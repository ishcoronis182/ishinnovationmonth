// Deal invariants. Every mutation appends a timeline event and re-derives the
// RAG. Nothing here touches disk.

import { normaliseDeal, ragForDeal, isReferred, clientLabel } from '../shared/record.js';
import { canTransition, isOffRamp, stageLabel } from '../shared/stages.js';
import { resolveRule, computeCommission, isOnIssuedStatement } from '../shared/commission.js';
import { formatMoney } from '../shared/money.js';
import { randomId, nextRef } from './ids.js';

export function timelineEvent({ type, message, meta = null, actor = 'broker', at }) {
  return {
    id: randomId('ev', 8),
    at,
    type,
    message,
    actor,
    meta,
  };
}

export function appendTimeline(deal, event) {
  if (!Array.isArray(deal.timeline)) deal.timeline = [];
  deal.timeline.push(event);
  if (deal.timeline.length > 400) deal.timeline = deal.timeline.slice(-400);
  return deal;
}

function refresh(deal, ctx) {
  const rag = ragForDeal(deal);
  deal.rag = rag.rag;
  deal.updatedAt = ctx.now;
  return deal;
}

/** A new record, straight off a handover or the manual form. */
export function createDeal(input, ctx) {
  const deal = normaliseDeal(input, { tz: ctx.tz, today: ctx.today });
  deal.id = deal.id || randomId('deal', 10);
  deal.ref = deal.ref || nextRef(ctx.refCounter, 'PP');
  deal.createdAt = ctx.now;
  deal.updatedAt = ctx.now;
  deal.stageEnteredAt = ctx.now;
  deal.referredAt = deal.referredAt || ctx.today;
  const rag = ragForDeal(deal);
  deal.rag = rag.rag;
  deal.arrivalRag = deal.arrivalRag || rag.rag;
  deal.timeline = [];
  appendTimeline(deal, timelineEvent({
    type: 'created',
    message: `Record created from a ${deal.channel} handover. ${rag.rag.toUpperCase()} on arrival${rag.missing.length ? `: missing ${rag.missing.join(', ')}` : ''}.`,
    meta: { arrivalRag: rag.rag, missing: rag.missing, provider: deal.aiProvider || null },
    actor: ctx.actor || 'broker',
    at: ctx.now,
  }));
  if (deal.stage === 'settled') {
    applyCommission(deal, ctx);
  } else if (!isReferred(deal)) {
    deal.referralComms.status = 'not_applicable';
  }
  return deal;
}

const PATCHABLE = new Set([
  'client', 'broker', 'referredBy', 'referredByName', 'purpose', 'loanAmount',
  'lender', 'propertyAddress', 'keyDates', 'summary',
]);

