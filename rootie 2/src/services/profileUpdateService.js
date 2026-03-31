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
const { parseBirthday, birthdayToDbFields, formatBirthdayDisplay, deriveAge } = require('./birthdayService');
const { logger }                         = require('../utils/logger');

// ── Exact / substring trigger phrases ────────────────────────────────────
const TRIGGER_PHRASES = [
  // Profile / family
  'update profile',
  'edit profile',
  'manage family',
  'edit family',

  // Parent name
  'change my name',
  'update my name',
  'wrong name',

  // Child name
  'wrong child name',
  'change child name',
  'update child',
  'rename child',

  // Add / remove child
  'add child',
  'add another child',
  'new child',
  'remove child',
  'archive child',
  'delete child',

  // Age
  'change age',
  'update age',
  'wrong age',
  'child age',

  // Timezone
  'change timezone',
  'update timezone',
  'timezone',

  // Traits — exact phrases
  'edit child traits',
  'update child traits',
  'child traits',
  'child trait',        // singular
  "child's trait",
  "child's traits",
  'tell you about',
  'update about',
  'describe my child',
  'personality profile',
  'update personality',
  'edit personality',
  'temperament',
  'sensitivity',
  'social style',
  'strengths',
  'challenges',
];

// ── Regex patterns for natural-language trait/profile update phrasings ────
// Catches things like "update hero's trait", "edit Aarav's profile",
// "tell me about Aarav", "change Uno's personality", etc.
const TRIGGER_REGEXES = [
  // "update/edit/change [name]'s trait(s)/profile/personality"
  /(?:update|edit|change|fix|update)\s+\S+'?s?\s+(?:trait|traits|profile|personality|info|information|details)/i,
  // "[name]'s trait(s)/profile/personality"
  /\S+'s\s+(?:trait|traits|profile|personality)/i,
  // "update/edit [name]'s ..."
  /(?:update|edit)\s+\S+'s/i,
  // "tell you about [name]"
  /tell\s+(?:you|rootie)\s+about/i,
  // "describe [name]"
  /describe\s+(?:my\s+)?(?:child|kid|son|daughter|\S+)/i,
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
  if (TRIGGER_PHRASES.some(phrase => lower.includes(phrase))) return true;
  if (TRIGGER_REGEXES.some(rx => rx.test(messageText.trim()))) return true;
  return false;
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

  let hour   = parseInt(match[1], 10);
  const mins = match[2] ? parseInt(match[2], 10) : 0;
  const ampm = match[3];

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  // Round to nearest whole hour so it aligns with the hourly scheduler
  if (mins >= 30) hour += 1;
  if (hour > 23) hour = 0; // midnight wrap
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
    `• *3* — Add another child\n` +
    `• *4* — A child's birthday\n` +
    `• *5* — My timezone\n` +
    `• *6* — Remove/archive a child\n` +
    `• *7* — Update a child's personality profile\n` +
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
      ? activeChildren.map(c => `• *${c.child_name}* — ${formatBirthdayDisplay(c)}`).join('\n')
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
      `• Timezone: *${user.timezone || 'UTC'}*\n` +
      `• Plan: *${user.plan_type || 'free'}*\n` +
      `• Scheduled messages: *10 AM* (morning) and *6 PM* (evening) your time`
    );
  }

  // Build a rich per-child block
  function buildChildBlock(c) {
    const age = deriveAge(c);
    const ageLine = age != null ? `Age: *${age}*` : null;
    const dobLine = c.child_dob || c.birth_year
      ? `Birthday: *${formatBirthdayDisplay(c)}*`
      : null;
    const traits = [
      c.temperament      ? `Temperament: *${c.temperament}*`       : null,
      c.sensitivity_level ? `Sensitivity: *${c.sensitivity_level}*` : null,
      c.social_style     ? `Social style: *${c.social_style}*`     : null,
      c.strengths        ? `Strengths: *${c.strengths}*`           : null,
      c.challenges       ? `Challenges: *${c.challenges}*`         : null,
    ].filter(Boolean);

    const lines = [
      `👶 *${c.child_name}*`,
      ageLine,
      dobLine,
      ...traits,
    ].filter(Boolean);

    return lines.join('\n');
  }

  const childrenSection = activeChildren.length
    ? activeChildren.map(buildChildBlock).join('\n\n')
    : 'No active children saved yet.';

  const archivedNote = archivedChildren.length
    ? `\n\n_${archivedChildren.length} archived child${archivedChildren.length > 1 ? 'ren' : ''} not shown. Reply *show my family* to see all._`
    : '';

  return (
    `Here's your profile 💛\n\n` +
    `👤 *Parent*\n` +
    `Name: *${user.parent_name || 'Not set'}*\n` +
    `Timezone: *${user.timezone || 'UTC'}*\n` +
    `Schedule: *10 AM* (morning) & *6 PM* (evening)\n` +
    `Plan: *${user.plan_type || 'free'}*\n\n` +
    `👨‍👩‍👧 *Children*\n` +
    childrenSection +
    archivedNote
  );
}

