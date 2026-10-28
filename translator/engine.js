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
    this.grammar = (index && index.grammar) || null;
    this.learned = (index && index.learned) || {};   // IBM-1 statistical lexicon
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
    // Fill remaining single tokens: explicit vocab, then the learned lexicon.
    // Articles and copulas are dropped (no Buxori surface form), not "unknown".
    var G = this.grammar, unknown = [];
    for (var i = 0; i < toks.length; i++) {
      if (covered[i]) continue;
      if (G && (G.articles.indexOf(toks[i]) !== -1 || G.copula.indexOf(toks[i]) !== -1)) {
        covered[i] = true; continue;        // dropped function word, not unknown
      }
      var w = this._glossWord(toks[i]);
      if (w) { pieces[i] = { bux: w, span: 1, src: "word", en: toks[i] }; covered[i] = true; }
      else unknown.push(toks[i]);
    }
    if (pieces.every(function (x) { return x === null; })) return null;

    // Walk the tokens left to right building:
    //   out        - Buxori only (untranslated words are OMITTED, never shown)
    //   breakdown  - per-segment [{en, bux|null}] for the explanation panel
    var out = [], breakdown = [], i2 = 0, knownTokens = 0;
    while (i2 < toks.length) {
      if (pieces[i2]) {
        out.push(pieces[i2].bux);
        breakdown.push({ en: pieces[i2].en, bux: pieces[i2].bux });
        knownTokens += pieces[i2].span;
        i2 += pieces[i2].span;
      } else {
        // Untranslated / dropped word: keep it out of the Buxori output; only
        // record genuinely untranslated content words in the breakdown.
        if (unknown.indexOf(toks[i2]) !== -1) breakdown.push({ en: toks[i2], bux: null });
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

  // L2.7 Grammar engine ------------------------------------------------------
  // A compact, offline, dataset-derived translator that conjugates verbs and
  // orders words per the grammar the TSV documents (verb-final; me-+stem+ending
  // present; droppable copula; ba/az prepositions). No neural net, no network,
  // no key. Handles simple pronoun-subject sentences; returns null otherwise so
  // the caller falls back to the word-by-word layer. Output is a labelled draft.
  var NEG = { "not": 1, "don't": 1, "dont": 1, "doesn't": 1, "doesnt": 1,
              "didn't": 1, "didnt": 1, "won't": 1, "wont": 1, "cannot": 1, "can't": 1 };
  var SKIP_AUX = { "do": 1, "does": 1, "did": 1, "will": 1, "would": 1, "can": 1 };
  var PAST_SURFACE = { went: 1, bought: 1, sold: 1, saw: 1, gave: 1, took: 1,
    made: 1, said: 1, came: 1, ate: 1, was: 1, were: 1, had: 1, knew: 1, spoke: 1 };

  Engine.prototype._lemma = function (w) {
    var G = this.grammar;
    if (G.irregular_lemma[w]) return G.irregular_lemma[w];
    var v = G.verbs;
    var cands = [];
    if (w.length > 4 && /ing$/.test(w)) cands.push(w.slice(0, -3), w.slice(0, -3) + "e");
    if (w.length > 3 && /es$/.test(w)) cands.push(w.slice(0, -2));
    if (w.length > 3 && /ed$/.test(w)) cands.push(w.slice(0, -2), w.slice(0, -1));
    if (w.length > 2 && /s$/.test(w)) cands.push(w.slice(0, -1));
    for (var i = 0; i < cands.length; i++) if (v[cands[i]]) return cands[i];
    return w;
  };

  // Conjugate a verb entry for person/tense/polarity using the dataset rules.
  Engine.prototype._conjugate = function (v, person, tense, neg) {
    var G = this.grammar, form;
    if (tense === "past") {
      // simple past: past stem = infinitive minus "-an"; add past ending.
      var inf = (v.inf || "").toLowerCase().split(" ").pop();
      var pstem = /an$/.test(inf) ? inf.slice(0, -2) : v.stem;
      form = pstem + (G.past_endings[person] || "");
      if (neg) form = "na" + form;
    } else {
      var end = (G.present_endings[person] || ["", ""])[v.vowel ? 1 : 0];
      form = v.no_me ? (v.stem + end) : ("me" + v.stem + end);
      if (neg) form = "na" + form;
    }
    if (v.compound) form = v.noun.toLowerCase() + " " + form;
    return form;
  };

  // Translate one complement word from the dataset: explicit vocab first, then
  // an exact single-word entry, then the learned (IBM-1) statistical lexicon.
  // Returns null only when no source at all covers the word (never English).
  Engine.prototype._glossWord = function (w) {
    var g = null;
    if (this.words[w]) g = this.words[w];
    else {
      var e = this.exact[w];
      if (e && e.en && e.en.toLowerCase() === w) g = e.bux;
      else if (this.learned[w]) g = this.learned[w];
    }
    // Never return a grammatical suffix fragment ("-i man", "-am") as a word.
    if (g && g.trim().charAt(0) === "-") return null;
    return g;
  };

  // wh-question words (single token).
  var WH = { where: "kujo", what: "chi", who: "ki", whom: "ki", when: "kay",
             which: "kadom", why: "charo" };
  var QAUX = { do: 1, does: 1, did: 1, will: 1, would: 1, can: 1, could: 1,
               is: 1, are: 1, am: 1, was: 1, were: 1, "'s": 1, "'re": 1, "'m": 1 };

  Engine.prototype.grammarTranslate = function (text) {
    var G = this.grammar;
    if (!G || !G.verbs) return null;
    var toks = tokenize(text);
    if (toks.length < 2) return null;

    // Proper nouns: capitalised input words (not first) stay capitalised.
    var proper = {};
    var rawWords = String(text).trim().split(/\s+/);
    for (var rw = 0; rw < rawWords.length; rw++) {
      if (rw > 0 && /^[A-Z]/.test(rawWords[rw])) proper[normEn(rawWords[rw])] = 1;
    }

    var isQuestion = /\?\s*$/.test(text) || !!WH[toks[0]] || !!QAUX[toks[0]];
    var i = 0;

    // Leading wh-word (where / what / how many / how much ...).
    var wh = null;
    if (WH[toks[0]]) { wh = { bux: WH[toks[0]], pre: false }; i = 1; }
    else if (toks[0] === "how") {
      if (toks[1] === "many") { wh = { bux: "chandta", pre: true }; i = 2; }
      else if (toks[1] === "much") { wh = { bux: "chand", pre: true }; i = 2; }
      else { wh = { bux: "chixel", pre: false }; i = 1; }   // "how ..." = chixel/chitü
    }

    // Auxiliaries + negation can sit before the subject (questions: "do you
    // eat?") or after it (declaratives: "I do not eat"), so consume them on
    // both sides of the subject.
    var state = { neg: false, tense: "present" };
    var self0 = this;
    function eatAux() {
      while (i < toks.length) {
        var t0 = toks[i];
        if (NEG[t0]) { state.neg = true; i++; continue; }
        if (QAUX[t0] || SKIP_AUX[t0]) {
          if (t0 === "did" || t0 === "was" || t0 === "were") state.tense = "past";
          i++; continue;
        }
        break;
      }
    }
    eatAux();

    // Subject pronoun (optional — Bukhori is pro-drop, esp. in questions).
    var subjTok = null, subjInfo = null;
    if (G.subjects[toks[i]]) { subjTok = toks[i]; subjInfo = G.subjects[toks[i]]; i++; }
    eatAux();
    var neg = state.neg, tense = state.tense;

    // Main verb (skip copulas; they are dropped/handled structurally).
    var vIdx = -1, verb = null;
    for (var j = i; j < toks.length; j++) {
      if (G.copula.indexOf(toks[j]) !== -1) continue;
      if (NEG[toks[j]]) { neg = true; continue; }
      var lemma = this._lemma(toks[j]);
      if (G.verbs[lemma]) { vIdx = j; verb = G.verbs[lemma]; if (PAST_SURFACE[toks[j]]) tense = "past"; break; }
    }

    // Need enough structure to be meaningful. A subject pronoun is required
    // unless this is a question (where Bukhori drops the subject), so plain
    // noun phrases fall through to the word-by-word layer instead of being
    // forced into a sentence.
    if (!subjTok && !isQuestion) return null;
    if (!verb && !wh && !subjTok) return null;

    // Complement tokens: everything except the subject and the main verb
    // (copulas and articles are dropped inside the renderer).
    var compTokens = [];
    for (var k = i; k < toks.length; k++) {
      if (k === vIdx) continue;
      if (G.copula.indexOf(toks[k]) !== -1) continue;
      compTokens.push(toks[k]);
    }

    // Formal/informal only matters when 2nd person ("you") is involved.
    var second = (subjTok === "you") || toks.indexOf("you") !== -1 || toks.indexOf("your") !== -1;
    var self = this;

    function build(register) {
      var steps = [], unknown = [], pieces = [];
      var person, subjBux = null;
      if (subjTok === "you") {
        person = register === "informal" ? "2s" : "2p";
        subjBux = register === "informal" ? "Tu" : "Shumo";
      } else if (subjInfo) {
        person = subjInfo.p; subjBux = subjInfo.bux;
      } else {
        person = "3s";                      // pro-drop default
      }
      if (subjBux) { pieces.push(subjBux); steps.push("Subject “" + subjTok + "” → " + subjBux + "."); }

      if (wh && wh.pre) pieces.push(wh.bux);        // "how many/much" leads the object
      var comps = self._renderComplements(compTokens, steps, proper, unknown);
      pieces = pieces.concat(comps);
      if (wh && !wh.pre) pieces.push(wh.bux);        // "... kujo" before the verb / at end

      if (verb) {
        var vform = self._conjugate(verb, person, tense, neg);
        pieces.push(vform);
        steps.push("Verb “" + toks[vIdx] + "” → " + vform + " ("
          + (tense === "past" ? "simple past" : "present")
          + (verb.no_me ? "" : ", me- + " + verb.stem + " + ending")
          + (verb.compound ? ", compound verb keeps “" + verb.noun.toLowerCase() + "”" : "")
          + (neg ? ", negated with na-" : "") + ").");
        steps.push("Word order: the verb goes to the end.");
      } else {
        steps.push("Bukhori drops “to be” here.");
      }
      return { pieces: pieces, steps: steps, unknown: unknown };
    }

    if (second) {
      var inf = build("informal"), formal = build("formal");
      return this._grammarResult({
        variants: [
          { register: "informal", bux: finish(inf.pieces, isQuestion) },
          { register: "formal", bux: finish(formal.pieces, isQuestion) },
        ],
        steps: formal.steps, unknown: formal.unknown,
      });
    }
    var one = build("default");
    return this._grammarResult({
      bux: finish(one.pieces, isQuestion), steps: one.steps, unknown: one.unknown,
    });
  };

  // Join pieces into a clean sentence: trim dangling connectives/prepositions,
  // capitalise the first word, add "?" for questions. Pieces are plain strings;
  // unknown words were never added (they are reported separately), so the
  // Buxori output contains only Buxori.
  function finish(pieces, question) {
    var words = pieces.map(function (p) { return p.toString(); })
      .filter(function (w) { return w && w.length; });
    // drop a trailing stray connective/preposition
    while (words.length && /^(va|yo|ba|az|qati|boli)$/i.test(words[words.length - 1])) words.pop();
    var bux = words.join(" ").replace(/\s+/g, " ").trim();
    bux = bux.charAt(0).toUpperCase() + bux.slice(1);
    if (question && !/\?$/.test(bux)) bux += "?";
    return bux;
  }

  // Render complement tokens into ordered Buxori pieces. Prepositions become
  // ba/az/qati; articles and copulas drop; unknown content words are OMITTED
  // from the output (so no English leaks) and collected in `unknown`.
  Engine.prototype._renderComplements = function (tokens, steps, proper, unknown) {
    var G = this.grammar, out = [];
    proper = proper || {}; unknown = unknown || [];
    for (var i = 0; i < tokens.length; i++) {
      var t = tokens[i];
      if (G.articles.indexOf(t) !== -1) continue;             // a/an/the dropped
      if (G.copula.indexOf(t) !== -1) continue;               // is/are/am dropped
      if (NEG[t]) continue;
      if (G.time_adverbs[t]) { out.push(G.time_adverbs[t]); continue; }
      if (Object.prototype.hasOwnProperty.call(G.prepositions, t)) {
        var prep = G.prepositions[t];
        if (prep) { out.push(prep); if (steps) steps.push("“" + t + "” → " + prep + "."); }
        continue;
      }
      if (G.connectives[t]) { out.push(G.connectives[t]); continue; }
      var g = this._glossWord(t);
      if (g) out.push(proper[t] ? g : g.charAt(0).toLowerCase() + g.slice(1));
      else unknown.push(t);                                   // omit, report later
    }
    return out;
  };

  Engine.prototype._grammarResult = function (r) {
    var unknown = r.unknown && r.unknown.length ? r.unknown : null;
    return {
      status: "grammar",
      bux: r.bux || (r.variants && r.variants[0] && r.variants[0].bux) || "",
      variants: r.variants || null,
      confidence: unknown ? 0.42 : 0.6,
      source: "grammar-engine",
      detail: {
        steps: r.steps,
        unknown: unknown,
        warning: "Built offline from your dataset's grammar rules (verb "
          + "conjugation, word order, prepositions). An unverified draft — "
          + "useful and usually close, but not a verified source translation.",
      },
    };
  };

  // Noun-phrase handler: ezafe adjective ordering, possessives, number/plural.
  // Grounded in the dataset's documented rules (ezafe -i/-yi; possessive
  // endings; number + singular noun). Returns null for anything that isn't a
  // clean noun phrase, so sentences fall through to the other layers.
  var POSS = {
    my:    { end: "am",    pron: "man" },
    your:  { end: "at",    pron: "tu", endF: "aton", pronF: "shumo" },
    his:   { end: "ash",   pron: "u" },
    her:   { end: "ash",   pron: "u" },
    its:   { end: "ash",   pron: "u" },
    our:   { end: "amo",   pron: "mo" },
    their: { end: "ashon", pron: "ino" },
  };
  var VOWEL_END = /[aeiouüöáéíAEIOUÜÖÁÉÍ]$/;
  function ezafeLink(w) { return VOWEL_END.test(w) ? "yi" : "i"; }
  function lcFirst(s) { return s ? s.charAt(0).toLowerCase() + s.slice(1) : s; }
  function singularize(w) {
    if (/ies$/.test(w) && w.length > 4) return w.slice(0, -3) + "y";
    if (/(ses|xes|zes|ches|shes)$/.test(w)) return w.slice(0, -2);
    if (/s$/.test(w) && !/ss$/.test(w) && w.length > 2) return w.slice(0, -1);
    return null;
  }

  // Resolve a noun to its cleanest base form, preferring the curated vocab
  // (base forms) over the learned lexicon (which can carry ezafe/plural
  // inflection). Returns {bux, pl} or null.
  Engine.prototype._cleanNoun = function (t) {
    var s = singularize(t);
    var tryClean = function (self, w) {
      if (self.words[w] && self.words[w].charAt(0) !== "-") return self.words[w];
      var e = self.exact[w];
      if (e && e.en && e.en.toLowerCase() === w && e.bux.charAt(0) !== "-") return e.bux;
      return null;
    };
    var g = tryClean(this, t);
    if (g) return { bux: g, pl: false };
    if (s) { g = tryClean(this, s); if (g) return { bux: g, pl: true }; }
    // learned lexicon last (may be inflected); prefer the singular form so a
    // plural like "books" resolves to the base noun, not a learned plural.
    if (s && this.learned[s]) return { bux: this.learned[s], pl: true };
    if (this.learned[t]) return { bux: this.learned[t], pl: false };
    return null;
  };

  Engine.prototype.nounPhrase = function (text) {
    var G = this.grammar;
    if (!G || !G.adjectives) return null;
    var toks = tokenize(text);
    if (toks.length < 2 || toks.length > 6) return null;

    var proper = {};
    var raw = String(text).trim().split(/\s+/);
    for (var r = 1; r < raw.length; r++) if (/^[A-Z]/.test(raw[r])) proper[normEn(raw[r])] = 1;

    var nums = [], poss = null, adjs = [], nounBux = null, nounEn = null,
        plural = false, unknown = [];
    for (var i = 0; i < toks.length; i++) {
      var t = toks[i];
      if (G.articles.indexOf(t) !== -1) continue;
      if (POSS[t]) { if (poss) return null; poss = t; continue; }
      if (G.numbers[t]) { nums.push(lcFirst(G.numbers[t])); continue; }
      if (G.adjectives[t]) { adjs.push(lcFirst(G.adjectives[t])); continue; }
      var nf = this._cleanNoun(t);             // prefer clean base-form noun
      if (nf) {
        if (nounBux) return null;              // one head noun only (v1)
        nounEn = t; nounBux = proper[t] ? nf.bux : lcFirst(nf.bux); plural = nf.pl;
      } else unknown.push(t);
    }
    if (!nounBux || unknown.length) return null;             // keep output clean
    var mods = nums.length + (poss ? 1 : 0) + adjs.length + (plural ? 1 : 0);
    if (mods === 0) return null;                             // bare noun -> elsewhere
    if (poss && adjs.length) return null;                    // combo too complex for v1

    var self = this;
    function build(register) {
      var head = nounBux, steps = [];
      if (poss) {
        var p = POSS[poss];
        if (VOWEL_END.test(head)) {
          var pron = (register === "formal" && p.pronF) ? p.pronF : p.pron;
          head = head + ezafeLink(head) + " " + pron;
        } else {
          head = head + ((register === "formal" && p.endF) ? p.endF : p.end);
        }
        steps.push("Possessive “" + poss + " " + nounEn + "” → " + head
          + " (" + (VOWEL_END.test(nounBux) ? "ezafe + pronoun" : "possessive ending") + ").");
      } else if (plural && nums.length === 0) {
        head = head + "ho";
        steps.push("Plural “" + nounEn + "” → " + head + " (suffix -ho).");
      }
      if (adjs.length) {
        var before = head;
        head = head + ezafeLink(head) + " " + adjs.join(" ");
        steps.push("Adjective order: “" + nounEn + "” + " + adjs.join(", ")
          + " → " + head + " (noun + ezafe -" + ezafeLink(before) + " + adjective).");
      }
      var words = nums.concat([head]);
      if (nums.length) steps.push("Number stays before the noun; the noun is singular.");
      var bux = words.join(" ").replace(/\s+/g, " ").trim();
      return { bux: bux.charAt(0).toUpperCase() + bux.slice(1), steps: steps };
    }

    var warn = "Built offline from your dataset's noun-phrase rules (ezafe, "
             + "possessives, number/plural). An unverified draft.";
    if (poss === "your") {
      var inf = build("informal"), fm = build("formal");
      return { status: "grammar", bux: inf.bux,
        variants: [{ register: "informal", bux: inf.bux }, { register: "formal", bux: fm.bux }],
        confidence: 0.62, source: "noun-phrase",
        detail: { steps: fm.steps, unknown: null, warning: warn } };
    }
    var one = build("default");
    return { status: "grammar", bux: one.bux, variants: null, confidence: 0.62,
      source: "noun-phrase", detail: { steps: one.steps, unknown: null, warning: warn } };
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

    // L2.7 grammar engine: conjugated, verb-final draft for pronoun sentences.
    if (this.grammar) {
      var gr = null;
      try { gr = this.grammarTranslate(raw); } catch (e) { gr = null; }
      if (gr && gr.bux) { this.cache[key] = gr; return gr; }
    }

    // L2.8 noun-phrase handler: ezafe/possessive/number ordering.
    if (this.grammar) {
      var np = null;
      try { np = this.nounPhrase(raw); } catch (e) { np = null; }
      if (np && np.bux) { this.cache[key] = np; return np; }
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
