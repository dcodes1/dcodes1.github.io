/*
 * Buxori morphology, driven by the compiled index. Each function returns the
 * form plus how it was obtained: the affix paradigm or grammar rule (with TSV
 * rows) and an evidence level. Endings are read from the index's paradigm
 * tables; the code only encodes the rule LOGIC the TSV states in prose
 * (rule ids in comments), never Buxori word lists.
 */
import { affixForm } from '../lib/normalizer.ts';
import type {
  Affix, AffixId, BuxoriIndex, Evidence, ParadigmId, PersonNumber, Register, RootEntry, SourceRef, Tense,
} from '../lib/types.ts';

export interface Step { text: string; rows?: number[] }
export interface Built {
  text: string;
  evidence: Evidence;
  steps: Step[];
  /** 0–1: attested 1, stated rule .85, derived .7, low-confidence .5 */
  confidence: number;
}

const VOWELS = 'aeiouü';
export const endsInVowel = (w: string) => VOWELS.includes(w.slice(-1).toLowerCase());
const rowsOf = (s: readonly SourceRef[] | undefined) => (s ?? []).map((x) => x.row).filter((r, i, a) => a.indexOf(r) === i).slice(0, 4);
const weakest = (...e: Evidence[]): Evidence => (['borrowed', 'derived', 'attested', 'stated'] as const).find((x) => e.includes(x)) ?? 'stated';
const CONF: Record<Evidence, number> = { attested: 0.95, stated: 0.85, derived: 0.7, borrowed: 0.5 };

/** Verbs the TSV names as irregular (rule irregular_verbs, p47): their Regular present differs from the rule. */
const IRREGULAR_REGULAR_PRESENT = new Set(['raftan', 'shudan', 'omadan', 'daromadan', 'buromadan']);

export class Morphology {
  private readonly index: BuxoriIndex;
  constructor(index: BuxoriIndex) { this.index = index; }

  private affix(id: AffixId): Affix | undefined { return this.index.affixes.entries[id]; }

  /** An ending from a paradigm cell, honouring the allomorph environment and register. */
  ending(paradigm: string, pn: PersonNumber, opts: { register?: Register; after?: string } = {}): { form: string; rows: number[] } | null {
    const p = this.index.affixes.paradigms[paradigm as ParadigmId];
    if (!p) return null;
    const cell = p.cells[pn] ?? (pn === '2pol' ? p.cells['2pl'] : pn === '3resp' ? p.cells['3pl'] : undefined);
    const al = (cell ?? []).flatMap((id) => this.affix(id)?.allomorphs ?? []);
    const after = opts.after ?? '';
    const last = after.slice(-1).toLowerCase();
    const fits = al.filter((a) => {
      const env = a.environment;
      if (env.kind === 'after_vowel') return !!after && endsInVowel(after) && (!env.vowels || env.vowels.includes(last) || (env.vowels.includes('a') && last === 'i'));
      if (env.kind === 'after_consonant') return !after || !endsInVowel(after);
      return true;
    });
    const reg = opts.register ?? 'regular';
    const pick = fits.find((a) => a.register === reg) ?? fits.find((a) => a.register === 'regular') ?? fits[0];
    if (!pick) return null;
    return { form: affixForm(pick.form), rows: rowsOf(pick.sources) };
  }

  private ruleRows(id: string): number[] {
    return rowsOf(this.index.syntaxRules.find((r) => r.id === id)?.sources);
  }

  // ── nouns ─────────────────────────────────────────────────────────────────
  /** noun_plural: "-ho, pronounced [o], for any noun". */
  plural(noun: string): Built {
    return { text: noun + 'ho', evidence: 'stated', confidence: CONF.stated,
      steps: [{ text: `Plural: ${noun} + -ho → ${noun}ho (pronounced -o in conversation).`, rows: this.ruleRows('noun_plural') }] };
  }

