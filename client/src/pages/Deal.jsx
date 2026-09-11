// The one record. Ten fields inline-edit, the partner update with its
// compliance report, stage moves, consent, commission, notes and timeline.

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { href, navigate } from '../router.js';
import {
  Card, Button, LinkButton, RagChip, Chip, ProviderTag, Field, Callout, Empty,
  LoadingBlock, Modal, ComplianceReport, HighlightedText, StagePipeline, CopyButton,
  money, shortDate, longDate, stampLabel, relativeDays,
} from '../components/ui.jsx';

const STAGE_LABELS = {
  referred: 'Referred',
  application: 'Application',
  lodged: 'Lodged',
  conditional: 'Conditional approval',
  formal: 'Formal approval',
  settled: 'Settled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

const PURPOSE_LABELS = {
  purchase: 'Purchase',
  refinance: 'Refinance',
  investment: 'Investment',
  construction: 'Construction',
  pre_approval: 'Pre-approval',
  other: 'Other',
};

const DATE_FIELDS = [
  ['contract', 'Contract date'],
  ['financeDue', 'Finance due'],
  ['settlementDue', 'Settlement due'],
  ['preApprovalExpiry', 'Pre-approval expiry'],
  ['settledAt', 'Settled on'],
];

function pipelineFor(deal, stages) {
  const at = stages.indexOf(deal.stage);
  const offRamp = at < 0;
  return stages.map((key, i) => ({
    key,
    label: STAGE_LABELS[key] || key,
    done: !offRamp && at >= 0 && i < at,
    current: !offRamp && i === at,
  }));
}

/** One inline-editable field: saves on blur or Enter, reverts on Escape. */
function InlineField({ label, value, missing, confidence, onSave, type = 'text', options, placeholder, hint, id }) {
  const [draft, setDraft] = useState(value ?? '');
  const [saving, setSaving] = useState(false);
  useEffect(() => { setDraft(value ?? ''); }, [value]);

  const commit = useCallback(async () => {
    const next = typeof draft === 'string' ? draft.trim() : draft;
    if ((next || '') === ((value ?? '') || '')) return;
    setSaving(true);
    try {
      await onSave(next === '' ? null : next);
    } finally {
      setSaving(false);
    }
  }, [draft, value, onSave]);

  const onKeyDown = (event) => {
    if (event.key === 'Enter' && type !== 'textarea') {
      event.preventDefault();
      event.currentTarget.blur();
    }
    if (event.key === 'Escape') {
      setDraft(value ?? '');
      event.currentTarget.blur();
    }
  };

  return (
    <Field label={label} missing={missing} confidence={confidence} hint={hint} id={id}>
      {options ? (
        <select id={id} value={draft ?? ''} onChange={(e) => setDraft(e.target.value)} onBlur={commit} disabled={saving}>
          <option value="">Not set</option>
          {options.map((opt) => <option key={opt.value} value={opt.value}>{opt.label}</option>)}
        </select>
      ) : (
        <input
          id={id}
          type={type}
          value={draft ?? ''}
          placeholder={placeholder}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          disabled={saving}
        />
      )}
    </Field>
  );
}

function TenFields({ deal, partners, onPatch }) {
  const missing = new Set(deal.ragDetail?.missingFields || []);
  const conf = deal.confidence || {};
  return (
    <div className="grid grid--3">
      <InlineField id="f-client" label="Client name" value={deal.client?.name} missing={missing.has('client')}
        confidence={conf.client} onSave={(v) => onPatch({ client: { name: v } })} />
      <InlineField id="f-phone" label="Client phone" value={deal.client?.phone} missing={missing.has('client.phone')}
        confidence={conf['client.phone']} type="tel" onSave={(v) => onPatch({ client: { phone: v } })} />
      <InlineField id="f-email" label="Client email" value={deal.client?.email} missing={missing.has('client.email')}
        confidence={conf['client.email']} type="email" onSave={(v) => onPatch({ client: { email: v } })} />
      <InlineField id="f-broker" label="Broker" value={deal.broker} missing={missing.has('broker')}
        confidence={conf.broker} onSave={(v) => onPatch({ broker: v })} />
      <InlineField id="f-referrer" label="Referred by" value={deal.referredBy || ''} missing={missing.has('referredBy')}
        confidence={conf.referredBy}
        options={[{ value: 'direct', label: 'Direct (no referrer)' }, ...partners.map((p) => ({ value: p.id, label: p.name }))]}
        hint={deal.referredBy ? undefined : 'Unknown referrer is a red field: the commission cannot be worked out without it.'}
        onSave={(v) => onPatch({ referredBy: v })} />
      <InlineField id="f-purpose" label="Purpose" value={deal.purpose} missing={missing.has('purpose')}
        confidence={conf.purpose}
        options={Object.entries(PURPOSE_LABELS).map(([value, label]) => ({ value, label }))}
        onSave={(v) => onPatch({ purpose: v })} />
      <InlineField id="f-loan" label="Loan amount" value={deal.loanAmount ?? ''} missing={missing.has('loanAmount')}
        confidence={conf.loanAmount} placeholder="600k or 600000"
        onSave={(v) => onPatch({ loanAmount: v })} />
      <InlineField id="f-lender" label="Lender" value={deal.lender} missing={missing.has('lender')}
        confidence={conf.lender} onSave={(v) => onPatch({ lender: v })} />
      <InlineField id="f-address" label="Security property" value={deal.propertyAddress} missing={missing.has('propertyAddress')}
        confidence={conf.propertyAddress} onSave={(v) => onPatch({ propertyAddress: v })} />
      {DATE_FIELDS.map(([key, label]) => (
        <InlineField
          key={key}
          id={`f-${key}`}
          label={label}
          value={deal.keyDates?.[key] || ''}
          missing={missing.has(`keyDates.${key}`)}
          type="date"
          onSave={(v) => onPatch({ keyDates: { [key]: v } })}
        />
      ))}
    </div>
  );
}

function ConsentBlock({ deal, onConsent }) {
  const consent = deal.consent || {};
  return (
    <div className="stack">
      <label className="check">
        <input
          type="checkbox"
          checked={consent.shareStatus === true}
          onChange={(e) => onConsent({ shareStatus: e.target.checked })}
        />
        <span className="check__body">
          <span>Client has agreed we can share deal status with the referrer</span>
          {consent.shareStatusEvidence
            ? <span className="check__evidence">&ldquo;{consent.shareStatusEvidence}&rdquo;</span>
            : <span className="field__note">Nothing reaches the partner until this is ticked.</span>}
          {consent.shareStatusAt ? <span className="field__note">Recorded {stampLabel(consent.shareStatusAt)}</span> : null}
        </span>
      </label>
      <label className="check">
        <input
          type="checkbox"
          checked={consent.feeDisclosed === true}
          onChange={(e) => onConsent({ feeDisclosed: e.target.checked })}
        />
        <span className="check__body">
          <span>Referral fee disclosed to the client</span>
          {consent.feeDisclosedEvidence
            ? <span className="check__evidence">&ldquo;{consent.feeDisclosedEvidence}&rdquo;</span>
            : <span className="field__note">Statements flag any line where this is not recorded.</span>}
          {consent.feeDisclosedAt ? <span className="field__note">Recorded {stampLabel(consent.feeDisclosedAt)}</span> : null}
        </span>
      </label>
    </div>
  );
}

function UpdateComposer({ deal, onSent }) {
  const { toast, boot } = useApp();
  const [draft, setDraft] = useState(null);
  const [meta, setMeta] = useState(null);
  const [gate, setGate] = useState(null);
  const [partner, setPartner] = useState(null);
  const [compliance, setCompliance] = useState(null);
  const [busy, setBusy] = useState(false);
  const [sending, setSending] = useState(false);
  const [stage, setStage] = useState(deal.stage);
  const [eventDate, setEventDate] = useState(deal.stageEnteredAt ? String(deal.stageEnteredAt).slice(0, 10) : (boot?.today || ''));

  const load = useCallback(async (useAi) => {
    setBusy(true);
    try {
      const result = await api.draftUpdate(deal.id, { stage, eventDate, useAi });
      setDraft(result.draft);
      setCompliance(result.compliance);
      setGate(result.gate);
      setPartner(result.partner);
      setMeta(result.meta);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }, [deal.id, stage, eventDate, toast]);

  useEffect(() => { load(Boolean(boot?.ai?.enabled)); /* eslint-disable-next-line */ }, [deal.id, deal.stage, deal.updatedAt]);

  const recheck = useCallback(async (next) => {
    try {
      const result = await api.checkDraft(deal.id, { sms: next.sms, emailBody: next.emailBody });
      setCompliance(result.compliance);
    } catch {
      // the send path re-checks server side anyway
    }
  }, [deal.id]);

  const edit = (patch) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    recheck(next);
  };

  const send = async (channels) => {
    setSending(true);
    try {
      const result = await api.sendUpdate(deal.id, {
        sms: draft.sms,
        emailSubject: draft.emailSubject,
        emailBody: draft.emailBody,
        channels,
        stage,
        eventDate,
        provider: draft.provider,
      });
      const links = (result.message.deliveries || []).map((d) => d.link).filter(Boolean);
      toast.ok(`Sent to ${result.message.partnerName} by ${channels.join(' and ')}.${links.length ? ' Links are on the timeline.' : ''}`);
      onSent(result.deal);
    } catch (err) {
      if (err instanceof ApiError && err.payload?.compliance) {
        setCompliance(err.payload.compliance);
      }
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  };

  if (busy && !draft) return <LoadingBlock rows={2} title={false} />;
  if (!draft) return <Empty>No draft yet.</Empty>;

  const smsBlocked = !compliance?.sms?.ok;
  const emailBlocked = !compliance?.email?.ok;
  const blockedReason = smsBlocked
    ? 'The SMS carries a figure or a financial detail. Edit it first.'
    : (emailBlocked ? 'The email carries a figure or a financial detail. Edit it first.' : null);
  const gateBlocked = gate && !gate.ok;
  const disabledReason = gateBlocked ? gate.message : blockedReason;

  return (
    <div className="stack">
      {gateBlocked ? (
        <Callout tone="red" title="Nothing can be sent yet">
          <span>{gate.message}</span>
        </Callout>
      ) : null}

      <div className="row">
        <div className="field" style={{ minWidth: 180 }}>
          <label htmlFor="u-stage">Update about</label>
          <select id="u-stage" value={stage} onChange={(e) => setStage(e.target.value)}>
            {Object.entries(STAGE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </div>
        <div className="field" style={{ minWidth: 150 }}>
          <label htmlFor="u-date">Milestone date</label>
          <input id="u-date" type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} />
        </div>
        <div className="spacer" />
        <Button size="sm" onClick={() => load(false)} disabled={busy}>Redraft offline</Button>
        <Button size="sm" variant="primary" onClick={() => load(true)} disabled={busy || !boot?.ai?.enabled}
          title={boot?.ai?.enabled ? 'Draft with Claude' : 'No API key: the template draft is what you get'}>
          Redraft with Claude
        </Button>
      </div>

      <div className="grid grid--2">
        <div className="stack">
          <div className="card__head" style={{ marginBottom: 0 }}>
            <h3>SMS</h3>
            <ProviderTag provider={draft.provider} />
            <span className="card__hint">{(draft.sms || '').length} / 320 characters</span>
          </div>
          <div className={`bubble${smsBlocked ? ' bubble--blocked' : ''}`}>
            <HighlightedText text={draft.sms} hits={compliance?.sms?.hits || []} />
          </div>
          <Field label="Edit the SMS" id="u-sms">
            <textarea id="u-sms" value={draft.sms} rows={4} onChange={(e) => edit({ sms: e.target.value })} />
          </Field>
          <ComplianceReport result={compliance?.sms} label="SMS check" />
        </div>

        <div className="stack">
          <div className="card__head" style={{ marginBottom: 0 }}>
            <h3>Email</h3>
            <ProviderTag provider={draft.provider} />
          </div>
          <div className="email-card">
            <div className="email-card__head">
              <strong>To:</strong> {partner?.email || 'no email on file'} &middot; <strong>Subject:</strong> {draft.emailSubject}
            </div>
            <div className="email-card__body">
              <HighlightedText text={draft.emailBody} hits={compliance?.email?.hits || []} />
            </div>
          </div>
          <Field label="Subject" id="u-subject">
            <input id="u-subject" value={draft.emailSubject} onChange={(e) => edit({ emailSubject: e.target.value })} />
          </Field>
          <Field label="Edit the email" id="u-body">
            <textarea id="u-body" value={draft.emailBody} rows={8} onChange={(e) => edit({ emailBody: e.target.value })} />
          </Field>
          <ComplianceReport result={compliance?.email} label="Email check" />
        </div>
      </div>

      <div className="row">
        <Button
          variant="primary"
          onClick={() => send(['sms'])}
          disabled={sending || Boolean(disabledReason) || !partner?.phone}
          title={disabledReason || (partner?.phone ? `Send to ${partner.phone}` : 'No mobile number on file for this partner')}
        >
          Send SMS
        </Button>
        <Button
          variant="navy"
          onClick={() => send(['sms', 'email'])}
          disabled={sending || Boolean(disabledReason) || !partner?.phone || !partner?.email}
          title={disabledReason || 'Send both the SMS and the email'}
        >
          Send both
        </Button>
        <CopyButton value={draft.sms} label="Copy SMS" size="sm" onCopied={() => toast.ok('SMS copied')} />
        {disabledReason ? <span className="small" style={{ color: 'var(--red)' }}>{disabledReason}</span> : null}
        {meta ? (
          <span className="small muted">
            Drafted by {meta.provider === 'claude' ? `Claude (${meta.ms}ms)` : (meta.provider === 'template' ? 'the deterministic template' : meta.provider)}
            {meta.reason ? ` - ${meta.reason.replace(/_/g, ' ')}` : ''}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function CommissionBox({ deal, onRecompute }) {
  const c = deal.commission || {};
  const statusLabels = {
    not_applicable: 'No referral commission',
    pending: 'Pending settlement',
    due: 'Due',
    on_statement: 'On a statement',
    paid: 'Paid',
    void: 'Void',
  };
  return (
    <div className="stack">
      <div className="row">
        <div className="stat stat--teal">
          <span className="stat__label">{c.recordedAmount != null ? 'Recorded' : 'Projected at settlement'}</span>
          <span className="stat__value">{money(c.recordedAmount ?? c.projectedAmount)}</span>
          <span className="stat__note">{c.recordedAmount != null ? 'Locked in at settlement' : 'What this will pay when it settles'}</span>
        </div>
        <div className="spacer" />
        <Chip tone={c.status === 'paid' ? 'green' : (c.status === 'due' ? 'amber' : 'neutral')}>
          {statusLabels[c.status] || c.status}
        </Chip>
      </div>
      <dl className="stack stack--tight small" style={{ margin: 0 }}>
        <div className="row row--tight"><dt className="muted">Rule</dt><dd style={{ margin: 0 }}>{c.ruleName || 'None in effect'}{c.ruleId ? <span className="mono muted"> ({c.ruleId})</span> : null}</dd></div>
        <div className="row row--tight"><dt className="muted">Basis</dt><dd style={{ margin: 0 }}>{c.basis || '-'}</dd></div>
        {c.statementId ? <div className="row row--tight"><dt className="muted">Statement</dt><dd style={{ margin: 0 }}><a href={href(`/statement/${c.statementId}`)}>{c.statementId}</a></dd></div> : null}
        {c.paidAt ? <div className="row row--tight"><dt className="muted">Paid</dt><dd style={{ margin: 0 }}>{longDate(c.paidAt)}</dd></div> : null}
      </dl>
      {(c.anomalies || []).length ? (
        <Callout tone="amber" title="Flagged">
          <ul className="compliance__list">{c.anomalies.map((a, i) => <li key={i}>{a.label}</li>)}</ul>
        </Callout>
      ) : null}
      <div className="row">
        <Button size="sm" onClick={onRecompute}>Recompute from the rules</Button>
      </div>
    </div>
  );
}

function Timeline({ deal }) {
  const events = [...(deal.timeline || [])].reverse();
  if (!events.length) return <Empty>Nothing has happened yet.</Empty>;
  return (
    <div className="timeline">
      {events.map((event) => (
        <div className="timeline__item" key={event.id}>
          <span className={`timeline__dot${event.actor === 'system' ? ' timeline__dot--system' : ''}${event.type === 'enquiry_logged' ? ' timeline__dot--warn' : ''}`} />
          <div className="timeline__body">
            <span>{event.message}</span>
            <span className="timeline__meta">
              {stampLabel(event.at)} &middot; {event.type.replace(/_/g, ' ')} &middot; {event.actor}
              {event.meta?.provider ? <> &middot; <ProviderTag provider={event.meta.provider} /></> : null}
            </span>
            {event.meta?.deliveries?.length ? (
              <span className="row row--tight small">
                {event.meta.deliveries.map((d, i) => (d.link
                  ? <a key={i} href={d.link} className="btn btn--sm">{d.channel === 'sms' ? 'Open in Messages' : 'Open in Mail'}</a>
                  : <Chip key={i} tone={d.ok ? 'green' : 'red'}>{d.channel} {d.ok ? 'sent' : 'failed'}</Chip>))}
              </span>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

export default function DealPage({ id }) {
  const { boot, toast, refreshPulse } = useApp();
  const { data, setData, loading, error, reload } = useAsync(() => api.deal(id), [id]);
  const [stageModal, setStageModal] = useState(false);
  const [enquiryModal, setEnquiryModal] = useState(false);
  const [reopenModal, setReopenModal] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [nextStage, setNextStage] = useState('');
  const [stageDate, setStageDate] = useState(boot?.today || '');
  const [enquiryKind, setEnquiryKind] = useState('where_is_my_deal');
  const [enquiryNote, setEnquiryNote] = useState('');

  // While a different deal loads, data still holds the previous one. Rendering
  // that would show one deal's fields under another deal's heading.
  const deal = data?.deal?.id === id ? data.deal : null;
  const partners = data?.partners || [];

  const apply = useCallback((updated) => {
    setData((current) => ({ ...(current || {}), deal: updated }));
    refreshPulse();
  }, [setData, refreshPulse]);

  const patch = useCallback(async (body) => {
    try {
      const result = await api.patchDeal(id, body);
      apply(result.deal);
      if (result.changes?.length) toast.ok(`Saved: ${result.changes.map((c) => c.field).join(', ')}`);
    } catch (err) {
      toast.error(err.message);
      reload();
    }
  }, [id, apply, toast, reload]);

  const consent = useCallback(async (body) => {
    try {
      const result = await api.setConsent(id, body);
      apply(result.deal);
      toast.ok('Consent updated on the record.');
    } catch (err) {
      toast.error(err.message);
    }
  }, [id, apply, toast]);

  if (!deal && !error) return <LoadingBlock rows={4} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not load this deal">
        <span>{error.message}</span>
        <div className="row">
          <Button size="sm" variant="primary" onClick={reload}>Try again</Button>
          <LinkButton to="/" size="sm">Back to the queue</LinkButton>
        </div>
      </Callout>
    );
  }
  if (!deal) return <Empty>That deal is not in the register. <a href={href('/')}>Back to the queue</a>.</Empty>;

  const stages = boot?.stages || [];
  const offRamp = !stages.includes(deal.stage);
  const missing = deal.ragDetail?.missing || [];

  return (
    <>
      <Card>
        <div className="card__head">
          <div className="stack stack--tight" style={{ marginRight: 'auto' }}>
            <div className="row row--tight">
              <h2>{deal.clientLabel}</h2>
              <RagChip rag={deal.rag} />
              {deal.arrivalRag ? <Chip tone="neutral" title="RAG when the handover arrived, which is what the metric counts">{deal.arrivalRag} on arrival</Chip> : null}
              <span className="mono muted">{deal.ref}</span>
            </div>
            <span className="small muted">
              {deal.propertyAddress || 'No security property recorded'}
              {deal.partnerName ? <> &middot; referred by <a href={href(`/partner/${deal.referredBy}`)}>{deal.partnerName}</a></> : ' · no referrer recorded'}
              {deal.channel ? ` · arrived by ${deal.channel}` : ''}
            </span>
          </div>
          <Button size="sm" onClick={() => { setNextStage(''); setStageModal(true); }}>Move stage</Button>
          {deal.stage === 'settled' ? <Button size="sm" onClick={() => setReopenModal(true)}>Reopen</Button> : null}
          <Button size="sm" onClick={() => setEnquiryModal(true)} title="Count a where-is-my-deal call against the metric">Log enquiry</Button>
        </div>
        <div className="row">
          <StagePipeline pipeline={pipelineFor(deal, stages)} stage={STAGE_LABELS[deal.stage]} offRamp={offRamp} />
          {deal.daysInStage != null ? <span className="small muted">{deal.daysInStage} days in this stage</span> : null}
          {deal.nextMilestone ? (
            <span className="small muted">
              Next: {deal.nextMilestone.label} {shortDate(deal.nextMilestone.date)} ({relativeDays(deal.nextMilestone.daysAway)})
            </span>
          ) : null}
        </div>
        {missing.length ? (
          <Callout tone={deal.rag === 'red' ? 'red' : 'amber'} title={`${missing.length} field${missing.length === 1 ? '' : 's'} still missing`}>
            <span>{missing.join(', ')}</span>
          </Callout>
        ) : (
          <Callout tone="green" title="All ten fields complete">
            <span>This record needed no chasing.</span>
          </Callout>
        )}
      </Card>

      {(deal.questions || []).length ? (
        <Card title="Questions for the broker" hint="Straight from the handover">
          <ol className="stack stack--tight" style={{ paddingLeft: 18, margin: 0 }}>
            {deal.questions.map((q, i) => <li key={i}>{q}</li>)}
          </ol>
          <div className="row" style={{ marginTop: 10 }}>
            <CopyButton value={deal.questions.join('\n')} label="Copy all questions" onCopied={() => toast.ok('Questions copied')} />
          </div>
        </Card>
      ) : null}

      <Card title="The ten fields" hint="Edit any field: it saves on Enter or when you click away">
        <TenFields deal={deal} partners={partners} onPatch={patch} />
      </Card>

      <div className="grid grid--2">
        <Card title="Consent" hint="A human ticks these, never the AI">
          <ConsentBlock deal={deal} onConsent={consent} />
        </Card>
        <Card title="Referral commission">
          <CommissionBox
            deal={deal}
            onRecompute={async () => {
              try {
                const result = await api.recomputeComms(id);
                apply(result.deal);
                toast.ok('Commission recomputed from the rules in effect.');
              } catch (err) {
                toast.error(err.message);
              }
            }}
          />
        </Card>
      </div>

      <Card title="Partner update" hint="Status only. The guard runs on every draft and every edit.">
        {deal.referredBy && deal.referredBy !== 'direct'
          ? <UpdateComposer key={deal.id} deal={deal} onSent={apply} />
          : <Empty>This deal has no referring partner, so there is nobody to update.</Empty>}
      </Card>

      <div className="grid grid--2">
        <Card title="Notes" hint="Internal only, never sent">
          <div className="stack">
            {(deal.notes || []).length
              ? [...deal.notes].reverse().map((note) => (
                <div className="callout" key={note.id}>
                  <span>{note.text}</span>
                  <span className="field__note">{stampLabel(note.at)} &middot; {note.author}</span>
                </div>
              ))
              : <Empty>No notes yet.</Empty>}
            <Field label="Add a note" id="d-note">
              <textarea
                id="d-note"
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                onKeyDown={async (e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault();
                    e.currentTarget.blur();
                  }
                }}
              />
            </Field>
            <div className="row row--end">
              <Button
                variant="primary"
                size="sm"
                disabled={!noteText.trim()}
                onClick={async () => {
                  try {
                    const result = await api.addNote(id, { text: noteText });
                    apply(result.deal);
                    setNoteText('');
                    toast.ok('Note saved on the record.');
                  } catch (err) {
                    toast.error(err.message);
                  }
                }}
              >
                Save note
              </Button>
            </div>
          </div>
        </Card>

        <Card title="Timeline" hint="Every mutation lands here">
          <Timeline deal={deal} />
        </Card>
      </div>

      {stageModal ? (
        <Modal title="Move stage" onClose={() => setStageModal(false)}>
          <Field label="New stage" id="m-stage">
            <select id="m-stage" value={nextStage} onChange={(e) => setNextStage(e.target.value)}>
              <option value="">Pick a stage</option>
              {Object.entries(STAGE_LABELS)
                .filter(([value]) => value !== deal.stage)
                .map(([value, label]) => <option key={value} value={value}>{label}</option>)}
            </select>
          </Field>
          <Field label="Date the milestone happened" id="m-date" hint="A backdated milestone is named by date in the partner message.">
            <input id="m-date" type="date" value={stageDate} onChange={(e) => setStageDate(e.target.value)} />
          </Field>
          <div className="row row--end">
            <Button onClick={() => setStageModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!nextStage}
              onClick={async () => {
                try {
                  const result = await api.moveStage(id, { stage: nextStage, eventDate: stageDate });
                  apply(result.deal);
                  setStageModal(false);
                  toast.ok(`Moved to ${STAGE_LABELS[nextStage]}. Draft the partner update below.`);
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Move stage
            </Button>
          </div>
        </Modal>
      ) : null}

      {reopenModal ? (
        <Modal title="Reopen this settled deal" onClose={() => setReopenModal(false)}>
          <Callout tone="amber" title="This clears the settlement date and the commission">
            <span>Any draft statement line for this deal is removed. If the deal is on an issued statement, void that first.</span>
          </Callout>
          <Field label="Why is it being reopened?" id="m-reason">
            <input id="m-reason" value={enquiryNote} onChange={(e) => setEnquiryNote(e.target.value)} placeholder="Settlement was rebooked" />
          </Field>
          <div className="row row--end">
            <Button onClick={() => setReopenModal(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  const result = await api.reopen(id, { stage: 'formal', reason: enquiryNote });
                  apply(result.deal);
                  setReopenModal(false);
                  setEnquiryNote('');
                  toast.ok(result.removedFromStatements?.length
                    ? `Reopened. Removed from draft statement ${result.removedFromStatements.join(', ')}.`
                    : 'Reopened. Commission cleared.');
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Reopen the deal
            </Button>
          </div>
        </Modal>
      ) : null}

      {enquiryModal ? (
        <Modal title="Log a partner enquiry" onClose={() => setEnquiryModal(false)}>
          <Callout tone="teal">
            <span>This is the metric the tool is trying to kill: &ldquo;where is my deal, where is my comm?&rdquo;</span>
          </Callout>
          <Field label="What did they ask?" id="m-kind">
            <select id="m-kind" value={enquiryKind} onChange={(e) => setEnquiryKind(e.target.value)}>
              <option value="where_is_my_deal">Where is my deal?</option>
              <option value="where_is_my_comm">Where is my commission?</option>
              <option value="other">Something else</option>
            </select>
          </Field>
          <Field label="Note (optional)" id="m-enote">
            <input id="m-enote" value={enquiryNote} onChange={(e) => setEnquiryNote(e.target.value)} />
          </Field>
          <div className="row row--end">
            <Button onClick={() => setEnquiryModal(false)}>Cancel</Button>
            <Button
              variant="primary"
              onClick={async () => {
                try {
                  const result = await api.logEnquiry(id, { kind: enquiryKind, note: enquiryNote });
                  apply(result.deal);
                  setEnquiryModal(false);
                  setEnquiryNote('');
                  toast.ok('Enquiry logged against the metric.');
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Log it
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
