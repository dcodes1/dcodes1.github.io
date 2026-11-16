/*
 * Tajik → Buxori adaptation for the fallback layer (see README, "AI draft layer").
 *
 * The fallback's words come from an AI working from Literary Tajik. Before one is used,
 * the forms in which Literary Tajik is known to differ from the lesson book's Buxori are
 * rewritten to the book's. EVERY rule here is one the book itself states or prints; the
 * evidence is given with each rule and re-checked by tests/transducer.test.ts against
 * the compiled index. A proposed rule the book does not support is listed under
 * REJECTED_RULES with the reason, and is not applied: an adaptation the book cannot
 * confirm would be one more unverified guess presented as a correction.
 *
 * Closed-class lock: pronouns, prepositions, conjunctions, numerals and particles are
 * never taken from the fallback. They are grammar, the book is the only authority on
 * grammar, and they are where the draft agreed with the book least (31 of 53).
 */

export type AuthorityTier = 'book_verified' | 'tajik_adapted' | 'ai_draft_unverified';

/** English function words whose Buxori must come from the lesson book. */
export const CLOSED_CLASS_ENGLISH: ReadonlySet<string> = new Set([
  'i', 'you', 'he', 'she', 'it', 'we', 'they', 'me', 'him', 'her', 'us', 'them',
  'my', 'your', 'his', 'its', 'our', 'their', 'mine', 'yours', 'ours', 'theirs',
  'myself', 'yourself', 'himself', 'herself', 'itself', 'ourselves', 'themselves',
  'this', 'that', 'these', 'those', 'who', 'whom', 'whose', 'what', 'which', 'where', 'when', 'why', 'how',
  'in', 'on', 'at', 'to', 'from', 'with', 'without', 'for', 'of', 'by', 'about', 'into', 'onto', 'over', 'under',
  'before', 'after', 'between', 'through', 'near', 'behind', 'until', 'than', 'as',
  'and', 'or', 'but', 'if', 'because', 'although', 'while', 'so',
  'is', 'am', 'are', 'was', 'were', 'be', 'been', 'not', 'no', 'yes',
  'a', 'an', 'the', 'some', 'any', 'every', 'each', 'all', 'both', 'none', 'nobody', 'nothing', 'somebody', 'something',
  'zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'hundred', 'thousand',
]);
export const CLOSED_CLASS_POS: ReadonlySet<string> = new Set(['pronoun', 'preposition', 'conjunction', 'numeral', 'particle']);

/** True when this English item is grammar, to be answered by the book or not at all. */
export function isClosedClass(english: string, pos?: string): boolean {
  if (pos && CLOSED_CLASS_POS.has(pos)) return true;
  const words = english.toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z' ]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  return words.length > 0 && words.every((w) => CLOSED_CLASS_ENGLISH.has(w));
}

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'ü']);
const endsWithVowel = (stem: string) => VOWELS.has(stem.slice(-1).toLowerCase());

export interface Adaptation {
  buxoriForm: string;
  appliedRules: string[];
  /** Set when the form uses a construction that cannot be adapted word by word; the row is not imported. */
  rejected?: string;
}

/** Rules proposed for this transducer that the lesson book does not support. Not applied. */
export const REJECTED_RULES: readonly { rule: string; why: string }[] = [
  { rule: '3sg copula -ast → -ay / -as', why: 'The book prints neither -ay nor -as. Its sentences drop the copula ("Ü bisyor odami baovrü") or use hast.' },
  { rule: '3pl verb ending -and → -an', why: 'The book\'s Regular 3pl ending is -and (present, simple past). -an appears only in a few transcribed dialogues.' },
  { rule: 'final cluster drop: düst → düs, rost → ros, baland → balan', why: 'The book prints düst, rost and baland, and never the reduced forms.' },
  { rule: 'vowel shift retries (u ↔ ü, o → a before nasals)', why: 'The book states no such rule; ü/u and the apostrophe are already matched as a spelling variant.' },
];

/**
 * Rewrite one Literary Tajik word or sentence (Latin script) in the lesson book's Buxori.
 * `isStem` says whether a bare word is a known entry, so that the object marker is only
 * stripped from a real noun (Buxoro, sahro and shüro end in -ro and are not objects).
 */
export function adaptTajikSurfaceToBuxori(tajikForm: string, isStem: (bare: string) => boolean = () => false): Adaptation {
  const appliedRules: string[] = [];
  let rejected: string | undefined;
  // Spelling: the book writes ü where Tajik romanisations write ū / ů / ӯ, and plain i for ī.
  let form = tajikForm.trim().replace(/[ūůӯ]/g, 'ü').replace(/[ŪŮӮ]/g, 'Ü').replace(/ī/g, 'i').replace(/Ī/g, 'I');
  if (form !== tajikForm.trim()) appliedRules.push('spelling: ū → ü, ī → i (the book\'s alphabet)');

  // Literary progressive (rafta istodaast). The book builds the Regular progressive on -sod-
  // (omasodim) and marks istoda as Literal: such a form is rebuilt from the stem, not converted.
  if (/a\s+istoda(ast|am|yam|i|yi|em|yem|ed|yed|and|yand)?(?![a-zü])/i.test(form)) rejected = 'literary progressive (… istoda-): rebuild from the verb stem with the book\'s -sod- pattern';

  // A word on its own is a headword, never an object: shüro is a word, not shü + -ro.
  const inSentence = /\s/.test(form);
  form = form.split(/(\s+)/).map((word) => {
    if (!inSentence) return word;
    const m = /^([A-Za-zÜü'’-]+?)(ro)([.,!?;:]*)$/.exec(word);
    if (!m) return word;
    const bare = m[1]!;
    if (bare.length < 2 || !isStem(bare)) return word;
    // Object marker. Book: affix "obj" = -a after a consonant, -ya after a vowel (Regular); -ro is Literal.
    const suffix = endsWithVowel(bare) ? 'ya' : 'a';
    appliedRules.push(`object marker: ${bare}-ro → ${bare}-${suffix}`);
    return bare + suffix + m[3]!;
  }).join('');

  // 3rd person plural pronoun. Book: "they" is inho; onho / eshon are not printed.
  const pron = form.replace(/\b(onho|eshon)\b/gi, (w) => (/^[A-Z]/.test(w) ? 'Inho' : 'inho'));
  if (pron !== form) { appliedRules.push('pronoun: onho / eshon → inho (the book\'s "they")'); form = pron; }

  return { buxoriForm: form, appliedRules, ...(rejected ? { rejected } : {}) };
}
