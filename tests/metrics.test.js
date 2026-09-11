import { describe, it, expect } from 'vitest';
import {
  computeMetrics, handoverFirstTime, updatesPerReferredDeal, statementProductionHours,
  enquiriesPerWeek, referralsByWeek, partnerVerdict, valueModel, livePulse, DEFAULT_BASELINES,
} from '../shared/metrics.js';
import { buildSeed } from '../server/seed.js';
import { loadConfig } from '../server/config.js';
import { addDays } from '../shared/dates.js';

const TODAY = '2026-09-11';
const config = loadConfig({ PULSE_TZ: 'Australia/Brisbane' });
const data = buildSeed({ config, today: TODAY });

describe('metrics computed from the register', () => {
  const metrics = computeMetrics({
    deals: data.deals,
    partners: data.partners,
    messages: data.messages,
    statements: data.statements,
    enquiries: data.enquiries,
    surveys: data.surveys,
    baselines: data.settings.baselines,
    today: TODAY,
    pilotOffice: config.firm.office,
    valueModelInput: data.settings.valueModel,
  });

  it('produces the six metric rows with a baseline, a current and a target', () => {
    expect(metrics.rows).toHaveLength(6);
    for (const row of metrics.rows) {
      expect(row.metric).toBeTruthy();
      expect(row.howMeasured).toBeTruthy();
      expect(row.baseline).toBeTypeOf('number');
      expect(row.target).toBeTypeOf('number');
      expect(['on_track', 'watch', 'off_track', 'unknown']).toContain(row.status);
    }
    expect(metrics.rows.map((r) => r.key)).toEqual([
      'handover_first_time', 'updates_per_deal', 'statement_time',
      'enquiries_per_week', 'referrals_per_week', 'partner_verdict',
    ]);
  });

  it('measures handovers complete first time from the arrival RAG of the last ten', () => {
    const result = handoverFirstTime(data.deals, 10);
    expect(result.sampleSize).toBe(10);
    expect(result.pct).toBe((result.green / 10) * 100);
    expect(metrics.rows[0].current).toBe(result.pct);
    expect(metrics.rows[0].target).toBe(80);
  });

  it('counts only green arrivals, not the current RAG', () => {
    const deals = [
      { arrivalRag: 'green', rag: 'red', createdAt: '2026-09-01T00:00:00Z' },
      { arrivalRag: 'red', rag: 'green', createdAt: '2026-09-02T00:00:00Z' },
    ];
    expect(handoverFirstTime(deals, 10).pct).toBe(50);
  });

  it('measures updates per referred deal', () => {
    const result = updatesPerReferredDeal(data.deals, data.messages);
    expect(result.referredDeals).toBeGreaterThan(0);
    expect(result.sentUpdates).toBe(data.messages.filter((m) => m.kind === 'update' && m.status === 'sent').length);
    expect(metrics.rows[1].target).toBe(4);
  });

  it('measures statement production time and targets minus 75 per cent', () => {
    const result = statementProductionHours(data.statements);
    expect(result.count).toBe(2);
    expect(result.hours).toBeGreaterThan(0);
    expect(metrics.rows[2].target).toBeCloseTo(DEFAULT_BASELINES.statementHours * 0.25, 5);
    expect(metrics.rows[2].direction).toBe('down');
  });

  it('reports nothing rather than zero when no statement has been issued', () => {
    expect(statementProductionHours([]).hours).toBeNull();
    expect(statementProductionHours([{ productionSeconds: null }]).count).toBe(0);
  });

  it('counts enquiries per week without double counting the deal copy', () => {
    const result = enquiriesPerWeek(data.deals, data.enquiries, TODAY, 4);
    const ids = new Set(data.enquiries.map((e) => e.id));
    expect(result.total).toBe(ids.size);
    expect(metrics.rows[3].target).toBe(DEFAULT_BASELINES.enquiriesPerWeek * 0.5);
    expect(metrics.rows[3].direction).toBe('down');
  });

  it('buckets referrals into twelve weeks with a trend', () => {
    const result = referralsByWeek({ deals: data.deals, partners: data.partners, today: TODAY, weeks: 12 });
    expect(result.buckets).toHaveLength(12);
    expect(result.buckets.at(-1).weekStart <= TODAY).toBe(true);
    expect(['up', 'down', 'flat']).toContain(result.trend.direction);
  });

  it('only counts the pilot office when one is named', () => {
    const all = referralsByWeek({ deals: data.deals, partners: data.partners, today: TODAY });
    const pilot = referralsByWeek({ deals: data.deals, partners: data.partners, today: TODAY, pilotOffice: 'Coronis Lutwyche' });
    const total = (r) => r.buckets.reduce((a, b) => a + b.count, 0);
    expect(total(pilot)).toBeLessThanOrEqual(total(all));
  });

  it('compares the partner verdict week 1 against week 3', () => {
    const verdict = partnerVerdict(data.surveys);
    expect(verdict.week1.responses).toBe(2);
    expect(verdict.week1.mean).toBeGreaterThan(0);
    expect(verdict.week3.responses).toBe(0);
    expect(verdict.week3.mean).toBeNull();
    expect(verdict.questions).toHaveLength(3);
  });

  it('models the value of one extra settlement a month', () => {
    const model = valueModel({});
    expect(model.perSettlement).toBe(3900);
    expect(model.perYear).toBe(46800);
    expect(model.assumption).toContain('0.65% upfront');
    expect(valueModel({ loanAmount: 500000, upfrontRate: 0.006, extraSettlementsPerMonth: 2 }).perYear).toBe(72000);
  });

  it('computes the sidebar pulse', () => {
    const pulse = livePulse({ deals: data.deals, statements: data.statements, messages: data.messages, today: TODAY });
    expect(pulse.inFlight).toBeGreaterThan(0);
    expect(pulse.redRecords).toBeGreaterThanOrEqual(0);
    expect(pulse.commsDue).toBe(1000);
    expect(pulse.updatesThisWeek).toBeGreaterThanOrEqual(1);
  });

  it('survives an empty register', () => {
    const empty = computeMetrics({ today: TODAY });
    expect(empty.rows).toHaveLength(6);
    expect(empty.rows[0].current).toBeNull();
    expect(empty.pulse.inFlight).toBe(0);
  });

  it('rates a metric on track only when it beats its target', () => {
    const rows = computeMetrics({
      deals: [
        { arrivalRag: 'green', createdAt: '2026-09-01T00:00:00Z', referredBy: 'p1', referredAt: addDays(TODAY, -3), stage: 'lodged', keyDates: {} },
      ],
      today: TODAY,
    }).rows;
    expect(rows[0].current).toBe(100);
    expect(rows[0].status).toBe('on_track');
  });
});
