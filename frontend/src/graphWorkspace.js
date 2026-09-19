import cytoscape from 'cytoscape'
import LZString from 'lz-string'
import { EDGE_COLORS, NODE_COLORS } from './graphData.js'

export async function exportGraph(imageUrl, format, graph, metric) {
  const image = new Image()
  image.src = imageUrl
  await image.decode()
  const entries = [
    ...[...new Set(graph.nodes.map(node => node.type))].map(type => [type, NODE_COLORS[type] || '#6B7280']),
    ...[...new Set(graph.edges.map(edge => edge.type))].map(type => [type.replaceAll('_', ' '), EDGE_COLORS[type] || '#6B7280']),
  ]
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1000, image.width)
  const columns = Math.max(1, Math.floor((canvas.width - 64) / 240))
  const imageScale = Math.min(canvas.width / image.width, 4096 / image.height)
  const graphHeight = image.height * imageScale
  canvas.height = graphHeight + 180 + Math.ceil(entries.length / columns) * 32
  const context = canvas.getContext('2d')
  context.fillStyle = '#050A14'
  context.fillRect(0, 0, canvas.width, canvas.height)
  context.drawImage(image, (canvas.width - image.width * imageScale) / 2, 70, image.width * imageScale, graphHeight)
  context.fillStyle = '#E8EDF5'
  context.font = 'bold 28px sans-serif'
  context.fillText('PatentGraph | Litigation graph', 32, 42)
  context.font = '18px sans-serif'
  context.fillText(`${graph.nodes.length} nodes | ${graph.edges.length} relationships | Size: ${metric === 'citations' ? 'incoming citations' : 'connections'} in result`, 32, graphHeight + 104)
  entries.forEach(([label, color], index) => {
    const left = 32 + (index % columns) * 240
    const top = graphHeight + 140 + Math.floor(index / columns) * 32
    context.fillStyle = color
    context.fillRect(left, top - 14, 14, 14)
    context.fillStyle = '#E8EDF5'
    context.fillText(label, left + 24, top, 205)
  })
  context.fillStyle = '#CBD5E1'
  context.font = '16px sans-serif'
  context.fillText('Orange ring: key case | Pink ring: note | Gold: selection/path | Arrows: direction | Similarity is not a citation', 32, canvas.height - 24, canvas.width - 64)
  const png = canvas.toDataURL('image/png')
  if (format === 'pdf') {
    const { jsPDF } = await import('jspdf')
    const pdf = new jsPDF({ orientation: canvas.width > canvas.height ? 'landscape' : 'portrait', unit: 'pt', format: 'a4' })
    const width = pdf.internal.pageSize.getWidth() - 48
    const height = pdf.internal.pageSize.getHeight() - 48
    const ratio = Math.min(width / canvas.width, height / canvas.height)
    pdf.addImage(png, 'PNG', 24, 24, canvas.width * ratio, canvas.height * ratio)
    pdf.save('patentgraph.pdf')
  } else {
    const link = document.createElement('a')
    link.href = png
    link.download = 'patentgraph.png'
    link.click()
  }
}

export function analyzeGraph(graph, selectedId, hops, from, to, directed = false) {
  const cy = cytoscape({ headless: true, elements: [
    ...graph.nodes.map(node => ({ data: { id: node.id } })),
    ...graph.edges.map(edge => ({ data: { ...edge, id: `edge:${edge.id}` } })),
  ] })
  try {
    let neighborhood = cy.getElementById(selectedId || '')
    for (let step = 0; step < hops; step += 1) neighborhood = neighborhood.closedNeighborhood()
    const focusedIds = neighborhood.nodes().map(node => node.id())
    const source = cy.getElementById(from || '')
    const target = cy.getElementById(to || '')
    let path = null
    if (source.length && target.length) {
      const result = cy.elements().dijkstra({ root: source, directed })
      if (Number.isFinite(result.distanceTo(target))) {
        const route = result.pathTo(target)
        path = {
          nodes: route.nodes().map(node => node.id()),
          edges: route.edges().map(edge => edge.id().slice(5)),
        }
      }
    }
    return { focusedIds, path }
  } finally {
    cy.destroy()
  }
}

