/*
 * Sentence and noun-phrase translation: English structure → Buxori structure.
 * Shallow, rule-based, and explicit about what it does: every word comes from the
 * index (Lexicon), every inflection from Morphology, every ordering decision from a
 * TSV grammar rule cited in the steps. Words it cannot source are reported, never
 * guessed.
 */
import type { Evidence, PersonNumber, Register, RootEntry, Tense } from '../lib/types.ts';
import {
  ARTICLES, BE_FORMS, DEMONSTRATIVES, INTENSIFIERS, OBJECT_PRONOUNS, PERSON_LABEL, POSSESSIVE_DETERMINERS,
  ENGLISH_SYNONYMS, SUBJECT_PRONOUNS, WH_WORDS, nounCandidates, verbCandidates, type EnglishInput,
} from './english.ts';
import { Lexicon, inline, inlineName } from './lexicon.ts';
import { Morphology, type Step } from './morphology.ts';
import { Numbers, parseNumber } from './numbers.ts';

export interface Draft {
  text: string;
  steps: Step[];
  evidence: Evidence[];
  confidence: number;
  unknown: string[];
  /** Words kept as written because they look like names. */
  names: string[];
}

export type Variant = { register: 'informal' | 'formal' | 'default'; draft: Draft };

const QUANTIFIERS = new Set(['many', 'much', 'some', 'all', 'every', 'few', 'several', 'each', 'any']);
const PREPOSITIONS = new Set(['in', 'at', 'to', 'into', 'on', 'from', 'with', 'for', 'of', 'about', 'under', 'near', 'behind', 'after', 'before', 'without', 'by', 'over', 'between', 'inside', 'outside', 'until', 'like']);
/** English preposition → the gloss key whose index entry is that preposition. */
const PREP_GLOSS: Record<string, string> = { in: 'in', at: 'in', to: 'in', into: 'in', on: 'on', from: 'from', with: 'with' };
const MOTION = new Set(['go', 'come', 'walk', 'run', 'fly', 'travel', 'move', 'return', 'arrive', 'drive', 'ride', 'enter']);
const DATIVE_VERBS = new Set(['give', 'tell', 'say', 'send', 'show', 'bring', 'write', 'teach', 'sell', 'buy', 'pay', 'read']);
const MODALS = new Set(['can', 'could', 'should', 'must', 'may', 'might', 'would', 'shall']);
const ADVERB_POS = ['adverb'] as const;
/** English words that are never the head of a noun phrase (adverbs, particles, prepositions). */
const NOT_NOUNS = new Set(['ago', 'now', 'then', 'here', 'there', 'so', 'too', 'very', 'also', 'until', 'since', 'still', 'already',
  'just', 'again', 'soon', 'together', 'away', 'back', 'out', 'up', 'down', 'off', 'much', 'many', 'more', 'most', 'less', 'ever',
  'never', 'always', 'often', 'sometimes', 'yet', 'only', 'even', 'almost', 'quite', 'rather', 'if', 'as', 'than', 'whether']);

export class Grammar {
  readonly numbers: Numbers;
  /** Second person plural requested ("You (pl.)"): 2pl instead of 2pol. */
  private plural2 = false;
  readonly lex: Lexicon;
  readonly morph: Morphology;
  constructor(lex: Lexicon, morph: Morphology) { this.lex = lex; this.morph = morph; this.numbers = new Numbers(lex.index); }

  // ── lexical helpers ─────────────────────────────────────────────────────
  private verbRoot(word: string): { root: RootEntry; form: ReturnType<typeof verbCandidates>[number]['form'] } | null {
    for (const c of verbCandidates(word)) {
      const r = this.lex.best(`to ${c.lemma}`, 'verb') ?? this.lex.best(c.lemma, 'verb');
      if (r?.verb) return { root: r, form: c.lemma === word && c.form !== 'ing' ? 'base' : c.form };
    }
    return null;
  }
  /** this / that / these as pointing words: skip entries the source files under conjunctions ("that" = ki). */
  private demonstrative(word: string): RootEntry | undefined {
    const list = this.lex.roots(word);
    return list.find((e) => !/conjunction/i.test(e.sources[0]?.section ?? '')) ?? list[0];
  }

  /** "said", "gone", "worked": a participle of a verb the index knows. */
  private isParticiple(word: string): boolean {
    return verbCandidates(word).some((c) => c.form === 'participle' && !!(this.lex.best(`to ${c.lemma}`, 'verb') ?? this.lex.best(c.lemma, 'verb')));
  }
  private nounRoot(word: string): { root: RootEntry; plural: boolean } | null {
    if (NOT_NOUNS.has(word)) return null;
    const direct = this.nounRootExact(word);
    if (direct) return direct;
    // English paraphrases ("home" → house) when the source has no entry for the word itself
    for (const alt of ENGLISH_SYNONYMS[word] ?? []) { const r = this.nounRootExact(alt); if (r) return r; }
    return null;
  }
  private nounRootExact(word: string): { root: RootEntry; plural: boolean } | null {
    for (const c of nounCandidates(word)) {
      const r = this.lex.best(c.lemma, ['noun', 'proper_noun', 'pronoun', 'numeral', 'adjective'], { examples: true });
      if (r && r.pos !== 'verb') return { root: r, plural: c.plural };
    }
    return null;
  }
  private word(english: string, pos?: Parameters<Lexicon['best']>[1]): RootEntry | undefined {
    return this.lex.best(english, pos, { examples: true });
  }

