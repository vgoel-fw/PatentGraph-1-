"""
Neo4j query functions.
"""

import os
import re

from dotenv import load_dotenv
from neo4j import GraphDatabase

load_dotenv()

# ── Neo4j driver (lazy singleton) ─────────────────────────────────────────────

_driver = None


def _get_driver():
    global _driver
    if _driver is None:
        _driver = GraphDatabase.driver(
            os.environ["NEO4J_URI"],
            auth=(os.environ["NEO4J_USERNAME"], os.environ["NEO4J_PASSWORD"]),
        )
    return _driver


def _run(cypher: str, params: dict = {}) -> list[dict]:
    driver = _get_driver()
    with driver.session() as session:
        result = session.run(cypher, params)
        return [dict(r) for r in result]


# ── Graph query functions ─────────────────────────────────────────────────────

MAX_CASE_IDS = 200
MAX_AUXILIARY_NODES = 100


def validate_case_ids(case_ids: list[str]) -> list[str]:
    if not isinstance(case_ids, list) or len(case_ids) > MAX_CASE_IDS:
        raise ValueError(f"Provide at most {MAX_CASE_IDS} case IDs")
    for case_id in case_ids:
        if not isinstance(case_id, str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}", case_id):
            raise ValueError("Case IDs must be 1–256 letters, digits, underscores, dots, colons or hyphens")
    return list(dict.fromkeys(case_ids))


def _case_node(row: dict) -> dict:
    node = dict(row)
    node["date"] = node.get("date") or node.get("date_filed")
    node["date_filed"] = node["date"]
    node["type"] = "Case"
    node["label"] = node.get("citation") or node["id"]
    return node


def normalize_graph(nodes: list[dict], edges: list[dict]) -> dict:
    """Keep distinct typed relationships only when both endpoints are present."""
    unique_nodes = {node["id"]: node for node in nodes}
    unique_edges = {}
    for row in edges:
        edge = {**(row.get("properties") or {}), **row}
        edge.pop("properties", None)
        if edge["source"] not in unique_nodes or edge["target"] not in unique_nodes:
            continue
        key = (edge["source"], edge["target"], edge["type"])
        unique_edges[key] = {**unique_edges.get(key, {}), **edge}
    return {"nodes": list(unique_nodes.values()), "edges": list(unique_edges.values())}


def get_precedent_chain(case_id: str, depth: int = 3) -> dict:
    """Traverse CITES edges up to `depth` hops from anchor case."""
    validate_case_ids([case_id])
    if type(depth) is not int or not 1 <= depth <= 3:
        raise ValueError("Depth must be an integer between 1 and 3")
    cypher = f"""
    MATCH path = (c:Case {{id: $case_id}})-[:CITES*1..{depth}]->(ancestor:Case)
    WHERE ancestor <> c
    WITH ancestor, min(length(path)) AS hops
    RETURN ancestor.id       AS id,
           ancestor.citation AS citation,
           ancestor.holding_summary AS holding_summary,
           ancestor.date_filed      AS date_filed,
           ancestor.court           AS court,
           hops                     AS hops
    ORDER BY hops ASC, ancestor.date_filed DESC, ancestor.id
    LIMIT 25
    """
    rows = _run(cypher, {"case_id": case_id})

    anchor_rows = _run(
        "MATCH (c:Case {id: $id}) RETURN c.id AS id, c.citation AS citation, "
        "c.holding_summary AS holding_summary, c.date_filed AS date_filed, c.court AS court",
        {"id": case_id},
    )
    if not anchor_rows:
        return {"nodes": [], "edges": []}
    nodes = [_case_node({**anchor_rows[0], "hops": 0})]
    nodes.extend(_case_node(row) for row in rows if row["id"] != case_id)

    node_ids = [n["id"] for n in nodes]
    edge_rows = _run(
        "MATCH (a:Case)-[r:CITES]->(b:Case) WHERE a.id IN $ids AND b.id IN $ids "
        "RETURN a.id AS source, b.id AS target, type(r) AS type, properties(r) AS properties",
        {"ids": node_ids},
    )
    return normalize_graph(nodes, edge_rows)


def find_cases_by_citation(citation_str: str) -> list[dict]:
    """Search Neo4j for cases whose citation contains the given string."""
    rows = _run(
        "MATCH (c:Case) WHERE toLower(c.citation) CONTAINS toLower($q) "
        "RETURN c.id AS id, c.citation AS citation, c.court AS court, "
        "c.date_filed AS date, c.holding_summary AS holding_summary LIMIT 5",
        {"q": citation_str},
    )
    return [dict(r) for r in rows]


def get_claim_construction_cluster(patent_number: str) -> dict:
    cypher = """
    MATCH (p:Patent {number: $patent_number})-[:HAS_CLAIM]->(cl:Claim)-[:CONSTRUED_IN]->(c:Case)
    RETURN c.id AS case_id, c.citation AS citation,
           cl.scope_ruling AS scope_ruling, cl.text_excerpt AS excerpt
    LIMIT 25
    """
    rows = _run(cypher, {"patent_number": patent_number})
    return {"patent": patent_number, "constructions": rows}


