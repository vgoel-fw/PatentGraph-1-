"""
PatentGraph FastAPI backend.

Run: uvicorn api.main:app --reload
"""

import json
import os
import sys
from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

load_dotenv()
sys.path.insert(0, str(Path(__file__).parent.parent))

from graph.queries import (
    get_full_subgraph,
    get_judge_pattern,
    get_precedent_chain,
    validate_case_ids,
)
from llm.query import run_patent_query
from llm.verify import verify_citations

app = FastAPI(title="PatentGraph API", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

DEMO_CACHE = Path(__file__).parent.parent / "demo" / "cached_responses.json"

DEMO_KEY_MAP = {
    "eligibility": "eligibility",
    "alice": "eligibility",
    "software patent eligibility": "eligibility",
    "claim construction": "claim_construction",
    "112": "claim_construction",
    "williamson": "claim_construction",
    "means-plus-function": "claim_construction",
    "obviousness": "obviousness",
    "ksr": "obviousness",
}


def _load_demo_cache() -> dict:
    if DEMO_CACHE.exists():
        return json.loads(DEMO_CACHE.read_text())
    return {}


def _match_demo_key(question: str) -> str | None:
    q = question.lower()
    for keyword, key in DEMO_KEY_MAP.items():
        if keyword in q:
            return key
    return None


class QueryBody(BaseModel):
    question: str
    demo: bool = False


@app.post("/query")
async def query(body: QueryBody):
    if body.demo:
        cache = _load_demo_cache()
        key = _match_demo_key(body.question)
        if key and key in cache:
            cached = cache[key]
            cached["_demo_mode"] = True
            cached["_demo_key"] = key
            return cached
        # Fall through to live if no cache hit

    try:
        memo = run_patent_query(body.question)
        memo = verify_citations(memo)
        return memo
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graph/case/{case_id}")
async def get_case_subgraph(case_id: str, depth: int = Query(default=2, ge=1, le=3)):
    try:
        validate_case_ids([case_id])
        return get_precedent_chain(case_id, depth)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graph/judge/{judge_name}")
async def get_judge_rulings(judge_name: str):
    try:
        return get_judge_pattern(judge_name)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/graph/subgraph")
async def get_subgraph(ids: str):
    """Comma-separated list of case IDs."""
    if not ids.strip():
        raise HTTPException(status_code=400, detail="No IDs provided")
    try:
        node_ids = validate_case_ids([i.strip() for i in ids.split(",")])
        return get_full_subgraph(node_ids)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))



@app.get("/health")
async def health():
    return {"status": "ok", "service": "PatentGraph"}
