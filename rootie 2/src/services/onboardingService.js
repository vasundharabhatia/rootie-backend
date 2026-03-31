/**
 * Rootie — Onboarding Service
 *
 * Handles the multi-step onboarding flow for new parents.
 * State is stored in the `users` table (`onboarding_step`).
 * Temporary child data is stored in DB-backed flow sessions.
 *
 * Steps:
 *   0  → Welcome message, ask parent name
 *   1  → Save parent name, ask child name
 *   2  → Save child name, ask child age
 *   3  → Save child + age, ask optional personality description
 *   33 → (optional) AI extracts traits, saves them, ask "any more children?"
 *   4  → Ask "any more children?" (Yes → back to step 2, No → complete)
 *   55 → Timezone confirmation (when phone-prefix guess was low/medium/null)
 *   6  → Onboarding complete
 *
 * Scheduled messages fire at fixed times (10 AM morning, 6 PM evening) in
 * each user's own timezone — no reminder_hour preference is collected.
 *
 * The personality step (3b) is optional — parents can skip it with "skip",
 * "later", or a blank reply. It does NOT block onboarding progress.
 */

const { updateUser, getUserByPhone }                       = require('./userService');
const { createChild, updateChild, findPotentialDuplicateChild } = require('./childService');
const { setFlowSession, getFlowSession, clearFlowSession }  = require('./flowSessionService');
const { extractChildTraits }                               = require('./traitExtractorService');
const { parseBirthday, birthdayToDbFields, formatBirthdayDisplay } = require('./birthdayService');
const { logger }                                           = require('../utils/logger');

/**
 * Expanded phone-prefix → IANA timezone map.
 * Prefixes are sorted longest-first so more specific codes (e.g. '971') are
 * matched before shorter overlapping ones (e.g. '9').
 *
 * Confidence levels:
 *   'high'   — single timezone for the country (e.g. Singapore, UAE, India)
 *   'medium' — country spans 2–3 zones but one is dominant (e.g. UK, Germany)
 *   'low'    — large multi-timezone country; user must confirm (e.g. US, Canada, Australia, Brazil)
 */