def detect_circuit_split(case_ids: list[str]) -> dict:
    cypher = """
    MATCH (c:Case)-[:HEARD_BY]->(ct:Court)
    WHERE c.id IN $case_ids
    RETURN c.id AS case_id, c.citation AS citation,
           c.holding_summary AS holding_summary,
           ct.name AS court, c.date_filed AS date
    ORDER BY ct.name, c.date_filed DESC
    """
    rows = _run(cypher, {"case_ids": case_ids})
    courts: dict[str, list] = {}
    for r in rows:
        courts.setdefault(r["court"], []).append(r)
    return {"exists": len(courts) > 1, "courts": courts, "cases": rows}


def get_judge_pattern(judge_name: str) -> dict:
    cypher = """
    MATCH (j:Judge {name: $judge_name})<-[:DECIDED_BY]-(c:Case)
    OPTIONAL MATCH (c)<-[:CONSTRUED_IN]-(cl:Claim)
    RETURN c.id AS case_id, c.citation AS citation, c.date_filed AS date,
           cl.scope_ruling AS scope_ruling, c.holding_summary AS summary
    ORDER BY c.date_filed DESC
    LIMIT 30
    """
    rows = _run(cypher, {"judge_name": judge_name})
    scope_counts: dict[str, int] = {}
    for r in rows:
        s = r.get("scope_ruling") or "unknown"
        scope_counts[s] = scope_counts.get(s, 0) + 1
    return {"judge": judge_name, "cases": rows, "scope_pattern": scope_counts}


def get_full_subgraph(node_ids: list[str]) -> dict:
    """Induced case graph plus existing Patent → Claim → Case relationships."""
    node_ids = validate_case_ids(node_ids)
    if not node_ids:
        return {"nodes": [], "edges": []}
    nodes_rows = _run(
        "MATCH (c:Case) WHERE c.id IN $ids "
        "RETURN c.id AS id, c.citation AS citation, c.holding_summary AS holding_summary, "
        "c.date_filed AS date, c.court AS court",
        {"ids": node_ids},
    )
    nodes = [_case_node(row) for row in nodes_rows]
    case_ids = [node["id"] for node in nodes]
    if not case_ids:
        return {"nodes": [], "edges": []}
    edges = _run(
        "MATCH (a:Case)-[r:CITES|SIMILAR_TO]->(b:Case) "
        "WHERE a.id IN $ids AND b.id IN $ids "
        "RETURN a.id AS source, b.id AS target, type(r) AS type, properties(r) AS properties",
        {"ids": case_ids},
    )
    related = _run(
        "MATCH (cl:Claim)-[:CONSTRUED_IN]->(c:Case) WHERE c.id IN $ids "
        "AND cl.id IS NOT NULL "
        "WITH DISTINCT cl ORDER BY cl.id LIMIT $limit "
        "OPTIONAL MATCH (p:Patent)-[:HAS_CLAIM]->(cl) "
        "WITH cl, collect(DISTINCT properties(p)) AS patents "
        "RETURN properties(cl) AS claim, patents "
        "ORDER BY cl.id",
        {"ids": case_ids, "limit": MAX_AUXILIARY_NODES},
    )
    auxiliary = {}
    for row in related:
        claim = row["claim"]
        claim_id = f"claim:{claim['id']}"
        if claim_id not in auxiliary:
            if len(auxiliary) >= MAX_AUXILIARY_NODES or claim_id in case_ids:
                continue
            auxiliary[claim_id] = {
                **claim, "id": claim_id, "claim_id": claim["id"], "type": "Claim",
                "label": claim.get("text_excerpt") or f"Claim {claim['id']}",
            }
        for patent in sorted(row["patents"], key=lambda item: str(item.get("number", ""))):
            if patent.get("number") is None:
                continue
            patent_id = f"patent:{patent['number']}"
            if patent_id not in auxiliary and patent_id not in case_ids and len(auxiliary) < MAX_AUXILIARY_NODES:
                auxiliary[patent_id] = {
                    **patent, "id": patent_id, "type": "Patent",
                    "label": f"Patent {patent['number']}",
                }
    nodes.extend(auxiliary.values())
    if auxiliary:
        edges.extend(_run(
            "MATCH (cl:Claim)-[r:CONSTRUED_IN]->(c:Case) "
            "WHERE cl.id IN $claims AND c.id IN $ids "
            "RETURN 'claim:' + cl.id AS source, c.id AS target, type(r) AS type, "
            "properties(r) AS properties "
            "UNION ALL "
            "MATCH (p:Patent)-[r:HAS_CLAIM]->(cl:Claim) "
            "WHERE p.number IN $patents AND cl.id IN $claims "
            "RETURN 'patent:' + p.number AS source, 'claim:' + cl.id AS target, "
            "type(r) AS type, properties(r) AS properties",
            {
                "ids": case_ids,
                "claims": [n["claim_id"] for n in auxiliary.values() if n["type"] == "Claim"],
                "patents": [n["number"] for n in auxiliary.values() if n["type"] == "Patent"],
            },
        ))
    return normalize_graph(nodes, edges)
