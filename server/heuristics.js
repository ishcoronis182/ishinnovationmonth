// Deterministic fallbacks for every AI step. These run when there is no API
// key, and whenever a Claude call fails. Regex and rules only.

import { parseMoney, parseMoneyWords } from '../shared/money.js';
import { parseDate, formatShort, todayISO, addDays } from '../shared/dates.js';
import { normaliseDeal, ragForDeal, clientLabel, shortAddress } from '../shared/record.js';
import { stageFromMilestoneWord, isLive } from '../shared/stages.js';
import { GUARD_LENDERS } from '../shared/guard.js';

const STATES = ['QLD', 'NSW', 'VIC', 'TAS', 'SA', 'WA', 'NT', 'ACT'];

const STREET_TYPES = 'St|Street|Rd|Road|Ave|Avenue|Av|Cres|Crescent|Dr|Drive|Ct|Court|Pde|Parade|Tce|Terrace|Way|Cl|Close|Pl|Place|Blvd|Boulevard|Hwy|Highway|Lane|Ln|Esp|Esplanade|Cct|Circuit|Gr|Grove|Mews|Rise|Ridge|Walk';

const ADDRESS_RE = new RegExp(
  '\\b(?:(?:unit|u|apt|apartment|lot)\\s*\\d+[a-z]?[/ ]\\s*)?\\d+[a-z]?(?:/\\d+[a-z]?)?\\s+'
  + `(?:[A-Z][A-Za-z'-]+\\s+){1,3}(?:${STREET_TYPES})\\b`
  + "(?:\\s*,?\\s*[A-Z][A-Za-z'-]+(?:\\s+[A-Z][A-Za-z'-]+)?)?"
  + `(?:\\s*,?\\s*(?:${STATES.join('|')}))?`
  + '(?:\\s*,?\\s*\\d{4})?',
  'g',
);

const PHONE_RE = /(?:\+?61[\s-]?4\d{2}|\b0[45]\d{2})[\s-]?\d{3}[\s-]?\d{3}\b|\(0[2-8]\)[\s-]?\d{4}[\s-]?\d{4}|\b0[2-8][\s-]?\d{4}[\s-]?\d{4}\b/;
const EMAIL_RE = /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g;

const MONEY_RE = /(?:\$\s?\d[\d,\s]*(?:\.\d+)?\s?(?:k|m|mill|million)?|\bAUD\s?\d[\d,\s]*(?:k|m)?|\b\d{3}(?:,\d{3})+\b|\b\d+(?:\.\d+)?\s?(?:k|m)\b(?![\w])|\b\d{6,7}\b)/i;
const MONEY_RE_G = new RegExp(MONEY_RE.source, 'gi');

const NUMWORD = '(?:zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)';
const MONEY_WORDS_RE = new RegExp(
  `\\b(?:${NUMWORD}(?:[\\s-]+(?:${NUMWORD}|and))*[\\s-]+(?:hundred|thousand|million|grand)(?:[\\s-]+(?:and[\\s-]+)?(?:${NUMWORD}|hundred|thousand|grand))*|(?:half|quarter)\\s+(?:of\\s+)?a\\s+million)\\b`,
  'gi',
);

const MONTH_NAMES = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t|tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const DATE_TOKEN_RE = new RegExp(
  '\\b\\d{4}-\\d{2}-\\d{2}\\b'
  + `|\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:${MONTH_NAMES})\\.?(?:\\s+\\d{2,4})?\\b`
  + `|\\b(?:${MONTH_NAMES})\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?(?:,?\\s+\\d{2,4})?\\b`
  + '|\\b\\d{1,2}[/.-]\\d{1,2}[/.-]\\d{2,4}\\b',
  'gi',
);

