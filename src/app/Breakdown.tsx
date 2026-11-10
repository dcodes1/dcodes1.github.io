import { useEffect, useState } from 'react';
import type { ReverseEngine, Reading, Token } from '../engine/reverse.ts';

/**
 * Word-by-word panel: one card per Buxori word (root, affixes, gloss). Tapping or
 * hovering a card opens its details: the other readings of that spelling, the other
 * words the source has for the same English, spoken and variant forms, the register
 * the source gives (Literal / spoken), and the TSV rows.
 */
const POS: Record<string, string> = { proper_noun: 'name', phrase: 'phrase', numeral: 'number' };
const REGISTER: Record<string, string> = { literal: 'Literal', spoken: 'spoken' };
const short = (r: Reading) => r.gloss.replace(/^to (?=\w)/, (m) => (r.pos === 'verb' ? m : '')).split(';')[0]!.trim();
const affixes = (r: Reading) => r.parts.filter((p) => p.form.startsWith('-') || p.form.endsWith('-'));

function ReadingLine({ r, show }: { r: Reading; show: (s: string) => string }) {
  return (
    <>
      <strong>{show(r.lemma)}</strong> <span className="tr-pos">{POS[r.pos] ?? r.pos}</span>
      {r.register && <span className="tr-reg-tag">{REGISTER[r.register]}</span>} — {r.glosses.slice(0, 4).join('; ')}
      {r.parts.length > 0 && (
        <div className="tr-entry-sub">{r.parts.map((p, i) => (
          <span key={i} className="tr-part"><code>{/^[-a-zü']+-?$/i.test(p.form) && p.label !== 'tense' && p.label !== 'person' ? show(p.form) : p.form}</code> {p.label}</span>
        ))}</div>
      )}
    </>
  );
}

export function Breakdown({ tokens, reverse, show, heading = 'Word by word' }: {
  tokens: Token[]; reverse: ReverseEngine; show: (s: string) => string; heading?: string;
}) {
  const [open, setOpen] = useState<number | null>(null);
  // Hovering previews a word; a click or tap pins it open (and a second one closes it).
  const [pinned, setPinned] = useState(false);
  const key = tokens.map((t) => t.latin).join(' ');
  useEffect(() => { setOpen(null); setPinned(false); }, [key]);
  if (!tokens.length) return null;
  const t = open !== null ? tokens[open] : undefined;
  const r = t?.readings[t.chosen];
  const others = t ? t.readings.filter((x) => x !== r) : [];
  const syn = r ? reverse.synonyms(r) : [];
  return (
    <div className="tr-breakdown" id="trBreakdown">
      <div className="tr-explain-head">// {heading}</div>
      <div className="tr-words" role="list">
        {tokens.map((tok, i) => {
          const rd = tok.readings[tok.chosen];
          const more = tok.readings.length - (rd ? 1 : 0) + (rd ? reverse.synonyms(rd).length : 0) + tok.suggestions.length;
          return (
            <button type="button" role="listitem" key={i} className={`tr-word${open === i ? ' open' : ''}${rd ? '' : ' unknown'}`}
              aria-expanded={open === i} onMouseEnter={() => { if (!pinned) setOpen(i); }}
              onClick={() => { if (pinned && open === i) { setOpen(null); setPinned(false); } else { setOpen(i); setPinned(true); } }}
              aria-label={rd ? `${tok.text}: ${short(rd)}. Details` : `${tok.text}: not in the source`}>
              <span className="tr-word-bux">{show(/[^\x00-\x7f]/.test(tok.text.replace(/[üÜáéíćġî’ʼ]/g, '')) ? tok.latin : tok.text)}</span>
              <span className="tr-word-gloss">{rd ? short(rd) : 'not in the source'}</span>
              {rd && affixes(rd).length > 0 && <span className="tr-word-tags">{affixes(rd).map((p) => show(p.form)).join(' ')}</span>}
              {rd?.register && <span className="tr-reg-tag">{REGISTER[rd.register]}</span>}
              {more > 0 && <span className="tr-word-more" title="More readings or forms">+{more}</span>}
            </button>
          );
        })}
      </div>
      {t && (
        <div className="tr-word-detail" id="trWordDetail" aria-live="polite">
          {r ? <div className="tr-entry"><ReadingLine r={r} show={show} />
            {r.rows.length > 0 && <span className="tr-rows" title="Line numbers in translator/data/bukhori.tsv"> TSV {r.rows.slice(0, 4).join(', ')}{r.rows.length > 4 ? '…' : ''}</span>}
            {r.forms.length > 0 && <div className="tr-entry-sub">Also written or said: {r.forms.slice(0, 6).map((f, i) => <span key={i} className="tr-part"><code>{show(f.text)}</code> {f.kind}</span>)}</div>}
            {r.everyday && r.everyday.toLowerCase() !== t.latin && <div className="tr-entry-sub">Everyday (Regular) form: <code>{show(r.everyday)}</code></div>}
            {r.spelling !== 'exact' && <div className="tr-entry-sub">Matched without accents or apostrophes; the source spells it <code>{show(r.lemma)}</code>.</div>}
          </div> : <div className="tr-entry"><strong>{t.text}</strong> is not in the source{t.readings.length ? ' in a form that fits here' : ''}. It was left as typed.</div>}
          {others.length > 0 && (
            <div className="tr-alts"><div className="tr-alts-head">Other readings of “{show(t.latin)}”</div>
              <ul className="tr-entries">{others.slice(0, 5).map((x, i) => <li key={i} className="tr-entry"><ReadingLine r={x} show={show} /></li>)}</ul></div>
          )}
          {syn.length > 0 && (
            <div className="tr-alts"><div className="tr-alts-head">Other words the source gives for the same English</div>
              <div className="tr-entry-sub">{syn.map((x, i) => <span key={i} className="tr-part"><code>{show(x.text)}</code> {x.gloss}</span>)}</div></div>
          )}
          {t.suggestions.length > 0 && (
            <div className="tr-alts"><div className="tr-alts-head">Similar spellings in the source (not used)</div>
              <div className="tr-entry-sub">{t.suggestions.map((x, i) => <span key={i} className="tr-part"><code>{show(x.lemma)}</code> {x.glosses.slice(0, 2).join('; ')}</span>)}</div></div>
          )}
        </div>
      )}
    </div>
  );
}