  // ── noun phrases ───────────────────────────────────────────────────────
  /**
   * Translate a run of English tokens that form one noun phrase.
   * Handles articles, demonstratives, possessive determiners, numerals with the
   * -ta classifier, quantifiers, adjectives (ezafe), plural -ho, "X of Y" and "X's Y".
   */
  nounPhrase(tokens: string[], input: EnglishInput, register: 'informal' | 'formal' | 'default'): (Draft & { definite: boolean; plural: boolean; pn?: PersonNumber; isPronoun?: boolean }) | null {
    const steps: Step[] = [], evidence: Evidence[] = [], unknown: string[] = [], names: string[] = [];
    let conf = 1;
    if (!tokens.length) return null;

    // Object pronoun on its own.
    if (tokens.length === 1 && (OBJECT_PRONOUNS[tokens[0]!] || SUBJECT_PRONOUNS[tokens[0]!])) {
      const t = tokens[0]!;
      let pn = (OBJECT_PRONOUNS[t] ?? SUBJECT_PRONOUNS[t])!;
      if (pn === '2sg' && register === 'formal') pn = '2pol';
      if (t === 'it') return { text: '', steps: [{ text: '“it” is not expressed (no Buxori pronoun for “it” in the source).' }], evidence: [], confidence: 0.8, unknown, names, definite: true, plural: false, pn, isPronoun: true };
      const p = this.lex.pronoun(pn);
      if (!p) return null;
      return { text: inline(p.lemma.text), steps: [{ text: `“${t}” → ${p.lemma.text} (${PERSON_LABEL[pn]}).`, rows: [p.sources[0]?.row ?? 0] }], evidence: ['stated'], confidence: 1, unknown, names, definite: true, plural: pn.endsWith('pl'), pn, isPronoun: true };
    }

    // A lone demonstrative is a pronoun: "that is good" → vay naghz.
    if (tokens.length === 1 && DEMONSTRATIVES.has(tokens[0]!)) {
      const t = tokens[0]!;
      const r = this.demonstrative(t);
      if (!r) return null;
      const w = inline(r.lemma.text).toLowerCase();
      return { text: w, steps: [{ text: `“${t}” → ${r.lemma.text}.`, rows: [r.sources[0]?.row ?? 0] }], evidence: [r.lemma.evidence], confidence: 0.95, unknown, names, definite: true, plural: t === 'these' || t === 'those', isPronoun: true };
    }

    // "X of Y" → X-ezafe Y ; "Y 's X" → X-ezafe Y
    const ofAt = tokens.indexOf('of');
    const sAt = tokens.indexOf("'s");
    if ((ofAt > 0 && ofAt < tokens.length - 1) || (sAt > 0 && sAt < tokens.length - 1)) {
      const [headToks, possToks] = ofAt > 0 ? [tokens.slice(0, ofAt), tokens.slice(ofAt + 1)] : [tokens.slice(sAt + 1), tokens.slice(0, sAt)];
      const head = this.nounPhrase(headToks.filter((t) => !ARTICLES.has(t)), input, register);
      const poss = this.nounPhrase(possToks, input, register);
      if (!head || !poss || !head.text || !poss.text) return null;
      const hw = head.text.split(' ');
      const ez = this.morph.ezafe(hw.at(-1)!);
      const text = [...hw.slice(0, -1), ez.text, poss.text].join(' ');
      return { text, steps: [...head.steps, ...poss.steps, ...ez.steps, { text: `Possessor follows the possessed noun: ${text}.` }],
        evidence: [...head.evidence, ...poss.evidence, ez.evidence], confidence: Math.min(head.confidence, poss.confidence) * 0.95,
        unknown: [...head.unknown, ...poss.unknown], names: [...head.names, ...poss.names], definite: true, plural: head.plural };
    }

    let i = 0;
    let definite = false;
    let possessor: PersonNumber | undefined;
    let demonstrative: string | undefined;
    const pre: string[] = [];      // quantifiers / numerals before the noun
    const ordinals: string[] = []; // "fifth lesson" → darsi panjum (ordinal after the noun, with ezafe)
    let counted = false;
    while (i < tokens.length) {
      const t = tokens[i]!;
      if (ARTICLES.has(t)) { if (t === 'the') definite = true; i++; continue; }
      if (DEMONSTRATIVES.has(t) && i < tokens.length - 1) { demonstrative = t; definite = true; i++; continue; }
      if (POSSESSIVE_DETERMINERS[t]) { possessor = POSSESSIVE_DETERMINERS[t]; definite = true; i++; continue; }
      const num = parseNumber(tokens, i);
      if (num && i + num.length < tokens.length) {
        const en = tokens.slice(i, i + num.length).join(' ');
        if (num.ordinal) {
          const o = this.numbers.ordinal(num.value);
          if (o) { ordinals.push(o.text); steps.push(...o.steps); evidence.push(o.evidence); }
          else unknown.push(en);
        } else {
          const c = this.numbers.cardinal(num.value);
          if (c) {
            const cls = this.morph.classifier(c.text);
            pre.push(cls.text); steps.push(...c.steps, ...cls.steps); evidence.push(c.evidence, cls.evidence); counted = true;
          } else unknown.push(en);
        }
        i += num.length; continue;
      }
      if (QUANTIFIERS.has(t) && i < tokens.length - 1) {
        const r = this.word(t);
        if (r) { pre.push(inline(r.lemma.text).toLowerCase()); steps.push({ text: `“${t}” → ${r.lemma.text} (before the noun).`, rows: [r.sources[0]?.row ?? 0] }); evidence.push('stated'); }
        else unknown.push(t);
        i++; continue;
      }
      break;
    }
    const rest = tokens.slice(i);
    if (!rest.length) return null;

    // Longest multi-word noun first ("father-in-law", "ice cream"), else last token is the head.
    let headStart = rest.length - 1;
    for (let s = 0; s < rest.length - 1; s++) {
      if (this.nounRoot(rest.slice(s).join(' '))) { headStart = s; break; }
    }
    const headEn = rest.slice(headStart).join(' ');
    const adjEn = rest.slice(0, headStart);

    // Possessive + noun printed as a whole word in the source ("my grandmother" → Bivim)?
    if (possessor && !adjEn.length && !pre.length) {
      const posWord = Object.entries(POSSESSIVE_DETERMINERS).find(([, v]) => v === possessor)?.[0] ?? '';
      const att = this.lex.inflected(`${posWord} ${headEn}`).find((e) => !e.source.review);
      if (att && !(possessor === '2sg' && register === 'formal')) {
        steps.push({ text: `“${posWord} ${headEn}” is printed in the source: ${att.text}.`, rows: [att.source.row] });
        return { text: inline(att.text), steps, evidence: ['attested'], confidence: 0.95, unknown, names, definite: true, plural: false };
      }
    }

    let head: string;
    let plural = false;
    const nr = this.nounRoot(headEn);
    if (nr) {
      head = nr.root.pos === 'proper_noun' ? inlineName(nr.root.lemma.text) : inline(nr.root.lemma.text).toLowerCase();
      plural = nr.plural;
      steps.push({ text: `“${headEn}” → ${nr.root.lemma.text}${nr.plural ? ' (English plural)' : ''}.`, rows: [nr.root.sources[0]?.row ?? 0] });
      evidence.push(nr.root.lemma.evidence);
      if (nr.root.sources.every((s) => s.review)) conf *= 0.8;
    } else if (input.proper.has(headEn)) {
      head = headEn.charAt(0).toUpperCase() + headEn.slice(1);
      names.push(head);
      steps.push({ text: `“${head}” looks like a name and is kept as written.` });
      conf *= 0.9;
    } else {
      unknown.push(headEn);
      return { text: '', steps, evidence, confidence: 0, unknown, names, definite, plural: false };
    }

    // Plural (not after a numeral: the noun stays singular after a classifier).
    if (plural && !counted) {
      const pl = this.morph.plural(head);
      head = pl.text; steps.push(...pl.steps); evidence.push(pl.evidence);
    }

    // Adjectives → after the noun, linked by ezafe. An intensifier ("very", "so",
    // "really") stays directly before the word it strengthens: bisyor qiziq.
    // For "very" the source has bisyor and judo; bisyor is the one its sentences use (8 vs 2).
    const veryRoot = [...this.lex.roots('very')].sort((a, b) => this.lex.freq(b.lemma.text) - this.lex.freq(a.lemma.text))[0];
    const very = veryRoot ? inline(veryRoot.lemma.text).toLowerCase() : null;
    const adjs: string[] = [];
    let intensify = false;
    for (const a of adjEn) {
      if (INTENSIFIERS.has(a)) {
        if (!very) { unknown.push(a); continue; }
        intensify = true;
        steps.push({ text: `“${a}” → ${veryRoot!.lemma.text} (“very”), placed before the word it strengthens.`, rows: [veryRoot!.sources[0]?.row ?? 0] });
        evidence.push('stated');
        continue;
      }
      const r = this.word(a, ['adjective']) ?? this.word(a);
      if (r && r.pos !== 'verb') {
        const w = inline(r.lemma.text).toLowerCase();
        adjs.push(intensify ? `${very} ${w}` : w); intensify = false;
        steps.push({ text: `“${a}” → ${r.lemma.text}.`, rows: [r.sources[0]?.row ?? 0] }); evidence.push(r.lemma.evidence);
      } else unknown.push(a);
    }
    // "very happy" with no noun after it: the intensifier goes before the head itself.
    if (intensify && very) head = `${very} ${head}`;
    adjs.push(...ordinals);
    let np = head;
    if (adjs.length) {
      const ez = this.morph.ezafe(head.split(' ').at(-1)!);
      const headWords = head.split(' ');
      const chain = adjs.map((a, k) => {
        if (k === adjs.length - 1) return a;
        const ws = a.split(' ');
        return [...ws.slice(0, -1), this.morph.ezafe(ws.at(-1)!).text].join(' ');
      });
      np = [...headWords.slice(0, -1), ez.text, ...chain].join(' ');
      steps.push(...ez.steps, { text: `Adjective after the noun: ${np}.` });
      evidence.push(ez.evidence);
      if (adjs.length > 1) { conf *= 0.8; steps.push({ text: 'Several adjectives: each but the last takes ezafe (no printed example of this).' }); }
    }

    if (possessor) {
      let pn = possessor;
      if (pn === '2sg' && register === 'formal') pn = '2pol';
      if (adjs.length) {
        // noun-i adjective-i pronoun: ezafe chain ending in the possessor pronoun
        const p = this.lex.pronoun(pn);
        const last = np.split(' ');
        const ezLast = this.morph.ezafe(last.at(-1)!);
        np = [...last.slice(0, -1), ezLast.text, inline(p?.lemma.text ?? '').toLowerCase()].join(' ');
        steps.push({ text: `With an adjective the possessor follows as a pronoun after ezafe: ${np}.` });
        conf *= 0.8;
      } else {
        const pr = this.lex.pronoun(pn);
        const b = this.morph.possessive(np, pn, { plural, pronoun: inline(pr?.lemma.text ?? '').toLowerCase() });
        np = b.text; steps.push(...b.steps); evidence.push(b.evidence); conf *= b.confidence < 0.6 ? 0.75 : 1;
      }
    }

    if (demonstrative) {
      const isNear = demonstrative === 'this' || demonstrative === 'these';
      const r = this.demonstrative(isNear ? 'this' : 'that');
      if (r) {
        let d = inline(r.lemma.text).toLowerCase();
        if (!isNear && d !== 'vay') d = 'vay';
        np = `${d} ${np}`;
        steps.push({ text: `“${demonstrative}” → ${d}, before the noun${demonstrative === 'these' || demonstrative === 'those' ? ' (the noun takes plural -ho, as in “in sevho”)' : ''}.`, rows: [r.sources[0]?.row ?? 0] });
        evidence.push('stated');
        if ((demonstrative === 'these' || demonstrative === 'those') && !plural) { const pl = this.morph.plural(head); np = np.replace(head, pl.text); }
      } else unknown.push(demonstrative);
    }

    const text = [...pre, np].join(' ');
    if (unknown.length) conf *= 0.6;
    return { text, steps, evidence, confidence: conf, unknown, names, definite: definite || !!names.length, plural };
  }

