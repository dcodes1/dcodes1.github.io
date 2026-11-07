/*
 * English → Buxori translation engine over src/data/buxori-index.json.
 *
 * Layers, first match wins:
 *   exact          the English is an entry, inflected headword or example in the TSV
 *   grammar        a sentence / noun phrase built from TSV words, paradigms and rules
 *   partial        the same, but some English words had no source and are missing
 *   fuzzy          a near-identical spelling of an entry (typo tolerance)
 *   compositional  word-by-word gloss, clearly marked as such
 *   none           nothing reliable; similar TSV examples are offered instead
 *
 * The engine never outputs a Buxori word that is not in the index or produced by a
 * cited rule. Unknown English words are listed, not translated.
 */
import { glossKey, similarity } from '../lib/normalizer.ts';
import type { BuxoriIndex, Evidence, Example, RootEntry } from '../lib/types.ts';
import { ARTICLES, BE_FORMS, ENGLISH_SYNONYMS, analyze, cleanEnglish, expandContractions, normalizeInformal } from './english.ts';
import { Grammar, type Draft, type Variant } from './grammar.ts';
import { Lexicon, inline } from './lexicon.ts';
import { Morphology, type Step } from './morphology.ts';
import { parseNumber } from './numbers.ts';

export type Status = 'exact' | 'grammar' | 'partial' | 'fuzzy' | 'compositional' | 'none';

export interface Alternative { text: string; note?: string; rows?: number[] }
export interface Retrieved { en: string; bux: string; score: number; row: number }

export interface Translation {
  status: Status;
  /** Primary output (Regular register). null when status is "none". */
  text: string | null;
  /** informal (tu) / formal (shumo) renderings when "you" is involved. */
  variants: { register: 'informal' | 'formal'; text: string }[];
  /** Other attested forms: spoken pronunciation, variants, synonyms. */
  alternatives: Alternative[];
  confidence: number;
  /** Weakest evidence used: attested/stated output is source-backed; derived/borrowed is rule-built. */
  evidence: Evidence | null;
  steps: Step[];
  /** English words that could not be sourced (omitted from the output). */
  unknown: string[];
  /** TSV rows behind the output. */
  rows: number[];
  review: boolean;
  notes: string[];
  matchedEnglish?: string;
  related: Retrieved[];
  /**
   * A draft that is NOT offered as a translation: word-by-word glosses or a sentence
   * with missing words. On the frozen held-out set these were right 0 times out of 36,
   * so they are shown as study hints only (status stays "none").
   */
  hint?: { kind: 'partial' | 'words'; text: string; variants: { register: 'informal' | 'formal'; text: string }[] };
}

const EVIDENCE_ORDER: Evidence[] = ['borrowed', 'derived', 'attested', 'stated'];
const weakest = (e: Evidence[]): Evidence | null => (e.length ? EVIDENCE_ORDER.find((x) => e.includes(x)) ?? null : null);
const uniqRows = (r: number[]) => [...new Set(r.filter((x) => x > 0))].sort((a, b) => a - b);

/** b is a with two adjacent letters swapped. */
function isTransposition(a: string, b: string): boolean {
  if (a.length !== b.length || a === b) return false;
  const d = [...a].map((c, i) => (c !== b[i] ? i : -1)).filter((i) => i >= 0);
  return d.length === 2 && d[1] === d[0]! + 1 && a[d[0]!] === b[d[1]!] && a[d[1]!] === b[d[0]!];
}
/** a is b with one letter typed twice. */
function isDoubled(a: string, b: string): boolean {
  if (a.length !== b.length + 1) return false;
  for (let i = 1; i < a.length; i++) if (a[i] === a[i - 1] && a.slice(0, i) + a.slice(i + 1) === b) return true;
  return false;
}

function trigrams(s: string): Set<string> {
  const t = `  ${s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()}  `;
  const g = new Set<string>();
  for (let i = 0; i + 3 <= t.length; i++) g.add(t.slice(i, i + 3));
  return g;
}
const jaccard = (a: Set<string>, b: Set<string>) => { let n = 0; for (const x of a) if (b.has(x)) n++; return n / (a.size + b.size - n || 1); };

export class Engine {
  readonly lex: Lexicon;
  readonly morph: Morphology;
  readonly grammar: Grammar;
  private readonly corpus: { en: string; bux: string; row: number; tg: Set<string>; toks: Set<string> }[];
  private readonly entryKeys: { key: string; tg: Set<string> }[];
  private readonly cache = new Map<string, Translation>();

