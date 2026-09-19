import asyncio
import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.parse import quote

from api.main import app
from graph import queries
from llm.query import run_patent_query


def case(case_id, **extra):
    return {
        "id": case_id, "citation": f"Citation {case_id}",
        "date_filed": "2020-01-01", "court": "CAFC",
        "holding_summary": "A holding", **extra,
    }


def edge(source, target, relationship="CITES", **extra):
    return {"source": source, "target": target, "type": relationship, **extra}


class GraphQueryTests(unittest.TestCase):
    def assert_integrity(self, graph):
        ids = [n["id"] for n in graph["nodes"]]
        self.assertEqual(len(ids), len(set(ids)))
        keys = [(e["source"], e["target"], e["type"]) for e in graph["edges"]]
        self.assertEqual(len(keys), len(set(keys)))
        for relationship in graph["edges"]:
            self.assertIn(relationship["source"], ids)
            self.assertIn(relationship["target"], ids)

    def test_depth_and_id_validation_precedes_database_access(self):
        with patch.object(queries, "_run") as run:
            for depth in (0, 4, -1, True, 2.0, "2", "1]->(n)"):
                with self.subTest(depth=depth), self.assertRaises(ValueError):
                    queries.get_precedent_chain("a", depth)
            for ids in ([""], [" "], ["a,b"], ["a\n"], ["a" * 257], [None], "a", ["a"] * 201):
                with self.subTest(ids=ids), self.assertRaises(ValueError):
                    queries.get_full_subgraph(ids)
            run.assert_not_called()
        self.assertEqual(queries.validate_case_ids(["seed_a:1.0-b", "seed_a:1.0-b"]), ["seed_a:1.0-b"])
        self.assertEqual(len(queries.validate_case_ids([str(i) for i in range(200)])), 200)

    def test_chain_uses_shortest_distinct_hops_and_consistent_dates(self):
        for depth in (1, 2, 3):
            with self.subTest(depth=depth), patch.object(
                queries, "_run",
                side_effect=[
                    [case("b", hops=1)],
                    [case("a")],
                    [edge("a", "b"), edge("a", "b"), edge("a", "missing")],
                ],
            ) as run:
                graph = queries.get_precedent_chain("a", depth)
                cypher = run.call_args_list[0].args[0]
                self.assertIn(f"CITES*1..{depth}", cypher)
                self.assertIn("min(length(path))", cypher)
                self.assertIn("WHERE ancestor <> c", cypher)
                self.assertLess(cypher.index("min(length(path))"), cypher.index("LIMIT 26"))
                self.assertEqual([n["hops"] for n in graph["nodes"]], [0, 1])
                for node in graph["nodes"]:
                    self.assertEqual(node["date"], "2020-01-01")
                    self.assertEqual(node["date_filed"], node["date"])
                    self.assertEqual(node["type"], "Case")
                    self.assertEqual(node["label"], node["citation"])
                self.assertEqual(len(graph["edges"]), 1)
                self.assertFalse(graph["truncated"])
                self.assert_integrity(graph)

    def test_chain_reports_truncation_without_dangling_edges(self):
        with patch.object(queries, "_run", side_effect=[
            [case(str(i), hops=1) for i in range(26)], [case("a")],
            [edge("a", str(i)) for i in range(26)],
        ]):
            graph = queries.get_precedent_chain("a")
        self.assertTrue(graph["truncated"])
        self.assertEqual(len(graph["nodes"]), 26)
        self.assertEqual(len(graph["edges"]), 25)
        self.assert_integrity(graph)

    def test_missing_anchor_and_empty_subgraph_do_not_invent_nodes(self):
        with patch.object(queries, "_run", side_effect=[[], []]):
            self.assertEqual(queries.get_precedent_chain("unknown"), {"nodes": [], "edges": []})
        with patch.object(queries, "_run") as run:
            self.assertEqual(queries.get_full_subgraph([]), {"nodes": [], "edges": []})
            run.assert_not_called()
        with patch.object(queries, "_run", return_value=[]) as run:
            self.assertEqual(queries.get_full_subgraph(["unknown"]), {"nodes": [], "edges": []})
            self.assertEqual(run.call_count, 1)

    def test_subgraph_enriches_real_relationships_and_metadata(self):
        related = [{
            "claim": {"id": "a", "patent_number": "123", "text_excerpt": "a processor",
                      "scope_ruling": "narrow"},
            "patents": [{"number": "123"}],
        }]
        case_edges = [
            edge("a", "b", properties={"context": "cited"}),
            edge("a", "b", "SIMILAR_TO", properties={"weight": 0.87}),
            edge("a", "b", "SIMILAR_TO", properties={"weight": 0.87}),
            edge("a", "unknown"),
        ]
        auxiliary_edges = [
            edge("patent:123", "claim:a", "HAS_CLAIM"),
            edge("claim:a", "a", "CONSTRUED_IN", properties={"note": "construction"}),
        ]
        with patch.object(
            queries, "_run", side_effect=[[case("a"), case("b")], case_edges, related, auxiliary_edges]
        ) as run:
            graph = queries.get_full_subgraph(["a", "b", "a"])
            self.assertEqual(run.call_args_list[0].args[1], {"ids": ["a", "b"]})
            self.assertIn("CITES|SIMILAR_TO", run.call_args_list[1].args[0])
            self.assertIn("CONSTRUED_IN", run.call_args_list[2].args[0])
            self.assertIn("HAS_CLAIM", run.call_args_list[2].args[0])
            self.assertEqual(run.call_args_list[3].args[1]["claims"], ["a"])
            self.assertEqual(run.call_args_list[3].args[1]["patents"], ["123"])
        self.assert_integrity(graph)
        nodes = {n["id"]: n for n in graph["nodes"]}
        self.assertEqual(set(nodes), {"a", "b", "claim:a", "patent:123"})
        self.assertEqual(nodes["claim:a"]["claim_id"], "a")
        self.assertEqual(nodes["claim:a"]["type"], "Claim")
        self.assertEqual(nodes["claim:a"]["scope_ruling"], "narrow")
        self.assertEqual(nodes["patent:123"]["label"], "Patent 123")
        edges = {e["type"]: e for e in graph["edges"]}
        self.assertEqual(len(graph["edges"]), 4)
        self.assertEqual(edges["SIMILAR_TO"]["weight"], 0.87)
        self.assertEqual(edges["SIMILAR_TO"]["score"], 0.87)
        self.assertFalse(graph["truncated"])
        self.assertEqual(edges["CITES"]["context"], "cited")
        self.assertEqual(edges["CONSTRUED_IN"]["note"], "construction")

    def test_auxiliary_cap_filters_edges_and_handles_shared_patents(self):
        related = [
            {"claim": {"id": str(i)}, "patents": [{"number": str(i)}]}
            for i in range(100)
        ]
        relationships = [
            relationship
            for i in range(100)
            for relationship in (
                edge(f"claim:{i}", "a", "CONSTRUED_IN"),
                edge(f"patent:{i}", f"claim:{i}", "HAS_CLAIM"),
            )
        ]
        with patch.object(
            queries, "_run", side_effect=[[case("a")], [], related, relationships]
        ) as run:
            graph = queries.get_full_subgraph(["a"])
            self.assertEqual(run.call_args_list[2].args[1]["limit"], 101)
            self.assertEqual(len(run.call_args_list[3].args[1]["claims"]), 50)
            self.assertEqual(len(run.call_args_list[3].args[1]["patents"]), 50)
        self.assertEqual(len(graph["nodes"]), 101)
        self.assertEqual(len(graph["edges"]), 100)
        self.assertTrue(graph["truncated"])
        self.assert_integrity(graph)
        shared = [
            {"claim": {"id": str(i)}, "patents": [{"number": "shared"}]}
            for i in range(2)
        ]
        with patch.object(queries, "_run", side_effect=[[case("a")], [], shared, []]):
            graph = queries.get_full_subgraph(["a"])
        self.assertEqual([n["type"] for n in graph["nodes"]].count("Patent"), 1)

    def test_claim_without_patent_still_enriches(self):
        with patch.object(queries, "_run", side_effect=[
            [case("a")], [], [{"claim": {"id": "cl"}, "patents": []}],
            [edge("claim:cl", "a", "CONSTRUED_IN")],
        ]):
            graph = queries.get_full_subgraph(["a"])
        self.assertEqual(len(graph["nodes"]), 2)
        self.assertEqual(graph["nodes"][1]["label"], "Claim cl")
        self.assert_integrity(graph)


