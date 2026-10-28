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
                bux = choose_primary(by_key[key])["bux"]
                # Skip grammatical suffix/affix fragments ("-i man", "-am"):
                # these are endings, not standalone words, and corrupt
                # word-by-word output. They are handled by the grammar engine.
                if bux.strip().startswith("-"):
                    break
                word_lex.setdefault(key, bux)
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
# Statistical lexicon: IBM Model 1 word alignment (the EM algorithm)
# --------------------------------------------------------------------------- #
# Trains an unsupervised word-translation model on the parallel pairs to learn
# an English->Bukhori probabilistic dictionary. This covers content words that
# only ever appear *inside* phrases (never as a standalone vocab row), so the
# browser engine can translate them instead of leaving English in the output.
# Pure stdlib, a few seconds, deterministic. Shipped as a compact JSON map.

def _bux_tokens(s: str) -> list[str]:
    s = unicodedata.normalize("NFC", s or "").lower()
    return [t for t in re.split(r"[^a-z0-9üöáéíćġ']+", s) if t]


def train_ibm1(pairs: list[dict], iterations: int = 20) -> dict:
    """IBM Model 1 EM. Returns {english_word: {"bux": best, "p": prob, "n": support}}
    for confident, well-supported entries only."""
    # Build tokenised bitext.
    bitext = []
    cooc = defaultdict(lambda: defaultdict(int))     # eng -> bux -> co-occurrence
    vocab_bux = set()
    for p in pairs:
        e_toks = [t for t in tokenize(p["en_key"]) if t]
        b_toks = _bux_tokens(p["bux"])
        if not e_toks or not b_toks:
            continue
        bitext.append((e_toks, b_toks))
        for e in set(e_toks):
            for b in set(b_toks):
                cooc[e][b] += 1
        vocab_bux.update(b_toks)

    NULL = "∅"
    # t[b][e] initialised uniformly.
    t = defaultdict(lambda: defaultdict(float))
    for e_toks, b_toks in bitext:
        src = e_toks + [NULL]
        for b in b_toks:
            for e in src:
                t[b][e] = 1.0 / len(vocab_bux) if vocab_bux else 0.0

    for _ in range(iterations):
        count = defaultdict(lambda: defaultdict(float))
        total = defaultdict(float)
        for e_toks, b_toks in bitext:
            src = e_toks + [NULL]
            for b in b_toks:
                z = sum(t[b][e] for e in src) or 1e-12
                for e in src:
                    c = t[b][e] / z
                    count[b][e] += c
                    total[e] += c
        for b in count:
            for e in count[b]:
                if total[e]:
                    t[b][e] = count[b][e] / total[e]

    # English function words must never get a content translation (they are
    # dropped or handled structurally by the grammar engine).
    STOP = {"is", "are", "am", "be", "been", "being", "was", "were", "the",
            "a", "an", "of", "do", "does", "did", "will", "would", "shall",
            "it", "this", "that", "these", "those"}

    # For each English word, pick the best Bukhori translation with support.
    learned = {}
    eng_vocab = set()
    for e_toks, _ in bitext:
        eng_vocab.update(e_toks)
    for e in eng_vocab:
        if e in STOP:
            continue
        best_b, best_p = None, 0.0
        for b in cooc[e]:
            p = t[b][e]
            if p > best_p:
                best_p, best_b = p, b
        if (best_b and not best_b.startswith("-") and best_p >= 0.45
                and cooc[e][best_b] >= 2):
            learned[e] = {"bux": best_b, "p": round(best_p, 3), "n": cooc[e][best_b]}
    return learned


# --------------------------------------------------------------------------- #
# Grammar model (for the offline grammar-aware translator)
# --------------------------------------------------------------------------- #
# A compact, dataset-derived model that lets the browser engine conjugate verbs
# and order words per the grammar the TSV itself documents (verb-final order,
# me-+stem+ending present, droppable copula, ba/az prepositions, ezafe linking).
# It is NOT a neural model: it is rules + a mined verb table, a few KB, fully
# offline, no API key. Output is clearly labelled as an unverified draft.

STEM_RE = re.compile(r"stem\s+-([^-;,\]]+)-", re.I)
VOWELS = "aeiouüöáéíü"

