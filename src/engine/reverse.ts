/*
 * Buxori → English.
 *
 *   1. exact     the text is a sentence, phrase, proverb or entry printed in the source
 *   2. built     each word is analysed (root + affixes), the clause is re-ordered from
 *                Buxori verb-final order into English order, and the verb is conjugated
 *                in English from the tense/person the Buxori form carries
 *   3. gloss     words were recognised but the sentence shape was not: word-by-word only
 *   4. none      nothing recognised
 *
 * Whatever the status, `tokens` holds the word-by-word analysis, so the UI can always
 * show how a rendering was derived. Words that are not in the source are kept as typed
 * and listed in `unknown`; nothing is guessed.
 *
 * Analysis reuses the generator: every verb is conjugated in every tense and person
 * (Morphology.conjugate, the tested English → Buxori path) and the forms are indexed, so
 * the analyser recognises exactly what the generator can build, including compound
 * verbs ("zindagi mekunam") and two-word tenses ("gufta budam"). Noun suffixes are
 * stripped with the allomorphs of the index's affix table.
 */
import { canonicalKey, detectScript, foldTsvStress, fuzzyKey, type Script } from '../lib/normalizer.ts';
import type { Lookup, Tier as SpellingTier } from '../lib/lookup.ts';
import type { BuxoriIndex, Example, InflectedEntry, PartOfSpeech, PersonNumber, RootEntry, Tense } from '../lib/types.ts';
import {
  ADJECTIVES, MASS, OBJECT_FORM, POSSESSIVE, articleFor, beForm, ordinalOf, pluralOf, subjectPronoun, verbPhrase, vpText, withDoSupport, type VerbPhrase,
} from './english-gen.ts';
import { TIER_HIGH, TIER_LOW, type Tier } from './engine.ts';
import type { Morphology } from './morphology.ts';

export interface Part { form: string; label: string }
export interface Features {
  plural?: true; poss?: PersonNumber; object?: true; ezafe?: true; to?: true; indefinite?: true;
  copula?: PersonNumber; want?: true; comparative?: true; superlative?: true; classifier?: true; and?: true; ordinal?: true; particle?: string;
  verb?: { tense: Tense; pn: PersonNumber; negative: boolean; alsoFuture?: true };
}
export interface Reading {
  kind: 'entry' | 'verb' | 'inflected' | 'phrase' | 'number' | 'name';
  /** Dictionary form in Buxori. */
  lemma: string;
  pos: PartOfSpeech;
  /** Sense used in the rendering, then the entry's other senses. */
  gloss: string;
  glosses: string[];
  parts: Part[];
  f: Features;
  rows: number[];
  /** How the spelling matched the source (exact, or one of the approximate tiers). */
  spelling: SpellingTier;
  register?: 'literal' | 'spoken';
  /** Spoken / variant / synonym forms the source lists for this entry. */
  forms: { text: string; kind: string }[];
  root?: RootEntry;
  /** For a Literal-register verb form: the everyday (Regular) form of the same tense and person. */
  everyday?: string;
}
export interface Token {
  /** As typed (one or more words: "zindagi mekunam" is one token). */
  text: string;
  /** Latin (source) spelling. */
  latin: string;
  /** Best reading first; empty = not in the source. */
  readings: Reading[];
  /** Entries with a similar spelling, offered when the word itself is not in the source. Never used in the rendering. */
  suggestions: Reading[];
  /** Index into readings of the one the rendering used. */
  chosen: number;
  punct: string;
}
export interface Reverse {
  status: 'exact' | 'built' | 'gloss' | 'none';
  english: string | null;
  confidence: number;
  tier: Tier;
  factors: string[];
  tokens: Token[];
  /** Printed source rows behind an exact answer. */
  printed: { en: string; bux: string; row: number }[];
  unknown: string[];
  notes: string[];
  script: Script;
  /** The input in the source's Latin spelling. */
  latin: string;
}

