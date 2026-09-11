// Week 1: a pasted handover becomes the record. Tab two reads a BPU milestone
// email and matches it to the right file.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { navigate } from '../router.js';
import {
  Card, Button, Field, Callout, Empty, LoadingBlock, RagChip, Chip, ProviderTag,
  CopyButton, Confidence, StagePipeline, money, shortDate, longDate,
} from '../components/ui.jsx';

const CHANNELS = [
  { value: 'email', label: 'Email' },
  { value: 'notes', label: 'Dot-point notes' },
  { value: 'voice', label: 'Voice transcript' },
];

const PURPOSES = [
  ['purchase', 'Purchase'],
  ['refinance', 'Refinance'],
  ['investment', 'Investment'],
  ['construction', 'Construction'],
  ['pre_approval', 'Pre-approval'],
  ['other', 'Other'],
];

const STAGES = [
  ['referred', 'Referred'],
  ['application', 'Application'],
  ['lodged', 'Lodged'],
  ['conditional', 'Conditional approval'],
  ['formal', 'Formal approval'],
  ['settled', 'Settled'],
  ['declined', 'Declined'],
  ['withdrawn', 'Withdrawn'],
];

const DATE_FIELDS = [
  ['contract', 'Contract date'],
  ['financeDue', 'Finance due'],
  ['settlementDue', 'Settlement due'],
  ['preApprovalExpiry', 'Pre-approval expiry'],
  ['settledAt', 'Settled on'],
];

const MAIN_LINE = ['referred', 'application', 'lodged', 'conditional', 'formal', 'settled'];

/** The same RAG rule the server applies, so the form can show it live. */
function ragFor(record) {
  const critical = [];
  const minor = [];
  const stageAt = MAIN_LINE.indexOf(record.stage);
  const lodged = stageAt >= MAIN_LINE.indexOf('lodged');
  if (!record.client?.name) critical.push('Client name');
  if (!record.broker) critical.push('Broker');
  if (!record.referredBy) critical.push('Referred by (unknown)');
  if (!record.purpose) critical.push('Purpose');
  if (record.loanAmount === null || record.loanAmount === undefined || record.loanAmount === '') critical.push('Loan amount');
  if (!record.lender && lodged) critical.push('Lender (required once lodged)');
  if (!record.propertyAddress && record.purpose === 'purchase') critical.push('Security property (required for a purchase)');
  if (record.stage === 'settled' && !record.keyDates?.settledAt) critical.push('Settlement date');

  if (!record.client?.phone) minor.push('Client phone');
  if (!record.client?.email) minor.push('Client email');
  if (!record.lender && !lodged) minor.push('Lender (not yet lodged)');
  if (!record.propertyAddress && record.purpose && record.purpose !== 'purchase' && record.purpose !== 'pre_approval') minor.push('Security property');
  const expected = record.purpose === 'purchase' || record.purpose === 'investment' || record.purpose === 'construction'
    ? ['contract', 'financeDue', 'settlementDue']
    : (record.purpose === 'refinance' || record.purpose === 'other'
      ? ['settlementDue']
      : (record.purpose === 'pre_approval' ? ['preApprovalExpiry'] : []));
  for (const key of expected) {
    if (!record.keyDates?.[key]) minor.push(DATE_FIELDS.find(([k]) => k === key)?.[1] || key);
  }
  return {
    rag: critical.length ? 'red' : (minor.length ? 'amber' : 'green'),
    missing: [...critical, ...minor],
    critical,
  };
}

function blankRecord(broker) {
  return {
    client: { name: null, phone: null, email: null },
    broker: broker || null,
    referredBy: null,
    referredByName: null,
    stage: 'referred',
    purpose: null,
    loanAmount: null,
    lender: null,
    propertyAddress: null,
    keyDates: { contract: null, financeDue: null, settlementDue: null, preApprovalExpiry: null, settledAt: null },
  };
}

function MetaLine({ meta }) {
  if (!meta) return null;
  return (
    <span className="row row--tight small muted">
      <ProviderTag provider={meta.provider} />
      <span>{meta.ms ? `${meta.ms}ms` : 'instant'}</span>
      {meta.model ? <span>{meta.model}</span> : null}
      {meta.reason ? <span>fell back: {String(meta.reason).replace(/_/g, ' ')}</span> : null}
      {meta.message ? <span>({meta.message})</span> : null}
    </span>
  );
}

