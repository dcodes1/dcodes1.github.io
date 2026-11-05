/*
 * POST /api/reveal  { "cells": number[] }  →  { ok: true, email } | { ok: false }
 *
 * Server-side half of the email lock (assets/email-gate.js). The puzzle is
 * public; the SOLUTION and the EMAIL exist only here, as Worker secrets:
 *
 *   ANSWER  comma-separated, sorted cell indices of the solved path (row * 7 + col)
 *   EMAIL   the address returned on success
 *
 * Every request is rate-limited per IP before the answer is checked, so the
 * endpoint cannot be brute-forced or used as a cheap oracle. This is a
 * courtesy gate against scrapers, not access control: anyone who solves the
 * puzzle once can publish the address. See contact/README.md to deploy.
 */

export interface RateLimiter { limit(o: { key: string }): Promise<{ success: boolean }> }
export interface Env {
  EMAIL?: string;
  ANSWER?: string;
  /** Comma-separated origins allowed to call the endpoint. */
  ALLOWED_ORIGINS?: string;
  /** Workers Rate Limiting binding (see wrangler.toml). */
  REVEAL_LIMITER?: RateLimiter;
}

const CELLS = 49;
const DEFAULT_ORIGINS = 'https://davidmilov.com,https://www.davidmilov.com';

function json(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...headers },
  });
}

/** Compare two strings without an early exit on the first difference. */
function sameString(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

function canonical(cells: number[]): string {
  return [...cells].sort((x, y) => x - y).join(',');
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== '/api/reveal') return json({ error: 'not found' }, 404);

    const origin = req.headers.get('Origin') ?? '';
    const allowed = (env.ALLOWED_ORIGINS ?? DEFAULT_ORIGINS).split(',').map((s) => s.trim()).filter(Boolean);
    const okOrigin = allowed.includes(origin);
    const cors: Record<string, string> = okOrigin
      ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'Origin' }
      : {};

    if (req.method === 'OPTIONS') return new Response(null, { status: okOrigin ? 204 : 403, headers: cors });
    if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, { ...cors, allow: 'POST, OPTIONS' });
    if (!okOrigin) return json({ error: 'forbidden' }, 403);
    if (!env.EMAIL || !env.ANSWER) return json({ error: 'not configured' }, 503, cors);

    // Rate limit first, so wrong and malformed attempts count too.
    const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
    if (env.REVEAL_LIMITER) {
      const { success } = await env.REVEAL_LIMITER.limit({ key: `reveal:${ip}` });
      if (!success) return json({ error: 'too many attempts' }, 429, { ...cors, 'retry-after': '60' });
    }

    const text = await req.text();
    if (text.length > 512) return json({ error: 'payload too large' }, 413, cors);
    let cells: unknown;
    try { cells = (JSON.parse(text) as { cells?: unknown }).cells; } catch { return json({ error: 'bad request' }, 400, cors); }
    if (!Array.isArray(cells) || cells.length > CELLS
      || !cells.every((c) => Number.isInteger(c) && (c as number) >= 0 && (c as number) < CELLS)
      || new Set(cells).size !== cells.length) {
      return json({ error: 'bad request' }, 400, cors);
    }

    const expected = canonical(env.ANSWER.split(',').map((s) => Number(s.trim())));
    if (!sameString(canonical(cells as number[]), expected)) return json({ ok: false }, 200, cors);
    return json({ ok: true, email: env.EMAIL }, 200, cors);
  },
};
