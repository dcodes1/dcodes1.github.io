/*
 * compile.ts — translator/data/bukhori.tsv  →  translator/data/buxori-index.json
 *
 *   node compile.ts            (from translator/compiler/, Node ≥ 22.18)
 *
 * Every output item records the TSV rows it came from and an evidence level.
 * Every TSV row ends up somewhere (a root, inflected entry, affix, paradigm,
 * rule, example) or in `excluded` with a reason — test.ts enforces this.
 */
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTsv, sourceRef, type Row } from './tsv.ts';
import { affixForm, buxKey, dedupeBy, glossKey, senses, similarity, stemFinal } from './normalize.ts';
import {
  EVIDENCE_PRECEDENCE,
  type Affix, type AffixCategory, type AffixId, type Allomorph, type AttachesTo, type BuxKey, type BuxoriIndex,
  type Environment, type Example, type ExampleId, type ExclusionReason, type Form, type Gloss, type GlossKey,
  type InflectedEntry, type NumericValue, type Paradigm, type ParadigmId, type PartOfSpeech, type PersonNumber,
  type Register, type RootEntry, type RootId, type RuleId, type SourceRef, type Stem, type SyntaxRule,
  type TemplatePart, type Tense, type VerbInfo,
} from './types.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const TSV_PATH = resolve(HERE, '../data/bukhori.tsv');
const OUT_PATH = resolve(HERE, '../data/buxori-index.json');

// ───────────────────────────────────────────────────────────── row accounting
export type Destination = 'root' | 'inflected' | 'affix' | 'paradigm' | 'rule' | 'example' | 'excluded';
const used = new Map<number, Set<Destination>>();
const use = (r: Row, d: Destination) => { (used.get(r.row) ?? used.set(r.row, new Set()).get(r.row)!).add(d); };

// ───────────────────────────────────────────────────────────── row predicates
const PLACEHOLDER_EN = /^(sentence|line)\s*\d+[a-z]?\b/i;
const isHebrewLine = (r: Row) => PLACEHOLDER_EN.test(r.english) && /\(Hebrew\)/.test(r.english);
const isStub = (r: Row) => r.entryType === 'exercise' && /\.\.\.|…/.test(r.bukhori);
const isInflected = (r: Row) => /base noun:/i.test(r.notes) && !!r.bukhori;
const isAffixValue = (s: string) => /^-|-$/.test(s.trim()) || /^\((bare stem|no ending)\)$/.test(s.trim());

