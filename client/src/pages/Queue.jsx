// The processing queue: kanban across the six stages, off-ramps collapsed,
// with a table toggle.

import React, { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import { href } from '../router.js';
import {
  Card, Button, RagChip, Chip, Empty, LoadingBlock, Callout, LinkButton,
  money, shortDate, stampLabel,
} from '../components/ui.jsx';

const STAGE_LABELS = {
  referred: 'Referred',
  application: 'Application',
  lodged: 'Lodged',
  conditional: 'Conditional',
  formal: 'Formal approval',
  settled: 'Settled',
  declined: 'Declined',
  withdrawn: 'Withdrawn',
};

function DealCard({ deal }) {
  const missing = deal.ragDetail?.missing || [];
  return (
    <a className={`deal-card deal-card--${deal.rag}`} href={href(`/deal/${deal.id}`)}>
      <span className="deal-card__top">
        <span className="deal-card__name">{deal.clientLabel}</span>
        <RagChip rag={deal.rag} label={deal.rag === 'green' ? 'Complete' : `${missing.length} gap${missing.length === 1 ? '' : 's'}`}
          title={missing.length ? `Missing: ${missing.join(', ')}` : 'All ten fields complete'} />
      </span>
      <span className="deal-card__meta">
        <span title={deal.propertyAddress || undefined}>
          {deal.propertyAddress ? deal.propertyAddress.split(',')[0] : 'No security property yet'}
        </span>
        <span>
          {deal.partnerName ? `via ${deal.partnerName}` : 'No referrer recorded'}
          {deal.loanAmount ? ` · ${money(deal.loanAmount)}` : ''}
        </span>
      </span>
      <span className="deal-card__foot">
        <span className="mono">{deal.ref}</span>
        {deal.daysInStage != null ? <span>{deal.daysInStage}d in stage</span> : null}
        {deal.lastUpdate ? <span>updated {shortDate(deal.lastUpdate.at)}</span> : <span>no update sent</span>}
        {deal.consent?.shareStatus ? null : <Chip tone="amber" title="No consent recorded to share status with the referrer">no consent</Chip>}
      </span>
    </a>
  );
}

function KanbanView({ deals, stages, offRamps }) {
  const [showOffRamp, setShowOffRamp] = useState(false);
  const byStage = useMemo(() => {
    const map = {};
    for (const stage of [...stages, ...offRamps]) map[stage] = [];
    for (const deal of deals) (map[deal.stage] ||= []).push(deal);
    return map;
  }, [deals, stages, offRamps]);
  const offRampDeals = offRamps.flatMap((s) => byStage[s] || []);

  return (
    <div className="kanban">
      {stages.map((stage) => (
        <section className="kanban__col" key={stage} aria-label={STAGE_LABELS[stage]}>
          <div className="kanban__head">
            <h3>{STAGE_LABELS[stage]}</h3>
            <span className="kanban__count">{(byStage[stage] || []).length}</span>
          </div>
          {(byStage[stage] || []).length
            ? (byStage[stage] || []).map((deal) => <DealCard key={deal.id} deal={deal} />)
            : <span className="small muted">Nothing here</span>}
        </section>
      ))}
      <section className={`kanban__col kanban__col--offramp${showOffRamp ? '' : ''}`} aria-label="Off ramp">
        <div className="kanban__head">
          <h3>Off ramp</h3>
          <span className="kanban__count">{offRampDeals.length}</span>
        </div>
        <Button size="sm" variant="ghost" onClick={() => setShowOffRamp((v) => !v)} aria-expanded={showOffRamp}>
          {showOffRamp ? 'Collapse' : 'Show'} declined and withdrawn
        </Button>
        {showOffRamp
          ? (offRampDeals.length
            ? offRampDeals.map((deal) => <DealCard key={deal.id} deal={deal} />)
            : <span className="small muted">Nothing off ramp</span>)
          : null}
      </section>
    </div>
  );
}

function TableView({ deals }) {
  return (
    <Card flush>
      <div className="table-wrap">
        <table className="data">
          <thead>
            <tr>
              <th>Ref</th>
              <th>Client</th>
              <th>Stage</th>
              <th>RAG</th>
              <th>Referred by</th>
              <th className="num">Loan</th>
              <th>Lender</th>
              <th className="num">Days in stage</th>
              <th>Last update</th>
              <th className="num">Comms</th>
            </tr>
          </thead>
          <tbody>
            {deals.map((deal) => (
              <tr key={deal.id} className="clickable" onClick={() => { window.location.hash = `#/deal/${deal.id}`; }}>
                <td className="mono">{deal.ref}</td>
                <td><a href={href(`/deal/${deal.id}`)}>{deal.clientLabel}</a></td>
                <td>{STAGE_LABELS[deal.stage] || deal.stage}</td>
                <td><RagChip rag={deal.rag} /></td>
                <td>{deal.partnerName || <span className="muted">unknown</span>}</td>
                <td className="num">{money(deal.loanAmount)}</td>
                <td>{deal.lender || <span className="muted">-</span>}</td>
                <td className="num">{deal.daysInStage ?? '-'}</td>
                <td>{deal.lastUpdate ? shortDate(deal.lastUpdate.at) : <span className="muted">never</span>}</td>
                <td className="num">{deal.commission?.recordedAmount != null ? money(deal.commission.recordedAmount) : (deal.commission?.projectedAmount != null ? <span className="muted">{money(deal.commission.projectedAmount)}</span> : '-')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function QueuePage() {
  const { boot } = useApp();
  const [view, setView] = useState('kanban');
  const [partner, setPartner] = useState('');
  const [rag, setRag] = useState('');
  const { data, loading, error, reload } = useAsync(() => api.deals(), []);

  const deals = useMemo(() => {
    let list = data?.deals || [];
    if (partner) list = list.filter((d) => (partner === 'unknown' ? !d.referredBy : d.referredBy === partner));
    if (rag) list = list.filter((d) => d.rag === rag);
    return list;
  }, [data, partner, rag]);

  if (loading && !data) return <LoadingBlock rows={4} />;
  if (error) {
    return (
      <Callout tone="red" title="Could not load the queue">
        <span>{error.message}</span>
        <div className="row"><Button size="sm" variant="primary" onClick={reload}>Try again</Button></div>
      </Callout>
    );
  }

  const stages = boot?.stages || [];
  const offRamps = boot?.offRamps || [];
  const reds = deals.filter((d) => d.rag === 'red').length;

  return (
    <>
      <Card>
        <div className="card__head">
          <h2>{deals.length} record{deals.length === 1 ? '' : 's'}</h2>
          <span className="card__hint">
            {reds ? `${reds} red, waiting on the broker` : 'No red records'}
          </span>
          <div className="btn-group" role="group" aria-label="View">
            <button type="button" aria-pressed={view === 'kanban'} onClick={() => setView('kanban')}>Kanban</button>
            <button type="button" aria-pressed={view === 'table'} onClick={() => setView('table')}>Table</button>
          </div>
          <Button size="sm" onClick={reload}>Refresh</Button>
          <LinkButton to="/handover" size="sm" variant="primary">Paste a handover</LinkButton>
        </div>
        <div className="row">
          <div className="field" style={{ minWidth: 200 }}>
            <label htmlFor="q-partner">Referred by</label>
            <select id="q-partner" value={partner} onChange={(e) => setPartner(e.target.value)}>
              <option value="">Everyone</option>
              <option value="direct">Direct</option>
              <option value="unknown">Unknown referrer</option>
              {(data?.partners || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div className="field" style={{ minWidth: 160 }}>
            <label htmlFor="q-rag">Record health</label>
            <select id="q-rag" value={rag} onChange={(e) => setRag(e.target.value)}>
              <option value="">Any</option>
              <option value="green">Green: complete</option>
              <option value="amber">Amber: minor gaps</option>
              <option value="red">Red: critical gaps</option>
            </select>
          </div>
          {(partner || rag) ? (
            <Button size="sm" variant="ghost" onClick={() => { setPartner(''); setRag(''); }}>Clear filters</Button>
          ) : null}
        </div>
      </Card>

      {deals.length === 0
        ? <Empty>No records match that filter. <a href={href('/handover')}>Paste a handover</a> to start one.</Empty>
        : (view === 'kanban'
          ? <KanbanView deals={deals} stages={stages} offRamps={offRamps} />
          : <TableView deals={deals} />)}

      <Card title="How the RAG works" hint="Recorded on arrival, because that is the metric">
        <div className="row">
          <RagChip rag="red" label="Red" /> <span className="small">a critical field is missing: client name, broker, referrer, purpose, loan amount, lender once lodged, or the address on a purchase.</span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <RagChip rag="amber" label="Amber" /> <span className="small">only minor gaps: contact details, key dates, or the lender before lodgement.</span>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <RagChip rag="green" label="Green" /> <span className="small">all ten fields complete. This is what "handover complete first time" counts.</span>
        </div>
      </Card>
    </>
  );
}
