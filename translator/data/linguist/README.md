# Worksheets for a Buxori speaker

These collect what the lesson book does not say. Fill in the columns in CAPITALS. Use
the book's Latin spelling (`ü`, and `'` for ayin, as in `so'at`). Everyday speech is the
target; note formal or written forms where they differ.

Open the `.tsv` files in Excel, Numbers or Google Sheets (tab-separated, UTF-8).

| # | File | What to do | Size | Why it matters |
|---|---|---|---|---|
| 1 | `../missing-words.tsv` | Fill the `bukhori` cell for common English words the book lacks. Verbs are listed as "to …": give the infinitive. Add `spoken_form` / `alt_forms` / `notes` if useful. Skip any you are unsure of. | 1,000 rows, most frequent first | Largest gain by far: most failed translations fail on a missing word. The first 300 rows are worth more than everything else here. |
| 2 | `2-word-choice.tsv` | For each English word with several Buxori words in the book, name the everyday default and say when the others are used. | 127 rows | The most common error in translated sentences is picking the wrong one. |
| 3 | `3-verb-forms.tsv` | Mark each built verb form right or wrong; correct the wrong ones. Do the rows marked `irregular` first. | 536 rows (about 250 irregular) | Only six verbs have printed tables. Everything else is built by rule and unconfirmed. |
| 4 | `4-judge-these.tsv` | Judge each output: right / acceptable / wrong, and give what you would say. | 111 sentences | Gives a real accuracy figure. Today's tests only credit an exact match to the book. |
| 5 | `5-everyday-phrases.tsv` | Give the Buxori for everyday phrases; confirm the ones the book already has. | 62 phrases | Fixed phrases cannot be built word by word ("Good evening" is `Ramsho tüvo!`). |
| 6 | `6-grammar-questions.md` | Answer 34 short questions, most with sentences to translate. | about 1 hour | Each one is a rule the book leaves open and the translator currently guesses or flags. |
| 7 | `../review-rows.tsv` | For each of the 9 rows the book's transcriber flagged, say which reading is right. | 9 rows | Confirmed rows go back into use. |
| 8 | `8-grammar-words.tsv` | Confirm, correct or supply pronouns, prepositions, conjunctions, question words, quantifiers, time words. | 341 words | Every sentence needs these, and the book has under half. |
| 9 | `9-topic-vocabulary.tsv` | Fill in words by topic (family, body, food, house, nature, religion, work, travel) that the book and worksheet 1 both lack. | 138 words | Fills the gaps a frequency list misses. |
| 10 | `10-sentences-by-construction.tsv` | Translate one or more sentences for each kind of sentence: tenses, negation, questions, clauses, passive, comparison. | 258 sentences | Shows the grammar of each construction; 151 cannot be translated at all today. |

Suggested order if time is short: 6, 8, 10, 3 (grammar, which applies to every sentence), then 2, 5, 9, 1 (words), then 4 and 7 (checking).

The same material is laid out as one printable document by the brief generator (a 67-page PDF with these spreadsheets attached inside it).

Nothing reads these files back automatically. Return them and the answers are checked,
entered into the data, and covered by tests. To regenerate worksheets 2–5 and 8–10 after the data
changes: `node scripts/linguist-worksheets.ts` (this overwrites them, so do it before
they are filled in, not after).

## Checked against the book: `answers-ai-draft-unverified.md`

That file is a set of answers to the grammar questions written from Tajik and Farsi, not
by a speaker. It is kept as candidates for a speaker to confirm. Nothing in it was
imported. Each claim was checked against the lesson book:

| Claim in the draft | What the book shows | Action |
|---|---|---|
| `qati` follows the bare noun, no ezafe (`tu qati`) | `shumo qati`, `jonam qati`, `Ki qati rafted?` | Fixed: "with you" gave `tuyi qati` |
| "never" is `hej` + negative verb | `Hej gham nabined!` | Fixed: "He never comes" dropped "never" |
| "in two days" is `ba'di du rüz`, not `ba` | `ba'di panj minut telefon mekunam` | Fixed |
| "on Saturday" is `rüzi shabot`, not `boli` | `rüzi yakshame`, `Imrüz rüzi shabot` | Fixed |
| "for ten years" has no preposition | `Panjo sol ü kalontari …` | Fixed |
| "there is", "what time is it", "how long", "what a …!" are calques | no printed pattern | Now declined with a reason, not built word by word |
| Names in the 1,000-word list | (list quality) | 32 names removed |
| `-ak` past is evidential; neutral past is bare | book calls `-ak` the Regular form | Book kept; question 26 |
| `-ani hastam` is "about to", not "want" | book prints `Man guftani hastam` = "I want to say" | Book kept; question 27 |
| `vayho` is "those" | book glosses it "these" | Book kept; question 28 |
| `garchande` is "although" | book glosses it "through; in spite of" | Book kept; question 29 |
| stems of gazidan, püshondan, shumurdan | book states `-gazid-`, `-püsh-`, `-shumur-` | Book kept; question 30 |
| "I am here" needs `-am` (`Man insunam`) | book has it only on nouns (`Man düxturam`) | Left flagged as unconfirmed; question 1 |
| `doshtan` takes no `me-` | book says the same | Already correct |
| new words and forms (`hej kas`, `mexoham`, `ravi`, `biyoyad`, `-emon`, …) | not in the book | Not imported; questions 8, 11, 23, 31–33 |
