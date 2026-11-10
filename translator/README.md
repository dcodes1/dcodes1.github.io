# Buxori translator

An English ⇄ Buxori (Bukharian, Judeo-Tajik) translator and learning tool,
served at [davidmilov.com/translator](https://davidmilov.com/translator). It
runs entirely in the browser and works offline after the first visit.
Everything it outputs comes from one source, a 3,519-row transcription of a
Bukharian lesson book (`translator/data/bukhori.tsv`). The output is either a
printed entry, or source words combined by the grammar rules that same book
states. It never invents vocabulary. Words it cannot source are reported, every
result carries a confidence level, and each one is shown word by word (root,
affixes, gloss) with TSV line numbers.

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
        │  src/engine/reverse.ts     Buxori → English: tokenizer, analyser, re-ordering (below)
        │  src/ai/similar.ts         optional in-browser model: similar source words for unknown English
        ▼
src/app/ (React)  ──vite build──▶  translator/app/   committed; loaded by index.html on first visit
sw.js                                offline cache for the site and the translator
```

GitHub Pages serves the repository as-is, so the built app is committed. The
portfolio (`index.html`) only downloads it when `/translator` is opened. The
JavaScript is 107 KB gzipped in six files (entry 69, engine 18, Buxori → English
12, the rest 8) and the content-hashed index is 191 KB gzipped (1.7 MB raw, under
the 2 MB point where it would need splitting). On a desktop the translator is
ready about 0.25 s after it is opened, and about 0.8 s with the CPU slowed 4× to
stand in for a mid-range phone. A translation takes a few milliseconds; the first
one can take up to 0.4 s (1.8 s slowed) if it is requested before the verb table
has finished building in the background. The optional similar-words model (below)
loads only on request.

## The engine (`src/engine/`)

The layers are tried in order, and the first that succeeds wins. The UI labels the result with that layer:

| status | meaning |
|---|---|
| `exact` (**verified**) | the English is an entry, inflected headword or example sentence in the TSV |
| `grammar` (**built from rules**) | assembled from TSV words with TSV-stated rules; every step is cited |
| `fuzzy` (**closest match**) | spelling corrected (swapped or doubled letters only) or a near-identical entry |
| low confidence (any built result) | shown as a **draft, not a translation**, with the word-by-word panel; nothing to copy |
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

## Buxori → English (`src/engine/reverse.ts`)

1. **Printed first.** A sentence, phrase, proverb or entry the book prints is
   returned as printed (`verified`), ignoring case, spacing and final punctuation.
2. **Tokenizer.** Longest unit first: compound verbs (`zindagi mekunam`),
   two-word tenses (`gufta budam`, `rafta istodayem`), multi-word entries and
   short printed phrases are one token. Punctuation and quotes are split off.
3. **Analyser.** Each word resolves to root + affixes:
   - verbs through the generator run backwards: every verb is conjugated in
     every tense, person, polarity and register once (about 54,000 forms, 0.3 s)
     and indexed, so the analyser recognises exactly what English → Buxori can
     build, plus every form in the book's own tables;
   - nouns and adjectives by stripping the affix table's allomorphs, outermost
     first (plural, possessive, ezafe, object marker, `-ba`, "to be" endings),
     restoring a final vowel the Regular form drops (`xonim` = `xona` + `-im`).
4. **Reading choice.** One reading per word from its position: the verb comes
   last, ezafe needs a following word, "to be" closes a clause with no verb, and
   a pronoun wins over a noun spelled the same way. The other readings stay
   available in the panel.
5. **English.** Subject, verb, object, then place and time; the verb is
   conjugated in English from the Buxori tense and person; questions put the
   question word first with do-support; articles are added where the grammar
   decides them (object marker → "the", bare singular count noun → "a").
6. **Never invented.** A word that is not in the source stops the sentence: the
   result is the word-by-word gloss with that word marked. Spellings that differ
   only by accents or apostrophes (`duxtur`) are accepted and flagged. Looser
   matches are listed as "similar spellings" and never used.

Present and future are one form in Buxori; the rendering uses the present and
says so. Input may be Latin or Cyrillic. Hebrew-script input is not translated.

## Confidence

Every result has a score from 0 to 1 and a tier. Printed results are 1. For
built results the score is driven by word choice, because that is where the
held-out errors are (the forms themselves are rarely wrong):

    (0.8 + 0.2 × form confidence) × 0.7 for each content word after the first
        × 0.75 for each word the source has several translations for
        × 0.5 for one inflected word alone, or a clause inside a clause
        × 0.75 for a form resting on one printed example

| tier | score | shown as |
|---|---|---|
| high | ≥ 0.80 | the translation |
| medium | 0.55 – 0.79 | the translation, with "likely right, but check it" |
| low | < 0.55 | a draft with the word-by-word panel; not offered as a translation |

**Why 0.55 and 0.80.** They sit in the gaps between three groups the held-out
set separates: one sourced word with regular inflection (0.9 and up), two
content words or one ambiguous one (0.6 to 0.75), and anything longer (0.5 and
below). The thresholds were chosen on the same 270 items they are reported on,
and the medium tier has five items, so treat its number as indicative only.
`eval/thresholds.json` makes CI fail if rule-built high-tier precision drops
below 85% or the low tier rises above 30%.

## Accuracy (reproducible)

`npm run eval` compiles an index **without** the 276 TSV rows of the frozen
test set (`eval/testset.json`, 270 items), then translates those items.
A prediction is correct if it equals any attested form for that English.

| engine | accuracy | precision (correct / answered) | answered | chrF (answered) |
|---|---|---|---|---|
| legacy `engine.js` (removed) | 4.1% | 8.7% | 126 / 270 | 0.331 |
| before confidence tiers | 13.7% | 59.7% | 62 / 270 | 0.709 |
| current | **13.7%** | **60.7%** | 61 / 270 | 0.721 |

English → Buxori by tier (strict: the output must equal a form the book gives for that English):

| tier | correct / answered | precision |
|---|---|---|
| built, high | 31 / 35 | 89% |
| built, medium | 4 / 5 | 80% |
| built, low (shown as a draft) | 1 / 12 | 8% |
| built answers shown as translations (high + medium) | 35 / 40 | **87.5%** |
| printed | 1 / 9 | 11% (see below) |

"Printed" is low here by construction: the row being tested is hidden, so what
the engine finds is another entry the book prints for the same English ("near" →
`Peshi`, where the hidden row says `Yon`). Those are the book's own words, not
errors, but they do not match the hidden answer. On the live site a printed
answer is the book's entry for exactly what was typed.

Buxori → English on the same set (`npm run eval:reverse`), strict wording match:

| | correct / answered | precision |
|---|---|---|
| built, high | 32 / 44 | 73% |
| built, medium | 3 / 8 | 38% |
| built, low (shown as a draft) | 0 / 8 | 0% |
| all answered | 37 / 67 | 55% (chrF 0.68) |

Strict matching undercounts this direction: "He/she has gone." against the
book's "He/she has gone/been", "Their dad" against "Their father", and "I'm glad
that I saw you" against "I'm glad to see you" all count as wrong. Read the 73% as
a floor for the high tier. 203 of the 270 items get no English at all, almost
all of them single words that exist nowhere else in the book.

Most of the test set is single words that appear nowhere else in the source
("dog", "teacher"). For those the correct behaviour is to abstain, so precision
is the trust number. `eval/thresholds.json` makes CI fail on any regression.

## Commands

```bash
npm ci
npm run compile     # TSV → src/data/buxori-index.json (byte-identical for the same input)
npm test            # vitest: data integrity, normalizer, lookup, both engines, suggestions (574 tests)
npm run typecheck
npm run eval        # held-out accuracy and per-tier precision; `-- --check` enforces thresholds
npm run eval:reverse  # the same set, Buxori → English
npm run build       # React app → translator/app/
npm run e2e         # real-browser test of the site, served like GitHub Pages
npm run check       # all of the above, as CI runs it
```

After editing the TSV, run `npm run compile && npm run build` and commit the results
(and regenerate the gloss vectors, see "Similar words").
CI (`.github/workflows/check.yml`) fails if the committed index or app differs
from a fresh build.

## Adding vocabulary the book lacks

The ceiling on quality is vocabulary: about 1,650 words. `translator/data/missing-words.tsv`
lists the 1,000 most frequent everyday English words the lexicon has nothing for,
in the same 11 columns as `bukhori.tsv`, with the `bukhori` cell empty.

1. Fill in the `bukhori` cell of any rows (and `spoken_form`, `alt_forms`,
   `notes` if you have them). Verbs are listed as "to …": give the infinitive.
2. Run `npm run compile && npm run build`, regenerate the gloss vectors, and commit.

Only filled rows are read. They are numbered from 100001, their lesson reads
"Additions (not from the lesson book)", and the translator says so when it uses
one, so they can never pass as the book's own entries. To regenerate the list
(filled cells are kept):

```bash
node scripts/missing-words.ts --freq words.txt --wordnet node_modules/wordnet-db/dict
```

## Offline

`sw.js` caches the page and the translator (JavaScript and the index, about
300 KB gzipped) the first time any page of the site is opened, so the translator
then works with no connection, in both directions. Hashed files are served from
the cache; everything else is fetched fresh when online. The similar-words model
is not part of the offline cache.

## Embedding it elsewhere

The translator is a self-contained ES module. On another page of this site:

```html
<link rel="stylesheet" href="/assets/site.css">
<div id="translator-root"></div>
<script type="module" src="/translator/app/translator.js"></script>
```

It mounts into `#translator-root` and fetches its own data. On a different
domain, copy `translator/app/` and the `.tr-*` rules of `assets/site.css`, and
set `base` in `vite.config.ts` to the folder you serve it from before building.

## Output scripts

Buxori is shown in Latin (the source's spelling) or Cyrillic (a transliteration).
Hebrew output is deliberately absent: its spelling could not be checked against
anything in the source. `src/lib/normalizer.ts` has the hook
(`registerOutputScript('hebrew', …)`) for when verified Hebrew-script data exists.

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

- **Rows not used:** 221 TSV rows are excluded with a recorded reason:
  - 180 exercises print no answer;
  - 13 are fill-in stubs;
  - 11 reading lines were never transcribed;
  - 9 carry the source's `REVIEW` flag (below);
  - 8 repeat an earlier example row word for word.
- **Duplicates:** a word the book teaches several times is one entry that cites
  every row; a repeated example sentence is kept once.
- **No English in the source:** 164 Buxori reading sentences are kept for
  Buxori-side search (`en: null`) and are never used as translation pairs.
- **REVIEW rows:** the 9 rows the source flags `REVIEW` are used nowhere. They are
  listed in `translator/data/review-rows.tsv` (written by the compiler) for manual
  checking; remove the flag in the TSV to bring a row back.
- **Section-title words:** 12 vocabulary rows have an English cell equal to their
  section title ("family" → `Mishpoho`, "food" → `Axilo`). They are real entries
  and are kept. The 106 grammar rows with the same property hold rules, not words,
  and were never in the lexicon.
- **Exercises:** 98 exercise sentences have Buxori but no English, so they cannot
  serve as expected answers. They are used as a robustness test for Buxori →
  English (all analysed, at least 85% of their words recognised).

## Known limitations

- **Vocabulary.** About 1,650 words. Most everyday words are missing, and no
  method can supply them from this book.
- **Long sentences.** Anything with three or more content words lands in the low
  tier in both directions. That is the measured reliability, not caution.
- **Buxori → English is a rough rendering.** English articles, the choice among
  an entry's senses (`xona`: room or house), `ba` (to / in / at) and present
  versus future are decided by simple rules. Relative clauses, passives and
  conditionals are not re-ordered; they fall back to the word-by-word gloss.
- **Parts of speech.** The book tags few words as adjectives, so a list of common
  English adjectives decides "is good" versus "is a doctor". A rare adjective can
  get an article.
- **Spurious analyses.** A word the source lacks can look like a known stem plus a
  suffix. The panel shows the analysis, so it can be checked, but it can be wrong.
- **Confidence thresholds** were set on the 270 items they are reported on.
- **Hebrew script.** No Hebrew output; Hebrew input is not translated.
