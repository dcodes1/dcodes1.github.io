#!/usr/bin/env python3
"""
preprocess.py  --  Offline TSV -> translation index builder.

Turns the authoritative Bukhori TSV into static JSON artifacts the browser
engine loads once. Uses the Python standard library only (no third-party deps,
no network, no GPU) so it runs anywhere and is fully reproducible.

Design rules (see translator/README.md for the why):
  * Bukhori text is PRESERVED EXACTLY -- original script, spelling, diacritics,
    capitalisation. We never invent, transliterate, or "fix" a translation.
  * Only rows that are genuine English->Bukhori pairs become lookup entries.
    Grammar headers, empty cells, conjugation-table fragments and fill-in
    exercise stubs are classified out of the lookup index (kept in the summary).
  * English is normalised for KEYS only (match keys); the original English and
    original Bukhori are always kept for display.

Outputs (written to translator/data/):
  index.json        - engine payload: exact map, variants, word lexicon,
                      phrase list, retrieval examples, config, metadata.
  summary.json      - dataset profile / quality report.
  pairs.jsonl       - every clean pair (audit trail).
  splits.json       - train/val/test ids (leak-free), for evaluation only.

Usage:
  python3 translator/scripts/preprocess.py \
      --tsv translator/data/bukhori.tsv \
      --out translator/data
"""
from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
import re
import unicodedata
from collections import Counter, defaultdict, OrderedDict

# --------------------------------------------------------------------------- #
# Row classification
# --------------------------------------------------------------------------- #

# entry_type values that can contain usable English->Bukhori pairs.
PAIR_TYPES = {"vocab", "phrase", "example", "proverb", "reading"}

# entry_type values that are NEVER lookup pairs:
#   grammar  -> rule headers, english == section, no translation
#   paradigm -> conjugation-table fragments ("my" -> "-am", "i" -> "-um").
#               These are suffixes/inflected cells, not standalone words, and
#               would poison exact/fuzzy matching. Kept for the summary only.
#   exercise -> prompts with no answer, or fill-in stubs ("Man xarid...").
NON_PAIR_TYPES = {"grammar", "paradigm", "exercise"}

# A Bukhori cell that is clearly not a clean standalone translation.
PLACEHOLDER_RE = re.compile(r"\.\.\.|…")          # ellipsis = fragment
BARE_STEM_RE = re.compile(r"^\s*\(")                   # "(bare stem)", "(no ending)"


def is_pair_row(row: dict) -> bool:
    """True if the row is a genuine, usable English->Bukhori translation pair."""
    etype = (row.get("entry_type") or "").strip().lower()
    eng = (row.get("english") or "").strip()
    bux = (row.get("bukhori") or "").strip()
    if etype in NON_PAIR_TYPES:
        return False
    if etype not in PAIR_TYPES:
        return False
    if not eng or not bux:
        return False
    if eng.strip().lower() == (row.get("section") or "").strip().lower():
        return False  # header row echoed into the english column
    if PLACEHOLDER_RE.search(bux) or BARE_STEM_RE.match(bux):
        return False
    return True


# --------------------------------------------------------------------------- #
# Normalisation (KEYS ONLY -- never applied to stored Bukhori)
# --------------------------------------------------------------------------- #

# Map typographic punctuation to ASCII so "What's" == "What’s".
PUNCT_MAP = {
    "’": "'", "‘": "'", "“": '"', "”": '"',
    "–": "-", "—": "-", "−": "-",
}
# Characters stripped from the *ends* of an English key (keep internal ones).
EDGE_PUNCT = " \t\r\n.,!?;:\"'()[]{}"


def _fold_punct(s: str) -> str:
    return "".join(PUNCT_MAP.get(ch, ch) for ch in s)


