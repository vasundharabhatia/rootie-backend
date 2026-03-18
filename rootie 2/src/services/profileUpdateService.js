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
 *   - Archive/remove child
 *   - Child traits (conversational — parent describes child in one message,
 *     AI extracts temperament / sensitivity / social style / strengths / challenges)
 *
 * Read-only commands:
 *   - show my profile
 *   - show my family
 *   - show my settings
 *
 * ── Traits flow (new) ────────────────────────────────────────────────────────
 * OLD: numbered menu → pick one field → enter value → repeat for each field
 * NEW: Rootie asks one open question → parent describes child naturally →
 *      AI extracts all fields → Rootie reflects back → parent confirms or edits
 *
 * Session steps for traits:
 *   describe_child_traits  — waiting for parent's free-text description
 *   confirm_child_traits   — waiting for yes / edit / cancel
 */

const { updateUser }                     = require('./userService');
const {
  createChild,
  getChildrenByUserId,
  updateChild,
  archiveChild,
  renameChild,
  findPotentialDuplicateChild,
  getChildById,
}                                        = require('./childService');
const {
  setFlowSession,
  getFlowSession,
  clearFlowSession,
}                                        = require('./flowSessionService');
const {
  extractChildTraits,
  formatTraitsForConfirmation,
  mergeTraits,
}                                        = require('./traitExtractorService');
const { logger }                         = require('../utils/logger');

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
  'remove child',
  'archive child',
  'delete child',
  'edit child traits',
  'update child traits',
  'child traits',
  'tell you about',
  'update about',
  'describe my child',
  'temperament',
  'sensitivity',
  'social style',
  'strengths',
  'challenges',
];

const VIEW_TRIGGERS = [
  'show my profile',
  'show profile',
  'my profile',
  'show my family',
  'show family',
  'my family',
  'show my settings',
  'show settings',
  'my settings',
];

const TIMEZONE_ALIASES = {
  singapore:   'Asia/Singapore',
  sg:          'Asia/Singapore',
  sgt:         'Asia/Singapore',
  india:       'Asia/Kolkata',
  kolkata:     'Asia/Kolkata',
  mumbai:      'Asia/Kolkata',
  delhi:       'Asia/Kolkata',
  ist:         'Asia/Kolkata',
  dubai:       'Asia/Dubai',
  uae:         'Asia/Dubai',
  london:      'Europe/London',
  uk:          'Europe/London',
  britain:     'Europe/London',
  bst:         'Europe/London',
  gmt:         'Europe/London',
  sydney:      'Australia/Sydney',
  australia:   'Australia/Sydney',
  'new york':  'America/New_York',
  nyc:         'America/New_York',
  est:         'America/New_York',
  california:  'America/Los_Angeles',
  la:          'America/Los_Angeles',
  pst:         'America/Los_Angeles',
  toronto:     'America/Toronto',
  canada:      'America/Toronto',
};

function isProfileUpdateTrigger(messageText) {
  const lower = messageText.trim().toLowerCase();
  return TRIGGER_PHRASES.some(phrase => lower.includes(phrase));
}

function isProfileViewTrigger(messageText) {
  const lower = messageText.trim().toLowerCase();
  return VIEW_TRIGGERS.some(phrase => lower.includes(phrase));
}

async function hasActiveSession(userId) {
  const session = await getFlowSession(userId);
  return !!session && session.flow_type === 'profile_update';
}

function parseHour(text) {
  const t = text.trim().toLowerCase();
  if (/\b(morning|morn)\b/.test(t)) return 8;
  if (/\b(afternoon|noon)\b/.test(t)) return 12;
  if (/\b(evening|eve)\b/.test(t)) return 18;
  if (/\b(night)\b/.test(t)) return 20;

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
  const match   = trimmed.match(/\d{1,2}/);
  if (!match) return null;

  const age = parseInt(match[0], 10);
  if (Number.isNaN(age) || age < 0 || age > 18) return null;

  return age;
}

function resolveTimezone(text) {
  const raw   = text.trim();
  const lower = raw.toLowerCase();

  if (TIMEZONE_ALIASES[lower]) return TIMEZONE_ALIASES[lower];

  for (const key of Object.keys(TIMEZONE_ALIASES)) {
    if (lower.includes(key)) return TIMEZONE_ALIASES[key];
  }

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
    `• *7* — Remove/archive a child\n` +
    `• *8* — Update a child's personality profile\n` +
    `• *cancel* — Never mind`
  );
}