const finitePoint = point => point && ['x', 'y', 'z'].every(key =>
  point[key] === undefined || Number.isFinite(point[key]),
) && Number.isFinite(point.x) && Number.isFinite(point.y)

export function validateSnapshot(snapshot) {
  if (snapshot?.version !== 1 || !Array.isArray(snapshot.graph?.nodes) ||
    !Array.isArray(snapshot.graph?.edges) || snapshot.graph.nodes.length > 2000 ||
    snapshot.graph.edges.length > 10000) throw new Error('Unsupported or oversized graph link.')
  if (snapshot.graph.nodes.some(node => !node || typeof node.id !== 'string') ||
    snapshot.graph.edges.some(edge => !edge || typeof edge.source !== 'string' || typeof edge.target !== 'string')) {
    throw new Error('Invalid graph data in link.')
  }
  const textFields = ['type', 'label', 'citation', 'holding', 'holding_summary', 'text_excerpt', 'court', 'date', 'date_filed', 'scope_ruling']
  if (snapshot.graph.nodes.some(node => textFields.some(key => node[key] != null && typeof node[key] !== 'string')) ||
    snapshot.graph.edges.some(edge => edge.type != null && typeof edge.type !== 'string')) {
    throw new Error('Invalid graph labels in link.')
  }
  const state = snapshot.state
  if (!state || !['2d', '3d'].includes(state.mode) ||
    !['connections', 'citations'].includes(state.metric) ||
    !Number.isInteger(state.hops) || state.hops < 0 || state.hops > 5 ||
    ['hiddenTypes', 'hiddenNodes', 'visibleIds'].some(key => !Array.isArray(state[key]) ||
      state[key].some(value => typeof value !== 'string')) || state.visibleIds.length > 50 ||
    ['selectedId', 'from', 'to'].some(key => typeof state[key] !== 'string') ||
    ['focus', 'directed', 'pathOnly'].some(key => typeof state[key] !== 'boolean')) {
    throw new Error('Invalid graph state in link.')
  }
  if (snapshot.notes && (typeof snapshot.notes !== 'object' || Array.isArray(snapshot.notes) ||
    Object.values(snapshot.notes).some(note => typeof note !== 'string' || note.length > 10000))) {
    throw new Error('Invalid notes in link.')
  }
  const view = snapshot.view
  if (view && (typeof view !== 'object' || Array.isArray(view) ||
    (view.zoom !== undefined && (!Number.isFinite(view.zoom) || view.zoom <= 0)) ||
    (view.pan && !finitePoint(view.pan)) ||
    (view.camera && (!finitePoint(view.camera.position) || !Number.isFinite(view.camera.position.z) ||
      !finitePoint(view.camera.target) || !Number.isFinite(view.camera.target.z) ||
      (view.camera.up && (!finitePoint(view.camera.up) || !Number.isFinite(view.camera.up.z))))) ||
    (view.positions && (typeof view.positions !== 'object' || Array.isArray(view.positions) ||
      Object.values(view.positions).some(point => !finitePoint(point) || (state.mode === '3d' && !Number.isFinite(point.z))))))) {
    throw new Error('Invalid viewport in link.')
  }
  return snapshot
}

export function encodeSnapshot(snapshot) {
  validateSnapshot(snapshot)
  const encoded = LZString.compressToEncodedURIComponent(JSON.stringify(snapshot))
  if (encoded.length > 60000) throw new Error('This snapshot is too large for a link. Reduce the graph before sharing.')
  return `#graph=${encoded}`
}

export function decodeSnapshot(hash) {
  if (!hash.startsWith('#graph=')) return null
  if (hash.length > 60007) throw new Error('Graph link is too large.')
  try {
    const decoded = LZString.decompressFromEncodedURIComponent(hash.slice(7))
    if (!decoded || decoded.length > 2000000) throw new Error('Invalid snapshot')
    return validateSnapshot(JSON.parse(decoded))
  } catch {
    throw new Error('This graph link is invalid, incomplete, or unsupported.')
  }
}

export function readSharedGraph() {
  try {
    return { snapshot: decodeSnapshot(window.location.hash), error: '' }
  } catch (error) {
    return { snapshot: null, error: error.message }
  }
}