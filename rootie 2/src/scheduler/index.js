/**
 * Rootie — Scheduler
 *
 * Scheduled message types (all free for all onboarded users, zero OpenAI cost):
 *
 * 1. Evening Connection Nudge — Mon–Fri 6:00 PM  (user's timezone)
 * 2. Weekly Bonding Activity  — Saturday 10:00 AM (user's timezone)
 *
 * The scheduler runs every hour (at :00). On each tick it checks which users
 * are currently at the target local hour in their own timezone.
 */

const cron       = require('node-cron');
const { logger } = require('../utils/logger');
const { getOnboardedUsers } = require('../services/userService');
const { sendMessage }       = require('../services/whatsappService');
const { saveMessage }       = require('../services/conversationService');
const { getTemplateResponse }        = require('../services/templateService');
const { recordActivitySent } = require('../services/activityTrackingService');
const { writeCronLog, isLoggingActive, minutesRemaining } = require('../services/cronLogService');

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
// Sent Mon–Fri at 6:00 PM in each parent's timezone.
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
let weeklyIndex  = 0;
let eveningIndex = 0;

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

/**
 * Build a compact per-user diagnostic snapshot for logging.
 * Shows each user's timezone, local day, local hour, and whether they matched.
 */
function buildUserDiagnostics(users, allowedDays, targetHour) {
  const days = Array.isArray(allowedDays) ? allowedDays : [allowedDays];
  return users.map(user => {
    const tz       = user.timezone || 'UTC';
    const localDay = localDayOfWeekInTimezone(tz);
    const localHr  = localHourInTimezone(tz);
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    return {
      userId:    user.user_id,
      timezone:  tz,
      localDay:  dayNames[localDay] || localDay,
      localHour: localHr,
      matched:   days.includes(localDay) && localHr === targetHour,
    };
  });
}

// ─── Send helpers ─────────────────────────────────────────────────────────
async function deliverToUsers(users, message) {
  let sent = 0, failed = 0;
  for (const user of users) {
    try {
      await sendMessage(user.whatsapp_number, message);
      await saveMessage(user.user_id, 'assistant', message, null);
      logger.info('Scheduled message sent', { userId: user.user_id, phone: user.whatsapp_number });
      sent++;
    } catch (err) {
      logger.error('Failed to deliver scheduled message', {
        userId: user.user_id, phone: user.whatsapp_number, error: err.message,
      });
      failed++;
    }
  }
  return { sent, failed };
}

// ─── Job: Weekly Bonding Activity (Saturday 10:00 AM) ───────────────────────
async function sendWeeklyActivities() {
  const utcNow = new Date().toISOString();
  logger.info('[CRON TICK] Weekly activity job fired', { utcNow });
  try {
    const allUsers     = await getOnboardedUsers();
    const diagnostics  = buildUserDiagnostics(allUsers, 6, MORNING_HOUR);
    logger.info('[CRON DIAG] Weekly activity user check', {
      totalUsers: allUsers.length,
      targetDay: 'Sat',
      targetHour: MORNING_HOUR,
      users: diagnostics,
    });

    const dueUsers = allUsers.filter((_, i) => diagnostics[i].matched);

    let sent = 0, failed = 0;
    if (dueUsers.length) {
      const activityText = WEEKLY_ACTIVITIES[weeklyIndex % WEEKLY_ACTIVITIES.length];
      weeklyIndex++;
      const message      = getTemplateResponse('weekly_activity', { activityText });

      for (const user of dueUsers) {
        try {
          await sendMessage(user.whatsapp_number, message);
          await saveMessage(user.user_id, 'assistant', message, null);
          await recordActivitySent(user.user_id, activityText);
          logger.info('Scheduled message sent', { userId: user.user_id, phone: user.whatsapp_number });
          sent++;
        } catch (err) {
          logger.error('Failed to deliver weekly activity', {
            userId: user.user_id, phone: user.whatsapp_number, error: err.message,
          });
          failed++;
        }
      }
      logger.info('[CRON DONE] Weekly activity job complete', { sent, failed, total: dueUsers.length });
    } else {
      logger.info('[CRON SKIP] Weekly activity: no users due this hour');
    }

    await writeCronLog({
      jobName: 'weekly_activity', utcTime: utcNow,
      totalUsers: allUsers.length, matched: dueUsers.length,
      sent, failed, userDetails: diagnostics,
    });
  } catch (err) {
    logger.error('[CRON ERROR] Weekly activity job failed', { error: err.message, stack: err.stack });
    await writeCronLog({ jobName: 'weekly_activity', utcTime: new Date().toISOString(), totalUsers: 0, matched: 0, notes: err.message });
  }
}

// ─── Job: Evening Connection Nudge (Monday–Friday 6:00 PM) ──────────────────
// Sends a warm reminder to put the phone down and spend 15 minutes with
// the child. Delivered at a fixed 18:00 (6pm) local time, Mon–Fri.
// Morning messages are at 10 AM so there is no overlap risk with 6 PM.
async function sendEveningNudge() {
  const utcNow = new Date().toISOString();
  logger.info('[CRON TICK] Evening nudge job fired', { utcNow });
  try {
    const allUsers = await getOnboardedUsers();
    const WEEKDAYS = [1, 2, 3, 4, 5]; // Mon–Fri in user's timezone
    const diagnostics = buildUserDiagnostics(allUsers, WEEKDAYS, EVENING_HOUR);
    logger.info('[CRON DIAG] Evening nudge user check', {
      totalUsers: allUsers.length,
      targetDays: 'Mon–Fri',
      targetHour: EVENING_HOUR,
      users: diagnostics,
    });

    const dueUsers = allUsers.filter((_, i) => diagnostics[i].matched);

    let sent = null, failed = null;
    if (dueUsers.length) {
      const nudge = EVENING_NUDGES[eveningIndex % EVENING_NUDGES.length];
      eveningIndex++;
      ({ sent, failed } = await deliverToUsers(dueUsers, nudge));
      logger.info('[CRON DONE] Evening nudge job complete', { sent, failed, total: dueUsers.length });
    } else {
      logger.info('[CRON SKIP] Evening nudge: no users due this hour');
    }

    await writeCronLog({
      jobName: 'evening_nudge', utcTime: utcNow,
      totalUsers: allUsers.length, matched: dueUsers.length,
      sent, failed, userDetails: diagnostics,
    });
  } catch (err) {
    logger.error('[CRON ERROR] Evening nudge job failed', { error: err.message, stack: err.stack });
    await writeCronLog({ jobName: 'evening_nudge', utcTime: new Date().toISOString(), totalUsers: 0, matched: 0, notes: err.message });
  }
}

// ─── Start schedulers ───────────────────────────────────────────────────────────────────
// All jobs run every hour. Day-of-week and hour gating is handled inside
// each job, so delivery is always evaluated in each user's own timezone.
function startDailyScheduler() {
  cron.schedule('0 * * * *', sendEveningNudge);
  logger.info('Evening nudge scheduler started (Mon–Fri 6 PM in user TZ)');
}

function startWeeklyScheduler() {
  cron.schedule('0 * * * *', sendWeeklyActivities);
  logger.info('Weekly activity scheduler started (Sat 10 AM in user TZ)');
}

module.exports = {
  startDailyScheduler,
  startWeeklyScheduler,
  sendWeeklyActivities,
  sendEveningNudge,
};
