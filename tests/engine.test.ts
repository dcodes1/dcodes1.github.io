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

describe('everyday English (typed casually)', () => {
  const out = (en: string) => { const r = T(en); return r.variants.length ? r.variants.map((v) => v.text) : r.text; };
  test.each([
    ['Im so happy!', 'Man bisyor baxtnokam'],       // no apostrophe + intensifier (reported bug)
    ["I'm so happy!", 'Man bisyor baxtnokam'],
    ['I am really happy', 'Man bisyor baxtnokam'],
    ['Im not hungry', 'Man gushna nestam'],
    ['I dont know', 'Man namedonam'],
    ['dont go', 'narov'],
    ['thats good', 'Vay naghz'],
    ['wheres my book', 'Kitovam kujo?'],
    ['thx', 'Rahmat'],
    ['thank u', 'Rahmat'],
    ['He is sad', 'Ü ghamgin'],                     // "He/she is sad" row; "sad" only in an example row
    ['She is very beautiful', 'Ü bisyor xushrü'],
    ['a very big house', 'xoni bisyor kalon'],
    ["It's very cold!!!", 'Bisyor xunuk'],
    ["I'm at home", 'Man ba xona'],
  ])('%s → %s', (en, bux) => expect(out(en)).toBe(bux));

  test('"whats your name" uses the printed (sing.) and (polite) rows', () => {
    expect(out('whats your name')).toEqual(['Nomat che?', 'Nomaton che?']);
  });
  test('intensifiers go before the word they strengthen (bisyor qiziq), never after it with ezafe', () => {
    for (const en of ["I'm very happy", 'She is so beautiful']) expect(String(out(en))).toMatch(/bisyor [a-zü']+$/);
  });
});

describe('modal verbs (built as the source builds them, or not at all)', () => {
  test.each([
    ['I can go', 'Man rafta metavonam'],            // participle + tavonistan (karda metavoned, row 141)
    ['I cant go', 'Man rafta nametavonam'],         // must NOT become "I don't go"
    ['I must go', 'Man boyad ravam'],               // boyad + present stem, no me- (Boyad ravam)
    ['I want to eat', 'Man xürdani hastam'],        // infinitive + -i + hast (Man guftani hastam)
    ["I don't want to eat", 'Man xürdani nestam'],
    ["You hadn't said", 'Tu nagufta budi'],          // negated past perfect, not "have"
  ])('%s → %s', (en, bux) => expect(T(en).text).toBe(bux));
  test('a modal the source does not document is never silently dropped', () => {
    for (const en of ['I may go', 'He might eat']) expect(T(en).status).toBe('none');
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
    expect(r.confidence).toBeLessThan(0.8);
    expect(r.tier).toBe('medium');
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

describe('confidence tiers (Engine.scored)', () => {
  test('printed entries are high confidence', () => {
    expect(T('Good morning')).toMatchObject({ status: 'exact', tier: 'high', confidence: 1 });
  });
  test('one sourced word with regular inflection is high', () => {
    for (const s of ['We bought', 'They buy', 'my book', 'three books']) {
      const r = T(s);
      expect(r.status, s).toBe('grammar');
      expect(r.tier, s).toBe('high');
      expect(r.confidence, s).toBeGreaterThanOrEqual(0.8);
    }
  });
  test('each extra content word and each ambiguous word lowers it', () => {
    const two = T('the big house'), many = T('I live in Israel now');
    expect(two.tier).toBe('medium');
    expect(many.tier).toBe('low');
    expect(many.text).toBe('Man aknun ba Isroel zindagi mekunam');      // the draft is still returned
    expect(many.factors?.join(' ')).toMatch(/content words/);
    expect(many.factors?.join(' ')).toMatch(/more than one word for/);
  });
  test('place names are not counted as a word choice', () => {
    expect(T('I live in Israel now').factors?.join(' ')).toMatch(/^.*2 content words/);
  });
  test('a form with one printed example is flagged and kept out of the high tier', () => {
    const r = T('my brothers');
    expect(r.steps.some((s) => s.weak)).toBe(true);
    expect(r.tier).not.toBe('high');
  });
  test('no answer → tier none, confidence 0', () => {
    expect(T('xyzzy plorp')).toMatchObject({ status: 'none', tier: 'none', confidence: 0 });
  });
  test('every answer has a tier and its reasons', () => {
    for (const s of ['water', 'I go', 'Where are you from?', 'He has six books', 'grandfahter']) {
      const r = T(s);
      expect(['high', 'medium', 'low'], s).toContain(r.tier);
      expect(r.factors?.length, s).toBeGreaterThan(0);
    }
  });
});

describe('fractions are answered only when printed', () => {
  test('one third is the printed word, never number + ordinal', () => {
    expect(T('one third').text).toBe('seyak');
    expect(T('three fourths').status).toBe('none');       // used to build "seta chorum"
    expect(T('twenty third').text).toBe('bistu seyum');
    expect(T('two hundred first').text).toBe('dusadu yakum');
  });
});

describe('“to be” with a place (here / there / at home)', () => {
  test('a place adverb is the location, “is” left out as the source does', () => {
    expect(T('He is here').text).toBe('Ü insun');
    expect(T('The book is here').text).toBe('Kitov insun');
    expect(T('He is not here').text).toBe('Ü insun nest');
    expect(T('He is here').tier).toBe('high');
  });
  test('“I am / you are” + place has no printed example, so it is flagged, not high', () => {
    const r = T('I am here');
    expect(r.text).toBe('Man insun');
    expect(r.steps.some((s) => s.weak)).toBe(true);
    expect(r.tier).toBe('medium');
  });
  test('the past of “to be” is never dropped', () => {      // used to give the present: "Ü ba xona"
    expect(T('He was at home').text).toBe('Ü ba xona budak');
    expect(T('I was not at home').text).toBe('Man ba xona nabudam');
    expect(T('They were in Israel').text).toBe('Inho ba Isroel budand');
    expect(T('He was a doctor').text).toBe('Ü düxtur budak');
  });
  test('question word comes before the past of “to be”', () => {
    expect(T('Where was the book?').text).toBe('Kitov kujo budak?');
    expect(T('Where is my book?').text).toBe('Kitovam kujo?');
  });
});

describe('two clauses joined the way the source joins them', () => {
  test.each([
    ['I know that he came', 'Man medonam, ki ü omadak'],
    ['He said that he is sick', 'Ü guftak, ki ü kasal'],
    ['He came because he is sick', 'Ü omadak, azbaski ü kasal'],
    ['I did not go because I was sick', 'Man naraftam, azbaski man kasal budam'],
    ['If he comes, I will go', 'Agar ü mebiyo, man merum'],
    ['When I came home, he was reading', 'Kay-ki man ba xona omadam, ü xonsoda bud'],
  ])('%s → %s', (en, bux) => {
    const r = T(en);
    expect(r.text).toBe(bux);
    expect(r.joined).toBe(true);
    expect(r.steps[0]?.rows?.length).toBeGreaterThan(0);
  });
  test('“that” is the conjunction ki, not the pronoun vay', () => {      // used to give "Ü vay kasali üya guftak"
    expect(T('I am glad that you came').variants.map((v) => v.text)).toEqual(['Man xursandam, ki tu omadi', 'Man xursandam, ki shumo omaded']);
  });
  test('“if” is flagged: the source prints two verb shapes after agar and no rule', () => {
    const r = T('If you go, I go');
    expect(r.variants[0]?.text).toBe('Agar tu meri, man merum');
    expect(r.steps.some((s) => s.weak)).toBe(true);
    expect(r.tier).toBe('medium');
  });
  test('a clause that cannot be built is named, and nothing is scrambled together', () => {
    const r = T('If you zorble, I go');
    expect(r.status).toBe('none');
    expect(r.notes[0]).toMatch(/“you zorble” could not be built/);
    expect(r.unknown).toEqual(['zorble']);
  });
  test('relative clauses are declined, not guessed', () => {              // used to give "Ki mard padarama omadak"
    const r = T('The man who came is my father');
    expect(r.status).toBe('none');
    expect(r.notes[0]).toMatch(/relative clause/);
  });
  test('questions and single clauses are untouched', () => {
    expect(T('Who came?').text).toBe('Ki omad?');
    expect(T('When did you come?').status).toBe('exact');
  });
  test('“went home” is a goal', () => {
    expect(T('I go home').text).toBe('Man ba xona merum');
    expect(T('my home').text).toBe('xonim');
  });
  test('a printed sentence is found with or without its contraction', () => {
    expect(T('I am glad')).toMatchObject({ status: 'exact', text: 'Man xursandam' });
  });
});

describe('address labels on single words', () => {
  test('“you (polite)” and “you (pl.)” give the source’s polite/plural pronoun', () => {      // used to give Tu for all three
    expect(T('you (polite)').text).toBe('Shumo');
    expect(T('you (pl.)').text).toBe('Shumo');
    expect(T('you (sing.)').text).toBe('Tu');
    expect(T('you').text).toBe('Tu');
  });
});

describe('patterns the source prints (found by checking a Tajik-based draft against the book)', () => {
  test('a postposition follows the bare noun or pronoun, with no ezafe', () => {      // used to give "tuyi qati"
    expect(T('with you').variants.map((v) => v.text)).toEqual(['tu qati', 'shumo qati']);
    expect(T('with me').text).toBe('man qati');
    expect(T('with my brother').text).toBe('barodaram qati');
  });
  test('“never” is hej + a negative verb, not just “not”', () => {                     // used to give "Ü namebiyo"
    expect(T('He never comes').text).toBe('Ü hej namebiyo');
    expect(T('I never go').text).toBe('Man hej namerum');
    expect(T('He never comes').steps.some((s) => /Hej gham nabined/.test(s.text))).toBe(true);
  });
  test('time expressions take the forms the source prints', () => {
    expect(T('on Saturday').text).toBe('rüzi shabot');                                  // not "shaboti boli"
    expect(T('We eat on Saturday').text).toBe('Mo rüzi shabot mexurem');
    expect(T('I will come in two days').text).toBe("Man ba'di du rüz mebiyom");         // not "ba duta rüz"
    expect(T('I have lived here for ten years').text).toMatch(/^Man dah sol insun/);    // no "baroyi"
    expect(T('in the house').text).toBe('ba xona');                                     // ordinary phrases unchanged
    expect(T('in the evening').text).toBe('Namozigar');                                 // the printed word, not ba + shav
    expect(T('at night').status).toBe('none');                                          // used to give "shavi ba"
  });
  test('English-only constructions are declined with a reason, not calqued', () => {
    for (const s of ['There is a book on the table', 'Is there water?', 'What time is it?', 'How long?', 'What a beautiful day!', 'How good!']) {
      const r = T(s);
      expect(r.status, s).toBe('none');
      expect(r.notes[0], s).toMatch(/prints no pattern/);
    }
    expect(T('How old are you?').status).toBe('exact');      // printed sentences still win
    expect(T('How are you?').status).toBe('exact');
    expect(T('What is this?').text).toBe('In chi?');
  });
  test('the pronoun ü is lower-case inside a sentence', () => {
    expect(T('I see him').text).toBe('Man üya mebinam');
    expect(T('I went with him').text).toBe('Man ü qati raftam');
  });
  test('where the book and the draft disagree, the book stands', () => {
    expect(T('I want to go').text).toBe('Man raftani hastam');      // book: "Man guftani hastam" = I want to say
    expect(T('He went').text).toMatch(/raftak$/);                   // book: -ak is the Regular 3sg past
  });
});
