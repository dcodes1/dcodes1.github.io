/*
 * "Similar words in the book": a small language model, run in the browser, that
 * points from an English word the source does not have to the source's English
 * glosses closest in meaning ("purchase" → buy, pay, sell).
 *
 * It only ever proposes words that are already in the source, and it never
 * translates on its own. The user picks a suggestion, and that word is then
 * translated normally. On the frozen held-out set, substituting the model's top
 * pick automatically was right 0 times out of 151 (Saturday → Friday,
 * grandfather → grandmother, three → two), because the book usually has no word with
 * the same meaning. That is why it suggests and the user decides.
 *
 * Model: all-MiniLM-L6-v2 (Apache-2.0), int8 ONNX, about 23 MB, run with
 * transformers.js on WebAssembly. It is downloaded only when the user asks for
 * suggestions and is cached by the browser. The source glosses are embedded ahead of
 * time by scripts/embed-glosses.ts (src/data/gloss-vectors.json).
 */
import type { RootEntry } from '../lib/types.ts';

export const WORD_MODEL = {
  id: 'Xenova/all-MiniLM-L6-v2',
  /** Hugging Face commit, so the weights can't change under the precomputed vectors. */
  revision: '751bff37182d3f1213fa05d7196b954e230abad9',
  dtype: 'q8',
  pooling: 'mean',
  /** transformers.js release (self-contained ES module build, loaded from jsDelivr). */
  transformers: '4.3.1',
} as const;
export const TRANSFORMERS_URL = `https://cdn.jsdelivr.net/npm/@huggingface/transformers@${WORD_MODEL.transformers}/dist/transformers.min.js`;
/** Approximate first-use download (model + WebAssembly runtime), for the UI. */
export const DOWNLOAD_MB = 30;

/** Below this cosine similarity nothing is suggested (MiniLM gives unrelated words ~0.2–0.45). */
export const MIN_SCORE = 0.5;

export interface VectorFile {
  model: string; revision: string; dtype: string; pooling: string; transformers: string;
  dim: number; keys: string[];
  /** base64 Float32Array: one scale per key (int8 → float). */
  scales: string;
  /** base64 Int8Array: keys.length × dim, L2-normalised before quantisation. */
  vectors: string;
}
export interface GlossVectors { keys: string[]; dim: number; scales: Float32Array; vectors: Int8Array }

function fromBase64(s: string): Uint8Array {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function decodeVectors(f: VectorFile): GlossVectors {
  const v = fromBase64(f.vectors), s = fromBase64(f.scales);
  const vectors = new Int8Array(v.buffer, v.byteOffset, v.byteLength);
  const scales = new Float32Array(s.buffer.slice(s.byteOffset, s.byteOffset + s.byteLength));
  if (vectors.length !== f.keys.length * f.dim || scales.length !== f.keys.length) throw new Error('gloss vectors: size mismatch');
  return { keys: f.keys, dim: f.dim, scales, vectors };
}

/** Cosine similarity of a normalised query to every gloss, best first. */
export function nearestGlosses(gv: GlossVectors, q: ArrayLike<number>, k = 20): { key: string; score: number }[] {
  const { dim, vectors, scales } = gv;
  const scored: { key: string; score: number }[] = [];
  for (let i = 0; i < gv.keys.length; i++) {
    let s = 0;
    const o = i * dim;
    for (let j = 0; j < dim; j++) s += vectors[o + j]! * (q[j] ?? 0);
    scored.push({ key: gv.keys[i]!, score: s * scales[i]! });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, k);
}

export interface Suggestion { gloss: string; score: number; root: RootEntry }

/**
 * Up to `k` source words closest in meaning, one per Buxori entry ("ask" and
 * "to ask" are the same word), each resolved to the entry the translator would use.
 */
export function suggest(
  gv: GlossVectors, q: ArrayLike<number>, resolve: (gloss: string) => RootEntry | undefined,
  { k = 4, min = MIN_SCORE, exclude = '' }: { k?: number; min?: number; exclude?: string } = {},
): Suggestion[] {
  const out: Suggestion[] = [];
  const seen = new Set<string>();
  for (const { key, score } of nearestGlosses(gv, q, 40)) {
    if (score < min || out.length >= k) break;
    if (key === exclude) continue;
    const root = resolve(key);
    if (!root || seen.has(root.id)) continue;
    seen.add(root.id);
    out.push({ gloss: key.replace(/^to /, ''), score: Math.round(score * 100) / 100, root });
  }
  return out;
}

/** Maps texts to L2-normalised sentence embeddings. */
export type Embedder = (texts: string[]) => Promise<Float32Array[]>;

interface Extractor { (texts: string[], o: { pooling: string; normalize: boolean }): Promise<{ data: Float32Array; dims: number[] }> }
interface TransformersModule {
  env: { allowLocalModels: boolean; useBrowserCache: boolean; remotePathTemplate: string };
  pipeline: (task: string, model: string, o: Record<string, unknown>) => Promise<Extractor>;
}

/**
 * Downloads (or reads from the browser cache) transformers.js and the model, and
 * returns an embedder. `onProgress` receives 0–100 while files download.
 */
export async function loadEmbedder(onProgress?: (pct: number) => void, url: string = TRANSFORMERS_URL): Promise<Embedder> {
  const tf = (await import(/* @vite-ignore */ url)) as TransformersModule;
  tf.env.allowLocalModels = false;   // never probe this site for /models/…
  tf.env.useBrowserCache = true;
  // Pin the commit in the URL itself: transformers.js 4.3.1 drops the `revision` option in
  // some internal requests (config lookup, size probes), which would then hit "main".
  tf.env.remotePathTemplate = `{model}/resolve/${WORD_MODEL.revision}/`;
  const files = new Map<string, { loaded: number; total: number }>();
  const extractor = await tf.pipeline('feature-extraction', WORD_MODEL.id, {
    dtype: WORD_MODEL.dtype, device: 'wasm',
    progress_callback: (p: { status?: string; file?: string; loaded?: number; total?: number }) => {
      if (!onProgress || p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, { loaded: p.loaded ?? 0, total: p.total });
      let l = 0, t = 0;
      for (const f of files.values()) { l += f.loaded; t += f.total; }
      onProgress(Math.min(100, Math.round((100 * l) / t)));
    },
  });
  return async (texts) => {
    const r = await extractor(texts, { pooling: WORD_MODEL.pooling, normalize: true });
    const d = r.dims[r.dims.length - 1]!;
    return texts.map((_, i) => r.data.slice(i * d, (i + 1) * d));
  };
}
