# Buxori reliability review — 2026-11-04

## Priorities and acceptance criteria

1. Preserve the TSV unchanged; never complete unanswered exercises or resolve linguistic conflicts by inference.
2. Fix translation regressions and provenance loss; require automated regression checks.
3. Add a source-backed React interface using the structured compiler output, lazy loading, explicit candidate labels, retryable loading errors and preserved portfolio assets.
4. Freeze evaluation inputs, publish machine-readable metrics, and verify all changes in GitHub Actions.
5. Complete the linguistic audit and migrate the remaining legacy runtime only after feature parity and independent translation evaluation.

Work is on `codex/buxori-reliability`, PR #2. This report distinguishes implemented work from linguistic verification and production deployment.

## Issue disposition

| # | Status | Evidence / remaining work |
|---|---|---|
| 1 | Source verification blocked | Preserve all nine REVIEW rows. Need scans of pp17,27–28,47,52,90 and/or attributable speaker evidence for stress, kinship inflections, shudan, 'amak and na-. No invented corrections. The old README's seven-review count is stale. |
| 2 | Preserved conflict; unresolved | Keep shav/shud with their source provenance. New React UI explicitly displays conflicts. Need Buxori present-tense attestations and original page comparison. |
| 3 | Unresolved linguistic distinction | Preserve xur versus xür. A different infinitive vowel is not proof that the present stem is a typo. Need source audio/paradigm evidence. |
| 4 | Source blocked | Keep 204 exclusions (180 unanswered exercises, 13 stubs, 11 untranscribed rows). Original source/answers and transcription permission needed; no answers synthesized. |
| 5 | Preserved | Keep 164 untranslated Buxori sentences. Corpus search displays English translation unavailable. Translation requires qualified source-backed review. |
| 6 | Partial | Existing compiler already inherits stems from linked auxiliaries in two passes. Derived stem now retains auxiliary source provenance. CI audit lists remaining missing stems; absent auxiliary lexemes cannot be guessed. |
| 7 | Unverified mapping isolated by warning | Hebrew spelling aids remain experimental, explicitly labelled in React UI. Need a Bukharian Hebrew orthographic source and transcribed recordings; no claim of authoritative transliteration. |
| 8 | Unverified mapping isolated by warning | Keep source spellings, warn that alternate romanization is experimental. Need explicit source conventions for ā, û and ġ. Stress-folding of TSV ġ is distinct from user-input ġ mapping. |
| 9 | Borrowed evidence remains borrowed | Do not promote -ra/-da to verified Buxori. Comparative Tajik sources are insufficient. Need full passage-level Buxori evidence for environment, register and meaning. |
| 10 | Implemented; regression tested | Bare plurals reach noun handling rather than fuzzy singular substitution. Duplicate exact singular surfaces are guarded. Existing source -ho rule retained; no new -o alternation asserted. |
| 11 | Safe abstention implemented | Plural possessives do not silently become singular. Explicit unsupported-form response instead of inventing stacked allomorphs. Accurate generation remains pending source verification. |
| 12 | Candidate UI implemented | Fuzzy/loose/skeleton results are explicitly spelling candidates, never verified translations of input. Candidate score is not a linguistic accuracy probability. |
| 13 | Partial | Compound preverb + auxiliary analysis and source-template continuous / participle+bud analysis added. Distinct ending analyses preserved. Full multiword tense coverage and attested-corpus regression validation remain open. |
| 14 | Corpus discovery implemented | Corpus search exposes sholüm occurrences with original sentence/page; does not invent a headword or copy a sentence-level gloss onto a token. |
| 15 | Implemented | Equivalent copula rules coalesced, preserving both statements, source references and examples. Integrity and deduplication regression tests check this. |
| 16 | Implemented in branch; deployment pending | React /translator/index.html uses structured TypeScript index and lookup API; portfolio links to it. Build packages portfolio assets and static routes. Source-only Pages hosting cannot execute TSX; publish built artifact before treating new page as live. |
| 17 | Incomplete migration | New UI uses TypeScript pipeline; legacy portfolio translator and held-out evaluation still use Python index. Not claiming a single runtime yet. Retiring legacy generation before equivalent tested coverage would remove existing functionality. |
| 18 | Implemented in new UI | Dynamic JSON import starts on first submitted search, not portfolio load. Index size is not reduced. |
| 19 | Implemented | SOURCE_DATE_EPOCH controls timestamp (default epoch); source path separators normalized. CI compiles twice and compares bytes. |
| 20 | Implemented | GitHub Actions runs npm ci, check, legacy tests, build, determinism and held-out evaluation; permissions read-only. |
| 21 | Baseline established | Fixed input Git blob pins prevent silent split/pair/index changes. Metrics include SHA256 hashes. 270-example baseline below; human semantic evaluation still needed. |
| 22 | Existing production checked; branch not deployed | Browser reached davidmilov.com and /translator. Reproduced brothers → Barodar with closest-match label. Portfolio and translator render. These observations concern old deployed code, not the branch changes. |

