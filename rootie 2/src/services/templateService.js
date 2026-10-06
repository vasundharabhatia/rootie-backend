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
  free_limit_first_time_plus_interest: () => {
  return `You've used today's 5 free parenting questions. 🌱

*Rootie Plus is coming soon* and it will include:
✨ Unlimited parenting questions
🧠 More personalised guidance based on your child
📈 Monthly growth reports
🔍 Pattern detection across your child's moments

I've marked that you're interested in *Rootie Plus* and I'll keep you posted when it launches. 💛

Until then, you can still log *unlimited child moments* anytime — that's always free.`;
},
  free_limit_repeat_plus_interest: () => {
  return `You've reached today's free question limit again. 🌱

We've already noted that you're interested in *Rootie Plus*, and that'll be the best fit once it launches. 💛

For now, come back tomorrow to ask more parenting questions.

You can still log *unlimited child moments* anytime — that part stays free.`;
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
