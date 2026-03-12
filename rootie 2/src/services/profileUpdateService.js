/**
 * Rootie — Profile Update Service
 *
 * Lets a fully onboarded parent correct any detail they entered during
 * onboarding via a simple WhatsApp conversation.
 *
 * Trigger keywords (case-insensitive, detected before the classifier):
 *   "update profile", "edit profile", "change name", "change my name",
 *   "update name", "wrong name", "change child name", "wrong child name",
 *   "update child", "change child", "change age", "update age",
 *   "change reminder", "update reminder", "change time", "update time"
 *
 * Flow:
 *   1. Parent sends a trigger keyword → Rootie shows a numbered menu
 *   2. Parent picks a number (1–5)   → Rootie asks for the new value
 *   3. Parent replies with new value  → Rootie saves it and confirms
 *
 * State is stored in a lightweight in-memory map keyed by user_id.
 * (Safe for MVP / single-instance; replace with a DB column for multi-instance.)
 *
 * Editable fields:
 *   1. My name (parent_name on users table)
 *   2. Child name (child_name on children table — if multiple children, asks which one first)
 *   3. Child age  (child_age  on children table)
 *   4. Reminder time (reminder_hour on users table)
 *   5. Cancel
 */

const { updateUser }                   = require('./userService');
const { getChildrenByUserId,
        updateChild }                  = require('./childService');
const { parseHour }                    = require('./onboardingService');
const { logger }                       = require('../utils/logger');

// ─── In-memory edit session store ────────────────────────────────────────────
// Key: user_id (number)
// Value: { stage, field, childId? }
//   stage: 'menu' | 'awaiting_value' | 'awaiting_child_pick'
//   field: 'parent_name' | 'child_name' | 'child_age' | 'reminder_hour'
const editSessions = new Map();

