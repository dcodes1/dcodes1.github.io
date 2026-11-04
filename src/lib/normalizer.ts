/*
 * Buxori script normalizer.
 *
 * Lookup keys only: display text is never altered. Every spelling a user might
 * type is reduced to the TSV's own Latin orthography (the "canonical key"), and
 * three progressively looser keys give fallback tiers when that misses:
 *
 *   canonicalKey  Cyrillic / Hebrew / variant Latin → TSV Latin (exact tier)
 *   fuzzyKey      + diacritics stripped: ü→u, ayin ' and hyphens dropped
 *   looseKey      + o/u and e/i merged, doubled letters collapsed
 *   skeletonKey   consonants only, confusable letters merged; the only tier
 *                 that can match unvowelled Hebrew-script input
 *
 * TSV orthography (verified against translator/data/bukhori.tsv):
 *   x = х (never "kh": 0 occurrences)   h = ҳ    q = қ    gh = ғ    j = ҷ
 *   sh = ш   ch = ч   zh = ж   ü = ӯ   y = й   ya/yu/yo = я/ю/ё
 *   ' = ayin (ъ); also separates s'h, z'h, k'h, g'h so they are not digraphs ("pis'ho")
 *   word-initial e is plain e ("eton", "ed"); "ye" is written out ("yerusholayim")
 *   acute/grave accents (and ć, ġ in the front matter) mark stress only
 *
 * Deliberate non-mappings, because the TSV uses them literally:
 *   "dzh" stays (kolledzhba)   "ts" stays (bolnitsa = ц, hashtsad = t+s)
 */
import type { Address, BuxKey, GlossKey } from './types.ts';

export type Script = 'latin' | 'cyrillic' | 'hebrew' | 'mixed' | 'none';

const CYRILLIC_RE = /[Ѐ-ӿ]/;
const HEBREW_RE = /[֐-׿יִ-ﭏ]/;
const LATIN_RE = /[A-Za-zÀ-ɏ]/;
const EDGE = /^[\s.,!?;:"()[\]{}…«»„“”]+|[\s.,!?;:"()[\]{}…«»„“”]+$/g;

export function detectScript(s: string): Script {
  const found = [CYRILLIC_RE.test(s) && 'cyrillic', HEBREW_RE.test(s) && 'hebrew', LATIN_RE.test(s) && 'latin'].filter(Boolean) as Script[];
  if (found.length === 0) return 'none';
  return found.length === 1 ? (found[0] as Script) : 'mixed';
}

// ── Cyrillic → canonical Latin ──────────────────────────────────────────────
const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', ғ: 'gh', д: 'd', ё: 'yo', ж: 'zh', з: 'z', и: 'i', ӣ: 'i',
  й: 'y', к: 'k', қ: 'q', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't',
  у: 'u', ӯ: 'ü', ф: 'f', х: 'x', ҳ: 'h', ч: 'ch', ҷ: 'j', ш: 'sh', щ: 'shch', ц: 'ts',
  ъ: "'", ь: '', ы: 'i', э: 'e', ю: 'yu', я: 'ya',
  // Uzbek/Kazakh Cyrillic letters that turn up in Bukharian spellings
  ў: 'ü', ҕ: 'gh', ҝ: 'k', ӑ: 'a',
};
const CYR_VOWELS = new Set('аеёиӣоуӯэюяыў');

function cyrillicRun(run: string): string {
  let out = '';
  const chars = [...run];
  chars.forEach((c, i) => {
    const prev = i > 0 ? (chars[i - 1] as string) : '';
    if (c === 'е') {
      // е reads "ye" at the start of a word and after a vowel or a hard/soft sign.
      out += prev === '' || CYR_VOWELS.has(prev) || prev === 'ъ' || prev === 'ь' ? 'ye' : 'e';
      return;
    }
    const lat = CYR[c] ?? c;
    // сҳ / зҳ / кҳ / гҳ would read as the digraphs sh / zh / kh / gh: separate them.
    if (lat === 'h' && /[szkg]$/.test(out)) out += "'";
    out += lat;
  });
  return out;
}

