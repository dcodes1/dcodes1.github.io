/*
 * English-side analysis. Everything here is knowledge about ENGLISH (irregular
 * verbs, plurals, pronouns, auxiliaries). No Buxori word appears in this file:
 * every Buxori form comes from the compiled index.
 */
import type { PersonNumber } from '../lib/types.ts';

const IRREGULAR_VERBS: Record<string, [past: string, participle: string]> = {
  be: ['was', 'been'], have: ['had', 'had'], do: ['did', 'done'], go: ['went', 'gone'], come: ['came', 'come'],
  eat: ['ate', 'eaten'], drink: ['drank', 'drunk'], see: ['saw', 'seen'], give: ['gave', 'given'], take: ['took', 'taken'],
  say: ['said', 'said'], make: ['made', 'made'], know: ['knew', 'known'], buy: ['bought', 'bought'], sell: ['sold', 'sold'],
  speak: ['spoke', 'spoken'], write: ['wrote', 'written'], read: ['read', 'read'], sleep: ['slept', 'slept'],
  sit: ['sat', 'sat'], stand: ['stood', 'stood'], get: ['got', 'gotten'], find: ['found', 'found'], think: ['thought', 'thought'],
  bring: ['brought', 'brought'], teach: ['taught', 'taught'], learn: ['learnt', 'learnt'], tell: ['told', 'told'],
  become: ['became', 'become'], begin: ['began', 'begun'], run: ['ran', 'run'], fly: ['flew', 'flown'], fall: ['fell', 'fallen'],
  forget: ['forgot', 'forgotten'], understand: ['understood', 'understood'], hear: ['heard', 'heard'], leave: ['left', 'left'],
  meet: ['met', 'met'], pay: ['paid', 'paid'], put: ['put', 'put'], send: ['sent', 'sent'], spend: ['spent', 'spent'],
  build: ['built', 'built'], wear: ['wore', 'worn'], win: ['won', 'won'], lose: ['lost', 'lost'], feel: ['felt', 'felt'],
  keep: ['kept', 'kept'], hold: ['held', 'held'], sing: ['sang', 'sung'], swim: ['swam', 'swum'], cut: ['cut', 'cut'],
  let: ['let', 'let'], lie: ['lay', 'lain'], ride: ['rode', 'ridden'], rise: ['rose', 'risen'], shut: ['shut', 'shut'],
  steal: ['stole', 'stolen'], throw: ['threw', 'thrown'], wake: ['woke', 'woken'], bear: ['bore', 'born'],
  break: ['broke', 'broken'], choose: ['chose', 'chosen'], draw: ['drew', 'drawn'], drive: ['drove', 'driven'],
  grow: ['grew', 'grown'], hide: ['hid', 'hidden'], lend: ['lent', 'lent'], light: ['lit', 'lit'], mean: ['meant', 'meant'],
  shoot: ['shot', 'shot'], show: ['showed', 'shown'], sew: ['sewed', 'sewn'], bite: ['bit', 'bitten'], dig: ['dug', 'dug'],
  feed: ['fed', 'fed'], fight: ['fought', 'fought'], hang: ['hung', 'hung'], lead: ['led', 'led'], ring: ['rang', 'rung'],
  shake: ['shook', 'shaken'], sweep: ['swept', 'swept'], catch: ['caught', 'caught'], cost: ['cost', 'cost'], dream: ['dreamt', 'dreamt'],
};
const IRREGULAR_FORMS = new Map<string, { lemma: string; form: 'past' | 'participle' | 'present3' | 'present' }>();
for (const [lemma, [past, part]] of Object.entries(IRREGULAR_VERBS)) {
  IRREGULAR_FORMS.set(past, { lemma, form: 'past' });
  if (!IRREGULAR_FORMS.has(part) || part !== past) IRREGULAR_FORMS.set(part, { lemma, form: past === part ? 'past' : 'participle' });
}
for (const [w, lemma] of [['am', 'be'], ['is', 'be'], ['are', 'be'], ['were', 'be'], ['has', 'have'], ['does', 'do'], ['goes', 'go']] as const) {
  IRREGULAR_FORMS.set(w, { lemma, form: w === 'were' ? 'past' : 'present3' });
}

const IRREGULAR_PLURALS: Record<string, string> = {
  children: 'child', men: 'man', women: 'woman', people: 'person', feet: 'foot', teeth: 'tooth', mice: 'mouse',
  geese: 'goose', wives: 'wife', knives: 'knife', leaves: 'leaf', loaves: 'loaf', halves: 'half', wolves: 'wolf',
  sheep: 'sheep', fish: 'fish', oxen: 'ox', brethren: 'brother', grandchildren: 'grandchild', thieves: 'thief',
};

