import { describe, it, expect } from 'vitest';
import {
  draftUpdate, buildUpdateContext, draftNudge, statementNote, partnerFirstName,
  statementNoteAllowedNumbers, dealStatusPhrase, SMS_MAX,
} from '../shared/templates.js';
import { checkCompliance, checkStatementNote } from '../shared/guard.js';
import { ALL_STAGES } from '../shared/stages.js';
import { normaliseDeal } from '../shared/record.js';

const TODAY = '2026-09-11';
const REFERENCE_SMS = "Hi Alex - quick update on the buyers you sent us for 42 Wattlebird Cres. Their loan was formally approved this morning. Settlement is booked for 9 Oct. We'll let you know the moment it's done. Thanks again for the referral - Nathan, Coronis Finance";

const DEAL = normaliseDeal({
  clientName: 'Sam & Jo Taylor',
  clientPhone: '0412 884 019',
  clientEmail: 'sam.taylor@example.com',
  broker: 'Nathan',
  referredBy: 'p_alex',
  stage: 'formal',
  purpose: 'purchase',
  loanAmount: 600000,
  lender: 'Macquarie',
  propertyAddress: '42 Wattlebird Cres, Lutwyche QLD 4030',
  keyDates: { settlementDue: '2026-10-09' },
}, { today: TODAY });

const PARTNER = { id: 'p_alex', name: 'Alex Sample', phone: '0412 555 178' };

function context(over = {}) {
  return {
    ...buildUpdateContext({
      deal: DEAL, partner: PARTNER, firm: 'Coronis Finance', broker: 'Nathan',
      today: TODAY, eventDate: TODAY,
    }),
    ...over,
  };
}

describe('partner update templates', () => {
  it('matches the reference SMS exactly', () => {
    expect(draftUpdate(context()).sms).toBe(REFERENCE_SMS);
  });

  it('uses plain hyphens, never an em dash', () => {
    for (const stage of ALL_STAGES) {
      const draft = draftUpdate(context({ stage }));
      expect(draft.sms).not.toMatch(/[‒-―−]/);
      expect(draft.email.body).not.toMatch(/[‒-―−]/);
    }
  });

  it('is partner safe and under the SMS limit at every stage', () => {
    for (const stage of ALL_STAGES) {
      const draft = draftUpdate(context({ stage }));
      const sms = checkCompliance(draft.sms);
      const email = checkCompliance(draft.email.body);
      expect(sms.ok, `${stage} sms: ${sms.summary}`).toBe(true);
      expect(email.ok, `${stage} email: ${email.summary}`).toBe(true);
      expect(draft.sms.length, `${stage} sms length`).toBeLessThan(SMS_MAX);
      expect(draft.email.subject.length).toBeGreaterThan(0);
    }
  });

  it('says buyers for a purchase and client for anything else', () => {
    expect(draftUpdate(context({ purpose: 'purchase' })).sms).toContain('the buyers you sent us for 42 Wattlebird Cres');
    expect(draftUpdate(context({ purpose: 'refinance' })).sms).toContain('the client you sent us for 42 Wattlebird Cres');
    expect(draftUpdate(context({ purpose: 'pre_approval' })).sms).toContain('the client you sent us');
  });

  it('names the date of a backdated milestone instead of saying this morning', () => {
    const sms = draftUpdate(context({ eventDate: '2026-09-03' })).sms;
    expect(sms).toContain('formally approved on 3 Sep');
    expect(sms).not.toContain('this morning');
  });

  it('never leaks a figure, a lender or a reason for a decline', () => {
    const declined = draftUpdate(context({ stage: 'declined' }));
    expect(declined.sms.toLowerCase()).not.toMatch(/because|credit|income|serviceab|lvr/);
    expect(checkCompliance(declined.sms).ok).toBe(true);
    for (const stage of ALL_STAGES) {
      const draft = draftUpdate(context({ stage }));
      expect(draft.sms).not.toContain('Macquarie');
      expect(draft.sms).not.toContain('600');
    }
  });

  it('writes around a missing address', () => {
    const draft = draftUpdate(context({ address: null }));
    expect(draft.sms).toContain('quick update on the buyers you sent us.');
    expect(checkCompliance(draft.sms).ok).toBe(true);
  });

  it('only carries partner-safe facts in its context', () => {
    const ctx = buildUpdateContext({ deal: DEAL, partner: PARTNER, firm: 'Coronis Finance', broker: 'Nathan', today: TODAY });
    const json = JSON.stringify(ctx);
    expect(json).not.toContain('600000');
    expect(json).not.toContain('Macquarie');
    expect(json).not.toContain('0412 884 019');
    expect(json).not.toContain('sam.taylor@example.com');
    expect(ctx.clientLabel).toBe('Sam & Jo T.');
  });

  it('mentions the next milestone when there is one', () => {
    expect(draftUpdate(context()).sms).toContain('Settlement is booked for 9 Oct.');
    const noDates = draftUpdate(context({ dates: {} }));
    expect(noDates.sms).not.toContain('Settlement is booked');
  });

  it('takes a first name off a partner', () => {
    expect(partnerFirstName(PARTNER)).toBe('Alex');
    expect(partnerFirstName(null)).toBe('there');
  });
});

