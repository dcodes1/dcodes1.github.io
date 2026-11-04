/**
 * types.ts — schema for the compiled Buxori index (buxori-index.json).
 *
 * Source: translator/data/bukhori.tsv — ONE file holding vocabulary, grammar
 * notes, paradigms and example sentences (distinguished by `entry_type`).
 * Every derived item keeps provenance (TSV row/page) and an evidence level so
 * the engine can tell TSV-stated facts from rule-derived or merely attested ones.
 */

// ── Branded primitives ───────────────────────────────────────────────────────
declare const brand: unique symbol;
type Brand<T, B extends string> = T & { readonly [brand]: B };

/**
 * Normalized Buxori lookup key:
 *  - Unicode NFC, lowercased
 *  - stress acutes folded (á→a, é→e, í→i) — they appear only in 6 front-matter rows
 *  - ü KEPT (a distinct vowel, not decoration)
 *  - apostrophe ' KEPT (marks ayin/glottal stop: 'amak, so'at)
 *  - internal hyphens kept (sihat-salomat); outer punctuation/whitespace trimmed
 * e.g. "Sholüm!" → "sholüm", "'Amak" → "'amak", "barodár" → "barodar"
 */
export type BuxKey = Brand<string, 'BuxKey'>;

/** Lowercased English sense, parentheticals moved to `qualifiers`. Verbs are
 *  indexed both with and without "to " ("to go" → "to go" and "go"). */
export type GlossKey = Brand<string, 'GlossKey'>;

export type RootId = Brand<string, 'RootId'>;         // "r<tsvRow>" — stable for a given TSV
export type AffixId = Brand<string, 'AffixId'>;       // semantic: "pref.me", "poss.1sg", "obj"
export type ParadigmId = Brand<string, 'ParadigmId'>; // "present.regular.consonant"
export type RuleId = Brand<string, 'RuleId'>;         // "word_order", "passive"
export type ExampleId = Brand<string, 'ExampleId'>;   // "e<tsvRow>"

// ── Provenance & certainty ───────────────────────────────────────────────────
export type EntryType =
  | 'vocab' | 'example' | 'phrase' | 'exercise' | 'paradigm' | 'grammar' | 'reading' | 'proverb';

export interface SourceRef {
  row: number;          // 1-based TSV line (header = 1)
  page: number;         // printed textbook page
  lesson: string;
  section: string;
  entryType: EntryType;
  review?: true;        // TSV flag == "REVIEW"
  note?: string;        // original `notes` cell, verbatim
}

/**
 * stated   – written as a rule or value in the TSV (paradigm cell, grammar note, "stem -rav-")
 * attested – seen in example sentences but never stated as a rule (e.g. directional -ba)
 * derived  – produced by applying a stated rule (past stem = infinitive minus -an, p54)
 * borrowed – NOT in the TSV; taken from colloquial Tajik by owner decision, with citations
 *            (e.g. object -ra after a vowel, locative -da). Lowest precedence.
 */
export type Evidence = 'stated' | 'attested' | 'derived' | 'borrowed';

/** Generation preference, highest first. Ties are broken by register (regular first). */
export const EVIDENCE_PRECEDENCE: readonly Evidence[] = ['stated', 'attested', 'derived', 'borrowed'];

export interface Citation {
  title: string;
  url: string;
  claim: string;          // what the source supports, in our words
}

/** Provenance for a form that is not in the TSV. */
export interface Borrowing {
  from: 'tajik';
  citations: Citation[];
  /** The TSV form this corresponds to, if any (e.g. Tajik -ra ≈ Bukhori -ya). */
  bukhoriCounterpart?: AffixId;
  caveat: string;
}

/** TSV "Regular form" (conversational) vs "Literal form" (written/literary). */
export type Register = 'regular' | 'literal' | 'spoken' | 'poetic';

/** From english-column markers "(sing.)", "(pol.)"/"(polite)", "(pl.)", "(respectful)". */
export type Address = 'informal' | 'polite' | 'plural' | 'respectful';

export type PersonNumber = '1sg' | '2sg' | '2pol' | '3sg' | '3resp' | '1pl' | '2pl' | '3pl';

export type PartOfSpeech =
  | 'noun' | 'proper_noun' | 'verb' | 'adjective' | 'adverb' | 'pronoun' | 'numeral'
  | 'preposition' | 'conjunction' | 'particle' | 'interjection' | 'phrase';

