  },

  // ── Upgrade enquiry — parent typed UPGRADE ────────────────────────────────
  upgrade_coming_soon: () => {
    const variants = [
      `Thank you for your interest in Rootie Plus! 🌱💛\n\n*Rootie Plus is coming soon.* Here's what it will include:\n\n✨ *Unlimited parenting questions* — ask as much as you need, any time\n🧠 *Child Personality Blueprint* — responses personalised to your child's unique traits and temperament\n📈 *Monthly Growth Reports* — a beautiful summary of your child's moments, patterns, and growth over the month\n🔍 *Pattern Detection* — Rootie notices trends across your child's moments and gently highlights what's emerging\n🌱 *Priority support* — your questions always get the most thoughtful, in-depth responses\n\nWe'll let you know the moment it's ready. You'll be first in line. 💛`,
    ];
    return pick(variants);
  },
  // ── Non-text message ───────────────────────────────────────────────────────────────────
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
      case 'free_limit_first_time_plus_interest':
  return TEMPLATES.free_limit_first_time_plus_interest();

case 'free_limit_repeat_plus_interest':
  return TEMPLATES.free_limit_repeat_plus_interest();

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

    case 'activity_suggestion_thanks':
      return TEMPLATES.activity_suggestion_thanks();

    case 'bonding_activity_response':
      return TEMPLATES.bonding_activity_response();

    case 'weekend_activity_confirmed':
      return TEMPLATES.weekend_activity_confirmed();
       case 'weekend_activity_skipped':
      return TEMPLATES.weekend_activity_skipped();

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

    case 'reaction_only':
      return TEMPLATES.reaction_only();

    case 'evening_nudge_response':
      return TEMPLATES.evening_nudge_response();

    case 'open_question_response':
      return TEMPLATES.open_question_response();

    default:
      return null; // caller should fall back to full AI
  }
}

module.exports = { getTemplateResponse, TEMPLATES, pick };
