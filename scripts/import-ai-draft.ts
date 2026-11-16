/*
 * Convert the AI draft (translator/data/ai-draft/buxori_dataset.jsonl) into rows the
 * compiler can read: translator/data/ai-draft.tsv, in the same 11 columns as bukhori.tsv.
 *
 *   node scripts/import-ai-draft.ts
 *
 * The draft is NOT speaker data. By its own account it was reconstructed from Tajik and
 * Farsi. Every row it yields is marked as such (lesson column), is used only where the
 * lesson book has nothing, and is never shown as verified (see README, "AI draft layer").
 *
 * What is taken:   content words (parts 7, 8), phrases (part 6), sentences (part 3), each passed
 *                  through the Tajik → Buxori transducer (src/transducer/tajikToBuxori.ts)
 * What is skipped: grammar words (part 2 and any closed-class item: locked to the book);
 *                  rows the draft itself rates "low"; empty answers; answers that are
 *                  explanations and not a form ("az hama (+ adj)", "na ... na");
 *                  verb-form corrections, word-choice preferences, judgments and grammar
 *                  answers (parts 1, 4, 5, 9, 10, 11), which would change how the BOOK's
 *                  own words are used and so need a speaker.
 * The draft's notes are not copied: the compiler reads the notes column for stems and
 * base forms, and free text there would be misread.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COLUMNS } from './lib/tsv.ts';
import { canonicalKey } from '../src/lib/normalizer.ts';
import { adaptTajikSurfaceToBuxori, isClosedClass } from '../src/transducer/tajikToBuxori.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const SRC = resolve(ROOT, 'translator/data/ai-draft/buxori_dataset.jsonl');
const OUT = resolve(ROOT, 'translator/data/ai-draft.tsv');
export const DRAFT_LESSON = 'AI draft (Tajik-derived, unverified)';

interface Row { id: string; part: number; part_name: string; english?: string; buxori?: string; alternatives?: string[]; confidence: string; pos?: string }
const rows = readFileSync(SRC, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l) as Row);

// Bare words the object marker may be stripped from: the book's entries and the draft's own words.
const book = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const stems = new Set<string>(Object.keys(book.roots.byKey));
for (const r of rows) if ([7, 8].includes(r.part) && r.buxori && !/\s/.test(r.buxori.trim())) stems.add(canonicalKey(r.buxori));
const isStem = (w: string) => stems.has(canonicalKey(w));
const adapted: string[] = [];

/** A Buxori form and nothing else: letters of the book's spelling, spaces, hyphens, one final mark. */
const FORM = /^[A-Za-zÜüĆćáéíġî'’ -]+[!?.]?$/;
const forms = (s: string) => s.split(/\s+\/\s+|\s*;\s*/).map((x) => x.replace(/’/g, "'").trim()).filter(Boolean);
const skipped: Record<string, number> = {};
const skip = (why: string) => { skipped[why] = (skipped[why] ?? 0) + 1; };

const out: string[][] = [];
const seen = new Set<string>();
for (const r of rows) {
  if (![2, 3, 6, 7, 8].includes(r.part)) { skip(`part ${r.part} (${r.part_name}): needs a speaker`); continue; }
  // Closed-class lock: grammar words come from the book or not at all.
  if (r.part === 2 || (r.part !== 3 && r.part !== 6 && isClosedClass(r.english ?? '', r.pos))) { skip('closed-class (grammar word): locked to the book'); continue; }
  if (r.confidence === 'low') { skip('rated low by the draft itself'); continue; }
  const en = (r.english ?? '').replace(/…/g, '').replace(/\s+/g, ' ').trim();
  const raw = forms(r.buxori ?? '').map((f) => adaptTajikSurfaceToBuxori(f, isStem));
  if (raw.some((x) => x.rejected)) { skip('literary construction that cannot be adapted'); continue; }
  for (const x of raw) if (x.appliedRules.length) adapted.push(`${r.id}: ${x.buxoriForm} (${x.appliedRules.join('; ')})`);
  const all = raw.map((x) => x.buxoriForm);
  if (!en || !all.length) { skip('no answer'); continue; }
  if (!all.every((f) => FORM.test(f))) { skip('answer is an explanation, not a form'); continue; }
  const sentence = r.part === 3 || r.part === 6;
  const alts = sentence ? [] : [...all.slice(1), ...(r.alternatives ?? []).flatMap(forms)].filter((f) => FORM.test(f) && f !== all[0]);
  const key = `${en.toLowerCase()}\u0000${all[0]!.toLowerCase()}`;
  if (seen.has(key)) { skip('duplicate'); continue; }
  seen.add(key);
  // one row per variant of a sentence ("Nomat chi? / Nomaton chi?"); words keep variants as alt_forms
  for (const bux of sentence ? all : [all[0]!]) {
    out.push(['0', DRAFT_LESSON, sentence ? 'phrase' : 'vocab', r.part_name, en, bux, '', [...new Set(alts)].join('; '), '',
      `AI draft, not confirmed by a speaker; the draft rates this ${r.confidence}; id ${r.id}`, '']);
  }
}
writeFileSync(OUT, [COLUMNS.join('\t'), ...out.map((r) => r.map((c) => c.replace(/[\t\r\n]+/g, ' ')).join('\t'))].join('\n') + '\n');
console.log(`${out.length} rows → translator/data/ai-draft.tsv`);
console.log('skipped:', JSON.stringify(skipped, null, 1));
console.log(`adapted by the transducer: ${adapted.length}`);
for (const x of adapted) console.log('  ' + x);