/** Phonological environment that selects an allomorph, as the TSV words it. */
export type Environment =
  | { kind: 'any' }
  | { kind: 'after_consonant' }
  /** "(vowel stem)", "(stem ends in a or i)", "(stem ends in o)", "(stem ends in ü)" */
  | { kind: 'after_vowel'; vowels?: readonly string[]; dropFinalVowel?: boolean }
  /** classifier -ta after a numeral ending in -t: haft + -ta → hafta (p50) */
  | { kind: 'after_segment'; segment: string; merges: true };

// ── ROOTS ────────────────────────────────────────────────────────────────────
export interface Form {
  text: string;        // surface exactly as in the TSV (case/diacritics preserved)
  key: BuxKey;
  kind: 'citation' | 'spoken' | 'literary' | 'variant' | 'synonym' | 'hebrew_origin';
  register?: Register;
  evidence: Evidence;
  source: SourceRef;
}

export interface Gloss {
  text: string;            // ONE sense: "to beat; to hit" becomes two Gloss objects
  key: GlossKey;
  qualifiers?: string[];   // "about hair", "a page" — kept, never silently dropped
  address?: Address;
}

export interface Stem {
  text: string;            // without dashes: "rav", "raft"
  evidence: Evidence;
  source?: SourceRef;
  /** For derived/attested stems: how it was obtained ("-idan rule", "attested in menüsham"). */
  basis?: string;
  /** Extra rows that attest the stem in conjugated forms. */
  attestedIn?: SourceRef[];
}

export interface VerbInfo {
  infinitive: Form;                     // "Raftan"
  presentStem?: Stem;                   // notes "stem -rav-" or alt_forms "-rav-"
  literaryPresentStem?: Stem;           // dodan: literary "-dih-"
  pastStem: Stem;                       // "raft" — derived (infinitive − "-an") unless a note states it
  irregular: boolean;                   // notes "irregular" / "Irregular Verbs List"
  takesMe: boolean;                     // false for doshtan ("Doshtan takes no me-", p48)
  imperative2sg?: Stem;                 // vowel-changed imperatives, e.g. rov (p43)
  compound?: {
    kind: 'nominal' | 'verbal';         // noun + aux (kor kardan) | participle + verb (p127)
    preverb: string;                    // "kor", "zindagi", "gap"
    auxiliary: RootId;                  // kardan / zadan / dodan / xondan / shudan …
  };
  /** Contradictions kept, not resolved silently (shudan: -shav- vs -shud-).
   *  `resolved` records which value the compiler uses and the evidence for it
   *  (see docs/LINGUISTIC_DECISIONS.md). */
  conflicts?: { field: 'presentStem' | 'pastStem'; values: string[]; sources: SourceRef[]; resolved?: { value: string; reason: string } }[];
}

export interface NounInfo {
  /** The final segment selects ezafe / possessive / object-marker allomorphs. */
  stemFinal: 'consonant' | 'a_or_i' | 'o' | 'ü' | 'other_vowel';
  animate?: boolean;                    // only when stated (governs literary plural -on)
}

export type NumericValue =
  | { kind: 'cardinal'; value: number }
  | { kind: 'ordinal'; value: number }                   // TSV "1st", "197th"
  | { kind: 'fraction'; numerator: number; denominator: number }; // TSV "1/3"

export interface RootEntry {
  id: RootId;
  lemma: Form;
  pos: PartOfSpeech;
  glosses: Gloss[];
  forms: Form[];                        // spoken_form + typed alt_forms entries
  verb?: VerbInfo;
  noun?: NounInfo;
  origin?: 'hebrew' | 'russian';        // only when stated or provable (Hebrew month set, p21)
  numeric?: NumericValue;
  sources: SourceRef[];                 // every TSV row merged into this entry
}

/** A row whose headword is itself inflected ("Padaraton", "shahrho", "onayam"),
 *  linked to its base via the "base noun: X" note so lookup can show the analysis. */
export interface InflectedEntry {
  text: string;
  key: BuxKey;
  glosses: Gloss[];
  base: RootId | null;                  // null when the base is not itself a headword
  baseText: string;                     // from "base noun: ona"
  affixes: AffixId[];                   // e.g. ["poss.1sg.literal"]
  spoken?: string;
  source: SourceRef;
}

/** A conjugated form printed in the TSV's own tables (present tense: raftan …,
 *  kardan Table of Tenses). The engine prefers these over generated forms. */
export interface AttestedVerbForm {
  tense: Tense;
  pn: PersonNumber;
  negative: boolean;
  register: Register;
  /** The verb word(s) only, subject pronoun removed: "merum", "karda budam". */
  form: string;
  source: SourceRef;
}

