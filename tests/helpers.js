// Test harness: a real app on an ephemeral port, backed by a temp data dir.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../server/config.js';
import { createStore } from '../server/store.js';
import { createAi } from '../server/ai.js';
import { createDelivery } from '../server/delivery.js';
import { createApp } from '../server/app.js';
import { buildSeed } from '../server/seed.js';
import { todayISO } from '../shared/dates.js';

export const silentLogger = {
  info() {}, warn() {}, error() {}, debug() {}, log() {},
};

export function tempDir(prefix = 'pulse-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/**
 * Build an app with a seeded store. Pass env overrides to change config.
 * @returns {{app, store, config, ai, delivery, baseUrl, close}}
 */
export async function makeApp(options = {}) {
  const dir = options.dataDir || tempDir();
  const config = loadConfig({
    PULSE_DATA_DIR: dir,
    PULSE_SEED_DEMO: 'true',
    PULSE_TZ: 'Australia/Brisbane',
    ...(options.env || {}),
  });
  const store = createStore({ dataDir: dir, logger: silentLogger, firm: config.firm, tz: config.tz });
  store.load();
  const today = options.today || todayISO(config.tz);
  if (options.seed !== false) {
    await store.replace(buildSeed({ config, today }));
  }
  const ai = options.ai || createAi({ config, logger: silentLogger, clientFactory: options.clientFactory });
  const delivery = options.delivery || createDelivery({ config, logger: silentLogger, fetchImpl: options.fetchImpl });
  const app = createApp({ config, store, ai, delivery, logger: silentLogger, now: options.now });

  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  const cookies = new Map();
  async function request(pathname, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookies.size) {
      headers.Cookie = [...cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
    }
    const res = await fetch(`${baseUrl}${pathname}`, {
      method: opts.method || (opts.body !== undefined ? 'POST' : 'GET'),
      headers,
      body: opts.body === undefined ? undefined : (opts.raw ? opts.body : JSON.stringify(opts.body)),
      redirect: 'manual',
    });
    for (const value of res.headers.getSetCookie?.() || []) {
      const [pair] = value.split(';');
      const idx = pair.indexOf('=');
      const name = pair.slice(0, idx).trim();
      const val = pair.slice(idx + 1).trim();
      if (val) cookies.set(name, val); else cookies.delete(name);
    }
    const type = res.headers.get('content-type') || '';
    const payload = type.includes('application/json') ? await res.json() : await res.text();
    return { status: res.status, payload, headers: res.headers };
  }

  return {
    app,
    store,
    config,
    ai,
    delivery,
    baseUrl,
    request,
    dir,
    today,
    clearCookies: () => cookies.clear(),
    async close() {
      await store.idle();
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}

/** A fake Anthropic client for the AI adapter tests. */
export function fakeClient(handler) {
  const calls = [];
  const create = async (params) => {
    calls.push(params);
    const result = await handler(params, calls.length);
    if (result instanceof Error) throw result;
    return result;
  };
  return {
    calls,
    client: {
      beta: { messages: { create } },
      messages: { create },
    },
  };
}

export function jsonResponse(data, extra = {}) {
  return {
    id: 'msg_test',
    model: 'claude-opus-5',
    stop_reason: 'end_turn',
    content: [{ type: 'text', text: JSON.stringify(data) }],
    usage: { input_tokens: 1200, output_tokens: 300 },
    ...extra,
  };
}

export function httpError(status, message = 'boom', name = 'APIError') {
  const err = new Error(message);
  err.status = status;
  err.name = name;
  return err;
}
