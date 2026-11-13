// GET /api/stats with header x-passcode: the counts, for /#/stats (8.2). The passcode is the
// STATS_PASSCODE environment variable; without it the page stays locked.
import {timingSafeEqual} from 'node:crypto'
import {ALL_KEYS, pipeline, storeConfig} from './_store.js'

function samePasscode(given, expected) {
  const a = Buffer.from(String(given ?? ''))
  const b = Buffer.from(String(expected ?? ''))
  return a.length === b.length && a.length > 0 && timingSafeEqual(a, b)
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store')
  if (req.method !== 'GET') return res.status(405).end()
  if (!samePasscode(req.headers['x-passcode'], process.env.STATS_PASSCODE)) return res.status(401).json({error: 'locked'})
  const store = storeConfig()
  if (!store) return res.status(200).json({store: 'off', counts: {}})
  try {
    const results = await pipeline(store, ALL_KEYS.map((k) => ['GET', k]))
    const counts = Object.fromEntries(ALL_KEYS.map((k, i) => [k.replace(/^count:/, ''), Number(results[i]?.result ?? 0)]))
    return res.status(200).json({store: 'on', counts})
  } catch {
    return res.status(502).json({error: 'store'})
  }
}