export interface RootsIndex {
  entries: Record<RootId, RootEntry>;
  inflected: Record<BuxKey, InflectedEntry[]>;
  /** Buxori → roots. Keys: lemma + every Form. Arrays because homographs exist
   *  (Ba = "to" and "at; in"; 'Amak has three kinship senses). */
  byKey: Record<BuxKey, RootId[]>;
  /** English → roots; senses split on ";", "/" and "1. … 2. …". */
  byGloss: Record<GlossKey, RootId[]>;
  /** English → inflected headwords ("my mom" → onayam), which are not roots. */
  inflectedByGloss: Record<GlossKey, BuxKey[]>;
  /** Stem → verb, for analysing conjugated words (merav-am → rav → Raftan). */
  byStem: Record<string, { root: RootId; stem: 'present' | 'past' | 'literary_present' }[]>;
  /** Attested conjugation tables, by verb. */
  verbForms: Record<RootId, AttestedVerbForm[]>;
}

// ── AFFIXES ──────────────────────────────────────────────────────────────────
export type AffixCategory =
  | 'aspect'            // me-      present / descriptive past (stated)
  | 'negation'          // na-, ma- (ma- = literary imperative)
  | 'mood'              // bi-      literary imperative (stated, poetic)
  | 'person_ending'     // verb agreement endings (many paradigms)
  | 'possessive'        // -am -at -ash -amo -aton -ashon (+ vowel-stem & literal sets)
  | 'ezafe'             // -i / -yi linking a noun to its modifier/possessor
  | 'plural'            // -ho; literary animate -on / -yon
  | 'object'            // -a / -ya regular; -ro literal spelling (pronounced -a)
  | 'directional'       // -ba "to/at/for" — ATTESTED ONLY (37 sentences, no rule row)
  | 'locative'          // -da "in/at"     — BORROWED from colloquial Tajik (not in TSV)
  | 'sentence_particle' // -ku -da -ha -mi (with present perfect)
  | 'participle'        // -a on the past stem
  | 'infinitive'        // -an
  | 'continuous'        // -sod- (regular present continuous, from istoda)
  | 'comparison'        // -tar comparative, -in superlative
  | 'ordinal'           // -um/-yum, -umin/-yumin
  | 'indefinite'        // -e
  | 'classifier'        // -ta
  | 'conjunction'       // -u/-yu
  | 'derivational';     // ham-, -don, -zor, -chi, -bon, -gar, -i, -a, -gor, -or, -cha, -icha, -ak, -chek, -jon

export type AttachesTo =
  | 'noun' | 'adjective' | 'numeral' | 'pronoun' | 'present_stem' | 'past_stem'
  | 'infinitive' | 'verb_word' | 'comparative' | 'clause';

export interface Allomorph {
  form: string;              // "-yam", "na-", "-ro" (hyphen shows the attachment side)
  environment: Environment;
  register: Register;
  pronounced?: string;       // "-ro"→"-a", "-em"→"-im", "-and"→"-an", "-ed"→"-et"
  evidence: Evidence;
  sources: SourceRef[];      // empty for borrowed forms (see `borrowed`)
  borrowed?: Borrowing;      // present iff evidence === 'borrowed'
}

export interface Affix {
  id: AffixId;
  category: AffixCategory;
  position: 'prefix' | 'suffix' | 'enclitic';
  gloss: string;
  attachesTo: AttachesTo[];
  personNumber?: PersonNumber;
  allomorphs: Allomorph[];
  /** Order in the word: lower = closer to the stem (stem < plural < possessive < object). */
  slot?: number;
  evidence: Evidence;
  examples?: ExampleId[];
}

export type Tense =
  | 'present' | 'future' | 'simple_past' | 'descriptive_past' | 'present_continuous'
  | 'past_continuous' | 'present_perfect' | 'past_perfect' | 'imperative'
  | 'conjectural_past' | 'conjectural_present' | 'conjectural_progressive';

/** One ending set as printed, e.g. "present tense endings (Literal form)". */
export interface Paradigm {
  id: ParadigmId;
  label: string;                                     // TSV section text, verbatim
  domain: 'verb' | 'possessive' | 'reflexive';
  tense?: Tense;
  register: Register;
  stemClass?: 'consonant' | 'vowel' | 'irregular';
  cells: Partial<Record<PersonNumber, AffixId[]>>;   // >1 = printed alternates
  /** Whole words where the TSV prints them (kardan Table of Tenses, reflexive xud). */
  fullForms?: Partial<Record<PersonNumber, string[]>>;
  sources: SourceRef[];
}

export interface AffixIndex {
  entries: Record<AffixId, Affix>;
  /** Surface (hyphens stripped, normalized) → candidate affixes, for segmentation. */
  byForm: Record<string, AffixId[]>;
  paradigms: Record<ParadigmId, Paradigm>;
}

