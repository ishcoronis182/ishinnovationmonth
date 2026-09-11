// The partner portal. Mobile first, no sidebar, status only.
// There are no loan figures, no lender and no client contact details in the
// payload this page receives, and there must be none on the page.

import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import {
  Card, Button, Chip, Field, Callout, Empty, LoadingBlock, StagePipeline,
  Wordmark, shortDate, longDate, stampLabel,
} from '../components/ui.jsx';

/** Only count forwards. A settlement that already happened is not "-36 days". */
function countdown(daysAway) {
  if (daysAway == null || daysAway < 0) return '';
  if (daysAway === 0) return ' (today)';
  if (daysAway === 1) return ' (tomorrow)';
  return ` (in ${daysAway} days)`;
}

function DealCard({ deal }) {
  return (
    <Card>
      <div className="portal-deal">
        <div className="portal-deal__top">
          <span className="portal-deal__initials">{deal.initials}</span>
          <div className="spacer" />
          <Chip tone={deal.stage === 'settled' ? 'green' : (deal.offRamp ? 'neutral' : 'teal')}>{deal.statusPhrase}</Chip>
        </div>
        <span className="small muted">{deal.address || 'Address to confirm'}{deal.purposeLabel ? ` · ${deal.purposeLabel}` : ''}</span>
        <StagePipeline pipeline={deal.pipeline} stage={deal.stageLabel} offRamp={deal.offRamp} />
        {deal.nextMilestone ? (
          <span className="small">
            {deal.stage === 'settled' ? '' : 'Next: '}
            {deal.nextMilestone.label} {deal.nextMilestone.dateLabel}
            {countdown(deal.nextMilestone.daysAway)}
          </span>
        ) : null}
        {deal.lastUpdate?.text ? (
          <div className="bubble" style={{ maxWidth: '100%' }}>
            {deal.lastUpdate.text}
            <div className="bubble__foot">Sent {stampLabel(deal.lastUpdate.at)}</div>
          </div>
        ) : <span className="small muted">No update sent yet.</span>}
      </div>
    </Card>
  );
}

