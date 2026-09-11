// One statement per partner per month, plus the register-level anomalies.

import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { href } from '../router.js';
import {
  Card, Button, Chip, Field, Callout, Empty, LoadingBlock, money, shortDate,
} from '../components/ui.jsx';

const STATUS_TONE = { draft: 'neutral', issued: 'teal', paid: 'green', void: 'red' };

export default function StatementsPage() {
  const { toast, refreshPulse } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.statements(), []);
  const [period, setPeriod] = useState('');
  const [busy, setBusy] = useState(false);

  const periods = useMemo(() => {
    const list = new Set(data?.periods || []);
    if (data?.suggestedPeriod) list.add(data.suggestedPeriod);
    for (const s of data?.statements || []) list.add(s.period);
    return [...list].sort().reverse();
  }, [data]);

  const chosen = period || data?.suggestedPeriod || periods[0] || '';

  const anomalyGroups = useMemo(() => {
    const map = new Map();
    for (const a of data?.registerAnomalies || []) {
      if (!map.has(a.type)) map.set(a.type, { type: a.type, label: a.label, items: [] });
      map.get(a.type).items.push(a);
    }
    return [...map.values()];
  }, [data]);

  if (loading && !data) return <LoadingBlock rows={3} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not load the statements">
        <span>{error.message}</span>
        <div className="row"><Button size="sm" variant="primary" onClick={reload}>Try again</Button></div>
      </Callout>
    );
  }

  const statements = data?.statements || [];

  const generate = async () => {
    setBusy(true);
    try {
      const result = await api.generateStatements({ period: chosen });
      const created = result.created?.length || 0;
      const existing = result.existing?.length || 0;
      toast.ok(created
        ? `${created} statement${created === 1 ? '' : 's'} generated for ${result.periodLabel}${existing ? `, ${existing} already existed` : ''}.`
        : `Nothing new for ${result.periodLabel}${existing ? `: ${existing} already existed` : ': no settled referrals in that period'}.`);
      await reload();
      refreshPulse();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Card title="Generate a period" hint="One statement per partner, built from the settled referrals in that month">
        <div className="row">
          <Field label="Period" id="st-period">
            <select id="st-period" value={chosen} onChange={(e) => setPeriod(e.target.value)}>
              {periods.length ? periods.map((p) => <option key={p} value={p}>{p}</option>) : <option value="">No settled periods yet</option>}
            </select>
          </Field>
          <div className="spacer" />
          <Button variant="primary" onClick={generate} disabled={busy || !chosen}>Generate statements</Button>
          <a className="btn" href="/api/register.xlsx" download>Export the register</a>
        </div>
      </Card>

      <Card title={`${statements.length} statement${statements.length === 1 ? '' : 's'}`} flush>
        {statements.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Period</th><th>Partner</th><th>Status</th>
                  <th className="num">Lines</th><th className="num">Total</th><th className="num">Anomalies</th>
                  <th>Issued</th><th>Paid</th>
                </tr>
              </thead>
              <tbody>
                {statements.map((s) => (
                  <tr key={s.id} className="clickable" onClick={() => { window.location.hash = `#/statement/${s.id}`; }}>
                    <td><a href={href(`/statement/${s.id}`)}>{s.periodLabel || s.period}</a></td>
                    <td>{s.partnerName}</td>
                    <td><Chip tone={STATUS_TONE[s.status] || 'neutral'}>{s.status}</Chip></td>
                    <td className="num">{s.lineCount}</td>
                    <td className="num">{money(s.total)}</td>
                    <td className="num">{s.anomalyCount ? <Chip tone="amber">{s.anomalyCount}</Chip> : <span className="muted">0</span>}</td>
                    <td>{s.issuedAt ? shortDate(s.issuedAt) : '-'}</td>
                    <td>{s.paidAt ? shortDate(s.paidAt) : '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <div style={{ padding: 16 }}><Empty>No statements yet. Pick a period above and generate.</Empty></div>}
      </Card>

      <Card title="Register anomalies" hint="Found across the whole register, not just one statement">
        {anomalyGroups.length ? (
          <div className="stack">
            {anomalyGroups.map((group) => (
              <div className="callout callout--amber" key={group.type}>
                <strong>{group.label} ({group.items.length})</strong>
                <span className="row row--tight small">
                  {group.items.slice(0, 12).map((a, i) => (
                    a.dealId
                      ? <a key={i} className="mono" href={href(`/deal/${a.dealId}`)}>{a.dealRef || a.dealId}</a>
                      : <span key={i} className="mono">{a.dealRef || '-'}</span>
                  ))}
                  {group.items.length > 12 ? <span className="muted">and {group.items.length - 12} more</span> : null}
                </span>
              </div>
            ))}
          </div>
        ) : <Empty>Nothing flagged. Every settled referral has a referrer, a rule and a disclosure.</Empty>}
      </Card>
    </>
  );
}
