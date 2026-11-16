/*
 * The AI draft layer (src/lib/draft.ts, src/data/buxori-draft.json). The draft was written
 * by an AI from Tajik and Farsi; it is not the lesson book and no speaker has confirmed it.
 * These tests hold the three rules: the book always wins, everything resting on the draft
 * is flagged and capped at the low tier, and draft sentences are never evidence.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Engine } from '../src/engine/engine.ts';
import { ReverseEngine } from '../src/engine/reverse.ts';
import { isDraftRoot, isDraftRow, withDraft } from '../src/lib/draft.ts';
import { createLookup } from '../src/lib/lookup.ts';
import { DRAFT_ROW_BASE, type BuxoriIndex, type DraftOverlay } from '../src/lib/types.ts';

const book = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
const overlay = JSON.parse(readFileSync(new URL('../src/data/buxori-draft.json', import.meta.url), 'utf8')) as DraftOverlay;
const merged = withDraft(book, overlay);
const bookEngine = new Engine(book);
const engine = new Engine(merged, book);
const rev = new ReverseEngine(merged, createLookup(merged), engine.morph, { index: book, lookup: createLookup(book) });
const T = (s: string) => engine.translate(s);

describe('the overlay file', () => {
  test('holds only draft entries, numbered above every book row', () => {
    const entries = Object.values(overlay.entries);
    expect(entries.length).toBe(overlay.meta.roots);
    expect(entries.length).toBeGreaterThan(500);
    for (const e of entries) {
      expect(isDraftRoot(e), e.lemma.text).toBe(true);
      expect(e.sources.every((s) => s.row > DRAFT_ROW_BASE && s.lesson === 'AI draft (Tajik-derived, unverified)')).toBe(true);
    }
    for (const x of Object.values(overlay.examples)) expect(x.source.draft).toBe(true);
  });
  test('the book index contains no draft entry at all', () => {
    expect(JSON.stringify(book)).not.toMatch(/"draft":true/);
    expect(Object.keys(book.roots.entries).some((id) => id in overlay.entries)).toBe(false);
  });
  test('merging does not modify the book index and keeps the book’s entries first', () => {
    const before = JSON.stringify(book);
    withDraft(book, overlay);
    expect(JSON.stringify(book)).toBe(before);
    for (const [k, ids] of Object.entries(merged.roots.byGloss)) {
      const firstDraft = ids.findIndex((id) => isDraftRoot(merged.roots.entries[id]));
      if (firstDraft >= 0) expect(ids.slice(firstDraft).every((id) => isDraftRoot(merged.roots.entries[id])), k).toBe(true);
    }
    expect(withDraft(book, null)).toBe(book);
  });
  test('a draft verb that reuses one of the book’s verbs conjugates with the book’s stems', () => {
    const bookVerb = Object.values(book.roots.entries).find((e) => e.lemma.key === 'giriftan')!;
    const draftVerb = Object.values(overlay.entries).find((e) => e.lemma.key === 'giriftan');
    if (draftVerb) expect(draftVerb.verb?.presentStem?.text).toBe(bookVerb.verb?.presentStem?.text);
  });
});

describe('rule 1: the book always wins', () => {
  test('every answer the book alone gives is unchanged by the draft', () => {
    const inputs = ['water', 'Good morning', 'I go', 'you', 'these', 'my book', 'three books', 'We bought', 'Where are you from?', 'I have two brothers',
      'He is here', 'I know that he came', 'How old are you?', 'sister', 'with you', 'on Saturday', 'He never comes', 'What do you do?',
      ...Object.keys(book.roots.byGloss).filter((_, i) => i % 23 === 0)];
    for (const s of inputs) {
      const a = bookEngine.translate(s), b = T(s);
      if (!a.text) continue;
      expect({ text: b.text, status: b.status, tier: b.tier, draft: b.draft }, s).toEqual({ text: a.text, status: a.status, tier: a.tier, draft: undefined });
      expect(b.alternatives.some((x) => x.rows?.some(isDraftRow)), s).toBe(false);      // and its alternatives are the book's
    }
  });
  test('Buxori → English: a word the book has keeps the book’s meaning', () => {
    for (const w of ['xohar', 'kitov', 'xona', 'Man kitov doram', 'Safro tüvo!']) {
      const r = rev.translate(w);
      expect(r.draft, w).toBeUndefined();
    }
    expect(rev.translate('xohar').english).toBe('younger sister');      // the draft says "sister"; the book's gloss stands
  });
});

describe('rule 2: draft-based results are flagged, low tier, never “verified”', () => {
  test('a word only the draft has', () => {
    const r = T('computer');
    expect(bookEngine.translate('computer').status).toBe('none');
    expect(r).toMatchObject({ draft: true, tier: 'low' });
    expect(r.confidence).toBeLessThanOrEqual(0.5);
    expect(r.factors?.join(' ')).toMatch(/Tajik fallback/);
    expect(r.steps.map((s) => s.text).join(' ')).not.toMatch(/Printed in the source|Dictionary entry/);
    expect(r.steps[0]?.text).toMatch(/AI draft|Tajik fallback/);
  });
  test('a sentence built with a draft noun, and with a draft verb', () => {
    expect(T('I have two sisters')).toMatchObject({ draft: true, tier: 'low' });
    const v = T('we purchased it');                                   // "purchase" is only in the draft
    expect(v.text).toBe('Mo xaridem');
    expect(v).toMatchObject({ draft: true, tier: 'low' });
  });
  test('a draft sentence returned whole', () => {
    expect(bookEngine.translate('Nobody came.').text).toBeNull();
    expect(T('Nobody came.')).toMatchObject({ text: 'Hej kas naomad.', draft: true, tier: 'low' });
    // …but a sentence the book can build itself stays the book's, although the draft prints it too
    expect(T('The boy reads a book.').draft).toBeUndefined();
  });
  test('sweep: no draft word reaches an answer unflagged, in any sentence frame', () => {
    const glosses = [...new Set(Object.values(overlay.entries).flatMap((e) => e.glosses.map((g) => g.key)))].filter((_, i) => i % 3 === 0);
    const frames = [(g: string) => g, (g: string) => `the ${g}`, (g: string) => `I see the ${g}`, (g: string) => `He is ${g}`, (g: string) => `We ${g.replace(/^to /, '')}`, (g: string) => `I do not ${g.replace(/^to /, '')}`];
    let flagged = 0;
    for (const g of glosses) for (const f of frames) {
      const s = f(g);
      const r = T(s);
      if (!r.text) continue;
      const usesBookOnly = bookEngine.translate(s).text === r.text;
      if (!usesBookOnly) { expect(r.draft, s).toBe(true); expect(r.tier, s).toBe('low'); flagged++; }
    }
    expect(flagged).toBeGreaterThan(200);
  }, 120_000);
  test('Buxori → English: draft words and draft sentences are flagged', () => {
    const w = rev.translate('faqat');
    expect(w).toMatchObject({ draft: true, tier: 'low' });
    expect(w.tokens[0]!.readings[w.tokens[0]!.chosen]?.draft).toBe(true);
    const s = rev.translate('Man moshin doram');
    expect(s.english).toBe('I have a car.');
    expect(s).toMatchObject({ draft: true, tier: 'low' });
    expect(s.tokens.map((t) => !!t.readings[t.chosen]?.draft)).toEqual([false, true, false]);
  });
});

describe('rule 1, Buxori → English, over the whole book', () => {
  test('every printed sentence and every headword reads exactly as it does without the draft', () => {
    const bookRev = new ReverseEngine(book, createLookup(book), bookEngine.morph);
    const inputs = [...Object.values(book.examples).map((e) => e.bux), ...Object.values(book.roots.entries).map((e) => e.lemma.text)].filter((_, i) => i % 4 === 0);
    for (const s of inputs) {
      const a = bookRev.translate(s), b = rev.translate(s);
      if (!a.english || a.unknown.length) continue;                    // the book cannot read it in full: the draft may help
      expect({ english: b.english, tier: b.tier, draft: b.draft }, s).toEqual({ english: a.english, tier: a.tier, draft: undefined });
    }
  }, 120_000);
});

describe('rule 3: draft sentences are never evidence', () => {
  test('“similar sentences in the source” are the book’s', () => {
    for (const s of ['xyzzy the boy reads', 'I zorble a book']) for (const x of T(s).related) expect(isDraftRow(x.row), s).toBe(false);
  });
  test('“not in the source” still means not in the book', () => {
    expect(engine.unknownWords('we purchased it')).toEqual(['purchased']);      // so the book’s own nearest words are still offered
    expect(engine.unknownWords('Good morning')).toEqual([]);
  });
});
