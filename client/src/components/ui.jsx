// Shared UI pieces. Every page composes from here so the look stays one look.

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { href } from '../router.js';

export function Wordmark({ ink = false, label = 'PARTNER PULSE', to = '/' }) {
  return (
    <a className={`wordmark${ink ? ' wordmark--ink' : ''}`} href={href(to)} aria-label={`${label} home`}>
      <svg className="wordmark__ecg" width="34" height="18" viewBox="0 0 34 18" aria-hidden="true">
        <path className="wordmark__trace" d="M1 9h6l2.5-6L14 15l3.5-9 2 4h12" />
      </svg>
      <span>{label}</span>
    </a>
  );
}

const RAG_LABEL = { green: 'Green', amber: 'Amber', red: 'Red' };

export function RagChip({ rag, label, title }) {
  const key = rag || 'neutral';
  return (
    <span className={`chip chip--${key}`} title={title || `${RAG_LABEL[key] || 'Unknown'} record`}>
      <span className="chip__dot" aria-hidden="true" />
      {label || RAG_LABEL[key] || 'Unknown'}
    </span>
  );
}

export function Chip({ tone = 'neutral', children, title }) {
  return <span className={`chip chip--${tone}`} title={title}>{children}</span>;
}

export function ProviderTag({ provider, title }) {
  if (!provider) return null;
  const label = provider === 'claude' ? 'Claude' : (provider === 'heuristic' ? 'Offline rules' : 'Template');
  return (
    <span className={`tag tag--${provider}`} title={title || `Produced by ${label}`}>{label}</span>
  );
}

export function Button({ variant, size, block, className, children, ...rest }) {
  const classes = ['btn'];
  if (variant) classes.push(`btn--${variant}`);
  if (size) classes.push(`btn--${size}`);
  if (block) classes.push('btn--block');
  if (className) classes.push(className);
  return <button type="button" className={classes.join(' ')} {...rest}>{children}</button>;
}

export function LinkButton({ to, variant, size, className, children, ...rest }) {
  const classes = ['btn'];
  if (variant) classes.push(`btn--${variant}`);
  if (size) classes.push(`btn--${size}`);
  if (className) classes.push(className);
  const target = to.startsWith('http') || to.startsWith('/api') ? to : href(to);
  return <a className={classes.join(' ')} href={target} {...rest}>{children}</a>;
}

export function Card({ title, hint, actions, children, flush = false, as = 'section', id }) {
  const Tag = as;
  return (
    <Tag className={`card${flush ? ' card--flush' : ''}`} id={id}>
      {(title || actions) && (
        <div className="card__head" style={flush ? { padding: '14px 16px 0' } : undefined}>
          {title ? <h2>{title}</h2> : <span className="spacer" />}
          {hint ? <span className="card__hint">{hint}</span> : null}
          {actions}
        </div>
      )}
      {children}
    </Tag>
  );
}

export function Stat({ label, value, note, tone }) {
  return (
    <div className={`stat${tone ? ` stat--${tone}` : ''}`}>
      <span className="stat__label">{label}</span>
      <span className="stat__value">{value}</span>
      {note ? <span className="stat__note">{note}</span> : null}
    </div>
  );
}

export function Empty({ children }) {
  return <div className="empty">{children}</div>;
}

export function Callout({ tone = 'teal', title, children }) {
  return (
    <div className={`callout callout--${tone}`}>
      {title ? <strong>{title}</strong> : null}
      {children}
    </div>
  );
}

export function Skeleton({ variant, style }) {
  return <div className={`skeleton${variant ? ` skeleton--${variant}` : ''}`} style={style} aria-hidden="true" />;
}

