/* Offline "similar spellings in the book" (src/search/offlineSimilarWords.ts). */
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { findSimilarWordsOffline, levenshteinDistance, maxDistance } from '../src/search/offlineSimilarWords.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';

const index = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
const keys = Object.keys(index.roots.byGloss);

describe('edit distance', () => {
  test('known values', () => {
    expect(levenshteinDistance('kitten', 'sitting')).toBe(3);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('doctor', 'doctor')).toBe(0);
    expect(levenshteinDistance('docter', 'doctor')).toBe(1);
    expect(levenshteinDistance('abc', 'acb')).toBe(2);
  });
  test('short words may differ by one letter only', () => {
    expect([3, 4, 5, 9, 10, 14].map(maxDistance)).toEqual([1, 1, 2, 2, 3, 3]);
  });
});

describe('similar spellings', () => {
  test('finds the book word behind a misspelling, nearest first', () => {
    expect(findSimilarWordsOffline('docter', keys)[0]).toBe('doctor');
    expect(findSimilarWordsOffline('famly', keys)[0]).toBe('family');
    expect(findSimilarWordsOffline('teecher', keys)[0]).toBe('teacher');
  });
  test('verbs are matched without their "to "', () => {
    expect(findSimilarWordsOffline('wrte', keys)).toContain('write');
  });
  test('only book words, never the word itself, at most five, deterministic', () => {
    const bare = new Set(keys.map((k) => k.replace(/^to /, '')));
    for (const w of ['docter', 'hous', 'watter', 'physician', 'xyzzyq', 'water']) {
      const out = findSimilarWordsOffline(w, keys);
      expect(out.length).toBeLessThanOrEqual(5);
      expect(out).not.toContain(w);
      for (const o of out) { expect(bare.has(o), o).toBe(true); expect(levenshteinDistance(w, o)).toBeLessThanOrEqual(maxDistance(w.length)); }
      expect(findSimilarWordsOffline(w, [...keys].reverse())).toEqual(out);
    }
  });
  test('says nothing when nothing is spelled alike (it compares letters, not meanings)', () => {
    expect(findSimilarWordsOffline('physician', keys)).toEqual([]);
    expect(findSimilarWordsOffline('xyzzyq', keys)).toEqual([]);
    expect(findSimilarWordsOffline('ab', keys)).toEqual([]);
  });
});

describe('no external services', () => {
  test('nothing in the app source or the built app names another host', () => {
    const walk = (dir: URL): URL[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(new URL(d.name + '/', dir)) : [new URL(d.name, dir)]));
    const files = [...walk(new URL('../src/', import.meta.url)), ...walk(new URL('../translator/app/', import.meta.url))].filter((u) => /\.(ts|tsx|js)$/.test(u.pathname));
    expect(files.length).toBeGreaterThan(10);
    for (const f of files) expect(readFileSync(f, 'utf8'), f.pathname).not.toMatch(/https?:\/\/[^\s'"`]*(huggingface|jsdelivr|unpkg|googleapis|cdnjs)/i);
  });
});