def normalize_english(s: str) -> str:
    """Normalise an English string into a match key.

    Lower-cases, folds typographic punctuation, collapses whitespace and trims
    edge punctuation. Parenthetical glosses like "(polite)" are dropped from the
    key because they annotate register, not the words being translated -- but the
    ORIGINAL english is always kept for display and never lost.
    """
    s = unicodedata.normalize("NFC", s or "")
    s = _fold_punct(s)
    s = re.sub(r"\((?:[^()]*)\)", " ", s)      # drop parenthetical glosses
    s = s.lower()
    s = re.sub(r"\s+", " ", s).strip()
    s = s.strip(EDGE_PUNCT).strip()
    s = re.sub(r"\s+", " ", s)
    return s


# A loose key used only for fuzzy candidate grouping: drop all non-alphanumerics.
def loose_key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", normalize_english(s)).strip()


def tokenize(s: str) -> list[str]:
    return [t for t in re.split(r"[^a-z0-9']+", normalize_english(s)) if t]


def char_trigrams(s: str) -> set[str]:
    s = "  " + re.sub(r"\s+", " ", loose_key(s)) + "  "
    return {s[i:i + 3] for i in range(len(s) - 2)} if len(s) >= 3 else {s}


def pair_id(eng: str, bux: str) -> str:
    h = hashlib.sha1(f"{eng}\u0001{bux}".encode("utf-8")).hexdigest()
    return h[:12]


# --------------------------------------------------------------------------- #
# Load + clean
# --------------------------------------------------------------------------- #

