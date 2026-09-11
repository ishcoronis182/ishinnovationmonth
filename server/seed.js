// The demo deck. Everything is fictional and every date is derived from today,
// so the seed never goes stale.

import { addDays, monthKey, monthRange, previousMonthKey, monthLabel, nextSaturday, todayISO } from '../shared/dates.js';
import { normaliseDeal, ragForDeal, clientLabel } from '../shared/record.js';
import { buildStatement } from '../shared/commission.js';
import { buildUpdateContext, draftUpdate } from '../shared/templates.js';
import { emptyData } from './store.js';
import { portalToken, randomId, nextRef } from './ids.js';

function stampFor(dateISO, hour = 9, minute = 12) {
  return `${dateISO}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00.000Z`;
}

function dayInMonth(key, day, maxISO) {
  const range = monthRange(key);
  if (!range) return maxISO;
  const target = `${key}-${String(day).padStart(2, '0')}`;
  const clamped = target > range.end ? range.end : target;
  return maxISO && clamped > maxISO ? maxISO : clamped;
}

/** Two history months for the already-paid statements, kept inside this year. */
function historyMonths(today) {
  const year = today.slice(0, 4);
  const lastMonth = previousMonthKey(monthKey(today));
  let a = previousMonthKey(lastMonth);
  let b = previousMonthKey(a);
  if (!a.startsWith(year)) a = `${year}-01`;
  if (!b.startsWith(year) || b >= a) b = a;
  return { a, b, lastMonth };
}

function makeDeal(input, { today, tz, refCounter, createdAt, events = [] }) {
  const deal = normaliseDeal(input, { today, tz });
  deal.id = input.id || randomId('deal', 10);
  deal.ref = input.ref || nextRef(refCounter, 'PP');
  deal.createdAt = createdAt;
  deal.updatedAt = createdAt;
  const lastStageEvent = [...events].reverse().find((e) => e.type === 'stage_changed');
  deal.stageEnteredAt = input.stageEnteredAt || lastStageEvent?.at || createdAt;
  deal.updatedAt = lastStageEvent?.at || createdAt;
  const rag = ragForDeal(deal);
  deal.rag = rag.rag;
  deal.arrivalRag = input.arrivalRag || rag.rag;
  deal.timeline = [
    {
      id: randomId('ev', 8),
      at: createdAt,
      type: 'created',
      actor: 'broker',
      message: `Record created from a ${deal.channel} handover. ${deal.arrivalRag.toUpperCase()} on arrival${rag.missing.length ? `: missing ${rag.missing.join(', ')}` : ''}.`,
      meta: { arrivalRag: deal.arrivalRag, missing: rag.missing, provider: deal.aiProvider },
    },
    ...events,
  ];
  return deal;
}

function stageEvent(at, from, to, extra = {}) {
  return {
    id: randomId('ev', 8),
    at,
    type: 'stage_changed',
    actor: 'broker',
    message: `Stage ${from} -> ${to}`,
    meta: { from, to, ...extra },
  };
}

function commissionEvent(at, amount, ruleName) {
  return {
    id: randomId('ev', 8),
    at,
    type: 'commission_computed',
    actor: 'system',
    message: `Referral commission $${amount} (flat per settled referred loan) under rule ${ruleName}.`,
    meta: { amount },
  };
}

/**
 * @param {{config: object, today?: string, now?: string}} opts
 */
