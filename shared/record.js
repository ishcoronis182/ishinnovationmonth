// The one record: ten fields, plus the Green / Amber / Red rule. Pure, no I/O.

import { parseMoney, roundCents } from './money.js';
import { parseDate, isValidISODate, DEFAULT_TZ, todayISO, daysBetween } from './dates.js';
import { STAGES, ALL_STAGES, isStage, atOrPast, stageIndex, isOffRamp } from './stages.js';

export const PURPOSES = ['purchase', 'refinance', 'investment', 'construction', 'pre_approval', 'other'];

export const PURPOSE_LABELS = {
  purchase: 'Purchase',
  refinance: 'Refinance',
  investment: 'Investment',
  construction: 'Construction',
  pre_approval: 'Pre-approval',
  other: 'Other',
};

export const CHANNELS = ['email', 'notes', 'voice', 'milestone', 'manual', 'portal'];

export const DATE_FIELDS = ['contract', 'financeDue', 'settlementDue', 'preApprovalExpiry', 'settledAt'];

export const DATE_LABELS = {
  contract: 'Contract date',
  financeDue: 'Finance due',
  settlementDue: 'Settlement due',
  preApprovalExpiry: 'Pre-approval expiry',
  settledAt: 'Settled on',
};

export const COMMS_STATUSES = ['not_applicable', 'pending', 'due', 'on_statement', 'paid', 'void'];

/** The ten fields of the one record, in the order the UI shows them. */
export const TEN_FIELDS = [
  { key: 'client', label: 'Client', hint: 'Name, phone, email' },
  { key: 'broker', label: 'Broker', hint: 'Who owns the file' },
  { key: 'referredBy', label: 'Referred by', hint: 'Partner, direct, or unknown' },
  { key: 'stage', label: 'Stage', hint: 'Referred through to settled' },
  { key: 'purpose', label: 'Purpose', hint: 'Purchase, refinance, investment...' },
  { key: 'loanAmount', label: 'Loan amount', hint: 'Dollars' },
  { key: 'lender', label: 'Lender', hint: 'Required once lodged' },
  { key: 'propertyAddress', label: 'Security property', hint: 'Required for a purchase' },
  { key: 'keyDates', label: 'Key dates', hint: 'Contract, finance, settlement, expiry' },
  { key: 'referralComms', label: 'Referral comms', hint: 'Rule, amount, status' },
];

const INVISIBLE_SPACES = /[   -​  　﻿­⁠]/g;

export function blankConsent() {
  return {
    shareStatus: false,
    shareStatusAt: null,
    shareStatusEvidence: null,
    feeDisclosed: false,
    feeDisclosedAt: null,
    feeDisclosedEvidence: null,
  };
}

export function blankDeal() {
  return {
    id: null,
    ref: null,
    client: { name: null, phone: null, email: null },
    broker: null,
    referredBy: null,
    referredByName: null,
    stage: 'referred',
    purpose: null,
    loanAmount: null,
    lender: null,
    propertyAddress: null,
    keyDates: { contract: null, financeDue: null, settlementDue: null, preApprovalExpiry: null, settledAt: null },
    referralComms: { ruleId: null, ruleName: null, amount: null, status: 'pending', statementId: null, paidAt: null },
    consent: blankConsent(),
    channel: 'manual',
    source: null,
    summary: null,
    questions: [],
    confidence: {},
    notes: [],
    timeline: [],
    enquiries: [],
    rag: 'red',
    arrivalRag: null,
    referredAt: null,
    stageEnteredAt: null,
    createdAt: null,
    updatedAt: null,
    aiProvider: null,
    lastUpdateAt: null,
    updateCount: 0,
  };
}

function cleanString(value, { max = 400 } = {}) {
  if (value == null) return null;
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(INVISIBLE_SPACES, ' ').replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;
  if (/^(unknown|n\/a|na|none|null|tbc|tba|-|\?)$/i.test(trimmed)) return null;
  return trimmed.slice(0, max);
}

export function normalisePhone(value) {
  const raw = cleanString(value, { max: 40 });
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  const plain = digits.replace(/^\+?61/, '0').replace(/\D/g, '');
  if (plain.length === 10 && plain.startsWith('04')) {
    return `${plain.slice(0, 4)} ${plain.slice(4, 7)} ${plain.slice(7)}`;
  }
  if (plain.length === 10 && plain.startsWith('0')) {
    return `(${plain.slice(0, 2)}) ${plain.slice(2, 6)} ${plain.slice(6)}`;
  }
  if (plain.length < 6) return null;
  return raw;
}

