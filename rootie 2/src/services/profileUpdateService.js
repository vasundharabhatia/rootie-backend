/**
 * Rootie — Profile Update Service
 *
 * DB-backed family/profile management flow.
 *
 * Supported updates:
 *   - Parent name
 *   - Child name
 *   - Child age
 *   - Add a new child after onboarding
 *   - Reminder time
 *   - Timezone
 *
 * Sessions are stored in Postgres via flowSessionService, so they survive
 * restarts and deploys.
 */

const { updateUser } = require('./userService');
const { createChild, getChildrenByUserId, updateChild } = require('./childService');
const { setFlowSession, getFlowSession, clearFlowSession } = require('./flowSessionService');
const { logger } = require('../utils/logger');

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
  'add child',
  'add another child',
  'new child',
  'change age',
  'update age',
  'wrong age',
  'child age',
  'change time',
  'update time',
  'change reminder',
  'update reminder',
  'change timezone',
  'update timezone',
  'timezone',
  'manage family',
  'edit family',
];

// ─── Timezone aliases ─────────────────────────────────────────────────────────
const TIMEZONE_ALIASES = {
  singapore: 'Asia/Singapore',
  sg: 'Asia/Singapore',
  sgt: 'Asia/Singapore',

  india: 'Asia/Kolkata',
  kolkata: 'Asia/Kolkata',
  mumbai: 'Asia/Kolkata',
  delhi: 'Asia/Kolkata',
  ist: 'Asia/Kolkata',

  dubai: 'Asia/Dubai',
  uae: 'Asia/Dubai',

  london: 'Europe/London',
  uk: 'Europe/London',
  britain: 'Europe/London',
  bst: 'Europe/London',
  gmt: 'Europe/London',

  sydney: 'Australia/Sydney',
  australia: 'Australia/Sydney',

  'new york': 'America/New_York',
  nyc: 'America/New_York',
  est: 'America/New_York',

  california: 'America/Los_Angeles',
  la: 'America/Los_Angeles',
  pst: 'America/Los_Angeles',

  toronto: 'America/Toronto',
  canada: 'America/Toronto',
};

function isProfileUpdateTrigger(messageText) {
  const lower = messageText.trim().toLowerCase();
  return TRIGGER_PHRASES.some(phrase => lower.includes(phrase));
}

async function hasActiveSession(userId) {
  const session = await getFlowSession(userId);
  return !!session && session.flow_type === 'profile_update';
}

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

function formatHour(hour) {
  if (hour === 0) return '12:00 AM';
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return '12:00 PM';
  return `${hour - 12}:00 PM`;
}

function resolveChildSelection(messageText, children) {
  const text = messageText.trim();
  const idx  = parseInt(text, 10);

  if (!Number.isNaN(idx) && idx >= 1 && idx <= children.length) {
    return children[idx - 1];
  }

  const lower = text.toLowerCase();
  return children.find(c => c.child_name.toLowerCase() === lower) || null;
}

function parseChildAge(text) {
  const trimmed = text.trim().toLowerCase();
  const match = trimmed.match(/\d{1,2}/);
  if (!match) return null;

  const age = parseInt(match[0], 10);
  if (Number.isNaN(age) || age < 0 || age > 18) return null;

  return age;
}

function resolveTimezone(text) {
  const raw = text.trim();
  const lower = raw.toLowerCase();

  if (TIMEZONE_ALIASES[lower]) {
    return TIMEZONE_ALIASES[lower];
  }

  for (const key of Object.keys(TIMEZONE_ALIASES)) {
    if (lower.includes(key)) {
      return TIMEZONE_ALIASES[key];
    }
  }

  // Allow direct IANA-style input like Asia/Singapore
  if (/^[A-Za-z_]+\/[A-Za-z_]+(?:\/[A-Za-z_]+)?$/.test(raw)) {
    return raw;
  }

  return null;
}

function buildMainMenu() {
  return (
    `Sure! What would you like to update? 🌱\n\n` +
    `Reply with:\n` +
    `• *1* — My name\n` +
    `• *2* — A child's name\n` +
    `• *3* — My reminder time\n` +
    `• *4* — Add another child\n` +
    `• *5* — A child's age\n` +
    `• *6* — My timezone\n` +
    `• *cancel* — Never mind`
  );
}

