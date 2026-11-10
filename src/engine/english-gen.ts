/*
 * English generation for Buxori → English: verb forms, plurals, articles. Everything
 * here is knowledge about ENGLISH; no Buxori appears in this file.
 */
import type { PersonNumber, Tense } from '../lib/types.ts';
import { IRREGULAR_PLURALS, IRREGULAR_VERBS } from './english.ts';

const doubles = (b: string) => /^[^aeiou]*[aeiou][bdgmnprt]$/.test(b);
export function pastOf(b: string): string {
  if (b === 'be') return 'was';
  const irr = IRREGULAR_VERBS[b];
  if (irr) return irr[0];
  return /e$/.test(b) ? b + 'd' : /[^aeiou]y$/.test(b) ? b.slice(0, -1) + 'ied' : doubles(b) ? b + b.slice(-1) + 'ed' : b + 'ed';
}
export function participleOf(b: string): string {
  if (b === 'be') return 'been';
  return IRREGULAR_VERBS[b]?.[1] ?? pastOf(b);
}
export function ingOf(b: string): string {
  if (b === 'be') return 'being';
  return /ie$/.test(b) ? b.slice(0, -2) + 'ying' : /[^e]e$/.test(b) ? b.slice(0, -1) + 'ing' : doubles(b) ? b + b.slice(-1) + 'ing' : b + 'ing';
}
export function thirdOf(b: string): string {
  if (b === 'have') return 'has';
  return /(s|sh|ch|x|z|o)$/.test(b) ? b + 'es' : /[^aeiou]y$/.test(b) ? b.slice(0, -1) + 'ies' : b + 's';
}
export function pluralOf(noun: string): string {
  const words = noun.split(' ');
  const w = words.pop() ?? '';
  const irr = Object.entries(IRREGULAR_PLURALS).find(([pl, sg]) => sg === w && pl !== 'brethren')?.[0];
  const pl = irr ?? (/(s|sh|ch|x|z)$/.test(w) ? w + 'es' : /[^aeiou]y$/.test(w) ? w.slice(0, -1) + 'ies' : w + 's');
  return [...words, pl].join(' ');
}
export const articleFor = (next: string) => (/^[aeiou]/i.test(next) && !/^(uni|use|one|eu)/i.test(next) ? 'an' : 'a');

/** Nouns that take no "a" in the singular (enough for a learner's rendering; not a full list). */
export const MASS = new Set(['bread', 'water', 'tea', 'money', 'rice', 'meat', 'milk', 'sugar', 'salt', 'time', 'work', 'food', 'wine',
  'oil', 'butter', 'cheese', 'fruit', 'music', 'love', 'luck', 'news', 'rain', 'snow', 'coffee', 'soup', 'flour', 'honey', 'health',
  'happiness', 'peace', 'air', 'gold', 'silver', 'pilaf', 'vodka', 'beer', 'juice', 'fish', 'paper', 'wood', 'grass', 'hair', 'help']);

const SUBJECT: Record<PersonNumber, string> = { '1sg': 'I', '2sg': 'you', '2pol': 'you', '3sg': 'he/she', '3resp': 'he/she', '1pl': 'we', '2pl': 'you', '3pl': 'they' };
export const subjectPronoun = (pn: PersonNumber) => SUBJECT[pn];
export const POSSESSIVE: Record<PersonNumber, string> = { '1sg': 'my', '2sg': 'your', '2pol': 'your', '3sg': 'his/her', '3resp': 'his/her', '1pl': 'our', '2pl': 'your', '3pl': 'their' };
export const OBJECT_FORM: Record<string, string> = { i: 'me', 'he/she': 'him/her', he: 'him', she: 'her', we: 'us', they: 'them', you: 'you' };

const be = (pn: PersonNumber, past: boolean) =>
  past ? (pn === '1sg' || pn === '3sg' || pn === '3resp' ? 'was' : 'were') : pn === '1sg' ? 'am' : pn === '3sg' || pn === '3resp' ? 'is' : 'are';
export const beForm = be;

export interface VerbPhrase { aux: string | null; not: boolean; main: string; note?: string }

