/**
 * Rootie — Template Response Engine
 *
 * Every scenario has multiple response variants.
 * pick() randomly selects one each time — so parents never see the same
 * reply twice in a row.
 *
 * Scenarios covered:
 *   moment_logged            — parent shared a positive child moment
 *   child_selection_needed   — multiple children, unclear which one
 *   free_limit_reached       — free user hit daily question limit
 *   daily_prompt             — outbound daily noticing challenge
 *   weekly_activity          — outbound weekly bonding activity
 *   general                  — greeting, thanks, or general chat
 *   daily_prompt_response    — parent replied to a daily prompt
 *   bonding_activity_response— parent replied to a weekly activity
 *   non_text                 — image, audio, or video received
 *   safety                   — crisis keywords detected (generic, no numbers)
 *   extreme_distress         — extreme language, rage, or severe distress
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
    const label = category ? category.replace('_', ' ') : 'beautiful';
    const child = childName ? `*${childName}*` : 'your child';

    const variants = [
      `That's a beautiful ${label} moment ${emoji}\n\nI've saved it to ${child}'s Kind Roots journey. These small moments are the ones that matter most. 🌱`,
      `What a lovely thing to notice ${emoji}\n\n${child}'s ${label} moment has been added to their journey. You're paying attention — and that makes all the difference. 💛`,
      `I love that you caught that ${emoji}\n\nA moment of ${label} — saved. ${child} is growing in ways you might not always see, but you're seeing them. 🌱`,
      `That's one to remember ${emoji}\n\n${child}'s ${label} moment is now part of their Kind Roots story. Keep noticing — it adds up beautifully. 💛`,
      `Beautiful ${emoji}\n\nI've logged that ${label} moment for ${child}. Every time you notice, you're telling them: *"I see you."* That's powerful parenting. 🌱`,
    ];
    return pick(variants);
  },

  // ── Child unclear ────────────────────────────────────────────────────────────
  child_selection_needed: () => {
    const variants = [
      `That sounds like a lovely moment! 🌱\n\nWhich of your children are you referring to?`,
      `I'd love to save that moment! 💛\n\nCould you tell me which child this is about?`,
      `What a beautiful thing to share 🌱\n\nJust so I can save it correctly — which child are you talking about?`,
      `I want to make sure I log this for the right little one 💛\n\nWhich child was this?`,
    ];
    return pick(variants);
  },

  // ── Free plan limit reached ──────────────────────────────────────────────────
  free_limit_reached: () => {
    const variants = [
      `You've used all 5 of today's questions 🌱\n\n*Rootie Plus* gives you unlimited parenting guidance, personalised to your child's personality and age.\n\nReply *UPGRADE* to learn more, or I'll be here again tomorrow! 💛`,
      `You've reached your 5 daily questions for today 💛\n\nWith *Rootie Plus*, every question gets a personalised answer — no limits, no waiting.\n\nReply *UPGRADE* to unlock it, or come back tomorrow. 🌱`,
      `That's all 5 of today's questions used up 🌱\n\nWant more? *Rootie Plus* gives you unlimited access to personalised parenting support.\n\nReply *UPGRADE* to find out more. See you tomorrow! 💛`,
      `You've asked 5 questions today — that's today's free allowance 💛\n\nYou can still log moments and respond to today's prompt — those are always free.\n\nReply *UPGRADE* for unlimited questions with *Rootie Plus*. 🌱`,
    ];
    return pick(variants);
  },

  // ── Daily prompt (outbound) ──────────────────────────────────────────────────
  daily_prompt: (promptText) => {
    const variants = [
      `*Kind Roots Moment* 🌱\n\n${promptText}`,
      `*Your Kind Roots Noticing Challenge* 🌱\n\n${promptText}`,
      `*Today's Moment to Notice* 🌱\n\n${promptText}`,
      `*Kind Roots — Daily Noticing* 🌱\n\n${promptText}`,
    ];
    return pick(variants);
  },

  // ── Weekly bonding activity (outbound) ───────────────────────────────────────
  weekly_activity: (activityText) => {
    const variants = [
      `*Weekend Kind Roots Activity* 🌱\n\n${activityText}`,
      `*This Week's Bonding Moment* 🌱\n\n${activityText}`,
      `*Kind Roots — Weekly Activity* 🌱\n\n${activityText}`,
      `*A Little Something for This Weekend* 🌱\n\n${activityText}`,
    ];
    return pick(variants);
  },

  // ── General (greeting, thanks, general chat) ─────────────────────────────────
  general: () => {
    const variants = [
      `Hi there! 🌱 I'm Rootie, your parenting companion from Kind Roots.\n\nYou can:\n• Share a moment you noticed in your child\n• Ask a parenting question\n• Reply to today's daily prompt\n\nWhat's on your mind today? 💛`,
      `Hello! 💛 Rootie here — your calm corner for parenting support.\n\nFeel free to:\n• Log a positive moment you noticed\n• Ask me a parenting question\n• Share how today went\n\nI'm listening. 🌱`,
      `Good to hear from you! 🌱\n\nI'm Rootie — here to help you notice, celebrate, and navigate the beautiful chaos of parenting.\n\nShare a moment, ask a question, or just tell me how things are going. 💛`,
      `Hey! 💛 I'm Rootie from Kind Roots.\n\nHere to help with:\n• Logging positive moments in your child's day\n• Parenting questions and gentle guidance\n• Weekly bonding activities\n\nWhat would you like to do today? 🌱`,
    ];
    return pick(variants);
  },

  // ── Daily prompt response ────────────────────────────────────────────────────
  daily_prompt_response: () => {
    const variants = [
      `Thank you for sharing that 🌱 Every moment of noticing matters. You're doing beautifully. 💛`,
      `I love that you took a moment to notice 💛 That awareness is one of the most powerful things a parent can offer. 🌱`,
      `That's wonderful 🌱 The fact that you're paying attention — really paying attention — says so much about the parent you are. 💛`,
      `Beautiful 💛 Noticing is the first step to everything. You're building something meaningful, one moment at a time. 🌱`,
      `Thank you for that 🌱 Small moments like this are the ones children carry with them. You're doing great. 💛`,
    ];
    return pick(variants);
  },

  // ── Bonding activity response ────────────────────────────────────────────────
  bonding_activity_response: () => {
    const variants = [
      `That's wonderful to hear! 🌱 Those conversations stay with children long after they happen. You're building something beautiful together. 💛`,
      `I love hearing that 💛 Time like that — unhurried, present — is exactly what children remember. Well done. 🌱`,
      `That sounds like a really special moment 🌱 You showed up, and that's everything. 💛`,
      `What a lovely thing to do together 💛 Connection like that is the foundation of everything. Keep going. 🌱`,
      `That's the kind of memory that lasts 🌱 Thank you for making the time. Your child felt it. 💛`,
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
      `I can only read text messages right now 😊 Please type your message and I'll help!`,
      `I'm not able to open that just yet 😊 Send me a text message and I'll be right with you!`,
      `I work best with text for now 🌱 Type out what's on your mind and I'll respond!`,
      `I can't read that format yet 😊 But if you type it out, I'm all ears! 💛`,
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
 * @param {object} [data] — optional data: { childName, category, promptText, activityText }
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
      return TEMPLATES.general();

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