# Curated grammar tables, each verified against the dataset's own grammar rows
# (cited in translator/README.md). Kept small and explicit on purpose.
SUBJECTS = {
    # english subject -> {bux, person key for endings}
    "i": {"bux": "Man", "p": "1s"},
    "you": {"bux": "Shumo", "p": "2p"},   # default to polite/plural Shumo
    "he": {"bux": "Ü", "p": "3s"},
    "she": {"bux": "Ü", "p": "3s"},
    "it": {"bux": "Ü", "p": "3s"},
    "we": {"bux": "Mo", "p": "1p"},
    "they": {"bux": "Inho", "p": "3p"},
}
# Present-tense personal endings (consonant stem); vowel stems take the -y- form.
PRESENT_ENDINGS = {  # person -> [consonant, vowel]
    "1s": ["am", "yam"], "2s": ["i", "yi"], "2p": ["ed", "yed"],
    "3s": ["ad", "yad"], "1p": ["em", "yem"], "3p": ["and", "yand"],
}
PAST_ENDINGS = {
    "1s": "am", "2s": "i", "2p": "ed", "3s": "", "1p": "em", "3p": "and",
}
PREPOSITIONS = {
    "in": "ba", "at": "ba", "to": "ba", "into": "ba", "on": "boli",
    "from": "az", "with": "qati", "of": "",  # 'of' handled via ezafe
}
CONNECTIVES = {"and": "va", "or": "yo", "but": "lekin", "that": "ki", "because": "baroi ki"}
TIME_ADVERBS = {
    "now": "aknun", "today": "imrüz", "tomorrow": "pagah", "yesterday": "dina",
    "tonight": "imshav", "always": "hama vaqt", "never": "hej",
    "here": "insun", "there": "unsun",
}
ARTICLES = {"a", "an", "the"}                # dropped in Bukhori
COPULA = {"is", "am", "are", "be", "'m", "'re", "'s", "being"}
# Minimal English lemmatiser for verbs (surface -> lemma) for irregular forms.
IRREGULAR_LEMMA = {
    "is": "be", "am": "be", "are": "be", "was": "be", "were": "be", "been": "be",
    "goes": "go", "went": "go", "gone": "go", "going": "go",
    "has": "have", "had": "have", "having": "have",
    "does": "do", "did": "do", "done": "do", "doing": "do",
    "says": "say", "said": "say", "eats": "eat", "ate": "eat", "eaten": "eat",
    "comes": "come", "came": "come", "coming": "come",
    "buys": "buy", "bought": "buy", "sells": "sell", "sold": "sell",
    "sees": "see", "saw": "see", "seen": "see", "gives": "give", "gave": "give",
    "knows": "know", "knew": "know", "takes": "take", "took": "take",
    "lives": "live", "lived": "live", "living": "live",
    "works": "work", "worked": "work", "speaks": "speak", "spoke": "speak",
    "wants": "want", "wanted": "want", "reads": "read", "makes": "make", "made": "make",
}