function buildChildrenList(children) {
  return children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
}

function buildChildTraitSummary(child) {
  const lines = [];
  if (child.temperament)       lines.push(`• Personality: *${child.temperament}*`);
  if (child.sensitivity_level) lines.push(`• Sensitivity: *${child.sensitivity_level}*`);
  if (child.social_style)      lines.push(`• Social style: *${child.social_style}*`);
  if (child.strengths)         lines.push(`• Strengths: *${child.strengths}*`);
  if (child.challenges)        lines.push(`• Challenges: *${child.challenges}*`);

  return lines.length
    ? lines.join('\n')
    : `_(Nothing saved yet)_`;
}

// ─── Ask the open traits question ─────────────────────────────────────────
function buildTraitsQuestion(childName, existingChild) {
  const hasExisting = (
    existingChild.temperament ||
    existingChild.sensitivity_level ||
    existingChild.social_style ||
    existingChild.strengths ||
    existingChild.challenges
  );

  if (hasExisting) {
    return (
      `Here's what I currently have for *${childName}*:\n\n` +
      `${buildChildTraitSummary(existingChild)}\n\n` +
      `Tell me about *${childName}* in your own words — their personality, what they're good at, ` +
      `what they find tricky. I'll update my notes from what you share. 🌱\n\n` +
      `_(Or reply *cancel* to stop)_`
    );
  }

  return (
    `Tell me a bit about *${childName}* — what are they like? ` +
    `Their personality, what they're good at, what they find tricky. ` +
    `Just talk to me like you would a friend. 🌱\n\n` +
    `_(Or reply *cancel* to stop)_`
  );
}

async function handleProfileView(user, messageText) {
  const lower          = messageText.trim().toLowerCase();
  const activeChildren = await getChildrenByUserId(user.user_id);
  const allChildren    = await getChildrenByUserId(user.user_id, { includeArchived: true });
  const archivedChildren = allChildren.filter(c => c.is_archived);

  if (lower.includes('family')) {
    if (!allChildren.length) {
      return `I don't have any family details saved yet. 🌱`;
    }

    const activeSection = activeChildren.length
      ? activeChildren.map(c => `• *${c.child_name}* — age ${c.child_age ?? '?'}`).join('\n')
      : `• No active children saved`;

    const archivedSection = archivedChildren.length
      ? `\n\nArchived children:\n${archivedChildren.map(c => `• *${c.child_name}*`).join('\n')}`
      : '';

    return (
      `Here's your family snapshot 🌱\n\n` +
      `Active children:\n${activeSection}` +
      archivedSection
    );
  }

  if (lower.includes('settings')) {
    return (
      `Here are your current settings ⚙️\n\n` +
      `• Reminder time: *${formatHour(user.reminder_hour ?? 8)}*\n` +
      `• Timezone: *${user.timezone || 'UTC'}*\n` +
      `• Plan: *${user.plan_type || 'free'}*`
    );
  }

  const childrenLine = activeChildren.length
    ? activeChildren.map(c => `${c.child_name} (${c.child_age ?? '?'})`).join(', ')
    : 'No active children saved yet';

  return (
    `Here's your profile 💛\n\n` +
    `• Name: *${user.parent_name || 'Not set'}*\n` +
    `• Children: *${childrenLine}*\n` +
    `• Reminder time: *${formatHour(user.reminder_hour ?? 8)}*\n` +
    `• Timezone: *${user.timezone || 'UTC'}*`
  );
}

