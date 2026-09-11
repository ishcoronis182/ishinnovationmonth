# PARTNER PULSE

**One deal record from referral to comms.** The handover creates it, every stage change
reaches the referring agent in plain English, and settlement pays them without chasing.

REFER → UPDATE → PAY → REFER AGAIN.

---

## Run it

```bash
npm install
npm start
```

Open <http://localhost:3000>. That builds the client, seeds the demo deck and serves
everything on one port. **No API key is needed.** Without one, every AI step falls back
to deterministic rules and says so on screen; the whole demo works offline.

With a key, the same flows use Claude and the AI activity panel on the Metrics page shows
each call, its model, its duration, its token counts and whether it degraded.

```bash
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

Other useful commands:

```bash
npm test          # 239 tests: domain, guard, commissions, templates, metrics,
                  # heuristics, the AI adapter with a fake client, and an API walk
npm run serve     # serve without rebuilding the client
npm run dev       # vite dev server on :5173, proxying /api to :3000
```

---

## The four-step demo

1. **Queue** – sixteen records across the six stages, each with a RAG chip. Red means a
   critical field is missing; the RAG *on arrival* is recorded because that is the metric.
2. **Handover** – paste the messy notes sample, press *Extract (offline mode)*. Ten fields
   come back with per-field confidence, the gaps named, and up to five specific questions
   for the broker. Consent is never inferred: the two checkboxes stay unticked unless the
   text clearly has the client agreeing, and then the matched phrase is shown. Press
   *Add to queue*.
3. **Deal** – open *Sam & Jo T.* The partner update is already drafted and passes the
   compliance guard. Type a figure into it and the send button disables with the reason.
   Press *Send both*: the SMS and the email are logged on the timeline with `sms:` and
   `mailto:` links you can open on your own phone.
4. **Milestone** – Handover → *BPU milestone* tab → load the settled sample → *Read this
   email*. It finds the right file by address, never by surname alone, and refuses to
   invent a stage when the email says nothing changed.
5. **Friday note** – what each agent will hear (consented deals only) beside your full
   register, their open homes, and a nudge you approve before it goes.
6. **Statements** – generate last month. Alex Sample shows the five numbers:
   **3 referred / 2 settled / $1,000 due / 1 in flight / $3,500 paid year to date.**
   Every line carries a deal id, a rule id and an amount. Issue, mark paid, export.
7. **Metrics** – the table, measured from the register, with editable baselines.
8. **Portal** – open a partner's private link on a phone. Status only: initials, address,
   stage pipeline, last update, next milestone, and what they are owed.

`Settings → Reset the demo` puts the deck back at any time.

---

## Compliance posture

This is the part that would stop a pilot, so it is deterministic and it is tested.

**Nothing reaches a partner without recorded consent.** Every deal carries two flags: the
client agreed we can share deal status with the referrer, and the referral fee was
disclosed. Only a human sets them. The AI may *suggest* consent, but only when it can
quote the phrase where the client agreed, and the suggestion is shown unticked for a
person to confirm. Drafting an update on a deal without consent shows the gate; sending is
refused with `403 no_consent`.

**No figure ever reaches a partner.** A deterministic guard runs on every draft, every
keystroke of an edit and again server-side at send. It blocks:

- currency in any shape: `$600k`, `AUD650k`, `600,000`, `600 000`, `650000`, `1.2 million`
- spelled-out figures: "six hundred thousand", "half a million"
- percentages and rates with or without a sign: `5.89%`, `5.89 pa`, "approved at 5.89"
- financial and personal detail: income, salary, deposit, LVR, interest rate, repayments,
  credit, default, arrears, bankrupt, debt, Centrelink, HECS, guarantor, payslips, bank
  statements, borrowing capacity, serviceability, "approved for"
- zero-width and full-width character tricks

It warns without blocking on a named lender, on document and process detail, and on long
numbers. Addresses, dates, postcodes and phone numbers pass. A blocked draft cannot be
sent until it is edited; the hits are highlighted in the text.

**The statement cover note** is guarded differently: the only numbers allowed are that
statement's own totals. Anything else is blocked.

**The partner portal is built field by field.** No deal object is ever spread into a
portal response. A runtime tripwire walks every response before it is sent and refuses it
if a forbidden key (`loanAmount`, `lender`, `phone`, `email`, `notes`, `consent`,
`referralComms`, …) appears at any depth. Clients appear as initials. A partner sees only
their own deals.

**Two different links per partner.** The *portal link* is private to the agent and lists
their deals. The *scan code* behind the open-home QR is for buyers and exposes nothing but
the agent's first name and who will call. Both are 32-character random tokens, rotated
together, and rotation kills the old link immediately.

**Money is re-checked, not trusted.** Statement lines are rebuilt from the live register
at issue and again at mark-paid, so a reopened deal can never be paid from a stale draft.
Reopening a settled deal is an explicit action that clears the commission, strips the deal
from any draft statement, and refuses outright when the deal sits on an issued statement.

**Other hardening.** Case-sensitive routing so `/API/deals` cannot slip past the passcode
guard. Bodies are parsed after auth. Constant-time passcode compare. Login lockout after
five failures in fifteen minutes. Per-IP rate limit and a daily cap on the public referral
form. HttpOnly, SameSite=Lax session cookie. Spreadsheet formulas are neutralised in
exported cells. The health endpoint warns about a weak passcode or a missing public URL.

---

## What is real and what is demo

**Real, working software:**

- The ten-field record, the RAG rule, the stage machine and its locks
- The compliance guard, in full
- The commission rules engine: flat, basis points, share of upfront, tiered, with
  partner overrides and effective dates; statements with lifecycle, anomalies and exports
- The AI layer: five tasks, structured JSON, a deterministic fallback for each, and honest
  reporting of which one ran
- The offline heuristics: they read the three sample handovers and the BPU emails well
  enough that the whole demo runs with no API key
- The portal, the QR codes, the printable sign-in sheet, the referral form and the survey
- Metrics computed from the register, not typed in
- CSV and XLSX exports, and a seven-sheet register workbook

**Demo data:** the deck is fictional and dated relative to today, so it never goes stale.
Coronis Finance, Nathan, and three invented partners. `PULSE_SEED_DEMO=false` starts empty.

**Placeholder until someone confirms it:** the commission rule is $500 per settled referred
loan. The rules editor in Settings covers the other shapes; the real number goes in when
the referral agreement is signed.

**Stubbed on purpose:** delivery. The default `log` provider records the send and hands
back `sms:` and `mailto:` links, so the broker's own phone is the pilot channel and no
third-party account is needed on day one. Twilio and Resend adapters are written and
selected by environment variable; they have not been run against live accounts here.

**Not built, deliberately:**

- No CRM, aggregator or lender integration. The BPU milestone email is pasted in.
- No automatic sending. Every partner message is approved by a human first.
- No lender commission statement reconciliation. This pays *referral* commission from the
  register; it does not check what the lender paid the brokerage.
- No multi-user accounts or roles. One shared passcode for a pilot office.
- No client-facing portal. Only the referring partner and the buyer referral form.

---

## Configure

Copy `.env.example` to `.env`. Everything has a working default.

| Variable | Default | What it does |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | – | Turns the AI on. Without it, deterministic fallbacks. |
| `PULSE_MODEL` | `claude-opus-5` | Model id. |
| `PULSE_AI_EFFORT` | `medium` | `output_config.effort`. |
| `PULSE_AI_FALLBACKS` | `true` | Server-side refusal fallbacks. |
| `PULSE_AI_TIMEOUT_MS` | `45000` | Client timeout; one retry. |
| `PULSE_TZ` | `Australia/Brisbane` | The firm's day. Never the host's UTC day. |
| `PULSE_DATA_DIR` | `./data` | Where `pulse.json` lives. |
| `PULSE_PASSCODE` | – | Locks the broker pages. Set this before sharing a link. |
| `PULSE_PUBLIC_URL` | – | Origin for portal links and QR codes. |
| `PULSE_SMS_PROVIDER` | `log` | `log` or `twilio`. |
| `PULSE_EMAIL_PROVIDER` | `log` | `log` or `resend`. |
| `PULSE_SEED_DEMO` | `true` | Seed the demo deck on an empty store. |
| `PORT` | `3000` | |

Twilio needs `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM`.
Resend needs `RESEND_API_KEY` and `RESEND_FROM`.

---

## Deploy

`render.yaml` is a Render blueprint: a Node web service that runs `npm install && npm start`
with a persistent disk mounted at `/var/data` for `pulse.json`. Set `PULSE_PASSCODE` and
`PULSE_PUBLIC_URL` in the dashboard, and `ANTHROPIC_API_KEY` if you want Claude on.

Data is a single JSON file, written to a temp file and renamed into place, so a crash
mid-write leaves the previous good file intact. A corrupt file is preserved beside the
fresh one rather than overwritten.

---

## How it is put together

```
shared/     pure domain, no I/O: dates, money, stages, the record + RAG,
            the compliance guard, commission rules + statements,
            partner-safe templates, metrics, the portal whitelist
