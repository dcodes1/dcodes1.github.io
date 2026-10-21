/*
 * Self-check for engine.js. Run: node translator/tests/engine.test.js
 * No test framework -- plain assertions so it runs anywhere Node exists.
 */
const fs = require("fs");
const path = require("path");
const Engine = require("../engine.js");

const index = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../data/index.json"), "utf-8")
);
const eng = new Engine(index);

let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; }
  else { fail++; console.log("  FAIL:", name, extra != null ? JSON.stringify(extra) : ""); }
}

console.log("index:", JSON.stringify(eng.count()));

// --- L1 exact: must return the TSV value verbatim -------------------------
const exacts = [
  ["I", "Man"],
  ["water", "Maim"],
  ["to go", "Raftan"],
  ["Sunday", "Yakshanbe"],
];
for (const [en, bux] of exacts) {
  const r = eng.translate(en);
  check("exact '" + en + "'", r.status === "exact" && r.bux === bux, r);
}

// Capitalisation / punctuation / whitespace must not change an exact match.
for (const variant of ["  water ", "WATER", "Water.", "water!"]) {
  const r = eng.translate(variant);
  check("normalised exact '" + variant + "'", r.status === "exact" && r.bux === "Maim", r);
}

// --- exact matches must equal the raw dataset (no fabrication) -------------
const pairs = fs.readFileSync(path.join(__dirname, "../data/pairs.jsonl"), "utf-8")
  .trim().split("\n").map(JSON.parse);
const byKey = {};
for (const p of pairs) (byKey[p.en_key] = byKey[p.en_key] || []).push(p.bux);
let mismatches = 0, checked = 0;
for (const key of Object.keys(index.exact)) {
  const r = eng.translate(key);
  checked++;
  if (r.status !== "exact") { mismatches++; continue; }
  if (!byKey[key] || byKey[key].indexOf(r.bux) === -1) mismatches++;
}
check("all " + checked + " exact keys resolve to a real dataset value",
      mismatches === 0, { mismatches });

// --- fuzzy: typo should still land on the right entry ---------------------
(function () {
  const r = eng.translate("watter");   // misspelling of water
  check("fuzzy 'watter' -> water", r.bux === "Maim", r);
})();

// --- compositional: known words assemble, unknown flagged -----------------
(function () {
  const r = eng.translate("water and bread");
  check("compositional covers known words",
        r.status === "compositional" || r.status === "exact", r);
})();

// --- out of coverage: never fabricate -------------------------------------
(function () {
  const r = eng.translate("quantum chromodynamics supercollider");
  check("gibberish -> status none", r.status === "none" && r.bux === null, r);
  check("gibberish returns retrieved examples",
        Array.isArray(r.detail.retrieved), r.detail);
})();

// --- empty input ----------------------------------------------------------
(function () {
  const r = eng.translate("   ");
  check("blank -> none", r.status === "none", r);
})();

// --- determinism / cache --------------------------------------------------
(function () {
  const a = eng.translate("to go"), b = eng.translate("to go");
  check("cached result identical", a === b);
})();

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
