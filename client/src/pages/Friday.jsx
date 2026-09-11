// The Friday note. A per-partner scoreboard from the register, the office's
// open homes, and a nudge the broker approves before it goes.

import React, { useCallback, useState } from 'react';
import { api, ApiError } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import {
  Card, Button, Chip, Callout, Empty, LoadingBlock, ComplianceReport, ProviderTag,
  Field, CopyButton, longDate, shortDate,
} from '../components/ui.jsx';

const SMS_MAX = 320;

function FridayCard({ card, saturdayLabel }) {
  const { toast } = useApp();
  const [sms, setSms] = useState(card.nudge?.sms || '');
  const [provider, setProvider] = useState(card.nudge?.provider || 'template');
  const [compliance, setCompliance] = useState(card.compliance || null);
  const [meta, setMeta] = useState(card.meta || null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const redraft = useCallback(async (useAi) => {
    setBusy(true);
    try {
      const result = await api.draftNudge(card.partnerId, { useAi });
      setSms(result.nudge.sms);
      setProvider(result.nudge.provider);
      setCompliance(result.compliance);
      setMeta(result.meta);
      setSent(false);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }, [card.partnerId, toast]);

  const send = async () => {
    setBusy(true);
    try {
      const result = await api.sendNudge(card.partnerId, { sms, provider });
      const link = result.message?.deliveries?.[0]?.link;
      setSent(true);
      toast.ok(`Nudge sent to ${card.partnerName}.${link ? ' Open it on your phone from the timeline link.' : ''}`);
    } catch (err) {
      if (err instanceof ApiError && err.payload?.compliance) setCompliance(err.payload.compliance);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const blocked = compliance && compliance.ok === false;
  const tooLong = sms.length > SMS_MAX;
  const noPhone = !card.phone;
  const reason = blocked
    ? 'The nudge carries a figure or a financial detail. Edit it first.'
    : (tooLong ? `That is ${sms.length} characters. Keep it under ${SMS_MAX}.` : (noPhone ? `${card.partnerName} has no mobile number on file.` : null));

  return (
    <Card>
      <div className="card__head">
        <h2>{card.partnerName}</h2>
        {card.office ? <Chip tone="neutral">{card.office}</Chip> : null}
        {sent ? <Chip tone="green">Sent</Chip> : null}
      </div>

      <div className="grid grid--2">
        <div className="callout callout--teal">
          <strong>What {card.firstName} will hear</strong>
          <span>
            {card.agentHears.settledThisMonth} settled, {card.agentHears.inFlight} in flight,
            {' '}{card.agentHears.total} {card.agentHears.total === 1 ? 'deal' : 'deals'} in total.
          </span>
          <span className="small">
            Counts only deals where the client agreed we can share status.
            {card.settledWindowStart ? ` Settled counts from ${longDate(card.settledWindowStart)}, the current unpaid commission window.` : ''}
          </span>
        </div>
        <div className="callout">
          <strong>Your register</strong>
          <span>
            {card.registerCount.settledThisMonth} settled, {card.registerCount.inFlight} in flight,
            {' '}{card.registerCount.total} {card.registerCount.total === 1 ? 'deal' : 'deals'} in total.
          </span>
          {card.consentGap > 0
            ? <span className="small" style={{ color: 'var(--amber)' }}>
              {card.consentGap} more deal{card.consentGap === 1 ? '' : 's'} we cannot mention yet: no consent recorded.
            </span>
            : <span className="small muted">Every deal has consent recorded.</span>}
        </div>
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        <h3>Open homes</h3>
        {card.opens.length ? (
          <ul className="stack stack--tight" style={{ margin: 0, paddingLeft: 18 }}>
            {card.opens.map((o, i) => (
              <li key={i}>{o.address} <span className="muted small">{shortDate(o.date)}{o.time ? ` ${o.time}` : ''}</span></li>
            ))}
          </ul>
        ) : <span className="small muted">No open homes listed. Add them on the partner page.</span>}
        {card.opens.length ? <span className="small muted">This weekend: {saturdayLabel}</span> : null}
      </div>

      <div className="stack" style={{ marginTop: 12 }}>
        <div className="card__head" style={{ marginBottom: 0 }}>
          <h3>The nudge</h3>
          <ProviderTag provider={provider} />
          <span className="card__hint">{sms.length} / {SMS_MAX}</span>
        </div>
        <div className={`bubble${blocked ? ' bubble--blocked' : ''}`}>{sms}</div>
        <Field label="Edit before it goes" id={`nudge-${card.partnerId}`}>
          <textarea
            id={`nudge-${card.partnerId}`}
            rows={5}
            value={sms}
            onChange={(e) => { setSms(e.target.value); setSent(false); }}
          />
        </Field>
        <ComplianceReport result={compliance} label="Nudge check" />
        <div className="row">
          <Button variant="primary" onClick={send} disabled={busy || Boolean(reason)} title={reason || `Send to ${card.phone}`}>
            Send the nudge
          </Button>
          <Button size="sm" onClick={() => redraft(true)} disabled={busy}>Redraft with Claude</Button>
          <Button size="sm" onClick={() => redraft(false)} disabled={busy}>Redraft offline</Button>
          <CopyButton value={sms} label="Copy" />
          {reason ? <span className="small" style={{ color: 'var(--red)' }}>{reason}</span> : null}
        </div>
        {meta ? (
          <span className="small muted">
            Drafted by {meta.provider === 'claude' ? `Claude in ${meta.ms}ms` : 'the deterministic template'}
            {meta.reason ? ` (${String(meta.reason).replace(/_/g, ' ')})` : ''}
          </span>
        ) : null}
      </div>

      <div className="row" style={{ marginTop: 12 }}>
        <img
          src={`/api/partners/${encodeURIComponent(card.partnerId)}/qr.png`}
          alt={`Pre-approval QR code for ${card.partnerName}`}
          width={72}
          height={72}
          style={{ borderRadius: 6, border: '1px solid var(--line)' }}
        />
        <div className="stack stack--tight">
          <span className="small">The QR code the nudge offers.</span>
          <a className="btn btn--sm" href={`/api/partners/${encodeURIComponent(card.partnerId)}/signin-sheet`} target="_blank" rel="noreferrer">
            Print the sign-in sheet
          </a>
        </div>
      </div>
    </Card>
  );
}

export default function FridayPage() {
  const { data, loading, error, reload } = useAsync(() => api.friday(), []);

  if (loading && !data) return <LoadingBlock rows={3} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not build the Friday note">
        <span>{error.message}</span>
        <div className="row"><Button size="sm" variant="primary" onClick={reload}>Try again</Button></div>
      </Callout>
    );
  }

  const cards = data?.cards || [];

  return (
    <>
      <Card>
        <div className="card__head" style={{ marginBottom: 0 }}>
          <h2>This week</h2>
          <span className="card__hint">
            The scoreboard falls out of the register. You approve every nudge before it goes.
          </span>
          <Button size="sm" onClick={reload}>Refresh</Button>
        </div>
        <span className="small muted">Weekend of {data?.saturdayLabel}</span>
      </Card>

      {cards.length
        ? <div className="grid grid--2">{cards.map((card) => <FridayCard key={card.partnerId} card={card} saturdayLabel={data?.saturdayLabel} />)}</div>
        : <Empty>No partners yet, so there is nothing to send.</Empty>}
    </>
  );
}
