"""
Load Case, Court, and Judge nodes into Neo4j.

Usage: python scripts/load_cases.py
"""

import csv
import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

DATA_DIR = Path(__file__).parent.parent / "data"
METADATA_CSV = DATA_DIR / "cases_metadata.csv"
RAW_DIR = DATA_DIR / "raw" / "cases"

MERGE_CASE = """
MERGE (c:Case {id: $case_id})
SET c.citation   = $citation_str,
    c.court      = $court,
    c.date_filed = $date_decided,
    c.holding_summary = $holding_summary,
    c.midpage_id = $case_id
"""

MERGE_COURT = """
MERGE (ct:Court {name: $court})
WITH ct
MATCH (c:Case {id: $case_id})
MERGE (c)-[:HEARD_BY]->(ct)
"""

MERGE_JUDGE = """
MERGE (j:Judge {name: $judge_name})
WITH j
MATCH (c:Case {id: $case_id})
MERGE (c)-[:DECIDED_BY]->(j)
"""


def get_holding_summary(row: dict) -> str:
    path = RAW_DIR / f"{row['case_id']}.json"
    if path.exists():
        case = json.loads(path.read_text())
        text = case.get("full_text") or case.get("text") or case.get("opinion") or ""
        from patent_data.corpus import plain_text
        return plain_text(text)[:500]
    return ""


def main():
    uri = os.environ["NEO4J_URI"]
    user = os.environ["NEO4J_USERNAME"]
    pwd = os.environ["NEO4J_PASSWORD"]
    driver = GraphDatabase.driver(uri, auth=(user, pwd))

    with open(METADATA_CSV) as f:
        rows = list(csv.DictReader(f))

    print(f"Loading {len(rows)} cases into Neo4j…")
    with driver.session() as session:
        for i, row in enumerate(rows):
            holding = get_holding_summary(row)
            session.run(MERGE_CASE, {
                "case_id": row["case_id"],
                "citation_str": row["citation_str"],
                "court": row["court"],
                "date_decided": row["date_decided"],
                "holding_summary": holding,
            })
            if row["court"]:
                session.run(MERGE_COURT, {"court": row["court"], "case_id": row["case_id"]})
            if row["judge"]:
                for judge in str(row["judge"]).split(";"):
                    judge = judge.strip()
                    if judge:
                        session.run(MERGE_JUDGE, {"judge_name": judge, "case_id": row["case_id"]})
            if (i + 1) % 50 == 0:
                print(f"  {i + 1}/{len(rows)}")

    driver.close()
    print("Cases loaded.")


if __name__ == "__main__":
    main()
