/**
 * Rootie — Onboarding Service
 *
 * Handles the multi-step onboarding flow for new parents.
 * State is stored in the `users` table (`onboarding_step`).
 * Temporary child data is stored in DB-backed flow sessions.
 */

const { updateUser, getUserByPhone } = require("./userService");
const { createChild } = require("./childService");
const { setFlowSession, getFlowSession, clearFlowSession } = require("./flowSessionService");
const { logger } = require("../utils/logger");

/**
 * Guesses a user's timezone from their WhatsApp number's country code.
 * This is a simple, non-authoritative guess.
 * @param {string} whatsappNumber
 * @returns {string|null}
 */
function guessTimezone(whatsappNumber) {
  const prefixes = {
    "1": "America/New_York",
    "44": "Europe/London",
    "91": "Asia/Kolkata",
    "61": "Australia/Sydney",
    "65": "Asia/Singapore",
    "971": "Asia/Dubai",
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

  let hour = parseInt(match[1], 10);
  const ampm = match[3];

  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;

  return hour;
}

async function handleOnboarding(user, messageText, displayName) {
  const text = messageText.trim();
  const step = user.onboarding_step;

  switch (step) {
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

    case 1: {
      const parentName = text.length > 0 ? text : (displayName || "there");

      await updateUser(user.whatsapp_number, {
        parent_name: parentName,
        onboarding_step: 2,
      });

      return `Lovely to meet you, *${parentName}*! 🌸\n\nWhat's your child's name?`;
    }

    case 2: {
      const childName = text.length > 0 ? text : "your child";

      await setFlowSession(user.user_id, 'onboarding', 'pending_child', {
        childName,
      });

      await updateUser(user.whatsapp_number, { onboarding_step: 3 });

      return `And how old is *${childName}*?`;
    }

    case 3: {
      const session = await getFlowSession(user.user_id);

      if (!session || session.flow_type !== 'onboarding' || session.step !== 'pending_child') {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Let's add your child's name again 🌱\n\nWhat's your child's name?`;
      }

      const childName = session.data?.childName || "Child";
      const age = parseInt(text, 10);
      const childAge = Number.isNaN(age) ? null : age;

      await createChild(user.user_id, {
        childName,
        childAge,
      });

      await clearFlowSession(user.user_id);
      await updateUser(user.whatsapp_number, { onboarding_step: 4 });

      return `Got it. 🌱 I've added *${childName}* to your family.\n\nDo you have any other children to add? Reply *Yes* or *No*.`;
    }

    case 4: {
      const answer = text.trim().toLowerCase();

      if (['yes', 'y'].includes(answer)) {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Great! What's your next child's name?`;
      }

      if (['no', 'n'].includes(answer)) {
        await updateUser(user.whatsapp_number, { onboarding_step: 5 });
        return `Almost done! Last question. 🌱\n\nI'll send you a little thought or activity a few times a week.\n\nWhat time of day works best for you? (e.g. *8am*, *evening*)`;
      }

      return `Please reply with *Yes* or *No* so I know whether to add another child. 🌱`;
    }

    case 5: {
      const hour = parseHour(text);
      const timezone = guessTimezone(user.whatsapp_number);

      if (hour === null) {
        return `I didn't quite catch that. 😊 Could you try a time like *8am*, *7:30pm*, or *morning*?`;
      }

      const displayHour =
        hour === 0 ? "12:00 AM" :
        hour < 12 ? `${hour}:00 AM` :
        hour === 12 ? "12:00 PM" :
        `${hour - 12}:00 PM`;

      await clearFlowSession(user.user_id);

      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step: 6,
        reminder_hour: hour,
        timezone,
      });

      logger.info("Onboarding complete", {
        userId: user.user_id,
        timezone,
        reminderHour: hour,
      });

      const freshUser = await getUserByPhone(user.whatsapp_number);

      return `You're all set, *${freshUser?.parent_name || "there"}*! 🌟\n\nI'll send you little thoughts and activities around *${displayHour}* your time. You can message me to change it any time.\n\nTo get started, try sharing a small, positive moment you noticed in your child today. 💛`;
    }

    default: {
      logger.warn("Onboarding in unexpected step", { userId: user.user_id, step });
      await clearFlowSession(user.user_id);
      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step: 6,
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
