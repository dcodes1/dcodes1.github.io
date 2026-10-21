/*
 * evaluate.js -- honest accuracy report for the Buxori translator.
 *
 * Methodology
 * -----------
 * The engine is run against the HELD-OUT TEST split using an index built ONLY
 * from train+val pairs (translator/data/index_train.json). Test keys are
 * therefore genuinely unseen by exact matching -- no train/test leakage.
 *
 * A prediction counts as CORRECT if it equals ANY attested Bukhori form for
 * that English key in the full dataset (a key can have several valid variants).
 *
 * Metrics (all with documented limits):
 *   exact-match accuracy  - strict, the headline number for a lexicon.
 *   coverage / abstention - how often the engine answers vs. honestly abstains.
 *   chrF (char 6-gram F2) - partial-credit surface similarity.
 *   BLEU-4 (smoothed)     - token n-gram precision; weak on 1-3 token targets,
 *                           reported only for context.
 *
 * Run: node translator/eval/evaluate.js
 */
const fs = require("fs");
const path = require("path");
const Engine = require("../engine.js");

const DATA = path.join(__dirname, "../data");
const idxTrain = JSON.parse(fs.readFileSync(path.join(DATA, "index_train.json"), "utf-8"));
const splits = JSON.parse(fs.readFileSync(path.join(DATA, "splits.json"), "utf-8"));
const pairs = fs.readFileSync(path.join(DATA, "pairs.jsonl"), "utf-8")
  .trim().split("\n").map(JSON.parse);

const byId = {};
const allFormsByKey = {};
for (const p of pairs) {
  byId[p.id] = p;
  (allFormsByKey[p.en_key] = allFormsByKey[p.en_key] || new Set()).add(p.bux);
}

const engine = new Engine(idxTrain);
const norm = (s) => Engine.normEn(s);

// ---- metric helpers -------------------------------------------------------
function chrF(ref, hyp, n = 6, beta = 2) {
  // character n-gram F-beta, averaged over n=1..n (sacrebleu-style, simplified)
  const grams = (s, k) => {
    s = s.replace(/\s+/g, "");
    const g = {};
    for (let i = 0; i + k <= s.length; i++) { const t = s.slice(i, i + k); g[t] = (g[t] || 0) + 1; }
    return g;
  };
  let pSum = 0, rSum = 0, cnt = 0;
  for (let k = 1; k <= n; k++) {
    const R = grams(ref, k), H = grams(hyp, k);
    const rTot = Object.values(R).reduce((a, b) => a + b, 0);
    const hTot = Object.values(H).reduce((a, b) => a + b, 0);
    if (rTot === 0 && hTot === 0) continue;
    let match = 0;
    for (const t in H) if (R[t]) match += Math.min(H[t], R[t]);
    const prec = hTot ? match / hTot : 0;
    const rec = rTot ? match / rTot : 0;
    pSum += prec; rSum += rec; cnt++;
  }
  const P = cnt ? pSum / cnt : 0, Rr = cnt ? rSum / cnt : 0;
  const b2 = beta * beta;
  return (P + Rr === 0) ? 0 : (1 + b2) * P * Rr / (b2 * P + Rr);
}

function bleu4(refs, hyps) {
  // corpus BLEU-4 with add-1 smoothing on higher orders.
  const tok = (s) => norm(s).split(/\s+/).filter(Boolean);
  const ngrams = (arr, k) => { const g = {}; for (let i = 0; i + k <= arr.length; i++) { const t = arr.slice(i, i + k).join(" "); g[t] = (g[t] || 0) + 1; } return g; };
  let refLen = 0, hypLen = 0;
  const num = [0, 0, 0, 0], den = [0, 0, 0, 0];
  for (let i = 0; i < hyps.length; i++) {
    const r = tok(refs[i]), h = tok(hyps[i]);
    refLen += r.length; hypLen += h.length;
    for (let k = 1; k <= 4; k++) {
      const R = ngrams(r, k), H = ngrams(h, k);
      for (const t in H) { den[k - 1] += H[t]; if (R[t]) num[k - 1] += Math.min(H[t], R[t]); }
    }
  }
  let logSum = 0;
  for (let k = 0; k < 4; k++) {
    const n = num[k] + (k === 0 ? 0 : 1), d = den[k] + (k === 0 ? 0 : 1);
    const p = d ? n / d : 0;
    logSum += Math.log(p || 1e-9);
  }
  const bp = hypLen > refLen ? 1 : Math.exp(1 - refLen / Math.max(hypLen, 1));
  return bp * Math.exp(logSum / 4);
}

