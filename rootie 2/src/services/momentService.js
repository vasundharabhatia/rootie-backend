/**
 * Rootie — Moment Service
 *
 * Logs positive child behaviors (moments) and aggregates them for growth reports.
 *
 * Moment categories:
 *   kindness | empathy | resilience | confidence |
 *   emotional_expression | curiosity | responsibility
 */

const { query } = require('../db/database');

// ─── Log a moment ─────────────────────────────────────────────────────────
async function logMoment({ userId, childId, category, summary, rawMessage, confidenceScore }) {
  const result = await query(
    `INSERT INTO moments (user_id, child_id, category, summary, raw_parent_message, confidence_score)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [userId, childId || null, category, summary || null, rawMessage, confidenceScore || null]
  );
  return result.rows[0];
}

// ─── Get moments for a child ──────────────────────────────────────────────
async function getMomentsForChild(childId, { limit = 50 } = {}) {
  const result = await query(
    `SELECT * FROM moments WHERE child_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [childId, limit]
  );
  return result.rows;
}

// ─── Aggregate moment counts by category (for growth reports) ────────────
async function aggregateMoments(childId) {
  const result = await query(
    `SELECT category, COUNT(*) AS count
     FROM moments
     WHERE child_id = $1
     GROUP BY category
     ORDER BY count DESC`,
    [childId]
  );
  return result.rows; // [{ category: 'kindness', count: '9' }, ...]
}

// ─── Get recent moments for a user (all children) ────────────────────────
async function getRecentMomentsByUser(userId, { limit = 20 } = {}) {
  const result = await query(
    `SELECT m.*, c.child_name
     FROM moments m
     LEFT JOIN children c ON m.child_id = c.child_id
     WHERE m.user_id = $1
     ORDER BY m.created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

// ─── Count moments logged today for a user ────────────────────────────────
async function countMomentsToday(userId) {
  const result = await query(
    `SELECT COUNT(*) AS n FROM moments
     WHERE user_id = $1 AND created_at >= CURRENT_DATE`,
    [userId]
  );
  return parseInt(result.rows[0].n, 10);
}

module.exports = {
  logMoment,
  getMomentsForChild,
  aggregateMoments,
  getRecentMomentsByUser,
  countMomentsToday,
};
