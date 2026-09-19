import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { EDGE_COLORS, NODE_COLORS, normalizeGraph } from './graphData'

cytoscape.use(dagre)
const Graph3D = lazy(() => import('./Graph3D'))

class GraphBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? <div className="graph-empty" role="alert">
          <p>3D could not start. WebGL may be unavailable in this browser.</p>
          <button className="pill" onClick={this.props.onFallback}>Return to 2D</button>
        </div>
      : this.props.children
  }
}

const stylesheet = [
  {
    selector: 'node',
    style: {
      'background-color': 'data(color)', label: 'data(shortLabel)',
      color: '#fff', 'font-size': 9, 'text-valign': 'center', 'text-halign': 'center',
      width: 100, height: 40, shape: 'round-rectangle', 'text-wrap': 'wrap', 'text-max-width': 94,
    },
  },
  { selector: 'node[type = "Patent"]', style: { shape: 'hexagon' } },
  { selector: 'node[type = "Claim"]', style: { shape: 'ellipse' } },
  { selector: 'node[?isAnchor]', style: { 'border-width': 3, 'border-color': '#fff' } },
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#FCD34D' } },
  {
    selector: 'edge',
    style: {
      width: 1.5, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)',
      'target-arrow-shape': 'triangle', 'curve-style': 'bezier', opacity: 0.75,
    },
  },
  {
    selector: 'edge[type = "SIMILAR_TO"]',
    style: { width: 1, 'line-style': 'dashed', 'target-arrow-shape': 'none', opacity: 0.5 },
  },
]

function Graph2D({ graph, selectedId, onSelect, resetKey, size }) {
  const cyRef = useRef(null)
  const elements = useMemo(() => [
    ...graph.nodes.map(n => ({ data: { ...n, shortLabel: n.label.slice(0, 32) } })),
    ...graph.edges.map(e => ({ data: { ...e, id: `edge:${e.id}`, color: EDGE_COLORS[e.type] || '#6B7280' } })),
  ], [graph])
  const bindCy = useCallback(cy => { cyRef.current = cy }, [])

  useEffect(() => {
    const cy = cyRef.current
    const select = event => onSelect(graph.nodes.find(n => n.id === event.target.id()))
    const clear = event => { if (event.target === cy) onSelect(null) }
    cy.on('tap', 'node', select)
    cy.on('tap', clear)
    const layout = cy.layout({ name: 'dagre', rankDir: 'BT', nodeSep: 45, rankSep: 70, padding: 40 })
    layout.run()
    return () => {
      layout.stop()
      cy.off('tap', 'node', select)
      cy.off('tap', clear)
    }
  }, [graph, onSelect])

  useEffect(() => {
    const cy = cyRef.current
    cy.nodes().unselect()
    if (selectedId) {
      const node = cy.getElementById(selectedId)
      if (node.length) {
        node.select()
        cy.animate({ fit: { eles: node, padding: 100 } }, { duration: 400 })
      }
    }
  }, [selectedId, graph])

  useEffect(() => {
    cyRef.current?.resize()
    cyRef.current?.fit(undefined, 40)
  }, [resetKey, size])

  return <CytoscapeComponent elements={elements} stylesheet={stylesheet}
    layout={{ name: 'preset' }} cy={bindCy} style={{ width: '100%', height: '100%' }} />
}

