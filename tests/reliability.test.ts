import { describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { createLookup } from '../src/lib/lookup.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';
const require = createRequire(import.meta.url);
const Engine = require('../translator/engine.js');
const engine = new Engine(JSON.parse(readFileSync(new URL('../translator/data/index.json', import.meta.url), 'utf8')));
describe('translation regressions', () => {
  test('prototype property names never resolve from cache', () => {
    for (const q of ['constructor', '__proto__', 'toString']) expect(typeof engine.translate(q).status).toBe('string');
  });
  test('questions and statements have separate cache entries', () => {
    const a = engine.translate('You eat bread');
    const b = engine.translate('You eat bread?');
    expect(a).not.toBe(b);
    expect(b.bux).toMatch(/\?$/);
    expect(a.bux).not.toMatch(/\?$/);
  });
  test('plural is not fuzzily replaced by a singular', () => {
    const r = engine.translate('brothers');
    expect(r.status).not.toBe('fuzzy');
    expect(r.bux).not.toBe('Barodar');
  });
  test('plural possessive never silently becomes singular', () => {
    const r = engine.translate('my brothers');
    expect(r.bux).not.toBe('Barodaram');
  });
});
test('verb analysis preserves ending ambiguity', () => {
  const index = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
  const lookup = createLookup(index);
  for (const word of ['meravam', 'meravi', 'meravem']) {
    const analyses = lookup.analyzeVerb(word);
    const identities = analyses.map(a => [a.root.id,a.stem,a.prefixes.join(''),a.tense,a.ending?.id].join('|'));
    expect(new Set(identities).size).toBe(identities.length);
    expect(analyses.length).toBeGreaterThan(0);
  }
});

test('compound verbs analyze their auxiliary without losing the preverb', () => {
  const index = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
  const lookup = createLookup(index);
  expect(lookup.analyzeVerb('zindagi mekunam').some(a => a.root.verb?.compound?.preverb === 'zindagi')).toBe(true);
  expect(lookup.analyzeVerb('zzxx mekunam')).toEqual([]);
});
test('duplicate copula rules retain all provenance in one semantic rule', () => {
  const index = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
  const copulas = index.syntaxRules.filter(r => r.kind === 'copula');
  const signatures = copulas.map(r => JSON.stringify([r.affirmative,r.negative,r.spoken,r.register]));
  expect(new Set(signatures).size).toBe(signatures.length);
  expect(copulas.some(r => r.sources.length > 1)).toBe(true);
});

test('corpus-only vocabulary remains discoverable without inventing headwords', () => {
  const index = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
  expect(createLookup(index).corpus('sholüm').length).toBeGreaterThan(0);
});