  constructor(index: BuxoriIndex) {
    this.lex = new Lexicon(index);
    this.morph = new Morphology(index);
    this.grammar = new Grammar(this.lex, this.morph);
    this.corpus = Object.values(index.examples)
      .filter((e): e is Example & { en: string } => !!e.en && e.language === 'buxori')
      .map((e) => ({ en: e.en, bux: e.bux, row: e.source.row, tg: trigrams(e.en), toks: new Set(glossKey(e.en).split(/\W+/).filter(Boolean)) }));
    const keys = new Set([...Object.keys(index.roots.byGloss), ...Object.keys(index.roots.inflectedByGloss)]);
    this.entryKeys = [...keys].map((key) => ({ key, tg: trigrams(key) }));
  }

  translate(input: string): Translation {
    const typed = (input ?? '').slice(0, 2000).trim();
    // Everyday typing ("im so happy!!", "thx", "how r u") → standard English first.
    const informal = normalizeInformal(typed);
    const raw = informal.text;
    const key = glossKey(raw);
    if (!key) return this.none(raw, 'Type some English to translate.');
    const cached = this.cache.get(raw);
    if (cached) return cached;
    let res = this.exact(raw) ?? this.segmented(raw) ?? this.generated(raw) ?? this.fuzzy(raw) ?? this.compositional(raw) ?? this.none(raw);
    if (res.status === 'none' || res.status === 'compositional' || res.status === 'partial') {
      // Spelling correction: retry with unknown English words replaced by their closest
      // source-vocabulary word ("grandfahter" → "grandfather"). Never swaps known words.
      const fixed = this.spellCorrect(raw);
      if (fixed) {
        const again = this.exact(fixed.text) ?? this.segmented(fixed.text) ?? this.generated(fixed.text);
        const rank: Status[] = ['none', 'compositional', 'partial', 'fuzzy', 'grammar', 'exact'];
        if (again && rank.indexOf(again.status) > rank.indexOf(res.status)) {
          res = { ...again, status: again.status === 'exact' ? 'fuzzy' : again.status, confidence: Math.round(again.confidence * 0.85 * 100) / 100,
            matchedEnglish: fixed.text, notes: [`Spelling corrected: ${fixed.changes.join(', ')}.`, ...again.notes] };
        }
      }
    }
    if (res.status === 'partial' || res.status === 'compositional') res = this.demote(res);
    if (informal.changes.length) res = { ...res, notes: [`Read as: “${raw}”.`, ...res.notes] };
    this.cache.set(raw, res);
    return res;
  }

  /** Turn an unreliable draft into "no translation" + a clearly separate hint. */
  private demote(r: Translation): Translation {
    const kind = r.status === 'partial' ? 'partial' : 'words';
    return {
      ...r,
      status: 'none', text: null, variants: [], alternatives: [], confidence: 0, evidence: null,
      notes: [kind === 'partial'
        ? 'No reliable translation: some words are not in the source, so a full sentence could not be built.'
        : 'No reliable translation: only individual words were found.', ...r.notes.filter((n) => !/^(Word-by-word gloss|Incomplete:)/.test(n))],
      hint: { kind, text: r.text ?? '', variants: r.variants },
      related: r.related.length ? r.related : this.related(r.matchedEnglish ?? '', 3),
    };
  }