const TENSES: Tense[] = ['present', 'simple_past', 'descriptive_past', 'present_continuous', 'past_continuous', 'present_perfect', 'past_perfect', 'imperative', 'future'];
const PERSONS: PersonNumber[] = ['1sg', '2sg', '2pol', '3sg', '1pl', '2pl', '3pl'];
const TENSE_LABEL: Record<string, string> = {
  present: 'present', future: 'future', simple_past: 'past', descriptive_past: 'habitual past (“used to”)', present_continuous: 'present continuous',
  past_continuous: 'past continuous', present_perfect: 'present perfect', past_perfect: 'past perfect', imperative: 'imperative',
};
const PERSON_LABEL: Record<PersonNumber, string> = {
  '1sg': 'I', '2sg': 'you (informal)', '2pol': 'you (polite)', '3sg': 'he/she', '3resp': 'he/she (respectful)', '1pl': 'we', '2pl': 'you (plural)', '3pl': 'they',
};
const sentenceKey = (s: string) => canonicalKey(foldTsvStress(s)).replace(/[^a-zü' -]+/g, ' ').replace(/\s+/g, ' ').trim();
/** Placeholder for the preposition ba / the suffix -ba until the verb is known. */
const BA = '\u0001ba';
const MOTION = new Set(['go', 'come', 'bring', 'send', 'give', 'return', 'arrive', 'enter', 'run', 'walk', 'fly', 'travel', 'move', 'take', 'say', 'tell', 'speak', 'write', 'call', 'look', 'invite', 'put', 'throw', 'carry', 'lead', 'get']);
const NOMINAL: PartOfSpeech[] = ['noun', 'proper_noun', 'pronoun', 'numeral', 'adjective', 'phrase', 'adverb'];

interface Suffix { form: string; label: string; slot: number; set: (f: Features) => void; restore?: string[]; on: (pos: PartOfSpeech) => boolean; register?: 'literal' | 'spoken' }
interface VerbHit { root: RootEntry; tense: Tense; pn: PersonNumber; negative: boolean; register: 'regular' | 'literal'; alsoFuture?: true }

export class ReverseEngine {
  private readonly index: BuxoriIndex;
  private readonly lookup: Lookup;
  private readonly morph: Morphology;
  private readonly sentences = new Map<string, Example[]>();
  private verbForms: Map<string, VerbHit[]> | null = null;
  private maxVerbWords = 1;
  private readonly suffixes: Suffix[] = [];

  constructor(index: BuxoriIndex, lookup: Lookup, morph: Morphology) {
    this.index = index; this.lookup = lookup; this.morph = morph;
    for (const e of Object.values(index.examples)) {
      if (!e.en || e.language !== 'buxori') continue;
      for (const k of new Set([sentenceKey(e.bux), ...(e.spoken ? [sentenceKey(e.spoken)] : [])])) {
        if (k) (this.sentences.get(k) ?? this.sentences.set(k, []).get(k)!).push(e);
      }
    }
    this.buildSuffixes();
  }

  // ── suffix table, from the index's affixes ────────────────────────────────
  private buildSuffixes() {
    const A = this.index.affixes.entries;
    const nounish = (p: PartOfSpeech) => p !== 'verb' && p !== 'preposition' && p !== 'conjunction' && p !== 'particle';
    const add = (id: string, slot: number, label: (a: { gloss: string; personNumber?: PersonNumber }) => string, set: (f: Features, pn?: PersonNumber) => void, on = nounish) => {
      const a = A[id as never]; if (!a) return;
      for (const al of a.allomorphs) {
        const form = al.form.replace(/-/g, '');
        if (!form) continue;
        const env = al.environment;
        this.suffixes.push({
          form, label: label(a), slot, on, set: (f) => set(f, a.personNumber),
          // "xona" + -im → "xonim": the Regular form drops a final a/i, so put it back when analysing
          ...(env.kind === 'after_vowel' && env.dropFinalVowel ? { restore: [...(env.vowels ?? ['a', 'i'])] } : {}),
          ...(al.register === 'literal' || al.register === 'spoken' ? { register: al.register } : {}),
        });
      }
    };
    add('pl.ho', 1, () => 'plural', (f) => { f.plural = true; }, (p) => p === 'noun' || p === 'proper_noun' || p === 'adjective' || p === 'pronoun');
    add('cmp.tar', 1, () => 'comparative (-er)', (f) => { f.comparative = true; }, (p) => p === 'adjective' || p === 'noun' || p === 'adverb');
    add('cls.ta', 1, () => 'counting suffix', (f) => { f.classifier = true; }, (p) => p === 'numeral');
    add('ord', 1, () => 'ordinal (-th)', (f) => { f.ordinal = true; }, (p) => p === 'numeral');
    for (const pn of ['1sg', '2sg', '3sg', '1pl', '2pl', '3pl']) add(`poss.${pn}`, 2, (a) => `possessive: ${POSSESSIVE[a.personNumber ?? '3sg']}`, (f, p) => { f.poss = p ?? '3sg'; });
    add('indef.e', 2, () => 'indefinite (a / one)', (f) => { f.indefinite = true; });
    add('ezafe', 3, () => 'ezafe: links to the next word', (f) => { f.ezafe = true; });
    // Regular ezafe replaces a final a/i ("xona" → "xoni"); the affix table lists only -i / -yi.
    this.suffixes.push({ form: 'i', label: 'ezafe: links to the next word', slot: 3, on: nounish, set: (f) => { f.ezafe = true; }, restore: ['a'] });
    // "Man guftani hastam" = I want to say: infinitive + -i + hast (stated in the source)
    this.suffixes.push({ form: 'i', label: 'infinitive + -i: “want to …” (with hast)', slot: 3, on: (p) => p === 'verb', set: (f) => { f.want = true; } });
    add('obj', 3, () => 'direct object marker', (f) => { f.object = true; });
    add('dir.ba', 3, () => 'to / at / for', (f) => { f.to = true; });
    add('conj.u', 4, () => 'and', (f) => { f.and = true; });
    // Copula ("to be") suffixes: taken from the generator so both directions agree.
    for (const pn of PERSONS) {
      for (const base of ['kitov', 'xona']) {
        const t = this.morph.copula(base, pn, false).text;
        const form = t.startsWith(base) && !t.includes(' ') ? t.slice(base.length) : '';
        if (form && !this.suffixes.some((s) => s.slot === 5 && s.form === form && s.label.endsWith(PERSON_LABEL[pn])))
          this.suffixes.push({ form, label: `“to be”: ${PERSON_LABEL[pn]}`, slot: 5, on: (p) => p !== 'verb' && p !== 'preposition' && p !== 'conjunction', set: (f) => { f.copula = pn; } });
      }
    }
    // hast + -and = "they are" (the source prints it as one word)
    this.suffixes.push({ form: 'and', label: `“to be”: ${PERSON_LABEL['3pl']}`, slot: 5, on: (p) => p === 'particle', set: (f) => { f.copula = '3pl'; } });
    for (const id of ['prt.ku', 'prt.da', 'prt.mi', 'prt.ha']) add(id, 6, () => 'sentence particle', (f) => { f.particle = id.slice(4); });
    this.suffixes.sort((a, b) => b.form.length - a.form.length);
  }

  /** Build the verb-form table ahead of the first translation (about 0.3 s; the UI calls this when idle). */
  warm(): void { this.verbs(); }

  private verbs(): Map<string, VerbHit[]> {
    if (this.verbForms) return this.verbForms;
    const map = new Map<string, VerbHit[]>();
    for (const root of Object.values(this.index.roots.entries)) {
      if (!root.verb) continue;
      for (const tense of TENSES) for (const pn of PERSONS) for (const negative of [false, true]) for (const register of ['regular', 'literal'] as const) {
        let text: string | undefined;
        try { text = this.morph.conjugate(root, tense, pn, { negative, register })?.text; } catch { text = undefined; }
        if (!text) continue;
        const k = sentenceKey(text);
        const list = map.get(k) ?? map.set(k, []).get(k)!;
        // present and future are one form in Buxori: keep one reading and remember the other
        const same = list.find((h) => h.root === root && h.pn === pn && h.negative === negative && (h.tense === tense || (h.tense === 'present' && tense === 'future')));
        if (same) { if (tense === 'future') same.alsoFuture = true; continue; }
        list.push({ root, tense, pn, negative, register });
        this.maxVerbWords = Math.max(this.maxVerbWords, k.split(' ').length);
      }
    }
    // Literal 3rd person singular of the habitual past: the source says it takes "the same
    // endings as the Simple Past" (p77), whose Literal 3sg has no ending: me- + past stem.
    for (const root of Object.values(this.index.roots.entries)) {
      if (!root.verb) continue;
      for (const negative of [false, true]) {
        let past: string | undefined;
        try { past = this.morph.conjugate(root, 'simple_past', '3sg', { register: 'literal' })?.text; } catch { past = undefined; }
        if (!past) continue;
        const words = past.split(' ');
        const k = sentenceKey([...words.slice(0, -1), `${negative ? 'na' : ''}me${words[words.length - 1]!.toLowerCase()}`].join(' '));
        const list = map.get(k) ?? map.set(k, []).get(k)!;
        if (!list.some((h) => h.root === root && h.tense === 'descriptive_past' && h.pn === '3sg')) list.push({ root, tense: 'descriptive_past', pn: '3sg', negative, register: 'literal' });
      }
    }
    // Forms printed in the source's own tables, in every register ("rafta istodayem")
    for (const [id, forms] of Object.entries(this.index.roots.verbForms)) {
      const root = this.index.roots.entries[id as never];
      if (!root) continue;
      for (const f of forms) {
        const k = sentenceKey(f.form);
        const list = map.get(k) ?? map.set(k, []).get(k)!;
        if (!list.some((h) => h.root === root && h.pn === f.pn && h.negative === f.negative && (h.tense === f.tense || (h.tense === 'present' && f.tense === 'future'))))
          list.push({ root, tense: f.tense, pn: f.pn, negative: f.negative, register: f.register === 'literal' ? 'literal' : 'regular' });
        this.maxVerbWords = Math.max(this.maxVerbWords, k.split(' ').length);
      }
    }
    this.verbForms = map;
    return map;
  }

  // ── word analysis ─────────────────────────────────────────────────────────
  /**
   * Which sense to show first for a word with several: the one the source's own example
   * sentences use. "Xona" is glossed "room; house", and the examples with bare "xona"
   * say "house" three times and "room" never. The order only changes on clear evidence (at least three
   * examples and twice as many as the first-listed sense); every sense stays in the panel.
   */
  private preferred: Map<string, number> | null = null;
  private senseOrder(): Map<string, number> {
    if (this.preferred) return this.preferred;
    const out = new Map<string, number>();
    const ex = [...new Set([...this.sentences.values()].flat())].map((e) => ({
      words: sentenceKey(e.bux).split(' '), en: ` ${(e.en ?? '').toLowerCase().replace(/[^a-z' ]+/g, ' ')} `,
    }));
    for (const root of Object.values(this.index.roots.entries)) {
      const k = root.lemma.key;
      if (root.glosses.length < 2 || k.includes(' ') || k.length < 3) continue;
      // only examples with the word in its bare form: "zanam" (my wife) says nothing about "zan" (woman)
      const mine = ex.filter((e) => e.words.includes(k));
      if (mine.length < 3) continue;
      const counts = root.glosses.map((g) => {
        const w = g.key.replace(/^to /, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const re = new RegExp(`[^a-z']${w}(s|es|d|ed|ing)?[^a-z']`);
        return mine.filter((e) => re.test(e.en)).length;
      });
      const best = counts.indexOf(Math.max(...counts));
      if (best > 0 && counts[best]! >= 3 && counts[best]! >= 2 * counts[0]!) out.set(root.id, best);
    }
    this.preferred = out;
    return out;
  }

  /** The entry's English senses, the one its examples use first. */
  private sensesOf(root: RootEntry): string[] {
    const first = this.senseOrder().get(root.id) ?? 0;
    // a gloss that only repeats the Buxori word ("Zadan": "zadan; to beat") is not a sense
    const all = root.glosses.map((g) => g.text).filter((t) => t.toLowerCase() !== root.lemma.key || root.glosses.length === 1);
    const pick = root.glosses[first]?.text;
    return pick && all.includes(pick) ? [pick, ...all.filter((t) => t !== pick)] : all;
  }

  private entryReading(root: RootEntry, spelling: SpellingTier, matched?: string): Reading {
    const senses = this.sensesOf(root);
    const via = matched && matched !== root.lemma.key ? root.forms.find((f) => f.key === matched) : undefined;
    return {
      kind: 'entry', lemma: root.lemma.text, pos: root.pos, gloss: senses[0] ?? '', glosses: senses,
      parts: via && via.key !== root.lemma.key ? [{ form: via.text, label: `${via.kind.replace('_', ' ')} form of ${root.lemma.text}` }] : [],
      f: {}, rows: root.sources.map((s) => s.row), spelling, root,
      ...(via?.register === 'spoken' || via?.kind === 'spoken' ? { register: 'spoken' as const } : via?.register === 'literal' || via?.kind === 'literary' ? { register: 'literal' as const } : {}),
      forms: root.forms.map((f) => ({ text: f.text, kind: f.kind.replace('_', ' ') })),
    };
  }
  private inflectedReading(e: InflectedEntry): Reading {
    const A = this.index.affixes.entries;
    const reg = /literal/i.test(e.source.section) || e.affixes.some((a) => /literal/.test(a)) ? 'literal' as const : undefined;
    return {
      kind: 'inflected', lemma: e.baseText || e.text, pos: 'noun', gloss: e.glosses[0]?.text ?? '', glosses: e.glosses.map((g) => g.text),
      parts: e.affixes.map((id) => ({ form: A[id.replace(/\.(literal|regular)$/, '') as never]?.allomorphs[0]?.form ?? id, label: A[id.replace(/\.(literal|regular)$/, '') as never]?.gloss ?? id })),
      f: {}, rows: [e.source.row], spelling: 'exact', forms: e.spoken ? [{ text: e.spoken, kind: 'spoken' }] : [], ...(reg ? { register: reg } : {}),
    };
  }
  private verbReading(h: VerbHit): Reading {
    const v = h.root.verb!;
    const parts: Part[] = [];
    if (h.negative) parts.push({ form: 'na-', label: 'not' });
    parts.push({ form: h.root.lemma.text, label: `verb “${this.sensesOf(h.root)[0] ?? ''}”${v.compound ? `, compound with ${v.compound.preverb}` : ''}` });
    parts.push({ form: TENSE_LABEL[h.tense] ?? h.tense, label: `tense${h.alsoFuture ? ' (the same form is the future)' : ''}` });
    parts.push({ form: PERSON_LABEL[h.pn], label: 'person' });
    let everyday: string | undefined;
    if (h.register === 'literal') {
      try { everyday = this.morph.conjugate(h.root, h.tense, h.pn, { negative: h.negative })?.text; } catch { everyday = undefined; }
    }
    return {
      ...(everyday ? { everyday } : {}),
      kind: 'verb', lemma: h.root.lemma.text, pos: 'verb', gloss: this.sensesOf(h.root)[0] ?? '', glosses: this.sensesOf(h.root), parts,
      f: { verb: { tense: h.tense, pn: h.pn, negative: h.negative, ...(h.alsoFuture ? { alsoFuture: true as const } : {}) } },
      rows: h.root.sources.map((s) => s.row), spelling: 'exact', root: h.root, ...(h.register === 'literal' ? { register: 'literal' as const } : {}),
      forms: h.root.forms.map((f) => ({ text: f.text, kind: f.kind.replace('_', ' ') })),
    };
  }

  /** Spelling without accents or apostrophes → the source spelling(s). */
  private readonly plain = new Map<string, string[]>();
  private direct(key: string, loose = true): Reading[] {
    const out: Reading[] = [];
    if (loose && !this.index.roots.byKey[key as never] && !this.index.roots.inflected[key as never]) {
      // "duxtur" for "düxtur": only ü/u and the apostrophe may differ
      if (!this.plain.size) for (const k of [...Object.keys(this.index.roots.byKey), ...Object.keys(this.index.roots.inflected)]) { const f = fuzzyKey(k); (this.plain.get(f) ?? this.plain.set(f, []).get(f)!).push(k); }
      const real = this.plain.get(fuzzyKey(key)) ?? [];
      if (real.length && !this.sentences.has(key)) return real.slice(0, 2).flatMap((k) => this.direct(k, false).map((r) => ({ ...r, spelling: 'fuzzy' as const })));
    }
    for (const id of this.index.roots.byKey[key as never] ?? []) { const r = this.index.roots.entries[id]; if (r) out.push(this.entryReading(r, 'exact', key)); }
    for (const e of this.index.roots.inflected[key as never] ?? []) out.push(this.inflectedReading(e));
    // Words the dictionary lacks but an example row gives on its own ("Xursand" = merry, happy)
    if (!out.length && !key.includes(' ')) {
      for (const e of this.sentences.get(key) ?? []) {
        if (!e.en || / /.test(e.en.split(/[;,]/)[0]!.trim().replace(/^to /, ''))) continue;
        out.push({ kind: 'entry', lemma: e.bux.replace(/[.!?]+$/, ''), pos: 'adjective', gloss: e.en.split(/[;,]/)[0]!.trim(), glosses: e.en.split(/[;,]/).map((x) => x.trim()), parts: [], f: {}, rows: [e.source.row], spelling: 'exact', forms: e.spoken ? [{ text: e.spoken, kind: 'spoken' }] : [] });
        break;
      }
    }
    return out;
  }

  /** Strip noun/adjective suffixes, outermost first, until a source entry is left. */
  private strip(key: string, maxSlot: number, depth: number): Reading[] {
    if (depth > 3) return [];
    const out: Reading[] = [];
    for (const s of this.suffixes) {
      if (s.slot >= maxSlot || !key.endsWith(s.form) || key.length - s.form.length < 1) continue;      // "üya" = ü + -ya
      const stem = key.slice(0, -s.form.length);
      const stems = s.restore ? s.restore.map((v) => stem + v) : [stem];
      for (const st of stems) {
        const bases = [...this.direct(st).filter((r) => r.kind === 'entry' && !r.parts.length), ...this.strip(st, s.slot, depth + 1)];
        for (const b of bases) {
          if (!s.on(b.pos)) continue;
          if (/\?$/.test(b.gloss) && s.slot < 3) continue;                 // question words take no plural or possessive
          const f = { ...b.f }; s.set(f);
          out.push({ ...b, parts: [...b.parts, { form: '-' + s.form, label: s.label }], f, ...(s.register ? { register: s.register } : {}) });
        }
      }
    }
    return out;
  }

  /** All readings of one word (or of several words that form one unit). */
  analyse(text: string): Reading[] {
    const key = sentenceKey(text);
    if (!key) return [];
    if (/^\d+$/.test(text.trim())) return [{ kind: 'number', lemma: text.trim(), pos: 'numeral', gloss: text.trim(), glosses: [text.trim()], parts: [], f: {}, rows: [], spelling: 'exact', forms: [] }];
    const readings: Reading[] = this.direct(key);
    for (const h of this.verbs().get(key) ?? []) readings.push(this.verbReading(h));
    if (!key.includes(' ')) {
      if (!readings.some((r) => r.kind === 'verb')) {
        // Literal-register forms the generator does not print by default (meravam)
        for (const a of this.lookup.analyzeVerb(key)) {
          const pn = a.ending?.personNumber;
          if (!pn || !a.tense) continue;
          readings.push(this.verbReading({ root: a.root, tense: a.tense, pn, negative: a.prefixes.includes('na'), register: 'literal' }));
        }
      }
      const stripped = this.strip(key, 99, 0).sort((a, b) => a.parts.length - b.parts.length);
      const seen = new Set(readings.map((r) => `${r.lemma}|${r.parts.map((p) => p.label).join('+')}`));
      for (const r of stripped) { const id = `${r.lemma}|${r.parts.map((p) => p.label).join('+')}`; if (!seen.has(id)) { seen.add(id); readings.push(r); } }
    }
    return readings.slice(0, 8);
  }

  /** "Did you mean": entries whose spelling is close to a word the source does not have. */
  private suggest(text: string): Reading[] {
    const near = this.lookup.byBuxori(text);
    if (!near.tier || near.tier === 'exact' || near.tier === 'fuzzy') return [];
    return near.matches.slice(0, 4).flatMap((m) => m.roots.map((r) => this.entryReading(r, near.tier!))).slice(0, 4);
  }

  /**
   * Literal continuous, built from parts for any verb (the source states the pattern:
   * "past participle rafta + istoda + -yam"): participle + istoda-ending = present
   * continuous, participle + istoda + bud-ending = past continuous.
   */
  private literalContinuous(words: string[], broken: boolean): { hit: VerbHit; words: number } | null {
    if (words.length < 2 || broken) return null;
    const [w0, w1, w2] = words.map((w) => sentenceKey(w));
    if (!w0 || !w1 || !w0.endsWith('a')) return null;
    const negative = w0.startsWith('na') && !this.index.roots.byStem[w0.slice(0, -1)];
    const stem = (negative ? w0.slice(2) : w0).slice(0, -1);
    const id = (this.index.roots.byStem[stem] ?? []).find((x) => x.stem === 'past')?.root;
    const root = id ? this.index.roots.entries[id] : undefined;
    if (!root?.verb) return null;
    const verbs = this.verbs();
    const aux = (key: string, lemma: string, tense: Tense) => (verbs.get(key) ?? []).find((h) => h.root.lemma.key === lemma && h.tense === tense && !h.negative);
    if (w1 === 'istoda' && w2) {
      const b = aux(w2, 'budan', 'simple_past');
      return b ? { hit: { root, tense: 'past_continuous', pn: b.pn, negative, register: 'literal' }, words: 3 } : null;
    }
    const a = aux(w1, 'istodan', 'present_perfect');
    return a ? { hit: { root, tense: 'present_continuous', pn: a.pn, negative, register: 'literal' }, words: 2 } : null;
  }

  // ── tokenising: longest unit first ────────────────────────────────────────
  private tokenise(sentence: string, phrases = true): Token[] {
    const raw = sentence.split(/\s+/).filter(Boolean).map((w) => {
      // closing quotes after punctuation are dropped; a word-final apostrophe (ayin: "sham'") is kept
      const m = /^([("“«'‘]*)(.*?)([)"”».,;:!?…]+['’"”]*|[)"”»]*)$/.exec(w) ?? ['', '', w, ''];
      return { text: m[2] ?? w, punct: m[3] ?? '' };
    }).filter((w) => /[\p{L}\p{N}]/u.test(w.text));
    const tokens: Token[] = [];
    const verbs = this.verbs();
    let i = 0;
    while (i < raw.length) {
      let taken = 0;
      const lit = this.literalContinuous(raw.slice(i, i + 3).map((w) => w.text), raw.slice(i, i + 2).some((w) => w.punct));
      if (lit) {
        const span = raw.slice(i, i + lit.words);
        const text = span.map((w) => w.text).join(' ');
        tokens.push({ text, latin: sentenceKey(text), readings: [this.verbReading(lit.hit)], suggestions: [], chosen: 0, punct: span[lit.words - 1]!.punct });
        i += lit.words; continue;
      }
      for (let n = Math.min(Math.max(4, this.maxVerbWords), raw.length - i); n >= 2 && !taken; n--) {
        const span = raw.slice(i, i + n);
        if (span.slice(0, -1).some((w) => w.punct)) continue;      // a unit never crosses punctuation
        const text = span.map((w) => w.text).join(' ');
        const key = sentenceKey(text);
        const readings: Reading[] = [...this.direct(key), ...(verbs.get(key) ?? []).map((h) => this.verbReading(h))];
        const ex = phrases && n <= 4 && !readings.length ? this.sentences.get(key)?.[0] : undefined;
        if (ex?.en) readings.push({ kind: 'phrase', lemma: ex.bux, pos: 'phrase', gloss: ex.en.replace(/[.!]+$/, ''), glosses: [ex.en], parts: [], f: {}, rows: [ex.source.row], spelling: 'exact', forms: [] });
        if (readings.length) { tokens.push({ text, latin: key, readings, suggestions: [], chosen: 0, punct: span[n - 1]!.punct }); taken = n; }
      }
      if (!taken) {
        const w = raw[i]!;
        let readings = this.analyse(w.text);
        // A capitalised word the source does not have, not at the start: a name, kept as written.
        if (!readings.length && i > 0 && /^\p{Lu}/u.test(w.text)) readings = [{ kind: 'name', lemma: w.text, pos: 'proper_noun', gloss: w.text, glosses: [w.text], parts: [], f: {}, rows: [], spelling: 'exact', forms: [] }];
        tokens.push({ text: w.text, latin: sentenceKey(w.text), readings, suggestions: readings.length ? [] : this.suggest(w.text), chosen: 0, punct: w.punct });
        taken = 1;
      }
      i += taken;
    }
    return tokens;
  }

  // ── public entry point ────────────────────────────────────────────────────
  translate(input: string): Reverse {
    const typed = (input ?? '').slice(0, 2000).trim();
    const latin = sentenceKey(typed);
    const base = { script: detectScript(typed), latin, printed: [], unknown: [], notes: [], factors: [], tokens: [] as Token[] };
    if (!latin) return { ...base, status: 'none', english: null, confidence: 0, tier: 'none' };

    // 1. printed sentence / phrase / proverb
    const printed = this.sentences.get(latin);
    const tokensAll = typed.split(/(?<=[.!?;])\s+/).flatMap((s) => this.pick(this.tokenise(s, false)));
    if (printed?.length) {
      return {
        ...base, status: 'exact', english: printed[0]!.en, confidence: 1, tier: 'high', factors: ['printed in the source'],
        tokens: tokensAll, printed: printed.map((e) => ({ en: e.en ?? '', bux: e.bux, row: e.source.row })),
        notes: printed[0]!.analysis ? [printed[0]!.analysis] : [],
      };
    }
    // 2. a single unit that is a dictionary entry
    if (tokensAll.length === 1) {
      const t = tokensAll[0]!;
      const r = t.readings[t.chosen];
      if (!r) return { ...base, status: 'none', english: null, confidence: 0, tier: 'none', tokens: [t], unknown: [t.text], notes: [t.suggestions.length ? 'Not in the source under this spelling.' : 'Not found in the source, in any spelling.'] };
      const plain = (r.kind === 'entry' || r.kind === 'inflected' || r.kind === 'phrase') && !r.parts.some((p) => p.form.startsWith('-')) && r.spelling === 'exact';
      if (plain) {
        const same = t.readings.filter((x) => x.kind !== 'verb' && !x.parts.some((p) => p.form.startsWith('-')));
        return {
          ...base, status: 'exact', english: [...new Set(same.flatMap((x) => x.glosses))].slice(0, 6).join('; '), confidence: 1, tier: 'high',
          factors: ['printed in the source'], tokens: [t], printed: [],
        };
      }
    }
    // 3. sentence by sentence
    const parts = typed.split(/(?<=[.!?;])\s+/).filter((s) => sentenceKey(s));
    const built = parts.map((s) => this.sentence(s));
    const tokens = built.flatMap((b) => b.tokens);
    const unknown = [...new Set(tokens.filter((t) => !t.readings[t.chosen]).map((t) => t.text))];
    const recognised = tokens.filter((t) => t.readings[t.chosen]).length;
    if (!recognised) return { ...base, status: 'none', english: null, confidence: 0, tier: 'none', tokens, unknown, notes: ['None of these words are in the source.'] };
    const allBuilt = built.every((b) => b.english);
    const status: Reverse['status'] = allBuilt ? (built.every((b) => b.printed) ? 'exact' : 'built') : 'gloss';
    const confidence = allBuilt ? Math.round(Math.min(...built.map((b) => b.confidence)) * 100) / 100 : 0;
    const notes = [...new Set(built.flatMap((b) => b.notes))];
    if (unknown.length) notes.unshift(`Not in the source (kept as typed): ${unknown.join(', ')}.`);
    if (tokens.some((t) => t.readings[t.chosen] && t.readings[t.chosen]!.spelling !== 'exact')) notes.push('Some words were matched without their accents or apostrophes (ü, ʼ).');
    return {
      ...base, status, tokens, unknown, notes,
      english: allBuilt ? built.map((b, k) => (k < built.length - 1 && !/[.!?]$/.test(b.english ?? '') ? `${b.english}.` : b.english)).join(' ') : null,
      confidence, tier: !allBuilt ? 'none' : status === 'exact' ? 'high' : confidence >= TIER_HIGH ? 'high' : confidence >= TIER_LOW ? 'medium' : 'low',
      factors: [...new Set(built.flatMap((b) => b.factors))],
      printed: built.flatMap((b) => (b.printed ? [b.printed] : [])),
    };
  }

  /**
   * Choose one reading per word from its place in the sentence: the verb comes last, ezafe
   * needs a following word, "to be" closes a clause that has no verb, and grammar words
   * (pronouns, prepositions, adverbs) win over a noun spelled the same way.
   */
  private pick(tokens: Token[]): Token[] {
    const hasVerb = tokens.some((t) => t.readings.some((r) => r.kind === 'verb'));
    const single = tokens.length === 1;
    const asks = tokens.some((t) => t.punct.includes('?'));
    const subject3pl = (i: number) => tokens.slice(0, i).some((x) => x.readings.some((y) => y.pos === 'pronoun' && /they/i.test(y.gloss)));
    tokens.forEach((t, i) => {
      const last = i === tokens.length - 1 || !!t.punct;
      const rank = (r: Reading): number => {
        let s = 0;
        if (r.spelling !== 'exact') s += 1;
        s += r.parts.filter((p) => p.form.startsWith('-')).length * 2;
        if (r.kind === 'verb') s += last ? -3 : 1;
        // "zan" is "woman" before it is the command "beat!": a bare imperative needs "!" to win over a noun
        if (r.f.verb?.tense === 'imperative' && !t.punct.includes('!') && t.readings.some((x) => x.kind === 'entry')) s += 5;
        if (r.kind === 'entry' && r.pos === 'verb' && !r.parts.length) s -= subject3pl(i) ? 0 : 4;   // "dodan" is the infinitive unless "they" precedes
        if (r.f.and && last) s += 20;                                   // -u "and" needs a following word
        if (r.f.ezafe) s += last ? 20 : -1;
        if (r.f.copula) {
          // -am is "my" on a noun and "I am" on an adjective or after the pronoun "man"
          const subjectBefore = tokens.slice(0, i).some((x) => x.readings.some((y) => y.pos === 'pronoun' && !y.parts.length));
          s += !last || hasVerb ? 20 : r.pos === 'adjective' || (subjectBefore && !single) ? -1 : 3;
        }
        if (r.f.indefinite) s += 3;
        if (r.f.and) s += 2;
        if (r.f.particle) s += 6;
        if (r.register === 'literal') s += 0.5;
        if (r.pos === 'pronoun' || r.pos === 'preposition' || r.pos === 'adverb' || r.pos === 'conjunction') s -= 1;
        if (r.pos === 'proper_noun') s += /^\p{Lu}/u.test(t.text) && i > 0 ? -1 : 4;
        if (asks && /\?$/.test(r.gloss)) s -= 2;                       // "ki" is "who?" in a question, "that" otherwise
        return s;
      };
      let best = 0;
      t.readings.forEach((r, k) => { if (rank(r) < rank(t.readings[best]!)) best = k; });
      // a reading that cannot stand in this position (ezafe at the end, …) is not a reading
      t.chosen = t.readings.length && rank(t.readings[best]!) >= 15 ? -1 : best;
    });
    return tokens;
  }

  /** Word-by-word analysis of a Buxori text (also used to explain English → Buxori output). */
  breakdown(text: string): Token[] {
    return text.split(/(?<=[.!?;])\s+/).filter((x) => sentenceKey(x)).flatMap((x) => this.pick(this.tokenise(x, false)));
  }

  /** Other source words glossed with the same English as this reading ("Sunday": yakshanbe, yakshabot). */
  synonyms(r: Reading): { text: string; gloss: string; rows: number[] }[] {
    if (!r.root) return [];
    const out = new Map<string, { text: string; gloss: string; rows: number[] }>();
    for (const g of r.root.glosses) for (const id of this.index.roots.byGloss[g.key] ?? []) {
      const o = this.index.roots.entries[id];
      if (o && o.id !== r.root.id && o.pos === r.root.pos && !out.has(o.lemma.key)) out.set(o.lemma.key, { text: o.lemma.text, gloss: g.text, rows: o.sources.map((x) => x.row) });
    }
    return [...out.values()].slice(0, 6);
  }

  /** Word-by-word English, in Buxori order. */
  static gloss(tokens: Token[]): string {
    return tokens.map((t) => {
      const r = t.readings[t.chosen];
      if (!r) return `⟨${t.text}⟩`;
      const tags = r.parts.filter((p) => p.form.startsWith('-') || p.label === 'tense' || p.label === 'person' || p.form === 'na-').map((p) => (p.label === 'tense' || p.label === 'person' ? p.form : p.label.replace(/^possessive: /, '').replace(/^“to be”: /, 'is/am/are: ')));
      return r.gloss.replace(/^to /, '') + (tags.length ? ` [${tags.join(', ')}]` : '');
    }).join(' · ');
  }

  // ── sentences of several clauses ──────────────────────────────────────────
  /**
   * Clauses the source joins with a comma and a conjunction are rendered one at a time and
   * put back together in English:
   *
   *   Agar X, Y                 →  If X, Y
   *   Kay-ki X, Y / Vaqte ki X, Y  →  When X, Y        (stated rule: kay-ki, Literal vaqte ki)
   *   X, ki Y                   →  X that Y
   *   X, azbaski / amo / lekin Y →  X, because / but Y
   *   N-e, ki X, Y              →  The N who X Y        ("-e comes before the conjunction ki,
   *                                 marking what follows as a defining subordinate clause")
   *
   * Anything else goes to clause() unchanged.
   */
  private sentence(text: string): ReturnType<ReverseEngine['clause']> {
    const whole = this.sentences.get(sentenceKey(text))?.[0];
    const parts = text.split(/,\s+/).map((x) => x.trim()).filter((x) => sentenceKey(x));
    if (whole?.en || parts.length < 2 || parts.length > 3) return this.clause(text);
    const end = /[.!?]+\s*$/.exec(text)?.[0].trim() ?? '';
    const WHEN = /^(kay-ki|vaqte ki)\s+/i;
    const conjOf = (seg: string): { en: string; rest: string; word: string } | null => {
      const w = WHEN.exec(seg);
      if (w && this.index.syntaxRules.some((r) => r.id === 'subordinate_clauses_of_time')) return { en: 'when', rest: seg.slice(w[0].length), word: w[1]! };
      const first = seg.split(/\s+/)[0] ?? '';
      const r = this.direct(sentenceKey(first)).find((x) => x.pos === 'conjunction' && x.lemma.toLowerCase() !== 'vay');
      const en = r ? (r.gloss.split(';')[0] ?? '').trim().toLowerCase() : '';
      return r && /^(if|that|because|but|however|and|or)$/.test(en) ? { en: en === 'however' ? 'but' : en, rest: seg.slice(first.length).trim(), word: first } : null;
    };
    const conjToken = (word: string, en: string): Token => ({
      text: word, latin: sentenceKey(word), suggestions: [], chosen: 0, punct: '',
      readings: [this.direct(sentenceKey(word)).find((x) => x.pos === 'conjunction') ?? { kind: 'entry', lemma: word, pos: 'conjunction', gloss: en, glosses: [en], parts: [], f: {}, rows: this.index.syntaxRules.find((r) => r.id === 'subordinate_clauses_of_time')?.sources.map((x) => x.row) ?? [], spelling: 'exact', forms: [] }],
    });
    const lower = (e: string) => (/^(I\b|[A-Z][a-z]+’s)/.test(e) || /^[A-Z][a-z]+ /.test(e) && !/^(He\/she|They|We|You|The|This|That|My|Your|His\/her|Our|Their|A|An|It|There|Where|What|Who|When|Do|Does|Did|Is|Are|Was|Were)\b/.test(e) ? e : e.charAt(0).toLowerCase() + e.slice(1));
    // no final punctuation, and none of the book's "(sing.)" / "(polite)" labels inside a longer sentence
    const bare = (e: string) => e.replace(/\s*\((sing|polite|pol|pl|plural)\.?\)/gi, '').replace(/[.!?]+$/, '').trim();
    const fail = (): ReturnType<ReverseEngine['clause']> => this.clause(text);
    const join = (subs: ReturnType<ReverseEngine['clause']>[], english: string, tokens: Token[], why: string) => ({
      english: english.charAt(0).toUpperCase() + english.slice(1) + (end || '.'),
      // every clause has to be right, so their confidences multiply; no joined sentence has been
      // measured on the held-out set, so none is allowed to reach the high tier on trust
      confidence: Math.min(subs.reduce((c, x) => c * x.confidence, 0.9), TIER_HIGH - 0.01),
      factors: [...new Set([why, ...subs.flatMap((x) => x.factors)])], tokens, notes: [...new Set(subs.flatMap((x) => x.notes))],
    });

    // N-e, ki X, Y: a defining clause on a noun
    const lead = conjOf(parts[0]!);
    const second = conjOf(parts[1]!);
    const headToks = this.pick(this.tokenise(parts[0]!, false));
    // ("marde" is also printed on its own as an example of -e; the reading with the suffix is the one that matters here)
    const head = headToks.length === 1 ? headToks[0]!.readings.find((r) => r.f.indefinite) ?? headToks[0]!.readings[headToks[0]!.chosen] : undefined;
    if (head?.f.indefinite && headToks[0]) headToks[0].chosen = headToks[0].readings.indexOf(head);
    if (!lead && second?.en === 'that' && parts.length === 3 && head?.f.indefinite && second.rest) {
      const relToks = this.pick(this.tokenise(second.rest, false));
      const verb = relToks.map((t) => t.readings[t.chosen]).find((r) => r?.kind === 'verb');
      const ownSubject = relToks.some((t) => t.readings[t.chosen]?.pos === 'pronoun' && !t.readings[t.chosen]!.f.object && !t.readings[t.chosen]!.f.to) || (!!verb?.f.verb && !verb.f.verb.pn.startsWith('3'));
      const rel = this.clause(ownSubject ? second.rest : `Ü ${second.rest}`);
      const main = this.clause(`Ü ${parts[2]}`);
      if (!rel.english || !main.english || !/^He\/she /.test(main.english) || (!ownSubject && !/^He\/she /.test(rel.english))) return fail();
      const noun = (head.gloss.split(/[;,]/)[0] ?? '').replace(/\s*\([^)]*\)/g, '').replace(/^(a|an|the) /, '').trim();
      const relEn = ownSubject ? `that ${lower(bare(rel.english))}` : `who ${bare(rel.english).replace(/^He\/she /, '')}`;
      const english = `the ${noun} ${relEn} ${bare(main.english).replace(/^He\/she /, '')}`;
      const tokens = [...headToks, conjToken(second.word, 'who / that'), ...(ownSubject ? rel.tokens : rel.tokens.slice(1)), ...main.tokens.slice(1)];
      return join([rel, main], english, tokens, 'a defining clause (-e + ki) threaded into the main clause');
    }
    if (parts.length !== 2) return fail();
    // Agar X, Y  /  Kay-ki X, Y
    if (lead && (lead.en === 'if' || lead.en === 'when') && lead.rest) {
      const a = this.clause(lead.rest), b = this.clause(parts[1]!);
      if (!a.english || !b.english) return fail();
      return join([a, b], `${lead.en} ${lower(bare(a.english))}, ${lower(bare(b.english))}`, [conjToken(lead.word, lead.en), ...a.tokens, ...b.tokens], 'two clauses joined by a pattern the source prints');
    }
    // X, ki Y  /  X, azbaski Y  /  X, amo Y
    if (!lead && second && second.rest && second.en !== 'if') {
      const a = this.clause(parts[0]!), b = this.clause(second.rest);
      if (!a.english || !b.english) return fail();
      const glue = second.en === 'that' ? ' that ' : `, ${second.en} `;
      return join([a, b], `${bare(a.english)}${glue}${lower(bare(b.english))}`, [...a.tokens, conjToken(second.word, second.en), ...b.tokens], 'two clauses joined by a pattern the source prints');
    }
    return fail();
  }

  // ── one clause: choose readings in context, chunk, re-order ───────────────
  private clause(text: string): { english: string | null; confidence: number; factors: string[]; tokens: Token[]; notes: string[]; printed?: { en: string; bux: string; row: number } } {
    const key = sentenceKey(text);
    const tokens = this.tokenise(text);
    const ex = this.sentences.get(key)?.[0];
    if (ex?.en) return { english: ex.en, confidence: 1, factors: ['printed in the source'], tokens: this.pick(this.tokenise(text, false)), notes: [], printed: { en: ex.en, bux: ex.bux, row: ex.source.row } };
    const question = /\?\s*$/.test(text);
    const exclaim = /!\s*$/.test(text);
    const notes: string[] = [];

    this.pick(tokens);
    const R = (i: number) => tokens[i]?.readings[tokens[i]!.chosen];

    // --- chunk ---
    type NP = { en: string; dem?: string; coord?: true; pronoun?: PersonNumber; plural: boolean; object: boolean; to: boolean; copula?: PersonNumber; wh: boolean; bare: boolean; headPos: PartOfSpeech; and: boolean };
    type Chunk = { t: 'np'; np: NP } | { t: 'pp'; en: string } | { t: 'adv'; en: string } | { t: 'verb'; r: Reading } | { t: 'conj'; en: string } | { t: 'be'; neg: boolean; pn: PersonNumber } | { t: 'raw'; en: string } | { t: 'must' } | { t: 'done'; en: string };
    const chunks: Chunk[] = [];
    let content = 0, ambiguous = 0, failed = false, infinitives = 0;
    const sense = (r: Reading) => (r.gloss.replace(/\s*\([^)]*\)?/g, ' ').split(/[;,]/)[0] ?? '').replace(/\?\s*$/, '').replace(/\s+/g, ' ').trim().replace(/^to /, '').replace(/^(a|an|the) /, '');
    const PRON: Record<string, PersonNumber> = { i: '1sg', you: '2sg', 'he; she': '3sg', he: '3sg', we: '1pl', they: '3pl' };
    const pronounOf = (r: Reading): PersonNumber | undefined => {
      if (r.pos !== 'pronoun') return undefined;
      const k = r.glosses.join('; ').toLowerCase();
      if (r.lemma.toLowerCase() === 'shumo') return '2pol';
      return PRON[k] ?? PRON[r.glosses[0]?.toLowerCase() ?? ''] ?? (/they/.test(k) ? '3pl' : undefined);
    };
    const isWh = (r: Reading) => /\?$/.test(r.gloss) || /^(what|who|where|when|why|how|which|how much|how many)$/i.test(r.gloss);
    const isAdj = (r: Reading) => r.pos === 'adjective' || ADJECTIVES.has(sense(r).toLowerCase());
    const isDem = (r: Reading) => /^(this|that|these|those)$/i.test(r.glosses[0] ?? '') && r.lemma.toLowerCase() !== 'ki';
    const count = (r: Reading) => {
      if (r.kind === 'name' || r.pos === 'pronoun' || r.pos === 'proper_noun' || r.pos === 'numeral' || isDem(r) || isWh(r)) return;
      content++;
      const t = tokens.find((x) => x.readings[x.chosen] === r);
      if (t && new Set(t.readings.filter((x) => x.spelling === 'exact' && x.kind !== 'verb' === (r.kind !== 'verb')).map((x) => x.lemma.toLowerCase())).size > 1) ambiguous++;
    };

    const parseNP = (start: number): { np: NP; next: number } | null => {
      let i = start;
      const pre: string[] = [];
      let number: number | null = null, det = '';
      let r = R(i);
      if (r && isDem(r) && R(i + 1) && NOMINAL.includes(R(i + 1)!.pos) && R(i + 1)!.kind !== 'verb' && !isWh(R(i + 1)!) && !R(i)!.f.object) { det = r.glosses[0]!.toLowerCase(); i++; r = R(i); }
      // numerals: "bistu panj" (twenty-and five), "seta" (three + counting suffix)
      const NUM = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'];
      const valueOf = (x: Reading | undefined) => (!x || x.pos !== 'numeral' || x.f.ordinal ? null : x.root?.numeric?.kind === 'cardinal' ? x.root.numeric.value : x.kind === 'number' ? Number(x.lemma) : null);
      let lastNum: Reading | undefined;
      while (valueOf(r) !== null) { number = (number ?? 0) + valueOf(r)!; lastNum = r; i++; r = R(i); }
      if (number !== null && (!r || r.kind === 'verb' || !NOMINAL.includes(r.pos) || isWh(r))) {
        // a number on its own
        return { np: { en: NUM[number] ?? String(number), plural: number !== 1, object: !!lastNum?.f.object, to: !!lastNum?.f.to, wh: false, bare: false, headPos: 'numeral', and: !!lastNum?.f.and, ...(lastNum?.f.copula ? { copula: lastNum.f.copula } : {}) }, next: i };
      }
      if (!r || r.kind === 'verb' || !NOMINAL.includes(r.pos)) return null;
      const head = r;
      const headIdx = i;
      count(head);
      const adjs: string[] = [];
      let possessor = '', poss: PersonNumber | undefined = head.f.poss;
      let lastR = head;
      i++;
      // ezafe chain: head-i modifier(-i modifier …)
      while (lastR.f.ezafe && R(i) && R(i)!.kind !== 'verb' && NOMINAL.includes(R(i)!.pos)) {
        const m = R(i)!;
        const pn = pronounOf(m);
        if (pn) possessor = POSSESSIVE[pn];
        else if (isAdj(m) || (m.pos === 'numeral' && m.f.ordinal)) { adjs.push(m.f.comparative ? `${sense(m)}er` : sense(m)); count(m); }
        else {
          const sub = parseNP(i);
          if (!sub) break;
          possessor = (m.pos === 'proper_noun' || m.kind === 'name') && sub.next === i + 1 ? `${sub.np.en}’s` : `of ${sub.np.en}`;
          lastR = R(sub.next - 1) ?? m; i = sub.next;
          poss = poss ?? lastR.f.poss;
          continue;
        }
        poss = poss ?? m.f.poss;
        lastR = m; i++;
      }
      const pn = pronounOf(head);
      const plural = !!head.f.plural || (number !== null && number !== 1) || (head.kind === 'inflected' && head.parts.some((p) => /^plural/.test(p.label)));
      let noun = head.kind === 'inflected' || head.kind === 'phrase' ? head.gloss : sense(head);
      if (head.f.ordinal) noun = head.root?.numeric?.kind === 'cardinal' ? ordinalOf(head.root.numeric.value) : `${noun} (ordinal)`;
      if (plural && head.pos !== 'pronoun' && head.kind === 'entry' && head.pos !== 'numeral') noun = pluralOf(noun);
      if (head.f.comparative) noun = /^\w+$/.test(noun) && noun.length <= 5 ? noun + 'er' : `more ${noun}`;
      const owner = poss ? POSSESSIVE[poss] : possessor && !possessor.startsWith('of ') ? possessor : '';
      const demSubject = det && owner ? det : '';
      const words = [demSubject ? owner : det || owner, number !== null ? NUM[number] ?? String(number) : '', ...adjs, noun, possessor.startsWith('of ') ? possessor : ''].filter(Boolean);
      const np: NP = {
        en: words.join(' '), plural, object: !!lastR.f.object, to: !!lastR.f.to, wh: isWh(head), and: !!lastR.f.and,
        bare: !det && !owner && number === null && (head.kind === 'entry' || (head.kind === 'inflected' && !head.parts.some((p) => /possessive|ezafe/.test(p.label)))) && (head.pos === 'noun') && !isAdj(head) && !isWh(head) && !isDem(head),
        headPos: isAdj(head) ? 'adjective' : head.pos, ...(demSubject ? { dem: demSubject } : {}), ...(pn ? { pronoun: pn } : {}), ...(lastR.f.copula ? { copula: lastR.f.copula } : head.f.copula ? { copula: head.f.copula } : {}),
      };
      void headIdx;
      return { np, next: i };
    };

    for (let i = 0; i < tokens.length;) {
      const r = R(i);
      if (!r) { chunks.push({ t: 'raw', en: `⟨${tokens[i]!.text}⟩` }); failed = true; i++; continue; }
      if (r.kind === 'verb') { chunks.push({ t: 'verb', r }); count(r); i++; continue; }
      if (r.kind === 'phrase') { chunks.push({ t: 'done', en: r.gloss }); i++; continue; }
      if (r.pos === 'verb' && r.f.want) {
        const be = R(i + 1);
        const isBe = !!be && /^(hast|nest)$/.test(be.lemma.toLowerCase());
        chunks.push({ t: 'verb', r: { ...r, kind: 'verb', gloss: `to want to ${sense(r)}`, f: { verb: { tense: 'present', pn: (isBe ? be!.f.copula : undefined) ?? '3sg', negative: isBe && be!.lemma.toLowerCase() === 'nest' } } } });
        count(r); i += isBe ? 2 : 1; continue;
      }
      if (r.pos === 'verb') { chunks.push({ t: 'pp', en: r.gloss.split(';')[0]!.trim() }); infinitives++; count(r); i++; continue; }   // an infinitive: "to give"      // a printed phrase is already English
      const low = r.lemma.toLowerCase();
      if (r.pos === 'particle' || low === 'nest' || low === 'hast') {
        chunks.push({ t: 'be', neg: /not/.test(r.gloss), pn: r.f.copula ?? '3sg' }); i++; continue;
      }
      if (/^must$/i.test(r.glosses[0] ?? '')) { chunks.push({ t: 'must' }); i++; continue; }
      if (r.pos === 'conjunction' && (!isDem(r) || r.lemma.toLowerCase() === 'ki')) {
        // "man va tu": two noun phrases joined into one
        const prev = chunks[chunks.length - 1];
        const next = /^(and|or)$/.test(sense(r)) && prev?.t === 'np' && !prev.np.copula ? parseNP(i + 1) : null;
        if (next && prev?.t === 'np' && !next.np.to) {
          const side = (n: NP) => (n.pronoun ? subjectPronoun(n.pronoun) : n.en);
          chunks[chunks.length - 1] = { t: 'np', np: { ...next.np, en: `${side(prev.np)} ${sense(r)} ${side(next.np)}`, plural: true, bare: false, wh: false, coord: true } };
          delete (chunks[chunks.length - 1] as { np: NP }).np.pronoun;
          i = next.next; continue;
        }
        chunks.push({ t: 'conj', en: sense(r) }); i++; continue;
      }
      if (r.pos === 'preposition') {
        const post = /^with$/i.test(r.glosses[0] ?? '');      // qati follows its noun
        const prev = chunks[chunks.length - 1];
        if (post && prev?.t === 'np') { chunks[chunks.length - 1] = { t: 'pp', en: `with ${objectForm(prev.np)}` }; i++; continue; }
        const sub = parseNP(i + 1);
        if (sub) { chunks.push({ t: 'pp', en: `${r.lemma.toLowerCase() === 'ba' ? BA : sense(r)} ${objectForm(sub.np)}` }); i = sub.next; continue; }
        chunks.push({ t: 'raw', en: sense(r) }); failed = true; i++; continue;
      }
      if (r.pos === 'adverb' && !r.f.copula && !r.f.ezafe) { chunks.push({ t: 'adv', en: sense(r).split(';')[0]!.trim() }); count(r); i++; continue; }
      const sub = parseNP(i);
      if (sub && /^how (much|many)$/.test(sub.np.en)) {
        const counted = parseNP(sub.next);
        if (counted && !counted.np.pronoun) { chunks.push({ t: 'np', np: { ...counted.np, en: `${sub.np.en} ${counted.np.en}`, wh: true, bare: false } }); i = counted.next; continue; }
      }
      if (sub && !sub.np.to && tokens[sub.next - 1]?.punct.includes(',') && !chunks.some((c) => c.t === 'verb')) {
        // "man, tu va ü": a comma-separated list is one noun phrase
        const next = parseNP(sub.next);
        const after = next ? R(next.next) : undefined;
        if (next && !next.np.to && (next.np.and || (after?.pos === 'conjunction' && /^(and|or)$/.test(sense(after))))) {
          const side = (n: NP) => (n.pronoun ? subjectPronoun(n.pronoun) : n.en);
          const np: NP = { ...next.np, en: `${side(sub.np)}, ${side(next.np)}`, plural: true, bare: false, wh: false, coord: true };
          delete np.pronoun;
          chunks.push({ t: 'np', np }); i = next.next; continue;
        }
      }
      if (sub?.np.and) {
        // "akayu uka": -u joins this noun phrase to the next one
        const next = parseNP(sub.next);
        if (next) {
          const side = (n: NP) => (n.pronoun ? subjectPronoun(n.pronoun) : n.en);
          const np: NP = { ...next.np, en: `${side(sub.np)} and ${side(next.np)}`, plural: true, bare: false, wh: false, coord: true, and: false };
          delete np.pronoun;
          chunks.push({ t: 'np', np }); i = next.next; continue;
        }
      }
      if (sub?.np.dem) chunks.push({ t: 'np', np: { en: sub.np.dem, plural: /^(these|those)$/.test(sub.np.dem), object: false, to: false, wh: false, bare: false, headPos: 'pronoun', and: false, dem: sub.np.dem } });
      if (sub) { chunks.push(sub.np.to ? { t: 'pp', en: `${BA} ${objectForm(sub.np)}` } : { t: 'np', np: sub.np }); if (sub.np.and) chunks.push({ t: 'conj', en: 'and' }); i = sub.next; continue; }
      chunks.push({ t: 'raw', en: sense(r) }); failed = true; i++;
    }
    function objectForm(np: NP): string { return np.pronoun ? OBJECT_FORM[subjectPronoun(np.pronoun).toLowerCase()] ?? np.en : withArticle(np, 'object'); }
    function withArticle(np: NP, role: 'subject' | 'object' | 'predicate'): string {
      if (!np.bare) return np.en;
      const first = np.en.split(' ')[0] ?? '';
      const mass = MASS.has(np.en.split(' ').pop() ?? '');
      if (role === 'subject' || np.object) return `the ${np.en}`;
      if (np.plural || mass) return np.en;
      return `${articleFor(first)} ${np.en}`;
    }

    // --- render each clause (split at conjunctions that follow a verb) ---
    const clauses: Chunk[][] = [[]];
    const joins: string[] = [];
    for (const c of chunks) {
      const cur = clauses[clauses.length - 1]!;
      if (c.t === 'conj' && cur.some((x) => x.t === 'verb' || x.t === 'be' || x.t === 'done' || (x.t === 'np' && x.np.copula))) { joins.push(c.en); clauses.push([]); } else cur.push(c);
    }
    // noun + infinitive with no conjugated verb is a dictionary-style compound ("maza didan"), not a sentence
    if (infinitives && !chunks.some((c) => c.t === 'verb') && chunks.length > 1) failed = true;
    const rendered: string[] = [];
    let fragment = false, inferred = false, sentenceLike = false, mismatch = false;
    for (const cl of clauses) {
      if (!cl.length) continue;
      const verbs = cl.filter((c): c is Extract<Chunk, { t: 'verb' }> => c.t === 'verb');
      const nps = cl.filter((c): c is Extract<Chunk, { t: 'np' }> => c.t === 'np').map((c) => c.np);
      const verbBase = verbs[verbs.length - 1]?.r.gloss.replace(/^to /, '').split(/[ ;]/)[0] ?? '';
      const ba = MOTION.has(verbBase) ? 'to' : verbs.length ? 'in' : 'at';      // "ba" is to / at / in: the verb decides
      const extras = [...cl.filter((c) => c.t === 'pp' || c.t === 'raw' || c.t === 'conj'), ...cl.filter((c) => c.t === 'adv')].map((c) => (c as { en: string }).en.replace(BA, ba));
      if (cl.every((c) => c.t === 'done')) { rendered.push(cl.map((c) => (c as { en: string }).en).join(' ')); continue; }
      if (cl.some((c) => c.t === 'done')) {
        // a printed phrase plus time/place words: "Imrüz | man kor namekunam"
        if (cl.every((c) => c.t === 'done' || c.t === 'adv' || c.t === 'pp')) { rendered.push([...cl.filter((c) => c.t === 'done').map((c) => (c as { en: string }).en), ...extras].join(' ')); continue; }
        failed = true;
      }
      const beChunk = cl.find((c): c is Extract<Chunk, { t: 'be' }> => c.t === 'be');
      const must = cl.some((c) => c.t === 'must');
      if (verbs.length > 1) { failed = true; notes.push('More than one verb in a clause: the English order may be off.'); }
      const verb = verbs[verbs.length - 1]?.r;
      const wh = nps.find((n) => n.wh);
      // "az kujo" = "where from?": English puts the preposition at the end
      const stranded = wh ? /^(where|what|who|whom) (from|to|with|for|about)$/i.exec(wh.en) : null;
      if (wh && stranded) { wh.en = stranded[1]!; extras.push(stranded[2]!); }
      const rest = nps.filter((n) => n !== wh);
      let out = '';
      if (verb?.f.verb || beChunk || rest.some((n) => n.copula) || (rest.length + (wh ? 1 : 0) > 1)) sentenceLike = true;
      if (verb?.f.verb) {
        const { tense, pn, negative, alsoFuture } = verb.f.verb;
        const imperative = tense === 'imperative';
        const subjIdx = rest.findIndex((n) => !n.object && (n.pronoun ? true : true));
        let subject = imperative ? undefined : rest.find((n) => n.pronoun && !n.object) ?? (rest.length > 1 || (rest[0] && !rest[0].object && pn.startsWith('3') && !(wh && !wh.object)) ? rest.find((n) => !n.object) : undefined);
        void subjIdx;
        // a bare noun before a 1st/2nd person verb is its object, not its subject
        const coord = rest.find((n) => n.coord && !n.object);
        if (coord && !rest.some((n) => n.pronoun && n !== coord)) subject = coord;
        else if (subject && !subject.pronoun && !pn.startsWith('3')) subject = undefined;
        const objects = rest.filter((n) => n !== subject);
        const whIsSubject = !!wh && !subject && pn.startsWith('3') && !wh.object && /^(who|what)/i.test(wh.en);
        const subjEn = whIsSubject ? '' : subject ? (subject.pronoun ? subjectPronoun(pn === '2pol' && subject.pronoun.startsWith('2') ? '2pol' : subject.pronoun) : withArticle(subject, 'subject')) : imperative ? '' : subjectPronoun(pn);
        const base = verb.gloss.replace(/^to /, '').split(';')[0]!.replace(/\(.*?\)/g, '').trim();
        // "Mo megufted": the pronoun and the verb ending disagree. Say so instead of hiding it.
        const fam = (p: PersonNumber) => (p.startsWith('2') ? '2' : p === '3resp' ? '3sg' : p);
        if (subject?.pronoun && fam(subject.pronoun) !== fam(pn)) {
          mismatch = true;
          notes.push(`The subject (${subjectPronoun(subject.pronoun)}) and the verb ending (${PERSON_LABEL[pn]}) do not agree; the English follows the subject.`);
        }
        const agree: PersonNumber = subject?.coord ? '3pl' : subject && !subject.pronoun ? (subject.plural ? '3pl' : '3sg') : pn;
        const vp: VerbPhrase = must ? { aux: 'must', not: negative, main: base } : verbPhrase(base, tense, agree, negative);
        if (vp.note) notes.push(vp.note);
        if (alsoFuture && !must) notes.push(`${tokens.find((t) => t.readings[t.chosen] === verb)?.text}: the same form also means the future (“will ${base}”).`);
        const objEn = objects.map((n) => objectForm(n)).join(' ');
        const tail = [objEn, ...extras].filter(Boolean).join(' ');
        if (question && !whIsSubject && !imperative) {
          const inv = vp.aux ? { aux: vp.aux, main: [vp.not ? 'not' : '', vp.main].filter(Boolean).join(' ') } : withDoSupport(base, tense, agree);
          out = [wh ? wh.en : '', inv.aux, subjEn, inv.main, tail].filter(Boolean).join(' ');
        } else {
          out = [whIsSubject ? wh!.en : '', subjEn, vpText(vp), tail, wh && !whIsSubject && !question ? wh.en : ''].filter(Boolean).join(' ');
        }
        if (!subject && !imperative && !whIsSubject && rest.filter((n) => !n.object).length > 1) failed = true;
      } else {
        // no verb: "to be". Subject + (am/is/are) + predicate; the 3rd person has no ending.
        const predIdx = rest.findIndex((n) => n.copula);
        const cop = predIdx >= 0 ? rest[predIdx]!.copula! : beChunk?.pn ?? '3sg';
        const subject = rest.find((n, k) => k !== predIdx && (n.pronoun || rest.length > 1 || !!wh || extras.length > 0)) ?? (rest.length > 1 ? rest[0] : undefined);
        const preds = rest.filter((n) => n !== subject);
        if (rest.length === 1 && !rest[0]!.copula && !beChunk && !extras.length && !wh) {
          out = rest[0]!.pronoun ? subjectPronoun(rest[0]!.pronoun) : rest[0]!.en;
        } else if (!subject && predIdx < 0 && !beChunk && !wh) {
          // no subject and nothing marking "to be": a fragment, rendered as it stands
          out = [...rest.map((n) => n.en), ...extras].join(' ');
          fragment = true;
        } else if (!preds.length && !extras.length && !wh) {
          // a lone noun phrase: nothing to assert, so render it as it is
          out = subject ? withArticle(subject, 'predicate') : '';
          if (!out) failed = true;
        } else {
          const pn: PersonNumber = subject?.pronoun ?? (predIdx >= 0 || beChunk ? cop : subject?.plural ? '3pl' : '3sg');
          const subjEn = subject ? (subject.pronoun ? subjectPronoun(subject.pronoun) : withArticle(subject, 'subject')) : wh && !preds.length ? '' : subjectPronoun(pn);
          const be = beForm(subject && !subject.pronoun ? (subject.plural ? '3pl' : '3sg') : pn, false) + (beChunk?.neg ? ' not' : '');
          sentenceLike = true;
          const many = pn === '1pl' || pn === '2pl' || pn === '3pl' || !!subject?.plural;
          const predEn = [...preds.map((n) => (n.headPos === 'adjective' || n.headPos === 'adverb' ? n.en : many && n.bare && !n.plural ? pluralOf(n.en) : withArticle(n, 'predicate'))), ...extras].join(' ');
          if (wh) out = (question || clauses.length === 1 ? [wh.en, be, subjEn, predEn] : [wh.en, subjEn, be, predEn]).filter(Boolean).join(' ');
          else if (question) out = [be.split(' ')[0], subjEn, beChunk?.neg ? 'not' : '', predEn].filter(Boolean).join(' ');
          else out = [subjEn, be, predEn].filter(Boolean).join(' ');
          if (preds.length > 1) failed = true;
          if (!beChunk && predIdx < 0 && subject && !subject.pronoun && !subject.dem && subject.bare) inferred = true;
        }
      }
      rendered.push(out);
    }
    if (failed || rendered.some((x) => !x)) return { english: null, confidence: 0, factors: [], tokens, notes };
    let english = rendered.map((c, k) => (k ? `${joins[k - 1]} ${c}` : c)).join(/^(but|because|if)$/.test(joins[0] ?? '') ? ', ' : ' ');
    english = english.charAt(0).toUpperCase() + english.slice(1) + (question ? '?' : exclaim ? '!' : sentenceLike && !fragment ? '.' : '');
    english = english.replace(/\bi\b/g, 'I');
    // confidence: same shape as English → Buxori (word choice is the risk)
    const factors: string[] = ['built from the word-by-word analysis'];
    let c = 0.9;
    if (content > 1) { c *= 0.7 ** (content - 1); factors.push(`${content} content words, each a separate word choice`); }
    if (ambiguous) { c *= 0.75 ** ambiguous; factors.push(`${ambiguous} word${ambiguous > 1 ? 's have' : ' has'} more than one possible reading`); }
    if (tokens.some((t) => t.readings[t.chosen]?.spelling !== 'exact')) { c *= 0.8; factors.push('a word was matched without its accents or apostrophes'); }
    if (inferred) { c *= 0.7; factors.push('“is” was supplied between two nouns with nothing marking it'); }
    if (mismatch) { c *= 0.5; factors.push('subject and verb ending do not agree'); }
    if (fragment) { c *= 0.7; factors.push('not a full sentence'); }
    return { english, confidence: c, factors, tokens, notes };
  }
}
