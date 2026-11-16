import { useMemo } from 'react';
import type { RootEntry } from '../lib/types.ts';
import { findSimilarWordsOffline } from '../search/offlineSimilarWords.ts';

/**
 * "Similar spellings in the book": when English words are not in the source, the book's
 * words spelled most like them are offered. The user picks one and the edited sentence is
 * translated normally. Computed on the page from the book's own word list
 * (src/search/offlineSimilarWords.ts); nothing is downloaded.
 */
export interface Suggestion { gloss: string; root: RootEntry }

export function SimilarWords({ words, keys, rootFor, show, onPick }: {
  words: string[];
  /** The book's English glosses. */
  keys: readonly string[];
  /** The book's entry for one of those glosses. */
  rootFor: (gloss: string) => RootEntry | undefined;
  show: (s: string) => string; onPick: (word: string, s: Suggestion) => void;
}) {
  const byWord = useMemo(() => words.map((w) => ({
    word: w,
    list: findSimilarWordsOffline(w, keys).map((gloss) => ({ gloss, root: rootFor(gloss) })).filter((x): x is Suggestion => !!x.root),
  })), [words.join('|'), keys, rootFor]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!words.length || !byWord.some((x) => x.list.length)) return null;
  return (
    <div className="tr-similar" id="trSimilar">
      <div className="tr-explain-head">// Similar spellings in the book</div>
      <p className="tr-similar-text">Not in the book as typed. These book words are spelled alike. They are not translations of your word: pick one only if it is the word you meant.</p>
      {byWord.filter((x) => x.list.length).map(({ word, list }) => (
        <div className="tr-similar-row" key={word}>
          <span className="tr-similar-word">{word}</span>
          {list.map((x) => {
            const others = x.root.glosses.map((g) => g.text).filter((t) => t.replace(/^to /, '') !== x.gloss).slice(0, 2);
            return (
              <button type="button" key={x.root.id + x.gloss} className="tr-chip" onClick={() => onPick(word, x)}
                aria-label={`Use “${x.gloss}” (${x.root.lemma.text}) instead of “${word}”`}>
                <strong>{x.gloss}</strong> <code>{show(x.root.lemma.text.replace(/[?!.]+$/, ''))}</code>
                {others.length > 0 && <em>{others.join('; ')}</em>}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