const TIMEZONE_PREFIXES = [
  // ── 3-digit prefixes (most specific, check first) ──────────────────────
  { prefix: '971', tz: 'Asia/Dubai',            confidence: 'high'   }, // UAE
  { prefix: '966', tz: 'Asia/Riyadh',           confidence: 'high'   }, // Saudi Arabia
  { prefix: '965', tz: 'Asia/Kuwait',           confidence: 'high'   }, // Kuwait
  { prefix: '974', tz: 'Asia/Qatar',            confidence: 'high'   }, // Qatar
  { prefix: '973', tz: 'Asia/Bahrain',          confidence: 'high'   }, // Bahrain
  { prefix: '968', tz: 'Asia/Muscat',           confidence: 'high'   }, // Oman
  { prefix: '962', tz: 'Asia/Amman',            confidence: 'high'   }, // Jordan
  { prefix: '961', tz: 'Asia/Beirut',           confidence: 'high'   }, // Lebanon
  { prefix: '972', tz: 'Asia/Jerusalem',        confidence: 'high'   }, // Israel
  { prefix: '880', tz: 'Asia/Dhaka',            confidence: 'high'   }, // Bangladesh
  { prefix: '977', tz: 'Asia/Kathmandu',        confidence: 'high'   }, // Nepal
  { prefix: '234', tz: 'Africa/Lagos',          confidence: 'high'   }, // Nigeria
  { prefix: '254', tz: 'Africa/Nairobi',        confidence: 'high'   }, // Kenya
  { prefix: '233', tz: 'Africa/Accra',          confidence: 'high'   }, // Ghana
  { prefix: '255', tz: 'Africa/Dar_es_Salaam',  confidence: 'high'   }, // Tanzania
  { prefix: '256', tz: 'Africa/Kampala',        confidence: 'high'   }, // Uganda
  { prefix: '251', tz: 'Africa/Addis_Ababa',    confidence: 'high'   }, // Ethiopia
  { prefix: '212', tz: 'Africa/Casablanca',     confidence: 'high'   }, // Morocco
  { prefix: '213', tz: 'Africa/Algiers',        confidence: 'high'   }, // Algeria
  { prefix: '216', tz: 'Africa/Tunis',          confidence: 'high'   }, // Tunisia
  { prefix: '237', tz: 'Africa/Douala',         confidence: 'high'   }, // Cameroon
  // ── 2-digit prefixes ───────────────────────────────────────────────────
  { prefix: '91',  tz: 'Asia/Kolkata',          confidence: 'high'   }, // India
  { prefix: '92',  tz: 'Asia/Karachi',          confidence: 'high'   }, // Pakistan
  { prefix: '94',  tz: 'Asia/Colombo',          confidence: 'high'   }, // Sri Lanka
  { prefix: '95',  tz: 'Asia/Rangoon',          confidence: 'high'   }, // Myanmar
  { prefix: '60',  tz: 'Asia/Kuala_Lumpur',     confidence: 'high'   }, // Malaysia
  { prefix: '65',  tz: 'Asia/Singapore',        confidence: 'high'   }, // Singapore
  { prefix: '66',  tz: 'Asia/Bangkok',          confidence: 'high'   }, // Thailand
  { prefix: '84',  tz: 'Asia/Ho_Chi_Minh',      confidence: 'high'   }, // Vietnam
  { prefix: '63',  tz: 'Asia/Manila',           confidence: 'high'   }, // Philippines
  { prefix: '62',  tz: 'Asia/Jakarta',          confidence: 'medium' }, // Indonesia (multiple zones)
  { prefix: '82',  tz: 'Asia/Seoul',            confidence: 'high'   }, // South Korea
  { prefix: '81',  tz: 'Asia/Tokyo',            confidence: 'high'   }, // Japan
  { prefix: '86',  tz: 'Asia/Shanghai',         confidence: 'high'   }, // China
  { prefix: '98',  tz: 'Asia/Tehran',           confidence: 'high'   }, // Iran
  { prefix: '90',  tz: 'Europe/Istanbul',       confidence: 'high'   }, // Turkey
  { prefix: '20',  tz: 'Africa/Cairo',          confidence: 'high'   }, // Egypt
  { prefix: '27',  tz: 'Africa/Johannesburg',   confidence: 'high'   }, // South Africa
  { prefix: '44',  tz: 'Europe/London',         confidence: 'high'   }, // UK
  { prefix: '49',  tz: 'Europe/Berlin',         confidence: 'high'   }, // Germany
  { prefix: '33',  tz: 'Europe/Paris',          confidence: 'high'   }, // France
  { prefix: '34',  tz: 'Europe/Madrid',         confidence: 'high'   }, // Spain
  { prefix: '39',  tz: 'Europe/Rome',           confidence: 'high'   }, // Italy
  { prefix: '31',  tz: 'Europe/Amsterdam',      confidence: 'high'   }, // Netherlands
  { prefix: '32',  tz: 'Europe/Brussels',       confidence: 'high'   }, // Belgium
  { prefix: '41',  tz: 'Europe/Zurich',         confidence: 'high'   }, // Switzerland
  { prefix: '43',  tz: 'Europe/Vienna',         confidence: 'high'   }, // Austria
  { prefix: '46',  tz: 'Europe/Stockholm',      confidence: 'high'   }, // Sweden
  { prefix: '47',  tz: 'Europe/Oslo',           confidence: 'high'   }, // Norway
  { prefix: '45',  tz: 'Europe/Copenhagen',     confidence: 'high'   }, // Denmark
  { prefix: '48',  tz: 'Europe/Warsaw',         confidence: 'high'   }, // Poland
  { prefix: '55',  tz: 'America/Sao_Paulo',     confidence: 'low'    }, // Brazil (multiple zones)
  { prefix: '52',  tz: 'America/Mexico_City',   confidence: 'low'    }, // Mexico (multiple zones)
  { prefix: '54',  tz: 'America/Argentina/Buenos_Aires', confidence: 'high' }, // Argentina
  { prefix: '56',  tz: 'America/Santiago',      confidence: 'high'   }, // Chile
  { prefix: '57',  tz: 'America/Bogota',        confidence: 'high'   }, // Colombia
  { prefix: '51',  tz: 'America/Lima',          confidence: 'high'   }, // Peru
  { prefix: '58',  tz: 'America/Caracas',       confidence: 'high'   }, // Venezuela
  { prefix: '64',  tz: 'Pacific/Auckland',      confidence: 'high'   }, // New Zealand
  // ── 1-digit prefixes (least specific, check last) ──────────────────────
  { prefix: '1',   tz: 'America/New_York',      confidence: 'low'    }, // US/Canada (multiple zones)
  { prefix: '7',   tz: 'Europe/Moscow',         confidence: 'low'    }, // Russia (multiple zones)
  { prefix: '61',  tz: 'Australia/Sydney',      confidence: 'low'    }, // Australia (multiple zones)
];