const LABEL_PATTERNS = {
  clientName: /(?:^|\n)\s*(?:clients?|borrowers?|applicants?|names?|buyers?)\s*[:\-]\s*(.+)/i,
  clientPhone: /(?:^|\n)\s*(?:phone|mobile|mob|contact|ph)\s*[:\-]\s*(.+)/i,
  clientEmail: /(?:^|\n)\s*(?:e-?mail)\s*[:\-]\s*(.+)/i,
  broker: /(?:^|\n)\s*(?:broker|adviser|advisor|loan writer)\s*[:\-]\s*(.+)/i,
  referredByName: /(?:^|\n)\s*(?:referred by|referrer|referring agent|agent|source)\s*[:\-]\s*(.+)/i,
  loanAmount: /(?:^|\n)\s*(?:loan(?: amount)?|amount|borrowing|finance|lending)\s*[:\-]\s*(.+)/i,
  lender: /(?:^|\n)\s*(?:lender|bank|funder)\s*[:\-]\s*(.+)/i,
  propertyAddress: /(?:^|\n)\s*(?:propert(?:y|ies)|security|address|purchasing)\s*[:\-]\s*(.+)/i,
  purpose: /(?:^|\n)\s*(?:purpose|loan purpose|type)\s*[:\-]\s*(.+)/i,
  stage: /(?:^|\n)\s*(?:stage|status)\s*[:\-]\s*(.+)/i,
  settlementDue: /(?:^|\n)\s*(?:settlement(?: date| due)?)\s*[:\-]\s*(.+)/i,
  financeDue: /(?:^|\n)\s*(?:finance(?: clause| due| date)?)\s*[:\-]\s*(.+)/i,
  contract: /(?:^|\n)\s*(?:contract(?: date| signed)?)\s*[:\-]\s*(.+)/i,
  preApprovalExpiry: /(?:^|\n)\s*(?:pre-?approval(?: expiry| expires)?)\s*[:\-]\s*(.+)/i,
};

// Which key date a phrase is talking about, most specific first.
const DATE_KEYWORDS = [
  ['settledAt', /\bsettled\b|\bsettlement (?:completed|complete|took place|occurred|effected|is done)\b|\bfunds (?:have )?disbursed\b/gi],
  ['preApprovalExpiry', /\bpre-?approval\b[^.\n]{0,40}?\b(?:expir\w*|valid|runs? to|until|lapses?)\b|\b(?:expir\w*|valid|runs? to|until|lapses?)\b[^.\n]{0,30}?\bpre-?approval\b/gi],
  ['financeDue', /\bfinance\b|\bfinance clause\b|\bunconditional (?:by|date|due)\b/gi],
  ['settlementDue', /\bsettlement\b|\bsettling\b|\bsettle on\b|\bsettles\b/gi],
  ['contract', /\bcontract\b|\bsigned\b|\bexchanged?\b|\bunder contract\b/gi],
];

