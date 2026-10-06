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

// ─── Weekly Bonding Activities (37 items, rotating, ages 4–10) ──────────
const WEEKLY_ACTIVITIES = [
  'Ask your child: *"What was one moment this week that made you proud?"* Listen without jumping in.',
  'Try a "Rose and Thorn" conversation at dinner: each person shares one good thing and one hard thing from their week.',
  'Spend 10 minutes doing whatever your child wants to do — no phones, no agenda. Just be present.',
  'Write a small note and leave it somewhere your child will find it. Just one thing you love about them.',
  'Ask your child to teach you something they know how to do. Let them be the expert.',
  'Take a 10-minute walk together. No destination. Just notice things around you.',
  'Ask your child: *"If you could change one rule in our house, what would it be?"* Really listen.',

  // ── Kindness & empathy ──
  'Do a secret kind act together this weekend — a thank-you drawing for a neighbour, grandparent or the security guard. Let your child choose who it\'s for.',
  'While reading a story together, pause and ask: *"How do you think they\'re feeling right now? How can you tell?"*',
  'Ask your child: *"Who do you think needs a little kindness this week?"* Make a simple plan together to help them.',
  'Make a "thank-you list" together: 5 people who helped your family this week, and one thing each of them did.',
  'Sort out a few toys or books together to give away. Talk about who might enjoy them next.',

  // ── Confidence ──
  'Let your child plan one part of the weekend — lunch, an afternoon activity, or the route for a walk. Follow their plan, even if it\'s not how you\'d do it.',
  'Tell your child about a time you made a mistake as a kid and what you learned. Then ask: *"Has anything like that happened to you?"*',
  'Ask your child: *"What\'s something you can do now that you couldn\'t do last year?"* Celebrate it together.',
  'Give your child a real job this weekend — washing vegetables, setting the table, watering plants. Thank them like a teammate, not a helper.',
  'Let your child be the "photographer" for a day. At bedtime, look through their photos together and ask why they chose each one.',

  // ── Feelings ──
  'Play "Feelings Charades" — take turns showing a feeling using only your face and body while the other guesses.',
  'At bedtime, ask: *"If today was weather, what would it be — sunny, cloudy, stormy, rainbow?"* Then ask why.',
  'Draw together: each of you draws how your week felt using only colours and shapes. Then explain your drawings to each other.',
  'Make a "calm-down list" together: 5 things that help your child feel better when they\'re upset. Stick it on the fridge.',
  'Share one small thing that was hard for you this week, in a simple way. When you name your feelings, it helps them name theirs.',

  // ── Curiosity ──
  'Go on a "noticing walk" — each of you finds 5 things you\'ve never noticed before on a street you know well.',
  'Ask your child to give you a tour of their room as if you\'re a visitor who\'s never seen it. Ask questions about everything.',
  'Ask your child: *"What\'s something you\'ve been wondering about?"* Find the answer together, or make up your silliest guesses first.',
  'Make something simple together in the kitchen — a sandwich, a smoothie, a salad. Let your child measure, pour and taste-test.',
  'Try a "sink or float" experiment in a bowl of water with 8 things from around the house. Guess first, then test.',

  // ── Resilience ──
  'Build the tallest tower you can from blocks, books or cups. When it falls, cheer and try again.',
  'Ask your child: *"What was the trickiest thing this week? How did you get through it?"* Praise the effort, not the outcome.',
  'Learn something new together that neither of you is good at — a dance move, a card trick, drawing an animal. Laugh at the wobbly first tries.',
  'Do a puzzle or play a board game together. If your child gets stuck or loses, stay calm and say: *"That was tricky. Want to try again?"*',

  // ── Connection ──
  'Have a "yes half-hour": for 30 minutes, say yes to whatever your child suggests (as long as it\'s safe).',
  'Look at old photos or videos together. Tell your child a story about when they were little.',
  'Make up a story together, one sentence each, taking turns. See where it goes.',
  'Have a snack or breakfast somewhere unusual — on the floor, on the balcony, in a blanket fort.',
  'Ask your child: *"What\'s your favourite thing we do together?"* Then do it this weekend.',
  'Make a simple "family handshake" together. Use it every morning this week.',
];

