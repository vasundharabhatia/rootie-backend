/**
 * Rootie — Safety Service
 *
 * Two-tier rules-based detection. Runs before any AI call.
 *
 * Tier 1 — CRISIS
 *   Triggered by: explicit self-harm, suicide ideation, child abuse, immediate danger
 *   Response: warm, generic safety escalation (no specific numbers or organisations)
 *   Template key: 'safety'
 *
 * Tier 2 — EXTREME DISTRESS
 *   Triggered by: extreme language, rage, severe overwhelm, threats
 *   Response: de-escalation, validation, gentle redirection to in-person support
 *   Template key: 'extreme_distress'
 *
 * Neither tier shares specific helpline numbers — responses are intentionally
 * generic to remain safe across all geographies.
 */

const { getTemplateResponse } = require('./templateService');

// ─── Tier 1: Crisis keywords ──────────────────────────────────────────────────
// Explicit self-harm, suicidal ideation, child abuse, immediate danger
const CRISIS_KEYWORDS = [
  'suicide',
  'kill myself',
  'end my life',
  'want to die',
  'don\'t want to live',
  'no reason to live',
  'hurt myself',
  'self harm',
  'self-harm',
  'cutting myself',
  'abuse',
  'hitting my child',
  'hurting my child',
  'hit my child',
  'hurt my child',
  'can\'t cope',
  'cannot cope',
  'emergency',
  'in danger',
  'not safe',
  'unsafe',
  'going to hurt',
];

// ─── Tier 2: Extreme distress / rage / severe overwhelm ──────────────────────
// Strong emotional language, rage, threats, severe parental burnout
const EXTREME_DISTRESS_KEYWORDS = [
  'i hate my child',
  'hate my kid',
  'i hate being a parent',
  'wish i never had kids',
  'wish i never had a child',
  'i want to scream',
  'i screamed at my child',
  'i screamed at my kid',
  'i lost it',
  'completely lost it',
  'out of control',
  'i can\'t do this anymore',
  'i cannot do this anymore',
  'i give up',
  'i\'m done',
  'i am done',
  'i want to run away',
  'i want to disappear',
  'i hate myself',
  'i\'m a terrible parent',
  'i am a terrible parent',
  'worst parent',
  'i broke down',
  'i snapped',
  'i threatened',
  'i shook',
  'i shook my child',
  'i threw something',
  'i smashed',
  'i punched',
  'i want to hit',
  'want to hit my child',
  'want to hurt',
  'going crazy',
  'losing my mind',
  'mental breakdown',
  'breakdown',
];

/**
 * Check a message for safety concerns.
 *
 * @param {string} messageText
 * @returns {{ escalate: boolean, tier: 'crisis'|'extreme_distress'|null, response: string|null }}
 */
function checkSafety(messageText) {
  const lower = messageText.toLowerCase();

  // Tier 1 — Crisis (highest priority, check first)
  const isCrisis = CRISIS_KEYWORDS.some(kw => lower.includes(kw));
  if (isCrisis) {
    return {
      escalate: true,
      tier: 'crisis',
      response: getTemplateResponse('safety'),
    };
  }

  // Tier 2 — Extreme distress / rage
  const isExtremeDistress = EXTREME_DISTRESS_KEYWORDS.some(kw => lower.includes(kw));
  if (isExtremeDistress) {
    return {
      escalate: true,
      tier: 'extreme_distress',
      response: getTemplateResponse('extreme_distress'),
    };
  }

  return { escalate: false, tier: null, response: null };
}

module.exports = { checkSafety };
