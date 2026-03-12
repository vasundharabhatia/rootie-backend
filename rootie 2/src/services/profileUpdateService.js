/**
 * Rootie — Profile Update Service
 *
 * Allows onboarded parents to update their own profile details via WhatsApp.
 * Supported updates:
 *   - Parent name
 *   - Child name (for an existing child)
 *   - Preferred reminder time (also re-detects and saves timezone)
 *
 * Trigger phrases (case-insensitive, detected by isProfileUpdateTrigger):
 *   "update profile", "change my name", "edit profile", "update my name",
 *   "wrong name", "wrong child name", "change child name", "update child",
 *   "change time", "update time", "change reminder", "update reminder"
 *
 * Flow:
 *   1. isProfileUpdateTrigger(text) → true  → start a new session
 *   2. handleProfileUpdate(user, text) → returns next prompt or confirmation
 *   3. hasActiveSession(userId) → true while a session is in progress
 *
 * Sessions are stored in-memory (keyed by user_id).
 * Safe for MVP / single-instance deployments.
 *
 * ── TIMEZONE / SCHEDULE BUG FIX ──────────────────────────────────────────────
 *
 * Previously, the 'enter_time' step only saved reminder_hour:
 *   await updateUser(user.whatsapp_number, { reminder_hour: hour });
 *
 * This meant the timezone column was never refreshed after onboarding. If the
 * user's timezone was incorrectly detected during onboarding (e.g. a US number
 * used from India), or if the user moved countries, their reminders would fire
 * at the wrong local time even after they updated their preferred hour.
 *
 * FIX: The 'enter_time' step now also re-detects the timezone from the user's
 * WhatsApp number and saves both reminder_hour AND timezone together. This
 * mirrors exactly what onboardingService step 5 does.
 *
 * NOTE: The primary cause of timezone/schedule updates not working at all was
 * the interactive message guard in webhook.js (see webhook.js fix comments).
 * This fix is a secondary improvement that ensures the saved data is correct.
 */

const { updateUser }            = require('./userService');
const { getChildrenByUserId,
        updateChild }           = require('./childService');
const { guessTimezone }         = require('./onboardingService');
const { logger }                = require('../utils/logger');

// ─── In-memory session store ──────────────────────────────────────────────────
// Key:   user_id (number)
// Value: { step: string, data: object }
//
// Steps:
//   'choose_field'     — ask what to update
//   'enter_name'       — waiting for new parent name
//   'choose_child'     — waiting for which child to rename (multi-child only)
//   'enter_child_name' — waiting for new child name
//   'enter_time'       — waiting for new reminder time
const sessions = new Map();

// ─── Trigger detection ────────────────────────────────────────────────────────
const TRIGGER_PHRASES = [
  'update profile',
  'edit profile',
  'change my name',
  'update my name',
  'wrong name',
  'wrong child name',
  'change child name',
  'update child',
  'change time',
  'update time',
  'change reminder',
  'update reminder',
];

/**
 * Returns true if the message should start a profile-update session.
 * @param {string} messageText
 * @returns {boolean}
 */
function isProfileUpdateTrigger(messageText) {
  const lower = messageText.trim().toLowerCase();
  return TRIGGER_PHRASES.some(phrase => lower.includes(phrase));
}

/**
 * Returns true if the user currently has an active profile-update session.
 * @param {number} userId
 * @returns {boolean}
 */
function hasActiveSession(userId) {
  return sessions.has(userId);
}

// ─── Hour parser (mirrors onboardingService) ──────────────────────────────────
function parseHour(text) {
  const t = text.trim().toLowerCase();
  if (/\b(morning|morn)\b/.test(t))   return 8;
  if (/\b(afternoon|noon)\b/.test(t)) return 12;
  if (/\b(evening|eve)\b/.test(t))    return 18;
  if (/\bnight\b/.test(t))            return 20;
  const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;
  let hour = parseInt(match[1], 10);
  const ampm = match[3];
  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return hour;
}

/**
 * Handle a message from a user who is either starting or continuing a
 * profile-update session.
 *
 * @param {object} user        — full user row from DB
 * @param {string} messageText — raw inbound message
 * @returns {string} reply to send back
 */
