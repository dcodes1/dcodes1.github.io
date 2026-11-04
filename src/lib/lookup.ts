/*
 * Read-side API over the compiled index. Every query goes through the same
 * normalizer the compiler used, then falls back tier by tier:
 *
 *   exact (canonical key) → fuzzy (no diacritics) → loose (o/u, e/i merged)
 *   → skeleton (consonants only; the tier that catches unvowelled Hebrew script)
 *
 * The tier is always reported, so the UI can say "did you mean …" instead of
 * presenting a skeleton guess as a translation.
 */
import {
  affixForm, canonicalKey, detectScript, fuzzyKey, glossKey, looseKey, similarity, skeletonKey, type Script,
} from './normalizer.ts';
import type {
  Affix, AffixId, BuxKey, BuxoriIndex, InflectedEntry, RootEntry, RootId, SyntaxRule, Tense,
} from './types.ts';

export type Tier = 'exact' | 'fuzzy' | 'loose' | 'skeleton';
export const TIERS: readonly Tier[] = ['exact', 'fuzzy', 'loose', 'skeleton'];

export interface BuxoriMatch {
  key: BuxKey;
  roots: RootEntry[];
  inflected: InflectedEntry[];
  /** Similarity of the query to this key after fuzzy folding, 0–1. */
  score: number;
}
export interface BuxoriResult {
  query: string;
  script: Script;
  canonical: BuxKey;
  tier: Tier | null;
  matches: BuxoriMatch[];
}
export interface EnglishResult {
  query: string;
  roots: RootEntry[];
  inflected: InflectedEntry[];
}
export interface VerbAnalysis {
  root: RootEntry;
  stem: 'present' | 'past' | 'literary_present';
  stemText: string;
  prefixes: string[];
  ending: Affix | null;
  /** Tense implied by the ending's paradigm; null for a bare stem. */
  tense: Tense | null;
}

const MAX_FALLBACK = 5;
/** Verb prefixes, longest first so "name-" is tried before "na-". */
const VERB_PREFIXES = [['na', 'me'], ['na', 'mi'], ['me'], ['mi'], ['bi'], ['na'], ['ma'], []] as const;

/**
 * Which stem and whether me- each one-word tense takes, from the TSV grammar
 * notes (simple_present_formation, simple_past_formation, descriptive_past,
 * present_perfect_regular_form). Tenses built with -sod- or an auxiliary
 * (continuous, past perfect) are not single stem+ending words, so they are absent.
 */
const TENSE_SHAPE: Partial<Record<Tense, { stem: 'present' | 'past'; me: boolean }>> = {
  present: { stem: 'present', me: true },
  future: { stem: 'present', me: true },
  simple_past: { stem: 'past', me: false },
  descriptive_past: { stem: 'past', me: true },
  present_perfect: { stem: 'past', me: false },
};

