import { describe, it, expect } from 'vitest';
import { extractHandoverOffline, parseMilestoneOffline, matchPartner, questionsForGaps } from '../server/heuristics.js';
import { buildSamples } from '../server/samples.js';
import { normaliseDeal, ragForDeal } from '../shared/record.js';
import { addDays } from '../shared/dates.js';

const TODAY = '2026-09-11';
const PARTNERS = [
  { id: 'p_alex', name: 'Alex Sample', agency: 'Sample Property', office: 'Coronis Lutwyche' },
  { id: 'p_priya', name: 'Priya Example', agency: 'Example Realty', office: 'Coronis Lutwyche' },
  { id: 'p_jordan', name: 'Jordan Placeholder', agency: 'Placeholder Real Estate', office: 'Coronis Windsor' },
];
const samples = buildSamples({ today: TODAY, firm: { broker: 'Nathan', name: 'Coronis Finance' } });
const sample = (id) => samples.find((s) => s.id === id);

function extract(text, channel = 'notes') {
  return extractHandoverOffline(text, { partners: PARTNERS, today: TODAY, broker: 'Nathan', channel, firmName: 'Coronis Finance' });
}

describe('offline handover extraction', () => {
  it('reads the tidy email sample into a complete record', () => {
    const result = extract(sample('sample_email').text, 'email');
    expect(result.provider).toBe('heuristic');
    expect(result.rag).toBe('green');
    expect(result.record.client.name).toBe('Priya & Dev Kumar');
    expect(result.record.client.phone).toBe('0412 998 221');
    expect(result.record.client.email).toBe('priya.kumar@example.com');
    expect(result.record.loanAmount).toBe(640000);
    expect(result.record.lender).toBe('Macquarie');
    expect(result.record.purpose).toBe('purchase');
    expect(result.record.propertyAddress).toContain('18 Bellbird St');
    expect(result.record.referredBy).toBe('p_alex');
  });

  it('keeps the finance date and the settlement date apart', () => {
    const result = extract(sample('sample_email').text, 'email');
    expect(result.record.keyDates.financeDue).toBe(addDays(TODAY, 12));
    expect(result.record.keyDates.settlementDue).toBe(addDays(TODAY, 40));
    expect(result.record.keyDates.contract).toBe(addDays(TODAY, -9));
  });

  it('takes the client email, not the agent one in the From line', () => {
    const result = extract(sample('sample_email').text, 'email');
    expect(result.record.client.email).not.toContain('sampleproperty');
  });

  it('reads the messy notes as red and asks for what is missing', () => {
    const result = extract(sample('sample_notes').text, 'notes');
    expect(result.rag).toBe('red');
    expect(result.record.loanAmount).toBe(500000);
    expect(result.record.client.name).toBeNull();
    expect(result.record.referredBy).toBeNull();
    expect(result.questions.length).toBeGreaterThanOrEqual(3);
    expect(result.questions.length).toBeLessThanOrEqual(5);
    expect(result.questions.join(' ')).toMatch(/referred|purpose|clients/i);
  });

  it('reads a rambling voice transcript, including a spelled-out amount', () => {
    const result = extract(sample('sample_voice').text, 'voice');
    expect(result.record.client.name).toBe('Bianca Nguyen');
    expect(result.record.loanAmount).toBe(620000);
    expect(result.record.purpose).toBe('refinance');
    expect(result.record.lender).toBe('Suncorp');
    expect(result.record.referredBy).toBe('p_jordan');
    expect(result.record.keyDates.preApprovalExpiry).toBe(addDays(TODAY, 78));
  });

  it('only suggests consent when the text says the client agreed, with the phrase', () => {
    const yes = extract(sample('sample_voice').text, 'voice');
    expect(yes.suggestedConsent.shareStatus).toBe(true);
    expect(yes.suggestedConsent.shareStatusEvidence).toMatch(/fine with us telling Jordan/);
    expect(yes.suggestedConsent.feeDisclosed).toBe(true);

    const no = extract(sample('sample_notes').text, 'notes');
    expect(no.suggestedConsent.shareStatus).toBe(false);
    expect(no.suggestedConsent.shareStatusEvidence).toBeNull();
    expect(no.suggestedConsent.feeDisclosed).toBe(false);
  });

  it('never infers consent from enthusiasm or from the referral itself', () => {
    const result = extract('Alex Sample sent me a great couple, they are keen and lovely, purchase at 12 Fern St, Lutwyche QLD 4030, 500k, with ANZ. Broker: Nathan');
    expect(result.suggestedConsent.shareStatus).toBe(false);
  });

  it('gives a confidence per field', () => {
    const result = extract(sample('sample_email').text, 'email');
    for (const key of ['client', 'broker', 'referredBy', 'purpose', 'loanAmount', 'lender', 'propertyAddress']) {
      expect(result.confidence[key]).toBeGreaterThan(0);
      expect(result.confidence[key]).toBeLessThanOrEqual(1);
    }
  });

  it('handles an empty paste without throwing', () => {
    const result = extract('');
    expect(result.rag).toBe('red');
    expect(result.record.client.name).toBeNull();
  });

  it('matches a partner by name, first name or agency', () => {
    expect(matchPartner('referred by Alex Sample', PARTNERS)[0].partnerId).toBe('p_alex');
    expect(matchPartner('Priya sent this one over', PARTNERS)[0].partnerId).toBe('p_priya');
    const byAgency = matchPartner('from Placeholder Real Estate', PARTNERS);
    expect(byAgency[0].partnerId).toBe('p_jordan');
    expect(matchPartner('nobody here', PARTNERS)).toHaveLength(0);
  });

  it('writes questions only about the gaps', () => {
    const deal = normaliseDeal({ clientName: 'A B', broker: 'Nathan', referredBy: 'p_alex', purpose: 'purchase', propertyAddress: '1 Test St' }, { today: TODAY });
    const questions = questionsForGaps(deal, ragForDeal(deal));
    expect(questions.join(' ')).toMatch(/loan amount/i);
    expect(questions.join(' ')).not.toMatch(/who referred/i);
  });
});