/**
 * English verb phrase for a Buxori tense. `base` is the gloss without "to" ("go",
 * "get tired"); only its first word is inflected. Returned in parts so questions
 * can put the auxiliary before the subject.
 */
export function verbPhrase(base: string, tense: Tense, pn: PersonNumber, negative: boolean): VerbPhrase {
  const [head = '', ...rest] = base.split(' ');
  const tail = rest.length ? ' ' + rest.join(' ') : '';
  const third = pn === '3sg' || pn === '3resp';
  const isBe = head === 'be';
  const m = (form: string) => form + tail;
  switch (tense) {
    case 'present': case 'future':
      if (isBe) return { aux: be(pn, false), not: negative, main: tail.trim() };
      return negative ? { aux: third ? 'does' : 'do', not: true, main: m(head) } : { aux: null, not: false, main: m(third ? thirdOf(head) : head) };
    case 'simple_past':
      if (isBe) return { aux: be(pn, true), not: negative, main: tail.trim() };
      return negative ? { aux: 'did', not: true, main: m(head) } : { aux: null, not: false, main: m(pastOf(head)) };
    case 'descriptive_past':
      return negative ? { aux: 'did', not: true, main: 'use to ' + m(head) } : { aux: null, not: false, main: 'used to ' + m(head) };
    case 'present_continuous': return { aux: be(pn, false), not: negative, main: m(ingOf(head)) };
    case 'past_continuous': return { aux: be(pn, true), not: negative, main: m(ingOf(head)) };
    case 'present_perfect': return { aux: third ? 'has' : 'have', not: negative, main: m(participleOf(head)) };
    case 'past_perfect': return { aux: 'had', not: negative, main: m(participleOf(head)) };
    case 'imperative': return negative ? { aux: 'do', not: true, main: m(head) } : { aux: null, not: false, main: m(head) };
    default: return { aux: null, not: negative, main: m(head), note: `tense “${tense.replace(/_/g, ' ')}” has no simple English form here` };
  }
}

/** Statement order: aux (+ not) + main. */
export const vpText = (v: VerbPhrase) => [v.aux, v.not ? 'not' : null, v.main].filter(Boolean).join(' ');

/** do-support for a question about a simple present/past verb: "goes" → { aux: "does", main: "go" }. */
export function withDoSupport(base: string, tense: Tense, pn: PersonNumber): { aux: string; main: string } {
  const third = pn === '3sg' || pn === '3resp';
  return { aux: tense === 'simple_past' || tense === 'descriptive_past' ? 'did' : third ? 'does' : 'do', main: tense === 'descriptive_past' ? 'use to ' + base : base };
}

/** Common English adjectives: the source tags few of its words as adjectives, so the gloss decides. */
export const ADJECTIVES = new Set(('good bad big small large little long short tall high low hot cold warm cool new old young beautiful pretty ugly '
  + 'happy sad glad merry angry tired hungry thirsty sick ill healthy rich poor cheap expensive easy hard difficult simple heavy light dark bright '
  + 'clean dirty wet dry full empty open closed fast slow quick early late near far right wrong true false sweet sour bitter salty tasty delicious '
  + 'fresh strong weak thick thin fat wide narrow deep soft loud quiet busy free ready sure sorry afraid alone alive dead married single clever smart '
  + 'wise stupid foolish kind nice fine great bad-tempered polite impolite rude honest lazy brave shy proud calm nervous funny serious important '
  + 'interesting boring famous dear lovely sharp blunt round straight red blue green yellow black white brown grey gray pink orange golden '
  + 'religious jewish pure holy bald blind deaf dumb mute lame stubborn greedy generous noble native foreign own same different other last next '
  + 'first second third main whole half ripe raw boiled fried sleepy sleepless fearful mischievous talkative all right well okay').split(' '));

const ORDINALS = ['zeroth', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
/** 5 → "fifth", 23 → "23rd". */
export function ordinalOf(n: number): string {
  if (ORDINALS[n]) return ORDINALS[n]!;
  const t = n % 100, u = n % 10;
  return `${n}${t >= 11 && t <= 13 ? 'th' : u === 1 ? 'st' : u === 2 ? 'nd' : u === 3 ? 'rd' : 'th'}`;
}
