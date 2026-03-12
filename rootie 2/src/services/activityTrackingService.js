/**
 * Rootie — Weekend Activity Tracking Service
 *
 * Handles the full lifecycle of the weekend activity feature:
 *   1. Records when an activity is sent to a user.
 *   2. Finds users who need a follow-up message on Monday morning.
 *   3. Processes user replies to the follow-up, marks activities as complete or skipped.
 *   4. Increments the user's completion counter only when completed = true.
 *   5. Checks for and grants creative "Connection Awards" at milestones.
 */

const { query }  = require("../db/database");
const { logger } = require("../utils/logger");

// --- Award Milestone Definitions ---
const AWARD_MILESTONES = {
  3:  { name: "The Spark Starter", template: "award_milestone_3" },
  6:  { name: "The Bridge Builder", template: "award_milestone_6" },
  9:  { name: "The Heart Weaver", template: "award_milestone_9" },
  12: { name: "The Memory Maker", template: "award_milestone_12" },
  15: { name: "The Connection Captain", template: "award_milestone_15" },
};

/**
 * Records that a weekend activity was sent to a user.
 * @param {number} userId
 * @param {string} activityText
 */
async function recordActivitySent(userId, activityText) {
  await query(
    `INSERT INTO weekend_activities (user_id, activity_text) VALUES ($1, $2)`,
    [userId, activityText]
  );
  logger.info("Weekend activity sent and recorded", { userId });
}

/**
 * Gets all users who were sent an activity over the weekend (Fri-Sun)
 * and have not yet received a follow-up message.
 * @returns {Promise<Array<{user_id: number, whatsapp_number: string, activity_id: number}>>}
 */
async function getUsersForMondayFollowup() {
  const result = await query(`
    SELECT u.user_id, u.whatsapp_number, wa.activity_id
    FROM users u
    JOIN weekend_activities wa ON u.user_id = wa.user_id
    WHERE wa.sent_at >= date_trunc('week', current_date) - interval '2 days'
      AND wa.sent_at < date_trunc('week', current_date) + interval '1 day'
      AND wa.followup_sent_at IS NULL
      AND u.onboarding_complete = true
  `);
  return result.rows;
}

/**
 * Marks that a follow-up message has been sent for a specific activity.
 * @param {number} activityId
 */
async function markFollowupSent(activityId) {
  await query(
    `UPDATE weekend_activities SET followup_sent_at = NOW() WHERE activity_id = $1`,
    [activityId]
  );
}

/**
 * Handles a user's confirmation that they completed OR skipped a weekend activity.
 *
 * @param {number} userId
 * @param {boolean} activityDone
 * @returns {Promise<{reply_template: string, award_name: string|null}>}
 */
async function handleActivityCompletion(userId, activityDone) {
  // Find the most recent activity for this user that has not yet been resolved.
  const activityRes = await query(
    `SELECT activity_id
     FROM weekend_activities
     WHERE user_id = $1
       AND completed = false
       AND completed_at IS NULL
     ORDER BY sent_at DESC
     LIMIT 1`,
    [userId]
  );

  if (activityRes.rows.length === 0) {
    logger.warn("Activity reply received but no pending activity found", { userId, activityDone });
    return { reply_template: 'general_returning_user', award_name: null };
  }

  const { activity_id } = activityRes.rows[0];

  // Parent said NO / didn't do it
  if (activityDone === false) {
    await query(
      `UPDATE weekend_activities
       SET completed = false,
           completed_at = NOW()
       WHERE activity_id = $1`,
      [activity_id]
    );

    logger.info("Weekend activity marked as skipped", { userId, activity_id });

    return { reply_template: 'weekend_activity_skipped', award_name: null };
  }

  // Parent said YES / did it
  await query(
    `UPDATE weekend_activities
     SET completed = true,
         completed_at = NOW()
     WHERE activity_id = $1`,
    [activity_id]
  );

  const userRes = await query(
    `UPDATE users
     SET activities_completed = activities_completed + 1
     WHERE user_id = $1
     RETURNING activities_completed, last_award_milestone`,
    [userId]
  );

  const { activities_completed, last_award_milestone } = userRes.rows[0];

  logger.info("Weekend activity marked as complete", {
    userId,
    activity_id,
    total_completed: activities_completed,
  });

  const award = AWARD_MILESTONES[activities_completed];
  if (award && activities_completed > last_award_milestone) {
    await query(
      `UPDATE users SET last_award_milestone = $1 WHERE user_id = $2`,
      [activities_completed, userId]
    );

    logger.info("Connection Award granted!", {
      userId,
      milestone: activities_completed,
      award: award.name,
    });

    return { reply_template: award.template, award_name: award.name };
  }

  return { reply_template: 'weekend_activity_confirmed', award_name: null };
}

module.exports = {
  recordActivitySent,
  getUsersForMondayFollowup,
  markFollowupSent,
  handleActivityCompletion,
};
