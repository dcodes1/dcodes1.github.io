/*
 * Translation engine: known translations, register policy, morphology against the
 * TSV's printed tables, regressions for every error found so far, and no-leakage.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import { Engine } from '../src/engine/engine.ts';
import { Morphology } from '../src/engine/morphology.ts';
import type { AttestedVerbForm, BuxoriIndex } from '../src/lib/types.ts';

const index = JSON.parse(readFileSync(resolve(import.meta.dirname, '../src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const E = new Engine(index);
const T = (en: string) => E.translate(en);

describe('verified source translations (exact layer)', () => {
  test.each([
    ['water', 'Maim'], ['to go', 'Raftan'], ['Sunday', 'Yakshanbe'], ['brother', 'Barodar'],
    ['Thank you', 'Rahmat'], ['Hello!', 'Sholüm!'], ['I don\'t know', 'Man namedonam'],
    ['I have two books.', 'Man duta kitov doram'], ['You are a man.', 'Tu mardi'],
    ['fifth', 'panjum'], ['sixth', 'shishtum'],
  ])('%s → %s', (en, bux) => {
    const r = T(en);
    expect(r.status).toBe('exact');
    expect(r.text).toBe(bux);
    expect(r.rows.length).toBeGreaterThan(0);
  });
});

describe('owner policy: Regular (conversational) register first', () => {
  test('my mom → Onim (Regular), Onayam only as the Literal alternative', () => {
    const r = T('my mom');
    expect(r.text).toBe('Onim');
    expect(r.alternatives.map((a) => a.text)).toContain('Onayam');
  });
  test('your grandmother → bivet (the -b- spellings are REVIEW-flagged)', () => {
    expect(T('your grandmother').text).toBe('bivet');
  });
  test('"(polite)" / "(sing.)" labels pick the matching source row', () => {
    expect(T('come! (polite)').text).toBe('bed');
    expect(T('How many books do you have? (polite)').text).toBe('Shumo chandta kitov dored?');
    expect(T('How many books do you have? (sing.)').text).toBe('Tu chandta kitov dori?');
  });
  test('second person yields informal (tu) and formal (shumo) variants', () => {
    const r = T('Where do you live?');
    expect(r.variants.map((v) => v.register)).toEqual(['informal', 'formal']);
    expect(r.variants[0]?.text).toMatch(/^Tu /);
    expect(r.variants[1]?.text).toMatch(/^Shumo /);
  });
});

describe('regressions: errors found in earlier versions', () => {
  test('why → Chuva? (legacy engine said "charo", not in the source)', () => expect(T('why?').text).toBe('Chuva?'));
  test('because → Azbaski (legacy said "baroi ki", not in the source)', () => expect(T('because').text).toBe('Azbaski'));
  test('brothers → barodarho, not uka (half of "akayu uka") or the singular', () => {
    const r = T('brothers');
    expect(r.text).toBe('barodarho');
    expect(r.status).toBe('grammar');
  });
  test('irregular verbs use the printed Regular forms: I go → merum, not meravam', () => {
    expect(T('I go to school').text).toBe('Man ba maktav merum');
    expect(T('He becomes happy').text).not.toMatch(/meshavad/);
  });
  test('compound verbs keep their noun: I live → zindagi mekunam (not "zindagi kor mekunam")', () => {
    expect(T('I live in Israel now').text).toBe('Man aknun ba Isroel zindagi mekunam');
  });
  test('capitalised English words are not copied into the output as "names"', () => {
    for (const en of ['Saturday', 'October', 'Christian']) {
      const r = T(en);
      if (r.text) expect(r.text.toLowerCase()).not.toContain(en.toLowerCase());
    }
  });
  test('fuzzy matching corrects typos but never swaps words', () => {
    expect(T('our grandfather').text).toBe('Bovomo');
    const typo = T('our grandfahter');
    expect(typo.status).toBe('fuzzy');
    expect(typo.text).toBe('Bovomo');
  });
  test('"to X" with no verb never resolves to a noun', () => {
    const r = T('to blorb');
    expect(r.status).toBe('none');
  });
  test('a sentence with an untranslatable word is marked partial, the word is reported', () => {
    const r = T('He has six zorbles');
    expect(r.status).toBe('none');
    expect(r.unknown).toContain('zorbles');
  });
  test('"thank you" does not become "tu" word-by-word', () => expect(T('Thank you').text).toBe('Rahmat'));
  test('a stranded preposition joins the question word: Where are you from? → az kujo (not "Where are you?")', () => {
    expect(T('Where are you from?').variants.map((v) => v.text)).toEqual(['Tu az kujo?', 'Shumo az kujo?']);
    expect(T('Where are you?').variants.map((v) => v.text)).toEqual(['Tu kujo?', 'Shumo kujo?']);
  });
  test('drafts with missing words are hints, never answers (0 of 36 were right on the frozen test set)', () => {
    for (const en of ['He has six zorbles', 'blorp the water quickly']) {
      const r = T(en);
      expect(r.status).toBe('none');
      expect(r.text).toBeNull();
      if (r.hint) expect(r.hint.text.length).toBeGreaterThan(0);
    }
  });
});

describe('morphology (built forms, cited rules)', () => {
  test.each([
    ['my book', 'kitovam'], ['our grandfather', 'Bovomo'],
    ['two red apples', 'duta sevi surx'], ['the fifth lesson', 'darsi panjum'], ['twenty-five', 'bistu panj'],
    ['125', 'sadu bistu panj'], ['seven books', 'hafta kitov'], ['the house of my father', 'xoni padaram'],
    ['I am a doctor', 'Man düxturam'], ['They are doctors', 'Inho düxturho hastand'],
    ['We are reading a book', 'Mo kitov xonsodim'], ['I drink wine', 'Man mayo menüsham'],
    ['I had said', 'Man gufta budam'], ['I did not eat meat', 'Man bosor naxürdam'],
  ])('%s → %s', (en, bux) => {
    const r = T(en);
    expect(r.text).toBe(bux);
    expect(['exact', 'grammar']).toContain(r.status);
  });

  test('their father: both printed Regular forms are offered (dadi inho p25, Padarashon p26)', () => {
    const r = T('their father');
    expect([r.text, ...r.alternatives.map((a) => a.text)]).toEqual(expect.arrayContaining(['dadi inho', 'Padarashon']));
  });

  test('every generated answer explains itself with steps', () => {
    for (const en of ['two red apples', 'I drink wine', 'my brothers']) expect(T(en).steps.length).toBeGreaterThan(0);
  });

  test('plural + possessive is labelled low-confidence (one printed example)', () => {
    const r = T('my brothers');
    expect(r.text).toBe('barodarhoyam');
    expect(r.evidence).toBe('derived');
    expect(r.confidence).toBeLessThan(0.75);
  });

  test('leave-one-out: hiding each printed conjugation, the engine rebuilds ≥ 85% from rules and the rest of the table', () => {
    const M = new Morphology(index);
    const vf = index.roots.verbForms as Record<string, AttestedVerbForm[]>;
    const norm = (s: string) => s.toLowerCase().replace(/[.!?]/g, '').replace(/im$/, 'em');
    let ok = 0, n = 0;
    for (const [id, forms] of Object.entries(vf)) {
      const root = index.roots.entries[id as keyof typeof index.roots.entries]!;
      for (const f of forms) {
        if (f.register !== 'regular' || f.source.review || f.tense.startsWith('conjectural')) continue;
        vf[id] = forms.filter((x) => !(x.tense === f.tense && x.pn === f.pn));
        const b = M.conjugate(root, f.tense, f.pn, { negative: f.negative });
        vf[id] = forms;
        n++;
        if (b && norm(b.text) === norm(f.form)) ok++;
      }
    }
    expect(n).toBeGreaterThan(200);
    expect(ok / n).toBeGreaterThanOrEqual(0.85);
  });

  test('irregular stem inference only fires when it reproduces the whole printed table', () => {
    const M = new Morphology(index);
    const vf = index.roots.verbForms as Record<string, AttestedVerbForm[]>;
    const omadan = Object.values(index.roots.entries).find((e) => e.lemma.key === 'omadan')!;
    const raftan = Object.values(index.roots.entries).find((e) => e.lemma.key === 'raftan')!;
    const hide = (id: string, pn: string) => { const all = vf[id]!; vf[id] = all.filter((x) => !(x.tense === 'present' && x.pn === pn)); return () => { vf[id] = all; }; };
    let restore = hide(raftan.id, '3pl');
    expect(M.conjugate(raftan, 'present', '3pl')?.text).toBe('merun');
    restore();
    restore = hide(omadan.id, '3pl');
    const om = M.conjugate(omadan, 'present', '3pl');
    restore();
    expect(om?.confidence ?? 0).toBeLessThanOrEqual(0.5);   // no reliable pattern → low confidence, flagged
  });
});

describe('honesty', () => {
  const sentences = ['I go to school', 'two red apples', 'Where do you live?', 'Give me the book', 'I lived in Tashkent',
    'He has six zorbles', 'my big book', 'I ate bread yesterday', 'The book is on the table', 'Good evening!'];
  test('no English word leaks into Buxori output (except reported names)', () => {
    const english = new Set(['the', 'a', 'to', 'is', 'are', 'school', 'apples', 'live', 'book', 'bread', 'table', 'evening', 'zorbles', 'six', 'good']);
    for (const s of sentences) {
      const r = T(s);
      const words = (r.text ?? '').toLowerCase().replace(/[^a-zü' ]/g, ' ').split(/\s+/).filter(Boolean);
      for (const w of words) expect(english.has(w), `${s} → ${r.text}`).toBe(false);
    }
  });
  test('nonsense gets no translation, only related examples', () => {
    const r = T('xyzzy plorp');
    expect(r.status).toBe('none');
    expect(r.text).toBeNull();
  });
  test('every non-none result carries evidence and confidence in [0,1]', () => {
    for (const s of sentences) {
      const r = T(s);
      if (r.status === 'none') continue;
      expect(r.evidence).not.toBeNull();
      expect(r.confidence).toBeGreaterThan(0);
      expect(r.confidence).toBeLessThanOrEqual(1);
    }
  });
  test('deterministic: same input, same output', () => {
    const a = new Engine(index), b = new Engine(index);
    for (const s of sentences) expect(a.translate(s)).toEqual(b.translate(s));
  });
});