// ── Hebrew script → rough Latin (lossy) ─────────────────────────────────────
// Judeo-Tajik in Hebrew letters writes few vowels and leaves several sounds
// ambiguous (ח = x or h, ש = sh or s, ו = v, u or o). The result is only good
// for skeletonKey matching, never for display.
const HEB: Record<string, string> = {
  א: 'a', ב: 'b', ג: 'g', ד: 'd', ה: 'h', ו: 'u', ז: 'z', ח: 'h', ט: 't', י: 'i',
  כ: 'k', ך: 'x', ל: 'l', מ: 'm', ם: 'm', נ: 'n', ן: 'n', ס: 's', ע: "'", פ: 'p', ף: 'f',
  צ: 'ts', ץ: 'ts', ק: 'q', ר: 'r', ש: 'sh', ת: 't',
};
const HEB_WITH_GERESH: Record<string, string> = { ג: 'j', ז: 'zh', צ: 'ch', ץ: 'ch', ח: 'x', כ: 'x', ך: 'x' };
const HEB_WITH_RAFE: Record<string, string> = { ב: 'v', כ: 'x', פ: 'f' };
const HEB_POINTS: Record<string, string> = {
  'ַ': 'a', 'ָ': 'a', 'ֶ': 'e', 'ֵ': 'e', 'ִ': 'i', 'ֹ': 'o', 'ֻ': 'u',
};

export function hebrewToLatin(s: string): string {
  // NFD expands presentation forms (e.g. U+FB2A shin-with-dot) into letter + points.
  const chars = [...s.normalize('NFD')];
  const isLetter = (c: string | undefined) => c !== undefined && HEB[c] !== undefined;
  const isMark = (c: string | undefined) => c !== undefined && /[֑-ׇ׳']/.test(c);
  let out = '';
  let inWord = false;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i] as string;
    if (!isLetter(c)) {
      if (!isMark(c)) { out += c; inWord = false; }
      continue;
    }
    let j = i + 1;
    const marks: string[] = [];
    while (isMark(chars[j])) marks.push(chars[j++] as string);
    const atStart = !inWord;
    const atEnd = !isLetter(chars[j]);
    const doubled = chars[j] === c && (c === 'ו' || c === 'י');
    let lat = HEB[c] as string;
    if (marks.some((m) => m === '׳' || m === "'") && HEB_WITH_GERESH[c]) lat = HEB_WITH_GERESH[c] as string;
    else if (marks.includes('ֿ') && HEB_WITH_RAFE[c]) lat = HEB_WITH_RAFE[c] as string;
    else if (c === 'ש' && marks.includes('ׂ')) lat = 's';
    else if (c === 'ו') lat = atStart || doubled ? 'v' : marks.includes('ֹ') ? 'o' : 'u';
    else if (c === 'י') lat = atStart || doubled ? 'y' : 'i';
    else if (c === 'ה' && atEnd && !atStart) lat = 'a'; // word-final he is a vowel letter
    out += lat;
    const vowel = c === 'ו' && lat !== 'v' ? undefined : marks.map((m) => HEB_POINTS[m]).find(Boolean);
    if (vowel) out += vowel;
    inWord = true;
    i = doubled ? j : j - 1;
  }
  return out;
}

