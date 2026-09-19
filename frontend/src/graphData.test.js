import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGraph, NODE_COLORS } from './graphData.js'

describe('shared 2D/3D graph data', () => {
  it('handles missing and empty graphs', () => {
    assert.deepEqual(normalizeGraph(), { nodes: [], edges: [] })
    assert.deepEqual(normalizeGraph({}), { nodes: [], edges: [] })
  })

  it('normalizes legacy cases, anchors, dates, and hops without mutating input', () => {
    const node = { id: 'case-1', citation: 'Alice', date_filed: '2014-06-19', hops: 1, holding_summary: 'Holding' }
    const graph = normalizeGraph({ nodes: [node] }, ['case-1'])
    assert.equal(graph.nodes[0].type, 'Case')
    assert.equal(graph.nodes[0].label, 'Alice')
    assert.equal(graph.nodes[0].date, node.date_filed)
    assert.equal(graph.nodes[0].hops, 1)
    assert.equal(graph.nodes[0].holding, 'Holding')
    assert.equal(graph.nodes[0].color, NODE_COLORS.anchor)
    assert.equal(node.isAnchor, undefined)
  })

  it('keeps distinct relationship types while removing duplicate and dangling edges', () => {
    const citation = { source: 'a', target: 'b', type: 'CITES' }
    const graph = normalizeGraph({
      nodes: [{ id: 'a' }, { id: 'a' }, { id: 'b' }, {}],
      edges: [citation, citation, { ...citation, type: 'SIMILAR_TO', score: 0.85 },
        { source: 'b', target: 'missing', type: 'CITES' }],
    })
    assert.equal(graph.nodes.length, 2)
    assert.equal(graph.edges.length, 2)
    assert.equal(graph.edges[1].score, 0.85)
    assert.notEqual(graph.edges[0].id, graph.edges[1].id)
  })

  it('preserves genuine patent and claim metadata and directions', () => {
    const graph = normalizeGraph({
      nodes: [
        { id: 'patent:123', type: 'Patent', number: '123' },
        { id: 'claim:1', type: 'Claim', label: 'Claim 1', text_excerpt: 'An apparatus', scope_ruling: 'narrow' },
        { id: 'case-1', citation: 'Case 1' },
      ],
      edges: [
        { source: 'patent:123', target: 'claim:1', type: 'HAS_CLAIM' },
        { source: 'claim:1', target: 'case-1', type: 'CONSTRUED_IN' },
      ],
    })
    assert.equal(graph.nodes[0].label, '123')
    assert.equal(graph.nodes[0].color, NODE_COLORS.Patent)
    assert.equal(graph.nodes[1].holding, 'An apparatus')
    assert.equal(graph.nodes[1].scope_ruling, 'narrow')
    assert.equal(graph.edges[1].target, 'case-1')
  })

  it('exposes stored Neo4j similarity weights without interpreting citation weights as similarity', () => {
    const graph = normalizeGraph({
      nodes: [{ id: 'a' }, { id: 'b' }],
      edges: [
        { source: 'a', target: 'b', type: 'SIMILAR_TO', weight: 0.91 },
        { source: 'a', target: 'b', type: 'CITES', weight: 1 },
      ],
    })
    assert.equal(graph.edges[0].score, 0.91)
    assert.equal(graph.edges[1].score, undefined)
  })
})
