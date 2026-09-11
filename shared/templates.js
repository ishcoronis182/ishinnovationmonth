// Partner-safe copy. Status only: no figures, no lender, no reasons for a
// decline. Plain hyphens in SMS (an em dash forces UCS-2 encoding).
// Pure: context in, draft out. Every draft still goes through the guard.

import { formatShort } from './dates.js';
import { clientLabel, shortAddress, PURPOSE_LABELS } from './record.js';
import { stageLabel } from './stages.js';
import { formatMoney } from './money.js';

export const SMS_MAX = 320;

export function partnerFirstName(partner) {
  const name = typeof partner === 'string' ? partner : partner?.name;
  if (!name) return 'there';
  return String(name).trim().split(/\s+/)[0];
}

/**
 * The only deal facts that may reach a partner. Build the context here and the
 * draft functions can never see a loan amount or a lender.
 */
export function buildUpdateContext({ deal, partner, firm, broker, today, eventDate, stage }) {
  const useStage = stage || deal?.stage;
  return {
    partnerFirstName: partnerFirstName(partner),
    clientLabel: clientLabel(deal),
    address: shortAddress(deal?.propertyAddress),
    purpose: deal?.purpose || null,
    stage: useStage,
    dates: {
      settlementDue: deal?.keyDates?.settlementDue || null,
      financeDue: deal?.keyDates?.financeDue || null,
      preApprovalExpiry: deal?.keyDates?.preApprovalExpiry || null,
      settledAt: deal?.keyDates?.settledAt || null,
    },
    broker: broker || deal?.broker || null,
    firm: firm || null,
    eventDate: eventDate || today || null,
    today: today || null,
  };
}

function whoPhrase(purpose) {
  return purpose === 'purchase' ? 'the buyers you sent us' : 'the client you sent us';
}

function whenPhrase(ctx, { todayWord }) {
  const { eventDate, today } = ctx;
  if (!eventDate || (today && eventDate === today)) return todayWord;
  return `on ${formatShort(eventDate)}`;
}

function stageSentence(ctx) {
  const backdated = Boolean(ctx.eventDate && ctx.today && ctx.eventDate !== ctx.today);
  const on = ctx.eventDate ? `on ${formatShort(ctx.eventDate)}` : '';
  switch (ctx.stage) {
    case 'referred':
      return "We've got their details and we're on it.";
    case 'application':
      return backdated ? `We started their application ${on}.` : "We're putting their application together now.";
    case 'lodged':
      return backdated ? `Their application was lodged ${on}.` : 'Their application has now been lodged.';
    case 'conditional':
      return backdated ? `They got conditional approval ${on}.` : 'They have conditional approval.';
    case 'formal':
      return `Their loan was formally approved ${whenPhrase(ctx, { todayWord: 'this morning' })}.`;
    case 'settled':
      return `Their loan settled ${whenPhrase(ctx, { todayWord: 'today' })} - all done.`;
    case 'declined':
      return "We weren't able to get this one across the line.";
    case 'withdrawn':
      return "They've decided to pause this one for now.";
    default:
      return 'We have an update for you.';
  }
}

function milestoneSentence(ctx) {
  const d = ctx.dates || {};
  if (ctx.stage === 'settled' || ctx.stage === 'declined' || ctx.stage === 'withdrawn') return '';
  if (d.settlementDue) return `Settlement is booked for ${formatShort(d.settlementDue)}.`;
  if (d.financeDue) return `Finance is due ${formatShort(d.financeDue)}.`;
  if (d.preApprovalExpiry) return `Their pre-approval runs to ${formatShort(d.preApprovalExpiry)}.`;
  return '';
}

function reassuranceSentence(ctx) {
  switch (ctx.stage) {
    case 'settled':
      return '';
    case 'declined':
      return "Happy to talk it through whenever suits you.";
    case 'withdrawn':
      return "We'll let you know if it picks back up.";
    case 'formal':
      return "We'll let you know the moment it's done.";
    default:
      return "We'll keep you posted as it moves.";
  }
}

function signature(ctx) {
  const parts = [ctx.broker, ctx.firm].filter(Boolean);
  return parts.join(', ');
}

