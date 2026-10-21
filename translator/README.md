# English → Buxori Translator

A dataset-grounded English → Buxori (Bukharian, Judeo-Tajik) translator embedded
in the portfolio (`index.html`, section `// 05`). The curated TSV is the single
source of truth: the tool returns verified source translations, clearly-flagged
approximations, or an honest "no translation available" — it never fabricates
Buxori vocabulary.

> **Script note:** the source material transliterates Bukharian into the Latin
> alphabet (with diacritics `ü á é í ö ć ġ`). That transliteration is preserved
> byte-for-byte; the tool does not convert to Cyrillic or Hebrew script.

---

## 1. Dataset summary & quality

Source: `data/bukhori.tsv` — a 3,519-row lesson-book export, 11 columns
(`page, lesson, entry_type, section, english, bukhori, spoken_form, alt_forms,
numeric_value, notes, flag`).

| Metric | Value |
|---|---|
| Source rows | 3,519 |
| **Clean English→Buxori pairs** | **2,835** |
| Unique English keys | 2,537 |
| Keys with multiple attested Buxori forms | 208 |
| Single-word lexicon entries | 900 |
| Multi-word phrases | 1,582 |
| Sentence-length retrieval examples | 974 |
| Rows flagged `REVIEW` (source-uncertain) | 7 |

**Entry-type mix:** vocab 1,766 · example 526 · phrase 512 · exercise 291 ·
paradigm 202 · grammar 106 · reading 77 · proverb 39.

**Shape:** overwhelmingly a **word/short-phrase lexicon** — 62% of pairs are 1–2
English tokens; only a few hundred are full sentences.

**Quality issues found and how they are handled:**

- **Non-pairs excluded from lookup** (kept out of the index, counted in the
  summary): `grammar` rows are rule headers with no translation; `paradigm` rows
  are conjugation-table fragments (e.g. "my" → `-am`, "I" → `-um`) that would
  corrupt matching; `exercise` rows are answerless prompts or fill-in stubs
  (`Man xarid...`). 288 rows have an empty `bukhori` cell and are dropped.
- **Duplicates / variants:** 208 English keys map to several Buxori forms. One
  canonical form is chosen (prefer non-`REVIEW`, then `vocab`/`phrase` over
  `example`, then shorter); the rest are preserved as **attested variants** and
  shown in the UI, never discarded.
- **Normalisation is key-only.** English is lower-cased, de-punctuated, and
  parenthetical glosses (`(polite)`) are stripped **for the match key only**.
  The original English and the original Buxori are always stored verbatim.
- **`REVIEW` entries** (source marks the transliteration as uncertain) are kept
  but surfaced with a visible "review" warning.
- **No invented data.** Missing translations are never filled in.

Run `python3 scripts/preprocess.py` to regenerate; it prints this summary and
writes it to `data/summary.json`.

---

## 2. Translation approach (and why)

A **hybrid, retrieval-first** engine (`engine.js`), chosen to fit the data:

| Layer | What it does | Confidence |
|---|---|---|
| **L1 Exact** | normalised input == an indexed English key → return the verified Buxori verbatim | highest, authoritative |
| **L2 Fuzzy** | closest key by char-trigram + token-overlap + edit distance, with per-path thresholds (strict for multi-word, spelling-based for single-word typos) | medium, flagged |
| **L2.5 Compositional** | cover the input with indexed phrases (longest-match) + word glosses; **report any token it can't source** | low, flagged word-by-word |
| **L3 Retrieval-augmented (optional)** | for out-of-coverage input, retrieve the most similar dataset pairs and let a server-side model translate *grounded on them* | optional, AI-assisted |

**Why no fine-tuned NLLB/mT5/etc.** It was evaluated and rejected, honestly:

1. **No model supports Bukhori.** NLLB-200, mT5 and similar have no Bukharian
   (Judeo-Tajik) token/lang-id; they would silently emit Standard Tajik,
   Persian or Russian — exactly the failure mode the project forbids.
2. **The data is too small and the wrong shape** — ~2,800 mostly single-word
   pairs, only a few hundred sentences. That is a lexicon, not a parallel
   sentence corpus; it cannot train an accurate NMT model.
3. **The deployment target is static** (GitHub Pages) with no GPU. Training
   would be an offline fiction with no honest payoff.

So the dataset itself *is* the model. L1–L2.5 run entirely in the browser from a
precomputed index; L3 is an optional, clearly-labelled enhancement. This beats
any ungrounded "ask an LLM to translate into Bukhori" approach, which the data
specifically exists to prevent.

---

## 3. Evaluation

`node eval/evaluate.js` runs a **leak-free generalisation test**: the held-out
test split's English keys are removed from the index (via `data/index_train.json`,
built from train+val only), so exact matching cannot fire and only the
generalising layers are measured — the hard case, not everyday use.

Headline results (295 held-out examples):

- **Abstention 79%** — by design: the tool refuses rather than guess on unseen
  input.
- **Committed answers** (exact+fuzzy, the trust-critical bucket): tiny on this
  adversarial split because the answers were deliberately removed.
