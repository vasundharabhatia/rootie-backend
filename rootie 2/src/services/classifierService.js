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
- parenting_question: parent is asking for parenting advice or guidance. This INCLUDES short follow-up or refinement messages that adjust a previous request — e.g. "indoor activity", "outdoor activity", "something shorter", "for a toddler", "give me another one". If the message looks like a follow-up to a prior Rootie suggestion, classify it as parenting_question.
- daily_prompt_response: parent is responding to Rootie's Monday noticing prompt / weekly challenge
- bonding_activity_response: parent is responding to a weekly bonding activity (e.g. sharing how it went)
- evening_nudge_response: parent is responding to the evening connection nudge (e.g. a reaction emoji, "aww", "thanks", "will do", "❤️", "👍", short warm reply)
- open_question_response: parent is responding to Rootie's weekly open question (e.g. sharing a worry, concern, or question about their child that they've been sitting with)
- weekend_activity_completion: parent is confirming they completed or did not complete a weekend activity (e.g. "yes", "we did it", "no", "didn't get to it")
- reaction_only: the message is a single emoji, emoji sequence, or very short reaction (≤5 characters) with no clear context — e.g. "❤️", "👍", "🙌", "😊", "wow"
- activity_suggestion_thanks: parent is expressing thanks, excitement, or acknowledgment specifically after receiving an activity or advice suggestion from Rootie — e.g. "thanks I will try it", "sounds great!", "we'll give it a go", "okay I'll do that"
- general: a greeting, thank you, or general chat (use this only when the thank-you is not clearly tied to a recent Rootie suggestion)
- child_selection_needed: message mentions a child behavior but it's unclear which child (only when parent has multiple children and child name is not mentioned)

Also detect:
- child_name: the child's name if mentioned, otherwise null
- log_moment: true if this should be saved as a positive moment
- moment_category: one of kindness, empathy, resilience, confidence, emotional_expression, curiosity, responsibility — or null
- confidence_score: 0.0 to 1.0 — how confident you are in the classification
- needs_full_ai: true ONLY if the message requires personalised parenting advice or emotional coaching. Set to false for moment logs, greetings, reactions, and simple responses. Set to true for parenting_question messages, including short follow-up/refinement messages.

The JSON object must use the exact key name "message_type" (not "type").

For weekend_activity_completion, also include a boolean field "activity_done" — true if the parent says yes/did it, false if they say no/didn't.

IMPORTANT: Short messages (≤5 chars) or pure emoji with no other context should be classified as reaction_only, not general or parenting_question.
IMPORTANT: Short messages that are clearly a follow-up or refinement of a previous activity/advice request (e.g. "indoor activity", "for a younger child", "give me another") must be classified as parenting_question with needs_full_ai: true — NOT as general or reaction_only.
IMPORTANT: Messages that express thanks or intent to try something after Rootie has just suggested an activity or advice (e.g. "thanks I will try it out", "ok I'll do that", "sounds fun!") must be classified as activity_suggestion_thanks — NOT as general.`;

// Regex that matches a string consisting entirely of emoji characters (and optional whitespace)
const EMOJI_ONLY_RE = /^[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE00}-\u{FEFF}\u{1F900}-\u{1F9FF}\u{1FA00}-\u{1FA9F}\u2764\u2665\u2714\u2728\u{200D}\uFE0F\s]+$/u;

async function classifyMessage(messageText, children = [], recentMessages = []) {
  // Fast-path: pure emoji or very short reaction — skip AI call entirely
  const trimmed = messageText.trim();
  if (trimmed.length <= 5 || EMOJI_ONLY_RE.test(trimmed)) {
    return {
      message_type:     'reaction_only',
      child_name:       null,
      log_moment:       false,
      moment_category:  null,
      confidence_score: 1.0,
      needs_full_ai:    false,
      activity_done:    false,
    };
  }

  // Build context about children so classifier can detect child_selection_needed
  let childContext = '';
  if (children.length > 1) {
    const names = children.map(c => c.child_name).join(', ');
    childContext = `\nThis parent has multiple children: ${names}.`;
  } else if (children.length === 1) {
    childContext = `\nThis parent has one child: ${children[0].child_name}.`;
  }

  // Build recent conversation context so the classifier can detect follow-up messages
  let recentContext = '';
  if (recentMessages && recentMessages.length > 0) {
    const lastFew = recentMessages.slice(-3); // last 3 messages for context
    const formatted = lastFew
      .map(m => `${m.role === 'user' ? 'Parent' : 'Rootie'}: ${m.message_text}`)
      .join('\n');
    recentContext = `\n\nRecent conversation context (for follow-up detection):\n${formatted}`;
  }

  try {
    const response = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0,
      max_tokens: 150,
      messages: [
        { role: 'system', content: CLASSIFIER_SYSTEM_PROMPT + childContext + recentContext },
        { role: 'user',   content: messageText },
      ],
    });

    const raw    = response.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);

    return {
      message_type:     parsed.message_type    || parsed.type || 'general',
      child_name:       parsed.child_name      || null,
      log_moment:       parsed.log_moment      === true,
      moment_category:  parsed.moment_category || null,
      confidence_score: parsed.confidence_score || 0.5,
      needs_full_ai:    parsed.needs_full_ai   === true,
      activity_done:    parsed.activity_done   === true,
    };
  } catch (err) {
    logger.error('Classifier failed', { error: err.message });
    return {
      message_type:     'general',
      child_name:       null,
      log_moment:       false,
      moment_category:  null,
      confidence_score: 0,
      needs_full_ai:    true,
      activity_done:    false,
    };
  }
}

module.exports = { classifyMessage };

