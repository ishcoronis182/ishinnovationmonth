import { describe, it, expect } from 'vitest';
import {
  resolveRule, computeCommission, buildStatement, statementNumbers, recheckLines,
  registerAnomalies, canIssue, canMarkPaid, canVoid, isOnIssuedStatement, describeRule,
  normaliseRule, periodsWithSettlements,
} from '../shared/commission.js';
import { normaliseDeal } from '../shared/record.js';
import { buildSeed } from '../server/seed.js';
import { loadConfig } from '../server/config.js';
import { previousMonthKey, monthKey } from '../shared/dates.js';

const TODAY = '2026-09-11';
const LAST_MONTH = previousMonthKey(monthKey(TODAY));

const FLAT = { id: 'r_flat', name: 'Demo rule', scope: 'global', type: 'flat', flatAmount: 500, effectiveFrom: '2025-01-01' };

function settledDeal(over = {}) {
  return normaliseDeal({
    id: over.id || 'd1',
    ref: over.ref || 'PP-0001',
    clientName: over.name || 'Test Client',
    broker: 'Nathan',
    referredBy: over.referredBy ?? 'p_alex',
    purpose: 'purchase',
    loanAmount: over.loanAmount === undefined ? 600000 : over.loanAmount,
    lender: 'Macquarie',
    propertyAddress: '1 Test St, Lutwyche QLD 4030',
    stage: over.stage || 'settled',
    keyDates: { settledAt: over.settledAt || `${LAST_MONTH}-14` },
    referredAt: over.referredAt || `${LAST_MONTH}-02`,
    consent: { shareStatus: true, feeDisclosed: over.feeDisclosed !== false },
    referralComms: over.referralComms || { status: 'due', amount: 500 },
  }, { today: TODAY });
}

describe('commission rules', () => {
  it('pays a flat amount per settled referral', () => {
    const result = computeCommission(settledDeal(), FLAT);
    expect(result.amount).toBe(500);
    expect(result.ruleId).toBe('r_flat');
    expect(result.basis).toContain('Flat $500');
  });

  it('pays basis points of the loan', () => {
    const result = computeCommission(settledDeal(), { id: 'r_bps', type: 'bps', bps: 15 });
    expect(result.amount).toBe(900); // 0.15% of 600,000
    expect(result.basis).toBe('0.15% of the loan');
  });

  it('pays a share of the upfront commission', () => {
    const result = computeCommission(settledDeal(), { id: 'r_share', type: 'share_upfront', sharePct: 20, upfrontBps: 65 });
    expect(result.amount).toBe(780); // 20% of 0.65% of 600,000
  });

  it('pays the matching tier', () => {
    const tiered = {
      id: 'r_tier',
      type: 'tiered',
      tiers: [
        { minLoan: 0, type: 'flat', amount: 400 },
        { minLoan: 750000, type: 'flat', amount: 750 },
        { minLoan: 1000000, type: 'bps', bps: 10 },
      ],
    };
    expect(computeCommission(settledDeal({ loanAmount: 500000 }), tiered).amount).toBe(400);
    expect(computeCommission(settledDeal({ loanAmount: 800000 }), tiered).amount).toBe(750);
    expect(computeCommission(settledDeal({ loanAmount: 1200000 }), tiered).amount).toBe(1200);
  });

  it('flags a percentage rule with no loan amount instead of guessing', () => {
    const result = computeCommission(settledDeal({ loanAmount: null }), { id: 'r_bps', type: 'bps', bps: 15 });
    expect(result.amount).toBeNull();
    expect(result.anomalies[0].type).toBe('missing_loan_amount');
  });

  it('flags a zero line', () => {
    const result = computeCommission(settledDeal(), { id: 'r_zero', type: 'flat', flatAmount: 0 });
    expect(result.amount).toBe(0);
    expect(result.anomalies[0].type).toBe('zero_line');
  });

  it('flags no rule at all', () => {
    const result = computeCommission(settledDeal(), null);
    expect(result.amount).toBeNull();
    expect(result.anomalies[0].type).toBe('no_rule');
  });

  it('rounds to cents', () => {
    const result = computeCommission(settledDeal({ loanAmount: 633333 }), { id: 'r_bps', type: 'bps', bps: 17 });
    expect(result.amount).toBe(1076.67);
  });
});

