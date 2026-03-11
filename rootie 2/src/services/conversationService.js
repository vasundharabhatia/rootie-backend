/**
 * Rootie — Conversation Service
 *
 * Stores and retrieves recent message history.
 * Only the most recent N messages are kept per user — older ones are pruned.
 * The full history is never sent to OpenAI; only the last 3–5 messages are used.
 */

const { query } = require('../db/database');

const KEEP_MESSAGES = parseInt(process.env.KEEP_MESSAGES || '30', 10);

// ─── Save a message ───────────────────────────────────────────────────────
async function saveMessage(userId, role, messageText, waMessageId = null) {
  await query(
    `INSERT INTO conversations (user_id, role, message_text, wa_message_id)
     VALUES ($1, $2, $3, $4)`,
    [userId, role, messageText, waMessageId]
  );
  // Prune old messages for this user — keep only the most recent KEEP_MESSAGES
  await query(
    `DELETE FROM conversations
     WHERE user_id = $1
       AND message_id NOT IN (
         SELECT message_id FROM conversations
         WHERE user_id = $1
         ORDER BY created_at DESC
         LIMIT $2
       )`,
    [userId, KEEP_MESSAGES]
  );
}

// ─── Check if a message was already processed (deduplication) ────────────
async function isAlreadyProcessed(waMessageId) {
  if (!waMessageId) return false;
  const result = await query(
    `SELECT 1 FROM conversations WHERE wa_message_id = $1 LIMIT 1`,
    [waMessageId]
  );
  return result.rows.length > 0;
}

// ─── Get recent messages for AI context ──────────────────────────────────
// Returns the last N messages in chronological order (oldest first).
async function getRecentMessages(userId, limit = 5) {
  const result = await query(
    `SELECT role, message_text FROM (
       SELECT role, message_text, created_at
       FROM conversations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2
     ) sub
     ORDER BY created_at ASC`,
    [userId, limit]
  );
  return result.rows; // [{ role: 'user', message_text: '...' }, ...]
}

// ─── Get full recent history (for admin view) ─────────────────────────────
async function getFullHistory(userId, limit = 30) {
  const result = await query(
    `SELECT role, message_text, created_at
     FROM conversations
     WHERE user_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [userId, limit]
  );
  return result.rows;
}

module.exports = {
  saveMessage,
  isAlreadyProcessed,
  getRecentMessages,
  getFullHistory,
};
