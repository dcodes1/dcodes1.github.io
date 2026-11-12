/*
 * English → Buxori word choice over the compiled index. Ranking is explicit and
 * deterministic; every returned form carries the TSV rows it came from.
 */
import { canonicalKey, glossKey, senses } from '../lib/normalizer.ts';
import { expandContractions } from './english.ts';
import type {
  BuxoriIndex, Example, GlossKey, InflectedEntry, PartOfSpeech, PersonNumber, RootEntry, RootId, SourceRef,
} from '../lib/types.ts';

const isReview = (sources: readonly SourceRef[]) => sources.length > 0 && sources.every((s) => s.review);

/** Display form of an entry: TSV text with sentence-style capitals and "?" removed for use inside a sentence. */
/** Inline form for a proper noun: punctuation stripped, capitals kept. */
export function inlineName(text: string): string {
  return text.replace(/[?!.]+$/, '').trim();
}

export function inline(text: string): string {
  const t = text.replace(/[?!.]+$/, '').trim();
  // (a one-letter word too: the pronoun "Ü" is "ü" inside a sentence)
  return /^[A-ZÜ']([a-zü']|$)/.test(t) && !/^[A-Z][a-z]+[A-Z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t;
}

export class Lexicon {
  readonly index: BuxoriIndex;
  private readonly examplesByEn = new Map<GlossKey, Example[]>();

  /** How often each word appears in the source's example sentences (canonical key → count). */
  private readonly corpusFreq = new Map<string, number>();
  freq(lemma: string): number {
    const k = canonicalKey(lemma.replace(/[?!.]+$/, ''));
    if (k.includes(' ')) return 0;
    return this.corpusFreq.get(k) ?? 0;
  }

  constructor(index: BuxoriIndex) {
    this.index = index;
    for (const e of Object.values(index.examples)) {
      if (e.language !== 'buxori') continue;
      for (const w of canonicalKey(e.bux).split(/[^a-zü']+/)) if (w) this.corpusFreq.set(w, (this.corpusFreq.get(w) ?? 0) + 1);
    }
    for (const e of Object.values(index.examples)) {
      if (!e.en || e.language !== 'buxori') continue;
      // "He/she is sad" is indexed as "he is sad" and "she is sad" too (same as dictionary senses).
      for (const part of e.en.split(/\s*;\s*/)) {
        // …and "I'm glad" also answers "I am glad"
        const keys = new Set([glossKey(part), glossKey(expandContractions(part)), ...senses(part).map((x) => x.key)]);
        for (const k of keys) {
          if (!k) continue;
          const list = this.examplesByEn.get(k) ?? [];
          if (!list.includes(e)) list.push(e);
          this.examplesByEn.set(k, list);
        }
      }
    }
  }

  root(id: RootId): RootEntry | undefined {
    return this.index.roots.entries[id];
  }

  /**
   * Roots glossed with this English key, best first:
   * requested POS → not REVIEW-only → fewer senses (more specific) → shorter → earlier row.
   */
  roots(english: string, pos?: PartOfSpeech | PartOfSpeech[], opts: { examples?: boolean } = {}): RootEntry[] {
    const k = glossKey(english);
    const ids = this.index.roots.byGloss[k] ?? [];
    const want = pos ? (Array.isArray(pos) ? pos : [pos]) : null;
    const list = ids.map((id) => this.root(id)).filter((e): e is RootEntry => !!e);
    if (!list.length && opts.examples) list.push(...this.exampleWords(k));
    const score = (e: RootEntry) => [
      want && !want.includes(e.pos) ? 1 : 0,
      isReview(e.sources) ? 1 : 0,
      // a restricted sense ("red (about hair)", "hello (on the phone)") ranks below a plain one
      e.glosses.some((g) => g.key === k && g.qualifiers?.length) ? 1 : 0,
      e.glosses.length,
      e.lemma.text.split(' ').length,
      e.sources[0]?.row ?? 0,
    ];
    return list.sort((a, b) => {
      const sa = score(a), sb = score(b);
      for (let i = 0; i < sa.length; i++) if ((sa[i] ?? 0) !== (sb[i] ?? 0)) return (sa[i] ?? 0) - (sb[i] ?? 0);
      return 0;
    });
  }

  /**
   * Words the dictionary lacks but an example row gives on its own ("sorrowful; sad" →
   * ghamgin, p161): one English word or two, one Buxori word. Treated as attested entries.
   */
  private exampleWords(k: GlossKey): RootEntry[] {
    if (!k || k.split(' ').length > 2) return [];
    return [...this.examples(k)]
      .filter((e) => /^[A-Za-zÜü']+[!?.]?$/.test(e.bux.trim()))
      .sort((a, b) => a.source.row - b.source.row)   // the book introduces the basic word first
      .slice(0, 1)
      .map((e): RootEntry => {
        const text = e.bux.trim().replace(/[!?.]$/, '');
        return {
          id: `x${e.source.row}` as RootEntry['id'], pos: 'noun',
          lemma: { text, key: canonicalKey(text), kind: 'citation', evidence: 'attested', source: e.source },
          glosses: [{ text: e.en ?? '', key: k }], forms: [], sources: [e.source],
        };
      });
  }

  best(english: string, pos?: PartOfSpeech | PartOfSpeech[], opts: { examples?: boolean } = {}): RootEntry | undefined {
    const want = pos ? (Array.isArray(pos) ? pos : [pos]) : null;
    return this.roots(english, pos, opts).find((e) => !want || want.includes(e.pos));
  }

  /** Inflected headwords for an English phrase ("my mom"), Regular register first, non-REVIEW first. */
  inflected(english: string): InflectedEntry[] {
    const k = glossKey(english);
    const keys = this.index.roots.inflectedByGloss[k] ?? [];
    const all = keys.flatMap((bk) => this.index.roots.inflected[bk] ?? [])
      .filter((e) => e.glosses.some((g) => g.key === k));
    // Regular (conversational) first, then forms the source gives as spoken, then Literal; REVIEW rows last.
    const rank = (e: InflectedEntry) => (e.source.review ? 10 : 0)
      + (/spoken/i.test(e.source.section) || e.spoken ? 1 : /literal/i.test(e.source.section) || e.affixes.some((a) => /literal/.test(a)) ? 2 : 0);
    return all.sort((a, b) => rank(a) - rank(b) || a.source.row - b.source.row);
  }

  examples(english: string): Example[] {
    return this.examplesByEn.get(glossKey(english)) ?? [];
  }

  /** Subject pronoun for a person, from the index's pronoun entries. */
  pronoun(pn: PersonNumber): RootEntry | undefined {
    switch (pn) {
      case '1sg': return this.best('i', 'pronoun');
      case '2sg': return this.roots('you', 'pronoun').find((e) => e.glosses.some((g) => g.key === 'you' && !g.address));
      case '2pol': case '2pl': return this.roots('you', 'pronoun').find((e) => e.glosses.some((g) => g.key === 'you' && g.address));
      case '3sg': case '3resp': return this.best('he', 'pronoun');
      case '1pl': return this.best('we', 'pronoun');
      case '3pl': return this.best('they', 'pronoun');
    }
  }

  allGlossKeys(): string[] {
    return Object.keys(this.index.roots.byGloss);
  }
}
