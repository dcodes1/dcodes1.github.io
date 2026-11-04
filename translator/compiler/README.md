# Buxori index compiler

Compiles `translator/data/bukhori.tsv` into `translator/data/buxori-index.json`,
a structured index shaped by [`types.ts`](types.ts):

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

## Usage

```bash
cd translator/compiler
npm install          # TypeScript + Node types, for type-checking only
node compile.ts      # build translator/data/buxori-index.json  (Node ≥ 22.18)
node test.ts         # 234 checks, incl. "every TSV row accounted for"
npx tsc -p .         # strict type-check
```

Re-run `node compile.ts && node test.ts` after editing the TSV. The reader is
strict: a changed header, a row with the wrong number of columns, or an
unknown `entry_type`/`flag` stops the build with the row number.