describe('offline milestone parsing', () => {
  const openDeals = [
    normaliseDeal({ id: 'd_taylor', ref: 'PP-0003', clientName: 'Sam & Jo Taylor', propertyAddress: '42 Wattlebird Cres, Lutwyche QLD 4030', stage: 'conditional', lender: 'Macquarie', broker: 'Nathan', referredBy: 'p_alex', purpose: 'purchase', loanAmount: 600000 }, { today: TODAY }),
    normaliseDeal({ id: 'd_nguyen', ref: 'PP-0007', clientName: 'Bianca Nguyen', propertyAddress: '7 Kookaburra Tce, Wooloowin QLD 4030', stage: 'lodged', lender: 'Suncorp', broker: 'Nathan', referredBy: 'p_jordan', purpose: 'refinance', loanAmount: 620000 }, { today: TODAY }),
    normaliseDeal({ id: 'd_other', ref: 'PP-0009', clientName: 'Chris Taylor', propertyAddress: '3 Emu Ct, Chermside QLD 4032', stage: 'application', broker: 'Nathan', referredBy: 'direct', purpose: 'purchase', loanAmount: 400000 }, { today: TODAY }),
  ];
  const parse = (text) => parseMilestoneOffline(text, openDeals, { today: TODAY });

  it('reads a formal approval and links it by address', () => {
    const result = parse(sample('sample_bpu_formal').text);
    expect(result.stage).toBe('formal');
    expect(result.dealId).toBe('d_taylor');
    expect(result.score).toBeGreaterThanOrEqual(0.85);
    expect(result.reason).toMatch(/address/);
  });

  it('dates the milestone when it happened, not by the next date in the email', () => {
    const result = parse(sample('sample_bpu_formal').text);
    expect(result.eventDate).toBe(TODAY);
    expect(result.keyDates.settlementDue).toBe(addDays(TODAY, 35));
  });

  it('reads a settlement and sets the settled date', () => {
    const result = parse(sample('sample_bpu_settled').text);
    expect(result.stage).toBe('settled');
    expect(result.dealId).toBe('d_nguyen');
    expect(result.keyDates.settledAt).toBe(TODAY);
  });

  it('respects an explicit no-milestone email', () => {
    const result = parse(sample('sample_bpu_none').text);
    expect(result.noMilestone).toBe(true);
    expect(result.stage).toBeNull();
    expect(result.eventDate).toBeNull();
    expect(result.dealId).toBeNull();
  });

  it('never links on a surname alone', () => {
    const result = parse('Formal approval came through for the Taylor loan today.');
    expect(result.dealId).toBeNull();
    expect(result.reason).toMatch(/surname/i);
    expect(result.alternates.some((a) => a.surnameOnly)).toBe(true);
  });

  it('links on the file reference when it is quoted', () => {
    const result = parse('PP-0009 is now conditionally approved.');
    expect(result.dealId).toBe('d_other');
    expect(result.score).toBeGreaterThanOrEqual(0.9);
  });

  it('says so when nothing matched', () => {
    const result = parse('Formal approval for a file we do not have.');
    expect(result.dealId).toBeNull();
    expect(result.alternates).toHaveLength(0);
    expect(result.reason).toMatch(/No open deal/);
  });

  it('backdates a milestone that names a past date', () => {
    const result = parse('Formal approval was granted on 3 September 2026 for 42 Wattlebird Cres.');
    expect(result.eventDate).toBe('2026-09-03');
    expect(result.dealId).toBe('d_taylor');
  });
});
