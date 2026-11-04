# Linguistic decisions

Every place where the translator departs from a literal reading of
`translator/data/bukhori.tsv`, or chooses between conflicting statements in it,
is listed here with its evidence and a confidence level. The TSV itself is never
edited: decisions are applied by the compiler (`scripts/compile-tsv.ts`) or the
engine (`src/engine/`), and the original rows stay in the index with their flags.

**Confidence levels**

- **High**: the TSV's own examples and an external source agree.
- **Medium**: the TSV's own evidence is consistent, but there is no external confirmation, or the reverse.
- **Low**: a best reading that needs a native speaker or the printed book.

**Research limits.** This environment's network policy blocked page fetches
(Wikipedia, Wiktionary, Encyclopaedia Iranica, Omniglot, jewishlanguages.org).
External evidence below therefore comes from search-engine summaries of those
pages, not from reading them in full. Each such claim is marked *(search
summary)*. To verify them directly, allow those hosts in the environment's network settings.

---

## 1. Shudan: present stem `-shav-`, not `-shud-` (High)

- **Conflict.** p41 and p43 state `-shav-`; p47 (row 720, `REVIEW`) states `-shud-`.
- **TSV evidence.** `shud` is shudan's past stem (`shud`+`am` = "I became"). The same
  p47 prints the whole Regular present as `meshum, meshi, meshed, meshü, meshem,
  mesheton, meshun` (rows 702–708, negatives nearby), which contains no `-shud-`. Across the corpus
  the present appears 19 times as `meshü`/`meshüyam` and never as `meshud…`.
- **External.** Tajik шудан has present stem шав (šav) *(search summary: Wiktionary)*.
- **Applied.** `presentStem = shav`. The conflict is kept in `verb.conflicts` with
  `resolved = { value: 'shav', reason }`. Regular-register output uses the
  attested p47 table.

## 2. Irregular verbs in the Regular register (High, TSV-stated)

p47 states that raftan, shudan, omadan, daromadan and buromadan take
`-um -i -ed -ü -em -eton -un` in the Regular form. Raftan, shudan and omadan are
printed in full (`merum`, `meshü`, `mebiyom` …). The legacy engine produced the
literary `meravam`. The new engine uses attested tables first, so "I go" gives
`merum`. Daromadan and buromadan have no printed table, so they fall back to the
general rules with a note.

## 3. Xürdan present stem `-xur-` vs `-xür-` (Medium; source-internal variation)

- The TSV states `-xur-`. Present forms are printed `mexuram`, `mexuri`, `namexura`, `mexura`.
- p43 prints the negative imperative both ways: `naxür` (example) and `naxur` (grammar note).
- Tajik хӯрдан has present stem хӯр (xür) *(search summary: Wiktionary)*.
- **Applied.** Keep the stated `-xur-`, which matches every printed present form.
  `xür` is noted as an attested variant. Not resolvable further without the book.

## 4. Grandmother: `Bibet`, `Bibesh`, `Bibeton` (rows 27–28, `REVIEW`) (High)

- `bivi` with -v- appears in 25+ rows (`Bivim`, `bivet`, `bivesh`, `biveton`, `Biveshon`, `Bivijon`).
- The -b- spelling occurs only in these three rows.
- **Applied.** The rows are kept as attested but `REVIEW`-flagged variants. The
  engine ranks non-review forms first, so "your grandmother" gives `bivet`.
  (Tajik бибӣ has -b-, so the -b- forms are not impossible, just unsupported in this source.)

## 5. Present stems of compound-verb auxiliaries (High where attested)

- The TSV states no stem for nüshidan, kashidan, gardondan or rasondan, so 11 compound
  verbs (`Choy nüshidan`, `Surat kashidan`, `Rü gardondan` …) could not be conjugated.
- **Rule check against the TSV's own stated stems:**
  - `-idan` verbs: present stem = infinitive − `-idan` in **21 of 24** cases.
    The exceptions are didan → bin (suppletive), farmoyidan → farmo (glide), and
    gazidan → gazid (probably a source error).
  - `-ondan` causatives: − `-dan` in only **4 of 7**, which is not reliable.
- **Applied.**
  - A stem is `attested` when a conjugated form built on it is printed:
    - `menüsham`/`menüshet` (rows 1289, 1304);
    - `kashed`/`nakashet` (rows 1287, 2617, 2855);
    - `megardoned`/`nagardoned` (rows 3277, 3282);
    - `rasoned` (row 374).
  - Otherwise `-idan` verbs get a `derived` stem.
  - Otherwise there is no stem. Currently none are missing.

