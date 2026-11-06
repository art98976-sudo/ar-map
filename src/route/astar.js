// A* shortest path on a graph. Small and dependency-free.
//
// neighbours(node) -> [[nextNode, cost], ...]
// heuristic(node)  -> estimated remaining cost (must never overestimate, e.g. straight-line metres)
// Returns {path: [node...], cost} or null when there is no way through.

export function aStar({start, goal, neighbours, heuristic, maxVisits = 200_000}) {
  const open = new MinHeap()
  const g = new Map([[start, 0]])
  const cameFrom = new Map()
  const closed = new Set()
  open.push(start, heuristic(start))
  let visits = 0

  while (open.size) {
    const current = open.pop()
    if (current === goal) return {path: rebuild(cameFrom, current), cost: g.get(current)}
    if (closed.has(current)) continue
    closed.add(current)
    if (++visits > maxVisits) break

    for (const [next, cost] of neighbours(current)) {
      if (closed.has(next)) continue
      const tentative = g.get(current) + cost
      if (tentative < (g.get(next) ?? Infinity)) {
        g.set(next, tentative)
        cameFrom.set(next, current)
        open.push(next, tentative + heuristic(next))
      }
    }
  }
  return null
}

function rebuild(cameFrom, node) {
  const path = [node]
  while (cameFrom.has(node)) {
    node = cameFrom.get(node)
    path.push(node)
  }
  return path.reverse()
}

/** Binary heap keyed by priority (lowest first). Duplicate entries are fine: A* skips closed nodes. */
class MinHeap {
  constructor() {
    this.items = []
  }
  get size() {
    return this.items.length
  }
  push(value, priority) {
    const items = this.items
    items.push({value, priority})
    let i = items.length - 1
    while (i > 0) {
      const parent = (i - 1) >> 1
      if (items[parent].priority <= items[i].priority) break
      ;[items[parent], items[i]] = [items[i], items[parent]]
      i = parent
    }
  }
  pop() {
    const items = this.items
    const top = items[0]
    const last = items.pop()
    if (items.length) {
      items[0] = last
      let i = 0
      for (;;) {
        const l = 2 * i + 1
        const r = l + 1
        let m = i
        if (l < items.length && items[l].priority < items[m].priority) m = l
        if (r < items.length && items[r].priority < items[m].priority) m = r
        if (m === i) break
        ;[items[m], items[i]] = [items[i], items[m]]
        i = m
      }
    }
    return top.value
  }
}