async function handleProfileUpdate(user, messageText) {
  const text     = messageText.trim();
  const userId   = user.user_id;
  let   session  = sessions.get(userId);

  // ── No active session → start one ──────────────────────────────────────────
  if (!session) {
    session = { step: 'choose_field', data: {} };
    sessions.set(userId, session);
    return (
      `Sure! What would you like to update? 🌱\n\n` +
      `Reply with:\n` +
      `• *1* — My name\n` +
      `• *2* — A child's name\n` +
      `• *3* — My reminder time\n` +
      `• *cancel* — Never mind`
    );
  }

  // ── Cancel at any point ─────────────────────────────────────────────────────
  if (/^cancel$/i.test(text)) {
    sessions.delete(userId);
    return `No problem! Nothing was changed. 💛`;
  }

  // ── Step: choose_field ──────────────────────────────────────────────────────
  if (session.step === 'choose_field') {
    if (text === '1' || /name/i.test(text) && !/child/i.test(text)) {
      session.step = 'enter_name';
      return `What would you like your new name to be?`;
    }

    if (text === '2' || /child/i.test(text)) {
      const children = await getChildrenByUserId(userId);
      if (!children.length) {
        sessions.delete(userId);
        return `I don't have any children on record for you yet. 🌱`;
      }
      if (children.length === 1) {
        session.step = 'enter_child_name';
        session.data.childId = children[0].child_id;
        session.data.oldChildName = children[0].child_name;
        return `What would you like to rename *${children[0].child_name}* to?`;
      }
      // Multiple children — ask which one
      const list = children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
      session.step = 'choose_child';
      session.data.children = children;
      return `Which child would you like to rename?\n\n${list}`;
    }

    if (text === '3' || /time|reminder/i.test(text)) {
      session.step = 'enter_time';
      return (
        `What time would you like to receive your prompts and activities?\n\n` +
        `Reply with something like *8am*, *7:30am*, or *evening*.`
      );
    }

    // Unrecognised input
    return (
      `I didn't quite get that 😊 Please reply with:\n` +
      `• *1* — My name\n` +
      `• *2* — A child's name\n` +
      `• *3* — My reminder time\n` +
      `• *cancel* — Never mind`
    );
  }

  // ── Step: enter_name ────────────────────────────────────────────────────────
  if (session.step === 'enter_name') {
    if (!text.length) {
      return `Please type your new name, or reply *cancel* to stop.`;
    }
    await updateUser(user.whatsapp_number, { parent_name: text });
    sessions.delete(userId);
    logger.info('Profile update: parent name changed', { userId, newName: text });
    return `Done! I'll call you *${text}* from now on. 💛`;
  }

  // ── Step: choose_child ──────────────────────────────────────────────────────
  if (session.step === 'choose_child') {
    const children = session.data.children || [];
    const idx      = parseInt(text, 10) - 1;
    if (isNaN(idx) || idx < 0 || idx >= children.length) {
      const list = children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
      return `Please choose a number from the list, or reply *cancel*.\n\n${list}`;
    }
    session.data.childId      = children[idx].child_id;
    session.data.oldChildName = children[idx].child_name;
    session.step = 'enter_child_name';
    return `What would you like to rename *${children[idx].child_name}* to?`;
  }

  // ── Step: enter_child_name ──────────────────────────────────────────────────
  if (session.step === 'enter_child_name') {
    if (!text.length) {
      return `Please type the new name, or reply *cancel* to stop.`;
    }
    await updateChild(session.data.childId, { child_name: text });
    const oldName = session.data.oldChildName || 'your child';
    sessions.delete(userId);
    logger.info('Profile update: child name changed', {
      userId,
      childId:  session.data.childId,
      newName:  text,
    });
    return `Done! I've updated *${oldName}*'s name to *${text}*. 🌱`;
  }

  // ── Step: enter_time ────────────────────────────────────────────────────────
  // FIX: Also re-detect and save timezone alongside reminder_hour.
  // Previously only reminder_hour was saved. If the user's timezone was wrong
  // (bad detection at onboarding, or user moved countries), the reminder would
  // fire at the wrong local time even after they updated their preferred hour.
  if (session.step === 'enter_time') {
    const hour = parseHour(text);
    if (hour === null) {
      return (
        `I didn't quite catch that 😊\n\n` +
        `Please reply with a time like *8am*, *7:30am*, *9*, or *evening*.`
      );
    }

    // Re-detect timezone from phone number (mirrors onboarding step 5 behaviour)
    const timezone = guessTimezone(user.whatsapp_number);

    await updateUser(user.whatsapp_number, { reminder_hour: hour, timezone });

    const displayHour = hour === 0 ? '12:00 AM'
      : hour < 12  ? `${hour}:00 AM`
      : hour === 12 ? '12:00 PM'
      : `${hour - 12}:00 PM`;

    sessions.delete(userId);
    logger.info('Profile update: reminder hour and timezone updated', { userId, hour, timezone });
    return `Done! I'll send your prompts at *${displayHour}* your time from now on. 💛`;
  }

  // Fallback — clear stale session
  sessions.delete(userId);
  return `Something went wrong with your update session. Please try again. 🌱`;
}

module.exports = {
  handleProfileUpdate,
  isProfileUpdateTrigger,
  hasActiveSession,
};
