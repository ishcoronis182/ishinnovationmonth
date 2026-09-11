# PARTNER PULSE - specification

The problem, the shape of the thing, and the decisions behind it. The README covers how to
run it and what is real versus demo; this is the technical contract.

---

## 1. The problem, restated

Dan asked for four things: an AI handover tool rather than emails, help promoting referrals
from agents, a way to send updates to partners who refer deals, and a way to calculate
their commissions. They are one problem: **a deal has no single record everyone can see.**

The referral loop breaks in three places:

1. Agents do not know when to refer.
2. The referring partner hears nothing until settlement.
3. Referral commissions are worked out by hand from lender commission statements, monthly,
   and paid late.

Two facts make this cheap to fix. The processing team already emails a milestone on every
file, and nobody turns those into a message an agent can read. And every settled referral
is a formula over data already held.

The thesis: **partners who can see their deals and their money refer more.** Promoting
referrals is not a fourth tool; it is the Friday note that falls out of the first three.

---

## 2. The one record

Ten fields, one per row of the deal page:

| # | Field | Shape |
| --- | --- | --- |
| 1 | client | `{ name, phone, email }` |
| 2 | broker | string |
| 3 | referredBy | partner id, `"direct"`, or `null` (unknown) |
| 4 | stage | see below |
| 5 | purpose | `purchase \| refinance \| investment \| construction \| pre_approval \| other` |
| 6 | loanAmount | dollars, number |
| 7 | lender | string |
| 8 | propertyAddress | string |
| 9 | keyDates | `{ contract, financeDue, settlementDue, preApprovalExpiry, settledAt }` |
| 10 | referralComms | `{ ruleId, ruleName, amount, status, statementId, paidAt }` |

Plus: `id`, `ref` (`PP-0001`), `consent`, `channel`, `summary`, `questions`, `confidence`,
`notes[]`, `timeline[]`, `enquiries[]`, `rag`, `arrivalRag`, `referredAt`, `stageEnteredAt`,
`createdAt`, `updatedAt`, `aiProvider`, `lastUpdateAt`, `updateCount`.

### RAG

Recorded on arrival as `arrivalRag`, because "handovers complete first time" is a metric
and the current RAG changes as gaps are filled.

- **Red** - any critical field missing: client name, broker, referrer unknown, purpose,
  loan amount, lender once lodged, property address on a purchase, settlement date once
  settled.
- **Amber** - only minor gaps: contact details, expected key dates, lender before lodgement,
  address on a non-purchase.
- **Green** - all ten complete.

Which key dates are *expected* depends on purpose: a purchase expects contract, finance due
and settlement due; a refinance expects settlement due; a pre-approval expects its expiry.

### Stages

`referred → application → lodged → conditional → formal → settled`, with `declined` and
`withdrawn` as off-ramps.

- Any live stage may move to any other live stage (brokers correct mistakes); a backward
  move is allowed and flagged.
- Any live stage may move to an off-ramp.
- **Settled is locked.** Reopening is an explicit action, not a transition. It clears the
  settlement date and the commission, removes the deal from any *draft* statement, and
  refuses when the deal sits on an issued or paid statement.
- Off-ramped deals are locked the same way.

### Dates and money

Date-only fields are `YYYY-MM-DD` reckoned in the firm's timezone (default
`Australia/Brisbane`), never the host's UTC day - on a Brisbane evening those differ, and
a settlement booked "today" would otherwise land yesterday. Australian input is day-first:
`9/10/2026` is 9 October. Money parses `600k`, `$600,000`, `AUD650k`, `1.2m`,
`six hundred thousand`, `600 000`. Cents are rounded through the exponent, because
`Math.round(1.005 * 100)` is 100 in binary floating point and a lost cent is a bug.

---

## 3. The compliance guard

`shared/guard.js`. Pure: text in, findings out. It runs on every draft, every edit and
again server-side before a send.

**Pipeline.** The text is NFKC-folded character by character with an index map back to the
original, so hits can be highlighted in what the user actually typed. Invisible characters
(zero-width space, joiners, bidi marks, soft hyphen) are dropped and reported in their own
right. Then "safe spans" are found - phone numbers, dates in five shapes, times, postcodes
after a state, email addresses - and figure detectors run everywhere *except* inside them.
That ordering is what lets `0412 345 678` pass while `600 000` blocks.

**Blocks:** currency with a symbol or an `AUD` prefix; abbreviated amounts (`600k`,
`1.2 million`); percentages and rates with or without a sign (`5.89%`, `5.89 pa`,
"approved at 5.89"); comma- or space-separated numbers; bare runs of five or more digits;
decimals; spelled-out figures via a number-word scanner; and a list of financial and
personal detail terms.