  /**
   * Several sentences, or a greeting + sentence ("Hello, how are you?"): translate
   * each part on its own when every part has a sourced translation.
   */
  private segmented(raw: string): Translation | null {
    const parts = cleanEnglish(raw).text.match(/[^.!?;,]+[.!?;,]?/g)?.map((p) => p.trim()).filter((p) => glossKey(p)) ?? [];
    if (parts.length < 2) return null;
    const done = parts.map((p) => {
      const r = this.exact(p) ?? this.generated(p) ?? this.fuzzy(p);
      return r ? { r, punct: /[.!?]$/.test(p) ? p.slice(-1) : /,$/.test(p) ? ',' : '' } : null;
    });
    if (done.some((d) => !d || !d.r.text)) return null;
    const ok = done as { r: Translation; punct: string }[];
    const join = (pick: (t: Translation) => string) => ok.map(({ r, punct }) => {
      const t = pick(r);
      return /[.!?,]$/.test(t) || !punct ? t : t + punct;
    }).join(' ');
    const hasVariants = ok.some(({ r }) => r.variants.length);
    const variants = hasVariants ? (['informal', 'formal'] as const).map((register) => ({
      register, text: join((r) => r.variants.find((v) => v.register === register)?.text ?? r.text ?? ''),
    })) : [];
    const order: Status[] = ['none', 'compositional', 'fuzzy', 'partial', 'grammar', 'exact'];
    const status = order.find((st) => ok.some(({ r }) => r.status === st)) ?? 'grammar';
    return {
      status, text: join((r) => r.text ?? ''), variants, alternatives: [],
      confidence: Math.min(...ok.map(({ r }) => r.confidence)),
      evidence: weakest(ok.flatMap(({ r }) => (r.evidence ? [r.evidence] : []))),
      steps: ok.flatMap(({ r }, k) => [{ text: `Part ${k + 1}: “${parts[k]}” → ${r.text} (${r.status}).`, rows: r.rows }, ...r.steps]),
      unknown: ok.flatMap(({ r }) => r.unknown), rows: uniqRows(ok.flatMap(({ r }) => r.rows)),
      review: ok.some(({ r }) => r.review), notes: ok.flatMap(({ r }) => r.notes), related: [],
    };
  }

  // ── exact ───────────────────────────────────────────────────────────────
  private exact(raw: string): Translation | null {
    const base = raw.replace(/[.!?]+$/, '');
    const imperative = /!\s*$/.test(raw) || /\((sing|polite|pol|pl)\.?\)/i.test(raw);
    // [form, which roots are acceptable]: "to X" may only resolve to a verb, a bare word prefers non-verbs
    const expanded = expandContractions(base);
    const forms: [string, 'any' | 'verb' | 'nonverb'][] = [[raw, 'any'], [base, 'any'], ...(expanded !== base.toLowerCase() ? [[expanded, 'any'] as [string, 'any']] : []),
      [/^to\s/i.test(raw) ? raw.slice(3) : `to ${raw}`, /^to\s/i.test(raw) ? 'verb' : 'verb'],
      ...(ENGLISH_SYNONYMS[glossKey(base)] ?? []).map((x): [string, 'any'] => [x, 'any'])];
    for (const [f, want] of forms) {
      // 1. inflected headwords ("my mom" → Onim, Regular register first)
      const infl = this.lex.inflected(f);
      if (infl.length) {
        const [best, ...others] = infl;
        return this.result('exact', best!.text, {
          rows: [best!.source.row], evidence: ['attested'], confidence: 1, review: !!best!.source.review,
          alternatives: others.map((o) => ({ text: o.text, note: /literal/i.test(o.source.section) ? 'Literal form' : o.source.section, rows: [o.source.row] })),
          steps: [{ text: `Printed in the source (p${best!.source.page}, ${best!.source.section}).`, rows: [best!.source.row] }],
          matchedEnglish: f, raw,
        });
      }
      // 2. dictionary entries
      let roots = this.lex.roots(f);
      if (want === 'verb') roots = roots.filter((r) => r.pos === 'verb');
      // "come!" is an imperative, not the dictionary entry "Omadan": let the grammar layer conjugate it
      if (imperative) roots = roots.filter((r) => r.pos !== 'verb');
      // a bare English word prefers an entry glossed with exactly that word over a verb glossed "to …"
      if (want === 'any' && !/^to\s/i.test(f)) {
        const k = glossKey(f);
        roots = [...roots].sort((a, b) => Number(!a.glosses.some((g) => g.key === k)) - Number(!b.glosses.some((g) => g.key === k)));
      }
      if (roots.length) return this.fromRoots(roots, f, raw);
      // 3. example sentences / phrases
      const ex = this.lex.examples(f);
      if (ex.length) {
        // Honour "(sing.)" / "(polite)" / "(pl.)": the source labels its rows the same way.
        const want = cleanEnglish(raw).address;
        const mismatch = (e: Example) => (want && cleanEnglish(e.en ?? '').address !== want ? 1 : 0);
        const [best, ...others] = [...ex].sort((a, b) => mismatch(a) - mismatch(b) || (a.source.review ? 1 : 0) - (b.source.review ? 1 : 0) || a.source.row - b.source.row);
        // No label typed, and the source prints both a (sing.) and a (polite) row: offer both.
        const sing = !want ? ex.find((e) => cleanEnglish(e.en ?? '').address === 'informal') : undefined;
        const pol = !want ? ex.find((e) => cleanEnglish(e.en ?? '').address === 'formal') : undefined;
        const variants = sing && pol ? [{ register: 'informal' as const, text: sing.bux }, { register: 'formal' as const, text: pol.bux }] : [];
        return this.result('exact', variants[0]?.text ?? best!.bux, {
          variants,
          rows: [best!.source.row], evidence: ['attested'], confidence: 1, review: !!best!.source.review,
          alternatives: [...(best!.spoken ? [{ text: best!.spoken, note: 'spoken' }] : []), ...others.filter((o) => o.bux !== best!.bux).map((o) => ({ text: o.bux, rows: [o.source.row] }))],
          steps: [{ text: `Printed in the source (p${best!.source.page}${best!.speaker ? `, spoken by ${best!.speaker}` : ''}).`, rows: [best!.source.row] }],
          notes: best!.analysis ? [best!.analysis] : [], matchedEnglish: f, raw,
        });
      }
    }
    return null;
  }