export function normaliseEmail(value) {
  const raw = cleanString(value, { max: 200 });
  if (!raw) return null;
  const candidate = raw.toLowerCase().replace(/^mailto:/, '').replace(/[<>]/g, '');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) return null;
  return candidate;
}

export function normalisePurpose(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (PURPOSES.includes(key)) return key;
  if (/pre_?approval|preapproval/.test(key)) return 'pre_approval';
  if (/refi/.test(key)) return 'refinance';
  if (/invest/.test(key)) return 'investment';
  if (/constru|build|knock_?down/.test(key)) return 'construction';
  if (/purchas|buy|first_?home|upgrad/.test(key)) return 'purchase';
  if (key === 'other') return 'other';
  return null;
}

export function normaliseStage(value) {
  const raw = cleanString(value);
  if (!raw) return null;
  const key = raw.toLowerCase().replace(/[\s-]+/g, '_');
  if (isStage(key)) return key;
  if (/formal/.test(key)) return 'formal';
  if (/condition/.test(key)) return 'conditional';
  if (/lodg/.test(key)) return 'lodged';
  if (/settl/.test(key)) return 'settled';
  if (/declin/.test(key)) return 'declined';
  if (/withdraw|cancel/.test(key)) return 'withdrawn';
  if (/applic/.test(key)) return 'application';
  if (/refer/.test(key)) return 'referred';
  return null;
}

function normaliseConfidence(input) {
  const out = {};
  if (!input || typeof input !== 'object') return out;
  for (const [key, value] of Object.entries(input)) {
    const n = Number(value);
    if (!Number.isFinite(n)) continue;
    const clamped = n > 1 ? Math.min(1, n / 100) : Math.max(0, n);
    out[key] = Math.round(clamped * 100) / 100;
  }
  return out;
}

function pick(...values) {
  for (const v of values) {
    if (v !== undefined && v !== null && v !== '') return v;
  }
  return undefined;
}

/**
 * Coerce anything (AI output, a form post, a stored record) into the canonical
 * ten-field shape. Never throws.
 */
export function normaliseDeal(input, opts = {}) {
  const tz = opts.tz || DEFAULT_TZ;
  const today = opts.today || todayISO(tz, opts.now);
  const src = input && typeof input === 'object' ? input : {};
  const base = blankDeal();
  const clientIn = src.client && typeof src.client === 'object' ? src.client : {};
  const datesIn = src.keyDates && typeof src.keyDates === 'object' ? src.keyDates : {};
  const commsIn = src.referralComms && typeof src.referralComms === 'object' ? src.referralComms : {};
  const consentIn = src.consent && typeof src.consent === 'object' ? src.consent : {};

  const deal = {
    ...base,
    id: cleanString(src.id, { max: 60 }) || null,
    ref: cleanString(src.ref, { max: 30 }) || null,
    client: {
      name: cleanString(pick(clientIn.name, src.clientName), { max: 120 }),
      phone: normalisePhone(pick(clientIn.phone, src.clientPhone)),
      email: normaliseEmail(pick(clientIn.email, src.clientEmail)),
    },
    broker: cleanString(pick(src.broker, src.brokerName), { max: 80 }),
    referredBy: normaliseReferredBy(pick(src.referredBy, src.referredByPartnerId, src.partnerId)),
    referredByName: cleanString(pick(src.referredByName, src.referrerName), { max: 120 }),
    stage: normaliseStage(src.stage) || 'referred',
    purpose: normalisePurpose(pick(src.purpose, src.loanPurpose)),
    loanAmount: parseMoney(pick(src.loanAmount, src.amount, src.loan)),
    lender: cleanString(src.lender, { max: 80 }),
    propertyAddress: cleanString(pick(src.propertyAddress, src.securityProperty, src.address), { max: 200 }),
    keyDates: {
      contract: normaliseDate(pick(datesIn.contract, src.contractDate), { tz, today }),
      financeDue: normaliseDate(pick(datesIn.financeDue, src.financeDue), { tz, today }),
      settlementDue: normaliseDate(pick(datesIn.settlementDue, src.settlementDue), { tz, today }),
      preApprovalExpiry: normaliseDate(pick(datesIn.preApprovalExpiry, src.preApprovalExpiry), { tz, today }),
      settledAt: normaliseDate(pick(datesIn.settledAt, src.settledAt), { tz, today }),
    },
    referralComms: {
      ruleId: cleanString(commsIn.ruleId, { max: 60 }),
      ruleName: cleanString(commsIn.ruleName, { max: 120 }),
      amount: commsIn.amount == null || commsIn.amount === '' ? null : roundCents(Number(commsIn.amount)),
      status: COMMS_STATUSES.includes(commsIn.status) ? commsIn.status : 'pending',
      statementId: cleanString(commsIn.statementId, { max: 60 }),
      paidAt: normaliseDate(commsIn.paidAt, { tz, today }),
    },
    consent: {
      shareStatus: consentIn.shareStatus === true,
      shareStatusAt: cleanString(consentIn.shareStatusAt, { max: 40 }),
      shareStatusEvidence: cleanString(consentIn.shareStatusEvidence, { max: 300 }),
      feeDisclosed: consentIn.feeDisclosed === true,
      feeDisclosedAt: cleanString(consentIn.feeDisclosedAt, { max: 40 }),
      feeDisclosedEvidence: cleanString(consentIn.feeDisclosedEvidence, { max: 300 }),
    },
    channel: CHANNELS.includes(src.channel) ? src.channel : 'manual',
    source: cleanString(src.source, { max: 40 }),
    summary: cleanString(src.summary, { max: 400 }),
    questions: Array.isArray(src.questions)
      ? src.questions.map((q) => cleanString(q, { max: 240 })).filter(Boolean).slice(0, 5)
      : [],
    confidence: normaliseConfidence(src.confidence),
    notes: Array.isArray(src.notes) ? src.notes : [],
    timeline: Array.isArray(src.timeline) ? src.timeline : [],
    enquiries: Array.isArray(src.enquiries) ? src.enquiries : [],
    arrivalRag: ['red', 'amber', 'green'].includes(src.arrivalRag) ? src.arrivalRag : null,
    referredAt: normaliseDate(src.referredAt, { tz, today }),
    stageEnteredAt: cleanString(src.stageEnteredAt, { max: 40 }),
    createdAt: cleanString(src.createdAt, { max: 40 }),
    updatedAt: cleanString(src.updatedAt, { max: 40 }),
    aiProvider: cleanString(src.aiProvider, { max: 30 }),
    lastUpdateAt: cleanString(src.lastUpdateAt, { max: 40 }),
    updateCount: Number.isFinite(Number(src.updateCount)) ? Number(src.updateCount) : 0,
  };

  const rag = ragForDeal(deal);
  deal.rag = rag.rag;
  return deal;
}

