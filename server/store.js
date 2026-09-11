// JSON file store. Writes go to a temp file and are renamed into place, so a
// crash mid-write leaves the previous good file intact. A corrupt file is
// preserved rather than overwritten.

import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_BASELINES, VALUE_MODEL_DEFAULTS } from '../shared/metrics.js';

export const STORE_VERSION = 1;

export function emptyData({ firm = null, tz = null } = {}) {
  return {
    version: STORE_VERSION,
    firm: {
      name: firm?.name || 'Coronis Finance',
      broker: firm?.broker || 'Nathan',
      office: firm?.office || 'Coronis Lutwyche',
    },
    settings: {
      tz: tz || 'Australia/Brisbane',
      baselines: { ...DEFAULT_BASELINES },
      valueModel: { ...VALUE_MODEL_DEFAULTS },
    },
    counters: { deal: 1, statement: 1, message: 1, partner: 1 },
    deals: [],
    partners: [],
    messages: [],
    statements: [],
    rules: [],
    enquiries: [],
    surveys: [],
    referrals: [],
    aiLog: [],
    seededAt: null,
  };
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/** Fill in anything a hand-edited or older file is missing. */
export function hydrate(raw, opts = {}) {
  const base = emptyData(opts);
  if (!isPlainObject(raw)) return base;
  const out = { ...base, ...raw };
  out.version = STORE_VERSION;
  out.firm = { ...base.firm, ...(isPlainObject(raw.firm) ? raw.firm : {}) };
  out.settings = {
    ...base.settings,
    ...(isPlainObject(raw.settings) ? raw.settings : {}),
    baselines: { ...base.settings.baselines, ...(isPlainObject(raw.settings?.baselines) ? raw.settings.baselines : {}) },
    valueModel: { ...base.settings.valueModel, ...(isPlainObject(raw.settings?.valueModel) ? raw.settings.valueModel : {}) },
  };
  out.counters = { ...base.counters, ...(isPlainObject(raw.counters) ? raw.counters : {}) };
  for (const key of ['deals', 'partners', 'messages', 'statements', 'rules', 'enquiries', 'surveys', 'referrals', 'aiLog']) {
    out[key] = Array.isArray(raw[key]) ? raw[key] : [];
  }
  return out;
}

/**
 * @param {{dataDir: string, fileName?: string, logger?: object, firm?: object, tz?: string}} opts
 */
export function createStore(opts = {}) {
  const dataDir = opts.dataDir || path.join(process.cwd(), 'data');
  const fileName = opts.fileName || 'pulse.json';
  const filePath = path.join(dataDir, fileName);
  const logger = opts.logger || console;
  let data = null;
  let queue = Promise.resolve();
  let writes = 0;
  let tmpCounter = 0;
  const events = [];

  function ensureDir() {
    fs.mkdirSync(dataDir, { recursive: true });
  }

  function preserveCorrupt(reason) {
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const target = path.join(dataDir, `${fileName}.corrupt-${stamp}`);
    try {
      fs.renameSync(filePath, target);
      logger.error?.(`[store] ${filePath} could not be read (${reason}). Preserved as ${path.basename(target)} and starting a fresh file.`);
      events.push({ type: 'corrupt_preserved', at: new Date().toISOString(), target });
      return target;
    } catch (err) {
      logger.error?.(`[store] could not preserve the corrupt file: ${err.message}`);
      return null;
    }
  }

  function load() {
    ensureDir();
    if (!fs.existsSync(filePath)) {
      data = emptyData({ firm: opts.firm, tz: opts.tz });
      return data;
    }
    let text;
    try {
      text = fs.readFileSync(filePath, 'utf8');
    } catch (err) {
      preserveCorrupt(`read failed: ${err.message}`);
      data = emptyData({ firm: opts.firm, tz: opts.tz });
      return data;
    }
    if (!text.trim()) {
      preserveCorrupt('file was empty');
      data = emptyData({ firm: opts.firm, tz: opts.tz });
      return data;
    }
    try {
      data = hydrate(JSON.parse(text), { firm: opts.firm, tz: opts.tz });
    } catch (err) {
      preserveCorrupt(`invalid JSON: ${err.message}`);
      data = emptyData({ firm: opts.firm, tz: opts.tz });
    }
    return data;
  }

  async function writeNow(next) {
    ensureDir();
    tmpCounter += 1;
    const tmpPath = path.join(dataDir, `.${fileName}.tmp-${process.pid}-${tmpCounter}`);
    const body = JSON.stringify(next, null, 2);
    let handle;
    try {
      handle = await fsp.open(tmpPath, 'w');
      await handle.writeFile(body, 'utf8');
      await handle.sync();
    } finally {
      await handle?.close();
    }
    await fsp.rename(tmpPath, filePath);
    try {
      const dir = await fsp.open(dataDir, 'r');
      await dir.sync().catch(() => {});
      await dir.close();
    } catch {
      // directory fsync is best effort
    }
    writes += 1;
  }

  return {
    filePath,
    dataDir,
    events,
    get writeCount() { return writes; },

    load,

    /** Current in-memory snapshot. Loads on first use. */
    read() {
      if (!data) load();
      return data;
    },

    /**
     * Serialised read-modify-write. The mutator gets the live object; whatever
     * it returns is handed back to the caller after the write lands.
     */
    update(mutator) {
      const run = async () => {
        if (!data) load();
        const before = JSON.stringify(data);
        let result;
        try {
          result = await mutator(data);
        } catch (err) {
          data = JSON.parse(before); // roll back an aborted mutation
          throw err;
        }
        try {
          await writeNow(data);
        } catch (err) {
          data = JSON.parse(before);
          throw err;
        }
        return result;
      };
      const next = queue.then(run, run);
      queue = next.then(() => undefined, () => undefined);
      return next;
    },

    /** Replace everything (demo reset, seeding). */
    replace(nextData) {
      return this.update((current) => {
        const hydrated = hydrate(nextData, { firm: opts.firm, tz: opts.tz });
        for (const key of Object.keys(current)) delete current[key];
        Object.assign(current, hydrated);
        return current;
      });
    },

    /** Flush pending writes (tests). */
    async idle() {
      await queue;
    },
  };
}