function MoneyTab({ payload }) {
  const statements = payload.statements || [];
  return (
    <>
      <Card>
        <div className="row">
          <div className="stat stat--teal">
            <span className="stat__label">Due to you</span>
            <span className="stat__value">{payload.totals?.dueLabel}</span>
          </div>
          <div className="spacer" />
          <div className="stat stat--green">
            <span className="stat__label">Paid</span>
            <span className="stat__value">{payload.totals?.paidLabel}</span>
          </div>
        </div>
      </Card>
      {statements.length ? statements.map((s) => (
        <Card key={s.id}>
          <div className="card__head">
            <h2>{s.periodLabel}</h2>
            <Chip tone={s.status === 'paid' ? 'green' : 'teal'}>{s.status === 'paid' ? 'Paid' : 'Due'}</Chip>
          </div>
          <div className="row">
            <span className="stat__value">{s.amountLabel}</span>
            <div className="spacer" />
            <span className="small muted">
              {s.lineCount} referral{s.lineCount === 1 ? '' : 's'}
              {s.paidAt ? ` · paid ${shortDate(s.paidAt)}` : (s.issuedAt ? ` · issued ${shortDate(s.issuedAt)}` : '')}
            </span>
          </div>
          {s.lines?.length ? (
            <ul className="stack stack--tight" style={{ margin: '10px 0 0', paddingLeft: 18 }}>
              {s.lines.map((line, i) => (
                <li key={i} className="small">
                  {line.initials} {line.address ? `- ${line.address}` : ''} settled {line.settledLabel || '-'}: <strong>{line.amountLabel}</strong>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      )) : <Empty>No statements yet. They arrive once your referrals settle.</Empty>}
    </>
  );
}

function ReferTab({ token, onDone }) {
  const { toast } = useApp();
  const [form, setForm] = useState({ buyerName: '', buyerPhone: '', buyerEmail: '', note: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async (event) => {
    event?.preventDefault?.();
    if (!consent) {
      toast.warn('Tick the box to confirm the buyer agreed to be contacted.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.portalRefer(token, { ...form, consentToContact: true });
      setDone(result.message);
      setForm({ buyerName: '', buyerPhone: '', buyerEmail: '', note: '' });
      setConsent(false);
      onDone?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Card>
        <Callout tone="green" title="Thanks">
          <span>{done}</span>
        </Callout>
        <div className="row" style={{ marginTop: 10 }}>
          <Button onClick={() => setDone(null)}>Refer someone else</Button>
        </div>
      </Card>
    );
  }

  return (
    <Card title="Refer a buyer" hint="One tap. We call them within a business day.">
      <form className="stack" onSubmit={submit}>
        <Field label="Buyer name" id="rf-name">
          <input id="rf-name" value={form.buyerName} onChange={(e) => setForm({ ...form, buyerName: e.target.value })} required />
        </Field>
        <Field label="Mobile" id="rf-phone">
          <input id="rf-phone" type="tel" value={form.buyerPhone} onChange={(e) => setForm({ ...form, buyerPhone: e.target.value })} />
        </Field>
        <Field label="Email" id="rf-email">
          <input id="rf-email" type="email" value={form.buyerEmail} onChange={(e) => setForm({ ...form, buyerEmail: e.target.value })} />
        </Field>
        <Field label="Anything we should know" id="rf-note">
          <textarea id="rf-note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
        </Field>
        <label className="check">
          <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
          <span className="check__body">
            <span>The buyer agreed to be contacted</span>
            <span className="field__note">We only call people who asked us to.</span>
          </span>
        </label>
        <Button variant="primary" block onClick={submit} disabled={busy || !consent || !form.buyerName}>
          Send the referral
        </Button>
        <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">Send</button>
      </form>
    </Card>
  );
}

function Survey({ token, payload, onSubmitted }) {
  const { toast } = useApp();
  const [answers, setAnswers] = useState([0, 0, 0]);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [again, setAgain] = useState(false);

  if (payload.survey?.submitted && !again) {
    return (
      <Card title="Your pulse check">
        <Callout tone="green">
          <span>Thanks, you answered this on {stampLabel(payload.survey.at)} (week {payload.survey.week}).</span>
        </Callout>
        <div className="row" style={{ marginTop: 10 }}>
          <Button size="sm" onClick={() => setAgain(true)}>Answer it again</Button>
        </div>
      </Card>
    );
  }

  const submit = async () => {
    if (answers.some((a) => !a)) {
      toast.warn('Answer all three, 1 to 5.');
      return;
    }
    setBusy(true);
    try {
      await api.portalSurvey(token, { answers, week: 3, comment });
      toast.ok('Thanks. That goes straight onto the metrics page.');
      setAgain(false);
      onSubmitted?.();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Three quick questions" hint="1 is no, 5 is yes">
      <div className="stack">
        {(payload.questions || []).map((question, qi) => (
          <div className="stack stack--tight" key={question}>
            <span id={`q-${qi}`}>{question}</span>
            <div className="scale" role="group" aria-labelledby={`q-${qi}`}>
              {[1, 2, 3, 4, 5].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={answers[qi] === value}
                  aria-label={`${question}: ${value} out of 5`}
                  onClick={() => setAnswers(answers.map((a, i) => (i === qi ? value : a)))}
                >
                  {value}
                </button>
              ))}
            </div>
          </div>
        ))}
        <Field label="Anything else?" id="sv-comment">
          <textarea id="sv-comment" rows={2} value={comment} onChange={(e) => setComment(e.target.value)} />
        </Field>
        <Button variant="primary" block onClick={submit} disabled={busy}>Send my answers</Button>
      </div>
    </Card>
  );
}

export default function PortalPage({ token }) {
  const [tab, setTab] = useState('deals');
  const { data, loading, error, reload } = useAsync(() => api.portal(token), [token]);

  if (loading && !data) {
    return <div className="portal"><div className="portal__body" style={{ paddingTop: 20 }}><LoadingBlock rows={3} /></div></div>;
  }
  if (error) {
    return (
      <div className="portal">
        <div className="portal__hero"><Wordmark /></div>
        <div className="portal__body" style={{ paddingTop: 24 }}>
          <Callout tone="red" title="This link is not working">
            <span>
              {error.status === 404
                ? 'That link has expired or been replaced. Ask your broker for a fresh one.'
                : error.message}
            </span>
          </Callout>
        </div>
      </div>
    );
  }

  const payload = data;
  const deals = payload.deals || [];

  return (
    <div className="portal">
      <div className="portal__hero">
        <Wordmark to={`/portal/${token}`} />
        <h1 style={{ marginTop: 12 }}>Hi {payload.partner?.firstName}</h1>
        <p>
          {payload.totals?.dealsReferred} referral{payload.totals?.dealsReferred === 1 ? '' : 's'} with {payload.firm?.name}
          {' '}&middot; {payload.totals?.inFlight} in flight &middot; {payload.totals?.settled} settled
        </p>
      </div>

      <div className="portal__body">
        <div className="portal-tabs" role="group" aria-label="Portal sections">
          <button type="button" aria-pressed={tab === 'deals'} onClick={() => setTab('deals')}>My deals</button>
          <button type="button" aria-pressed={tab === 'money'} onClick={() => setTab('money')}>My money</button>
          <button type="button" aria-pressed={tab === 'refer'} onClick={() => setTab('refer')}>Refer a buyer</button>
        </div>

        {tab === 'deals' ? (
          deals.length ? deals.map((deal) => <DealCard key={deal.id} deal={deal} />) : <Empty>No deals yet.</Empty>
        ) : null}

        {tab === 'money' ? <MoneyTab payload={payload} /> : null}

        {tab === 'refer' ? (
          <>
            <ReferTab token={token} onDone={reload} />
            <Card title="Pre-approval QR code" hint="For your sign-in sheet">
              <div className="stack">
                <img
                  src={`/api/portal/${encodeURIComponent(token)}/qr.png`}
                  alt="QR code buyers can scan for a pre-approval call"
                  width={180}
                  height={180}
                  style={{ borderRadius: 8, border: '1px solid var(--line)', alignSelf: 'center' }}
                />
                <span className="small muted">
                  Anyone who scans it gets a call from {payload.firm?.broker} within a business day. It shows them a form and nothing else.
                </span>
                <a className="btn" href={`/api/portal/${encodeURIComponent(token)}/signin-sheet`} target="_blank" rel="noreferrer">
                  Print the sign-in sheet
                </a>
              </div>
            </Card>
          </>
        ) : null}

        {tab === 'deals' && payload.openHomes?.length ? (
          <Card title="Your open homes" hint="What we have on file">
            <ul className="stack stack--tight" style={{ margin: 0, paddingLeft: 18 }}>
              {payload.openHomes.map((o, i) => (
                <li key={i} className="small">{o.address} - {longDate(o.date)}{o.time ? ` ${o.time}` : ''}</li>
              ))}
            </ul>
          </Card>
        ) : null}

        <Survey token={token} payload={payload} onSubmitted={reload} />

        <p className="small muted" style={{ textAlign: 'center' }}>
          Status only. No client details, no figures. {payload.firm?.name}.
        </p>
      </div>
    </div>
  );
}
