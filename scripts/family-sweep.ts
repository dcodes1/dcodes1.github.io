/*
 * Family-event sentence sweep. Builds a few thousand everyday sentences of the kind said
 * at a family gathering (who came, who is eating what, greetings, questions, requests)
 * from the vocabulary the translator has, translates each one, and checks that the
 * GRAMMAR of the answer holds:
 *
 *   verb-last     the conjugated verb is the last word (the book's word order)
 *   agreement     the verb's ending is the subject's person and number
 *   tense         the verb is in the tense the English asked for
 *   negation      na- is there exactly when the English is negative
 *   round-trip    Buxori → English gives back the same content words
 *   labelling     an answer resting on the fallback is flagged and low; a book answer is not
 *   stable        the same input gives the same answer twice
 *
 * These are checks of internal consistency against the book's own rules. They cannot say
 * a sentence is what a speaker would say: only a speaker can. So the sweep also writes
 * the answered sentences to translator/data/linguist/11-family-event-sentences.tsv for a
 * speaker to mark, and lists the family-event words the book lacks.
 *
 *   node scripts/family-sweep.ts            write eval/family-report.json and the worksheet
 *   node scripts/family-sweep.ts --check    also fail if grammar failures exceed eval/family-baseline.json
 *   node scripts/family-sweep.ts --seed 7   a different sample of the same frames (default 1)
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Engine } from '../src/engine/engine.ts';
import { IRREGULAR_VERBS } from '../src/engine/english.ts';
import { pluralOf } from '../src/engine/english-gen.ts';
import { ReverseEngine } from '../src/engine/reverse.ts';
import { withDraft } from '../src/lib/draft.ts';
import { createLookup } from '../src/lib/lookup.ts';
import type { BuxoriIndex, DraftOverlay, PersonNumber, Tense } from '../src/lib/types.ts';

const ROOT = resolve(import.meta.dirname, '..');
const book = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as BuxoriIndex;
const overlay = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-draft.json'), 'utf8')) as DraftOverlay;
const merged = withDraft(book, overlay);
const engine = new Engine(merged, book);
const bookEngine = new Engine(book);
const reverse = new ReverseEngine(merged, createLookup(merged), engine.morph, { index: book, lookup: createLookup(book) });

const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const SEED = Number(arg('--seed') ?? 1);
const LIMIT = Number(arg('--limit') ?? 2500);

// ── vocabulary: family-event words. Each is used only if the translator has it. ──
const KIN = ['mother', 'father', 'brother', 'sister', 'older brother', 'younger sister', 'grandmother', 'grandfather', 'uncle', 'aunt', 'son', 'daughter', 'wife', 'husband', 'child', 'guest', 'bride', 'groom', 'friend', 'neighbor', 'baby', 'rabbi', 'teacher'];
const THINGS = ['bread', 'tea', 'wine', 'water', 'meat', 'rice', 'soup', 'fruit', 'apple', 'cake', 'food', 'gift', 'candle', 'song', 'book', 'letter'];
const PLACES = ['house', 'home', 'synagogue', 'wedding', 'party', 'market', 'garden', 'kitchen', 'table'];
const ADJ = ['happy', 'good', 'beautiful', 'big', 'small', 'old', 'young', 'new', 'sweet', 'healthy', 'hungry', 'tired', 'tasty'];
interface Verb { base: string; past: string; third: string; ing: string; object?: 'thing' | 'kin' }
const VERBS: Verb[] = [
  { base: 'come', past: 'came', third: 'comes', ing: 'coming' }, { base: 'go', past: 'went', third: 'goes', ing: 'going' },
  { base: 'sit', past: 'sat', third: 'sits', ing: 'sitting' }, { base: 'dance', past: 'danced', third: 'dances', ing: 'dancing' },
  { base: 'sing', past: 'sang', third: 'sings', ing: 'singing' }, { base: 'laugh', past: 'laughed', third: 'laughs', ing: 'laughing' },
  { base: 'cry', past: 'cried', third: 'cries', ing: 'crying' }, { base: 'arrive', past: 'arrived', third: 'arrives', ing: 'arriving' },
  { base: 'eat', past: 'ate', third: 'eats', ing: 'eating', object: 'thing' }, { base: 'drink', past: 'drank', third: 'drinks', ing: 'drinking', object: 'thing' },
  { base: 'bring', past: 'brought', third: 'brings', ing: 'bringing', object: 'thing' }, { base: 'buy', past: 'bought', third: 'buys', ing: 'buying', object: 'thing' },
  { base: 'cook', past: 'cooked', third: 'cooks', ing: 'cooking', object: 'thing' }, { base: 'take', past: 'took', third: 'takes', ing: 'taking', object: 'thing' },
  { base: 'see', past: 'saw', third: 'sees', ing: 'seeing', object: 'kin' }, { base: 'love', past: 'loved', third: 'loves', ing: 'loving', object: 'kin' },
  { base: 'invite', past: 'invited', third: 'invites', ing: 'inviting', object: 'kin' }, { base: 'kiss', past: 'kissed', third: 'kisses', ing: 'kissing', object: 'kin' },
  { base: 'help', past: 'helped', third: 'helps', ing: 'helping', object: 'kin' }, { base: 'meet', past: 'met', third: 'meets', ing: 'meeting', object: 'kin' },
];
const has = (gloss: string, e = engine) => { const r = e.translate(gloss); return r.status === 'exact' && !!r.text; };
const hasVerb = (v: Verb) => has(`to ${v.base}`) || has(v.base);
const missing = { book: [] as string[], everywhere: [] as string[] };
const keep = <T,>(list: T[], gloss: (x: T) => string, known: (x: T) => boolean) => list.filter((x) => {
  if (!has(gloss(x), bookEngine) && !bookEngine.translate(`to ${gloss(x)}`).text) missing.book.push(gloss(x));
  if (known(x)) return true;
  missing.everywhere.push(gloss(x)); return false;
});
const kin = keep(KIN, (x) => x, (x) => has(x)), things = keep(THINGS, (x) => x, (x) => has(x)), places = keep(PLACES, (x) => x, (x) => has(x));
const adjs = keep(ADJ, (x) => x, (x) => has(x)), verbs = keep(VERBS, (v) => v.base, hasVerb);

// ── sentence frames ──
interface Case { en: string; frame: string; pn?: PersonNumber; tense?: Tense; negative?: boolean; verb?: boolean; content: string[] }
type Subj = { en: string; pn: PersonNumber; third: boolean; plural: boolean; content: string[] };
const PRON: Subj[] = [
  { en: 'I', pn: '1sg', third: false, plural: false, content: [] }, { en: 'you', pn: '2sg', third: false, plural: false, content: [] },
  { en: 'he', pn: '3sg', third: true, plural: false, content: [] }, { en: 'she', pn: '3sg', third: true, plural: false, content: [] },
  { en: 'we', pn: '1pl', third: false, plural: true, content: [] }, { en: 'they', pn: '3pl', third: false, plural: true, content: [] },
];
const nounSubj = (k: string, poss: string): Subj => ({ en: `${poss} ${k}`, pn: '3sg', third: true, plural: false, content: [k] });
const subjects: Subj[] = [...PRON, ...kin.flatMap((k) => [nounSubj(k, 'my'), nounSubj(k, 'our'), nounSubj(k, 'the')])];
const be = (s: Subj, past: boolean) => (past ? (s.pn === '1sg' || s.third ? 'was' : 'were') : s.pn === '1sg' ? 'am' : s.third ? 'is' : 'are');
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const cases: Case[] = [];
for (const s of subjects) for (const v of verbs) {
  const objs = v.object === 'thing' ? things : v.object === 'kin' ? kin.filter((k) => !s.content.includes(k)) : [''];
  for (const o of objs) {
    const obj = o ? (v.object === 'kin' ? ` my ${o}` : ` ${o}`) : '';
    const content = [...s.content, v.base, ...(o ? [o] : [])];
    const add = (en: string, tense: Tense, negative: boolean, frame: string) => cases.push({ en: `${cap(en)}.`, frame, pn: s.pn, tense, negative, verb: true, content });
    add(`${s.en} ${s.third ? v.third : v.base}${obj}`, 'present', false, 'present');
    add(`${s.en} ${v.past}${obj}`, 'simple_past', false, 'past');
    add(`${s.en} will ${v.base}${obj}`, 'future', false, 'future');
    add(`${s.en} ${be(s, false)} ${v.ing}${obj}`, 'present_continuous', false, 'present continuous');
    add(`${s.en} ${s.third ? 'does' : 'do'} not ${v.base}${obj}`, 'present', true, 'present, negative');
    add(`${s.en} did not ${v.base}${obj}`, 'simple_past', true, 'past, negative');
  }
}
for (const s of subjects) {
  for (const a of adjs) {
    cases.push({ en: `${cap(s.en)} ${be(s, false)} ${a}.`, frame: 'is + adjective', content: [...s.content, a] });
    cases.push({ en: `${cap(s.en)} ${be(s, true)} ${a}.`, frame: 'was + adjective', content: [...s.content, a] });
    cases.push({ en: `${cap(s.en)} ${be(s, false)} not ${a}.`, frame: 'is not + adjective', content: [...s.content, a] });
  }
  for (const p of places) cases.push({ en: `${cap(s.en)} ${be(s, false)} at the ${p}.`, frame: 'is at a place', content: [...s.content, p] });
  cases.push({ en: `${cap(s.en)} ${be(s, false)} here.`, frame: 'is here', content: s.content });
}
for (const k of kin) {
  for (const p of ['my', 'your', 'his', 'her', 'our', 'their']) cases.push({ en: `${p} ${k}`, frame: 'possessive', content: [k] });
  for (const n of ['two', 'three', 'five']) cases.push({ en: `I have ${n} ${pluralOf(k)}.`, frame: 'have + number', content: [k] });
  cases.push({ en: `Where is your ${k}?`, frame: 'question: where', content: [k] });
  cases.push({ en: `This is my ${k}.`, frame: 'this is', content: [k] });
  cases.push({ en: `Who is your ${k}?`, frame: 'question: who', content: [k] });
  for (const a of adjs.slice(0, 5)) cases.push({ en: `my ${a} ${k}`, frame: 'adjective + noun', content: [a, k] });
  for (const t of things.slice(0, 6)) cases.push({ en: `Give my ${k} ${t}.`, frame: 'request', content: [k, t] });
}
for (const v of verbs) {
  cases.push({ en: `${cap(v.base)}!`, frame: 'imperative', content: [v.base] });
  cases.push({ en: `Do not ${v.base}!`, frame: 'imperative, negative', content: [v.base] });
  cases.push({ en: `Who ${v.past}?`, frame: 'question: who + verb', content: [v.base] });
  for (const s of PRON) cases.push({ en: `When did ${s.en} ${v.base}?`, frame: 'question: when', content: [v.base] });
}
for (const t of things) for (const a of adjs.slice(0, 6)) cases.push({ en: `The ${t} is ${a}.`, frame: 'is + adjective', content: [t, a] });
const FIXED = ['Good morning', 'Good evening', 'How are you?', 'Thank you', 'Welcome!', 'Congratulations!', 'Happy holiday!', 'What is your name?', 'Where are you from?', 'How old are you?',
  'Please sit down.', 'Come here!', 'Come in!', 'Good night', 'Goodbye', 'I am hungry.', 'Let us eat.', 'To your health!', 'Good Saturday', 'How is your family?'];
for (const f of FIXED) cases.push({ en: f, frame: 'greeting or fixed phrase', content: [] });

// A fixed, seeded sample across frames, so each run with the same seed checks the same sentences.
let state = SEED * 2654435761 % 4294967296;
const rnd = () => { state = (state * 1664525 + 1013904223) % 4294967296; return state / 4294967296; };
const byFrame = new Map<string, Case[]>();
for (const c of cases) (byFrame.get(c.frame) ?? byFrame.set(c.frame, []).get(c.frame)!).push(c);
const perFrame = Math.ceil(LIMIT / byFrame.size);
const sample: Case[] = [];
for (const list of byFrame.values()) {
  const pool = [...list];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [pool[i], pool[j]] = [pool[j]!, pool[i]!]; }
  sample.push(...pool.slice(0, perFrame));
}

// ── checks ──
const SAME_TENSE: Record<string, Tense[]> = { present: ['present', 'future'], future: ['present', 'future'], simple_past: ['simple_past'], present_continuous: ['present_continuous'] };
const PN_OK: Record<string, PersonNumber[]> = { '2sg': ['2sg', '2pol', '2pl'], '3sg': ['3sg', '3resp'], '3pl': ['3pl'], '1sg': ['1sg'], '1pl': ['1pl'] };
const words = (s: string) => s.toLowerCase().replace(/[^a-z' ]+/g, ' ').split(/\s+/).filter(Boolean);
const BASE_OF = new Map<string, string>(Object.entries(IRREGULAR_VERBS).flatMap(([b, [past, part]]): [string, string][] => [[past, b], [part, b]]));
const stem = (w: string) => (BASE_OF.get(w) ?? w).replace(/(ing|ed|ies|es|s|y)$/, '').slice(0, 4);
interface Failure { en: string; bux: string; frame: string; tier: string; check: string; detail: string }
const failures: Failure[] = [];
const stats: Record<string, { n: number; answered: number; high: number; medium: number; low: number; fallback: number; failed: number }> = {};
const unanswered: Record<string, number> = {};
const worksheet: string[][] = [];
let roundTripExact = 0, roundTripContent = 0, roundTripTried = 0;

for (const c of sample) {
  const st = (stats[c.frame] ??= { n: 0, answered: 0, high: 0, medium: 0, low: 0, fallback: 0, failed: 0 });
  st.n++;
  const r = engine.translate(c.en);
  if (!r.text || r.status === 'none') { for (const w of r.unknown.length ? r.unknown : ['(could not be built)']) unanswered[w] = (unanswered[w] ?? 0) + 1; continue; }
  st.answered++;
  if (r.draft) st.fallback++;
  st[r.tier === 'high' ? 'high' : r.tier === 'medium' ? 'medium' : 'low']++;
  const before = failures.length;
  const fail = (check: string, detail: string) => failures.push({ en: c.en, bux: r.text!, frame: c.frame, tier: r.tier ?? 'none', check, detail });

  if (engine.translate(c.en).text !== r.text) fail('stable', 'a second call gave a different answer');
  if (r.draft && r.tier !== 'low') fail('labelling', `a fallback answer at tier ${r.tier}`);
  if (!r.draft && bookEngine.translate(c.en).text !== r.text) fail('labelling', 'differs from the book-only answer but is not flagged');

  const back = reverse.translate(r.text);
  if (c.verb && r.status === 'grammar') {
    const toks = back.tokens;
    const last = toks[toks.length - 1];
    const lastVerb = last?.readings[last.chosen]?.f.verb ?? last?.readings.find((x) => x.f.verb)?.f.verb;
    const anyVerb = toks.map((t) => t.readings[t.chosen]?.f.verb ?? t.readings.find((x) => x.f.verb)?.f.verb).filter(Boolean);
    if (!lastVerb) fail('verb-last', anyVerb.length ? 'the conjugated verb is not the last word' : 'no conjugated verb recognised in the answer');
    const v = lastVerb ?? anyVerb[anyVerb.length - 1];
    if (v) {
      const last2 = last?.readings.map((x) => x.f.verb).filter((x): x is NonNullable<typeof x> => !!x) ?? [v];
      const some = (ok: (x: NonNullable<typeof v>) => boolean) => (lastVerb ? last2.some(ok) : ok(v));
      if (c.pn && !some((x) => (PN_OK[c.pn!] ?? [c.pn!]).includes(x.pn))) fail('agreement', `subject is ${c.pn}, verb is ${v.pn}`);
      if (c.tense && !some((x) => (SAME_TENSE[c.tense!] ?? [c.tense!]).includes(x.tense) || (c.tense === 'future' && !!x.alsoFuture))) fail('tense', `asked for ${c.tense}, verb is ${v.tense}`);
      if (c.negative !== undefined && !some((x) => x.negative === c.negative)) fail('negation', c.negative ? 'the English is negative, the verb is not' : 'the verb is negative, the English is not');
    }
  }
  if (back.english && c.content.length) {
    roundTripTried++;
    // One Buxori word can stand for several English ones (zan: woman, wife; xondan: read, sing).
    // The content is kept if the English word is the rendering or any sense of the entry that was read.
    const got = [...words(back.english), ...back.tokens.flatMap((t) => t.readings.flatMap((x) => x.glosses.flatMap(words)))].map(stem);
    const want = c.content.flatMap((w) => words(w)).map(stem);
    const lostWords = want.filter((w) => !got.includes(w));
    if (words(back.english).join(' ') === words(c.en).join(' ')) roundTripExact++;
    if (!lostWords.length) roundTripContent++;
    else if (r.tier === 'high') fail('round-trip', `read back as “${back.english}”`);
  }
  if (failures.length > before) st.failed++;
  worksheet.push([c.frame, c.en, r.text, r.draft ? 'fallback' : r.tier ?? '', failures.length > before ? failures.slice(before).map((f) => f.check).join(', ') : '', '', '']);
}

// ── report ──
const byCheck: Record<string, number> = {};
for (const f of failures) byCheck[f.check] = (byCheck[f.check] ?? 0) + 1;
const tot = Object.values(stats).reduce((a, s) => ({ n: a.n + s.n, answered: a.answered + s.answered, high: a.high + s.high, medium: a.medium + s.medium, low: a.low + s.low, fallback: a.fallback + s.fallback, failed: a.failed + s.failed }));
const sorted = <T,>(o: Record<string, T>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b)));
const report = {
  what: 'Family-event sentences built from the translator’s vocabulary, translated English → Buxori and checked for grammar consistency. Not a measure of what a speaker would say.',
  seed: SEED, sentences: tot.n, answered: tot.answered, tiers: { high: tot.high, medium: tot.medium, low: tot.low }, usedFallback: tot.fallback,
  sentencesWithAGrammarFailure: tot.failed, failuresByCheck: sorted(byCheck),
  roundTrip: { tried: roundTripTried, sameContentWords: roundTripContent, identicalEnglish: roundTripExact },
  byFrame: sorted(stats),
  familyWordsTheBookLacks: [...new Set(missing.book)].sort(), familyWordsNoSourceHas: [...new Set(missing.everywhere)].sort(),
  mostCommonReasonsForNoAnswer: Object.fromEntries(Object.entries(unanswered).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 25)),
  failures: failures.slice(0, 400),
};
console.log(`${tot.n} sentences, ${tot.answered} answered (high ${tot.high}, medium ${tot.medium}, low ${tot.low}; ${tot.fallback} used the fallback)`);
console.log(`grammar failures: ${tot.failed} sentences`, JSON.stringify(report.failuresByCheck));
console.log(`round trip: ${roundTripContent}/${roundTripTried} keep their content words, ${roundTripExact} identical`);
console.log(`family words the book lacks: ${report.familyWordsTheBookLacks.join(', ')}`);

const BASE = resolve(ROOT, 'eval/family-baseline.json');
if (SEED === 1 && !arg('--limit')) {
  writeFileSync(resolve(ROOT, 'eval/family-report.json'), JSON.stringify(report, null, 2) + '\n');
  const head = ['frame', 'english', 'translator_output', 'tier', 'failed_checks', 'correct? (y/n)', 'correct_buxori'];
  writeFileSync(resolve(ROOT, 'translator/data/linguist/11-family-event-sentences.tsv'), [head, ...worksheet].map((r) => r.join('\t')).join('\n') + '\n');
}
if (process.argv.includes('--check')) {
  const base = existsSync(BASE) ? (JSON.parse(readFileSync(BASE, 'utf8')) as { maxSentencesWithAGrammarFailure: number; minAnswered: number }) : null;
  if (!base) { console.error('eval/family-baseline.json is missing.'); process.exit(1); }
  if (SEED === 1 && (tot.failed > base.maxSentencesWithAGrammarFailure || tot.answered < base.minAnswered)) {
    console.error(`Regression: ${tot.failed} failing sentences (allowed ${base.maxSentencesWithAGrammarFailure}), ${tot.answered} answered (required ${base.minAnswered}).`);
    process.exit(1);
  }
  console.log('family sweep: within the baseline.');
}
