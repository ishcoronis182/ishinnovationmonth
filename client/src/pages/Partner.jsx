// One partner: their deals, the updates they were sent, their statements,
// their open homes, and the two links that are not the same link.

import React, { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { href } from '../router.js';
import {
  Card, Button, LinkButton, Chip, RagChip, Field, Callout, Empty, LoadingBlock,
  Modal, Stat, CopyButton, ProviderTag, money, shortDate, stampLabel,
} from '../components/ui.jsx';

function EditableRow({ label, value, onSave, type = 'text', id }) {
  const [draft, setDraft] = useState(value ?? '');
  useEffect(() => { setDraft(value ?? ''); }, [value]);
  return (
    <Field label={label} id={id}>
      <input
        id={id}
        type={type}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { if ((draft || '') !== (value || '')) onSave(draft || null); }}
        onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
      />
    </Field>
  );
}

function OpenHomesEditor({ partner, onSaved }) {
  const { toast, boot } = useApp();
  const [rows, setRows] = useState(partner.openHomes || []);
  const [saving, setSaving] = useState(false);
  useEffect(() => { setRows(partner.openHomes || []); }, [partner.id, partner.openHomes]);

  const update = (index, patch) => setRows((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const save = async () => {
    setSaving(true);
    try {
      const result = await api.setOpenHomes(partner.id, { openHomes: rows });
      toast.ok('Open homes saved. They feed the Friday note.');
      onSaved(result.partner);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="stack">
      {rows.length ? rows.map((row, index) => (
        <div className="row" key={row.id || index}>
          <Field label={index === 0 ? 'Address' : undefined} id={`oh-a-${index}`}>
            <input id={`oh-a-${index}`} value={row.address || ''} onChange={(e) => update(index, { address: e.target.value })} style={{ minWidth: 220 }} />
          </Field>
          <Field label={index === 0 ? 'Date' : undefined} id={`oh-d-${index}`}>
            <input id={`oh-d-${index}`} type="date" value={row.date || ''} onChange={(e) => update(index, { date: e.target.value })} />
          </Field>
          <Field label={index === 0 ? 'Time' : undefined} id={`oh-t-${index}`}>
            <input id={`oh-t-${index}`} value={row.time || ''} placeholder="10:00am" onChange={(e) => update(index, { time: e.target.value })} />
          </Field>
          <Button size="sm" variant="ghost" onClick={() => setRows(rows.filter((_, i) => i !== index))} aria-label={`Remove ${row.address || 'this open home'}`}>Remove</Button>
        </div>
      )) : <Empty>No open homes listed for this weekend.</Empty>}
      <div className="row">
        <Button size="sm" onClick={() => setRows([...rows, { address: '', date: boot?.today || '', time: '' }])}>Add an open home</Button>
        <div className="spacer" />
        <Button size="sm" variant="primary" onClick={save} disabled={saving}>Save open homes</Button>
      </div>
    </div>
  );
}

export default function PartnerPage({ id }) {
  const { toast, boot } = useApp();
  const { data, setData, loading, error, reload } = useAsync(() => api.partner(id), [id]);
  const [rotating, setRotating] = useState(false);

  const applyPartner = useCallback((partner) => {
    setData((current) => ({ ...(current || {}), partner }));
  }, [setData]);

  const patch = async (body) => {
    try {
      const result = await api.patchPartner(id, body);
      applyPartner(result.partner);
      toast.ok('Partner updated.');
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading && !data) return <LoadingBlock rows={4} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not load this partner">
        <span>{error.message}</span>
        <div className="row">
          <Button size="sm" variant="primary" onClick={reload}>Try again</Button>
          <LinkButton to="/partners" size="sm">Back to partners</LinkButton>
        </div>
      </Callout>
    );
  }

  const partner = data?.partner?.id === id ? data.partner : null;
  if (loading && !partner) return <LoadingBlock rows={4} />;
  if (!partner) return <Empty>That partner is not in the register. <a href={href('/partners')}>Back to partners</a>.</Empty>;

  const deals = data?.deals || [];
  const messages = data?.messages || [];
  const statements = data?.statements || [];
  const questions = boot?.pulseQuestions || [];

  return (
    <>
      <Card>
        <div className="card__head">
          <h2 style={{ marginRight: 'auto' }}>{partner.name}</h2>
          <LinkButton to="/partners" size="sm">All partners</LinkButton>
        </div>
        <div className="grid grid--3">
          <EditableRow id="pr-name" label="Name" value={partner.name} onSave={(v) => patch({ name: v })} />
          <EditableRow id="pr-agency" label="Agency" value={partner.agency} onSave={(v) => patch({ agency: v })} />
          <EditableRow id="pr-office" label="Office" value={partner.office} onSave={(v) => patch({ office: v })} />
          <EditableRow id="pr-phone" label="Mobile" value={partner.phone} type="tel" onSave={(v) => patch({ phone: v })} />
          <EditableRow id="pr-email" label="Email" value={partner.email} type="email" onSave={(v) => patch({ email: v })} />
        </div>
        <div className="grid grid--4" style={{ marginTop: 14 }}>
          <Stat label="Referred" value={partner.stats?.dealsReferred ?? 0} />
          <Stat label="In flight" value={partner.stats?.inFlight ?? 0} />
          <Stat label="Settled" value={partner.stats?.settled ?? 0} />
          <Stat label="Comms due" value={money(partner.stats?.commsDue)} tone="teal" />
          <Stat label="Paid this year" value={money(partner.stats?.paidYtd)} tone="green" />
          <Stat label="Updates sent" value={partner.stats?.updatesSent ?? 0} />
          <Stat label="Enquiries logged" value={partner.stats?.enquiries ?? 0} note="Log these on the deal page" />
          <Stat label="Consented deals" value={`${partner.stats?.consented ?? 0} / ${partner.stats?.dealsReferred ?? 0}`} />
        </div>
      </Card>

      <Card title="Their deals" hint="Status only is what they see; this is the full record" flush>
        {deals.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Ref</th><th>Client</th><th>Stage</th><th>RAG</th>
                  <th className="num">Days in stage</th><th>Last update</th><th>Consent</th><th>Commission</th>
                </tr>
              </thead>
              <tbody>
                {deals.map((deal) => (
                  <tr key={deal.id} className="clickable" onClick={() => { window.location.hash = `#/deal/${deal.id}`; }}>
                    <td className="mono">{deal.ref}</td>
                    <td><a href={href(`/deal/${deal.id}`)}>{deal.clientLabel}</a></td>
                    <td>{deal.stageLabel}</td>
                    <td><RagChip rag={deal.rag} /></td>
                    <td className="num">{deal.daysInStage ?? '-'}</td>
                    <td>{deal.lastUpdate ? shortDate(deal.lastUpdate.at) : <span className="muted">never</span>}</td>
                    <td>{deal.consent?.shareStatus ? <Chip tone="green">yes</Chip> : <Chip tone="amber">not yet</Chip>}</td>
                    <td>
                      {deal.commission?.recordedAmount != null
                        ? `${money(deal.commission.recordedAmount)} ${deal.commission.status}`
                        : <span className="muted">{money(deal.commission?.projectedAmount)} projected</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ padding: 16 }}><Empty>No deals from this partner yet.</Empty></div>}
      </Card>

      <div className="grid grid--2">
        <Card title="Updates sent" hint="Every one of these was approved by a human first">
          <div className="stack">
            {messages.length ? messages.slice(0, 8).map((m) => (
              <div className="stack stack--tight" key={m.id}>
                <div className="row row--tight small muted">
                  <Chip tone="neutral">{m.kind}</Chip>
                  <span>{(m.channels || []).join(' + ')}</span>
                  <span>{stampLabel(m.sentAt || m.createdAt)}</span>
                  {m.dealRef ? <span className="mono">{m.dealRef}</span> : null}
                  <ProviderTag provider={m.provider} />
                </div>
                {m.smsBody ? <div className="bubble">{m.smsBody}</div> : <span className="small muted">{m.emailSubject}</span>}
              </div>
            )) : <Empty>Nothing has been sent to this partner yet.</Empty>}
          </div>
        </Card>

        <Card title="Statements" flush>
          {statements.length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Period</th><th>Status</th><th className="num">Lines</th><th className="num">Total</th><th>Issued</th><th>Paid</th></tr>
                </thead>
                <tbody>
                  {statements.map((s) => (
                    <tr key={s.id} className="clickable" onClick={() => { window.location.hash = `#/statement/${s.id}`; }}>
                      <td><a href={href(`/statement/${s.id}`)}>{s.periodLabel || s.period}</a></td>
                      <td><Chip tone={s.status === 'paid' ? 'green' : (s.status === 'issued' ? 'teal' : (s.status === 'void' ? 'red' : 'neutral'))}>{s.status}</Chip></td>
                      <td className="num">{(s.lines || []).length}</td>
                      <td className="num">{money(s.total)}</td>
                      <td>{s.issuedAt ? shortDate(s.issuedAt) : '-'}</td>
                      <td>{s.paidAt ? shortDate(s.paidAt) : '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <div style={{ padding: 16 }}><Empty>No statements yet. Generate one from the Statements page.</Empty></div>}
        </Card>
      </div>

      <Card title="Open homes this weekend" hint="These become the Friday note">
        <OpenHomesEditor partner={partner} onSaved={applyPartner} />
      </Card>

      <div className="grid grid--2">
        <Card title="Open-home QR code" hint="For buyers. It shows nothing about this partner's deals.">
          <div className="stack">
            <img
              src={`/api/partners/${encodeURIComponent(partner.id)}/qr.png`}
              alt={`QR code linking buyers to the pre-approval form for ${partner.name}`}
              width={168}
              height={168}
              style={{ borderRadius: 8, border: '1px solid var(--line)' }}
            />
            <span className="small muted break">{partner.scanUrl || 'Set PULSE_PUBLIC_URL to get an absolute link.'}</span>
            <div className="row">
              <CopyButton value={partner.scanUrl || ''} label="Copy the buyer link" onCopied={() => toast.ok('Buyer link copied')} />
              <a className="btn btn--sm" href={`/api/partners/${encodeURIComponent(partner.id)}/signin-sheet`} target="_blank" rel="noreferrer">
                Print sign-in sheet
              </a>
            </div>
          </div>
        </Card>

        <Card title="Private portal link" hint="For the agent. It shows their deals and their money.">
          <div className="stack">
            <Callout tone="teal">
              <span>
                Two different links. The portal link below is private to {partner.name} and lists their referred deals,
                status only. The QR code beside it is for buyers at an open home and exposes nothing but a first name.
              </span>
            </Callout>
            <span className="small muted break">{partner.portalUrl || `#/portal/${partner.portalToken}`}</span>
            <div className="row">
              <CopyButton value={partner.portalUrl || `#/portal/${partner.portalToken}`} label="Copy the portal link" onCopied={() => toast.ok('Portal link copied')} />
              <a className="btn btn--sm" href={`#/portal/${partner.portalToken}`} target="_blank" rel="noreferrer">Open the portal</a>
              <Button size="sm" variant="danger" onClick={() => setRotating(true)}>Rotate token</Button>
            </div>
            {partner.tokenRotatedAt ? <span className="field__note">Last rotated {stampLabel(partner.tokenRotatedAt)}</span> : null}
          </div>
        </Card>
      </div>

      <Card title="Pulse survey" hint="Three questions, 1 to 5, asked in week 1 and again in week 3">
        {(partner.surveys || []).length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Week</th>
                  {questions.map((q) => <th key={q}>{q}</th>)}
                  <th>Comment</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {partner.surveys.map((s) => (
                  <tr key={s.id}>
                    <td>Week {s.week}</td>
                    {[0, 1, 2].map((i) => <td key={i} className="num">{s.answers?.[i] ?? '-'}</td>)}
                    <td className="small">{s.comment || '-'}</td>
                    <td className="nowrap small">{stampLabel(s.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>No survey responses yet. The portal asks for them.</Empty>}
      </Card>

      {rotating ? (
        <Modal title="Rotate this partner's links" onClose={() => setRotating(false)}>
          <Callout tone="amber" title="The old link stops working immediately">
            <span>
              Anyone holding the current portal link or QR code will get &ldquo;this link is not valid any more&rdquo;.
              Send {partner.name} the new one after you rotate.
            </span>
          </Callout>
          <div className="row row--end">
            <Button onClick={() => setRotating(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  const result = await api.rotateToken(partner.id);
                  applyPartner(result.partner);
                  setRotating(false);
                  toast.ok(result.message || 'New link created.');
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Rotate now
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
