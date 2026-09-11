// Date helpers. Date-only values are strings "YYYY-MM-DD" reckoned in the firm's
// timezone, never the host's UTC day. Australian input is parsed day-first.
// Pure: every function that needs "now" takes it as an argument.

export const DEFAULT_TZ = 'Australia/Brisbane';

const MONTHS = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
];
const MONTH_SHORT = MONTHS.map((m) => m.slice(0, 3));
const MONTH_LABEL = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
];
const MONTH_FULL = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const DAY_LABEL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

const formatterCache = new Map();
function partsFormatter(tz) {
  const key = `parts:${tz}`;
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }));
  }
  return formatterCache.get(key);
}

function coerceDate(now) {
  if (now instanceof Date) return now;
  if (typeof now === 'number') return new Date(now);
  if (typeof now === 'string') {
    const d = new Date(now);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date();
}

/** Today in the firm's timezone as "YYYY-MM-DD". */
export function todayISO(tz = DEFAULT_TZ, now = undefined) {
  const d = coerceDate(now);
  try {
    const parts = partsFormatter(tz).formatToParts(d);
    const get = (t) => parts.find((p) => p.type === t)?.value;
    const y = get('year');
    const m = get('month');
    const day = get('day');
    if (y && m && day) return `${y}-${m}-${day}`;
  } catch {
    // fall through to UTC when the timezone is unknown
  }
  return d.toISOString().slice(0, 10);
}

/** Full timestamp for timeline events. */
export function nowStamp(now = undefined) {
  return coerceDate(now).toISOString();
}

export function isValidISODate(value) {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function isoParts(iso) {
  const m = ISO_RE.exec(String(iso || ''));
  if (!m) return null;
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
}

function isoToUTC(iso) {
  const p = isoParts(iso);
  if (!p) return null;
  return Date.UTC(p.year, p.month - 1, p.day);
}

function utcToISO(ms) {
  const d = new Date(ms);
  const y = String(d.getUTCFullYear()).padStart(4, '0');
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(iso, days) {
  const ms = isoToUTC(iso);
  if (ms === null) return null;
  return utcToISO(ms + Math.round(days) * 86400000);
}

/** b - a, in whole days. Positive when b is later. */
export function daysBetween(a, b) {
  const ams = isoToUTC(a);
  const bms = isoToUTC(b);
  if (ams === null || bms === null) return null;
  return Math.round((bms - ams) / 86400000);
}

export function compareISO(a, b) {
  if (a === b) return 0;
  if (!a) return 1;
  if (!b) return -1;
  return a < b ? -1 : 1;
}

/** "2026-10-09" -> "9 Oct" */
export function formatShort(iso) {
  const p = isoParts(iso);
  if (!p) return '';
  return `${p.day} ${MONTH_LABEL[p.month - 1]}`;
}

/** "2026-10-09" -> "9 October 2026" */
export function formatLong(iso) {
  const p = isoParts(iso);
  if (!p) return '';
  return `${p.day} ${MONTH_FULL[p.month - 1]} ${p.year}`;
}

/** "2026-10-09" -> "Fri 9 Oct" */
export function formatWithDay(iso) {
  const p = isoParts(iso);
  if (!p) return '';
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return `${DAY_LABEL[dow].slice(0, 3)} ${p.day} ${MONTH_LABEL[p.month - 1]}`;
}

export function dayName(iso) {
  const p = isoParts(iso);
  if (!p) return '';
  const dow = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return DAY_LABEL[dow];
}

/** "2026-10-09" -> "2026-10" */
export function monthKey(iso) {
  const p = isoParts(iso);
  if (!p) return '';
  return `${p.year}-${String(p.month).padStart(2, '0')}`;
}

export function monthLabel(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return '';
  return `${MONTH_FULL[Number(m[2]) - 1]} ${m[1]}`;
}

export function monthRange(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const start = `${m[1]}-${m[2]}-01`;
  const lastDay = new Date(Date.UTC(y, mo, 0)).getUTCDate();
  return { start, end: `${m[1]}-${m[2]}-${String(lastDay).padStart(2, '0')}` };
}

export function previousMonthKey(key) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return '';
  let y = Number(m[1]);
  let mo = Number(m[2]) - 1;
  if (mo === 0) { mo = 12; y -= 1; }
  return `${y}-${String(mo).padStart(2, '0')}`;
}

export function inMonth(iso, key) {
  if (!isValidISODate(iso)) return false;
  return monthKey(iso) === key;
}

export function inRange(iso, start, end) {
  if (!isValidISODate(iso)) return false;
  if (start && iso < start) return false;
  if (end && iso > end) return false;
  return true;
}

/** Monday of the week containing iso. */
export function weekStart(iso) {
  const p = isoParts(iso);
  if (!p) return null;
  const ms = Date.UTC(p.year, p.month - 1, p.day);
  const dow = new Date(ms).getUTCDay(); // 0 Sun
  const shift = dow === 0 ? -6 : 1 - dow;
  return utcToISO(ms + shift * 86400000);
}

/** The coming Saturday (or today when today is Saturday). */
export function nextSaturday(iso) {
  const p = isoParts(iso);
  if (!p) return null;
  const ms = Date.UTC(p.year, p.month - 1, p.day);
  const dow = new Date(ms).getUTCDay();
  const shift = (6 - dow + 7) % 7;
  return utcToISO(ms + shift * 86400000);
}

const RELATIVE = {
  today: 0,
  tonight: 0,
  tomorrow: 1,
  yesterday: -1,
};

function twoDigitYear(n) {
  return n >= 70 ? 1900 + n : 2000 + n;
}

/**
 * Parse a human date. Day-first for numeric forms ("9/10/26" is 9 October).
 * When no year is given the nearest sensible year is chosen: the current year,
 * rolled forward when that date is more than 120 days in the past.
 * Returns "YYYY-MM-DD" or null.
 */
export function parseDate(input, opts = {}) {
  if (input == null) return null;
  const tz = opts.tz || DEFAULT_TZ;
  const today = opts.today && isValidISODate(opts.today) ? opts.today : todayISO(tz, opts.now);
  const raw = String(input).trim();
  if (!raw) return null;

  if (ISO_RE.test(raw)) return isValidISODate(raw) ? raw : null;

  const text = raw.toLowerCase().replace(/\s+/g, ' ').trim();

  if (Object.hasOwn(RELATIVE, text)) return addDays(today, RELATIVE[text]);
  let m = /^(?:in )?(\d{1,2}) (day|days|week|weeks|month|months)$/.exec(text);
  if (m) {
    const n = Number(m[1]);
    const unit = m[2];
    if (unit.startsWith('day')) return addDays(today, n);
    if (unit.startsWith('week')) return addDays(today, n * 7);
    const p = isoParts(today);
    const target = new Date(Date.UTC(p.year, p.month - 1 + n, p.day));
    return utcToISO(target.getTime());
  }

  // ISO-ish with slashes: 2026/10/09
  m = /^(\d{4})[/.-](\d{1,2})[/.-](\d{1,2})$/.exec(text);
  if (m) {
    const iso = `${m[1]}-${String(m[2]).padStart(2, '0')}-${String(m[3]).padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }

  // Day-first numeric: 9/10/2026, 09-10-26, 9.10.2026
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2}|\d{4})$/.exec(text);
  if (m) {
    const day = Number(m[1]);
    const mon = Number(m[2]);
    const year = m[3].length === 2 ? twoDigitYear(Number(m[3])) : Number(m[3]);
    const iso = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    return isValidISODate(iso) ? iso : null;
  }

  // Day/month without year: 9/10
  m = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (m) {
    return resolveNoYear(Number(m[1]), Number(m[2]), today);
  }

  const monthNamePattern = '(' + MONTHS.join('|') + '|' + MONTH_SHORT.join('|') + ')';
  // 9 Oct 2026 / 9th October / 9 Oct
  m = new RegExp(`^(\\d{1,2})(?:st|nd|rd|th)? (?:of )?${monthNamePattern}\\.?(?: (\\d{2}|\\d{4}))?$`).exec(text);
  if (m) {
    const day = Number(m[1]);
    const mon = monthIndex(m[2]) + 1;
    if (m[3]) {
      const year = m[3].length === 2 ? twoDigitYear(Number(m[3])) : Number(m[3]);
      const iso = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return isValidISODate(iso) ? iso : null;
    }
    return resolveNoYear(day, mon, today);
  }

  // October 9 2026 / Oct 9
  m = new RegExp(`^${monthNamePattern}\\.? (\\d{1,2})(?:st|nd|rd|th)?(?:,? (\\d{2}|\\d{4}))?$`).exec(text);
  if (m) {
    const mon = monthIndex(m[1]) + 1;
    const day = Number(m[2]);
    if (m[3]) {
      const year = m[3].length === 2 ? twoDigitYear(Number(m[3])) : Number(m[3]);
      const iso = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      return isValidISODate(iso) ? iso : null;
    }
    return resolveNoYear(day, mon, today);
  }

  return null;
}

function monthIndex(name) {
  const n = String(name).toLowerCase().replace(/\.$/, '');
  let i = MONTHS.indexOf(n);
  if (i >= 0) return i;
  i = MONTH_SHORT.indexOf(n.slice(0, 3));
  return i;
}

function resolveNoYear(day, mon, today) {
  const p = isoParts(today);
  if (!p) return null;
  for (const year of [p.year, p.year + 1, p.year - 1]) {
    const iso = `${year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (!isValidISODate(iso)) continue;
    const delta = daysBetween(today, iso);
    if (delta >= -120 && delta <= 300) return iso;
  }
  const iso = `${p.year}-${String(mon).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  return isValidISODate(iso) ? iso : null;
}

/** Find the first parseable date inside a longer piece of text. */
export function findDate(text, opts = {}) {
  if (!text) return null;
  const monthNamePattern = '(?:' + MONTHS.join('|') + '|' + MONTH_SHORT.join('|') + ')';
  const patterns = [
    /\b\d{4}-\d{2}-\d{2}\b/i,
    new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)? (?:of )?${monthNamePattern}\\.?(?: \\d{2,4})?\\b`, 'i'),
    new RegExp(`\\b${monthNamePattern}\\.? \\d{1,2}(?:st|nd|rd|th)?(?:,? \\d{2,4})?\\b`, 'i'),
    /\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m) {
      const parsed = parseDate(m[0], opts);
      if (parsed) return parsed;
    }
  }
  return null;
}

export const __monthNames = { MONTHS, MONTH_SHORT, MONTH_LABEL, MONTH_FULL };
