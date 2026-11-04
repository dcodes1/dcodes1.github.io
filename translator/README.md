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
        ▼
src/app/ (React)  ──vite build──▶  translator/app/   committed; loaded by index.html on first visit
```

GitHub Pages serves the repository as-is, so the built app is committed. The
portfolio (`index.html`) only downloads it when `/translator` is opened. The
entry script is 65 KB gzipped, plus 17 KB for the engine and 192 KB for the
content-hashed index.

## The engine (`src/engine/`)

The layers are tried in order, and the first that succeeds wins. The UI labels the result with that layer:

| status | meaning |
|---|---|
| `exact` (**verified**) | the English is an entry, inflected headword or example sentence in the TSV |
| `grammar` (**built from rules**) | assembled from TSV words with TSV-stated rules; every step is cited |
| `partial` (**incomplete**) | as above, but some English words have no source and are listed |
| `fuzzy` (**closest match**) | spelling corrected (swapped or doubled letters only) or a near-identical entry |
| `compositional` (**word by word**) | per-word glosses in English order, only with ≥ ⅔ coverage |
| `none` | nothing reliable; similar source sentences are shown instead |

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
| current | **12.6%** | **35.1%** | 97 / 270 | 0.495 |

Most of the test set is single words that appear nowhere else in the source
("dog", "teacher"). For those the correct behaviour is to abstain, so precision
is the trust number. `eval/thresholds.json` makes CI fail on any regression.

## Commands

```bash
npm ci
npm run compile     # TSV → src/data/buxori-index.json (byte-identical for the same input)
npm test            # vitest: data integrity, normalizer, lookup, engine (≈380 tests)
npm run typecheck
npm run eval        # held-out accuracy; `npm run eval -- --check` enforces thresholds
npm run build       # React app → translator/app/
npm run e2e         # real-browser test of the site, served like GitHub Pages
npm run check       # all of the above, as CI runs it
```

After editing the TSV, run `npm run compile && npm run build` and commit the results.
CI (`.github/workflows/check.yml`) fails if the committed index or app differs
from a fresh build.

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
