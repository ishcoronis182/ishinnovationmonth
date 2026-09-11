// Referral commission rules and statements. Pure: no I/O, no clock.
// Every dollar traces to a deal id and a rule id.

import { roundCents, sumAmounts, formatMoney } from './money.js';
import { monthKey, monthLabel, monthRange, daysBetween, isValidISODate } from './dates.js';
import { isLive, isOffRamp } from './stages.js';
import { clientLabel, isReferred } from './record.js';

export const RULE_TYPES = ['flat', 'bps', 'share_upfront', 'tiered'];

export const RULE_TYPE_LABELS = {
  flat: 'Flat per settled loan',
  bps: 'Basis points of loan',
  share_upfront: 'Share of upfront commission',
  tiered: 'Tiered by loan size',
};

export const STATEMENT_STATUSES = ['draft', 'issued', 'paid', 'void'];

export const ANOMALY_LABELS = {
  no_rule: 'No commission rule applies',
  missing_loan_amount: 'Percentage rule with no loan amount',
  zero_line: 'Line calculates to zero',
  fee_disclosure_missing: 'Referral fee disclosure not recorded',
  duplicate_client: 'Possible duplicate client',
  settled_unpaid_30: 'Settled and unpaid for over 30 days',
  settled_no_referrer: 'Settled with no referrer recorded',
  consent_missing: 'Client consent to share status not recorded',
};

export function normaliseRule(input) {
  const src = input && typeof input === 'object' ? input : {};
  const type = RULE_TYPES.includes(src.type) ? src.type : 'flat';
  const tiers = Array.isArray(src.tiers)
    ? src.tiers
      .map((t) => ({
        minLoan: Number.isFinite(Number(t?.minLoan)) ? Number(t.minLoan) : 0,
        type: t?.type === 'bps' ? 'bps' : 'flat',
        amount: Number.isFinite(Number(t?.amount)) ? Number(t.amount) : null,
        bps: Number.isFinite(Number(t?.bps)) ? Number(t.bps) : null,
      }))
      .sort((a, b) => a.minLoan - b.minLoan)
    : [];
  return {
    id: src.id ? String(src.id) : null,
    name: src.name ? String(src.name).slice(0, 120) : RULE_TYPE_LABELS[type],
    scope: src.scope === 'partner' ? 'partner' : 'global',
    partnerId: src.partnerId ? String(src.partnerId) : null,
    type,
    flatAmount: Number.isFinite(Number(src.flatAmount)) ? Number(src.flatAmount) : null,
    bps: Number.isFinite(Number(src.bps)) ? Number(src.bps) : null,
    sharePct: Number.isFinite(Number(src.sharePct)) ? Number(src.sharePct) : null,
    upfrontBps: Number.isFinite(Number(src.upfrontBps)) ? Number(src.upfrontBps) : 65,
    tiers,
    effectiveFrom: isValidISODate(src.effectiveFrom) ? src.effectiveFrom : '1970-01-01',
    active: src.active !== false,
    note: src.note ? String(src.note).slice(0, 300) : null,
    createdAt: src.createdAt || null,
  };
}

/**
 * Partner-specific overrides beat the global rule; among the rules already in
 * effect, the latest effective date wins.
 */