export default function GraphPanel({ memo, loading, selectedNode, onSelect }) {
  const [mode, setMode] = useState('2d')
  const [hiddenTypes, setHiddenTypes] = useState([])
  const [resetKey, setResetKey] = useState(0)
  const [size, setSize] = useState({ width: 600, height: 500 })
  const containerRef = useRef(null)
  const graph = useMemo(() => normalizeGraph(memo?.subgraph, memo?.anchor_cases), [memo])
  const types = useMemo(() => [...new Set(graph.edges.map(e => e.type))].sort(), [graph])
  const visibleGraph = useMemo(() => ({
    nodes: graph.nodes,
    edges: graph.edges.filter(e => !hiddenTypes.includes(e.type)),
  }), [graph, hiddenTypes])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  function toggleType(type) {
    setHiddenTypes(previous => previous.includes(type)
      ? previous.filter(value => value !== type) : [...previous, type])
  }

  return (
    <div className="graph-panel">
      <div className="graph-toolbar" aria-label="Graph controls">
        <div className="graph-modes" role="group" aria-label="Graph dimensions">
          {['2d', '3d'].map(value => <button key={value} className="pill"
            aria-pressed={mode === value} onClick={() => setMode(value)}>{value.toUpperCase()}</button>)}
        </div>
        <button className="pill" disabled={!graph.nodes.length} onClick={() => setResetKey(k => k + 1)}>Fit graph</button>
        <span className="graph-count">{graph.nodes.length} nodes · {visibleGraph.edges.length} relationships</span>
        <label className="node-picker">Find node
          <select value={selectedNode?.id || ''} onChange={event => onSelect(
            graph.nodes.find(n => n.id === event.target.value) || null,
          )}>
            <option value="">Select a patent, claim or case</option>
            {graph.nodes.map(node => <option key={node.id} value={node.id}>{node.type}: {node.label}</option>)}
          </select>
        </label>
      </div>
      {!!types.length && <div className="graph-filters" role="group" aria-label="Relationship filters">
        {types.map(type => <label key={type}>
          <input type="checkbox" checked={!hiddenTypes.includes(type)} onChange={() => toggleType(type)} />
          <span style={{ color: EDGE_COLORS[type] }}>{type.replaceAll('_', ' ')}</span>
        </label>)}
      </div>}
      <p className="graph-help">
        {mode === '3d' ? 'Drag to rotate · Scroll to zoom · Right-drag to pan' : 'Drag to pan or move nodes · Scroll to zoom'}
        {' · Select a node for details'}
      </p>
      {memo?.subgraph?.truncated && <p className="graph-help" role="status">Graph limited for readability; not all related nodes are shown.</p>}
      <div ref={containerRef} className="cy-container" aria-label={`${mode.toUpperCase()} patent knowledge graph`}>
        {graph.nodes.length ? (mode === '3d'
          ? <GraphBoundary key={mode} onFallback={() => setMode('2d')}>
              <Suspense fallback={<div className="graph-empty" role="status">Loading 3D renderer…</div>}>
                <Graph3D graph={visibleGraph} size={size} selectedId={selectedNode?.id}
                  onSelect={onSelect} resetKey={resetKey} />
              </Suspense>
            </GraphBoundary>
          : <Graph2D graph={visibleGraph} size={size} selectedId={selectedNode?.id}
              onSelect={onSelect} resetKey={resetKey} />)
          : <div className="graph-empty" role="status">
              {loading ? <div className="loading-msg">Traversing knowledge graph…</div>
                : memo ? 'No graph data was returned for this query.'
                  : 'Choose a sample question or enter your own to explore the graph.'}
            </div>}
      </div>
      {selectedNode && <div className="node-drawer">
        <button className="drawer-close" aria-label="Close node details" onClick={() => onSelect(null)}>✕</button>
        <div className="drawer-badges">
          <span className={`drawer-badge ${selectedNode.isAnchor ? 'anchor' : 'related'}`}>
            {selectedNode.isAnchor ? 'Key Case' : selectedNode.type}
          </span>
          {selectedNode.hops > 0 && <span className="drawer-badge hops">{selectedNode.hops} citation hops</span>}
        </div>
        <div className="drawer-citation">{selectedNode.label || selectedNode.citation}</div>
        <div className="drawer-meta">{selectedNode.court} {selectedNode.date && ` · ${selectedNode.date.slice(0, 4)}`}</div>
        <div className="drawer-section-label">{selectedNode.type === 'Case' ? 'What the court decided' : 'Details'}</div>
        <div className="drawer-holding">{selectedNode.holding || 'No summary available.'}</div>
        {selectedNode.scope_ruling && <div className="drawer-holding">Scope ruling: {selectedNode.scope_ruling}</div>}
        <div className="drawer-section-label">Connected relationships</div>
        <ul className="node-connections">
          {graph.edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id).map(edge => {
            const other = graph.nodes.find(n => n.id === (edge.source === selectedNode.id ? edge.target : edge.source))
            return <li key={edge.id}><button onClick={() => onSelect(other)}>
              {edge.source === selectedNode.id ? '→' : '←'} {edge.type.replaceAll('_', ' ')}: {other.label}
              {edge.score != null && ` (${Number(edge.score).toFixed(2)})`}
            </button></li>
          })}
        </ul>
        {!graph.edges.some(e => e.source === selectedNode.id || e.target === selectedNode.id) &&
          <p className="drawer-holding">No connections in this result.</p>}
      </div>}
      <div className="legend">
        {Object.entries(NODE_COLORS).filter(([type]) => type === 'anchor' || graph.nodes.some(n => n.type === type))
          .map(([type, color]) => <span key={type} className="leg-item"><span className="leg-dot" style={{ background: color }} />{type}</span>)}
        <span>Arrows show direction · Similarity is not a citation</span>
      </div>
    </div>
  )
}
