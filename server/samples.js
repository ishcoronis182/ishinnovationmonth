// Sample pastes for the UI's "load a sample" buttons. Dates are derived from
// today so the demo never goes stale. All names are fictional.

import { addDays, formatLong, formatShort, todayISO } from '../shared/dates.js';

export function buildSamples({ today = null, tz = null, firm = null } = {}) {
  const day = today || todayISO(tz);
  const brokerName = firm?.broker || 'Nathan';
  const firmName = firm?.name || 'Coronis Finance';
  const contract = addDays(day, -9);
  const finance = addDays(day, 12);
  const settlement = addDays(day, 40);
  const taylorSettlement = addDays(day, 35);
  const preApprovalExpiry = addDays(day, 78);

  return [
    {
      id: 'sample_email',
      channel: 'email',
      label: 'Email from the agent',
      hint: 'A tidy handover. Should arrive green or amber.',
      text: [
        'From: Alex Sample <alex@sampleproperty.com.au>',
        `To: ${brokerName} <${brokerName.toLowerCase()}@coronisfinance.com.au>`,
        'Subject: Referral - Priya and Dev Kumar, 18 Bellbird St',
        '',
        `Hi ${brokerName},`,
        '',
        'Sending you Priya and Dev Kumar. They signed the contract on '
          + `${formatLong(contract)} for 18 Bellbird St, Lutwyche QLD 4030, purchase, and they need about 640k.`,
        'Finance clause is due ' + formatLong(finance) + ' and settlement is booked for ' + formatLong(settlement) + '.',
        'They are going with Macquarie. Priya is on 0412 998 221 and priya.kumar@example.com.',
        '',
        'They are happy for us to keep you in the loop on where it is up to, and I let them know I get a referral fee.',
        '',
        'Thanks,',
        'Alex Sample',
        'Sample Property, Coronis Lutwyche',
      ].join('\n'),
    },
    {
      id: 'sample_notes',
      channel: 'notes',
      label: 'Messy dot-point notes',
      hint: 'Half the fields are missing. Should arrive red with questions.',
      text: [
        'quick one from the open home sat',
        '- couple, Tomas + Mel, keen on a unit at kedron somewhere',
        '- maybe 500k ish, not sure yet',
        '- they were at the sign in sheet, agent was one of the lutwyche crew',
        '- said to call them this week',
        '- no contract yet, still looking',
      ].join('\n'),
    },
    {
      id: 'sample_voice',
      channel: 'voice',
      label: 'Voice memo transcript',
      hint: 'Rambling but complete enough. Watch the consent evidence.',
      text: [
        `[voice memo transcript - ${brokerName}, ${formatShort(day)}]`,
        '',
        'ok so this is the referral from Jordan Placeholder, he sent through a refinance,',
        'client is Bianca Nguyen, she owns 7 Kookaburra Tce, Wooloowin QLD 4030,',
        'wants to refinance about six hundred and twenty thousand, we are looking at Suncorp for this one,',
        'her number is 0431 552 004, email bianca.nguyen@example.com,',
        'settlement would be around the ' + formatLong(settlement) + ' if we get moving,',
        'she said she is fine with us telling Jordan how it is tracking, and I have disclosed the referral fee to her,',
        'oh and she has a pre-approval elsewhere that expires ' + formatLong(preApprovalExpiry) + ' so there is some urgency',
      ].join('\n'),
    },
    {
      id: 'sample_bpu_formal',
      channel: 'milestone',
      label: 'BPU milestone email (formal approval)',
      hint: 'Matches the Taylor file at 42 Wattlebird Cres.',
      milestone: true,
      text: [
        'From: BPU Processing <processing@coronisfinance.com.au>',
        `To: ${brokerName}`,
        'Subject: FORMAL APPROVAL - Taylor - 42 Wattlebird Cres',
        '',
        'Team,',
        '',
        'Formal approval received this morning for the Taylor file, security 42 Wattlebird Cres, Lutwyche.',
        `Settlement remains booked for ${formatLong(taylorSettlement)}.`,
        'Loan docs will issue in the next 48 hours. No conditions outstanding.',
        '',
        'BPU Processing',
        firmName,
      ].join('\n'),
    },
    {
      id: 'sample_bpu_settled',
      channel: 'milestone',
      label: 'BPU milestone email (settled)',
      hint: 'A settlement notice for the Kumar file.',
      milestone: true,
      text: [
        'From: BPU Processing <processing@coronisfinance.com.au>',
        `To: ${brokerName}`,
        'Subject: SETTLED - Nguyen - 7 Kookaburra Tce',
        '',
        `Confirming settlement completed today, ${formatLong(day)}, for the Nguyen refinance at 7 Kookaburra Tce, Wooloowin.`,
        'Funds have disbursed. Nothing further required.',
        '',
        'BPU Processing',
      ].join('\n'),
    },
    {
      id: 'sample_bpu_none',
      channel: 'milestone',
      label: 'BPU email with no milestone',
      hint: 'Explicitly says nothing changed. The tool should not invent a stage.',
      milestone: true,
      text: [
        'From: BPU Processing <processing@coronisfinance.com.au>',
        'Subject: FYI - Taylor file',
        '',
        'No update on the Taylor file today, still waiting on the valuer to book in.',
        'No milestone to report. FYI only.',
        '',
        'BPU Processing',
      ].join('\n'),
    },
  ];
}
