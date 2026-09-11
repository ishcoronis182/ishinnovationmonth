// Who refers, what they are owed, and what they can see.

import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { href } from '../router.js';
import {
  Card, Button, Chip, Field, Callout, Empty, LoadingBlock, Modal, Stat,
  money, stampLabel,
} from '../components/ui.jsx';

function PartnerCard({ partner }) {
  const gap = (partner.stats?.dealsReferred || 0) - (partner.stats?.consented || 0);
  return (
    <Card>
      <div className="card__head">
        <h2><a href={href(`/partner/${partner.id}`)}>{partner.name}</a></h2>
        {gap > 0 ? (
          <Chip tone="amber" title="These deals cannot be updated until the client consents">
            {gap} without consent
          </Chip>
        ) : <Chip tone="green">All consented</Chip>}
      </div>
      <span className="small muted">
        {[partner.agency, partner.office].filter(Boolean).join(' · ') || 'No agency recorded'}
      </span>
      <div className="grid grid--4" style={{ marginTop: 12 }}>
        <Stat label="Referred" value={partner.stats?.dealsReferred ?? 0} />
        <Stat label="In flight" value={partner.stats?.inFlight ?? 0} />
        <Stat label="Comms due" value={money(partner.stats?.commsDue)} tone="teal" />
        <Stat label="Paid this year" value={money(partner.stats?.paidYtd)} tone="green" />
      </div>
      <div className="row row--tight" style={{ marginTop: 12 }}>
        <Chip tone="neutral">{partner.stats?.updatesSent ?? 0} updates sent</Chip>
        <Chip tone="neutral">{partner.stats?.settled ?? 0} settled</Chip>
        <Chip tone={partner.stats?.enquiries ? 'amber' : 'neutral'}>{partner.stats?.enquiries ?? 0} enquiries</Chip>
        <Chip tone="neutral">{(partner.openHomes || []).length} opens listed</Chip>
        <div className="spacer" />
        <a className="btn btn--sm" href={href(`/partner/${partner.id}`)}>Open</a>
      </div>
    </Card>
  );
}

export default function PartnersPage() {
  const { toast } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.partners(), []);
  const { data: referralData, reload: reloadReferrals } = useAsync(() => api.referrals(), []);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ name: '', agency: '', office: '', phone: '', email: '' });
  const [saving, setSaving] = useState(false);

  if (loading && !data) return <LoadingBlock rows={3} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not load the partners">
        <span>{error.message}</span>
        <div className="row"><Button size="sm" variant="primary" onClick={reload}>Try again</Button></div>
      </Callout>
    );
  }

  const partners = data?.partners || [];
  const referrals = referralData?.referrals || [];

  const create = async () => {
    if (!form.name.trim()) {
      toast.warn('A partner needs a name.');
      return;
    }
    setSaving(true);
    try {
      await api.createPartner(form);
      toast.ok(`${form.name} added. Their private portal link is ready.`);
      setAdding(false);
      setForm({ name: '', agency: '', office: '', phone: '', email: '' });
      reload();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <Card>
        <div className="card__head" style={{ marginBottom: 0 }}>
          <h2>{partners.length} partner{partners.length === 1 ? '' : 's'}</h2>
          <span className="card__hint">Each one has a private portal link and an open-home QR code.</span>
          <Button size="sm" onClick={reload}>Refresh</Button>
          <Button size="sm" variant="primary" onClick={() => setAdding(true)}>Add a partner</Button>
        </div>
      </Card>

      {partners.length
        ? <div className="grid grid--2">{partners.map((p) => <PartnerCard key={p.id} partner={p} />)}</div>
        : <Empty>No partners yet. Add the first agent who sends you buyers.</Empty>}

      <Card title="Buyers who asked for a call" hint="From the portal form and the open-home QR code">
        {referrals.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Buyer</th>
                  <th>Contact</th>
                  <th>From</th>
                  <th>How</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {referrals.map((r) => (
                  <tr key={r.id}>
                    <td className="nowrap">{stampLabel(r.at)}</td>
                    <td>{r.buyerName}</td>
                    <td className="small">{[r.buyerPhone, r.buyerEmail].filter(Boolean).join(' · ') || '-'}</td>
                    <td>{r.partnerName || '-'}</td>
                    <td><Chip tone={r.source === 'scan' ? 'teal' : 'neutral'}>{r.source === 'scan' ? 'Open-home QR' : 'Portal'}</Chip></td>
                    <td className="small">{r.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <Empty>Nobody has used the referral form yet.</Empty>}
        <div className="row" style={{ marginTop: 10 }}>
          <Button size="sm" onClick={reloadReferrals}>Refresh</Button>
          <span className="small muted">Every one of these ticked &ldquo;the buyer agreed to be contacted&rdquo;.</span>
        </div>
      </Card>

      {adding ? (
        <Modal title="Add a partner" onClose={() => setAdding(false)}>
          <Field label="Name" id="p-name">
            <input
              id="p-name"
              value={form.name}
              autoFocus
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') create(); }}
            />
          </Field>
          <Field label="Agency" id="p-agency">
            <input id="p-agency" value={form.agency} onChange={(e) => setForm({ ...form, agency: e.target.value })} />
          </Field>
          <Field label="Office" id="p-office">
            <input id="p-office" value={form.office} onChange={(e) => setForm({ ...form, office: e.target.value })} />
          </Field>
          <Field label="Mobile" id="p-phone" hint="Needed to send an SMS update.">
            <input id="p-phone" type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
          <Field label="Email" id="p-email">
            <input id="p-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          </Field>
          <div className="row row--end">
            <Button onClick={() => setAdding(false)}>Cancel</Button>
            <Button variant="primary" onClick={create} disabled={saving}>Add partner</Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