**Warns:** a named lender, document and process words, and long numbers that were
classified as phone numbers.

Findings are de-overlapped: overlapping hits of the same severity merge and keep both
labels, a block beats an overlapping warn, and hidden-character findings are never absorbed.
Redaction merges adjacent spans so the preview never contains `[removed][removed]`.

`checkStatementNote(text, totals)` is the same guard with the statement's own totals added
as allowed spans. Nothing else numeric gets through.

---

## 4. Commission

Rule shape:

```js
{ id, name, scope: 'global' | 'partner', partnerId, type, effectiveFrom, active, note,
  flatAmount,            // type 'flat'
  bps,                   // type 'bps'
  sharePct, upfrontBps,  // type 'share_upfront'
  tiers: [{ minLoan, type, amount, bps }] }  // type 'tiered'
```

**Resolution:** partner-specific overrides beat the global rule. Among the rules already in
effect on the relevant date, the latest `effectiveFrom` wins. Inactive rules are ignored.
The relevant date is the settlement date, falling back to the referral date.

**Computation** returns `{ amount, ruleId, ruleName, basis, anomalies }`. A percentage rule
with no loan amount returns `amount: null` and a `missing_loan_amount` anomaly - it never
quietly computes zero.

**The five numbers** on a statement:

| Number | Definition |
| --- | --- |
| Deals referred (this period) | partner's deals with `referredAt` inside the period |
| Settled this month | partner's deals with `settledAt` inside the period |
| Referral comms due | outstanding commission across all periods (not paid, not void) |
| In flight | partner's deals in a live stage |
| Paid year to date | commission paid in the period's calendar year |

**Lifecycle:** `draft → issued → paid`, plus `void` with a reason. Lines are rebuilt from
the live register at issue and again at mark-paid. At issue, dropped lines are reported and
the statement is refused if every line drops. At mark-paid, any dropped line refuses the
whole payment and asks for a regenerate - a reopened deal must never be paid from a stale
draft. Voiding returns every line to `due`.

**Anomalies:** no rule, missing loan amount on a percentage rule, a zero line, fee
disclosure not recorded, duplicate client, settled and unpaid for over 30 days, and the
register-level "settled with no referrer recorded".

**Exports:** per statement, a CSV and an XLSX with partner-safe columns only (deal ref,
deal id, client label, security property, settled date, rule id, rule, basis, amount) - no
loan figures. Plus a seven-sheet register workbook: Deals, Partners, Messages, Statements,
Statement lines, Rules, Anomalies. Cells beginning `=`, `+`, `-`, `@`, tab or CR are
prefixed with an apostrophe so a pasted note cannot execute in Excel.

---

## 5. Partner messages

`shared/templates.js` builds from a whitelist context - partner first name, client label
(`Sam & Jo T.`), short address, purpose, stage, dates, broker, firm, event date - so the
draft functions cannot see a loan amount or a lender even if they wanted to.

The reference register the templates match exactly:

> Hi Alex - quick update on the buyers you sent us for 42 Wattlebird Cres. Their loan was
> formally approved this morning. Settlement is booked for 9 Oct. We'll let you know the
> moment it's done. Thanks again for the referral - Nathan, Coronis Finance

Rules: plain hyphens only (an em dash forces UCS-2 SMS encoding and halves the segment
length); "the buyers you sent us for {address}" for a purchase and "the client you sent us
for {address}" otherwise; a backdated milestone names its date instead of saying "this
morning"; under 320 characters at every stage; no reason is ever given for a decline.

---

## 6. Metrics

Computed from the register on every request.

| Metric | How | Target |
| --- | --- | --- |
| Handovers complete first time | share of the last 10 handovers green on arrival | ≥ 80% |
| Updates per referred deal | sent partner updates ÷ referred deals | 4 |
| Statement production time | hours from generate to issue | baseline − 75% |
| "Where is my deal / my comm?" enquiries | logged enquiries per week, last 4 | baseline − 50% |
| Referrals per week (pilot office) | 12-week buckets with a trend | editable |
| Partner verdict | mean of the 3-question pulse survey, week 1 vs week 3 | 4 / 5 |

Baselines are editable and stored. The value model: one extra settlement a month at a
$600,000 loan and 0.65% upfront is $3,900 a month, about **$46,800 a year**.

---

## 7. The AI layer

`server/ai.js` + `server/prompts.js`. Five tasks, each with a deterministic fallback.

