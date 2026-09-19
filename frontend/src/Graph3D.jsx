import { useCallback, useEffect, useMemo, useRef } from 'react'
import ForceGraph3D from 'react-force-graph-3d'
import { BoxGeometry, ConeGeometry, CylinderGeometry, OctahedronGeometry, SphereGeometry,
  TorusGeometry, Group, Mesh, MeshLambertMaterial, CanvasTexture, Sprite, SpriteMaterial,
  Line, LineDashedMaterial, BufferGeometry, Float32BufferAttribute } from 'three'
import { EDGE_COLORS, graphTooltip } from './graphData'

const rendererConfig = { preserveDrawingBuffer: true }

function nodeObject(node, selected) {
  const radius = node.diameter / 9
  const geometry = node.type === 'Patent' ? new CylinderGeometry(radius, radius, radius, 6)
    : node.type === 'Court' ? new ConeGeometry(radius, radius * 2, 3)
      : node.type === 'Litigant' ? new OctahedronGeometry(radius)
        : ['Case', 'Assignee'].includes(node.type) ? new BoxGeometry(radius * 1.6, radius * 1.6, radius)
          : new SphereGeometry(radius, 16, 12)
  const group = new Group()
  group.add(new Mesh(geometry, new MeshLambertMaterial({ color: node.color, transparent: true, opacity: node.opacity })))
  if (selected || node.onPath || node.hasNote || node.isAnchor) {
    group.add(new Mesh(new TorusGeometry(radius * 1.35, 0.4, 6, 32), new MeshLambertMaterial({
      color: selected || node.onPath ? '#FCD34D' : node.hasNote ? '#E879B9' : '#F97316',
      transparent: true, opacity: node.opacity,
    })))
  }
  const canvas = document.createElement('canvas')
  canvas.width = 512
  canvas.height = 64
  const context = canvas.getContext('2d')
  context.font = '24px sans-serif'
  context.fillStyle = '#E8EDF5'
  context.textAlign = 'center'
  context.fillText(node.label.slice(0, 38), 256, 36, 500)
  const label = new Sprite(new SpriteMaterial({ map: new CanvasTexture(canvas), transparent: true, opacity: node.opacity }))
  label.scale.set(40, 5, 1)
  label.position.y = -radius - 5
  group.add(label)
  return group
}

export default function Graph3D({ graph, size, selectedId, onSelect, resetKey, apiRef, initialView }) {
  const ref = useRef(null)
  const fitted = useRef(false)
  const cameraRestored = useRef(false)
  const topology = JSON.stringify({ nodes: graph.nodes.map(node => ({ id: node.id })),
    links: graph.edges.map(edge => ({ id: edge.id, source: edge.source, target: edge.target, type: edge.type, score: edge.score })) })
  const data = useMemo(() => {
    const result = JSON.parse(topology)
    result.nodes.forEach(node => {
      const position = initialView?.positions?.[node.id]
      if (position) Object.assign(node, position, { fx: position.x, fy: position.y, fz: position.z })
    })
    return result
  }, [topology, initialView])
  const objects = useMemo(() => new Map(graph.nodes.map(node => [node.id, nodeObject(node, node.id === selectedId)])), [graph.nodes, selectedId])
  const objectForNode = useCallback(node => objects.get(node.id), [objects])
  const dashedLinks = useMemo(() => new Map(graph.edges.filter(edge => edge.type === 'SIMILAR_TO').map(edge => {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3))
    return [edge.id, new Line(geometry, new LineDashedMaterial({
      color: edge.onPath ? '#FCD34D' : EDGE_COLORS.SIMILAR_TO, dashSize: 3, gapSize: 2,
      transparent: true, opacity: edge.opacity,
    }))]
  })), [graph.edges])
  const objectForLink = useCallback(edge => dashedLinks.get(edge.id), [dashedLinks])
  const nodesById = new Map(graph.nodes.map(node => [node.id, node]))
  const edgesById = new Map(graph.edges.map(edge => [edge.id, edge]))

  useEffect(() => () => objects.forEach(object => object.traverse(child => {
    child.geometry?.dispose()
    child.material?.map?.dispose()
    child.material?.dispose()
  })), [objects])

  useEffect(() => () => dashedLinks.forEach(line => {
    line.geometry.dispose()
    line.material.dispose()
  }), [dashedLinks])

  useEffect(() => {
    fitted.current = false
  }, [data])

  useEffect(() => {
    if (resetKey) ref.current?.zoomToFit(400, 50)
  }, [resetKey])

  useEffect(() => {
    const instance = ref.current
    if (initialView?.camera && !cameraRestored.current) {
      instance.cameraPosition(initialView.camera.position, initialView.camera.target, 0)
      if (initialView.camera.up) instance.camera().up.copy(initialView.camera.up)
    }
    cameraRestored.current = true
    apiRef.current = {
      capture: () => {
        const camera = instance.camera()
        const target = instance.controls().target
        return { camera: { position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
          target: { x: target.x, y: target.y, z: target.z }, up: { x: camera.up.x, y: camera.up.y, z: camera.up.z } },
        positions: Object.fromEntries(data.nodes.filter(node => [node.x, node.y, node.z].every(Number.isFinite))
          .map(node => [node.id, { x: node.x, y: node.y, z: node.z }])) }
      },
      png: () => {
        instance.renderer().render(instance.scene(), instance.camera())
        return instance.renderer().domElement.toDataURL('image/png')
      },
      zoomBy: factor => {
        const camera = instance.camera()
        const target = instance.controls().target
        const position = camera.position.clone().sub(target).multiplyScalar(1 / factor).add(target)
        instance.cameraPosition(position, target, 150)
      },
    }
    return () => { apiRef.current = null }
  }, [apiRef, data, initialView])

  return (
    <ForceGraph3D
      ref={ref}
      graphData={data}
      rendererConfig={rendererConfig}
      width={size.width}
      height={size.height}
      backgroundColor="#050A14"
      nodeLabel={node => graphTooltip(`${nodesById.get(node.id)?.type}: ${nodesById.get(node.id)?.label}`)}
      nodeThreeObject={objectForNode}
      nodeVal={node => (nodesById.get(node.id)?.diameter / 12) ** 3}
      linkColor={edge => edgesById.get(edge.id)?.opacity < 0.1 ? '#182333'
        : edgesById.get(edge.id)?.onPath ? '#FCD34D' : EDGE_COLORS[edge.type] || '#6B7280'}
      linkWidth={edge => edgesById.get(edge.id)?.onPath ? 2.5 : edge.type === 'SIMILAR_TO' ? 0.5 : 1.3}
      linkOpacity={0.75}
      linkThreeObject={objectForLink}
      linkPositionUpdate={(object, { start, end }, edge) => {
        if (edge.type !== 'SIMILAR_TO') return false
        const positions = object.geometry.getAttribute('position')
        positions.setXYZ(0, start.x, start.y, start.z)
        positions.setXYZ(1, end.x, end.y, end.z)
        positions.needsUpdate = true
        object.geometry.computeBoundingSphere()
        object.computeLineDistances()
        return true
      }}
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
          if (!initialView?.camera) ref.current?.zoomToFit(400, 50)
          fitted.current = true
        }
      }}
    />
  )
}
