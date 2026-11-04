import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { readTsv } from '../scripts/lib/tsv.ts';
import {
  canonicalKey, detectScript, foldTsvStress, fuzzyKey, hebrewToLatin, looseKey, skeletonKey, toCyrillic,
} from '../src/lib/normalizer.ts';

const { rows } = readTsv(resolve(import.meta.dirname, '../translator/data/bukhori.tsv'));
const tsvStrings = [...new Set(rows.flatMap((r) => [r.bukhori, r.spoken, r.alt].flatMap((c) => c.split(/[;,]/)).map((s) => s.trim()).filter(Boolean)))];

describe('canonicalKey: Cyrillic → TSV Latin', () => {
  test.each([
    ['Ҳаво', 'havo'], ['Худо', 'xudo'], ['Қати', 'qati'], ['Ҷумъа', "jum'a"], ['Нағз', 'naghz'],
    ['Сӯҳбат', 'sühbat'], ['Ёр', 'yor'], ['Ерусолайим', 'yerusolayim'], ['Эй', 'ey'], ['Вадяэв', 'vadyaev'],
    ['Яхшӣ', 'yaxshi'], ['бачаҳо', 'bachaho'],
    ['Писҳо', "pis'ho"],    // сҳ must not become the digraph "sh"
    ['Болница', 'bolnitsa'],
  ])('%s → %s', (input, key) => expect(canonicalKey(input)).toBe(key));
});

describe('canonicalKey: variant Latin → TSV Latin', () => {
  test.each([
    ['Khudo', 'xudo'], ['XUDO', 'xudo'],                // kh/x, case
    ['čoy', 'choy'], ['šir', 'shir'], ['žurnal', 'zhurnal'], // háček
    ['ǧum‘a', "jum'a"], ['jum’a', "jum'a"],             // j/ǧ, curly apostrophes → ayin
    ['Sholūm', 'sholüm'], ['Sholŭm', 'sholüm'],         // ū/ŭ → ü
    ['Ġam', 'gham'], ['g‘am', 'gham'],                  // ġ and Uzbek gʻ → gh
    ['Barodár', 'barodar'], ['Maím', 'maim'],           // stress accents dropped
    ['Wodka', 'vodka'],
    ['Bar​odar', 'barodar'],                        // zero-width space dropped
  ])('%s → %s', (input, key) => expect(canonicalKey(input)).toBe(key));

  test('keeps TSV spellings that look like variants', () => {
    expect(canonicalKey('kolledzhba')).toBe('kolledzhba'); // no dzh → j
    expect(canonicalKey('hashtsad')).toBe('hashtsad');     // ts is t+s here
    expect(canonicalKey("pis'ho")).toBe("pis'ho");
  });

  test('TSV stress marks on consonants fold only via foldTsvStress', () => {
    expect(canonicalKey(foldTsvStress('ġiriftam'))).toBe('giriftam');
    expect(canonicalKey(foldTsvStress('baćha'))).toBe('bacha');
  });
});

describe('Hebrew script (lossy)', () => {
  test('consonant mapping incl. geresh and final he', () => {
    expect(hebrewToLatin('ג׳ומעה')).toBe("jum'a");
    expect(hebrewToLatin('שלום')).toBe('shlum');
    expect(hebrewToLatin('משפחה')).toBe('mshpha');
  });
  test('vowel points are used when present', () => {
    expect(hebrewToLatin('שָׁלוֹם')).toBe('shalom');
  });
  test('skeleton of Hebrew input matches the TSV spelling', () => {
    expect(skeletonKey('שלום')).toBe(skeletonKey('sholüm'));
  });
});

describe('fallback keys', () => {
  test('fuzzy strips diacritics and ayin', () => {
    expect(fuzzyKey('Rüz')).toBe('ruz');
    expect(fuzzyKey("Jum'a")).toBe('juma');
  });
  test('loose merges o/u, e/i and doubled letters', () => {
    expect(looseKey('xudoo')).toBe(looseKey('xudo'));
    expect(looseKey('meshe')).toBe(looseKey('mishi'));
  });
  test('skeleton merges letters Hebrew script cannot distinguish', () => {
    expect(skeletonKey('kitob')).toBe(skeletonKey('kitov'));
    expect(skeletonKey('xudo')).toBe(skeletonKey('hudo'));
  });
});

describe('detectScript', () => {
  test.each([['Xudo', 'latin'], ['Худо', 'cyrillic'], ['שלום', 'hebrew'], ['Xudo Худо', 'mixed'], ['123', 'none']] as const)(
    '%s → %s', (s, script) => expect(detectScript(s)).toBe(script),
  );
});

describe('toCyrillic', () => {
  test.each([
    ['Xudo', 'Худо'], ["Jum'a", 'Ҷумъа'], ["pis'ho", 'писҳо'], ['eton', 'этон'], ['yerusholayim', 'ерушолайим'],
    ['isroel', 'исроэл'], ['naghz', 'нағз'], ['Sholüm', 'Шолӯм'],
  ])('%s → %s', (input, cyr) => expect(toCyrillic(input)).toBe(cyr));
});

describe(`every TSV Buxori string (${tsvStrings.length})`, () => {
  const keys = tsvStrings.map((s) => canonicalKey(foldTsvStress(s)));
  test('canonicalKey is idempotent', () => {
    expect(keys.filter((k) => canonicalKey(k) !== k)).toEqual([]);
  });
  test('Latin → Cyrillic → Latin round-trips exactly', () => {
    expect(keys.filter((k) => canonicalKey(toCyrillic(k)) !== k)).toEqual([]);
  });
  test('Cyrillic conversion never merges two distinct keys', () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const k of new Set(keys)) {
      const c = toCyrillic(k).toLowerCase();
      if (seen.has(c) && seen.get(c) !== k) clashes.push(`${seen.get(c)} / ${k}`);
      seen.set(c, k);
    }
    expect(clashes).toEqual([]);
  });
});