export interface VerbCandidate { lemma: string; form: 'base' | 'present3' | 'past' | 'participle' | 'ing' }

/** All plausible lemmas for an English verb form; the caller keeps the ones its lexicon knows. */
export function verbCandidates(w: string): VerbCandidate[] {
  const out: VerbCandidate[] = [];
  const irr = IRREGULAR_FORMS.get(w);
  if (irr) {
    out.push({ lemma: irr.lemma, form: irr.form === 'present' ? 'base' : irr.form });
    // "said", "made", "bought": past and participle are the same word
    const forms = IRREGULAR_VERBS[irr.lemma];
    if (irr.form === 'past' && forms && forms[0] === forms[1]) out.push({ lemma: irr.lemma, form: 'participle' });
  }
  out.push({ lemma: w, form: 'base' });
  if (/ies$/.test(w)) out.push({ lemma: w.slice(0, -3) + 'y', form: 'present3' });
  if (/(s|sh|ch|x|z|o)es$/.test(w)) out.push({ lemma: w.slice(0, -2), form: 'present3' });
  if (/s$/.test(w) && !/ss$/.test(w)) out.push({ lemma: w.slice(0, -1), form: 'present3' });
  if (/ied$/.test(w)) out.push({ lemma: w.slice(0, -3) + 'y', form: 'past' });
  if (/ed$/.test(w)) {
    out.push({ lemma: w.slice(0, -2), form: 'past' }, { lemma: w.slice(0, -1), form: 'past' });
    out.push({ lemma: w.slice(0, -2), form: 'participle' }, { lemma: w.slice(0, -1), form: 'participle' });
    if (/([bcdfgklmnprstvz])\1ed$/.test(w)) out.push({ lemma: w.slice(0, -3), form: 'past' });
  }
  if (/ing$/.test(w) && w.length > 4) {
    const b = w.slice(0, -3);
    out.push({ lemma: b, form: 'ing' }, { lemma: b + 'e', form: 'ing' });
    if (/([bcdfgklmnprstvz])\1$/.test(b)) out.push({ lemma: b.slice(0, -1), form: 'ing' });
    if (/y$/.test(b)) out.push({ lemma: b.slice(0, -1) + 'ie', form: 'ing' });
  }
  return out;
}

/** Singular candidates for an English noun ("books" → book, "boxes" → box, "children" → child). */
export function nounCandidates(w: string): { lemma: string; plural: boolean }[] {
  const out = [{ lemma: w, plural: false }];
  const irr = IRREGULAR_PLURALS[w];
  if (irr) out.unshift({ lemma: irr, plural: irr !== w });
  if (/ies$/.test(w) && w.length > 4) out.push({ lemma: w.slice(0, -3) + 'y', plural: true });
  if (/(s|sh|ch|x|z)es$/.test(w)) out.push({ lemma: w.slice(0, -2), plural: true });
  if (/s$/.test(w) && !/(ss|us|is)$/.test(w) && w.length > 2) out.push({ lemma: w.slice(0, -1), plural: true });
  return out;
}

export const SUBJECT_PRONOUNS: Record<string, PersonNumber> = { i: '1sg', you: '2sg', he: '3sg', she: '3sg', it: '3sg', we: '1pl', they: '3pl' };
export const OBJECT_PRONOUNS: Record<string, PersonNumber> = { me: '1sg', you: '2sg', him: '3sg', her: '3sg', us: '1pl', them: '3pl', it: '3sg' };
export const POSSESSIVE_DETERMINERS: Record<string, PersonNumber> = { my: '1sg', your: '2sg', his: '3sg', her: '3sg', its: '3sg', our: '1pl', their: '3pl' };
export const ARTICLES = new Set(['a', 'an', 'the']);
export const DEMONSTRATIVES = new Set(['this', 'that', 'these', 'those']);
export const NEGATORS = new Set(['not', 'never']);
export const BE_FORMS = new Set(['am', 'is', 'are', 'was', 'were', 'be', 'been', 'being']);
export const WH_WORDS = new Set(['where', 'what', 'who', 'whom', 'when', 'which', 'why', 'how']);
export const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
};

