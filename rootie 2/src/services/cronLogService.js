/**
 * Rootie — Cron Log Service
 *
 * Writes diagnostic records to the cron_logs table on every scheduler fire.
 * Logging is automatically disabled after a configurable window (default 4 hours)
 * from the time the server started, to avoid filling the DB with noise.
 */

const { query } = require('../db/database');
const { logger } = require('../utils/logger');

// ─── Logging window ────────────────────────────────────────────────────────
// Log cron fires for this many milliseconds after server start.
const LOG_WINDOW_MS = 4 * 60 * 60 * 1000; // 4 hours
const LOG_START     = Date.now();

/**
 * Returns true if we are still within the 4-hour diagnostic window.
 */
function isLoggingActive() {
  return (Date.now() - LOG_START) < LOG_WINDOW_MS;
}

/**
 * Write one row to cron_logs for a job fire.
 *
 * @param {object} params
 * @param {string}   params.jobName      - e.g. 'evening_nudge'
 * @param {string}   params.utcTime      - ISO string of when the cron fired
 * @param {number}   params.totalUsers   - total onboarded users checked
 * @param {number}   params.matched      - users that matched the target day/hour
 * @param {number}   [params.sent]       - messages successfully sent (null if skipped)
 * @param {number}   [params.failed]     - messages that failed (null if skipped)
 * @param {Array}    [params.userDetails]- per-user diagnostic array from buildUserDiagnostics()
 * @param {string}   [params.notes]      - any extra context (e.g. error message)
 */
async function writeCronLog({ jobName, utcTime, totalUsers, matched, sent = null, failed = null, userDetails = [], notes = null }) {
  if (!isLoggingActive()) return; // silent no-op after 4 hours

  try {
    await query(
      `INSERT INTO cron_logs (job_name, utc_time, total_users, matched, sent, failed, user_details, notes)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [jobName, utcTime, totalUsers, matched, sent, failed, JSON.stringify(userDetails), notes]
    );
  } catch (err) {
    // Never let a logging failure crash the scheduler
    logger.error('Failed to write cron log', { jobName, error: err.message });
  }
}

/**
 * Fetch recent cron log entries (newest first).
 * @param {number} limit - max rows to return (default 100)
 */
async function getCronLogs(limit = 100) {
  const result = await query(
    `SELECT log_id, fired_at, job_name, utc_time, total_users, matched, sent, failed, user_details, notes
     FROM cron_logs
     ORDER BY fired_at DESC
     LIMIT $1`,
    [limit]
  );
  return result.rows;
}

/**
 * Returns how many minutes of the 4-hour logging window remain.
 * Returns 0 if the window has expired.
 */
function minutesRemaining() {
  const elapsed = Date.now() - LOG_START;
  const remaining = LOG_WINDOW_MS - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 60000) : 0;
}

module.exports = { writeCronLog, getCronLogs, isLoggingActive, minutesRemaining };
