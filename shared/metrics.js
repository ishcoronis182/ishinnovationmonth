// Live metrics, computed from the register. Pure.

import { weekStart, addDays, daysBetween, formatShort, monthKey, todayISO } from './dates.js';
import { isLive, isOffRamp } from './stages.js';
import { isReferred } from './record.js';
import { roundCents } from './money.js';

export const DEFAULT_BASELINES = {
  handoverFirstTimePct: 40,
  updatesPerDeal: 0.5,
  statementHours: 6,
  enquiriesPerWeek: 8,
  referralsPerWeek: 1,
  referralsPerWeekTarget: 3,
  partnerVerdict: 2.5,
};

export const PULSE_QUESTIONS = [
  'I know where my referred deals are',
  "I know what I'm owed and when",
  "I'd refer my next buyer here",
];

export const VALUE_MODEL_DEFAULTS = {
  extraSettlementsPerMonth: 1,
  loanAmount: 600000,
  upfrontRate: 0.0065,
};

export function valueModel(input = {}) {
  const extra = Number(input.extraSettlementsPerMonth ?? VALUE_MODEL_DEFAULTS.extraSettlementsPerMonth);
  const loan = Number(input.loanAmount ?? VALUE_MODEL_DEFAULTS.loanAmount);
  const rate = Number(input.upfrontRate ?? VALUE_MODEL_DEFAULTS.upfrontRate);
  const perSettlement = roundCents(loan * rate);
  const perMonth = roundCents(perSettlement * extra);
  const perYear = roundCents(perMonth * 12);
  return {
    extraSettlementsPerMonth: extra,
    loanAmount: loan,
    upfrontRate: rate,
    perSettlement,
    perMonth,
    perYear,
    assumption: `+${extra} settlement a month at a $${loan.toLocaleString('en-AU')} loan and ${(rate * 100).toFixed(2)}% upfront`,
  };
}

