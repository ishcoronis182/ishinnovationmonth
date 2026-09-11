// Deterministic compliance guard. Runs on every partner-facing draft and every
// edit, before anything is shown or sent. Pure: text in, findings out.
//
// Block: figures of any shape (currency, abbreviated, separated, spelled out,
// percentages and rates with or without a sign), hidden-character tricks, and
// financial or personal detail words.
// Warn: a named lender, document or process detail, long numbers.

const INVISIBLE = new Set([
  '​', '‌', '‍', '⁠', '﻿', '­', '᠎',
  '‎', '‏', '‪', '‫', '‬', '‭', '‮',
  '⁡', '⁢', '⁣', '⁤',
]);

const NUMWORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fourty|fifty|sixty|seventy|eighty|ninety)';
const MAGWORD = '(?:hundred|thousand|million|billion|grand|mill)';

export const MONEY_WORD_RE = new RegExp(
  `\\b${NUMWORD}(?:[\\s-]+(?:${NUMWORD}|and|point))*[\\s-]+${MAGWORD}(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMWORD}|${MAGWORD}))*\\b`,
  'gi',
);

const FRACTION_MONEY_RE = /\b(?:a\s+)?(?:half|quarter)\s+(?:of\s+)?a\s+(?:million|mill|billion)\b/gi;

// Financial or personal detail. Order matters only for label quality.
const BANNED_TERMS = [
  { re: /\bincomes?\b/gi, label: 'income' },
  { re: /\bsalar(?:y|ies)\b/gi, label: 'salary' },
  { re: /\bwages?\b/gi, label: 'wages' },
  { re: /\bdeposits?\b/gi, label: 'deposit' },
  { re: /\bLVRs?\b/g, label: 'LVR' },
  { re: /\bloan[\s-]?to[\s-]?value\b/gi, label: 'loan to value' },
  { re: /\binterest\s+rates?\b/gi, label: 'interest rate' },
  { re: /\bvariable\s+rate\b/gi, label: 'variable rate' },
  { re: /\bfixed\s+rate\b/gi, label: 'fixed rate' },
  { re: /\bcomparison\s+rate\b/gi, label: 'comparison rate' },
  { re: /\brepayments?\b/gi, label: 'repayments' },
  { re: /\bcredits?\b/gi, label: 'credit' },
  { re: /\bcredit\s+file\b/gi, label: 'credit file' },
  { re: /\bdefaults?\b/gi, label: 'default' },
  { re: /\barrears\b/gi, label: 'arrears' },
  { re: /\bbankrupt(?:cy|cies)?\b/gi, label: 'bankrupt' },
  { re: /\binsolven(?:t|cy)\b/gi, label: 'insolvency' },
  { re: /\bdebts?\b/gi, label: 'debt' },
  { re: /\bCentrelink\b/gi, label: 'Centrelink' },
  { re: /\bHECS\b/gi, label: 'HECS' },
  { re: /\bHELP\s+loan\b/gi, label: 'HELP loan' },
  { re: /\bguarantors?\b/gi, label: 'guarantor' },
  { re: /\bpayslips?\b/gi, label: 'payslips' },
  { re: /\bbank\s+statements?\b/gi, label: 'bank statements' },
  { re: /\bborrowing\s+capacit(?:y|ies)\b/gi, label: 'borrowing capacity' },
  { re: /\bserviceabilit(?:y|ies)\b/gi, label: 'serviceability' },
  { re: /\bapproved\s+for\b/gi, label: '"approved for"' },
  { re: /\bpre[\s-]?approved\s+for\b/gi, label: '"pre-approved for"' },
  { re: /\bcash\s?out\b/gi, label: 'cash out' },
  { re: /\bequity\s+release\b/gi, label: 'equity release' },
  { re: /\bcommissions?\b/gi, label: 'commission' },
  { re: /\bcashback\b/gi, label: 'cashback' },
];