function describeValue(value) {
  if (value == null || value === '') return 'empty';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Apply an inline edit. Returns the fields that actually changed. */
export function patchDeal(deal, patch, ctx) {
  const merged = { ...deal };
  const requested = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!PATCHABLE.has(key)) continue;
    requested[key] = value;
  }
  if (!Object.keys(requested).length) return { deal, changes: [] };

  if (requested.client) {
    merged.client = { ...deal.client, ...requested.client };
    delete requested.client;
  }
  if (requested.keyDates) {
    merged.keyDates = { ...deal.keyDates, ...requested.keyDates };
    delete requested.keyDates;
  }
  Object.assign(merged, requested);

  const normalised = normaliseDeal(merged, { tz: ctx.tz, today: ctx.today });
  const changes = [];
  const compare = [
    ['client.name', deal.client?.name, normalised.client?.name],
    ['client.phone', deal.client?.phone, normalised.client?.phone],
    ['client.email', deal.client?.email, normalised.client?.email],
    ['broker', deal.broker, normalised.broker],
    ['referredBy', deal.referredBy, normalised.referredBy],
    ['purpose', deal.purpose, normalised.purpose],
    ['loanAmount', deal.loanAmount, normalised.loanAmount],
    ['lender', deal.lender, normalised.lender],
    ['propertyAddress', deal.propertyAddress, normalised.propertyAddress],
    ['keyDates.contract', deal.keyDates?.contract, normalised.keyDates?.contract],
    ['keyDates.financeDue', deal.keyDates?.financeDue, normalised.keyDates?.financeDue],
    ['keyDates.settlementDue', deal.keyDates?.settlementDue, normalised.keyDates?.settlementDue],
    ['keyDates.preApprovalExpiry', deal.keyDates?.preApprovalExpiry, normalised.keyDates?.preApprovalExpiry],
    ['keyDates.settledAt', deal.keyDates?.settledAt, normalised.keyDates?.settledAt],
    ['summary', deal.summary, normalised.summary],
  ];
  for (const [field, before, after] of compare) {
    if (before !== after) changes.push({ field, from: before ?? null, to: after ?? null });
  }
  if (!changes.length) return { deal, changes: [] };

  // Keep the parts normaliseDeal cannot know about.
  normalised.timeline = deal.timeline;
  normalised.notes = deal.notes;
  normalised.enquiries = deal.enquiries;
  normalised.consent = deal.consent;
  normalised.arrivalRag = deal.arrivalRag;
  normalised.createdAt = deal.createdAt;
  normalised.stageEnteredAt = deal.stageEnteredAt;
  normalised.referredAt = deal.referredAt;
  normalised.channel = deal.channel;
  normalised.aiProvider = deal.aiProvider;
  normalised.lastUpdateAt = deal.lastUpdateAt;
  normalised.updateCount = deal.updateCount;
  normalised.questions = deal.questions;
  normalised.confidence = deal.confidence;
  normalised.referralComms = { ...deal.referralComms };
  normalised.stage = deal.stage;

  appendTimeline(normalised, timelineEvent({
    type: 'field_changed',
    message: changes.map((c) => `${c.field}: ${describeValue(c.from)} -> ${describeValue(c.to)}`).join('; '),
    meta: { changes },
    actor: ctx.actor || 'broker',
    at: ctx.now,
  }));

  if (normalised.stage === 'settled' && changes.some((c) => c.field === 'loanAmount' || c.field === 'referredBy')) {
    applyCommission(normalised, ctx);
  }
  if (!isReferred(normalised) && normalised.referralComms.status !== 'paid') {
    normalised.referralComms.status = 'not_applicable';
    normalised.referralComms.amount = null;
  } else if (isReferred(normalised) && normalised.referralComms.status === 'not_applicable') {
    normalised.referralComms.status = normalised.stage === 'settled' ? 'due' : 'pending';
  }
  refresh(normalised, ctx);
  return { deal: normalised, changes };
}

export function applyCommission(deal, ctx) {
  if (!isReferred(deal)) {
    deal.referralComms = {
      ruleId: null,
      ruleName: null,
      amount: null,
      status: 'not_applicable',
      statementId: null,
      paidAt: null,
    };
    return { amount: null, rule: null };
  }
  const rule = resolveRule(ctx.rules || [], {
    partnerId: deal.referredBy,
    onDate: deal.keyDates?.settledAt || deal.referredAt || ctx.today,
  });
  const computed = computeCommission(deal, rule);
  const keepStatus = deal.referralComms?.status;
  deal.referralComms = {
    ruleId: computed.ruleId,
    ruleName: computed.ruleName,
    amount: computed.amount,
    status: keepStatus === 'paid' || keepStatus === 'void' || keepStatus === 'on_statement'
      ? keepStatus
      : (deal.stage === 'settled' ? 'due' : 'pending'),
    statementId: deal.referralComms?.statementId || null,
    paidAt: deal.referralComms?.paidAt || null,
  };
  return { amount: computed.amount, rule, anomalies: computed.anomalies, basis: computed.basis };
}

/**
 * Move a deal to another stage. Settled deals are locked; use reopenDeal.
 */