  // ── clauses ────────────────────────────────────────────────────────────
  /**
   * Translate a simple clause. Returns one draft, or informal + formal drafts
   * when "you"/"your" is involved (the TSV distinguishes tu and shumo).
   */
  clause(input: EnglishInput): Variant[] | null {
    const toks = input.tokens.filter((t) => t !== 'please');
    if (!toks.length) return null;
    const second = toks.some((t) => t === 'you' || t === 'your' || t === 'yours' || t === 'yourself');
    const imperative = this.isImperative(toks);
    // An English label "(sing.)" / "(polite)" / "(pl.)" asks for one register only.
    if ((second || imperative) && input.address) {
      const reg = input.address === 'informal' ? 'informal' : 'formal';
      this.plural2 = input.address === 'plural';
      try {
        const d = this.buildClause(toks, input, reg);
        return d ? [{ register: reg, draft: d }] : null;
      } finally { this.plural2 = false; }
    }
    if (!second && !imperative) {
      const d = this.buildClause(toks, input, 'default');
      return d ? [{ register: 'default', draft: d }] : null;
    }
    const inf = this.buildClause(toks, input, 'informal');
    const fm = this.buildClause(toks, input, 'formal');
    if (!inf || !fm) return null;
    return [{ register: 'informal', draft: inf }, { register: 'formal', draft: fm }];
  }

