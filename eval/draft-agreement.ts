/*
 * How far can the AI draft be trusted? It cannot be checked against a speaker, but where
 * the draft and the lesson book BOTH give Buxori for the same English, the two can be
 * compared. This prints, and writes to eval/draft-report.json, how often the draft's
 * answer is one of the book's, by worksheet part and by the draft's own confidence label.
 *
 * Caveat, stated in the report: on many "high" rows the draft was shown the book's form
 * and repeated it, so "high" agreement overstates the draft. The "medium" rows, written
 * without the book's answer in view, are the fair measure of what the draft layer adds.
 *
 *   node eval/draft-agreement.ts            write the report
 *   node eval/draft-agreement.ts --check    fail if the report on disk is out of date
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Engine } from '../src/engine/engine.ts';
import { canonicalKey } from '../src/lib/normalizer.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const index = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const engine = new Engine(index);      // the book alone
interface DraftRow { part: number; part_name: string; english?: string; buxori?: string; alternatives?: string[]; confidence?: string }
const rows = readFileSync(resolve(ROOT, 'translator/data/ai-draft/buxori_dataset.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l) as DraftRow);

const norm = (s: string) => canonicalKey(String(s).replace(/\([^)]*\)/g, ' ')).replace(/[^a-zü' -]+/g, ' ').replace(/\s+/g, ' ').trim();
/** What the book PRINTS for this English (not what the engine builds). */
const bookForms = (en: string): string[] | null => {
  const r = engine.translate(en.replace(/\s*\([^)]*\)/g, '').replace(/…/g, '').trim());
  if (r.status !== 'exact' || !r.text) return null;
  return [r.text, ...r.variants.map((v) => v.text), ...r.alternatives.map((a) => a.text)].filter(Boolean).map(norm);
};

const PARTS = [2, 3, 5, 6, 7, 8];      // parts that pair an English item with a Buxori answer
const byPart: Record<string, Record<string, { agree: number; compared: number }>> = {};
const total: Record<string, { agree: number; compared: number }> = {};
const disagreements: { part: string; confidence: string; english: string; draft: string; book: string[] }[] = [];
for (const r of rows) {
  if (!r.english || !r.buxori || !PARTS.includes(r.part)) continue;
  const book = bookForms(r.english);
  if (!book) continue;
  const cands = [r.buxori, ...(r.alternatives ?? [])].flatMap((x) => String(x).split(/\s*[;/]\s*/)).map(norm).filter(Boolean);
  const ok = cands.some((c) => book.includes(c));
  const conf = r.confidence ?? 'unrated';
  for (const cell of [((byPart[r.part_name] ??= {})[conf] ??= { agree: 0, compared: 0 }), (total[conf] ??= { agree: 0, compared: 0 })]) { cell.compared++; if (ok) cell.agree++; }
  if (!ok) disagreements.push({ part: r.part_name, confidence: conf, english: r.english, draft: r.buxori, book: book.slice(0, 3) });
}
const sortKeys = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const report = {
  what: 'AI draft (Tajik-derived, unverified) compared with the lesson book, on English items for which the book prints Buxori.',
  caveat: 'Agreement overstates the draft wherever it was shown the book: rows rated "high" often repeat a printed form, and "Everyday word choice" rows only pick among translations the book prints. The fair measure is "Grammar words" rated "medium", written without the book\'s answer in view. Rows rated "low" are not imported at all.',
  rowsInDraft: rows.length,
  agreementByConfidence: sortKeys(total),
  agreementByPart: sortKeys(Object.fromEntries(Object.entries(byPart).map(([k, v]) => [k, sortKeys(v)]))),
  disagreements,
};
const text = JSON.stringify(report, null, 2) + '\n';
const out = resolve(ROOT, 'eval/draft-report.json');
for (const [k, c] of Object.entries(report.agreementByConfidence)) console.log(`${k.padEnd(8)} ${c.agree}/${c.compared} (${Math.round((100 * c.agree) / c.compared)}%)`);
for (const [p, v] of Object.entries(report.agreementByPart)) console.log(`  ${p}: ${Object.entries(v).map(([k, c]) => `${k} ${c.agree}/${c.compared}`).join(', ')}`);
if (process.argv.includes('--check')) {
  if (readFileSync(out, 'utf8') !== text) { console.error('eval/draft-report.json is out of date: run `npm run eval:draft`.'); process.exit(1); }
  console.log('eval/draft-report.json is up to date.');
} else writeFileSync(out, text);