async def request(path, query=""):
    messages = []

    async def receive():
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        messages.append(message)

    await app({
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1",
        "method": "GET", "scheme": "http", "path": path, "raw_path": path.encode(),
        "query_string": query.encode(), "root_path": "", "headers": [],
        "server": ("test", 80), "client": ("test", 1234),
    }, receive, send)
    status = next(m["status"] for m in messages if m["type"] == "http.response.start")
    body = b"".join(m.get("body", b"") for m in messages if m["type"] == "http.response.body")
    return status, json.loads(body)


class GraphApiTests(unittest.TestCase):
    def test_depth_bounds_and_invalid_case_ids(self):
        with patch("api.main.get_precedent_chain", return_value={"nodes": [], "edges": []}) as chain:
            for value in ("0", "4", "-1", "2.5", "false"):
                with self.subTest(depth=value):
                    self.assertEqual(asyncio.run(request("/graph/case/a", f"depth={value}"))[0], 422)
            self.assertEqual(asyncio.run(request("/graph/case/bad id"))[0], 400)
            chain.assert_not_called()
            for value in ("1", "3"):
                self.assertEqual(asyncio.run(request("/graph/case/a", f"depth={value}"))[0], 200)
                chain.assert_called_with("a", int(value))
            self.assertEqual(asyncio.run(request("/graph/case/a"))[0], 200)
            chain.assert_called_with("a", 2)

    def test_subgraph_id_validation_and_existing_endpoint_enrichment(self):
        graph = {"nodes": [{"id": "patent:123", "type": "Patent", "label": "Patent 123"}], "edges": []}
        with patch("api.main.get_full_subgraph", return_value=graph) as full:
            for ids in ("", " ", "a,,b", "a,", "bad id", "x" * 257, ",".join(map(str, range(201)))):
                with self.subTest(ids=ids):
                    self.assertEqual(asyncio.run(request("/graph/subgraph", "ids=" + quote(ids)))[0], 400)
            full.assert_not_called()
            status, data = asyncio.run(request("/graph/subgraph", "ids=a,b,a"))
            self.assertEqual(status, 200)
            self.assertEqual(data, graph)
            full.assert_called_once_with(["a", "b"])
            self.assertEqual(asyncio.run(request("/graph/subgraph"))[0], 422)


