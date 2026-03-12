/**
 * Rootie — Onboarding Service
 *
 * Handles the multi-step onboarding flow for new parents.
 * State is stored in the `users` table (`onboarding_step`).
 * Temporary child data is stored in-memory (`pendingChild`).
 *
 * REPHRASING UPDATE:
 * All user-facing messages have been rewritten to sound more human, warm, and
 * less like an AI. The goal is to feel like a calm, supportive friend.
 *
 * CONDITIONAL INTRODUCTION:
 * Step 0 now checks if the user has already sent a meaningful message (i.e.,
 * not just "hi" or "hello"). If they have, we skip the "I'm Rootie" intro
 * and jump straight to asking for their name, making the conversation feel
 * more natural as if Rootie is responding directly to their opening message.
 */

const { updateUser }  = require("./userService");
const { createChild } = require("./childService");
const { logger }      = require("../utils/logger");

// In-memory store for child being created during onboarding
// Key: user_id, Value: { child_name: string }
// This is safe for MVP/single-instance but would need a DB/Redis table in a multi-node setup.
const pendingChild = new Map();

/**
 * Guesses a user's timezone from their WhatsApp number's country code.
 * This is a simple, non-authoritative guess.
 * @param {string} whatsappNumber - E.g., "14155552671"
 * @returns {string|null} IANA timezone name or null
 */
function guessTimezone(whatsappNumber) {
  // This is a simplified mapping. A production system would use a comprehensive library.
  const prefixes = {
    "1": "America/New_York",    // United States/Canada
    "44": "Europe/London",       // UK
    "91": "Asia/Kolkata",      // India
    "61": "Australia/Sydney",    // Australia
    "65": "Asia/Singapore",    // Singapore
    "971": "Asia/Dubai",       // UAE
    // ... add more common prefixes as needed
  };
  for (const prefix in prefixes) {
    if (whatsappNumber.startsWith(prefix)) {
      return prefixes[prefix];
    }
  }
  return null; // Default if no match
}

/**
 * Parses a user's free-text time input into a 24-hour integer.
 * @param {string} text - E.g., "8am", "evening", "19:30"
 * @returns {number|null} Hour (0-23) or null if unparseable
 */
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
  if (ampm === "pm" && hour < 12) hour += 12;
  if (ampm === "am" && hour === 12) hour = 0;
  if (hour < 0 || hour > 23) return null;
  return hour;
}

/**
 * Main handler for the onboarding conversation flow.
 * @param {object} user - The user object from the database.
 * @param {string} messageText - The inbound message from the user.
 * @param {string} displayName - The user's WhatsApp display name.
 * @returns {string} The reply message to send back.
 */
