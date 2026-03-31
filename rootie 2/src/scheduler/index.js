/**
 * Rootie — Scheduler
 *
 * Scheduled message types (all free for all onboarded users, zero OpenAI cost):
 *
 * 1. Noticing Prompt       — Monday    10:00 AM (user's timezone)
 * 2. Weekly Open Question  — Tuesday   10:00 AM (user's timezone)
 * 3. Moment Nudge          — Wednesday 10:00 AM (user's timezone)
 * 4. Weekly Bonding Activity — Saturday 10:00 AM (user's timezone)
 * 5. Evening Connection Nudge — Mon–Fri 6:00 PM  (user's timezone)
 * 6. Weekend Activity Follow-up — Sunday 6:00 PM (user's timezone)
 *
 * ── Fixed-time weekly rhythm ─────────────────────────────────────────────────
 *
 *   Day        10:00 AM (local)               6:00 PM (local)
 *   ─────────  ─────────────────────────────  ──────────────────────────
 *   Monday     Noticing Prompt                Evening Connection Nudge
 *   Tuesday    Weekly Open Question           Evening Connection Nudge
 *   Wednesday  Moment Nudge                   Evening Connection Nudge
 *   Thursday   —                              Evening Connection Nudge
 *   Friday     —                              Evening Connection Nudge
 *   Saturday   Bonding Activity               —
 *   Sunday     —                              Weekend Activity Follow-up
 *
 * All times are fixed — no per-user reminder_hour preference is used.
 * The scheduler runs every hour (at :00). On each tick it checks which users
 * are currently at the target local hour in their own timezone.
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
 * Return the current local day-of-week (0=Sun … 6=Sat) for a given IANA
 * timezone string. Falls back to the server's local day if the timezone is
 * invalid.
 *
 * This is the companion to localHourInTimezone() and is used to gate
 * day-specific scheduled jobs. Without this, the cron day-of-week field
 * is evaluated in the SERVER timezone, which causes messages to be missed
 * for users whose local day differs from the server's day (e.g. a UTC+5:30
 * user at 8 AM IST is still on Sunday in UTC).
 */
function localDayOfWeekInTimezone(timezone) {
  try {
    const tz      = timezone || 'UTC';
    const now     = new Date();
    const dayName = new Intl.DateTimeFormat('en-US', {
      timeZone: tz,
      weekday:  'long',
    }).format(now);
    const days = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
    const idx  = days.indexOf(dayName);
    return idx === -1 ? new Date().getDay() : idx;
  } catch {
    return new Date().getDay();
  }
}

// Fixed send hours — no per-user preference needed.
const MORNING_HOUR = 10; // 10:00 AM in user's timezone
const EVENING_HOUR = 18; // 6:00 PM  in user's timezone

/**
 * Filter users whose current local hour matches targetHour
 * AND whose local day-of-week is in allowedDays.
 * Both checks are performed in each user's own IANA timezone.
 *
 * @param {Array}           users       - onboarded user records
 * @param {number|number[]} allowedDays - day(s) of week (0=Sun…6=Sat)
 * @param {number}          targetHour  - local hour to match (0–23)
 */
