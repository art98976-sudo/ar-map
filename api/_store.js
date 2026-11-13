// The counts store (8.2): Upstash Redis over its REST API, set up from Vercel → Storage → Upstash,
// which adds KV_REST_API_URL and KV_REST_API_TOKEN (or UPSTASH_REDIS_REST_URL / _TOKEN).
// Without them the store is off: counts are dropped and /api/stats says so.
export const EVENTS = ['trip-started', 'ar-started', 'lineup-confirmed', 'arrived', 'ended-early', 'tracking-lost', 'rerouted']
export const DEVICES = ['ios', 'android', 'other']
export const BROWSERS = ['safari', 'chrome', 'firefox', 'samsung', 'other']

export function storeConfig(env = process.env) {
  const url = env.KV_REST_API_URL || env.UPSTASH_REDIS_REST_URL
  const token = env.KV_REST_API_TOKEN || env.UPSTASH_REDIS_REST_TOKEN
  return url && token ? {url: url.replace(/\/$/, ''), token} : null
}

/** Run Redis commands in one round trip: [['INCR', 'k'], ...]. */
export async function pipeline(store, commands) {
  const res = await fetch(`${store.url}/pipeline`, {
    method: 'POST',
    headers: {Authorization: `Bearer ${store.token}`, 'Content-Type': 'application/json'},
    body: JSON.stringify(commands),
  })
  if (!res.ok) throw new Error(`store ${res.status}`)
  return res.json()
}

/** The keys to add one to for a body, or null if the body is not one we count. */
export function keysFor(body) {
  if (!body || !EVENTS.includes(body.event)) return null
  const keys = [`count:${body.event}`]
  if (body.event === 'trip-started') {
    if (DEVICES.includes(body.device)) keys.push(`count:device:${body.device}`)
    if (BROWSERS.includes(body.browser)) keys.push(`count:browser:${body.browser}`)
  }
  return keys
}

export const ALL_KEYS = [
  ...EVENTS.map((e) => `count:${e}`),
  ...DEVICES.map((d) => `count:device:${d}`),
  ...BROWSERS.map((b) => `count:browser:${b}`),
]
