import {readFileSync} from 'node:fs'
import {afterEach, describe, expect, it} from 'vitest'
import {formatNumber, getLocale, kilometres, LOCALES, minutes, savedLocale, setLocale, speechLang, t} from '../../src/i18n/i18n.js'
import EN from '../../src/i18n/en-GB.js'
import {formatDistance} from '../../src/ar/pin.js'
import {walkSummary} from '../../src/route/card-text.js'
import {createTripSteps, createTurnAnnouncer} from '../../src/route/trip-steps.js'
import {DESTINATIONS} from '../../src/map/destinations.js'
import {QUICK_CHIPS} from '../../src/map/filters.js'

// Item 13: the interface in en-GB (source), Simplified Chinese, Arabic and Spanish.
const memory = () => {
  const data = new Map()
  return {getItem: (k) => data.get(k) ?? null, setItem: (k, v) => data.set(k, String(v))}
}
const use = (id) => setLocale(id, {save: false})
afterEach(() => use('en-GB'))

describe('t()', () => {
  it('gives the en-GB source text, with {params} filled', () => {
    expect(getLocale().id).toBe('en-GB')
    expect(t('card.go')).toBe('Go')
    expect(t('card.save', {name: 'Library'})).toBe('Save Library')
    expect(t('start.gpsAccuracy', {m: 12})).toBe('Current location · ±12 m')
  })

  it('an unknown key comes back as the key, never as nothing', () => {
    expect(t('no.such.key')).toBe('no.such.key')
  })

  it('a key a translation lacks falls back to en-GB', async () => {
    await use('es')
    const {STRINGS} = await import('../../src/i18n/locales/es.js')
    const kept = STRINGS['card.go']
    delete STRINGS['card.go']
    try {
      expect(t('card.go')).toBe('Go')
      expect(t('card.share', {name: 'Library'})).toBe('Compartir Library') // the rest stays Spanish
    } finally {
      STRINGS['card.go'] = kept
    }
    expect(t('card.go')).toBe('Ir')
  })

  it('a language that cannot load keeps the one in use', async () => {
    expect((await setLocale('xx', {save: false})).id).toBe('en-GB')
  })
})

describe('plurals and numbers', () => {
  it('English and Spanish minutes; Arabic has its own six forms', async () => {
    expect(minutes(1)).toBe('1 min')
    expect(minutes(12)).toBe('12 min')
    await use('ar')
    expect([0, 1, 2, 3, 11, 100].map(minutes)).toEqual(['0 دقيقة', 'دقيقة واحدة', 'دقيقتان', '3 دقائق', '11 دقيقة', '100 دقيقة'])
    await use('zh-Hans')
    expect(minutes(1)).toBe('1 分钟')
  })

  it('a plural chosen by count: the map clusters', async () => {
    await use('es')
    expect(t('map.cluster', {count: 1})).toBe('1 lugar aquí. Acercar')
    expect(t('map.cluster', {count: 4})).toBe('4 lugares aquí. Acercar')
  })

  it('decimal marks follow the language; Arabic keeps Western digits like the signs', async () => {
    expect(kilometres(1.234)).toBe('1.2 km')
    expect(walkSummary(95)).toBe('1 min · 95 m')
    await use('es')
    expect(formatNumber(1.5)).toBe('1,5')
    expect(kilometres(1.234)).toBe('1,2 km')
    await use('zh-Hans')
    expect(formatDistance(120)).toBe('120 米')
    await use('ar')
    expect(formatDistance(1500)).toBe('1.5 كم')
    expect(formatNumber(2087)).toBe('2087')
  })
})