function mean(list) {
  const nums = (list || []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function pct(part, whole) {
  if (!whole) return null;
  return Math.round((part / whole) * 1000) / 10;
}

function statusFor(current, target, direction) {
  if (current == null || target == null) return 'unknown';
  if (direction === 'down') {
    if (current <= target) return 'on_track';
    if (current <= target * 1.5) return 'watch';
    return 'off_track';
  }
  if (current >= target) return 'on_track';
  if (current >= target * 0.6) return 'watch';
  return 'off_track';
}

/** % of the last N handovers that arrived green. */
export function handoverFirstTime(deals, limit = 10) {
  const withArrival = (deals || [])
    .filter((d) => d.arrivalRag)
    .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')))
    .slice(0, limit);
  const green = withArrival.filter((d) => d.arrivalRag === 'green').length;
  return {
    sampleSize: withArrival.length,
    green,
    pct: pct(green, withArrival.length),
    sample: withArrival.map((d) => ({ id: d.id, ref: d.ref, rag: d.arrivalRag, createdAt: d.createdAt })),
  };
}

/** Sent partner updates per referred deal. */
export function updatesPerReferredDeal(deals, messages) {
  const referred = (deals || []).filter(isReferred);
  const sent = (messages || []).filter((m) => m.status === 'sent' && m.kind === 'update');
  const byDeal = new Map();
  for (const m of sent) {
    if (!m.dealId) continue;
    byDeal.set(m.dealId, (byDeal.get(m.dealId) || 0) + 1);
  }
  const counts = referred.map((d) => byDeal.get(d.id) || 0);
  return {
    referredDeals: referred.length,
    sentUpdates: sent.length,
    perDeal: referred.length ? Math.round((sent.filter((m) => byDeal.has(m.dealId)).length / referred.length) * 10) / 10 : null,
    average: counts.length ? Math.round(mean(counts) * 10) / 10 : null,
  };
}

/** Mean hours from statement generated to issued. */
export function statementProductionHours(statements) {
  const measured = (statements || [])
    .map((s) => s.productionSeconds)
    // Number(null) is 0, so drop absent values before converting: a statement
    // that was never issued must not read as "produced in no time".
    .filter((v) => v != null && v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0)
    .map(Number);
  if (!measured.length) return { count: 0, hours: null, seconds: null };
  const avgSeconds = mean(measured);
  return {
    count: measured.length,
    seconds: Math.round(avgSeconds),
    hours: Math.round((avgSeconds / 3600) * 1000) / 1000,
  };
}

export function enquiriesPerWeek(deals, enquiries, today, weeks = 4) {
  const byId = new Map();
  let anonymous = 0;
  const add = (entry) => {
    if (entry?.id) byId.set(entry.id, entry);
    else byId.set(`anon_${anonymous += 1}`, entry);
  };
  for (const e of enquiries || []) add(e);
  for (const deal of deals || []) {
    for (const e of deal.enquiries || []) add({ ...e, dealId: deal.id });
  }
  const all = [...byId.values()];
  const start = addDays(today, -7 * weeks);
  const recent = all.filter((e) => (e.at || '').slice(0, 10) >= start);
  return {
    total: all.length,
    recent: recent.length,
    perWeek: Math.round((recent.length / weeks) * 10) / 10,
    weeks,
  };
}

/** Referrals per week for the last 12 weeks, from the pilot office. */
export function referralsByWeek({ deals, partners, today, weeks = 12, pilotOffice = null }) {
  const partnerById = new Map((partners || []).map((p) => [p.id, p]));
  const thisWeek = weekStart(today);
  const buckets = [];
  for (let i = weeks - 1; i >= 0; i -= 1) {
    const start = addDays(thisWeek, -7 * i);
    buckets.push({ weekStart: start, label: formatShort(start), count: 0 });
  }
  const index = new Map(buckets.map((b, i) => [b.weekStart, i]));
  for (const deal of deals || []) {
    if (!isReferred(deal) || !deal.referredAt) continue;
    if (pilotOffice) {
      const partner = partnerById.get(deal.referredBy);
      if (partner && partner.office && partner.office !== pilotOffice) continue;
    }
    const ws = weekStart(deal.referredAt);
    if (index.has(ws)) buckets[index.get(ws)].count += 1;
  }
  const counts = buckets.map((b) => b.count);
  const half = Math.floor(weeks / 2);
  const firstHalf = mean(counts.slice(0, half)) || 0;
  const secondHalf = mean(counts.slice(half)) || 0;
  const direction = secondHalf > firstHalf ? 'up' : (secondHalf < firstHalf ? 'down' : 'flat');
  return {
    buckets,
    perWeek: Math.round((mean(counts.slice(-4)) || 0) * 10) / 10,
    trend: {
      direction,
      firstHalf: Math.round(firstHalf * 10) / 10,
      secondHalf: Math.round(secondHalf * 10) / 10,
    },
  };
}

export function partnerVerdict(surveys) {
  const byWeek = new Map();
  for (const s of surveys || []) {
    const week = Number(s.week) || 1;
    if (!byWeek.has(week)) byWeek.set(week, []);
    byWeek.get(week).push(s);
  }
  const summarise = (week) => {
    const list = byWeek.get(week) || [];
    if (!list.length) return { week, responses: 0, mean: null, byQuestion: [null, null, null] };
    const byQuestion = [0, 1, 2].map((i) => {
      const vals = list.map((s) => Number(s.answers?.[i]) || Number(s.answers?.[`q${i + 1}`])).filter((n) => Number.isFinite(n));
      const m = mean(vals);
      return m == null ? null : Math.round(m * 10) / 10;
    });
    const all = list.flatMap((s) => (Array.isArray(s.answers) ? s.answers : Object.values(s.answers || {})));
    const m = mean(all);
    return {
      week,
      responses: list.length,
      mean: m == null ? null : Math.round(m * 10) / 10,
      byQuestion,
    };
  };
  return {
    questions: PULSE_QUESTIONS,
    week1: summarise(1),
    week3: summarise(3),
    weeks: [...byWeek.keys()].sort((a, b) => a - b),
  };
}

/**
 * The metrics table plus the extras the page shows.
 */
export function computeMetrics({
  deals = [],
  partners = [],
  messages = [],
  statements = [],
  enquiries = [],
  surveys = [],
  baselines = {},
  today = null,
  pilotOffice = null,
  valueModelInput = {},
} = {}) {
  const base = { ...DEFAULT_BASELINES, ...(baselines || {}) };
  const day = today || todayISO();

  const handover = handoverFirstTime(deals, 10);
  const updates = updatesPerReferredDeal(deals, messages);
  const production = statementProductionHours(statements);
  const enq = enquiriesPerWeek(deals, enquiries, day, 4);
  const referrals = referralsByWeek({ deals, partners, today: day, weeks: 12, pilotOffice });
  const verdict = partnerVerdict(surveys);
  const value = valueModel(valueModelInput);

  const statementTarget = Math.round(Number(base.statementHours) * 0.25 * 100) / 100;
  const enquiryTarget = Math.round(Number(base.enquiriesPerWeek) * 0.5 * 10) / 10;

  const rows = [
    {
      key: 'handover_first_time',
      metric: 'Handovers complete first time',
      howMeasured: 'Share of the last 10 handovers that arrived green',
      baselineKey: 'handoverFirstTimePct',
      baseline: Number(base.handoverFirstTimePct),
      current: handover.pct,
      target: 80,
      unit: '%',
      direction: 'up',
      detail: `${handover.green} of ${handover.sampleSize} green on arrival`,
    },
    {
      key: 'updates_per_deal',
      metric: 'Updates per referred deal',
      howMeasured: 'Partner updates sent, divided by referred deals',
      baselineKey: 'updatesPerDeal',
      baseline: Number(base.updatesPerDeal),
      current: updates.average,
      target: 4,
      unit: 'updates',
      direction: 'up',
      detail: `${updates.sentUpdates} sent across ${updates.referredDeals} referred deals`,
    },
    {
      key: 'statement_time',
      metric: 'Statement production time',
      howMeasured: 'Hours from generating a statement to issuing it',
      baselineKey: 'statementHours',
      baseline: Number(base.statementHours),
      current: production.hours,
      target: statementTarget,
      unit: 'hours',
      direction: 'down',
      detail: production.count
        ? `${production.count} issued, mean ${production.seconds}s`
        : 'No statements issued yet',
    },
    {
      key: 'enquiries_per_week',
      metric: '"Where is my deal / my comm?" enquiries',
      howMeasured: 'Logged partner enquiries per week, last 4 weeks',
      baselineKey: 'enquiriesPerWeek',
      baseline: Number(base.enquiriesPerWeek),
      current: enq.perWeek,
      target: enquiryTarget,
      unit: 'per week',
      direction: 'down',
      detail: `${enq.recent} logged in the last ${enq.weeks} weeks`,
    },
    {
      key: 'referrals_per_week',
      metric: 'Referrals per week (pilot office)',
      howMeasured: 'Partner referrals per week, 12-week trend',
      baselineKey: 'referralsPerWeek',
      baseline: Number(base.referralsPerWeek),
      current: referrals.perWeek,
      target: Number(base.referralsPerWeekTarget),
      unit: 'per week',
      direction: 'up',
      detail: `Trend ${referrals.trend.direction} (${referrals.trend.firstHalf} to ${referrals.trend.secondHalf})`,
    },
    {
      key: 'partner_verdict',
      metric: 'Partner verdict',
      howMeasured: 'Mean of the 3-question pulse survey, week 1 vs week 3',
      baselineKey: 'partnerVerdict',
      baseline: verdict.week1.mean ?? Number(base.partnerVerdict),
      current: verdict.week3.mean ?? verdict.week1.mean,
      target: 4,
      unit: '/ 5',
      direction: 'up',
      detail: `Week 1: ${verdict.week1.mean ?? '-'} (${verdict.week1.responses}), week 3: ${verdict.week3.mean ?? '-'} (${verdict.week3.responses})`,
    },
  ].map((row) => ({ ...row, status: statusFor(row.current, row.target, row.direction) }));

  return {
    today: day,
    rows,
    handover,
    updates,
    production,
    enquiries: enq,
    referrals,
    verdict,
    valueModel: value,
    pulse: livePulse({ deals, statements, messages, today: day }),
  };
}

/** The four counters in the sidebar. */
export function livePulse({ deals = [], statements = [], messages = [], today = null }) {
  const day = today || todayISO();
  const weekAgo = addDays(day, -7);
  const inFlight = deals.filter((d) => isLive(d.stage)).length;
  const redRecords = deals.filter((d) => d.rag === 'red' && !isOffRamp(d.stage)).length;
  const commsDue = roundCents(deals
    .filter((d) => d.stage === 'settled' && d.referredBy && d.referredBy !== 'direct'
      && ['due', 'pending', 'on_statement'].includes(d.referralComms?.status))
    .reduce((acc, d) => acc + (Number(d.referralComms?.amount) || 0), 0));
  const updatesThisWeek = messages.filter((m) => m.status === 'sent'
    && m.kind === 'update'
    && (m.sentAt || m.createdAt || '').slice(0, 10) >= weekAgo).length;
  return { inFlight, redRecords, commsDue, updatesThisWeek };
}

export { monthKey, daysBetween };
