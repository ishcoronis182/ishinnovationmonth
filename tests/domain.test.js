import { describe, it, expect } from 'vitest';
import {
  normaliseDeal, ragForDeal, clientLabel, clientInitials, shortAddress,
  nextMilestone, expectedDateFields, normalisePhone, normaliseEmail, normalisePurpose,
} from '../shared/record.js';
import {
  canTransition, stageIndex, isLive, isClosed, atOrPast, nextStage, stageFromMilestoneWord, STAGES,
} from '../shared/stages.js';
import { parseMoney, parseMoneyWords, formatMoney, roundCents } from '../shared/money.js';
import {
  todayISO, parseDate, addDays, daysBetween, formatShort, monthRange, previousMonthKey,
  weekStart, nextSaturday, isValidISODate, findDate,
} from '../shared/dates.js';

const TODAY = '2026-09-11';

function deal(over = {}) {
  return normaliseDeal({
    clientName: 'Sam & Jo Taylor',
    clientPhone: '0412 345 678',
    clientEmail: 'sam@example.com',
    broker: 'Nathan',
    referredBy: 'p_alex',
    stage: 'formal',
    purpose: 'purchase',
    loanAmount: 600000,
    lender: 'Macquarie',
    propertyAddress: '42 Wattlebird Cres, Lutwyche QLD 4030',
    keyDates: { contract: '2026-08-12', financeDue: '2026-09-05', settlementDue: '2026-10-09' },
    ...over,
  }, { today: TODAY });
}

