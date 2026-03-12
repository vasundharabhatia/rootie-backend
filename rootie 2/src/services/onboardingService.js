/**
 * Rootie — Onboarding Service
 *
 * Handles the first-time setup flow for new parents.
 * Collects parent name, child name(s), child age(s), and preferred reminder time.
 * Timezone is auto-detected from the WhatsApp phone number's country code.
 * Supports multiple children.
 *
 * Steps:
 *   0 → Send welcome message, ask for parent name
 *   1 → Save parent name, ask for first child's name
 *   2 → Save child name, ask for child's age
 *   3 → Save child age, ask if there are more children
 *   4 → If yes → ask for next child name (loops back to step 2 logic)
 *       If no  → ask for preferred reminder time
 *   5 → Save reminder time + timezone → complete onboarding
 *
 * State is tracked via user.onboarding_step in the DB.
 * Temporary child data is stored in a simple in-memory map keyed by user_id
 * (safe for MVP; replace with DB column for multi-instance deployments).
 */

const { updateUser }  = require('./userService');
const { createChild } = require('./childService');
const { logger }      = require('../utils/logger');

// ─── Timezone detection from WhatsApp country code ───────────────────────────
// Maps ISO 3166-1 alpha-2 country codes → IANA timezone.
// Uses the most common/representative timezone for each country.
const COUNTRY_TIMEZONES = {
  // South Asia
  IN: 'Asia/Kolkata',
  PK: 'Asia/Karachi',
  LK: 'Asia/Colombo',
  BD: 'Asia/Dhaka',
  NP: 'Asia/Kathmandu',
  // Middle East
  AE: 'Asia/Dubai',
  SA: 'Asia/Riyadh',
  QA: 'Asia/Qatar',
  KW: 'Asia/Kuwait',
  BH: 'Asia/Bahrain',
  OM: 'Asia/Muscat',
  // Southeast Asia
  SG: 'Asia/Singapore',
  MY: 'Asia/Kuala_Lumpur',
  PH: 'Asia/Manila',
  ID: 'Asia/Jakarta',
  TH: 'Asia/Bangkok',
  // East Asia
  CN: 'Asia/Shanghai',
  JP: 'Asia/Tokyo',
  KR: 'Asia/Seoul',
  HK: 'Asia/Hong_Kong',
  // Oceania
  AU: 'Australia/Sydney',
  NZ: 'Pacific/Auckland',
  // Europe
  GB: 'Europe/London',
  IE: 'Europe/Dublin',
  DE: 'Europe/Berlin',
  FR: 'Europe/Paris',
  NL: 'Europe/Amsterdam',
  ES: 'Europe/Madrid',
  IT: 'Europe/Rome',
  PT: 'Europe/Lisbon',
  SE: 'Europe/Stockholm',
  NO: 'Europe/Oslo',
  DK: 'Europe/Copenhagen',
  FI: 'Europe/Helsinki',
  PL: 'Europe/Warsaw',
  CH: 'Europe/Zurich',
  AT: 'Europe/Vienna',
  BE: 'Europe/Brussels',
  // Americas
  US: 'America/New_York',
  CA: 'America/Toronto',
  MX: 'America/Mexico_City',
  BR: 'America/Sao_Paulo',
  AR: 'America/Argentina/Buenos_Aires',
  CO: 'America/Bogota',
  CL: 'America/Santiago',
  // Africa
  ZA: 'Africa/Johannesburg',
  NG: 'Africa/Lagos',
  KE: 'Africa/Nairobi',
  GH: 'Africa/Accra',
  EG: 'Africa/Cairo',
};

