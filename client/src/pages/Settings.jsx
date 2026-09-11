// Firm, integrations, the commission rules editor, baselines, and a demo reset.

import React, { useState } from 'react';
import { api } from '../api.js';
import { useApp, useAsync } from '../state.jsx';
import {
  Card, Button, Chip, Field, Callout, Empty, LoadingBlock, Modal, money,
} from '../components/ui.jsx';

const TYPES = [
  ['flat', 'Flat per settled loan'],
  ['bps', 'Basis points of the loan'],
  ['share_upfront', 'Share of upfront commission'],
  ['tiered', 'Tiered by loan size'],
];

const BASELINES = [
  ['handoverFirstTimePct', 'Handovers complete first time (%)'],
  ['updatesPerDeal', 'Updates per referred deal'],
  ['statementHours', 'Statement production time (hours)'],
  ['enquiriesPerWeek', 'Partner enquiries per week'],
  ['referralsPerWeek', 'Referrals per week'],
  ['referralsPerWeekTarget', 'Referrals per week target'],
  ['partnerVerdict', 'Partner verdict (out of 5)'],
];

function RuleEditor({ rule, partners, onChange, onRemove }) {
  const set = (patch) => onChange({ ...rule, ...patch });
  return (
    <div className="callout" style={{ display: 'grid', gap: 10 }}>
      <div className="row">
        <Field label="Name" id={`r-name-${rule.id}`}>
          <input id={`r-name-${rule.id}`} value={rule.name || ''} onChange={(e) => set({ name: e.target.value })} style={{ minWidth: 200 }} />
        </Field>
        <Field label="Applies to" id={`r-scope-${rule.id}`}>
          <select
            id={`r-scope-${rule.id}`}
            value={rule.scope === 'partner' ? (rule.partnerId || '') : 'global'}
            onChange={(e) => (e.target.value === 'global'
              ? set({ scope: 'global', partnerId: null })
              : set({ scope: 'partner', partnerId: e.target.value }))}
          >
            <option value="global">All partners</option>
            {(partners || []).map((p) => <option key={p.id} value={p.id}>{p.name} only</option>)}
          </select>
        </Field>
        <Field label="Type" id={`r-type-${rule.id}`}>
          <select id={`r-type-${rule.id}`} value={rule.type} onChange={(e) => set({ type: e.target.value })}>
            {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </Field>
        <Field label="Effective from" id={`r-from-${rule.id}`}>
          <input id={`r-from-${rule.id}`} type="date" value={rule.effectiveFrom || ''} onChange={(e) => set({ effectiveFrom: e.target.value })} />
        </Field>
      </div>

      <div className="row">
        {rule.type === 'flat' ? (
          <Field label="Amount per settled referral" id={`r-flat-${rule.id}`}>
            <input id={`r-flat-${rule.id}`} type="number" min="0" step="50" value={rule.flatAmount ?? ''} onChange={(e) => set({ flatAmount: Number(e.target.value) })} />
          </Field>
        ) : null}
        {rule.type === 'bps' ? (
          <Field label="Basis points of the loan" id={`r-bps-${rule.id}`} hint="15 bps is 0.15%">
            <input id={`r-bps-${rule.id}`} type="number" min="0" step="1" value={rule.bps ?? ''} onChange={(e) => set({ bps: Number(e.target.value) })} />
          </Field>
        ) : null}
        {rule.type === 'share_upfront' ? (
          <>
            <Field label="Share of upfront (%)" id={`r-share-${rule.id}`}>
              <input id={`r-share-${rule.id}`} type="number" min="0" max="100" step="1" value={rule.sharePct ?? ''} onChange={(e) => set({ sharePct: Number(e.target.value) })} />
            </Field>
            <Field label="Upfront assumed (bps)" id={`r-up-${rule.id}`} hint="65 bps is 0.65%">
              <input id={`r-up-${rule.id}`} type="number" min="0" step="1" value={rule.upfrontBps ?? ''} onChange={(e) => set({ upfrontBps: Number(e.target.value) })} />
            </Field>
          </>
        ) : null}
        {rule.type === 'tiered' ? (
          <div className="stack" style={{ flex: 1 }}>
            {(rule.tiers || []).map((tier, i) => (
              <div className="row" key={i}>
                <Field label="From loan" id={`r-tmin-${rule.id}-${i}`}>
                  <input id={`r-tmin-${rule.id}-${i}`} type="number" min="0" step="50000" value={tier.minLoan ?? 0}
                    onChange={(e) => set({ tiers: rule.tiers.map((t, j) => (j === i ? { ...t, minLoan: Number(e.target.value) } : t)) })} />
                </Field>
                <Field label="Pays" id={`r-tamt-${rule.id}-${i}`}>
                  <input id={`r-tamt-${rule.id}-${i}`} type="number" min="0" step="50" value={tier.amount ?? 0}
                    onChange={(e) => set({ tiers: rule.tiers.map((t, j) => (j === i ? { ...t, type: 'flat', amount: Number(e.target.value) } : t)) })} />
                </Field>
                <Button size="sm" variant="ghost" onClick={() => set({ tiers: rule.tiers.filter((_, j) => j !== i) })}>Remove tier</Button>
              </div>
            ))}
            <div className="row">
              <Button size="sm" onClick={() => set({ tiers: [...(rule.tiers || []), { minLoan: 0, type: 'flat', amount: 0 }] })}>Add a tier</Button>
            </div>
          </div>
        ) : null}
        <div className="spacer" />
        <label className="check">
          <input type="checkbox" checked={rule.active !== false} onChange={(e) => set({ active: e.target.checked })} />
          <span className="check__body"><span>Active</span></span>
        </label>
        <Button size="sm" variant="ghost" onClick={onRemove}>Remove rule</Button>
      </div>

      <Field label="Note" id={`r-note-${rule.id}`}>
        <input id={`r-note-${rule.id}`} value={rule.note || ''} onChange={(e) => set({ note: e.target.value })} />
      </Field>
      {rule.description ? <span className="small muted">Currently: {rule.description}</span> : null}
    </div>
  );
}

export default function SettingsPage() {
  const { boot, toast, reload: reloadBoot } = useApp();
  const { data: rulesData, setData: setRulesData, loading, reload: reloadRules } = useAsync(() => api.rules(), []);
  const { data: health, reload: reloadHealth } = useAsync(() => api.health(), []);
  const [firm, setFirm] = useState(null);
  const [resetting, setResetting] = useState(false);
  const [saving, setSaving] = useState(false);

  const currentFirm = firm || boot?.firm || { name: '', broker: '', office: '' };
  const rules = rulesData?.rules || [];

  const saveFirm = async () => {
    setSaving(true);
    try {
      await api.saveSettings({ firm: currentFirm });
      await reloadBoot();
      toast.ok('Firm details saved.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const saveRules = async () => {
    setSaving(true);
    try {
      const result = await api.saveRules(rules);
      setRulesData({ ...rulesData, rules: result.rules });
      toast.ok('Rules saved. New settlements use them straight away.');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const setRule = (index, next) => {
    setRulesData({ ...rulesData, rules: rules.map((r, i) => (i === index ? next : r)) });
  };

  return (
    <>
      <Card title="Firm">
        <div className="row">
          <Field label="Firm name" id="s-firm">
            <input id="s-firm" value={currentFirm.name || ''} onChange={(e) => setFirm({ ...currentFirm, name: e.target.value })} />
          </Field>
          <Field label="Broker" id="s-broker">
            <input id="s-broker" value={currentFirm.broker || ''} onChange={(e) => setFirm({ ...currentFirm, broker: e.target.value })} />
          </Field>
          <Field label="Pilot office" id="s-office">
            <input id="s-office" value={currentFirm.office || ''} onChange={(e) => setFirm({ ...currentFirm, office: e.target.value })} />
          </Field>
          <div className="spacer" />
          <Button variant="primary" onClick={saveFirm} disabled={saving}>Save firm</Button>
        </div>
        <span className="small muted">The broker name signs every partner message.</span>
      </Card>

      <Card title="Integrations" hint="What is real and what is a placeholder right now">
        <div className="row row--tight">
          <Chip tone="neutral">Timezone {health?.tz || boot?.tz}</Chip>
          <Chip tone={health?.authEnabled ? 'green' : 'amber'}>{health?.authEnabled ? 'Passcode on' : 'No passcode'}</Chip>
          <Chip tone={health?.aiEnabled ? 'teal' : 'neutral'}>{health?.aiEnabled ? `Claude ${health.model}` : 'Offline mode'}</Chip>
          <Chip tone="neutral">SMS: {health?.smsProvider}</Chip>
          <Chip tone="neutral">Email: {health?.emailProvider}</Chip>
          <Chip tone={health?.publicUrlSet ? 'green' : 'amber'}>{health?.publicUrlSet ? 'Public URL set' : 'No public URL'}</Chip>
          <div className="spacer" />
          <Button size="sm" onClick={reloadHealth}>Re-check</Button>
        </div>
        <div className="stack" style={{ marginTop: 12 }}>
          {(health?.warnings || []).length
            ? health.warnings.map((w, i) => <Callout tone="amber" key={i}><span>{w}</span></Callout>)
            : <Callout tone="green"><span>Nothing to flag. This instance is configured for a pilot.</span></Callout>}
        </div>
      </Card>

      <Card
        title="Referral commission rules"
        hint="A partner override beats the global rule; among rules in effect, the latest effective date wins."
      >
        {loading && !rulesData ? <LoadingBlock rows={2} title={false} /> : (
          <div className="stack">
            {rules.length ? rules.map((rule, index) => (
              <RuleEditor
                key={rule.id || index}
                rule={rule}
                partners={rulesData?.partners}
                onChange={(next) => setRule(index, next)}
                onRemove={() => setRulesData({ ...rulesData, rules: rules.filter((_, i) => i !== index) })}
              />
            )) : <Empty>No rules. Settled referrals will be flagged as having no rule.</Empty>}
            <div className="row">
              <Button
                size="sm"
                onClick={() => setRulesData({
                  ...rulesData,
                  rules: [...rules, {
                    id: '',
                    name: 'New rule',
                    scope: 'global',
                    partnerId: null,
                    type: 'flat',
                    flatAmount: 500,
                    upfrontBps: 65,
                    tiers: [],
                    effectiveFrom: boot?.today || '',
                    active: true,
                  }],
                })}
              >
                Add a rule
              </Button>
              <div className="spacer" />
              <Button size="sm" onClick={reloadRules}>Discard changes</Button>
              <Button variant="primary" onClick={saveRules} disabled={saving}>Save rules</Button>
            </div>
          </div>
        )}
      </Card>

      <Card title="Baselines" hint="What the pilot is being measured against">
        <div className="grid grid--3">
          {BASELINES.map(([key, label]) => (
            <Field key={key} label={label} id={`b-${key}`}>
              <input
                id={`b-${key}`}
                type="number"
                step="0.1"
                min="0"
                defaultValue={boot?.settings?.baselines?.[key] ?? ''}
                onBlur={async (e) => {
                  const n = Number(e.target.value);
                  if (!Number.isFinite(n)) return;
                  try {
                    await api.saveSettings({ baselines: { [key]: n } });
                    await reloadBoot();
                    toast.ok(`${label} baseline saved.`);
                  } catch (err) {
                    toast.error(err.message);
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
              />
            </Field>
          ))}
        </div>
      </Card>

      <Card title="Demo data">
        <div className="row">
          <span className="small muted">
            Resets the register to the demo deck: {boot?.counts?.deals ?? 0} deals, {boot?.counts?.partners ?? 0} partners,
            {' '}{boot?.counts?.statements ?? 0} statements.
          </span>
          <div className="spacer" />
          <Button variant="danger" onClick={() => setResetting(true)}>Reset the demo</Button>
        </div>
      </Card>

      {resetting ? (
        <Modal title="Reset the demo" onClose={() => setResetting(false)}>
          <Callout tone="red" title="Everything you have changed is discarded">
            <span>Deals, partners, messages and statements all go back to the seeded deck, dated from today.</span>
          </Callout>
          <div className="row row--end">
            <Button onClick={() => setResetting(false)}>Cancel</Button>
            <Button
              variant="danger"
              onClick={async () => {
                try {
                  const result = await api.resetDemo();
                  await reloadBoot();
                  setResetting(false);
                  toast.ok(`Demo reset: ${result.counts.deals} deals, ${result.counts.partners} partners.`);
                } catch (err) {
                  toast.error(err.message);
                }
              }}
            >
              Reset it
            </Button>
          </div>
        </Modal>
      ) : null}
    </>
  );
}