// ---- run ------------------------------------------------------------------
const test = splits.test.map((id) => byId[id]).filter(Boolean);

const buckets = { exact: 0, fuzzy: 0, compositional: 0, none: 0 };
// "committed" = answers the UI presents as verified/closest (exact + fuzzy).
// "draft"     = compositional word-by-word assemblies, flagged as unverified.
let committed = 0, committedCorrect = 0;
let draft = 0, draftCorrect = 0;
const committedRefs = [], committedHyps = [];
const draftRefs = [], draftHyps = [];

for (const p of test) {
  const res = engine.translate(p.en);
  buckets[res.status] = (buckets[res.status] || 0) + 1;
  const valid = allFormsByKey[p.en_key] || new Set([p.bux]);
  const isCorrect = res.bux != null && valid.has(res.bux);

  if (res.status === "exact" || res.status === "fuzzy") {
    committed++; if (isCorrect) committedCorrect++;
    committedRefs.push(p.bux); committedHyps.push(res.bux);
  } else if (res.status === "compositional" || res.status === "grammar") {
    draft++; if (isCorrect) draftCorrect++;
    draftRefs.push(p.bux); draftHyps.push(res.bux);
  }
}

const n = test.length;
const pct = (x, d) => (d ? (100 * x / d).toFixed(1) : "0.0") + "%";
const meanChrf = (R, H) => R.length ? (R.reduce((a, r, i) => a + chrF(r, H[i]), 0) / R.length) : 0;

const answered = committed + draft;
const report = {
  test_examples: n,
  index_built_from: "train+val only (held-out test keys removed -> no leakage)",
  status_distribution: buckets,
  abstention_rate: pct(buckets.none, n) + "  (deliberately refuses rather than guess)",
  committed_answers: {
    count: committed,
    exact_match_precision: pct(committedCorrect, committed),
    chrF: meanChrf(committedRefs, committedHyps).toFixed(3),
    note: "exact+fuzzy layers; the trust-critical number",
  },
  draft_answers: {
    count: draft,
    exact_match_precision: pct(draftCorrect, draft),
    chrF: meanChrf(draftRefs, draftHyps).toFixed(3),
    BLEU4: draftRefs.length ? bleu4(draftRefs, draftHyps).toFixed(3) : "n/a",
    note: "compositional word-by-word; UI-flagged as unverified. Verbatim exact-"
        + "match is the wrong lens here -- chrF shows partial correctness.",
  },
  answered_rate: pct(answered, n),
};

console.log(JSON.stringify(report, null, 2));
console.log(`
Interpretation
--------------
* This is a GENERALISATION test: every test English key was removed from the
  index, so exact matching cannot fire. It measures only how the fuzzy and
  compositional layers cope with unseen input -- the HARD case. It is NOT the
  everyday experience, where a user's word or phrase is usually a real dataset
  entry and returns the verified translation with 100% fidelity (see
  translator/tests/engine.test.js, which checks all ${Object.keys(idxTrain.exact).length}+ exact keys).
* The number that matters for trust is committed_answers.exact_match_precision:
  when the tool PRESENTS an answer as verified/closest, is it right. The large
  abstention rate is by design -- refusing beats fabricating.
* chrF (char n-gram F2) gives partial credit and is the fair automatic metric
  for this short, diacritic-rich, transliterated target. BLEU-4 is near-useless
  on 1-3 token targets (most of this data) and is shown only for context.
* No automatic metric captures meaning; see sample_predictions.txt for a manual
  read, including where compositional drafts go wrong (idioms, verb phrases).`);

// Write a human-readable sample for manual inspection.
const sample = [];
for (let i = 0; i < test.length && sample.length < 40; i += Math.max(1, Math.floor(test.length / 40))) {
  const p = test[i], res = engine.translate(p.en);
  sample.push(
    `EN:   ${p.en}\n` +
    `GOLD: ${p.bux}\n` +
    `PRED: ${res.bux == null ? "(abstained)" : res.bux}  [${res.status}${res.confidence ? " " + res.confidence : ""}]\n`
  );
}
fs.writeFileSync(path.join(__dirname, "sample_predictions.txt"),
  "Manual inspection sample -- held-out test set\n" +
  "=".repeat(48) + "\n\n" + sample.join("\n"));
console.log("\nWrote translator/eval/sample_predictions.txt");
