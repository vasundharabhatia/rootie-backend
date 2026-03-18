/**
 * Rootie — Onboarding Service
 *
 * Handles the multi-step onboarding flow for new parents.
 * State is stored in the `users` table (`onboarding_step`).
 * Temporary child data is stored in DB-backed flow sessions.
 *
 * Steps:
 *   0 → Welcome message, ask parent name
 *   1 → Save parent name, ask child name
 *   2 → Save child name, ask child age
 *   3 → Save child + age, ask optional personality description  ← NEW
 *   33→ (optional) AI extracts traits, saves them, ask "any more children?"
 *   4 → Ask "any more children?" (Yes → back to step 2, No → step 5)
 *   5 → Ask preferred reminder time
 *   6 → Onboarding complete
 *
 * The personality step (3b) is optional — parents can skip it with "skip",
 * "later", or a blank reply. It does NOT block onboarding progress.
 */

const { updateUser, getUserByPhone }                       = require('./userService');
const { createChild, updateChild, findPotentialDuplicateChild } = require('./childService');
const { setFlowSession, getFlowSession, clearFlowSession }  = require('./flowSessionService');
const { extractChildTraits }                               = require('./traitExtractorService');
const { parseBirthday, birthdayToDbFields, formatBirthdayDisplay } = require('./birthdayService');
const { logger }                                           = require('../utils/logger');

/**
 * Guesses a user's timezone from their WhatsApp number's country code.
 * @param {string} whatsappNumber
 * @returns {string|null}
 */
function guessTimezone(whatsappNumber) {
  const prefixes = {
    '1':   'America/New_York',
    '44':  'Europe/London',
    '91':  'Asia/Kolkata',
    '61':  'Australia/Sydney',
    '65':  'Asia/Singapore',
    '971': 'Asia/Dubai',
  };

  for (const prefix in prefixes) {
    if (whatsappNumber.startsWith(prefix)) {
      return prefixes[prefix];
    }
  }

  return null;
}

/**
 * Parses a user's free-text time input into a 24-hour integer.
 * @param {string} text
 * @returns {number|null}
 */
function parseHour(text) {
  const t = text.trim().toLowerCase();
  if (/\b(morning|morn)\b/.test(t))   return 8;
  if (/\b(afternoon|noon)\b/.test(t)) return 12;
  if (/\b(evening|eve)\b/.test(t))    return 18;
  if (/\b(night)\b/.test(t))          return 20;

  const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour   = parseInt(match[1], 10);
  const ampm = match[3];

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;

  return hour;
}

/**
 * Returns true if the parent's reply is a skip intent.
 */
function isSkipReply(text) {
  return /^(skip|later|no thanks|not now|maybe later|nope|n\/a|na|-)$/i.test(text.trim())
    || text.trim().length === 0;
}

