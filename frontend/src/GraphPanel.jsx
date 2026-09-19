import { Component, lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import CytoscapeComponent from 'react-cytoscapejs'
import cytoscape from 'cytoscape'
import dagre from 'cytoscape-dagre'
import { Download, Share2, Maximize, Plus, Minus, X, Route, RotateCcw, MessageSquare, Copy } from 'lucide-react'
import { EDGE_COLORS, NODE_COLORS, normalizeGraph, initialNodeIds, expandNodeIds, nodeSize } from './graphData'
import { analyzeGraph, encodeSnapshot, exportGraph } from './graphWorkspace'

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
      color: '#E8EDF5', 'font-size': 10, 'text-valign': 'bottom', 'text-halign': 'center',
      'text-margin-y': 5, width: 'data(diameter)', height: 'data(diameter)', shape: 'data(shape)',
      'text-wrap': 'wrap', 'text-max-width': 110, opacity: 'data(opacity)',
    },
  },
  { selector: 'node[type = "Patent"]', style: { shape: 'hexagon' } },
  { selector: 'node[type = "Claim"]', style: { shape: 'ellipse' } },
  { selector: 'node[?isAnchor]', style: { 'border-width': 3, 'border-color': '#F97316' } },
  { selector: 'node[?hasNote]', style: { 'border-width': 3, 'border-color': '#E879B9', 'border-style': 'double' } },
  { selector: 'node[?onPath]', style: { 'border-width': 4, 'border-color': '#FCD34D' } },
  { selector: 'node:selected', style: { 'border-width': 3, 'border-color': '#FCD34D' } },
  {
    selector: 'edge',
    style: {
      width: 1.5, 'line-color': 'data(color)', 'target-arrow-color': 'data(color)',
      'target-arrow-shape': 'triangle', 'curve-style': 'bezier', opacity: 'data(opacity)',
    },
  },
  {
    selector: 'edge[type = "SIMILAR_TO"]',
    style: { width: 1, 'line-style': 'dashed', 'target-arrow-shape': 'none' },
  },
  { selector: 'edge[?onPath]', style: { width: 4, 'line-color': '#FCD34D', 'target-arrow-color': '#FCD34D' } },
]

function Graph2D({ graph, selectedId, onSelect, resetKey, size, apiRef, initialView }) {
  const cyRef = useRef(null)
  const topologyRef = useRef('')
  const restoredRef = useRef(false)
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
    return () => {
      cy.off('tap', 'node', select)
      cy.off('tap', clear)
    }
  }, [graph, onSelect])

  useEffect(() => {
    const cy = cyRef.current
    const topology = JSON.stringify([graph.nodes.map(node => node.id), graph.edges.map(edge => edge.id)])
    if (topologyRef.current === topology) return
    topologyRef.current = topology
    cy.layout({ name: 'dagre', rankDir: 'BT', nodeSep: 50, rankSep: 85, fit: false }).run()
    if (!restoredRef.current && initialView) {
      cy.nodes().forEach(node => {
        if (initialView.positions?.[node.id()]) node.position(initialView.positions[node.id()])
      })
      if (initialView.zoom) cy.zoom(initialView.zoom)
      if (initialView.pan) cy.pan(initialView.pan)
    } else cy.fit(undefined, 45)
    restoredRef.current = true
  }, [graph, initialView])

  useEffect(() => {
    const cy = cyRef.current
    cy.nodes().unselect()
    if (selectedId) {
      const node = cy.getElementById(selectedId)
      if (node.length) {
        node.select()
      }
    }
  }, [selectedId, graph])

  useEffect(() => {
    cyRef.current?.resize()
  }, [size])

  useEffect(() => {
    if (resetKey) cyRef.current?.fit(undefined, 40)
  }, [resetKey])

  useEffect(() => {
    const cy = cyRef.current
    apiRef.current = {
      capture: () => ({ zoom: cy.zoom(), pan: cy.pan(), positions: Object.fromEntries(
        cy.nodes().map(node => [node.id(), { ...node.position() }]),
      ) }),
      png: full => cy.png({ full, scale: 2, bg: '#050A14', maxWidth: 4096, maxHeight: 4096 }),
      zoomBy: factor => cy.zoom({ level: cy.zoom() * factor,
        renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } }),
    }
    return () => { apiRef.current = null }
  }, [apiRef])

  return <CytoscapeComponent elements={elements} stylesheet={stylesheet}
    layout={{ name: 'preset' }} cy={bindCy} style={{ width: '100%', height: '100%' }} />
}