// Phone number prefix → ISO country code (covers most WhatsApp markets)
const PREFIX_TO_COUNTRY = {
  '91':  'IN',  // India
  '92':  'PK',  // Pakistan
  '94':  'LK',  // Sri Lanka
  '880': 'BD',  // Bangladesh
  '977': 'NP',  // Nepal
  '971': 'AE',  // UAE
  '966': 'SA',  // Saudi Arabia
  '974': 'QA',  // Qatar
  '965': 'KW',  // Kuwait
  '973': 'BH',  // Bahrain
  '968': 'OM',  // Oman
  '65':  'SG',  // Singapore
  '60':  'MY',  // Malaysia
  '63':  'PH',  // Philippines
  '62':  'ID',  // Indonesia
  '66':  'TH',  // Thailand
  '86':  'CN',  // China
  '81':  'JP',  // Japan
  '82':  'KR',  // South Korea
  '852': 'HK',  // Hong Kong
  '61':  'AU',  // Australia
  '64':  'NZ',  // New Zealand
  '44':  'GB',  // UK
  '353': 'IE',  // Ireland
  '49':  'DE',  // Germany
  '33':  'FR',  // France
  '31':  'NL',  // Netherlands
  '34':  'ES',  // Spain
  '39':  'IT',  // Italy
  '351': 'PT',  // Portugal
  '46':  'SE',  // Sweden
  '47':  'NO',  // Norway
  '45':  'DK',  // Denmark
  '358': 'FI',  // Finland
  '48':  'PL',  // Poland
  '41':  'CH',  // Switzerland
  '43':  'AT',  // Austria
  '32':  'BE',  // Belgium
  '1':   'US',  // US / Canada (default to US Eastern)
  '52':  'MX',  // Mexico
  '55':  'BR',  // Brazil
  '54':  'AR',  // Argentina
  '57':  'CO',  // Colombia
  '56':  'CL',  // Chile
  '27':  'ZA',  // South Africa
  '234': 'NG',  // Nigeria
  '254': 'KE',  // Kenya
  '233': 'GH',  // Ghana
  '20':  'EG',  // Egypt
};

/**
 * Guess the IANA timezone from a WhatsApp number (digits only, no +).
 * Tries 3-digit prefix first, then 2-digit, then 1-digit.
 * Falls back to 'UTC' if unknown.
 */
function guessTimezone(whatsappNumber) {
  const digits = whatsappNumber.replace(/\D/g, '');
  for (const len of [3, 2, 1]) {
    const prefix  = digits.slice(0, len);
    const country = PREFIX_TO_COUNTRY[prefix];
    if (country && COUNTRY_TIMEZONES[country]) {
      return COUNTRY_TIMEZONES[country];
    }
  }
  return 'UTC';
}

/**
 * Parse a user's free-text time preference into a 0–23 hour integer.
 * Accepts: "8", "8am", "8 am", "8:00", "8:00 am", "20:00", "8pm", "evening" etc.
 * Returns null if unparseable.
 */
function parseHour(text) {
  const t = text.trim().toLowerCase();

  // Named slots
  if (/\b(morning|morn)\b/.test(t))   return 8;
  if (/\b(afternoon|noon)\b/.test(t)) return 12;
  if (/\b(evening|eve)\b/.test(t))    return 18;
  if (/\bnight\b/.test(t))            return 20;

  // Numeric: "8", "8am", "8 am", "8:00", "8:00am", "20", "20:00"
  const match = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/);
  if (!match) return null;

  let hour = parseInt(match[1], 10);
  const ampm = match[3];

  if (ampm === 'pm' && hour < 12) hour += 12;
  if (ampm === 'am' && hour === 12) hour = 0;

  if (hour < 0 || hour > 23) return null;
  return hour;
}

// Temporary in-memory store for "child being added" during onboarding
// Key: user_id, Value: { child_name: string }
const pendingChild = new Map();

