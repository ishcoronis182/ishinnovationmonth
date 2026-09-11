// Money helpers. Amounts are dollars as numbers; cents are rounded.

const WORD_UNITS = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
const WORD_SCALES = { hundred: 100, thousand: 1000, grand: 1000, k: 1000, million: 1e6, mill: 1e6, m: 1e6, billion: 1e9 };

export function roundCents(n) {
  if (!Number.isFinite(n)) return null;
  // Math.round(1.005 * 100) is 100 in binary floating point, so round through
  // the exponent instead: commissions are money and a lost cent is a bug.
  const shifted = Number(`${n}e2`);
  if (!Number.isFinite(shifted)) return Math.round(n * 100) / 100;
  return Number(`${Math.round(shifted)}e-2`);
}

export function roundDollars(n) {
  if (!Number.isFinite(n)) return null;
  return Math.round(n);
}

/**
 * Parse a written amount into dollars.
 * "600k" -> 600000, "$1.2m" -> 1200000, "AUD650k" -> 650000, "600,000" -> 600000,
 * "1.2 million" -> 1200000, "six hundred thousand" -> 600000. Returns null when unsure.
 */
export function parseMoney(input) {
  if (input == null) return null;
  if (typeof input === 'number') return Number.isFinite(input) ? roundCents(input) : null;
  let text = String(input).toLowerCase().trim();
  if (!text) return null;
  text = text.replace(/\baud\$?/g, ' ').replace(/\bau\$/g, ' ').replace(/\ba\$/g, ' ').replace(/\$/g, ' ');
  text = text.replace(/\bdollars?\b/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text) return null;

  // Numeric with optional scale suffix
  let m = /^(\d+(?:[,\s]\d{3})*(?:\.\d+)?)\s*(k|m|mill|million|billion|thousand|grand|b)?$/.exec(text);
  if (m) {
    const base = Number(m[1].replace(/[,\s]/g, ''));
    if (!Number.isFinite(base)) return null;
    const suffix = m[2];
    if (!suffix) return roundCents(base);
    const scale = suffix === 'b' ? 1e9 : WORD_SCALES[suffix] || 1;
    return roundCents(base * scale);
  }

  // "1.2 million dollars", "600 k"
  m = /^(\d+(?:\.\d+)?)\s+(k|m|mill|million|billion|thousand|grand)$/.exec(text);
  if (m) {
    return roundCents(Number(m[1]) * (WORD_SCALES[m[2]] || 1));
  }

  const words = parseMoneyWords(text);
  if (words != null) return words;
  return null;
}

/** "six hundred thousand" -> 600000, "half a million" -> 500000. */
export function parseMoneyWords(text) {
  const clean = String(text || '').toLowerCase().replace(/[^a-z0-9. ]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  if (/^(a )?half a (million|mill)$/.test(clean)) return 500000;
  if (/^(a )?quarter of a (million|mill)$/.test(clean)) return 250000;
  const tokens = clean.split(' ').filter((t) => t && t !== 'and' && t !== 'a');
  if (!tokens.length) return null;
  let total = 0;
  let current = 0;
  let sawWord = false;
  for (const tok of tokens) {
    if (Object.hasOwn(WORD_UNITS, tok)) {
      current += WORD_UNITS[tok];
      sawWord = true;
    } else if (Object.hasOwn(WORD_SCALES, tok)) {
      const scale = WORD_SCALES[tok];
      sawWord = true;
      if (scale === 100) {
        current = (current || 1) * 100;
      } else {
        total += (current || 1) * scale;
        current = 0;
      }
    } else if (/^\d+(\.\d+)?$/.test(tok)) {
      current += Number(tok);
    } else {
      return null;
    }
  }
  if (!sawWord) return null;
  const value = total + current;
  return value > 0 ? roundCents(value) : null;
}

export function formatMoney(n, opts = {}) {
  if (n == null || !Number.isFinite(Number(n))) return '-';
  const value = Number(n);
  const cents = opts.cents ?? (Math.abs(value % 1) > 0.0001);
  const fixed = cents ? value.toFixed(2) : String(Math.round(value));
  const [whole, frac] = fixed.split('.');
  const sign = whole.startsWith('-') ? '-' : '';
  const digits = whole.replace('-', '').replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${sign}$${digits}${frac ? '.' + frac : ''}`;
}

export function formatBps(bps) {
  if (bps == null || !Number.isFinite(Number(bps))) return '-';
  return `${(Number(bps) / 100).toFixed(2)}%`;
}

export function sumAmounts(list) {
  return roundCents((list || []).reduce((acc, n) => acc + (Number.isFinite(Number(n)) ? Number(n) : 0), 0));
}