export function buildSeed(opts = {}) {
  const config = opts.config;
  const tz = config?.tz || 'Australia/Brisbane';
  const today = opts.today || todayISO(tz);
  const now = opts.now || stampFor(today, 22, 30);
  const firm = {
    name: config?.firm?.name || 'Coronis Finance',
    broker: config?.firm?.broker || 'Nathan',
    office: config?.firm?.office || 'Coronis Lutwyche',
  };
  const brokerName = firm.broker;
  const data = emptyData({ firm, tz });
  data.seededAt = now;

  const { a: monthA, b: monthB, lastMonth } = historyMonths(today);
  const saturday = nextSaturday(today);
  const yesterday = addDays(today, -1);
  const ruleEffectiveFrom = `${today.slice(0, 4)}-01-01`;

  data.rules = [{
    id: 'rule_demo_flat',
    name: 'Demo rule - $500 per settled referral',
    scope: 'global',
    partnerId: null,
    type: 'flat',
    flatAmount: 500,
    bps: null,
    sharePct: null,
    upfrontBps: 65,
    tiers: [],
    effectiveFrom: ruleEffectiveFrom,
    active: true,
    note: 'Placeholder until the referral agreement is confirmed.',
    createdAt: stampFor(ruleEffectiveFrom, 8, 0),
  }];

  const partners = [
    {
      id: 'p_alex',
      name: 'Alex Sample',
      agency: 'Sample Property',
      office: 'Coronis Lutwyche',
      phone: '0412 555 178',
      email: 'alex@sampleproperty.example',
      portalToken: portalToken(),
      scanToken: portalToken(),
      tokenRotatedAt: stampFor(addDays(today, -40), 9, 0),
      createdAt: stampFor(addDays(today, -180), 9, 0),
      openHomes: [
        { id: randomId('oh', 6), address: '11 Kookaburra St, Lutwyche', date: saturday, time: '9:00am' },
        { id: randomId('oh', 6), address: '3/58 Rose Pde, Wooloowin', date: saturday, time: '10:00am' },
        { id: randomId('oh', 6), address: '204 Kedron Park Rd, Wooloowin', date: saturday, time: '11:00am' },
        { id: randomId('oh', 6), address: '7 Bellbird St, Lutwyche', date: saturday, time: '12:00pm' },
      ],
    },
    {
      id: 'p_priya',
      name: 'Priya Example',
      agency: 'Example Realty',
      office: 'Coronis Lutwyche',
      phone: '0413 555 902',
      email: 'priya@examplerealty.example',
      portalToken: portalToken(),
      scanToken: portalToken(),
      tokenRotatedAt: stampFor(addDays(today, -30), 9, 0),
      createdAt: stampFor(addDays(today, -120), 9, 0),
      openHomes: [
        { id: randomId('oh', 6), address: '19 Wattlebird Cres, Lutwyche', date: saturday, time: '9:30am' },
      ],
    },
    {
      id: 'p_jordan',
      name: 'Jordan Placeholder',
      agency: 'Placeholder Real Estate',
      office: 'Coronis Windsor',
      phone: '0414 555 336',
      email: 'jordan@placeholderre.example',
      portalToken: portalToken(),
      scanToken: portalToken(),
      tokenRotatedAt: stampFor(addDays(today, -20), 9, 0),
      createdAt: stampFor(addDays(today, -90), 9, 0),
      openHomes: [],
    },
  ];
  data.partners = partners;

  let refCounter = 1;
  const nextCounter = () => refCounter++;
  const deals = [];

  // --- Alex: seven older settled referrals, already paid this year -----------
  const paidGroups = [
    {
      month: monthB,
      clients: [
        { name: 'Harriet Brown', address: '5 Magpie St, Windsor QLD 4030', loan: 480000, lender: 'ANZ' },
        { name: 'Owen Fields', address: '22 Lorikeet Ave, Lutwyche QLD 4030', loan: 615000, lender: 'Macquarie' },
        { name: 'Georgia Reid', address: '9/14 Rosella Rd, Wooloowin QLD 4030', loan: 395000, lender: 'ING', duplicateDemo: true },
      ],
    },
    {
      month: monthA,
      clients: [
        { name: 'Marcus Webb', address: '31 Currawong St, Kedron QLD 4031', loan: 720000, lender: 'Westpac' },
        { name: 'Tia Rowe', address: '6 Finch Ct, Lutwyche QLD 4030', loan: 505000, lender: 'Suncorp' },
        { name: 'Elliot Hale', address: '88 Kingfisher Pde, Windsor QLD 4030', loan: 660000, lender: 'Macquarie' },
        { name: 'Nadia Frost', address: '17 Heron St, Wooloowin QLD 4030', loan: 545000, lender: 'Bendigo Bank' },
      ],
    },
  ];

  const paidStatements = [];
  for (const group of paidGroups) {
    const groupDeals = [];
    group.clients.forEach((client, index) => {
      const settledAt = dayInMonth(group.month, 8 + index * 5, addDays(today, -35));
      const referredAt = addDays(settledAt, -42);
      const createdAt = stampFor(referredAt, 8, 40 + index);
      const paidAt = dayInMonth(previousMonthKey(monthKey(addDays(settledAt, 45))) === group.month
        ? monthKey(addDays(settledAt, 45))
        : monthKey(addDays(settledAt, 45)), 15, addDays(today, -10));
      const statementId = `st_${group.month.replace('-', '')}_alex`;
      const deal = makeDeal({
        clientName: client.name,
        clientPhone: '0412 900 111',
        clientEmail: `${client.name.split(' ')[0].toLowerCase()}@example.com`,
        broker: brokerName,
        referredBy: 'p_alex',
        referredByName: 'Alex Sample',
        stage: 'settled',
        purpose: 'purchase',
        loanAmount: client.loan,
        lender: client.lender,
        propertyAddress: client.address,
        keyDates: {
          contract: addDays(settledAt, -40),
          financeDue: addDays(settledAt, -26),
          settlementDue: settledAt,
          settledAt,
        },
        referredAt,
        channel: 'email',
        consent: {
          shareStatus: true,
          shareStatusAt: createdAt,
          shareStatusEvidence: 'happy for us to keep Alex posted on where it is at',
          feeDisclosed: true,
          feeDisclosedAt: createdAt,
          feeDisclosedEvidence: 'referral fee disclosed at the first appointment',
        },
        referralComms: {
          ruleId: 'rule_demo_flat',
          ruleName: data.rules[0].name,
          amount: 500,
          status: 'paid',
          statementId,
          paidAt,
        },
        updateCount: 3,
        lastUpdateAt: stampFor(settledAt, 10, 5),
        aiProvider: 'heuristic',
        summary: client.duplicateDemo
          ? 'Deliberate duplicate client name, so the statement duplicate-client check has something to flag.'
          : null,
        ref: nextRef(nextCounter(), 'PP'),
      }, {
        today,
        tz,
        createdAt,
        events: [
          stageEvent(stampFor(addDays(referredAt, 6), 9, 10), 'Referred', 'Lodged'),
          stageEvent(stampFor(addDays(settledAt, -20), 11, 0), 'Lodged', 'Formal approval'),
          stageEvent(stampFor(settledAt, 15, 30), 'Formal approval', 'Settled'),
          commissionEvent(stampFor(settledAt, 15, 31), 500, data.rules[0].name),
        ],
      });
      groupDeals.push(deal);
      deals.push(deal);
    });

    const statement = buildStatement({
      partner: partners[0],
      deals: groupDeals.map((d) => ({ ...d, referralComms: { ...d.referralComms, status: 'due' } })),
      rules: data.rules,
      period: group.month,
      today,
      statements: [],
      id: `st_${group.month.replace('-', '')}_alex`,
      createdAt: stampFor(dayInMonth(monthKey(addDays(monthRange(group.month).end, 3)), 3, addDays(today, -20)), 9, 0),
    });
    const issuedAt = stampFor(dayInMonth(monthKey(addDays(monthRange(group.month).end, 3)), 3, addDays(today, -20)), 9, 52);
    statement.status = 'paid';
    statement.issuedAt = issuedAt;
    statement.paidAt = stampFor(dayInMonth(monthKey(addDays(monthRange(group.month).end, 14)), 15, addDays(today, -8)), 14, 0);
    statement.productionSeconds = 3120 + groupDeals.length * 60;
    statement.coverNote = `Hi Alex, here's your referral statement for ${monthLabel(group.month)}. ${groupDeals.length} of your referrals settled this period and $${groupDeals.length * 500} is due to you. Thanks again - ${brokerName}, ${firm.name}`;
    statement.coverNoteProvider = 'template';
    statement.history = [
      { at: statement.createdAt, type: 'generated', message: `Generated for ${monthLabel(group.month)}` },
      { at: issuedAt, type: 'issued', message: 'Issued to the partner' },
      { at: statement.paidAt, type: 'paid', message: 'Marked paid' },
    ];
    paidStatements.push(statement);
  }

  // --- Alex: two settled last month, commission due -------------------------
  const dueClients = [
    { name: 'Georgia Reid', address: '14 Peewee St, Lutwyche QLD 4030', loan: 585000, lender: 'Macquarie', day: 6 },
    { name: 'Liam Cortez', address: '2/40 Butcherbird Rd, Windsor QLD 4030', loan: 430000, lender: 'ING', day: 24, feeDisclosed: false },
  ];
  for (const client of dueClients) {
    const settledAt = dayInMonth(lastMonth, client.day, addDays(today, -2));
    const referredAt = dayInMonth(lastMonth, Math.max(1, client.day - 9), addDays(today, -3));
    const createdAt = stampFor(referredAt, 8, 30);
    const deal = makeDeal({
      clientName: client.name,
      clientPhone: '0412 700 233',
      clientEmail: `${client.name.split(' ')[0].toLowerCase()}@example.com`,
      broker: brokerName,
      referredBy: 'p_alex',
      referredByName: 'Alex Sample',
      stage: 'settled',
      purpose: 'purchase',
      loanAmount: client.loan,
      lender: client.lender,
      propertyAddress: client.address,
      keyDates: {
        contract: addDays(settledAt, -34),
        financeDue: addDays(settledAt, -20),
        settlementDue: settledAt,
        settledAt,
      },
      referredAt,
      channel: 'email',
      consent: {
        shareStatus: true,
        shareStatusAt: createdAt,
        shareStatusEvidence: 'client is happy for us to share progress with the agent',
        feeDisclosed: client.feeDisclosed !== false,
        feeDisclosedAt: client.feeDisclosed === false ? null : createdAt,
        feeDisclosedEvidence: client.feeDisclosed === false ? null : 'referral fee disclosed in the first meeting',
      },
      referralComms: {
        ruleId: 'rule_demo_flat',
        ruleName: data.rules[0].name,
        amount: 500,
        status: 'due',
        statementId: null,
        paidAt: null,
      },
      updateCount: 4,
      lastUpdateAt: stampFor(settledAt, 16, 20),
      aiProvider: 'heuristic',
      ref: nextRef(nextCounter(), 'PP'),
    }, {
      today,
      tz,
      createdAt,
      events: [
        stageEvent(stampFor(addDays(referredAt, 4), 9, 30), 'Referred', 'Lodged'),
        stageEvent(stampFor(addDays(settledAt, -14), 10, 15), 'Lodged', 'Formal approval'),
        stageEvent(stampFor(settledAt, 15, 45), 'Formal approval', 'Settled'),
        commissionEvent(stampFor(settledAt, 15, 46), 500, data.rules[0].name),
      ],
    });
    deals.push(deal);
  }

  // --- Alex: the live one, formal approval, 42 Wattlebird Cres ---------------
  const taylorReferredAt = dayInMonth(lastMonth, 20, addDays(today, -12));
  const taylorCreatedAt = stampFor(taylorReferredAt, 8, 15);
  const taylorSettlement = addDays(today, 35);
  const taylorDeal = makeDeal({
    id: 'deal_taylor',
    ref: nextRef(nextCounter(), 'PP'),
    clientName: 'Sam & Jo Taylor',
    clientPhone: '0412 884 019',
    clientEmail: 'sam.taylor@example.com',
    broker: brokerName,
    referredBy: 'p_alex',
    referredByName: 'Alex Sample',
    stage: 'formal',
    purpose: 'purchase',
    loanAmount: 600000,
    lender: 'Macquarie',
    propertyAddress: '42 Wattlebird Cres, Lutwyche QLD 4030',
    keyDates: {
      contract: addDays(today, -21),
      financeDue: addDays(today, 4),
      settlementDue: taylorSettlement,
    },
    referredAt: taylorReferredAt,
    channel: 'email',
    consent: {
      shareStatus: true,
      shareStatusAt: taylorCreatedAt,
      shareStatusEvidence: 'Sam and Jo are happy for us to keep Alex in the loop on progress',
      feeDisclosed: true,
      feeDisclosedAt: taylorCreatedAt,
      feeDisclosedEvidence: 'referral fee disclosed and noted on the file',
    },
    referralComms: { ruleId: null, ruleName: null, amount: null, status: 'pending', statementId: null, paidAt: null },
    updateCount: 2,
    lastUpdateAt: stampFor(addDays(today, -3), 9, 5),
    aiProvider: 'heuristic',
    summary: 'Sam & Jo T., purchase, for 42 Wattlebird Cres, loan 600k, with Macquarie',
  }, {
    today,
    tz,
    createdAt: taylorCreatedAt,
    events: [
      stageEvent(stampFor(addDays(taylorReferredAt, 3), 10, 0), 'Referred', 'Application'),
      stageEvent(stampFor(addDays(today, -14), 11, 20), 'Application', 'Lodged'),
      stageEvent(stampFor(addDays(today, -3), 9, 0), 'Lodged', 'Conditional approval'),
      stageEvent(stampFor(today, 8, 45), 'Conditional approval', 'Formal approval'),
    ],
  });
  deals.push(taylorDeal);

  // --- Priya: one lodged, one amber application -----------------------------
  const priyaLodgedReferred = addDays(today, -18);
  const priyaLodged = makeDeal({
    ref: nextRef(nextCounter(), 'PP'),
    clientName: 'Dev Anand',
    clientPhone: '0431 220 884',
    clientEmail: 'dev.anand@example.com',
    broker: brokerName,
    referredBy: 'p_priya',
    referredByName: 'Priya Example',
    stage: 'lodged',
    purpose: 'purchase',
    loanAmount: 545000,
    lender: 'Suncorp',
    propertyAddress: '63 Tawny Frogmouth Dr, Kedron QLD 4031',
    keyDates: {
      contract: addDays(today, -16),
      financeDue: addDays(today, 9),
      settlementDue: addDays(today, 30),
    },
    referredAt: priyaLodgedReferred,
    channel: 'notes',
    consent: {
      shareStatus: true,
      shareStatusAt: stampFor(priyaLodgedReferred, 9, 0),
      shareStatusEvidence: 'ok to update the agent on where it is up to',
      feeDisclosed: true,
      feeDisclosedAt: stampFor(priyaLodgedReferred, 9, 0),
      feeDisclosedEvidence: 'referral fee disclosed at the appointment',
    },
    updateCount: 1,
    lastUpdateAt: stampFor(addDays(today, -11), 10, 0),
    aiProvider: 'heuristic',
  }, {
    today,
    tz,
    createdAt: stampFor(priyaLodgedReferred, 8, 55),
    events: [
      stageEvent(stampFor(addDays(today, -15), 9, 40), 'Referred', 'Application'),
      stageEvent(stampFor(addDays(today, -11), 9, 50), 'Application', 'Lodged'),
    ],
  });
  deals.push(priyaLodged);

  const priyaAmberReferred = addDays(today, -6);
  const priyaAmber = makeDeal({
    ref: nextRef(nextCounter(), 'PP'),
    clientName: 'Mei Lin',
    broker: brokerName,
    referredBy: 'p_priya',
    referredByName: 'Priya Example',
    stage: 'application',
    purpose: 'refinance',
    loanAmount: 410000,
    propertyAddress: '8 Butcherbird Rd, Windsor QLD 4030',
    referredAt: priyaAmberReferred,
    channel: 'voice',
    consent: {
      shareStatus: true,
      shareStatusAt: stampFor(priyaAmberReferred, 9, 0),
      shareStatusEvidence: 'she is fine with us telling Priya how it is tracking',
      feeDisclosed: false,
    },
    aiProvider: 'heuristic',
  }, {
    today,
    tz,
    createdAt: stampFor(priyaAmberReferred, 15, 20),
    events: [stageEvent(stampFor(addDays(today, -4), 9, 15), 'Referred', 'Application')],
  });
  deals.push(priyaAmber);

  // --- Jordan: conditional approval, consent NOT given (the gate) -----------
  const jordanReferred = addDays(today, -13);
  const jordanDeal = makeDeal({
    ref: nextRef(nextCounter(), 'PP'),
    clientName: 'Bianca Nguyen',
    clientPhone: '0431 552 004',
    clientEmail: 'bianca.nguyen@example.com',
    broker: brokerName,
    referredBy: 'p_jordan',
    referredByName: 'Jordan Placeholder',
    stage: 'conditional',
    purpose: 'refinance',
    loanAmount: 620000,
    lender: 'Suncorp',
    propertyAddress: '7 Kookaburra Tce, Wooloowin QLD 4030',
    keyDates: { settlementDue: addDays(today, 26) },
    referredAt: jordanReferred,
    channel: 'voice',
    consent: { shareStatus: false, feeDisclosed: true, feeDisclosedAt: stampFor(jordanReferred, 9, 0), feeDisclosedEvidence: 'referral fee disclosed on the call' },
    aiProvider: 'heuristic',
  }, {
    today,
    tz,
    createdAt: stampFor(jordanReferred, 16, 5),
    events: [
      stageEvent(stampFor(addDays(today, -10), 9, 25), 'Referred', 'Lodged'),
      stageEvent(stampFor(addDays(today, -3), 14, 10), 'Lodged', 'Conditional approval'),
    ],
  });
  deals.push(jordanDeal);

  // --- Two direct deals, one red on arrival ---------------------------------
  const directGreen = makeDeal({
    ref: nextRef(nextCounter(), 'PP'),
    clientName: 'Ruth Calder',
    clientPhone: '0407 118 552',
    clientEmail: 'ruth.calder@example.com',
    broker: brokerName,
    referredBy: 'direct',
    stage: 'lodged',
    purpose: 'refinance',
    loanAmount: 375000,
    lender: 'ANZ',
    propertyAddress: '12 Grevillea St, Windsor QLD 4030',
    keyDates: { settlementDue: addDays(today, 21) },
    referredAt: addDays(today, -9),
    channel: 'email',
    consent: { shareStatus: false, feeDisclosed: false },
    aiProvider: 'heuristic',
  }, {
    today,
    tz,
    createdAt: stampFor(addDays(today, -9), 11, 30),
    events: [stageEvent(stampFor(addDays(today, -7), 9, 5), 'Referred', 'Lodged')],
  });
  deals.push(directGreen);

  const directRed = makeDeal({
    ref: nextRef(nextCounter(), 'PP'),
    clientName: 'Tomas and Mel',
    broker: brokerName,
    referredBy: null,
    stage: 'referred',
    purpose: null,
    loanAmount: 500000,
    channel: 'notes',
    referredAt: addDays(today, -2),
    arrivalRag: 'red',
    aiProvider: 'heuristic',
    questions: [
      'Who are the clients on this one, as they appear on the application?',
      'Who referred this one - which agent, or was it direct?',
      'Is this a purchase, refinance, investment, construction or pre-approval?',
    ],
    summary: 'New handover, loan 500k',
    consent: { shareStatus: false, feeDisclosed: false },
  }, {
    today,
    tz,
    createdAt: stampFor(addDays(today, -2), 8, 5),
  });
  deals.push(directRed);

  // --- One settled with no referrer recorded: a register anomaly ------------
  const orphanSettled = dayInMonth(lastMonth, 18, addDays(today, -4));
  const orphan = makeDeal({
    ref: nextRef(nextCounter(), 'PP'),
    clientName: 'Peter Vasquez',
    clientPhone: '0417 664 210',
    clientEmail: 'peter.vasquez@example.com',
    broker: brokerName,
    referredBy: null,
    stage: 'settled',
    purpose: 'purchase',
    loanAmount: 460000,
    lender: 'Westpac',
    propertyAddress: '25 Ibis St, Kedron QLD 4031',
    keyDates: {
      contract: addDays(orphanSettled, -38),
      financeDue: addDays(orphanSettled, -24),
      settlementDue: orphanSettled,
      settledAt: orphanSettled,
    },
    referredAt: addDays(orphanSettled, -45),
    channel: 'notes',
    arrivalRag: 'red',
    consent: { shareStatus: false, feeDisclosed: false },
    aiProvider: 'heuristic',
  }, {
    today,
    tz,
    createdAt: stampFor(addDays(orphanSettled, -45), 12, 0),
    events: [
      stageEvent(stampFor(addDays(orphanSettled, -30), 9, 0), 'Referred', 'Lodged'),
      stageEvent(stampFor(orphanSettled, 15, 0), 'Lodged', 'Settled'),
    ],
  });
  deals.push(orphan);

  data.deals = deals;
  data.counters = { deal: refCounter, statement: paidStatements.length + 1, message: 1, partner: partners.length + 1 };

  // --- Sent updates ---------------------------------------------------------
  const messages = [];
  const pushUpdate = ({ deal, partner, stage, eventDate, at, channels = ['sms', 'email'] }) => {
    const context = buildUpdateContext({
      deal: { ...deal, stage },
      partner,
      firm: firm.name,
      broker: brokerName,
      today: eventDate,
      eventDate,
      stage,
    });
    const draft = draftUpdate(context);
    messages.push({
      id: randomId('msg', 8),
      kind: 'update',
      status: 'sent',
      createdAt: at,
      sentAt: at,
      dealId: deal.id,
      dealRef: deal.ref,
      partnerId: partner.id,
      partnerName: partner.name,
      stage,
      eventDate,
      channels,
      smsBody: draft.sms,
      emailSubject: draft.email.subject,
      emailBody: draft.email.body,
      provider: 'template',
      deliveries: channels.map((channel) => ({
        channel,
        ok: true,
        provider: 'log',
        at,
        to: channel === 'sms' ? partner.phone : partner.email,
      })),
      compliance: { ok: true, blocked: [], warnings: [] },
    });
  };

  pushUpdate({ deal: taylorDeal, partner: partners[0], stage: 'lodged', eventDate: addDays(today, -14), at: stampFor(addDays(today, -14), 11, 25) });
  pushUpdate({ deal: taylorDeal, partner: partners[0], stage: 'conditional', eventDate: addDays(today, -3), at: stampFor(addDays(today, -3), 9, 5) });
  pushUpdate({ deal: priyaLodged, partner: partners[1], stage: 'lodged', eventDate: addDays(today, -11), at: stampFor(addDays(today, -11), 10, 0) });
  for (const deal of deals.filter((d) => d.referredBy === 'p_alex' && d.stage === 'settled')) {
    const settledAt = deal.keyDates.settledAt;
    pushUpdate({ deal, partner: partners[0], stage: 'settled', eventDate: settledAt, at: stampFor(settledAt, 16, 10) });
  }
  data.messages = messages;

  // --- Statements -----------------------------------------------------------
  data.statements = paidStatements;

  // --- Enquiries (the baseline the metric is trying to kill) ---------------
  const enquiries = [
    { id: randomId('enq', 8), at: stampFor(addDays(today, -3), 9, 15), kind: 'where_is_my_deal', partnerId: 'p_jordan', dealId: jordanDeal.id, note: 'Jordan rang asking where the Nguyen refinance is at.' },
    { id: randomId('enq', 8), at: stampFor(addDays(today, -6), 14, 40), kind: 'where_is_my_comm', partnerId: 'p_alex', dealId: null, note: 'Alex asked when last month\'s referrals get paid.' },
    { id: randomId('enq', 8), at: stampFor(addDays(today, -9), 10, 5), kind: 'where_is_my_deal', partnerId: 'p_priya', dealId: priyaAmber.id, note: 'Priya chased the Lin refinance.' },
    { id: randomId('enq', 8), at: stampFor(addDays(today, -16), 11, 0), kind: 'where_is_my_comm', partnerId: 'p_alex', dealId: null, note: 'Alex asked for a statement he could check.' },
  ];
  data.enquiries = enquiries;
  for (const enquiry of enquiries) {
    if (!enquiry.dealId) continue;
    const deal = deals.find((d) => d.id === enquiry.dealId);
    if (!deal) continue;
    deal.enquiries.push({ id: enquiry.id, at: enquiry.at, kind: enquiry.kind, note: enquiry.note, partnerId: enquiry.partnerId });
    deal.timeline.push({
      id: randomId('ev', 8),
      at: enquiry.at,
      type: 'enquiry_logged',
      actor: 'broker',
      message: `Partner enquiry logged (${enquiry.kind.replace(/_/g, ' ')}): ${enquiry.note}`,
      meta: { enquiryId: enquiry.id, kind: enquiry.kind },
    });
  }

  // --- Two week-one pulse surveys ------------------------------------------
  data.surveys = [
    {
      id: randomId('sv', 8),
      partnerId: 'p_alex',
      week: 1,
      at: stampFor(addDays(today, -14), 17, 30),
      answers: [2, 1, 4],
      comment: 'I never know where they are up to until it settles.',
    },
    {
      id: randomId('sv', 8),
      partnerId: 'p_priya',
      week: 1,
      at: stampFor(addDays(today, -13), 8, 20),
      answers: [3, 2, 4],
      comment: 'Would refer more if I could see progress.',
    },
  ];

  // --- One referral that came in through a portal form ---------------------
  data.referrals = [
    {
      id: randomId('ref', 8),
      at: stampFor(yesterday, 18, 40),
      partnerId: 'p_alex',
      buyerName: 'Hannah Doyle',
      buyerPhone: '0402 771 338',
      note: 'Met at the Lutwyche open, wants a pre-approval before Saturday.',
      consentToContact: true,
      status: 'new',
      dealId: null,
    },
  ];

  data.settings.baselines = {
    handoverFirstTimePct: 40,
    updatesPerDeal: 0.5,
    statementHours: 6,
    enquiriesPerWeek: 8,
    referralsPerWeek: 1,
    referralsPerWeekTarget: 3,
    partnerVerdict: 2.5,
  };

  data.aiLog = [];
  return data;
}

export function seedSummary(data) {
  return {
    deals: data.deals.length,
    partners: data.partners.length,
    messages: data.messages.length,
    statements: data.statements.length,
    rules: data.rules.length,
    enquiries: data.enquiries.length,
    surveys: data.surveys.length,
  };
}

export { clientLabel };