// ── Variant Latin → canonical Latin ─────────────────────────────────────────
// Applied to Latin text only (never to the output of the Cyrillic step, which is
// already canonical), so mappings like kh → x cannot double-fire.
const LATIN_CHARS: Record<string, string> = {
  // ӯ in common romanizations
  ū: 'ü', ŭ: 'ü', ů: 'ü', û: 'ü', ǖ: 'ü', ǘ: 'ü', ǚ: 'ü', ǜ: 'ü',
  // Persian-style long vowels (ā is Tajik о)
  ā: 'o', ō: 'o', ī: 'i', ē: 'e',
  // háček / DMG / ALA-LC transliteration
  č: 'ch', š: 'sh', ž: 'zh', ǧ: 'j', ǰ: 'j', ğ: 'gh', ġ: 'gh', ḡ: 'gh',
  ḥ: 'h', ḫ: 'x', ẖ: 'x', ḳ: 'q', ẓ: 'z', ṣ: 's', ṭ: 't',
  w: 'v',
  // apostrophe look-alikes → ayin
  '‘': "'", '’': "'", 'ʼ': "'", 'ʿ': "'", 'ʾ': "'", '`': "'", '´': "'",
};

function latinRun(run: string): string {
  let t = run;
  // Uzbek-style gʻ / oʻ (U+02BB, or ‘ directly after g/o) are ғ and ӯ, not ayin.
  t = t.replace(/g[ʻ‘]/g, 'gh').replace(/o[ʻ‘]/g, 'ü');
  t = t.replace(/ʻ/g, "'");
  // Stress accents: acute / grave / circumflex-on-e etc. carry no phonemic value.
  t = t.normalize('NFD').replace(/[̀́̀́]/g, '').normalize('NFC');
  t = [...t].map((c) => LATIN_CHARS[c] ?? c).join('');
  t = t.replace(/kh/g, 'x');
  return t;
}

/**
 * Canonical lookup key in TSV orthography. Accepts Latin (any common variant),
 * Tajik/Russian Cyrillic, or Hebrew script, including mixed input.
 * Idempotent: canonicalKey(canonicalKey(s)) === canonicalKey(s).
 */
