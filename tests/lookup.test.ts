/*
 * End-to-end: sample words and grammar rules from the TSV resolve through the
 * compiled index (src/data/buxori-index.json, built by `npm run compile`).
 * Expected values are the TSV's own cells (row numbers in comments).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { createLookup, type Tier } from '../src/lib/lookup.ts';
import type { BuxoriIndex, TemplatePart } from '../src/lib/types.ts';

const index = JSON.parse(readFileSync(resolve(import.meta.dirname, '../src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const L = createLookup(index);

/** First headword text for a query, plus the tier it resolved at. */
function resolveWord(q: string) {
  const r = L.byBuxori(q);
  const lemmas = r.matches.flatMap((m) => [...m.roots.map((e) => e.lemma.text), ...m.inflected.map((e) => e.text)]);
  const glosses = r.matches.flatMap((m) => [...m.roots, ...m.inflected].flatMap((e) => e.glosses.map((g) => g.text)));
  return { tier: r.tier, lemmas, glosses };
}

describe('sample words resolve from any script or spelling', () => {
  test.each<[query: string, tier: Tier, lemma: string, gloss: string]>([
    ['Ҳаво', 'exact', 'Havo', 'weather'],
    ['Худо', 'exact', 'Xudo', 'G-d'],
    ['Khudo', 'exact', 'Xudo', 'G-d'],
    ['Қати', 'exact', 'Qati', 'with'],
    ['Ҷумъа', 'exact', "Jum'a", 'Friday'],
    ['ǧum‘a', 'exact', "Jum'a", 'Friday'],
    ['ג׳ומעה', 'exact', "Jum'a", 'Friday'],
    ['čoy', 'exact', 'Choy', 'tea'],
    ['šir', 'exact', 'Shir', 'milk'],
    ['Нағз', 'exact', 'Naghz', 'good'],
    ['Бародар', 'exact', 'Barodar', 'brother'],
    ['Maím', 'exact', 'Maim', 'water'],
    ['Писҳо', 'exact', 'Pisho', 'Passover'],
    ['онаям', 'exact', 'Onayam', 'my mom'],
    ['ruz', 'fuzzy', 'Rüz', 'day'],
    ['xudoo', 'loose', 'Xudo', 'G-d'],
    ['Kitob', 'skeleton', 'Kitov', 'book'],
    ['שלום', 'skeleton', 'Sholümi', 'peace'],
  ])('%s → %s match %s (%s)', (q, tier, lemma, gloss) => {
    const r = resolveWord(q);
    expect(r.tier).toBe(tier);
    expect(r.lemmas).toContain(lemma);
    expect(r.glosses).toContain(gloss);
  });

  test('unknown words return no match rather than a guess', () => {
    expect(L.byBuxori('qwzzv').tier).toBeNull();
    expect(L.byBuxori('').matches).toEqual([]);
  });
});

describe('English → Buxori (reverse index)', () => {
  test.each([
    ['water', 'Maim'], ['tea', 'Choy'], ['bread', 'Non'], ['brother', 'Barodar'],
    ['to go', 'Raftan'], ['go', 'Raftan'], ['good', 'Naghz'],
  ])('%s → %s', (en, bux) => {
    expect(L.byEnglish(en).roots.map((e) => e.lemma.text)).toContain(bux);
  });
  test('inflected headwords: "my mom" → Onayam', () => {
    expect(L.byEnglish('my mom').inflected.map((e) => e.text)).toContain('Onayam');
  });
});

describe('verb stems', () => {
  test.each([
    ['meravam', 'Raftan', 'rav', 'present'],
    ['nameravem', 'Raftan', 'rav', 'present'],
    ['raftam', 'Raftan', 'raft', 'simple_past'],
    ['meraftam', 'Raftan', 'raft', 'descriptive_past'],
    ['mekunad', 'Kardan', 'kun', 'present'],
    ['kardem', 'Kardan', 'kard', 'simple_past'],
  ])('%s → %s (stem %s, %s)', (word, inf, stem, tense) => {
    const a = L.analyzeVerb(word);
    expect(a.map((x) => [x.root.lemma.text, x.stemText, x.tense])).toContainEqual([inf, stem, tense]);
  });
  test('stated stems carry their source row', () => {
    const raftan = L.byBuxori('raftan').matches[0]?.roots.find((e) => e.verb);
    expect(raftan?.verb?.presentStem).toMatchObject({ text: 'rav', evidence: 'stated', source: { row: 594 } });
  });
});

describe('grammar rules', () => {
  test('word order is SOV: subject first, verb last', () => {
    const [wo] = L.rules('word_order');
    const roleOf = (p: TemplatePart): string | null => ('role' in p ? p.role : 'optional' in p ? roleOf(p.optional) : null);
    const roles = wo?.order.map(roleOf);
    expect(roles?.[0]).toBe('subject');
    expect(roles?.at(-1)).toBe('verb');
    expect(wo?.verbFinal).toBe(true);
  });
  test('simple present = me- + stem + ending', () => {
    expect(L.rule('simple_present_formation')?.statement).toMatch(/prefix me-.*personal ending/);
  });
  test('passive uses shudan with a past participle', () => {
    expect(L.rule('passive_voice')?.statement).toMatch(/shudan/);
  });
  test('copula is hast / nest', () => {
    expect(L.rules('copula').map((r) => [r.affirmative, r.negative])).toContainEqual(['hast', 'nest']);
  });
  test('adpositions: qati after the noun; qatori and bo before', () => {
    const place = Object.fromEntries(L.rules('adposition').map((r) => [r.form, r.placement]));
    expect(place).toEqual({ qati: 'after', qatori: 'before', bo: 'before' });
  });
});

describe('affixes and owner policy decisions', () => {
  test('-ho is the stated plural', () => {
    expect(L.affix('-ho').map((a) => [a.id, a.evidence])).toContainEqual(['pl.ho', 'stated']);
  });
  test('-ba is attested from examples (decision 1)', () => {
    expect(L.affix('ba').map((a) => [a.id, a.evidence])).toContainEqual(['dir.ba', 'attested']);
  });
  test('-ra and locative -da are borrowed from Tajik (decision 2)', () => {
    const ra = L.affix('-ra').flatMap((a) => a.allomorphs).find((al) => al.form === '-ra');
    expect(ra?.evidence).toBe('borrowed');
    expect(L.affix('-da').map((a) => [a.id, a.evidence])).toContainEqual(['loc.da', 'borrowed']);
  });
  test('default register is Regular (decision 3)', () => {
    expect(index.policy.defaultRegister).toBe('regular');
  });
  test('untranslated Buxori sentences are kept with en = null (decision 4)', () => {
    const untranslated = Object.values(index.examples).filter((e) => e.en === null);
    expect(untranslated.length).toBeGreaterThan(0);
    expect(untranslated.every((e) => e.bux.trim().length > 0)).toBe(true);
  });
});
