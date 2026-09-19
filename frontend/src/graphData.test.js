import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeGraph, NODE_COLORS, nodeSize, initialNodeIds, expandNodeIds } from './graphData.js'
import { analyzeGraph, encodeSnapshot, decodeSnapshot } from './graphWorkspace.js'

describe('graph workspace', () => {
  const graph = normalizeGraph({
    nodes: ['a', 'b', 'c', 'isolated'].map(id => ({ id })),
    edges: [{ source: 'a', target: 'b', type: 'CITES' }, { source: 'b', target: 'c', type: 'OWNS' }],
  })

  it('finds shortest connections with optional direction and handles disconnected endpoints', () => {
    assert.deepEqual(analyzeGraph(graph, 'a', 1, 'c', 'a').path.nodes, ['c', 'b', 'a'])
    assert.equal(analyzeGraph(graph, 'a', 1, 'c', 'a', true).path, null)
    assert.equal(analyzeGraph(graph, 'a', 1, 'a', 'isolated').path, null)
    assert.deepEqual(analyzeGraph(graph, 'a', 0, 'a', 'a').path.nodes, ['a'])
    const filtered = { ...graph, edges: graph.edges.filter(edge => edge.type !== 'OWNS') }
    assert.equal(analyzeGraph(filtered, 'a', 1, 'a', 'c').path, null)
  })

  it('uses hop distance for focus without hiding unrelated nodes', () => {
    assert.deepEqual(analyzeGraph(graph, 'a', 0).focusedIds, ['a'])
    assert.deepEqual(new Set(analyzeGraph(graph, 'a', 1).focusedIds), new Set(['a', 'b']))
    assert.deepEqual(new Set(analyzeGraph(graph, 'a', 2).focusedIds), new Set(['a', 'b', 'c']))
    assert.equal(graph.nodes.length, 4)
  })

  it('expands only one hop and respects filtered relationships', () => {
    assert.deepEqual(expandNodeIds(graph, ['a'], 'a'), ['a', 'b'])
    const filtered = { ...graph, edges: [] }
    assert.deepEqual(expandNodeIds(filtered, ['a'], 'a'), ['a'])
  })

  it('round-trips graph, filters, notes, selection, positions, and camera state', () => {
    const snapshot = { version: 1, graph, notes: { a: 'Client context: \u00a7 101' }, state: {
      mode: '2d', metric: 'citations', hops: 2, hiddenTypes: ['OWNS'], hiddenNodes: [],
      visibleIds: ['a', 'b'], selectedId: 'a', from: 'a', to: 'b', focus: true, directed: false, pathOnly: false,
    }, view: { zoom: 1.5, pan: { x: 12, y: 42 }, positions: { a: { x: 10, y: 20 } },
      camera: { position: { x: 1, y: 2, z: 3 }, target: { x: 0, y: 0, z: 0 } } } }
    assert.deepEqual(decodeSnapshot(encodeSnapshot(snapshot)), JSON.parse(JSON.stringify(snapshot)))
    assert.equal(decodeSnapshot(''), null)
    assert.throws(() => decodeSnapshot('#graph=broken'))
    assert.throws(() => encodeSnapshot({ ...snapshot, version: 2 }))
    assert.throws(() => encodeSnapshot({ ...snapshot, view: { zoom: -1 } }))
    assert.throws(() => encodeSnapshot({ ...snapshot, graph: { ...graph, nodes: [{ id: 'a', label: {} }] } }))
    assert.throws(() => encodeSnapshot({ ...snapshot, state: { ...snapshot.state, hops: 6 } }))
    assert.throws(() => encodeSnapshot({ ...snapshot, notes: { a: { unexpected: 'object' } } }))
    assert.throws(() => encodeSnapshot({ ...snapshot, view: { camera: { position: { x: 1, y: 2 }, target: { x: 0, y: 0, z: 0 } } } }))
  })
})

describe('shared 2D/3D graph data', () => {
  it('starts small, expands one hop, and keeps a selected node within the cap', () => {
    const graph = normalizeGraph({
      nodes: Array.from({ length: 80 }, (_, index) => ({ id: String(index) })),
      edges: Array.from({ length: 79 }, (_, index) => ({ source: '0', target: String(index + 1) })),
    }, ['79'])
    const initial = initialNodeIds(graph)
    assert.equal(initial.length, 12)
    assert.equal(initial[0], '79')
    const expanded = expandNodeIds(graph, initial, '0')
    assert.equal(expanded.length, 50)
    assert.ok(expandNodeIds(graph, expanded, '78').includes('78'))
  })

  it('sizes nodes by measured degree or incoming citations and preserves entity types', () => {
    const graph = normalizeGraph({
      nodes: [{ id: 'a', type: 'Court' }, { id: 'b', type: 'Inventor' }, { id: 'c', type: 'Assignee' }],
      edges: [{ source: 'b', target: 'a', type: 'CITES' }, { source: 'c', target: 'a', type: 'HEARD_IN' }],
    })
    assert.equal(graph.nodes[0].connections, 2)
    assert.equal(graph.nodes[0].citations, 1)
    assert.equal(graph.nodes[0].shape, 'triangle')
    assert.ok(nodeSize(graph.nodes[0], 'connections') > nodeSize(graph.nodes[1], 'connections'))
    assert.equal(nodeSize(graph.nodes[1], 'citations'), 24)
  })

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
    assert.equal(graph.nodes[0].color, NODE_COLORS.Case)
    assert.equal(graph.nodes[0].isAnchor, true)
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