  private isImperative(toks: string[]): boolean {
    let i = 0;
    if (toks[0] === 'do' && toks[1] === 'not') i = 2;
    else if (toks[0] === 'never') i = 1;
    const w = toks[i];
    if (!w || SUBJECT_PRONOUNS[w] || WH_WORDS.has(w) || BE_FORMS.has(w) || MODALS.has(w)) return w === 'be' && i === 0;
    const v = this.verbRoot(w);
    return !!v && v.form === 'base' && !this.nounRoot(w) || (!!v && v.form === 'base' && toks.length > 1 && !this.verbRoot(toks[i + 1] ?? '#'));
  }

  private buildClause(toks: string[], input: EnglishInput, register: 'informal' | 'formal' | 'default'): Draft | null {
    const steps: Step[] = [], evidence: Evidence[] = [], unknown: string[] = [], names: string[] = [];
    let conf = 1;
    let i = 0;
    let wh: string | undefined;
    let negative = false;
    let tense = 'present' as Tense;
    let perfectAux = false, progressive = false, usedTo = false, future = false, beAux: string | undefined, haveMain = false, modal: string | undefined;

    const imperative = this.isImperative(toks);

    // wh-word (how many / how much count as one)
    let whNp: string[] = [];
    if (WH_WORDS.has(toks[0] ?? '')) {
      wh = toks[0]; i = 1;
      if (wh === 'how' && (toks[1] === 'many' || toks[1] === 'much')) { wh = `how ${toks[1]}`; i = 2; }
      // "how much money do you have", "which book do you want": the noun belongs to the wh-word
      if (wh && ['how many', 'how much', 'which', 'what', 'whose'].includes(wh)) {
        let j = i;
        while (j < toks.length && !SUBJECT_PRONOUNS[toks[j]!] && !BE_FORMS.has(toks[j]!) && !['do', 'does', 'did', 'will', 'can', 'have', 'has', 'had'].includes(toks[j]!)) j++;
        if (j > i && j < toks.length) { whNp = toks.slice(i, j); i = j; }
      }
    }
    const eatAux = () => {
      while (i < toks.length) {
        const t = toks[i]!;
        if (t === 'not' || t === 'never') { negative = true; i++; continue; }
        if (t === 'do' || t === 'does') { i++; continue; }
        if (t === 'did') { tense = 'simple_past'; i++; continue; }
        if (t === 'will' || t === 'shall') { future = true; i++; continue; }
        if (MODALS.has(t)) { modal = t; i++; continue; }
        if (t === 'used' && toks[i + 1] === 'to') { usedTo = true; i += 2; continue; }
        if (BE_FORMS.has(t)) {
          beAux = t; i++;
          if (toks[i] === 'going' && toks[i + 1] === 'to') { future = true; beAux = undefined; i += 2; }
          continue;
        }
        // have/has/had (+ not) + participle: perfect tenses ("you hadn't said" → nagufta budi)
        const neg = toks[i + 1] === 'not' || toks[i + 1] === 'never';
        const nxt = toks[i + (neg ? 2 : 1)];
        if ((t === 'have' || t === 'has' || t === 'had') && nxt && this.isParticiple(nxt)) {
          perfectAux = true; if (t === 'had') tense = 'past_perfect'; if (neg) negative = true; i += neg ? 2 : 1; continue;
        }
        break;
      }
    };
    if (!imperative) eatAux();

    // Subject
    let subjPn: PersonNumber = '3sg';
    let subjText = '';
    if (imperative) {
      if (toks[0] === 'do' && toks[1] === 'not') { negative = true; i = 2; } else if (toks[0] === 'never') { negative = true; i = 1; }
      subjPn = register === 'formal' ? (this.plural2 ? '2pl' : '2pol') : '2sg';
      steps.push({ text: `Imperative, ${PERSON_LABEL[subjPn]}.`, rows: [] });
    } else if (SUBJECT_PRONOUNS[toks[i] ?? '']) {
      const t = toks[i]!;
      subjPn = SUBJECT_PRONOUNS[t]!;
      if (t === 'you') subjPn = register === 'formal' ? (this.plural2 ? '2pl' : '2pol') : '2sg';
      if (t !== 'it') {
        const p = this.lex.pronoun(subjPn);
        if (p) { subjText = inline(p.lemma.text); steps.push({ text: `Subject “${t}” → ${p.lemma.text}.`, rows: [p.sources[0]?.row ?? 0] }); evidence.push('stated'); }
      } else steps.push({ text: 'Subject “it” is left unexpressed.' });
      i++;
    } else {
      // Noun-phrase subject: tokens up to the first auxiliary or verb.
      let j = i;
      while (j < toks.length && !BE_FORMS.has(toks[j]!) && !['do', 'does', 'did', 'will', 'have', 'has', 'had', 'not', 'can'].includes(toks[j]!) && !(j > i && this.verbRoot(toks[j]!) && !this.nounRoot(toks[j]!))) j++;
      if (j > i && j < toks.length) {
        const np = this.nounPhrase(toks.slice(i, j), input, register);
        if (np?.text) {
          subjText = np.text; subjPn = np.plural ? '3pl' : '3sg';
          steps.push(...np.steps); evidence.push(...np.evidence); unknown.push(...np.unknown); names.push(...np.names); conf *= np.confidence;
          i = j;
        } else if (!wh) return null;
      } else if (!wh) return null;
    }
    if (!imperative) eatAux();

    // Main verb
    let verb: RootEntry | undefined;
    let vIdx = -1;
    let vForm: string | undefined;
    let vLemma: string | undefined;
    for (let j = i; j < toks.length; j++) {
      const t = toks[j]!;
      if (t === 'not' || t === 'never') { negative = true; continue; }
      if (t === 'to' && verb) break;
      // phrasal verbs: "wake up", "get up", "look at"
      const two = toks[j + 1] ? this.verbRoot(`${t} ${toks[j + 1]}`) : null;
      const vr = two ?? this.verbRoot(t);
      if (vr && !(BE_FORMS.has(t))) {
        if (t === 'have' || t === 'has' || t === 'had') haveMain = true;
        // a word that is also a noun right after a determiner is a noun, not the verb
        if (j > i && ['a', 'an', 'the', 'my', 'your', 'his', 'her', 'our', 'their', 'this', 'that'].includes(toks[j - 1]!)) continue;
        verb = vr.root; vIdx = j; vForm = vr.form;
        vLemma = verbCandidates(t).find((c) => this.lex.best(`to ${c.lemma}`, 'verb') === vr.root || this.lex.best(c.lemma, 'verb') === vr.root)?.lemma;
        if (two) toks = [...toks.slice(0, j), `${t} ${toks[j + 1]}`, ...toks.slice(j + 2)];
        break;
      }
      // only skip over adverbs between the subject and the verb
      if (!this.word(t, [...ADVERB_POS]) && !['also', 'always', 'often', 'usually', 'still', 'already', 'just', 'really'].includes(t)) break;
    }

    // Tense from English morphology
    if (verb) {
      if (usedTo) tense = 'descriptive_past';
      else if (perfectAux && tense !== 'past_perfect') tense = 'present_perfect';
      if (perfectAux && vForm === 'past') vForm = 'participle';
      else if (beAux && vForm === 'ing') tense = beAux === 'was' || beAux === 'were' ? 'past_continuous' : 'present_continuous';
      else if (future) tense = 'future';
      else if (vForm === 'past' && tense === 'present') tense = 'simple_past';
      if (beAux && vForm === 'participle') {
        // passive ("is built") — handled only by exact/retrieval layers for now
        return null;
      }
      progressive = tense === 'present_continuous' || tense === 'past_continuous';
    }
    if (imperative) tense = 'imperative';
    // Modal constructions the source documents. Anything else is reported, never dropped
    // (dropping "can" from "I can't go" would say "I don't go").
    let construction: 'can' | 'must' | 'want' | undefined;
    let restFrom = vIdx >= 0 ? vIdx + 1 : i;
    // "must have gone", "could have said": modal + perfect is a conjecture the engine does not build
    if (modal && perfectAux) unknown.push(`${modal} have`);
    else if (modal === 'can' || modal === 'could') construction = 'can';
    else if (modal === 'must' || modal === 'should') construction = 'must';
    else if (modal) unknown.push(modal);
    if (verb && vLemma && ['want', 'have', 'need'].includes(vLemma) && toks[vIdx + 1] === 'to' && toks[vIdx + 2]) {
      const second = this.verbRoot(toks[vIdx + 2]!);
      if (second) { construction = vLemma === 'want' ? 'want' : 'must'; verb = second.root; vForm = 'base'; restFrom = vIdx + 3; }
    }

    // Remaining tokens → object / prepositional phrases / adverbs
    const restToks = toks.slice(restFrom);
    const preVerbToks = vIdx >= 0 ? toks.slice(i, vIdx).filter((t) => t !== 'not' && t !== 'never') : [];
    const chunks = this.chunk([...preVerbToks, ...restToks]);
    const timeParts: string[] = [], placeParts: string[] = [], objParts: string[] = [], advParts: string[] = [], postParts: string[] = [];
    let predicate: string | undefined;
    let strandedPrep: string | undefined;
    const isCopula = !verb && !!beAux && !haveMain;

    for (const c of chunks) {
      if (c.kind === 'adverb') {
        const r = this.word(c.tokens.join(' '), [...ADVERB_POS]) ?? this.word(c.tokens.join(' '));
        if (r) {
          const w = inline(r.lemma.text).toLowerCase();
          (r.pos === 'adverb' && /^(today|tomorrow|yesterday|tonight|now|always|never|sometimes|often|then|soon)$/.test(c.tokens.join(' ')) ? timeParts : advParts).push(w);
          steps.push({ text: `“${c.tokens.join(' ')}” → ${r.lemma.text}.`, rows: [r.sources[0]?.row ?? 0] }); evidence.push('stated');
        } else unknown.push(...c.tokens);
        continue;
      }
      if (c.kind === 'pp') {
        // "Where are you from?": the preposition is stranded at the end in English and
        // belongs to the question word in Buxori (az kujo, "from where").
        if (!c.tokens.length && wh) { strandedPrep = c.prep; continue; }
        const np = this.nounPhrase(c.tokens, input, register);
        if (!np) { unknown.push(c.prep!, ...c.tokens); continue; }
        steps.push(...np.steps); evidence.push(...np.evidence); unknown.push(...np.unknown); names.push(...np.names); conf *= np.confidence || 0.5;
        const pr = this.preposition(c.prep!, verb, np.text);
        if (!pr) { unknown.push(c.prep!); placeParts.push(np.text); continue; }
        steps.push(pr.step); evidence.push(pr.evidence);
        (pr.after ? postParts : placeParts).push(pr.after ? `${np.text} ${pr.word}` : `${pr.word} ${np.text}`);
        continue;
      }
      // noun phrase: object (or predicate after "be")
      const np = this.nounPhrase(c.tokens, input, register);
      if (!np) { unknown.push(...c.tokens); continue; }
      steps.push(...np.steps); evidence.push(...np.evidence); unknown.push(...np.unknown); names.push(...np.names); conf *= np.confidence || 0.5;
      if (!np.text) continue;
      if (isCopula && predicate === undefined) { predicate = np.text; continue; }
      // "give me the book": a lone object pronoun followed by another noun phrase is the
      // indirect object → ba + pronoun.
      const npChunks = chunks.filter((x) => x.kind === 'np');
      if (verb && vLemma && DATIVE_VERBS.has(vLemma) && np.isPronoun && npChunks.length > 1 && npChunks[0] === c) {
        const ba = this.word('in', 'preposition');
        objParts.push(`${inline(ba?.lemma.text ?? '').toLowerCase()} ${np.text}`.trim());
        steps.push({ text: `Indirect object “${c.tokens.join(' ')}” → ${inline(ba?.lemma.text ?? '')} ${np.text}.`, rows: [ba?.sources[0]?.row ?? 0] });
        continue;
      }
      if (np.definite || np.isPronoun) {
        const words = np.text.split(' ');
        const om = this.morph.objectMarker(words.at(-1)!);
        objParts.push([...words.slice(0, -1), om.text].join(' '));
        steps.push(...om.steps); evidence.push(om.evidence);
      } else objParts.push(np.text);
    }

    // wh-word
    let whText: string | undefined;
    if (wh) {
      const key = wh === 'why' ? 'why?' : wh === 'how many' ? 'how many?' : wh === 'how much' ? 'how much?' : wh === 'how' ? 'how?' : `${wh}?`;
      const r = this.word(key) ?? this.word(wh);
      if (r) { whText = inline(r.lemma.text).toLowerCase(); steps.push({ text: `“${wh}” → ${r.lemma.text}.`, rows: [r.sources[0]?.row ?? 0] }); evidence.push('stated'); }
      else unknown.push(wh);
      if (r && strandedPrep) {
        const pr = this.preposition(strandedPrep, verb, whText ?? '');
        if (pr) {
          whText = pr.after ? `${whText} ${pr.word}` : `${pr.word} ${whText}`;
          steps.push(pr.step, { text: `The stranded English “${strandedPrep}” attaches to the question word: ${whText}.` });
          evidence.push(pr.evidence);
        } else unknown.push(strandedPrep);
      }
      if (whNp.length) {
        const np = this.nounPhrase(whNp, input, register);
        if (np?.text) {
          // the noun after "how many" stays singular (classifier construction: chandta kitov)
          const singular = np.plural ? this.nounPhrase(whNp.map((w) => nounCandidates(w).find((c) => c.plural)?.lemma ?? w), input, register) : null;
          whText = `${whText ?? ''} ${(singular?.text || np.text)}`.trim();
          steps.push(...np.steps, { text: `The noun follows the question word: ${whText}.` });
          evidence.push(...np.evidence); unknown.push(...np.unknown); conf *= np.confidence || 0.5;
        } else unknown.push(...whNp);
      }
    }

    // Verb or copula
    let verbText = '';
    if (verb && construction) {
      const b = this.modal(construction, verb, subjPn, negative);
      if (!b) { unknown.push(construction); conf *= 0.4; }
      else { verbText = b.text; steps.push(...b.steps); evidence.push(b.evidence); conf *= b.confidence; }
    } else if (verb) {
      const b = this.morph.conjugate(verb, tense, subjPn, { negative, register: 'regular' });
      if (!b) { unknown.push(toks[vIdx]!); conf *= 0.4; }
      else {
        verbText = b.text; steps.push(...b.steps); evidence.push(b.evidence); conf *= b.confidence;
        steps.push({ text: 'Word order: subject first, verb last (word_order).' });
      }
    } else if (haveMain) {
      // "I have a book" without a verb root for have → doshtan
      const have = this.verbRoot('have');
      if (have) {
        const b = this.morph.conjugate(have.root, tense === 'present' && beAux === undefined ? 'present' : tense, subjPn, { negative });
        if (b) { verbText = b.text; steps.push(...b.steps); evidence.push(b.evidence); conf *= b.confidence; }
      }
    } else if (isCopula) {
      // "He is here": a place adverb is the location, like "ba xona" (the source's own
      // sentences put it before the verb: "Man haminsun istam").
      const pred = predicate ?? [...placeParts, ...postParts, ...advParts].join(' ');
      if (predicate === undefined && !pred && !whText) return null;
      const pastBe = beAux === 'was' || beAux === 'were';
      if (predicate !== undefined) {
        const past = beAux === 'was' || beAux === 'were';
        if (past) {
          const bud = this.verbRoot('be');
          const b = bud ? this.morph.conjugate(bud.root, 'simple_past', subjPn, { negative }) : null;
          if (b) verbText = b.text;      // after the predicate and after a question word: Kitov kujo budak?
          if (b) { steps.push(...b.steps); evidence.push(b.evidence); conf *= b.confidence; }
        } else {
          const cop = this.morph.copula(predicate, subjPn, negative);
          predicate = cop.text; steps.push(...cop.steps); evidence.push(cop.evidence); conf *= cop.confidence;
        }
      } else if (pastBe) {
        // "He was at home", "Where were you?": the past of "to be" is never left out
        // (as in the source's "Koram barevah bud", "… padari man bud").
        const bud = this.verbRoot('be');
        const b = bud ? this.morph.conjugate(bud.root, 'simple_past', subjPn, { negative }) : null;
        if (!b) return null;
        verbText = b.text; steps.push(...b.steps); evidence.push(b.evidence); conf *= b.confidence;
      } else if (negative) {
        const cop = this.morph.copula('', subjPn, true);
        verbText = cop.text.trim(); steps.push(...cop.steps);
      } else {
        // The source says hast ("is") is left out in conversation and shows it for the 3rd
        // person. For "I am / you are" + a place it prints no example, so that is marked weak.
        const third = subjPn === '3sg' || subjPn === '3pl' || subjPn === '3resp' || !!whText;
        steps.push(third
          ? { text: '“to be” of location is left out in conversation (e.g. “Sev boli kantür”).' }
          : { text: '“to be” of location is left out, as the source does for “is”. It prints no “I am / you are” + place sentence, so this form is not confirmed.', weak: true });
      }
    } else if (!whText) {
      return null;
    }

    // Assemble: [subject] [time] [place/goal] [object] [adverbs] [postpositions] [wh] [predicate|verb]
    // "What is your name?" → Nomat chi?  "Where is my book?" → Kitovam kujo?  (question word last with "to be")
    // …and before the past of "to be": Kitov kujo budak?
    const whLast = isCopula && !!whText;
    const parts = [subjText, ...timeParts, ...placeParts, ...objParts, ...postParts, ...advParts,
      whLast ? '' : whText ?? '', predicate ?? '', whLast ? whText ?? '' : '', verbText].filter(Boolean);
    if (!parts.length) return null;
    let text = parts.join(' ').replace(/\s+/g, ' ').trim();
    text = text.charAt(0).toUpperCase() + text.slice(1);
    if (input.question && !/\?$/.test(text)) text += '?';
    if (imperative && !/[!?]$/.test(text)) text += '!';
    if (unknown.length) conf *= 0.5;
    if (!verb && !isCopula && !haveMain) conf *= 0.7;
    void progressive;
    return { text, steps, evidence, confidence: Math.round(conf * 100) / 100, unknown: [...new Set(unknown)], names };
  }

