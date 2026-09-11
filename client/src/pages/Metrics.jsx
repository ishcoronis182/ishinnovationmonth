// Metrics, computed from the register: metric, how measured, baseline, current,
// target, status. Plus the trend, the value model, the verdict and AI activity.

import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { href } from '../router.js';
import {
  Card, Button, Chip, RagChip, Field, Callout, Empty, LoadingBlock, Sparkline,
  ProviderTag, Stat, money, stampLabel, shortDate,
} from '../components/ui.jsx';

const STATUS = {
  on_track: { tone: 'green', label: 'On track' },
  watch: { tone: 'amber', label: 'Watch' },
  off_track: { tone: 'red', label: 'Off track' },
  unknown: { tone: 'neutral', label: 'No data yet' },
};

function formatValue(value, unit) {
  if (value == null) return '-';
  if (unit === '%') return `${value}%`;
  if (unit === 'hours') return value < 1 ? `${Math.round(value * 60)} min` : `${value} h`;
  return `${value}${unit && unit !== 'updates' ? ` ${unit}` : (unit === 'updates' ? ' per deal' : '')}`;
}

function BaselineInput({ row, onSave }) {
  const [value, setValue] = useState(row.baseline ?? '');
  return (
    <input
      type="number"
      step="0.1"
      min="0"
      value={value}
      aria-label={`Baseline for ${row.metric}`}
      style={{ width: 90 }}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => {
        const n = Number(value);
        if (Number.isFinite(n) && n !== row.baseline && row.baselineKey) onSave(row.baselineKey, n);
      }}
      onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
    />
  );
}