export function normaliseReferredBy(value) {
  const raw = cleanString(value, { max: 60 });
  if (!raw) return null;
  const key = raw.toLowerCase();
  if (key === 'direct' || key === 'no referrer' || key === 'self') return 'direct';
  if (key === 'unknown' || key === 'not stated') return null;
  return raw;
}

function normaliseDate(value, { tz, today }) {
  if (value == null || value === '') return null;
  if (isValidISODate(value)) return value;
  return parseDate(value, { tz, today });
}

/** Which key dates a deal of this shape is expected to carry. */
export function expectedDateFields(deal) {
  const out = [];
  const purpose = deal?.purpose;
  const stage = deal?.stage;
  if (purpose === 'purchase' || purpose === 'investment' || purpose === 'construction') {
    out.push('contract', 'financeDue', 'settlementDue');
  } else if (purpose === 'refinance') {
    out.push('settlementDue');
  } else if (purpose === 'pre_approval') {
    out.push('preApprovalExpiry');
  } else if (purpose === 'other') {
    out.push('settlementDue');
  }
  if (stage === 'settled') out.push('settledAt');
  return [...new Set(out)];
}

/**
 * Red when a critical field is missing, amber for minor gaps only, green when
 * all ten fields are complete.
 */
export function ragForDeal(deal) {
  const critical = [];
  const minor = [];
  const d = deal || {};
  const stage = d.stage || 'referred';
  const purpose = d.purpose;

  if (!d.client?.name) critical.push({ field: 'client', label: 'Client name' });
  if (!d.broker) critical.push({ field: 'broker', label: 'Broker' });
  if (!d.referredBy) critical.push({ field: 'referredBy', label: 'Referred by (unknown)' });
  if (!purpose) critical.push({ field: 'purpose', label: 'Purpose' });
  if (d.loanAmount == null) critical.push({ field: 'loanAmount', label: 'Loan amount' });
  if (!d.lender && atOrPast(stage, 'lodged')) {
    critical.push({ field: 'lender', label: 'Lender (required once lodged)' });
  }
  if (!d.propertyAddress && purpose === 'purchase') {
    critical.push({ field: 'propertyAddress', label: 'Security property (required for a purchase)' });
  }
  if (stage === 'settled' && !d.keyDates?.settledAt) {
    critical.push({ field: 'keyDates.settledAt', label: 'Settlement date' });
  }

  if (!d.client?.phone) minor.push({ field: 'client.phone', label: 'Client phone' });
  if (!d.client?.email) minor.push({ field: 'client.email', label: 'Client email' });
  if (!d.lender && !atOrPast(stage, 'lodged')) {
    minor.push({ field: 'lender', label: 'Lender (not yet lodged)' });
  }
  if (!d.propertyAddress && purpose && purpose !== 'purchase' && purpose !== 'pre_approval') {
    minor.push({ field: 'propertyAddress', label: 'Security property' });
  }
  for (const key of expectedDateFields(d)) {
    if (key === 'settledAt' && stage === 'settled') continue; // already critical
    if (!d.keyDates?.[key]) minor.push({ field: `keyDates.${key}`, label: DATE_LABELS[key] });
  }

  const rag = critical.length ? 'red' : (minor.length ? 'amber' : 'green');
  return {
    rag,
    critical,
    minor,
    missing: [...critical, ...minor].map((m) => m.label),
    missingFields: [...critical, ...minor].map((m) => m.field),
  };
}

