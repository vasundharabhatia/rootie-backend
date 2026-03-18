/**
 * Rootie — Birthday Service
 *
 * Parses a parent's free-text birthday input into structured date data,
 * and derives a child's current age from stored birthday information.
 *
 * Supported input formats (all case-insensitive):
 *   Full date:
 *     "12 March 2019"        → { dob: Date(2019-03-12), year: 2019, precision: 'full' }
 *     "March 12, 2019"       → same
 *     "12/03/2019"           → same (DD/MM/YYYY)
 *     "03/12/2019"           → same (MM/DD/YYYY — ambiguous, treated as DD/MM)
 *     "2019-03-12"           → same (ISO)
 *     "12th March 2019"      → same
 *     "12 Mar 19"            → same (2-digit year)
 *
 *   Month + year only:
 *     "March 2019"           → { dob: null, year: 2019, month: 3, precision: 'month_year' }
 *     "Mar 2019"             → same
 *     "03/2019"              → same
 *
 *   Year only:
 *     "2019"                 → { dob: null, year: 2019, precision: 'year_only' }
 *     "born in 2019"         → same
 *     "2019 born"            → same
 *
 *   Skip / refusal:
 *     "skip", "later", "no", "don't want to share", etc.
 *     → { precision: 'skip' }
 *
 * Returns null if the input cannot be parsed at all.
 *
 * Age calculation:
 *   - Full date: exact age in years
 *   - Month + year: age accurate to within ±1 month
 *   - Year only: age as current year minus birth year (may be off by 1)
 */

const MONTH_MAP = {
  jan: 1, january: 1,
  feb: 2, february: 2,
  mar: 3, march: 3,
  apr: 4, april: 4,
  may: 5,
  jun: 6, june: 6,
  jul: 7, july: 7,
  aug: 8, august: 8,
  sep: 9, sept: 9, september: 9,
  oct: 10, october: 10,
  nov: 11, november: 11,
  dec: 12, december: 12,
};

const SKIP_PATTERNS = [
  /^(skip|later|no|nope|n\/a|na|pass|not now|no thanks|prefer not|rather not|private|secret|-)$/i,
  /don.?t\s+(want|share|like)/i,
  /prefer\s+not/i,
  /rather\s+not/i,
];

/**
 * Normalise a 2-digit year to 4 digits.
 * Years 00–29 → 2000–2029, 30–99 → 1930–1999.
 */
function expandYear(y) {
  if (y >= 100) return y;
  return y <= 29 ? 2000 + y : 1900 + y;
}

/**
 * Build a JS Date safely, returning null if the date is invalid.
 */
function safeDate(year, month, day) {
  // month is 1-based here
  const d = new Date(year, month - 1, day);
  if (
    d.getFullYear() !== year ||
    d.getMonth() !== month - 1 ||
    d.getDate() !== day
  ) return null;
  return d;
}

/**
 * Calculate age in whole years from a full Date object.
 */
function ageFromDate(dob) {
  const now     = new Date();
  let   age     = now.getFullYear() - dob.getFullYear();
  const m       = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age < 0 ? 0 : age;
}

/**
 * Calculate approximate age from year + month (1-based).
 */
function ageFromMonthYear(year, month) {
  const now = new Date();
  let age   = now.getFullYear() - year;
  if (now.getMonth() + 1 < month) age--;
  return age < 0 ? 0 : age;
}

/**
 * Calculate approximate age from birth year only.
 */
function ageFromYear(year) {
  const age = new Date().getFullYear() - year;
  return age < 0 ? 0 : age;
}

/**
 * Parse a parent's free-text birthday input.
 *
 * @param {string} text
 * @returns {object|null}
 *   { precision: 'full',         dob: Date,  year: number, month: number, day: number, age: number }
 *   { precision: 'month_year',   dob: null,  year: number, month: number,              age: number }
 *   { precision: 'year_only',    dob: null,  year: number,                              age: number }
 *   { precision: 'skip' }
 *   null  — unparseable
 */