describe('the ten-field record', () => {
  it('normalises a complete handover to green', () => {
    const d = deal();
    expect(d.rag).toBe('green');
    expect(ragForDeal(d).missing).toEqual([]);
    expect(d.loanAmount).toBe(600000);
    expect(d.client.phone).toBe('0412 345 678');
    expect(d.client.email).toBe('sam@example.com');
  });

  it('parses Australian input: day-first dates and shorthand money', () => {
    const d = deal({ loanAmount: '600k', keyDates: { contract: '9/10/2026', settlementDue: '3 Dec 2026' } });
    expect(d.loanAmount).toBe(600000);
    expect(d.keyDates.contract).toBe('2026-10-09');
    expect(d.keyDates.settlementDue).toBe('2026-12-03');
  });

  it.each([
    ['client name', { clientName: null }, 'Client name'],
    ['broker', { broker: null }, 'Broker'],
    ['referrer', { referredBy: null }, 'Referred by (unknown)'],
    ['purpose', { purpose: null }, 'Purpose'],
    ['loan amount', { loanAmount: null }, 'Loan amount'],
  ])('is red when %s is missing', (_label, patch, expected) => {
    const result = ragForDeal(deal(patch));
    expect(result.rag).toBe('red');
    expect(result.missing).toContain(expected);
  });

  it('is red for a missing lender only once the deal is lodged', () => {
    expect(ragForDeal(deal({ lender: null, stage: 'application' })).rag).toBe('amber');
    expect(ragForDeal(deal({ lender: null, stage: 'lodged' })).rag).toBe('red');
    expect(ragForDeal(deal({ lender: null, stage: 'formal' })).rag).toBe('red');
  });

  it('is red for a missing address only on a purchase', () => {
    expect(ragForDeal(deal({ propertyAddress: null, purpose: 'purchase' })).rag).toBe('red');
    const refi = ragForDeal(deal({ propertyAddress: null, purpose: 'refinance' }));
    expect(refi.rag).toBe('amber');
    expect(refi.critical).toHaveLength(0);
  });

  it('is red when a settled deal has no settlement date', () => {
    const result = ragForDeal(deal({ stage: 'settled', keyDates: { contract: '2026-08-12', financeDue: '2026-09-05', settlementDue: '2026-10-09' } }));
    expect(result.rag).toBe('red');
    expect(result.missing).toContain('Settlement date');
  });

  it('is amber for contact details and dates only', () => {
    const missingPhone = ragForDeal(deal({ clientPhone: null }));
    expect(missingPhone.rag).toBe('amber');
    expect(missingPhone.missing).toEqual(['Client phone']);
    const missingDates = ragForDeal(deal({ keyDates: {} }));
    expect(missingDates.rag).toBe('amber');
    expect(missingDates.missing).toEqual(['Contract date', 'Finance due', 'Settlement due']);
  });

  it('expects different dates for different purposes', () => {
    expect(expectedDateFields(deal({ purpose: 'purchase' }))).toEqual(['contract', 'financeDue', 'settlementDue']);
    expect(expectedDateFields(deal({ purpose: 'refinance' }))).toEqual(['settlementDue']);
    expect(expectedDateFields(deal({ purpose: 'pre_approval' }))).toEqual(['preApprovalExpiry']);
  });

  it('never invents a value it was not given', () => {
    const d = normaliseDeal({ clientName: 'unknown', loanAmount: 'not a number', purpose: 'banana', lender: 'n/a' }, { today: TODAY });
    expect(d.client.name).toBeNull();
    expect(d.loanAmount).toBeNull();
    expect(d.purpose).toBeNull();
    expect(d.lender).toBeNull();
  });

  it('never throws on rubbish input', () => {
    for (const input of [null, undefined, 42, 'text', [], { client: 'not an object' }, { keyDates: 7 }]) {
      expect(() => normaliseDeal(input, { today: TODAY })).not.toThrow();
    }
  });

  it('labels clients for partner copy and initials for the portal', () => {
    expect(clientLabel(deal())).toBe('Sam & Jo T.');
    expect(clientLabel({ client: { name: 'Bianca Nguyen' } })).toBe('Bianca N.');
    expect(clientLabel({ client: { name: 'Sam and Jo Taylor' } })).toBe('Sam & Jo T.');
    expect(clientInitials(deal())).toBe('S. & J. T.');
    expect(clientInitials({ client: { name: null } })).toBe('Client');
  });

  it('shortens an address for SMS', () => {
    expect(shortAddress('42 Wattlebird Cres, Lutwyche QLD 4030')).toBe('42 Wattlebird Cres');
    expect(shortAddress(null)).toBeNull();
  });

  it('picks the next milestone the partner cares about', () => {
    expect(nextMilestone(deal(), TODAY).key).toBe('settlementDue');
    const preApp = deal({ purpose: 'pre_approval', keyDates: { preApprovalExpiry: '2026-11-01' } });
    expect(nextMilestone(preApp, TODAY).key).toBe('preApprovalExpiry');
    expect(nextMilestone(deal({ stage: 'declined' }), TODAY)).toBeNull();
  });

  it('normalises contact details', () => {
    expect(normalisePhone('+61412345678')).toBe('0412 345 678');
    expect(normalisePhone('0732520700')).toBe('(07) 3252 0700');
    expect(normalisePhone('nope')).toBeNull();
    expect(normaliseEmail('  SAM@Example.COM ')).toBe('sam@example.com');
    expect(normaliseEmail('not-an-email')).toBeNull();
    expect(normalisePurpose('Refi')).toBe('refinance');
    expect(normalisePurpose('first home')).toBe('purchase');
  });
});

describe('stage transitions', () => {
  it('moves forward along the main line', () => {
    for (let i = 0; i < STAGES.length - 1; i += 1) {
      expect(canTransition(STAGES[i], STAGES[i + 1]).ok).toBe(true);
    }
  });

  it('allows a correction backwards but flags it', () => {
    const back = canTransition('formal', 'lodged');
    expect(back.ok).toBe(true);
    expect(back.backwards).toBe(true);
  });

  it('locks a settled deal', () => {
    const result = canTransition('settled', 'formal');
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('settled_locked');
    expect(canTransition('settled', 'declined').ok).toBe(false);
  });

  it('locks an off-ramped deal until it is reopened', () => {
    expect(canTransition('declined', 'formal').reason).toBe('off_ramp_locked');
    expect(canTransition('withdrawn', 'lodged').reason).toBe('off_ramp_locked');
  });

  it('refuses a move to the same stage or an unknown stage', () => {
    expect(canTransition('lodged', 'lodged').reason).toBe('same_stage');
    expect(canTransition('lodged', 'banana').reason).toBe('unknown_stage');
  });

  it('lets any live stage go to an off ramp', () => {
    expect(canTransition('referred', 'declined').ok).toBe(true);
    expect(canTransition('formal', 'withdrawn').ok).toBe(true);
  });

  it('knows where a stage sits', () => {
    expect(stageIndex('lodged')).toBe(2);
    expect(stageIndex('declined')).toBe(-1);
    expect(isLive('formal')).toBe(true);
    expect(isLive('settled')).toBe(false);
    expect(isClosed('withdrawn')).toBe(true);
    expect(atOrPast('formal', 'lodged')).toBe(true);
    expect(atOrPast('application', 'lodged')).toBe(false);
    expect(nextStage('conditional')).toBe('formal');
    expect(nextStage('settled')).toBeNull();
  });

  it('reads a stage out of a milestone sentence', () => {
    expect(stageFromMilestoneWord('We are pleased to advise formal approval')).toBe('formal');
    expect(stageFromMilestoneWord('conditionally approved subject to valuation')).toBe('conditional');
    expect(stageFromMilestoneWord('the file has been lodged')).toBe('lodged');
    expect(stageFromMilestoneWord('settlement complete, funds disbursed')).toBe('settled');
    expect(stageFromMilestoneWord('nothing to report')).toBeNull();
  });
});

