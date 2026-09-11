// Layout and routing. The portal, the buyer form and the login page render
// without the broker shell.

import React, { useEffect, useState } from 'react';
import { useApp, Toasts } from './state.jsx';
import { href, navigate } from './router.js';
import { Wordmark, Button, LoadingBlock, Callout, money } from './components/ui.jsx';

import QueuePage from './pages/Queue.jsx';
import HandoverPage from './pages/Handover.jsx';
import DealPage from './pages/Deal.jsx';
import PartnersPage from './pages/Partners.jsx';
import PartnerPage from './pages/Partner.jsx';
import FridayPage from './pages/Friday.jsx';
import StatementsPage from './pages/Statements.jsx';
import StatementPage from './pages/Statement.jsx';
import MetricsPage from './pages/Metrics.jsx';
import SettingsPage from './pages/Settings.jsx';
import PortalPage from './pages/Portal.jsx';
import ReferPage from './pages/Refer.jsx';
import LoginPage from './pages/Login.jsx';

const NAV = [
  { to: '/', name: 'queue', label: 'Queue', badge: 'inFlight' },
  { to: '/handover', name: 'handover', label: 'Handover' },
  { to: '/partners', name: 'partners', label: 'Partners' },
  { to: '/friday', name: 'friday', label: 'Friday note' },
  { to: '/statements', name: 'statements', label: 'Statements', badge: 'commsDue' },
  { to: '/metrics', name: 'metrics', label: 'Metrics' },
  { to: '/settings', name: 'settings', label: 'Settings' },
];

const TITLES = {
  queue: ['Processing queue', 'Every deal, one record, RAG on arrival'],
  handover: ['Handover', 'Paste what you have. Claude fills the ten fields.'],
  deal: ['Deal', 'The one record everyone can see'],
  partners: ['Partners', 'Who refers, what they are owed, what they can see'],
  partner: ['Partner', 'Their deals, updates, statements and links'],
  friday: ['Friday note', 'What each agent hears, and the nudge that goes with it'],
  statements: ['Statements', 'One statement per partner per month'],
  statement: ['Statement', 'The five numbers, the lines, the anomalies'],
  metrics: ['Metrics', 'Measured from the register, not from memory'],
  settings: ['Settings', 'Firm, rules, baselines, integrations'],
  notfound: ['Not found', 'That page does not exist'],
};

function Sidebar({ open, onClose }) {
  const { route, pulse, firm, ai } = useApp();
  return (
    <nav className={`sidebar${open ? ' sidebar--open' : ''}`} aria-label="Main">
      <Wordmark />
      <div className="sidebar__nav">
        {NAV.map((item) => {
          const active = route.name === item.name
            || (item.name === 'partners' && route.name === 'partner')
            || (item.name === 'statements' && route.name === 'statement')
            || (item.name === 'queue' && route.name === 'deal');
          const badgeValue = item.badge === 'inFlight'
            ? pulse.inFlight
            : (item.badge === 'commsDue' ? (pulse.commsDue ? money(pulse.commsDue) : null) : null);
          return (
            <a
              key={item.to}
              className="sidebar__link"
              href={href(item.to)}
              aria-current={active ? 'page' : undefined}
              onClick={onClose}
            >
              <span>{item.label}</span>
              {badgeValue ? <span className="sidebar__badge">{badgeValue}</span> : null}
            </a>
          );
        })}
      </div>

      <div className="pulse-panel" aria-label="Live pulse">
        <span className="pulse-panel__title"><span className="pulse-dot" aria-hidden="true" />Live pulse</span>
        <div className="pulse-row">
          <span className="pulse-row__label">In flight</span>
          <span className="pulse-row__value">{pulse.inFlight}</span>
        </div>
        <div className="pulse-row">
          <span className="pulse-row__label">Red records</span>
          <span className={`pulse-row__value${pulse.redRecords ? ' pulse-row__value--red' : ''}`}>{pulse.redRecords}</span>
        </div>
        <div className="pulse-row">
          <span className="pulse-row__label">Comms due</span>
          <span className="pulse-row__value pulse-row__value--teal">{money(pulse.commsDue)}</span>
        </div>
        <div className="pulse-row">
          <span className="pulse-row__label">Updates this week</span>
          <span className="pulse-row__value">{pulse.updatesThisWeek}</span>
        </div>
      </div>

      <div className="sidebar__foot">
        <span>{firm.name} &middot; {firm.office}</span>
        <span>{ai.enabled ? `Claude ${ai.model}` : 'Offline mode: deterministic fallbacks'}</span>
      </div>
    </nav>
  );
}

function Page() {
  const { route } = useApp();
  switch (route.name) {
    case 'queue': return <QueuePage />;
    case 'handover': return <HandoverPage />;
    case 'deal': return <DealPage id={route.params.id} />;
    case 'partners': return <PartnersPage />;
    case 'partner': return <PartnerPage id={route.params.id} />;
    case 'friday': return <FridayPage />;
    case 'statements': return <StatementsPage />;
    case 'statement': return <StatementPage id={route.params.id} />;
    case 'metrics': return <MetricsPage />;
    case 'settings': return <SettingsPage />;
    default:
      return (
        <Callout tone="amber" title="Nothing here">
          <span>That page does not exist. <a href={href('/')}>Back to the queue</a>.</span>
        </Callout>
      );
  }
}

export default function App() {
  const { route, status, error, boot, reload } = useApp();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => { setMenuOpen(false); }, [route.name, route.params.id]);

  if (route.name === 'portal') return <><PortalPage token={route.params.token} /><Toasts /></>;
  if (route.name === 'refer') return <><ReferPage token={route.params.token} /><Toasts /></>;
  if (route.name === 'login' || status === 'unauthorised') {
    return (
      <>
        <LoginPage onSignedIn={async () => { await reload(); navigate('/'); }} />
        <Toasts />
      </>
    );
  }

  const [title, subtitle] = TITLES[route.name] || TITLES.notfound;

  return (
    <div className="shell">
      <a className="skip-link" href="#main">Skip to content</a>
      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />
      <div className="main">
        <header className="topbar">
          <Button
            className="menu-toggle"
            variant="ghost"
            size="sm"
            onClick={() => setMenuOpen((v) => !v)}
            aria-expanded={menuOpen}
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          >
            ☰
          </Button>
          <div className="topbar__title">
            <h1>{title}</h1>
            <span className="topbar__sub">{subtitle}</span>
          </div>
          <div className="topbar__actions">
            <span className="chip chip--neutral" title="Today in the firm's timezone">{boot?.today || '...'}</span>
            {boot?.ai?.enabled
              ? <span className="chip chip--teal" title={`Claude ${boot.ai.model}, effort ${boot.ai.effort}`}>Claude on</span>
              : <span className="chip chip--neutral" title="No API key: every AI step uses the deterministic fallback">Offline mode</span>}
            <a className="btn btn--primary btn--sm" href={href('/handover')}>New handover</a>
          </div>
        </header>

        <main className="content" id="main">
          {status === 'loading' && !boot ? <LoadingBlock rows={3} /> : null}
          {status === 'error' ? (
            <Callout tone="red" title="Could not load PARTNER PULSE">
              <span>{error?.message || 'The server did not answer.'}</span>
              <div className="row"><Button variant="primary" size="sm" onClick={reload}>Try again</Button></div>
            </Callout>
          ) : null}
          {boot ? <Page /> : null}
        </main>
      </div>
      <Toasts />
    </div>
  );
}
