/**
 * Rootie — Usage Tracking Service
 *
 * Tracks daily usage per user for free-plan limits.
 *
 * Free plan limits:
 *   - 1 parenting question per day
 *   - Unlimited moment logging
 *   - Daily prompts + weekly activities (always free)
 *
 * Paid plan (Rootie Plus):
 *   - Unlimited parenting questions
 *   - Personalised guidance using Child Personality Blueprint
 *   - Monthly growth reports
 *   - Pattern detection
 */

const { query } = require('../db/database');

const FREE_QUESTION_LIMIT = parseInt(process.env.FREE_QUESTION_LIMIT || '1', 10);

// ─── Get or create today's usage row ─────────────────────────────────────
async function getTodayUsage(userId) {
  const today = new Date().toISOString().slice(0, 10);
  const result = await query(
    `INSERT INTO usage_tracking (user_id, date, questions_used, moments_logged, messages_sent, hit_limit_count)
     VALUES ($1, $2, 0, 0, 0, 0)
     ON CONFLICT (user_id, date) DO UPDATE SET messages_sent = usage_tracking.messages_sent
     RETURNING *`,
    [userId, today]
  );
  return result.rows[0];
}

// ─── Check if a free-plan user can ask a parenting question ──────────────
async function canAskQuestion(user) {
  if (user.plan_type === 'paid') return { allowed: true };
  const usage = await getTodayUsage(user.user_id);
  if (usage.questions_used >= FREE_QUESTION_LIMIT) {
    return { allowed: false };
  }
  return { allowed: true };
}

// ─── Increment question count ─────────────────────────────────────────────
async function incrementQuestions(userId) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO usage_tracking (user_id, date, questions_used, moments_logged, messages_sent, hit_limit_count)
     VALUES ($1, $2, 1, 0, 0, 0)
     ON CONFLICT (user_id, date) DO UPDATE
       SET questions_used = usage_tracking.questions_used + 1`,
    [userId, today]
  );
}

// ─── Increment moment count ───────────────────────────────────────────────
async function incrementMoments(userId) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO usage_tracking (user_id, date, moments_logged, questions_used, messages_sent, hit_limit_count)
     VALUES ($1, $2, 1, 0, 0, 0)
     ON CONFLICT (user_id, date) DO UPDATE
       SET moments_logged = usage_tracking.moments_logged + 1`,
    [userId, today]
  );
}

// ─── Increment total messages sent ───────────────────────────────────────
async function incrementMessages(userId) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO usage_tracking (user_id, date, messages_sent, questions_used, moments_logged, hit_limit_count)
     VALUES ($1, $2, 1, 0, 0, 0)
     ON CONFLICT (user_id, date) DO UPDATE
       SET messages_sent = usage_tracking.messages_sent + 1`,
    [userId, today]
  );
}

// ─── Increment hit_limit_count (free user tried to ask but was blocked) ──
// This is the clearest paid-conversion signal: a parent who hits the limit
// multiple times in a week is actively wanting more than the free plan offers.
async function incrementHitLimit(userId) {
  const today = new Date().toISOString().slice(0, 10);
  await query(
    `INSERT INTO usage_tracking (user_id, date, questions_used, moments_logged, messages_sent, hit_limit_count)
     VALUES ($1, $2, 0, 0, 0, 1)
     ON CONFLICT (user_id, date) DO UPDATE
       SET hit_limit_count = usage_tracking.hit_limit_count + 1`,
    [userId, today]
  );
}

// ─── Get usage stats for a user (last N days) ────────────────────────────
async function getUsageStats(userId, days = 7) {
  const result = await query(
    `SELECT date, questions_used, moments_logged, messages_sent, hit_limit_count
     FROM usage_tracking
     WHERE user_id = $1 AND date >= CURRENT_DATE - ($2 || ' days')::INTERVAL
     ORDER BY date DESC`,
    [userId, String(days)]
  );
  return result.rows;
}

module.exports = {
  getTodayUsage,
  canAskQuestion,
  incrementQuestions,
  incrementMoments,
  incrementMessages,
  incrementHitLimit,
  getUsageStats,
  FREE_QUESTION_LIMIT,
};