const LENDERS = [
  'CBA', 'Commonwealth Bank', 'Westpac', 'NAB', 'National Australia Bank', 'ANZ',
  'Macquarie', 'ING', 'Suncorp', 'St George', 'St. George', 'Bankwest', 'BOQ',
  'Bank of Queensland', 'AMP', 'Bendigo Bank', 'Pepper Money', 'Firstmac',
  'La Trobe', 'Liberty Financial', 'Resimac', 'Athena', 'Ubank', 'Great Southern Bank',
  'Heritage Bank', 'Newcastle Permanent', 'Teachers Mutual', 'ME Bank', 'Adelaide Bank',
  'Auswide', 'Beyond Bank', 'Gateway Bank', 'Greater Bank', 'HSBC', 'Citibank',
  'Judo Bank', 'Bluestone', 'Bank Australia', 'P&N Bank', 'Bank of Melbourne',
];

const PROCESS_TERMS = [
  { re: /\bvaluations?\b/gi, label: 'valuation' },
  { re: /\bdocuments?\b/gi, label: 'documents' },
  { re: /\bdocs\b/gi, label: 'docs' },
  { re: /\bpaperwork\b/gi, label: 'paperwork' },
  { re: /\bverification\b/gi, label: 'verification' },
  { re: /\bassessment\b/gi, label: 'assessment' },
  { re: /\bunderwrit(?:er|ing)\b/gi, label: 'underwriting' },
  { re: /\bconditions?\b/gi, label: 'conditions' },
  { re: /\bLMI\b/g, label: 'LMI' },
  { re: /\bmortgage\s+insurance\b/gi, label: 'mortgage insurance' },
  { re: /\bbroker\s+fee\b/gi, label: 'broker fee' },
  { re: /\bpolicy\s+exception\b/gi, label: 'policy exception' },
];

const MONTH_NAMES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';

// Spans that are legitimate in partner copy and must not be read as figures.
const SAFE_PATTERNS = [
  // Australian phone numbers, various shapes
  { re: /\+?61[\s-]?4\d{2}[\s-]?\d{3}[\s-]?\d{3}/g, type: 'phone' },
  { re: /\+?61[\s-]?[2-8][\s-]?\d{4}[\s-]?\d{4}/g, type: 'phone' },
  { re: /\b0[45]\d{2}[\s-]?\d{3}[\s-]?\d{3}\b/g, type: 'phone' },
  { re: /\(0[2-8]\)[\s-]?\d{4}[\s-]?\d{4}/g, type: 'phone' },
  { re: /\b0[2-8][\s-]?\d{4}[\s-]?\d{4}\b/g, type: 'phone' },
  { re: /\b1[38]00[\s-]?\d{3}[\s-]?\d{3}\b/g, type: 'phone' },
  { re: /\b13[\s-]?\d{2}[\s-]?\d{2}\b/g, type: 'phone' },
  // Dates
  { re: /\b\d{4}-\d{2}-\d{2}\b/g, type: 'date' },
  { re: /\b\d{1,2}[/.-]\d{1,2}[/.-](?:\d{2}|\d{4})\b/g, type: 'date' },
  { re: new RegExp(`\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_NAMES})\\.?(?:\\s+\\d{2,4})?\\b`, 'gi'), type: 'date' },
  { re: new RegExp(`\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{2,4})?\\b`, 'gi'), type: 'date' },
  { re: /\b\d{1,2}(?::\d{2})?\s?(?:am|pm)\b/gi, type: 'time' },
  { re: /\b\d{1,2}:\d{2}\b/g, type: 'time' },
  // Address tails: state then postcode, or a bare four digit postcode after a comma
  { re: /\b(?:QLD|NSW|VIC|TAS|SA|WA|NT|ACT)\s+\d{4}\b/g, type: 'postcode' },
  // Email addresses (a warn, not a figure)
  { re: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g, type: 'email' },
];

function rangesOverlap(a, b) {
  return a.start < b.end && b.start < a.end;
}

