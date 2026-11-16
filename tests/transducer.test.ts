/*
 * The Tajik → Buxori transducer (src/transducer/tajikToBuxori.ts). Each rule it applies
 * must be one the lesson book states or prints, so the evidence is re-checked here
 * against the compiled index. Proposed rules the book does not support must NOT fire.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Engine } from '../src/engine/engine.ts';
import { ReverseEngine } from '../src/engine/reverse.ts';
import { withDraft } from '../src/lib/draft.ts';
import { createLookup } from '../src/lib/lookup.ts';
import type { BuxoriIndex, DraftOverlay } from '../src/lib/types.ts';
import { CLOSED_CLASS_POS, REJECTED_RULES, adaptTajikSurfaceToBuxori, isClosedClass } from '../src/transducer/tajikToBuxori.ts';

const book = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
const overlay = JSON.parse(readFileSync(new URL('../src/data/buxori-draft.json', import.meta.url), 'utf8')) as DraftOverlay;
const sentences = Object.values(book.examples).filter((e) => e.language === 'buxori').map((e) => ` ${e.bux.toLowerCase()} `);
const count = (re: RegExp) => sentences.filter((s) => re.test(s)).length;
const isStem = (w: string) => w.toLowerCase() in book.roots.byKey;
const A = (s: string) => adaptTajikSurfaceToBuxori(s, isStem);

describe('rules applied, each with its evidence in the book', () => {
  test('object marker -ro → -a after a consonant, -ya after a vowel', () => {
    const obj = book.affixes.entries['obj' as never] as { allomorphs: { form: string; register?: string }[] };
    expect(obj.allomorphs.filter((a) => a.register === 'regular').map((a) => a.form).sort()).toEqual(['-a', '-ya']);
    expect(obj.allomorphs.find((a) => a.form === '-ro')?.register).toBe('literal');
    expect(A('Man kitovro mexonam.').buxoriForm).toBe('Man kitova mexonam.');
    expect(A('Ü xonaro did').buxoriForm).toBe('Ü xonaya did');
    expect(A('Man kitovro mexonam.').appliedRules.join()).toMatch(/object marker/);
  });
  test('…but only from a known noun: words that merely end in -ro are left alone', () => {
    for (const w of ['shahri Buxoro', 'sahro', 'shüro', 'Buxoro shahri kalon']) expect(A(w), w).toEqual({ buxoriForm: w, appliedRules: [] });
    expect(A('kitovro').buxoriForm).toBe('kitovro');                                       // a word on its own is a headword, not an object
    expect(adaptTajikSurfaceToBuxori('Man kitovro mexonam.').buxoriForm).toBe('Man kitovro mexonam.');      // no stem check supplied: nothing is stripped
  });
  test('“they” is the book’s inho, not onho / eshon', () => {
    expect((book.roots.byGloss['they' as never] as string[]).map((id) => book.roots.entries[id as never]!.lemma.key)).toContain('inho');
    expect(count(/ inho /)).toBeGreaterThan(20);
    expect(count(/ onho | eshon /)).toBe(0);
    expect(A('Onho omadand.').buxoriForm).toBe('Inho omadand.');
  });
  test('spelling: ū → ü, ī → i', () => {
    expect(A('dūst').buxoriForm).toBe('düst');
    expect(JSON.stringify(Object.keys(book.roots.byKey))).not.toMatch(/[ūī]/);
  });
  test('the literary progressive is refused, not converted; “istodam” (I stayed) is not a progressive', () => {
    expect(count(/sod/)).toBeGreaterThan(count(/istoda/));
    expect(A('Ü rafta istodaast.').rejected).toMatch(/progressive/);
    expect(A('Man xona istodam.').rejected).toBeUndefined();
  });
});

describe('proposed rules the book does not support are not applied', () => {
  test('the evidence: the book prints -and, düst, rost, baland, and no -ay / -as copula', () => {
    expect(count(/and[ .,!?]/)).toBeGreaterThan(50);
    expect(count(/düst/)).toBeGreaterThan(0);
    expect(count(/ düs[ .,!?]| ros[ .,!?]| balan[ .,!?]/)).toBe(0);
    expect(count(/ ast[ .,!?]/)).toBe(0);
    expect(REJECTED_RULES.length).toBe(4);
  });
  test('so these forms pass through unchanged', () => {
    for (const s of ['Inho kor mekunand.', 'düst', 'rost', 'baland', 'In xona kalon ast.']) expect(A(s).buxoriForm, s).toBe(s);
  });
});

describe('closed-class lock', () => {
  test('grammar words are recognised by part of speech or by their English', () => {
    for (const e of ['they', 'to me', 'with you', 'and', 'three', 'nobody', 'you (polite)', 'in (in two days)']) expect(isClosedClass(e), e).toBe(true);
    for (const e of ['computer', 'to purchase', 'happy', 'the city of Bukhara', 'Nobody came.']) expect(isClosedClass(e), e).toBe(false);
    expect(isClosedClass('however', 'conjunction')).toBe(true);
  });
  test('the fallback layer holds no closed-class entry at all', () => {
    const bad = Object.values(overlay.entries).filter((e) => CLOSED_CLASS_POS.has(e.pos) || e.glosses.every((g) => isClosedClass(g.text)));
    expect(bad.map((e) => `${e.lemma.text} = ${e.glosses[0]?.text}`)).toEqual([]);
    expect(Object.values(overlay.entries).some((e) => e.sources.some((s) => s.section === 'Grammar words'))).toBe(false);
  });
});

describe('hybrid: fallback stem + the book’s affixes', () => {
  const merged = withDraft(book, overlay);
  const engine = new Engine(merged, book);
  const rev = new ReverseEngine(merged, createLookup(merged), engine.morph, { index: book, lookup: createLookup(book) });
  test('English → Buxori: a fallback verb is conjugated by the book’s rules and labelled “adapted”', () => {
    const r = engine.translate('we purchased it');
    expect(r).toMatchObject({ text: 'Mo xaridem', draft: true, tier: 'low', authority: 'tajik_adapted' });
    expect(engine.translate('computer').authority).toBe('tajik_adapted');
  });
  test('a whole fallback sentence is the unadapted tier', () => {
    expect(engine.translate('The woman gave the child an apple.')).toMatchObject({ draft: true, tier: 'low', authority: 'ai_draft_unverified' });
  });
  test('Buxori → English: the book’s suffixes (-a/-ya, -ba, -ho) are stripped from a fallback stem', () => {
    const car = Object.values(overlay.entries).find((e) => e.glosses.some((g) => g.key === 'car'))!.lemma.key;
    for (const [suffix, label] of [['a', /object/], ['ba', /to|in|at/], ['ho', /plural/]] as const) {
      const rd = rev.analyse(car + suffix).find((x) => x.draft);
      expect(rd, car + suffix).toBeDefined();
      expect(rd!.parts.map((p) => p.label).join(' '), car + suffix).toMatch(label);
    }
    expect(rev.translate(`Man ${car} doram`)).toMatchObject({ english: 'I have a car.', draft: true, tier: 'low', authority: 'tajik_adapted' });
  });
});
