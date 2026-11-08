/*
 * Measures the in-browser "similar words" model (src/ai/similar.ts). Not part of CI:
 * it needs the model (npm i --no-save @huggingface/transformers@4.3.1; downloads ~23 MB).
 *
 *   node eval/suggestions.ts        → eval/suggestions-report.json
 *
 * 1. Held-out set, automatic use: for every test item the engine cannot translate,
 *    replace each unknown word by the model's nearest source gloss and translate.
 *    This is what "let the model figure out the word" would do.
 * 2. Upper bound: how many of those items have their correct answer anywhere else in
 *    the book (no method that only uses the book can do better).
 * 3. Suggestions: for 52 everyday words that are not in the book but have a synonym
 *    that is, is the synonym among the model's top 1 / 3 / 5 suggestions? (The pairs
 *    are English synonyms chosen by hand; no Buxori is involved.)
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORD_MODEL, decodeVectors, nearestGlosses, type VectorFile } from '../src/ai/similar.ts';
import { Engine } from '../src/engine/engine.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';
import { surface, type TestSet } from './metrics.ts';

const ROOT = resolve(import.meta.dirname, '..');
const spec = '@huggingface/transformers';
const tf = await import(spec) as { pipeline: (t: string, m: string, o: object) => Promise<(x: string[], o: object) => Promise<{ data: Float32Array; dims: number[] }>> };
const fe = await tf.pipeline('feature-extraction', WORD_MODEL.id, { dtype: WORD_MODEL.dtype, revision: WORD_MODEL.revision });
async function embed(texts: string[]): Promise<Float32Array[]> {
  const out: Float32Array[] = [];
  for (let i = 0; i < texts.length; i += 64) {
    const r = await fe(texts.slice(i, i + 64), { pooling: WORD_MODEL.pooling, normalize: true });
    const d = r.dims[1]!;
    for (let k = 0; k < r.dims[0]!; k++) out.push(r.data.slice(k * d, (k + 1) * d));
  }
  return out;
}
const quantised = (keys: string[], vecs: Float32Array[]): VectorFile => {
  const dim = vecs[0]!.length, v = new Int8Array(keys.length * dim), s = new Float32Array(keys.length);
  vecs.forEach((x, i) => { const m = Math.max(...x.map(Math.abs)) / 127 || 1; s[i] = m; x.forEach((y, j) => { v[i * dim + j] = Math.round(y / m); }); });
  return { ...WORD_MODEL, model: WORD_MODEL.id, dim, keys, scales: Buffer.from(s.buffer).toString('base64'), vectors: Buffer.from(v.buffer).toString('base64') };
};

// ── 1 + 2: held-out set ───────────────────────────────────────────────────
const HELD = resolve(ROOT, 'eval/.build/index-heldout.json');
execFileSync(process.execPath, [resolve(ROOT, 'scripts/compile-tsv.ts'), '--exclude-rows', resolve(ROOT, 'eval/testset.json'), '--out', HELD], { stdio: 'ignore' });
const held = JSON.parse(readFileSync(HELD, 'utf8')) as BuxoriIndex;
const set = JSON.parse(readFileSync(resolve(ROOT, 'eval/testset.json'), 'utf8')) as TestSet;
const engine = new Engine(held);
const heldKeys = Object.keys(held.roots.byGloss).sort();
const heldGv = decodeVectors(quantised(heldKeys, await embed(heldKeys)));

const bookSurfaces = new Set<string>();
for (const e of Object.values(held.roots.entries)) { bookSurfaces.add(surface(e.lemma.text)); for (const f of e.forms) bookSurfaces.add(surface(f.text)); }
for (const e of Object.values(held.examples)) if (e.en) bookSurfaces.add(surface(e.bux));

const auto: { en: string; replaced: string[]; output: string; ok: boolean }[] = [];
let unanswered = 0, reachable = 0;
for (const it of set.items) {
  if (engine.translate(it.en).status !== 'none') continue;
  unanswered++;
  if (it.refs.some((r) => bookSurfaces.has(surface(r)))) reachable++;
  const unknown = engine.unknownWords(it.en);
  if (!unknown.length) continue;
  const qs = await embed(unknown);
  let text = it.en;
  const replaced: string[] = [];
  unknown.forEach((w, i) => {
    const best = nearestGlosses(heldGv, qs[i]!, 1)[0]!;
    text = text.replace(new RegExp(`\\b${w}\\b`, 'i'), best.key.replace(/^to /, ''));
    replaced.push(`${w} → ${best.key} (${best.score.toFixed(2)})`);
  });
  const r = engine.translate(text);
  if (r.status === 'none' || !r.text) continue;
  const ok = [r.text, ...r.variants.map((v) => v.text)].some((p) => it.refs.map(surface).includes(surface(p)));
  auto.push({ en: it.en, replaced, output: r.text, ok });
}

// ── 3: suggestions for everyday synonyms ──────────────────────────────────
const full = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const fullGv = decodeVectors(JSON.parse(readFileSync(resolve(ROOT, 'src/data/gloss-vectors.json'), 'utf8')) as VectorFile);
const PAIRS = ('glad:happy purchase:buy quick:fast ill:sick store:shop little:small infant:baby grandpa:grandfather grandma:grandmother '
  + 'dwelling:house residence:house home:house cash:money wealthy:rich depart:leave inquire:ask query:question smart:clever '
  + 'intelligent:clever tiny:small huge:big enormous:big pal:friend buddy:friend chum:friend spouse:wife hubby:husband lad:boy '
  + 'dine:eat consume:eat nap:sleep rest:sleep shut:close finish:end hound:dog pup:dog puppy:dog kitty:cat feline:cat '
  + 'physician:doctor medic:doctor tutor:teacher instructor:teacher cheerful:happy delighted:happy elderly:old youthful:young '
  + 'tough:hard error:mistake job:work occupation:work labor:work').split(' ').map((p) => p.split(':') as [string, string]);
for (const [q, t] of PAIRS) if (full.roots.byGloss[q] || !full.roots.byGloss[t]) throw new Error(`pair ${q}:${t} no longer fits the book`);
const pq = await embed(PAIRS.map((p) => p[0]));
const rank = PAIRS.map(([, t], i) => nearestGlosses(fullGv, pq[i]!, 50).map((x) => x.key.replace(/^to /, '')).filter((k, j, a) => a.indexOf(k) === j).indexOf(t));
const at = (n: number) => rank.filter((r) => r >= 0 && r < n).length;

const report = {
  model: `${WORD_MODEL.id}@${WORD_MODEL.revision.slice(0, 7)} (${WORD_MODEL.dtype})`,
  heldOut: {
    unanswered, answerElsewhereInBook: reachable,
    automaticSubstitution: { answered: auto.length, correct: auto.filter((a) => a.ok).length },
    examples: auto.slice(0, 40),
  },
  suggestions: { pairs: PAIRS.length, top1: at(1), top3: at(3), top5: at(5) },
};
writeFileSync(resolve(ROOT, 'eval/suggestions-report.json'), JSON.stringify(report, null, 1) + '\n');
console.log(`held-out: ${unanswered} unanswered; correct answer exists elsewhere in the book for ${reachable}`);
console.log(`automatic substitution: ${report.heldOut.automaticSubstitution.correct} correct of ${auto.length} answered`);
console.log(`suggestions: synonym in top 1 ${at(1)}/${PAIRS.length}, top 3 ${at(3)}/${PAIRS.length}, top 5 ${at(5)}/${PAIRS.length}`);
