import {describe, expect, it, vi} from 'vitest'
import {createVoice, pickVoice, speechSupported, voiceOn} from '../../src/ui/voice.js'
import {createTurnAnnouncer} from '../../src/route/trip-steps.js'

// Item 3: spoken directions. Off by default, remembered, never over itself, quiet when hidden.
function memoryStorage(initial = {}) {
  const data = {...initial}
  return {getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => (data[k] = String(v)), data}
}
function fakeSpeech() {
  const spoken = []
  const synth = {speak: vi.fn((u) => spoken.push(u.text)), cancel: vi.fn(), getVoices: () => [{lang: 'en-US', localService: true}, {lang: 'en_GB', localService: false, name: 'Daniel'}]}
  function SpeechSynthesisUtterance(text) {
    this.text = text
  }
  return {win: {speechSynthesis: synth, SpeechSynthesisUtterance}, synth, spoken}
}
const doc = (hidden = false) => ({hidden, addEventListener: vi.fn(), removeEventListener: vi.fn()})

describe('voice', () => {
  it('is off by default and remembers the switch', () => {
    const storage = memoryStorage()
    expect(voiceOn(storage)).toBe(false)
    const {win} = fakeSpeech()
    const voice = createVoice({win, doc: doc(), storage})
    expect(voice.on).toBe(false)
    voice.set(true)
    expect(storage.data['welcomeAR.voice.v1']).toBe('1')
    expect(createVoice({win, doc: doc(), storage}).on).toBe(true) // the next visit
  })

  it('says nothing while off', () => {
    const {win, spoken} = fakeSpeech()
    const voice = createVoice({win, doc: doc(), storage: memoryStorage()})
    expect(voice.say('Turn left now')).toBe(false)
    expect(spoken).toEqual([])
  })

  it('speaks in an en-GB voice, cancelling anything still being read, and never repeats itself', () => {
    const {win, synth, spoken} = fakeSpeech()
    const voice = createVoice({win, doc: doc(), storage: memoryStorage({'welcomeAR.voice.v1': '1'})})
    expect(voice.say('In 80 m, turn left')).toBe(true)
    expect(voice.say('In 80 m, turn left')).toBe(false)
    voice.say('Turn left now')
    expect(spoken).toEqual(['In 80 m, turn left', 'Turn left now'])
    expect(synth.cancel).toHaveBeenCalledTimes(2) // before each one: no talking over itself
    const utterance = synth.speak.mock.calls[0][0]
    expect(utterance.lang).toBe('en-GB')
    expect(utterance.voice.name).toBe('Daniel')
  })

  it('is quiet while the tab is hidden, and stops when it is hidden or the trip ends', () => {
    const {win, synth, spoken} = fakeSpeech()
    const d = doc(true)
    const voice = createVoice({win, doc: d, storage: memoryStorage({'welcomeAR.voice.v1': '1'})})
    expect(voice.say('Turn right now')).toBe(false)
    expect(spoken).toEqual([])
    const onVisibility = d.addEventListener.mock.calls.find(([name]) => name === 'visibilitychange')[1]
    onVisibility()
    expect(synth.cancel).toHaveBeenCalled()
    voice.destroy()
    expect(d.removeEventListener).toHaveBeenCalledWith('visibilitychange', onVisibility)
  })

  it('fails silently where the browser cannot speak', () => {
    expect(speechSupported({})).toBe(false)
    const voice = createVoice({win: {}, doc: doc(), storage: memoryStorage({'welcomeAR.voice.v1': '1'})})
    expect(voice.supported).toBe(false)
    expect(voice.on).toBe(false)
    expect(() => {
      voice.set(true)
      voice.say('Hello')
      voice.stop()
      voice.destroy()
    }).not.toThrow()
  })

  it('picks en-GB on the phone first, then any en-GB, then any English', () => {
    expect(pickVoice([{lang: 'en-GB', localService: false, name: 'a'}, {lang: 'en-GB', localService: true, name: 'b'}]).name).toBe('b')
    expect(pickVoice([{lang: 'fr-FR'}, {lang: 'en-AU', name: 'c'}]).name).toBe('c')
    expect(pickVoice([])).toBeNull()
  })
})

describe('turn announcer', () => {
  const left = {type: 'left', landmark: 'Atrium', s: 100}
  const end = {type: 'arrive', s: 300}
  it('says each turn when it comes up, once more close to it, and the end once', () => {
    const a = createTurnAnnouncer({arriveLabel: 'Library entrance'})
    expect(a.next(left, 80)).toBe('In 80 m, turn left at the Atrium')
    expect(a.next(left, 60)).toBeNull()
    expect(a.next(left, 12)).toBe('Turn left now at the Atrium')
    expect(a.next(left, 4)).toBeNull()
    expect(a.next(end, 200)).toBe('In 200 m, arrive at Library entrance')
    expect(a.next(end, 50)).toBeNull()
  })
  it('a turn first seen close by is said once, as "now"', () => {
    const a = createTurnAnnouncer({arriveLabel: 'X'})
    expect(a.next({type: 'right'}, 10)).toBe('Turn right now')
  })
})
