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
 *       a. Onboarding (not complete)  → onboardingService
 *       b. Safety check               → safetyService
 *       c. UPGRADE keyword intercept  → upgrade_coming_soon template
 *       d. Profile update trigger     → profileUpdateService (edit name/child/time)
 *       e. Active profile edit session→ profileUpdateService (continue flow)
 *       f. Step 1: Classify message   → classifierService
 *       g. Route by message_type:
 *          - moment_log              → log moment, send template reply
 *          - child_selection_needed  → ask which child
 *          - parenting_question      → check plan limit → Step 2 AI
 *          - general / other         → Step 2 AI (if needed) or template
 *   8.  Save conversation, update usage
 *
 * ── TIMEZONE / SCHEDULE BUG FIX ──────────────────────────────────────────────
 *
 * ROOT CAUSE: When a user taps a WhatsApp quick-reply button (e.g. "Yes"/"No"
 * at onboarding step 4, or any button in the profile-update flow), Meta sends
 * the message with type = 'interactive', not 'text'. The previous guard:
 *
 *   if (messageType !== 'text' || !messageText) { ... return; }
 *
 * evaluated to TRUE for interactive messages and immediately returned a
 * "non-text" reply, silently dropping the user's intent. This meant:
 *
 *   • Onboarding step 4 ("Yes/No — add another child?") was never processed
 *     when the user tapped a button, leaving them stuck at step 4 forever.
 *   • Onboarding step 5 (reminder time) was unreachable via button tap.
 *   • The profile-update "change reminder time" flow was broken for button users.
 *   • timezone and reminder_hour were therefore never saved for these users.
 *
 * FIX: Normalise interactive messages to 'text' BEFORE the non-text guard,
 * whenever the parsed messageText is non-empty. This allows button replies to
 * flow through the full routing pipeline exactly like typed text messages.
 * Messages of type 'interactive' with no extractable text are still rejected.
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
        updateUser,
        updateLastActive }    = require('../services/userService');
const { getChildrenByUserId } = require('../services/childService');
const { handleOnboarding }    = require('../services/onboardingService');
const { handleProfileUpdate,
        isProfileUpdateTrigger,
        isProfileViewTrigger,
        handleProfileView,
        hasActiveSession }    = require('../services/profileUpdateService');
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
const { handleActivityCompletion } = require('../services/activityTrackingService');
const { setPendingAction,
        getPendingAction,
        clearPendingAction } = require('../services/pendingActionService');

function buildChildSelectionReply(children) {
  const list = children.map((c, i) => `• *${i + 1}* — ${c.child_name}`).join('\n');
  return (
    `That's beautiful. Just so I log it for the right child — who was this about? 🌱\n\n` +
    `${list}\n\n` +
    `You can reply with the *number* or the *name*.`
  );
}

