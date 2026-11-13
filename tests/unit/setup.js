// Unit tests never reach the network. The AR trip loads MazeMap's floor tiles for the building
// shell; here those answer "not found", so the trip carries on without a shell, as it would on a
// device with no signal. Tests that want tiles pass their own fetch.
const realFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const url = typeof input === 'string' ? input : input?.url
  if (url && url.startsWith('https://tiles.mazemap.com/')) return new Response(null, {status: 404})
  return realFetch(input, init)
}
