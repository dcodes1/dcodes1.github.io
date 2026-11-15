/*
 * The AI draft layer. src/data/buxori-draft.json holds entries written by an AI from
 * Tajik and Farsi: not in the lesson book, not confirmed by a speaker. They are merged
 * into the index at load time so the engines can use them, under three rules that the
 * engines enforce:
 *
 *   1. The book always wins. A draft entry is used only when the book has nothing for
 *      that English (or that Buxori spelling).
 *   2. Anything built with a draft entry is flagged `draft`, capped at the low tier, and
 *      shown as an AI draft, never as "verified" or "built from rules" alone.
 *   3. Draft sentences are never evidence: they do not count as source examples, do not
 *      feed sense choice or frequency, and are not offered as "similar sentences".
 *
 * Where the draft could be checked against the book (words both have), its "medium"
 * answers matched the book 31 times in 53 on grammar words. See eval/draft-report.json.
 */
import { DRAFT_ROW_BASE, type BuxoriIndex, type DraftOverlay, type RootEntry, type SourceRef } from './types.ts';

export const isDraftRow = (row: number) => row > DRAFT_ROW_BASE;
export const isDraftSource = (s: SourceRef | undefined) => !!s?.draft;
/** Every source of the entry is the draft (a book entry is never a draft, whatever was added to it). */
export const isDraftRoot = (e: RootEntry | undefined) => !!e && e.sources.length > 0 && e.sources.every((s) => s.draft);

const concat = <V>(a: Record<string, V[]>, b: Record<string, V[]>): Record<string, V[]> => {
  const out: Record<string, V[]> = { ...a };
  for (const [k, list] of Object.entries(b)) out[k] = [...(a[k] ?? []), ...list];      // book ids first
  return out;
};

/** The book index with the draft entries added after the book's own. The input is not modified. */
export function withDraft(index: BuxoriIndex, overlay: DraftOverlay | null | undefined): BuxoriIndex {
  if (!overlay || !Object.keys(overlay.entries).length && !Object.keys(overlay.examples).length) return index;
  return {
    ...index,
    roots: {
      ...index.roots,
      entries: { ...index.roots.entries, ...overlay.entries },
      byKey: concat(index.roots.byKey, overlay.byKey) as BuxoriIndex['roots']['byKey'],
      byGloss: concat(index.roots.byGloss, overlay.byGloss) as BuxoriIndex['roots']['byGloss'],
      byStem: concat(index.roots.byStem, overlay.byStem),
    },
    examples: { ...index.examples, ...overlay.examples },
  };
}
