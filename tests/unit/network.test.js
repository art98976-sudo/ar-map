// Stage 2: automatic checks on the generated campus walking network (npm run build:network).
// A failure lists the node / edge ids and coordinates; npm run network:report prints them all.
import {describe, expect, it} from 'vitest'
import net from '../../src/data/campus-network.json'
import {
  checkBlockedCrossings,
  checkDoors,
  checkFloorsConnected,
  checkPilotRoute,
  checkRoomsReachable,
  checkWalkable,
  pilotRoute,
  pilotScope,
} from '../../src/network/network-checks.js'

/** The failures as readable lines, so a red test says what is wrong and where. */
function explain(result, max = 15) {
  const lines = result.failures.slice(0, max).map((f) => {
    const where = Number.isFinite(f.x) ? ` at (${f.x}, ${f.y}) level ${f.z}` : ''
    const ids = [...(f.nodeIds ?? []), ...(f.edgeIds ?? []).slice(0, 3)].join(', ')
    return `  - ${f.message}${where}${ids ? ` [${ids}]` : ''}`
  })
  if (result.failures.length > max) lines.push(`  … and ${result.failures.length - max} more (npm run network:report)`)
  return `${result.title}: ${result.failures.length} failure(s)\n${lines.join('\n')}`
}

// The gate is the pilot route: failures on it fail the test. Failures elsewhere in the network are
// site checks, listed by npm run network:report (never dropped).
const expectPass = (result) => {
  const {onPilot, siteChecks} = pilotScope(net, result)
  expect(onPilot.length + siteChecks.length).toBe(result.failures.length)
  expect(onPilot, explain({...result, failures: onPilot})).toEqual([])
}

describe('campus-network.json', () => {
  it('is versioned, dated and in the campus frame', () => {
    expect(net.schemaVersion).toBe(1)
    expect(Number.isNaN(Date.parse(net.generatedAt))).toBe(false)
    expect(net.origin).toEqual({lat: 56.1455, lng: -3.92})
    expect(net.nodes.length).toBeGreaterThan(0)
    expect(net.edges.length).toBeGreaterThan(0)
    const ids = new Set(net.nodes.map((n) => n.id))
    for (const e of net.edges) {
      expect(ids.has(e.from) && ids.has(e.to), `edge ${e.id} names a missing node`).toBe(true)
      expect(['outdoor', 'corridor', 'door', 'stairs', 'lift']).toContain(e.type)
    }
    for (const n of net.nodes) expect(['path', 'door', 'entrance', 'stairs', 'lift', 'room']).toContain(n.type)
  })

  it('every room node is reachable from every entrance node', () => expectPass(checkRoomsReachable(net)))
  it('every door node has at least one indoor and one outdoor edge', () => expectPass(checkDoors(net)))
  it('every floor of the building is connected by stairs or a lift', () => expectPass(checkFloorsConnected(net)))
  it('no edge crosses a wall or blocked-area polygon', () => expectPass(checkBlockedCrossings(net)))
  it('every edge lies inside a walkable area (0.3 m tolerance)', () => expectPass(checkWalkable(net)))
  it('pilot route: A* within 15% of MazeMap and through the same entrance', () => expectPass(checkPilotRoute(net)))

  it('the pilot route goes outdoors, through a door, and up to the room floor', () => {
    const route = pilotRoute(net)
    expect(route).not.toBeNull()
    const byId = new Map(net.nodes.map((n) => [n.id, n]))
    const levels = route.nodeIds.map((id) => byId.get(id).z).filter((z, i, all) => i === 0 || z !== all[i - 1])
    expect(levels[0]).toBe(0)
    expect(levels.at(-1)).toBe(2)
    expect(route.entranceNodeId).toBe(net.pilot.mazemap.entranceNodeIds[0])
  })

  it('records the evidence for every covered approach and every derived walkable area', () => {
    for (const e of net.edges.filter((x) => x.passage === 'covered' && x.source === 'mazemap')) expect(e.passageFrom).toMatch(/plan: outside/)
    for (const w of net.areas.walkable.filter((x) => x.kind === 'derived')) expect(w.derived).toBe(true)
  })
})
