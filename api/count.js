// POST /api/count {event, device?, browser?}: add one to the anonymous counts (8.2).
import {keysFor, pipeline, storeConfig} from './_store.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()
  let body = req.body
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body)
    } catch {
      body = null
    }
  }
  const keys = keysFor(body)
  if (!keys) return res.status(400).end()
  const store = storeConfig()
  if (!store) return res.status(204).end() // the store is off
  try {
    await pipeline(store, keys.map((k) => ['INCR', k]))
  } catch {
    // a count is not worth an error on the phone
  }
  return res.status(204).end()
}
