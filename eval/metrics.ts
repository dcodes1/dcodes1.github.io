/* Evaluation metrics shared by every engine run against eval/testset.json. */

export interface TestItem { en: string; type: string; rows: number[]; refs: string[] }
export interface TestSet { description: string; rowNumbering: string; items: TestItem[] }
export interface Prediction { bux: string | null; status: string }

/** Comparison key: case, edge punctuation and stress accents never decide correctness. */
export function surface(s: string): string {
  return s.normalize('NFD').replace(/[́̀̇]/g, '').normalize('NFC')
    .toLowerCase().replace(/[.,!?;:"“”«»]/g, '').replace(/\s+/g, ' ').trim();
}

/** Character n-gram F-beta (chrF, n = 1..6, beta = 2), whitespace ignored. */
export function chrF(ref: string, hyp: string, n = 6, beta = 2): number {
  const grams = (s: string, k: number) => {
    const t = s.replace(/\s+/g, '');
    const g = new Map<string, number>();
    for (let i = 0; i + k <= t.length; i++) { const x = t.slice(i, i + k); g.set(x, (g.get(x) ?? 0) + 1); }
    return g;
  };
  let pSum = 0, rSum = 0, cnt = 0;
  for (let k = 1; k <= n; k++) {
    const R = grams(ref, k), H = grams(hyp, k);
    const rTot = [...R.values()].reduce((a, b) => a + b, 0);
    const hTot = [...H.values()].reduce((a, b) => a + b, 0);
    if (!rTot && !hTot) continue;
    let match = 0;
    for (const [t, c] of H) match += Math.min(c, R.get(t) ?? 0);
    pSum += hTot ? match / hTot : 0; rSum += rTot ? match / rTot : 0; cnt++;
  }
  const P = cnt ? pSum / cnt : 0, Rc = cnt ? rSum / cnt : 0, b2 = beta * beta;
  return P + Rc === 0 ? 0 : ((1 + b2) * P * Rc) / (b2 * P + Rc);
}

export interface Report {
  engine: string;
  items: number;
  answered: number;
  correct: number;
  /** correct / items: the headline number (abstaining counts as wrong). */
  accuracy: number;
  /** correct / answered: how trustworthy an answer is. */
  precision: number;
  /** mean best chrF against any reference, over answered items. */
  chrfAnswered: number;
  /** mean chrF over all items, abstentions scoring 0. */
  chrfAll: number;
  byStatus: Record<string, { n: number; correct: number }>;
}

export function evaluate(engine: string, set: TestSet, predict: (en: string) => Prediction): { report: Report; rows: { en: string; refs: string[]; pred: Prediction; ok: boolean; chrf: number }[] } {
  const rows = set.items.map((it) => {
    const pred = predict(it.en);
    const refs = it.refs.map(surface);
    const hyp = pred.bux ? surface(pred.bux) : null;
    const ok = hyp !== null && refs.includes(hyp);
    const chrf = hyp === null ? 0 : Math.max(...refs.map((r) => chrF(r, hyp)));
    return { en: it.en, refs: it.refs, pred, ok, chrf };
  });
  const answered = rows.filter((r) => r.pred.bux);
  const byStatus: Report['byStatus'] = {};
  for (const r of rows) {
    const s = (byStatus[r.pred.status] ??= { n: 0, correct: 0 });
    s.n++; if (r.ok) s.correct++;
  }
  const round = (x: number) => Math.round(x * 1000) / 1000;
  const correct = rows.filter((r) => r.ok).length;
  return {
    report: {
      engine, items: rows.length, answered: answered.length, correct,
      accuracy: round(correct / rows.length),
      precision: round(answered.length ? correct / answered.length : 0),
      chrfAnswered: round(answered.length ? answered.reduce((a, r) => a + r.chrf, 0) / answered.length : 0),
      chrfAll: round(rows.reduce((a, r) => a + r.chrf, 0) / rows.length),
      byStatus,
    },
    rows,
  };
}
