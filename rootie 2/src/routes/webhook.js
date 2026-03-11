/**
 * Rootie — WhatsApp Webhook Route
 *
 * GET  /webhook  — Meta verification handshake
 * POST /webhook  — Every inbound WhatsApp message
 *
 * Message pipeline (POST):
 *   1.  Verify Meta signature
 *   2.  Parse payload → phone, text, messageId
 *   3.  Deduplicate
 *   4.  Send read receipt
 *   5.  Get or create user
 *   6.  Handle non-text messages
 *   7.  Route:
 *       a. Onboarding (not complete) → onboardingService
 *       b. Safety check             → safetyService
 *       c. Step 1: Classify message → classifierService
 *       d. Route by message_type:
 *          - moment_log             → log moment, send template reply
 *          - child_selection_needed → ask which child
 *          - parenting_question     → check plan limit → Step 2 AI
 *          - general / other        → Step 2 AI (if needed) or template
 *   8.  Save conversation, update usage
 */

const express = require('express');
const router  = express.Router();

const { logger }              = require('../utils/logger');
const { parseInbound,
        sendMessage,
        markAsRead,
        verifySignature }     = require('../services/whatsappService');
const { getOrCreateUser,
        getUserByPhone,
        updateLastActive }    = require('../services/userService');
const { getChildrenByUserId,
        getChildByName }      = require('../services/childService');
const { handleOnboarding }    = require('../services/onboardingService');
const { classifyMessage }     = require('../services/classifierService');
const { getTemplateResponse } = require('../services/templateService');
const { handleMomentLog }     = require('../services/momentHandlerService');
const { askGPT }              = require('../services/gptService');
const { canAskQuestion,
        incrementQuestions,
        incrementMessages,
        incrementMoments,
        incrementHitLimit }   = require('../services/usageService');
const { saveMessage,
        isAlreadyProcessed }  = require('../services/conversationService');
const { checkSafety }         = require('../services/safetyService');

// ─── GET /webhook — Meta verification ─────────────────────────────────────
router.get('/', (req, res) => {
  const mode      = req.query['hub.mode'];
  const token     = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    logger.info('Webhook verified by Meta');
    return res.status(200).send(challenge);
  }
  logger.warn('Webhook verification failed', { token });
  res.status(403).send('Forbidden');
});

