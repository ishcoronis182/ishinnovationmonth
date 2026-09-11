import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createStore, emptyData, hydrate } from '../server/store.js';
import { tempDir, silentLogger } from './helpers.js';

const dirs = [];
function store(options = {}) {
  const dir = tempDir('pulse-store-');
  dirs.push(dir);
  return { dir, store: createStore({ dataDir: dir, logger: silentLogger, ...options }) };
}

afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop(), { recursive: true, force: true });
});

describe('the JSON store', () => {
  it('starts empty and writes through a temp file', async () => {
    const { store: s, dir } = store();
    expect(s.read().deals).toEqual([]);
    await s.update((data) => { data.deals.push({ id: 'd1' }); return data; });
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, 'pulse.json'), 'utf8'));
    expect(onDisk.deals).toHaveLength(1);
    // no temp files left behind
    expect(fs.readdirSync(dir).filter((f) => f.includes('tmp'))).toEqual([]);
  });

  it('serialises concurrent writes so none are lost', async () => {
    const { store: s } = store();
    await Promise.all(Array.from({ length: 25 }, (_, i) => s.update((data) => {
      data.deals.push({ id: `d${i}` });
      return data;
    })));
    expect(s.read().deals).toHaveLength(25);
    expect(new Set(s.read().deals.map((d) => d.id)).size).toBe(25);
  });

  it('rolls back and keeps the last good state when a mutation throws', async () => {
    const { store: s } = store();
    await s.update((data) => { data.deals.push({ id: 'keep' }); return data; });
    await expect(s.update((data) => {
      data.deals.push({ id: 'discard' });
      throw new Error('mid-write failure');
    })).rejects.toThrow('mid-write failure');
    expect(s.read().deals).toEqual([{ id: 'keep' }]);
    // and the queue still works afterwards
    await s.update((data) => { data.deals.push({ id: 'after' }); return data; });
    expect(s.read().deals).toHaveLength(2);
  });

  it('survives a crash mid-write: the previous file is still readable', async () => {
    const { store: s, dir } = store();
    await s.update((data) => { data.deals.push({ id: 'first' }); return data; });
    // simulate a crash leaving a half-written temp file behind
    fs.writeFileSync(path.join(dir, '.pulse.json.tmp-999-1'), '{"deals": [{"id": "half');
    const reopened = createStore({ dataDir: dir, logger: silentLogger });
    expect(reopened.read().deals).toEqual([{ id: 'first' }]);
  });

  it('preserves a corrupt file instead of overwriting it', async () => {
    const { dir } = store();
    fs.writeFileSync(path.join(dir, 'pulse.json'), '{ this is not json');
    const s = createStore({ dataDir: dir, logger: silentLogger });
    const data = s.load();
    expect(data.deals).toEqual([]);
    const preserved = fs.readdirSync(dir).filter((f) => f.includes('corrupt'));
    expect(preserved).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, preserved[0]), 'utf8')).toBe('{ this is not json');
    expect(s.events.some((e) => e.type === 'corrupt_preserved')).toBe(true);
  });

  it('preserves an empty file too', () => {
    const { dir } = store();
    fs.writeFileSync(path.join(dir, 'pulse.json'), '   ');
    const s = createStore({ dataDir: dir, logger: silentLogger });
    s.load();
    expect(fs.readdirSync(dir).filter((f) => f.includes('corrupt'))).toHaveLength(1);
  });

  it('fills in anything an older or hand-edited file is missing', () => {
    const filled = hydrate({ deals: [{ id: 'd1' }], firm: { name: 'Other Firm' } });
    expect(filled.partners).toEqual([]);
    expect(filled.statements).toEqual([]);
    expect(filled.settings.baselines.statementHours).toBeGreaterThan(0);
    expect(filled.firm.name).toBe('Other Firm');
    expect(filled.firm.broker).toBeTruthy();
    expect(hydrate(null).deals).toEqual([]);
    expect(hydrate('nonsense').deals).toEqual([]);
    expect(hydrate({ deals: 'not an array' }).deals).toEqual([]);
  });

  it('replaces everything on a demo reset', async () => {
    const { store: s } = store();
    await s.update((data) => { data.deals.push({ id: 'old' }); return data; });
    await s.replace({ ...emptyData(), deals: [{ id: 'new' }] });
    expect(s.read().deals).toEqual([{ id: 'new' }]);
  });

  it('counts its writes so the health endpoint can report them', async () => {
    const { store: s } = store();
    const before = s.writeCount;
    await s.update((data) => data);
    await s.update((data) => data);
    expect(s.writeCount).toBe(before + 2);
  });
});
