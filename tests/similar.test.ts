/*
 * "Similar words in the book" (src/ai/similar.ts): the precomputed gloss vectors must
 * match the index, suggestions must come only from the source, and the engine must
 * report exactly the English words the source lacks. The model itself is not run
 * here (it is a 23 MB download); its loader is exercised with a stand-in module.
 */
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { MIN_SCORE, WORD_MODEL, decodeVectors, loadEmbedder, nearestGlosses, suggest, type VectorFile } from '../src/ai/similar.ts';
import { Engine } from '../src/engine/engine.ts';
import { inflectLike } from '../src/engine/english.ts';
import type { BuxoriIndex } from '../src/lib/types.ts';

const index = JSON.parse(readFileSync(new URL('../src/data/buxori-index.json', import.meta.url), 'utf8')) as BuxoriIndex;
const file = JSON.parse(readFileSync(new URL('../src/data/gloss-vectors.json', import.meta.url), 'utf8')) as VectorFile;
const gv = decodeVectors(file);
const engine = new Engine(index);
const resolve = (g: string) => engine.lex.roots(g)[0];
const vecOf = (key: string) => {
  const i = gv.keys.indexOf(key);
  if (i < 0) throw new Error(`no vector for ${key}`);
  return Float32Array.from(gv.vectors.subarray(i * gv.dim, (i + 1) * gv.dim), (x) => x * gv.scales[i]!);
};

describe('gloss vectors (src/data/gloss-vectors.json)', () => {
  it('cover exactly the index glosses: run `node scripts/embed-glosses.ts` after recompiling the index', () => {
    expect(file.keys).toEqual(Object.keys(index.roots.byGloss).sort());
  });
  it('were made with the model the browser loads', () => {
    expect({ model: file.model, revision: file.revision, dtype: file.dtype, pooling: file.pooling, transformers: file.transformers })
      .toEqual({ model: WORD_MODEL.id, revision: WORD_MODEL.revision, dtype: WORD_MODEL.dtype, pooling: WORD_MODEL.pooling, transformers: WORD_MODEL.transformers });
    expect(gv.dim).toBe(384);
  });
  it('are unit length after de-quantisation', () => {
    for (let i = 0; i < gv.keys.length; i += 97) {
      const v = vecOf(gv.keys[i]!);
      expect(Math.hypot(...v)).toBeCloseTo(1, 1);
    }
  });
  it('place a word nearest to itself, then to words of related meaning', () => {
    expect(nearestGlosses(gv, vecOf('happy'), 1)[0]?.key).toBe('happy');
    expect(nearestGlosses(gv, vecOf('big'), 6).map((x) => x.key)).toContain('large');
  });
});

describe('suggest', () => {
  it('returns source entries only, one per Buxori word, best first', () => {
    const s = suggest(gv, vecOf('ask'), resolve, { k: 6, exclude: 'ask' });
    expect(s.length).toBeGreaterThan(0);
    const ids = s.map((x) => x.root.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const x of s) expect(index.roots.entries[x.root.id]).toBeDefined();
    expect(s.map((x) => x.score)).toEqual([...s.map((x) => x.score)].sort((a, b) => b - a));
    expect(s.map((x) => x.gloss)).not.toContain('to ask');   // "to ask" is the same entry as "ask"
  });
  it('suggests nothing below the similarity floor', () => {
    expect(suggest(gv, new Float32Array(gv.dim), resolve)).toEqual([]);
    for (const x of suggest(gv, vecOf('teacher'), resolve, { k: 10 })) expect(x.score).toBeGreaterThanOrEqual(MIN_SCORE);
  });
});

describe('loadEmbedder (stand-in for transformers.js)', () => {
  it('configures the library, reports download progress and returns one vector per text', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'tf-'));
    const mod = join(dir, 'fake-transformers.mjs');
    writeFileSync(mod, `
      export const env = { allowLocalModels: true, useBrowserCache: false, remotePathTemplate: '{model}/resolve/{revision}/' };
      export const calls = [];
      export async function pipeline(task, model, o) {
        calls.push({ task, model, dtype: o.dtype, device: o.device });
        o.progress_callback({ status: 'progress', file: 'a', loaded: 5, total: 10 });
        o.progress_callback({ status: 'progress', file: 'b', loaded: 10, total: 10 });
        return async (texts, opts) => ({ dims: [texts.length, 2], data: Float32Array.from(texts.flatMap((t) => opts.normalize ? [1, t.length] : [0, 0])) });
      }`);
    const progress: number[] = [];
    const embed = await loadEmbedder((p) => progress.push(p), pathToFileURL(mod).href);
    const loaded = (await import(pathToFileURL(mod).href)) as { env: Record<string, unknown>; calls: unknown[] };
    // the model commit is pinned in every download URL, not left to "main"
    expect(loaded.env).toEqual({ allowLocalModels: false, useBrowserCache: true, remotePathTemplate: `{model}/resolve/${WORD_MODEL.revision}/` });
    expect(loaded.calls).toEqual([{ task: 'feature-extraction', model: WORD_MODEL.id, dtype: 'q8', device: 'wasm' }]);
    expect(progress).toEqual([50, 75]);
    const out = await embed(['ab', 'abcd']);
    expect(out.map((v) => [...v])).toEqual([[1, 2], [1, 4]]);
  });
});

describe('Engine.unknownWords', () => {
  it('lists the content words the source has nothing for', () => {
    expect(engine.unknownWords('The physician is here')).toEqual(['physician']);
    expect(engine.unknownWords('I want to purchase a car')).toContain('purchase');
    expect(engine.unknownWords('we purchased it yesterday')).toEqual(['purchased']);
  });
  it('never lists function words, numbers, inflected source words or translated phrases', () => {
    expect(engine.unknownWords('I went home')).toEqual([]);            // went → go
    expect(engine.unknownWords('Thank you very much')).toEqual([]);   // a phrase in the source
    expect(engine.unknownWords('I have three books')).toEqual([]);
    const u = engine.unknownWords('my pal is in the house with the dogs');
    expect(u).toEqual(['pal']);
  });
});

describe('inflectLike', () => {
  it('puts the picked word in the form of the word it replaces', () => {
    expect(inflectLike('purchased', 'buy', 'verb')).toBe('bought');
    expect(inflectLike('purchasing', 'buy', 'verb')).toBe('buying');
    expect(inflectLike('needed', 'want', 'verb')).toBe('wanted');
    expect(inflectLike('kitties', 'cat', 'noun')).toBe('cats');
    expect(inflectLike('infants', 'child', 'noun')).toBe('children');
    expect(inflectLike('Physician', 'doctor', 'noun')).toBe('Doctor');
  });
  it('leaves adjectives, multi-word glosses and base forms alone', () => {
    expect(inflectLike('scared', 'fearful', 'adjective')).toBe('fearful');
    expect(inflectLike('exhausted', 'get tired', 'verb')).toBe('get tired');
    expect(inflectLike('huge', 'big', 'adjective')).toBe('big');
    expect(inflectLike('bus', 'car', 'noun')).toBe('car');
  });
});