// ─── POST /webhook — Inbound messages ─────────────────────────────────────
router.post('/', async (req, res) => {
  // Respond 200 immediately — Meta retries if it doesn't get one fast
  res.status(200).send('EVENT_RECEIVED');

  // Verify signature
  if (process.env.SKIP_WEBHOOK_AUTH !== 'true') {
    const valid = verifySignature(req.rawBody, req.headers['x-hub-signature-256']);
    if (!valid) {
      logger.warn('Invalid Meta signature — request dropped');
      return;
    }
  }

  try {
    const parsed = parseInbound(req.body);
    if (!parsed) return;

    const { phoneNumber, messageId, messageType, messageText, displayName } = parsed;

    // Deduplicate
    if (await isAlreadyProcessed(messageId)) {
      logger.info('Duplicate message ignored', { messageId });
      return;
    }

    // Read receipt
    await markAsRead(messageId);

    // Handle non-text messages
    if (messageType !== 'text' || !messageText) {
      await sendMessage(phoneNumber, getTemplateResponse('non_text'));
      return;
    }

    logger.info('Inbound message', { from: phoneNumber, preview: messageText.substring(0, 60) });

    // Get or create user, then update last_active_date
    const user = await getOrCreateUser(phoneNumber);
    // Fire-and-forget — don't block the pipeline
    updateLastActive(user.user_id).catch(err =>
      logger.warn('Failed to update last_active_date', { error: err.message })
    );

    // ── Onboarding ──────────────────────────────────────────────────────────
    if (!user.onboarding_complete) {
      const reply = await handleOnboarding(user, messageText, displayName);
      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'user',      messageText, messageId);
      await saveMessage(user.user_id, 'assistant', reply,       null);
      await incrementMessages(user.user_id);
      return;
    }

    // ── Safety check ────────────────────────────────────────────────────────
    const safety = checkSafety(messageText);
    if (safety.escalate) {
      await sendMessage(phoneNumber, safety.response);
      await saveMessage(user.user_id, 'user',      messageText,     messageId);
      await saveMessage(user.user_id, 'assistant', safety.response, null);
      return;
    }

    // ── UPGRADE keyword intercept ───────────────────────────────────────────
    // Catch "upgrade", "UPGRADE", "Upgrade" etc. before the classifier.
    // Log the intent (hit_limit_count acts as a proxy) and send coming-soon message.
    if (/^upgrade$/i.test(messageText.trim())) {
      const upgradeReply = getTemplateResponse('upgrade_coming_soon');
      await sendMessage(phoneNumber, upgradeReply);
      await saveMessage(user.user_id, 'user',      messageText,   messageId);
      await saveMessage(user.user_id, 'assistant', upgradeReply,  null);
      // Reuse hit_limit_count as an upgrade-intent signal
      await incrementHitLimit(user.user_id);
      logger.info('Upgrade intent captured', { phone: phoneNumber });
      return;
    }

    // ── Step 1: Classify the message ────────────────────────────────────────
    const children    = await getChildrenByUserId(user.user_id);
    const freshUser   = await getUserByPhone(phoneNumber);
    const classified  = await classifyMessage(messageText, children);

    logger.info('Message classified', {
      type: classified.message_type,
      needs_full_ai: classified.needs_full_ai,
      confidence: classified.confidence_score,
    });

    // ── Route by message type ───────────────────────────────────────────────

    // A) Moment log — no AI needed
    if (classified.message_type === 'moment_log' && !classified.needs_full_ai) {
      const reply = await handleMomentLog(freshUser, children, classified, messageText);
      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'user',      messageText, messageId);
      await saveMessage(user.user_id, 'assistant', reply,       null);
      await incrementMoments(user.user_id);
      await incrementMessages(user.user_id);
      return;
    }

    // B) Child unclear — ask which child
    if (classified.message_type === 'child_selection_needed') {
      const reply = getTemplateResponse('child_unclear');
      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'user',      messageText, messageId);
      await saveMessage(user.user_id, 'assistant', reply,       null);
      return;
    }

    // C) Parenting question or anything needing full AI
    if (classified.message_type === 'parenting_question' || classified.needs_full_ai) {
      // Check free plan limit
      const access = await canAskQuestion(freshUser);
      if (!access.allowed) {
        const limitReply = getTemplateResponse('free_limit_reached');
        await sendMessage(phoneNumber, limitReply);
        await saveMessage(user.user_id, 'user',        messageText, messageId);
        await saveMessage(user.user_id, 'assistant',   limitReply,  null);
        // Track that this parent hit the limit — key paid-conversion signal
        await incrementHitLimit(user.user_id);
        return;
      }

      // Step 2: Full AI response
      await saveMessage(user.user_id, 'user', messageText, messageId);
      const reply = await askGPT(freshUser, children, messageText);
      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'assistant', reply, null);
      await incrementQuestions(user.user_id);
      await incrementMessages(user.user_id);
      return;
    }

    // D) General / daily_prompt_response / bonding_activity_response
    // Use template if available, otherwise call AI
    const templateReply = getTemplateResponse(classified.message_type);
    if (templateReply) {
      await sendMessage(phoneNumber, templateReply);
      await saveMessage(user.user_id, 'user',      messageText,   messageId);
      await saveMessage(user.user_id, 'assistant', templateReply, null);
      await incrementMessages(user.user_id);
      return;
    }

    // Fallback: full AI
    await saveMessage(user.user_id, 'user', messageText, messageId);
    const reply = await askGPT(freshUser, children, messageText);
    await sendMessage(phoneNumber, reply);
    await saveMessage(user.user_id, 'assistant', reply, null);
    await incrementMessages(user.user_id);

  } catch (err) {
    logger.error('Webhook processing error', { error: err.message, stack: err.stack });
  }
});

module.exports = router;
