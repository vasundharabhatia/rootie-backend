/**
 * Rootie — Template Response Engine
 *
 * Every scenario has multiple response variants.
 * pick() randomly selects one each time — so parents never see the same
 * reply twice in a row.
 *
 * Scenarios covered:
 *   moment_logged              — parent shared a positive child moment
 *   child_selection_needed     — multiple children, unclear which one
 *   free_limit_reached         — free user hit daily question limit
 *   daily_prompt               — outbound daily noticing challenge
 *   weekly_activity            — outbound weekly bonding activity
 *   general                    — greeting/chat from a NEW (unonboarded) user
 *   general_returning_user     — greeting/chat from an already-onboarded user
 *   daily_prompt_response      — parent replied to a daily prompt
 *   bonding_activity_response  — parent replied to a weekly activity
 *   non_text                   — image, audio, or video received
 *   safety                     — crisis keywords detected (generic, no numbers)
 *   extreme_distress           — extreme language, rage, or severe distress
 *
 * REPHRASING UPDATE:
 * All templates rewritten to sound human and warm — less like an AI, more like
 * a calm, supportive friend. Removed "prompt", "challenge", "noticing" framing
 * from outbound headers. Added `general_returning_user` so Rootie does not
 * re-introduce itself to users who are already onboarded.
 */