/**
 * Guesses a user's timezone from their WhatsApp number's country code.
 * Returns { tz, confidence } or null if no match.
 * @param {string} whatsappNumber
 * @returns {{ tz: string, confidence: 'high'|'medium'|'low' }|null}
 */
function guessTimezone(whatsappNumber) {
  // Sort by prefix length descending so longer (more specific) prefixes match first
  const sorted = [...TIMEZONE_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const entry of sorted) {
    if (whatsappNumber.startsWith(entry.prefix)) {
      return { tz: entry.tz, confidence: entry.confidence };
    }
  }
  return null;
}

/**
 * Resolves a free-text city/country/timezone string to an IANA timezone.
 * Used in the timezone confirmation step.
 * @param {string} text
 * @returns {string|null}
 */
function resolveTimezoneFromText(text) {
  const t = text.trim().toLowerCase();
  const map = {
    // Cities
    'new york': 'America/New_York', 'los angeles': 'America/Los_Angeles',
    'chicago': 'America/Chicago', 'toronto': 'America/Toronto',
    'vancouver': 'America/Vancouver', 'london': 'Europe/London',
    'paris': 'Europe/Paris', 'berlin': 'Europe/Berlin',
    'dubai': 'Asia/Dubai', 'mumbai': 'Asia/Kolkata', 'delhi': 'Asia/Kolkata',
    'bangalore': 'Asia/Kolkata', 'kolkata': 'Asia/Kolkata',
    'karachi': 'Asia/Karachi', 'lahore': 'Asia/Karachi',
    'dhaka': 'Asia/Dhaka', 'singapore': 'Asia/Singapore',
    'kuala lumpur': 'Asia/Kuala_Lumpur', 'kl': 'Asia/Kuala_Lumpur',
    'bangkok': 'Asia/Bangkok', 'jakarta': 'Asia/Jakarta',
    'manila': 'Asia/Manila', 'tokyo': 'Asia/Tokyo', 'seoul': 'Asia/Seoul',
    'beijing': 'Asia/Shanghai', 'shanghai': 'Asia/Shanghai',
    'hong kong': 'Asia/Hong_Kong', 'sydney': 'Australia/Sydney',
    'melbourne': 'Australia/Melbourne', 'brisbane': 'Australia/Brisbane',
    'perth': 'Australia/Perth', 'auckland': 'Pacific/Auckland',
    'nairobi': 'Africa/Nairobi', 'lagos': 'Africa/Lagos',
    'johannesburg': 'Africa/Johannesburg', 'cairo': 'Africa/Cairo',
    'casablanca': 'Africa/Casablanca', 'riyadh': 'Asia/Riyadh',
    'tehran': 'Asia/Tehran', 'istanbul': 'Europe/Istanbul',
    'moscow': 'Europe/Moscow', 'sao paulo': 'America/Sao_Paulo',
    'buenos aires': 'America/Argentina/Buenos_Aires',
    'bogota': 'America/Bogota', 'lima': 'America/Lima',
    // Countries
    'india': 'Asia/Kolkata', 'pakistan': 'Asia/Karachi',
    'bangladesh': 'Asia/Dhaka', 'sri lanka': 'Asia/Colombo',
    'nepal': 'Asia/Kathmandu', 'uk': 'Europe/London',
    'united kingdom': 'Europe/London', 'england': 'Europe/London',
    'usa': 'America/New_York', 'us': 'America/New_York',
    'united states': 'America/New_York', 'america': 'America/New_York',
    'canada': 'America/Toronto', 'australia': 'Australia/Sydney',
    'new zealand': 'Pacific/Auckland', 'uae': 'Asia/Dubai',
    'emirates': 'Asia/Dubai', 'saudi': 'Asia/Riyadh',
    'saudi arabia': 'Asia/Riyadh', 'qatar': 'Asia/Qatar',
    'kuwait': 'Asia/Kuwait', 'bahrain': 'Asia/Bahrain',
    'oman': 'Asia/Muscat', 'jordan': 'Asia/Amman',
    'lebanon': 'Asia/Beirut', 'israel': 'Asia/Jerusalem',
    'egypt': 'Africa/Cairo', 'nigeria': 'Africa/Lagos',
    'kenya': 'Africa/Nairobi', 'ghana': 'Africa/Accra',
    'south africa': 'Africa/Johannesburg', 'ethiopia': 'Africa/Addis_Ababa',
    'tanzania': 'Africa/Dar_es_Salaam', 'uganda': 'Africa/Kampala',
    'malaysia': 'Asia/Kuala_Lumpur', 'indonesia': 'Asia/Jakarta',
    'philippines': 'Asia/Manila', 'thailand': 'Asia/Bangkok',
    'vietnam': 'Asia/Ho_Chi_Minh', 'myanmar': 'Asia/Rangoon',
    'china': 'Asia/Shanghai', 'japan': 'Asia/Tokyo',
    'south korea': 'Asia/Seoul', 'korea': 'Asia/Seoul',
    'turkey': 'Europe/Istanbul', 'iran': 'Asia/Tehran',
    'germany': 'Europe/Berlin', 'france': 'Europe/Paris',
    'spain': 'Europe/Madrid', 'italy': 'Europe/Rome',
    'netherlands': 'Europe/Amsterdam', 'belgium': 'Europe/Brussels',
    'switzerland': 'Europe/Zurich', 'austria': 'Europe/Vienna',
    'sweden': 'Europe/Stockholm', 'norway': 'Europe/Oslo',
    'denmark': 'Europe/Copenhagen', 'poland': 'Europe/Warsaw',
    'russia': 'Europe/Moscow', 'brazil': 'America/Sao_Paulo',
    'mexico': 'America/Mexico_City', 'argentina': 'America/Argentina/Buenos_Aires',
    'colombia': 'America/Bogota', 'chile': 'America/Santiago',
    'peru': 'America/Lima', 'venezuela': 'America/Caracas',
    'morocco': 'Africa/Casablanca', 'algeria': 'Africa/Algiers',
    'tunisia': 'Africa/Tunis',
    // IANA direct pass-through (if user types the IANA string)
  };

  if (map[t]) return map[t];

  // Try IANA direct (e.g. 'Asia/Kolkata')
  try {
    new Intl.DateTimeFormat('en', { timeZone: text.trim() }).format();
    return text.trim();
  } catch {
    return null;
  }
}