const CONSENT_PATTERNS = [
  /\bhappy for us to (?:keep|let|share|update|tell)[^.\n]*/i,
  /\bhappy for (?:the )?(?:agent|referrer|\w+) to (?:know|hear|be kept)[^.\n]*/i,
  /\b(?:client|clients|they|she|he)(?:'s| is| are|)? (?:fine|ok|okay|comfortable|good|happy) (?:with|for) (?:us|me)(?: to)? (?:shar|updat|tell|keep|let)[^.\n]*/i,
  /\bgave (?:us )?(?:permission|consent)[^.\n]*/i,
  /\bconsent(?:ed)? to (?:us )?(?:shar|updat)[^.\n]*/i,
  /\bok(?:ay)? to (?:keep|update|tell) (?:the )?(?:agent|referrer)[^.\n]*/i,
  /\bwants? (?:the )?agent (?:kept )?in the loop[^.\n]*/i,
];

const FEE_PATTERNS = [
  /\breferral fee (?:has been |was |)disclos(?:ed|ure)[^.\n]*/i,
  /\b(?:i(?:'ve| have)?|we(?:'ve| have)?) disclosed the referral fee[^.\n]*/i,
  /\bdisclos(?:ed|ure) (?:of )?the referral fee[^.\n]*/i,
  /\bfee disclosure (?:signed|done|complete|provided)[^.\n]*/i,
  /\bthey know (?:about )?(?:the|we get a) referral fee[^.\n]*/i,
  /\b(?:i|we) let them know (?:i|we) get a referral fee[^.\n]*/i,
  /\bcredit guide (?:and|&) referral fee[^.\n]*/i,
];

const NO_MILESTONE_PATTERNS = [
  /\bno (?:milestone|update|change|news)\b/i,
  /\bnothing (?:to report|new|has changed)\b/i,
  /\bno stage change\b/i,
  /\bfyi only\b/i,
];

const RELATIVE_EVENT_WORDS = [
  [/\bthis morning\b|\btoday\b|\bjust now\b|\bthis afternoon\b/i, 0],
  [/\byesterday\b/i, -1],
  [/\blast night\b/i, -1],
];

function firstMatch(text, re) {
  const pattern = re.global ? new RegExp(re.source, re.flags.replace('g', '')) : re;
  const m = pattern.exec(text);
  return m ? (m[1] ?? m[0]).trim() : null;
}

function cleanLabelValue(value) {
  if (!value) return null;
  return value.replace(/\s*[|;].*$/, '').replace(/\.$/, '').trim() || null;
}

function escapeRe(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function allMatches(text, re) {
  const pattern = new RegExp(re.source, re.flags.includes('g') ? re.flags : `${re.flags}g`);
  const out = [];
  let m;
  while ((m = pattern.exec(text)) !== null) {
    if (!m[0].length) { pattern.lastIndex += 1; continue; }
    out.push({ text: m[0], index: m.index, end: m.index + m[0].length });
  }
  return out;
}

function detectPurpose(text) {
  const t = text.toLowerCase();
  if (/\brefinanc/.test(t)) return 'refinance';
  if (/\bconstruction\b|\bknock ?down\b|\bbuild(?:ing)? (?:contract|loan)\b|\bhouse and land\b/.test(t)) return 'construction';
  if (/\binvestment (?:loan|property|purchase)\b|\binvestor\b|\brental (?:property|income)\b|\bip purchase\b/.test(t)) return 'investment';
  if (/\bpurchase\b|\bbuying\b|\bfirst home\b|\bupgrader?\b|\bunder contract\b|\bcontract of sale\b|\bcontract signed\b/.test(t)) return 'purchase';
  if (/\bpre-?approval\b|\bpre-?approved\b|\bpre-?app\b/.test(t)) return 'pre_approval';
  return null;
}

function detectLender(text) {
  for (const lender of GUARD_LENDERS) {
    const re = new RegExp(`(?<![\\w])${escapeRe(lender)}(?![\\w])`, 'i');
    if (re.test(text)) return lender;
  }
  const m = /\b(?:with|to|through|via)\s+([A-Z][A-Za-z]+(?:\s+(?:Bank|Money|Financial|Mutual|Credit Union))?)\b/.exec(text);
  if (m && /Bank|Money|Financial|Mutual|Credit Union/.test(m[1])) return m[1];
  return null;
}

function detectAddress(text) {
  const matches = allMatches(text, ADDRESS_RE)
    .map((m) => m.text.replace(/\s+/g, ' ').replace(/\s,/g, ',').trim())
    .filter(Boolean);
  if (!matches.length) return null;
  matches.sort((a, b) => b.length - a.length);
  return matches[0];
}

// A name is capitalised words, optionally joined by "&" or "and". Anything else
// ("happy for us", "the clients") is a phrase the pattern caught by accident.
const NAME_SHAPE = /^[A-Z][A-Za-z'-]*(?:\s+(?:&|and|[A-Z][A-Za-z'-]*))*$/;