function getUsersDueAt(users, allowedDays, targetHour) {
  const days = Array.isArray(allowedDays) ? allowedDays : [allowedDays];
  return users.filter(user => {
    const tz = user.timezone || 'UTC';
    return days.includes(localDayOfWeekInTimezone(tz))
        && localHourInTimezone(tz) === targetHour;
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

// ─── Job: Noticing Prompt (Monday 10:00 AM) ─────────────────────────────────
// Framed as a challenge to carry through the whole week.
async function sendDailyPrompts() {
  logger.info('Noticing prompt job started');
  try {
    const allUsers = await getOnboardedUsers();
    const dueUsers = getUsersDueAt(allUsers, 1, MORNING_HOUR); // Monday 10 AM
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

// ─── Job: Moment Nudge (Wednesday 10:00 AM) ─────────────────────────────────
async function sendMomentNudge() {
  logger.info('Moment nudge job started');
  try {
    const allUsers = await getOnboardedUsers();
    const dueUsers = getUsersDueAt(allUsers, 3, MORNING_HOUR); // Wednesday 10 AM
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

// ─── Job: Weekly Bonding Activity (Saturday 10:00 AM) ───────────────────────
async function sendWeeklyActivities() {
  logger.info('Weekly activity job started');
  try {
    const allUsers     = await getOnboardedUsers();
    const dueUsers     = getUsersDueAt(allUsers, 6, MORNING_HOUR); // Saturday 10 AM
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
// Runs every hour; fires for each user when their local time is Sunday 18:00.
async function sendWeekendActivityFollowups() {
  logger.info('Weekend activity follow-up job started');
  try {
    const usersForFollowup = await getUsersForMondayFollowup();
    if (!usersForFollowup.length) {
      logger.info('Weekend follow-up job: no users to follow up with this hour');
      return;
    }

    // Filter to users whose local time is currently Sunday 18:00
    const allUsers = await getOnboardedUsers();
    const userMap  = new Map(allUsers.map(u => [u.user_id, u]));

    let sent = 0, failed = 0;
    for (const row of usersForFollowup) {
      const userProfile = userMap.get(row.user_id);
      if (!userProfile) continue;

      const tz = userProfile.timezone || 'UTC';
      // Send on Sunday at 6 PM in user's own timezone
      if (localDayOfWeekInTimezone(tz) !== 0) continue;
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
// ─── Job: Evening Connection Nudge (Monday–Friday 6:00 PM) ──────────────────
// Sends a warm reminder to put the phone down and spend 15 minutes with
// the child. Delivered at a fixed 18:00 (6pm) local time, Mon–Fri.
// Morning messages are at 10 AM so there is no overlap risk with 6 PM.
async function sendEveningNudge() {
  logger.info('Evening nudge job started');
  try {
    const allUsers = await getOnboardedUsers();
    const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri in user's timezone
    const dueUsers = getUsersDueAt(allUsers, WEEKDAYS, EVENING_HOUR);
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

// ─── Job: Weekly Open Question (Tuesday 10:00 AM) ───────────────────────────
// Invites parents to share any worry, question, or curiosity about their child.
// Sent Tuesday 10 AM in the user's timezone. Rotates through 15 templates.
// Replies are classified as open_question_response and routed to full AI.
async function sendWeeklyOpenQuestion() {
  logger.info('Weekly open question job started');
  try {
    const allUsers = await getOnboardedUsers();
    const dueUsers = getUsersDueAt(allUsers, 2, MORNING_HOUR); // Tuesday 10 AM
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
  // All jobs run every hour. Day-of-week and hour gating is handled inside
  // each job using localDayOfWeekInTimezone() and localHourInTimezone(),
  // so delivery is always evaluated in each user's own timezone.
  //
  // Fixed schedule (all times in user's local timezone):
  //   Mon 10:00 AM — Noticing Prompt
  //   Tue 10:00 AM — Weekly Open Question
  //   Wed 10:00 AM — Moment Nudge
  //   Mon–Fri 6 PM — Evening Connection Nudge
  //   Sat 10:00 AM — Weekly Bonding Activity
  //   Sun 6:00 PM  — Weekend Activity Follow-up

  cron.schedule('0 * * * *', sendDailyPrompts);
  logger.info('Noticing prompt scheduler started (Mon 10 AM in user TZ)');

  cron.schedule('0 * * * *', sendWeeklyOpenQuestion);
  logger.info('Weekly open question scheduler started (Tue 10 AM in user TZ)');

  cron.schedule('0 * * * *', sendMomentNudge);
  logger.info('Moment nudge scheduler started (Wed 10 AM in user TZ)');

  cron.schedule('0 * * * *', sendEveningNudge);
  logger.info('Evening nudge scheduler started (Mon–Fri 6 PM in user TZ)');
}

function startWeeklyScheduler() {
  cron.schedule('0 * * * *', sendWeeklyActivities);
  logger.info('Weekly activity scheduler started (Sat 10 AM in user TZ)');

  cron.schedule('0 * * * *', sendWeekendActivityFollowups);
  logger.info('Weekend activity follow-up scheduler started (Sun 6 PM in user TZ)');
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
