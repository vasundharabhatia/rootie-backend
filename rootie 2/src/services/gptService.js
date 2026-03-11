/**
 * Rootie — GPT Service (Step 2 of the Two-Step AI Pipeline)
 *
 * Called ONLY when the classifier determines needs_full_ai = true.
 *
 * Context strategy (lean — keeps token usage low):
 *   1. Rootie system prompt
 *   2. Compact family profile (parent name + child blueprints)
 *   3. Family summary (long-term memory, replaces full history)
 *   4. Last 3–5 conversation messages
 *   5. Current message
 *
 * Never sent to OpenAI:
 *   - Full conversation history
 *   - Full moment logs
 *   - Full growth reports
 */

const OpenAI     = require('openai');
const { logger } = require('../utils/logger');
const { getRecentMessages }   = require('./conversationService');
const { getFamilySummary,
        buildBasicSummary,
        saveFamilySummary }   = require('./familySummaryService');
const { buildChildProfile }   = require('./childService');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const ROOTIE_SYSTEM_PROMPT = `You are Rootie, a warm and calm parenting companion from Kind Roots 🌱

Your purpose is to help parents raise kind, confident, and emotionally intelligent children through:
- Small daily rituals and positive moment tracking
- Gentle, practical parenting guidance
- Emotional coaching and support
- Age-appropriate activity suggestions

Your tone is:
- Warm, calm, and non-judgmental
- Encouraging without being preachy
- Practical and specific (not generic advice)
- Brief — WhatsApp messages, not essays (max 3–4 short paragraphs)

You follow a positive parenting approach:
- Focus on connection before correction
- Validate the child's emotions
- Offer scripts parents can actually use
- Celebrate small wins

You NEVER:
- Give medical or clinical diagnoses
- Replace professional therapy
- Shame or judge parents
- Write long walls of text

When a parent shares a moment, celebrate it warmly and briefly.
When a parent asks a question, give 1–2 concrete, actionable suggestions.
Always end with warmth or a small encouragement.`;

/**
 * Build the lean context string for the AI prompt.
 */
async function buildContext(user, children) {
  const parts = [];

  // Family profile
  const profile = [`Parent: ${user.parent_name || 'Unknown'}`];
  if (children.length) {
    const childProfiles = children.map(c => buildChildProfile(c));
    profile.push(`Children: ${childProfiles.join(' | ')}`);
  }
  parts.push(profile.join('\n'));

  // Family summary (long-term memory)
  let summary = await getFamilySummary(user.user_id);
  if (!summary) {
    summary = buildBasicSummary(user, children);
    await saveFamilySummary(user.user_id, summary);
  }
  if (summary) parts.push(`Family context: ${summary}`);

  return parts.join('\n');
}

/**
 * Call the full AI model with lean context.
 *
 * @param {object} user      — full user row
 * @param {array}  children  — all children for this user
 * @param {string} message   — current parent message
 * @returns {string} AI reply
 */
async function askGPT(user, children, message) {
  try {
    const context      = await buildContext(user, children);
    const recentMsgs   = await getRecentMessages(user.user_id, 5);

    // Build messages array
    const messages = [
      { role: 'system', content: ROOTIE_SYSTEM_PROMPT },
      { role: 'system', content: `FAMILY PROFILE:\n${context}` },
      // Recent conversation history
      ...recentMsgs.map(m => ({ role: m.role, content: m.message_text })),
      // Current message (already in history but included for clarity)
      { role: 'user', content: message },
    ];

    const response = await openai.chat.completions.create({
      model:       process.env.OPENAI_MODEL || 'gpt-4o-mini',
      temperature: 0.7,
      max_tokens:  400,
      messages,
    });

    const reply = response.choices[0].message.content.trim();
    logger.info('GPT response generated', {
      userId:     user.user_id,
      inputTokens:  response.usage?.prompt_tokens,
      outputTokens: response.usage?.completion_tokens,
    });

    return reply;

  } catch (err) {
    logger.error('GPT call failed', { error: err.message });
    return (
      `I'm having a little trouble right now 🌱 Please try again in a moment.\n\n` +
      `In the meantime, remember — you're doing a wonderful job just by showing up for your child. 💛`
    );
  }
}

module.exports = { askGPT };
