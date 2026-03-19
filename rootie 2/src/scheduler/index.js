/**
 * Rootie — Scheduler
 *
 * Scheduled message types (all free for all onboarded users, zero OpenAI cost):
 *
 * 1. Noticing Prompt  — Monday morning
 *    A "Kind Roots Moment" challenge to carry through the week — one behaviour
 *    to watch for in their child over the next 7 days. Rotates through 20 prompts.
 *
 * 2. Moment Nudge     — Wednesday morning
 *    A short, soft mid-week nudge asking parents to log any good moment they noticed.
 *    Rotates through 8 nudge variants.
 *
 * 3. Weekly Bonding Activity — Saturday morning
 *    A 5-minute bonding activity for the whole family. Rotates through 7 activities.
 *    The activity text is saved to weekend_activities so the Sunday follow-up can
 *    reference it.
 *
 * 4. Weekend Activity Follow-up — Sunday evening
 *    Asks parents if they completed Saturday's activity. Sent in the evening so
 *    families have had the full weekend to try it.
 *    Replies are handled in webhook.js → activityTrackingService.js.
 *
 * 5. Evening Connection Nudge — Monday–Friday, evening
 *    A warm, personal nudge reminding parents to put the phone down and spend
 *    15 distraction-free minutes with their child. Rotates through 10 messages.
 *    Sent at a FIXED local hour of 18:00 (6pm) in the user's timezone.
 *    This is completely independent of reminder_hour, so there is zero risk
 *    of collision with morning messages regardless of what time the parent chose.
 *
 * ── Overlap-free weekly rhythm ───────────────────────────────────────────────────
 *
 *   Day        Morning (at reminder_hour)     Evening (fixed 18:00 local)
 *   ─────────  ─────────────────────────────  ──────────────────────────
 *   Monday     Noticing Prompt                Evening Connection Nudge
 *   Tuesday    —                              Evening Connection Nudge
 *   Wednesday  Moment Nudge                   Evening Connection Nudge
 *   Thursday   —                              Evening Connection Nudge
 *   Friday     —                              Evening Connection Nudge
 *   Saturday   Bonding Activity               —
 *   Sunday     —                              Weekend Activity Follow-up (18:00)
 *
 *   Morning messages fire at the parent's chosen reminder_hour.
 *   Evening messages fire at a fixed 18:00 local time.
 *   A parent who chose reminder_hour=18 would receive both at 6pm on Mon/Wed —
 *   the only edge case. To avoid this, the evening nudge skips users whose
 *   reminder_hour is 18 on days that also have a morning message.
 *
 * ── Timezone-aware delivery ──────────────────────────────────────────────────
 * The scheduler runs every hour (at :00). On each tick it checks which users
 * have their preferred reminder_hour matching the current hour in their timezone,
 * and sends only to those users. This means every parent receives messages at
 * the time they chose during onboarding, regardless of where they are in the world.
 *
 * New users who registered before this feature existed default to reminder_hour=8
 * and timezone='UTC'. Update their records via the admin panel or DB if needed.
 */

const cron       = require('node-cron');
const { logger } = require('../utils/logger');
const { getOnboardedUsers } = require('../services/userService');
const { sendMessage }       = require('../services/whatsappService');
const { saveMessage }       = require('../services/conversationService');
const { getTemplateResponse }        = require('../services/templateService');
const {
  recordActivitySent,
  getUsersForMondayFollowup,
  markFollowupSent,
} = require('../services/activityTrackingService');

