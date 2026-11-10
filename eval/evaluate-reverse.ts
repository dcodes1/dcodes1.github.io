/*
 * Buxori → English on the frozen held-out set (the same items as eval/evaluate.ts, read
 * the other way): the index is compiled WITHOUT the test rows, each item's Buxori is
 * translated, and the English is compared with the book's English.
 *
 *   node eval/evaluate-reverse.ts      → eval/reverse-report.json
 *
 * "Correct" is strict: the same words as the book after lower-casing and removing
 * punctuation, articles and "(…)" labels, with he/she/it treated alike. A different but
 * valid wording counts as wrong, so read precision here as a floor, and use chrF and the
 * listed outputs to judge readability.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine } from '../src/engine/engine.ts';
import { ReverseEngine } from '../src/engine/reverse.ts';
import { createLookup } from '../src/lib/lookup.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';
import { chrF, type TestSet } from './metrics.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'eval/.build/index-heldout.json');
mkdirSync(resolve(ROOT, 'eval/.build'), { recursive: true });
execFileSync(process.execPath, [resolve(ROOT, 'scripts/compile-tsv.ts'), '--exclude-rows', resolve(ROOT, 'eval/testset.json'), '--out', OUT], { stdio: 'ignore' });
const index = JSON.parse(readFileSync(OUT, 'utf8')) as BuxoriIndex;
const set = JSON.parse(readFileSync(resolve(ROOT, 'eval/testset.json'), 'utf8')) as TestSet;
const rev = new ReverseEngine(index, createLookup(index), new Engine(index).morph);

const norm = (s: string) => s.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/’/g, "'")
  .replace(/\b(i'm)\b/g, 'i am').replace(/\b(\w+)n't\b/g, '$1 not').replace(/\b(he|she|it)'s\b/g, '$1 is').replace(/\b(\w+)'ll\b/g, '$1 will')
  .replace(/\bhe\/she\b|\bshe\b|\bit\b/g, 'he').replace(/\bhis\/her\b|\bher\b|\bits\b/g, 'his').replace(/\bhim\/her\b/g, 'him')
  .replace(/[^a-z0-9' ]+/g, ' ').replace(/\b(a|an|the|to)\b/g, ' ').replace(/\s+/g, ' ').trim();
const senses = (en: string) => en.split(/\s*[;]\s*/).flatMap((p) => [p, ...p.split(/\s*,\s*/)]).map(norm).filter(Boolean);

type Row = { bux: string; en: string; type: string; out: string | null; status: string; tier: string; ok: boolean; chrf: number };
const rows: Row[] = [];
for (const it of set.items) {
  const bux = it.refs[0]!.split(';')[0]!.trim();
  const r = rev.translate(bux);
  const outs = r.english ? senses(r.english) : [];
  const want = senses(it.en);
  const ok = outs.some((o) => want.includes(o));
  rows.push({ bux, en: it.en, type: it.type, out: r.english, status: r.status, tier: r.tier, ok, chrf: r.english ? chrF(norm(it.en), norm(r.english)) : 0 });
}
const answered = rows.filter((r) => r.out);
const by = (key: (r: Row) => string) => Object.fromEntries([...new Set(answered.map(key))].sort().map((k) => {
  const g = answered.filter((r) => key(r) === k);
  return [k, { n: g.length, correct: g.filter((r) => r.ok).length, precision: Math.round(1000 * g.filter((r) => r.ok).length / g.length) / 1000 }];
}));
const report = {
  items: rows.length, answered: answered.length, correct: answered.filter((r) => r.ok).length,
  accuracy: Math.round(1000 * answered.filter((r) => r.ok).length / rows.length) / 1000,
  precision: Math.round(1000 * answered.filter((r) => r.ok).length / Math.max(1, answered.length)) / 1000,
  chrfAnswered: Math.round(1000 * answered.reduce((a, r) => a + r.chrf, 0) / Math.max(1, answered.length)) / 1000,
  byTier: by((r) => (r.status === 'exact' ? 'printed' : `built:${r.tier}`)),
  byType: by((r) => r.type),
};
writeFileSync(resolve(ROOT, 'eval/reverse-report.json'), JSON.stringify({ report, predictions: rows }, null, 1) + '\n');
console.log(`Buxori → English, held-out: answered ${report.answered}/${report.items}, strictly correct ${report.correct} (precision ${(100 * report.precision).toFixed(1)}%, accuracy ${(100 * report.accuracy).toFixed(1)}%), chrF(answered) ${report.chrfAnswered}`);
console.log('by tier:', JSON.stringify(report.byTier));
console.log('by type:', JSON.stringify(report.byType));
if (process.argv.includes('--check')) {
  // Tiers must mean something: rule-built high answers are mostly right even by the strict
  // measure, and nothing in the low tier may be relied on.
  const t = report.byTier as Record<string, { precision: number } | undefined>;
  const fails = [
    (t['built:high']?.precision ?? 0) < 0.7 && `built:high precision ${t['built:high']?.precision} < 0.7`,
    (t['built:low']?.precision ?? 0) > 0.2 && `built:low precision ${t['built:low']?.precision} > 0.2`,
  ].filter(Boolean);
  if (fails.length) { console.error('REVERSE EVAL REGRESSION:', fails.join('; ')); process.exit(1); }
  console.log('reverse thresholds ok');
}
if (process.argv.includes('--show')) for (const r of answered) console.log(`${r.ok ? 'OK ' : 'BAD'} ${r.status}/${r.tier} | ${r.bux.slice(0, 50)} → ${r.out} | book: ${r.en}`);
