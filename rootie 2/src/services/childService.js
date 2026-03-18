/**
 * Rootie — Child Service
 *
 * Manages the children table. Each parent can have multiple children.
 * Child records form the "Child Personality Blueprint" used in AI prompts.
 *
 * Birthday fields (v2):
 *   child_dob   — full date (DATE), stored when parent shares a complete birthday
 *   birth_year  — year only (SMALLINT), stored when parent only shares year
 *   child_age   — derived integer, kept in sync for backward compatibility
 *                 and for fast AI prompt building without recalculation
 */

const { query }                        = require('../db/database');
const { deriveAge, formatBirthdayDisplay } = require('./birthdayService');

function normalizeChildName(name) {
  return (name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

// ─── Create a child record ────────────────────────────────────────────────
async function createChild(userId, {
  childName,
  childAge,
  childDob,        // ISO date string e.g. "2019-03-12"  (optional)
  birthYear,       // integer e.g. 2019                  (optional)
  temperament,
  sensitivityLevel,
  socialStyle,
  strengths,
  challenges
}) {
  const duplicate = await findPotentialDuplicateChild(userId, childName);

  if (duplicate) {
    const error = new Error('Duplicate child name detected');
    error.code = 'DUPLICATE_CHILD';
    error.child = duplicate;
    throw error;
  }

  const result = await query(
    `INSERT INTO children
       (user_id, child_name, child_age, child_dob, birth_year,
        temperament, sensitivity_level, social_style, strengths, challenges)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      userId,
      childName.trim(),
      childAge   || null,
      childDob   || null,
      birthYear  || null,
      temperament    || null,
      sensitivityLevel || null,
      socialStyle    || null,
      strengths      || null,
      challenges     || null,
    ]
  );
  return result.rows[0];
}

// ─── Get all children for a user ──────────────────────────────────────────
// By default returns only active (non-archived) children.
async function getChildrenByUserId(userId, { includeArchived = false } = {}) {
  const result = await query(
    `SELECT *
     FROM children
     WHERE user_id = $1
       AND ($2::boolean = true OR is_archived = false)
     ORDER BY created_at ASC`,
    [userId, includeArchived]
  );
  return result.rows;
}

// ─── Get a single child by name (case-insensitive) ────────────────────────
async function getChildByName(userId, childName, { includeArchived = false } = {}) {
  const result = await query(
    `SELECT *
     FROM children
     WHERE user_id = $1
       AND LOWER(TRIM(child_name)) = LOWER(TRIM($2))
       AND ($3::boolean = true OR is_archived = false)
     LIMIT 1`,
    [userId, childName, includeArchived]
  );
  return result.rows[0] || null;
}

// ─── Find a likely duplicate child by normalized name ─────────────────────
async function findPotentialDuplicateChild(userId, childName, { excludeChildId = null } = {}) {
  const children = await getChildrenByUserId(userId);
  const target = normalizeChildName(childName);

  return (
    children.find(child => {
      if (excludeChildId && child.child_id === excludeChildId) return false;
      return normalizeChildName(child.child_name) === target;
    }) || null
  );
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
  const values = keys.map(k => fields[k]);

  const result = await query(
    `UPDATE children
     SET ${setClause}
     WHERE child_id = $1
     RETURNING *`,
    [childId, ...values]
  );

  return result.rows[0] || null;
}

// ─── Safe rename child with duplicate protection ──────────────────────────
async function renameChild(userId, childId, newChildName) {
  const duplicate = await findPotentialDuplicateChild(userId, newChildName, {
    excludeChildId: childId,
  });

  if (duplicate) {
    const error = new Error('Duplicate child name detected');
    error.code = 'DUPLICATE_CHILD';
    error.child = duplicate;
    throw error;
  }

  return updateChild(childId, { child_name: newChildName.trim() });
}

// ─── Archive a child ──────────────────────────────────────────────────────
async function archiveChild(childId) {
  const result = await query(
    `UPDATE children
     SET is_archived = true,
         archived_at = NOW()
     WHERE child_id = $1
       AND is_archived = false
     RETURNING *`,
    [childId]
  );
  return result.rows[0] || null;
}

// ─── Build a compact profile string for AI prompts ───────────────────────
// Uses the most accurate age available (dob → birth_year → child_age).
function buildChildProfile(child) {
  const age = deriveAge(child);
  const parts = [`${child.child_name} (age ${age ?? '?'})`];
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
  findPotentialDuplicateChild,
  getChildById,
  updateChild,
  renameChild,
  archiveChild,
  buildChildProfile,
  normalizeChildName,
};