describe('rule precedence', () => {
  const rules = [
    { id: 'r_old', scope: 'global', type: 'flat', flatAmount: 300, effectiveFrom: '2024-01-01' },
    { id: 'r_current', scope: 'global', type: 'flat', flatAmount: 500, effectiveFrom: '2026-01-01' },
    { id: 'r_future', scope: 'global', type: 'flat', flatAmount: 900, effectiveFrom: '2027-01-01' },
    { id: 'r_alex', scope: 'partner', partnerId: 'p_alex', type: 'bps', bps: 15, effectiveFrom: '2026-01-01' },
    { id: 'r_alex_old', scope: 'partner', partnerId: 'p_alex', type: 'flat', flatAmount: 250, effectiveFrom: '2025-01-01' },
  ];

  it('takes the latest rule already in effect', () => {
    expect(resolveRule(rules, { onDate: '2026-06-01' }).id).toBe('r_current');
    expect(resolveRule(rules, { onDate: '2025-06-01' }).id).toBe('r_old');
    expect(resolveRule(rules, { onDate: '2027-06-01' }).id).toBe('r_future');
  });

  it('lets a partner override beat the global rule', () => {
    expect(resolveRule(rules, { partnerId: 'p_alex', onDate: '2026-06-01' }).id).toBe('r_alex');
    expect(resolveRule(rules, { partnerId: 'p_priya', onDate: '2026-06-01' }).id).toBe('r_current');
  });

  it('falls back to the global rule before the override takes effect', () => {
    expect(resolveRule(rules, { partnerId: 'p_alex', onDate: '2024-06-01' }).id).toBe('r_old');
  });

  it('ignores inactive rules', () => {
    const withInactive = [...rules, { id: 'r_newest', scope: 'global', type: 'flat', flatAmount: 1, effectiveFrom: '2026-08-01', active: false }];
    expect(resolveRule(withInactive, { onDate: '2026-09-01' }).id).toBe('r_current');
  });

  it('returns null when nothing applies', () => {
    expect(resolveRule([], { onDate: '2026-06-01' })).toBeNull();
    expect(resolveRule(rules, { onDate: '2020-01-01' })).toBeNull();
  });

  it('describes each rule type in words', () => {
    expect(describeRule(normaliseRule({ type: 'flat', flatAmount: 500 }))).toContain('$500 per settled referred loan');
    expect(describeRule(normaliseRule({ type: 'bps', bps: 15 }))).toContain('0.15%');
    expect(describeRule(normaliseRule({ type: 'share_upfront', sharePct: 20 }))).toContain('20%');
    expect(describeRule(null)).toBe('No rule');
  });
});

describe('the demo deck totals', () => {
  const config = loadConfig({ PULSE_TZ: 'Australia/Brisbane' });
  const data = buildSeed({ config, today: TODAY });

  it('gives Alex 3 referred / 2 settled / $1,000 due / 1 in flight / $3,500 paid', () => {
    const numbers = statementNumbers({
      partnerId: 'p_alex',
      deals: data.deals,
      period: LAST_MONTH,
      today: TODAY,
      rules: data.rules,
    });
    expect(numbers).toEqual({
      dealsReferred: 3,
      settledThisMonth: 2,
      commsDue: 1000,
      inFlight: 1,
      paidYtd: 3500,
    });
  });

  it('builds one statement per partner with a line per settled deal', () => {
    const statement = buildStatement({
      partner: data.partners[0],
      deals: data.deals,
      rules: data.rules,
      period: LAST_MONTH,
      today: TODAY,
      statements: data.statements,
      id: 'st_test',
    });
    expect(statement.lines).toHaveLength(2);
    expect(statement.total).toBe(1000);
    for (const line of statement.lines) {
      expect(line.dealId).toBeTruthy();
      expect(line.ruleId).toBe('rule_demo_flat');
      expect(line.amount).toBe(500);
    }
  });

  it('flags the anomalies the deck is built to show', () => {
    const statement = buildStatement({
      partner: data.partners[0],
      deals: data.deals,
      rules: data.rules,
      period: LAST_MONTH,
      today: TODAY,
      statements: data.statements,
      id: 'st_test',
    });
    const types = new Set(statement.anomalies.map((a) => a.type));
    expect(types.has('fee_disclosure_missing')).toBe(true);
    expect(types.has('duplicate_client')).toBe(true);
    expect(types.has('settled_unpaid_30')).toBe(true);
  });

  it('flags a settled deal with no referrer at register level', () => {
    const anomalies = registerAnomalies({ deals: data.deals, partners: data.partners, rules: data.rules, today: TODAY });
    expect(anomalies.some((a) => a.type === 'settled_no_referrer')).toBe(true);
  });

  it('lists the periods that have settlements', () => {
    expect(periodsWithSettlements(data.deals)).toContain(LAST_MONTH);
  });
});

