export const NODE_COLORS = {
  Case: '#8B5CF6',
  Patent: '#22C55E',
  Claim: '#38BDF8',
  anchor: '#F97316',
}

export const EDGE_COLORS = {
  CITES: '#A78BFA',
  SIMILAR_TO: '#94A3B8',
  HAS_CLAIM: '#22C55E',
  CONSTRUED_IN: '#38BDF8',
}

// Both renderers use the same graph; force-graph receives its own mutable copy.
export function normalizeGraph(subgraph, anchors = []) {
  const anchorIds = new Set(anchors)
  const nodesById = new Map()
  for (const node of subgraph?.nodes || []) {
    if (node.id == null || nodesById.has(String(node.id))) continue
    const id = String(node.id)
    const type = node.type || 'Case'
    nodesById.set(id, {
      ...node,
      id,
      type,
      label: String(node.label || node.citation || node.number || id),
      holding: node.holding_summary || node.text_excerpt || '',
      date: node.date || node.date_filed,
      isAnchor: anchorIds.has(id),
      color: anchorIds.has(id) ? NODE_COLORS.anchor : (NODE_COLORS[type] || '#6B7280'),
    })
  }
  const edgesById = new Map()
  for (const edge of subgraph?.edges || []) {
    const source = String(edge.source)
    const target = String(edge.target)
    if (!nodesById.has(source) || !nodesById.has(target)) continue
    const type = edge.type || 'RELATED'
    const id = JSON.stringify([source, target, type])
    if (!edgesById.has(id)) edgesById.set(id, {
      ...edge, id, source, target, type,
      score: edge.score ?? (type === 'SIMILAR_TO' ? edge.weight : undefined),
    })
  }
  return { nodes: [...nodesById.values()], edges: [...edgesById.values()] }
}

export function graphTooltip(text) {
  const label = document.createElement('span')
  label.textContent = text
  return label
}