// ─── Evening Connection Nudges (25 items, rotating, ages 4–10) ───────────
// Each nudge invites the parent to spend a few minutes with their child and
// gives one small, specific thing to do together.
// Sent Mon–Fri at 6:00 PM in each parent's timezone.
const EVENING_NUDGES = [
  'Spend 5 minutes with your child tonight 🌙 Play *"Two Truths and a Fib"*: each of you says 3 things about your day — one is made up. Guess which! 💛',
  'Sit with your child for a few minutes tonight and ask: *"What\'s one thing you\'re looking forward to tomorrow?"* Then share yours. 🌱',
  'Take 5 minutes with your child before bed tonight 🕵️ Give them a *secret mission* for tomorrow: one kind thing to do for someone without getting caught. Ask how it went at bedtime tomorrow. 💛',
  'Spend dinner time with your child tonight and let them *pick the music* 🎶 Dancing while you set the table is completely allowed.',
  'Sit down with your child at dinner tonight and play *"High, Low, Funny"*: everyone shares the best, the hardest, and the silliest part of their day. 🌙',
  'Spend a few minutes with your child tonight with this question 💛 *"If you could have any superpower for just one day, what would you do with it?"* Then tell them yours.',
  'Spend 10 minutes with your child tonight swapping roles — *your child is the parent, you\'re the child.* Let them tuck you in. Expect giggles. 🌱',
  'Take a quiet moment with your child tonight and ask: *"Who did you sit with today? What did you talk about?"* Small questions open big doors. 💛',
  'Spend 10 minutes with your child tonight building a *blanket fort* 🏕️ Read one book inside it. That\'s the whole plan.',
  'Spend 5 minutes with your child tonight playing *"I Spy" with a twist* 🌙 Use feelings instead of colours: *"I spy someone who looks… sleepy."*',
  'Spend 10 minutes with your child before bath time tonight having a *dance party* 💃 They pick 3 songs, and everyone dances, no matter what. 🌱',
  'Sit with your child at dinner tonight and play *"Would You Rather"*: *"Would you rather talk to animals or fly?"* Take turns asking. 💛',
  'Spend 5 minutes with your child tonight playing *"Back Drawing"* 🌙 Draw a shape or letter on their back with your finger and let them guess. Then swap.',
  'Spend a few minutes with your child at bedtime tonight telling them *one story from when you were their age.* They\'ll ask for it again, guaranteed. 💛',
  'Lie down with your child for 5 minutes tonight and do *"5 Slow Breaths"* together: breathe in like smelling a flower 🌸, out like blowing out a candle 🕯️. Five times. That\'s it.',
  'Spend 10 minutes with your child tonight and ask them to *teach you a game they play at school.* Let them be the expert. 🌱',
  'Sit with your child tonight and ask: *"What was the best moment of your week so far?"* Share yours too — then tell me about it. I\'d love to save it. 💛',
  'Spend dinner time with your child tonight as a *picnic on the living-room floor* 🧺 Same food, new spot, big smiles.',
  'Spend 5 minutes with your child tonight playing *"Guess the Sound"* 🎧 One of you closes your eyes while the other makes a sound with something in the house — a spoon, keys, paper. Take turns. 🌱',
  'Take a moment with your child tonight to tell them *one specific thing you were proud of them for this week* — not just "good job", but exactly what you noticed. 💛',
  'Spend 5 minutes with your child tonight on a *"you-choose"*: they pick what you do together, and you say yes. 🌱',
  'Spend a moment with your child tonight choosing *one word that describes them* — brave, funny, kind. Write it on a sticky note and put it on their pillow together. 💛',
  'Spend a few minutes with your child at bedtime tonight and ask: *"What\'s one thing that made you smile today?"* End the day on a good note. 🌙',
  'Spend 10 minutes with your child tonight making up a *silly bedtime story*: you start a sentence, they finish it. Keep going until someone laughs too hard. 🌱',
  'Spend 5 minutes with your child tonight at the window spotting *3 things in the sky*: stars, the moon, a plane, a funny-shaped cloud. ✨',
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
