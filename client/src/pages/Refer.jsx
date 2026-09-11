// The buyer-facing form behind the open-home QR code. It exposes nothing about
// the agent's deals: only their first name and who will call.

import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { Card, Button, Field, Callout, LoadingBlock, Wordmark } from '../components/ui.jsx';

export default function ReferPage({ token }) {
  const { toast } = useApp();
  const { data, loading, error } = useAsync(() => api.scan(token), [token]);
  const [form, setForm] = useState({ buyerName: '', buyerPhone: '', buyerEmail: '', note: '' });
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(null);

  const submit = async (event) => {
    event?.preventDefault?.();
    if (!form.buyerName.trim()) {
      toast.warn('Add your name so we know who to call.');
      return;
    }
    if (!form.buyerPhone.trim() && !form.buyerEmail.trim()) {
      toast.warn('Add a phone number or an email so we can reach you.');
      return;
    }
    if (!consent) {
      toast.warn('Tick the box so we know you want the call.');
      return;
    }
    setBusy(true);
    try {
      const result = await api.scanRefer(token, { ...form, consentToContact: true });
      setDone(result.message);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading && !data) {
    return <div className="portal"><div className="portal__body" style={{ paddingTop: 20 }}><LoadingBlock rows={2} /></div></div>;
  }

  if (error) {
    return (
      <div className="portal">
        <div className="portal__hero"><Wordmark /></div>
        <div className="portal__body" style={{ paddingTop: 24 }}>
          <Callout tone="red" title="This code is not working">
            <span>
              {error.status === 404
                ? 'That code has expired or been replaced. Ask the agent for the current one.'
                : error.message}
            </span>
          </Callout>
        </div>
      </div>
    );
  }

  return (
    <div className="portal">
      <div className="portal__hero">
        <Wordmark to={`/refer/${token}`} />
        <h1 style={{ marginTop: 12 }}>Want a pre-approval?</h1>
        <p>
          {data?.partnerFirstName ? `${data.partnerFirstName} works with ` : ''}{data?.firm}.
          {' '}{data?.broker} will call you within one business day.
        </p>
      </div>

      <div className="portal__body">
        {done ? (
          <Card>
            <Callout tone="green" title="Thanks, you are on the list">
              <span>{done}</span>
            </Callout>
          </Card>
        ) : (
          <Card title="Your details" hint="We only call people who ask us to.">
            <form className="stack" onSubmit={submit}>
              <Field label="Your name" id="sc-name">
                <input id="sc-name" value={form.buyerName} autoFocus onChange={(e) => setForm({ ...form, buyerName: e.target.value })} />
              </Field>
              <Field label="Mobile" id="sc-phone">
                <input id="sc-phone" type="tel" value={form.buyerPhone} onChange={(e) => setForm({ ...form, buyerPhone: e.target.value })} />
              </Field>
              <Field label="Email" id="sc-email">
                <input id="sc-email" type="email" value={form.buyerEmail} onChange={(e) => setForm({ ...form, buyerEmail: e.target.value })} />
              </Field>
              <Field label="What are you looking at?" id="sc-note">
                <textarea id="sc-note" rows={3} value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
              </Field>
              <label className="check">
                <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} />
                <span className="check__body">
                  <span>I agree to be contacted about a pre-approval</span>
                  <span className="field__note">Nothing else. No mailing list.</span>
                </span>
              </label>
              <Button variant="primary" block onClick={submit} disabled={busy || !consent}>
                Ask for a call
              </Button>
              <button type="submit" className="sr-only" tabIndex={-1} aria-hidden="true">Send</button>
            </form>
          </Card>
        )}
        <p className="small muted" style={{ textAlign: 'center' }}>
          {data?.firm} discloses any referral fee before giving advice.
        </p>
      </div>
    </div>
  );
}