**Request shape.** Model `claude-opus-5` by default. Structured JSON via
`output_config: { effort, format: { type: 'json_schema', schema } }`, where the schema is a
plain object with `properties`, `required` and `additionalProperties: false`, and no
`format`/`pattern`/min/max keywords. No `thinking`, `temperature`, `top_p` or `top_k`.
Server-side refusal fallbacks on by default via
`client.beta.messages.create({ betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' })`,
with one retry without those two fields on a 400 that mentions them. 45 s timeout, one
retry on the client.

**System prompts are stable cached prefixes** - no dates, no partner lists, nothing that
changes per call - and carry a `cache_control: { type: 'ephemeral' }` breakpoint. Volatile
data goes in the user turn.

**Pasted text is untrusted.** It is fenced in `<pasted_handover>` / `<pasted_email>` tags,
the system prompt says it is data and not instructions, and any closing tag inside it is
stripped.

**Failure handling.** `stop_reason === 'refusal'` is checked before the content is read.
`max_tokens` is reported as itself, not as malformed JSON. `AuthenticationError` and a 403
disable AI for the process; rate limits, timeouts, network errors, 5xx and bad requests
fall back for that call only. Every call is logged with task, provider, model, duration,
tokens, ok and the reason it degraded.

**Output is normalised and guarded.** A partner id the model invented is dropped. Consent
is only accepted when the model quoted evidence. A surname-only milestone match is
overruled. A draft that fails the compliance guard is discarded and the template is used,
recorded as `guard_blocked`.

---

## 8. API

All under `/api`, JSON, case-sensitive.

**Public:** `GET /health`, `POST /login`, `POST /logout`, `GET /session`,
`GET /portal/:token`, `GET /portal/:token/qr.png`, `GET /portal/:token/signin-sheet`,
`POST /portal/:token/refer`, `POST /portal/:token/survey`, `GET /scan/:token`,
`POST /scan/:token/refer`.

**Behind the passcode:** `GET /bootstrap`, `GET /samples`, `GET /ai/log`,
deals (`GET /deals`, `GET|PATCH /deals/:id`, `POST /deals`, `/stage`, `/reopen`, `/consent`,
`/notes`, `/enquiry`, `/recompute-comms`, `/draft-update`, `/check-draft`, `/send-update`),
handover (`/handover/extract`, `/handover/commit`), milestones (`/milestone/parse`,
`/milestone/apply`), partners (`GET /partners`, `GET|PATCH /partners/:id`, `POST /partners`,
`/rotate-token`, `/open-homes`, `/qr.png`, `/signin-sheet`), `GET /referrals`,
Friday (`GET /friday`, `/friday/:id/draft`, `/friday/:id/send`),
statements (`GET /statements`, `/statements/generate`, `GET|PATCH /statements/:id`,
`/note`, `/issue`, `/paid`, `/void`, `/send`, `/export.csv`, `/export.xlsx`),
`GET /register.xlsx`, `GET /metrics`, `PUT /settings`, `GET|PUT /rules`, `POST /demo/reset`.

`createApp({ config, store, ai, delivery, logger, now })` is injectable, which is how the
tests drive the whole API without a network.

---

## 9. Storage

One JSON file. `store.update(mutator)` serialises every write through a promise queue,
snapshots the state first, runs the mutator, writes to `.pulse.json.tmp-<pid>-<n>`, fsyncs,
renames into place, then fsyncs the directory. A mutator that throws rolls the in-memory
state back. A corrupt or empty file on load is renamed to `pulse.json.corrupt-<stamp>` and
preserved; a fresh file is started and the event is recorded.

This is a pilot-sized tool. One file is the right amount of database for it, and the
rename-based write is what makes "lose data on a crash mid-write" a tested claim rather
than a hope.

---

## 10. Decisions worth knowing

**Two tokens per partner, not one.** The obvious design puts one token in the QR code and
the portal. Then anyone who scans a sign-in sheet at an open home can read that agent's
deal list. The scan token exposes a first name and a form; the portal token is private.

**The Friday count window.** "Settled this month" on the Friday card counts from the first
of *last* month - the current unpaid commission window. A calendar-month count reads zero
for the first week of every month, which is useless to an agent. The card says which window
it used; the SMS keeps the natural phrasing.

**Consent gates status updates, not payment.** A statement is about the partner's own
money for deals they referred; the message carries totals only and links to the portal. The
consent flag gates deal *status*, which is what would otherwise leak.

**The RAG is recorded twice.** `arrivalRag` never changes, `rag` is live. The metric needs
the first; the queue needs the second.

**An unknown referrer is red, not amber.** Without it the commission cannot be worked out
at all, and a settled deal with no referrer is the register anomaly that tells you the loop
leaked.

**The guard blocks before it warns, and a human can always edit.** A blocked draft is not
discarded; the hits are highlighted so the broker can see exactly what to change.
