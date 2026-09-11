import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { makeApp } from './helpers.js';
import { previousMonthKey, monthKey } from '../shared/dates.js';

describe('the whole loop, through the API', () => {
  let h;
  let lastMonth;

  beforeAll(async () => {
    h = await makeApp();
    lastMonth = previousMonthKey(monthKey(h.today));
  });
  afterAll(async () => { await h?.close(); });

  it('boots with the demo deck', async () => {
    const res = await h.request('/api/bootstrap');
    expect(res.status).toBe(200);
    expect(res.payload.firm.name).toBe('Coronis Finance');
    expect(res.payload.counts.deals).toBe(16);
    expect(res.payload.pulse.commsDue).toBe(1000);
    expect(res.payload.ai.enabled).toBe(false);
  });

  it('REFER: a pasted handover becomes a ten-field record with no API key', async () => {
    const samples = await h.request('/api/samples');
    const notes = samples.payload.samples.find((s) => s.id === 'sample_notes');

    const extracted = await h.request('/api/handover/extract', { body: { text: notes.text, channel: 'notes', useAi: true } });
    expect(extracted.status).toBe(200);
    expect(extracted.payload.meta.provider).toBe('heuristic');
    expect(extracted.payload.meta.reason).toBe('no_api_key');
    expect(extracted.payload.extraction.rag).toBe('red');
    expect(extracted.payload.extraction.missing.length).toBeGreaterThan(0);
    expect(extracted.payload.extraction.questions.length).toBeGreaterThan(0);
    expect(extracted.payload.extraction.suggestedConsent.shareStatus).toBe(false);

    const email = samples.payload.samples.find((s) => s.id === 'sample_email');
    const green = await h.request('/api/handover/extract', { body: { text: email.text, channel: 'email' } });
    expect(green.payload.extraction.rag).toBe('green');
    expect(green.payload.extraction.partnerMatch.partnerId).toBe('p_alex');
    expect(green.payload.extraction.suggestedConsent.shareStatus).toBe(true);
    expect(green.payload.extraction.suggestedConsent.shareStatusEvidence).toBeTruthy();

    const committed = await h.request('/api/handover/commit', {
      body: {
        record: green.payload.extraction.record,
        consent: green.payload.extraction.suggestedConsent,
        channel: 'email',
        summary: green.payload.extraction.summary,
        questions: green.payload.extraction.questions,
        confidence: green.payload.extraction.confidence,
        provider: green.payload.meta.provider,
      },
    });
    expect(committed.status).toBe(201);
    expect(committed.payload.deal.ref).toMatch(/^PP-\d{4}$/);
    expect(committed.payload.deal.arrivalRag).toBe('green');
    expect(committed.payload.deal.consent.shareStatus).toBe(true);
    expect(committed.payload.deal.timeline.some((e) => e.type === 'created')).toBe(true);
  });

  it('MUST NEVER: send to a partner without the client consenting on that deal', async () => {
    const deals = await h.request('/api/deals');
    const jordanDeal = deals.payload.deals.find((d) => d.partnerName === 'Jordan Placeholder');
    expect(jordanDeal.consent.shareStatus).toBe(false);

    const draft = await h.request(`/api/deals/${jordanDeal.id}/draft-update`, { body: {} });
    expect(draft.payload.gate.ok).toBe(false);
    expect(draft.payload.gate.reason).toBe('no_consent');

    const send = await h.request(`/api/deals/${jordanDeal.id}/send-update`, {
      body: { sms: draft.payload.draft.sms, channels: ['sms'] },
    });
    expect(send.status).toBe(403);
    expect(send.payload.error).toBe('no_consent');

    const after = await h.request(`/api/deals/${jordanDeal.id}`);
    expect(after.payload.deal.updateCount).toBe(0);
  });

  it('UPDATE: a stage change drafts a partner-safe SMS and email, and sends in one click', async () => {
    const draft = await h.request('/api/deals/deal_taylor/draft-update', { body: { stage: 'formal' } });
    expect(draft.payload.gate.ok).toBe(true);
    expect(draft.payload.compliance.sms.ok).toBe(true);
    expect(draft.payload.compliance.email.ok).toBe(true);
    expect(draft.payload.draft.sms).toContain('Hi Alex - quick update on the buyers you sent us for 42 Wattlebird Cres.');
    expect(draft.payload.draft.sms).toContain('Their loan was formally approved this morning.');
    expect(draft.payload.draft.sms).toContain('Thanks again for the referral - Nathan, Coronis Finance');
    expect(draft.payload.smsLength).toBeLessThan(320);

    const sent = await h.request('/api/deals/deal_taylor/send-update', {
      body: {
        sms: draft.payload.draft.sms,
        emailSubject: draft.payload.draft.emailSubject,
        emailBody: draft.payload.draft.emailBody,
        channels: ['sms', 'email'],
        stage: 'formal',
      },
    });
    expect(sent.status).toBe(200);
    expect(sent.payload.message.status).toBe('sent');
    expect(sent.payload.message.deliveries).toHaveLength(2);
    expect(sent.payload.message.deliveries[0].link).toMatch(/^sms:/);
    expect(sent.payload.message.deliveries[1].link).toMatch(/^mailto:/);
    expect(sent.payload.deal.timeline.some((e) => e.type === 'update_sent')).toBe(true);
    expect(sent.payload.deal.updateCount).toBeGreaterThan(0);
  });

  it('MUST NEVER: send a partner message carrying a figure', async () => {
    const attempts = [
      'Hi Alex - their $600,000 loan was approved. Thanks - Nathan',
      'Hi Alex - approved at 5.89% today. Thanks - Nathan',
      'Hi Alex - the loan of 600,000 is away. Thanks - Nathan',
      'Hi Alex - six hundred thousand approved. Thanks - Nathan',
      'Hi Alex - their income checks out so it is approved. Thanks - Nathan',
    ];
    for (const sms of attempts) {
      const res = await h.request('/api/deals/deal_taylor/send-update', { body: { sms, channels: ['sms'] } });
      expect(res.status, sms).toBe(422);
      expect(res.payload.error).toBe('compliance_blocked');
      expect(res.payload.compliance.sms.blocked.length).toBeGreaterThan(0);
    }
  });

  it('reads a BPU milestone email and applies it to the right file', async () => {
    const samples = await h.request('/api/samples');

    const none = await h.request('/api/milestone/parse', {
      body: { text: samples.payload.samples.find((s) => s.id === 'sample_bpu_none').text },
    });
    expect(none.payload.parsed.noMilestone).toBe(true);
    expect(none.payload.parsed.stage).toBeNull();

    const settled = await h.request('/api/milestone/parse', {
      body: { text: samples.payload.samples.find((s) => s.id === 'sample_bpu_settled').text },
    });
    expect(settled.payload.parsed.stage).toBe('settled');
    expect(settled.payload.matched).toBeTruthy();

    const applied = await h.request('/api/milestone/apply', {
      body: {
        dealId: settled.payload.parsed.dealId,
        stage: 'settled',
        eventDate: settled.payload.parsed.eventDate,
        keyDates: settled.payload.parsed.keyDates,
      },
    });
    expect(applied.status).toBe(200);
    expect(applied.payload.deal.stage).toBe('settled');
    expect(applied.payload.deal.referralComms.amount).toBe(500);
    expect(applied.payload.deal.referralComms.ruleId).toBe('rule_demo_flat');
    expect(applied.payload.deal.timeline.some((e) => e.type === 'commission_computed')).toBe(true);

    const locked = await h.request(`/api/deals/${applied.payload.deal.id}/stage`, { body: { stage: 'formal' } });
    expect(locked.status).toBe(409);
    expect(locked.payload.error).toBe('settled_locked');
  });

  it('PROMOTE: the Friday note counts only consented deals', async () => {
    const friday = await h.request('/api/friday');
    const alex = friday.payload.cards.find((c) => c.partnerId === 'p_alex');
    expect(alex.opensCount).toBe(4);
    expect(alex.nudge.sms).toContain("you've got 4 opens on Saturday");
    expect(alex.nudge.sms).toContain('2 of your referred buyers settled this month');
    expect(alex.compliance.ok).toBe(true);
    expect(alex.agentHears.total).toBeLessThanOrEqual(alex.registerCount.total);

    const jordan = friday.payload.cards.find((c) => c.partnerId === 'p_jordan');
    expect(jordan.consentGap).toBeGreaterThan(0);
    expect(jordan.agentHears.total).toBeLessThan(jordan.registerCount.total);
  });

  it('PAY: generating a period gives one statement per partner with traceable lines', async () => {
    const generated = await h.request('/api/statements/generate', { body: { period: lastMonth } });
    expect(generated.status).toBe(200);
    const alexStatement = generated.payload.statements.find((s) => s.partnerId === 'p_alex');
    expect(alexStatement).toBeTruthy();
    // This walk added one more Alex deal in the REFER step, so in flight is 2 here.
    // The exact deck is asserted on a fresh register below.
    expect(alexStatement.numbers.dealsReferred).toBe(3);
    expect(alexStatement.numbers.settledThisMonth).toBe(2);
    expect(alexStatement.numbers.commsDue).toBe(1000);
    expect(alexStatement.numbers.paidYtd).toBe(3500);
    expect(alexStatement.numbers.inFlight).toBeGreaterThanOrEqual(1);
    expect(alexStatement.lines).toHaveLength(2);
    for (const line of alexStatement.lines) {
      expect(line.dealId).toBeTruthy();
      expect(line.ruleId).toBe('rule_demo_flat');
      expect(line.amount).toBe(500);
    }
    expect(alexStatement.anomalies.length).toBeGreaterThan(0);

    const issued = await h.request(`/api/statements/${alexStatement.id}/issue`, { body: {} });
    expect(issued.payload.statement.status).toBe('issued');
    expect(issued.payload.statement.productionSeconds).not.toBeNull();

    const paid = await h.request(`/api/statements/${alexStatement.id}/paid`, { body: {} });
    expect(paid.payload.statement.status).toBe('paid');

    const deal = await h.request(`/api/deals/${alexStatement.lines[0].dealId}`);
    expect(deal.payload.deal.referralComms.status).toBe('paid');
    expect(deal.payload.deal.referralComms.statementId).toBe(alexStatement.id);

    const reopen = await h.request(`/api/deals/${alexStatement.lines[0].dealId}/reopen`, { body: { reason: 'test' } });
    expect(reopen.status).toBe(409);
    expect(reopen.payload.error).toBe('on_issued_statement');
  });

  it('exports a statement without any loan figure', async () => {
    const list = await h.request('/api/statements');
    const target = list.payload.statements.find((s) => s.partnerId === 'p_alex' && s.period === lastMonth);
    const csv = await h.request(`/api/statements/${target.id}/export.csv`);
    expect(csv.status).toBe(200);
    expect(csv.payload).toContain('PARTNER PULSE referral commission statement');
    expect(csv.payload).toContain('Deal ref,Deal id,Client');
    for (const loan of ['585000', '430000', '600000']) {
      expect(csv.payload).not.toContain(loan);
    }
  });

  it('neutralises a spreadsheet formula in an exported cell', async () => {
    const deals = await h.request('/api/deals');
    const settled = deals.payload.deals.find((d) => d.referredBy === 'p_alex' && d.stage === 'settled');
    await h.request(`/api/deals/${settled.id}`, {
      method: 'PATCH',
      body: { propertyAddress: '=HYPERLINK("http://evil.example","click")' },
    });
    const csv = await h.request(`/api/statements/${(await h.request('/api/statements')).payload.statements[0].id}/export.csv`);
    expect(csv.payload).not.toMatch(/(^|,)"?=HYPERLINK/m);
    await h.request(`/api/deals/${settled.id}`, { method: 'PATCH', body: { propertyAddress: '1 Restored St, Lutwyche QLD 4030' } });
  });

  it('computes the metrics from the store', async () => {
    const metrics = await h.request('/api/metrics');
    expect(metrics.status).toBe(200);
    expect(metrics.payload.rows).toHaveLength(6);
    expect(metrics.payload.rows[0].current).toBeGreaterThan(0);
    expect(metrics.payload.production.count).toBeGreaterThanOrEqual(3);
    expect(metrics.payload.valueModel.perYear).toBe(46800);
    expect(metrics.payload.referrals.buckets).toHaveLength(12);
    expect(metrics.payload.aiStatus.enabled).toBe(false);
  });

  it('logs a where-is-my-deal enquiry against the metric', async () => {
    const before = (await h.request('/api/metrics')).payload.enquiries.total;
    const logged = await h.request('/api/deals/deal_taylor/enquiry', {
      body: { kind: 'where_is_my_deal', note: 'Alex called' },
    });
    expect(logged.status).toBe(200);
    const after = (await h.request('/api/metrics')).payload.enquiries.total;
    expect(after).toBe(before + 1);
  });
});

describe('the demo deck, on a fresh register', () => {
  it('shows Alex the five numbers: 3 / 2 / $1,000 / 1 / $3,500', async () => {
    const fresh = await makeApp();
    try {
      const period = previousMonthKey(monthKey(fresh.today));
      const generated = await fresh.request('/api/statements/generate', { body: { period } });
      const alex = generated.payload.statements.find((s) => s.partnerId === 'p_alex');
      expect(alex.numbers).toEqual({
        dealsReferred: 3,
        settledThisMonth: 2,
        commsDue: 1000,
        inFlight: 1,
        paidYtd: 3500,
      });
      expect(alex.total).toBe(1000);
    } finally {
      await fresh.close();
    }
  });
});

describe('the partner portal', () => {
  let h;
  let alex;

  beforeAll(async () => {
    h = await makeApp();
    const partners = await h.request('/api/partners');
    alex = partners.payload.partners.find((p) => p.id === 'p_alex');
  });
  afterAll(async () => { await h?.close(); });

  it('gives every partner a rotatable token of at least 32 characters', () => {
    expect(alex.portalToken.length).toBeGreaterThanOrEqual(32);
    expect(alex.scanToken.length).toBeGreaterThanOrEqual(32);
    expect(alex.portalToken).not.toBe(alex.scanToken);
  });

  it('MUST NEVER: expose a loan figure, a lender, contact details or notes', async () => {
    const portal = await h.request(`/api/portal/${alex.portalToken}`);
    expect(portal.status).toBe(200);
    expect(portal.payload.deals.length).toBeGreaterThan(0);

    const forbidden = ['loanAmount', 'lender', 'phone', 'email', 'notes', 'note', 'consent', 'referralComms', 'timeline', 'client'];
    const found = [];
    const walk = (node, path = '$') => {
      if (!node || typeof node !== 'object') return;
      if (Array.isArray(node)) { node.forEach((item, i) => walk(item, `${path}[${i}]`)); return; }
      for (const [key, value] of Object.entries(node)) {
        if (forbidden.includes(key)) found.push(`${path}.${key}`);
        walk(value, `${path}.${key}`);
      }
    };
    walk(portal.payload);
    expect(found).toEqual([]);

    const json = JSON.stringify(portal.payload);
    expect(json).not.toContain('600000');
    expect(json).not.toContain('Macquarie');
    expect(json).not.toContain('0412 884 019');
    expect(json).not.toContain('sam.taylor@example.com');
    expect(json).not.toContain('Sam & Jo Taylor');
    expect(json).toContain('S. & J. T.');
  });

  it('MUST NEVER: show another partner their deals', async () => {
    const partners = await h.request('/api/partners');
    const priya = partners.payload.partners.find((p) => p.id === 'p_priya');
    const alexPortal = await h.request(`/api/portal/${alex.portalToken}`);
    const priyaPortal = await h.request(`/api/portal/${priya.portalToken}`);
    const alexIds = new Set(alexPortal.payload.deals.map((d) => d.id));
    for (const deal of priyaPortal.payload.deals) {
      expect(alexIds.has(deal.id)).toBe(false);
    }
    expect(priyaPortal.payload.partner.name).toBe('Priya Example');
  });

  it('rotating the token kills the old link immediately', async () => {
    const before = await h.request(`/api/portal/${alex.portalToken}`);
    expect(before.status).toBe(200);
    const rotated = await h.request('/api/partners/p_alex/rotate-token', { body: {} });
    expect(rotated.payload.partner.portalToken).not.toBe(alex.portalToken);
    const after = await h.request(`/api/portal/${alex.portalToken}`);
    expect(after.status).toBe(404);
    const fresh = await h.request(`/api/portal/${rotated.payload.partner.portalToken}`);
    expect(fresh.status).toBe(200);
    alex = rotated.payload.partner;
  });

  it('takes a referral only when the buyer agreed to be contacted', async () => {
    const refused = await h.request(`/api/portal/${alex.portalToken}/refer`, {
      body: { buyerName: 'No Consent', buyerPhone: '0400 000 000' },
    });
    expect(refused.status).toBe(400);
    expect(refused.payload.error).toBe('consent_required');

    const accepted = await h.request(`/api/portal/${alex.portalToken}/refer`, {
      body: { buyerName: 'Keen Buyer', buyerPhone: '0400 000 111', consentToContact: true },
    });
    expect(accepted.status).toBe(200);
    expect(accepted.payload.message).toContain('Keen Buyer');
  });

  it('takes a pulse survey and rejects nonsense answers', async () => {
    const bad = await h.request(`/api/portal/${alex.portalToken}/survey`, { body: { answers: [9, 9, 9] } });
    expect(bad.status).toBe(400);
    const good = await h.request(`/api/portal/${alex.portalToken}/survey`, { body: { answers: [5, 4, 5], week: 3 } });
    expect(good.status).toBe(200);
    const metrics = await h.request('/api/metrics');
    expect(metrics.payload.verdict.week3.responses).toBeGreaterThan(0);
  });

  it('exposes nothing but a first name behind the open-home QR code', async () => {
    const scan = await h.request(`/api/scan/${alex.scanToken}`);
    expect(scan.status).toBe(200);
    expect(scan.payload).toEqual({
      partnerFirstName: 'Alex',
      agency: 'Sample Property',
      firm: 'Coronis Finance',
      broker: 'Nathan',
    });
    const usingPortalToken = await h.request(`/api/scan/${alex.portalToken}`);
    expect(usingPortalToken.status).toBe(404);
  });

  it('serves a QR png and a printable sign-in sheet', async () => {
    const qr = await fetch(`${h.baseUrl}/api/portal/${alex.portalToken}/qr.png`);
    expect(qr.status).toBe(200);
    expect(qr.headers.get('content-type')).toBe('image/png');
    const sheet = await h.request(`/api/portal/${alex.portalToken}/signin-sheet`);
    expect(sheet.status).toBe(200);
    expect(sheet.payload).toContain('Open home sign-in');
    expect(sheet.payload).not.toContain('600000');
  });

  it('refuses a made-up token', async () => {
    const res = await h.request('/api/portal/not-a-real-token-but-long-enough-to-try');
    expect(res.status).toBe(404);
  });
});

describe('auth and routing', () => {
  it('works with no passcode configured', async () => {
    const open = await makeApp();
    try {
      expect((await open.request('/api/deals')).status).toBe(200);
      expect((await open.request('/api/session')).payload.authEnabled).toBe(false);
    } finally {
      await open.close();
    }
  });

  it('locks the broker API behind a passcode and lets a good one in', async () => {
    const locked = await makeApp({ env: { PULSE_PASSCODE: 'correct-horse-battery' } });
    try {
      const blocked = await locked.request('/api/deals');
      expect(blocked.status).toBe(401);
      expect(blocked.payload.error).toBe('unauthorised');

      const bad = await locked.request('/api/login', { body: { passcode: 'wrong' } });
      expect(bad.status).toBe(401);
      expect(bad.payload.attemptsRemaining).toBe(4);

      const good = await locked.request('/api/login', { body: { passcode: 'correct-horse-battery' } });
      expect(good.status).toBe(200);
      expect(good.headers.getSetCookie().join(';')).toContain('HttpOnly');
      expect(good.headers.getSetCookie().join(';')).toContain('SameSite=Lax');

      const allowed = await locked.request('/api/deals');
      expect(allowed.status).toBe(200);

      await locked.request('/api/logout', { method: 'POST' });
      locked.clearCookies();
      expect((await locked.request('/api/deals')).status).toBe(401);
    } finally {
      await locked.close();
    }
  });

  it('locks an address out after five failures', async () => {
    const locked = await makeApp({ env: { PULSE_PASSCODE: 'a-good-passcode' } });
    try {
      for (let i = 0; i < 5; i += 1) {
        const res = await locked.request('/api/login', { body: { passcode: `wrong-${i}` } });
        expect(res.status).toBe(401);
      }
      const sixth = await locked.request('/api/login', { body: { passcode: 'a-good-passcode' } });
      expect(sixth.status).toBe(429);
      expect(sixth.payload.error).toBe('locked_out');
    } finally {
      await locked.close();
    }
  });

  it('leaves the portal and the health check public', async () => {
    const locked = await makeApp({ env: { PULSE_PASSCODE: 'a-good-passcode' } });
    try {
      expect((await locked.request('/api/health')).status).toBe(200);
      const data = locked.store.read();
      const token = data.partners[0].portalToken;
      expect((await locked.request(`/api/portal/${token}`)).status).toBe(200);
    } finally {
      await locked.close();
    }
  });

  it('routes case sensitively so /API cannot slip past the guard', async () => {
    const locked = await makeApp({ env: { PULSE_PASSCODE: 'a-good-passcode' } });
    try {
      for (const path of ['/API/deals', '/Api/deals', '/API/health']) {
        const res = await fetch(`${locked.baseUrl}${path}`);
        expect(res.status, path).toBe(404);
      }
    } finally {
      await locked.close();
    }
  });

  it('rate limits the public referral form', async () => {
    const limited = await makeApp({ env: { PULSE_FORM_MAX_PER_WINDOW: '2' } });
    try {
      const token = limited.store.read().partners[0].scanToken;
      const body = { buyerName: 'Buyer', buyerPhone: '0400 000 222', consentToContact: true };
      expect((await limited.request(`/api/scan/${token}/refer`, { body })).status).toBe(200);
      expect((await limited.request(`/api/scan/${token}/refer`, { body })).status).toBe(200);
      const third = await limited.request(`/api/scan/${token}/refer`, { body });
      expect(third.status).toBe(429);
      expect(third.payload.error).toBe('rate_limited');
    } finally {
      await limited.close();
    }
  });

  it('caps the public form for the whole day', async () => {
    const capped = await makeApp({ env: { PULSE_FORM_MAX_PER_DAY: '1', PULSE_FORM_MAX_PER_WINDOW: '50' } });
    try {
      const token = capped.store.read().partners[0].scanToken;
      const body = { buyerName: 'Buyer', buyerPhone: '0400 000 333', consentToContact: true };
      expect((await capped.request(`/api/scan/${token}/refer`, { body })).status).toBe(200);
      const second = await capped.request(`/api/scan/${token}/refer`, { body });
      expect(second.status).toBe(429);
      expect(second.payload.error).toBe('daily_cap');
    } finally {
      await capped.close();
    }
  });

  it('warns about a weak passcode and a missing public URL, once signed in', async () => {
    const weak = await makeApp({ env: { PULSE_PASSCODE: 'demo' } });
    try {
      // A stranger gets liveness only: no counts, no warnings, no store path.
      const anonymous = await weak.request('/api/health');
      expect(anonymous.status).toBe(200);
      expect(anonymous.payload.signedIn).toBe(false);
      expect(anonymous.payload.counts).toBeUndefined();
      expect(anonymous.payload.warnings).toBeUndefined();
      expect(anonymous.payload.store).toBeUndefined();

      await weak.request('/api/login', { body: { passcode: 'demo' } });
      const health = await weak.request('/api/health');
      expect(health.payload.signedIn).toBe(true);
      expect(health.payload.warnings.join(' ')).toMatch(/well-known value/);
      expect(health.payload.warnings.join(' ')).toMatch(/PULSE_PUBLIC_URL/);
    } finally {
      await weak.close();
    }
  });

  it('refuses to move the referrer on a deal that sits on an issued statement', async () => {
    const h = await makeApp();
    try {
      const period = previousMonthKey(monthKey(h.today));
      const generated = await h.request('/api/statements/generate', { body: { period } });
      const statement = generated.payload.statements.find((s) => s.partnerId === 'p_alex');
      await h.request(`/api/statements/${statement.id}/issue`, { body: {} });
      const dealId = statement.lines[0].dealId;

      const moved = await h.request(`/api/deals/${dealId}`, { method: 'PATCH', body: { referredBy: 'p_priya' } });
      expect(moved.status).toBe(409);
      expect(moved.payload.error).toBe('locked');

      const amount = await h.request(`/api/deals/${dealId}`, { method: 'PATCH', body: { loanAmount: 999999 } });
      expect(amount.status).toBe(409);
    } finally {
      await h.close();
    }
  });

  it('never crashes on bad input', async () => {
    const h = await makeApp();
    try {
      const badJson = await fetch(`${h.baseUrl}/api/deals`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{not json',
      });
      expect(badJson.status).toBe(400);

      expect((await h.request('/api/deals/does-not-exist')).status).toBe(404);
      expect((await h.request('/api/nope')).status).toBe(404);
      expect((await h.request('/api/statements/generate', { body: { period: 'banana' } })).status).toBe(400);
      expect((await h.request('/api/deals/deal_taylor/stage', { body: { stage: 'banana' } })).status).toBe(400);
      expect((await h.request('/api/handover/extract', { body: {} })).status).toBe(400);
      expect((await h.request('/api/deals', { body: { record: { clientName: 'x'.repeat(5000) } } })).status).toBe(201);
      expect((await h.request('/api/deals/deal_taylor/notes', { body: { text: '   ' } })).status).toBe(400);
    } finally {
      await h.close();
    }
  });
});

describe('reopening a settled deal', () => {
  let h;
  beforeAll(async () => { h = await makeApp(); });
  afterAll(async () => { await h?.close(); });

  it('removes the deal from a draft statement and clears the commission', async () => {
    const lastMonth = previousMonthKey(monthKey(h.today));
    const generated = await h.request('/api/statements/generate', { body: { period: lastMonth } });
    const statement = generated.payload.statements.find((s) => s.partnerId === 'p_alex');
    expect(statement.lines).toHaveLength(2);
    const dealId = statement.lines[0].dealId;

    const reopened = await h.request(`/api/deals/${dealId}/reopen`, { body: { reason: 'settlement was rebooked' } });
    expect(reopened.status).toBe(200);
    expect(reopened.payload.deal.stage).toBe('formal');
    expect(reopened.payload.deal.keyDates.settledAt).toBeNull();
    expect(reopened.payload.deal.referralComms.amount).toBeNull();
    expect(reopened.payload.deal.referralComms.status).toBe('pending');
    expect(reopened.payload.removedFromStatements).toContain(statement.id);

    const after = await h.request(`/api/statements/${statement.id}`);
    expect(after.payload.statement.lines).toHaveLength(1);
    expect(after.payload.statement.total).toBe(500);
  });

  it('re-checks at issue so a stale draft cannot be issued with a dead line', async () => {
    const lastMonth = previousMonthKey(monthKey(h.today));
    const list = await h.request('/api/statements');
    const statement = list.payload.statements.find((s) => s.partnerId === 'p_alex' && s.period === lastMonth);
    const issued = await h.request(`/api/statements/${statement.id}/issue`, { body: {} });
    expect(issued.status).toBe(200);
    expect(issued.payload.statement.lines).toHaveLength(1);
    expect(issued.payload.statement.total).toBe(500);
  });

  it('voids a statement and puts the commission back to due', async () => {
    const list = await h.request('/api/statements');
    const statement = list.payload.statements.find((s) => s.status === 'issued');
    const voided = await h.request(`/api/statements/${statement.id}/void`, { body: { reason: 'wrong period' } });
    expect(voided.payload.statement.status).toBe('void');
    const deal = await h.request(`/api/deals/${statement.lines?.[0]?.dealId || voided.payload.statement.lines[0].dealId}`);
    expect(deal.payload.deal.referralComms.status).toBe('due');
    expect(deal.payload.deal.referralComms.statementId).toBeNull();
  });

  it('shows a draft the live numbers and freezes them at issue', async () => {
    const fresh = await makeApp();
    try {
      const period = previousMonthKey(monthKey(fresh.today));
      const generated = await fresh.request('/api/statements/generate', { body: { period } });
      const id = generated.payload.statements.find((s) => s.partnerId === 'p_alex').id;

      const asDraft = await fresh.request(`/api/statements/${id}`);
      expect(asDraft.payload.statement.numbers.inFlight).toBe(1);

      // another Alex referral arrives while the statement is still a draft
      await fresh.request('/api/handover/commit', {
        body: {
          record: { clientName: 'Late Arrival', broker: 'Nathan', referredBy: 'p_alex', purpose: 'purchase', loanAmount: 500000, propertyAddress: '9 New St, Lutwyche QLD 4030' },
          consent: { shareStatus: false, feeDisclosed: false },
          channel: 'manual',
        },
      });
      const stillDraft = await fresh.request(`/api/statements/${id}`);
      expect(stillDraft.payload.statement.numbers.inFlight).toBe(2);

      await fresh.request(`/api/statements/${id}/issue`, { body: {} });
      const issued = await fresh.request(`/api/statements/${id}`);
      expect(issued.payload.statement.numbers.inFlight).toBe(2);

      // a later arrival does not move an issued statement's numbers
      await fresh.request('/api/handover/commit', {
        body: {
          record: { clientName: 'Even Later', broker: 'Nathan', referredBy: 'p_alex', purpose: 'purchase', loanAmount: 400000, propertyAddress: '11 New St, Lutwyche QLD 4030' },
          consent: { shareStatus: false, feeDisclosed: false },
          channel: 'manual',
        },
      });
      const frozen = await fresh.request(`/api/statements/${id}`);
      expect(frozen.payload.statement.numbers.inFlight).toBe(2);
    } finally {
      await fresh.close();
    }
  });

  it('refuses to void without a reason', async () => {
    const list = await h.request('/api/statements');
    const any = list.payload.statements[0];
    const res = await h.request(`/api/statements/${any.id}/void`, { body: {} });
    expect(res.status).toBe(400);
    expect(res.payload.error).toBe('missing_reason');
  });
});
