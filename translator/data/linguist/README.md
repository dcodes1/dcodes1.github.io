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
| 6 | `6-grammar-questions.md` | Answer 25 short questions, most with sentences to translate. | about 1 hour | Each one is a rule the book leaves open and the translator currently guesses or flags. |
| 7 | `../review-rows.tsv` | For each of the 9 rows the book's transcriber flagged, say which reading is right. | 9 rows | Confirmed rows go back into use. |

Suggested order if time is short: 6, 4, 2, then 1 as far as possible, then 3 and 5.

Nothing reads these files back automatically. Return them and the answers are checked,
entered into the data, and covered by tests. To regenerate worksheets 2–5 after the data
changes: `node scripts/linguist-worksheets.ts` (this overwrites them, so do it before
they are filled in, not after).
