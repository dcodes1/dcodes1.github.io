import { useEffect, useRef, useState } from 'react';
import vectorsUrl from '../data/gloss-vectors.json?url';
import type { Engine } from '../engine/engine.ts';
import { DOWNLOAD_MB, decodeVectors, loadEmbedder, suggest, type Embedder, type GlossVectors, type Suggestion } from '../ai/similar.ts';

/**
 * "Similar words in the book": when a translation fails because English words are
 * not in the source, a small language model running in the browser suggests source
 * words close in meaning. The user picks one and the edited sentence is translated
 * normally. Suggestions are never used as a translation on their own (see
 * src/ai/similar.ts for why, with the measurement).
 */
const OPT_IN = 'buxori-similar-words';
const optedIn = () => { try { return localStorage.getItem(OPT_IN) === 'on'; } catch { return false; } };
const rememberOptIn = () => { try { localStorage.setItem(OPT_IN, 'on'); } catch { /* private mode: ask again next time */ } };

// Loaded once per page, on first use.
// (transformers.js and the model are fetched by loadEmbedder; this module itself is small.)
let ready: Promise<{ embed: Embedder; gv: GlossVectors }> | null = null;
let progressListener: ((pct: number) => void) | null = null;
function loadAll() {
  ready ??= (async () => {
    const [embed, gv] = await Promise.all([
      loadEmbedder((pct) => progressListener?.(pct)),
      fetch(vectorsUrl).then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); }).then(decodeVectors),
    ]);
    return { embed, gv };
  })();
  ready.catch(() => { ready = null; });   // allow a retry after a network error
  return ready;
}

type Phase = { s: 'idle' } | { s: 'loading'; pct: number } | { s: 'ready'; byWord: Record<string, Suggestion[]> } | { s: 'error'; msg: string };

export function SimilarWords({ words, engine, show, onPick }: {
  words: string[]; engine: Engine; show: (s: string) => string; onPick: (word: string, s: Suggestion) => void;
}) {
  const [phase, setPhase] = useState<Phase>({ s: 'idle' });
  const key = words.join('|');
  const current = useRef(key);
  current.current = key;

  const start = () => {
    const mine = key;
    rememberOptIn();
    setPhase({ s: 'loading', pct: 0 });
    progressListener = (pct) => setPhase((p) => (p.s === 'loading' ? { s: 'loading', pct } : p));
    loadAll()
      .then(async ({ embed, gv }) => {
        const vecs = await embed(words);
        if (current.current !== mine) return;   // the user has moved on to another sentence
        const byWord: Record<string, Suggestion[]> = {};
        words.forEach((w, i) => { byWord[w] = suggest(gv, vecs[i]!, (g) => engine.lex.roots(g)[0], { exclude: w }); });
        setPhase({ s: 'ready', byWord });
      })
      .catch((e: unknown) => { if (current.current === mine) setPhase({ s: 'error', msg: e instanceof Error ? e.message : String(e) }); });
  };

  // New words: start over; if the user turned suggestions on before, run straight away.
  useEffect(() => {
    setPhase({ s: 'idle' });
    if (words.length && optedIn()) start();
    return () => { progressListener = null; };
  }, [key]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!words.length) return null;
  const list = words.map((w) => `“${w}”`).join(', ');
  return (
    <div className="tr-similar" id="trSimilar">
      <div className="tr-explain-head">// Similar words in the book</div>
      {phase.s === 'idle' && (
        <>
          <p className="tr-similar-text">{list} {words.length > 1 ? 'are' : 'is'} not in the source. A small AI language model can suggest words in the book with a similar meaning. You choose one, and that sentence is translated.</p>
          <button type="button" className="btn btn-ghost tr-similar-go" onClick={start}>Suggest similar words</button>
          <p className="tr-similar-fine">Runs on your device: about {DOWNLOAD_MB} MB is downloaded once, and nothing you type is sent anywhere.</p>
        </>
      )}
      {phase.s === 'loading' && (
        <p className="tr-similar-text" role="status"><span className="tr-spinner tr-spinner-dim" /> Loading the language model{phase.pct ? ` · ${phase.pct}%` : '…'}</p>
      )}
      {phase.s === 'error' && (
        <p className="tr-similar-text" role="alert">The language model could not be loaded ({phase.msg}). <button type="button" className="tr-linkbtn" onClick={start}>Try again</button></p>
      )}
      {phase.s === 'ready' && (
        <>
          <p className="tr-similar-text"><span className="tr-badge ai">ai suggestion</span>Closest meanings the book has. These are not translations of your word: pick one only if it means what you meant.</p>
          {words.map((w) => {
            const s = phase.byWord[w] ?? [];
            return (
              <div className="tr-similar-row" key={w}>
                <span className="tr-similar-word">{w}</span>
                {s.length ? s.map((x) => {
                  const others = x.root.glosses.map((g) => g.text).filter((t) => t.replace(/^to /, '') !== x.gloss).slice(0, 2);
                  return (
                    <button type="button" key={x.root.id} className="tr-chip" onClick={() => onPick(w, x)}
                      aria-label={`Use “${x.gloss}” (${x.root.lemma.text}) instead of “${w}”`}>
                      <strong>{x.gloss}</strong> <code>{show(x.root.lemma.text.replace(/[?!.]+$/, ''))}</code>
                      {others.length > 0 && <em>{others.join('; ')}</em>}
                    </button>
                  );
                }) : <span className="tr-similar-none">nothing close in the book</span>}
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