server/     config, the JSON store, deal invariants, the AI adapter and prompts,
            offline heuristics, delivery adapters, xlsx, auth, seed, samples,
            app.js (createApp is injectable, which is how the tests drive it)
client/     React 18 + Vite, a small hash router, one design system
tests/      239 vitest tests
docs/       SPEC.md
```

Node 22, JavaScript ESM only. Dependencies: express, @anthropic-ai/sdk, exceljs, qrcode,
react, react-dom. Dev: vite, @vitejs/plugin-react, vitest.

`docs/SPEC.md` has the data model, the API surface, the AI contract and the decisions
behind them.

---

## The AI layer

Four decision points inside deterministic software, plus the statement note:

| Task | What it decides | Fallback |
| --- | --- | --- |
| `extractHandover` | the ten fields, confidence, questions, partner match, consent evidence | regex heuristics |
| `parseMilestone` | stage, event date, key dates, which file | regex + a match scorer |
| `draftUpdate` | the partner SMS and email | the template that matches the reference register |
| `draftNudge` | the Friday nudge | template |
| `writeStatementNote` | the statement cover note | template |

Every call uses structured JSON output (`output_config.format.type = "json_schema"`), a
stable cached system prefix with no timestamps in it, and volatile data in the user turn.
Pasted text is fenced and treated as data, never as instructions. `stop_reason` is checked
for a refusal before the content is read, and `max_tokens` is reported honestly rather than
as malformed JSON. An `AuthenticationError` disables AI for the process; a rate limit,
timeout, network error, 5xx or bad request falls back for that call only. Server-side
refusal fallbacks are on by default, with one retry without them on a 400 that names them.

Every AI output is normalised and guarded before it is shown. A model draft that carries a
figure is thrown away and the template is used instead, with `guard_blocked` recorded in
the activity log. A model that proposes a surname-only milestone match is overruled.

---

## Verified

- 239 vitest tests pass: domain rules, the guard (the reference SMS passes; `$600k`,
  `5.89%`, `600,000`, LVR, income and "six hundred thousand" block; addresses, dates,
  postcodes and phone numbers pass; overlapping redactions are clean), every commission
  rule type and precedence, the deck totals, every stage template under 320 characters and
  partner-safe, metrics, heuristics on the samples, the AI adapter against a fake client
  (happy path, refusal, malformed JSON, `AuthenticationError`, rate limit, timeout,
  `max_tokens`), and an API walk asserting the must-nevers.
- A headless Chromium walk drives queue → handover → deal → send → milestone → Friday →
  statements → metrics → partner → portal on a 390px phone, with zero page errors.
- Not verified here: a live `ANTHROPIC_API_KEY` (the AI paths are covered by a fake client,
  not a real call), and live Twilio/Resend delivery.