## 6. Past perfect negation (row 90, `REVIEW`) (High)

- The source's instruction says to put `na-` before `bud`.
- Every printed example (`nagufta budam` …) puts it on the participle.
- Persian negates the past perfect on the participle (نگفته بودم) *(search summary: UT Austin Persian resources)*, and Tajik grammars describe the same pattern.
- **Applied.** `na-` goes on the participle.

## 7. Stress marks: `baćha`, `kardí` (rows 17, `REVIEW`) (Medium; display only)

- The TSV states that nouns take final stress, the stress moves onto suffixes, and verbs take first-syllable stress.
- Tajik descriptions agree: finite verbs are stressed on the first syllable and
  nouns on the last *(search summary: Wikipedia, Tajik grammar)*.
- So `baćha` is most likely `bachá`, and `kardí` is most likely `kárdi`; the printed marks look like typesetting errors.
- **Applied.** None needed. Stress marks never affect lookup keys, and the engine
  does not print stress. Both rows stay flagged.

## 8. `'Amak`: uncle vs father-in-law (rows 52, `REVIEW`) (Medium)

- The TSV glosses `'Amak` as "father's brother", "husband's father" and "wife's father" (the last also giving `padar'arüs`).
- Tajik амак = paternal uncle *(search summary: Wiktionary; one aggregator says "maternal uncle")*.
- No source found for the father-in-law senses in Bukharian usage.
- **Applied.** All senses are kept. "uncle (father's brother)" → `'Amak`. For
  "father-in-law (wife's father)" the engine shows `'Amak` with `padar'arüs` as the
  alternative and the source's ambiguity note.
- **Needs** a native speaker.

## 9. Function words the legacy engine hard-coded (High)

The legacy grammar tables (`translator/scripts/preprocess.py`) contained Buxori
words that are not in the TSV:

| English | legacy output | TSV | action |
|---|---|---|---|
| why | `charo` (Tajik чаро) | `Chuva?` (row 840) | use TSV |
| because | `baroi ki` | `Azbaski` (row 1104) | use TSV |
| into | `ba` | no entry | not mapped |

The new engine takes every function word from the index, never from a table of Buxori strings.

## 10. Object marker and locative (owner decision 2) (Medium)

- **TSV-stated (Regular form):** the direct object takes `-a`, or `-ya` after a vowel; the Literal form writes `-ro`.
- **Borrowed `-ra` and locative `-da`:**
  - Windfuhr & Perry list colloquial `-ra`, `-a`, `-ya` *(search summary)*.
  - Encyclopaedia Iranica (Perry) describes `-ro` with colloquial `-a`/`-ya` *(search summary)*.
  - It also describes `da` (< `dar`) as a general locative in colloquial Tajik *(search summary)*.
- **Applied.** The stated `-a`/`-ya` are used. `-ra` and `-da` stay in the index as
  `borrowed` and are never preferred over stated forms (evidence precedence).

## 11. Plural and possessive together (Low)

- The TSV has one example: `Akahoyam` "my (older) brothers" (p62, a Literal-style reading text).
- It states no rule for stacking `-ho` with a possessive in the Regular form.
- **Applied.** The engine builds plural + possessive as `-ho` + `-yam…`, following
  `Akahoyam`, and labels the result low-confidence.

## 12. Romanization assumptions in the normalizer (High)

- Persian/Tajik `ā` ↔ Tajik `о`: Iranica gives Tajik kitob = Persian ketāb *(search summary)*.
- Hebrew script:
  - Ҳ ↔ ה is confirmed by Wikipedia's Bukharian alphabet table *(search summary)*.
  - ח, ך, כֿ, ו, י and final ה are mapped by their usual Judeo-Persian values. These are **not verified** against a Bukharian primer.
  - Hebrew input is therefore only used at the lowest ("skeleton") match tier and is always labelled.

## Blocked: needs the printed source or a speaker

- **204 excluded rows:**
  - 180 exercises print no answer;
  - 13 are fill-in stubs;
  - 11 reading lines were never transcribed.
  The translator does not invent answers to these.
- **164 Buxori reading sentences have no English** in the source. They are kept (`en: null`),
  searchable from the Buxori side, and never used as translation pairs.
