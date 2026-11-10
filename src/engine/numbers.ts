/*
 * Numbers: English number words/digits → value; value → Buxori cardinal/ordinal
 * using the index's numeral entries and the TSV rules joining_numbers,
 * ordinal_formation and ordinal_formation_suffix_choice.
 */
import type { BuxoriIndex, Evidence } from '../lib/types.ts';
import type { Step } from './morphology.ts';

const UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19,
};
const TENS: Record<string, number> = { twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
const ORDINAL_WORDS: Record<string, string> = {
  first: 'one', second: 'two', third: 'three', fourth: 'four', fifth: 'five', sixth: 'six', seventh: 'seven', eighth: 'eight',
  ninth: 'nine', tenth: 'ten', eleventh: 'eleven', twelfth: 'twelve', thirteenth: 'thirteen', fourteenth: 'fourteen',
  fifteenth: 'fifteen', sixteenth: 'sixteen', seventeenth: 'seventeen', eighteenth: 'eighteen', nineteenth: 'nineteen',
  twentieth: 'twenty', thirtieth: 'thirty', fortieth: 'forty', fiftieth: 'fifty', sixtieth: 'sixty', seventieth: 'seventy',
  eightieth: 'eighty', ninetieth: 'ninety', hundredth: 'hundred', thousandth: 'thousand',
};

export interface ParsedNumber { value: number; ordinal: boolean; length: number }

/** Parse a number starting at tokens[i]: "25", "5th", "twenty-five", "three hundred and two", "fifth". */
export function parseNumber(tokens: string[], i: number): ParsedNumber | null {
  const t0 = tokens[i];
  if (!t0) return null;
  const dig = /^(\d+)(st|nd|rd|th)?$/.exec(t0);
  if (dig) return { value: Number(dig[1]), ordinal: !!dig[2], length: 1 };
  let total = 0, current = 0, j = i, ordinal = false, any = false;
  while (j < tokens.length) {
    let w = tokens[j]!;
    if (w === 'and' && any && tokens[j + 1] && (UNITS[tokens[j + 1]!] !== undefined || TENS[tokens[j + 1]!] !== undefined)) { j++; continue; }
    const parts = w.split('-');
    let ok = true;
    for (let k = 0; k < parts.length; k++) {
      let p = parts[k]!;
      if (ORDINAL_WORDS[p]) {
        // "one third", "three fourths": a unit followed by an ordinal is a fraction, not 1 + 3rd.
        // (An ordinal unit may only follow tens or hundreds: "twenty third", "one hundred first".)
        if (any && current % 10 !== 0) return null;
        p = ORDINAL_WORDS[p]!; ordinal = true;
      }
      if (UNITS[p] !== undefined) current += UNITS[p]!;
      else if (TENS[p] !== undefined) current += TENS[p]!;
      else if (p === 'hundred') current = (current || 1) * 100;
      else if (p === 'thousand') { total += (current || 1) * 1000; current = 0; }
      else if (p === 'million') { total += (current || 1) * 1_000_000; current = 0; }
      else { ok = false; break; }
    }
    if (!ok) break;
    any = true; j++;
    w = '';
    if (ordinal) break;
  }
  if (!any) return null;
  return { value: total + current, ordinal, length: j - i };
}

export interface BuiltNumber { text: string; evidence: Evidence; steps: Step[] }

export class Numbers {
  private readonly byValue = new Map<number, { text: string; row: number }>();
  private readonly rules: Map<string, number[]>;
  constructor(index: BuxoriIndex) {
    for (const e of Object.values(index.roots.entries)) {
      if (e.numeric?.kind === 'cardinal' && !this.byValue.has(e.numeric.value) && !e.sources.every((s) => s.review)) {
        this.byValue.set(e.numeric.value, { text: e.lemma.text.toLowerCase(), row: e.sources[0]?.row ?? 0 });
      }
    }
    this.rules = new Map(index.syntaxRules.map((r) => [r.id as string, r.sources.map((s) => s.row)]));
  }

  private join(parts: string[]): string {
    // joining_numbers: -u after a consonant, -yu after a vowel; higher number first
    return parts.map((p, k) => (k < parts.length - 1 ? p + (/[aeiouü]$/.test(p) ? 'yu' : 'u') : p)).join(' ');
  }

  cardinal(n: number): BuiltNumber | null {
    const direct = this.byValue.get(n);
    if (direct) return { text: direct.text, evidence: 'stated', steps: [{ text: `${n} → ${direct.text}.`, rows: [direct.row] }] };
    const parts: string[] = [];
    const steps: Step[] = [];
    let rest = n;
    let evidence: Evidence = 'stated';
    if (rest >= 1000) {
      const th = Math.floor(rest / 1000);
      const thW = th === 1 ? this.byValue.get(1000)?.text : (() => { const c = this.cardinal(th); const h = this.byValue.get(1000)?.text; return c && h ? `${c.text} ${h}` : undefined; })();
      if (!thW) return null;
      parts.push(thW); rest %= 1000;
      if (th > 1) { evidence = 'derived'; steps.push({ text: `${th * 1000}: “${thW}” (multiplier before hazor; no printed example).` }); }
    }
    if (rest >= 100) {
      const h = this.byValue.get(Math.floor(rest / 100) * 100);
      if (!h) return null;
      parts.push(h.text); steps.push({ text: `${Math.floor(rest / 100) * 100} → ${h.text}.`, rows: [h.row] }); rest %= 100;
    }
    if (rest > 0) {
      const d = this.byValue.get(rest);
      if (d) { parts.push(d.text); steps.push({ text: `${rest} → ${d.text}.`, rows: [d.row] }); }
      else {
        const tens = this.byValue.get(Math.floor(rest / 10) * 10), unit = this.byValue.get(rest % 10);
        if (!tens || !unit) return null;
        parts.push(tens.text, unit.text); steps.push({ text: `${rest} = ${tens.text} + ${unit.text}.`, rows: [tens.row, unit.row] });
      }
    }
    if (!parts.length) return null;
    const text = this.join(parts);
    steps.push({ text: `Compound numbers join with -u / -yu, highest first → ${text}.`, rows: this.rules.get('joining_numbers') ?? [] });
    return { text, evidence, steps };
  }

  ordinal(n: number): BuiltNumber | null {
    const c = this.cardinal(n);
    if (!c) return null;
    const words = c.text.split(' ');
    const last = words.at(-1)!;
    const suf = last === 'shish' ? 'tum' : /[aeiouü]$/.test(last) ? 'yum' : 'um';
    const text = [...words.slice(0, -1), last + suf].join(' ');
    return { text, evidence: c.evidence, steps: [...c.steps, { text: `Ordinal: ${last} + -${suf} → ${text}${last === 'shish' ? ' (shish is the stated exception)' : ''}.`, rows: this.rules.get('ordinal_formation') ?? [] }] };
  }
}