async function handleProfileUpdate(user, messageText) {
  const text   = messageText.trim();
  const userId = user.user_id;

  let session = await getFlowSession(userId);

  // ── No active session → start one ──────────────────────────────────────────
  if (!session) {
    await setFlowSession(userId, 'profile_update', 'choose_field', {});
    return buildMainMenu();
  }

  // ── Cancel at any point ─────────────────────────────────────────────────────
  if (/^cancel$/i.test(text)) {
    await clearFlowSession(userId);
    return `No problem! Nothing was changed. 💛`;
  }

  // Safety fallback if some other flow somehow exists
  if (session.flow_type !== 'profile_update') {
    await clearFlowSession(userId);
    await setFlowSession(userId, 'profile_update', 'choose_field', {});
    return buildMainMenu();
  }

  // ── Step: choose_field ──────────────────────────────────────────────────────
  if (session.step === 'choose_field') {
    if (text === '1' || (/name/i.test(text) && !/child/i.test(text))) {
      await setFlowSession(userId, 'profile_update', 'enter_name', session.data || {});
      return `What would you like your new name to be?`;
    }

    if (text === '2' || (/child/i.test(text) && /name/i.test(text))) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
        await clearFlowSession(userId);
        return `I don't have any children on record for you yet. 🌱`;
      }

      if (children.length === 1) {
        await setFlowSession(userId, 'profile_update', 'enter_child_name', {
          childId: children[0].child_id,
          oldChildName: children[0].child_name,
        });
        return `What would you like to rename *${children[0].child_name}* to?`;
      }

      const list = children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
      await setFlowSession(userId, 'profile_update', 'choose_child_for_rename', { children });
      return `Which child would you like to rename?\n\n${list}`;
    }

    if (text === '3' || /time|reminder/i.test(text)) {
      await setFlowSession(userId, 'profile_update', 'enter_time', session.data || {});
      return (
        `What time would you like to receive your prompts and activities?\n\n` +
        `Reply with something like *8am*, *7:30am*, or *evening*.`
      );
    }

    if (text === '4' || /add another child|add child|new child/i.test(text)) {
      await setFlowSession(userId, 'profile_update', 'enter_new_child_name', {});
      return `Of course 🌱 What is your child's name?`;
    }

    if (text === '5' || /age/i.test(text)) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
        await clearFlowSession(userId);
        return `I don't have any children on record for you yet. 🌱`;
      }

      if (children.length === 1) {
        await setFlowSession(userId, 'profile_update', 'enter_child_age', {
          childId: children[0].child_id,
          childName: children[0].child_name,
        });
        return `What is *${children[0].child_name}*'s correct age?`;
      }

      const list = children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
      await setFlowSession(userId, 'profile_update', 'choose_child_for_age', { children });
      return `Which child's age would you like to update?\n\n${list}`;
    }

    if (text === '6' || /timezone/i.test(text)) {
      await setFlowSession(userId, 'profile_update', 'enter_timezone', session.data || {});
      return (
        `What timezone should I use for your reminders? 🌍\n\n` +
        `You can reply with something like:\n` +
        `• *Singapore*\n` +
        `• *India*\n` +
        `• *Dubai*\n` +
        `• *London*\n` +
        `• *Asia/Singapore*`
      );
    }

    return buildMainMenu();
  }

  // ── Step: enter_name ────────────────────────────────────────────────────────
  if (session.step === 'enter_name') {
    if (!text.length) {
      return `Please type your new name, or reply *cancel* to stop.`;
    }

    await updateUser(user.whatsapp_number, { parent_name: text });
    await clearFlowSession(userId);

    logger.info('Profile update: parent name changed', { userId, newName: text });
    return `Done! I'll call you *${text}* from now on. 💛`;
  }

  // ── Step: choose_child_for_rename ───────────────────────────────────────────
  if (session.step === 'choose_child_for_rename') {
    const children = session.data.children || [];
    const selected = resolveChildSelection(text, children);

    if (!selected) {
      const list = children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
      return `Please reply with a number or name from the list, or reply *cancel*.\n\n${list}`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_child_name', {
      childId: selected.child_id,
      oldChildName: selected.child_name,
    });

    return `What would you like to rename *${selected.child_name}* to?`;
  }

  // ── Step: enter_child_name ──────────────────────────────────────────────────
  if (session.step === 'enter_child_name') {
    if (!text.length) {
      return `Please type the new name, or reply *cancel* to stop.`;
    }

    await updateChild(session.data.childId, { child_name: text });
    const oldName = session.data.oldChildName || 'your child';

    await clearFlowSession(userId);

    logger.info('Profile update: child name changed', {
      userId,
      childId: session.data.childId,
      newName: text,
    });

    return `Done! I've updated *${oldName}*'s name to *${text}*. 🌱`;
  }

  // ── Step: enter_time ────────────────────────────────────────────────────────
  if (session.step === 'enter_time') {
    const hour = parseHour(text);

    if (hour === null) {
      return (
        `I didn't quite catch that 😊\n\n` +
        `Please reply with a time like *8am*, *7:30am*, *9*, or *evening*.`
      );
    }

    await updateUser(user.whatsapp_number, { reminder_hour: hour });
    await clearFlowSession(userId);

    logger.info('Profile update: reminder hour changed', { userId, hour });

    return `Done! I'll send your prompts at *${formatHour(hour)}* your time from now on. 💛`;
  }

  // ── Step: enter_new_child_name ──────────────────────────────────────────────
  if (session.step === 'enter_new_child_name') {
    if (!text.length) {
      return `Please type your child's name, or reply *cancel* to stop.`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_new_child_age', {
      childName: text,
    });

    return `How old is *${text}*?`;
  }

  // ── Step: enter_new_child_age ───────────────────────────────────────────────
  if (session.step === 'enter_new_child_age') {
    const childAge = parseChildAge(text);

    if (childAge === null) {
      return `Please reply with an age between *0* and *18*, or reply *cancel*.`;
    }

    const childName = session.data.childName || 'your child';

    await createChild(userId, {
      childName,
      childAge,
    });

    await clearFlowSession(userId);

    logger.info('Profile update: child added', {
      userId,
      childName,
      childAge,
    });

    return `Done! I've added *${childName}* (${childAge}) to your family. 🌱`;
  }

  // ── Step: choose_child_for_age ──────────────────────────────────────────────
  if (session.step === 'choose_child_for_age') {
    const children = session.data.children || [];
    const selected = resolveChildSelection(text, children);

    if (!selected) {
      const list = children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
      return `Please reply with a number or name from the list, or reply *cancel*.\n\n${list}`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_child_age', {
      childId: selected.child_id,
      childName: selected.child_name,
    });

    return `What is *${selected.child_name}*'s correct age?`;
  }

  // ── Step: enter_child_age ───────────────────────────────────────────────────
  if (session.step === 'enter_child_age') {
    const age = parseChildAge(text);

    if (age === null) {
      return `Please reply with an age between *0* and *18*, or reply *cancel*.`;
    }

    await updateChild(session.data.childId, { child_age: age });
    const childName = session.data.childName || 'your child';

    await clearFlowSession(userId);

    logger.info('Profile update: child age changed', {
      userId,
      childId: session.data.childId,
      childName,
      age,
    });

    return `Done! I've updated *${childName}*'s age to *${age}*. 🌱`;
  }

  // ── Step: enter_timezone ────────────────────────────────────────────────────
  if (session.step === 'enter_timezone') {
    const timezone = resolveTimezone(text);

    if (!timezone) {
      return (
        `I couldn't match that timezone yet 🌍\n\n` +
        `Please try something like *Singapore*, *India*, *Dubai*, *London*, or *Asia/Singapore*.`
      );
    }

    await updateUser(user.whatsapp_number, { timezone });
    await clearFlowSession(userId);

    logger.info('Profile update: timezone changed', { userId, timezone });

    return `Done! I'll now use *${timezone}* for your reminders and scheduled messages. 💛`;
  }

  // ── Fallback ────────────────────────────────────────────────────────────────
  await clearFlowSession(userId);
  return `Let's try that again. 🌱\n\n${buildMainMenu()}`;
}

module.exports = {
  handleProfileUpdate,
  isProfileUpdateTrigger,
  hasActiveSession,
};