async function handleOnboarding(user, messageText, displayName) {
  const text = messageText.trim();
  const step = user.onboarding_step;

  switch (step) {
    // ── Step 0: Welcome ──────────────────────────────────────────────────────
    case 0: {
      await updateUser(user.whatsapp_number, { onboarding_step: 1 });

      const introVariants = [
        `Hello! I'm Rootie 🌱
Your everyday parenting companion from Kind Roots.

Think of me as a small pocket guide for raising kind, confident, emotionally resilient children. I'm here to support you through everyday parenting moments — helping with big feelings, building connection, and noticing the good that's already happening in your child's world.

Whenever you need a quick idea, activity, or bit of reassurance, I'm right here.

First, let's get to know each other.
What's your name? 😊`,

        `Hi there! I'm Rootie 🌱
A parenting companion from the Kind Roots team.

I'm here for the everyday stuff — the big feelings, the small wins, the moments you want to remember, and the ones you're not quite sure how to handle. Whether you need a quick idea, a gentle activity, or just a bit of reassurance, I'm always here.

My whole focus is helping you raise a kind, confident, emotionally resilient child — one small moment at a time.

Let's start by getting to know each other.
What's your name? 😊`,

        `Hello! I'm Rootie 🌱
Your everyday parenting companion, from Kind Roots.

Parenting is full of moments — some beautiful, some hard, most somewhere in between. I'm here to help you navigate all of it: noticing the good, handling the tricky, and building the kind of connection that stays with your child for life.

Think of me as a calm, always-available pocket guide for raising kind, confident, emotionally resilient kids.

First things first — what's your name? 😊`,
      ];

      return introVariants[Math.floor(Math.random() * introVariants.length)];
    }

    // ── Step 1: Save parent name, ask child name ─────────────────────────────
    case 1: {
      const parentName = text.length > 0 ? text : (displayName || 'there');

      await updateUser(user.whatsapp_number, {
        parent_name:      parentName,
        onboarding_step:  2,
      });

      return `Lovely to meet you, *${parentName}*! 🌸\n\nWhat's your child's name?`;
    }

    // ── Step 2: Save child name, ask age ─────────────────────────────────────
    case 2: {
      const childName = text.length > 0 ? text : 'your child';

      const duplicate = await findPotentialDuplicateChild(user.user_id, childName);
      if (duplicate) {
        return (
          `It looks like *${duplicate.child_name}* is already in your family profile. 🌱\n\n` +
          `If you meant the same child, reply with a different child's name.\n` +
          `If not, you can send a more distinct name like *Aarav S* or *Baby Aarav*.`
        );
      }

      await setFlowSession(user.user_id, 'onboarding', 'pending_child', { childName });
      await updateUser(user.whatsapp_number, { onboarding_step: 3 });

      return (
        `When is *${childName}*'s birthday? 🎂\n\n` +
        `You can share it any way you like — *12 March 2019*, *March 2019*, or just the year *2019*.\n` +
        `_(Reply *skip* if you'd rather not share)_`
      );
    }

    // ── Step 3: Save child + birthday, ask optional personality description ──
    case 3: {
      const session = await getFlowSession(user.user_id);

      if (!session || session.flow_type !== 'onboarding' || session.step !== 'pending_child') {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Let's add your child's name again 🌱\n\nWhat's your child's name?`;
      }

      const childName = session.data?.childName || 'Child';

      // ── Parse birthday input ──────────────────────────────────────────────
      const parsed = parseBirthday(text);

      // If completely unparseable (not a skip, not a date), ask for year as fallback
      if (!parsed) {
        // Store that we're now in the year-fallback sub-step
        await setFlowSession(user.user_id, 'onboarding', 'pending_child_year_fallback', { childName });
        await updateUser(user.whatsapp_number, { onboarding_step: 32 });
        return (
          `I didn't quite catch that. 😊\n\n` +
          `No worries — what year was *${childName}* born? _(e.g. *2019*)_\n` +
          `_(Or reply *skip* to move on)_`
        );
      }

      const dbFields = birthdayToDbFields(parsed);

      let newChild;
      try {
        newChild = await createChild(user.user_id, {
          childName,
          childAge:  dbFields.child_age  || null,
          childDob:  dbFields.child_dob  || null,
          birthYear: dbFields.birth_year || null,
        });
      } catch (error) {
        if (error.code === 'DUPLICATE_CHILD') {
          await clearFlowSession(user.user_id);
          await updateUser(user.whatsapp_number, { onboarding_step: 2 });
          return (
            `It looks like *${childName}* is already saved in your family profile. 🌱\n\n` +
            `Let's try again — what's the child's name?`
          );
        }
        throw error;
      }

      // Build a friendly confirmation of what was understood
      const birthdayLine = parsed.precision === 'skip'
        ? ''
        : `Birthday noted as *${formatBirthdayDisplay(newChild)}*. `;

      // Store child ID so the next step can save traits to the right record
      await setFlowSession(user.user_id, 'onboarding', 'pending_traits', {
        childName,
        childId: newChild.child_id,
      });

      await updateUser(user.whatsapp_number, { onboarding_step: 33 });

      return (
        `Got it. 🌱 I've added *${childName}* to your family. ${birthdayLine}\n\n` +
        `One quick thing — tell me a little about *${childName}*'s personality. ` +
        `What are they like? What are they good at? What do they find tricky?\n\n` +
        `Just talk to me like you would a friend. ` +
        `_(Or reply *skip* if you'd rather do this later)_`
      );
    }

    // ── Step 32: Year-only fallback (when birthday was unparseable) ───────────
    case 32: {
      const session = await getFlowSession(user.user_id);

      if (!session || session.flow_type !== 'onboarding') {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Let's add your child's name again 🌱\n\nWhat's your child's name?`;
      }

      const childName = session.data?.childName || 'Child';
      const parsed    = parseBirthday(text);

      // Accept year-only, month+year, or full date; or skip
      const dbFields  = parsed ? birthdayToDbFields(parsed) : {};

      let newChild;
      try {
        newChild = await createChild(user.user_id, {
          childName,
          childAge:  dbFields.child_age  || null,
          childDob:  dbFields.child_dob  || null,
          birthYear: dbFields.birth_year || null,
        });
      } catch (error) {
        if (error.code === 'DUPLICATE_CHILD') {
          await clearFlowSession(user.user_id);
          await updateUser(user.whatsapp_number, { onboarding_step: 2 });
          return (
            `It looks like *${childName}* is already saved in your family profile. 🌱\n\n` +
            `Let's try again — what's the child's name?`
          );
        }
        throw error;
      }

      await setFlowSession(user.user_id, 'onboarding', 'pending_traits', {
        childName,
        childId: newChild.child_id,
      });
      await updateUser(user.whatsapp_number, { onboarding_step: 33 });

      return (
        `Got it. 🌱 I've added *${childName}* to your family.\n\n` +
        `One quick thing — tell me a little about *${childName}*'s personality. ` +
        `What are they like? What are they good at? What do they find tricky?\n\n` +
        `Just talk to me like you would a friend. ` +
        `_(Or reply *skip* if you'd rather do this later)_`
      );
    }

    // ── Step 3b: Optional personality description (stored as 33 in DB) ─────────
    case 33: {
      const session = await getFlowSession(user.user_id);
      const childName = session?.data?.childName || 'your child';
      const childId   = session?.data?.childId   || null;

      if (!isSkipReply(text) && childId) {
        // Run AI extraction and save whatever was found
        try {
          const traits = await extractChildTraits(text);
          const toSave = {};
          if (traits.temperament)       toSave.temperament       = traits.temperament;
          if (traits.sensitivity_level) toSave.sensitivity_level = traits.sensitivity_level;
          if (traits.social_style)      toSave.social_style      = traits.social_style;
          if (traits.strengths)         toSave.strengths         = traits.strengths;
          if (traits.challenges)        toSave.challenges        = traits.challenges;

          if (Object.keys(toSave).length) {
            await updateChild(childId, toSave);
            logger.info('Onboarding: child traits saved', {
              userId: user.user_id,
              childId,
              childName,
              saved: JSON.stringify(toSave),
            });
          }
        } catch (err) {
          // Non-fatal — log and continue
          logger.warn('Onboarding: trait extraction failed, continuing', { error: err.message });
        }
      }

      // Either way, move on to "any more children?"
      await clearFlowSession(user.user_id);
      await updateUser(user.whatsapp_number, { onboarding_step: 4 });

      return `Do you have any other children to add? Reply *Yes* or *No*.`;
    }

    // ── Step 4: More children? ────────────────────────────────────────────────
    case 4: {
      const answer = text.trim().toLowerCase();

      if (['yes', 'y'].includes(answer)) {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Great! What's your next child's name?`;
      }

      if (['no', 'n'].includes(answer)) {
        await updateUser(user.whatsapp_number, { onboarding_step: 5 });
        return (
          `Almost done! Last question. 🌱\n\n` +
          `I'll send you a little thought or activity a few times a week.\n\n` +
          `What time of day works best for you? (e.g. *8am*, *evening*)`
        );
      }

      return `Please reply with *Yes* or *No* so I know whether to add another child. 🌱`;
    }

    // ── Step 5: Reminder time ─────────────────────────────────────────────────
    case 5: {
      const hour     = parseHour(text);
      const timezone = guessTimezone(user.whatsapp_number);

      if (hour === null) {
        return `I didn't quite catch that. 😊 Could you try a time like *8am*, *7:30pm*, or *morning*?`;
      }

      const displayHour =
        hour === 0  ? '12:00 AM' :
        hour < 12   ? `${hour}:00 AM` :
        hour === 12 ? '12:00 PM' :
        `${hour - 12}:00 PM`;

      await clearFlowSession(user.user_id);

      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step:     6,
        reminder_hour:       hour,
        timezone,
      });

      logger.info('Onboarding complete', {
        userId:       user.user_id,
        timezone,
        reminderHour: hour,
      });

      const freshUser = await getUserByPhone(user.whatsapp_number);

      return (
        `You're all set, *${freshUser?.parent_name || 'there'}*! 🌟\n\n` +
        `I'll send you little thoughts and activities around *${displayHour}* your time. ` +
        `You can message me to change it any time.\n\n` +
        `To get started, try sharing a small, positive moment you noticed in your child today. 💛`
      );
    }

    default: {
      logger.warn('Onboarding in unexpected step', { userId: user.user_id, step });
      await clearFlowSession(user.user_id);
      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step:     6,
      });
      return `Welcome back! 🌱 What's on your mind today?`;
    }
  }
}

module.exports = {
  handleOnboarding,
  guessTimezone,
  parseHour,
};