describe('the page', () => {
  it('Arabic turns the page right to left, and back', async () => {
    const html = document.documentElement
    await use('ar')
    expect(html.dir).toBe('rtl')
    expect(html.lang).toBe('ar')
    await use('es')
    expect(html.dir).toBe('ltr')
    expect(html.lang).toBe('es')
    await use('en-GB')
    expect(html.lang).toBe('en-GB')
  })

  it('in Arabic a filled-in English name is isolated, so it reads the right way round', async () => {
    await use('ar')
    expect(t('card.save', {name: 'Library'})).toBe('حفظ ⁨Library⁩')
  })

  it('remembers the choice on this device only (localStorage), and survives blocked storage', async () => {
    const storage = memory()
    expect(savedLocale(storage)).toBe('en-GB')
    await setLocale('zh-Hans', {storage})
    expect(savedLocale(storage)).toBe('zh-Hans')
    expect(savedLocale({getItem: () => 'klingon'})).toBe('en-GB')
    expect(
      savedLocale({
        getItem: () => {
          throw new Error('blocked')
        },
      }),
    ).toBe('en-GB')
  })

  it('speaks each language in its own voice', async () => {
    const voices = {}
    for (const l of LOCALES) {
      await use(l.id)
      voices[l.id] = speechLang()
    }
    expect(voices).toEqual({'en-GB': 'en-GB', 'zh-Hans': 'zh-CN', ar: 'ar-SA', es: 'es-ES'})
  })

  it('labels fixed at start-up follow the language when drawn', async () => {
    await use('es')
    expect(QUICK_CHIPS.find((c) => c.id === 'toilets').label).toBe('Aseos')
  })
})

describe('every translation', () => {
  for (const id of ['zh-Hans', 'ar', 'es']) {
    it(`${id}: has every key, with the same {placeholders}`, async () => {
      const {STRINGS, DIRECTIONS} = await import(`../../src/i18n/locales/${id}.js`)
      const holes = (v) => JSON.stringify([...new Set((typeof v === 'string' ? v : Object.values(v).join(' ')).match(/\{\w+\}/g) ?? [])].sort())
      const missing = Object.keys(EN).filter((k) => EN[k] !== '' && STRINGS[k] == null)
      const extra = Object.keys(STRINGS).filter((k) => !(k in EN))
      // Arabic says "one minute" and "two minutes" in words, without the number.
      const params = Object.keys(STRINGS).filter((k) => k in EN && holes(EN[k]) !== holes(STRINGS[k]) && !(id === 'ar' && (k === 'time.min' || k === 'map.cluster')))
      expect({missing, extra, params}).toEqual({missing: [], extra: [], params: []})
      expect(Object.keys(DIRECTIONS).sort()).toEqual(['arCard', 'arStep', 'banner', 'detail', 'distance', 'onto', 'place', 'spoken', 'stepLine'])
    })
  }
})

describe('turn directions read naturally in each language (Pathfoot to the Library)', () => {
  const route = JSON.parse(readFileSync('tests/fixtures/route-pathfoot-library.json', 'utf8'))
  const osm = JSON.parse(readFileSync('src/data/landmarks-osm.json', 'utf8'))
  const tripSteps = () => createTripSteps(route, {arriveLabel: 'Library entrance', destinations: DESTINATIONS, destinationId: 'library', osm})

  for (const id of ['en-GB', 'zh-Hans', 'ar', 'es']) {
    it(`${id}: the step list, a banner and what is said`, async () => {
      await use(id)
      const s = tripSteps()
      const list = s.list().map((x) => (x.detail ? `(${x.detail}) ` : '') + `${x.text} · ${x.walkText}`)
      const said = createTurnAnnouncer({arriveLabel: 'Library entrance'})
      expect({list, banner: s.banner(0).text, now: s.banner(s.manoeuvres[0].s).text, spoken: said.next(s.manoeuvres[1], 130)}).toMatchSnapshot()
      // Place names stay in English, whatever the language.
      expect(list.join(' ')).toContain('Library entrance')
      expect(list.join(' ')).toContain('Pathfoot')
    })
  }

  it('en-GB is exactly as before', () => {
    const lines = tripSteps().list().map((x) => (x.detail ? `(${x.detail}) ` : '') + `${x.text} · ${x.walkText}`)
    expect(lines[0]).toBe('Turn right at the Pathfoot Building, then left 20 m later onto Pathfoot Road · 25 m')
  })
})
