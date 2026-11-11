/*
 * Build scripts/data/english-adjectives.txt: English words that are (almost) always
 * adjectives. The lesson book labels few of its words as adjectives, so the compiler uses
 * this list to tell "good" from "doctor" by the ENGLISH gloss. It is knowledge about
 * English only; no Buxori is involved.
 *
 *   node scripts/english-adjectives.ts <WordNet dict dir>     (npm: wordnet-db)
 *
 * A word is listed when at least 80% of its sense-tagged uses in WordNet are adjectival,
 * or, if it has no tagged uses, when all its senses are adjectives.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dict = process.argv[2];
if (!dict) throw new Error('usage: node scripts/english-adjectives.ts <WordNet dict dir>');
const use = new Map<string, { adj: number; other: number; adjSenses: number; otherSenses: number }>();
for (const line of readFileSync(resolve(dict, 'index.sense'), 'utf8').split('\n')) {
  const m = /^([a-z]+(?:-[a-z]+)*)%(\d):\S+ \d+ \d+ (\d+)$/.exec(line);
  if (!m) continue;
  const adj = m[2] === '3' || m[2] === '5';
  const u = use.get(m[1]!) ?? use.set(m[1]!, { adj: 0, other: 0, adjSenses: 0, otherSenses: 0 }).get(m[1]!)!;
  if (adj) { u.adj += Number(m[3]); u.adjSenses++; } else { u.other += Number(m[3]); u.otherSenses++; }
}
const words = [...use].filter(([, u]) => (u.adj + u.other > 0 ? u.adj / (u.adj + u.other) >= 0.8 : u.adjSenses > 0 && u.otherSenses === 0)).map(([w]) => w).sort();
writeFileSync(resolve(import.meta.dirname, 'data/english-adjectives.txt'), words.join('\n') + '\n');
console.log(`${words.length} adjectives → scripts/data/english-adjectives.txt`);
