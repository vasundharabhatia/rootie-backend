/**
 * Rootie — Pending Action Service
 *
 * Persists short-lived conversational state that must survive restarts/deploys.
 * Current use case:
 *   - Rootie asked which child a moment belongs to
 *   - Parent replies later with a number or child name
 */

const { query } = require('../db/database');
const { logger } = require('../utils/logger');

async function setPendingAction(userId, actionType, payload = {}, expiresInMinutes = 30) {
  const result = await query(
    `
      INSERT INTO pending_parent_actions (user_id, action_type, payload, expires_at)
      VALUES ($1, $2, $3::jsonb, NOW() + ($4 || ' minutes')::interval)
      ON CONFLICT (user_id)
      DO UPDATE SET
        action_type = EXCLUDED.action_type,
        payload = EXCLUDED.payload,
        expires_at = EXCLUDED.expires_at,
        created_at = NOW()
      RETURNING *
    `,
    [userId, actionType, JSON.stringify(payload), String(expiresInMinutes)]
  );

  logger.info('Pending action saved', { userId, actionType });
  return result.rows[0];
}

async function getPendingAction(userId) {
  const result = await query(
    `
      SELECT *
      FROM pending_parent_actions
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  const action = result.rows[0] || null;
  if (!action) return null;

  if (action.expires_at && new Date(action.expires_at) < new Date()) {
    await clearPendingAction(userId);
    logger.info('Expired pending action cleared', { userId, actionType: action.action_type });
    return null;
  }

  return action;
}

async function clearPendingAction(userId) {
  await query(
    `DELETE FROM pending_parent_actions WHERE user_id = $1`,
    [userId]
  );
}

module.exports = {
  setPendingAction,
  getPendingAction,
  clearPendingAction,
};