function detectClientName(text, { excludeNames = [] } = {}) {
  const candidates = [];
  const labelled = cleanLabelValue(firstMatch(text, LABEL_PATTERNS.clientName));
  if (labelled) {
    const stripped = labelled.replace(/\s*\(.*?\)\s*/g, ' ').replace(/[,;].*$/, '').trim();
    if (/[A-Za-z]/.test(stripped)) candidates.push({ value: stripped, labelled: true });
  }
  // Every pattern below is case sensitive on purpose: with the /i flag, [A-Z]
  // also matches lowercase and "Client is happy for us" yields "happy for us".
  const patterns = [
    /(?:^|\n)\s*[Ss]ubject:\s*(?:[Nn]ew )?(?:[Rr]eferral|[Hh]andover|[Dd]eal)\s*[-\u2013:]\s*([A-Z][^,\n]+?)(?:,|\n|$)/,
    /\b(?:[Ss]ending|[Ss]ent|[Ss]end) (?:you|through|over)\s+([A-Z][a-z]+(?:\s*(?:&|and)\s*[A-Z][a-z]+)?(?:\s+[A-Z][a-z]+){0,2})/,
    /\b(?:[Cc]lients?|[Bb]uyers?|[Bb]orrowers?|[Aa]pplicants?)\s+(?:are|is|:)?\s*([A-Z][a-z]+(?:\s*(?:&|and)\s*[A-Z][a-z]+)?(?:\s+[A-Z][a-z]+){0,2})/,
    /\b[Cc]lient is\s+([A-Z][a-z]+(?:\s*(?:&|and)\s*[A-Z][a-z]+)?(?:\s+[A-Z][a-z]+){0,2})/,
    /\b[Rr]eferral (?:for|of)\s+([A-Z][a-z]+(?:\s*(?:&|and)\s*[A-Z][a-z]+)?(?:\s+[A-Z][a-z]+){0,2})/,
    /\bfor\s+([A-Z][a-z]+(?:\s*(?:&|and)\s*[A-Z][a-z]+)?\s+[A-Z][a-z]+)\b/,
    /\b([A-Z][a-z]+(?:\s*(?:&|and)\s*[A-Z][a-z]+)?\s+[A-Z][a-z]+)\s+(?:are|is|have|has|want|wants|would like|need|needs|owns|buying|purchasing|refinancing|building|settling|looking)\b/,
  ];
  for (const re of patterns) {
    const m = re.exec(text);
    if (m && m[1]) candidates.push({ value: m[1], labelled: false });
  }
  const excluded = excludeNames.filter(Boolean).map((n) => n.toLowerCase());
  for (const candidate of candidates) {
    const name = candidate.value.replace(/\s+and\s+/i, ' & ').replace(/\s+/g, ' ').trim();
    if (!name || name.length < 3) continue;
    const lower = name.toLowerCase();
    if (excluded.some((ex) => ex === lower || ex.includes(lower) || lower.includes(ex))) continue;
    if (/^(?:the|this|that|hi|hello|thanks|regards|subject|from|to)\b/i.test(name)) continue;
    if (!candidate.labelled && !NAME_SHAPE.test(name)) continue;
    return name;
  }
  return null;
}

function detectStage(text) {
  const labelled = cleanLabelValue(firstMatch(text, LABEL_PATTERNS.stage));
  if (labelled) {
    const fromLabel = stageFromMilestoneWord(labelled) || stageFromMilestoneWord(`${labelled} approval`);
    if (fromLabel) return fromLabel;
  }
  return stageFromMilestoneWord(text);
}

/**
 * Pair each key-date keyword with the nearest date token after it. A date is
 * claimed by the closest keyword only, so "finance due 5 Sep and settlement
 * 9 Oct" lands on two different fields.
 */
