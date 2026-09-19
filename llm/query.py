"""
Patent query orchestration: Midpage search -> graph traversal -> Claude.
"""

import json
import os
import sys

from groq import Groq
from dotenv import load_dotenv

load_dotenv()

sys.path.insert(0, str(__import__("pathlib").Path(__file__).parent.parent))

from graph.queries import get_full_subgraph, get_precedent_chain, normalize_graph
from llm.prompts import SYSTEM_PROMPT
from scripts.midpage_client import MidpageClient

GROQ_MODEL = "llama-3.3-70b-versatile"

_midpage = None
_groq = None


def _get_client():
    global _groq
    if _groq is None:
        _groq = Groq(api_key=os.environ["GROQ_API_KEY"])
    return _groq


def _midpage_client():
    global _midpage
    if _midpage is None:
        _midpage = MidpageClient()
    return _midpage


def run_patent_query(attorney_question: str) -> dict:
    print(f"\n[query] '{attorney_question[:80]}…'")

    # Step 1: Find anchor cases directly in Neo4j via keyword search
    print("  [1/3] Finding anchor cases in Neo4j…")
    from graph.queries import _run
    subgraph_nodes, subgraph_edges = {}, []
    seen: set[str] = set()
    anchor_ids: list[str] = []

    # Extract keywords from the question (words > 4 chars, skip stop words)
    STOP = {"about", "after", "under", "with", "have", "that", "this", "from",
            "their", "which", "what", "does", "been", "most", "more", "when",
            "how", "the", "for", "and", "patent"}
    keywords = [w.lower().strip("?.,") for w in attorney_question.split()
                if len(w) > 4 and w.lower().strip("?.,") not in STOP][:6]

    anchor_cases = []
    for kw in keywords:
        rows = _run(
            "MATCH (c:Case) WHERE toLower(c.citation) CONTAINS toLower($kw) "
            "OR toLower(c.holding_summary) CONTAINS toLower($kw) "
            "RETURN c.id AS id, c.citation AS citation, c.holding_summary AS holding_summary, "
            "c.date_filed AS date_filed, c.court AS court LIMIT 3",
            {"kw": kw},
        )
        for r in rows:
            if r["id"] not in seen:
                seen.add(r["id"])
                anchor_cases.append(r)
        if len(anchor_cases) >= 5:
            break

    # Fallback: if no keyword matches, use the most-cited cases (Alice, Mayo, KSR)
    if not anchor_cases:
        anchor_cases = _run(
            "MATCH (c:Case) WHERE c.citation IN $cits "
            "RETURN c.id AS id, c.citation AS citation, c.holding_summary AS holding_summary, "
            "c.date_filed AS date_filed, c.court AS court",
            {"cits": ["573 U.S. 208", "566 U.S. 66", "550 U.S. 398", "415 F.3d 1303"]},
        )

    print(f"    Anchors: {[c['citation'] for c in anchor_cases[:5]]}")

    # Step 2: Expand each anchor into its precedent chain
    print("  [2/3] Expanding precedent chains via Neo4j…")
    anchor_ids = [case["id"] for case in anchor_cases[:5]]
    for case in anchor_cases[:5]:
        subgraph_nodes[case["id"]] = {
            **case, "date": case.get("date_filed"), "hops": 0,
            "type": "Case", "label": case.get("citation") or case["id"], "is_anchor": True,
        }
    for gc in anchor_cases[:5]:
        gid = gc["id"]
        try:
            chain = get_precedent_chain(gid, depth=2)
            for n in chain["nodes"]:
                previous = subgraph_nodes.get(n["id"])
                if previous is None or n.get("hops", 3) < previous.get("hops", 3):
                    subgraph_nodes[n["id"]] = {**n, "is_anchor": n["id"] in anchor_ids}
            subgraph_edges.extend(chain["edges"])
        except Exception as e:
            print(f"    WARNING: graph traversal failed for {gid}: {e}")

    # Step 2b: Midpage for live text snippets (separate from graph lookup)
    midpage_text = ""
    try:
        midpage_results = _midpage_client().get_by_citations(
            [c["citation"] for c in anchor_cases[:5] if c.get("citation")],
            include_content=False,
        )
        midpage_text = "\n\n".join([
            f"[Midpage | {r.get('citation_str','?')} | {r.get('date_decided','')}]: "
            f"{r.get('case_name','')}"
            for r in midpage_results
        ])
        print(f"    Midpage: {len(midpage_results)} snippets")
    except Exception as e:
        print(f"    WARNING: Midpage failed: {e}")
        midpage_text = "[Midpage retrieval unavailable]"

    try:
        enriched = get_full_subgraph(list(subgraph_nodes))
        for node in enriched["nodes"]:
            previous = subgraph_nodes.get(node["id"], {})
            subgraph_nodes[node["id"]] = {
                **previous, **node, "is_anchor": node["id"] in anchor_ids,
            }
        subgraph_edges.extend(enriched["edges"])
    except Exception as e:
        print(f"    WARNING: graph enrichment failed: {e}")
    subgraph_json = normalize_graph(list(subgraph_nodes.values()), subgraph_edges)
    memo_nodes = [n for n in subgraph_json["nodes"] if n.get("type", "Case") == "Case"][:20]
    memo_graph = normalize_graph(memo_nodes, subgraph_json["edges"])
    print(f"    Subgraph: {len(subgraph_json['nodes'])} nodes, {len(subgraph_json['edges'])} edges")

    # Step 3: Groq call
    print("  [3/3] Calling Groq (Llama 3.3 70B)…")
    user_message = f"""ATTORNEY QUESTION: {attorney_question}

SUBGRAPH ({len(memo_nodes)} cases from knowledge graph):
{json.dumps(memo_graph, indent=2)}

LIVE CASE LAW (Midpage, real-time retrieval):
{midpage_text}

Produce the structured legal memo JSON."""

    response = _get_client().chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_message},
        ],
        max_tokens=2500,
        temperature=0.2,
    )
    raw = response.choices[0].message.content.strip()
    if raw.startswith("```"):
        raw = raw.split("\n", 1)[1] if "\n" in raw else raw[3:]
        if raw.endswith("```"):
            raw = raw[:-3].strip()

    memo = json.loads(raw)
    memo["subgraph"] = subgraph_json
    memo["anchor_cases"] = anchor_ids
    print("  Done.")
    return memo