export function moveStage(deal, { stage, eventDate, keyDates, reason }, ctx) {
  const check = canTransition(deal.stage, stage);
  if (!check.ok) return { ok: false, error: check };

  const next = { ...deal, keyDates: { ...deal.keyDates } };
  const from = deal.stage;
  next.stage = stage;
  next.stageEnteredAt = ctx.now;
  const at = eventDate || ctx.today;

  if (keyDates && typeof keyDates === 'object') {
    const merged = normaliseDeal({ ...next, keyDates: { ...next.keyDates, ...keyDates } }, { tz: ctx.tz, today: ctx.today });
    next.keyDates = merged.keyDates;
  }
  if (stage === 'settled' && !next.keyDates.settledAt) {
    next.keyDates.settledAt = at;
  }
  if (stage !== 'settled' && from === 'settled') {
    next.keyDates.settledAt = null;
  }

  appendTimeline(next, timelineEvent({
    type: 'stage_changed',
    message: `Stage ${stageLabel(from)} -> ${stageLabel(stage)}${eventDate && eventDate !== ctx.today ? ` (effective ${eventDate})` : ''}${reason ? `. ${reason}` : ''}`,
    meta: { from, to: stage, eventDate: at, backwards: Boolean(check.backwards) },
    actor: ctx.actor || 'broker',
    at: ctx.now,
  }));

  if (stage === 'settled') {
    const result = applyCommission(next, ctx);
    appendTimeline(next, timelineEvent({
      type: 'commission_computed',
      message: result.rule
        ? `Referral commission ${formatMoney(result.amount)} (${result.basis}) under rule ${result.rule.name}.`
        : 'Settled with no commission rule in effect.',
      meta: { amount: result.amount, ruleId: result.rule?.id || null, anomalies: result.anomalies || [] },
      actor: 'system',
      at: ctx.now,
    }));
  } else if (isOffRamp(stage)) {
    next.referralComms = { ...next.referralComms, status: isReferred(next) ? 'void' : 'not_applicable', amount: null };
  }

  refresh(next, ctx);
  return { ok: true, deal: next, from, to: stage };
}

/**
 * Reopening a settled deal is an explicit action. It refuses when the deal
 * sits on an issued statement; the caller strips any draft statement lines.
 */
export function reopenDeal(deal, { stage = 'formal', reason }, ctx) {
  if (deal.stage !== 'settled') {
    return { ok: false, error: { reason: 'not_settled', message: 'Only a settled deal needs reopening.' } };
  }
  const issued = isOnIssuedStatement(deal.id, ctx.statements || []);
  if (issued) {
    return {
      ok: false,
      error: {
        reason: 'on_issued_statement',
        message: `This deal is on statement ${issued.id} (${issued.status}). Void that statement before reopening the deal.`,
        statementId: issued.id,
      },
    };
  }
  const next = { ...deal, keyDates: { ...deal.keyDates } };
  next.stage = stage;
  next.stageEnteredAt = ctx.now;
  next.keyDates.settledAt = null;
  next.referralComms = {
    ruleId: null,
    ruleName: null,
    amount: null,
    status: isReferred(next) ? 'pending' : 'not_applicable',
    statementId: null,
    paidAt: null,
  };
  appendTimeline(next, timelineEvent({
    type: 'reopened',
    message: `Deal reopened to ${stageLabel(stage)}. Settlement date and commission cleared.${reason ? ` ${reason}` : ''}`,
    meta: { stage, reason: reason || null },
    actor: ctx.actor || 'broker',
    at: ctx.now,
  }));
  refresh(next, ctx);
  return { ok: true, deal: next };
}

