/**
 * Rootie — Scheduler
 *
 * Three scheduled jobs (all free for all onboarded users, zero OpenAI cost):
 *
 * 1. Noticing Prompt  — 2× per week (Tuesday + Friday at 8:00 AM)
 *    A fuller "Kind Roots Moment" challenge asking parents to observe a specific
 *    behaviour in their child. Rotates through 20 prompts.
 *
 * 2. Moment Nudge     — 1× per week (Wednesday at 8:00 AM)
 *    A short, soft nudge asking parents to log any good moment they noticed.
 *    Rotates through 8 nudge variants.
 *
 * 3. Weekly Bonding Activity — 1× per week (Saturday at 8:00 AM)
 *    A 5-minute bonding activity for the whole family. Rotates through 7 activities.
 *
 * Weekly message rhythm per parent:
 *   Tuesday   → Noticing Prompt
 *   Wednesday → Moment Nudge
 *   Friday    → Noticing Prompt
 *   Saturday  → Bonding Activity
 *   (Monday, Thursday, Sunday — no proactive messages)
 *
 * Total: 4 messages per week — low enough to feel valuable, not spammy.
 */

const cron       = require('node-cron');
const { logger } = require('../utils/logger');
const { getOnboardedUsers } = require('../services/userService');
const { sendMessage }       = require('../services/whatsappService');
const { saveMessage }       = require('../services/conversationService');
const { getTemplateResponse } = require('../services/templateService');

// ─── Noticing Prompts (20 items, rotating) ────────────────────────────────
const DAILY_PROMPTS = [
  'Today, try noticing one moment when your child shows kindness — even something small.',
  'Watch for a moment today when your child tries something difficult. Notice it out loud.',
  'Today, catch your child being patient. Tell them what you saw.',
  'Notice a moment when your child shows curiosity — about anything at all.',
  'Today, look for a moment when your child shows empathy toward someone else.',
  'Watch for a moment when your child bounces back from something frustrating.',
  'Notice a moment today when your child takes responsibility for something.',
  'Today, listen for a moment when your child expresses a big feeling with words.',
  'Watch for a moment when your child helps someone without being asked.',
  'Notice a moment today when your child is proud of something they created.',
  'Today, look for a moment when your child shares something with a friend or sibling.',
  'Catch a moment when your child is deeply focused on a task. What are they exploring?',
  'Today, notice a moment when your child uses their words to solve a problem.',
  'Watch for a moment when your child shows respect for someone else\'s feelings.',
  'Notice a moment today when your child cleans up a small mess without being reminded.',
  'Today, look for a moment when your child asks a really thoughtful question.',
  'Catch a moment when your child shows courage, even if they feel a little scared.',
  'Today, notice a moment when your child is a good listener to someone else.',
  'Watch for a moment when your child shows they can wait for something they want.',
  'Notice a moment today when your child says "please" or "thank you" without being prompted.',
];

// ─── Moment Nudges (8 items, rotating) ───────────────────────────────────
// Short, soft prompts to encourage moment logging on non-prompt days
const MOMENT_NUDGES = [
  'Did anything lovely happen with your child today? 🌱 Even something tiny counts — tap to log it.',
  'One small moment is all it takes. 💛 Did you notice anything about your child today worth remembering?',
  'A quick check-in 🌱 — did your child do or say anything today that made you smile? Log it here.',
  'Moments add up. 💛 Anything worth noting from today — big or small?',
  'Even a 10-second moment matters. 🌱 Did you catch anything in your child today worth saving?',
  'Your child is growing every day. 💛 Notice anything today? Share it here and I\'ll save it for you.',
  'A little nudge 🌱 — did anything happen today that you\'d love to remember a year from now?',
  'Kind Roots check-in 💛 — any moments of kindness, curiosity, or courage from your child today?',
];

// ─── Weekly Bonding Activities (7 items, rotating) ───────────────────────
const WEEKLY_ACTIVITIES = [
  'Ask your child: *"What was one moment today that made you proud?"* Listen without jumping in.',
  'Try a "Rose and Thorn" conversation at dinner: each person shares one good thing and one hard thing from their day.',
  'Spend 10 minutes doing whatever your child wants to do — no phones, no agenda. Just be present.',
  'Write a small note and leave it somewhere your child will find it. Just one thing you love about them.',
  'Ask your child to teach you something they know how to do. Let them be the expert.',
  'Take a 10-minute walk together. No destination. Just notice things around you.',
  'Ask your child: *"If you could change one rule in our house, what would it be?"* Really listen.',
];