export function missingList(deal) {
  return ragForDeal(deal).missing;
}

export function isFieldMissing(deal, field) {
  return ragForDeal(deal).missingFields.includes(field);
}

/** "Sam & Jo Taylor" -> "Sam & Jo T." Used in partner-facing copy. */
export function clientLabel(deal) {
  const name = typeof deal === 'string' ? deal : deal?.client?.name;
  const clean = cleanString(name, { max: 120 });
  if (!clean) return 'your client';
  const normalised = clean.replace(/\s+and\s+/gi, ' & ');
  const parts = normalised.split(' ').filter(Boolean);
  if (parts.length === 1) return parts[0];
  const surname = parts[parts.length - 1];
  const rest = parts.slice(0, -1).join(' ');
  return `${rest} ${surname[0].toUpperCase()}.`;
}

/** "Sam & Jo Taylor" -> "S. & J. T." Portal views show initials only. */
export function clientInitials(deal) {
  const name = typeof deal === 'string' ? deal : deal?.client?.name;
  const clean = cleanString(name, { max: 120 });
  if (!clean) return 'Client';
  const normalised = clean.replace(/\s+and\s+/gi, ' & ');
  return normalised
    .split(' ')
    .filter(Boolean)
    .map((part) => (part === '&' ? '&' : `${part[0].toUpperCase()}.`))
    .join(' ');
}

/** "42 Wattlebird Cres, Lutwyche QLD 4030" -> "42 Wattlebird Cres" */
export function shortAddress(address) {
  const clean = cleanString(address, { max: 200 });
  if (!clean) return null;
  return clean.split(',')[0].trim();
}

export function daysInStage(deal, today) {
  const at = deal?.stageEnteredAt || deal?.createdAt;
  if (!at) return null;
  const iso = String(at).slice(0, 10);
  if (!isValidISODate(iso) || !isValidISODate(today)) return null;
  const n = daysBetween(iso, today);
  return n == null ? null : Math.max(0, n);
}

/** The next thing the partner would care about. */
export function nextMilestone(deal, today) {
  const d = deal || {};
  const dates = d.keyDates || {};
  const candidates = [];
  if (d.stage === 'settled') {
    if (dates.settledAt) candidates.push({ key: 'settledAt', label: 'Settled', date: dates.settledAt });
  } else if (isOffRamp(d.stage)) {
    return null;
  } else {
    if (dates.settlementDue) candidates.push({ key: 'settlementDue', label: 'Settlement booked', date: dates.settlementDue });
    if (dates.financeDue) candidates.push({ key: 'financeDue', label: 'Finance due', date: dates.financeDue });
    if (dates.preApprovalExpiry) {
      candidates.push({ key: 'preApprovalExpiry', label: 'Pre-approval expires', date: dates.preApprovalExpiry });
    }
  }
  if (!candidates.length) return null;
  const future = candidates.filter((c) => !today || c.date >= today);
  const list = future.length ? future : candidates;
  list.sort((a, b) => (a.date < b.date ? -1 : 1));
  const chosen = list[0];
  return { ...chosen, daysAway: today ? daysBetween(today, chosen.date) : null };
}

export function isReferred(deal) {
  const by = deal?.referredBy;
  return Boolean(by) && by !== 'direct';
}

export function stageOrderValue(deal) {
  const i = stageIndex(deal?.stage);
  return i < 0 ? STAGES.length + ALL_STAGES.indexOf(deal?.stage) : i;
}