// ─────────────────────────────────────────────────────────────────── helpers
function envFrom(label: string, section = ''): Environment {
  for (const s of [label, section]) {
    if (/stem ends in a or i|vowel -a or -i/i.test(s)) return { kind: 'after_vowel', vowels: ['a', 'i'], dropFinalVowel: true };
    if (/stem ends in o\b/i.test(s)) return { kind: 'after_vowel', vowels: ['o'] };
    if (/stem ends in ü/i.test(s)) return { kind: 'after_vowel', vowels: ['ü'] };
    if (/consonant/i.test(s)) return { kind: 'after_consonant' };
    if (/vowel/i.test(s)) return { kind: 'after_vowel' };
  }
  return { kind: 'any' };
}
function registerFrom(...texts: string[]): Register {
  const t = texts.join(' ');
  if (/literary imperative|poetic|poetry/i.test(t)) return 'poetic';
  if (/Literal form|\(lit\.\)|literal/i.test(t)) return 'literal';
  return 'regular';
}
function personOf(label: string): PersonNumber | undefined {
  const l = label.toLowerCase().trim();
  if (/2nd singular/.test(l)) return '2sg';
  if (/2nd polite/.test(l)) return '2pol';
  if (/2nd plural/.test(l)) return '2pl';
  if (/^(you|your)\b.*\((pl\.?|plural)\)|^your \(pl/.test(l)) return '2pl';
  if (/^(you|your)\b.*\((polite|pol\.?)/.test(l)) return '2pol';
  if (/respectful/.test(l)) return '3resp';
  if (/^(my\b|my\/i|i\b|i myself)/.test(l)) return '1sg';
  if (/^(you|your)\b/.test(l)) return '2sg';
  if (/^(he|she|his|her|it|he\/she|his\/her)\b/.test(l)) return '3sg';
  if (/^(we|our)\b/.test(l)) return '1pl';
  if (/^(they|their)\b/.test(l)) return '3pl';
  return undefined;
}
function parseNumeric(v: string): NumericValue | undefined {
  if (!v) return undefined;
  let m;
  if ((m = /^(\d+)\/(\d+)$/.exec(v))) return { kind: 'fraction', numerator: Number(m[1]), denominator: Number(m[2]) };
  if ((m = /^(\d+)(st|nd|rd|th)$/.exec(v))) return { kind: 'ordinal', value: Number(m[1]) };
  if (/^-?\d+$/.test(v)) return { kind: 'cardinal', value: Number(v) };
  return undefined;
}
const lastWord = (s: string) => buxKey(s).split(' ').at(-1) ?? '';
const words = (s: string) => buxKey(s).split(' ').filter(Boolean);
const affixId = (s: string) => s as AffixId;

// ═════════════════════════════════════════════════════════════════ 1. LOAD
const { rows, raw } = readTsv(TSV_PATH);
const byRow = new Map(rows.map((r) => [r.row, r]));
const grammarRow = (title: string) => rows.find((r) => r.entryType === 'grammar' && r.section.toLowerCase() === title.toLowerCase());

// ═════════════════════════════════════════════════════════════ 2. AFFIXES
const affixes = new Map<AffixId, Affix>();

interface AffixSpec {
  id: string; category: AffixCategory; position: Affix['position']; gloss: string;
  attachesTo: AttachesTo[]; slot: number; personNumber?: PersonNumber;
}
function ensureAffix(spec: AffixSpec, evidence: Affix['evidence'] = 'stated'): Affix {
  const id = affixId(spec.id);
  let a = affixes.get(id);
  if (!a) {
    a = { id, category: spec.category, position: spec.position, gloss: spec.gloss, attachesTo: spec.attachesTo,
          ...(spec.personNumber ? { personNumber: spec.personNumber } : {}), allomorphs: [], slot: spec.slot, evidence };
    affixes.set(id, a);
  } else if (EVIDENCE_PRECEDENCE.indexOf(evidence) < EVIDENCE_PRECEDENCE.indexOf(a.evidence)) {
    a.evidence = evidence;   // an affix is as strong as its best-supported allomorph
  }
  return a;
}
function addAllomorph(a: Affix, al: Omit<Allomorph, 'sources'> & { sources: SourceRef[] }) {
  const same = a.allomorphs.find((x) => x.form === al.form && x.register === al.register && JSON.stringify(x.environment) === JSON.stringify(al.environment));
  if (same) { for (const s of al.sources) if (!same.sources.some((y) => y.row === s.row)) same.sources.push(s); return; }
  a.allomorphs.push(al);
}

// 2a. Paradigm rows ----------------------------------------------------------
interface SectionInfo { id: string; category: AffixCategory; domain: Paradigm['domain'] | null; tense?: Tense; stemClass?: Paradigm['stemClass']; position: Affix['position']; gloss: string; attachesTo: AttachesTo[]; slot: number }
const ENDING = (tense: Tense, gloss: string, stemClass?: Paradigm['stemClass']): SectionInfo => ({
  id: `end.${tense}${stemClass === 'irregular' ? '.irr' : ''}`, category: 'person_ending', domain: 'verb', tense,
  ...(stemClass ? { stemClass } : {}), position: 'suffix', gloss, attachesTo: tense === 'present' || tense === 'imperative' ? ['present_stem'] : ['past_stem', 'verb_word'], slot: 10,
});
const SECTION_MAP: [RegExp, SectionInfo][] = [
  [/^possessive endings/i, { id: 'poss', category: 'possessive', domain: 'possessive', position: 'suffix', gloss: 'possessive ending', attachesTo: ['noun'], slot: 20 }],
  [/^present tense endings \(irregular/i, ENDING('present', 'present tense ending (irregular verbs)', 'irregular')],
  [/^present tense endings/i, ENDING('present', 'present / future personal ending')],
  [/^simple past endings/i, ENDING('simple_past', 'simple past personal ending')],
  [/^past continuous endings/i, ENDING('past_continuous', 'past continuous ending (on bud)')],
  [/^present continuous endings/i, ENDING('present_continuous', 'present continuous ending')],
  [/^descriptive past endings/i, ENDING('descriptive_past', 'descriptive past ending')],
  [/^past perfect endings/i, ENDING('past_perfect', 'past perfect ending (on bud)')],
  [/^present perfect endings/i, ENDING('present_perfect', 'present perfect ending')],
  [/^imperative$/i, ENDING('imperative', 'imperative ending')],
  [/^noun plural$/i, { id: 'pl', category: 'plural', domain: null, position: 'suffix', gloss: 'plural', attachesTo: ['noun'], slot: 10 }],
  [/^direct object marker$/i, { id: 'obj', category: 'object', domain: null, position: 'suffix', gloss: 'direct object marker', attachesTo: ['noun', 'pronoun'], slot: 30 }],
  [/^ordinal superlative suffix$/i, { id: 'ord.sup', category: 'ordinal', domain: null, position: 'suffix', gloss: 'the Nth (ordinal superlative)', attachesTo: ['numeral'], slot: 6 }],
  [/^ordinal suffix$/i, { id: 'ord', category: 'ordinal', domain: null, position: 'suffix', gloss: 'ordinal (-th)', attachesTo: ['numeral'], slot: 5 }],
  [/^number conjunction$/i, { id: 'conj.num', category: 'conjunction', domain: null, position: 'suffix', gloss: 'and (joining compound numbers)', attachesTo: ['numeral'], slot: 40 }],
  [/^conjunction$/i, { id: 'conj.u', category: 'conjunction', domain: null, position: 'suffix', gloss: 'and (suffixed to the first item)', attachesTo: ['noun', 'adjective'], slot: 40 }],
  [/^comparative suffix$/i, { id: 'cmp.tar', category: 'comparison', domain: null, position: 'suffix', gloss: 'comparative (-er)', attachesTo: ['adjective'], slot: 5 }],
  [/^superlative suffix$/i, { id: 'sup.in', category: 'comparison', domain: null, position: 'suffix', gloss: 'superlative (added to -tar)', attachesTo: ['comparative'], slot: 6 }],
  [/^indefinite suffix$/i, { id: 'indef.e', category: 'indefinite', domain: null, position: 'suffix', gloss: 'indefinite (a / the one who)', attachesTo: ['noun'], slot: 15 }],
  [/^classifiers$/i, { id: 'cls.ta', category: 'classifier', domain: null, position: 'suffix', gloss: 'numeral classifier', attachesTo: ['numeral'], slot: 5 }],
  [/^past participle$/i, { id: 'part.a', category: 'participle', domain: null, position: 'suffix', gloss: 'past participle', attachesTo: ['past_stem'], slot: 5 }],
];
const PREFIX_SPEC: Record<string, AffixSpec> = {
  'na': { id: 'neg.na', category: 'negation', position: 'prefix', gloss: 'negation', attachesTo: ['present_stem', 'past_stem', 'verb_word'], slot: -20 },
  'ma': { id: 'neg.ma', category: 'negation', position: 'prefix', gloss: 'negation (literary imperative)', attachesTo: ['present_stem'], slot: -20 },
  'bi': { id: 'mood.bi', category: 'mood', position: 'prefix', gloss: 'affirmative imperative (literary)', attachesTo: ['present_stem'], slot: -20 },
};

const paradigms = new Map<ParadigmId, Paradigm>();
function paradigmFor(r: Row, info: Omit<Paradigm, 'id' | 'label' | 'cells' | 'sources'>): Paradigm {
  const id = r.section.toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '') as ParadigmId;
  let p = paradigms.get(id);
  if (!p) { p = { id, label: r.section, ...info, cells: {}, sources: [] }; paradigms.set(id, p); }
  if (!p.sources.some((s) => s.row === r.row)) p.sources.push(sourceRef(r));
  return p;
}
const KARDAN_TENSE: Record<string, Tense> = {
  'simple past': 'simple_past', 'simple present': 'present', 'simple future': 'future', 'past continuous': 'past_continuous',
  'present continuous': 'present_continuous', 'past perfect': 'past_perfect', 'present perfect': 'present_perfect', 'descriptive past': 'descriptive_past',
};
const paradigmWordRows: Row[] = [];   // hast / nest / va → become roots

for (const r of rows.filter((x) => x.entryType === 'paradigm')) {
  const values = r.bukhori.split(';').map((v) => v.trim()).filter(Boolean);
  const person = personOf(r.english);
  const register = registerFrom(r.section, r.english);
  const kardan = /^kardan: (.+)$/i.exec(r.section);

  // Full-form tables (kardan Table of Tenses, reflexive xud).
  if (kardan || /^reflexive pronoun xud/i.test(r.section)) {
    const tense = kardan ? KARDAN_TENSE[(kardan[1] ?? '').toLowerCase()] : undefined;
    const p = paradigmFor(r, { domain: kardan ? 'verb' : 'reflexive', ...(tense ? { tense } : {}), register: 'regular' });
    if (person) (p.fullForms ??= {})[person] = values;
    use(r, 'paradigm');
    continue;
  }
  // Standalone words printed in paradigm tables.
  if (values.every((v) => !isAffixValue(v))) { paradigmWordRows.push(r); continue; }

  const info = SECTION_MAP.find(([re]) => re.test(r.section))?.[1];
  for (const v of values) {
    const prefix = /^([a-zü]+)-$/i.exec(v);
    if (prefix) {
      const spec = PREFIX_SPEC[(prefix[1] ?? '').toLowerCase()];
      if (!spec) throw new Error(`Row ${r.row}: unknown prefix "${v}"`);
      const a = ensureAffix(spec);
      addAllomorph(a, { form: v, environment: { kind: 'any' }, register: register === 'poetic' ? 'poetic' : 'regular', evidence: 'stated', sources: [sourceRef(r)] });
      if (info?.domain === 'verb' && person) { const p = paradigmFor(r, { domain: 'verb', ...(info.tense ? { tense: info.tense } : {}), register }); (p.cells[person] ??= []).push(a.id); }
      continue;
    }
    if (!info) throw new Error(`Row ${r.row}: no affix mapping for section "${r.section}" value "${v}"`);
    const zero = /^\((bare stem|no ending)\)$/.test(v);
    const form = zero ? '' : v;
    // Literary plural "-on" note: "-yon after a vowel".
    const label = r.english;
    let id = info.id;
    if (info.id === 'poss' || info.category === 'person_ending') id = `${info.id}.${person ?? 'x'}`;
    if (/^noun plural$/i.test(r.section)) id = /literary/i.test(label) ? 'pl.on' : 'pl.ho';
    const spec: AffixSpec = {
      id, category: /^noun plural$/i.test(r.section) ? 'plural' : info.category, position: info.position,
      gloss: /^noun plural$/i.test(r.section) ? (/literary/i.test(label) ? 'plural (literary, animate)' : 'plural') : info.gloss + (person ? ` (${person})` : ''),
      attachesTo: /^noun plural$/i.test(r.section) ? ['noun'] : info.attachesTo, slot: /^noun plural$/i.test(r.section) ? 10 : info.slot,
      ...(person && (info.id === 'poss' || info.category === 'person_ending') ? { personNumber: person } : {}),
    };
    const a = ensureAffix(spec);
    const environment = /^classifiers$/i.test(r.section) ? { kind: 'any' as const } : envFrom(label, r.section);
    addAllomorph(a, { form, environment, register, ...(r.spoken ? { pronounced: r.spoken } : {}), evidence: 'stated', sources: [sourceRef(r)] });
    if (id === 'pl.on' && /-yon after a vowel/.test(r.notes)) {
      addAllomorph(a, { form: '-yon', environment: { kind: 'after_vowel' }, register: 'literal', evidence: 'stated', sources: [sourceRef(r)] });
    }
    if (info.domain && person) {
      const p = paradigmFor(r, { domain: info.domain, ...(info.tense ? { tense: info.tense } : {}), register, ...(info.stemClass ? { stemClass: info.stemClass } : /consonant stem|vowel stem/i.test(r.section + label) ? { stemClass: /vowel/i.test(r.section + label) ? 'vowel' as const : 'consonant' as const } : {}) });
      const cell = (p.cells[person] ??= []);
      if (!cell.includes(a.id)) cell.push(a.id);
    }
  }
  use(r, 'affix');
}

// 2b. Affixes stated only in grammar notes (tied to their grammar row) -------
function grammarAffix(title: string, spec: AffixSpec, forms: [string, Environment, Register?][]) {
  const g = grammarRow(title);
  if (!g) throw new Error(`Grammar row "${title}" not found`);
  const a = ensureAffix(spec);
  for (const [form, environment, register] of forms) addAllomorph(a, { form, environment, register: register ?? 'regular', evidence: 'stated', sources: [sourceRef(g)] });
  return a;
}
const ANY: Environment = { kind: 'any' };
grammarAffix('Simple present formation', { id: 'pref.me', category: 'aspect', position: 'prefix', gloss: 'present/habitual prefix (me- + stem + ending)', attachesTo: ['present_stem', 'past_stem'], slot: -10 }, [['me-', ANY]]);
grammarAffix('Negative present', PREFIX_SPEC['na']!, [['na-', ANY]]);
grammarAffix('Infinitive marker', { id: 'inf.an', category: 'infinitive', position: 'suffix', gloss: 'infinitive (English "to …")', attachesTo: ['past_stem'], slot: 5 }, [['-an', ANY]]);
grammarAffix('Linking noun and adjective', { id: 'ezafe', category: 'ezafe', position: 'suffix', gloss: 'links a noun to its adjective or possessor', attachesTo: ['noun'], slot: 25 },
  [['-i', { kind: 'after_consonant' }], ['-yi', { kind: 'after_vowel' }]]);
grammarAffix('Present continuous, Regular form', { id: 'cont.sod', category: 'continuous', position: 'suffix', gloss: 'present continuous (infinitive minus 3 letters + sod)', attachesTo: ['infinitive'], slot: 7 }, [['-sod-', ANY]]);
grammarAffix('Direct object marker', { id: 'obj', category: 'object', position: 'suffix', gloss: 'direct object marker', attachesTo: ['noun', 'pronoun'], slot: 30 }, [['-ro', ANY, 'literal']]);
for (const p of ['ku', 'da', 'ha', 'mi']) {
  grammarAffix('Sentence-final particles', { id: `prt.${p}`, category: 'sentence_particle', position: 'enclitic', gloss: `sentence-final particle (used with the present perfect)`, attachesTo: ['clause'], slot: 50 }, [[`-${p}`, ANY]]);
}
const DERIVATIONAL: [string, Affix['position'], string][] = [
  ['ham-', 'prefix', 'co-, fellow'], ['-don', 'suffix', 'place'], ['-zor', 'suffix', 'place'],
  ['-chi', 'suffix', 'profession'], ['-bon', 'suffix', 'profession'], ['-gar', 'suffix', 'profession'],
  ['-i', 'suffix', 'abstract noun'], ['-a', 'suffix', 'noun formation'], ['-gor', 'suffix', 'noun formation'], ['-or', 'suffix', 'noun formation'],
  ['-cha', 'suffix', 'diminutive / affection'], ['-icha', 'suffix', 'diminutive / affection'], ['-ak', 'suffix', 'diminutive / affection'],
  ['-chek', 'suffix', 'diminutive / affection'], ['-jon', 'suffix', 'term of affection'],
];
for (const [form, position, gloss] of DERIVATIONAL) {
  grammarAffix('Nominal derivational affixes', { id: `der.${affixForm(form)}`, category: 'derivational', position, gloss, attachesTo: ['noun', 'adjective', 'present_stem'], slot: 2 }, [[form, ANY]]);
}
// Classifier assimilation (stated as an observation, p50): haft + -ta → hafta.
{
  const g = grammarRow('Classifier assimilation');
  const cls = affixes.get(affixId('cls.ta'));
  if (g && cls) addAllomorph(cls, { form: '-a', environment: { kind: 'after_segment', segment: 't', merges: true }, register: 'regular', evidence: 'stated', sources: [sourceRef(g)] });
}
// The six vocab rows "-i man", "-i tu", … (ezafe + pronoun possession, Rule #1) belong to the ezafe affix.
for (const r of rows.filter((x) => x.entryType === 'vocab' && x.bukhori.startsWith('-'))) {
  const ez = affixes.get(affixId('ezafe'))!;
  addAllomorph(ez, { form: '-i', environment: { kind: 'after_consonant' }, register: 'regular', evidence: 'stated', sources: [sourceRef(r)] });
  use(r, 'affix');
}

// 2c. Pronunciation rules stated in grammar (apply to person endings) -------
const PRON_RULES: [string, RegExp, string][] = [
  ['1st plural -em is said -im', /^-(y)?em$/, '-im'],
  ['1st plural -em is said -im (past)', /^-(y)?em$/, '-im'],
  ['3rd plural -d is silent', /^-(y)?and$/, '-an'],
  ['3rd singular -d is silent', /^-(y)?ad$/, '-a'],
  ['Polite ending -ed is said -et', /^-(y)?ed$/, '-et'],
];
for (const [title, re, said] of PRON_RULES) {
  if (!grammarRow(title)) continue;
  for (const a of affixes.values()) {
    if (a.category !== 'person_ending') continue;
    for (const al of a.allomorphs) if (re.test(al.form) && !al.pronounced) al.pronounced = al.form.replace(/^-(y)?(em|and|ad|ed)$/, (_m, y = '') => '-' + y + said.slice(1));
  }
}
{
  const obj = affixes.get(affixId('obj'))!;
  for (const al of obj.allomorphs) if (al.form === '-ro') al.pronounced = '-a / -ya';
}

// ═══════════════════════════════════════════════════════════════ 3. EXAMPLES
const examples = new Map<ExampleId, Example>();
const excluded: { row: number; reason: ExclusionReason }[] = [];
const exclude = (r: Row, reason: ExclusionReason) => { excluded.push({ row: r.row, reason }); use(r, 'excluded'); };

for (const r of rows) {
  if (r.entryType === 'grammar' || r.entryType === 'vocab' || r.entryType === 'paradigm') continue;
  if (isInflected(r)) continue;                                     // → inflected entries
  if (!r.bukhori) { exclude(r, r.entryType === 'reading' && /not transcribed/i.test(r.notes) ? 'not_transcribed' : 'no_answer'); continue; }
  if (isStub(r)) { exclude(r, 'fill_in_stub'); continue; }
  if (r.entryType === 'exercise' && !PLACEHOLDER_EN.test(r.english)) { exclude(r, 'no_answer'); continue; }   // "conjugate in …: omadan"
  const placeholder = PLACEHOLDER_EN.test(r.english);
  const speaker = /spoken by ([^;,.]+)/i.exec(r.notes)?.[1]?.trim();
  const id = `e${r.row}` as ExampleId;
  examples.set(id, {
    id, bux: r.bukhori, en: placeholder ? null : r.english,
    ...(r.spoken ? { spoken: r.spoken } : {}),
    ...(speaker ? { speaker } : {}),
    ...(/\+|=/.test(r.notes) ? { analysis: r.notes } : {}),
    language: isHebrewLine(r) ? 'hebrew' : 'buxori',
    source: sourceRef(r),
  });
  use(r, 'example');
}

// ═════════════════════════════════════════════════════════════════ 4. ROOTS
const CONJ = new Set(['and', 'or', 'but', 'however', 'but; however', 'that', 'if', 'because', 'although', 'so', 'than', 'nor']);
const ADV = new Set(['always', 'never', 'now', 'today', 'tomorrow', 'yesterday', 'here', 'there', 'also', 'too', 'also; too', 'perhaps', 'maybe', 'perhaps; maybe', 'very', 'soon', 'already', 'again', 'still', 'then', 'tonight', 'sometimes', 'often']);
function posOf(r: Row): PartOfSpeech {
  const en = r.english.toLowerCase().trim();
  const lw = lastWord(r.bukhori);
  if ((/^to\s/.test(en) || /\bstem\s+-[^\s]+-/.test(r.notes)) && /an$/.test(lw) && lw.length > 3) return 'verb';
  if (r.numeric || /number|numeral|ordinal|fraction/i.test(r.section)) return 'numeral';
  if (/pronoun/i.test(r.section)) return 'pronoun';
  if (/adjectiv|colou?r/i.test(r.section)) return 'adjective';
  if (/\b(man's|woman's|boy's|girl's)\s+name\b|\(city\)|\(country\)/i.test(en) || /\bnames\b|cities|countries/i.test(r.section)) return 'proper_noun';
  if (CONJ.has(en)) return 'conjunction';
  if (ADV.has(en)) return 'adverb';
  if (/preposition/i.test(r.section)) return 'preposition';
  if (/copula/i.test(r.section)) return 'particle';
  if (words(r.bukhori).length >= 3) return 'phrase';
  return 'noun';
}

// Stems stated in any row's notes: "<infinitive>, past stem X" / "<infinitive> (stem -x-)".
const statedPast = new Map<string, Stem>();
const statedPresent = new Map<string, Stem>();
for (const r of rows) {
  for (const m of r.notes.matchAll(/\b([a-zü']+an),\s*past stem\s+([a-zü']+)/gi)) statedPast.set((m[1] ?? '').toLowerCase(), { text: (m[2] ?? '').toLowerCase(), evidence: 'stated', source: sourceRef(r) });
  for (const m of r.notes.matchAll(/\b([a-zü']+an)\s*\(stem\s+-([^-\s)]+)-/gi)) statedPresent.set((m[1] ?? '').toLowerCase(), { text: (m[2] ?? '').toLowerCase(), evidence: 'stated', source: sourceRef(r) });
}

const roots = new Map<RootId, RootEntry>();
const rootGroup = new Map<string, RootId>();      // `${lemmaKey}|${pos}` → id
const rootRows = new Map<RootId, Row[]>();
const rootRowsList = rows.filter((r) => r.entryType === 'vocab' && r.bukhori && !r.bukhori.startsWith('-') && !isInflected(r));
for (const r of [...rootRowsList, ...paradigmWordRows]) {
  const pieces = r.bukhori.split(';').map((s) => s.trim()).filter(Boolean);
  const lemmaText = pieces[0] ?? r.bukhori;
  const pos: PartOfSpeech = r.entryType === 'paradigm'
    ? (/copula/i.test(r.section) ? 'particle' : /conjunction/i.test(r.section) ? 'conjunction' : 'noun')
    : posOf(r);
  const gk = `${buxKey(lemmaText)}|${pos}`;
  let id = rootGroup.get(gk);
  if (!id) {
    id = `r${r.row}` as RootId;
    rootGroup.set(gk, id);
    roots.set(id, {
      id, lemma: { text: lemmaText, key: buxKey(lemmaText), kind: 'citation', evidence: 'stated', source: sourceRef(r) },
      pos, glosses: [], forms: [], sources: [],
    });
    rootRows.set(id, []);
  }
  const e = roots.get(id)!;
  rootRows.get(id)!.push(r);
  e.sources.push(sourceRef(r));
  e.glosses = dedupeBy([...e.glosses, ...senses(r.english).map((s): Gloss => ({ text: s.text, key: s.key, ...(s.qualifiers.length ? { qualifiers: s.qualifiers } : {}), ...(s.address ? { address: s.address } : {}) }))], (g) => g.key);
  for (const extra of pieces.slice(1)) e.forms.push({ text: extra, key: buxKey(extra), kind: 'variant', evidence: 'stated', source: sourceRef(r) });
  for (const sp of r.spoken.split(';').map((s) => s.trim()).filter(Boolean)) e.forms.push({ text: sp, key: buxKey(sp), kind: 'spoken', register: 'spoken', evidence: 'stated', source: sourceRef(r) });
  for (const piece of r.alt.split(';').map((s) => s.trim()).filter(Boolean)) {
    if (/^-[^\s]+-$/.test(piece)) continue;                                  // a stem — handled in verb info
    const bracket = /^(.*?)\s*\[([^\]]+)\]\s*$/.exec(piece);
    const literary = /\(lit\.\)/.test(piece);
    const text = (bracket ? (bracket[1] ?? '') : piece).replace(/\(lit\.\)/g, '').trim();
    if (!text) continue;
    const hebrew = /Hebrew-origin alternate/i.test(r.notes) || new RegExp(`\\b${text.replace(/[.*+?^${}()|[\]\\']/g, '\\$&')} is Hebrew-origin`, 'i').test(r.notes);
    const kind: Form['kind'] = hebrew ? 'hebrew_origin' : literary ? 'literary' : similarity(buxKey(text), buxKey(lemmaText)) >= 0.6 ? 'variant' : 'synonym';
    e.forms.push({ text, key: buxKey(text), kind, ...(literary ? { register: 'literal' as const } : {}), evidence: 'stated', source: sourceRef(r) });
    if (bracket) e.forms.push({ text: bracket[2] ?? '', key: buxKey(bracket[2] ?? ''), kind: 'spoken', register: 'spoken', evidence: 'stated', source: sourceRef(r) });
  }
  if (!e.numeric) { const n = parseNumeric(r.numeric); if (n) e.numeric = n; }
  if (/hebrew/i.test(r.section) && !e.origin) e.origin = 'hebrew';
  use(r, 'root');
}
for (const e of roots.values()) e.forms = dedupeBy(e.forms, (f) => `${f.key}|${f.kind}`).filter((f) => f.key !== e.lemma.key || f.kind === 'spoken');

// 4b. Verb information -----------------------------------------------------
const verbRootByInf = new Map<string, RootId>();
for (const e of roots.values()) if (e.pos === 'verb' && words(e.lemma.text).length === 1) verbRootByInf.set(e.lemma.key, e.id);
const findVerb = (inf: string): RootId | undefined =>
  verbRootByInf.get(inf) ?? [...verbRootByInf.entries()].find(([k]) => k.replace(/ü/g, 'u') === inf.replace(/ü/g, 'u'))?.[1];

for (const e of roots.values()) {
  if (e.pos !== 'verb') continue;
  const rs = rootRows.get(e.id)!;
  const inf = lastWord(e.lemma.text);
  const present: Stem[] = [];
  let literary: Stem | undefined;
  for (const r of rs) {
    for (const m of r.notes.matchAll(/(literary\s+)?stem\s+-([^\s;,)]+?)-/gi)) {
      const st: Stem = { text: (m[2] ?? '').toLowerCase(), evidence: 'stated', source: sourceRef(r) };
      if (m[1]) literary = st; else present.push(st);
    }
    const alt = /^-([^\s;]+)-$/.exec(r.alt.trim());
    if (alt) present.push({ text: (alt[1] ?? '').toLowerCase(), evidence: 'stated', source: sourceRef(r) });
  }
  const distinct = dedupeBy(present, (s) => s.text);
  const preverb = words(e.lemma.text).slice(0, -1).join(' ');
  const auxId = preverb ? findVerb(inf) : undefined;
  const aux = auxId ? roots.get(auxId) : undefined;
  const statedPres = statedPresent.get(inf);
  const presentStem: Stem | undefined = distinct[0]
    ?? (preverb && aux?.verb?.presentStem ? { text: aux.verb.presentStem.text, evidence: 'derived' as const } : undefined)
    ?? statedPres;
  const pastStem: Stem = statedPast.get(inf) ?? { text: inf.replace(/an$/, ''), evidence: 'derived' };
  const verb: VerbInfo = {
    infinitive: e.lemma,
    ...(presentStem ? { presentStem } : {}),
    ...(literary ? { literaryPresentStem: literary } : {}),
    pastStem,
    irregular: rs.some((r) => /\birregular\b/i.test(r.notes) || r.lesson === 'Irregular Verbs List'),
    takesMe: inf !== 'doshtan',
    ...(preverb && auxId ? { compound: { kind: 'nominal' as const, preverb, auxiliary: auxId } } : {}),
    ...(distinct.length > 1 ? { conflicts: [{ field: 'presentStem' as const, values: distinct.map((s) => s.text), sources: distinct.flatMap((s) => (s.source ? [s.source] : [])) }] } : {}),
  };
  e.verb = verb;
}
// Second pass so compounds pick up auxiliaries whose own stems were set above.
for (const e of roots.values()) {
  const v = e.verb;
  if (!v?.compound || v.presentStem) continue;
  const aux = roots.get(v.compound.auxiliary)?.verb?.presentStem;
  if (aux) v.presentStem = { text: aux.text, evidence: 'derived' };
}
for (const e of roots.values()) {
  if (e.pos === 'noun' || e.pos === 'adjective' || e.pos === 'proper_noun') e.noun = { stemFinal: stemFinal(lastWord(e.lemma.text)) };
}

// ═══════════════════════════════════════════════════════ 5. INFLECTED ENTRIES
const affixByForm = new Map<string, AffixId[]>();
for (const a of affixes.values()) for (const al of a.allomorphs) {
  const f = affixForm(al.form);
  if (!f) continue;
  const list = affixByForm.get(f) ?? [];
  if (!list.includes(a.id)) list.push(a.id);
  affixByForm.set(f, list);
}
const inflected = new Map<BuxKey, InflectedEntry[]>();
const rootsByKey = new Map<BuxKey, RootId[]>();
const pushKey = <K, V>(m: Map<K, V[]>, k: K, v: V) => { const l = m.get(k) ?? []; if (!l.includes(v)) l.push(v); m.set(k, l); };
for (const e of roots.values()) { pushKey(rootsByKey, e.lemma.key, e.id); for (const f of e.forms) pushKey(rootsByKey, f.key, e.id); }

for (const r of rows.filter(isInflected)) {
  const baseText = (/base noun:\s*([^;,.(]+)/i.exec(r.notes)?.[1] ?? '').trim();
  const PRONOUNS = new Set(['man', 'tu', 'ü', 'mo', 'shumo', 'inho']);
  const [first = '', second = ''] = buxKey(r.bukhori).split(' ');
  const analytic = PRONOUNS.has(second);            // "hoveri man" = noun + ezafe + pronoun
  const allowed = analytic ? ['ezafe'] : ['possessive', 'plural'];
  const qualifying = (f: string) => (affixByForm.get(f) ?? []).filter((id) => allowed.includes(affixes.get(id)?.category ?? ''));
  const endings = [...r.notes.matchAll(/(?:ending|\+)\s*(-[a-zü]+)/gi)].map((m) => affixForm(m[1] ?? ''));
  if (!endings.length && baseText) {
    // The note names only the base: segment the word against it, trying the full
    // base first and then the base minus its final vowel (Regular vowel stems:
    // "onim" = "on(a)" + "im", "bovom" = "bov(o)" + "om"). Keep the first split
    // whose remainder is a real affix; otherwise leave it unanalysed.
    const base = buxKey(baseText);
    for (const stem of [base, base.replace(/[aeiouü]$/, '')]) {
      const rest = stem && first.startsWith(stem) ? first.slice(stem.length) : '';
      if (rest && qualifying(rest).length) { endings.push(rest); break; }
    }
  }
  const ids = endings.flatMap(qualifying);
  const baseRoot = rootsByKey.get(buxKey(baseText))?.[0] ?? null;
  const entry: InflectedEntry = {
    text: r.bukhori, key: buxKey(r.bukhori),
    glosses: senses(r.english).map((s): Gloss => ({ text: s.text, key: s.key, ...(s.qualifiers.length ? { qualifiers: s.qualifiers } : {}), ...(s.address ? { address: s.address } : {}) })),
    base: baseRoot, baseText, affixes: [...new Set(ids)], ...(r.spoken ? { spoken: r.spoken } : {}), source: sourceRef(r),
  };
  pushKey(inflected, entry.key, entry);
  use(r, 'inflected');
}

// ═════════════════════════════════════════════════ 6. ATTESTED & BORROWED AFFIXES
// -ba: never stated as a rule; attested where <known word> + "ba" appears in a sentence.
{
  const known = new Set<string>([...rootsByKey.keys()]);
  const hits: { r: Row; word: string }[] = [];
  for (const ex of examples.values()) {
    if (ex.language !== 'buxori') continue;
    for (const w of ex.bux.split(/[\s,.!?;:]+/)) {
      const k = buxKey(w);
      if (k.length > 3 && k.endsWith('ba') && !known.has(k) && known.has(k.slice(0, -2))) hits.push({ r: byRow.get(ex.source.row)!, word: w });
    }
  }
  const a = ensureAffix({ id: 'dir.ba', category: 'directional', position: 'enclitic', gloss: 'to / at / for (attested in sentences, not stated as a rule)', attachesTo: ['noun', 'pronoun'], slot: 35 }, 'attested');
  addAllomorph(a, { form: '-ba', environment: ANY, register: 'regular', evidence: 'attested', sources: dedupeBy(hits.map((h) => sourceRef(h.r)), (s) => String(s.row)) });
  a.examples = [...new Set(hits.map((h) => `e${h.r.row}` as ExampleId))];
}
// Borrowed from colloquial Tajik by owner decision (2026-11-04). Not in the TSV.
const IRANICA = { title: 'Encyclopaedia Iranica — "Tajik iii. Colloquial Tajiki in comparison with Persian of Iran"', url: 'https://www.iranicaonline.org/articles/tajik-iii-colloquial/' };
const WIKI_TAJIK = { title: 'Wikipedia — "Tajik grammar"', url: 'https://en.wikipedia.org/wiki/Tajik_grammar' };
const VIA_SEARCH = 'Cited from search-result excerpts; the page itself could not be fetched from this build environment.';
addAllomorph(affixes.get(affixId('obj'))!, {
  form: '-ra', environment: { kind: 'after_vowel' }, register: 'spoken', evidence: 'borrowed', sources: [],
  borrowed: {
    from: 'tajik', bukhoriCounterpart: affixId('obj'),
    citations: [{ ...IRANICA, claim: 'Colloquial Tajik object marker is -(r)a: -ra after a vowel (tu-ra didam), -a after a consonant (man-a did).' }],
    caveat: `The TSV states -ya in this position for Bukhori; -ra is the colloquial Tajik counterpart. ${VIA_SEARCH}`,
  },
});
{
  const loc = ensureAffix({ id: 'loc.da', category: 'locative', position: 'enclitic', gloss: 'in / at (colloquial Tajik locative)', attachesTo: ['noun', 'pronoun'], slot: 35 }, 'borrowed');
  addAllomorph(loc, {
    form: '-da', environment: ANY, register: 'spoken', evidence: 'borrowed', sources: [],
    borrowed: {
      from: 'tajik', bukhoriCounterpart: affixId('dir.ba'),
      citations: [
        { ...WIKI_TAJIK, claim: 'Colloquial Tajik has innovated a locative case -да (-da), absent from literary Tajik.' },
        { ...IRANICA, claim: 'In northern dialects ba, dar/da and qati can follow the noun phrase as postpositions.' },
      ],
      caveat: `Not in the TSV, whose own sentences use -ba / the preposition ba for "at/in" (e.g. Kvins-kolledzhba mexonam). ${VIA_SEARCH}`,
    },
  });
}

// ═══════════════════════════════════════════════════════════════ 7. SYNTAX RULES
const rootByKeyOrFold = (k: string): RootId | undefined =>
  rootsByKey.get(k as BuxKey)?.[0] ?? [...rootsByKey.entries()].find(([kk]) => kk.replace(/ü/g, 'u') === k.replace(/ü/g, 'u'))?.[1]?.[0];
const lex = (text: string): TemplatePart | null => { const id = rootByKeyOrFold(text); return id ? { lexeme: id, text } : null; };
const A = (id: string): TemplatePart => { if (!affixes.has(affixId(id))) throw new Error(`template references unknown affix ${id}`); return { affix: affixId(id) }; };
const ENDINGS: TemplatePart = { affixCategory: 'person_ending' };
const opt = (p: TemplatePart): TemplatePart => ({ optional: p });
const parts = (...ps: (TemplatePart | null)[]): TemplatePart[] => (ps.includes(null) ? [] : (ps as TemplatePart[]));

type Kind = SyntaxRule['kind'];
const KIND: [RegExp, Kind][] = [
  [/^(letter q|silent letters|vowel u-umlaut|stress - |silent final h|literal form in writing|poetry exception)/i, 'orthography'],
  [/^(jewish day boundary|two day-name systems|hebrew-origin numbers|idioms|card games note|dialogue source note|oyad in poetry)/i, 'cultural_note'],
  [/^what a sentence is/i, 'general_note'],
  [/^word order$/i, 'word_order'],
  [/^(the )?copula hast$/i, 'copula'],
  [/^prepositions$/i, 'adposition'],
  [/(is said|is silent|^classifier assimilation$|^guftan stem$|^imperative vowel changes$)/i, 'phonology'],
  [/^(compound verbs|compound verb present|verbal compound verbs|profession verbs)/i, 'compound_verb'],
  [/^(passive|modal boyad|darkor|subordinate clauses of time|conjunction$|direct object marker$|past participle$|future participle|infinitive marker$|table of tenses$)/i, 'construction'],
  [/^(simple present formation|negative present|simple past|simple future|imperative mood|negative imperative|literary imperative|present continuous|descriptive past|past perfect|present perfect|past continuous|irregular verbs|doshtan takes no me-|sentence-final particles|past conjectural|present-future conjectural|present-progressive conjectural)/i, 'verb_form'],
];
const TENSE: [RegExp, Tense][] = [
  [/conjectural/i, 'conjectural_past'], [/present-future conjectural/i, 'conjectural_present'], [/present-progressive conjectural/i, 'conjectural_progressive'],
  [/present continuous/i, 'present_continuous'], [/past continuous/i, 'past_continuous'], [/present perfect|sentence-final/i, 'present_perfect'],
  [/past perfect/i, 'past_perfect'], [/descriptive past/i, 'descriptive_past'], [/simple past/i, 'simple_past'], [/future/i, 'future'],
  [/imperative/i, 'imperative'], [/present|irregular verbs|doshtan/i, 'present'],
];
const tenseOf = (t: string): Tense => {
  if (/present-future conjectural/i.test(t)) return 'conjectural_present';
  if (/present-progressive conjectural/i.test(t)) return 'conjectural_progressive';
  return TENSE.find(([re]) => re.test(t))?.[1] ?? 'present';
};

const TEMPLATES: Record<string, () => { template: TemplatePart[]; negation?: { affix: AffixId; placement: 'before_me' | 'before_stem' | 'before_participle' | 'before_auxiliary' } }> = {
  'simple present formation': () => ({ template: [A('pref.me'), { stem: 'present' }, ENDINGS], negation: { affix: affixId('neg.na'), placement: 'before_me' } }),
  'negative present': () => ({ template: [A('neg.na'), A('pref.me'), { stem: 'present' }, ENDINGS] }),
  'simple future': () => ({ template: [A('pref.me'), { stem: 'present' }, ENDINGS], negation: { affix: affixId('neg.na'), placement: 'before_me' } }),
  'doshtan takes no me-': () => ({ template: [{ stem: 'present' }, ENDINGS], negation: { affix: affixId('neg.na'), placement: 'before_stem' } }),
  'simple past formation': () => ({ template: [{ stem: 'past' }, ENDINGS], negation: { affix: affixId('neg.na'), placement: 'before_stem' } }),
  'descriptive past': () => ({ template: [A('pref.me'), { stem: 'past' }, ENDINGS], negation: { affix: affixId('neg.na'), placement: 'before_me' } }),
  'present continuous, regular form': () => ({ template: [{ stem: 'infinitive_minus_3' }, A('cont.sod'), ENDINGS] }),
  'imperative mood': () => ({ template: [{ stem: 'present' }, opt(ENDINGS)] }),
  'negative imperative': () => ({ template: [A('neg.na'), { stem: 'present' }, opt(ENDINGS)] }),
  'literary imperative prefixes': () => ({ template: [A('mood.bi'), { stem: 'present' }, opt(ENDINGS)] }),
};
const CONSTRUCTIONS: Record<string, () => TemplatePart[]> = {
  'passive voice': () => parts({ stem: 'past_participle' }, lex('shudan'), ENDINGS),
  'modal boyad - obligation (past)': () => parts(lex('boyad'), A('pref.me'), { stem: 'past' }, ENDINGS),
  'darkor for obligation': () => parts({ role: 'indirect_object' }, A('dir.ba'), { stem: 'infinitive' }, lex('darkor')),
  'direct object marker': () => [{ role: 'object' }, A('obj')],
  'past participle': () => [{ stem: 'past' }, A('part.a')],
  'infinitive marker': () => [{ stem: 'past' }, A('inf.an')],
};
const NOUN_PHRASES: Record<string, () => TemplatePart[]> = {
  'linking noun and adjective': () => [{ role: 'head_noun' }, A('ezafe'), { role: 'adjective' }],
  'possession': () => [{ role: 'head_noun' }, { affixCategory: 'possessive' }],
  'possessive rule 1 - consonant': () => [{ role: 'head_noun' }, A('ezafe'), { role: 'possessor' }],
  'noun plural': () => [{ role: 'head_noun' }, A('pl.ho')],
  'classifiers': () => [{ role: 'numeral' }, A('cls.ta'), { role: 'head_noun' }],
  'joining numbers': () => [{ role: 'numeral' }, A('conj.num'), { role: 'numeral' }],
  'ordinal formation': () => [{ role: 'numeral' }, A('ord')],
  'comparatives': () => [{ role: 'adjective' }, A('cmp.tar')],
  'superlatives': () => [{ role: 'adjective' }, A('cmp.tar'), A('sup.in')],
  'ordinal superlatives': () => [{ role: 'numeral' }, A('ord.sup')],
  'indefinite nouns': () => [{ role: 'head_noun' }, A('indef.e')],
};

const syntaxRules: SyntaxRule[] = [];
const examplesFor = (title: string): ExampleId[] =>
  [...examples.values()].filter((e) => e.source.section.toLowerCase() === title.toLowerCase()).map((e) => e.id);
const COMPOUND_AUX = ['kardan', 'dodan', 'zadan', 'xondan', 'didan', 'xurdan', 'shudan'];

for (const g of rows.filter((r) => r.entryType === 'grammar')) {
  const t = g.section, tl = t.toLowerCase();
  const kind: Kind = KIND.find(([re]) => re.test(t))?.[1] ?? 'noun_phrase';
  const base = {
    id: tl.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') as RuleId, title: t, statement: g.notes,
    evidence: 'stated' as const, ...(/Literal/i.test(t) ? { register: 'literal' as const } : /Regular/i.test(t) ? { register: 'regular' as const } : {}),
    examples: examplesFor(t), sources: [sourceRef(g)],
  };
  const exceptions = g.review ? ['Source flagged REVIEW: ' + g.notes] : undefined;
  const b = exceptions ? { ...base, exceptions } : base;
  switch (kind) {
    case 'word_order':
      syntaxRules.push({ ...b, kind, clause: 'declarative', verbFinal: true,
        order: [{ role: 'subject' }, opt({ role: 'object' }), opt({ role: 'location' }), opt({ role: 'source' }), opt({ role: 'goal' }), opt({ role: 'instrument' }), { role: 'verb' }],
        exceptions: [...(exceptions ?? []), 'The TSV fixes subject-first and verb-last; the relative order of the middle constituents is not specified.'] });
      break;
    case 'verb_form': {
      const tpl = TEMPLATES[tl]?.();
      syntaxRules.push({ ...b, kind, tense: tenseOf(t), template: tpl?.template ?? [], ...(tpl?.negation ? { negation: tpl.negation } : {}) });
      break;
    }
    case 'compound_verb': {
      const auxIds = COMPOUND_AUX.filter((a) => g.notes.toLowerCase().includes(a)).map(findVerb).filter((x): x is RootId => !!x);
      syntaxRules.push({ ...b, kind, compound: /^verbal/i.test(t) ? 'verbal' : 'nominal', auxiliaries: auxIds, preverb: 'before_auxiliary', inflects: 'auxiliary', negation: 'on_auxiliary' });
      break;
    }
    case 'copula':
      syntaxRules.push({ ...b, kind, affirmative: 'hast', negative: 'nest', spoken: 'e', droppable: true });
      break;
    case 'adposition': {
      const qati = rootByKeyOrFold('qati');
      if (!qati) throw new Error('qati root not found for Prepositions rule');
      syntaxRules.push({ ...b, id: `${b.id}_qati` as RuleId, kind, word: qati, form: 'qati', placement: 'after' });
      syntaxRules.push({ ...b, id: `${b.id}_qatori` as RuleId, kind, word: qati, form: 'qatori', placement: 'before' });
      syntaxRules.push({ ...b, id: `${b.id}_bo` as RuleId, kind, word: qati, form: 'bo', placement: 'before', register: 'literal' });
      break;
    }
    case 'construction':
      syntaxRules.push({ ...b, kind, name: tl, template: CONSTRUCTIONS[tl]?.() ?? [] });
      break;
    case 'noun_phrase':
      syntaxRules.push({ ...b, kind, template: NOUN_PHRASES[tl]?.() ?? [] });
      break;
    case 'phonology':
      syntaxRules.push({ ...b, kind, effect: g.notes });
      break;
    case 'orthography': case 'cultural_note': case 'general_note':
      syntaxRules.push({ ...b, kind });
      break;
  }
  use(g, 'rule');
}

// ═══════════════════════════════════════════════════════════════ 8. INDEXES
const record = <K extends string, V>(m: Map<K, V>): Record<K, V> => Object.fromEntries([...m.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) as Record<K, V>;
const byGloss = new Map<GlossKey, RootId[]>();
const inflectedByGloss = new Map<GlossKey, BuxKey[]>();
const byStem = new Map<string, { root: RootId; stem: 'present' | 'past' | 'literary_present' }[]>();
for (const e of roots.values()) {
  for (const g of e.glosses) {
    pushKey(byGloss, g.key, e.id);
    if (e.pos === 'verb' && g.key.startsWith('to ')) pushKey(byGloss, glossKey(g.key.slice(3)), e.id);
  }
  const v = e.verb;
  if (v && !v.compound) {
    const add = (s: string, stem: 'present' | 'past' | 'literary_present') => {
      const l = byStem.get(s) ?? []; if (!l.some((x) => x.root === e.id && x.stem === stem)) l.push({ root: e.id, stem }); byStem.set(s, l);
    };
    if (v.presentStem) add(v.presentStem.text, 'present');
    if (v.literaryPresentStem) add(v.literaryPresentStem.text, 'literary_present');
    add(v.pastStem.text, 'past');
    for (const c of v.conflicts ?? []) for (const s of c.values) add(s, 'present');
  }
}
for (const [k, list] of inflected) for (const ie of list) for (const g of ie.glosses) pushKey(inflectedByGloss, g.key, k);
// Final affix → form index (now including attested / borrowed allomorphs).
const finalByForm = new Map<string, AffixId[]>();
for (const a of affixes.values()) for (const al of a.allomorphs) { const f = affixForm(al.form); if (f) pushKey(finalByForm, f, a.id); }

const index: BuxoriIndex = {
  meta: {
    schemaVersion: 1,
    source: { file: 'translator/data/bukhori.tsv', sha256: createHash('sha256').update(raw).digest('hex'), rows: rows.length },
    builtAt: new Date().toISOString(),
    orthography: { script: 'latin', specialLetters: ['ü'], stressMarks: ['á', 'é', 'í'], apostrophe: 'ayin' },
  },
  policy: { defaultRegister: 'regular', evidencePrecedence: EVIDENCE_PRECEDENCE },
  roots: {
    entries: record(roots), inflected: record(inflected), byKey: record(rootsByKey), byGloss: record(byGloss),
    inflectedByGloss: record(inflectedByGloss), byStem: record(byStem),
  },
  affixes: { entries: record(affixes), byForm: record(finalByForm), paradigms: record(paradigms) },
  syntaxRules,
  examples: record(examples),
  excluded: excluded.sort((a, b) => a.row - b.row),
};

// Every row must have been placed somewhere.
const missing = rows.filter((r) => !used.has(r.row)).map((r) => r.row);
if (missing.length) throw new Error(`Unaccounted TSV rows: ${missing.slice(0, 20).join(', ')}${missing.length > 20 ? ' …' : ''}`);

writeFileSync(OUT_PATH, JSON.stringify(index));
const count = (d: Destination) => [...used.values()].filter((s) => s.has(d)).length;
console.log(JSON.stringify({
  out: OUT_PATH.replace(resolve(HERE, '../..') + '/', ''), bytes: Buffer.byteLength(JSON.stringify(index)),
  rows: rows.length, rowsBy: Object.fromEntries((['root', 'inflected', 'affix', 'paradigm', 'rule', 'example', 'excluded'] as const).map((d) => [d, count(d)])),
  roots: roots.size, verbs: [...roots.values()].filter((e) => e.verb).length, inflected: [...inflected.values()].flat().length,
  affixes: affixes.size, paradigms: paradigms.size, rules: syntaxRules.length, examples: examples.size, excluded: excluded.length,
}, null, 1));

export { index };