/**
 * Parses a user's free-text time input into a 24-hour integer (whole hour).
 * If the user supplies minutes (e.g. "9:30am"), the result is rounded to the
 * nearest whole hour so it aligns with the hourly scheduler.
 * @param {string} text
 * @returns {number|null}
 */
function parseHour(text) {
  const t = text.trim().toLowerCase();
  if (/\b(morning|morn)\b/.test(t))   return 8;
  if (/\b(afternoon|noon)\b/.test(t)) return 12;
  if (/\b(evening|eve)\b/.test(t))    return 18;
  if (/\b(night)\b/.test(t))          return 20;

  const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour    = parseInt(match[1], 10);
  const mins  = match[2] ? parseInt(match[2], 10) : 0;
  const ampm  = match[3];

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  // Round to nearest whole hour
  if (mins >= 30) hour += 1;
  if (hour > 23) hour = 0;  // midnight wrap
  if (hour < 0 || hour > 23) return null;

  return hour;
}

/**
 * Returns true if the parent's reply is a skip intent.
 */
function isSkipReply(text) {
  return /^(skip|later|no thanks|not now|maybe later|nope|n\/a|na|-)$/i.test(text.trim())
    || text.trim().length === 0;
}

async function handleOnboarding(user, messageText, displayName) {
  const text = messageText.trim();
  const step = user.onboarding_step;

  switch (step) {
    // ── Step 0: Welcome ──────────────────────────────────────────────────────
    case 0: {
      await updateUser(user.whatsapp_number, { onboarding_step: 1 });

      const introVariants = [
        `Hey! So glad you're here. 🌱

I'm Rootie — think of me as that friend who happens to know a lot about kids. I'm here for the everyday parenting stuff: the big feelings, the small wins, the moments you want to remember, and the ones you're not sure how to handle.

I'm made by Kind Roots, and my whole thing is helping you raise a kind, confident, emotionally resilient child — one small moment at a time.

Let's start simple. What's your name? 😊`,

        `Hi! I'm Rootie 🌱 — your parenting companion from Kind Roots.

I'm not here to give you a lecture or a long to-do list. I'm here to be the calm, always-available friend who helps you notice the good in your child, handle the tricky moments, and feel a little more confident in the everyday stuff.

Just message me whenever — I'm always here.

First things first — what do I call you? 😊`,

        `Hello! Welcome to Rootie 🌱

I'm your parenting companion from Kind Roots. Think of me like a knowledgeable friend you can message any time — whether you want to share a lovely moment your child had, ask for advice on something tricky, or just get a gentle nudge to stay connected.

No judgement, no pressure. Just support, whenever you need it.

What's your name? 😊`,
      ];

      return introVariants[Math.floor(Math.random() * introVariants.length)];
    }

    // ── Step 1: Save parent name, ask child name ─────────────────────────────
    case 1: {
      const parentName = text.length > 0 ? text : (displayName || 'there');

      await updateUser(user.whatsapp_number, {
        parent_name:      parentName,
        onboarding_step:  2,
      });

      return `Lovely to meet you, *${parentName}*! 🌸\n\nWhat's your child's name?`;
    }

    // ── Step 2: Save child name, ask age ─────────────────────────────────────
    case 2: {
      const childName = text.length > 0 ? text : 'your child';

      const duplicate = await findPotentialDuplicateChild(user.user_id, childName);
      if (duplicate) {
        return (
          `It looks like *${duplicate.child_name}* is already in your family profile. 🌱\n\n` +
          `If you meant the same child, reply with a different child's name.\n` +
          `If not, you can send a more distinct name like *Aarav S* or *Baby Aarav*.`
        );
      }

      await setFlowSession(user.user_id, 'onboarding', 'pending_child', { childName });
      await updateUser(user.whatsapp_number, { onboarding_step: 3 });

      return (
        `When is *${childName}*'s birthday? 🎂\n\n` +
        `You can share it any way you like — *12 March 2019*, *March 2019*, or just the year *2019*.\n` +
        `_(Reply *skip* if you'd rather not share)_`
      );
    }

    // ── Step 3: Save child + birthday, ask optional personality description ──
    case 3: {
      const session = await getFlowSession(user.user_id);

      if (!session || session.flow_type !== 'onboarding' || session.step !== 'pending_child') {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Let's add your child's name again 🌱\n\nWhat's your child's name?`;
      }

      const childName = session.data?.childName || 'Child';

      // ── Parse birthday input ──────────────────────────────────────────────
      const parsed = parseBirthday(text);

      // If completely unparseable (not a skip, not a date), ask for year as fallback
      if (!parsed) {
        // Store that we're now in the year-fallback sub-step
        await setFlowSession(user.user_id, 'onboarding', 'pending_child_year_fallback', { childName });
        await updateUser(user.whatsapp_number, { onboarding_step: 32 });
        return (
          `I didn't quite catch that. 😊\n\n` +
          `No worries — what year was *${childName}* born? _(e.g. *2019*)_\n` +
          `_(Or reply *skip* to move on)_`
        );
      }

      const dbFields = birthdayToDbFields(parsed);

      let newChild;
      try {
        newChild = await createChild(user.user_id, {
          childName,
          childAge:  dbFields.child_age  || null,
          childDob:  dbFields.child_dob  || null,
          birthYear: dbFields.birth_year || null,
        });
      } catch (error) {
        if (error.code === 'DUPLICATE_CHILD') {
          await clearFlowSession(user.user_id);
          await updateUser(user.whatsapp_number, { onboarding_step: 2 });
          return (
            `It looks like *${childName}* is already saved in your family profile. 🌱\n\n` +
            `Let's try again — what's the child's name?`
          );
        }
        throw error;
      }

      // Build a friendly confirmation of what was understood
      const birthdayLine = parsed.precision === 'skip'
        ? ''
        : `Birthday noted as *${formatBirthdayDisplay(newChild)}*. `;

      // Store child ID so the next step can save traits to the right record
      await setFlowSession(user.user_id, 'onboarding', 'pending_traits', {
        childName,
        childId: newChild.child_id,
      });

      await updateUser(user.whatsapp_number, { onboarding_step: 33 });

      return (
        `Got it. 🌱 I've added *${childName}* to your family. ${birthdayLine}\n\n` +
        `One quick thing — tell me a little about *${childName}*'s personality. ` +
        `What are they like? What are they good at? What do they find tricky?\n\n` +
        `Just talk to me like you would a friend. ` +
        `_(Or reply *skip* if you'd rather do this later)_`
      );
    }

    // ── Step 32: Year-only fallback (when birthday was unparseable) ───────────
    case 32: {
      const session = await getFlowSession(user.user_id);

      if (!session || session.flow_type !== 'onboarding') {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Let's add your child's name again 🌱\n\nWhat's your child's name?`;
      }

      const childName = session.data?.childName || 'Child';
      const parsed    = parseBirthday(text);

      // Accept year-only, month+year, or full date; or skip
      const dbFields  = parsed ? birthdayToDbFields(parsed) : {};

      let newChild;
      try {
        newChild = await createChild(user.user_id, {
          childName,
          childAge:  dbFields.child_age  || null,
          childDob:  dbFields.child_dob  || null,
          birthYear: dbFields.birth_year || null,
        });
      } catch (error) {
        if (error.code === 'DUPLICATE_CHILD') {
          await clearFlowSession(user.user_id);
          await updateUser(user.whatsapp_number, { onboarding_step: 2 });
          return (
            `It looks like *${childName}* is already saved in your family profile. 🌱\n\n` +
            `Let's try again — what's the child's name?`
          );
        }
        throw error;
      }

      await setFlowSession(user.user_id, 'onboarding', 'pending_traits', {
        childName,
        childId: newChild.child_id,
      });
      await updateUser(user.whatsapp_number, { onboarding_step: 33 });

      return (
        `Got it. 🌱 I've added *${childName}* to your family.\n\n` +
        `One quick thing — tell me a little about *${childName}*'s personality. ` +
        `What are they like? What are they good at? What do they find tricky?\n\n` +
        `Just talk to me like you would a friend. ` +
        `_(Or reply *skip* if you'd rather do this later)_`
      );
    }

    // ── Step 3b: Optional personality description (stored as 33 in DB) ─────────
    case 33: {
      const session = await getFlowSession(user.user_id);
      const childName = session?.data?.childName || 'your child';
      const childId   = session?.data?.childId   || null;

      if (!isSkipReply(text) && childId) {
        // Run AI extraction and save whatever was found
        try {
          const traits = await extractChildTraits(text);
          const toSave = {};
          if (traits.temperament)       toSave.temperament       = traits.temperament;
          if (traits.sensitivity_level) toSave.sensitivity_level = traits.sensitivity_level;
          if (traits.social_style)      toSave.social_style      = traits.social_style;
          if (traits.strengths)         toSave.strengths         = traits.strengths;
          if (traits.challenges)        toSave.challenges        = traits.challenges;

          if (Object.keys(toSave).length) {
            await updateChild(childId, toSave);
            logger.info('Onboarding: child traits saved', {
              userId: user.user_id,
              childId,
              childName,
              saved: JSON.stringify(toSave),
            });
          }
        } catch (err) {
          // Non-fatal — log and continue
          logger.warn('Onboarding: trait extraction failed, continuing', { error: err.message });
        }
      }

      // Either way, move on to "any more children?"
      await clearFlowSession(user.user_id);
      await updateUser(user.whatsapp_number, { onboarding_step: 4 });

      return `Do you have any other children to add? Reply *Yes* or *No*.`;
    }

    // ── Step 4: More children? ────────────────────────────────────────────────
    case 4: {
      const answer = text.trim().toLowerCase();

      if (['yes', 'y'].includes(answer)) {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `Great! What's your next child's name?`;
      }

      if (['no', 'n'].includes(answer)) {
        // No reminder_hour needed — messages fire at fixed times.
        // Detect timezone from phone prefix and complete or ask for city.
        const guess = guessTimezone(user.whatsapp_number);

        if (guess && guess.confidence === 'high') {
          // High-confidence → save timezone silently and complete onboarding
          await clearFlowSession(user.user_id);
          await updateUser(user.whatsapp_number, {
            onboarding_complete: true,
            onboarding_step:     6,
            timezone:            guess.tz,
          });

          logger.info('Onboarding complete (timezone auto-detected)', {
            userId: user.user_id, timezone: guess.tz,
          });

          const freshUser = await getUserByPhone(user.whatsapp_number);
          return (
            `You're all set, *${freshUser?.parent_name || 'there'}*! 🌟\n\n` +
            `I'll send you a little thought or activity a few times a week — ` +
            `mornings at *10 AM* and evenings at *6 PM* your time.\n\n` +
            `Here's what I can do for you:\n` +
            `• 📝 *Log moments* — share a small positive thing you noticed in your child and I'll save it to their story\n` +
            `• 💬 *Answer questions* — ask me anything about parenting, child behaviour, or development\n` +
            `• 🌱 *Send weekly prompts* — I'll nudge you with things to notice, try, and reflect on\n\n` +
            `What's on your mind? You can ask me a question, or share a moment you noticed today. 💛`
          );
        }

        // Medium/low confidence or no match → ask for city/country
        const guessLine = (guess && guess.confidence === 'medium')
          ? `I think you might be in *${guess.tz.replace(/_/g, ' ')}* — is that right? `
          : '';

        await updateUser(user.whatsapp_number, { onboarding_step: 55 });

        return (
          `Almost done! 🌱\n\n` +
          `${guessLine}` +
          `Just so I get the timing right — what city or country are you in? ` +
          `(e.g. *New York*, *Sydney*, *Lagos*, *India*)\n\n` +
          `_(Reply *skip* if you'd rather not share — I'll use a default)_`
        );
      }

      return `Please reply with *Yes* or *No* so I know whether to add another child. 🌱`;
    }

    // ── Step 55: Timezone confirmation (when phone-prefix guess was low/medium/null) ──
    case 55: {
      let timezone = 'UTC';

      if (!isSkipReply(text)) {
        const resolved = resolveTimezoneFromText(text);
        if (resolved) {
          timezone = resolved;
        } else {
          // Couldn't resolve — ask once more with a gentler prompt
          return (
            `Hmm, I didn't recognise that. 😊 Try something like *Singapore*, *London*, *Mumbai*, *New York*, or *Sydney*.\n\n` +
            `_(Or reply *skip* to use a default timezone)_`
          );
        }
      }

      await clearFlowSession(user.user_id);
      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step:     6,
        timezone,
      });

      logger.info('Onboarding complete (timezone confirmed by user)', {
        userId: user.user_id, timezone,
      });

      const freshUser = await getUserByPhone(user.whatsapp_number);
      return (
        `You're all set, *${freshUser?.parent_name || 'there'}*! 🌟\n\n` +
        `I'll send you a little thought or activity a few times a week — ` +
        `mornings at *10 AM* and evenings at *6 PM* your time.\n\n` +
        `Here's what I can do for you:\n` +
        `• 📝 *Log moments* — share a small positive thing you noticed in your child and I'll save it to their story\n` +
        `• 💬 *Answer questions* — ask me anything about parenting, child behaviour, or development\n` +
        `• 🌱 *Send weekly prompts* — I'll nudge you with things to notice, try, and reflect on\n\n` +
        `What's on your mind? You can ask me a question, or share a moment you noticed today. 💛`
      );
    }

    default: {
      logger.warn('Onboarding in unexpected step', { userId: user.user_id, step });
      await clearFlowSession(user.user_id);
      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step:     6,
      });
      return `Welcome back! 🌱 What's on your mind today?`;
    }
  }
}

module.exports = {
  handleOnboarding,
  guessTimezone,
  resolveTimezoneFromText,
  parseHour,
};
