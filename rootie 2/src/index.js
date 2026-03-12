/**
 * Rootie — Scheduler
 *
 * Three scheduled message types (all free for all onboarded users, zero OpenAI cost):
 *
 * 1. Noticing Prompt  — 2× per week (Tuesday + Friday)
 *    A fuller "Kind Roots Moment" challenge asking parents to observe a specific
 *    behaviour in their child. Rotates through 20 prompts.
 *
 * 2. Moment Nudge     — 1× per week (Wednesday)
 *    A short, soft nudge asking parents to log any good moment they noticed.
 *    Rotates through 8 nudge variants.
 *
 * 3. Weekly Bonding Activity — 1× per week (Saturday)
 *    A 5-minute bonding activity for the whole family. Rotates through 7 activities.
 *    The activity text is saved to weekend_activities so a Monday follow-up can be sent.
 *
 * 4. Weekend Activity Follow-up — 1× per week (Monday morning)
 *    Checks which users received a weekend activity and asks if they completed it.
 *    Replies are handled in webhook.js → activityTrackingService.js.
 *
 * Weekly message rhythm per parent:
 *   Tuesday   → Noticing Prompt
 *   Wednesday → Moment Nudge
 *   Friday    → Noticing Prompt
 *   Saturday  → Bonding Activity  (recorded in weekend_activities table)
 *   Monday    → Weekend Activity Follow-up
 *   (Thursday, Sunday — no proactive messages)
 *
 * ── Timezone-aware delivery ────────────────────────────────────────────────────
 * The scheduler runs every hour (at :00). On each tick it checks which users
 * have their preferred reminder_hour matching the current hour in their timezone,
 * and sends only to those users. This means every parent receives messages at
 * the time they chose during onboarding, regardless of where they are in the world.
 *
 * New users who registered before this feature existed default to reminder_hour=8
 * and timezone='UTC'. Update their records via the admin panel or DB if needed.
 */

const cron       = require('node-cron');
const { logger } = require('./utils/logger');
const { getOnboardedUsers } = require('./services/userService');
const { sendMessage }       = require('./services/whatsappService');
const { saveMessage }       = require('./services/conversationService');
const { getTemplateResponse }        = require('./services/templateService');
const {
  recordActivitySent,
  getUsersForMondayFollowup,
  markFollowupSent,
} = require('./services/activityTrackingService');

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
let promptIndex = 0;
let nudgeIndex  = 0;
let weeklyIndex = 0;

// ─── Timezone-aware user filtering ───────────────────────────────────────
/**
 * Return the current local hour (0–23) for a given IANA timezone string.
 * Falls back to UTC if the timezone is invalid.
 */
function localHourInTimezone(timezone) {
  try {
    const tz      = timezone || 'UTC';
    const now     = new Date();
    // Intl.DateTimeFormat gives us the local hour in any IANA timezone
    const hour    = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour:     'numeric',
        hour12:   false,
      }).format(now),
      10
    );
    // Intl returns 24 for midnight in some environments — normalise to 0
    return hour === 24 ? 0 : hour;
  } catch {
    return new Date().getUTCHours();
  }
}

/**
 * Filter the full user list to only those whose preferred reminder_hour
 * matches the current local hour in their timezone.
 */
function getUsersDueNow(users) {
  return users.filter(user => {
    const tz           = user.timezone     || 'UTC';
    const preferredHr  = user.reminder_hour != null ? user.reminder_hour : 8;
    const currentLocal = localHourInTimezone(tz);
    return currentLocal === preferredHr;
  });
}

// ─── Send helpers ─────────────────────────────────────────────────────────
async function deliverToUsers(users, message) {
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await sendMessage(user.whatsapp_number, message);
      await saveMessage(user.user_id, 'assistant', message, null);
      sent++;
    } catch (err) {
      logger.error('Failed to deliver scheduled message', {
        userId: user.user_id, error: err.message,
      });
      failed++;
    }
  }
  return { sent, failed };
}

// ─── Job: Noticing Prompt (Tuesday + Friday) ──────────────────────────────
async function sendDailyPrompts() {
  logger.info('Noticing prompt job started');
  try {
    const allUsers  = await getOnboardedUsers();
    const dueUsers  = getUsersDueNow(allUsers);
    if (!dueUsers.length) {
      logger.info('Noticing prompt job: no users due this hour');
      return;
    }

    const promptText = DAILY_PROMPTS[promptIndex % DAILY_PROMPTS.length];
    promptIndex++;
    const message    = getTemplateResponse('daily_prompt', { promptText });

    const { sent, failed } = await deliverToUsers(dueUsers, message);
    logger.info('Noticing prompt job complete', { sent, failed, total: dueUsers.length });
  } catch (err) {
    logger.error('Noticing prompt job failed', { error: err.message });
  }
}