function joinSentences(parts) {
  return parts.map((p) => (p || '').trim()).filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Draft the partner SMS and email for a stage change.
 * @returns {{sms: string, email: {subject: string, body: string}, provider: string}}
 */
export function draftUpdate(context) {
  const ctx = context || {};
  const who = whoPhrase(ctx.purpose);
  const opener = ctx.address
    ? `Hi ${ctx.partnerFirstName} - quick update on ${who} for ${ctx.address}.`
    : `Hi ${ctx.partnerFirstName} - quick update on ${who}.`;
  const body = joinSentences([stageSentence(ctx), milestoneSentence(ctx), reassuranceSentence(ctx)]);
  const closing = `Thanks again for the referral - ${signature(ctx)}`;
  let sms = joinSentences([opener, body, closing]);
  if (sms.length > SMS_MAX) {
    sms = joinSentences([opener, stageSentence(ctx), milestoneSentence(ctx), closing]);
  }
  if (sms.length > SMS_MAX) {
    sms = joinSentences([opener, stageSentence(ctx), closing]);
  }

  const emailSubject = ctx.address
    ? `${subjectStage(ctx.stage)} - ${ctx.address}`
    : `${subjectStage(ctx.stage)} - your referral`;
  const emailBody = [
    `Hi ${ctx.partnerFirstName},`,
    '',
    ctx.address
      ? `Quick update on ${who} for ${ctx.address}.`
      : `Quick update on ${who}.`,
    '',
    joinSentences([stageSentence(ctx), milestoneSentence(ctx)]),
    '',
    joinSentences([reassuranceSentence(ctx), 'Thanks again for the referral.']),
    '',
    ctx.broker || '',
    ctx.firm || '',
  ].join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return {
    sms,
    email: { subject: emailSubject, body: emailBody },
    provider: 'template',
  };
}

function subjectStage(stage) {
  switch (stage) {
    case 'formal': return 'Formal approval';
    case 'conditional': return 'Conditional approval';
    case 'lodged': return 'Application lodged';
    case 'application': return 'Application under way';
    case 'settled': return 'Settled';
    case 'referred': return 'We have their details';
    case 'declined': return 'An update on your referral';
    case 'withdrawn': return 'An update on your referral';
    default: return `Update: ${stageLabel(stage)}`;
  }
}

/**
 * The Friday nudge. Numbers here count only deals whose client consented to
 * sharing status; the caller is responsible for passing consented counts.
 */
export function draftNudge(context) {
  const ctx = context || {};
  const first = ctx.partnerFirstName || 'there';
  const opens = Number(ctx.opensCount) || 0;
  const settled = Number(ctx.settledCount) || 0;
  const day = ctx.openDay || 'Saturday';
  const broker = ctx.broker || 'your broker';
  const buyersWord = settled === 1 ? 'buyer' : 'buyers';
  const opensWord = opens === 1 ? 'open' : 'opens';

  let lead;
  if (opens > 0 && settled > 0) {
    lead = `${first} - you've got ${opens} ${opensWord} on ${day} and ${settled} of your referred ${buyersWord} settled this month.`;
  } else if (opens > 0) {
    lead = `${first} - you've got ${opens} ${opensWord} on ${day}.`;
  } else if (settled > 0) {
    lead = `${first} - ${settled} of your referred ${buyersWord} settled this month.`;
  } else {
    lead = `${first} - anything on this weekend?`;
  }
  const ask = opens > 0
    ? 'Want a pre-approval QR code for the sign-in sheet?'
    : 'Want a pre-approval QR code for your next open?';
  const promise = `Anyone who scans it gets a call from ${broker} within a day.`;
  return {
    sms: joinSentences([lead, ask, promise]),
    provider: 'template',
  };
}

/** Statement cover note. The only numbers are the statement's own totals. */
export function statementNote(context) {
  const ctx = context || {};
  const first = ctx.partnerFirstName || 'there';
  const n = ctx.numbers || {};
  const period = ctx.periodLabel || 'this month';
  const settled = Number(n.settledThisMonth) || 0;
  const due = Number(n.commsDue) || 0;
  const inFlight = Number(n.inFlight) || 0;
  const lines = [`Hi ${first}, here's your referral statement for ${period}.`];
  if (settled > 0) {
    lines.push(`${settled} of your referrals settled this period and ${formatMoney(due)} is due to you.`);
  } else if (due > 0) {
    lines.push(`${formatMoney(due)} is due to you.`);
  } else {
    lines.push('Nothing settled this period, so there is nothing owing yet.');
  }
  if (inFlight > 0) {
    lines.push(`${inFlight} more ${inFlight === 1 ? 'is' : 'are'} in flight.`);
  }
  lines.push(`Thanks again - ${[ctx.broker, ctx.firm].filter(Boolean).join(', ')}`);
  return {
    text: joinSentences(lines),
    provider: 'template',
  };
}

/** Numbers a statement note is allowed to mention. */
export function statementNoteAllowedNumbers(statement) {
  const n = statement?.numbers || {};
  const out = [
    n.dealsReferred, n.settledThisMonth, n.commsDue, n.inFlight, n.paidYtd,
    statement?.total,
  ];
  for (const line of statement?.lines || []) out.push(line.amount);
  return out.filter((v) => Number.isFinite(Number(v))).map(Number);
}

/** Short, partner-safe description of a deal for portal and Friday cards. */
export function dealStatusPhrase(deal) {
  switch (deal?.stage) {
    case 'referred': return 'With us, getting started';
    case 'application': return 'Application under way';
    case 'lodged': return 'Lodged';
    case 'conditional': return 'Conditional approval';
    case 'formal': return 'Formally approved';
    case 'settled': return 'Settled';
    case 'declined': return 'Closed';
    case 'withdrawn': return 'On hold';
    default: return 'In progress';
  }
}

export function purposeLabel(purpose) {
  return PURPOSE_LABELS[purpose] || 'Other';
}
