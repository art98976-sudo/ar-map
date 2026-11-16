import {describe, expect, it} from 'vitest'
import {buildGraph, footpathEdgeId, routeOnFootpaths} from '../../src/route/footpaths.js'

const source = {
  bbox: [56.14, -3.93, 56.15, -3.91],
  nodes: [
    [56.145, -3.92],
    [56.145, -3.919],
  ],
  edges: [[0, 1, 62, 'path']],
}

describe('manual footpath corrections', () => {
  it('removes a source edge by its stable endpoint identity', () => {
    const graph = buildGraph(source, {
      removeEdges: [footpathEdgeId(source.nodes[0], source.nodes[1])],
    })
    expect(graph.edges).toHaveLength(0)
    expect(graph.edgeIndex.within({x: 0, y: 0}, 100)).toEqual([])
  })

  it('adds explicitly typed and directed path segments to the navigation graph', () => {
    const corrections = {
      paths: [{
        geometry: {type: 'LineString', coordinates: [[-3.92, 56.145], [-3.919, 56.145]]},
        properties: {type: 'ramp', widthM: 2.4, direction: 'forward', wheelchair: true, verified: true},
      }],
    }
    const graph = buildGraph({...source, edges: []}, corrections)
    expect(graph.edges).toMatchObject([
      {type: 'ramp', widthM: 2.4, direction: 'forward', wheelchair: true, source: 'correction'},
    ])
    expect(routeOnFootpaths(graph, {lat: 56.145, lng: -3.92}, {lat: 56.145, lng: -3.919})).not.toBeNull()
    expect(routeOnFootpaths(graph, {lat: 56.145, lng: -3.919}, {lat: 56.145, lng: -3.92})).toBeNull()
  })

  it('retains explicit OSM width, surface, accessibility, and direction metadata', () => {
    const graph = buildGraph({
      ...source,
      edges: [[0, 1, 62, 'path', 2.2, 'forward', 'yes', 'paved']],
    })
    expect(graph.edges[0]).toMatchObject({
      widthM: 2.2,
      surface: 'paved',
      wheelchair: 'yes',
      direction: 'forward',
      source: 'osm',
    })
    expect(routeOnFootpaths(graph, {lat: 56.145, lng: -3.92}, {lat: 56.145, lng: -3.919})).not.toBeNull()
    expect(routeOnFootpaths(graph, {lat: 56.145, lng: -3.919}, {lat: 56.145, lng: -3.92})).toBeNull()
  })

  it('ignores malformed geometry rather than inventing graph edges', () => {
    const graph = buildGraph({...source, edges: []}, {
      paths: [
        {geometry: {type: 'Polygon', coordinates: []}, properties: {type: 'path', verified: true}},
        {geometry: {type: 'LineString', coordinates: [[-3.92, 56.145]]}, properties: {type: 'path', verified: true}},
      ],
    })
    expect(graph.edges).toHaveLength(0)
  })

  it('does not route on a correction until it has been field-verified', () => {
    const graph = buildGraph({...source, edges: []}, {
      paths: [{
        geometry: {type: 'LineString', coordinates: [[-3.92, 56.145], [-3.919, 56.145]]},
        properties: {type: 'path', verified: false},
      }],
    })
    expect(graph.edges).toHaveLength(0)
  })
})