// ─── Helper: pick a random item from an array ────────────────────────────────
function pick(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ─── Emoji map for moment categories ─────────────────────────────────────────
const CATEGORY_EMOJI = {
  kindness:             '💛',
  empathy:              '🤝',
  resilience:           '💪',
  confidence:           '⭐',
  emotional_expression: '💬',
  curiosity:            '🔍',
  responsibility:       '🌟',
};

// ─── Template Variants ────────────────────────────────────────────────────────

const TEMPLATES = {

  // ── Moment logged ────────────────────────────────────────────────────────────
  moment_logged: (childName, category) => {
    const emoji = CATEGORY_EMOJI[category] || '🌱';
    const child = childName ? `*${childName}*` : 'your child';

    const variants = [
      `What a wonderful thing to see. ${emoji} I've saved that to ${child}'s journey. It's these little moments that build so much. 🌱`,
      `That's beautiful. Thank you for sharing. ${emoji} Saved. You have a great eye for these moments. 💛`,
      `I love that. ${emoji} Every time you notice, you're telling them — I see you. That's powerful stuff. 🌱`,
      `That's one to remember. ${emoji} I've saved it. Keep noticing the good things — it really does add up. 💛`,
      `Thank you for sharing that with me. ${emoji} It's been added to ${child}'s story. You're doing a wonderful job. 🌱`,
    ];
    return pick(variants);
  },

  // ── Child unclear ────────────────────────────────────────────────────────────
  child_selection_needed: () => {
    const variants = [
      `That's a wonderful moment to share. Who are we celebrating? 🌱`,
      `I'd love to save that. Which of your children was it? 💛`,
      `That's beautiful. Just so I get it right — which child was this about? 🌱`,
      `I want to make sure I log this for the right little one. Who was it? 💛`,
    ];
    return pick(variants);
  },

  // ── Free plan limit reached ──────────────────────────────────────────────────
  free_limit_reached: () => {
    const variants = [
      `It looks like you've used all of today's questions. 🌱 You can still log as many moments as you like — that's always free. I'll be here to chat again tomorrow! 💛`,
      `That's all of today's questions for now. 💛 If you often have more on your mind, Rootie Plus offers unlimited chats. Reply *UPGRADE* to learn more, or we can pick this up again tomorrow. 🌱`,
      `We've reached today's limit on questions. 🌱 You can still share any positive moments you notice. Otherwise, I'm looking forward to talking more tomorrow! 💛`,
    ];
    return pick(variants);
  },

  // ── Daily prompt (outbound) ──────────────────────────────────────────────────
  daily_prompt: (promptText) => {
    const variants = [
      `A little something to notice today... 🌱\n\n${promptText}`,
      `Good morning! Here's a small thought for your day... 💛\n\n${promptText}`,
      `Today's thought... 🌱\n\n${promptText}`,
    ];
    return pick(variants);
  },

  // ── Weekly bonding activity (outbound) ───────────────────────────────────────
  weekly_activity: (activityText) => {
    const variants = [
      `A little idea for the weekend... 🌱\n\n${activityText}`,
      `Something to try this weekend... 💛\n\n${activityText}`,
      `Here's a small way to connect this weekend... 🌱\n\n${activityText}`,
    ];
    return pick(variants);
  },

  // ── General (greeting, thanks, general chat) ─────────────────────────────────
  // For NEW users who are not yet onboarded — give the full intro.
  general: () => {
    const variants = [
      `Hi there! I'm Rootie. 🌱 A calm little space for parents to notice the good things and get a bit of support.\n\nYou can share a moment you noticed in your child, or ask me a parenting question. What's on your mind? 💛`,
      `Hello! I'm Rootie. 🌱 I'm here to help you track the small, positive moments in your child's life, or to help with parenting questions.\n\nWhat would you like to do? 💛`,
    ];
    return pick(variants);
  },

  // ── General (returning, already onboarded user) ───────────────────────────────
  // Short and warm — no re-introduction needed.
  general_returning_user: () => {
    const variants = [
      `Good to hear from you. 💛`,
      `Hello! How are things today? 🌱`,
      `Hi there. What's on your mind? 💛`,
      `I'm here. 🌱`,
    ];
    return pick(variants);
  },

  // ── Daily prompt response ────────────────────────────────────────────────────
  daily_prompt_response: () => {
    const variants = [
      `Thank you for sharing that. 🌱 Every moment of noticing matters. You're doing beautifully. 💛`,
      `I love that you took a moment to notice. 💛 That awareness is one of the most powerful things a parent can offer. 🌱`,
      `That's wonderful. 🌱 The fact that you're paying attention says so much about the parent you are. 💛`,
      `Beautiful. 💛 Noticing is the first step to everything. You're building something meaningful, one moment at a time. 🌱`,
    ];
    return pick(variants);
  },

  // ── Bonding activity response ────────────────────────────────────────────────
  bonding_activity_response: () => {
    const variants = [
      `That's wonderful to hear. 🌱 Those conversations stay with children long after they happen. 💛`,
      `I love hearing that. 💛 Time like that — unhurried, present — is exactly what children remember. 🌱`,
      `That sounds like a really special moment. 🌱 You showed up, and that's everything. 💛`,
      `What a lovely thing to do together. 💛 Connection is the foundation of it all. 🌱`,
    ];
    return pick(variants);
  },

  // ── Upgrade enquiry — parent typed UPGRADE ────────────────────────────────
  // Coming soon message — lists all Rootie Plus features warmly
  upgrade_coming_soon: () => {
    const variants = [
      `Thank you for your interest in Rootie Plus! 🌱💛

*Rootie Plus is coming soon.* Here's what it will include:

✨ *Unlimited parenting questions* — ask as much as you need, any time
🧠 *Child Personality Blueprint* — responses personalised to your child's unique traits and temperament
📈 *Monthly Growth Reports* — a beautiful summary of your child's moments, patterns, and growth over the month
🔍 *Pattern Detection* — Rootie notices trends across your child's moments and gently highlights what's emerging
🌱 *Priority support* — your questions always get the most thoughtful, in-depth responses

We'll let you know the moment it's ready. You'll be first in line. 💛`,

      `Rootie Plus is on its way! 🌱

Here's a peek at what's coming:

✨ *Ask unlimited parenting questions* — no daily limits
🧠 *Personalised guidance* using your child's personality, age, and the moments you've shared
📈 *Monthly Growth Reports* — see your child's journey captured beautifully each month
🔍 *Moment pattern insights* — Rootie spots what's growing in your child before you even notice
🌱 *Deeper, richer responses* tailored to your family's story

We're working hard to make it something really special. We'll message you as soon as it's live! 💛`,

      `We love that you're interested! 💛

*Rootie Plus is coming soon.* Here's what you'll unlock:

✨ Unlimited parenting questions — any time, no limits
🧠 A Child Personality Blueprint — so every response truly fits *your* child
📈 Monthly Growth Reports — a keepsake summary of your child's development
🔍 Pattern detection — Rootie notices what's quietly growing in your child
🌱 Richer, more personalised guidance for your whole family

You'll be among the first to know when it launches. Thank you for being part of this journey. 🌱`,
    ];
    return pick(variants);
  },

  // ── Non-text message ─────────────────────────────────────────────────────────
  non_text: () => {
    const variants = [
      `I can only read text messages for now. 😊 Please type your message and I'll help!`,
      `I'm not able to open that just yet. 😊 Send me a text message and I'll be right with you!`,
      `I work best with text for now. 🌱 Type out what's on your mind and I'll respond!`,
    ];
    return pick(variants);
  },

  // ── Safety — crisis keywords detected ───────────────────────────────────────
  // Generic: no specific numbers, no specific organisations
  safety: () => {
    const variants = [
      `I hear you, and I want you to know you're not alone. 💛\n\nWhat you're feeling matters. If you or someone around you is in immediate danger, please reach out to your local emergency services or a crisis helpline in your area.\n\nI'm here for parenting support — but right now, please make sure you're safe first. 🌱`,
      `Thank you for trusting me with this. 💛\n\nIf there is any immediate risk to you or your child, please contact your local emergency services right away — they are there to help.\n\nOnce you're safe, I'm here. You don't have to go through this alone. 🌱`,
      `I want you to know I'm taking what you've shared seriously. 💛\n\nIf you or your child are in danger right now, please reach out to emergency services or a local support line in your area — help is available.\n\nYou matter. Your child matters. Please reach out. 🌱`,
    ];
    return pick(variants);
  },

  // ── Extreme distress — rage, extreme language, severe emotional crisis ────────
  extreme_distress: () => {
    const variants = [
      `I can hear that things feel really overwhelming right now. 💛\n\nWhen we're at our limit, it helps to step away for just a moment — even 60 seconds in another room.\n\nIf you feel like you or your child might be at risk, please reach out to someone who can be with you right now. You don't have to handle this alone. 🌱`,
      `It sounds like you're carrying a lot right now, and that's okay to say. 💛\n\nParenting is hard, and some moments are genuinely overwhelming. You're not a bad parent for feeling this way.\n\nIf things feel out of control, please reach out to a trusted person nearby or a local support service. You deserve support too. 🌱`,
      `I hear you. What you're feeling right now sounds really intense, and I want you to be okay. 💛\n\nPlease take a breath. If you feel unsafe — or your child does — reach out to someone who can help in person right now.\n\nI'm here for you when things feel calmer. You're not alone. 🌱`,
      `That sounds like a really hard moment. 💛\n\nWhen emotions run this high, the most important thing is safety — yours and your child's. Please reach out to someone you trust, or a local support line, if you need immediate help.\n\nYou reached out here, and that takes courage. I'm with you. 🌱`,
    ];
    return pick(variants);
  },

};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a randomly selected template response for the given type.
 * Returns null if no template exists (caller falls back to full AI).
 *
 * @param {string} type
 * @param {object} [data] — optional data: { childName, category, promptText, activityText, isNewUser }
 * @returns {string|null}
 */
function getTemplateResponse(type, data = {}) {
  switch (type) {
    case 'moment_logged':
      return TEMPLATES.moment_logged(data.childName, data.category);

    case 'child_unclear':
    case 'child_selection_needed':
      return TEMPLATES.child_selection_needed();

    case 'free_limit_reached':
      return TEMPLATES.free_limit_reached();

    case 'daily_prompt':
      return TEMPLATES.daily_prompt(
        data.promptText || 'Notice one moment of kindness in your child today.'
      );

    case 'weekly_activity':
      return TEMPLATES.weekly_activity(
        data.activityText || 'Ask your child: "What was one moment today that made you proud?"'
      );

    case 'general':
      // Pass isNewUser: true for unonboarded users to get the full intro.
      // Pass isNewUser: false (or omit) for returning users to get a short greeting.
      return data.isNewUser
        ? TEMPLATES.general()
        : TEMPLATES.general_returning_user();

    case 'daily_prompt_response':
      return TEMPLATES.daily_prompt_response();

    case 'bonding_activity_response':
      return TEMPLATES.bonding_activity_response();

    case 'non_text':
      return TEMPLATES.non_text();

    case 'safety':
      return TEMPLATES.safety();

    case 'extreme_distress':
      return TEMPLATES.extreme_distress();

    case 'upgrade_coming_soon':
    case 'upgrade':
      return TEMPLATES.upgrade_coming_soon();

    default:
      return null; // caller should fall back to full AI
  }
}

module.exports = { getTemplateResponse, TEMPLATES, pick };