function detectDates(text, opts) {
  const out = { contract: null, financeDue: null, settlementDue: null, preApprovalExpiry: null, settledAt: null };

  const labelled = {
    settlementDue: cleanLabelValue(firstMatch(text, LABEL_PATTERNS.settlementDue)),
    financeDue: cleanLabelValue(firstMatch(text, LABEL_PATTERNS.financeDue)),
    contract: cleanLabelValue(firstMatch(text, LABEL_PATTERNS.contract)),
    preApprovalExpiry: cleanLabelValue(firstMatch(text, LABEL_PATTERNS.preApprovalExpiry)),
  };
  for (const [key, value] of Object.entries(labelled)) {
    if (!value) continue;
    const token = allMatches(value, DATE_TOKEN_RE)[0];
    const parsed = token ? parseDate(token.text, opts) : parseDate(value, opts);
    if (parsed) out[key] = parsed;
  }

  const dateTokens = allMatches(text, DATE_TOKEN_RE)
    .map((t) => ({ ...t, iso: parseDate(t.text, opts) }))
    .filter((t) => t.iso);
  if (!dateTokens.length) return out;

  const claims = [];
  for (const [field, re] of DATE_KEYWORDS) {
    for (const kw of allMatches(text, re)) {
      for (let i = 0; i < dateTokens.length; i += 1) {
        const token = dateTokens[i];
        const gap = token.index - kw.end;
        if (gap < -1) continue;
        if (gap > 80) continue;
        if (/[.!?\n]/.test(text.slice(kw.end, token.index))) continue;
        claims.push({ field, tokenIndex: i, distance: Math.abs(gap), keywordIndex: kw.index });
        break;
      }
    }
  }
  claims.sort((a, b) => a.distance - b.distance || a.keywordIndex - b.keywordIndex);
  const usedTokens = new Set();
  const priority = DATE_KEYWORDS.map(([field]) => field);
  claims.sort((a, b) => (priority.indexOf(a.field) - priority.indexOf(b.field)) || a.distance - b.distance);
  for (const claim of claims) {
    if (out[claim.field]) continue;
    if (usedTokens.has(claim.tokenIndex)) continue;
    out[claim.field] = dateTokens[claim.tokenIndex].iso;
    usedTokens.add(claim.tokenIndex);
  }
  return out;
}

function detectMoney(text) {
  const labelled = cleanLabelValue(firstMatch(text, LABEL_PATTERNS.loanAmount));
  if (labelled) {
    const parsed = parseMoney(labelled) ?? parseMoney(firstMatch(labelled, MONEY_RE) || '');
    if (parsed) return parsed;
  }
  const sentences = String(text).split(/(?<=[.!?\n])/);
  for (const sentence of sentences) {
    if (!/\bloan\b|\bborrow|\blend|\bfinanc|\bamount\b|\bapprov|\bneed/i.test(sentence)) continue;
    const m = MONEY_RE.exec(sentence);
    if (m) {
      const parsed = parseMoney(m[0]);
      if (parsed && parsed >= 10000) return parsed;
    }
    const words = firstMatch(sentence, MONEY_WORDS_RE);
    if (words) {
      const parsed = parseMoneyWords(words);
      if (parsed && parsed >= 10000) return parsed;
    }
  }
  for (const m of allMatches(text, MONEY_RE_G)) {
    const parsed = parseMoney(m.text);
    if (parsed && parsed >= 50000) return parsed;
  }
  for (const m of allMatches(text, MONEY_WORDS_RE)) {
    const parsed = parseMoneyWords(m.text);
    if (parsed && parsed >= 50000) return parsed;
  }
  return null;
}