describe('money', () => {
  it.each([
    ['600k', 600000],
    ['$600,000', 600000],
    ['AUD650k', 650000],
    ['$1.2m', 1200000],
    ['1.2 million', 1200000],
    ['six hundred thousand', 600000],
    ['half a million', 500000],
    ['600 000', 600000],
    ['650000', 650000],
    [600000, 600000],
  ])('parses %s', (input, expected) => {
    expect(parseMoney(input)).toBe(expected);
  });

  it('returns null when it is not money', () => {
    expect(parseMoney('not money')).toBeNull();
    expect(parseMoney('')).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });

  it('parses spelled-out amounts', () => {
    expect(parseMoneyWords('six hundred and twenty thousand')).toBe(620000);
    expect(parseMoneyWords('two million')).toBe(2000000);
    expect(parseMoneyWords('hello there')).toBeNull();
  });

  it('formats dollars with cents only when needed', () => {
    expect(formatMoney(1000)).toBe('$1,000');
    expect(formatMoney(3500.5)).toBe('$3,500.50');
    expect(formatMoney(null)).toBe('-');
    expect(roundCents(1.005)).toBe(1.01);
  });
});

describe('dates in the firm timezone', () => {
  it('reckons today in Brisbane, not in UTC', () => {
    const lateUtc = new Date('2026-09-10T17:00:00Z'); // already the 11th in Brisbane
    expect(todayISO('Australia/Brisbane', lateUtc)).toBe('2026-09-11');
    expect(todayISO('UTC', lateUtc)).toBe('2026-09-10');
  });

  it('parses day-first', () => {
    expect(parseDate('9/10/2026')).toBe('2026-10-09');
    expect(parseDate('09-10-26')).toBe('2026-10-09');
    expect(parseDate('9 Oct 2026')).toBe('2026-10-09');
    expect(parseDate('October 9, 2026')).toBe('2026-10-09');
    expect(parseDate('2026-10-09')).toBe('2026-10-09');
    expect(parseDate('not a date')).toBeNull();
  });

  it('rolls a bare day and month to the nearest sensible year', () => {
    expect(parseDate('9 Oct', { today: '2026-09-11' })).toBe('2026-10-09');
    expect(parseDate('9 Jan', { today: '2026-12-20' })).toBe('2027-01-09');
  });

  it('does arithmetic without timezone drift', () => {
    expect(addDays('2026-09-11', 35)).toBe('2026-10-16');
    expect(addDays('2026-02-28', 1)).toBe('2026-03-01');
    expect(daysBetween('2026-09-11', '2026-10-09')).toBe(28);
    expect(formatShort('2026-10-09')).toBe('9 Oct');
    expect(monthRange('2026-02')).toEqual({ start: '2026-02-01', end: '2026-02-28' });
    expect(previousMonthKey('2026-01')).toBe('2025-12');
    expect(weekStart('2026-09-11')).toBe('2026-09-07');
    expect(nextSaturday('2026-09-11')).toBe('2026-09-12');
    expect(isValidISODate('2026-02-30')).toBe(false);
  });

  it('finds a date inside a sentence', () => {
    expect(findDate('settlement is booked for 9 Oct, all good', { today: '2026-09-11' })).toBe('2026-10-09');
    expect(findDate('no dates here')).toBeNull();
  });
});