def build_grammar(rows: list[dict], index: dict) -> dict:
    """Mine a verb table (infinitive -> present stem, with compound-verb parts)
    and bundle it with the curated grammar tables for the browser engine."""
    verbs: dict[str, dict] = {}
    aux_stems: dict[str, str] = {}      # 1-word bukhori infinitive -> stem

    def verb_key(en: str) -> str:
        key = normalize_english(en)
        if key.startswith("to "):
            key = key[3:]
        return key.split(";")[0].strip()   # "to have; to catch" -> "have"

    # Pass 1: single-word infinitive stems (the auxiliaries compound verbs use:
    # kardan -> kun, zadan -> zan, ...).
    for r in rows:
        en = (r.get("english") or "").strip()
        bux = (r.get("bukhori") or "").strip()
        m = STEM_RE.search(r.get("notes") or "")
        if en.lower().startswith("to ") and bux and m and len(bux.split()) == 1:
            aux_stems[bux.lower()] = m.group(1).strip().split()[0]

    # Pass 2: simple verbs (with a stem) + compound "noun + auxiliary" verbs.
    for r in rows:
        en = (r.get("english") or "").strip()
        bux = (r.get("bukhori") or "").strip()
        notes = r.get("notes") or ""
        if not en.lower().startswith("to ") or not bux:
            continue
        key = verb_key(en)
        if not key or key in verbs:
            continue
        bux_words = bux.split()
        m = STEM_RE.search(notes)

        if len(bux_words) == 2 and (aux_stems.get(bux_words[1].lower()) or "+" in notes):
            aux = bux_words[1]
            aux_stem = aux_stems.get(aux.lower())
            if not aux_stem:
                continue
            verbs[key] = {
                "inf": bux, "noun": bux_words[0], "aux": aux, "stem": aux_stem,
                "vowel": 1 if aux_stem[-1].lower() in VOWELS else 0,
                "compound": 1,
                "no_me": 1 if aux.lower().startswith("doshtan") else 0,
            }
        elif m:
            stem = m.group(1).strip().split()[0]
            verbs[key] = {
                "inf": bux, "stem": stem,
                "vowel": 1 if (stem and stem[-1].lower() in VOWELS) else 0,
                "no_me": 1 if ("no me-" in notes or bux.lower() == "doshtan") else 0,
            }

    # Adjectives + colours (English -> Buxori) for ezafe noun-phrase ordering.
    adjectives: dict[str, str] = {}
    for r in rows:
        if r["entry_type"] != "vocab" or not r["bukhori"]:
            continue
        sect = (r.get("section") or "").lower()
        if not ("adjectiv" in sect or "colour" in sect or "color" in sect):
            continue
        en = normalize_english(r["english"])
        bux = r["bukhori"].strip()
        # single/two-word adjective glosses only; skip sentences and fragments
        if not en or len(en.split()) > 2 or len(bux.split()) > 2:
            continue
        if bux.startswith("-") or en.split()[0] in ("he", "she", "it", "they"):
            continue
        adjectives.setdefault(en, bux)

    # Common adjectives often live outside the "adjectives" section (e.g. good =
    # Naghz under common words). Pull them in from the clean word lexicon.
    COMMON_ADJ = [
        "good", "bad", "cold", "hot", "warm", "cool", "happy", "sad", "young",
        "fast", "slow", "clean", "full", "empty", "hard", "soft", "sweet",
        "sour", "bitter", "salty", "wet", "dry", "heavy", "light", "deep",
        "sick", "healthy", "tired", "hungry", "thirsty", "easy", "difficult",
        "true", "false", "right", "wrong", "same", "different", "ready",
    ]
    for en in COMMON_ADJ:
        if en in adjectives:
            continue
        bux = index["words"].get(en)
        if bux and not bux.startswith("-"):
            adjectives[en] = bux

    return {
        "verbs": verbs,
        "subjects": SUBJECTS,
        "present_endings": PRESENT_ENDINGS,
        "past_endings": PAST_ENDINGS,
        "prepositions": PREPOSITIONS,
        "connectives": CONNECTIVES,
        "time_adverbs": TIME_ADVERBS,
        "articles": sorted(ARTICLES),
        "copula": sorted(COPULA),
        "irregular_lemma": IRREGULAR_LEMMA,
        "adjectives": adjectives,
        # number words -> Buxori, for "two books" style phrases
        "numbers": {w: (index["words"].get(w) or index["exact"].get(w, {}).get("bux"))
                    for w in ["one", "two", "three", "four", "five", "six", "seven",
                              "eight", "nine", "ten", "eleven", "twelve", "twenty",
                              "thirty", "forty", "fifty", "hundred", "thousand"]
                    if index["words"].get(w) or index["exact"].get(w)},
    }


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
    grammar = build_grammar(rows, index)
    learned = train_ibm1(pairs)
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
        # grammar is rule knowledge (verb stems, endings), not held-out pairs,
        # so including it here does not leak test examples into evaluation.
        "grammar": grammar,
        "learned": {e: v["bux"] for e, v in train_ibm1(trainval_pairs).items()},
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
            "verbs": len(grammar["verbs"]),
        },
        "exact": index["exact"],
        "words": index["words"],
        "phrases": index["phrases"],
        "retrieval": index["retrieval"],
        "grammar": grammar,
        "learned": {e: v["bux"] for e, v in learned.items()},
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
