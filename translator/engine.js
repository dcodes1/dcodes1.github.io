/*
 * engine.js -- English -> Buxori (Bukharian Judeo-Tajik) translation engine.
 *
 * Pure, dependency-free. Runs identically in the browser and in Node (for the
 * test/eval harness). The TSV is the sole authority: this engine only matches,
 * ranks, and assembles translations that exist in the indexed dataset. It never
 * invents Bukhori vocabulary.
 *
 * Layers, in priority order:
 *   L1  exact        - normalised English == an indexed English key.
 *   L2  fuzzy        - closest indexed key above a confidence threshold.
 *   L2.5 compositional - cover the input with indexed phrases + word glosses;
 *                        report any uncovered tokens instead of guessing.
 *   L3  retrieve()   - returns ranked dataset examples for an optional external
 *                      RAG model (see worker/). The engine itself never calls a
 *                      model; out-of-coverage input returns status "none".
 *
 * Result shape (always):
 *   { status, bux|null, confidence, source, detail }
 *   status: "exact" | "fuzzy" | "compositional" | "none"
 */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.BuxoriEngine = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // ---- normalisation (MUST mirror preprocess.py normalize_english) ---------
  var PUNCT = {
    "’": "'", "‘": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "−": "-",
  };
  var EDGE = " \t\r\n.,!?;:\"'()[]{}";

  function foldPunct(s) {
    var out = "";
    for (var i = 0; i < s.length; i++) out += PUNCT[s[i]] || s[i];
    return out;
  }
  function trimEdges(s) {
    var a = 0, b = s.length;
    while (a < b && EDGE.indexOf(s[a]) !== -1) a++;
    while (b > a && EDGE.indexOf(s[b - 1]) !== -1) b--;
    return s.slice(a, b);
  }
  function normEn(s) {
    s = (s == null ? "" : String(s));
    if (s.normalize) s = s.normalize("NFC");
    s = foldPunct(s);
    s = s.replace(/\([^()]*\)/g, " ");          // drop parenthetical glosses
    s = s.toLowerCase();
    s = s.replace(/\s+/g, " ").trim();
    s = trimEdges(s);
    s = s.replace(/\s+/g, " ");
    return s;
  }
  function tokenize(s) {
    return normEn(s).split(/[^a-z0-9']+/).filter(Boolean);
  }
  function trigrams(s) {
    var k = "  " + normEn(s).replace(/[^a-z0-9]+/g, " ").trim() + "  ";
    var set = {};
    if (k.length < 3) { set[k] = 1; return set; }
    for (var i = 0; i < k.length - 2; i++) set[k.slice(i, i + 3)] = 1;
    return set;
  }

  // ---- similarity primitives ------------------------------------------------
  function jaccard(aSet, bSet) {
    var inter = 0, aKeys = Object.keys(aSet);
    for (var i = 0; i < aKeys.length; i++) if (bSet[aKeys[i]]) inter++;
    var uni = aKeys.length + Object.keys(bSet).length - inter;
    return uni === 0 ? 0 : inter / uni;
  }
  function tokenJaccard(a, b) {
    var sa = {}, sb = {}, i;
    for (i = 0; i < a.length; i++) sa[a[i]] = 1;
    for (i = 0; i < b.length; i++) sb[b[i]] = 1;
    return jaccard(sa, sb);
  }
  // Normalised Levenshtein similarity in [0,1].
  function editSim(a, b) {
    if (a === b) return 1;
    var m = a.length, n = b.length;
    if (m === 0 || n === 0) return 0;
    var prev = new Array(n + 1), cur = new Array(n + 1), i, j;
    for (j = 0; j <= n; j++) prev[j] = j;
    for (i = 1; i <= m; i++) {
      cur[0] = i;
      for (j = 1; j <= n; j++) {
        var cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
        cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      }
      var t = prev; prev = cur; cur = t;
    }
    return 1 - prev[n] / Math.max(m, n);
  }

  // ---- engine ---------------------------------------------------------------
  function Engine(index) {
    this.index = index || {};
    this.cfg = Object.assign(
      {
        // multi-word ("blend") acceptance uses token overlap and is strict;
        // single-word ("spell") acceptance is spelling-driven (a one-char typo
        // in a short word caps edit-similarity near 0.83, so it needs its own,
        // lower bar) and gated by trigram overlap to avoid cat->car slips.
        fuzzy_accept: 0.86, fuzzy_review: 0.62,
        spell_accept: 0.72, spell_review: 0.6,
        max_input_chars: 2000,
      },
      (index && index.config) || {}
    );
    this.exact = (index && index.exact) || {};
    this.words = (index && index.words) || {};
    this.phrases = (index && index.phrases) || [];
    this.retrievalEx = (index && index.retrieval) || [];
    this.cache = {};

    // Precompute lightweight per-key features for fuzzy matching.
    this._keys = Object.keys(this.exact);
    this._feat = {};
    for (var i = 0; i < this._keys.length; i++) {
      var k = this._keys[i];
      this._feat[k] = { tg: trigrams(k), tok: tokenize(k) };
    }
    // Phrase keys sorted longest-first (greedy longest-match coverage).
    this._phrasesByLen = this.phrases
      .map(function (p) { return { k: p.k, bux: p.bux, en: p.en, n: tokenize(p.k).length }; })
      .sort(function (a, b) { return b.n - a.n; });
  }

  Engine.prototype.count = function () {
    return {
      exact: this._keys.length,
      words: Object.keys(this.words).length,
      phrases: this.phrases.length,
      retrieval: this.retrievalEx.length,
    };
  };

  // L1 -----------------------------------------------------------------------
  Engine.prototype.exactLookup = function (key) {
    return Object.prototype.hasOwnProperty.call(this.exact, key)
      ? this.exact[key] : null;
  };

  // L2 -----------------------------------------------------------------------
  // Returns the best fuzzy candidate and its combined score, or null.
  Engine.prototype.bestFuzzy = function (text) {
    var qtg = trigrams(text), qtok = tokenize(text);
    if (qtok.length === 0) return null;
    var qtokSet = {}; for (var t = 0; t < qtok.length; t++) qtokSet[qtok[t]] = 1;

    var best = null;
    for (var i = 0; i < this._keys.length; i++) {
      var k = this._keys[i], f = this._feat[k];
      // Cheap gate: require at least one shared token OR similar length,
      // skips the costly scoring for obviously unrelated keys.
      var shared = 0;
      for (var j = 0; j < f.tok.length; j++) if (qtokSet[f.tok[j]]) { shared = 1; break; }
      if (!shared && Math.abs(f.tok.length - qtok.length) > 1) continue;

      var tg = jaccard(qtg, f.tg);
      if (tg < 0.2 && !shared) continue;
      var tj = tokenJaccard(qtok, f.tok);
      var es = editSim(normEn(text).replace(/\s+/g, " "), k);

      var kind, score;
      if (qtok.length === 1 && f.tok.length === 1) {
        // spelling path: edit distance + trigram, gated so only genuinely
        // close spellings qualify (prevents short-word false positives).
        kind = "spell";
        score = tg < 0.3 ? 0 : 0.55 * es + 0.45 * tg;
      } else {
        // blended path for multi-word: token overlap carries the meaning.
        kind = "blend";
        score = 0.4 * tg + 0.35 * tj + 0.25 * es;
      }
      if (!best || score > best.score) {
        best = { key: k, score: score, kind: kind, entry: this.exact[k] };
      }
    }
    return best;
  };

  // Accept / review thresholds depend on which scoring path produced the match.
  Engine.prototype._fuzzyThresholds = function (kind) {
    return kind === "spell"
      ? { accept: this.cfg.spell_accept, review: this.cfg.spell_review }
      : { accept: this.cfg.fuzzy_accept, review: this.cfg.fuzzy_review };
  };

  // L2.5 ---------------------------------------------------------------------
  // Greedy longest-phrase + word-gloss coverage. Honest about gaps: any token
  // we cannot source from the dataset is reported in detail.unknown, and the
  // assembled output is clearly marked as a word-by-word draft.
  Engine.prototype.compose = function (text) {
    var toks = tokenize(text);
    if (toks.length === 0) return null;
    var covered = new Array(toks.length).fill(false);
    var pieces = new Array(toks.length).fill(null);

    // Try multi-word phrases first, longest first.
    for (var p = 0; p < this._phrasesByLen.length; p++) {
      var ph = this._phrasesByLen[p];
      if (ph.n < 2 || ph.n > toks.length) continue;
      var ptok = tokenize(ph.k);
      for (var start = 0; start + ph.n <= toks.length; start++) {
        var ok = true;
        for (var q = 0; q < ph.n; q++) {
          if (covered[start + q] || toks[start + q] !== ptok[q]) { ok = false; break; }
        }
        if (ok) {
          for (var r = 0; r < ph.n; r++) { covered[start + r] = true; }
          pieces[start] = { bux: ph.bux, span: ph.n, src: "phrase", en: ph.en };
        }
      }
    }
    // Fill remaining single tokens from the word lexicon.
    var unknown = [];
    for (var i = 0; i < toks.length; i++) {
      if (covered[i]) continue;
      var w = this.words[toks[i]];
      if (w) { pieces[i] = { bux: w, span: 1, src: "word", en: toks[i] }; covered[i] = true; }
      else unknown.push(toks[i]);
    }
    if (pieces.every(function (x) { return x === null; })) return null;

    // Walk the tokens left to right building:
    //   out        - the assembled line (untranslated words kept as-is, no gaps)
    //   breakdown  - per-segment [{en, bux|null}] for the explanation panel
    var out = [], breakdown = [], i2 = 0, knownTokens = 0;
    while (i2 < toks.length) {
      if (pieces[i2]) {
        out.push(pieces[i2].bux);
        breakdown.push({ en: pieces[i2].en, bux: pieces[i2].bux });
        knownTokens += pieces[i2].span;
        i2 += pieces[i2].span;
      } else {
        // Untranslated word: keep the English word inline (readable, no "…").
        out.push(toks[i2]);
        breakdown.push({ en: toks[i2], bux: null });
        i2 += 1;
      }
    }
    var coverage = knownTokens / toks.length;
    return {
      bux: out.join(" "),
      coverage: coverage,
      unknown: unknown,
      breakdown: breakdown,
      pieces: pieces.filter(Boolean),
    };
  };

  // Word-by-word dataset gloss for the explanation panel. Independent of which
  // layer produced the main translation; shows what each English word maps to
  // in the dataset (or marks it as not found). Never invents a gloss.
  Engine.prototype.glossTokens = function (text) {
    var c = this.compose(text);
    if (c && c.breakdown) return c.breakdown;
    // single-token input: direct word lookup
    var toks = tokenize(text);
    return toks.map(function (t) {
      return { en: t, bux: this.words[t] || null };
    }, this);
  };

  // L3 ------------------------------------------------------------------------
  // Rank dataset examples by similarity to the input, for an external RAG model.
  Engine.prototype.retrieve = function (text, k) {
    k = k || 6;
    var qtg = trigrams(text), qtok = tokenize(text);
    var scored = this.retrievalEx.map(function (ex) {
      var tg = jaccard(qtg, trigrams(ex.en));
      var tj = tokenJaccard(qtok, ex.toks || tokenize(ex.en));
      return { en: ex.en, bux: ex.bux, score: 0.5 * tg + 0.5 * tj };
    });
    scored.sort(function (a, b) { return b.score - a.score; });
    return scored.slice(0, k);
  };

  // Main entry ----------------------------------------------------------------
  Engine.prototype.translate = function (text) {
    var raw = (text == null ? "" : String(text));
    if (raw.length > this.cfg.max_input_chars) {
      raw = raw.slice(0, this.cfg.max_input_chars);
    }
    var key = normEn(raw);
    if (!key) return { status: "none", bux: null, confidence: 0, source: "empty", detail: {} };
    if (this.cache[key]) return this.cache[key];

    var res;
    // L1 exact
    var hit = this.exactLookup(key);
    if (hit) {
      res = {
        status: "exact", bux: hit.bux, confidence: 1, source: "tsv-exact",
        detail: {
          english: hit.en, type: hit.type, review: !!hit.review,
          spoken: hit.spoken || null, alt: hit.alt || null,
          notes: hit.notes || null, variants: hit.variants || null,
        },
      };
      this.cache[key] = res; return res;
    }

    // L2 fuzzy
    var fz = this.bestFuzzy(raw);
    var thr = fz ? this._fuzzyThresholds(fz.kind) : null;
    if (fz && fz.score >= thr.accept) {
      res = {
        status: "fuzzy", bux: fz.entry.bux, confidence: round(fz.score),
        source: "tsv-fuzzy",
        detail: { matchedEnglish: fz.entry.en, type: fz.entry.type,
                  review: !!fz.entry.review, variants: fz.entry.variants || null },
      };
      this.cache[key] = res; return res;
    }

    // L2.5 compositional (for multi-word input)
    var comp = tokenize(raw).length >= 2 ? this.compose(raw) : null;
    if (comp && comp.coverage >= 0.5) {
      res = {
        status: "compositional",
        bux: comp.bux,
        confidence: round(0.5 * comp.coverage + (comp.unknown.length ? 0 : 0.1)),
        source: "tsv-compositional",
        detail: {
          coverage: round(comp.coverage), unknown: comp.unknown,
          breakdown: comp.breakdown, pieces: comp.pieces,
          warning: "Assembled word-by-word from the dataset; not a verified "
                 + "sentence translation. Grammar and word order are not applied.",
        },
      };
      this.cache[key] = res; return res;
    }

    // L2 low-confidence suggestion (surfaced as a hint, not an answer)
    if (fz && fz.score >= thr.review) {
      res = {
        status: "none", bux: null, confidence: round(fz.score),
        source: "below-threshold",
        detail: {
          reason: "No reliable translation in the dataset.",
          suggestion: { english: fz.entry.en, bux: fz.entry.bux, score: round(fz.score) },
          retrieved: this.retrieve(raw, 5),
        },
      };
      this.cache[key] = res; return res;
    }

    // Out of coverage.
    res = {
      status: "none", bux: null, confidence: 0, source: "out-of-coverage",
      detail: {
        reason: "This phrase is not in the Bukhori dataset, so no verified "
              + "translation is available.",
        retrieved: this.retrieve(raw, 5),
      },
    };
    this.cache[key] = res; return res;
  };

  function round(x) { return Math.round(x * 100) / 100; }

  // expose helpers for tests
  Engine.normEn = normEn;
  Engine.tokenize = tokenize;
  Engine.editSim = editSim;
  return Engine;
});