// ─── Trigger detection ────────────────────────────────────────────────────────
const TRIGGER_PATTERNS = [
  /\bupdate\s+profile\b/i,
  /\bedit\s+profile\b/i,
  /\bchange\s+(my\s+)?name\b/i,
  /\bupdate\s+(my\s+)?name\b/i,
  /\bwrong\s+(my\s+)?name\b/i,
  /\bchange\s+child\s*(\'s)?\s*name\b/i,
  /\bwrong\s+child\s*(\'s)?\s*name\b/i,
  /\bupdate\s+child\b/i,
  /\bchange\s+child\b/i,
  /\bchange\s+(child\s+)?age\b/i,
  /\bupdate\s+(child\s+)?age\b/i,
  /\bchange\s+(reminder|time)\b/i,
  /\bupdate\s+(reminder|time)\b/i,
  /\bwrong\s+(child|age|name|time|reminder)\b/i,
];

function isProfileUpdateTrigger(text) {
  return TRIGGER_PATTERNS.some(p => p.test(text));
}

function hasActiveSession(userId) {
  return editSessions.has(userId);
}

// ─── Menu message ─────────────────────────────────────────────────────────────
function buildMenu(parentName) {
  return (
    `Hi ${parentName || 'there'}! 🌱 What would you like to update?\n\n` +
    `1️⃣  My name\n` +
    `2️⃣  Child's name\n` +
    `3️⃣  Child's age\n` +
    `4️⃣  Reminder time\n` +
    `5️⃣  Cancel\n\n` +
    `Just reply with a number.`
  );
}

// ─── Main handler ─────────────────────────────────────────────────────────────
/**
 * Call this from webhook.js whenever isProfileUpdateTrigger() or hasActiveSession() is true.
 * Returns the reply string to send back to the parent.
 *
 * @param {object} user     - full user row from DB
 * @param {string} text     - trimmed inbound message text
 * @returns {Promise<string>}
 */
async function handleProfileUpdate(user, text) {
  const userId  = user.user_id;
  const session = editSessions.get(userId);

  // ── No active session: show menu ────────────────────────────────────────────
  if (!session) {
    editSessions.set(userId, { stage: 'menu' });
    return buildMenu(user.parent_name);
  }

  // ── Stage: menu — waiting for the user to pick 1–5 ──────────────────────────
  if (session.stage === 'menu') {
    const choice = text.trim();

    if (choice === '1') {
      editSessions.set(userId, { stage: 'awaiting_value', field: 'parent_name' });
      return `What would you like to change your name to? 😊`;
    }

    if (choice === '2') {
      const children = await getChildrenByUserId(userId);
      if (children.length === 0) {
        editSessions.delete(userId);
        return `I don't have any children saved for you yet. Please complete onboarding first. 🌱`;
      }
      if (children.length === 1) {
        editSessions.set(userId, { stage: 'awaiting_value', field: 'child_name', childId: children[0].child_id });
        return `What would you like to change *${children[0].child_name}*'s name to?`;
      }
      // Multiple children — ask which one
      const list = children.map((c, i) => `${i + 1}️⃣  ${c.child_name}`).join('\n');
      editSessions.set(userId, { stage: 'awaiting_child_pick', field: 'child_name', children });
      return `Which child's name would you like to update?\n\n${list}\n\nReply with a number.`;
    }

    if (choice === '3') {
      const children = await getChildrenByUserId(userId);
      if (children.length === 0) {
        editSessions.delete(userId);
        return `I don't have any children saved for you yet. 🌱`;
      }
      if (children.length === 1) {
        editSessions.set(userId, { stage: 'awaiting_value', field: 'child_age', childId: children[0].child_id, childName: children[0].child_name });
        return `How old is *${children[0].child_name}* now? (Just type the age, e.g. *6*)`;
      }
      const list = children.map((c, i) => `${i + 1}️⃣  ${c.child_name}`).join('\n');
      editSessions.set(userId, { stage: 'awaiting_child_pick', field: 'child_age', children });
      return `Which child's age would you like to update?\n\n${list}\n\nReply with a number.`;
    }

    if (choice === '4') {
      editSessions.set(userId, { stage: 'awaiting_value', field: 'reminder_hour' });
      return (
        `What time would you like to receive your weekly prompts and activities?\n\n` +
        `Reply with a time like *8am*, *7:30am*, or *evening*. 💛`
      );
    }

    if (choice === '5') {
      editSessions.delete(userId);
      return `No problem! Nothing was changed. 🌱 Just message me any time if you'd like to update something.`;
    }

    // Unrecognised input — show menu again
    return buildMenu(user.parent_name);
  }

  // ── Stage: awaiting_child_pick — user is choosing which child ───────────────
  if (session.stage === 'awaiting_child_pick') {
    const idx = parseInt(text.trim(), 10) - 1;
    const children = session.children;

    if (isNaN(idx) || idx < 0 || idx >= children.length) {
      const list = children.map((c, i) => `${i + 1}️⃣  ${c.child_name}`).join('\n');
      return `Please reply with a number from the list:\n\n${list}`;
    }

    const chosen = children[idx];

    if (session.field === 'child_name') {
      editSessions.set(userId, { stage: 'awaiting_value', field: 'child_name', childId: chosen.child_id });
      return `What would you like to change *${chosen.child_name}*'s name to?`;
    }

    if (session.field === 'child_age') {
      editSessions.set(userId, { stage: 'awaiting_value', field: 'child_age', childId: chosen.child_id, childName: chosen.child_name });
      return `How old is *${chosen.child_name}* now? (e.g. *6*)`;
    }
  }

  // ── Stage: awaiting_value — user is supplying the new value ─────────────────
  if (session.stage === 'awaiting_value') {
    const { field, childId, childName } = session;
    const value = text.trim();

    // ── Update parent name ──────────────────────────────────────────────────
    if (field === 'parent_name') {
      if (!value) {
        return `I didn't catch that — what would you like your name to be?`;
      }
      await updateUser(user.whatsapp_number, { parent_name: value });
      editSessions.delete(userId);
      logger.info('Profile updated: parent_name', { userId, newValue: value });
      return `Done! I'll call you *${value}* from now on. 💛`;
    }

    // ── Update child name ───────────────────────────────────────────────────
    if (field === 'child_name') {
      if (!value) {
        return `I didn't catch that — what should I call your child?`;
      }
      await updateChild(childId, { child_name: value });
      editSessions.delete(userId);
      logger.info('Profile updated: child_name', { userId, childId, newValue: value });
      return `Updated! I'll refer to your child as *${value}* from now on. 🌱`;
    }

    // ── Update child age ────────────────────────────────────────────────────
    if (field === 'child_age') {
      const age = parseInt(value, 10);
      if (isNaN(age) || age < 0 || age > 18) {
        return `That doesn't look like a valid age. Please reply with a number, e.g. *6*.`;
      }
      await updateChild(childId, { child_age: age });
      editSessions.delete(userId);
      logger.info('Profile updated: child_age', { userId, childId, newValue: age });
      const name = childName || 'your child';
      return `Got it! I've updated *${name}*'s age to *${age}*. 🌱`;
    }

    // ── Update reminder time ────────────────────────────────────────────────
    if (field === 'reminder_hour') {
      const hour = parseHour(value);
      if (hour === null) {
        return `I didn't quite catch that. Please reply with a time like *8am*, *7:30am*, or *evening*.`;
      }
      const displayHour = hour === 0 ? '12:00 AM'
        : hour < 12  ? `${hour}:00 AM`
        : hour === 12 ? '12:00 PM'
        : `${hour - 12}:00 PM`;
      await updateUser(user.whatsapp_number, { reminder_hour: hour });
      editSessions.delete(userId);
      logger.info('Profile updated: reminder_hour', { userId, newValue: hour });
      return `Done! I'll send your weekly prompts and activities at *${displayHour}* from now on. 💛`;
    }
  }

  // Fallback — clear session and show menu
  editSessions.delete(userId);
  return buildMenu(user.parent_name);
}

module.exports = { handleProfileUpdate, isProfileUpdateTrigger, hasActiveSession };
