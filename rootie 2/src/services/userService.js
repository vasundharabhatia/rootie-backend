/**
 * Rootie — User Service
 *
 * All database operations for parent (user) records.
 * WhatsApp number is the primary identity key.
 */

const { query } = require('../db/database');

// ─── Get or create a user by WhatsApp number ──────────────────────────────
async function getOrCreateUser(whatsappNumber) {
  const result = await query(
    `INSERT INTO users (whatsapp_number, onboarding_step, onboarding_complete, plan_type, created_at, updated_at)
     VALUES ($1, 0, false, 'free', NOW(), NOW())
     ON CONFLICT (whatsapp_number) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [whatsappNumber]
  );
  return result.rows[0];
}

// ─── Fetch a user by WhatsApp number ──────────────────────────────────────
async function getUserByPhone(whatsappNumber) {
  const result = await query(
    'SELECT * FROM users WHERE whatsapp_number = $1 LIMIT 1',
    [whatsappNumber]
  );
  return result.rows[0] || null;
}

// ─── Update user fields ────────────────────────────────────────────────────
async function updateUser(whatsappNumber, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values    = keys.map(k => fields[k]);
  const result = await query(
    `UPDATE users SET ${setClause}, updated_at = NOW()
     WHERE whatsapp_number = $1 RETURNING *`,
    [whatsappNumber, ...values]
  );
  return result.rows[0] || null;
}

// ─── Get all fully onboarded users (for schedulers) ───────────────────────
async function getOnboardedUsers() {
  const result = await query(
    `SELECT * FROM users WHERE onboarding_complete = true`
  );
  return result.rows;
}

// ─── Update last_active_date to today ───────────────────────────────────────────────
async function updateLastActive(userId) {
  await query(
    `UPDATE users SET last_active_date = CURRENT_DATE, updated_at = NOW()
     WHERE user_id = $1`,
    [userId]
  );
}

// ─── Get user by numeric ID ───────────────────────────────────────────────
async function getUserById(userId) {
  const result = await query(
    `SELECT * FROM users WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

// ─── Get all users (admin) ─────────────────────────────────────────────────────
async function getAllUsers({ limit = 50, offset = 0 } = {}) {
  const result = await query(
    `SELECT user_id, whatsapp_number, parent_name, plan_type,
            onboarding_complete, onboarding_step, last_active_date, created_at
     FROM users ORDER BY created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset]
  );
  return result.rows;
}

module.exports = {
  getOrCreateUser,
  getUserByPhone,
  getUserById,
  updateUser,
  getOnboardedUsers,
  updateLastActive,
  getAllUsers,
};