async function handleOnboarding(user, messageText, displayName = '') {
  const step = user.onboarding_step;
  const text = messageText.trim();

  switch (step) {

    // ── Step 0: Welcome + ask for parent name ────────────────────────────
    case 0: {
      await updateUser(user.whatsapp_number, { onboarding_step: 1 });
      return (
        `Hi! I'm *Rootie* from Kind Roots 🌱\n\n` +
        `I help parents raise kind, confident, and emotionally intelligent children ` +
        `through small daily moments and positive moment tracking.\n\n` +
        `Let's get started! What's your name? 😊`
      );
    }

    // ── Step 1: Save parent name + ask for child name ────────────────────
    case 1: {
      const parentName = text.length > 0 ? text : (displayName || 'there');
      await updateUser(user.whatsapp_number, {
        parent_name:    parentName,
        onboarding_step: 2,
      });
      return (
        `Lovely to meet you, *${parentName}*! 🌸\n\n` +
        `What's your child's name?`
      );
    }

    // ── Step 2: Save child name + ask for age ────────────────────────────
    case 2: {
      const childName = text.length > 0 ? text : 'your child';
      pendingChild.set(user.user_id, { child_name: childName });
      await updateUser(user.whatsapp_number, { onboarding_step: 3 });
      return `How old is *${childName}*? (Just type the age, e.g. *5*)`;
    }

    // ── Step 3: Save child age + ask if more children ────────────────────
    case 3: {
      const pending  = pendingChild.get(user.user_id) || {};
      const age      = parseInt(text, 10);
      const childAge = isNaN(age) ? null : age;

      await createChild(user.user_id, {
        childName:  pending.child_name || 'Child',
        childAge,
      });
      pendingChild.delete(user.user_id);

      await updateUser(user.whatsapp_number, { onboarding_step: 4 });
      return (
        `Wonderful! 🌱 I've added *${pending.child_name || 'your child'}* to your Kind Roots family.\n\n` +
        `Do you have any other children you'd like to add?\n\n` +
        `Reply *Yes* to add another child, or *No* to continue.`
      );
    }

    // ── Step 4: More children? → if no, ask for preferred reminder time ──
    case 4: {
      const answer = text.toLowerCase();

      if (answer.startsWith('y') || answer === 'yes') {
        await updateUser(user.whatsapp_number, { onboarding_step: 2 });
        return `What's the name of your next child?`;
      }

      // Move to reminder time step
      await updateUser(user.whatsapp_number, { onboarding_step: 5 });
      return (
        `Almost done! One last thing 🌱\n\n` +
        `I'll send you a small noticing challenge twice a week, a gentle nudge mid-week, ` +
        `and a fun family activity on weekends.\n\n` +
        `*What time works best for you to receive these?*\n\n` +
        `Just reply with a time like *8am*, *7:30am*, or *evening* — whatever fits your morning routine best. 💛`
      );
    }

    // ── Step 5: Save reminder time + timezone → complete onboarding ──────
    case 5: {
      const hour     = parseHour(text);
      const timezone = guessTimezone(user.whatsapp_number);

      // If we can't parse the time, ask again gently
      if (hour === null) {
        return (
          `I didn't quite catch that 😊\n\n` +
          `Could you reply with a time like *8am*, *7:30am*, *9*, or *evening*?`
        );
      }

      // Format the hour nicely for the confirmation message
      const displayHour = hour === 0 ? '12:00 AM'
        : hour < 12  ? `${hour}:00 AM`
        : hour === 12 ? '12:00 PM'
        : `${hour - 12}:00 PM`;

      await updateUser(user.whatsapp_number, {
        onboarding_complete: true,
        onboarding_step:     6,
        reminder_hour:       hour,
        timezone,
      });

      logger.info('Onboarding complete', {
        userId:       user.user_id,
        timezone,
        reminderHour: hour,
      });

      return (
        `You're all set, *${user.parent_name || 'there'}*! 🌟\n\n` +
        `I'll send your weekly prompts and activities at *${displayHour}* your time. ` +
        `You can always just message me to change it.\n\n` +
        `Here's what Rootie can do for you:\n\n` +
        `🌱 *Log moments* — Share something kind or brave your child did\n` +
        `💬 *Ask questions* — Get parenting guidance (5 questions/day on the free plan)\n` +
        `📅 *Weekly prompts* — A small noticing challenge, twice a week\n` +
        `🎯 *Weekend activities* — A 5-minute bonding activity every weekend\n\n` +
        `Try it now — share a moment you noticed in your child today! 💛`
      );
    }

    default: {
      // Should not reach here — mark as complete if somehow stuck
      logger.warn('Onboarding in unexpected step', { userId: user.user_id, step });
      await updateUser(user.whatsapp_number, { onboarding_complete: true, onboarding_step: 6 });
      return `Welcome back! 🌱 What's on your mind today?`;
    }
  }
}

module.exports = { handleOnboarding, guessTimezone, parseHour };
