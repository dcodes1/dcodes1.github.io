import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createLookup } from '../lib/lookup.ts';
import type { BuxoriIndex } from '../lib/types.ts';
import './style.css';

function App() {
  const [query, setQuery] = useState('');
  const [direction, setDirection] = useState('en');
  const [index, setIndex] = useState<BuxoriIndex | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<React.ReactNode>(null);
  async function search(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(''); setResult(null);
    try {
      // The large index is requested only on first search, never on portfolio load.
      const data = index ?? (await import('../data/buxori-index.json')).default as unknown as BuxoriIndex;
      setIndex(data);
      const lookup = createLookup(data);
      const q = query.trim();
      let rows: React.ReactNode[] = [];
      if (direction === 'en') {
        const hit = lookup.byEnglish(q);
        rows = [...hit.roots.map(e => <li key={e.id}><strong>{e.lemma.text}</strong> — {e.glosses.map(g => g.text).join('; ')}
          <p>Source pages: {[...new Set(e.sources.map(s => s.page))].join(', ')}. Evidence: {e.lemma.evidence}.
          {e.sources.some(s => s.review) && ' Source marked REVIEW; verification required.'}</p>
          {e.verb?.conflicts && <p>Conflicting stems retained: {e.verb.conflicts.flatMap(c => c.values).join(', ')}. No preferred conjugation asserted.</p>}</li>),
          ...hit.inflected.map((e,i) => <li key={'i'+i}>{e.text} — {e.glosses.map(g => g.text).join('; ')} (page {e.source.page})</li>)];
        // Exact corpus retrieval preserves untranslated text and excludes Hebrew lines.
        for (const e of Object.values(data.examples)) if (e.language === 'buxori' && e.en?.trim().toLowerCase() === q.toLowerCase()) {
          rows.push(<li key={e.id}>{e.bux} — source page {e.source.page}{e.source.review && ' (REVIEW)'}</li>);
        }
      } else {
        const hit = lookup.byBuxori(q);
        rows = hit.matches.map(m => <li key={m.key}><strong>{m.key}</strong> — {[...m.roots, ...m.inflected].flatMap(e => e.glosses.map(g => g.text)).join('; ')}
          <p>{hit.tier === 'exact' ? 'Canonical spelling match in source' : 'Spelling candidate only ('+hit.tier+'); not a verified translation of your input.'}</p></li>);
        for (const e of lookup.corpus(q).slice(0, 20)) rows.push(<li key={e.id}>{e.bux} — {e.en ?? 'English translation unavailable'} (source page {e.source.page})</li>);
        const analyses = lookup.analyzeVerb(q);
        if (analyses.length) rows.push(<li key="analysis">Possible verb analyses:<ul>{analyses.map((a,i) => <li key={i}>{a.root.lemma.text}: {a.tense ?? 'bare stem'}, {a.ending?.personNumber ?? 'no ending'}; stem {a.stemText}</li>)}</ul></li>);
      }
      setResult(rows.length ? <ul>{rows}</ul> : <p>No source-backed match. Try a word or phrase from the lessons. Missing translations are not generated.</p>);
    } catch { setError('The dictionary could not be loaded. Please retry.'); }
    finally { setBusy(false); }
  }
  return <main><a href="/">← Portfolio</a><h1>Buxori dictionary & learning</h1>
    <p>Explore source vocabulary, phrases and verb analyses. Spelling candidates and uncertain source forms are labelled; this tool does not promise unrestricted sentence translation.</p>
    <form onSubmit={search}><label>Direction<select value={direction} onChange={e => {setDirection(e.target.value);setResult(null);}}><option value="en">English → Buxori</option><option value="bux">Buxori → English</option></select></label>
    <label>Word or phrase<input required maxLength={2000} value={query} onChange={e => setQuery(e.target.value)} /></label>
    <button disabled={busy}>{busy ? 'Loading…' : 'Look up'}</button></form>
    <section aria-live="polite" aria-busy={busy}>{error && <p role="alert">{error}</p>}{result}</section>
    <p>Latin source spellings are preserved. Hebrew input and alternate romanizations are experimental spelling aids.</p>
  </main>;
}
createRoot(document.getElementById('root')!).render(<App />);
