// Passcode session, login lockout, and the rate limits on the public form.
// Routing is case sensitive on purpose: "/API/deals" must not reach the API.

import { safeEqual, sessionToken } from './ids.js';

const COOKIE_SAFE = /^[A-Za-z0-9_-]+$/;

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx < 0) continue;
    const key = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

function clientIp(req) {
  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * @param {{config: object, logger?: object, now?: Function}} opts
 */
export function createAuth(opts = {}) {
  const config = opts.config;
  const logger = opts.logger || console;
  const nowFn = opts.now || (() => Date.now());
  const sessions = new Map(); // token -> {expiresAt, ip}
  const attempts = new Map(); // ip -> {count, windowStart}
  const formHits = new Map(); // ip -> [timestamps]
  let formDay = { date: null, count: 0 };

  const sessionMs = Math.max(1, config.auth.sessionHours) * 3600 * 1000;
  const lockoutMs = Math.max(1, config.auth.lockoutMinutes) * 60 * 1000;

  function sweep(now) {
    for (const [token, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(token);
    }
    for (const [ip, entry] of attempts) {
      if (now - entry.windowStart > lockoutMs) attempts.delete(ip);
    }
    for (const [ip, hits] of formHits) {
      const kept = hits.filter((t) => now - t < config.publicForm.windowMinutes * 60 * 1000);
      if (kept.length) formHits.set(ip, kept); else formHits.delete(ip);
    }
  }

  function lockState(ip, now) {
    const entry = attempts.get(ip);
    if (!entry) return { locked: false, remainingMs: 0, count: 0 };
    if (now - entry.windowStart > lockoutMs) {
      attempts.delete(ip);
      return { locked: false, remainingMs: 0, count: 0 };
    }
    const locked = entry.count >= config.auth.maxAttempts;
    return { locked, remainingMs: locked ? lockoutMs - (now - entry.windowStart) : 0, count: entry.count };
  }

  function noteFailure(ip, now) {
    const entry = attempts.get(ip);
    if (!entry || now - entry.windowStart > lockoutMs) {
      attempts.set(ip, { count: 1, windowStart: now });
      return 1;
    }
    entry.count += 1;
    return entry.count;
  }

  function issueSession(res, ip, now) {
    const token = sessionToken();
    sessions.set(token, { expiresAt: now + sessionMs, ip });
    const parts = [
      `${config.auth.cookieName}=${token}`,
      'Path=/',
      'HttpOnly',
      'SameSite=Lax',
      `Max-Age=${Math.floor(sessionMs / 1000)}`,
    ];
    if (config.auth.secureCookie) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
    return token;
  }

  function clearSession(req, res) {
    const cookies = parseCookies(req.headers?.cookie);
    const token = cookies[config.auth.cookieName];
    if (token) sessions.delete(token);
    const parts = [`${config.auth.cookieName}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
    if (config.auth.secureCookie) parts.push('Secure');
    res.append('Set-Cookie', parts.join('; '));
  }

  return {
    sessionCount() { return sessions.size; },

    /**
     * Reject any path that looks like the API but is not spelled exactly
     * "/api/...". Runs before body parsing and before the auth check.
     */
    caseGuard() {
      return (req, res, next) => {
        const path = req.path || '';
        if (/^\/api(\/|$)/i.test(path) && !/^\/api(\/|$)/.test(path)) {
          res.status(404).json({ error: 'not_found', message: 'Unknown path.' });
          return;
        }
        next();
      };
    },

    /** Attaches req.session (or null). Never throws. */
    attach() {
      return (req, res, next) => {
        const now = nowFn();
        sweep(now);
        const cookies = parseCookies(req.headers?.cookie);
        const token = cookies[config.auth.cookieName];
        req.session = null;
        if (token && COOKIE_SAFE.test(token)) {
          const session = sessions.get(token);
          if (session && session.expiresAt > now) {
            req.session = { token, expiresAt: session.expiresAt };
          }
        }
        next();
      };
    },

    /** Guard for the broker API. Public routes are registered before this. */
    require() {
      return (req, res, next) => {
        if (!config.auth.enabled) { next(); return; }
        if (req.session) { next(); return; }
        res.status(401).json({ error: 'unauthorised', message: 'Sign in to use PARTNER PULSE.' });
      };
    },

    login(req, res) {
      const now = nowFn();
      const ip = clientIp(req);
      if (!config.auth.enabled) {
        res.json({ ok: true, authEnabled: false, message: 'No passcode is configured, so you are already in.' });
        return;
      }
      const state = lockState(ip, now);
      if (state.locked) {
        res.status(429).json({
          error: 'locked_out',
          message: `Too many attempts. Try again in ${Math.ceil(state.remainingMs / 60000)} minutes.`,
          retryAfterMs: state.remainingMs,
        });
        return;
      }
      const supplied = typeof req.body?.passcode === 'string' ? req.body.passcode : '';
      if (!supplied || !safeEqual(supplied, config.auth.passcode)) {
        const count = noteFailure(ip, now);
        const remaining = Math.max(0, config.auth.maxAttempts - count);
        logger.warn?.(`[auth] failed sign-in from ${ip} (${count}/${config.auth.maxAttempts})`);
        res.status(401).json({
          error: 'bad_passcode',
          message: remaining > 0
            ? `That passcode is not right. ${remaining} ${remaining === 1 ? 'try' : 'tries'} left.`
            : 'That passcode is not right. This address is now locked for 15 minutes.',
          attemptsRemaining: remaining,
        });
        return;
      }
      attempts.delete(ip);
      issueSession(res, ip, now);
      res.json({ ok: true, authEnabled: true });
    },

    logout(req, res) {
      clearSession(req, res);
      res.json({ ok: true });
    },

    session(req, res) {
      res.json({
        authEnabled: config.auth.enabled,
        signedIn: Boolean(req.session) || !config.auth.enabled,
      });
    },

    /** Per-IP window plus a whole-of-day cap on the public referral form. */
    formLimiter() {
      return (req, res, next) => {
        const now = nowFn();
        sweep(now);
        const ip = clientIp(req);
        const today = new Date(now).toISOString().slice(0, 10);
        if (formDay.date !== today) formDay = { date: today, count: 0 };
        if (formDay.count >= config.publicForm.maxPerDay) {
          res.status(429).json({
            error: 'daily_cap',
            message: 'The referral form has reached its limit for today. Call us instead and we will take the details.',
          });
          return;
        }
        const hits = formHits.get(ip) || [];
        const windowMs = config.publicForm.windowMinutes * 60 * 1000;
        const recent = hits.filter((t) => now - t < windowMs);
        if (recent.length >= config.publicForm.maxPerWindow) {
          res.status(429).json({
            error: 'rate_limited',
            message: `That is a lot of referrals at once. Try again in ${config.publicForm.windowMinutes} minutes.`,
          });
          return;
        }
        recent.push(now);
        formHits.set(ip, recent);
        formDay.count += 1;
        next();
      };
    },

    /** Test hook. */
    reset() {
      sessions.clear();
      attempts.clear();
      formHits.clear();
      formDay = { date: null, count: 0 };
    },
  };
}