## Changes beyond the original checklist

- Prototype-safe cache fixes constructor / __proto__ lookups.
- Cache keys retain punctuation and capitalization because grammar interpretation uses both; question/statement contamination is regression tested.
- Unsupported English modals no longer generate a present-tense grammar assertion.
- IBM-1 alignment guesses removed from authoritative word-gloss fallback; alignment alone is not a verified bilingual dictionary.
- Build packaging now copies portfolio assets, research, AI route, 404 and CNAME. Vite's initial successful build had omitted static assets: build success alone was insufficient.
- CI audit artifact lists missing present stems, source conflicts, REVIEW references, untranslated examples and exclusions.

## Baseline v1

Frozen inputs are the committed splits.json, pairs.jsonl and index_train.json at main commit 9080434b7605ec25da8fe042da78373a0b77d268. Git blob IDs are pinned in tests/evaluation-inputs.test.ts. Engine baseline: 9b95b6bea7a57eb44dc5f05b2738d2552915b233, GitHub run 41840758586.

- Held-out examples: 270.
- Exact / fuzzy / compositional / grammar / none: 0 / 1 / 50 / 64 / 155.
- Abstention: 57.4%.
- Committed-answer exact-match precision: 0% (one answer; too small for a reliable estimate).
- Draft exact match: 8.8%; chrF: 0.234; BLEU4: 0.048.

This is retrieval generalization, not semantic accuracy or a production-quality claim. The old 295-example README baseline is not comparable. Grammar model extraction also requires a separate leakage audit: it uses TSV rows outside the parallel train split. Runtime and data hashes must accompany future comparisons.

## Linguistic sources and confidence

- [Endangered Language Alliance: Bukhori](https://www.elalliance.org/languages/bukhori), full page read 2026-11-04. High confidence for research landscape, dialect differences and source identification. Identifies Zarubin (1928), Gulkarov's four-language dictionary (1998), Rybakov's Easy Bukharian (2012), and native-speaker recordings. Does not verify any disputed suffix or spelling here.
- [Shinji Ido: Bukharan Tajik, JIPA](https://www.cambridge.org/core/journals/journal-of-the-international-phonetic-association/article/div-classtitlebukharan-tajikdiv/E909A0BEDE9E6F52A52FBB12A9255A6F), publisher page accessed. Comparative phonological background only; not evidence to substitute Muslim Bukharan Tajik forms for Jewish Buxori.
- Journal of Jewish Languages 5 (2017), pp81–103: publisher PDF access returned 403. No claim verified from unavailable full text.
- Repository TSV and its page/row references: authoritative for faithful source reproduction, not proof that every source form is linguistically correct. REVIEW flags and contradictions must survive compilation.

No disputed lexical form, exercise answer or missing sentence translation was changed. More research remains necessary; this is not a completed linguistic review of issues 1–9.

## Verification and deployment limits

All execution is on GitHub Actions, per instruction to work directly with GitHub. No repository was downloaded locally. The first reliability commit passed all checks. A later copula test correctly caught an insertion failure, which was corrected before the final validation run. See PR checks for final status and downloadable build/evaluation/audit artifacts.

The new React app is an additional source-backed dictionary and learning interface, not a complete replacement for arbitrary sentence translation. Browser smoke tests of that built interface and a final production deployment are still required. Do not merge on a claim that all 22 issues or production readiness are complete.
