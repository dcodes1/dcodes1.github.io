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
JavaScript is 111 KB gzipped in six files (entry 69, engine 19, Buxori → English
14, the rest 9) and the content-hashed index is 191 KB gzipped (1.7 MB raw, under
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
- **Two clauses.** "X that Y", "If X, Y", "When X, Y" and "X because Y" are
  translated clause by clause and joined as the source joins them (`…, ki …`,
  `Agar …, …`, `Kay-ki …, …`, `…, azbaski …`). If one clause can't be built the
  result says which. Relative clauses ("the man who came …") are declined in this
  direction. Joined sentences are capped at medium confidence: none are in the
  held-out set.
- **"To be" with a place.** "He is here" → `Ü insun`; the past is never dropped
  ("He was at home" → `Ü ba xona budak`). "I am / you are" + place has no printed
  example and is flagged.
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

7. **Several clauses.** `Agar X, Y`, `Kay-ki X, Y` / `Vaqte ki X, Y`, `X, ki Y`,
   `X, azbaski / amo / lekin Y` are rendered clause by clause. A noun with `-e`
   before `ki` opens a defining clause: `Marde, ki omad, padari man` → "The man who
   came is my father."

A word with several senses shows first the one the book's examples use for the
bare word (`xona`: "house", not "room"); only three words have enough examples to
decide. Adjectives are recognised by their English gloss
(`scripts/data/english-adjectives.txt`, built from WordNet), since the book labels
few of them.

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
| current | **13.7%** | **61.7%** | 60 / 270 | 0.729 |

English → Buxori by tier (strict: the output must equal a form the book gives for that English):

| tier | correct / answered | precision |
|---|---|---|
| built, high | 31 / 35 | 89% |
| built, medium | 4 / 5 | 80% |
| built, low (shown as a draft) | 1 / 11 | 9% |
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
| built, high | 32 / 43 | 74% |
| built, medium | 3 / 9 | 33% |
| built, low (shown as a draft) | 0 / 8 | 0% |
| all answered | 37 / 67 | 55% (chrF 0.68) |

Strict matching undercounts this direction: "He/she has gone." against the
book's "He/she has gone/been", "Their dad" against "Their father", and "I'm glad
that I saw you" against "I'm glad to see you" all count as wrong. Read the 74% as
a floor for the high tier. 203 of the 270 items get no English at all, almost
all of them single words that exist nowhere else in the book.

Most of the test set is single words that appear nowhere else in the source
("dog", "teacher"). For those the correct behaviour is to abstain, so precision
is the trust number. `eval/thresholds.json` makes CI fail on any regression.

## Commands

```bash
npm ci
npm run compile     # TSV → src/data/buxori-index.json (byte-identical for the same input)
npm run import:draft  # ai-draft/buxori_dataset.jsonl → ai-draft.tsv (then `npm run compile` writes buxori-draft.json)
npm test            # vitest: data integrity, normalizer, lookup, both engines, suggestions, the fallback rules, the transducer
npm run typecheck
npm run eval        # held-out accuracy and per-tier precision; `-- --check` enforces thresholds
npm run eval:reverse  # the same set, Buxori → English
npm run eval:draft  # AI draft compared with the book, where both answer
npm run sweep:family  # family-event sentences, grammar consistency; `-- --check` enforces the baseline
npm run build       # React app → translator/app/
npm run e2e         # real-browser test of the site, served like GitHub Pages
npm run check       # all of the above, as CI runs it
```

After editing the TSV, run `npm run compile && npm run build` and commit the results.
CI (`.github/workflows/check.yml`) fails if the committed index or app differs
from a fresh build.

## Adding vocabulary the book lacks

The ceiling on quality is vocabulary: about 1,650 words. `translator/data/missing-words.tsv`
lists the 1,000 most frequent everyday English words the lexicon has nothing for,
in the same 11 columns as `bukhori.tsv`, with the `bukhori` cell empty.

1. Fill in the `bukhori` cell of any rows (and `spoken_form`, `alt_forms`,
   `notes` if you have them). Verbs are listed as "to …": give the infinitive.
2. Run `npm run compile && npm run build` and commit.

Only filled rows are read. They are numbered from 100001, their lesson reads
"Additions (not from the lesson book)", and the translator says so when it uses
one, so they can never pass as the book's own entries. To regenerate the list
(filled cells are kept):

```bash
node scripts/missing-words.ts --freq words.txt --wordnet node_modules/wordnet-db/dict
```

## AI draft layer (Tajik fallback, unverified)

`translator/data/ai-draft/buxori_dataset.jsonl` is the linguist worksheets filled in by
an AI working from Tajik and Farsi. Every row is marked
`ai_draft_tajik_derived_unverified`: it is **not** the lesson book and **no speaker has
confirmed it**. It is used so that a learner gets a labelled guess instead of nothing.

| Tier | Source | Label | Used for |
|---|---|---|---|
| 1 | the lesson book | verified / built, with its own confidence | everything the book prints or can build; **all grammar and every grammar word** |
| 2 | fallback, single content words | "Tajik fallback · adapted", low | a noun, adjective or verb the book lacks, inflected with the book's affixes |
| 3 | fallback, whole sentences and phrases | "AI draft · unverified", low | a sentence the book can neither print nor build |

Rules, held by `tests/draft.test.ts` and `tests/transducer.test.ts`:

1. **The book always wins.** Both engines ask the book-only index first. Whatever the book
   prints or can build is returned exactly as it would be without the fallback.
2. **Closed-class lock.** Pronouns, prepositions, conjunctions, numerals and particles
   are never imported from the fallback (352 rows locked out).
3. **Fallback results are labelled and capped** at the low tier, and each fallback word
   is tagged in the word-by-word panel.
4. **Fallback sentences are never evidence.** They are not "similar sentences in the
   source" and do not feed sense choice or frequency.

### The transducer (`src/transducer/tajikToBuxori.ts`)

Rewrites Literary Tajik forms as the book's Buxori. Every rule must be one the book
states or prints; the tests re-check that evidence against the index.

| Rule | Evidence in the book | Status |
|---|---|---|
| object marker `-ro` → `-a` / `-ya`, inside a sentence, on a known noun | affix table: `-a`, `-ya` Regular; `-ro` Literal | applied |
| `onho` / `eshon` → `inho` | "they" is `inho` (41 sentences); the others are never printed | applied |
| spelling `ū` → `ü`, `ī` → `i` | the book's alphabet | applied |
| literary progressive `… istoda-` | the book's Regular progressive is `-sod-`; `istoda` is Literal | row refused, not converted |
| copula `-ast` → `-ay` / `-as` | the book prints neither | **rejected** |
| 3pl `-and` → `-an` | the book's Regular 3pl is `-and` (71 sentences) | **rejected** |
| cluster drop `düst` → `düs`, `baland` → `balan` | the book prints `düst`, `rost`, `baland` only | **rejected** |
| vowel-shift retries | no such rule in the book | **rejected** |

On the current data the transducer changes **0 rows**: the draft was already written
in the book's spelling and uses none of these Literary forms. It is a guard for future
imports, not a source of accuracy today.

### Pipeline (the book's index is not touched; its checksum is unchanged)

```
ai-draft/buxori_dataset.jsonl ──► scripts/import-ai-draft.ts ──► translator/data/ai-draft.tsv   (985 rows)
ai-draft.tsv ──► scripts/compile-tsv.ts --draft ──► src/data/buxori-draft.json                 (685 words, 205 sentences)
```

Fallback rows are numbered from 200001. The app loads `buxori-draft.json` as a separate
file and merges it with `withDraft()` (`src/lib/draft.ts`); if that file fails to load,
the translator is the lesson book alone.

**Imported:** worksheet parts 3 (sentences by construction), 6 (everyday phrases),
7 (vocabulary by topic) and 8 (common words missing from the book), rated high or medium.
**Not imported:** grammar words (352, locked), rows the draft rated low (409),
explanations that are not forms (53), duplicates, and parts 1, 4, 5, 9, 10, 11 (815
rows that would change or overrule the book and need a speaker).

**How good is it?** Unknown for the words that are imported: they are exactly the words
the book lacks, so there is nothing to compare them with. `npm run eval:draft`
(`eval/draft-report.json`) compares the draft with the book where both answer: 142 / 147
on rows the draft rated high (mostly where it was shown the book's form) and 31 / 53 on
medium grammar words, which is why grammar words are locked out.

`ai-draft/buxori_train_pairs.jsonl` is the same content as chat-format pairs for
fine-tuning a language model. Nothing here uses it: this translator is rule-based and
runs in the browser with no model to train.

To remove the layer: delete `src/data/buxori-draft.json` and rebuild.

## Family-event sentence sweep

`npm run sweep:family` builds about 1,800 sentences of the kind said at a family
gathering (who came, who is eating what, greetings, questions, requests) from the
vocabulary the translator has, translates each, and checks that the grammar holds:
verb last, verb ending agrees with the subject, tense and negation as asked, the answer
reads back to the same content, fallback answers labelled and low, same answer twice.

It checks consistency with the book's rules. It cannot say a sentence is what a speaker
would say, so it also writes `translator/data/linguist/11-family-event-sentences.tsv`
for a speaker to mark, and lists the family-event words the book lacks
(`eval/family-report.json`). `-- --check` enforces `eval/family-baseline.json`, a
ratchet that CI runs on every push. `--seed N` samples other sentences from the same
frames. The `bukhori-sentence-tester` agent (`.claude/agents/`) runs it, extends it and
triages what it finds.

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

## Similar spellings (offline)

When a sentence can't be translated because an English word isn't in the book, the
translator offers the book's words spelled most like it ("docter" → `doctor → düxtur`).
The user picks one, the sentence is edited, and that sentence is translated normally.
The pick keeps the word's form: "purchased" + buy → "bought".

It is plain edit distance over the book's own English glosses
(`src/search/offlineSimilarWords.ts`): one letter may differ in words up to 4 letters,
two up to 9, three beyond. Nothing is downloaded and nothing leaves the page.

This replaced an opt-in language model (all-MiniLM-L6-v2) that was fetched from
jsDelivr and Hugging Face, removed so that the translator uses no external service at
all. The trade-off is real: the model could point from "physician" to "doctor";
spelling cannot. Words with no similarly spelled book word get no offer.

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
  section title ("family" → `Mishpoho`, "food" → `Axilo`, "body" → `Badan`,
  "music" → `Musiqa`). Each is the heading printed with its Buxori word: real
  vocabulary, not a header without a translation. They are kept; excluding them
  would remove "family", "food", "body" and nine more words from the dictionary. The 106 grammar rows with the same property hold rules, not words,
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
  versus future are decided by simple rules. Passives, and clauses joined without
  a comma, are not re-ordered; they fall back to the word-by-word gloss.
- **Parts of speech.** The book tags few words as adjectives, so the English gloss
  decides "is good" versus "is a doctor". A word glossed with an English word that
  is both noun and adjective can be tagged wrongly.
- **"If" clauses.** After `agar` the book prints both a plain present and a form
  without `me-`, and states no rule. English → Buxori uses the plain present and
  flags it; Buxori → English does not recognise the form without `me-`.
- **Names at the start of a clause** ("If David comes, …") are not recognised as
  names in English → Buxori.
- **Spurious analyses.** A word the source lacks can look like a known stem plus a
  suffix. The panel shows the analysis, so it can be checked, but it can be wrong.
- **Confidence thresholds** were set on the 270 items they are reported on.
- **Hebrew script.** No Hebrew output; Hebrew input is not translated.
