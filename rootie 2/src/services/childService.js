/**
 * Rootie — Child Service
 *
 * Manages the children table. Each parent can have multiple children.
 * Child records form the "Child Personality Blueprint" used in AI prompts.
 */

const { query } = require('../db/database');

// ─── Create a child record ────────────────────────────────────────────────
async function createChild(userId, { childName, childAge, temperament, sensitivityLevel, socialStyle, strengths, challenges }) {
  const result = await query(
    `INSERT INTO children
       (user_id, child_name, child_age, temperament, sensitivity_level, social_style, strengths, challenges)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING *`,
    [userId, childName, childAge || null, temperament || null,
     sensitivityLevel || null, socialStyle || null, strengths || null, challenges || null]
  );
  return result.rows[0];
}

// ─── Get all children for a user ──────────────────────────────────────────
async function getChildrenByUserId(userId) {
  const result = await query(
    `SELECT * FROM children WHERE user_id = $1 ORDER BY created_at ASC`,
    [userId]
  );
  return result.rows;
}

// ─── Get a single child by name (case-insensitive) ────────────────────────
async function getChildByName(userId, childName) {
  const result = await query(
    `SELECT * FROM children
     WHERE user_id = $1 AND LOWER(child_name) = LOWER($2) LIMIT 1`,
    [userId, childName]
  );
  return result.rows[0] || null;
}

// ─── Get a child by ID ────────────────────────────────────────────────────
async function getChildById(childId) {
  const result = await query(
    `SELECT * FROM children WHERE child_id = $1 LIMIT 1`,
    [childId]
  );
  return result.rows[0] || null;
}

// ─── Update child fields ──────────────────────────────────────────────────
async function updateChild(childId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return null;
  const setClause = keys.map((k, i) => `${k} = $${i + 2}`).join(', ');
  const values    = keys.map(k => fields[k]);
  const result = await query(
    `UPDATE children SET ${setClause} WHERE child_id = $1 RETURNING *`,
    [childId, ...values]
  );
  return result.rows[0] || null;
}

// ─── Build a compact profile string for AI prompts ───────────────────────
// Returns a short text summary of a child's personality blueprint.
function buildChildProfile(child) {
  const parts = [`${child.child_name} (age ${child.child_age || '?'})`];
  if (child.temperament)       parts.push(`temperament: ${child.temperament}`);
  if (child.sensitivity_level) parts.push(`sensitivity: ${child.sensitivity_level}`);
  if (child.social_style)      parts.push(`social style: ${child.social_style}`);
  if (child.strengths)         parts.push(`strengths: ${child.strengths}`);
  if (child.challenges)        parts.push(`challenges: ${child.challenges}`);
  return parts.join(', ');
}

module.exports = {
  createChild,
  getChildrenByUserId,
  getChildByName,
  getChildById,
  updateChild,
  buildChildProfile,
};