  /** Verb word(s) of a root with the auxiliary or the root itself split out. */
  private parts(root: RootEntry): { pre: string; core: RootEntry } {
    const c = root.verb?.compound;
    const aux = c ? this.lex.index.roots.entries[c.auxiliary] : undefined;
    return c && aux ? { pre: `${c.preverb.toLowerCase()} `, core: aux } : { pre: '', core: root };
  }

  /**
   * can / must / want + verb, as the source builds them:
   *   can  → past participle + tavonistan conjugated   (karda metavoned, row 141)
   *   must → boyad + present stem + ending, no me-     (modal_boyad_future: Boyad ravam)
   *   want → infinitive + -i + hast + ending           (future_participle_want: guftani hastam)
   */
  private modal(kind: 'can' | 'must' | 'want', root: RootEntry, pn: PersonNumber, negative: boolean): { text: string; steps: Step[]; evidence: Evidence; confidence: number } | null {
    const { pre, core } = this.parts(root);
    const v = core.verb;
    if (!v) return null;
    const rule = (id: string) => (this.lex.index.syntaxRules.find((r) => r.id === id)?.sources ?? []).map((x) => x.row).slice(0, 3);
    if (kind === 'can') {
      const can = this.lex.best('can', 'verb');
      const aux = can ? this.morph.conjugate(can, 'present', pn, { negative }) : null;
      if (!aux) return null;
      const text = `${pre}${v.pastStem.text}a ${aux.text}`;
      return { text, evidence: 'derived', confidence: 0.6, steps: [{ text: `“can” + verb: past participle ${pre}${v.pastStem.text}a + ${aux.text} (as in “karda metavoned”, “can you make change”).`, rows: [141] }, ...aux.steps] };
    }
    if (kind === 'must') {
      if (negative) return null;   // the source has no negative of boyad
      const boyad = this.lex.best('must');
      const e = v.presentStem ? this.morph.ending('present.tense.endings', pn, { after: v.presentStem.text }) : null;
      if (!boyad || !v.presentStem || !e) return null;
      const text = `${inline(boyad.lemma.text).toLowerCase()} ${pre}${v.presentStem.text}${e.form}`;
      return { text, evidence: 'stated', confidence: 0.8, steps: [{ text: `“must / have to” + verb: boyad + present stem ${v.presentStem.text} + -${e.form}, no me- → ${text}.`, rows: rule('modal_boyad_future') }] };
    }
    const inf = `${pre}${core.lemma.key}`;
    const e = this.morph.ending('present.tense.endings', pn, { after: 'hast' });
    const cop = negative ? 'nest' : 'hast';
    const text = `${inf}i ${cop}${pn === '3sg' ? '' : e?.form ?? ''}`;
    return { text, evidence: 'stated', confidence: 0.8, steps: [{ text: `“want to” + verb: infinitive ${inf} + -i + ${cop} + ending → ${text} (as in “Man guftani hastam”, I want to say).`, rows: rule('future_participle_want') }] };
  }