// ── SYNTAX RULES ─────────────────────────────────────────────────────────────
export type Role =
  | 'subject' | 'object' | 'indirect_object' | 'location' | 'goal' | 'source'
  | 'instrument' | 'time' | 'adverb' | 'question_word' | 'verb'
  | 'head_noun' | 'adjective' | 'possessor' | 'numeral' | 'preverb';

/** A piece of a template: a role, a stem, an affix, a fixed word, or an optional part. */
export type TemplatePart =
  | { role: Role }
  | { stem: 'present' | 'past' | 'infinitive' | 'infinitive_minus_3' | 'past_participle' }
  | { affix: AffixId }
  | { affixCategory: AffixCategory }        // "any person_ending"
  | { lexeme: RootId; text: string }        // bud, shudan, boyad, darkor, ki
  | { optional: TemplatePart };

interface RuleBase {
  id: RuleId;
  title: string;            // TSV grammar section, e.g. "Word order"
  statement: string;        // the grammar note, verbatim
  evidence: Evidence;
  register?: Register;
  examples: ExampleId[];
  exceptions?: string[];
  sources: SourceRef[];
}

export type SyntaxRule =
  | (RuleBase & { kind: 'word_order'; clause: 'declarative' | 'question' | 'imperative'; order: TemplatePart[]; verbFinal: true })
  | (RuleBase & { kind: 'verb_form'; tense: Tense; template: TemplatePart[];
      negation?: { affix: AffixId; placement: 'before_me' | 'before_stem' | 'before_participle' | 'before_auxiliary' } })
  | (RuleBase & { kind: 'compound_verb'; compound: 'nominal' | 'verbal'; auxiliaries: RootId[];
      preverb: 'before_auxiliary'; inflects: 'auxiliary'; negation: 'on_auxiliary' })
  | (RuleBase & { kind: 'noun_phrase'; template: TemplatePart[] })             // ezafe, possession, numeral + classifier
  | (RuleBase & { kind: 'copula'; affirmative: string; negative: string; spoken: string; droppable: true })
  | (RuleBase & { kind: 'adposition'; word: RootId; form: string; placement: 'before' | 'after' })   // qati after; qatori, bo before
  | (RuleBase & { kind: 'construction'; name: string; template: TemplatePart[] })   // passive, boyad, darkor, comparison…
  | (RuleBase & { kind: 'phonology'; effect: string })                         // -em→-im, final -d silent, t-merge
  | (RuleBase & { kind: 'orthography' | 'cultural_note' | 'general_note' });   // letter Q, Jewish day boundary, "What a sentence is" (engine ignores)

/* Templates: an EMPTY `template` means the rule is kept verbatim in `statement`
 * but has not been formalized — never that the construction has no parts. */

// ── SUPPORTING CORPUS ────────────────────────────────────────────────────────
export interface Example {
  id: ExampleId;
  bux: string;
  en: string | null;        // null = monolingual Buxori (164 "sentence N"/"line N" rows)
  spoken?: string;
  speaker?: string;         // notes "spoken by Rohel"
  analysis?: string;        // notes "shumo + -ya; naghz didan = to love"
  language: 'buxori' | 'hebrew';  // 4 piyyut lines are Hebrew, not Buxori
  source: SourceRef;
}

export type ExclusionReason =
  | 'grammar_header'            // promoted to syntaxRules instead
  | 'held_out'                  // evaluation build only: row belongs to eval/testset.json
  | 'no_answer'                 // exercise prompt, answer not in source
  | 'fill_in_stub'              // "Man xarid..." templates
  | 'not_transcribed'           // copyrighted text omitted at source
  | 'non_buxori_language';

export interface BuxoriIndex {
  meta: {
    schemaVersion: 2;
    /** Same TSV + same compiler ⇒ byte-identical index (no timestamps). */
    source: { file: string; sha256: string; rows: number };
    orthography: {
      script: 'latin';          // no Cyrillic / Hebrew / IPA in the source
      specialLetters: ['ü'];
      stressMarks: ['á', 'é', 'í', 'ć', 'ġ']; // ć, ġ: front matter marks stress on consonants too
      apostrophe: 'ayin';
    };
  };
  /** How the engine should choose between competing forms. */
  policy: {
    defaultRegister: 'regular';                 // owner decision: always conversational
    evidencePrecedence: readonly Evidence[];    // stated > attested > derived > borrowed
  };
  roots: RootsIndex;
  affixes: AffixIndex;
  syntaxRules: SyntaxRule[];
  examples: Record<ExampleId, Example>;
  /** Audit trail: every TSV row not turned into a root/affix/rule/example, and why. */
  excluded: { row: number; reason: ExclusionReason }[];
}