export function LoadingBlock({ rows = 3, title = true }) {
  return (
    <div className="stack" aria-busy="true" aria-live="polite">
      {title ? <Skeleton variant="title" /> : null}
      {Array.from({ length: rows }, (_, i) => <Skeleton key={i} variant="card" />)}
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function Field({ label, hint, missing, children, id, confidence }) {
  return (
    <div className={`field${missing ? ' field--missing' : ''}`}>
      {label ? (
        <label htmlFor={id}>
          {label}
          {missing ? <span className="field__note field__note--missing"> - missing</span> : null}
        </label>
      ) : null}
      {children}
      {confidence !== undefined && confidence !== null ? <Confidence value={confidence} /> : null}
      {hint ? <span className="field__note">{hint}</span> : null}
    </div>
  );
}

export function Confidence({ value }) {
  const pct = Math.round(Math.max(0, Math.min(1, Number(value) || 0)) * 100);
  const tone = pct >= 70 ? '' : (pct >= 40 ? ' confidence__fill--low' : ' confidence__fill--vlow');
  return (
    <div className="confidence" title={`Confidence ${pct}%`}>
      <div className="confidence__bar">
        <div className={`confidence__fill${tone}`} style={{ width: `${pct}%` }} />
      </div>
      <span className="field__note">{pct}% confident</span>
    </div>
  );
}

export function StagePipeline({ pipeline, stage, offRamp, compact = false }) {
  const steps = pipeline || [];
  return (
    <div className="pipeline" role="list" aria-label="Deal stage">
      {steps.map((step) => (
        <span
          key={step.key}
          role="listitem"
          className={`pipeline__step${step.current ? ' pipeline__step--current' : ''}${step.done ? ' pipeline__step--done' : ''}`}
          aria-current={step.current ? 'step' : undefined}
        >
          {compact ? step.label.slice(0, 4) : step.label}
        </span>
      ))}
      {offRamp ? <span role="listitem" className="pipeline__step pipeline__step--offramp">{stage}</span> : null}
    </div>
  );
}

/** Highlight the guard's hits inside the text it checked. */
export function HighlightedText({ text, hits = [] }) {
  const parts = useMemo(() => {
    const source = String(text || '');
    const sorted = [...hits].filter((h) => h && h.end > h.start).sort((a, b) => a.start - b.start);
    const out = [];
    let cursor = 0;
    for (const hit of sorted) {
      if (hit.start < cursor) continue;
      if (hit.start > cursor) out.push({ text: source.slice(cursor, hit.start) });
      out.push({ text: source.slice(hit.start, hit.end), hit });
      cursor = hit.end;
    }
    if (cursor < source.length) out.push({ text: source.slice(cursor) });
    return out;
  }, [text, hits]);

  return (
    <>
      {parts.map((part, i) => (part.hit
        ? (
          <mark key={i} className={`hit${part.hit.severity === 'warn' ? ' hit--warn' : ''}`} title={`${part.hit.severity === 'warn' ? 'Check' : 'Blocked'}: ${part.hit.label}`}>
            {part.text}
          </mark>
        )
        : <React.Fragment key={i}>{part.text}</React.Fragment>))}
    </>
  );
}

export function ComplianceReport({ result, label = 'Compliance check' }) {
  if (!result) return null;
  const blocked = result.blocked || [];
  const warnings = result.warnings || [];
  const tone = blocked.length ? 'blocked' : (warnings.length ? 'warn' : 'ok');
  return (
    <div className={`compliance compliance--${tone}`} role="status">
      <span className="compliance__title">
        {blocked.length ? '⛔' : (warnings.length ? '⚠️' : '✅')} {label}: {blocked.length ? 'blocked' : (warnings.length ? 'check before sending' : 'partner safe')}
      </span>
      {blocked.length ? (
        <ul className="compliance__list">
          {blocked.map((hit, i) => (
            <li key={i}><strong>{hit.label}</strong>{hit.match ? <> - &ldquo;{hit.match}&rdquo;</> : null}</li>
          ))}
        </ul>
      ) : null}
      {warnings.length ? (
        <ul className="compliance__list">
          {warnings.map((hit, i) => (
            <li key={i}>{hit.label}{hit.match ? <> - &ldquo;{hit.match}&rdquo;</> : null}</li>
          ))}
        </ul>
      ) : null}
      {!blocked.length && !warnings.length ? (
        <span className="small">No figures, no lender, no client detail. Safe to send.</span>
      ) : null}
    </div>
  );
}

export function Modal({ title, onClose, children, footer, labelledBy = 'modal-title' }) {
  const ref = useRef(null);
  const previous = useRef(null);

  useEffect(() => {
    previous.current = document.activeElement;
    const node = ref.current;
    const focusables = () => Array.from(
      node?.querySelectorAll('a[href], button:not([disabled]), textarea, input, select, [tabindex]:not([tabindex="-1"])') || [],
    ).filter((el) => el.offsetParent !== null);
    const first = focusables()[0];
    (first || node)?.focus();

    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose?.();
        return;
      }
      if (event.key !== 'Tab') return;
      const list = focusables();
      if (!list.length) return;
      const firstEl = list[0];
      const lastEl = list[list.length - 1];
      if (event.shiftKey && document.activeElement === firstEl) {
        event.preventDefault();
        lastEl.focus();
      } else if (!event.shiftKey && document.activeElement === lastEl) {
        event.preventDefault();
        firstEl.focus();
      }
    };
    node?.addEventListener('keydown', onKeyDown);
    return () => {
      node?.removeEventListener('keydown', onKeyDown);
      if (previous.current instanceof HTMLElement) previous.current.focus();
    };
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby={labelledBy} ref={ref} tabIndex={-1}>
        <div className="card__head">
          <h2 id={labelledBy}>{title}</h2>
          <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">✕</Button>
        </div>
        {children}
        {footer ? <div className="row row--end">{footer}</div> : null}
      </div>
    </div>
  );
}

export function Sparkline({ points = [], width = 260, height = 46, labels = [] }) {
  const values = points.map((p) => Number(p) || 0);
  if (!values.length) return null;
  const max = Math.max(1, ...values);
  const stepX = values.length > 1 ? width / (values.length - 1) : width;
  const coords = values.map((v, i) => [i * stepX, height - 4 - (v / max) * (height - 10)]);
  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join(' ');
  const area = `${line} L${width} ${height} L0 ${height} Z`;
  const last = coords[coords.length - 1];
  return (
    <svg className="sparkline" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img"
      aria-label={`Twelve week trend: ${values.join(', ')}${labels.length ? ` for weeks starting ${labels.join(', ')}` : ''}`}>
      <path className="sparkline__area" d={area} />
      <path className="sparkline__line" d={line} />
      <circle className="sparkline__dot" cx={last[0]} cy={last[1]} r="3" />
    </svg>
  );
}

/** Copy helper that reports through a toast. */
export function CopyButton({ value, label = 'Copy', onCopied, size = 'sm' }) {
  const [done, setDone] = useState(false);
  const copy = useCallback(async () => {
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(String(value ?? ''));
      } else {
        const area = document.createElement('textarea');
        area.value = String(value ?? '');
        document.body.appendChild(area);
        area.select();
        document.execCommand('copy');
        area.remove();
      }
      setDone(true);
      onCopied?.();
      setTimeout(() => setDone(false), 1600);
    } catch {
      onCopied?.(new Error('Could not copy'));
    }
  }, [value, onCopied]);
  return <Button size={size} onClick={copy} aria-label={label}>{done ? 'Copied' : label}</Button>;
}

export function money(value, { dash = '-' } = {}) {
  if (value == null || Number.isNaN(Number(value))) return dash;
  const n = Number(value);
  const cents = Math.abs(n % 1) > 0.001;
  return `$${n.toLocaleString('en-AU', { minimumFractionDigits: cents ? 2 : 0, maximumFractionDigits: 2 })}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function shortDate(iso) {
  if (!iso || typeof iso !== 'string') return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '-';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]}`;
}

export function longDate(iso) {
  if (!iso || typeof iso !== 'string') return '-';
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return '-';
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function stampLabel(value) {
  if (!value) return '-';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value).slice(0, 16);
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

export function relativeDays(days) {
  if (days == null) return '';
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days === -1) return 'yesterday';
  return days > 0 ? `in ${days} days` : `${Math.abs(days)} days ago`;
}
