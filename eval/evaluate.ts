/*
 * Reproducible accuracy evaluation on the frozen held-out set.
 *
 *   npm run eval            (writes eval/report.json, prints a comparison)
 *   npm run eval -- --check (exit 1 if accuracy or precision drops below eval/thresholds.json)
 *
 * The engine is run on an index compiled WITHOUT the test rows
 * (scripts/compile-tsv.ts --exclude-rows), so nothing it answers can be a lookup
 * of the test item itself. Correct = equals any attested form for that English.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine } from '../src/engine/engine.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';
import { evaluate, type Report, type TestSet } from './metrics.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'eval/.build/index-heldout.json');
mkdirSync(resolve(ROOT, 'eval/.build'), { recursive: true });
execFileSync(process.execPath, [resolve(ROOT, 'scripts/compile-tsv.ts'), '--exclude-rows', resolve(ROOT, 'eval/testset.json'), '--out', OUT], { stdio: 'ignore' });

const set = JSON.parse(readFileSync(resolve(ROOT, 'eval/testset.json'), 'utf8')) as TestSet;
const index = JSON.parse(readFileSync(OUT, 'utf8')) as BuxoriIndex;
const heldOut = new Set(set.items.flatMap((i) => i.rows));
const leaked = index.excluded.filter((x) => x.reason === 'held_out').length;
if (leaked !== heldOut.size) throw new Error(`held-out build excluded ${leaked} rows, expected ${heldOut.size}`);

const engine = new Engine(index);
const { report, rows } = evaluate('src/engine (held-out index)', set, (en) => {
  const r = engine.translate(en);
  // A "you" sentence has two answers; the item counts as correct if either register matches.
  const pick = r.variants.length ? r.variants : [];
  return { bux: r.text, status: r.status, ...(pick.length ? { alts: pick.map((v) => v.text) } : {}) };
});
// Credit the formal/informal variant when the primary missed.
let variantHits = 0;
for (const row of rows) {
  const alts = (row.pred as { alts?: string[] }).alts;
  if (!row.ok && alts) {
    const norm = (s: string) => s.normalize('NFD').replace(/[́̀̇]/g, '').normalize('NFC').toLowerCase().replace(/[.,!?;:"“”«»]/g, '').replace(/\s+/g, ' ').trim();
    if (alts.some((a) => row.refs.map(norm).includes(norm(a)))) { row.ok = true; variantHits++; }
  }
}
const correct = rows.filter((r) => r.ok).length;
const answered = rows.filter((r) => r.pred.bux).length;
const fixed: Report = { ...report, correct, accuracy: round(correct / rows.length), precision: round(answered ? correct / answered : 0) };
const byStatus: Report['byStatus'] = {};
for (const r of rows) { const s = (byStatus[r.pred.status] ??= { n: 0, correct: 0 }); s.n++; if (r.ok) s.correct++; }
fixed.byStatus = byStatus;

const legacy = (JSON.parse(readFileSync(resolve(ROOT, 'eval/baseline-legacy.json'), 'utf8')) as { report: Report }).report;
writeFileSync(resolve(ROOT, 'eval/report.json'), JSON.stringify({
  report: fixed, variantHits, legacy,
  predictions: rows.map((r) => ({ en: r.en, refs: r.refs, bux: r.pred.bux, status: r.pred.status, ok: r.ok, chrf: Math.round(r.chrf * 1000) / 1000 })),
}, null, 1) + '\n');

const line = (name: string, r: Report) => `${name.padEnd(10)} accuracy ${(100 * r.accuracy).toFixed(1).padStart(5)}%  precision ${(100 * r.precision).toFixed(1).padStart(5)}%  answered ${String(r.answered).padStart(3)}/${r.items}  chrF(answered) ${r.chrfAnswered.toFixed(3)}  chrF(all) ${r.chrfAll.toFixed(3)}`;
console.log(line('legacy', legacy));
console.log(line('new', fixed));
console.log('by status:', JSON.stringify(fixed.byStatus));

if (process.argv.includes('--check')) {
  const t = JSON.parse(readFileSync(resolve(ROOT, 'eval/thresholds.json'), 'utf8')) as { minAccuracy: number; minPrecision: number };
  const fails = [
    fixed.accuracy < t.minAccuracy && `accuracy ${fixed.accuracy} < ${t.minAccuracy}`,
    fixed.precision < t.minPrecision && `precision ${fixed.precision} < ${t.minPrecision}`,
  ].filter(Boolean);
  if (fails.length) { console.error('EVAL REGRESSION:', fails.join('; ')); process.exit(1); }
  console.log('thresholds ok');
}

function round(x: number) { return Math.round(x * 1000) / 1000; }