  private fromRoots(roots: RootEntry[], english: string, raw: string): Translation {
    const [best, ...others] = roots;
    const b = best!;
    const alts: Alternative[] = [];
    for (const f of b.forms) alts.push({ text: f.text, note: f.kind === 'spoken' ? 'spoken' : f.kind.replace(/_/g, ' '), rows: [f.source.row] });
    for (const o of others) alts.push({ text: o.lemma.text, note: o.glosses.map((g) => g.text).slice(0, 3).join('; '), rows: [o.sources[0]?.row ?? 0] });
    const notes: string[] = [];
    const quals = b.glosses.find((g) => g.key === glossKey(english))?.qualifiers;
    if (quals?.length) notes.push(...quals);
    if (b.verb?.presentStem) notes.push(`present stem -${b.verb.presentStem.text}-, past stem -${b.verb.pastStem.text}-`);
    const review = b.sources.every((s) => s.review);
    if (review) notes.push('The source marks this entry as uncertain (REVIEW).');
    return this.result('exact', b.lemma.text, {
      rows: b.sources.map((s) => s.row), evidence: [b.lemma.evidence === 'derived' ? 'derived' : 'attested'],
      confidence: b.lemma.evidence === 'derived' ? 0.8 : 1, review, alternatives: alts, notes,
      steps: [{ text: b.lemma.evidence === 'derived' ? `Derived: ${b.glosses[0]?.qualifiers?.join(' ') ?? ''}.` : `Dictionary entry (p${b.sources[0]?.page}).`, rows: b.sources.map((s) => s.row).slice(0, 3) }],
      matchedEnglish: english, raw,
    });
  }

  // ── grammar ─────────────────────────────────────────────────────────────
  private generated(raw: string): Translation | null {
    const input = analyze(raw);
    if (!input.tokens.length) return null;
    // A bare number: "twenty-five", "5th", "three hundred"
    const num = parseNumber(input.tokens, 0);
    if (num && num.length === input.tokens.length) {
      const b = num.ordinal ? this.grammar.numbers.ordinal(num.value) : this.grammar.numbers.cardinal(num.value);
      if (!b) return null;
      return this.result('grammar', b.text, { steps: b.steps, evidence: [b.evidence], confidence: b.evidence === 'stated' ? 0.9 : 0.7, rows: b.steps.flatMap((x) => x.rows ?? []), raw });
    }
    // "to taste": an English infinitive whose verb is not in the source has nothing to build from
    if (input.tokens[0] === 'to' && input.tokens.length <= 3) return null;
    let variants: Variant[] | null = null;
    try { variants = this.grammar.clause(input); } catch { variants = null; }
    if (!variants) {
      // bare noun phrase ("two red apples", "my brothers")
      const np = this.grammar.nounPhrase(input.tokens, input, 'default');
      if (np?.text && !np.unknown.length) variants = [{ register: 'default', draft: { ...np } }];
      if (np?.text && !np.unknown.length && input.tokens.some((t) => t === 'your')) {
        const inf = this.grammar.nounPhrase(input.tokens, input, 'informal');
        const fm = this.grammar.nounPhrase(input.tokens, input, 'formal');
        if (inf?.text && fm?.text) variants = [{ register: 'informal', draft: inf }, { register: 'formal', draft: fm }];
      }
    }
    if (!variants?.length) return null;
    const main = variants[0]!.draft;
    // Require that most content words were sourced; otherwise word-by-word is more honest.
    const content = input.tokens.filter((t) => !ARTICLES.has(t) && !BE_FORMS.has(t) && !['do', 'does', 'did', 'not', 'will', 'to', 'please'].includes(t));
    if (main.unknown.length && main.unknown.length >= Math.ceil(content.length / 2)) return null;
    const all = variants.map((v) => v.draft);
    return this.fromDraft(main, raw, variants.length > 1 ? variants.map((v) => ({ register: v.register as 'informal' | 'formal', text: v.draft.text })) : [], all);
  }

