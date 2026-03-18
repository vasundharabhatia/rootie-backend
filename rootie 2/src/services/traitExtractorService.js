/**
 * Rootie — Trait Extractor Service
 *
 * Takes a parent's free-text description of their child and uses gpt-4o-mini
 * to intelligently extract structured personality fields.
 *
 * Extracted fields (all optional — null if not mentioned):
 *   temperament      — e.g. "spirited", "easy-going", "slow-to-warm"
 *   sensitivity_level — e.g. "high", "medium", "low"
 *   social_style     — e.g. "introverted", "extroverted", "slow to warm up in groups"
 *   strengths        — free text, comma-separated themes
 *   challenges       — free text, comma-separated themes
 *
 * Cost: ~200 tokens per call at gpt-4o-mini rates ≈ $0.00003 per extraction.
 */

const OpenAI     = require('openai');
const { logger } = require('../utils/logger');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const EXTRACTOR_SYSTEM_PROMPT = `You are a child psychology assistant helping a parenting app understand a child's personality.

A parent has described their child in their own words. Extract the following fields from their description:

- temperament: The child's general energy and disposition. Use plain, parent-friendly terms like "spirited", "easy-going", "slow-to-warm", "intense", "sensitive", "adaptable", "strong-willed". Return null if not mentioned.
- sensitivity_level: How emotionally or sensorially sensitive the child seems. Return "high", "medium", or "low". Return null if not mentioned.
- social_style: How the child relates to others. Use plain terms like "introverted", "extroverted", "shy with new people", "loves groups", "prefers one-on-one". Return null if not mentioned.
- strengths: A short, comma-separated list of the child's positive traits, skills, or qualities mentioned. Return null if none mentioned.
- challenges: A short, comma-separated list of things the child finds difficult, struggles with, or that are hard for the parent. Return null if none mentioned.

Rules:
- Only extract what is actually mentioned. Do NOT infer or invent.
- Keep values concise and natural — not clinical jargon.
- If a field is not mentioned at all, return null for that field.
- Return ONLY a valid JSON object with exactly these 5 keys. No explanation, no markdown.

Example output:
{"temperament":"spirited","sensitivity_level":"high","social_style":"introverted","strengths":"empathy, creativity, curiosity","challenges":"transitions, loud environments, frustration tolerance"}`;

/**
 * Parse a parent's free-text child description into structured trait fields.
 *
 * @param {string} freeText — the parent's natural language description
 * @returns {object} — { temperament, sensitivity_level, social_style, strengths, challenges }
 *                     any field may be null if not mentioned
 */
async function extractChildTraits(freeText) {
  try {
    const response = await openai.chat.completions.create({
      model:       'gpt-4o-mini',
      temperature: 0,
      max_tokens:  200,
      messages: [
        { role: 'system', content: EXTRACTOR_SYSTEM_PROMPT },
        { role: 'user',   content: freeText },
      ],
    });

    const raw    = response.choices[0].message.content.trim();
    const parsed = JSON.parse(raw);

    logger.info('Trait extraction complete', {
      inputLength: freeText.length,
      extracted:   JSON.stringify(parsed),
    });

    return {
      temperament:       parsed.temperament       || null,
      sensitivity_level: parsed.sensitivity_level || null,
      social_style:      parsed.social_style      || null,
      strengths:         parsed.strengths         || null,
      challenges:        parsed.challenges        || null,
    };

  } catch (err) {
    logger.error('Trait extraction failed', { error: err.message });
    // Return all-null on failure — caller will handle gracefully
    return {
      temperament:       null,
      sensitivity_level: null,
      social_style:      null,
      strengths:         null,
      challenges:        null,
    };
  }
}

/**
 * Format extracted traits into a friendly confirmation message for the parent.
 *
 * @param {string} childName
 * @param {object} traits — extracted trait object
 * @returns {string}
 */
function formatTraitsForConfirmation(childName, traits) {
  const lines = [];

  if (traits.temperament)       lines.push(`• Personality: *${traits.temperament}*`);
  if (traits.sensitivity_level) lines.push(`• Sensitivity: *${traits.sensitivity_level}*`);
  if (traits.social_style)      lines.push(`• Social style: *${traits.social_style}*`);
  if (traits.strengths)         lines.push(`• Strengths: *${traits.strengths}*`);
  if (traits.challenges)        lines.push(`• Challenges: *${traits.challenges}*`);

  if (!lines.length) {
    return (
      `Hmm, I wasn't quite sure what to pick up from that for *${childName}* 🌱\n\n` +
      `Could you tell me a bit more? For example:\n` +
      `_"She's quite spirited and gets overwhelmed easily. She's really empathetic and loves drawing, but transitions are hard for her."_`
    );
  }

  return (
    `Got it 🌱 Here's what I've noted for *${childName}*:\n\n` +
    lines.join('\n') +
    `\n\nDoes that sound right? Reply *yes* to save, *edit* to describe again, or *cancel* to stop.`
  );
}

/**
 * Merge new extracted traits on top of existing child traits.
 * Only overwrites fields where the new extraction found something (non-null).
 * Preserves existing values for fields the parent didn't mention this time.
 *
 * @param {object} existing — current child row from DB
 * @param {object} extracted — result from extractChildTraits()
 * @returns {object} — merged traits object (only changed fields)
 */
function mergeTraits(existing, extracted) {
  const merged = {};

  const fields = ['temperament', 'sensitivity_level', 'social_style', 'strengths', 'challenges'];
  for (const field of fields) {
    if (extracted[field] !== null) {
      merged[field] = extracted[field];
    }
  }

  return merged; // Only contains fields that actually changed
}

module.exports = {
  extractChildTraits,
  formatTraitsForConfirmation,
  mergeTraits,
};
