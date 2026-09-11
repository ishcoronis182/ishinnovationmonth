// One statement: the five numbers, the lines, the anomalies, and the lifecycle.

import React, { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { href } from '../router.js';
import {
  Card, Button, LinkButton, Chip, Field, Callout, Empty, LoadingBlock, Modal,
  Stat, ComplianceReport, ProviderTag, money, shortDate, longDate, stampLabel,
} from '../components/ui.jsx';

const STATUS_TONE = { draft: 'neutral', issued: 'teal', paid: 'green', void: 'red' };

function duration(seconds) {
  if (seconds == null) return null;
  const n = Number(seconds);
  if (!Number.isFinite(n)) return null;
  if (n < 90) return `${Math.round(n)} seconds`;
  if (n < 5400) return `${Math.round(n / 60)} minutes`;
  return `${(n / 3600).toFixed(1)} hours`;
}

export default function StatementPage({ id }) {
  const { toast, refreshPulse } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.statement(id), [id]);
  const [note, setNote] = useState('');
  const [noteCompliance, setNoteCompliance] = useState(null);
  const [noteProvider, setNoteProvider] = useState(null);
  const [busy, setBusy] = useState(false);
  const [voiding, setVoiding] = useState(false);
  const [voidReason, setVoidReason] = useState('');
  const [sending, setSending] = useState(false);
  const [channels, setChannels] = useState(['email']);

  const statement = data?.statement?.id === id ? data.statement : null;
  const partner = data?.partner;
  const recheck = data?.recheck;

  useEffect(() => {
    if (statement) {
      setNote(statement.coverNote || '');
      setNoteCompliance(statement.coverNoteCompliance || null);
      setNoteProvider(statement.coverNoteProvider || null);
    }
  }, [statement?.id, statement?.coverNote]); // eslint-disable-line react-hooks/exhaustive-deps

  const act = useCallback(async (fn, describe) => {
    setBusy(true);
    try {
      const result = await fn();
      toast.ok(describe(result));
      await reload();
      refreshPulse();
      return result;
    } catch (err) {
      if (err instanceof ApiError && err.payload?.compliance) setNoteCompliance(err.payload.compliance);
      toast.error(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  }, [toast, reload, refreshPulse]);

  if (!statement && !error) return <LoadingBlock rows={4} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not load this statement">
        <span>{error.message}</span>
        <div className="row">
          <Button size="sm" variant="primary" onClick={reload}>Try again</Button>
          <LinkButton to="/statements" size="sm">Back to statements</LinkButton>
        </div>
      </Callout>
    );
  }
  if (!statement) return <Empty>That statement does not exist. <a href={href('/statements')}>Back to statements</a>.</Empty>;

  const n = statement.numbers || {};
  const changes = recheck?.changes || [];

  return (
    <>
      <Card>
        <div className="card__head">
          <div className="stack stack--tight" style={{ marginRight: 'auto' }}>
            <div className="row row--tight">
              <h2>{statement.partnerName}</h2>
              <Chip tone={STATUS_TONE[statement.status] || 'neutral'}>{statement.status}</Chip>
              <span className="mono muted">{statement.id}</span>
            </div>
            <span className="small muted">
              {statement.periodLabel}
              {statement.issuedAt ? ` · issued ${stampLabel(statement.issuedAt)}` : ''}
              {statement.paidAt ? ` · paid ${stampLabel(statement.paidAt)}` : ''}
              {statement.productionSeconds != null ? ` · issued ${duration(statement.productionSeconds)} after it was generated` : ''}
            </span>
          </div>
          <LinkButton to="/statements" size="sm">All statements</LinkButton>
        </div>

        <div className="five-numbers">
          <Stat label="Deals referred (this period)" value={n.dealsReferred ?? 0} />
          <Stat label="Settled this month" value={n.settledThisMonth ?? 0} />
          <Stat label="Referral comms due" value={money(n.commsDue)} tone="teal" />
          <Stat label="In flight" value={n.inFlight ?? 0} />
          <Stat label="Paid year to date" value={money(n.paidYtd)} tone="green" />
        </div>

        {statement.status === 'void' && statement.voidReason ? (
          <Callout tone="red" title="Voided">
            <span>{statement.voidReason} ({stampLabel(statement.voidedAt)})</span>
          </Callout>
        ) : null}
      </Card>

      <Card title="Lines" hint="Every dollar traces to a deal id and a rule id" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Deal</th><th>Client</th><th>Security property</th><th>Settled</th>
                <th>Rule</th><th>Basis</th><th className="num">Amount</th>
              </tr>
            </thead>
            <tbody>
              {(statement.lines || []).map((line) => (
                <tr key={line.id || line.dealId}>
                  <td><a className="mono" href={href(`/deal/${line.dealId}`)}>{line.dealRef}</a></td>
                  <td>{line.clientLabel}</td>
                  <td className="small">{line.address || '-'}</td>
                  <td className="nowrap">{line.settledAt ? longDate(line.settledAt) : '-'}</td>
                  <td>
                    {line.ruleName}
                    <br />
                    <span className="mono muted">{line.ruleId}</span>
                  </td>
                  <td className="small">{line.basis}</td>
                  <td className="num strong">{money(line.amount)}</td>
                </tr>
              ))}
              <tr>
                <td colSpan={6} className="right strong">Total</td>
                <td className="num strong">{money(statement.total)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid--2">
        <Card title="Anomalies" hint="Worth a look before you pay">
          {(statement.anomalies || []).length ? (
            <div className="stack stack--tight">
              {statement.anomalies.map((a, i) => (
                <div className="callout callout--amber" key={i}>
                  <span>
                    {a.label}
                    {a.dealId ? <> - <a className="mono" href={href(`/deal/${a.dealId}`)}>{a.dealRef || a.dealId}</a></> : null}
                  </span>
                </div>
              ))}
            </div>
          ) : <Empty>Nothing flagged on this statement.</Empty>}
        </Card>

        <Card title="Re-check against the live register" hint="Run again at issue and at mark-paid">
          {changes.length ? (
            <div className="stack stack--tight">
              <Callout tone="amber" title={`${changes.length} difference${changes.length === 1 ? '' : 's'} since this draft was built`}>
                <span>Issuing or paying re-checks every line, so a reopened deal can never be paid from a stale draft.</span>
              </Callout>
              {changes.map((c, i) => (
                <span className="small" key={i}>
                  <Chip tone={c.type === 'removed' ? 'red' : (c.type === 'added' ? 'teal' : 'amber')}>{c.type.replace('_', ' ')}</Chip>
                  {' '}<span className="mono">{c.dealRef || c.dealId}</span>
                  {c.reason ? ` - ${c.reason}` : ''}
                  {c.type === 'amount_changed' ? ` ${money(c.from)} to ${money(c.to)}` : ''}
                </span>
              ))}
            </div>
          ) : (
            <Callout tone="green" title="The lines still match the register">
              <span>Re-checked just now. Total would be {money(recheck?.total)}.</span>
            </Callout>
          )}
        </Card>
      </div>

      <Card title="Cover note" hint="The only numbers allowed here are this statement's own totals">
        <div className="stack">
          <Field label="What the partner reads" id="st-note">
            <textarea id="st-note" rows={4} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          <ComplianceReport result={noteCompliance} label="Cover note check" />
          <div className="row">
            <Button
              variant="primary"
              disabled={busy}
              onClick={() => act(
                () => api.patchStatement(id, { coverNote: note, provider: noteProvider || 'broker' }),
                () => 'Cover note saved.',
              )}
            >
              Save note
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await api.statementNote(id, { useAi: true });
                  setNote(result.note);
                  setNoteCompliance(result.compliance);
                  setNoteProvider(result.provider);
                  toast.ok(`Written by ${result.provider === 'claude' ? 'Claude' : 'the template'}.`);
                } catch (err) {
                  toast.error(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Write it with Claude
            </Button>
            <Button
              size="sm"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const result = await api.statementNote(id, { useAi: false });
                  setNote(result.note);
                  setNoteCompliance(result.compliance);
                  setNoteProvider(result.provider);
                } catch (err) {
                  toast.error(err.message);
                } finally {
                  setBusy(false);
                }
              }}
            >
              Write it offline
            </Button>
            <ProviderTag provider={noteProvider} />
          </div>
        </div>
      </Card>

      <Card title="Actions">
        <div className="row">
          <Button
            variant="primary"
            disabled={busy || statement.status !== 'draft' || !(statement.lines || []).length}
            title={statement.status !== 'draft' ? `Only a draft can be issued (this one is ${statement.status})` : 'Re-checks every line, then issues'}
            onClick={() => act(
              () => api.issueStatement(id),
              (r) => `Issued with ${r.statement.lines.length} lines${r.changes?.length ? `, ${r.changes.length} line change${r.changes.length === 1 ? '' : 's'} on re-check` : ''}.`,
            )}
          >
            Issue
          </Button>
          <Button
            variant="navy"
            disabled={busy || statement.status !== 'issued'}
            title={statement.status !== 'issued' ? 'Only an issued statement can be marked paid' : 'Re-checks every line, then marks paid'}
            onClick={() => act(() => api.payStatement(id), (r) => `Marked paid: ${money(r.statement.total)}.`)}
          >
            Mark paid
          </Button>
          <Button
            disabled={busy || statement.status === 'draft' || statement.status === 'void' || !partner}
            title={statement.status === 'draft' ? 'Issue it before sending' : `Send to ${partner?.name}`}
            onClick={() => setSending(true)}
          >
            Send to partner
          </Button>
          <Button variant="danger" disabled={busy || statement.status === 'void'} onClick={() => setVoiding(true)}>Void</Button>
          <div className="spacer" />
          <a className="btn btn--sm" href={`/api/statements/${encodeURIComponent(id)}/export.csv`} download>Export CSV</a>
          <a className="btn btn--sm" href={`/api/statements/${encodeURIComponent(id)}/export.xlsx`} download>Export XLSX</a>
        </div>
      </Card>

      <Card title="History">
        {(statement.history || []).length ? (
          <div className="timeline">
            {[...statement.history].reverse().map((h, i) => (
              <div className="timeline__item" key={i}>
                <span className="timeline__dot" />
                <div className="timeline__body">
                  <span>{h.message}</span>
                  <span className="timeline__meta">{stampLabel(h.at)} · {h.type.replace(/_/g, ' ')}</span>
                </div>
              </div>
            ))}
          </div>
        ) : <Empty>Nothing recorded yet.</Empty>}
      </Card>

      {voiding ? (
        <Modal title="Void this statement" onClose={() => setVoiding(false)}>
          <Callout tone="amber" title="Every line goes back to due">
            <span>The deals on this statement become unpaid again and can be reopened.</span>
          </Callout>
          <Field label="Why?" id="st-void">
            <input id="st-void" value={voidReason} autoFocus onChange={(e) => setVoidReason(e.target.value)} placeholder="Paid the wrong amount" />
          </Field>
          <div className="row row--end">
            <Button onClick={() => setVoiding(false)}>Cancel</Button>
            <Button
              variant="danger"
              disabled={!voidReason.trim()}
              onClick={async () => {
                const ok = await act(() => api.voidStatement(id, { reason: voidReason }), () => 'Statement voided.');
                if (ok) { setVoiding(false); setVoidReason(''); }
              }}
            >
              Void it
            </Button>
          </div>
        </Modal>
      ) : null}

      {sending ? (
        <Modal title={`Send to ${partner?.name}`} onClose={() => setSending(false)}>
          <Callout tone="teal">
            <span>They get the cover note and a link to their portal. No loan figures leave this page.</span>
          </Callout>
          <div className="row">
            <label className="check">
              <input type="checkbox" checked={channels.includes('email')} onChange={(e) => setChannels(e.target.checked ? [...new Set([...channels, 'email'])] : channels.filter((c) => c !== 'email'))} />
              <span className="check__body"><span>Email ({partner?.email || 'none on file'})</span></span>
            </label>
            <label className="check">
              <input type="checkbox" checked={channels.includes('sms')} onChange={(e) => setChannels(e.target.checked ? [...new Set([...channels, 'sms'])] : channels.filter((c) => c !== 'sms'))} />
              <span className="check__body"><span>SMS ({partner?.phone || 'none on file'})</span></span>
            </label>
          </div>
          <div className="row row--end">
            <Button onClick={() => setSending(false)}>Cancel</Button>
            <Button
              variant="primary"
              disabled={!channels.length}
              onClick={async () => {
                const ok = await act(() => api.sendStatement(id, { note, channels }), () => `Statement sent to ${partner?.name}.`);
                if (ok) setSending(false);
              }}
            >
              Send it
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