function parseBirthday(text) {
  if (!text || !text.trim()) return null;

  const raw = text.trim();

  // ── Skip / refusal ──────────────────────────────────────────────────────
  if (SKIP_PATTERNS.some(rx => rx.test(raw))) {
    return { precision: 'skip' };
  }

  const lower = raw.toLowerCase().replace(/[,\-\/\.]/g, ' ').replace(/\s+/g, ' ').trim();

  // ── Full date: DD Month YYYY or Month DD YYYY ───────────────────────────
  // e.g. "12 March 2019", "March 12 2019", "12th March 2019"
  const fullNamedMonth = lower.match(
    /^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)\s+(\d{2,4})$|^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\s+(\d{2,4})$/
  );
  if (fullNamedMonth) {
    let day, monthStr, yearRaw;
    if (fullNamedMonth[1]) {
      day      = parseInt(fullNamedMonth[1], 10);
      monthStr = fullNamedMonth[2];
      yearRaw  = parseInt(fullNamedMonth[3], 10);
    } else {
      monthStr = fullNamedMonth[4];
      day      = parseInt(fullNamedMonth[5], 10);
      yearRaw  = parseInt(fullNamedMonth[6], 10);
    }
    const month = MONTH_MAP[monthStr];
    if (!month) return null;
    const year = expandYear(yearRaw);
    const dob  = safeDate(year, month, day);
    if (!dob) return null;
    return { precision: 'full', dob, year, month, day, age: ageFromDate(dob) };
  }

  // ── Full date: numeric DD MM YYYY or YYYY MM DD ─────────────────────────
  // e.g. "12 03 2019", "2019 03 12"
  const numericFull = lower.match(/^(\d{1,4})\s+(\d{1,2})\s+(\d{1,4})$/);
  if (numericFull) {
    let a = parseInt(numericFull[1], 10);
    let b = parseInt(numericFull[2], 10);
    let c = parseInt(numericFull[3], 10);

    let year, month, day;

    if (a > 31) {
      // YYYY MM DD
      year = expandYear(a); month = b; day = c;
    } else if (c > 31) {
      // DD MM YYYY
      day = a; month = b; year = expandYear(c);
    } else {
      // Ambiguous — treat as DD MM YY/YYYY
      day = a; month = b; year = expandYear(c);
    }

    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dob = safeDate(year, month, day);
    if (!dob) return null;
    return { precision: 'full', dob, year, month, day, age: ageFromDate(dob) };
  }

  // ── Month + year: "March 2019" or "03 2019" ─────────────────────────────
  const monthYear = lower.match(/^([a-z]+)\s+(\d{2,4})$|^(\d{1,2})\s+(\d{4})$/);
  if (monthYear) {
    let month, year;
    if (monthYear[1]) {
      month = MONTH_MAP[monthYear[1]];
      year  = expandYear(parseInt(monthYear[2], 10));
    } else {
      month = parseInt(monthYear[3], 10);
      year  = parseInt(monthYear[4], 10);
    }
    if (!month || month < 1 || month > 12) return null;
    if (year < 1990 || year > new Date().getFullYear()) return null;
    return { precision: 'month_year', dob: null, year, month, age: ageFromMonthYear(year, month) };
  }

  // ── Year only: "2019" or "born in 2019" ─────────────────────────────────
  const yearMatch = raw.match(/\b(19[89]\d|20[012]\d)\b/);
  if (yearMatch) {
    const year = parseInt(yearMatch[1], 10);
    if (year < 1990 || year > new Date().getFullYear()) return null;
    return { precision: 'year_only', dob: null, year, age: ageFromYear(year) };
  }

  return null; // unparseable
}

/**
 * Derive the best available age integer from a child DB row.
 * Uses child_dob first (most accurate), then birth_year, then child_age fallback.
 *
 * @param {object} child — DB row
 * @returns {number|null}
 */
function deriveAge(child) {
  if (child.child_dob) {
    return ageFromDate(new Date(child.child_dob));
  }
  if (child.birth_year) {
    return ageFromYear(child.birth_year);
  }
  if (child.child_age != null) {
    return child.child_age;
  }
  return null;
}

/**
 * Format a child's birthday/age for display in profile views.
 *
 * @param {object} child — DB row
 * @returns {string}  e.g. "12 March 2019 (age 6)" or "2019 (age ~6)" or "age 6"
 */
function formatBirthdayDisplay(child) {
  if (child.child_dob) {
    const d   = new Date(child.child_dob);
    const age = ageFromDate(d);
    const str = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
    return `${str} (age ${age})`;
  }
  if (child.birth_year) {
    const age = ageFromYear(child.birth_year);
    return `born ${child.birth_year} (age ~${age})`;
  }
  if (child.child_age != null) {
    return `age ${child.child_age}`;
  }
  return 'age unknown';
}

/**
 * Build the DB fields to store from a parsed birthday result.
 *
 * @param {object} parsed — result of parseBirthday()
 * @returns {object}  fields to pass to updateChild() / createChild()
 */
function birthdayToDbFields(parsed) {
  if (!parsed || parsed.precision === 'skip') return {};

  const fields = { child_age: parsed.age ?? null };

  if (parsed.precision === 'full' && parsed.dob) {
    // Store as ISO date string for Postgres DATE column
    fields.child_dob  = parsed.dob.toISOString().split('T')[0];
    fields.birth_year = parsed.year;
  } else if (parsed.precision === 'month_year') {
    fields.birth_year = parsed.year;
  } else if (parsed.precision === 'year_only') {
    fields.birth_year = parsed.year;
  }

  return fields;
}

module.exports = {
  parseBirthday,
  deriveAge,
  formatBirthdayDisplay,
  birthdayToDbFields,
  ageFromDate,
  ageFromYear,
};
