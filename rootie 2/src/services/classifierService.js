/**
 * Rootie — Message Classifier (Step 1 of the Two-Step AI Pipeline)
 *
 * Every inbound message goes through this classifier FIRST.
 * It uses gpt-4o-mini (very cheap) to categorise the message.
 *
 * If needs_full_ai = false, we use a template response and skip the expensive model.
 * If needs_full_ai = true,  we call the full AI (Step 2).
 *
 * Classifier output:
 * {
 *   message_type:     'moment_log' | 'parenting_question' | 'onboarding' |
 *                     'daily_prompt_response' | 'bonding_activity_response' |
 *                     'child_selection_needed' | 'general',
 *   child_name:       string | null,
 *   log_moment:       boolean,
 *   moment_category:  'kindness' | 'empathy' | 'resilience' | 'confidence' |
 *                     'emotional_expression' | 'curiosity' | 'responsibility' | null,
 *   confidence_score: number (0–1),
 *   needs_full_ai:    boolean
 * }
 *
 * Cost note: gpt-4o-mini costs ~$0.00015 per 1K input tokens.
 * A typical classification call uses ~200 tokens = $0.00003 per message.
 */

const OpenAI     = require('openai');
const { logger } = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const CLASSIFIER_SYSTEM_PROMPT = `You are a message classifier for Rootie, a WhatsApp parenting companion.

Classify the parent's message into one of these types:
- moment_log: parent is sharing a positive behavior they observed in their child
- parenting_question: parent is asking for parenting advice or guidance
- daily_prompt_response: parent is responding to today's daily prompt
- bonding_activity_response: parent is responding to a weekly bonding activity
- general: a greeting, thank you, or general chat
- child_selection_needed: message mentions a child behavior but it's unclear which child (only when parent has multiple children and child name is not mentioned)

Also detect:
- child_name: the child's name if mentioned, otherwise null
- log_moment: true if this should be saved as a positive moment
- moment_category: one of kindness, empathy, resilience, confidence, emotional_expression, curiosity, responsibility — or null
- confidence_score: 0.0 to 1.0 — how confident you are in the classification
- needs_full_ai: true ONLY if the message requires personalised parenting advice or emotional coaching. Set to false for moment logs, greetings, and simple responses.

Respond ONLY with valid JSON. No explanation.`;

async function classifyMessage(messageText, children = []) {
  try {
    // Build context about children so classifier can detect child_selection_needed
    let childContext = '';
    if (children.length > 1) {
      const names = children.map(c => c.child_name).join(', ');
      childContext = `\nThis parent has multiple children: ${names}.`;
    } else if (children.length === 1) {
      childContext = `\nThis parent has one child: ${children[0].child_name}.`;
    }

    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 150,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT + childContext },
        { role: 'user',   content: messageText },
      ],
    });

    const raw = response.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);

    // Validate required fields
    return {
      message_type:     parsed.message_type     || 'general',
      child_name:       parsed.child_name        || null,
      log_moment:       parsed.log_moment        === true,
      moment_category:  parsed.moment_category   || null,
      confidence_score: parsed.confidence_score  || 0.5,
      needs_full_ai:    parsed.needs_full_ai     === true,
    };

  } catch (err) {
    logger.error('Classifier failed', { error: err.message });
    // Safe fallback — treat as general, let full AI handle it
    return {
      message_type:     'general',
      child_name:       null,
      log_moment:       false,
      moment_category:  null,
      confidence_score: 0,
      needs_full_ai:    true,
    };
  }
}

module.exports = { classifyMessage };
