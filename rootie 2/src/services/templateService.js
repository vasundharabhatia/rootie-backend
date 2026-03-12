/**
 * Rootie — Template Response Engine
 *
 * Every scenario has multiple response variants.
 * pick() randomly selects one each time — so parents never see the same
 * reply twice in a row.
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
  general: () => {
    const variants = [
      `Hi there! I'm Rootie. 🌱 A calm little space for parents to notice the good things and get a bit of support.\n\nYou can share a moment you noticed in your child, or ask me a parenting question. What's on your mind? 💛`,
      `Hello! I'm Rootie. 🌱 I'm here to help you track the small, positive moments in your child's life, or to help with parenting questions.\n\nWhat would you like to do? 💛`,
    ];
    return pick(variants);
  },

  // ── General (returning, already onboarded user) ───────────────────────────────
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

  // ── Weekend Activity: Monday Follow-up ───────────────────────────────────────
  weekend_activity_followup: () => {
    const variants = [
      `Good morning! ☀️ Just a little nudge to see if you had a chance to try the weekend activity? (Yes/No)`,
      `Morning! 🌱 Just following up on the weekend activity — were you able to give it a try? (Yes/No)`,
      `Hello! Hope you had a good weekend. 💛 Did you get a chance to do the little activity I sent? (Yes/No)`,
    ];
    return pick(variants);
  },

  // ── Weekend Activity: Confirmed Completion ───────────────────────────────────
  weekend_activity_confirmed: () => {
    const variants = [
      `That's wonderful! I've marked it as complete. 🌱 Every little moment of connection builds something beautiful. 💛`,
      `Amazing! So glad you had a chance to do it. 💛 I've logged it. Keep up the wonderful work. 🌱`,
      `I love to hear that! Thank you for making the time. 🌱 That connection is what it's all about. 💛`,
    ];
    return pick(variants);
  },

  // ── Connection Awards (Weekend Activity Milestones) ──────────────────────────
  award_milestone_3: () => {
    return (
      `That's wonderful! And I've just noticed something...\n\n` +
      `You've completed 3 weekend activities! 🎉\n\n` +
      `In recognition of your commitment to building connection, you've earned your first Connection Award: *The Spark Starter* ✨\n\n` +
      `You're not just doing activities; you're intentionally creating small, powerful moments of connection that your child will carry with them for life. That's incredible work. Keep going. 💛`
    );
  },

  award_milestone_6: () => {
    return (
      `Amazing! And I have some lovely news...\n\n` +
      `That's 6 weekend activities completed! 🎉\n\n` +
      `For your consistent effort in strengthening your family bond, you've earned the *Bridge Builder* award 🌉\n\n` +
      `You're turning small moments into a steady, reliable bridge of connection that your child can always count on. Thank you for the beautiful work you're doing. 🌱`
    );
  },

  award_milestone_9: () => {
    return (
      `I love hearing that! And I've just spotted a new milestone...\n\n` +
      `You've now completed 9 weekend activities! 🎉\n\n` +
      `For weaving connection into the fabric of your family life, you've earned the *Heart Weaver* award 🧶\n\n` +
      `These aren't just separate moments anymore; they're threads in a beautiful, strong tapestry of love and trust you're creating every day. This is how lifelong security is built. 💛`
    );
  },

  award_milestone_12: () => {
    return (
      `That's fantastic! And I have to share this with you...\n\n` +
      `You've completed 12 weekend activities! 🎉\n\n` +
      `For your incredible dedication to creating lasting family memories, you've earned the *Memory Maker* award 📸\n\n` +
      `You're doing more than just spending time; you're building a library of positive memories that will shape your child's sense of self and belonging for years to come. This is a profound gift. 🌱`
    );
  },

  award_milestone_15: () => {
    return (
      `Wonderful! And look at this incredible achievement...\n\n` +
      `That's 15 weekend activities completed! 🎉\n\n` +
      `For your leadership and unwavering focus on what matters most, you've earned our highest honor: *The Connection Captain* 🚢\n\n` +
      `You are steering your family with intention, navigating the everyday with a compass pointed firmly at connection. This is the heart of it all. Thank you for letting me be a small part of your journey. 💛`
    );
  },

  // ── Upgrade enquiry — parent typed UPGRADE ────────────────────────────────
  upgrade_coming_soon: () => {
    const variants = [
      `Thank you for your interest in Rootie Plus! 🌱💛\n\n*Rootie Plus is coming soon.* Here's what it will include:\n\n✨ *Unlimited parenting questions* — ask as much as you need, any time\n🧠 *Child Personality Blueprint* — responses personalised to your child's unique traits and temperament\n📈 *Monthly Growth Reports* — a beautiful summary of your child's moments, patterns, and growth over the month\n🔍 *Pattern Detection* — Rootie notices trends across your child's moments and gently highlights what's emerging\n🌱 *Priority support* — your questions always get the most thoughtful, in-depth responses\n\nWe'll let you know the moment it's ready. You'll be first in line. 💛`,
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
  safety: () => {
    const variants = [
      `I hear you, and I want you to know you're not alone. 💛\n\nWhat you're feeling matters. If you or someone around you is in immediate danger, please reach out to your local emergency services or a crisis helpline in your area.\n\nI'm here for parenting support — but right now, please make sure you're safe first. 🌱`,
    ];
    return pick(variants);
  },

  // ── Extreme distress — rage, extreme language, severe emotional crisis ────────
  extreme_distress: () => {
    const variants = [
      `I can hear that things feel really overwhelming right now. 💛\n\nWhen we're at our limit, it helps to step away for just a moment — even 60 seconds in another room.\n\nIf you feel like you or your child might be at risk, please reach out to someone who can be with you right now. You don't have to handle this alone. 🌱`,
    ];
    return pick(variants);
  },

};

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Get a randomly selected template response for the given type.
 * Returns null if no template exists (caller falls back to full AI).
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
      return data.isNewUser
        ? TEMPLATES.general()
        : TEMPLATES.general_returning_user();

    case 'daily_prompt_response':
      return TEMPLATES.daily_prompt_response();

    case 'bonding_activity_response':
      return TEMPLATES.bonding_activity_response();

    case 'weekend_activity_followup':
      return TEMPLATES.weekend_activity_followup();

    case 'weekend_activity_confirmed':
      return TEMPLATES.weekend_activity_confirmed();

    case 'award_milestone_3':
      return TEMPLATES.award_milestone_3();

    case 'award_milestone_6':
      return TEMPLATES.award_milestone_6();

    case 'award_milestone_9':
      return TEMPLATES.award_milestone_9();

    case 'award_milestone_12':
      return TEMPLATES.award_milestone_12();

    case 'award_milestone_15':
      return TEMPLATES.award_milestone_15();

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