  /** Ezafe link before an adjective or possessor (possessive rules 1 and 2, Regular form). */
  ezafe(noun: string, register: Register = 'regular'): Built {
    const last = noun.slice(-1).toLowerCase();
    if (!endsInVowel(noun)) return { text: noun + 'i', evidence: 'stated', confidence: CONF.stated, steps: [{ text: `Ezafe: ${noun} + -i.`, rows: this.ruleRows('possessive_rule_1_consonant') }] };
    if ((last === 'a' || last === 'i') && register === 'regular') {
      const t = noun.slice(0, -1) + 'i';
      return { text: t, evidence: 'stated', confidence: CONF.stated, steps: [{ text: `Ezafe (Regular): drop final -${last}, add -i → ${t}.`, rows: this.ruleRows('possessive_rule_2_vowel_a_or_i') }] };
    }
    return { text: noun + 'yi', evidence: 'stated', confidence: CONF.stated, steps: [{ text: `Ezafe after -${last}: + -yi → ${noun}yi.`, rows: this.ruleRows('possessive_rule_2_other_vowels') }] };
  }

  /** Possessive ending (POSSESSION, consonant stems p26, Regular vowel stems p27–28, Literal p29). */
  possessive(noun: string, pn: PersonNumber, opts: { register?: Register; plural?: boolean; pronoun?: string } = {}): Built {
    const register = opts.register ?? 'regular';
    if (opts.plural) {
      // Plural + possessive: one attested example only, Akahoyam (p62). Literal-style endings.
      const e = this.ending('possessive.endings.literal.form.vowel.stem', pn, { register: 'literal', after: 'o' });
      if (e) return { text: noun + e.form, evidence: 'derived', confidence: 0.5,
        steps: [{ text: `Plural + possessive: ${noun} + -${e.form} (pattern of Akahoyam “my brothers”, the only printed example).`, rows: e.rows }] };
    }
    if (!endsInVowel(noun)) {
      const e = this.ending('possessive.endings.consonant.stem', pn);
      if (e) return { text: noun + e.form, evidence: 'stated', confidence: CONF.stated, steps: [{ text: `Possessive: ${noun} + -${e.form} (consonant stem).`, rows: e.rows }] };
    }
    const last = noun.slice(-1).toLowerCase();
    if (register === 'literal') {
      const e = this.ending('possessive.endings.literal.form.vowel.stem', pn, { register: 'literal', after: noun });
      if (e) return { text: noun + e.form, evidence: 'stated', confidence: CONF.stated, steps: [{ text: `Possessive (Literal): ${noun} + -${e.form}.`, rows: e.rows }] };
    }
    if ('aio'.includes(last) || last === 'ü') {
      const e = this.ending('possessive.endings.regular.form.vowel.stem', pn, { after: noun });
      if (e) {
        const t = noun.slice(0, -1) + e.form;
        return { text: t, evidence: 'stated', confidence: CONF.stated, steps: [{ text: `Possessive (Regular): drop final -${last}, add -${e.form} → ${t}.`, rows: e.rows }] };
      }
    }
    // -u / -e stems, or a person with no printed vowel-stem ending: ezafe + pronoun (rule 2, other vowels).
    const ez = this.ezafe(noun, register);
    const pron = opts.pronoun ?? '';
    return { text: `${ez.text} ${pron}`.trim(), evidence: 'stated', confidence: CONF.stated,
      steps: [...ez.steps, { text: `Possessor pronoun follows: ${ez.text} ${pron}.`, rows: this.ruleRows('possessive_rule_2_other_vowels') }] };
  }

  /** direct_object_marker: -a after a consonant, -ya after a vowel (Regular form). */
  objectMarker(word: string): Built {
    const suf = endsInVowel(word) ? 'ya' : 'a';
    return { text: word + suf, evidence: 'stated', confidence: CONF.stated,
      steps: [{ text: `Definite direct object: ${word} + -${suf}.`, rows: this.ruleRows('direct_object_marker') }] };
  }

  /** Classifiers: numeral + -ta, before the singular noun; a final -t merges (haft → hafta). */
  classifier(numeral: string): Built {
    const t = /t$/i.test(numeral) ? numeral + 'a' : numeral + 'ta';
    const id = this.index.syntaxRules.find((r) => /classifier/i.test(r.title));
    return { text: t, evidence: 'stated', confidence: CONF.stated,
      steps: [{ text: `Counting: ${numeral} + classifier -ta → ${t}; the noun stays singular.`, rows: rowsOf(id?.sources) }] };
  }