export function canonicalKey(s: string): BuxKey {
  // Invisible characters (zero-width space/joiners, BOM, soft hyphen) are dropped.
  const lower = s.normalize('NFC').replace(/[\u200B-\u200F\u2060\uFEFF\u00AD]/g, '').toLowerCase();
  // Split into script runs so each converter only sees its own script.
  const runs = lower.match(/[Ѐ-ӿ]+|[֐-׿יִ-ﭏ][֐-׿יִ-ﭏ']*|[^Ѐ-ӿ֐-׿יִ-ﭏ׳״]+/g) ?? [];
  let t = runs.map((r) => (CYRILLIC_RE.test(r) ? cyrillicRun(r) : HEBREW_RE.test(r) ? hebrewToLatin(r) : latinRun(r))).join('');
  t = t.replace(/\s+/g, ' ').replace(EDGE, '').trim();
  return t as BuxKey;
}

/** Back-compat name used throughout the compiler. */
export const buxKey = canonicalKey;

/**
 * TSV-only pre-pass: the front matter prints stress with a dot or accent over
 * consonants too (ġiriftam, baćha). In user input ġ means ғ, so this is not part
 * of canonicalKey — the compiler calls it on TSV text before keying.
 */
export function foldTsvStress(s: string): string {
  return s.normalize('NFD').replace(/[̀́̇]/g, '').normalize('NFC');
}

/** Tier 2: diacritics stripped (ü→u), ayin and hyphens dropped. */
export function fuzzyKey(s: string): string {
  return canonicalKey(s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/['-]/g, '').replace(/\s+/g, ' ').trim();
}

/** Tier 3: also merges the vowels spellers confuse most (o/u, e/i) and collapses doubled letters. */
export function looseKey(s: string): string {
  return fuzzyKey(s).replace(/o/g, 'u').replace(/e/g, 'i').replace(/([a-z])\1+/g, '$1');
}

/**
 * Tier 4: consonant skeleton. Vowels, y and ayin dropped; letters Hebrew script
 * cannot tell apart are merged (x/h, k/q, v/b, f/p, sh/s, zh/z, gh/g).
 */
export function skeletonKey(s: string): string {
  return fuzzyKey(s)
    .replace(/sh/g, 's').replace(/zh/g, 'z').replace(/gh/g, 'g').replace(/ch/g, 'C').replace(/ts/g, 'c')
    .replace(/x/g, 'h').replace(/q/g, 'k').replace(/v/g, 'b').replace(/f/g, 'p')
    .replace(/[aeiouy]/g, '').replace(/([a-zA-Z])\1+/g, '$1').replace(/\s+/g, ' ').trim();
}

// ── canonical Latin → Tajik Cyrillic ────────────────────────────────────────
const TO_CYR: Record<string, string> = {
  sh: 'ш', ch: 'ч', zh: 'ж', gh: 'ғ', ya: 'я', yu: 'ю', yo: 'ё',
  a: 'а', b: 'б', d: 'д', f: 'ф', g: 'г', h: 'ҳ', i: 'и', j: 'ҷ', k: 'к', l: 'л', m: 'м',
  n: 'н', o: 'о', p: 'п', q: 'қ', r: 'р', s: 'с', t: 'т', u: 'у', ü: 'ӯ', v: 'в', x: 'х', y: 'й', z: 'з',
};
const LAT_VOWELS = new Set('aeiouü');

/**
 * Any supported spelling → Tajik Cyrillic, word by word, keeping a capital first
 * letter. Round-trips: canonicalKey(toCyrillic(k)) === k for every canonical key.
 * "ts" becomes тс: the TSV does not distinguish ц from t+s, and both key back to "ts".
 */
export function toCyrillic(s: string): string {
  return s.replace(/[\p{L}\p{M}'‘’ʻʼ׳]+/gu, (word) => {
    const cyr = wordToCyrillic(canonicalKey(word));
    const first = [...word][0] ?? '';
    return first !== first.toLowerCase() ? cyr.charAt(0).toUpperCase() + cyr.slice(1) : cyr;
  });
}

function wordToCyrillic(k: string): string {
  let out = '';
  for (let i = 0; i < k.length; ) {
    const c = k[i] as string;
    const prev = k[i - 1] ?? '';
    const afterVowelish = i === 0 || LAT_VOWELS.has(prev) || prev === "'" || prev === '-';
    const two = k.slice(i, i + 2);
    if (c === "'") {
      // Separator in s'h / z'h / k'h / g'h; otherwise ayin → ъ.
      out += /[szkg]/.test(prev) && k[i + 1] === 'h' ? '' : 'ъ'; i += 1;
    } else if (two === 'ye') {
      out += afterVowelish ? 'е' : 'йе'; i += 2;
    } else if (c === 'e') {
      out += afterVowelish ? 'э' : 'е'; i += 1;
    } else if (TO_CYR[two]) {
      out += TO_CYR[two]; i += 2;
    } else {
      out += TO_CYR[c] ?? c; i += 1;
    }
  }
  return out;
}

// ── English glosses ─────────────────────────────────────────────────────────
export function glossKey(s: string): GlossKey {
  let t = s.normalize('NFC').toLowerCase().replace(/[‘’]/g, "'");
  t = t.replace(/\([^()]*\)/g, ' ');
  t = t.replace(/\s+/g, ' ').replace(EDGE, '').trim();
  return t as GlossKey;
}

/** Affix lookup form: hyphens and spaces removed ("-yam" → "yam", "na-" → "na"). */
export function affixForm(s: string): string {
  return canonicalKey(s).replace(/[-\s]/g, '');
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

/** Similarity in [0,1] (normalized Levenshtein), used to rank fallback candidates. */
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
  const last = canonicalKey(word).replace(/[^a-zü']/g, '').slice(-1);
  if (!last || !VOWELS.includes(last)) return 'consonant';
  if (last === 'a' || last === 'i') return 'a_or_i';
  if (last === 'o') return 'o';
  if (last === 'ü') return 'ü';
  return 'other_vowel';
}