/**
 * Returns true if the message is clearly asking to update a child's traits/personality.
 * Used to skip the main menu and go straight to the traits flow.
 */
function isTraitUpdateIntent(messageText) {
  const lower = messageText.trim().toLowerCase();
  const traitKeywords = [
    'trait', 'traits', 'personality', 'temperament', 'sensitivity',
    'social style', 'strengths', 'challenges', 'tell you about',
    'describe my child', 'update about',
  ];
  if (traitKeywords.some(kw => lower.includes(kw))) return true;
  // Regex: "update/edit [name]'s trait/profile/personality"
  if (/(?:update|edit|change)\s+\S+'s?\s+(?:trait|traits|profile|personality)/i.test(messageText)) return true;
  if (/\S+'s\s+(?:trait|traits|profile|personality)/i.test(messageText)) return true;
  return false;
}

async function handleProfileUpdate(user, messageText) {
  const text   = messageText.trim();
  const userId = user.user_id;

  let session = await getFlowSession(userId);

  if (!session) {
    // If the trigger message already signals a trait update intent,
    // skip the main menu and jump straight to child selection / traits flow.
    if (isTraitUpdateIntent(text)) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
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

    if (text === '3' || /add another child|add child|new child/i.test(text)) {
      await setFlowSession(userId, 'profile_update', 'enter_new_child_name', {});
      return `Of course 🌱 What is your child's name?`;
    }

    if (text === '4' || /birthday|age|born/i.test(text)) {
      const children = await getChildrenByUserId(userId);

      if (!children.length) {
        await clearFlowSession(userId);
        return `I don't have any active children on record for you yet. 🌱`;
      }

      if (children.length === 1) {
        await setFlowSession(userId, 'profile_update', 'enter_child_birthday', {
          childId:   children[0].child_id,
          childName: children[0].child_name,
        });
        return (
          `When is *${children[0].child_name}*'s birthday? 🎂\n\n` +
          `You can share it any way you like — *12 March 2019*, *March 2019*, or just the year *2019*.\n` +
          `_(Reply *skip* to leave it unchanged)_`
        );
      }

      await setFlowSession(userId, 'profile_update', 'choose_child_for_birthday', { children });
      return `Which child's birthday would you like to update?\n\n${buildChildrenList(children)}`;
    }

    if (text === '5' || /timezone/i.test(text)) {
      await setFlowSession(userId, 'profile_update', 'enter_timezone', session.data || {});
      return (
        `What timezone should I use for your scheduled messages? 🌍\n\n` +
        `You can reply with something like:\n` +
        `• *Singapore*\n` +
        `• *India*\n` +
        `• *Dubai*\n` +
        `• *London*\n` +
        `• *Asia/Singapore*`
      );
    }

    if (text === '6' || /remove child|archive child|delete child/i.test(text)) {
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
      text === '7' ||
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

  // ── Add new child ─────────────────────────────────────────────────────────────────────────────────────
  if (session.step === 'enter_new_child_name') {
    if (!text.length) {
      return `Please type your child's name, or reply *cancel* to stop.`;
    }

    const duplicate = await findPotentialDuplicateChild(userId, text);
    if (duplicate) {
      return `It looks like *${duplicate.child_name}* is already in your family profile. 🌱\n\nPlease enter a different child's name, or reply *cancel*.`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_new_child_birthday', {
      childName: text.trim(),
    });

    return (
      `When is *${text.trim()}*'s birthday? 🎂\n\n` +
      `You can share it any way you like — *12 March 2019*, *March 2019*, or just the year *2019*.\n` +
      `_(Reply *skip* if you'd rather not share)_`
    );
  }

  if (session.step === 'enter_new_child_birthday') {
    const childName = session.data.childName || 'your child';
    const parsed    = parseBirthday(text);

    // If unparseable and not a skip, ask for year as fallback
    if (!parsed) {
      await setFlowSession(userId, 'profile_update', 'enter_new_child_birth_year', { childName });
      return (
        `I didn't quite catch that. 😊\n\n` +
        `What year was *${childName}* born? _(e.g. *2019*)_\n` +
        `_(Or reply *skip* to move on)_`
      );
    }

    const dbFields = birthdayToDbFields(parsed);

    try {
      await createChild(userId, {
        childName,
        childAge:  dbFields.child_age  || null,
        childDob:  dbFields.child_dob  || null,
        birthYear: dbFields.birth_year || null,
      });
    } catch (error) {
      if (error.code === 'DUPLICATE_CHILD') {
        await setFlowSession(userId, 'profile_update', 'enter_new_child_name', {});
        return `It looks like *${error.child.child_name}* is already in your family profile. 🌱\n\nLet's try again — what is your child's name?`;
      }
      throw error;
    }

    await clearFlowSession(userId);

    const bdDisplay = parsed.precision === 'skip' ? '' : ` (${formatBirthdayDisplay({ child_dob: dbFields.child_dob, birth_year: dbFields.birth_year, child_age: dbFields.child_age })})`;
    logger.info('Profile update: child added', { userId, childName });
    return `Done! I've added *${childName}*${bdDisplay} to your family. 🌱`;
  }

  if (session.step === 'enter_new_child_birth_year') {
    const childName = session.data.childName || 'your child';
    const parsed    = parseBirthday(text); // try again — may now parse as year
    const dbFields  = parsed ? birthdayToDbFields(parsed) : {};

    try {
      await createChild(userId, {
        childName,
        childAge:  dbFields.child_age  || null,
        childDob:  dbFields.child_dob  || null,
        birthYear: dbFields.birth_year || null,
      });
    } catch (error) {
      if (error.code === 'DUPLICATE_CHILD') {
        await setFlowSession(userId, 'profile_update', 'enter_new_child_name', {});
        return `It looks like *${error.child.child_name}* is already in your family profile. 🌱\n\nLet's try again — what is your child's name?`;
      }
      throw error;
    }

    await clearFlowSession(userId);
    logger.info('Profile update: child added (year fallback)', { userId, childName });
    return `Done! I've added *${childName}* to your family. 🌱`;
  }

  // ── Child birthday update ──────────────────────────────────────────────
  if (session.step === 'choose_child_for_birthday') {
    const children = session.data.children || [];
    const selected = resolveChildSelection(text, children);

    if (!selected) {
      return `Please reply with a number or name from the list, or reply *cancel*.\n\n${buildChildrenList(children)}`;
    }

    await setFlowSession(userId, 'profile_update', 'enter_child_birthday', {
      childId:   selected.child_id,
      childName: selected.child_name,
    });

    return (
      `When is *${selected.child_name}*'s birthday? 🎂\n\n` +
      `You can share it any way you like — *12 March 2019*, *March 2019*, or just the year *2019*.\n` +
      `_(Reply *skip* to leave it unchanged)_`
    );
  }

  if (session.step === 'enter_child_birthday') {
    const childName = session.data.childName || 'your child';
    const parsed    = parseBirthday(text);

    if (parsed?.precision === 'skip') {
      await clearFlowSession(userId);
      return `No problem! *${childName}*'s birthday was left unchanged. 💛`;
    }

    if (!parsed) {
      // Fallback to year-only
      await setFlowSession(userId, 'profile_update', 'enter_child_birth_year', session.data);
      return (
        `I didn't quite catch that. 😊\n\n` +
        `What year was *${childName}* born? _(e.g. *2019*)_\n` +
        `_(Or reply *skip* to leave it unchanged)_`
      );
    }

    const dbFields = birthdayToDbFields(parsed);
    await updateChild(session.data.childId, dbFields);
    await clearFlowSession(userId);

    logger.info('Profile update: child birthday changed', {
      userId,
      childId:   session.data.childId,
      childName,
      precision: parsed.precision,
    });

    return `Done! I've updated *${childName}*'s birthday to *${formatBirthdayDisplay({ child_dob: dbFields.child_dob, birth_year: dbFields.birth_year, child_age: dbFields.child_age })}*. 🌱`;
  }

  if (session.step === 'enter_child_birth_year') {
    const childName = session.data.childName || 'your child';
    const parsed    = parseBirthday(text);

    if (parsed?.precision === 'skip' || !parsed) {
      await clearFlowSession(userId);
      return `No problem! *${childName}*'s birthday was left unchanged. 💛`;
    }

    const dbFields = birthdayToDbFields(parsed);
    await updateChild(session.data.childId, dbFields);
    await clearFlowSession(userId);

    logger.info('Profile update: child birth year saved', { userId, childId: session.data.childId });
    return `Got it! I've noted *${childName}* was born in *${parsed.year}*. 🌱`;
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
    return `Done! I'll now use *${timezone}* for your scheduled messages. 💛`;
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