export function createLookup(index: BuxoriIndex) {
  const { roots, affixes, syntaxRules } = index;

  // Every Buxori key the index knows: root lemmas and forms, plus inflected headwords.
  const allKeys = new Set<BuxKey>([
    ...(Object.keys(roots.byKey) as BuxKey[]),
    ...(Object.keys(roots.inflected) as BuxKey[]),
  ]);
  const tierMaps: Record<Exclude<Tier, 'exact'>, Map<string, BuxKey[]>> = {
    fuzzy: new Map(), loose: new Map(), skeleton: new Map(),
  };
  const keyFns = { fuzzy: fuzzyKey, loose: looseKey, skeleton: skeletonKey } as const;
  for (const k of allKeys) {
    for (const tier of ['fuzzy', 'loose', 'skeleton'] as const) {
      const tk = keyFns[tier](k);
      if (!tk) continue;
      const list = tierMaps[tier].get(tk) ?? [];
      list.push(k);
      tierMaps[tier].set(tk, list);
    }
  }

  // Person ending → tense, from the paradigm tables the endings came from.
  const endingTense = new Map<AffixId, Tense>();
  for (const p of Object.values(affixes.paradigms)) {
    if (p.domain !== 'verb' || !p.tense) continue;
    for (const ids of Object.values(p.cells)) for (const id of ids ?? []) endingTense.set(id, p.tense);
  }

  const root = (id: RootId): RootEntry => {
    const e = roots.entries[id];
    if (!e) throw new Error(`index references missing root ${id}`);
    return e;
  };

  function matchFor(key: BuxKey, queryFuzzy: string): BuxoriMatch {
    return {
      key,
      roots: (roots.byKey[key] ?? []).map(root),
      inflected: roots.inflected[key] ?? [],
      score: similarity(queryFuzzy, fuzzyKey(key)),
    };
  }

  /** Buxori (any script or spelling) → entries, via the first tier that matches. */
  function byBuxori(query: string): BuxoriResult {
    const canonical = canonicalKey(query);
    const base = { query, script: detectScript(query), canonical };
    if (!canonical) return { ...base, tier: null, matches: [] };
    const qf = fuzzyKey(query);
    if (allKeys.has(canonical)) return { ...base, tier: 'exact', matches: [matchFor(canonical, qf)] };
    for (const tier of ['fuzzy', 'loose', 'skeleton'] as const) {
      const tk = keyFns[tier](query);
      // A one-consonant skeleton matches far too much to be useful.
      if (!tk || (tier === 'skeleton' && tk.replace(/\s/g, '').length < 2)) continue;
      const keys = tierMaps[tier].get(tk);
      if (keys?.length) {
        const matches = keys.map((k) => matchFor(k, qf)).sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
        return { ...base, tier, matches: matches.slice(0, MAX_FALLBACK) };
      }
    }
    return { ...base, tier: null, matches: [] };
  }

  /** English → Buxori entries. Verbs answer with or without "to". */
  function byEnglish(query: string): EnglishResult {
    const k = glossKey(query);
    const ids = roots.byGloss[k] ?? (k.startsWith('to ') ? roots.byGloss[glossKey(k.slice(3))] : undefined) ?? [];
    const inflected = (roots.inflectedByGloss[k] ?? []).flatMap((bk) => roots.inflected[bk] ?? []);
    return { query, roots: ids.map(root), inflected };
  }

  /** Conjugated verb → infinitive, via the stems the compiler extracted (meravam → rav → Raftan). */
  function analyzeVerb(word: string): VerbAnalysis[] {
    const tokens = canonicalKey(word).split(/\s+/).filter(Boolean);
    // Resolve compound preverbs before analyzing their auxiliary.
    if (tokens.length > 1) {
      const auxiliaryWord = tokens.at(-1) ?? '';
      const preverb = tokens.slice(0, -1).join(' ');
      const auxiliaryAnalyses = analyzeVerb(auxiliaryWord);
      const compoundAnalyses: VerbAnalysis[] = [];
      for (const e of Object.values(roots.entries)) {
        const compound = e.verb?.compound;
        if (!compound || canonicalKey(compound.preverb) !== preverb) continue;
        for (const a of auxiliaryAnalyses) if (a.root.id === compound.auxiliary) {
          compoundAnalyses.push({ ...a, root: e });
        }
      }
      if (compoundAnalyses.length) return compoundAnalyses;
      // Only the source-documented past participle + bud construction.
      if (tokens.length === 2 && preverb.endsWith('a')) {
        const past = preverb.slice(0, -1);
        const out: VerbAnalysis[] = [];
        for (const a of auxiliaryAnalyses) {
          if (canonicalKey(a.root.lemma.text) !== 'budan' || a.stem !== 'past' || !a.ending) continue;
          for (const st of roots.byStem[past] ?? []) if (st.stem === 'past') {
            out.push({ ...a, root: root(st.root), stemText: past, tense: 'past_perfect' });
          }
        }
        return out;
      }
      return [];
    }
    const k = (tokens[0] ?? '').replace(/-/g, '');
    const endings = Object.values(affixes.entries).filter((a) => a.category === 'person_ending');
    const out: VerbAnalysis[] = [];
    const seen = new Set<string>();
    // Present continuous uses infinitive minus three letters + -sod- + ending
    // (the TSV's cont.sod rule), not the ordinary present stem.
    for (const e of Object.values(roots.entries)) {
      if (!e.verb || e.verb.compound) continue;
      const inf = canonicalKey(e.verb.infinitive.text);
      if (!inf.endsWith('an')) continue;
      const stem = inf.slice(0, -3);
      for (const ending of endings) {
        if (endingTense.get(ending.id) !== 'present_continuous') continue;
        for (const al of ending.allomorphs) {
          const suffix = affixForm(al.form);
          for (const prefix of ['', 'na']) if (k === prefix + stem + 'sod' + suffix) {
            const identity = e.id + '|' + ending.id + '|' + prefix;
            if (seen.has(identity)) continue;
            seen.add(identity);
            out.push({ root: e, stem: 'present', stemText: stem,
              prefixes: prefix ? [prefix] : [], ending, tense: 'present_continuous' });
          }
        }
      }
    }
    for (const prefixes of VERB_PREFIXES) {
      const p = prefixes.join('');
      if (!k.startsWith(p)) continue;
      const rest = k.slice(p.length);
      const candidates: [string, Affix | null][] = [[rest, null]];
      for (const a of endings) for (const al of a.allomorphs) {
        const f = affixForm(al.form);
        if (f && rest.endsWith(f) && rest.length > f.length) candidates.push([rest.slice(0, -f.length), a]);
      }
      const hasMe = prefixes.some((x) => x === 'me' || x === 'mi');
      for (const [stemText, ending] of candidates) {
        const tense = ending ? endingTense.get(ending.id) ?? null : null;
        for (const s of roots.byStem[stemText] ?? []) {
          // Keep only stem/prefix/ending combinations the grammar allows.
          if (ending) {
            const shape = tense ? TENSE_SHAPE[tense] : undefined;
            const stemKind = s.stem === 'past' ? 'past' : 'present';
            if (!shape || shape.stem !== stemKind || shape.me !== hasMe) continue;
          }
          const id = `${s.root}|${s.stem}|${p}|${tense ?? ''}|${ending?.id ?? ''}`;
          if (seen.has(id)) continue;
          seen.add(id);
          out.push({ root: root(s.root), stem: s.stem, stemText, prefixes: [...prefixes], ending, tense });
        }
      }
    }
    return out;
  }

  /** Affix by surface form ("-ho", "ba", "na-"). */
  function affix(form: string): Affix[] {
    return (affixes.byForm[affixForm(form)] ?? []).map((id) => affixes.entries[id]).filter((a): a is Affix => !!a);
  }

  function rules<K extends SyntaxRule['kind']>(kind: K): Extract<SyntaxRule, { kind: K }>[] {
    return syntaxRules.filter((r): r is Extract<SyntaxRule, { kind: K }> => r.kind === kind);
  }
  function rule(id: string): SyntaxRule | undefined {
    return syntaxRules.find((r) => r.id === id);
  }

  function corpus(query: string) {
    const k = canonicalKey(query);
    if (!k) return [];
    return Object.values(index.examples).filter(e =>
      e.language === 'buxori' && (' ' + canonicalKey(e.bux) + ' ').includes(' ' + k + ' '));
  }
  return { byBuxori, byEnglish, analyzeVerb, corpus, affix, rules, rule, root };
}

export type Lookup = ReturnType<typeof createLookup>;