describe('the Friday nudge', () => {
  it('matches the reference nudge', () => {
    const nudge = draftNudge({ partnerFirstName: 'Alex', opensCount: 4, settledCount: 2, broker: 'Nathan' });
    expect(nudge.sms).toBe("Alex - you've got 4 opens on Saturday and 2 of your referred buyers settled this month. Want a pre-approval QR code for the sign-in sheet? Anyone who scans it gets a call from Nathan within a day.");
    expect(checkCompliance(nudge.sms).ok).toBe(true);
  });

  it('reads properly with no opens, no settlements, or one of each', () => {
    const cases = [
      { opensCount: 0, settledCount: 0 },
      { opensCount: 1, settledCount: 0 },
      { opensCount: 0, settledCount: 1 },
      { opensCount: 1, settledCount: 1 },
    ];
    for (const c of cases) {
      const nudge = draftNudge({ partnerFirstName: 'Alex', broker: 'Nathan', ...c });
      expect(checkCompliance(nudge.sms).ok).toBe(true);
      expect(nudge.sms.length).toBeLessThan(SMS_MAX);
      expect(nudge.sms).not.toMatch(/\b1 (opens|buyers)\b/);
    }
  });
});

describe('the statement cover note', () => {
  const statement = {
    periodLabel: 'August 2026',
    numbers: { dealsReferred: 3, settledThisMonth: 2, commsDue: 1000, inFlight: 1, paidYtd: 3500 },
    total: 1000,
    lines: [{ amount: 500 }, { amount: 500 }],
  };

  it('uses only the statement totals', () => {
    const note = statementNote({
      partnerFirstName: 'Alex',
      periodLabel: statement.periodLabel,
      numbers: statement.numbers,
      broker: 'Nathan',
      firm: 'Coronis Finance',
    });
    const result = checkStatementNote(note.text, statementNoteAllowedNumbers(statement));
    expect(result.ok).toBe(true);
    expect(note.text).toContain('$1,000');
  });

  it('reads properly when nothing settled', () => {
    const note = statementNote({
      partnerFirstName: 'Priya',
      periodLabel: 'August 2026',
      numbers: { dealsReferred: 1, settledThisMonth: 0, commsDue: 0, inFlight: 2, paidYtd: 0 },
      broker: 'Nathan',
      firm: 'Coronis Finance',
    });
    expect(note.text).toContain('nothing owing yet');
    expect(checkStatementNote(note.text, [0, 1, 2]).ok).toBe(true);
  });
});

describe('status phrasing', () => {
  it('gives a partner-safe phrase per stage', () => {
    for (const stage of ALL_STAGES) {
      const phrase = dealStatusPhrase({ stage });
      expect(phrase.length).toBeGreaterThan(0);
      expect(checkCompliance(phrase).ok).toBe(true);
    }
    expect(dealStatusPhrase({ stage: 'declined' })).toBe('Closed');
  });
});