describe('re-checking a statement against the live register', () => {
  const partner = { id: 'p_alex', name: 'Alex Sample' };
  const deals = [settledDeal({ id: 'd1', ref: 'PP-0001' }), settledDeal({ id: 'd2', ref: 'PP-0002', name: 'Second Client' })];
  const statement = buildStatement({ partner, deals, rules: [FLAT], period: LAST_MONTH, today: TODAY, id: 'st1' });

  it('starts with both lines', () => {
    expect(statement.lines).toHaveLength(2);
    expect(statement.total).toBe(1000);
  });

  it('drops a line when the deal is reopened', () => {
    const reopened = deals.map((d) => (d.id === 'd1' ? { ...d, stage: 'formal' } : d));
    const result = recheckLines(statement, reopened, [FLAT], TODAY);
    expect(result.lines).toHaveLength(1);
    expect(result.total).toBe(500);
    expect(result.changes[0]).toMatchObject({ type: 'removed', dealId: 'd1' });
  });

  it('notices an amount that changed under a new rule', () => {
    const newRule = { id: 'r_new', scope: 'global', type: 'flat', flatAmount: 750, effectiveFrom: '2025-01-01' };
    const result = recheckLines(statement, deals, [newRule], TODAY);
    expect(result.total).toBe(1500);
    expect(result.changes.every((c) => c.type === 'amount_changed')).toBe(true);
  });

  it('adds a deal that settled into the period after the draft was built', () => {
    const extra = settledDeal({ id: 'd3', ref: 'PP-0003', name: 'Late Settler', settledAt: `${LAST_MONTH}-27`, referralComms: { status: 'due', amount: null } });
    const result = recheckLines(statement, [...deals, extra], [FLAT], TODAY);
    expect(result.lines).toHaveLength(3);
    expect(result.changes.some((c) => c.type === 'added' && c.dealId === 'd3')).toBe(true);
  });

  it('drops a line when the settlement date moves out of the period', () => {
    const moved = deals.map((d) => (d.id === 'd1' ? { ...d, keyDates: { ...d.keyDates, settledAt: TODAY } } : d));
    const result = recheckLines(statement, moved, [FLAT], TODAY);
    expect(result.changes.some((c) => c.type === 'removed' && c.reason.includes('period'))).toBe(true);
  });
});

describe('statement lifecycle guards', () => {
  const partner = { id: 'p_alex', name: 'Alex Sample' };
  const base = buildStatement({ partner, deals: [settledDeal()], rules: [FLAT], period: LAST_MONTH, today: TODAY, id: 'st1' });

  it('only issues a draft with lines', () => {
    expect(canIssue(base).ok).toBe(true);
    expect(canIssue({ ...base, status: 'issued' }).reason).toBe('wrong_status');
    expect(canIssue({ ...base, lines: [] }).reason).toBe('empty');
    expect(canIssue(null).reason).toBe('not_found');
  });

  it('only pays an issued statement', () => {
    expect(canMarkPaid({ ...base, status: 'issued' }).ok).toBe(true);
    expect(canMarkPaid(base).reason).toBe('wrong_status');
  });

  it('voids anything that is not already void', () => {
    expect(canVoid(base).ok).toBe(true);
    expect(canVoid({ ...base, status: 'void' }).reason).toBe('wrong_status');
  });

  it('knows when a deal sits on an issued statement', () => {
    const issued = { ...base, status: 'issued' };
    expect(isOnIssuedStatement('d1', [issued])?.id).toBe('st1');
    expect(isOnIssuedStatement('d1', [base])).toBeNull();
    expect(isOnIssuedStatement('other', [issued])).toBeNull();
  });
});