function HandoverTab({ samples, partners, boot, toast }) {
  const [channel, setChannel] = useState('email');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [extraction, setExtraction] = useState(null);
  const [meta, setMeta] = useState(null);
  const [record, setRecord] = useState(null);
  const [consent, setConsent] = useState({ shareStatus: false, feeDisclosed: false });
  const [saving, setSaving] = useState(false);

  const rag = useMemo(() => (record ? ragFor(record) : null), [record]);

  const extract = useCallback(async (useAi) => {
    if (!text.trim()) {
      toast.warn('Paste the handover first.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.extract({ text, channel, useAi });
      setExtraction(result.extraction);
      setMeta(result.meta);
      setRecord({ ...blankRecord(boot?.firm?.broker), ...result.extraction.record });
      setConsent({
        shareStatus: result.extraction.suggestedConsent?.shareStatus === true,
        feeDisclosed: result.extraction.suggestedConsent?.feeDisclosed === true,
      });
      toast.ok(`Read by ${result.meta.provider === 'claude' ? 'Claude' : 'the offline rules'}. ${result.extraction.rag.toUpperCase()} on arrival.`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }, [text, channel, boot, toast]);

  const setField = (patch) => setRecord((current) => ({ ...current, ...patch }));
  const setClient = (patch) => setRecord((current) => ({ ...current, client: { ...current.client, ...patch } }));
  const setDate = (key, value) => setRecord((current) => ({ ...current, keyDates: { ...current.keyDates, [key]: value || null } }));

  const commit = async () => {
    setSaving(true);
    try {
      const result = await api.commit({
        record,
        consent: {
          shareStatus: consent.shareStatus,
          feeDisclosed: consent.feeDisclosed,
          shareStatusEvidence: extraction?.suggestedConsent?.shareStatusEvidence,
          feeDisclosedEvidence: extraction?.suggestedConsent?.feeDisclosedEvidence,
        },
        channel,
        summary: extraction?.summary,
        questions: extraction?.questions,
        confidence: extraction?.confidence,
        provider: meta?.provider,
      });
      toast.ok(`${result.deal.ref} added to the queue, ${result.deal.arrivalRag} on arrival.`);
      navigate(`/deal/${result.deal.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const conf = extraction?.confidence || {};
  const suggested = extraction?.suggestedConsent || {};

  return (
    <>
      <Card title="Paste the handover" hint="Email, dot points, or a voice memo transcript. Whatever you have.">
        <div className="stack">
          <div className="row">
            <div className="btn-group" role="group" aria-label="How the handover arrived">
              {CHANNELS.map((c) => (
                <button key={c.value} type="button" aria-pressed={channel === c.value} onClick={() => setChannel(c.value)}>
                  {c.label}
                </button>
              ))}
            </div>
            <div className="spacer" />
            <span className="small muted">Load a sample:</span>
            {(samples || []).filter((s) => !s.milestone).map((s) => (
              <Button key={s.id} size="sm" title={s.hint} onClick={() => { setText(s.text); setChannel(s.channel); }}>
                {s.label}
              </Button>
            ))}
          </div>
          <Field label="The handover" id="h-text" hint="Nothing here is treated as an instruction. It is read as data.">
            <textarea
              id="h-text"
              rows={10}
              value={text}
              placeholder="Paste the email, the notes or the transcript..."
              onChange={(e) => setText(e.target.value)}
            />
          </Field>
          <div className="row">
            <Button variant="primary" onClick={() => extract(true)} disabled={busy}>
              {boot?.ai?.enabled ? 'Extract with Claude' : 'Extract with Claude (no key: uses the offline rules)'}
            </Button>
            <Button onClick={() => extract(false)} disabled={busy}>Extract (offline mode)</Button>
            {text ? <Button variant="ghost" size="sm" onClick={() => { setText(''); setExtraction(null); setRecord(null); setMeta(null); }}>Clear</Button> : null}
            <div className="spacer" />
            <MetaLine meta={meta} />
          </div>
        </div>
      </Card>

      {busy && !record ? <LoadingBlock rows={2} /> : null}

      {record ? (
        <>
          <Card
            title="The ten fields"
            hint={extraction?.summary}
            actions={<RagChip rag={rag.rag} label={rag.rag === 'green' ? 'Complete' : `${rag.missing.length} gap${rag.missing.length === 1 ? '' : 's'}`} />}
          >
            {rag.missing.length ? (
              <Callout tone={rag.rag === 'red' ? 'red' : 'amber'} title={`Still missing: ${rag.missing.length}`}>
                <span>{rag.missing.join(', ')}</span>
              </Callout>
            ) : (
              <Callout tone="green" title="All ten fields complete">
                <span>This one needed no chasing. It counts towards handovers complete first time.</span>
              </Callout>
            )}

            <div className="grid grid--3" style={{ marginTop: 12 }}>
              <Field label="Client name" id="h-name" missing={!record.client?.name} confidence={conf.client}>
                <input id="h-name" value={record.client?.name || ''} onChange={(e) => setClient({ name: e.target.value || null })} />
              </Field>
              <Field label="Client phone" id="h-phone" missing={!record.client?.phone} confidence={conf['client.phone']}>
                <input id="h-phone" type="tel" value={record.client?.phone || ''} onChange={(e) => setClient({ phone: e.target.value || null })} />
              </Field>
              <Field label="Client email" id="h-email" missing={!record.client?.email} confidence={conf['client.email']}>
                <input id="h-email" type="email" value={record.client?.email || ''} onChange={(e) => setClient({ email: e.target.value || null })} />
              </Field>
              <Field label="Broker" id="h-broker" missing={!record.broker} confidence={conf.broker}>
                <input id="h-broker" value={record.broker || ''} onChange={(e) => setField({ broker: e.target.value || null })} />
              </Field>
              <Field label="Referred by" id="h-referrer" missing={!record.referredBy} confidence={conf.referredBy}
                hint={extraction?.partnerMatch
                  ? `Matched ${extraction.partnerMatch.name} (${Math.round((extraction.partnerMatch.score || 0) * 100)}%): ${extraction.partnerMatch.reason}`
                  : 'No partner matched. An unknown referrer is a red field.'}>
                <select id="h-referrer" value={record.referredBy || ''} onChange={(e) => setField({ referredBy: e.target.value || null })}>
                  <option value="">Still unknown</option>
                  <option value="direct">Direct (no referrer)</option>
                  {(partners || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
              <Field label="Stage" id="h-stage" confidence={conf.stage}>
                <select id="h-stage" value={record.stage || 'referred'} onChange={(e) => setField({ stage: e.target.value })}>
                  {STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Purpose" id="h-purpose" missing={!record.purpose} confidence={conf.purpose}>
                <select id="h-purpose" value={record.purpose || ''} onChange={(e) => setField({ purpose: e.target.value || null })}>
                  <option value="">Not set</option>
                  {PURPOSES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </Field>
              <Field label="Loan amount" id="h-loan" missing={record.loanAmount == null} confidence={conf.loanAmount}
                hint={record.loanAmount != null ? money(record.loanAmount) : '600k, $600,000 and "six hundred thousand" all work.'}>
                <input id="h-loan" value={record.loanAmount ?? ''} onChange={(e) => setField({ loanAmount: e.target.value === '' ? null : e.target.value })} />
              </Field>
              <Field label="Lender" id="h-lender" missing={!record.lender} confidence={conf.lender}>
                <input id="h-lender" value={record.lender || ''} onChange={(e) => setField({ lender: e.target.value || null })} />
              </Field>
              <Field label="Security property" id="h-address" missing={!record.propertyAddress} confidence={conf.propertyAddress}>
                <input id="h-address" value={record.propertyAddress || ''} onChange={(e) => setField({ propertyAddress: e.target.value || null })} />
              </Field>
              {DATE_FIELDS.map(([key, label]) => (
                <Field key={key} label={label} id={`h-${key}`} missing={!record.keyDates?.[key]} confidence={key === 'contract' ? conf.keyDates : undefined}>
                  <input id={`h-${key}`} type="date" value={record.keyDates?.[key] || ''} onChange={(e) => setDate(key, e.target.value)} />
                </Field>
              ))}
            </div>
          </Card>

          <Card title="Consent" hint="You are confirming this, not the AI. Nothing reaches the partner without it.">
            <div className="stack">
              <label className="check">
                <input type="checkbox" checked={consent.shareStatus} onChange={(e) => setConsent((c) => ({ ...c, shareStatus: e.target.checked }))} />
                <span className="check__body">
                  <span>Client has agreed we can share deal status with the referrer</span>
                  {suggested.shareStatusEvidence
                    ? <span className="check__evidence">Matched: &ldquo;{suggested.shareStatusEvidence}&rdquo;</span>
                    : <span className="field__note">Nothing in the text says they agreed, so this stays unticked.</span>}
                </span>
              </label>
              <label className="check">
                <input type="checkbox" checked={consent.feeDisclosed} onChange={(e) => setConsent((c) => ({ ...c, feeDisclosed: e.target.checked }))} />
                <span className="check__body">
                  <span>Referral fee disclosed to the client</span>
                  {suggested.feeDisclosedEvidence
                    ? <span className="check__evidence">Matched: &ldquo;{suggested.feeDisclosedEvidence}&rdquo;</span>
                    : <span className="field__note">Statements flag every line where this is not recorded.</span>}
                </span>
              </label>
            </div>
          </Card>

          {(extraction?.questions || []).length ? (
            <Card title="Questions for the broker" hint="Specific, and only about what is actually missing">
              <div className="stack">
                {extraction.questions.map((q, i) => (
                  <div className="row" key={i}>
                    <span style={{ flex: 1, minWidth: 200 }}>{i + 1}. {q}</span>
                    <CopyButton value={q} label="Copy" />
                  </div>
                ))}
                <div className="row row--end">
                  <CopyButton value={extraction.questions.join('\n')} label="Copy all questions" size={undefined} />
                </div>
              </div>
            </Card>
          ) : null}

          <Card>
            <div className="row">
              <span className="small muted">
                It lands in the processing queue with its RAG. The RAG on arrival is recorded, because that is the metric.
              </span>
              <div className="spacer" />
              <Button variant="primary" onClick={commit} disabled={saving}>Add to queue</Button>
            </div>
          </Card>
        </>
      ) : null}
    </>
  );
}

function MilestoneTab({ samples, toast }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [chosen, setChosen] = useState('');
  const [eventDate, setEventDate] = useState('');
  const [stage, setStage] = useState('');
  const [applying, setApplying] = useState(false);

  const read = async (useAi) => {
    if (!text.trim()) {
      toast.warn('Paste the BPU email first.');
      return;
    }
    setBusy(true);
    try {
      const payload = await api.parseMilestone({ text, useAi });
      setResult(payload);
      setChosen(payload.parsed.dealId || '');
      setEventDate(payload.parsed.eventDate || '');
      setStage(payload.parsed.stage || '');
      if (payload.parsed.noMilestone) toast.warn('That email reports no milestone. Nothing to apply.');
      else toast.ok(`Read as ${payload.parsed.stage}. ${payload.parsed.dealId ? 'Matched a file.' : 'No confident match.'}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    setApplying(true);
    try {
      const payload = await api.applyMilestone({
        dealId: chosen,
        stage,
        eventDate,
        keyDates: result?.parsed?.keyDates,
        provider: result?.parsed?.provider,
      });
      toast.ok(`${payload.deal.ref} moved to ${payload.to}. Draft the partner update on the deal.`);
      navigate(`/deal/${payload.deal.id}`);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setApplying(false);
    }
  };

  const parsed = result?.parsed;
  const alternates = result?.alternates || [];

  return (
    <>
      <Card title="Paste the BPU milestone email" hint="The processing team already emails every milestone. This turns it into a stage change.">
        <div className="stack">
          <div className="row">
            <span className="small muted">Load a sample:</span>
            {(samples || []).filter((s) => s.milestone).map((s) => (
              <Button key={s.id} size="sm" title={s.hint} onClick={() => { setText(s.text); setResult(null); }}>{s.label}</Button>
            ))}
          </div>
          <Field label="The email" id="m-text">
            <textarea id="m-text" rows={9} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste the milestone email..." />
          </Field>
          <div className="row">
            <Button variant="primary" onClick={() => read(true)} disabled={busy}>Read this email</Button>
            <Button onClick={() => read(false)} disabled={busy}>Read it offline</Button>
            <div className="spacer" />
            <MetaLine meta={result?.meta} />
          </div>
        </div>
      </Card>

      {busy && !result ? <LoadingBlock rows={2} /> : null}

      {parsed ? (
        parsed.noMilestone ? (
          <Card title="No milestone in that email">
            <Callout tone="amber" title="Nothing to apply">
              <span>
                That email says nothing has changed, so the tool will not invent a stage. {parsed.reason}
              </span>
            </Callout>
          </Card>
        ) : (
          <Card title="What it read" actions={<ProviderTag provider={parsed.provider} />}>
            <div className="stack">
              <div className="row">
                <Field label="Milestone" id="m-stage">
                  <select id="m-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
                    {STAGES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                  </select>
                </Field>
                <Field label="Date it happened" id="m-date">
                  <input id="m-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
                </Field>
                <div className="spacer" />
                <div className="stat">
                  <span className="stat__label">Match confidence</span>
                  <span className="stat__value">{Math.round((parsed.score || 0) * 100)}%</span>
                </div>
              </div>

              {Object.entries(parsed.keyDates || {}).some(([, v]) => v) ? (
                <Callout tone="teal" title="Dates it found">
                  <span>
                    {Object.entries(parsed.keyDates)
                      .filter(([, v]) => v)
                      .map(([k, v]) => `${DATE_FIELDS.find(([key]) => key === k)?.[1] || k}: ${longDate(v)}`)
                      .join(' · ')}
                  </span>
                </Callout>
              ) : null}

              {!parsed.dealId ? (
                <Callout tone="amber" title="No file was linked automatically">
                  <span>{parsed.reason}</span>
                </Callout>
              ) : null}

              <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
                <legend className="card__hint" style={{ marginBottom: 8 }}>Which file is this?</legend>
                <div className="stack stack--tight">
                  {alternates.length ? alternates.map((alt) => (
                    <label className="check" key={alt.dealId}>
                      <input
                        type="radio"
                        name="milestone-deal"
                        value={alt.dealId}
                        checked={chosen === alt.dealId}
                        onChange={() => setChosen(alt.dealId)}
                      />
                      <span className="check__body">
                        <span>
                          <span className="mono">{alt.ref}</span> {alt.clientLabel}
                          {alt.address ? ` - ${alt.address}` : ''}
                          {alt.stageLabel ? <Chip tone="neutral">{alt.stageLabel}</Chip> : null}
                        </span>
                        <span className="field__note">
                          {Math.round((alt.score || 0) * 100)}% - {alt.reason}
                          {alt.surnameOnly ? ' (a surname alone is never enough to link)' : ''}
                        </span>
                      </span>
                    </label>
                  )) : <Empty>No open deal looked like a match.</Empty>}
                </div>
              </fieldset>

              <div className="row row--end">
                <Button variant="primary" onClick={apply} disabled={!chosen || !stage || applying}>
                  Apply to this file
                </Button>
              </div>
            </div>
          </Card>
        )
      ) : null}

      {result?.matched ? (
        <Card title="The matched file" hint="Check it before you apply">
          <div className="stack">
            <div className="row">
              <strong>{result.matched.clientLabel}</strong>
              <RagChip rag={result.matched.rag} />
              <span className="muted small">{result.matched.propertyAddress}</span>
            </div>
            <StagePipeline
              pipeline={['referred', 'application', 'lodged', 'conditional', 'formal', 'settled'].map((key, i) => ({
                key,
                label: STAGES.find(([s]) => s === key)?.[1] || key,
                done: i < MAIN_LINE.indexOf(result.matched.stage),
                current: key === result.matched.stage,
              }))}
            />
            <span className="small muted">
              Referred by {result.matched.partnerName || 'nobody recorded'}
              {result.matched.nextMilestone ? ` · next: ${result.matched.nextMilestone.label} ${shortDate(result.matched.nextMilestone.date)}` : ''}
            </span>
          </div>
        </Card>
      ) : null}
    </>
  );
}

export default function HandoverPage() {
  const { boot, toast } = useApp();
  const [tab, setTab] = useState('handover');
  const { data: samples } = useAsync(() => api.samples(), []);
  const { data: partnerData } = useAsync(() => api.partners(), []);

  return (
    <>
      <Card>
        <div className="card__head" style={{ marginBottom: 0 }}>
          <div className="btn-group" role="group" aria-label="Handover or milestone">
            <button type="button" aria-pressed={tab === 'handover'} onClick={() => setTab('handover')}>Handover</button>
            <button type="button" aria-pressed={tab === 'milestone'} onClick={() => setTab('milestone')}>BPU milestone</button>
          </div>
          <span className="card__hint">
            {tab === 'handover'
              ? 'The handover creates the record. Ten fields, a RAG, and the questions worth asking.'
              : 'A milestone email becomes a stage change on the right file, and then a partner update.'}
          </span>
        </div>
      </Card>

      {tab === 'handover'
        ? <HandoverTab samples={samples?.samples} partners={partnerData?.partners} boot={boot} toast={toast} />
        : <MilestoneTab samples={samples?.samples} toast={toast} />}
    </>
  );
}
