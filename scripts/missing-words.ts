/*
 * List the most common everyday English words the lexicon has nothing for, as a TSV in
 * the same 11 columns as bukhori.tsv with the bukhori cell empty, for the owner to fill in.
 *
 *   node scripts/missing-words.ts --freq <words.txt> [--wordnet <dict dir>] [--top 1000]
 *
 *   words.txt   English words, most frequent first, one per line. The committed list was
 *               made from the `wordfreq` Python package: top_n_list('en', 6000).
 *   dict dir    WordNet's dict/ folder (npm: wordnet-db). Used only to drop non-words and
 *               names and to tell verbs from nouns; without it every word is kept as typed.
 *
 * A word counts as missing when the engine cannot translate it and it is not an inflected
 * form of a word the source has ("went", "dogs"). Output: translator/data/missing-words.tsv.
 * Rows you fill in there are read by scripts/compile-tsv.ts on the next `npm run compile`.
 * Re-running this script keeps every Buxori cell already filled in.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine } from '../src/engine/engine.ts';
import { nounCandidates, verbCandidates } from '../src/engine/english.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';
import { COLUMNS } from './lib/tsv.ts';

const ROOT = resolve(import.meta.dirname, '..');
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const freqPath = arg('--freq');
if (!freqPath) throw new Error('usage: node scripts/missing-words.ts --freq <words.txt> [--wordnet <dict dir>] [--top 1000]');
const TOP = Number(arg('--top') ?? 1000);
const OUT = resolve(ROOT, 'translator/data/missing-words.tsv');

const words = readFileSync(freqPath, 'utf8').split(/\r?\n/).map((w) => w.trim().toLowerCase()).filter((w) => /^[a-z]{3,}$/.test(w));
const rank = new Map(words.map((w, i) => [w, i + 1]));
const engine = new Engine(JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex);

// WordNet: which words are real lemmas, and their most used part of speech.
const wn = arg('--wordnet');
const pos = new Map<string, string>();
if (wn) {
  const use = new Map<string, Record<string, number>>();
  for (const line of readFileSync(resolve(wn, 'index.sense'), 'utf8').split('\n')) {
    const m = /^([a-z]+)%(\d):\S+ \d+ \d+ (\d+)$/.exec(line);
    if (!m) continue;
    const p = ['', 'noun', 'verb', 'adjective', 'adverb', 'adjective'][Number(m[2])]!;
    const u = use.get(m[1]!) ?? use.set(m[1]!, {}).get(m[1]!)!;
    u[p] = (u[p] ?? 0) + Number(m[3]) + 0.01;
  }
  for (const [w, u] of use) pos.set(w, Object.entries(u).sort((a, b) => b[1] - a[1])[0]![0]);
}
/** Not everyday vocabulary: web/chat words and names that a frequency list is full of. */
const SKIP = new Set(('www com http https org net html lol yeah okay hey wow gonna gotta wanna etc via per amp nbsp jpg png pdf inc ltd est '
  + 'john james david michael paul mark george robert william thomas peter mary smith jones brown miller jack joe tom mike '
  + 'america american british english french german chinese japanese european african indian russian spanish italian greek '
  + 'london york california texas washington europe asia africa china japan india france germany canada australia').split(' '));

const kept: { en: string; word: string; rank: number; pos: string }[] = [];
const seen = new Set<string>();
for (const w of words) {
  if (kept.length >= TOP) break;
  if (SKIP.has(w) || !engine.unknownWords(w).includes(w)) continue;
  // "islands" → "island", "marked" → "mark": list the dictionary form once
  const bases = [...nounCandidates(w), ...verbCandidates(w)].map((c) => c.lemma).filter((l) => l !== w && rank.has(l) && (!wn || pos.has(l)));
  const lemma = bases.sort((a, b) => rank.get(a)! - rank.get(b)!)[0] ?? w;
  if (seen.has(lemma) || SKIP.has(lemma)) continue;
  if (lemma !== w && !engine.unknownWords(lemma).includes(lemma)) continue;      // its base is in the source after all
  if (wn && !pos.has(lemma)) continue;
  seen.add(lemma);
  const p = pos.get(lemma) ?? '';
  kept.push({ en: p === 'verb' ? `to ${lemma}` : lemma, word: lemma, rank: rank.get(w)!, pos: p });
}

// Keep what the owner has already filled in.
const filled = new Map<string, string[]>();
if (existsSync(OUT)) {
  for (const line of readFileSync(OUT, 'utf8').split(/\r?\n/).slice(1)) {
    const c = line.split('\t');
    if (c[COLUMNS.indexOf('bukhori')]?.trim()) filled.set(c[COLUMNS.indexOf('english')]!.trim().toLowerCase(), c);
  }
}
const rows = kept.map((k) => filled.get(k.en) ?? [
  '0', 'Additions (not from the lesson book)', 'vocab', 'everyday words missing from the book', k.en, '', '', '', '',
  `English frequency rank ${k.rank}${k.pos ? `; ${k.pos}` : ''}`, '',
]);
for (const [en, c] of filled) if (!kept.some((k) => k.en === en)) rows.push(c);     // filled rows are never dropped
writeFileSync(OUT, [COLUMNS.join('\t'), ...rows.map((r) => r.join('\t'))].join('\n') + '\n');
console.log(`${rows.length} rows → ${OUT} (${filled.size} already filled in)`);
console.log('first 40:', kept.slice(0, 40).map((k) => k.en).join(', '));