export function resolveRule(rules, { partnerId, onDate } = {}) {
  const list = (rules || []).map(normaliseRule).filter((r) => r.active);
  const eligible = list.filter((r) => (!onDate || r.effectiveFrom <= onDate));
  const partnerRules = partnerId
    ? eligible.filter((r) => r.scope === 'partner' && r.partnerId === partnerId)
    : [];
  const pool = partnerRules.length ? partnerRules : eligible.filter((r) => r.scope === 'global');
  if (!pool.length) return null;
  const sorted = [...pool].sort((a, b) => {
    if (a.effectiveFrom !== b.effectiveFrom) return a.effectiveFrom < b.effectiveFrom ? 1 : -1;
    const aCreated = a.createdAt || '';
    const bCreated = b.createdAt || '';
    if (aCreated !== bCreated) return aCreated < bCreated ? 1 : -1;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
  return sorted[0];
}

export function describeRule(rule) {
  if (!rule) return 'No rule';
  const r = normaliseRule(rule);
  switch (r.type) {
    case 'flat':
      return `${formatMoney(r.flatAmount)} per settled referred loan`;
    case 'bps':
      return `${(Number(r.bps || 0) / 100).toFixed(2)}% of the loan amount`;
    case 'share_upfront':
      return `${Number(r.sharePct || 0)}% of upfront commission (upfront assumed ${(Number(r.upfrontBps || 0) / 100).toFixed(2)}%)`;
    case 'tiered': {
      const parts = r.tiers.map((t) => (t.type === 'bps'
        ? `${formatMoney(t.minLoan)}+: ${(Number(t.bps || 0) / 100).toFixed(2)}%`
        : `${formatMoney(t.minLoan)}+: ${formatMoney(t.amount)}`));
      return `Tiered (${parts.join(', ')})`;
    }
    default:
      return 'Unknown rule';
  }
}

/**
 * What one settled deal earns the referring partner.
 * @returns {{amount: number|null, ruleId: string|null, ruleName: string|null, basis: string, anomalies: object[]}}
 */
export function computeCommission(deal, rule) {
  const anomalies = [];
  if (!rule) {
    return {
      amount: null,
      ruleId: null,
      ruleName: null,
      basis: 'No rule applies',
      anomalies: [{ type: 'no_rule', label: ANOMALY_LABELS.no_rule, dealId: deal?.id || null }],
    };
  }
  const r = normaliseRule(rule);
  // Number(null) is 0, so check for absence before converting: a missing loan
  // amount must raise an anomaly, never quietly compute a zero commission.
  const rawLoan = deal?.loanAmount;
  const loan = rawLoan == null || rawLoan === '' || !Number.isFinite(Number(rawLoan))
    ? null
    : Number(rawLoan);
  const needsLoan = r.type !== 'flat';
  if (needsLoan && loan == null) {
    return {
      amount: null,
      ruleId: r.id,
      ruleName: r.name,
      basis: describeRule(r),
      anomalies: [{ type: 'missing_loan_amount', label: ANOMALY_LABELS.missing_loan_amount, dealId: deal?.id || null }],
    };
  }

  let amount = null;
  let basis = describeRule(r);
  if (r.type === 'flat') {
    amount = roundCents(Number(r.flatAmount || 0));
    basis = `Flat ${formatMoney(r.flatAmount)} per settled referred loan`;
  } else if (r.type === 'bps') {
    amount = roundCents(loan * (Number(r.bps || 0) / 10000));
    basis = `${(Number(r.bps || 0) / 100).toFixed(2)}% of the loan`;
  } else if (r.type === 'share_upfront') {
    const upfront = loan * (Number(r.upfrontBps || 0) / 10000);
    amount = roundCents(upfront * (Number(r.sharePct || 0) / 100));
    basis = `${Number(r.sharePct || 0)}% of upfront commission`;
  } else if (r.type === 'tiered') {
    const tier = [...r.tiers].reverse().find((t) => loan >= t.minLoan) || null;
    if (!tier) {
      return {
        amount: null,
        ruleId: r.id,
        ruleName: r.name,
        basis,
        anomalies: [{ type: 'no_rule', label: 'Loan falls outside every tier', dealId: deal?.id || null }],
      };
    }
    amount = tier.type === 'bps'
      ? roundCents(loan * (Number(tier.bps || 0) / 10000))
      : roundCents(Number(tier.amount || 0));
    basis = tier.type === 'bps'
      ? `Tier ${formatMoney(tier.minLoan)}+ at ${(Number(tier.bps || 0) / 100).toFixed(2)}%`
      : `Tier ${formatMoney(tier.minLoan)}+ at ${formatMoney(tier.amount)}`;
  }

  if (amount === 0) {
    anomalies.push({ type: 'zero_line', label: ANOMALY_LABELS.zero_line, dealId: deal?.id || null });
  }
  return { amount, ruleId: r.id, ruleName: r.name, basis, anomalies };
}

function partnerDeals(deals, partnerId) {
  return (deals || []).filter((d) => d.referredBy === partnerId);
}

function unpaidCommsStatus(status) {
  return status === 'due' || status === 'pending' || status === 'on_statement';
}

/** The five numbers on a partner statement. */
export function statementNumbers({ partnerId, deals, period, today, rules }) {
  const mine = partnerDeals(deals, partnerId);
  const range = monthRange(period);
  const year = period ? period.slice(0, 4) : (today || '').slice(0, 4);

  const dealsReferred = mine.filter((d) => d.referredAt && range && d.referredAt >= range.start && d.referredAt <= range.end).length;
  const settledDeals = mine.filter((d) => d.stage === 'settled' && d.keyDates?.settledAt
    && range && d.keyDates.settledAt >= range.start && d.keyDates.settledAt <= range.end);
  const inFlight = mine.filter((d) => isLive(d.stage)).length;

  const outstanding = mine.filter((d) => d.stage === 'settled' && unpaidCommsStatus(d.referralComms?.status));
  const commsDue = sumAmounts(outstanding.map((d) => amountFor(d, rules)));

  const paidYtd = sumAmounts(mine
    .filter((d) => d.referralComms?.status === 'paid' && (d.referralComms?.paidAt || '').startsWith(year))
    .map((d) => d.referralComms?.amount));

  return {
    dealsReferred,
    settledThisMonth: settledDeals.length,
    commsDue,
    inFlight,
    paidYtd,
  };
}

function amountFor(deal, rules) {
  if (deal?.referralComms?.amount != null) return deal.referralComms.amount;
  const rule = resolveRule(rules, {
    partnerId: deal?.referredBy,
    onDate: deal?.keyDates?.settledAt || deal?.referredAt,
  });
  return computeCommission(deal, rule).amount;
}

/**
 * Build one statement for one partner for one month.
 * Lines cover deals settled in the period that are not already paid or sitting
 * on another issued statement.
 */
export function buildStatement({
  partner,
  deals,
  rules,
  period,
  today,
  statements = [],
  id = null,
  createdAt = null,
  coverNote = null,
  coverNoteProvider = null,
}) {
  const partnerId = partner?.id;
  const range = monthRange(period);
  const mine = partnerDeals(deals, partnerId);
  const issuedElsewhere = new Set();
  for (const st of statements) {
    if (!st || st.partnerId !== partnerId) continue;
    if (st.period === period) continue;
    if (st.status === 'issued' || st.status === 'paid') {
      for (const line of st.lines || []) issuedElsewhere.add(line.dealId);
    }
  }

  const settled = mine.filter((d) => d.stage === 'settled'
    && d.keyDates?.settledAt
    && range
    && d.keyDates.settledAt >= range.start
    && d.keyDates.settledAt <= range.end
    && d.referralComms?.status !== 'paid'
    && d.referralComms?.status !== 'void'
    && !issuedElsewhere.has(d.id));

  const lines = settled
    .sort((a, b) => (a.keyDates.settledAt < b.keyDates.settledAt ? -1 : 1))
    .map((deal) => buildLine(deal, rules));

  const numbers = statementNumbers({ partnerId, deals, period, today, rules });
  const anomalies = statementAnomalies({ lines, deals: mine, partner, today });
  const total = sumAmounts(lines.map((l) => l.amount));

  return {
    id,
    partnerId,
    partnerName: partner?.name || null,
    period,
    periodLabel: monthLabel(period),
    status: 'draft',
    createdAt,
    issuedAt: null,
    paidAt: null,
    voidedAt: null,
    voidReason: null,
    lines,
    total,
    numbers,
    anomalies,
    coverNote,
    coverNoteProvider,
    productionSeconds: null,
    history: [],
  };
}

export function buildLine(deal, rules) {
  const rule = resolveRule(rules, {
    partnerId: deal.referredBy,
    onDate: deal.keyDates?.settledAt || deal.referredAt,
  });
  const computed = computeCommission(deal, rule);
  return {
    id: `line_${deal.id}`,
    dealId: deal.id,
    dealRef: deal.ref || deal.id,
    clientLabel: clientLabel(deal),
    address: deal.propertyAddress || null,
    settledAt: deal.keyDates?.settledAt || null,
    ruleId: computed.ruleId,
    ruleName: computed.ruleName,
    basis: computed.basis,
    amount: computed.amount,
    anomalies: computed.anomalies,
    feeDisclosed: deal.consent?.feeDisclosed === true,
  };
}

export function statementAnomalies({ lines, deals, partner, today }) {
  const out = [];
  const seen = new Set();
  const add = (a) => {
    const key = `${a.type}:${a.dealId || ''}:${a.partnerId || ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push(a);
  };

  for (const line of lines || []) {
    for (const a of line.anomalies || []) {
      add({ ...a, partnerId: partner?.id || null, dealRef: line.dealRef });
    }
    if (!line.feeDisclosed) {
      add({
        type: 'fee_disclosure_missing',
        label: ANOMALY_LABELS.fee_disclosure_missing,
        dealId: line.dealId,
        dealRef: line.dealRef,
        partnerId: partner?.id || null,
      });
    }
  }

  const byClient = new Map();
  for (const deal of deals || []) {
    const name = (deal.client?.name || '').toLowerCase().trim();
    if (!name) continue;
    if (!byClient.has(name)) byClient.set(name, []);
    byClient.get(name).push(deal);
  }
  for (const [, group] of byClient) {
    if (group.length > 1) {
      for (const deal of group) {
        add({
          type: 'duplicate_client',
          label: `${ANOMALY_LABELS.duplicate_client} (${clientLabel(deal)})`,
          dealId: deal.id,
          dealRef: deal.ref || deal.id,
          partnerId: partner?.id || null,
        });
      }
    }
  }

  for (const deal of deals || []) {
    if (deal.stage !== 'settled') continue;
    if (!unpaidCommsStatus(deal.referralComms?.status)) continue;
    const settledAt = deal.keyDates?.settledAt;
    if (!settledAt || !today) continue;
    const age = daysBetween(settledAt, today);
    if (age != null && age > 30) {
      add({
        type: 'settled_unpaid_30',
        label: `${ANOMALY_LABELS.settled_unpaid_30} (${age} days)`,
        dealId: deal.id,
        dealRef: deal.ref || deal.id,
        partnerId: partner?.id || null,
      });
    }
  }

  return out;
}

/** Register-level anomalies, independent of any one statement. */
export function registerAnomalies({ deals, partners, rules, today }) {
  const out = [];
  for (const deal of deals || []) {
    if (deal.stage === 'settled' && !deal.referredBy) {
      out.push({
        type: 'settled_no_referrer',
        label: ANOMALY_LABELS.settled_no_referrer,
        dealId: deal.id,
        dealRef: deal.ref || deal.id,
        partnerId: null,
      });
    }
    if (deal.stage === 'settled' && isReferred(deal)) {
      const rule = resolveRule(rules, { partnerId: deal.referredBy, onDate: deal.keyDates?.settledAt });
      if (!rule) {
        out.push({
          type: 'no_rule',
          label: ANOMALY_LABELS.no_rule,
          dealId: deal.id,
          dealRef: deal.ref || deal.id,
          partnerId: deal.referredBy,
        });
      }
      if (rule && rule.type !== 'flat' && deal.loanAmount == null) {
        out.push({
          type: 'missing_loan_amount',
          label: ANOMALY_LABELS.missing_loan_amount,
          dealId: deal.id,
          dealRef: deal.ref || deal.id,
          partnerId: deal.referredBy,
        });
      }
      const settledAt = deal.keyDates?.settledAt;
      if (settledAt && today && unpaidCommsStatus(deal.referralComms?.status)) {
        const age = daysBetween(settledAt, today);
        if (age != null && age > 30) {
          out.push({
            type: 'settled_unpaid_30',
            label: `${ANOMALY_LABELS.settled_unpaid_30} (${age} days)`,
            dealId: deal.id,
            dealRef: deal.ref || deal.id,
            partnerId: deal.referredBy,
          });
        }
      }
      if (!deal.consent?.feeDisclosed) {
        out.push({
          type: 'fee_disclosure_missing',
          label: ANOMALY_LABELS.fee_disclosure_missing,
          dealId: deal.id,
          dealRef: deal.ref || deal.id,
          partnerId: deal.referredBy,
        });
      }
    }
  }
  return out;
}

/**
 * Re-check a statement's lines against the live register. Run at issue and at
 * mark-paid so a reopened deal can never be paid from a stale draft.
 */
export function recheckLines(statement, deals, rules, today) {
  const byId = new Map((deals || []).map((d) => [d.id, d]));
  const changes = [];
  const lines = [];
  const range = monthRange(statement?.period);

  for (const line of statement?.lines || []) {
    const deal = byId.get(line.dealId);
    if (!deal) {
      changes.push({ type: 'removed', dealId: line.dealId, dealRef: line.dealRef, reason: 'deal no longer exists' });
      continue;
    }
    if (deal.stage !== 'settled') {
      changes.push({ type: 'removed', dealId: line.dealId, dealRef: line.dealRef, reason: `deal is now ${deal.stage}` });
      continue;
    }
    if (deal.referredBy !== statement.partnerId) {
      changes.push({ type: 'removed', dealId: line.dealId, dealRef: line.dealRef, reason: 'referrer changed' });
      continue;
    }
    const settledAt = deal.keyDates?.settledAt;
    if (!settledAt || (range && (settledAt < range.start || settledAt > range.end))) {
      changes.push({ type: 'removed', dealId: line.dealId, dealRef: line.dealRef, reason: 'settlement date moved out of the period' });
      continue;
    }
    const rebuilt = buildLine(deal, rules);
    if (rebuilt.amount !== line.amount) {
      changes.push({
        type: 'amount_changed',
        dealId: line.dealId,
        dealRef: line.dealRef,
        from: line.amount,
        to: rebuilt.amount,
      });
    }
    lines.push(rebuilt);
  }

  const existing = new Set(lines.map((l) => l.dealId));
  for (const deal of deals || []) {
    if (deal.referredBy !== statement.partnerId) continue;
    if (deal.stage !== 'settled') continue;
    const settledAt = deal.keyDates?.settledAt;
    if (!settledAt || !range || settledAt < range.start || settledAt > range.end) continue;
    if (existing.has(deal.id)) continue;
    if (deal.referralComms?.status === 'paid' || deal.referralComms?.status === 'void') continue;
    if (deal.referralComms?.statementId && deal.referralComms.statementId !== statement.id) continue;
    const line = buildLine(deal, rules);
    lines.push(line);
    changes.push({ type: 'added', dealId: deal.id, dealRef: line.dealRef, to: line.amount });
  }

  lines.sort((a, b) => ((a.settledAt || '') < (b.settledAt || '') ? -1 : 1));
  return { lines, changes, total: sumAmounts(lines.map((l) => l.amount)) };
}

export function statementTotal(statement) {
  return sumAmounts((statement?.lines || []).map((l) => l.amount));
}

export function canIssue(statement) {
  if (!statement) return { ok: false, reason: 'not_found', message: 'Statement not found' };
  if (statement.status !== 'draft') {
    return { ok: false, reason: 'wrong_status', message: `Only a draft can be issued (this one is ${statement.status})` };
  }
  if (!statement.lines?.length) {
    return { ok: false, reason: 'empty', message: 'Nothing to issue: this statement has no lines' };
  }
  return { ok: true };
}

export function canMarkPaid(statement) {
  if (!statement) return { ok: false, reason: 'not_found', message: 'Statement not found' };
  if (statement.status !== 'issued') {
    return { ok: false, reason: 'wrong_status', message: `Only an issued statement can be marked paid (this one is ${statement.status})` };
  }
  return { ok: true };
}

export function canVoid(statement) {
  if (!statement) return { ok: false, reason: 'not_found', message: 'Statement not found' };
  if (statement.status === 'void') return { ok: false, reason: 'wrong_status', message: 'Already void' };
  return { ok: true };
}

/** Is this deal locked because it sits on an issued or paid statement? */
export function isOnIssuedStatement(dealId, statements) {
  for (const st of statements || []) {
    if (st.status !== 'issued' && st.status !== 'paid') continue;
    if ((st.lines || []).some((l) => l.dealId === dealId)) return st;
  }
  return null;
}

export function periodsWithSettlements(deals) {
  const keys = new Set();
  for (const deal of deals || []) {
    if (deal.stage === 'settled' && deal.keyDates?.settledAt && isReferred(deal)) {
      keys.add(monthKey(deal.keyDates.settledAt));
    }
  }
  return [...keys].sort().reverse();
}

export { isOffRamp };