def load_rows(tsv_path: str) -> list[dict]:
    with open(tsv_path, encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t", quoting=csv.QUOTE_NONE)
        rows = []
        for r in reader:
            # strip surrounding whitespace on every cell; keep interior intact
            rows.append({k: (v.strip() if isinstance(v, str) else v)
                         for k, v in r.items()})
    return rows


def build_pairs(rows: list[dict]) -> list[dict]:
    """Extract clean pairs, preserving every source attribute we may need."""
    pairs = []
    seen = set()  # exact (eng_key, bukhori) de-dup within the pair list
    for r in rows:
        if not is_pair_row(r):
            continue
        eng_display = re.sub(r"\s+", " ", r["english"]).strip()
        bux = r["bukhori"].strip()                 # PRESERVED EXACTLY
        key = normalize_english(eng_display)
        if not key:
            continue
        dedup = (key, bux)
        if dedup in seen:
            continue
        seen.add(dedup)
        pairs.append({
            "id": pair_id(key, bux),
            "en": eng_display,
            "en_key": key,
            "bux": bux,
            "spoken": r.get("spoken_form", "") or "",
            "alt": r.get("alt_forms", "") or "",
            "type": (r.get("entry_type") or "").lower(),
            "section": r.get("section", "") or "",
            "lesson": r.get("lesson", "") or "",
            "notes": r.get("notes", "") or "",
            "review": (r.get("flag", "") or "").upper() == "REVIEW",
        })
    return pairs


# Preference order when the same English key maps to several Bukhori forms.
TYPE_RANK = {"vocab": 0, "phrase": 1, "proverb": 2, "example": 3, "reading": 4}


def choose_primary(group: list[dict]) -> dict:
    """Pick the canonical translation for an English key; rest become variants."""
    def score(p):
        return (p["review"],                 # non-REVIEW first (False < True)
                TYPE_RANK.get(p["type"], 9),  # vocab/phrase before example
                len(p["bux"]))                # shorter/cleaner first
    return sorted(group, key=score)[0]


# --------------------------------------------------------------------------- #
# Index construction
# --------------------------------------------------------------------------- #

def build_index(pairs: list[dict]) -> dict:
    by_key: dict[str, list[dict]] = defaultdict(list)
    for p in pairs:
        by_key[p["en_key"]].append(p)

    exact: "OrderedDict[str, dict]" = OrderedDict()
    for key in sorted(by_key):
        group = by_key[key]
        primary = choose_primary(group)
        variants = [g for g in group if g["id"] != primary["id"]]
        entry = {
            "en": primary["en"],
            "bux": primary["bux"],
            "type": primary["type"],
            "review": primary["review"],
        }
        if primary["spoken"]:
            entry["spoken"] = primary["spoken"]
        if primary["alt"]:
            entry["alt"] = primary["alt"]
        if primary["notes"]:
            entry["notes"] = primary["notes"]
        if variants:
            entry["variants"] = [
                {"bux": v["bux"], "en": v["en"], "section": v["section"]}
                for v in variants
            ]
        exact[key] = entry

    # Single-token "word" lexicon for the compositional layer. Only genuine
    # one-word English headwords, and only from vocab (phrases/examples are not
    # word glosses). First/most canonical wins.
    word_lex: "OrderedDict[str, str]" = OrderedDict()
    for key in sorted(by_key):
        if " " in key:
            continue
        for p in by_key[key]:
            if p["type"] == "vocab":
                word_lex.setdefault(key, choose_primary(by_key[key])["bux"])
                break

    # Phrase list (multi-word keys) for fuzzy + longest-substring matching.
    phrases = [
        {"k": key, "en": exact[key]["en"], "bux": exact[key]["bux"]}
        for key in exact if " " in key
    ]

    # Retrieval examples: full sentence-ish pairs (>=3 english tokens), the
    # material a RAG layer would condition on. Trigram sig kept for client-side
    # similarity ranking without any ML dependency.
    retrieval = []
    for key in exact:
        toks = tokenize(key)
        if len(toks) >= 3:
            retrieval.append({
                "en": exact[key]["en"],
                "bux": exact[key]["bux"],
                "toks": toks,
            })

    return {
        "exact": exact,
        "words": word_lex,
        "phrases": phrases,
        "retrieval": retrieval,
    }


# --------------------------------------------------------------------------- #
# Leak-free train/val/test split (evaluation only)
# --------------------------------------------------------------------------- #

def build_splits(pairs: list[dict], seed: int = 1337) -> dict:
    """Assign WHOLE equivalence-groups to a single split so near-duplicates
    (same English key, or shared Bukhori surface) never leak across sets.

    Union-Find over two relations: same en_key, and same bukhori.
    """
    parent: dict[str, str] = {}

    def find(x):
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    def union(a, b):
        ra, rb = find(a), find(b)
        if ra != rb:
            parent[ra] = rb

    key_rep: dict[str, str] = {}
    bux_rep: dict[str, str] = {}
    for p in pairs:
        find(p["id"])
        if p["en_key"] in key_rep:
            union(p["id"], key_rep[p["en_key"]])
        else:
            key_rep[p["en_key"]] = p["id"]
        if p["bux"] in bux_rep:
            union(p["id"], bux_rep[p["bux"]])
        else:
            bux_rep[p["bux"]] = p["id"]

    groups: dict[str, list[str]] = defaultdict(list)
    for p in pairs:
        groups[find(p["id"])].append(p["id"])

    # Deterministic shuffle of groups, then 80/10/10 by group.
    import random
    rng = random.Random(seed)
    group_keys = sorted(groups)
    rng.shuffle(group_keys)
    n = len(group_keys)
    n_test = max(1, int(round(n * 0.10)))
    n_val = max(1, int(round(n * 0.10)))
    test_g = set(group_keys[:n_test])
    val_g = set(group_keys[n_test:n_test + n_val])

    split = {"train": [], "val": [], "test": []}
    for g in group_keys:
        bucket = "test" if g in test_g else "val" if g in val_g else "train"
        split[bucket].extend(groups[g])
    return split


# --------------------------------------------------------------------------- #
# Summary / quality report
# --------------------------------------------------------------------------- #

def build_summary(rows, pairs, index, splits) -> dict:
    etypes = Counter((r.get("entry_type") or "").lower() for r in rows)
    empty_bux = Counter((r.get("entry_type") or "").lower()
                        for r in rows if not (r.get("bukhori") or "").strip())
    key_counts = Counter(p["en_key"] for p in pairs)
    dup_keys = {k: c for k, c in key_counts.items() if c > 1}
    wc = Counter(min(len(tokenize(p["en_key"])), 7) for p in pairs)
    review = [p for p in pairs if p["review"]]
    return {
        "source_rows": len(rows),
        "entry_types": dict(etypes.most_common()),
        "rows_missing_bukhori": dict(empty_bux.most_common()),
        "clean_pairs": len(pairs),
        "unique_english_keys": len(index["exact"]),
        "english_keys_with_multiple_bukhori": len(dup_keys),
        "single_word_lexicon": len(index["words"]),
        "multiword_phrases": len(index["phrases"]),
        "retrieval_examples": len(index["retrieval"]),
        "english_token_count_histogram": {str(k): v for k, v in sorted(wc.items())},
        "review_flagged_pairs": len(review),
        "split_sizes": {k: len(v) for k, v in splits.items()},
        "notes": (
            "Bukhori is Latin-transliterated Bukharian (Judeo-Tajik); script, "
            "spelling and diacritics are preserved exactly from the source. "
            "grammar/paradigm/exercise rows are intentionally excluded from the "
            "lookup index (headers, conjugation fragments, answerless prompts)."
        ),
    }


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--tsv", default="translator/data/bukhori.tsv")
    ap.add_argument("--out", default="translator/data")
    args = ap.parse_args()

    rows = load_rows(args.tsv)
    pairs = build_pairs(rows)
    index = build_index(pairs)
    splits = build_splits(pairs)
    summary = build_summary(rows, pairs, index, splits)

    os.makedirs(args.out, exist_ok=True)

    # Evaluation-only index built from TRAIN+VAL pairs exclusively, so the
    # held-out TEST set never leaks into exact matching. Same builder, same
    # structure as index.json -> the engine is identical; only coverage differs.
    trainval_ids = set(splits["train"]) | set(splits["val"])
    trainval_pairs = [p for p in pairs if p["id"] in trainval_ids]
    index_tv = build_index(trainval_pairs)
    eval_payload = {
        "version": 1, "source": os.path.basename(args.tsv) + " [train+val]",
        "config": {"fuzzy_accept": 0.86, "fuzzy_review": 0.62,
                   "spell_accept": 0.72, "spell_review": 0.6, "max_input_chars": 2000},
        "exact": index_tv["exact"], "words": index_tv["words"],
        "phrases": index_tv["phrases"], "retrieval": index_tv["retrieval"],
    }
    with open(os.path.join(args.out, "index_train.json"), "w", encoding="utf-8") as f:
        json.dump(eval_payload, f, ensure_ascii=False, separators=(",", ":"))

    engine_payload = {
        "version": 1,
        "source": os.path.basename(args.tsv),
        "config": {
            # Fuzzy acceptance: combined score in [0,1]. Below review -> shown
            # only as a low-confidence suggestion; below floor -> not shown.
            "fuzzy_accept": 0.86,
            "fuzzy_review": 0.62,
            "max_input_chars": 2000,
        },
        "counts": {
            "exact": len(index["exact"]),
            "words": len(index["words"]),
            "phrases": len(index["phrases"]),
            "retrieval": len(index["retrieval"]),
        },
        "exact": index["exact"],
        "words": index["words"],
        "phrases": index["phrases"],
        "retrieval": index["retrieval"],
    }

    with open(os.path.join(args.out, "index.json"), "w", encoding="utf-8") as f:
        json.dump(engine_payload, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(args.out, "summary.json"), "w", encoding="utf-8") as f:
        json.dump(summary, f, ensure_ascii=False, indent=2)
    with open(os.path.join(args.out, "pairs.jsonl"), "w", encoding="utf-8") as f:
        for p in pairs:
            f.write(json.dumps(p, ensure_ascii=False) + "\n")
    with open(os.path.join(args.out, "splits.json"), "w", encoding="utf-8") as f:
        json.dump(splits, f, ensure_ascii=False, indent=2)

    print(json.dumps(summary, ensure_ascii=False, indent=2))
    print("\nWrote index.json, summary.json, pairs.jsonl, splits.json to", args.out)


if __name__ == "__main__":
    main()
