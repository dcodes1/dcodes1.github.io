#!/usr/bin/env python3
"""
build_llm_prompt.py -- compile a compact Bukhori "system prompt" from the TSV
for the in-browser WebLLM app (ai/index.html).

A 1.5B model has a small context window, so the full ~2,800-pair dataset cannot
be embedded. This selects the grammar rules plus a curated core vocabulary,
verb table, and phrase set, and prints the text block to embed. Stdlib only.

Usage:
  python3 translator/scripts/build_llm_prompt.py > /tmp/.../knowledge.txt
"""
from __future__ import annotations
import csv, re, sys, collections

TSV = "translator/data/bukhori.tsv"

# Sections worth prioritising for a general translator (high day-to-day value).
PRIORITY_SECTIONS = re.compile(
    r"pronoun|common words|greeting|family|number|day|month|food|time|"
    r"question|preposition|adjectiv|colour|color|body|house|verb",
    re.I,
)


def load():
    with open(TSV, encoding="utf-8", newline="") as f:
        return list(csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE))


def clean(s):
    return re.sub(r"\s+", " ", (s or "").strip())


def main():
    rows = load()
    out = []

    # --- Grammar rules: prioritise translation-relevant rules (sentence
    # construction), not pronunciation trivia. ------------------------------
    # Pick the translation-relevant rules in a fixed, sensible order (one rule
    # per topic), so the prompt leads with sentence construction, not phonology.
    TOPICS = [
        "word order", "simple present", "simple past", "future", "descriptive past",
        "negative", "compound verb", "noun plural", "copula", "imperative",
        "subordinate clauses of time",
    ]
    grules = []
    gseen = set()
    for r in rows:
        if r["entry_type"] == "grammar" and r["notes"]:
            grules.append((clean(r["section"]).lower(), clean(r["notes"])))
    grammar_lines = []
    for topic in TOPICS:
        for sect, note in grules:
            if topic in sect and sect not in gseen:
                gseen.add(sect)
                if len(note) > 240:
                    note = note[:237] + "..."
                grammar_lines.append("- " + note)
                break
    # a couple of high-value possession/ezafe rules to close out
    for sect, note in grules:
        if ("possession" in sect or "plural" in sect) and sect not in gseen:
            gseen.add(sect)
            grammar_lines.append("- " + note[:220])
        if len(grammar_lines) >= 16:
            break

    # --- Verb table (infinitive -> bukhori, present stem) --------------------
    verbs = []
    vseen = set()
    for r in rows:
        if r["entry_type"] != "vocab":
            continue
        en = clean(r["english"]).lower()
        m = re.search(r"stem\s+-([^-;,\]]+)-", r["notes"] or "", re.I)
        if en.startswith("to ") and r["bukhori"] and (m or "+" in (r["notes"] or "")):
            key = en.split(";")[0]
            if key in vseen:
                continue
            vseen.add(key)
            stem = (" [stem -%s-]" % m.group(1).strip()) if m else ""
            verbs.append("%s = %s%s" % (key, clean(r["bukhori"]), stem))
    verbs = verbs[:60]

    # --- Core vocabulary (short english, priority sections) ------------------
    vocab = []
    vseen = set()
    def add_vocab(pred, limit):
        n = 0
        for r in rows:
            if r["entry_type"] != "vocab" or not r["bukhori"]:
                continue
            en = clean(r["english"])
            if en.lower().startswith("to "):
                continue
            if len(en.split()) > 3 or len(en) > 28:
                continue
            k = en.lower()
            if k in vseen:
                continue
            if pred(r):
                vocab.append("%s = %s" % (en, clean(r["bukhori"])))
                vseen.add(k)
                n += 1
                if n >= limit:
                    break
    add_vocab(lambda r: PRIORITY_SECTIONS.search(r["section"] or ""), 180)
    add_vocab(lambda r: True, 80)   # top up with any other short vocab

    # --- Phrases / greetings (short, high value) -----------------------------
    phrases = []
    pseen = set()
    for r in rows:
        if r["entry_type"] not in ("phrase", "example") or not r["bukhori"]:
            continue
        en = clean(r["english"])
        if len(en.split()) > 8 or not en:
            continue
        k = en.lower()
        if k in pseen:
            continue
        pseen.add(k)
        phrases.append("%s = %s" % (en, clean(r["bukhori"])))
        if len(phrases) >= 55:
            break

    # --- Assemble ------------------------------------------------------------
    P = out.append
    P("You are a translator from English into Bukhori (also called Bukharian, "
      "a Judeo-Tajik language), written in the Latin transliteration used below. "
      "Translate the user's English text into Bukhori.")
    P("")
    P("STRICT RULES:")
    P("- Use ONLY the Bukhori vocabulary and grammar given below. Do NOT "
      "substitute Standard Tajik, Persian, Dari, or Russian words.")
    P("- Preserve the exact spelling and diacritics shown (ü, ö, á, é, í, ć, ġ).")
    P("- If the sentence uses the 2nd person (you/your), give BOTH an informal "
      "(Tu) and a formal/polite (Shumo) version, each on its own line.")
    P("- If a needed word is not in the vocabulary below, keep the English word "
      "rather than inventing Bukhori, and note it.")
    P("- Output only the translation (and a one-line note if a word was "
      "missing). No explanations unless asked.")
    P("")
    P("GRAMMAR:")
    out.extend(grammar_lines)
    P("")
    P("VERBS (infinitive = Bukhori [present stem]; present tense = me- + stem + "
      "personal ending; simple past = past stem + ending; negation = na-):")
    out.extend(verbs)
    P("")
    P("VOCABULARY (English = Bukhori):")
    out.extend(vocab)
    P("")
    P("PHRASES / EXAMPLES (English = Bukhori):")
    out.extend(phrases)

    text = "\n".join(out)
    sys.stderr.write(
        "chars=%d  approx_tokens=%d  grammar=%d verbs=%d vocab=%d phrases=%d\n"
        % (len(text), len(text) // 4, len(grammar_lines), len(verbs),
           len(vocab), len(phrases))
    )
    sys.stdout.write(text)


if __name__ == "__main__":
    main()
