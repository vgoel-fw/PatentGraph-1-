"""
Load Patent and Claim nodes into Neo4j.

Usage: python scripts/load_claims.py
"""

import csv
import os
from pathlib import Path

from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

DATA_DIR = Path(__file__).parent.parent / "data"
CLAIMS_CSV = DATA_DIR / "claims.csv"

MERGE_PATENT = "MERGE (p:Patent {number: $patent_number})"
CREATE_CLAIM = """
MERGE (cl:Claim {id: $claim_id})
SET cl.patent_number    = $patent_number,
    cl.text_excerpt     = $text_excerpt,
    cl.scope_ruling     = $scope_ruling,
    cl.review_status   = "reviewed",
    cl.claim_number    = $claim_number
WITH cl
MERGE (p:Patent {number: $patent_number})
MERGE (p)-[:HAS_CLAIM]->(cl)
WITH cl
MATCH (c:Case {id: $case_id})
MERGE (cl)-[:CONSTRUED_IN]->(c)
"""


def main():
    uri = os.environ["NEO4J_URI"]
    user = os.environ["NEO4J_USERNAME"]
    pwd = os.environ["NEO4J_PASSWORD"]
    driver = GraphDatabase.driver(uri, auth=(user, pwd))

    with open(CLAIMS_CSV) as f:
        rows = [r for r in csv.DictReader(f) if r.get("review_status") == "reviewed"
                and r.get("patent_number") not in {None, "", "UNKNOWN"}
                and r.get("claim_number") and r.get("claim_text_excerpt")]

    print(f"Loading {len(rows)} claim records…")
    with driver.session() as session:
        for i, row in enumerate(rows):
            session.run(CREATE_CLAIM, {
                "claim_id": row["claim_id"],
                "claim_number": row["claim_number"],
                "patent_number": row["patent_number"],
                "text_excerpt": row["claim_text_excerpt"][:200],
                "scope_ruling": row["scope_ruling"],
                "case_id": row["case_id"],
            })
            if (i + 1) % 100 == 0:
                print(f"  {i + 1}/{len(rows)}")

    driver.close()
    print("Claims loaded.")


if __name__ == "__main__":
    main()
