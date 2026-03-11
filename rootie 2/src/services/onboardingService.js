/**
 * Rootie — Onboarding Service
 *
 * Handles the first-time setup flow for new parents.
 * Collects parent name, child name(s), and child age(s).
 * Supports multiple children.
 *
 * Steps:
 *   0 → Send welcome message, ask for parent name
 *   1 → Save parent name, ask for first child's name
 *   2 → Save child name, ask for child's age
 *   3 → Save child age, ask if there are more children
 *   4 → If yes → ask for next child name (loops back to step 2 logic)
 *       If no  → complete onboarding
 *
 * State is tracked via user.onboarding_step in the DB.
 * Temporary child data is stored in a simple in-memory map keyed by user_id
 * (safe for MVP; replace with DB column for multi-instance deployments).
 */

const { updateUser }   = require('./userService');
const { createChild }  = require('./childService');
const { logger }       = require('../utils/logger');

// Temporary in-memory store for "child being added" during onboarding
// Key: user_id, Value: { child_name: string }
const pendingChild = new Map();

async function handleOnboarding(user, messageText, displayName = '') {
  const step = user.onboarding_step;
  const text = messageText.trim();

  switch (step) {

    // ── Step 0: Welcome + ask for parent name ────────────────────────────
    case 0: {
      await updateUser(user.whatsapp_number, { onboarding_step: 1 });
      return (
        `Hi! I'm *Rootie* from Kind Roots 🌱\n\n` +
        `I help parents raise kind, confident, and emotionally intelligent children ` +
        `through small daily moments and positive moment tracking.\n\n` +
        `Let's get started! What's your name? 😊`
      );
    }

    // ── Step 1: Save parent name + ask for child name ────────────────────
    case 1: {
      const parentName = text.length > 0 ? text : (displayName || 'there');
      await updateUser(user.whatsapp_number, {
        parent_name:    parentName,
        onboarding_step: 2,
      });
      return (
        `Lovely to meet you, *${parentName}*! 🌸\n\n` +
        `What's your child's name?`
      );
    }

    // ── Step 2: Save child name + ask for age ────────────────────────────
    case 2: {
      const childName = text.length > 0 ? text : 'your child';
      pendingChild.set(user.user_id, { child_name: childName });
      await updateUser(user.whatsapp_number, { onboarding_step: 3 });
      return `How old is *${childName}*? (Just type the age, e.g. *5*)`;
    }

    // ── Step 3: Save child age + ask if more children ────────────────────
    case 3: {
      const pending = pendingChild.get(user.user_id) || {};
      const age     = parseInt(text, 10);
      const childAge = isNaN(age) ? null : age;

      await createChild(user.user_id, {
        childName:  pending.child_name || 'Child',
        childAge,
      });
      pendingChild.delete(user.user_id);

      await updateUser(user.whatsapp_number, { onboarding_step: 4 });
      return (
        `Wonderful! 🌱 I've added *${pending.child_name || 'your child'}* to your Kind Roots family.\n\n` +
        `Do you have any other children you'd like to add?\n\n` +
        `Reply *Yes* to add another child, or *No* to get started.`
      );
    }

    // ── Step 4: More children? ────────────────────────────────────────────
    case 4: {
      const answer = text.toLowerCase();

      if (answer.startsWith('y') || answer === 'yes') {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `What's the name of your next child?`;
      }

      // Complete onboarding
      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step:     5,
      });

      return (
        `You're all set, *${user.parent_name || 'there'}*! 🌟\n\n` +
        `Here's what Rootie can do for you:\n\n` +
        `🌱 *Log moments* — Share something kind or brave your child did\n` +
        `💬 *Ask questions* — Get parenting guidance (1 question/day on the free plan)\n` +
        `📅 *Daily prompts* — I'll send you a small noticing challenge each morning\n` +
        `🎯 *Weekly activities* — A 5-minute bonding activity every weekend\n\n` +
        `Try it now — share a moment you noticed in your child today! 💛`
      );
    }

    default: {
      // Should not reach here — mark as complete if somehow stuck
      logger.warn('Onboarding in unexpected step', { userId: user.user_id, step });
      await updateUser(user.whatsapp_number, { onboarding_complete: true, onboarding_step: 5 });
      return `Welcome back! 🌱 What's on your mind today?`;
    }
  }
}

module.exports = { handleOnboarding };