/** Consent is only ever set by a human confirming it. */
export function setConsent(deal, { shareStatus, feeDisclosed, evidence }, ctx) {
  const next = { ...deal, consent: { ...deal.consent } };
  const changes = [];
  if (typeof shareStatus === 'boolean' && shareStatus !== next.consent.shareStatus) {
    next.consent.shareStatus = shareStatus;
    next.consent.shareStatusAt = shareStatus ? ctx.now : null;
    if (shareStatus && evidence) next.consent.shareStatusEvidence = String(evidence).slice(0, 300);
    if (!shareStatus) next.consent.shareStatusEvidence = null;
    changes.push({ field: 'consent.shareStatus', to: shareStatus });
  }
  if (typeof feeDisclosed === 'boolean' && feeDisclosed !== next.consent.feeDisclosed) {
    next.consent.feeDisclosed = feeDisclosed;
    next.consent.feeDisclosedAt = feeDisclosed ? ctx.now : null;
    if (feeDisclosed && evidence) next.consent.feeDisclosedEvidence = String(evidence).slice(0, 300);
    if (!feeDisclosed) next.consent.feeDisclosedEvidence = null;
    changes.push({ field: 'consent.feeDisclosed', to: feeDisclosed });
  }
  if (!changes.length) return { deal, changes: [] };
  appendTimeline(next, timelineEvent({
    type: 'consent_changed',
    message: changes.map((c) => `${c.field === 'consent.shareStatus' ? 'Share status with referrer' : 'Referral fee disclosed'}: ${c.to ? 'yes' : 'no'}`).join('; '),
    meta: { changes, evidence: evidence || null },
    actor: ctx.actor || 'broker',
    at: ctx.now,
  }));
  refresh(next, ctx);
  return { deal: next, changes };
}

export function addNote(deal, { text, author = 'broker' }, ctx) {
  const clean = String(text || '').trim().slice(0, 2000);
  if (!clean) return { deal, note: null };
  const next = { ...deal, notes: [...(deal.notes || [])] };
  const note = { id: randomId('note', 8), at: ctx.now, author, text: clean };
  next.notes.push(note);
  appendTimeline(next, timelineEvent({
    type: 'note_added',
    message: clean.length > 120 ? `${clean.slice(0, 117)}...` : clean,
    meta: { noteId: note.id },
    actor: author,
    at: ctx.now,
  }));
  refresh(next, ctx);
  return { deal: next, note };
}

export const ENQUIRY_KINDS = ['where_is_my_deal', 'where_is_my_comm', 'other'];

export function logEnquiry(deal, { kind = 'where_is_my_deal', note = null, partnerId = null }, ctx) {
  const useKind = ENQUIRY_KINDS.includes(kind) ? kind : 'other';
  const next = { ...deal, enquiries: [...(deal.enquiries || [])] };
  const entry = {
    id: randomId('enq', 8),
    at: ctx.now,
    kind: useKind,
    note: note ? String(note).slice(0, 400) : null,
    partnerId: partnerId || deal.referredBy || null,
  };
  next.enquiries.push(entry);
  appendTimeline(next, timelineEvent({
    type: 'enquiry_logged',
    message: `Partner enquiry logged (${useKind.replace(/_/g, ' ')})${entry.note ? `: ${entry.note}` : ''}`,
    meta: { enquiryId: entry.id, kind: useKind },
    actor: ctx.actor || 'broker',
    at: ctx.now,
  }));
  refresh(next, ctx);
  return { deal: next, enquiry: entry };
}

export function recordUpdateSent(deal, { message }, ctx) {
  const next = { ...deal };
  next.lastUpdateAt = ctx.now;
  next.updateCount = (Number(next.updateCount) || 0) + 1;
  appendTimeline(next, timelineEvent({
    type: 'update_sent',
    message: `Partner update sent (${(message.channels || []).join(' + ') || 'sms'}) to ${message.partnerName || 'the referring partner'}.`,
    meta: {
      messageId: message.id,
      channels: message.channels,
      provider: message.provider,
      smsBody: message.smsBody,
      deliveries: message.deliveries,
    },
    actor: ctx.actor || 'broker',
    at: ctx.now,
  }));
  refresh(next, ctx);
  return next;
}

/** The one gate before anything reaches a partner. */
export function consentGate(deal, partner) {
  if (!deal) return { ok: false, reason: 'no_deal', message: 'Deal not found.' };
  if (!isReferred(deal)) {
    return { ok: false, reason: 'no_referrer', message: 'This deal has no referring partner, so there is nobody to update.' };
  }
  if (!partner) {
    return { ok: false, reason: 'partner_missing', message: 'The referring partner is not in the register.' };
  }
  if (deal.consent?.shareStatus !== true) {
    return {
      ok: false,
      reason: 'no_consent',
      message: `${clientLabel(deal)} has not agreed to share deal status with ${partner.name}. Tick the consent box on the record first.`,
    };
  }
  return { ok: true };
}