class QueryOrchestrationTests(unittest.TestCase):
    assert_integrity = GraphQueryTests.assert_integrity

    def test_enriched_visual_graph_is_separate_from_bounded_case_memo(self):
        cases = [case("a"), case("b")] + [case(f"c{i}") for i in range(24)]
        chain_nodes = [
            {**c, "type": "Case", "label": c["citation"], "hops": 0 if c["id"] == "a" else 1}
            for c in cases
        ]
        case_edges = [edge("a", c["id"]) for c in cases[1:]]
        enriched = {
            "truncated": True,
            "nodes": chain_nodes + [
                {"id": "claim:cl", "type": "Claim", "label": "a processor"},
                {"id": "patent:123", "type": "Patent", "label": "Patent 123"},
            ],
            "edges": case_edges + [
                edge("a", "b", "SIMILAR_TO", weight=0.9),
                edge("claim:cl", "b", "CONSTRUED_IN"),
                edge("patent:123", "claim:cl", "HAS_CLAIM"),
                edge("a", "missing"),
            ],
        }
        client = Mock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"summary":"memo"}'))]
        )
        with (
            patch("graph.queries._run", return_value=cases[:2]),
            patch("llm.query.get_precedent_chain", return_value={"nodes": chain_nodes, "edges": case_edges}),
            patch("llm.query.get_full_subgraph", return_value=enriched) as full,
            patch("llm.query._midpage_client") as midpage,
            patch("llm.query._get_client", return_value=client),
        ):
            midpage.return_value.get_by_citations.return_value = []
            memo = run_patent_query("processor construction")
        full.assert_called_once_with([c["id"] for c in cases])
        self.assertEqual(memo["anchor_cases"], ["a", "b"])
        self.assertEqual(len(memo["subgraph"]["nodes"]), 28)
        self.assertTrue(memo["subgraph"]["truncated"])
        self.assert_integrity(memo["subgraph"])
        self.assertTrue(all(n["is_anchor"] for n in memo["subgraph"]["nodes"][:2]))
        message = client.chat.completions.create.call_args.kwargs["messages"][1]["content"]
        context = json.loads(message.split("cases from knowledge graph):\n", 1)[1].split("\n\nLIVE CASE LAW", 1)[0])
        self.assertEqual(len(context["nodes"]), 20)
        self.assertTrue(all(n["type"] == "Case" for n in context["nodes"]))
        self.assert_integrity(context)
        self.assertNotIn("claim:cl", message)
        self.assertEqual(len([e for e in context["edges"] if e["source"] == "a" and e["target"] == "b"]), 2)

    def test_graph_service_failures_preserve_anchor_memo(self):
        client = Mock()
        client.chat.completions.create.return_value = SimpleNamespace(
            choices=[SimpleNamespace(message=SimpleNamespace(content='{"summary":"memo"}'))]
        )
        with (
            patch("graph.queries._run", return_value=[case("a")]),
            patch("llm.query.get_precedent_chain", side_effect=RuntimeError("offline")),
            patch("llm.query.get_full_subgraph", side_effect=RuntimeError("offline")),
            patch("llm.query._midpage_client", side_effect=RuntimeError("offline")),
            patch("llm.query._get_client", return_value=client),
        ):
            memo = run_patent_query("processor")
        self.assertEqual(memo["anchor_cases"], ["a"])
        self.assertEqual(memo["subgraph"]["nodes"][0]["id"], "a")
        self.assertEqual(memo["subgraph"]["edges"], [])


if __name__ == "__main__":
    unittest.main()
