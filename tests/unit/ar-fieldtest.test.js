import {afterEach, describe, expect, it, vi} from 'vitest'
import {FIELD_COLUMNS, copyText, createFieldLog, createFieldTest, rowFrom, summarise, toCsv} from '../../src/ui/screens/ar-fieldtest.js'

const STATS = {
  phase: 'ready',
  gpsLat: 56.14512345678,
  gpsLng: -3.9201234567,
  trackedLat: 56.145111,
  trackedLng: -3.920111,
  gpsAccuracy: 6.04,
  heading: 181.26,
  offRouteM: 1.234,
  userS: 42.47,
  arrowBearingDeg: 95.56,
}

function memoryStorage() {
  const data = new Map()
  return {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
    removeItem: (k) => data.delete(k),
  }
}

describe('field test log rows', () => {
  it('records every value, rounded, with a timestamp', () => {
    const row = rowFrom(STATS, {at: Date.UTC(2026, 10, 11, 12, 0, 3), startedAt: Date.UTC(2026, 10, 11, 12, 0, 0)})
    expect(row).toEqual({
      time: '2026-11-11T12:00:03.000Z',
      elapsed_s: 3,
      lat: 56.1451235,
      lon: -3.9201235,
      tracked_lat: 56.145111,
      tracked_lon: -3.920111,
      gps_accuracy_m: 6,
      heading_deg: 181.3,
      off_route_m: 1.23,
      along_m: 42.5,
      arrow_bearing_deg: 95.6,
      phase: 'ready',
      mark: null,
    })
    expect(Object.keys(row)).toEqual(FIELD_COLUMNS)
  })

  it('leaves missing values empty, and names the button for a marked row', () => {
    const row = rowFrom(null, {at: 1000, startedAt: 0, mark: 'wrong'})
    expect(row.lat).toBeNull()
    expect(row.arrow_bearing_deg).toBeNull()
    expect(row.mark).toBe('Arrow wrong')
  })
})

describe('field test summary', () => {
  it('averages and finds the worst over timed samples, and counts each button', () => {
    let t = 0
    const log = createFieldLog({storage: memoryStorage(), now: () => t})
    for (const [acc, off] of [
      [4, 0.5],
      [8, 1.5],
      [12, 4],
    ]) {
      t += 1000
      log.add({...STATS, gpsAccuracy: acc, offRouteM: off})
    }
    log.add({...STATS, gpsAccuracy: 99, offRouteM: 99}, 'correct') // marks do not count towards averages
    log.add(STATS, 'correct')
    log.add(STATS, 'turn')
    log.add({phase: 'facing'}) // nothing known yet: skipped in the averages
    const s = summarise(log.rows)
    expect(s.gpsAccuracy).toEqual({average: 8, worst: 12, count: 3})
    expect(s.offRoute.average).toBeCloseTo(2, 6)
    expect(s.offRoute.worst).toBe(4)
    expect(s.marks).toEqual({correct: 2, wrong: 0, turn: 1})
    expect(s.samples).toBe(4)
    expect(s.rows).toBe(7)
    expect(s.durationS).toBe(3)
  })

  it('copes with an empty log', () => {
    expect(summarise([])).toMatchObject({gpsAccuracy: {average: null, worst: null}, samples: 0, durationS: 0})
  })
})

describe('field test CSV', () => {
  it('has a header and one line per row, with empty cells for unknowns', () => {
    const rows = [rowFrom(STATS, {at: 0, startedAt: 0}), rowFrom(null, {at: 1000, startedAt: 0, mark: 'turn'})]
    const lines = toCsv(rows).trimEnd().split('\n')
    expect(lines[0]).toBe(FIELD_COLUMNS.join(','))
    expect(lines).toHaveLength(3)
    expect(lines[1].split(',')).toHaveLength(FIELD_COLUMNS.length)
    expect(lines[2]).toBe('1970-01-01T00:00:01.000Z,1,,,,,,,,,,,At a turn')
  })

  it('quotes cells with commas or quotes', () => {
    const row = {...rowFrom(null, {at: 0, startedAt: 0}), phase: 'a,"b"'}
    expect(toCsv([row])).toContain('"a,""b"""')
  })
})