/** NFKC-fold and drop invisible characters, keeping a map back to the original. */
function normaliseForScan(input) {
  const text = String(input ?? '');
  let out = '';
  const map = [];
  const tricks = [];
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (INVISIBLE.has(ch)) {
      tricks.push({ start: i, end: i + 1, char: ch });
      continue;
    }
    let folded;
    try {
      folded = ch.normalize('NFKC');
    } catch {
      folded = ch;
    }
    if (folded !== ch && /\s/.test(folded)) folded = ' ';
    for (const c of folded) {
      out += c;
      map.push(i);
    }
  }
  map.push(text.length);
  return { text: out, map, tricks, original: text };
}

function toOriginal(map, start, end, originalLength) {
  const s = map[Math.min(start, map.length - 1)] ?? 0;
  const eIdx = Math.min(end, map.length - 1);
  const e = end >= map.length ? originalLength : (map[eIdx] ?? originalLength);
  return { start: s, end: Math.max(s + 1, e) };
}

function collectSafeSpans(scan, allowSpans) {
  const spans = [];
  for (const { re, type } of SAFE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(scan.text)) !== null) {
      if (m[0].length === 0) { re.lastIndex += 1; continue; }
      spans.push({ start: m.index, end: m.index + m[0].length, type, match: m[0] });
    }
  }
  for (const span of allowSpans || []) spans.push(span);
  return spans;
}

function digitsOf(str) {
  return String(str).replace(/\D/g, '');
}

/**
 * Numbers the caller explicitly permits (a statement's own totals).
 * Matches the number in any common written shape.
 */
function allowedNumberSpans(scanText, allowNumbers) {
  const spans = [];
  if (!Array.isArray(allowNumbers) || !allowNumbers.length) return spans;
  const wanted = new Set();
  for (const raw of allowNumbers) {
    const n = Number(raw);
    if (!Number.isFinite(n)) continue;
    wanted.add(String(Math.round(n)));
    wanted.add(String(Math.round(n * 100) / 100));
    wanted.add(n.toFixed(2));
  }
  const re = /\$?\s?\d[\d,\s]*(?:\.\d{1,2})?/g;
  let m;
  while ((m = re.exec(scanText)) !== null) {
    if (!m[0].trim()) { re.lastIndex += 1; continue; }
    const cleaned = m[0].replace(/[$\s,]/g, '');
    const asNum = Number(cleaned);
    if (!Number.isFinite(asNum)) continue;
    if (wanted.has(cleaned) || wanted.has(String(asNum)) || wanted.has(asNum.toFixed(2))) {
      spans.push({ start: m.index, end: m.index + m[0].length, type: 'allowed_total', match: m[0] });
    }
  }
  return spans;
}

const BLOCK_DETECTORS = [
  { type: 'currency', label: 'currency amount', re: /(?:\$|AUD\s?|A\$)\s?\d[\d,]*(?:\.\d+)?(?:\s?(?:k|m|mill|million|bn|b))?/gi },
  { type: 'currency', label: 'currency symbol', re: /(?:\$|AUD\b|A\$)(?!\w)/gi },
  { type: 'abbreviated_amount', label: 'abbreviated amount', re: /\b\d+(?:\.\d+)?\s?(?:k|m|mill|million|billion|grand|bn)\b/gi },
  { type: 'abbreviated_amount', label: 'written amount', re: /\b\d+(?:\.\d+)?\s+(?:thousand|million|billion|grand)\b/gi },
  { type: 'percentage', label: 'percentage', re: /\b\d+(?:\.\d+)?\s?%/g },
  { type: 'percentage', label: 'percentage', re: /\b\d+(?:\.\d+)?\s?(?:per\s?cent|percent|pc)\b/gi },
  { type: 'rate', label: 'rate', re: /\b\d+(?:\.\d+)?\s?(?:pa|p\.a\.|per\s+annum|bps|basis\s+points)\b/gi },
  { type: 'figure', label: 'decimal figure', re: /\b\d{1,4}\.\d{1,2}\b/g },
  { type: 'figure', label: 'separated number', re: /\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b/g },
  { type: 'figure', label: 'separated number', re: /\b\d{1,3}(?:[  ]\d{3})+\b/g },
  { type: 'figure', label: 'long number', re: /\b\d{5,}\b/g },
  { type: 'dollars_word', label: 'amount in dollars', re: /\b\d[\d,. ]*\s?dollars?\b/gi },
];