// ─── Noticing Prompts (20 items, rotating) ────────────────────────────────
// Framed as something to watch for throughout the coming week, not just today.
const DAILY_PROMPTS = [
  'This week, keep an eye out for a moment when your child shows kindness — even something tiny. When you spot it, tell them what you saw. 🌱',
  'Your challenge this week: notice one moment when your child tries something hard. Watch how they handle it — without jumping in. 💛',
  'This week, catch your child being patient. It might happen fast — a pause before reacting, waiting their turn. Notice it out loud when it does. 🌱',
  'This week, look for a moment of pure curiosity in your child. What are they drawn to? What questions do they ask? 💛',
  'Your challenge this week: spot a moment when your child shows empathy — a kind word, a gentle gesture, noticing someone else\'s feelings. 🌱',
  'This week, watch for resilience. When your child hits a frustrating moment, notice how they bounce back — even a little. 💛',
  'This week, look for a moment when your child takes responsibility for something — big or small — without being asked. 🌱',
  'Your challenge this week: listen for a moment when your child expresses a big feeling using words instead of actions. That\'s a real skill. 💛',
  'This week, notice a moment when your child helps someone without being asked. It might be quick — don\'t miss it. 🌱',
  'Your challenge this week: catch your child being proud of something they made or did. Notice their face. Tell them you saw it. 💛',
  'This week, look for a moment when your child shares something — a toy, a snack, their time — with someone else. 🌱',
  'This week, notice a moment when your child gets completely absorbed in something. What are they exploring? What does that tell you about them? 💛',
  'Your challenge this week: catch a moment when your child uses their words to work through a problem instead of giving up or getting upset. 🌱',
  'This week, watch for a moment when your child shows respect for someone else\'s feelings — a pause, a softening, a kind choice. 💛',
  'This week, notice a moment when your child cleans up or tidies something without being reminded. Small, but worth celebrating. 🌱',
  'Your challenge this week: listen for a really thoughtful question from your child. What are they trying to understand about the world? 💛',
  'This week, look for a moment of courage in your child — trying something new, speaking up, doing something even when they\'re a little scared. 🌱',
  'Your challenge this week: notice a moment when your child is a genuinely good listener to someone else. That\'s a rare and beautiful thing. 💛',
  'This week, watch for a moment when your child waits for something they want — and handles it well. Patience is a muscle. 🌱',
  'This week, notice a moment when your child says "please" or "thank you" without being prompted. Small habit, big character. 💛',
];

// ─── Moment Nudges (8 items, rotating) ───────────────────────────────────
const MOMENT_NUDGES = [
  'Mid-week check-in 🌱 — did anything lovely happen with your child this week? Even something tiny counts. Tap to log it.',
  'One small moment is all it takes. 💛 Did you notice anything about your child this week worth remembering?',
  'A quick check-in 🌱 — did your child do or say anything this week that made you smile? Log it here.',
  'Moments add up. 💛 Anything worth noting from this week — big or small?',
  'Even a 10-second moment matters. 🌱 Did you catch anything in your child this week worth saving?',
  'Your child is growing every day. 💛 Notice anything this week? Share it here and I\'ll save it for you.',
  'A little nudge 🌱 — did anything happen this week that you\'d love to remember a year from now?',
  'Kind Roots mid-week check-in 💛 — any moments of kindness, curiosity, or courage from your child this week?',
];

// ─── Weekly Bonding Activities (7 items, rotating) ───────────────────────
const WEEKLY_ACTIVITIES = [
  'Ask your child: *"What was one moment this week that made you proud?"* Listen without jumping in.',
  'Try a "Rose and Thorn" conversation at dinner: each person shares one good thing and one hard thing from their week.',
  'Spend 10 minutes doing whatever your child wants to do — no phones, no agenda. Just be present.',
  'Write a small note and leave it somewhere your child will find it. Just one thing you love about them.',
  'Ask your child to teach you something they know how to do. Let them be the expert.',
  'Take a 10-minute walk together. No destination. Just notice things around you.',
  'Ask your child: *"If you could change one rule in our house, what would it be?"* Really listen.',
];

// ─── Evening Connection Nudges (10 items, rotating) ──────────────────────
// Warm, personal reminders to put the phone down and be present.
// Sent Mon–Fri at each parent's evening hour (reminder_hour + 10, max 21).
const EVENING_NUDGES = [
  `The work day is done. 🌙 Your child doesn't need a perfect parent tonight — just a present one. Even 15 minutes of real, phone-free time together does more than you know. 💛`,

  `Hey — before the evening disappears, try this: put your phone face-down for just 15 minutes and let your child lead. No agenda, no teaching. Just you, fully there. 🌱 Those are the moments they carry forever.`,

  `Quick reminder from Rootie 🌱 — connection doesn't need a plan. It just needs you to show up. Sit with your child tonight. Ask them one question and really listen to the answer. That's it. 💛`,

  `The dishes can wait. The emails can wait. 🌙 But your child's childhood? That's happening right now. Steal 15 minutes tonight — just the two of you, doing whatever they want. You won't regret it.`,

  `Research shows that 15 minutes of undivided attention a day is enough to make a child feel deeply loved and secure. 💛 You've got 15 minutes tonight. Put the phone down. Go find them. 🌱`,

  `Evening nudge 🌙 — your child has been waiting all day to tell you something. They might not say it directly. But if you sit with them, get on their level, and just *be there* — it'll come out. 💛 Try it tonight.`,

  `Parenting tip from Rootie 🌱: the most powerful thing you can do tonight isn't a lesson or a lecture. It's just being genuinely curious about your child's world. Ask them: *"What was the best part of your day?"* Then listen like it's the most interesting thing you've heard all week. 💛`,

  `You made it through another day. 🌙 So did they. Tonight, before bedtime, try a little ritual: sit together, no screens, and each share one good thing from the day. It takes 5 minutes. It builds a lifetime. 🌱`,

  `Here's something worth knowing 💛 — children who have at least one parent who is consistently, warmly present grow up with stronger emotional regulation, better friendships, and more resilience. You don't have to be perfect. You just have to *show up*. Tonight's a good night to start. 🌱`,

  `Evening check-in from Rootie 🌙 — how are *you* doing? Parenting is hard, and you're doing it anyway. Take a breath. Then go find your child and do something small together — a hug, a silly game, five minutes of their favourite show. Connection is the whole thing. 💛`,
];