- **Compositional drafts** earn partial credit — **chrF ≈ 0.19** — and are
  UI-flagged as unverified; verbatim exact-match is the wrong lens for them.

Metrics and caveats: **chrF** (char n-gram F2) is the fair automatic metric for
this short, diacritic-rich, transliterated target; **BLEU-4** is reported but is
unreliable on 1–3 token targets (most of the data); neither captures meaning.
See `eval/sample_predictions.txt` for a manual read, including where
compositional drafts fail (idioms, verb phrases).

> This number **understates** real use. When a user types a word or phrase that
> exists in the dataset — the common case — they get the verified translation at
> 100% fidelity. `tests/engine.test.js` asserts every exact key resolves to a
> real dataset value.

**Do not** re-measure "accuracy" on in-index items; that is memorisation, not
accuracy, and is deliberately excluded.

---

## 4. Running locally

No build step. Any static server works (the page fetches `/translator/data/index.json`):

```bash
# from the repo root
python3 -m http.server 8000
# open http://localhost:8000/   and scroll to the Translator section
```

Rebuild the index after editing the TSV:

```bash
python3 translator/scripts/preprocess.py \
    --tsv translator/data/bukhori.tsv --out translator/data
```

Self-checks (no dependencies beyond Node + Python stdlib):

```bash
node translator/tests/engine.test.js     # engine unit tests
node translator/eval/evaluate.js         # held-out evaluation
```

---

## 5. Deploying

The translator is **pure static files** — it ships with the existing GitHub
Pages site automatically. `index.html` loads `/translator/engine.js` and fetches
`/translator/data/index.json`; committing the repo is the whole deploy. No
environment variables, no model downloads, no API keys required.

### Enabling full sentence translation + explanations (AI layer)

The offline engine (L1–L2.5) translates **words and phrases that exist in the
dataset** and, for multi-word input, shows a clean word-by-word draft with any
untranslated word kept inline (no gap markers) plus a dataset gloss. It cannot
fluently translate arbitrary sentences or explain grammar — a ~2,800-entry
lesson lexicon has no copula/preposition coverage for that.

To get **Google-Translate-style fluent translations with sentence
explanations**, enable the AI layer. It calls Claude with your dataset examples
as grounding and returns `{translation, explanation}`. The API key stays
server-side in a Cloudflare Worker; the browser never sees it. Exact dataset
matches stay authoritative and never hit the network.

```bash
cd translator/worker
npm i -g wrangler
wrangler secret put ANTHROPIC_API_KEY     # paste key when prompted
wrangler deploy                           # prints a *.workers.dev URL
```

Then set the endpoint in `index.html` (search for `RAG_ENDPOINT`):

```js
var RAG_ENDPOINT = "https://buxori-rag.<your-subdomain>.workers.dev";
```

Lock `ALLOW_ORIGIN` in `wrangler.toml` to your domain for production. L3 results
are always flagged as AI-assisted, grounded on retrieved dataset examples, and
the worker **refuses** to translate if no examples are supplied.

**Required for L3 only:** `ANTHROPIC_API_KEY` (Worker secret), optional `MODEL`
and `ALLOW_ORIGIN` vars. Nothing else in the project needs secrets.

---

## 6. Known limitations & improving accuracy

- **Coverage is the ceiling.** Outside ~2,800 pairs the tool abstains (or, with
  L3, approximates). It is a faithful dataset front-end, not a general MT system.
- **Compositional output is word-order-naïve.** It concatenates dataset forms;
  it does not apply Bukhori grammar (ezafe, verb-final order, possessive
  suffixes). Treat multi-word drafts as glossing aids. The dataset's `paradigm`
  and `grammar` rows (deliberately excluded from lookup) are the raw material for
  a future grammar-aware assembler.
- **Transliteration, not native script.** Matches the source; a future pass
  could add Cyrillic/Hebrew renderings if a mapping is sourced.
- **7 `REVIEW` entries** carry source uncertainty (shown as warnings).
- **Ways to improve:** add more sentence-level parallel pairs (the biggest win);
  add a curated synonym/lemmatisation map (e.g. "thanks" ↔ "thank you") to widen
  exact matching without guessing; build the grammar-aware assembler from the
  paradigm tables; enable L3 for graceful out-of-coverage handling.

---

## File map

```
translator/
  engine.js                 # the translation engine (browser + Node)
  data/
    bukhori.tsv             # source dataset (authoritative)
    index.json              # engine payload (all pairs) — shipped to browser
    index_train.json        # train+val-only index — evaluation (no leakage)
    pairs.jsonl             # every clean pair (audit trail)
    splits.json             # leak-free train/val/test ids
    summary.json            # dataset quality report
  scripts/preprocess.py     # TSV → indexes (stdlib only, reproducible)
  eval/
    evaluate.js             # held-out evaluation (chrF/BLEU/abstention)
    sample_predictions.txt  # manual-inspection sample (generated)
  tests/engine.test.js      # engine unit tests
  worker/                   # optional Layer-3 RAG (Cloudflare Worker)
    worker.js  wrangler.toml
```