function pushHit(list, scan, start, end, severity, type, label) {
  if (end <= start) return;
  const mapped = toOriginal(scan.map, start, end, scan.original.length);
  list.push({
    severity,
    type,
    label,
    match: scan.text.slice(start, end),
    start: mapped.start,
    end: mapped.end,
    scanStart: start,
    scanEnd: end,
  });
}

/**
 * @param {string} text
 * @param {{allowNumbers?: number[], allowLenders?: boolean}} [opts]
 */
export function checkCompliance(text, opts = {}) {
  const scan = normaliseForScan(text);
  const allowSpans = allowedNumberSpans(scan.text, opts.allowNumbers);
  const safeSpans = collectSafeSpans(scan, allowSpans);
  const raw = [];

  for (const trick of scan.tricks) {
    raw.push({
      severity: 'block',
      type: 'hidden_characters',
      label: 'hidden character',
      match: '',
      start: trick.start,
      end: trick.end,
      scanStart: -1,
      scanEnd: -1,
    });
  }
  if (scan.text !== scan.original.replace(/ /g, ' ') && scan.text !== scan.original) {
    const changed = [...scan.original].some((ch) => {
      if (INVISIBLE.has(ch)) return false;
      let f;
      try { f = ch.normalize('NFKC'); } catch { f = ch; }
      return f !== ch && !/\s/.test(ch);
    });
    if (changed) {
      raw.push({
        severity: 'block',
        type: 'hidden_characters',
        label: 'disguised character',
        match: '',
        start: 0,
        end: Math.min(scan.original.length, 1),
        scanStart: -1,
        scanEnd: -1,
      });
    }
  }

  for (const det of BLOCK_DETECTORS) {
    det.re.lastIndex = 0;
    let m;
    while ((m = det.re.exec(scan.text)) !== null) {
      if (!m[0].length) { det.re.lastIndex += 1; continue; }
      const candidate = { start: m.index, end: m.index + m[0].length };
      const insideSafe = safeSpans.some((s) => rangesOverlap(candidate, s)
        && (s.type === 'allowed_total'
          ? digitsOf(s.match).includes(digitsOf(m[0])) || digitsOf(m[0]) === digitsOf(s.match)
          : true));
      if (insideSafe) continue;
      pushHit(raw, scan, candidate.start, candidate.end, 'block', det.type, det.label);
    }
  }

  for (const re of [MONEY_WORD_RE, FRACTION_MONEY_RE]) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(scan.text)) !== null) {
      if (!m[0].length) { re.lastIndex += 1; continue; }
      pushHit(raw, scan, m.index, m.index + m[0].length, 'block', 'spelled_figure', 'figure in words');
    }
  }

  for (const term of BANNED_TERMS) {
    term.re.lastIndex = 0;
    let m;
    while ((m = term.re.exec(scan.text)) !== null) {
      if (!m[0].length) { term.re.lastIndex += 1; continue; }
      pushHit(raw, scan, m.index, m.index + m[0].length, 'block', 'financial_detail', term.label);
    }
  }

  if (!opts.allowLenders) {
    for (const lender of LENDERS) {
      const re = new RegExp(`(?<![\\w])${lender.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w])`, 'gi');
      let m;
      while ((m = re.exec(scan.text)) !== null) {
        if (!m[0].length) { re.lastIndex += 1; continue; }
        pushHit(raw, scan, m.index, m.index + m[0].length, 'warn', 'lender_named', `lender named (${lender})`);
      }
    }
  }

  for (const term of PROCESS_TERMS) {
    term.re.lastIndex = 0;
    let m;
    while ((m = term.re.exec(scan.text)) !== null) {
      if (!m[0].length) { term.re.lastIndex += 1; continue; }
      pushHit(raw, scan, m.index, m.index + m[0].length, 'warn', 'process_detail', term.label);
    }
  }

  for (const span of safeSpans) {
    if (span.type === 'phone') {
      pushHit(raw, scan, span.start, span.end, 'warn', 'long_number', 'phone number');
    } else if (span.type === 'email') {
      pushHit(raw, scan, span.start, span.end, 'warn', 'contact_detail', 'email address');
    }
  }

  const hits = dedupeHits(raw);
  const blocked = hits.filter((h) => h.severity === 'block');
  const warnings = hits.filter((h) => h.severity === 'warn');
  return {
    ok: blocked.length === 0,
    blocked,
    warnings,
    hits,
    redacted: redact(scan.original, blocked),
    summary: summarise(blocked, warnings),
    length: scan.original.length,
  };
}