describe('field test storage', () => {
  it('keeps the log across a reload, and Clear starts a new one', () => {
    const storage = memoryStorage()
    let t = 5000
    const first = createFieldLog({storage, now: () => t})
    first.add(STATS)
    first.add(STATS, 'wrong')
    t = 9000
    const again = createFieldLog({storage, now: () => t})
    expect(again.restored).toBe(2)
    expect(again.add(STATS).elapsed_s).toBe(4) // still timed from the first start
    again.clear()
    expect(again.rows).toHaveLength(0)
    expect(createFieldLog({storage}).restored).toBe(0)
  })

  it('works when storage is blocked', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    const log = createFieldLog({storage: blocked})
    log.add(STATS)
    expect(log.rows).toHaveLength(1)
    expect(() => log.clear()).not.toThrow()
  })
})

describe('field test panel', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    document.body.replaceChildren()
  })

  it('samples once a second, marks rows on a tap, and summarises on Finish', async () => {
    vi.useFakeTimers()
    const haptic = vi.fn()
    const ft = createFieldTest({haptic, storage: memoryStorage()})
    const host = document.createElement('div')
    document.body.append(host)
    ft.mount(host)
    ft.update(STATS)
    expect(host.querySelector('[data-ft="gps"]').textContent).toBe('±6 m')
    expect(host.querySelector('[data-ft="arrow"]').textContent).toBe('96°')
    vi.advanceTimersByTime(3000)
    expect(ft.log.rows).toHaveLength(3)
    host.querySelector('[data-ft-mark="wrong"]').click()
    host.querySelector('[data-ft-mark="turn"]').click()
    expect(haptic).toHaveBeenCalledTimes(2)
    expect(ft.log.rows.map((r) => r.mark).filter(Boolean)).toEqual(['Arrow wrong', 'At a turn'])
    host.querySelector('[data-ft-finish]').click()
    const sheet = host.querySelector('[data-ft-sheet]')
    expect(sheet.hidden).toBe(false)
    expect(sheet.textContent).toContain('average ±6.0 m, worst ±6.0 m')
    expect(sheet.textContent).toMatch(/Arrow wrong\s*1/)

    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', {clipboard: {writeText}})
    host.querySelector('[data-ft-copy]').click()
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1))
    expect(writeText.mock.calls[0][0].split('\n')[0]).toBe(FIELD_COLUMNS.join(','))
    ft.destroy()
    vi.advanceTimersByTime(3000)
    expect(ft.log.rows).toHaveLength(5) // stopped
    expect(host.querySelector('.fieldtest')).toBeNull()
  })

  it('shows the CSV to copy by hand when the browser refuses', async () => {
    vi.stubGlobal('navigator', {clipboard: {writeText: async () => Promise.reject(new Error('denied'))}})
    document.execCommand = () => false
    const ft = createFieldTest({storage: memoryStorage(), intervalMs: 60_000})
    const host = document.createElement('div')
    document.body.append(host)
    ft.mount(host)
    ft.log.add(STATS)
    host.querySelector('[data-ft-finish]').click()
    host.querySelector('[data-ft-copy]').click()
    await vi.waitFor(() => expect(host.querySelector('[data-ft-csv]').hidden).toBe(false))
    expect(host.querySelector('[data-ft-csv]').value.split('\n')).toHaveLength(3)
    ft.destroy()
  })

  it('copyText uses the Clipboard API', async () => {
    const writeText = vi.fn(async () => {})
    vi.stubGlobal('navigator', {clipboard: {writeText}})
    expect(await copyText('a,b')).toBe(true)
    expect(writeText).toHaveBeenCalledWith('a,b')
  })
})