// ─── Rotating counters ───────────────────────────────────────────────────
let promptIndex = 0;   // which noticing prompt to send next
let nudgeIndex  = 0;   // which moment nudge to send next
let weeklyIndex = 0;   // which bonding activity to send next

// ─── Send noticing prompt to all users ───────────────────────────────────
async function sendDailyPrompts() {
  logger.info('Noticing prompt job started');
  try {
    const users      = await getOnboardedUsers();
    const promptText = DAILY_PROMPTS[promptIndex % DAILY_PROMPTS.length];
    promptIndex++;

    const message = getTemplateResponse('daily_prompt', { promptText });
    let sent = 0, failed = 0;

    for (const user of users) {
      try {
        await sendMessage(user.whatsapp_number, message);
        await saveMessage(user.user_id, 'assistant', message, null);
        sent++;
      } catch (err) {
        logger.error('Failed to send noticing prompt', {
          userId: user.user_id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('Noticing prompt job complete', { sent, failed, total: users.length });
  } catch (err) {
    logger.error('Noticing prompt job failed', { error: err.message });
  }
}

// ─── Send moment nudge to all users ──────────────────────────────────────
async function sendMomentNudge() {
  logger.info('Moment nudge job started');
  try {
    const users   = await getOnboardedUsers();
    const nudge   = MOMENT_NUDGES[nudgeIndex % MOMENT_NUDGES.length];
    nudgeIndex++;

    let sent = 0, failed = 0;
    for (const user of users) {
      try {
        await sendMessage(user.whatsapp_number, nudge);
        await saveMessage(user.user_id, 'assistant', nudge, null);
        sent++;
      } catch (err) {
        logger.error('Failed to send moment nudge', {
          userId: user.user_id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('Moment nudge job complete', { sent, failed, total: users.length });
  } catch (err) {
    logger.error('Moment nudge job failed', { error: err.message });
  }
}

// ─── Send weekly activity to all users ───────────────────────────────────
async function sendWeeklyActivities() {
  logger.info('Weekly activity job started');
  try {
    const users        = await getOnboardedUsers();
    const activityText = WEEKLY_ACTIVITIES[weeklyIndex % WEEKLY_ACTIVITIES.length];
    weeklyIndex++;

    const message = getTemplateResponse('weekly_activity', { activityText });
    let sent = 0, failed = 0;

    for (const user of users) {
      try {
        await sendMessage(user.whatsapp_number, message);
        await saveMessage(user.user_id, 'assistant', message, null);
        sent++;
      } catch (err) {
        logger.error('Failed to send weekly activity', {
          userId: user.user_id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('Weekly activity job complete', { sent, failed, total: users.length });
  } catch (err) {
    logger.error('Weekly activity job failed', { error: err.message });
  }
}

// ─── Start schedulers ─────────────────────────────────────────────────────
function startDailyScheduler() {
  // Noticing Prompt: Tuesday (2) and Friday (5) at 8:00 AM
  const promptSchedule = process.env.PROMPT_CRON || '0 0 8 * * 2,5';
  cron.schedule(promptSchedule, sendDailyPrompts);
  logger.info('Noticing prompt scheduler started (Tue + Fri 8 AM)', { schedule: promptSchedule });

  // Moment Nudge: Wednesday (3) at 8:00 AM
  const nudgeSchedule = process.env.NUDGE_CRON || '0 0 8 * * 3';
  cron.schedule(nudgeSchedule, sendMomentNudge);
  logger.info('Moment nudge scheduler started (Wed 8 AM)', { schedule: nudgeSchedule });
}

function startWeeklyScheduler() {
  // Bonding Activity: Saturday (6) at 8:00 AM
  const schedule = process.env.WEEKLY_ACTIVITY_CRON || '0 0 8 * * 6';
  cron.schedule(schedule, sendWeeklyActivities);
  logger.info('Weekly activity scheduler started (Sat 8 AM)', { schedule });
}

module.exports = {
  startDailyScheduler,
  startWeeklyScheduler,
  sendDailyPrompts,
  sendMomentNudge,
  sendWeeklyActivities,
};
