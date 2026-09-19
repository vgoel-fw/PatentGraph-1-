export const NODE_COLORS = {
  Case: '#8B5CF6',
  Patent: '#22C55E',
  Claim: '#38BDF8',
  Litigant: '#E879B9',
  Court: '#FACC15',
  Inventor: '#2DD4BF',
  Assignee: '#FB923C',
  anchor: '#F97316',
}

export const NODE_SHAPES = {
  Case: 'round-rectangle', Patent: 'hexagon', Claim: 'ellipse',
  Litigant: 'diamond', Court: 'triangle', Inventor: 'ellipse', Assignee: 'rectangle',
}

export const EDGE_COLORS = {
  CITES: '#A78BFA',
  SIMILAR_TO: '#94A3B8',
  HAS_CLAIM: '#22C55E',
  CONSTRUED_IN: '#38BDF8',
  OWNS: '#FB923C',
  ASSIGNED_TO: '#FB923C',
  INVENTED_BY: '#2DD4BF',
  LITIGATED_BY: '#E879B9',
  HEARD_IN: '#FACC15',
}

// Both renderers use the same graph; force-graph receives its own mutable copy.
export function normalizeGraph(subgraph, anchors = []) {
  const anchorIds = new Set(anchors.map(String))
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
      holding: node.holding_summary || node.text_excerpt || node.holding || '',
      date: node.date || node.date_filed,
      isAnchor: anchorIds.has(id),
      color: NODE_COLORS[type] || '#6B7280',
      shape: NODE_SHAPES[type] || 'round-rectangle',
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
  const edges = [...edgesById.values()]
  const nodes = [...nodesById.values()].map(node => ({
    ...node,
    connections: edges.filter(edge => edge.source === node.id || edge.target === node.id).length,
    citations: edges.filter(edge => edge.type === 'CITES' && edge.target === node.id).length,
  }))
  return { nodes, edges }
}

export function nodeSize(node, metric) {
  return 24 + Math.min(40, Math.sqrt(node[metric] || 0) * 9)
}

export function initialNodeIds(graph, limit = 12) {
  return [...graph.nodes].sort((left, right) =>
    Number(right.isAnchor) - Number(left.isAnchor) || right.connections - left.connections,
  ).slice(0, limit).map(node => node.id)
}

export function expandNodeIds(graph, visibleIds, selectedId, limit = 50) {
  const visible = new Set([selectedId, ...visibleIds])
  for (const edge of graph.edges) {
    if (visible.size >= limit) break
    if (edge.source === selectedId) visible.add(edge.target)
    if (edge.target === selectedId) visible.add(edge.source)
  }
  return [...visible].slice(0, limit)
}

export function graphTooltip(text) {
  const label = document.createElement('span')
  label.textContent = text
  return label
}