export default function GraphPanel({ memo, loading, selectedNode, onSelect }) {
  const shared = memo?._graphSnapshot
  const [mode, setMode] = useState(shared?.state.mode || '2d')
  const [hiddenTypes, setHiddenTypes] = useState(shared?.state.hiddenTypes || [])
  const [hiddenNodes, setHiddenNodes] = useState(shared?.state.hiddenNodes || [])
  const graph = useMemo(() => normalizeGraph(memo?.subgraph, memo?.anchor_cases), [memo])
  const [visibleIds, setVisibleIds] = useState(() => shared?.state.visibleIds || initialNodeIds(graph))
  const [focus, setFocus] = useState(shared?.state.focus ?? false)
  const [hops, setHops] = useState(shared?.state.hops ?? 1)
  const [metric, setMetric] = useState(shared?.state.metric || 'connections')
  const [from, setFrom] = useState(shared?.state.from || '')
  const [to, setTo] = useState(shared?.state.to || '')
  const [directed, setDirected] = useState(shared?.state.directed ?? false)
  const [pathOnly, setPathOnly] = useState(shared?.state.pathOnly ?? false)
  const [notes, setNotes] = useState(() => {
    try {
      const stored = JSON.parse(localStorage.getItem('patentgraph:notes') || '{}')
      return { ...Object.fromEntries(Object.entries(stored).filter(([, note]) => typeof note === 'string')), ...shared?.notes }
    } catch { return shared?.notes || {} }
  })
  const [status, setStatus] = useState('')
  const [shareOpen, setShareOpen] = useState(false)
  const [shareUrl, setShareUrl] = useState('')
  const [includeNotes, setIncludeNotes] = useState(false)
  const [shareFullGraph, setShareFullGraph] = useState(true)
  const [exportScope, setExportScope] = useState('viewport')
  const [busy, setBusy] = useState(false)
  const [resetKey, setResetKey] = useState(0)
  const [size, setSize] = useState({ width: 600, height: 500 })
  const containerRef = useRef(null)
  const apiRef = useRef(null)
  const [views, setViews] = useState({ [mode]: shared?.view })
  const dialogRef = useRef(null)
  const types = useMemo(() => [...new Set(graph.edges.map(e => e.type))].sort(), [graph])
  const nodeTypes = [...new Set(graph.nodes.map(node => node.type))].sort()
  const filteredGraph = useMemo(() => {
    const nodes = graph.nodes.filter(node => !hiddenNodes.includes(node.type))
    const ids = new Set(nodes.map(node => node.id))
    return { nodes, edges: graph.edges.filter(edge => !hiddenTypes.includes(edge.type) && ids.has(edge.source) && ids.has(edge.target)) }
  }, [graph, hiddenTypes, hiddenNodes])
  const analysis = useMemo(() => analyzeGraph(filteredGraph, selectedNode?.id, hops, from, to, directed),
    [filteredGraph, selectedNode?.id, hops, from, to, directed])
  const visibleGraph = useMemo(() => {
    const candidates = pathOnly && analysis.path ? analysis.path.nodes :
      [...(analysis.path?.nodes || []), ...(selectedNode ? [selectedNode.id] : []), ...visibleIds]
    const ids = new Set([...new Set(candidates)].slice(0, 50))
    const nodes = filteredGraph.nodes.filter(node => ids.has(node.id)).map(node => ({
      ...node, diameter: nodeSize(node, metric), hasNote: !!notes[node.id],
      onPath: analysis.path?.nodes.includes(node.id) || false,
      opacity: focus && selectedNode && !analysis.focusedIds.includes(node.id) ? 0.12 : 1,
    }))
    const shown = new Set(nodes.map(node => node.id))
    return { nodes, edges: filteredGraph.edges.filter(edge => shown.has(edge.source) && shown.has(edge.target) &&
      (!pathOnly || !analysis.path || analysis.path.edges.includes(edge.id))).map(edge => ({
      ...edge, onPath: analysis.path?.edges.includes(edge.id) || false,
      opacity: focus && selectedNode && (!analysis.focusedIds.includes(edge.source) || !analysis.focusedIds.includes(edge.target)) ? 0.07 : 0.8,
    })) }
  }, [filteredGraph, visibleIds, selectedNode, analysis, pathOnly, metric, notes, focus])

  const selectNode = useCallback(node => {
    onSelect(node)
    if (node) setVisibleIds(previous => expandNodeIds(filteredGraph, previous, node.id))
  }, [filteredGraph, onSelect])

  useEffect(() => {
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: Math.max(1, entry.contentRect.width), height: Math.max(1, entry.contentRect.height) })
    })
    observer.observe(containerRef.current)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (shareOpen) dialogRef.current?.showModal()
    else dialogRef.current?.close()
  }, [shareOpen])

  function toggleType(type, setter) {
    setter(previous => previous.includes(type)
      ? previous.filter(value => value !== type) : [...previous, type])
  }

  function saveNote(value) {
    setNotes(previous => ({ ...previous, [selectedNode.id]: value }))
    try {
      const stored = JSON.parse(localStorage.getItem('patentgraph:notes') || '{}')
      localStorage.setItem('patentgraph:notes', JSON.stringify({ ...stored, [selectedNode.id]: value }))
      setStatus('Note saved on this device.')
    } catch { setStatus('Browser storage unavailable. Note kept for this session only; include it in a shared link to preserve it.') }
  }

  function changeMode(value) {
    if (value === mode) return
    const currentView = apiRef.current?.capture()
    setViews(previous => ({ ...previous, [mode]: currentView }))
    setMode(value)
  }

  async function createLink() {
    try {
      if (!apiRef.current) throw new Error('The graph is not ready to share.')
      const snapshotGraph = shareFullGraph ? graph : visibleGraph
      const ids = new Set(snapshotGraph.nodes.map(node => node.id))
      const hash = encodeSnapshot({ version: 1, graph: snapshotGraph, notes: includeNotes ? Object.fromEntries(
        snapshotGraph.nodes.filter(node => notes[node.id]).map(node => [node.id, notes[node.id]]),
      ) : {}, state: { mode, hiddenTypes, hiddenNodes, visibleIds: visibleIds.filter(id => ids.has(id)), focus, hops, metric,
        from: ids.has(from) ? from : '', to: ids.has(to) ? to : '', directed, pathOnly,
        selectedId: ids.has(selectedNode?.id) ? selectedNode.id : '' }, view: apiRef.current.capture() })
      const url = new URL(window.location.href)
      url.hash = hash
      setShareUrl(url.href)
      try {
        await navigator.clipboard.writeText(url.href)
        setStatus('Snapshot link copied.')
      } catch { setStatus('Link ready. Select and copy the URL below.') }
    } catch (error) { setStatus(error.message) }
  }

  async function download(format) {
    setBusy(true)
    try {
      if (!apiRef.current) throw new Error('The graph is not ready to export.')
      const image = apiRef.current.png(mode === '2d' && exportScope === 'subgraph')
      await exportGraph(image, format, visibleGraph, metric)
      setStatus(`${format.toUpperCase()} exported.`)
    } catch (error) { setStatus(`Export failed: ${error.message}`) }
    finally { setBusy(false) }
  }

  return (
    <div className="graph-panel">
      <div className="graph-toolbar" aria-label="Graph controls">
        <div className="graph-modes" role="group" aria-label="Graph dimensions">
          {['2d', '3d'].map(value => <button key={value} className="pill"
            aria-pressed={mode === value} onClick={() => changeMode(value)}>{value.toUpperCase()}</button>)}
        </div>
        <button className="graph-icon" title="Fit graph" aria-label="Fit graph" disabled={!visibleGraph.nodes.length} onClick={() => setResetKey(value => value + 1)}><Maximize size={16} /></button>
        <button className="graph-icon" title="Zoom in" aria-label="Zoom in" disabled={!visibleGraph.nodes.length} onClick={() => apiRef.current?.zoomBy(1.3)}><Plus size={16} /></button>
        <button className="graph-icon" title="Zoom out" aria-label="Zoom out" disabled={!visibleGraph.nodes.length} onClick={() => apiRef.current?.zoomBy(1 / 1.3)}><Minus size={16} /></button>
        <button className="graph-icon" title="Collapse to starting nodes" aria-label="Collapse to starting nodes" onClick={() => {
          setVisibleIds(initialNodeIds(filteredGraph)); onSelect(null); setFrom(''); setTo(''); setPathOnly(false)
        }}><RotateCcw size={16} /></button>
        <span className="graph-count">{visibleGraph.nodes.length} / {graph.nodes.length} nodes · {visibleGraph.edges.length} relationships</span>
        <button className="graph-icon" title="Share graph snapshot" aria-label="Share graph snapshot" disabled={!graph.nodes.length} onClick={() => { setShareUrl(''); setShareOpen(true) }}><Share2 size={16} /></button>
        <label className="node-picker">Find node
          <select value={selectedNode?.id || ''} onChange={event => selectNode(
            filteredGraph.nodes.find(n => n.id === event.target.value) || null,
          )}>
            <option value="">Select node</option>
            {filteredGraph.nodes.map(node => <option key={node.id} value={node.id}>{node.type}: {node.label}</option>)}
          </select>
        </label>
      </div>
      <div className="graph-options">
        <label><input type="checkbox" checked={focus} onChange={event => setFocus(event.target.checked)} /> Focus</label>
        <label>Hops <input aria-label="Focus hops" type="number" min="0" max="5" value={hops} onChange={event => setHops(Math.max(0, Math.min(5, Number(event.target.value))))} /></label>
        <label>Size by <select value={metric} onChange={event => setMetric(event.target.value)}>
          <option value="connections">Connections</option><option value="citations">Incoming citations</option>
        </select></label>
      </div>
      <details className="graph-disclosure">
        <summary>Filters & paths</summary>
        <div className="graph-filters" role="group" aria-label="Node type filters">
          {nodeTypes.map(type => <label key={type}><input type="checkbox" checked={!hiddenNodes.includes(type)} onChange={() => {
            toggleType(type, setHiddenNodes)
            if (selectedNode?.type === type) onSelect(null)
          }} /><span style={{ color: NODE_COLORS[type] || '#94A3B8' }}>{type}</span></label>)}
        </div>
      {!!types.length && <div className="graph-filters" role="group" aria-label="Relationship filters">
        {types.map(type => <label key={type}>
          <input type="checkbox" checked={!hiddenTypes.includes(type)} onChange={() => toggleType(type, setHiddenTypes)} />
          <span style={{ color: EDGE_COLORS[type] || '#94A3B8' }}>{type.replaceAll('_', ' ')}</span>
        </label>)}
      </div>}
        <div className="path-controls">
          {[['From', from, setFrom], ['To', to, setTo]].map(([label, value, setter]) => <label key={label}>{label}
            <select value={value} onChange={event => setter(event.target.value)}><option value="">Select node</option>
              {filteredGraph.nodes.map(node => <option key={node.id} value={node.id}>{node.type}: {node.label}</option>)}
            </select></label>)}
          <label><input type="checkbox" checked={directed} onChange={event => setDirected(event.target.checked)} /> Follow arrows</label>
          <label><input type="checkbox" checked={pathOnly} onChange={event => setPathOnly(event.target.checked)} /> Path only</label>
        </div>
        {from && to && <div className="path-result" role="status">
          <Route size={14} /> {analysis.path ? `${analysis.path.edges.length} relationships${directed ? ' (directed)' : ' (either direction)'}` : 'No path with the current filters.'}
          {analysis.path?.nodes.length > 50 && <span>First 50 path nodes shown in the graph.</span>}
          {analysis.path && <ol>{analysis.path.nodes.map((id, index) => <li key={id}>
            <button onClick={() => selectNode(graph.nodes.find(node => node.id === id))}>{graph.nodes.find(node => node.id === id)?.label}</button>
            {analysis.path.edges[index] && (() => {
              const edge = graph.edges.find(value => value.id === analysis.path.edges[index])
              return <span> {edge.source === id ? '→' : '←'} {edge.type.replaceAll('_', ' ')}</span>
            })()}
          </li>)}</ol>}
        </div>}
      </details>
      <div className="graph-options export-controls">
        <label>Export <select aria-label="Export scope" value={mode === '3d' ? 'viewport' : exportScope} onChange={event => setExportScope(event.target.value)}>
          <option value="viewport">Current view</option><option value="subgraph" disabled={mode === '3d'}>Visible subgraph</option>
        </select></label>
        {['png', 'pdf'].map(format => <button key={format} className="graph-action" disabled={busy || !visibleGraph.nodes.length} onClick={() => download(format)}><Download size={14} /> {format.toUpperCase()}</button>)}
      </div>
      {visibleGraph.nodes.length >= 50 && <p className="graph-help" role="status">50-node view limit reached.</p>}
      {memo?.subgraph?.truncated && <p className="graph-help" role="status">Graph limited for readability; not all related nodes are shown.</p>}
      <div className="graph-stage">
      <div ref={containerRef} className="cy-container" aria-label={`${mode.toUpperCase()} patent knowledge graph`}>
        {visibleGraph.nodes.length ? (mode === '3d'
          ? <GraphBoundary key={mode} onFallback={() => setMode('2d')}>
              <Suspense fallback={<div className="graph-empty" role="status">Loading 3D renderer…</div>}>
                <Graph3D graph={visibleGraph} size={size} selectedId={selectedNode?.id}
                  onSelect={selectNode} resetKey={resetKey} apiRef={apiRef} initialView={views[mode]} />
              </Suspense>
            </GraphBoundary>
          : <Graph2D graph={visibleGraph} size={size} selectedId={selectedNode?.id}
              onSelect={selectNode} resetKey={resetKey} apiRef={apiRef} initialView={views[mode]} />)
          : <div className="graph-empty" role="status">
              {loading ? <div className="loading-msg">Traversing knowledge graph…</div>
                : graph.nodes.length ? 'No nodes match the current view. Adjust filters or collapse to starting nodes.' : memo ? 'No graph data was returned for this query.'
                  : 'Choose a sample question or enter your own to explore the graph.'}
            </div>}
      </div>
      {selectedNode && <div className="node-drawer">
        <button className="drawer-close" aria-label="Close node details" onClick={() => onSelect(null)}><X size={18} /></button>
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
        <div className="node-metrics">{selectedNode.connections} connections · {selectedNode.citations} incoming citations in this result</div>
        <div className="graph-options">
          <button className="graph-action" onClick={() => { setVisibleIds(expandNodeIds(filteredGraph, [selectedNode.id], selectedNode.id)); setPathOnly(false); setFrom(''); setTo('') }}>Explore from here</button>
          <button className="graph-action" onClick={() => setFrom(selectedNode.id)}>Set path start</button>
          <button className="graph-action" onClick={() => setTo(selectedNode.id)}>Set path end</button>
        </div>
        <label className="node-note"><span><MessageSquare size={14} /> Case narrative note</span>
          <textarea value={notes[selectedNode.id] || ''} maxLength={10000} rows={4} onChange={event => saveNote(event.target.value)} />
        </label>
        <div className="drawer-section-label">Connected relationships</div>
        <ul className="node-connections">
          {filteredGraph.edges.filter(e => e.source === selectedNode.id || e.target === selectedNode.id).map(edge => {
            const other = graph.nodes.find(n => n.id === (edge.source === selectedNode.id ? edge.target : edge.source))
            return <li key={edge.id}><button onClick={() => selectNode(other)}>
              {edge.source === selectedNode.id ? '→' : '←'} {edge.type.replaceAll('_', ' ')}: {other.label}
              {edge.score != null && ` (${Number(edge.score).toFixed(2)})`}
            </button></li>
          })}
        </ul>
        {!filteredGraph.edges.some(e => e.source === selectedNode.id || e.target === selectedNode.id) &&
          <p className="drawer-holding">No connections in this result.</p>}
      </div>}
      </div>
      <div className="legend">
        {nodeTypes.map(type => <span key={type} className="leg-item"><span className={`leg-symbol shape-${type}`} style={{ background: NODE_COLORS[type] || '#6B7280' }} />{type}</span>)}
        {types.map(type => <span key={type} className="leg-item"><span className={`leg-edge ${type === 'SIMILAR_TO' ? 'similarity' : ''}`} style={{ borderColor: EDGE_COLORS[type] || '#6B7280' }} />{type.replaceAll('_', ' ')}</span>)}
        <span>Orange ring: key case · Pink ring: note · Gold: selection/path</span>
        <span>Size: {metric === 'citations' ? 'incoming citations' : 'connections'} in this result</span>
      </div>
      {status && <div className="graph-status" role="status">{status}</div>}
      <dialog ref={dialogRef} className="share-dialog" onCancel={() => setShareOpen(false)} aria-labelledby="share-heading">
        <button className="drawer-close" aria-label="Close share dialog" onClick={() => setShareOpen(false)}><X size={18} /></button>
        <h2 id="share-heading">Share graph snapshot</h2>
        <p>Anyone with this link can read the graph data{includeNotes ? ' and included notes' : ''}. This is a snapshot, not a live shared workspace.</p>
        <label><input type="checkbox" checked={includeNotes} onChange={event => { setIncludeNotes(event.target.checked); setShareUrl('') }} /> Include case narrative notes</label>
        <label><input type="checkbox" checked={shareFullGraph} onChange={event => { setShareFullGraph(event.target.checked); setShareUrl('') }} /> Include unexpanded and filtered nodes</label>
        <button className="graph-action" onClick={createLink}><Copy size={16} /> Copy snapshot link</button>
        {shareUrl && <label className="share-link">Snapshot URL<textarea readOnly value={shareUrl} onFocus={event => event.target.select()} rows={3} /></label>}
        <p role="status">{status}</p>
      </dialog>
    </div>
  )
}
