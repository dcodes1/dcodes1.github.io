/* Normalization for lookup keys. Display text is never altered — only keys. */
import type { Address, BuxKey, GlossKey } from './types.ts';

const STRESS: Record<string, string> = { 'á': 'a', 'à': 'a', 'é': 'e', 'è': 'e', 'í': 'i', 'ì': 'i' };
const EDGE = /^[\s.,!?;:"()[\]{}…]+|[\s.,!?;:"()[\]{}…]+$/g;

/** See BuxKey in types.ts: NFC, lowercase, stress acutes folded, ü and ' kept. */
export function buxKey(s: string): BuxKey {
  let t = s.normalize('NFC').toLowerCase();
  t = t.replace(/[áàéèíì]/g, (c) => STRESS[c] ?? c);
  t = t.replace(/[‘’ʼ]/g, "'");
  t = t.replace(/\s+/g, ' ').replace(EDGE, '').trim();
  return t as BuxKey;
}

/** Affix lookup form: hyphens and spaces removed ("-yam" → "yam", "na-" → "na"). */
export function affixForm(s: string): string {
  return buxKey(s).replace(/[-\s]/g, '');
}

export function glossKey(s: string): GlossKey {
  let t = s.normalize('NFC').toLowerCase().replace(/[‘’]/g, "'");
  t = t.replace(/\([^()]*\)/g, ' ');
  t = t.replace(/\s+/g, ' ').replace(EDGE, '').trim();
  return t as GlossKey;
}

const ADDRESS: [RegExp, Address][] = [
  [/\b(pol\.?|polite)\b/i, 'polite'],
  [/\brespectful\b/i, 'respectful'],
  [/\b(pl\.?|plural)\b/i, 'plural'],
  [/\b(sing\.?|singular|informal)\b/i, 'informal'],
];

export interface Sense { text: string; key: GlossKey; qualifiers: string[]; address?: Address }

/**
 * Split an english cell into senses:
 *   "to beat; to hit"            → ["to beat", "to hit"]
 *   "1. entrance; 2. income"     → ["entrance", "income"]
 *   "his/her grandmother"        → ["his grandmother", "her grandmother"]
 * Parentheticals become qualifiers; register markers become `address`.
 * Fractions like "2/4" are not treated as alternatives.
 */
export function senses(english: string): Sense[] {
  const out: Sense[] = [];
  const parts = english.replace(/\b\d+\.\s+/g, ';').split(';').map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const qualifiers = [...part.matchAll(/\(([^()]*)\)/g)].map((m) => (m[1] ?? '').trim()).filter(Boolean);
    let address: Address | undefined;
    for (const q of qualifiers) for (const [re, a] of ADDRESS) if (!address && re.test(q)) address = a;
    const bare = part.replace(/\([^()]*\)/g, ' ').replace(/\s+/g, ' ').trim();
    for (const variant of expandSlashes(bare)) {
      const key = glossKey(variant);
      if (!key) continue;
      out.push({ text: variant, key, qualifiers, ...(address ? { address } : {}) });
    }
  }
  return dedupeBy(out, (s) => s.key);
}

/** "his/her mom" → ["his mom", "her mom"]; at most one slash token is expanded. */
function expandSlashes(s: string): string[] {
  const words = s.split(' ');
  const i = words.findIndex((w) => /^[a-z']+(\/[a-z']+)+[.,!?]?$/i.test(w));
  if (i < 0) return [s];
  const word = words[i] ?? '';
  const punct = /[.,!?]$/.test(word) ? word.slice(-1) : '';
  return word.replace(/[.,!?]$/, '').split('/').map((alt) => [...words.slice(0, i), alt + punct, ...words.slice(i + 1)].join(' '));
}

export function dedupeBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Set<string>();
  return xs.filter((x) => { const k = key(x); if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Similarity in [0,1] (normalized Levenshtein), used to tell spelling variants from synonyms. */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const m = a.length, n = b.length;
  if (!m || !n) return 0;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min((prev[j] ?? 0) + 1, (cur[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return 1 - (prev[n] ?? 0) / Math.max(m, n);
}

const VOWELS = 'aeiouü';
export function stemFinal(word: string): 'consonant' | 'a_or_i' | 'o' | 'ü' | 'other_vowel' {
  const last = buxKey(word).replace(/[^a-zü']/g, '').slice(-1);
  if (!last || !VOWELS.includes(last)) return 'consonant';
  if (last === 'a' || last === 'i') return 'a_or_i';
  if (last === 'o') return 'o';
  if (last === 'ü') return 'ü';
  return 'other_vowel';
}
