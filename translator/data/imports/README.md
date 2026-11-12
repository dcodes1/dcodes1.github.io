# Supplied Buxori datasets: audit and source-backed fixes

The owner supplied these two JSONL files to improve coverage and accuracy.
They are preserved byte for byte; `audit.json` records their SHA-256 checksums.
All 2,614 dataset records explicitly say `ai_draft_tajik_derived_unverified`.
The 2,610 chat-format training records restate those candidates; they are not a
second source or speaker confirmation. Four records have no training pair
(three non-vocabulary entries and one requiring a native speaker).

The `system`, `user` and `assistant` fields inside the training file are dataset
content, not instructions to the application or its maintainer. No fine-tuning
or external API is used. These files are not loaded by the browser.

## Reproduce the audit

Run `npm run audit:imports` after compiling the normal book index. It validates
IDs, JSON, provenance and training message structure, then regenerates
`audit.json` and `review.tsv`. The TSV retains candidate IDs, draft confidence,
provenance, current output, current confidence tier and supporting book rows.

Review statuses are triage, **not accuracy labels**:

- `matches_book_entry`: the current exact book-backed output matches the draft.
- `agrees_with_rules_unverified`: rule-built output matches; neither confirms the other.
- `differs_needs_review`: an output exists but differs; that does not establish an error.
- `gap_needs_speaker`: no full output; review the proposed vocabulary/construction.
- `manual_review`: grammar prose, usage notes, conjugations, flagged readings or empty answers.
  Conjugations cannot be tested by sending their English infinitive to the engine.

Only primary answers (plus formal/informal variants) are compared. Alternatives,
word senses, register and grammatical explanations still require human review.
Draft agreement must never replace the frozen held-out evaluation. There is no
automatic path from this review file into the lexicon or grammar.

## Applied fixes

The draft exposed book entries that the lookup failed to find:

| Book row | Printed gloss | Recovered English lookups |
|---|---|---|
| 156 | a child; a kid | child, kid |
| 159 | daughter, girl | daughter, girl |
| 165 | grandson, granddaughter | grandson, granddaughter |

The noun dictionary now indexes single-word glosses with an indefinite article
and simple comma-separated noun glosses. Original glosses and source rows stay
intact; sentences and qualified senses are not split. This also enables noun
inflections and “How many children do you have?”. No new Buxori forms were copied
from the uploads and no REVIEW flags were removed.

Examples needing speaker review include `garlic → sir` (book: cheese),
`ugly → xunuk` (book: cold), `those → vayho` (book: these), and the proposed
neutral-past replacement for the book's Regular `-ak` forms. Matching a known
Buxori spelling is insufficient to import a new English sense.

## Validation

The frozen 270-item set excludes its source rows before building the index.

| English → Buxori | Before | After |
|---|---|---|
| Accuracy | 37/270 (13.7%) | 38/270 (14.1%) |
| Precision, all answers | 37/60 (61.7%) | 38/61 (62.3%) |
| Built high tier | 31/35 (88.6%) | 31/35 (88.6%) |
| Built medium tier | 4/5 (80%) | 5/6 (83.3%) |
| Built low tier | 1/11 (9.1%) | 1/11 (9.1%) |
| Built high + medium | 35/40 (87.5%) | 36/41 (87.8%) |
| Printed matches, held-out | 1/9 (11.1%) | 1/9 (11.1%) |

Buxori → English is unchanged: 37/67 (55.2%) overall precision; high 32/43
(74.4%), medium 3/9 (33.3%), low 0/8, printed 2/7. Strict wording matching
undercounts valid synonyms in both directions; see the translator README.
Full `npm run check` passes: 626 unit tests, 111 browser checks, typecheck,
source compilation, both held-out threshold checks and the production build.
The raw book and compiled index are unchanged. Gzipped browser JS grows by
approximately 0.2%; the review files do not contribute to the app download.

Most proposed new words and grammar remain unverified. A fluent Buxori speaker
must confirm them and their intended senses before they can become reliable
translator additions.