async function handleProfileUpdate(user, messageText) {
  const text   = messageText.trim();
  const userId = user.user_id;

  let session = await getFlowSession(userId);

  if (!session) {
    await setFlowSession(userId, 'profile_update', 'choose_field', {});
    return buildMainMenu();
  }

  if (/^cancel$/i.test(text)) {
    await clearFlowSession(userId);
    return `No problem! Nothing was changed. 💛`;
  }

  if (session.flow_type !== 'profile_update') {
    await clearFlowSession(userId);
    await setFlowSession(userId, 'profile_update', 'choose_field', {});
    return buildMainMenu();
  }

  // ── Choose field ──────────────────────────────────────────────────────────
  if (session.step === 'choose_field') {
    if (text === '1' || (/name/i.test(text) && !/child/i.test(text))) {
      await setFlowSession(userId, 'profile_update', 'enter_name', session.data || {});
      return `What would you like your new name to be?`;
    }

    if (text === '2' || (/child/i.test(text) && /name/i.test(text))) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
        await clearFlowSession(userId);
        return `I don't have any active children on record for you yet. 🌱`;
      }

      if (children.length === 1) {
        await setFlowSession(userId, 'profile_update', 'enter_child_name', {
          childId:      children[0].child_id,
          oldChildName: children[0].child_name,
        });
        return `What would you like to rename *${children[0].child_name}* to?`;
      }

      await setFlowSession(userId, 'profile_update', 'choose_child_for_rename', { children });
      return `Which child would you like to rename?\n\n${buildChildrenList(children)}`;
    }

    if (text === '3' || /time|reminder/i.test(text)) {
      await setFlowSession(userId, 'profile_update', 'enter_time', session.data || {});
      return `What time would you like to receive your prompts and activities?\n\nReply with something like *8am*, *7:30am*, or *evening*.`;
    }

    if (text === '4' || /add another child|add child|new child/i.test(text)) {
      await setFlowSession(userId, 'profile_update', 'enter_new_child_name', {});
      return `Of course 🌱 What is your child's name?`;
    }

    if (text === '5' || /age/i.test(text)) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
        await clearFlowSession(userId);
        return `I don't have any active children on record for you yet. 🌱`;
      }

      if (children.length === 1) {
        await setFlowSession(userId, 'profile_update', 'enter_child_age', {
          childId:   children[0].child_id,
          childName: children[0].child_name,
        });
        return `What is *${children[0].child_name}*'s correct age?`;
      }

      await setFlowSession(userId, 'profile_update', 'choose_child_for_age', { children });
      return `Which child's age would you like to update?\n\n${buildChildrenList(children)}`;
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

    if (text === '7' || /remove child|archive child|delete child/i.test(text)) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
        await clearFlowSession(userId);
        return `I don't have any active children on record for you yet. 🌱`;
      }

      if (children.length === 1) {
        await setFlowSession(userId, 'profile_update', 'confirm_archive_child', {
          childId:   children[0].child_id,
          childName: children[0].child_name,
        });
        return `Are you sure you want to archive *${children[0].child_name}*? Reply *yes* to confirm or *cancel* to stop.`;
      }

      await setFlowSession(userId, 'profile_update', 'choose_child_for_archive', { children });
      return `Which child would you like to archive?\n\n${buildChildrenList(children)}`;
    }

    if (
      text === '8' ||
      /edit child traits|update child traits|child traits|personality|temperament|sensitivity|social style|strengths|challenges|tell you about|describe my child/i.test(text)
    ) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
        await clearFlowSession(userId);
        return `I don't have any active children on record for you yet. 🌱`;
      }

      if (children.length === 1) {
        await setFlowSession(userId, 'profile_update', 'describe_child_traits', {
          childId:   children[0].child_id,
          childName: children[0].child_name,
        });
        return buildTraitsQuestion(children[0].child_name, children[0]);
      }

      await setFlowSession(userId, 'profile_update', 'choose_child_for_traits', { children });
      return `Which child's personality profile would you like to update?\n\n${buildChildrenList(children)}`;
    }

    return buildMainMenu();
  }

  // ── Parent name ───────────────────────────────────────────────────────────
  if (session.step === 'enter_name') {
    if (!text.length) {
      return `Please type your new name, or reply *cancel* to stop.`;
    }

    await updateUser(user.whatsapp_number, { parent_name: text });
    await clearFlowSession(userId);

    logger.info('Profile update: parent name changed', { userId, newName: text });
    return `Done! I'll call you *${text}* from now on. 💛`;
  }

  // ── Child rename ──────────────────────────────────────────────────────────
  if (session.step === 'choose_child_for_rename') {
    const children = session.data.children || [];
    const selected = resolveChildSelection(text, children);

    if (!selected) {
      return `Please reply with a number or name from the list, or reply *cancel*.\n\n${buildChildrenList(children)}`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_child_name', {
      childId:      selected.child_id,
      oldChildName: selected.child_name,
    });

    return `What would you like to rename *${selected.child_name}* to?`;
  }

  if (session.step === 'enter_child_name') {
    if (!text.length) {
      return `Please type the new name, or reply *cancel* to stop.`;
    }

    try {
      await renameChild(userId, session.data.childId, text);
    } catch (error) {
      if (error.code === 'DUPLICATE_CHILD') {
        return `It looks like *${error.child.child_name}* is already in your family profile. 🌱\n\nPlease choose a different name, or reply *cancel*.`;
      }
      throw error;
    }

    const oldName = session.data.oldChildName || 'your child';
    await clearFlowSession(userId);

    logger.info('Profile update: child name changed', {
      userId,
      childId: session.data.childId,
      newName:  text,
    });

    return `Done! I've updated *${oldName}*'s name to *${text.trim()}*. 🌱`;
  }

  // ── Reminder time ─────────────────────────────────────────────────────────
  if (session.step === 'enter_time') {
    const hour = parseHour(text);

    if (hour === null) {
      return `I didn't quite catch that 😊\n\nPlease reply with a time like *8am*, *7:30am*, *9*, or *evening*.`;
    }

    await updateUser(user.whatsapp_number, { reminder_hour: hour });
    await clearFlowSession(userId);

    logger.info('Profile update: reminder hour changed', { userId, hour });
    return `Done! I'll send your prompts at *${formatHour(hour)}* your time from now on. 💛`;
  }

  // ── Add new child ─────────────────────────────────────────────────────────
  if (session.step === 'enter_new_child_name') {
    if (!text.length) {
      return `Please type your child's name, or reply *cancel* to stop.`;
    }

    const duplicate = await findPotentialDuplicateChild(userId, text);
    if (duplicate) {
      return `It looks like *${duplicate.child_name}* is already in your family profile. 🌱\n\nPlease enter a different child's name, or reply *cancel*.`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_new_child_age', {
      childName: text.trim(),
    });

    return `How old is *${text.trim()}*?`;
  }

  if (session.step === 'enter_new_child_age') {
    const childAge  = parseChildAge(text);

    if (childAge === null) {
      return `Please reply with an age between *0* and *18*, or reply *cancel*.`;
    }

    const childName = session.data.childName || 'your child';

    try {
      await createChild(userId, { childName, childAge });
    } catch (error) {
      if (error.code === 'DUPLICATE_CHILD') {
        await setFlowSession(userId, 'profile_update', 'enter_new_child_name', {});
        return `It looks like *${error.child.child_name}* is already in your family profile. 🌱\n\nLet's try again — what is your child's name?`;
      }
      throw error;
    }

    await clearFlowSession(userId);

    logger.info('Profile update: child added', { userId, childName, childAge });
    return `Done! I've added *${childName}* (${childAge}) to your family. 🌱`;
  }

  // ── Child age ─────────────────────────────────────────────────────────────
  if (session.step === 'choose_child_for_age') {
    const children = session.data.children || [];
    const selected = resolveChildSelection(text, children);

    if (!selected) {
      return `Please reply with a number or name from the list, or reply *cancel*.\n\n${buildChildrenList(children)}`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_child_age', {
      childId:   selected.child_id,
      childName: selected.child_name,
    });

    return `What is *${selected.child_name}*'s correct age?`;
  }

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
      childId:   session.data.childId,
      childName,
      age,
    });

    return `Done! I've updated *${childName}*'s age to *${age}*. 🌱`;
  }

  // ── Timezone ──────────────────────────────────────────────────────────────
  if (session.step === 'enter_timezone') {
    const timezone = resolveTimezone(text);

    if (!timezone) {
      return `I couldn't match that timezone yet 🌍\n\nPlease try something like *Singapore*, *India*, *Dubai*, *London*, or *Asia/Singapore*.`;
    }

    await updateUser(user.whatsapp_number, { timezone });
    await clearFlowSession(userId);

    logger.info('Profile update: timezone changed', { userId, timezone });
    return `Done! I'll now use *${timezone}* for your reminders and scheduled messages. 💛`;
  }

  // ── Archive child ─────────────────────────────────────────────────────────
  if (session.step === 'choose_child_for_archive') {
    const children = session.data.children || [];
    const selected = resolveChildSelection(text, children);

    if (!selected) {
      return `Please reply with a number or name from the list, or reply *cancel*.\n\n${buildChildrenList(children)}`;
    }

    await setFlowSession(userId, 'profile_update', 'confirm_archive_child', {
      childId:   selected.child_id,
      childName: selected.child_name,
    });

    return `Are you sure you want to archive *${selected.child_name}*? Reply *yes* to confirm or *cancel* to stop.`;
  }

  if (session.step === 'confirm_archive_child') {
    const answer = text.toLowerCase();

    if (!['yes', 'y'].includes(answer)) {
      return `Please reply *yes* to confirm, or *cancel* to stop.`;
    }

    const childName = session.data.childName || 'your child';
    await archiveChild(session.data.childId);
    await clearFlowSession(userId);

    logger.info('Profile update: child archived', {
      userId,
      childId:   session.data.childId,
      childName,
    });

    return `Done. I've archived *${childName}* from your active family profile. 🌱`;
  }

  // ── Child selection for traits (multi-child) ──────────────────────────────
  if (session.step === 'choose_child_for_traits') {
    const children = session.data.children || [];
    const selected = resolveChildSelection(text, children);

    if (!selected) {
      return `Please reply with a number or name from the list, or reply *cancel*.\n\n${buildChildrenList(children)}`;
    }

    // Fetch fresh child row so we can show existing traits
    const freshChild = await getChildById(selected.child_id);

    await setFlowSession(userId, 'profile_update', 'describe_child_traits', {
      childId:   selected.child_id,
      childName: selected.child_name,
    });

    return buildTraitsQuestion(selected.child_name, freshChild || selected);
  }

  // ── NEW: Free-text child description ─────────────────────────────────────
  if (session.step === 'describe_child_traits') {
    if (!text.length) {
      return `Just tell me about *${session.data.childName || 'your child'}* in your own words, or reply *cancel* to stop. 🌱`;
    }

    // Run AI extraction
    const extracted = await extractChildTraits(text);
    const confirmation = formatTraitsForConfirmation(session.data.childName || 'your child', extracted);

    // Store extracted traits in session for the confirm step
    await setFlowSession(userId, 'profile_update', 'confirm_child_traits', {
      ...session.data,
      extractedTraits: extracted,
    });

    return confirmation;
  }

  // ── NEW: Confirm and save extracted traits ────────────────────────────────
  if (session.step === 'confirm_child_traits') {
    const childName      = session.data.childName || 'your child';
    const extractedTraits = session.data.extractedTraits || {};

    // "yes" / "yep" / "looks good" / "save it" / "correct" / "that's right"
    const isConfirm = /^(yes|yep|yeah|yup|correct|looks good|save|save it|that'?s right|perfect|great|ok|okay|sure)$/i.test(text.trim());

    if (isConfirm) {
      const freshChild = await getChildById(session.data.childId);
      const toSave     = mergeTraits(freshChild || {}, extractedTraits);

      if (Object.keys(toSave).length) {
        await updateChild(session.data.childId, toSave);

        logger.info('Profile update: child traits saved via AI extraction', {
          userId,
          childId:   session.data.childId,
          childName,
          saved:     JSON.stringify(toSave),
        });
      }

      await clearFlowSession(userId);

      return (
        `Saved! 🌱 I've updated my notes on *${childName}*. ` +
        `This will help me give you more personalised guidance going forward. 💛`
      );
    }

    // "edit" / "change" / "not quite" / "actually" → loop back to description
    const isEdit = /^(edit|change|no|nope|not quite|actually|wrong|redo|again|try again)$/i.test(text.trim())
      || text.trim().length > 10; // treat longer replies as a new description attempt

    if (isEdit && text.trim().length > 10) {
      // Parent typed a correction or new description — re-run extraction on it
      const reExtracted  = await extractChildTraits(text);
      const confirmation = formatTraitsForConfirmation(childName, reExtracted);

      await setFlowSession(userId, 'profile_update', 'confirm_child_traits', {
        ...session.data,
        extractedTraits: reExtracted,
      });

      return confirmation;
    }

    if (isEdit) {
      // Short "edit" / "no" — ask them to describe again
      const freshChild = await getChildById(session.data.childId);
      await setFlowSession(userId, 'profile_update', 'describe_child_traits', {
        childId:   session.data.childId,
        childName: session.data.childName,
      });
      return buildTraitsQuestion(childName, freshChild || {});
    }

    // Unclear reply — re-show the confirmation
    const confirmation = formatTraitsForConfirmation(childName, extractedTraits);
    return confirmation;
  }

  await clearFlowSession(userId);
  return `Let's try that again. 🌱\n\n${buildMainMenu()}`;
}

module.exports = {
  handleProfileUpdate,
  isProfileUpdateTrigger,
  isProfileViewTrigger,
  handleProfileView,
  hasActiveSession,
};
