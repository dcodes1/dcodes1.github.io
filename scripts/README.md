# Buxori data pipeline

[`compile-tsv.ts`](compile-tsv.ts) compiles `translator/data/bukhori.tsv` into
`src/data/buxori-index.json`, a structured index shaped by
[`src/lib/types.ts`](../src/lib/types.ts):

- **`roots`**: lemmas with typed forms, verb stems (present / past / literary),
  compound-verb structure, noun stem class; looked up by normalized Buxori
  (`byKey`), English sense (`byGloss`) and stem (`byStem`). Inflected headwords
  (`onayam`, `Padaraton`) are kept separately with their affix analysis.
- **`affixes`**: prefixes, suffixes and enclitics with allomorphs and their
  conditions (after consonant / vowel / stem ends in …), register, and the
  printed paradigms.
- **`syntaxRules`**: all 106 grammar rows, classified (word order, verb forms,
  compound verbs, noun phrases, copula, adpositions, constructions, phonology),
  with formal templates where the rule is precise enough.
- **`examples`**: the sentence corpus, including Buxori-only text (`en: null`).
- **`excluded`**: every row not used, with the reason.

Every item records its TSV rows and an **evidence** level:

| evidence | meaning |
|---|---|
| `stated` | written in the TSV as a rule or value |
| `attested` | seen in example sentences but never stated (e.g. `-ba`) |
| `derived` | from applying a stated rule (e.g. past stem = infinitive − `-an`) |
| `borrowed` | not in the TSV; colloquial Tajik, with citations (`-ra`, locative `-da`) |

The engine should prefer forms in that order and use the **Regular**
(conversational) register (`index.policy`).

## Normalizer

[`src/lib/normalizer.ts`](../src/lib/normalizer.ts) turns any spelling into the
TSV's own Latin key, so the compiler (building keys) and the app (reading what
people type) can never disagree:

| input | key |
|---|---|
| Cyrillic `Ҳаво`, `Ҷумъа`, `Писҳо` | `havo`, `jum'a`, `pis'ho` |
| variant Latin `Khudo`, `čoy`, `šir`, `ǧum‘a`, `Sholūm` | `xudo`, `choy`, `shir`, `jum'a`, `sholüm` |
| Hebrew script `ג׳ומעה` | `jum'a` (lossy; unvowelled words fall to the skeleton tier) |

[`src/lib/lookup.ts`](../src/lib/lookup.ts) tries the canonical key, then three
fallback tiers (fuzzy: no diacritics; loose: o/u and e/i merged; skeleton:
consonants only), and always reports which tier matched. `toCyrillic()` converts
back; it round-trips every TSV key exactly.

## Usage

From the repository root (Node ≥ 22.18 runs the TypeScript directly):

```bash
npm install
npm run compile      # build src/data/buxori-index.json
npm test             # vitest: integrity (every TSV row accounted for), normalizer, lookups
npm run typecheck    # strict tsc
npm run check        # all three
```

Re-run `npm run check` after editing the TSV. The reader is strict: a changed
header, a row with the wrong number of columns, or an unknown `entry_type`/`flag`
stops the build with the row number.

The live site does not use this index yet: it still serves
`translator/engine.js` with `translator/data/index.json`, built by
`translator/scripts/preprocess.py`.