  private preposition(prep: string, verb: RootEntry | undefined, np: string): { word: string; after: boolean; step: Step; evidence: Evidence } | null {
    if (prep === 'for') {
      const r = this.lex.best('for whom?');
      if (!r) return null;
      const w = inline(r.lemma.text).toLowerCase().replace(/\s+ki\??$/, '');
      return { word: w, after: false, evidence: 'derived', step: { text: `“for” → ${w} (from “${r.lemma.text}” = for whom?).`, rows: [r.sources[0]?.row ?? 0] } };
    }
    const key = PREP_GLOSS[prep] ?? prep;
    const r = this.lex.best(key, 'preposition') ?? (PREP_GLOSS[prep] ? this.lex.best(key) : undefined);
    if (!r) return null;
    const w = inline(r.lemma.text).toLowerCase();
    const rule = this.lex.index.syntaxRules.find((x) => x.kind === 'adposition' && x.form === w);
    const after = rule?.kind === 'adposition' && rule.placement === 'after';
    void verb; void np; void MOTION;
    return { word: w, after, evidence: 'stated', step: { text: `“${prep}” → ${r.lemma.text}${after ? ', placed after its noun (prepositions_qati)' : ''}.`, rows: [r.sources[0]?.row ?? 0] } };
  }

  /** Split the post-subject tokens into noun phrases, prepositional phrases and adverbs. */
  private chunk(toks: string[]): { kind: 'np' | 'pp' | 'adverb'; tokens: string[]; prep?: string }[] {
    const out: { kind: 'np' | 'pp' | 'adverb'; tokens: string[]; prep?: string }[] = [];
    let cur: { kind: 'np' | 'pp' | 'adverb'; tokens: string[]; prep?: string } | null = null;
    const flush = () => { if (cur && (cur.tokens.length || cur.kind === 'pp')) out.push(cur); cur = null; };
    for (let k = 0; k < toks.length; k++) {
      const t = toks[k]!;
      if (t === 'not' || t === 'never' || BE_FORMS.has(t) || t === 'to' && !cur) { if (t === 'to') { flush(); cur = { kind: 'pp', tokens: [], prep: 'to' }; } continue; }
      if (PREPOSITIONS.has(t) && t !== 'of') { flush(); cur = { kind: 'pp', tokens: [], prep: t }; continue; }
      const adverb = !ARTICLES.has(t) && !POSSESSIVE_DETERMINERS[t] && !DEMONSTRATIVES.has(t) && this.word(t)?.pos === 'adverb';
      if (adverb) { flush(); out.push({ kind: 'adverb', tokens: [t] }); continue; }
      if (!cur) cur = { kind: 'np', tokens: [] };
      // a new determiner after a complete noun starts a new phrase ("give me the book")
      const c = cur as { kind: 'np' | 'pp' | 'adverb'; tokens: string[]; prep?: string };
      if (c.tokens.length && (ARTICLES.has(t) || POSSESSIVE_DETERMINERS[t] || OBJECT_PRONOUNS[c.tokens.at(-1)!]) && c.tokens.at(-1) !== 'of' && c.tokens.at(-1) !== "'s") { flush(); cur = { kind: 'np', tokens: [] }; }
      (cur as { tokens: string[] }).tokens.push(t);
    }
    flush();
    return out;
  }
}

export type { Register };
