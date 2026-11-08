/*
 * Precompute the embeddings of every English gloss in the index, for the in-browser
 * "similar words" suggestions (src/ai/similar.ts). Run after the index changes:
 *
 *   npm i --no-save @huggingface/transformers@4.3.1   (the version in WORD_MODEL)
 *   node scripts/embed-glosses.ts
 *
 * transformers.js is not a project dependency: it is large (its Node runtime is
 * ~700 MB installed), and the browser loads it from a CDN only when asked.
 * tests/similar.test.ts fails if the vectors no longer match the index.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { WORD_MODEL, type VectorFile } from '../src/ai/similar.ts';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = resolve(ROOT, 'src/data/gloss-vectors.json');

const spec = '@huggingface/transformers';
const tf = await import(spec) as {
  pipeline: (t: string, m: string, o: object) => Promise<(x: string[], o: object) => Promise<{ data: Float32Array; dims: number[] }>>;
};
const installed = (JSON.parse(readFileSync(resolve(ROOT, 'node_modules', spec, 'package.json'), 'utf8')) as { version: string }).version;
if (installed !== WORD_MODEL.transformers) throw new Error(`${spec} ${installed} installed, WORD_MODEL expects ${WORD_MODEL.transformers}`);

const index = JSON.parse(readFileSync(resolve(ROOT, 'src/data/buxori-index.json'), 'utf8')) as { roots: { byGloss: Record<string, unknown> } };
const keys = Object.keys(index.roots.byGloss).sort();
const extractor = await tf.pipeline('feature-extraction', WORD_MODEL.id, { dtype: WORD_MODEL.dtype, revision: WORD_MODEL.revision });

let dim = 0;
const chunks: Float32Array[] = [];
for (let i = 0; i < keys.length; i += 64) {
  const r = await extractor(keys.slice(i, i + 64), { pooling: WORD_MODEL.pooling, normalize: true });
  dim = r.dims[1]!;
  chunks.push(r.data);
}
const vectors = new Int8Array(keys.length * dim);
const scales = new Float32Array(keys.length);
let row = 0;
for (const c of chunks) {
  for (let k = 0; k < c.length / dim; k++, row++) {
    let max = 0;
    for (let j = 0; j < dim; j++) max = Math.max(max, Math.abs(c[k * dim + j]!));
    const scale = max / 127 || 1;
    scales[row] = scale;
    for (let j = 0; j < dim; j++) vectors[row * dim + j] = Math.round(c[k * dim + j]! / scale);
  }
}
const file: VectorFile = {
  model: WORD_MODEL.id, revision: WORD_MODEL.revision, dtype: WORD_MODEL.dtype, pooling: WORD_MODEL.pooling, transformers: WORD_MODEL.transformers,
  dim, keys,
  scales: Buffer.from(scales.buffer).toString('base64'),
  vectors: Buffer.from(vectors.buffer).toString('base64'),
};
writeFileSync(OUT, JSON.stringify(file) + '\n');
console.log(`${keys.length} glosses × ${dim} → ${OUT}`);
