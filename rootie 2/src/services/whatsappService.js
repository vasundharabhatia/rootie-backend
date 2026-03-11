/**
 * Rootie — WhatsApp Cloud API Service
 *
 * All communication with Meta's WhatsApp Cloud API.
 * No third-party SDK — direct HTTP calls via axios.
 *
 * API version: v21.0
 */

const axios  = require('axios');
const crypto = require('crypto');
const { logger } = require('../utils/logger');

const API_VERSION = 'v21.0';
const BASE_URL    = `https://graph.facebook.com/${API_VERSION}`;

// ─── Send a text message ──────────────────────────────────────────────────
async function sendMessage(to, text) {
  try {
    const res = await axios.post(
      `${BASE_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      {
        messaging_product: 'whatsapp',
        recipient_type:    'individual',
        to,
        type: 'text',
        text: { preview_url: false, body: text },
      },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
    logger.info('Message sent', { to, preview: text.substring(0, 60) });
    return res.data;
  } catch (err) {
    const detail = err.response?.data || err.message;
    logger.error('Failed to send WhatsApp message', { to, error: detail });
    throw err;
  }
}

// ─── Mark a message as read (blue ticks) ─────────────────────────────────
async function markAsRead(messageId) {
  try {
    await axios.post(
      `${BASE_URL}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`,
      { messaging_product: 'whatsapp', status: 'read', message_id: messageId },
      {
        headers: {
          Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
          'Content-Type': 'application/json',
        },
      }
    );
  } catch {
    // Non-critical — don't throw if read receipt fails
  }
}

// ─── Verify Meta webhook signature ───────────────────────────────────────
function verifySignature(rawBody, signatureHeader) {
  if (!process.env.WHATSAPP_APP_SECRET) return true; // skip in dev
  if (!signatureHeader) return false;
  const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.WHATSAPP_APP_SECRET)
    .update(rawBody || '')
    .digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signatureHeader), Buffer.from(expected));
  } catch {
    return false;
  }
}

// ─── Parse an inbound webhook payload ────────────────────────────────────
// Returns null if the payload is a status update (not a message).
function parseInbound(body) {
  try {
    const entry   = body?.entry?.[0];
    const change  = entry?.changes?.[0];
    const value   = change?.value;
    const message = value?.messages?.[0];
    if (!message) return null;

    const contact     = value?.contacts?.[0];
    const phoneNumber = message.from;
    const messageId   = message.id;
    const messageType = message.type;
    const displayName = contact?.profile?.name || '';

    let messageText = null;
    if (messageType === 'text') {
      messageText = message.text?.body?.trim() || null;
    } else if (messageType === 'interactive') {
      messageText = message.interactive?.button_reply?.title ||
                    message.interactive?.list_reply?.title || null;
    }

    return { phoneNumber, messageId, messageType, messageText, displayName };
  } catch (err) {
    logger.error('Failed to parse inbound payload', { error: err.message });
    return null;
  }
}

module.exports = { sendMessage, markAsRead, verifySignature, parseInbound };