  private fromDraft(d: Draft, raw: string, variants: { register: 'informal' | 'formal'; text: string }[], all: Draft[]): Translation {
    const notes: string[] = [];
    if (d.names.length) notes.push(`Kept as written (names): ${d.names.join(', ')}.`);
    if (d.unknown.length) notes.push(`Incomplete: ${d.unknown.map((w) => `“${w}”`).join(', ')} ${d.unknown.length > 1 ? 'are' : 'is'} not in the source and ${d.unknown.length > 1 ? 'were' : 'was'} left out.`);
    const evidence = all.flatMap((x) => x.evidence);
    return this.result(d.unknown.length ? 'partial' : 'grammar', d.text, {
      variants, steps: d.steps, evidence, confidence: Math.min(0.9, d.confidence * 0.9),
      unknown: d.unknown, rows: d.steps.flatMap((s) => s.rows ?? []), notes, raw,
    });
  }

  private vocab: Map<string, string[]> | null = null;
  /** English words of the source (all glosses and example sentences), bucketed by first letter. */
  private englishVocab(): Map<string, string[]> {
    if (this.vocab) return this.vocab;
    const words = new Set<string>();
    for (const k of this.entryKeys) for (const w of k.key.split(/[^a-z']+/)) if (w.length >= 3) words.add(w);
    for (const c of this.corpus) for (const w of c.toks) if (w.length >= 3) words.add(w);
    const m = new Map<string, string[]>();
    for (const w of words) { const l = m.get(w[0]!) ?? []; l.push(w); m.set(w[0]!, l); }
    return (this.vocab = m);
  }

  private spellCorrect(raw: string): { text: string; changes: string[] } | null {
    const v = this.englishVocab();
    const known = (w: string) => (v.get(w[0] ?? '') ?? []).includes(w);
    const changes: string[] = [];
    const text = raw.replace(/[A-Za-z']+/g, (word) => {
      const w = word.toLowerCase();
      if (w.length < 4 || known(w) || known(w.replace(/s$/, '')) || known(w.replace(/(ed|ing|es)$/, ''))) return word;
      // Only two typo shapes that rarely turn one real word into another: swapped neighbours
      // (grandfahter, liev) and a doubled letter (amm, bookk). Deletions/substitutions
      // (eighty→eight, mouth→month, Russian→Russia) are real different words, so never "corrected".
      let best: { w: string; s: number } | null = null;
      for (const c of v.get(w[0]!) ?? []) {
        if (isTransposition(w, c) || isDoubled(w, c)) { best = { w: c, s: similarity(w, c) }; break; }
      }
      if (!best) return word;
      changes.push(`${word} → ${best.w}`);
      return /^[A-Z]/.test(word) ? best.w.charAt(0).toUpperCase() + best.w.slice(1) : best.w;
    });
    return changes.length ? { text, changes } : null;
  }

  // ── fuzzy (typos) ───────────────────────────────────────────────────────
  private fuzzy(raw: string): Translation | null {
    const key = glossKey(raw);
    if (key.split(' ').length > 4) return null;
    const tg = trigrams(key);
    let best: { key: string; score: number } | null = null;
    for (const e of this.entryKeys) {
      if (Math.abs(e.key.length - key.length) > 3) continue;
      const score = 0.55 * similarity(key, e.key) + 0.45 * jaccard(tg, e.tg);
      if (!best || score > best.score) best = { key: e.key, score };
    }
    if (!best || best.score < 0.78 || similarity(key, best.key) < 0.75) return null;
    // Typos only: same number of words, and every changed word is a near-spelling of its
    // counterpart ("grandfahter"), never a different word ("our" vs "your", "fathers" vs "mothers").
    const a = key.split(' '), b = best.key.split(' ');
    if (a.length !== b.length) return null;
    for (let i = 0; i < a.length; i++) {
      const x = a[i]!, y = b[i]!;
      if (x === y) continue;
      if (x.length < 4 || similarity(x, y) < 0.8 || x[0] !== y[0]) return null;
    }
    const hit = this.exact(best.key);
    if (!hit) return null;
    return { ...hit, status: 'fuzzy', confidence: Math.round(best.score * 0.8 * 100) / 100, matchedEnglish: best.key,
      notes: [`Not in the source as typed; closest entry is “${best.key}”.`, ...hit.notes] };
  }

  // ── word by word ────────────────────────────────────────────────────────
  private compositional(raw: string): Translation | null {
    const input = analyze(raw);
    const toks = input.tokens;
    if (toks.length < 2) return null;
    const out: string[] = [], unknown: string[] = [], steps: Step[] = [], rows: number[] = [];
    let covered = 0, content = 0;
    for (let i = 0; i < toks.length; ) {
      let taken = 0;
      for (let n = Math.min(5, toks.length - i); n >= 1; n--) {
        const span = toks.slice(i, i + n).join(' ');
        if (n === 1 && (ARTICLES.has(span) || BE_FORMS.has(span) || ['do', 'does', 'did', 'to', 'please'].includes(span))) { taken = 1; break; }
        const r = this.lex.roots(span)[0];
        const ex = this.lex.examples(span)[0] ?? (ENGLISH_SYNONYMS[span] ?? []).map((x) => this.lex.examples(x)[0]).find(Boolean);
        const w = r ? inline(r.lemma.text) : ex ? ex.bux : null;
        if (w && !w.startsWith('-')) {
          out.push(w); steps.push({ text: `“${span}” → ${w}`, rows: [r?.sources[0]?.row ?? ex?.source.row ?? 0] });
          rows.push(r?.sources[0]?.row ?? ex?.source.row ?? 0);
          covered += n; content += n; taken = n; break;
        }
      }
      if (!taken) { unknown.push(toks[i]!); content++; taken = 1; }
      i += taken;
    }
    // Word-by-word is only offered when it covers at least two thirds of the words.
    if (!out.length || covered / Math.max(content, 1) < 0.67) return null;
    return this.result('compositional', out.join(' '), {
      steps, unknown, rows, evidence: ['attested'], confidence: Math.round((0.4 * covered / Math.max(content, 1)) * 100) / 100, raw,
      notes: ['Word-by-word gloss in English order. Buxori grammar (word order, endings) is NOT applied.'],
    });
  }

  private none(raw: string, reason = 'No reliable translation: this is not in the source and could not be built from its words and rules.'): Translation {
    return { status: 'none', text: null, variants: [], alternatives: [], confidence: 0, evidence: null, steps: [], unknown: [], rows: [], review: false, notes: [reason], related: raw ? this.related(raw) : [] };
  }

  /** Most similar TSV examples (for "did you mean" and for learning). */
  related(text: string, k = 5): Retrieved[] {
    const tg = trigrams(text);
    const toks = new Set(glossKey(text).split(/\W+/).filter(Boolean));
    return this.corpus
      .map((c) => {
        let shared = 0; for (const t of toks) if (c.toks.has(t)) shared++;
        return { en: c.en, bux: c.bux, row: c.row, score: Math.round((0.5 * jaccard(tg, c.tg) + 0.5 * (shared / (toks.size + c.toks.size - shared || 1))) * 100) / 100 };
      })
      .filter((r) => r.score > 0.12)
      .sort((a, b) => b.score - a.score || a.row - b.row)
      .slice(0, k);
  }

  private result(status: Status, text: string, o: {
    rows?: number[]; evidence?: Evidence[]; confidence: number; review?: boolean; alternatives?: Alternative[]; steps?: Step[];
    notes?: string[]; matchedEnglish?: string; unknown?: string[]; variants?: { register: 'informal' | 'formal'; text: string }[]; raw: string;
  }): Translation {
    return {
      status, text, variants: o.variants ?? [], alternatives: o.alternatives ?? [], confidence: Math.round(o.confidence * 100) / 100,
      evidence: weakest(o.evidence ?? []), steps: o.steps ?? [], unknown: o.unknown ?? [], rows: uniqRows(o.rows ?? []),
      review: !!o.review, notes: o.notes ?? [], ...(o.matchedEnglish ? { matchedEnglish: o.matchedEnglish } : {}),
      related: status === 'exact' ? [] : this.related(o.raw, 3),
    };
  }
}
