/**
 * Rootie — Moment Handler Service
 *
 * Handles the full moment logging flow:
 *   1. Identify which child the moment is about
 *   2. Log the moment to the database
 *   3. Return a warm template response
 *
 * Child identification logic:
 *   - If classifier detected a child_name → find that child in DB
 *   - If only one child → use that child automatically
 *   - If multiple children and no name detected → return child_unclear template
 *     (this case is handled upstream in webhook.js)
 */

const { getChildByName,
        getChildrenByUserId } = require('./childService');
const { logMoment }           = require('./momentService');
const { getTemplateResponse } = require('./templateService');
const { logger }              = require('../utils/logger');

/**
 * Handle a classified moment_log message.
 *
 * @param {object} user        — full user row
 * @param {array}  children    — all children for this user
 * @param {object} classified  — classifier output
 * @param {string} rawMessage  — original parent message
 * @returns {string} reply to send
 */
async function handleMomentLog(user, children, classified, rawMessage) {
  try {
    let child = null;

    // Try to identify the child
    if (classified.child_name) {
      child = await getChildByName(user.user_id, classified.child_name);
    }

    // If still no child and only one child exists, use that one
    if (!child && children.length === 1) {
      child = children[0];
    }

    // If multiple children and still no match — ask which child
    if (!child && children.length > 1) {
      return getTemplateResponse('child_unclear');
    }

    // Log the moment
    const category = classified.moment_category || 'kindness';
    const summary  = `${classified.child_name || (child?.child_name || 'child')} showed ${category}`;

    await logMoment({
      userId:          user.user_id,
      childId:         child?.child_id || null,
      category,
      summary,
      rawMessage,
      confidenceScore: classified.confidence_score,
    });

    logger.info('Moment logged', {
      userId:   user.user_id,
      childId:  child?.child_id,
      category,
    });

    // Return warm template response
    return getTemplateResponse('moment_logged', {
      childName: child?.child_name || classified.child_name || null,
      category,
    });

  } catch (err) {
    logger.error('Moment handler failed', { error: err.message });
    return `That sounds like a beautiful moment 🌱 I've noted it in your child's Kind Roots journey. 💛`;
  }
}

module.exports = { handleMomentLog };
