// A very small hash router. No dependencies.

import { useEffect, useState, useCallback } from 'react';

export function currentHash() {
  const raw = window.location.hash.replace(/^#/, '');
  return raw || '/';
}

export function parseRoute(hash) {
  const path = (hash || '/').split('?')[0];
  const parts = path.split('/').filter(Boolean);
  const query = {};
  const qs = (hash || '').split('?')[1];
  if (qs) {
    for (const pair of qs.split('&')) {
      const [key, value] = pair.split('=');
      if (key) query[decodeURIComponent(key)] = decodeURIComponent(value || '');
    }
  }
  if (!parts.length) return { name: 'queue', params: {}, query, path };
  const [head, ...rest] = parts;
  const map = {
    queue: 'queue',
    handover: 'handover',
    deal: 'deal',
    partners: 'partners',
    partner: 'partner',
    friday: 'friday',
    statements: 'statements',
    statement: 'statement',
    metrics: 'metrics',
    settings: 'settings',
    portal: 'portal',
    refer: 'refer',
    login: 'login',
  };
  const name = map[head] || 'notfound';
  const params = {};
  if (name === 'deal' || name === 'partner' || name === 'statement') params.id = decodeURIComponent(rest[0] || '');
  if (name === 'portal' || name === 'refer') params.token = decodeURIComponent(rest[0] || '');
  return { name, params, query, path };
}

export function navigate(to, { replace = false } = {}) {
  const target = to.startsWith('#') ? to : `#${to}`;
  if (replace) {
    const url = `${window.location.pathname}${window.location.search}${target}`;
    window.history.replaceState(null, '', url);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    window.location.hash = target;
  }
}

export function useRoute() {
  const [hash, setHash] = useState(() => currentHash());
  useEffect(() => {
    const onChange = () => {
      setHash(currentHash());
      window.scrollTo({ top: 0 });
    };
    window.addEventListener('hashchange', onChange);
    return () => window.removeEventListener('hashchange', onChange);
  }, []);
  return parseRoute(hash);
}

export function useNavigate() {
  return useCallback((to, opts) => navigate(to, opts), []);
}

export function href(to) {
  return to.startsWith('#') ? to : `#${to}`;
}