// ─── Rotating counters ───────────────────────────────────────────────────────────────────
let promptIndex  = 0;
let nudgeIndex   = 0;
let weeklyIndex  = 0;
let eveningIndex = 0;
let openQIndex   = 0;

// ─── Timezone-aware user filtering ───────────────────────────────────────────────────────────────────
/**
 * Return the current local hour (0–23) for a given IANA timezone string.
 * Falls back to UTC if the timezone is invalid.
 */
function localHourInTimezone(timezone) {
  try {
    const tz   = timezone || 'UTC';
    const now  = new Date();
    const hour = parseInt(
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hour:     'numeric',
        hour12:   false,
      }).format(now),
      10
    );
    return hour === 24 ? 0 : hour;
  } catch {
    return new Date().getUTCHours();
  }
}

/**
 * Filter users whose preferred reminder_hour matches the current local hour.
 * Used for all morning messages.
 */
function getUsersDueNow(users) {
  return users.filter(user => {
    const tz          = user.timezone     || 'UTC';
    const preferredHr = user.reminder_hour != null ? user.reminder_hour : 8;
    return localHourInTimezone(tz) === preferredHr;
  });
}

// Fixed evening hour: all evening messages fire at 18:00 (6pm) local time.
const EVENING_HOUR = 18;

/**
 * Filter users whose current local hour is 18:00 (6pm).
 * Used for all evening messages (connection nudge + weekend follow-up).
 *
 * Edge case: a parent who chose reminder_hour=18 would receive a morning
 * message AND an evening nudge at the same time on Mon/Wed (days that have
 * both). The hasMorningMessageToday flag is passed in to skip those users.
 *
 * @param {Array} users
 * @param {boolean} [skipReminderHour18=false] - if true, exclude users whose reminder_hour is 18
 */
