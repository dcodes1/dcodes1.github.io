/*
 * Server half of the email lock. Uses a FAKE answer and address: the real ones
 * are Worker secrets and must never appear in this public repository.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import worker, { type Env, type RateLimiter } from '../contact/worker.ts';

const ORIGIN = 'https://davidmilov.com';
const FAKE = { ANSWER: '3,1,2', EMAIL: 'someone@example.com' };
const allow: RateLimiter = { limit: async () => ({ success: true }) };

function call(body: unknown, opts: { env?: Env; origin?: string | null; method?: string; path?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { 'content-type': 'application/json', 'CF-Connecting-IP': '203.0.113.7' };
  if (opts.origin !== null) headers['Origin'] = opts.origin ?? ORIGIN;
  const method = opts.method ?? 'POST';
  const init: RequestInit = { method, headers };
  if (method === 'POST') init.body = opts.raw ?? JSON.stringify(body);
  return worker.fetch(new Request(`https://davidmilov.com${opts.path ?? '/api/reveal'}`, init), opts.env ?? { ...FAKE, REVEAL_LIMITER: allow });
}

describe('POST /api/reveal', () => {
  test('correct cells (any order) return the email', async () => {
    const r = await call({ cells: [2, 3, 1] });
    expect(r.status).toBe(200);
    expect(await r.json()).toEqual({ ok: true, email: FAKE.EMAIL });
    expect(r.headers.get('cache-control')).toBe('no-store');
    expect(r.headers.get('access-control-allow-origin')).toBe(ORIGIN);
  });
  test('wrong cells: ok false, and the email is not in the response', async () => {
    for (const cells of [[1, 2], [1, 2, 3, 4], [], [0, 1, 2]]) {
      const r = await call({ cells });
      const text = await r.text();
      expect(JSON.parse(text)).toEqual({ ok: false });
      expect(text).not.toContain('@');
    }
  });
  test('malformed input is rejected', async () => {
    for (const body of [{ cells: [1, 1, 2, 3] }, { cells: [1, 2, 49] }, { cells: [-1] }, { cells: [1.5] }, { cells: 'x' }, {}]) {
      expect((await call(body)).status).toBe(400);
    }
    expect((await call(null, { raw: '{not json' })).status).toBe(400);
    expect((await call(null, { raw: JSON.stringify({ cells: [], pad: 'x'.repeat(600) }) })).status).toBe(413);
  });
  test('rate limit is checked before the answer, per IP', async () => {
    const seen: string[] = [];
    const deny: RateLimiter = { limit: async ({ key }) => { seen.push(key); return { success: false }; } };
    const r = await call({ cells: [1, 2, 3] }, { env: { ...FAKE, REVEAL_LIMITER: deny } });
    expect(r.status).toBe(429);
    expect(r.headers.get('retry-after')).toBe('60');
    expect(await r.text()).not.toContain('@');
    expect(seen).toEqual(['reveal:203.0.113.7']);
  });
  test('other origins, methods and paths are refused', async () => {
    expect((await call({ cells: [1, 2, 3] }, { origin: 'https://evil.example' })).status).toBe(403);
    expect((await call({ cells: [1, 2, 3] }, { origin: null })).status).toBe(403);
    expect((await call(null, { method: 'GET' })).status).toBe(405);
    expect((await call({ cells: [1, 2, 3] }, { path: '/api/other' })).status).toBe(404);
    expect((await call(null, { method: 'OPTIONS' })).status).toBe(204);
    expect((await call(null, { method: 'OPTIONS', origin: 'https://evil.example' })).status).toBe(403);
  });
  test('unconfigured worker reveals nothing', async () => {
    const r = await call({ cells: [1, 2, 3] }, { env: { REVEAL_LIMITER: allow } });
    expect(r.status).toBe(503);
  });
});

describe('the public site never contains the address or the solution', () => {
  const ROOT = resolve(import.meta.dirname, '..');
  const files: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (['node_modules', '.git', 'eval', 'data'].includes(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p); else if (/\.(html|js|mjs|css|json|md|ts|tsx|toml)$/.test(f)) files.push(p);
    }
  };
  walk(ROOT);
  test.each(files.map((f) => [f.slice(ROOT.length + 1), f]))('%s', (_n, f) => {
    const s = readFileSync(f, 'utf8');
    // Built from fragments so this file does not contain the strings it looks for.
    const needles = [['david', 'milov2'], ['__cf', '_email__'], ['data-cf', 'email']].map((x) => x.join(''));
    for (const n of needles) expect(s.toLowerCase().includes(n), n).toBe(false);
  });
});