// ─── Job: Moment Nudge (Wednesday) ────────────────────────────────────────
async function sendMomentNudge() {
  logger.info('Moment nudge job started');
  try {
    const allUsers = await getOnboardedUsers();
    const dueUsers = getUsersDueNow(allUsers);
    if (!dueUsers.length) {
      logger.info('Moment nudge job: no users due this hour');
      return;
    }

    const nudge = MOMENT_NUDGES[nudgeIndex % MOMENT_NUDGES.length];
    nudgeIndex++;

    const { sent, failed } = await deliverToUsers(dueUsers, nudge);
    logger.info('Moment nudge job complete', { sent, failed, total: dueUsers.length });
  } catch (err) {
    logger.error('Moment nudge job failed', { error: err.message });
  }
}// ─── Job: Weekly Bonding Activity (Saturday) ──────────────────────────────────
async function sendWeeklyActivities() {
  logger.info('Weekly activity job started');
  try {
    const allUsers     = await getOnboardedUsers();
    const dueUsers     = getUsersDueNow(allUsers);
    if (!dueUsers.length) {
      logger.info('Weekly activity job: no users due this hour');
      return;
    }

    const activityText = WEEKLY_ACTIVITIES[weeklyIndex % WEEKLY_ACTIVITIES.length];
    weeklyIndex++;
    const message      = getTemplateResponse('weekly_activity', { activityText });

    let sent = 0, failed = 0;
    for (const user of dueUsers) {
      try {
        await sendMessage(user.whatsapp_number, message);
        await saveMessage(user.user_id, 'assistant', message, null);
        // Record the activity so Monday follow-up knows what was sent
        await recordActivitySent(user.user_id, activityText);
        sent++;
      } catch (err) {
        logger.error('Failed to deliver weekly activity', {
          userId: user.user_id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('Weekly activity job complete', { sent, failed, total: dueUsers.length });
  } catch (err) {
    logger.error('Weekly activity job failed', { error: err.message });
  }
}

// ─── Job: Weekend Activity Follow-up (Monday morning) ──────────────────────────
// Sends a gentle check-in to every user who received a weekend activity
// but has not yet been asked if they completed it.
// Runs every hour on Monday so it respects each user's preferred reminder_hour.
async function sendWeekendActivityFollowups() {
  logger.info('Weekend activity follow-up job started');
  try {
    const usersForFollowup = await getUsersForMondayFollowup();
    if (!usersForFollowup.length) {
      logger.info('Weekend follow-up job: no users to follow up with this hour');
      return;
    }

    // Filter to users whose preferred reminder_hour matches the current local hour
    const allUsers = await getOnboardedUsers();
    const userMap  = new Map(allUsers.map(u => [u.user_id, u]));

    let sent = 0, failed = 0;
    for (const row of usersForFollowup) {
      const userProfile = userMap.get(row.user_id);
      if (!userProfile) continue;

      const tz           = userProfile.timezone     || 'UTC';
      const preferredHr  = userProfile.reminder_hour != null ? userProfile.reminder_hour : 8;
      const currentLocal = localHourInTimezone(tz);
      if (currentLocal !== preferredHr) continue; // not their preferred hour yet

      try {
        const message = getTemplateResponse('weekend_activity_followup');
        await sendMessage(row.whatsapp_number, message);
        await saveMessage(row.user_id, 'assistant', message, null);
        await markFollowupSent(row.activity_id);
        sent++;
      } catch (err) {
        logger.error('Failed to send weekend follow-up', {
          userId: row.user_id, error: err.message,
        });
        failed++;
      }
    }
    logger.info('Weekend follow-up job complete', { sent, failed });
  } catch (err) {
    logger.error('Weekend follow-up job failed', { error: err.message });
  }
}
// ─── Start schedulers ─────────────────────────────────────────────────────
// All jobs now run every hour at :00.
// The getUsersDueNow() filter ensures each user only receives a message
// during the hour that matches their saved reminder_hour in their timezone.
function startDailyScheduler() {
  // Noticing Prompt: every hour, Tuesday (2) and Friday (5)
  cron.schedule('0 0 * * * 2,5', sendDailyPrompts);
  logger.info('Noticing prompt scheduler started (Tue + Fri, hourly dispatch)');

  // Moment Nudge: every hour, Wednesday (3)
  cron.schedule('0 0 * * * 3', sendMomentNudge);
  logger.info('Moment nudge scheduler started (Wed, hourly dispatch)');
}

function startWeeklyScheduler() {
  // Bonding Activity: every hour, Saturday (6)
  cron.schedule('0 0 * * * 6', sendWeeklyActivities);
  logger.info('Weekly activity scheduler started (Sat, hourly dispatch)');

  // Weekend Activity Follow-up: every hour, Monday (1)
  cron.schedule('0 0 * * * 1', sendWeekendActivityFollowups);
  logger.info('Weekend activity follow-up scheduler started (Mon, hourly dispatch)');
}

module.exports = {
  startDailyScheduler,
  startWeeklyScheduler,
  sendDailyPrompts,
  sendMomentNudge,
  sendWeeklyActivities,
  sendWeekendActivityFollowups,
};
