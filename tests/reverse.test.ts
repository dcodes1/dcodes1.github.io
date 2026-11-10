/*
 * Buxori → English (src/engine/reverse.ts): printed sentences win, inflected words
 * resolve to root + affixes, clauses are re-ordered and conjugated in English, unknown
 * words are never translated, and the word-by-word analysis is always present.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { Engine } from '../src/engine/engine.ts';
import { articleFor, ingOf, ordinalOf, participleOf, pastOf, pluralOf, thirdOf, verbPhrase, vpText } from '../src/engine/english-gen.ts';
import { ReverseEngine, type Reverse } from '../src/engine/reverse.ts';
import { createLookup } from '../src/lib/lookup.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';

const index = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
const engine = new Engine(index);
const rev = new ReverseEngine(index, createLookup(index), engine.morph);
const T = (s: string) => rev.translate(s);
const chosen = (r: Reverse) => r.tokens.map((t) => t.readings[t.chosen]);

describe('printed in the source (exact)', () => {
  test.each([
    ['Safro tüvo!', 'Good morning!'],
    ['Man duta kitov doram', 'I have two books.'],
    ['Ü gap zasode', 'He is talking'],
    ['Man gufta budam', 'I had said'],
    ['Ki omad?', 'Who came?'],
  ])('%s → %s', (bux, en) => {
    const r = T(bux);
    expect(r.status).toBe('exact');
    expect(r.english).toBe(en);
    expect(r.tier).toBe('high');
    expect(r.printed[0]?.row).toBeGreaterThan(1);
  });
  test('a printed sentence still gets its word-by-word analysis', () => {
    const r = T('Man duta kitov doram');
    expect(r.tokens.map((t) => t.latin)).toEqual(['man', 'duta', 'kitov', 'doram']);
    expect(chosen(r)[1]?.parts.map((p) => p.label)).toContain('counting suffix');
    expect(chosen(r)[3]?.f.verb).toMatchObject({ tense: 'present', pn: '1sg', negative: false });
  });
  test('dictionary words give all their senses', () => {
    expect(T('kitov').english).toBe('book');
    expect(T('Bist').english).toBe('twenty');
    expect(T('xona').english).toMatch(/room/);
    expect(T('xona').english).toMatch(/house/);
  });
  test('printing is ignored for case, spacing and final punctuation', () => {
    expect(T('MAN MERUM').english).toBe(T('man  merum ').english);
    expect(T('safro tüvo').status).toBe('exact');
  });
});

describe('inflected words → root + affixes', () => {
  test.each([
    ['kitovho', 'book', ['plural']],
    ['kitovhoyam', 'book', ['plural', 'possessive: my']],
    ['kitova', 'book', ['direct object marker']],
    ['xonaba', 'room', ['to / at / for']],
    ['barodaram', 'brother', ['possessive: my']],
    ['seta', 'three', ['counting suffix']],
  ])('%s = %s + %j', (word, gloss, labels) => {
    const r = T(word).tokens[0]!;
    const rd = r.readings.find((x) => labels.every((l) => x.parts.some((p) => p.label === l)));
    expect(rd, JSON.stringify(r.readings.map((x) => x.parts))).toBeDefined();
    expect(rd!.gloss).toContain(gloss);
  });
  test('a dropped final vowel is restored: xonim = xona + -im', () => {
    const rd = T('xonim').tokens[0]!.readings.find((x) => x.f.poss === '1sg');
    expect(rd?.lemma.toLowerCase()).toBe('xona');
  });
  test.each([
    ['merum', 'Raftan', 'present', '1sg', false],
    ['namedonam', 'Donistan', 'present', '1sg', true],
    ['raftam', 'Raftan', 'simple_past', '1sg', false],
    ['rafsode', 'Raftan', 'present_continuous', '3sg', false],
    ['merafti', 'Raftan', 'descriptive_past', '2sg', false],
    ['xaridem', 'Xaridan', 'simple_past', '1pl', false],
  ])('verb %s = %s, %s, %s', (word, lemma, tense, pn, negative) => {
    const rd = T(word).tokens[0]!.readings.find((x) => x.kind === 'verb' && x.f.verb?.tense === tense && x.f.verb.pn === pn);
    expect(rd?.lemma).toBe(lemma);
    expect(rd?.f.verb?.negative).toBe(negative);
  });
  test('Literal-register verb is labelled and its everyday form given', () => {
    const rd = T('meravam').tokens[0]!.readings[0]!;
    expect(rd).toMatchObject({ lemma: 'Raftan', register: 'literal', everyday: 'merum' });
  });
  test('every form the generator builds is recognised by the analyser (round trip)', () => {
    let n = 0;
    for (const root of Object.values(index.roots.entries).filter((e) => e.verb).slice(0, 60)) {
      for (const tense of ['present', 'simple_past', 'present_perfect', 'past_perfect', 'present_continuous'] as const) {
        const form = engine.morph.conjugate(root, tense, '1pl', { negative: true })?.text;
        if (!form) continue;
        n++;
        const hit = rev.analyse(form).some((x) => x.kind === 'verb' && x.root === root && x.f.verb?.negative);
        expect(hit, `${root.lemma.text} ${tense}: ${form}`).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(200);
  });
});

describe('compound verbs and multi-word units (longest match first)', () => {
  test('zindagi mekunam is one unit: to live', () => {
    const r = T('Man aknun ba Isroel zindagi mekunam');
    expect(r.tokens.map((t) => t.latin)).toEqual(['man', 'aknun', 'ba', 'isroel', 'zindagi mekunam']);
    expect(chosen(r)[4]?.lemma).toBe('Zindagi kardan');
    expect(r.english).toBe('I live in Israel now.');
  });
  test('negation sits on the auxiliary: kor namekunand', () => {
    const rd = rev.analyse('kor namekunand').find((x) => x.kind === 'verb');
    expect(rd?.lemma).toBe('Kor kardan');
    expect(rd?.f.verb).toMatchObject({ pn: '3pl', negative: true });
  });
  test('two-word tenses: gufta budam, and the Literal continuous for any verb', () => {
    expect(rev.analyse('gufta budam').find((x) => x.kind === 'verb')?.f.verb?.tense).toBe('past_perfect');
    expect(T('Mo xonda istodayem').english).toBe('We are reading.');
    expect(T('Ü narafta istoda bud').english).toBe('He/she was not going.');
  });
  test('“want to”: infinitive + -i + hast, the construction English → Buxori builds', () => {
    const there = engine.translate('I want to buy bread').text!;
    expect(T(there).english).toBe('I want to buy bread.');
    expect(T('Ü raftani nest').english).toBe('He/she does not want to go.');
  });
});

describe('word order and English generation', () => {
  test.each([
    ['Man kitov doram', 'I have a book.'],                       // SOV → SVO, article
    ['Mo non xaridem', 'We bought bread.'],                      // mass noun: no article
    ['Man in kitova xondam', 'I read this book.'],
    ['Ü kitova xond.', 'He/she read the book.'],                 // object marker → "the"
    ['Man se barodar doram', 'I have three brothers.'],          // numeral → plural
    ['Man bistu panj kitov doram', 'I have 25 books.'],          // compound numeral
    ['Dina man non xaridam', 'I bought bread yesterday.'],       // time adverb moves to the end
    ['Man ba xona merum', 'I go to a room.'],                    // ba + motion verb = to
    ['Man tuya naghz mebinam', 'I like you.'],                   // pronoun object
    ['Man nameravam', 'I do not go.'],
    ['Ü mexarid', 'He/she used to buy.'],
    ['Man non va maim xaridam', 'I bought bread and water.'],
    ['Man va tu merem', 'I and you go.'],
    ['Man raftam. Tu omadi.', 'I went. You came.'],
  ])('%s → %s', (bux, en) => { expect(T(bux).english).toBe(en); });

  test.each([
    ['Tu kujo zindagi mekuni?', 'Where do you live?'],
    ['Shumo chi mekuned?', 'What do you do?'],
    ['Tu az kujo omadi?', 'Where did you come from?'],
    ['Tu kitov dori?', 'Do you have a book?'],
    ['Kitov kujo?', 'Where is the book?'],
    ['Nomi shumo chi?', 'What is your name?'],
    ['In chi?', 'What is this?'],
    ['Tu düxturi?', 'Are you a doctor?'],
  ])('question: %s → %s', (bux, en) => { expect(T(bux).english).toBe(en); });

  test.each([
    ['Ü düxtur', 'He/she is a doctor.'],
    ['Inho düxtur hastand', 'They are doctors.'],
    ['Ü naghz', 'He/she is good.'],
    ['Kitovi man kalon', 'My book is big.'],
    ['Padaram düxtur nest', 'My father is not a doctor.'],
    ['In kitovi man', 'This is my book.'],
    ['Man az Buxoro', 'I am from Bukhara.'],
    ['Padari Dovid düxtur', 'Dovid’s father is a doctor.'],
  ])('“to be”: %s → %s', (bux, en) => { expect(T(bux).english).toBe(en); });

  test('noun phrases on their own are not turned into sentences', () => {
    expect(T('Kitovi kalon').english).toBe('Big book');
    expect(T('kitovhoyam').english).toBe('My books');
    expect(T('seta kitov').english).toBe('Three books');
    expect(T('bistu panj').english).toBe('25');
  });
  test('present = future is said, not hidden', () => {
    expect(T('Man kitov doram').notes.join(' ')).toMatch(/same form also means the future/);
  });
});

describe('scripts', () => {
  test('Cyrillic input', () => {
    const r = T('Ман китов дорам');
    expect(r.script).toBe('cyrillic');
    expect(r.latin).toBe('man kitov doram');
    expect(r.english).toBe('I have a book.');
    expect(T('Худо').english).toBe('G-d');
  });
  test('Latin without ü is accepted and flagged', () => {
    const r = T('Man duxturam');
    expect(r.english).toBe('I am a doctor.');
    expect(chosen(r)[1]?.spelling).toBe('fuzzy');
    expect(r.notes.join(' ')).toMatch(/without their accents/);
    expect(r.confidence).toBeLessThan(T('Man düxturam').confidence);
  });
  test('Hebrew script is not translated (no verified Hebrew spelling in the source)', () => {
    const r = T('מן מרום');
    expect(r.script).toBe('hebrew');
    expect(r.english).toBeNull();
    expect(r.unknown.length).toBe(2);
  });
});

describe('unknown words, punctuation, empty input', () => {
  test('an unknown word stops the sentence; it is kept and listed, never translated', () => {
    const r = T('Man zorble merum');
    expect(r.status).toBe('gloss');
    expect(r.english).toBeNull();
    expect(r.unknown).toEqual(['zorble']);
    expect(ReverseEngine.gloss(r.tokens)).toBe('I · ⟨zorble⟩ · go [I]');
  });
  test('a near spelling is offered as a suggestion, never used', () => {
    const r = T('kitob');
    expect(r.status).toBe('none');
    expect(r.english).toBeNull();
    expect(r.tokens[0]!.readings).toEqual([]);
    expect(r.tokens[0]!.suggestions.map((s) => s.lemma)).toContain('Kitov');
  });
  test('nonsense → none', () => { expect(T('xyzzy plorp').status).toBe('none'); });
  test.each([[''], ['   '], ['?!'], ['...']])('empty input %j', (s) => {
    const r = T(s);
    expect(r).toMatchObject({ status: 'none', english: null, confidence: 0, tokens: [] });
  });
  test('punctuation: quotes, commas and question marks do not hide words', () => {
    expect(T('"Man kitov doram."').english).toBe('I have a book.');
    expect(T('Man, tu va ü').english).toBe('I, you and he/she');
    expect(T("Chand bor guftam tuba: 'In kora nakun!'").unknown).toEqual([]);
  });
  test('names the source does not have are kept as written', () => {
    expect(T('Man ba Zorbleton merum').english).toBe('I go to Zorbleton.');
  });
  test('very long input is cut, not crashed on', () => {
    expect(() => T('man merum '.repeat(400))).not.toThrow();
  });
});

describe('confidence', () => {
  test('printed = 1; built sentences lose confidence with each content word', () => {
    expect(T('Safro tüvo!').confidence).toBe(1);
    const one = T('Man merum.'), two = T('Man kitov doram'), three = T('Dina man non xaridam');
    expect(one.tier).toBe('high');
    expect(two.confidence).toBeLessThan(0.8);
    expect(three.confidence).toBeLessThan(two.confidence);
    expect(three.tier).toBe('low');
    expect(three.factors.join(' ')).toMatch(/3 content words/);
  });
  test('“is” supplied between two bare nouns lowers confidence', () => {
    expect(T('Kitovho kalon').factors.join(' ')).toMatch(/“is” was supplied/);
  });
});

describe('ambiguity and registers (breakdown data)', () => {
  test('a word with several readings lists them', () => {
    const t = T('Mo non xaridem').tokens[0]!;
    expect(t.readings.length).toBeGreaterThan(1);
    expect(t.readings[t.chosen]?.pos).toBe('pronoun');          // "we", not the noun spelled the same
  });
  test('other source words for the same English are offered', () => {
    const rd = T('Yakshanbe').tokens[0]!.readings[0]!;
    expect(rev.synonyms(rd).map((s) => s.text.toLowerCase())).toContain('yakshabot');
  });
  test('spoken and variant forms come with the entry', () => {
    const rd = T('Pagah').tokens[0]!.readings[0]!;
    expect(rd.forms).toContainEqual({ text: 'paga', kind: 'spoken' });
    expect(T('paga').tokens[0]!.readings[0]).toMatchObject({ lemma: 'Pagah', register: 'spoken' });
  });
});

describe('the source’s exercise sentences (no English printed, so no expected answer)', () => {
  const sentences = Object.values(index.examples).filter((e) => e.source.entryType === 'exercise');
  test('there are 98 and every one is analysed without error', () => {
    expect(sentences.length).toBe(98);
    for (const e of sentences) expect(() => T(e.bux), e.bux).not.toThrow();
  });
  test('at least 85% of their words are recognised, and no rendering contains an unrecognised word', () => {
    let words = 0, known = 0;
    for (const e of sentences) {
      const r = T(e.bux);
      words += r.tokens.length;
      known += r.tokens.filter((t) => t.readings[t.chosen]).length;
      // (a sentence the book prints elsewhere is verified as a whole, whatever its words)
      if (r.english && !r.printed.length) expect(r.tokens.every((t) => t.readings[t.chosen]), e.bux).toBe(true);
    }
    expect(known / words).toBeGreaterThan(0.85);
  });
});

describe('English generation helpers', () => {
  test('verbs', () => {
    expect([pastOf('go'), pastOf('buy'), pastOf('stop'), pastOf('live'), pastOf('study')]).toEqual(['went', 'bought', 'stopped', 'lived', 'studied']);
    expect([participleOf('go'), ingOf('run'), ingOf('live'), ingOf('lie'), thirdOf('go'), thirdOf('have'), thirdOf('study')]).toEqual(['gone', 'running', 'living', 'lying', 'goes', 'has', 'studies']);
    expect(vpText(verbPhrase('go', 'present', '3sg', false))).toBe('goes');
    expect(vpText(verbPhrase('go', 'present', '3sg', true))).toBe('does not go');
    expect(vpText(verbPhrase('get tired', 'simple_past', '1sg', false))).toBe('got tired');
    expect(vpText(verbPhrase('go', 'past_perfect', '1pl', true))).toBe('had not gone');
    expect(vpText(verbPhrase('be', 'simple_past', '3pl', false))).toBe('were');
  });
  test('nouns', () => {
    expect([pluralOf('book'), pluralOf('child'), pluralOf('city'), pluralOf('box'), pluralOf('brother'), pluralOf('older brother')]).toEqual(['books', 'children', 'cities', 'boxes', 'brothers', 'older brothers']);
    expect([articleFor('apple'), articleFor('book'), articleFor('university')]).toEqual(['an', 'a', 'a']);
    expect([ordinalOf(5), ordinalOf(23), ordinalOf(111)]).toEqual(['fifth', '23rd', '111th']);
  });
});