  // ── verbs ─────────────────────────────────────────────────────────────────
  private attested(root: RootEntry, tense: Tense, pn: PersonNumber, negative: boolean, register: Register) {
    const forms = this.index.roots.verbForms[root.id] ?? [];
    const t = tense === 'future' ? 'present' : tense;     // simple_future: same form as present (table_of_tenses)
    const pns: PersonNumber[] = [pn];
    for (const reg of [register, 'regular', 'spoken'] as Register[]) {
      for (const p of pns) {
        const hit = forms.find((f) => f.tense === t && f.pn === p && f.negative === negative && f.register === reg && !f.source.review);
        if (hit) return hit;
      }
    }
    return undefined;
  }

  conjugate(root: RootEntry, tense: Tense, pn: PersonNumber, opts: { negative?: boolean; register?: Register; useAttested?: boolean } = {}): Built | null {
    const v = root.verb;
    if (!v) return null;
    const negative = !!opts.negative;
    const register = opts.register ?? 'regular';

    const label = `${root.lemma.text}, ${tense.replace(/_/g, ' ')}, ${pn}${negative ? ', negative' : ''}`;
    const useAttested = opts.useAttested !== false;
    const own = useAttested ? this.attested(root, tense, pn, negative, register) : undefined;
    if (own) return { text: own.form.toLowerCase(), evidence: 'attested', confidence: CONF.attested, steps: [{ text: `${label}: printed in the source as “${own.form}”.`, rows: [own.source.row] }] };

    // Compound verb: the noun stays, the auxiliary conjugates (compound_verb_present_and_negative).
    if (v.compound) {
      const aux = this.index.roots.entries[v.compound.auxiliary];
      const inner = aux ? this.conjugate(aux, tense, pn, opts) : null;
      if (!inner) return null;
      const pre = v.compound.preverb.toLowerCase();
      return { ...inner, text: `${pre} ${inner.text}`,
        steps: [...inner.steps, { text: `Compound verb ${root.lemma.text}: “${pre}” stays before the conjugated ${aux?.lemma.text}.`, rows: this.ruleRows('compound_verb_present_and_negative') }] };
    }

    if (negative && useAttested) {
      const pos = this.attested(root, tense, pn, false, register);
      if (pos) {
        const neg = this.negate(pos.form.toLowerCase(), tense);
        return { text: neg, evidence: 'derived', confidence: CONF.derived,
          steps: [{ text: `${label}: affirmative “${pos.form}” is printed; negation adds na- → ${neg}.`, rows: [pos.source.row, ...this.ruleRows(tense === 'past_perfect' ? 'past_perfect_negation' : 'negative_present')] }] };
      }
    }
    const irr = useAttested ? this.irregularPresent(root, tense, pn, register) : null;
    if (irr) {
      if (!negative) return irr;
      const neg = this.negate(irr.text, tense);
      return { ...irr, text: neg, steps: [...irr.steps, { text: `Negative: na- → ${neg}.`, rows: this.ruleRows('negative_present') }] };
    }
    const built = this.generate(root, tense, pn, register);
    if (!built) return null;
    if (!negative) return built;
    const neg = this.negate(built.text, tense);
    return { ...built, text: neg, steps: [...built.steps, { text: `Negative: na- → ${neg}.`, rows: this.ruleRows(tense === 'past_perfect' ? 'past_perfect_negation' : 'negative_present') }] };
  }