/** Overlapping findings collapse into one span; blocks beat warns. */
function dedupeHits(raw) {
  // Hidden characters are reported in their own right: they are the reason a
  // draft looked clean, so they must never be absorbed by an overlapping hit.
  const hidden = raw.filter((h) => h.type === 'hidden_characters');
  const rest = raw.filter((h) => h.type !== 'hidden_characters');
  const sorted = [...rest].sort((a, b) => (a.start - b.start) || (b.end - a.end)
    || (a.severity === b.severity ? 0 : (a.severity === 'block' ? -1 : 1)));
  const kept = [...hidden];
  for (const hit of sorted) {
    const clash = kept.find((k) => k.type !== 'hidden_characters' && rangesOverlap(k, hit));
    if (!clash) { kept.push({ ...hit }); continue; }
    if (clash.severity === hit.severity) {
      if (hit.end > clash.end) {
        clash.end = hit.end;
        clash.match = clash.match.length >= hit.match.length ? clash.match : hit.match;
      }
      if (!clash.labels) clash.labels = [clash.label];
      if (!clash.labels.includes(hit.label)) clash.labels.push(hit.label);
      continue;
    }
    if (hit.severity === 'block') {
      const idx = kept.indexOf(clash);
      kept.splice(idx, 1, { ...hit });
    }
    // a warn overlapping an existing block is dropped
  }
  return kept
    .map((h) => ({ ...h, label: h.labels ? h.labels.join(', ') : h.label }))
    .sort((a, b) => a.start - b.start);
}

function redact(original, blocked) {
  const spans = blocked.filter((h) => h.type !== 'hidden_characters');
  if (!spans.length) return original;
  const merged = [];
  for (const hit of [...spans].sort((a, b) => a.start - b.start)) {
    const last = merged[merged.length - 1];
    if (last && hit.start <= last.end) {
      last.end = Math.max(last.end, hit.end);
    } else {
      merged.push({ start: hit.start, end: hit.end });
    }
  }
  let out = '';
  let cursor = 0;
  for (const span of merged) {
    out += original.slice(cursor, span.start) + '[removed]';
    cursor = span.end;
  }
  out += original.slice(cursor);
  return out;
}

function summarise(blocked, warnings) {
  const parts = [];
  if (blocked.length) {
    const labels = [...new Set(blocked.map((b) => b.label))];
    parts.push(`Blocked: ${labels.join(', ')}`);
  }
  if (warnings.length) {
    const labels = [...new Set(warnings.map((w) => w.label))];
    parts.push(`Check: ${labels.join(', ')}`);
  }
  return parts.join('. ') || 'Clear.';
}

/** Convenience: does this text pass? */
export function isPartnerSafe(text, opts = {}) {
  return checkCompliance(text, opts).ok;
}

/** A statement cover note may carry the statement's own totals and nothing else. */
export function checkStatementNote(text, totals = []) {
  return checkCompliance(text, { allowNumbers: totals });
}

/** Human-readable reason a draft cannot be sent. */
export function blockReason(result) {
  if (!result || result.ok) return null;
  const labels = [...new Set(result.blocked.map((b) => b.label))];
  return `Cannot send: contains ${labels.join(', ')}. Edit the draft to remove it.`;
}

export const GUARD_LENDERS = LENDERS;
