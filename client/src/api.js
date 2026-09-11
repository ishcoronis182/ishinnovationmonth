// Thin fetch wrapper. Every failure becomes an ApiError with a readable message.

export class ApiError extends Error {
  constructor(message, { status, code, payload } = {}) {
    super(message || 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status ?? 0;
    this.code = code || 'unknown';
    this.payload = payload || null;
  }
}

async function request(path, { method = 'GET', body, signal } = {}) {
  let res;
  try {
    res = await fetch(path, {
      method,
      headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'same-origin',
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check it is still running.', { code: 'network' });
  }
  const type = res.headers.get('content-type') || '';
  const payload = type.includes('application/json') ? await res.json().catch(() => null) : await res.text();
  if (!res.ok) {
    const message = (payload && typeof payload === 'object' && payload.message)
      || (typeof payload === 'string' && payload.slice(0, 200))
      || `Request failed (${res.status}).`;
    throw new ApiError(message, {
      status: res.status,
      code: (payload && typeof payload === 'object' && payload.error) || 'http_error',
      payload,
    });
  }
  return payload;
}

export const api = {
  get: (path, opts) => request(path, opts),
  post: (path, body, opts) => request(path, { ...opts, method: 'POST', body: body ?? {} }),
  patch: (path, body, opts) => request(path, { ...opts, method: 'PATCH', body: body ?? {} }),
  put: (path, body, opts) => request(path, { ...opts, method: 'PUT', body: body ?? {} }),

  bootstrap: () => request('/api/bootstrap'),
  session: () => request('/api/session'),
  login: (passcode) => request('/api/login', { method: 'POST', body: { passcode } }),
  logout: () => request('/api/logout', { method: 'POST' }),
  health: () => request('/api/health'),

  deals: (query = '') => request(`/api/deals${query}`),
  deal: (id) => request(`/api/deals/${encodeURIComponent(id)}`),
  patchDeal: (id, body) => request(`/api/deals/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  moveStage: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/stage`, { method: 'POST', body }),
  reopen: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/reopen`, { method: 'POST', body }),
  setConsent: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/consent`, { method: 'POST', body }),
  addNote: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/notes`, { method: 'POST', body }),
  logEnquiry: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/enquiry`, { method: 'POST', body }),
  recomputeComms: (id) => request(`/api/deals/${encodeURIComponent(id)}/recompute-comms`, { method: 'POST', body: {} }),
  draftUpdate: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/draft-update`, { method: 'POST', body }),
  checkDraft: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/check-draft`, { method: 'POST', body }),
  sendUpdate: (id, body) => request(`/api/deals/${encodeURIComponent(id)}/send-update`, { method: 'POST', body }),

  samples: () => request('/api/samples'),
  extract: (body) => request('/api/handover/extract', { method: 'POST', body }),
  commit: (body) => request('/api/handover/commit', { method: 'POST', body }),
  parseMilestone: (body) => request('/api/milestone/parse', { method: 'POST', body }),
  applyMilestone: (body) => request('/api/milestone/apply', { method: 'POST', body }),

  partners: () => request('/api/partners'),
  partner: (id) => request(`/api/partners/${encodeURIComponent(id)}`),
  patchPartner: (id, body) => request(`/api/partners/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  createPartner: (body) => request('/api/partners', { method: 'POST', body }),
  rotateToken: (id) => request(`/api/partners/${encodeURIComponent(id)}/rotate-token`, { method: 'POST', body: {} }),
  setOpenHomes: (id, body) => request(`/api/partners/${encodeURIComponent(id)}/open-homes`, { method: 'PUT', body }),
  referrals: () => request('/api/referrals'),

  friday: () => request('/api/friday'),
  draftNudge: (partnerId, body) => request(`/api/friday/${encodeURIComponent(partnerId)}/draft`, { method: 'POST', body }),
  sendNudge: (partnerId, body) => request(`/api/friday/${encodeURIComponent(partnerId)}/send`, { method: 'POST', body }),

  statements: () => request('/api/statements'),
  statement: (id) => request(`/api/statements/${encodeURIComponent(id)}`),
  generateStatements: (body) => request('/api/statements/generate', { method: 'POST', body }),
  patchStatement: (id, body) => request(`/api/statements/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  statementNote: (id, body) => request(`/api/statements/${encodeURIComponent(id)}/note`, { method: 'POST', body }),
  issueStatement: (id) => request(`/api/statements/${encodeURIComponent(id)}/issue`, { method: 'POST', body: {} }),
  payStatement: (id) => request(`/api/statements/${encodeURIComponent(id)}/paid`, { method: 'POST', body: {} }),
  voidStatement: (id, body) => request(`/api/statements/${encodeURIComponent(id)}/void`, { method: 'POST', body }),
  sendStatement: (id, body) => request(`/api/statements/${encodeURIComponent(id)}/send`, { method: 'POST', body }),

  metrics: () => request('/api/metrics'),
  aiLog: () => request('/api/ai/log'),
  rules: () => request('/api/rules'),
  saveRules: (rules) => request('/api/rules', { method: 'PUT', body: { rules } }),
  saveSettings: (body) => request('/api/settings', { method: 'PUT', body }),
  resetDemo: () => request('/api/demo/reset', { method: 'POST', body: {} }),

  portal: (token) => request(`/api/portal/${encodeURIComponent(token)}`),
  portalSurvey: (token, body) => request(`/api/portal/${encodeURIComponent(token)}/survey`, { method: 'POST', body }),
  portalRefer: (token, body) => request(`/api/portal/${encodeURIComponent(token)}/refer`, { method: 'POST', body }),
  scan: (token) => request(`/api/scan/${encodeURIComponent(token)}`),
  scanRefer: (token, body) => request(`/api/scan/${encodeURIComponent(token)}/refer`, { method: 'POST', body }),
};
