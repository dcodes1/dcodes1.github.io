/*
 * "Similar spellings in the book": when an English word is not in the lesson book, offer
 * the book's words spelled most like it ("docter" → doctor). Plain edit distance over the
 * book's own English glosses: nothing is downloaded and nothing leaves the page.
 *
 * It replaces an earlier opt-in language model that was fetched from jsDelivr and
 * Hugging Face. That model could point from "physician" to "doctor"; this cannot, because
 * it compares letters, not meanings. It only ever proposes words the book has, and never
 * translates on its own: the user picks one and that sentence is translated normally.
 */

export function levenshteinDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[] = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    let prev = dp[0]!;
    dp[0] = i;
    for (let j = 1; j <= n; j++) {
      const temp = dp[j]!;
      dp[j] = a[i - 1] === b[j - 1] ? prev : 1 + Math.min(prev, dp[j]!, dp[j - 1]!);
      prev = temp;
    }
  }
  return dp[n]!;
}

/** How many letters may differ. Short words get one (at two, "cat" is "car", "eat" and "hot"); three only from ten letters (at nine, "physician" is "musician"). */
export const maxDistance = (length: number) => (length <= 4 ? 1 : length <= 9 ? 2 : 3);

/**
 * The lexicon keys closest in spelling to `query`, nearest first (ties: same first letter,
 * then alphabetical, so the result is deterministic). Verb glosses are listed as "to buy";
 * the "to " is ignored when comparing. Multi-word keys are skipped.
 */
export function findSimilarWordsOffline(query: string, lexiconKeys: readonly string[], maxResults = 5): string[] {
  const q = query.trim().toLowerCase();
  if (q.length < 3) return [];
  const limit = maxDistance(q.length);
  const best = new Map<string, number>();
  for (const key of lexiconKeys) {
    const word = key.toLowerCase().replace(/^to /, '');
    if (!word || word.includes(' ') || Math.abs(word.length - q.length) > limit) continue;
    const dist = levenshteinDistance(q, word);
    if (dist > 0 && dist <= limit && dist < (best.get(word) ?? Infinity)) best.set(word, dist);
  }
  return [...best.entries()]
    .sort(([a, da], [b, db]) => da - db || Number(b[0] === q[0]) - Number(a[0] === q[0]) || a.localeCompare(b))
    .slice(0, maxResults)
    .map(([word]) => word);
}