  /**
   * Regular-register present of an irregular verb whose printed table lacks this
   * person: infer the reduced stem from the printed forms (merum → r) and accept it
   * only if it reproduces EVERY printed form of the table with the -um/-i/-ed/-ü/
   * -em/-eton/-un endings (p47). Omadan (mebiyom, mebiyo …) fails that check, so it
   * is never guessed.
   */
  private irregularPresent(root: RootEntry, tense: Tense, pn: PersonNumber, register: Register): Built | null {
    // Any verb qualifies whose printed Regular present fits this pattern: the five verbs the
    // TSV names as irregular, and guftan (megum, megi, megü … megun, p-tables), which it does not name.
    if (register !== 'regular' || (tense !== 'present' && tense !== 'future')) return null;
    const printed = (this.index.roots.verbForms[root.id] ?? []).filter((f) => f.tense === 'present' && f.register === 'regular' && !f.negative);
    if (printed.length < 3) return null;
    const P = 'present.tense.endings.irregular.verbs.regular.form';
    const stems = new Map<string, number>();
    for (const f of printed) {
      const e = this.ending(P, f.pn);
      const w = f.form.toLowerCase();
      const end = e && (w.endsWith(e.form) ? e.form : f.pn === '1pl' && w.endsWith('im') ? 'im' : null);
      if (end && w.startsWith('me')) { const st = w.slice(2, w.length - end.length); stems.set(st, (stems.get(st) ?? 0) + 1); }
    }
    const [stem] = [...stems.entries()].sort((a, b) => b[1] - a[1])[0] ?? [];
    if (stem === undefined || !stem) return null;
    // "-em is always pronounced -im in conversation" (1st_plural_em_is_said_im): accept either.
    const same = (a: string, b: string) => a === b || a.replace(/im$/, 'em') === b.replace(/im$/, 'em');
    const reproduces = printed.every((f) => { const e = this.ending(P, f.pn); return !!e && same(f.form.toLowerCase(), `me${stem}${e.form}`); });
    if (!reproduces) return null;
    const e = this.ending(P, pn);
    if (!e) return null;
    const text = `me${stem}${e.form}`;
    return { text, evidence: 'derived', confidence: CONF.derived,
      steps: [{ text: `${root.lemma.text} is irregular; its printed Regular forms (${printed.slice(0, 3).map((f) => f.form).join(', ')} …) all share the stem -${stem}-. me- + ${stem} + -${e.form} → ${text}.`, rows: [...printed.slice(0, 3).map((f) => f.source.row), ...e.rows] }] };
  }

  /** na- goes on the first word (on me-/the stem; on the participle in the past perfect). */
  private negate(form: string, _tense: Tense): string {
    return 'na' + form;
  }

  private generate(root: RootEntry, tense: Tense, pn: PersonNumber, register: Register): Built | null {
    const v = root.verb!;
    const inf = root.lemma.key.split(' ').at(-1) ?? '';
    const pres = v.presentStem;
    const past = v.pastStem;
    const stemEv = (s: { evidence: Evidence }) => s.evidence;
    const note = (s: { text: string; evidence: Evidence; basis?: string; source?: SourceRef }) =>
      `${s.text} (${s.evidence}${s.basis ? `: ${s.basis}` : ''})`;

    switch (tense) {
      case 'present': case 'future': {
        if (!pres) return null;
        const e = this.ending('present.tense.endings', pn, { after: pres.text });
        if (!e) return null;
        const me = v.takesMe ? 'me' : '';
        const text = `${me}${pres.text}${e.form}`;
        // raftan/shudan/omadan have printed Regular tables (used above); daromadan and
        // buromadan are irregular but unprinted, so only the Literal pattern is available.
        const irregularGap = IRREGULAR_REGULAR_PRESENT.has(inf) && register === 'regular';
        const ev = irregularGap ? 'derived' : weakest(stemEv(pres), 'stated');
        return { text, evidence: ev, confidence: irregularGap ? 0.5 : CONF[ev],
          steps: [{ text: `${tense === 'future' ? 'Future = present form' : 'Present'}: ${me ? 'me- + ' : ''}stem ${note(pres)} + -${e.form} → ${text}.${v.takesMe ? '' : ' Doshtan takes no me-.'}${irregularGap ? ' This verb is irregular and its everyday (Regular) form is not printed, so this is the Literal pattern.' : ''}`, rows: [...this.ruleRows(v.takesMe ? 'simple_present_formation' : 'doshtan_takes_no_me'), ...e.rows] }] };
      }
      case 'simple_past': case 'descriptive_past': case 'present_perfect': {
        const pid = tense === 'simple_past' ? 'simple.past.endings' : tense === 'descriptive_past' ? 'descriptive.past.endings'
          : register === 'literal' ? 'present.perfect.endings.literal.form' : 'present.perfect.endings.regular.form';
        const e = this.ending(pid, pn, { register });
        if (!e) return null;
        const base = tense === 'present_perfect' && register === 'literal' ? past.text + 'a' : past.text;
        const me = tense === 'descriptive_past' ? 'me' : '';
        const text = `${me}${base}${e.form}`;
        const ev = weakest(stemEv(past), 'stated');
        return { text, evidence: ev, confidence: CONF[ev],
          steps: [{ text: `${tense.replace(/_/g, ' ')}: ${me ? 'me- + ' : ''}past stem ${note(past)} + -${e.form || '∅'} → ${text}.`, rows: [...this.ruleRows(tense === 'simple_past' ? 'simple_past_formation' : tense === 'descriptive_past' ? 'descriptive_past' : 'present_perfect_regular_form'), ...e.rows] }] };
      }
      case 'present_continuous': case 'past_continuous': {
        if (register === 'literal') return null;
        const short = inf.slice(0, -3);      // "drop the last three letters of the infinitive"
        if (tense === 'present_continuous') {
          const e = this.ending('present.continuous.endings.regular.form', pn, { register: 'regular' });
          if (!e) return null;
          const text = `${short}sod${e.form}`;
          return { text, evidence: 'derived', confidence: CONF.derived,
            steps: [{ text: `Present continuous (Regular): ${inf} − last 3 letters → ${short} + sod + -${e.form} → ${text}.`, rows: [...this.ruleRows('present_continuous_regular_form'), ...e.rows] }] };
        }
        const e = this.ending('past.continuous.endings.on.bud', pn, { register: 'regular' });
        if (!e) return null;
        const text = `${short}soda bud${e.form}`;
        return { text, evidence: 'derived', confidence: CONF.derived,
          steps: [{ text: `Past continuous (Regular): ${short} + soda + bud + -${e.form || '∅'} → ${text}.`, rows: [...this.ruleRows('past_continuous_regular_form'), ...e.rows] }] };
      }
      case 'past_perfect': {
        const e = this.ending('past.perfect.endings', pn, { register });
        if (!e) return null;
        const text = `${past.text}a bud${e.form}`;
        const ev = weakest(stemEv(past), 'stated');
        return { text, evidence: ev, confidence: CONF[ev],
          steps: [{ text: `Past perfect: participle ${past.text}a + bud + -${e.form || '∅'} → ${text}.`, rows: [...this.ruleRows('past_perfect'), ...e.rows] }] };
      }
      case 'imperative': {
        if (!pres) return null;
        const e = this.ending('imperative', pn);
        if (e === null) return null;
        const text = pres.text + e.form;
        return { text, evidence: weakest(stemEv(pres), 'stated'), confidence: CONF.derived,
          steps: [{ text: `Imperative: stem ${pres.text}${e.form ? ` + -${e.form}` : ' (bare)'} → ${text}. Some verbs change their vowel here; this one has no printed form.`, rows: [...this.ruleRows('imperative_mood'), ...e.rows] }] };
      }
      default:
        return null;
    }
  }