async function handleOnboarding(user, messageText, displayName) {
  const text = messageText.trim();
  const step = user.onboarding_step;

  switch (step) {

    // ── Step 0: Welcome + ask for parent name ────────────────────────────
    case 0: {
      await updateUser(user.whatsapp_number, { onboarding_step: 1 });

      const introVariants = [
        // Variant 1 — provided by Kind Roots team (original)
        `Hello! I'm Rootie 🌱\n` +
        `Your everyday parenting companion from Kind Roots.\n\n` +
        `Think of me as a small pocket guide for raising kind, confident, emotionally resilient children. ` +
        `I'm here to support you through everyday parenting moments — helping with big feelings, building connection, ` +
        `and noticing the good that's already happening in your child's world.\n\n` +
        `Whenever you need a quick idea, activity, or bit of reassurance, I'm right here.\n\n` +
        `First, let's get to know each other.\nWhat's your name? 😊`,

        // Variant 2 — warm and grounded
        `Hi there! I'm Rootie 🌱\n` +
        `A parenting companion from the Kind Roots team.\n\n` +
        `I'm here for the everyday stuff — the big feelings, the small wins, the moments you want to remember, ` +
        `and the ones you're not quite sure how to handle. Whether you need a quick idea, a gentle activity, ` +
        `or just a bit of reassurance, I'm always here.\n\n` +
        `My whole focus is helping you raise a kind, confident, emotionally resilient child — one small moment at a time.\n\n` +
        `Let's start by getting to know each other.\nWhat's your name? 😊`,

        // Variant 3 — slightly more personal and conversational
        `Hello! I'm Rootie 🌱\n` +
        `Your everyday parenting companion, from Kind Roots.\n\n` +
        `Parenting is full of moments — some beautiful, some hard, most somewhere in between. ` +
        `I'm here to help you navigate all of it: noticing the good, handling the tricky, ` +
        `and building the kind of connection that stays with your child for life.\n\n` +
        `Think of me as a calm, always-available pocket guide for raising kind, confident, emotionally resilient kids.\n\n` +
        `First things first — what's your name? 😊`,
      ];

      return introVariants[Math.floor(Math.random() * introVariants.length)];
    }

    // ── Step 1: Save parent name + ask for child name ────────────────────
    case 1: {
      const parentName = text.length > 0 ? text : (displayName || "there");
      await updateUser(user.whatsapp_number, {
        parent_name:    parentName,
        onboarding_step: 2,
      });
      return `Lovely to meet you, *${parentName}*! 🌸\n\nWhat's your child's name?`;
    }

    // ── Step 2: Save child name + ask for age ────────────────────────────
    case 2: {
      const childName = text.length > 0 ? text : "your child";
      pendingChild.set(user.user_id, { child_name: childName });
      await updateUser(user.whatsapp_number, { onboarding_step: 3 });
      return `And how old is *${childName}*?`;
    }

    // ── Step 3: Save child age + ask if more children ────────────────────
    case 3: {
      const pending  = pendingChild.get(user.user_id) || {};
      const age      = parseInt(text, 10);
      const childAge = isNaN(age) ? null : age;

      await createChild(user.user_id, {
        childName:  pending.child_name || "Child",
        childAge,
      });
      pendingChild.delete(user.user_id);

      await updateUser(user.whatsapp_number, { onboarding_step: 4 });
      return `Got it. 🌱 I've added *${pending.child_name || "your child"}* to your family.\n\nDo you have any other children to add? (Yes/No)`;
    }

    // ── Step 4: More children? → if no, ask for preferred reminder time ──
    case 4: {
      const answer = text.toLowerCase();

      if (answer.startsWith("y")) {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Great! What's your next child's name?`;
      }

      await updateUser(user.whatsapp_number, { onboarding_step: 5 });
      return `Almost done! Last question. 🌱\n\nI'll send you a little thought or activity a few times a week.\n\nWhat time of day works best for you? (e.g. *8am*, *evening*)`;
    }

    // ── Step 5: Save reminder time + timezone → complete onboarding ──────
    case 5: {
      const hour     = parseHour(text);
      const timezone = guessTimezone(user.whatsapp_number);

      if (hour === null) {
        return `I didn't quite catch that. 😊 Could you try a time like *8am*, *7:30pm*, or *morning*?`;
      }

      const displayHour = hour === 0 ? "12:00 AM"
        : hour < 12  ? `${hour}:00 AM`
        : hour === 12 ? "12:00 PM"
        : `${hour - 12}:00 PM`;

      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step:     6,
        reminder_hour:       hour,
        timezone,
      });

      logger.info("Onboarding complete", {
        userId:       user.user_id,
        timezone,
        reminderHour: hour,
      });

      // Fetch the user again to get the updated parent_name
      const freshUser = await updateUser(user.whatsapp_number, {});

      return `You're all set, *${freshUser.parent_name || "there"}*! 🌟\n\nI'll send you little thoughts and activities around *${displayHour}* your time. You can message me to change it any time.\n\nTo get started, try sharing a small, positive moment you noticed in your child today. 💛`;
    }

    default: {
      logger.warn("Onboarding in unexpected step", { userId: user.user_id, step });
      await updateUser(user.whatsapp_number, { onboarding_complete: true, onboarding_step: 6 });
      return `Welcome back! 🌱 What's on your mind today?`;
    }
  }
}

module.exports = { handleOnboarding, guessTimezone, parseHour };