export default function MetricsPage() {
  const { toast } = useApp();
  const { data, loading, error, reload } = useAsync(() => api.metrics(), []);
  const [model, setModel] = useState(null);

  if (loading && !data) return <LoadingBlock rows={4} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not load the metrics">
        <span>{error.message}</span>
        <div className="row"><Button size="sm" variant="primary" onClick={reload}>Try again</Button></div>
      </Callout>
    );
  }

  const rows = data?.rows || [];
  const value = model || data?.valueModel || {};
  const verdict = data?.verdict || {};
  const aiLog = data?.aiLog || [];
  const aiStatus = data?.aiStatus || {};

  const saveBaseline = async (key, number) => {
    try {
      await api.saveSettings({ baselines: { [key]: number } });
      toast.ok('Baseline saved.');
      reload();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const saveValueModel = async (patch) => {
    try {
      const next = { ...value, ...patch };
      setModel(next);
      await api.saveSettings({ valueModel: next });
      const fresh = await api.metrics();
      setModel(null);
      toast.ok('Value model updated.');
      return fresh;
    } catch (err) {
      toast.error(err.message);
      return null;
    }
  };

  return (
    <>
      <Card title="The table" hint="Every number is computed from the register" flush>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Metric</th>
                <th>How it is measured</th>
                <th className="num">Baseline</th>
                <th className="num">Current</th>
                <th className="num">Target</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key}>
                  <td>
                    <strong>{row.metric}</strong>
                    {row.detail ? <><br /><span className="small muted">{row.detail}</span></> : null}
                  </td>
                  <td className="small">{row.howMeasured}</td>
                  <td className="num"><BaselineInput row={row} onSave={saveBaseline} /></td>
                  <td className="num strong">{formatValue(row.current, row.unit)}</td>
                  <td className="num">{formatValue(row.target, row.unit)}</td>
                  <td><Chip tone={STATUS[row.status]?.tone || 'neutral'}>{STATUS[row.status]?.label || row.status}</Chip></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <div className="grid grid--2">
        <Card title="Referrals per week" hint="Twelve weeks, pilot office">
          <div className="stack">
            <Sparkline
              points={(data?.referrals?.buckets || []).map((b) => b.count)}
              labels={(data?.referrals?.buckets || []).map((b) => b.label)}
              width={320}
              height={56}
            />
            <div className="row row--tight small muted">
              {(data?.referrals?.buckets || []).map((b) => (
                <span key={b.weekStart} title={`Week starting ${b.label}`} style={{ minWidth: 18, textAlign: 'center' }}>{b.count}</span>
              ))}
            </div>
            <span className="small">
              Trend {data?.referrals?.trend?.direction}: {data?.referrals?.trend?.firstHalf} per week in the first six,
              {' '}{data?.referrals?.trend?.secondHalf} in the last six.
            </span>
          </div>
        </Card>

        <Card title="Value model" hint="What one more settlement a month is worth">
          <div className="stack">
            <Stat label="Per year" value={money(value.perYear)} tone="green" note={value.assumption} />
            <div className="row">
              <Field label="Extra settlements a month" id="vm-extra">
                <input id="vm-extra" type="number" step="1" min="0" defaultValue={value.extraSettlementsPerMonth}
                  onBlur={(e) => saveValueModel({ extraSettlementsPerMonth: Number(e.target.value) })} />
              </Field>
              <Field label="Average loan" id="vm-loan">
                <input id="vm-loan" type="number" step="10000" min="0" defaultValue={value.loanAmount}
                  onBlur={(e) => saveValueModel({ loanAmount: Number(e.target.value) })} />
              </Field>
              <Field label="Upfront rate" id="vm-rate" hint="0.0065 is 0.65%">
                <input id="vm-rate" type="number" step="0.0005" min="0" defaultValue={value.upfrontRate}
                  onBlur={(e) => saveValueModel({ upfrontRate: Number(e.target.value) })} />
              </Field>
            </div>
            <span className="small muted">
              {money(value.perSettlement)} per settlement, {money(value.perMonth)} a month.
            </span>
          </div>
        </Card>
      </div>

      <div className="grid grid--2">
        <Card title="Partner verdict" hint="Three questions, 1 to 5, week 1 against week 3">
          {(verdict.questions || []).length ? (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>Question</th><th className="num">Week 1</th><th className="num">Week 3</th></tr>
                </thead>
                <tbody>
                  {verdict.questions.map((q, i) => (
                    <tr key={q}>
                      <td>{q}</td>
                      <td className="num">{verdict.week1?.byQuestion?.[i] ?? '-'}</td>
                      <td className="num">{verdict.week3?.byQuestion?.[i] ?? '-'}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="strong">Mean</td>
                    <td className="num strong">{verdict.week1?.mean ?? '-'}</td>
                    <td className="num strong">{verdict.week3?.mean ?? '-'}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          ) : <Empty>No survey responses yet.</Empty>}
          <span className="small muted">
            Week 1: {verdict.week1?.responses ?? 0} response{verdict.week1?.responses === 1 ? '' : 's'}.
            {' '}Week 3: {verdict.week3?.responses ? `${verdict.week3.responses} responses` : 'nobody has answered yet, so there is nothing to compare.'}
          </span>
        </Card>

        <Card title="Handovers, last ten" hint="RAG on arrival is what counts, not the RAG today">
          {(data?.handover?.sample || []).length ? (
            <div className="stack stack--tight">
              {data.handover.sample.map((s) => (
                <div className="row row--tight" key={s.id}>
                  <a className="mono" href={href(`/deal/${s.id}`)}>{s.ref}</a>
                  <RagChip rag={s.rag} />
                  <span className="small muted">{stampLabel(s.createdAt)}</span>
                </div>
              ))}
            </div>
          ) : <Empty>No handovers recorded yet.</Empty>}
        </Card>
      </div>

      <Card
        title="AI activity"
        hint={aiStatus.enabled
          ? `Claude ${aiStatus.model}, effort ${aiStatus.effort}`
          : `AI is off (${(aiStatus.disabledReason || 'no_api_key').replace(/_/g, ' ')}): every step used the deterministic fallback`}
        flush
      >
        {aiLog.length ? (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>When</th><th>Task</th><th>Provider</th><th>Model</th><th className="num">ms</th><th className="num">Tokens</th><th>Outcome</th></tr>
              </thead>
              <tbody>
                {aiLog.map((row) => (
                  <tr key={row.id}>
                    <td className="nowrap small">{stampLabel(row.at)}</td>
                    <td>{row.task}</td>
                    <td><ProviderTag provider={row.provider} /></td>
                    <td className="small">{row.model || '-'}</td>
                    <td className="num">{row.ms ?? 0}</td>
                    <td className="num small">{row.tokens ? `${row.tokens.input || 0} in / ${row.tokens.output || 0} out` : '-'}</td>
                    <td className="small">
                      {row.ok
                        ? <Chip tone="green">ok</Chip>
                        : <Chip tone={row.degraded ? 'amber' : 'neutral'}>{String(row.reason || 'fallback').replace(/_/g, ' ')}</Chip>}
                      {row.message ? <><br /><span className="muted">{row.message}</span></> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 16 }}>
            <Empty>
              No AI calls yet this session. {aiStatus.enabled ? 'Extract a handover to see one here.' : 'With no API key, every step runs the offline rules and is logged as such.'}
            </Empty>
          </div>
        )}
      </Card>

      <div className="row">
        <Button size="sm" onClick={reload}>Refresh the metrics</Button>
        <span className="small muted">Baselines are editable. Everything else is measured.</span>
      </div>
    </>
  );
}