  /** Copula "to be" with a nominal/adjectival predicate (copula rules, p42 and p148). */
  copula(predicate: string, pn: PersonNumber, negative: boolean): Built {
    const rows = this.ruleRows('the_copula_hast');
    if (negative) {
      const suf = pn === '3sg' ? '' : (this.ending('present.tense.endings', pn, { after: 'nest' })?.form ?? '');
      const text = `${predicate} nest${suf}`;
      return { text, evidence: 'derived', confidence: CONF.derived, steps: [{ text: `Negative copula: nest${suf ? ' + -' + suf : ''} after the predicate → ${text}.`, rows }] };
    }
    if (pn === '3sg') {
      return { text: predicate, evidence: 'stated', confidence: CONF.stated,
        steps: [{ text: 'Copula: in conversation 3rd-person “hast” is pronounced -e or left out; it is left out here (literal: + hast).', rows }] };
    }
    if (pn === '3pl') {
      return { text: `${predicate} hastand`, evidence: 'attested', confidence: CONF.attested,
        steps: [{ text: `Copula 3rd plural: ${predicate} hastand (printed e.g. “düxtur hastand”).`, rows }] };
    }
    // 1sg -am (düxturam), 2sg -i (mardi) are printed (p148); other persons follow the present endings.
    const e = this.ending('present.tense.endings', pn, { after: predicate });
    const suf = pn === '2sg' ? (endsInVowel(predicate) ? 'yi' : 'i') : (e?.form ?? '');
    const text = predicate + suf;
    const printed = pn === '1sg' || pn === '2sg';
    return { text, evidence: printed ? 'attested' : 'derived', confidence: printed ? CONF.attested : CONF.derived,
      steps: [{ text: `Copula as a suffix: ${predicate} + -${suf}${printed ? ' (as in düxturam / mardi, p148)' : ''}.`, rows }] };
  }
}
