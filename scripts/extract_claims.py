"""
Extract patent numbers and claim construction rulings from case opinions.
Output: /data/claims.csv

Usage: python scripts/extract_claims.py
"""

import csv
import json
import re
import sys
from pathlib import Path

DATA_DIR = Path(__file__).parent.parent / "data"
RAW_DIR = DATA_DIR / "raw" / "cases"
METADATA_CSV = DATA_DIR / "cases_metadata.csv"
CLAIMS_CSV = DATA_DIR / "claims.csv"

PATENT_PATTERNS = [
    re.compile(r"U\.?S\.?\s*Patent\s+(?:No\.?\s*)?(\d{1,2},\d{3},\d{3})", re.IGNORECASE),
    re.compile(r"Patent\s+No\.?\s*(\d{1,2},\d{3},\d{3})", re.IGNORECASE),
    re.compile(r"\bUS\s*(\d{7,8})\b"),
]

SCOPE_PATTERNS = {
    "means-plus-function": re.compile(r"means.plus.function|§\s*112[\(\s]*f\b|112\s*\(\s*f\s*\)", re.IGNORECASE),
    "indefinite": re.compile(r"\bindefinite\b|\bindefiniteness\b", re.IGNORECASE),
    "narrowing": re.compile(r"\bnarrow(?:ly|ing)?\b.{0,40}constru", re.IGNORECASE),
    "broad": re.compile(r"\bbroad(?:ly|er)?\b.{0,40}constru", re.IGNORECASE),
    "construed_as": re.compile(r"constru(?:ed|ing)\s+as\s+[\"']?([^\"',\.]{5,60})", re.IGNORECASE),
}


def extract_patent_numbers(text: str) -> list[str]:
    found = set()
    for pat in PATENT_PATTERNS:
        for m in pat.finditer(text):
            num = m.group(1).replace(",", "").strip()
            found.add(num)
    return sorted(found)


def extract_scope_ruling(text: str) -> str:
    # Whole-opinion keyword matches cannot establish a claim-level disposition.
    return "unreviewed"


def extract_construed_as_snippet(text: str) -> str:
    m = SCOPE_PATTERNS["construed_as"].search(text)
    if m:
        return m.group(1).strip()[:120]
    return ""


def main():
    with open(METADATA_CSV) as f:
        rows = list(csv.DictReader(f))

    corpus_ids = {r["case_id"] for r in rows}
    claim_counter = 0
    output_rows = []

    for case_path in sorted(RAW_DIR.glob("*.json")):
        case = json.loads(case_path.read_text())
        case_id = str(case.get("id") or case.get("case_id") or case_path.stem)
        if case_id not in corpus_ids:
            continue

        text = case.get("full_text") or case.get("text") or case.get("opinion") or ""
        if not text:
            continue

        patent_numbers = extract_patent_numbers(text)
        scope_ruling = extract_scope_ruling(text)
        claim_text_excerpt = ""

        if not patent_numbers:
            continue

        for pat_num in patent_numbers:
            claim_id = f"cl_{claim_counter:06d}"
            claim_counter += 1
            output_rows.append({
                "claim_id": claim_id,
                "case_id": case_id,
                "patent_number": pat_num,
                "claim_text_excerpt": claim_text_excerpt,
                "scope_ruling": scope_ruling,
            })

    print(f"Extracted {len(output_rows)} claim records from {len(corpus_ids)} cases.")

    with open(CLAIMS_CSV, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=["claim_id", "case_id", "patent_number", "claim_text_excerpt", "scope_ruling"])
        writer.writeheader()
        writer.writerows(output_rows)

    print(f"Written to {CLAIMS_CSV}")


if __name__ == "__main__":
    main()