const CONTRACTIONS: [RegExp, string][] = [
  [/\bcan't\b/g, 'can not'], [/\bcannot\b/g, 'can not'], [/\bwon't\b/g, 'will not'], [/\bshan't\b/g, 'shall not'],
  [/\b(\w+)n't\b/g, '$1 not'], [/\bi'm\b/g, 'i am'], [/\b(\w+)'re\b/g, '$1 are'], [/\b(\w+)'ve\b/g, '$1 have'],
  [/\b(\w+)'ll\b/g, '$1 will'], [/\b(\w+)'d\b/g, '$1 would'], [/\b(he|she|it|that|there|what|where|who|how)'s\b/g, '$1 is'],
];

export interface EnglishInput {
  raw: string;
  tokens: string[];
  question: boolean;
  /** Capitalised words that are plausibly names (mid-sentence, not calendar/English proper adjectives). */
  proper: Set<string>;
  /** Register requested by an English label: "(sing.)" → informal, "(polite)" → formal, "(pl.)" → plural. */
  address?: 'informal' | 'formal' | 'plural';
}

/** Capitalised in English but never names: they must be translated or reported, not copied. */
const CAPITALISED_COMMON = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december',
  'god', 'g-d', 'english', 'russian', 'hebrew', 'jewish', 'jew', 'jews', 'christian', 'muslim', 'indian', 'israeli', 'american',
  'torah', 'shabbat', 'passover', 'i',
]);
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'dr']);

/** Remove English annotation conventions used in the source's English column. */
export function cleanEnglish(text: string): { text: string; address?: EnglishInput['address'] } {
  let address: EnglishInput['address'];
  const t = text.replace(/\(([^)]*)\)/g, (_m, inner: string) => {
    const x = inner.toLowerCase();
    if (/\b(sing\.?|singular|informal)\b/.test(x)) address = 'informal';
    else if (/\b(polite|pol\.?|formal)\b/.test(x)) address = 'formal';
    else if (/\b(pl\.?|plural)\b/.test(x)) address = 'plural';
    return ' ';
  })
    // "he/she", "his/her", "gone/been": keep the first alternative
    .replace(/\b([A-Za-z']+)\/[A-Za-z']+\b/g, '$1')
    .replace(/\s+([.,!?;:])/g, '$1').replace(/\s+/g, ' ').trim();
  return { text: t, ...(address ? { address } : {}) };
}

export function analyze(text: string): EnglishInput {
  const cleaned = cleanEnglish(text.normalize('NFC').replace(/[’‘]/g, "'"));
  const raw = cleaned.text;
  const proper = new Set<string>();
  const words = raw.split(/\s+/);
  words.forEach((w, i) => {
    const bare = w.toLowerCase().replace(/[^a-z'-]/g, '').replace(/'s$/, '');
    const prev = (words[i - 1] ?? '').toLowerCase().replace(/[^a-z]/g, '');
    const sentenceStart = i === 0 || /[.!?]$/.test(words[i - 1] ?? '');
    const possessiveName = /^[A-Z][a-z]+'s\b/.test(w);
    if (/^[A-Z][a-z]/.test(w) && !CAPITALISED_COMMON.has(bare) && (!sentenceStart || TITLES.has(prev) || possessiveName)) proper.add(bare);
    if (TITLES.has(prev) && /^[A-Z]/.test(w)) proper.add(bare);
  });
  let t = raw.toLowerCase();
  for (const [re, rep] of CONTRACTIONS) t = t.replace(re, rep);
  // possessive 's on nouns: "David's book" → "david 's book"
  t = t.replace(/\b([a-z]+)'s\b/g, "$1 's");
  const tokens = t.split(/[^a-z0-9'-]+/).map((x) => (x === "'s" ? x : x.replace(/^'+|'+$/g, ''))).filter((x) => x && x !== "'");
  const question = /\?\s*$/.test(raw) || WH_WORDS.has(tokens[0] ?? '') || /^(do|does|did|is|are|am|was|were|can|will|have|has)$/.test(tokens[0] ?? '');
  return { raw, tokens, question, proper, ...(cleaned.address ? { address: cleaned.address } : {}) };
}

/** English paraphrases tried when the exact wording is not in the source. */
export const ENGLISH_SYNONYMS: Record<string, string[]> = {
  'thank you': ['thanks'], 'thank you very much': ['thanks'], hi: ['hello'], bye: ['goodbye'], 'good bye': ['goodbye'],
  mom: ['mother'], mum: ['mother'], dad: ['father'], kid: ['child'], kids: ['children'],
};

export const PERSON_LABEL: Record<PersonNumber, string> = {
  '1sg': 'I', '2sg': 'you (informal)', '2pol': 'you (polite)', '3sg': 'he/she', '3resp': 'he/she (respectful)',
  '1pl': 'we', '2pl': 'you (plural)', '3pl': 'they',
};