function resolveChildFromReply(messageText, children) {
  const text = messageText.trim();
  const idx = parseInt(text, 10);

  if (!Number.isNaN(idx) && idx >= 1 && idx <= children.length) {
    return children[idx - 1];
  }

  const lower = text.toLowerCase();
  return children.find(c => c.child_name.toLowerCase() === lower) || null;
}
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

    let { phoneNumber, messageId, messageType, messageText, displayName } = parsed;

    // ── TIMEZONE / SCHEDULE FIX ─────────────────────────────────────────────
    // Normalise interactive messages (button/list replies) to 'text' so they
    // flow through the full routing pipeline. WhatsApp sends type='interactive'
    // for quick-reply button taps; parseInbound already extracts the button
    // title into messageText. If messageText is present, treat it as plain text.
    // If messageText is absent (e.g. an unsupported interactive subtype), the
    // non-text guard below will still reject it correctly.
    if (messageType === 'interactive' && messageText) {
      messageType = 'text';
    }

    // Deduplicate
    if (await isAlreadyProcessed(messageId)) {
      logger.info('Duplicate message ignored', { messageId });
      return;
    }

    // Read receipt
    await markAsRead(messageId);

    // Handle non-text messages (audio, image, sticker, location, etc.)
    // Also catches interactive messages with no extractable text.
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
    if (/^upgrade$/i.test(messageText.trim())) {
      const upgradeReply = getTemplateResponse('upgrade_coming_soon');
      await sendMessage(phoneNumber, upgradeReply);
      await saveMessage(user.user_id, 'user',      messageText,   messageId);
      await saveMessage(user.user_id, 'assistant', upgradeReply,  null);
      await incrementHitLimit(user.user_id);
      logger.info('Upgrade intent captured', { phone: phoneNumber });
      return;
    }

        // ── Profile view intercept ──────────────────────────────────────────────
    if (isProfileViewTrigger(messageText)) {
      const freshUser = await getUserByPhone(phoneNumber);
      const profileViewReply = await handleProfileView(freshUser, messageText);
      await sendMessage(phoneNumber, profileViewReply);
      await saveMessage(user.user_id, 'user', messageText, messageId);
      await saveMessage(user.user_id, 'assistant', profileViewReply, null);
      await incrementMessages(user.user_id);
      return;
    }

    // ── Profile update intercept ────────────────────────────────────────────
    const profileSessionActive = await hasActiveSession(user.user_id);

    if (isProfileUpdateTrigger(messageText) || profileSessionActive) {
      const freshUser = await getUserByPhone(phoneNumber);
      const profileReply = await handleProfileUpdate(freshUser, messageText);
      await sendMessage(phoneNumber, profileReply);
      await saveMessage(user.user_id, 'user', messageText, messageId);
      await saveMessage(user.user_id, 'assistant', profileReply, null);
      await incrementMessages(user.user_id);
      return;
    }
    // ── Pending child selection resolution ───────────────────────────────────
    const pendingAction = await getPendingAction(user.user_id);

    if (pendingAction && pendingAction.action_type === 'child_selection_for_moment') {
      const currentChildren = await getChildrenByUserId(user.user_id);
      const selectedChild = resolveChildFromReply(messageText, currentChildren);

      if (!selectedChild) {
        const reply = buildChildSelectionReply(currentChildren);
        await sendMessage(phoneNumber, reply);
        await saveMessage(user.user_id, 'user', messageText, messageId);
        await saveMessage(user.user_id, 'assistant', reply, null);
        await incrementMessages(user.user_id);
        return;
      }

      const payload = pendingAction.payload || {};
      const originalClassified = payload.classified || {};
      const originalRawMessage = payload.rawMessage || '';

      const resolvedClassified = {
        ...originalClassified,
        message_type: 'moment_log',
        child_name: selectedChild.child_name,
      };

      const freshUser = await getUserByPhone(phoneNumber);
      const reply = await handleMomentLog(
        freshUser,
        currentChildren,
        resolvedClassified,
        originalRawMessage
      );

      await clearPendingAction(user.user_id);

      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'user', messageText, messageId);
      await saveMessage(user.user_id, 'assistant', reply, null);
      await incrementMoments(user.user_id);
      await incrementMessages(user.user_id);
      return;
    }
    // ── Step 1: Classify the message ────────────────────────────────────────
    const children   = await getChildrenByUserId(user.user_id);
    const freshUser  = await getUserByPhone(phoneNumber);
    const classified = await classifyMessage(messageText, children);

    logger.info('Message classified', {
      type:          classified.message_type,
      needs_full_ai: classified.needs_full_ai,
      confidence:    classified.confidence_score,
    });

    // ── Route by message type ───────────────────────────────────────────────

    // A) Moment log — no AI needed
    if (classified.message_type === 'moment_log') {
      const reply = await handleMomentLog(freshUser, children, classified, messageText);
      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'user',      messageText, messageId);
      await saveMessage(user.user_id, 'assistant', reply,       null);
      await incrementMoments(user.user_id);
      await incrementMessages(user.user_id);
      return;
    }

        // B) Child unclear — persist original moment and ask which child
    if (classified.message_type === 'child_selection_needed') {
      await setPendingAction(user.user_id, 'child_selection_for_moment', {
        rawMessage: messageText,
        classified,
      });

      const reply = buildChildSelectionReply(children);
      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'user', messageText, messageId);
      await saveMessage(user.user_id, 'assistant', reply, null);
      await incrementMessages(user.user_id);
      return;
    }
    // C) Parenting question or anything needing full AI
    if (classified.message_type === 'parenting_question' || classified.needs_full_ai) {
      // Check free plan limit
      const access = await canAskQuestion(freshUser);
    if (!access.allowed) {
  let limitReply;

  if (access.firstTimeBlocked) {
    limitReply = getTemplateResponse('free_limit_first_time_plus_interest');

    await updateUser(phoneNumber, {
      rootie_plus_interested: true,
      rootie_plus_interest_at: new Date().toISOString(),
    });
  } else {
    limitReply = getTemplateResponse('free_limit_repeat_plus_interest');
  }

  await sendMessage(phoneNumber, limitReply);
  await saveMessage(user.user_id, 'user', messageText, messageId);
  await saveMessage(user.user_id, 'assistant', limitReply, null);
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

    // D) Weekend activity completion — parent replied to Monday follow-up
    if (classified.message_type === 'weekend_activity_completion') {
      const { reply_template } = await handleActivityCompletion(
        user.user_id,
        classified.activity_done
      );

      const reply =
        getTemplateResponse(reply_template) ||
        getTemplateResponse(
          classified.activity_done ? 'weekend_activity_confirmed' : 'weekend_activity_skipped'
        );

      await sendMessage(phoneNumber, reply);
      await saveMessage(user.user_id, 'user', messageText, messageId);
      await saveMessage(user.user_id, 'assistant', reply, null);
      await incrementMessages(user.user_id);
      return;
    }

    // E) General / daily_prompt_response / bonding_activity_response
    const templateReply = getTemplateResponse(classified.message_type, { isNewUser: !user.onboarding_complete });
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
