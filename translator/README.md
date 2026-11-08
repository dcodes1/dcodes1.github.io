# Buxori translator

An English ⇄ Buxori (Bukharian, Judeo-Tajik) translator and learning tool,
served at [davidmilov.com/translator](https://davidmilov.com/translator).
Everything it outputs comes from one source, a 3,519-row transcription of a
Bukharian lesson book (`translator/data/bukhori.tsv`). The output is either a
printed entry, or source words combined by the grammar rules that same book
states. It never invents vocabulary. Words it cannot source are reported, and
its reasoning is shown step by step, with TSV line numbers.

## How it fits together

```
translator/data/bukhori.tsv          the only source of truth (never edited by code)
        │  scripts/compile-tsv.ts    strict reader, every row accounted for, byte-identical output
        ▼
src/data/buxori-index.json           roots, verb stems, printed conjugation tables, affixes,
        │                            paradigms, grammar rules, examples, exclusions, provenance
        │  src/lib/normalizer.ts     any spelling (Latin variants, Cyrillic, Hebrew script) → TSV key
        │  src/lib/lookup.ts         Buxori → English (with match tier), verb analysis
        │  src/engine/               English → Buxori (below)
        │  src/ai/similar.ts         optional in-browser model: similar source words for unknown English
        ▼
src/app/ (React)  ──vite build──▶  translator/app/   committed; loaded by index.html on first visit
```

GitHub Pages serves the repository as-is, so the built app is committed. The
portfolio (`index.html`) only downloads it when `/translator` is opened. The
entry script is 66 KB gzipped, plus 19 KB for the engine and 187 KB for the
content-hashed index. The optional similar-words model (below) loads only on request.

## The engine (`src/engine/`)

The layers are tried in order, and the first that succeeds wins. The UI labels the result with that layer:

| status | meaning |
|---|---|
| `exact` (**verified**) | the English is an entry, inflected headword or example sentence in the TSV |
| `grammar` (**built from rules**) | assembled from TSV words with TSV-stated rules; every step is cited |
| `fuzzy` (**closest match**) | spelling corrected (swapped or doubled letters only) or a near-identical entry |
| `none` | nothing reliable; similar source sentences are shown, plus (as a separate, labelled hint, never as the answer) an incomplete draft or word glosses when some words were found. On the frozen test set those drafts were right 0 of 36 times. |

Main design points:

- **Attested forms first.** The compiler extracts the printed conjugation
  tables (raftan, shudan, omadan, doshtan, donistan, guftan, dodan, kardan;
  present, past, perfect, continuous, imperative). The engine uses those before
  any rule.
- **Rules come from data.** Endings are read from the index's paradigm cells,
  whose allomorphs are tagged by register and environment. The code only
  encodes the rule logic the TSV states in prose (each step cites the rule's rows).
- **Irregular verbs.** A reduced stem (`merum` → `r`) is inferred only if it
  reproduces every printed form of that verb's table. That is how guftan
  (`megum … megun`) is handled even though the TSV doesn't list it as irregular.
  Omadan fails the check and is never guessed.
- **Register.** Regular (conversational) forms are used by default (owner
  decision): "my mom" → `Onim`, not the Literal `Onayam`. A "you" sentence yields
  both `tu` (informal) and `shumo` (formal), and the English labels `(sing.)`,
  `(polite)` and `(pl.)` pick one.
- **Coverage:**
  - noun plural `-ho`;
  - possessives by stem class, ezafe, and the object marker `-a`/`-ya`;
  - classifier `-ta` (`hafta kitov`), cardinals (`bistu panj`) and ordinals
    (`darsi panjum`);
  - copula suffixes (`düxturam`);
  - compound verbs (`zindagi mekunam`);
  - nine tenses, negation, imperatives, questions and wh-phrases (`chand pul`).
- **Function words** come from the index, never from a hard-coded Buxori list.
  The legacy engine's hard-coded tables produced `charo` and `baroi ki`, which
  are not in the source; the TSV has `Chuva?` and `Azbaski`.

Linguistic choices, with their evidence and confidence, are in
[`docs/LINGUISTIC_DECISIONS.md`](../docs/LINGUISTIC_DECISIONS.md).

## Accuracy (reproducible)

`npm run eval` compiles an index **without** the 276 TSV rows of the frozen
test set (`eval/testset.json`, 270 items), then translates those items.
A prediction is correct if it equals any attested form for that English.

| engine | accuracy | precision (correct / answered) | answered | chrF (answered) |
|---|---|---|---|---|
| legacy `engine.js` (removed) | 4.1% | 8.7% | 126 / 270 | 0.331 |
| current | **13.7%** | **59.7%** | 62 / 270 | 0.709 |

Most of the test set is single words that appear nowhere else in the source
("dog", "teacher"). For those the correct behaviour is to abstain, so precision
is the trust number. `eval/thresholds.json` makes CI fail on any regression.

## Commands

```bash
npm ci
npm run compile     # TSV → src/data/buxori-index.json (byte-identical for the same input)
npm test            # vitest: data integrity, normalizer, lookup, engine, suggestions (≈470 tests)
npm run typecheck
npm run eval        # held-out accuracy; `npm run eval -- --check` enforces thresholds
npm run build       # React app → translator/app/
npm run e2e         # real-browser test of the site, served like GitHub Pages
npm run check       # all of the above, as CI runs it
```

After editing the TSV, run `npm run compile && npm run build` and commit the results.
CI (`.github/workflows/check.yml`) fails if the committed index or app differs
from a fresh build.

## Similar words (local language model)

When a sentence can't be translated because an English word isn't in the source,
the translator can suggest source words with a similar meaning. For example, for
"physician" it suggests `doctor → düxtur`, `medicine → Doru`, …. The user picks one,
the sentence is edited ("I am a doctor"), and that sentence is translated normally.
The pick keeps the word's form: "purchased" + buy → "bought".

- **Model.** [all-MiniLM-L6-v2](https://huggingface.co/Xenova/all-MiniLM-L6-v2)
  (Apache-2.0, int8 ONNX), run in the browser on WebAssembly with transformers.js.
  It works on phones and needs no WebGPU.
- **Opt-in, on the device.** Nothing loads until the user clicks *Suggest similar
  words*. The first use downloads about 30 MB, which the browser then caches:
  - transformers.js 4.3.1 and its WebAssembly runtime, from jsDelivr;
  - the model, pinned to one commit, from Hugging Face;
  - 0.8 MB of precomputed gloss vectors, from this site.
- **Privacy.** Nothing the user types is sent anywhere.
- **Grounded.** It can only point at English glosses that are in the index, and
  each suggestion shows the Buxori entry and that entry's other glosses.
  Suggestions are labelled *ai suggestion*, and a picked word is labelled *your pick*.

**Why it suggests instead of translating.** `node eval/suggestions.ts` measures it
(`eval/suggestions-report.json`):

| measurement | result |
|---|---|
| Held-out items the engine can't answer whose correct answer appears anywhere else in the book | 6 of 208 |
| Replacing each unknown word with the model's nearest gloss, automatically | 0 correct of 151 answered |
| Everyday words with a synonym in the book (52 hand-picked English pairs): synonym is the 1st suggestion | 33 / 52 |
| … the synonym is among the first 3 / 5 suggestions | 47 / 52, 50 / 52 |

The model's nearest word is often *related* but different: Saturday → Friday,
grandfather → grandmother, three → two, question → answer. Used automatically, it
would turn "no translation" into a confident wrong one. Shown as choices, the right
word is almost always on the list.

Other models were tried on the same held-out set and the same synonym pairs:
paraphrase-MiniLM-L3-v2, bge-small-en-v1.5, gte-small, potion-base-8M
(Model2Vec), and WordNet synonyms. All scored 0 correct when used automatically.
MiniLM-L6 gave the best suggestions (synonym in the top 5 for 49 of 52 pairs,
against 44–47 for the others) and is the smallest download.

The engine's results and the held-out accuracy are unchanged: suggestions never
replace or add a translation.

After the index changes, regenerate the vectors (a unit test fails until you do):

```bash
npm i --no-save @huggingface/transformers@4.3.1
node scripts/embed-glosses.ts
```

## Optional AI fallback

`translator/worker/` is a Cloudflare Worker that asks an LLM to translate,
grounded only on source examples sent by the browser. It is off by default. To
enable it, deploy the worker and set
`data-ai-endpoint="https://…"` on `<div id="translator-root">` in `index.html`.

- Verified (exact) results never call it.
- AI output is labelled "ai-assisted".
- The API key stays in the worker.

## Data notes

- **Rows not used:** 204 TSV rows are excluded with a recorded reason:
  - 180 exercises print no answer;
  - 13 are fill-in stubs;
  - 11 reading lines were never transcribed.
- **No English in the source:** 164 Buxori reading sentences are kept for
  Buxori-side search (`en: null`) and are never used as translation pairs.
- **REVIEW rows:** 9 rows carry the source's `REVIEW` flag. They stay, rank last,
  and are labelled in the UI.
