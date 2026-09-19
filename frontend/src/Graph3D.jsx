import { useEffect, useMemo, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { EDGE_COLORS, graphTooltip } from './graphData'

export default function Graph3D({ graph, size, selectedId, onSelect, resetKey }) {
  const ref = useRef(null)
  const fitted = useRef(false)
  const data = useMemo(() => ({
    nodes: graph.nodes.map(node => ({ ...node })),
    links: graph.edges.map(edge => ({ ...edge })),
  }), [graph])

  useEffect(() => {
    fitted.current = false
  }, [data])

  useEffect(() => {
    ref.current?.zoomToFit(400, 50)
  }, [resetKey])

  useEffect(() => {
    const node = data.nodes.find(n => n.id === selectedId)
    if (!node || ![node.x, node.y, node.z].every(Number.isFinite)) return
    const distance = 100
    const ratio = 1 + distance / Math.max(Math.hypot(node.x, node.y, node.z), 1)
    ref.current?.cameraPosition(
      { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio + distance / 2 },
      { x: node.x, y: node.y, z: node.z },
      600,
    )
  }, [selectedId, data])

  return (
    <ForceGraph3D
      ref={ref}
      graphData={data}
      width={size.width}
      height={size.height}
      backgroundColor="#050A14"
      nodeLabel={node => graphTooltip(`${node.type}: ${node.label}`)}
      nodeColor={node => node.id === selectedId ? '#FCD34D' : node.color}
      nodeVal={node => node.isAnchor ? 8 : 4}
      linkColor={edge => EDGE_COLORS[edge.type] || '#6B7280'}
      linkWidth={edge => edge.type === 'SIMILAR_TO' ? 0.5 : 1.3}
      linkOpacity={0.75}
      linkDirectionalArrowLength={edge => edge.type === 'SIMILAR_TO' ? 0 : 4}
      linkDirectionalArrowRelPos={0.9}
      linkLabel={edge => graphTooltip(
        `${edge.type}${edge.score != null ? ` · similarity ${edge.score}` : ''}`,
      )}
      onNodeClick={node => onSelect(graph.nodes.find(n => n.id === node.id))}
      onBackgroundClick={() => onSelect(null)}
      cooldownTicks={120}
      onEngineStop={() => {
        if (!fitted.current) {
          ref.current?.zoomToFit(400, 50)
          fitted.current = true
        }
      }}
    />
  )
}
