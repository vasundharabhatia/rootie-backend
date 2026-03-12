/**
 * Rootie — Flow Session Service
 *
 * Stores multi-step conversational flows in Postgres so they survive restarts.
 * Used for:
 *   - profile updates
 *   - family management
 *   - reminder / timezone updates
 */

const { query }  = require('../db/database');
const { logger } = require('../utils/logger');

async function setFlowSession(userId, flowType, step, data = {}, expiresInHours = 24) {
  const result = await query(
    `
      INSERT INTO user_flow_sessions (user_id, flow_type, step, data, expires_at, updated_at)
      VALUES ($1, $2, $3, $4::jsonb, NOW() + ($5 || ' hours')::interval, NOW())
      ON CONFLICT (user_id)
      DO UPDATE SET
        flow_type   = EXCLUDED.flow_type,
        step        = EXCLUDED.step,
        data        = EXCLUDED.data,
        expires_at  = EXCLUDED.expires_at,
        updated_at  = NOW()
      RETURNING *
    `,
    [userId, flowType, step, JSON.stringify(data), String(expiresInHours)]
  );

  logger.info('Flow session saved', { userId, flowType, step });
  return result.rows[0];
}

async function getFlowSession(userId) {
  const result = await query(
    `
      SELECT *
      FROM user_flow_sessions
      WHERE user_id = $1
      LIMIT 1
    `,
    [userId]
  );

  const session = result.rows[0] || null;
  if (!session) return null;

  if (session.expires_at && new Date(session.expires_at) < new Date()) {
    await clearFlowSession(userId);
    logger.info('Expired flow session cleared', { userId, flowType: session.flow_type });
    return null;
  }

  return session;
}

async function clearFlowSession(userId) {
  await query(
    `DELETE FROM user_flow_sessions WHERE user_id = $1`,
    [userId]
  );
}

module.exports = {
  setFlowSession,
  getFlowSession,
  clearFlowSession,
};