function detectEmails(text, { clientName = null, excludeDomains = [] } = {}) {
  const found = allMatches(text, EMAIL_RE).map((m) => m.text.toLowerCase());
  if (!found.length) return null;
  const headerLines = String(text)
    .split('\n')
    .filter((line) => /^\s*(?:from|to|cc|bcc|sender|reply-to)\s*:/i.test(line))
    .join(' ')
    .toLowerCase();
  const nameParts = String(clientName || '')
    .toLowerCase()
    .split(/[^a-z]+/)
    .filter((p) => p.length > 2);
  const scored = found.map((email) => {
    let score = 0;
    if (headerLines.includes(email)) score -= 3;
    if (excludeDomains.some((d) => d && email.endsWith(d.toLowerCase()))) score -= 3;
    if (nameParts.some((part) => email.includes(part))) score += 3;
    return { email, score };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored[0].score < 0 ? null : scored[0].email;
}

/** Match a referring partner by name, first name or agency. */
export function matchPartner(text, partners, hintName) {
  const candidates = [];
  const haystack = String(text || '');
  const hint = String(hintName || '').toLowerCase();
  for (const partner of partners || []) {
    const name = String(partner.name || '');
    const first = name.split(' ')[0];
    const agency = String(partner.agency || '');
    let score = 0;
    const reasons = [];
    if (hint && name && hint.includes(name.toLowerCase())) { score = Math.max(score, 0.95); reasons.push('named as the referrer'); }
    else if (hint && first && hint.includes(first.toLowerCase())) { score = Math.max(score, 0.8); reasons.push('first name given as the referrer'); }
    if (name && new RegExp(`\\b${escapeRe(name)}\\b`, 'i').test(haystack)) { score = Math.max(score, 0.9); reasons.push('full name appears in the handover'); }
    else if (first && new RegExp(`\\b${escapeRe(first)}\\b`, 'i').test(haystack)) { score = Math.max(score, 0.6); reasons.push('first name appears in the handover'); }
    if (agency && new RegExp(`\\b${escapeRe(agency)}\\b`, 'i').test(haystack)) { score = Math.min(1, score + 0.15); reasons.push(`agency ${agency} mentioned`); }
    if (score > 0) {
      candidates.push({ partnerId: partner.id, name: partner.name, score: Math.round(score * 100) / 100, reason: reasons.join('; ') });
    }
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

function detectConsent(text) {
  for (const re of CONSENT_PATTERNS) {
    const m = re.exec(text);
    if (m) return { agreed: true, evidence: m[0].trim().replace(/[,;]$/, '').slice(0, 200) };
  }
  return { agreed: false, evidence: null };
}

function detectFeeDisclosure(text) {
  for (const re of FEE_PATTERNS) {
    const m = re.exec(text);
    if (m) return { agreed: true, evidence: m[0].trim().replace(/[,;]$/, '').slice(0, 200) };
  }
  return { agreed: false, evidence: null };
}

export function questionsForGaps(deal, rag) {
  const label = clientLabel(deal);
  const map = {
    client: 'Who are the clients on this one, as they appear on the application?',
    broker: 'Which broker owns this file?',
    referredBy: 'Who referred this one - which agent, or was it direct?',
    purpose: 'Is this a purchase, refinance, investment, construction or pre-approval?',
    loanAmount: `What loan amount are we working to for ${label}?`,
    lender: 'Which lender is this going to?',
    propertyAddress: 'What is the security property address?',
    'keyDates.settledAt': 'What date did it settle?',
    'client.phone': `What is the best contact number for ${label}?`,
    'client.email': `What email should we use for ${label}?`,
    'keyDates.contract': 'Has the contract been signed, and on what date?',
    'keyDates.financeDue': 'When is the finance clause due?',
    'keyDates.settlementDue': 'Is there a settlement date booked?',
    'keyDates.preApprovalExpiry': 'When does the pre-approval expire?',
  };
  const questions = [];
  for (const gap of [...(rag.critical || []), ...(rag.minor || [])]) {
    const q = map[gap.field];
    if (q && !questions.includes(q)) questions.push(q);
    if (questions.length >= 5) break;
  }
  return questions;
}

function summarise(deal) {
  const bits = [];
  const label = clientLabel(deal);
  bits.push(label === 'your client' ? 'New handover' : label);
  if (deal.purpose) bits.push(deal.purpose.replace('_', '-'));
  if (deal.propertyAddress) bits.push(`for ${shortAddress(deal.propertyAddress)}`);
  if (deal.loanAmount) bits.push(`loan ${Math.round(deal.loanAmount / 1000)}k`);
  if (deal.lender) bits.push(`with ${deal.lender}`);
  if (deal.keyDates?.settlementDue) bits.push(`settlement ${formatShort(deal.keyDates.settlementDue)}`);
  return bits.join(', ');
}

/**
 * Offline handover extraction.
 * @returns the same shape the AI task returns, with provider "heuristic".
 */
export function extractHandoverOffline(text, opts = {}) {
  const source = String(text || '');
  const today = opts.today || todayISO(opts.tz);
  const dateOpts = { tz: opts.tz, today };
  const partners = opts.partners || [];

  const referrerHint = cleanLabelValue(firstMatch(source, LABEL_PATTERNS.referredByName));
  const matches = matchPartner(source, partners, referrerHint);
  const best = matches[0] && matches[0].score >= 0.55 ? matches[0] : null;

  const explicitDirect = !best
    && /\b(?:direct|walk-?in|no referrer|came direct|our own client|existing client)\b/i.test(source);

  const excludeNames = [best?.name, referrerHint, opts.broker, opts.firmName].filter(Boolean);
  const clientName = detectClientName(source, { excludeNames });

  const record = {
    clientName,
    clientPhone: firstMatch(source, PHONE_RE),
    clientEmail: detectEmails(source, {
      clientName,
      excludeDomains: [opts.firmDomain || 'coronisfinance.com.au'],
    }),
    broker: cleanLabelValue(firstMatch(source, LABEL_PATTERNS.broker)) || opts.broker || null,
    referredBy: best ? best.partnerId : (explicitDirect ? 'direct' : null),
    referredByName: best ? best.name : (referrerHint || null),
    stage: detectStage(source) || 'referred',
    purpose: detectPurpose(source),
    loanAmount: detectMoney(source),
    lender: cleanLabelValue(firstMatch(source, LABEL_PATTERNS.lender)) || detectLender(source),
    propertyAddress: cleanLabelValue(firstMatch(source, LABEL_PATTERNS.propertyAddress)) || detectAddress(source),
    keyDates: detectDates(source, dateOpts),
    channel: opts.channel || 'notes',
  };
  if (record.propertyAddress) {
    record.propertyAddress = detectAddress(record.propertyAddress) || record.propertyAddress;
  }
  if (!record.purpose && record.keyDates.contract) record.purpose = 'purchase';

  const deal = normaliseDeal(record, { tz: opts.tz, today });
  const rag = ragForDeal(deal);
  const consent = detectConsent(source);
  const fee = detectFeeDisclosure(source);

  const confidence = {};
  const set = (key, value, score) => { confidence[key] = value == null || value === '' ? 0 : score; };
  set('client', deal.client.name, cleanLabelValue(firstMatch(source, LABEL_PATTERNS.clientName)) ? 0.9 : 0.65);
  set('client.phone', deal.client.phone, 0.9);
  set('client.email', deal.client.email, 0.9);
  set('broker', deal.broker, 0.8);
  set('referredBy', deal.referredBy, best ? best.score : 0.5);
  set('stage', deal.stage, detectStage(source) ? 0.8 : 0.4);
  set('purpose', deal.purpose, 0.75);
  set('loanAmount', deal.loanAmount, cleanLabelValue(firstMatch(source, LABEL_PATTERNS.loanAmount)) ? 0.9 : 0.7);
  set('lender', deal.lender, 0.8);
  set('propertyAddress', deal.propertyAddress, 0.8);
  set('keyDates', Object.values(deal.keyDates).find(Boolean), 0.7);

  return {
    record: {
      client: deal.client,
      broker: deal.broker,
      referredBy: deal.referredBy,
      referredByName: deal.referredByName,
      stage: deal.stage,
      purpose: deal.purpose,
      loanAmount: deal.loanAmount,
      lender: deal.lender,
      propertyAddress: deal.propertyAddress,
      keyDates: deal.keyDates,
      channel: record.channel,
    },
    summary: summarise(deal),
    missing: rag.missing,
    rag: rag.rag,
    questions: questionsForGaps(deal, rag),
    confidence,
    partnerMatch: best ? { ...best } : null,
    partnerAlternates: matches.slice(0, 4),
    suggestedConsent: {
      shareStatus: consent.agreed,
      shareStatusEvidence: consent.evidence,
      feeDisclosed: fee.agreed,
      feeDisclosedEvidence: fee.evidence,
    },
    provider: 'heuristic',
  };
}

/** The date the milestone happened, not the next date the email mentions. */
function milestoneEventDate(text, opts) {
  const today = opts.today;
  const sentences = String(text).split(/(?<=[.!?\n])/);
  const milestoneSentences = sentences.filter((s) => stageFromMilestoneWord(s));
  const pool = milestoneSentences.length ? milestoneSentences : sentences;
  for (const sentence of pool) {
    for (const [re, offset] of RELATIVE_EVENT_WORDS) {
      if (re.test(sentence)) return addDays(today, offset);
    }
  }
  for (const sentence of pool) {
    if (/\bsettlement (?:is|remains|has been)? ?(?:booked|scheduled|set)\b/i.test(sentence)) continue;
    const token = allMatches(sentence, DATE_TOKEN_RE)[0];
    if (token) {
      const parsed = parseDate(token.text, opts);
      if (parsed) return parsed;
    }
  }
  return today;
}

/**
 * Offline BPU milestone parsing. Never auto-links on a surname alone.
 */
export function parseMilestoneOffline(text, openDeals = [], opts = {}) {
  const source = String(text || '');
  const today = opts.today || todayISO(opts.tz);
  const dateOpts = { tz: opts.tz, today };

  const noMilestone = NO_MILESTONE_PATTERNS.some((re) => re.test(source));
  const stage = noMilestone ? null : stageFromMilestoneWord(source);
  const eventDate = noMilestone ? null : milestoneEventDate(source, dateOpts);
  const dates = detectDates(source, dateOpts);
  if (stage === 'settled' && !dates.settledAt) dates.settledAt = eventDate;

  const candidates = [];
  for (const deal of openDeals) {
    let score = 0;
    const reasons = [];
    const weak = [];

    const ref = deal.ref || '';
    if (ref && new RegExp(`\\b${escapeRe(ref)}\\b`, 'i').test(source)) {
      score = Math.max(score, 0.95);
      reasons.push(`reference ${ref} quoted`);
    }
    const address = shortAddress(deal.propertyAddress);
    if (address && new RegExp(escapeRe(address), 'i').test(source)) {
      score = Math.max(score, 0.85);
      reasons.push(`security address matches (${address})`);
    }
    const fullName = deal.client?.name || '';
    if (fullName && new RegExp(`\\b${escapeRe(fullName)}\\b`, 'i').test(source)) {
      score = Math.max(score, 0.8);
      reasons.push('client name matches');
    }
    const surname = fullName.split(' ').filter(Boolean).pop();
    if (surname && surname.length > 2 && new RegExp(`\\b${escapeRe(surname)}\\b`, 'i').test(source)) {
      weak.push(`surname ${surname} appears`);
      score = Math.max(score, 0.35);
    }
    const suburb = (deal.propertyAddress || '').split(',')[1]?.trim().split(' ')[0];
    if (suburb && suburb.length > 3 && new RegExp(`\\b${escapeRe(suburb)}\\b`, 'i').test(source)) {
      score = Math.min(1, score + 0.15);
      reasons.push(`suburb ${suburb} mentioned`);
    }
    if (deal.lender && new RegExp(`\\b${escapeRe(deal.lender)}\\b`, 'i').test(source)) {
      score = Math.min(1, score + 0.1);
      reasons.push(`lender ${deal.lender} mentioned`);
    }
    if (score <= 0) continue;
    candidates.push({
      dealId: deal.id,
      ref: deal.ref,
      clientLabel: clientLabel(deal),
      address: deal.propertyAddress || null,
      stage: deal.stage,
      score: Math.round(score * 100) / 100,
      reason: [...reasons, ...weak].join('; ') || 'weak match',
      surnameOnly: reasons.length === 0,
    });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates[0] || null;
  const linkable = top && top.score >= 0.6 && !top.surnameOnly ? top : null;

  return {
    noMilestone,
    stage,
    eventDate,
    keyDates: dates,
    dealId: linkable ? linkable.dealId : null,
    score: linkable ? linkable.score : (top ? top.score : 0),
    reason: linkable
      ? linkable.reason
      : (top
        ? (top.surnameOnly
          ? `Only a surname matched (${top.reason}). Confirm the file before applying.`
          : `Best match is weak (${top.reason}).`)
        : 'No open deal matched this email.'),
    alternates: candidates.slice(0, 4),
    provider: 'heuristic',
  };
}

export function openDealsFor(deals) {
  return (deals || []).filter((d) => isLive(d.stage));
}