function getUsersDueForEvening(users, skipReminderHour18 = false) {
  return users.filter(user => {
    const tz          = user.timezone || 'UTC';
    const preferredHr = user.reminder_hour != null ? user.reminder_hour : 8;
    if (skipReminderHour18 && preferredHr === EVENING_HOUR) return false;
    return localHourInTimezone(tz) === EVENING_HOUR;
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

// ─── Job: Noticing Prompt (Monday morning) ────────────────────────────────
// Framed as a challenge to carry through the whole week.
async function sendDailyPrompts() {
  logger.info('Noticing prompt job started');
  try {
    const allUsers = await getOnboardedUsers();
    const dueUsers = getUsersDueNow(allUsers);
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

// ─── Job: Moment Nudge (Wednesday morning) ────────────────────────────────
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
}

// ─── Job: Weekly Bonding Activity (Saturday morning) ──────────────────────
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
        // Record the activity so Sunday follow-up knows what was sent
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

// ─── Job: Weekend Activity Follow-up (Sunday evening) ─────────────────────
// Sends a gentle check-in to every user who received a weekend activity
// but has not yet been asked if they completed it.
// Runs every hour on Sunday; fires for each user when their local time is 18:00.
async function sendWeekendActivityFollowups() {
  logger.info('Weekend activity follow-up job started');
  try {
    const usersForFollowup = await getUsersForMondayFollowup();
    if (!usersForFollowup.length) {
      logger.info('Weekend follow-up job: no users to follow up with this hour');
      return;
    }

    // Filter to users whose local time is currently 18:00 (fixed evening hour)
    const allUsers = await getOnboardedUsers();
    const userMap  = new Map(allUsers.map(u => [u.user_id, u]));

    let sent = 0, failed = 0;
    for (const row of usersForFollowup) {
      const userProfile = userMap.get(row.user_id);
      if (!userProfile) continue;

      const tz = userProfile.timezone || 'UTC';
      if (localHourInTimezone(tz) !== EVENING_HOUR) continue;

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
// ─── Job: Evening Connection Nudge (Monday–Friday, evening) ─────────────────────
// Sends a warm reminder to put the phone down and spend 15 minutes with
// the child. Delivered at a fixed 18:00 (6pm) local time, Mon–Fri.
// On Mon and Wed (days with a morning message), users whose reminder_hour=18
// are skipped to avoid sending two messages at the same time.
async function sendEveningNudge() {
  logger.info('Evening nudge job started');
  try {
    const allUsers = await getOnboardedUsers();
    // Mon=1, Wed=3 have morning messages — skip reminder_hour=18 users on those days
    const dayOfWeek     = new Date().getDay(); // 0=Sun, 1=Mon, ...
    const hasMorningToday = (dayOfWeek === 1 || dayOfWeek === 3);
    const dueUsers = getUsersDueForEvening(allUsers, hasMorningToday);
    if (!dueUsers.length) {
      logger.info('Evening nudge job: no users due this hour');
      return;
    }

    const nudge = EVENING_NUDGES[eveningIndex % EVENING_NUDGES.length];
    eveningIndex++;

    const { sent, failed } = await deliverToUsers(dueUsers, nudge);
    logger.info('Evening nudge job complete', { sent, failed, total: dueUsers.length });
  } catch (err) {
    logger.error('Evening nudge job failed', { error: err.message });
  }
}

// ─── Job: Weekly Open Question (Tuesday morning) ─────────────────────────────────────────────────
// Invites parents to share any worry, question, or curiosity about their child.
// Sent Tuesday morning at the parent's reminder_hour. Rotates through 15 templates.
// Replies are classified as open_question_response and routed to full AI.
async function sendWeeklyOpenQuestion() {
  logger.info('Weekly open question job started');
  try {
    const allUsers = await getOnboardedUsers();
    const dueUsers = getUsersDueNow(allUsers);
    if (!dueUsers.length) {
      logger.info('Weekly open question job: no users due this hour');
      return;
    }

    const message = getTemplateResponse('weekly_open_question');
    openQIndex++;

    const { sent, failed } = await deliverToUsers(dueUsers, message);
    logger.info('Weekly open question job complete', { sent, failed, total: dueUsers.length });
  } catch (err) {
    logger.error('Weekly open question job failed', { error: err.message });
  }
}

// ─── Start schedulers ───────────────────────────────────────────────────────────────────
// All jobs run every hour at :00 on their designated days.
// Morning jobs use getUsersDueNow()        → fires at parent's reminder_hour.
// Evening jobs use getUsersDueForEvening() → fires at fixed 18:00 local time.
//
// Updated weekly rhythm:
//   Mon morning : Noticing Prompt
//   Tue morning : Weekly Open Question
//   Wed morning : Moment Nudge
//   Mon–Fri 18:00: Evening Connection Nudge
//   Sat morning : Bonding Activity
//   Sun 18:00   : Weekend Activity Follow-up
function startDailyScheduler() {
  // Noticing Prompt: Monday morning (1)
  cron.schedule('0 * * * 1', sendDailyPrompts);
  logger.info('Noticing prompt scheduler started (Mon morning)');

  // Weekly Open Question: Tuesday morning (2)
  cron.schedule('0 * * * 2', sendWeeklyOpenQuestion);
  logger.info('Weekly open question scheduler started (Tue morning)');

  // Moment Nudge: Wednesday morning (3)
  cron.schedule('0 * * * 3', sendMomentNudge);
  logger.info('Moment nudge scheduler started (Wed morning)');

  // Evening Connection Nudge: Monday–Friday evenings (1–5)
  cron.schedule('0 * * * 1-5', sendEveningNudge);
  logger.info('Evening nudge scheduler started (Mon–Fri evenings)');
}

function startWeeklyScheduler() {
  // Bonding Activity: Saturday morning (6)
  cron.schedule('0 * * * 6', sendWeeklyActivities);
  logger.info('Weekly activity scheduler started (Sat morning)');

  // Weekend Activity Follow-up: Sunday evening (0)
  cron.schedule('0 * * * 0', sendWeekendActivityFollowups);
  logger.info('Weekend activity follow-up scheduler started (Sun evening)');
}

module.exports = {
  startDailyScheduler,
  startWeeklyScheduler,
  sendDailyPrompts,
  sendMomentNudge,
  sendWeeklyActivities,
  sendWeekendActivityFollowups,
  sendEveningNudge,
  sendWeeklyOpenQuestion,
};
