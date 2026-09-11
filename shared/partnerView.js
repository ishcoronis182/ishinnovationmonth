// Partner-facing whitelists. A portal response is built field by field here;
// no deal, partner or statement object is ever spread into it.

import { STAGES, STAGE_SHORT, stageIndex, isOffRamp, stageLabel } from './stages.js';
import { clientInitials, nextMilestone, PURPOSE_LABELS } from './record.js';
import { dealStatusPhrase } from './templates.js';
import { formatShort, formatLong, monthLabel, monthKey, monthRange, previousMonthKey } from './dates.js';
import { formatMoney } from './money.js';

/** Keys that must never appear in a portal response, at any depth. */
export const FORBIDDEN_PORTAL_KEYS = [
  'loanAmount', 'lender', 'phone', 'email', 'notes', 'note',
  'client', 'consent', 'confidence', 'timeline', 'enquiries',
  'referralComms', 'token', 'portalToken', 'passcode', 'summary',
  'basis', 'ruleId', 'ruleName', 'anomalies', 'aiProvider',
];

/** Walk any structure and report forbidden keys. Used as a runtime tripwire. */
export function findForbiddenKeys(value, forbidden = FORBIDDEN_PORTAL_KEYS, path = '$') {
  const hits = [];
  const walk = (node, here) => {
    if (node == null) return;
    if (Array.isArray(node)) {
      node.forEach((item, i) => walk(item, `${here}[${i}]`));
      return;
    }
    if (typeof node !== 'object') return;
    for (const [key, val] of Object.entries(node)) {
      if (forbidden.includes(key)) hits.push(`${here}.${key}`);
      walk(val, `${here}.${key}`);
    }
  };
  walk(value, path);
  return hits;
}

function pipelineFor(stage) {
  const at = stageIndex(stage);
  const offRamp = isOffRamp(stage);
  return STAGES.map((key, i) => ({
    key,
    label: STAGE_SHORT[key],
    done: !offRamp && at >= 0 && i < at,
    current: !offRamp && i === at,
  }));
}

/** One of the partner's deals: status only. */
export function portalDealView(deal, { today = null, lastUpdate = null } = {}) {
  const milestone = nextMilestone(deal, today);
  return {
    id: deal.id,
    ref: deal.ref || deal.id,
    initials: clientInitials(deal),
    address: deal.propertyAddress || null,
    purposeLabel: deal.purpose ? PURPOSE_LABELS[deal.purpose] : null,
    stage: deal.stage,
    stageLabel: stageLabel(deal.stage),
    statusPhrase: dealStatusPhrase(deal),
    offRamp: isOffRamp(deal.stage),
    pipeline: pipelineFor(deal.stage),
    lastUpdate: lastUpdate
      ? {
        at: lastUpdate.sentAt || lastUpdate.createdAt || null,
        text: lastUpdate.smsBody || null,
        channel: lastUpdate.channel || null,
      }
      : null,
    nextMilestone: milestone
      ? { label: milestone.label, date: milestone.date, dateLabel: formatShort(milestone.date), daysAway: milestone.daysAway }
      : null,
  };
}

/** One of the partner's statements: due or paid, no loan figures. */
export function portalStatementView(statement) {
  return {
    id: statement.id,
    period: statement.period,
    periodLabel: statement.periodLabel || monthLabel(statement.period),
    status: statement.status,
    amount: statement.total ?? null,
    amountLabel: formatMoney(statement.total),
    issuedAt: statement.issuedAt || null,
    paidAt: statement.paidAt || null,
    lineCount: (statement.lines || []).length,
    lines: (statement.lines || []).map((line) => ({
      dealRef: line.dealRef,
      initials: line.clientLabel ? initialsFromLabel(line.clientLabel) : null,
      address: line.address || null,
      settledAt: line.settledAt || null,
      settledLabel: line.settledAt ? formatLong(line.settledAt) : null,
      amount: line.amount,
      amountLabel: formatMoney(line.amount),
    })),
  };
}

function initialsFromLabel(label) {
  return String(label)
    .split(' ')
    .filter(Boolean)
    .map((part) => (part === '&' ? '&' : `${part[0].toUpperCase()}.`))
    .join(' ');
}

/** The whole portal payload for one token. */
export function portalPayload({
  partner,
  deals = [],
  statements = [],
  messagesByDeal = new Map(),
  firm = null,
  broker = null,
  today = null,
  survey = null,
  publicUrl = null,
}) {
  const dealViews = deals.map((deal) => portalDealView(deal, {
    today,
    lastUpdate: messagesByDeal.get(deal.id) || null,
  }));
  const statementViews = statements.map(portalStatementView);
  const due = statementViews
    .filter((s) => s.status === 'issued')
    .reduce((acc, s) => acc + (Number(s.amount) || 0), 0);
  const paid = statementViews
    .filter((s) => s.status === 'paid')
    .reduce((acc, s) => acc + (Number(s.amount) || 0), 0);

  return {
    partner: {
      id: partner.id,
      name: partner.name,
      firstName: String(partner.name || '').split(' ')[0],
      agency: partner.agency || null,
      office: partner.office || null,
    },
    firm: firm ? { name: firm.name, broker: broker || firm.broker || null } : null,
    deals: dealViews,
    statements: statementViews,
    totals: {
      dealsReferred: dealViews.length,
      inFlight: dealViews.filter((d) => !d.offRamp && d.stage !== 'settled').length,
      settled: dealViews.filter((d) => d.stage === 'settled').length,
      dueLabel: formatMoney(due),
      paidLabel: formatMoney(paid),
      due,
      paid,
    },
    survey: survey
      ? { submitted: true, at: survey.at, week: survey.week }
      : { submitted: false, at: null, week: null },
    referralFormUrl: publicUrl ? `${publicUrl.replace(/\/$/, '')}/#/portal` : null,
  };
}

/**
 * Per-partner Friday card: what the agent will hear vs the full register.
 * "Settled this month" counts the current unpaid commission window, which runs
 * from the first of last month. On the 2nd of a month a calendar count would
 * always read zero, which is no use to an agent.
 */
export function fridayCard({
  partner,
  deals = [],
  today = null,
  openHomes = [],
  nudge = null,
}) {
  const consented = deals.filter((d) => d.consent?.shareStatus === true);
  const windowStart = monthRange(previousMonthKey(monthKey(today || '')))?.start || null;
  const settledThisMonth = (list) => list.filter((d) => d.stage === 'settled'
    && d.keyDates?.settledAt
    && (!windowStart || d.keyDates.settledAt >= windowStart)).length;
  return {
    partnerId: partner.id,
    partnerName: partner.name,
    firstName: String(partner.name || '').split(' ')[0],
    office: partner.office || null,
    settledWindowStart: windowStart,
    opens: openHomes.map((o) => ({ address: o.address, date: o.date, time: o.time || null })),
    opensCount: openHomes.length,
    agentHears: {
      settledThisMonth: settledThisMonth(consented),
      inFlight: consented.filter((d) => !isOffRamp(d.stage) && d.stage !== 'settled').length,
      total: consented.length,
    },
    registerCount: {
      settledThisMonth: settledThisMonth(deals),
      inFlight: deals.filter((d) => !isOffRamp(d.stage) && d.stage !== 'settled').length,
      total: deals.length,
    },
    consentGap: deals.length - consented.length,
    nudge,
  };
}
