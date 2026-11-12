/** Audit the supplied AI draft; never compile its answers into the dictionary.
 * Run: node scripts/audit-buxori-import.ts
 * Agreement is a review aid, NOT an accuracy evaluation or speaker verification.
 */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine } from '../src/engine/engine.ts';
import { canonicalKey, foldTsvStress } from '../src/lib/normalizer.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';

type Candidate = { id: string; task: string; source: string; confidence: string; english?: string; buxori?: string; question?: string; notes?: string; no_answer_reason?: string };
type Pair = { id: string; source: string; messages: { role: string; content: string }[] };
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'translator/data/imports');
function read<T>(name: string): T[] {
  return readFileSync(resolve(dir, name), 'utf8').trim().split(/\r?\n/).map((line, i) => {
    try { return JSON.parse(line) as T; } catch { throw new Error(`${name}:${i + 1}: invalid JSON`); }
  });
}
const candidates = read<Candidate>('buxori_dataset.jsonl');
const pairs = read<Pair>('buxori_train_pairs.jsonl');
const ids = new Set<string>();
for (const row of candidates) {
  if (!row.id || ids.has(row.id)) throw new Error(`Missing or duplicate dataset ID: ${row.id}`);
  if (row.source !== 'ai_draft_tajik_derived_unverified') throw new Error(`Unexpected provenance for ${row.id}`);
  ids.add(row.id);
}
const pairIds = new Set<string>();
for (const pair of pairs) {
  if (!ids.has(pair.id) || pairIds.has(pair.id)) throw new Error(`Unknown or duplicate training ID: ${pair.id}`);
  if (pair.source !== 'ai_draft_tajik_derived_unverified' || pair.messages.length !== 3
    || pair.messages.map((m) => m.role).join(',') !== 'system,user,assistant'
    || pair.messages.some((m) => typeof m.content !== 'string')) throw new Error(`Invalid training record: ${pair.id}`);
  pairIds.add(pair.id);
}
const index = JSON.parse(readFileSync(resolve(root, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const engine = new Engine(index);
const norm = (s: string) => canonicalKey(foldTsvStress(s)).replace(/[.!?,;:]/g, '').replace(/\s+/g, ' ').trim();
const counts: Record<string, number> = {};
const tasks: Record<string, number> = {};
const tsv: string[][] = [['id', 'task', 'english_or_question', 'draft_buxori', 'draft_confidence', 'source', 'current_output', 'current_tier', 'book_rows', 'review_status', 'notes']];
for (const c of candidates) {
  tasks[c.task] = (tasks[c.task] ?? 0) + 1;
  // Conjugation records name an infinitive in English; that is NOT a test of
  // the requested person/tense. Grammar prose and transcription guesses also
  // require manual review. Do not turn chat instructions into executable rules.
  const comparable = !!c.english && !!c.buxori && !['conjugate_verb', 'resolve_flagged_reading'].includes(c.task);
  const result = comparable ? engine.translate(c.english!) : null;
  const outputs = result ? [result.text, ...result.variants.map((v) => v.text)].filter((x): x is string => !!x) : [];
  const agrees = outputs.some((out) => norm(out) === norm(c.buxori!));
  const status = !comparable ? 'manual_review'
    : agrees && result?.status === 'exact' ? 'matches_book_entry'
    : agrees ? 'agrees_with_rules_unverified'
    : outputs.length ? 'differs_needs_review' : 'gap_needs_speaker';
  counts[status] = (counts[status] ?? 0) + 1;
  tsv.push([c.id, c.task, c.english ?? c.question ?? '', c.buxori ?? '', c.confidence, c.source,
    result?.text ?? '', result?.tier ?? '', result?.rows.join(',') ?? '', status, c.notes ?? c.no_answer_reason ?? '']);
}
const omitted = candidates.filter((c) => !pairIds.has(c.id)).map((c) => ({ id: c.id, reason: c.no_answer_reason ?? 'No training pair; review manually' }));
const files = ['buxori_dataset.jsonl', 'buxori_train_pairs.jsonl'].map((name) => ({ name, sha256: createHash('sha256').update(readFileSync(resolve(dir, name))).digest('hex') }));
writeFileSync(resolve(dir, 'audit.json'), JSON.stringify({ provenance: 'Unverified AI draft derived from Tajik; confidence labels are supplied, not calibrated.',
  warning: 'Agreement is not measured accuracy. The training pairs restate this dataset, not independent evidence. Nothing here is automatically imported.',
  files, datasetRecords: candidates.length, trainingRecords: pairs.length, tasks, counts, omittedTrainingRecords: omitted }, null, 2) + '\n');
const cell = (s: string) => s.replace(/[\t\r\n]/g, ' ');
writeFileSync(resolve(dir, 'review.tsv'), tsv.map((r) => r.map(cell).join('\t')).join('\n') + '\n');
console.log(JSON.stringify({ records: candidates.length, trainingRecords: pairs.length, counts, omitted }, null, 2));
