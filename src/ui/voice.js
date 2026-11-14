// Spoken directions (item 3): each turn and the arrival, read aloud in an en-GB voice through the
// Web Speech API. Off by default; the choice is remembered on this device. Speech happens on the
// phone: no text leaves it. Where the browser cannot speak, nothing is offered and nothing fails.
import {turnBanner} from '../route/trip-steps.js'
import {landmarkPhrase} from '../route/guidance.js'

const KEY = 'welcomeAR.voice.v1'
export const NEAR_M = 15 // within this of a turn: "Turn left now"

/** Is speech there at all? */
export function speechSupported(win = globalThis) {
  return Boolean(win?.speechSynthesis && win?.SpeechSynthesisUtterance)
}

/** The voice to use: en-GB first (on the phone itself if possible), then any English one. */
export function pickVoice(voices = []) {
  const lang = (v) => String(v.lang || '').replace('_', '-').toLowerCase()
  const gb = voices.filter((v) => lang(v) === 'en-gb')
  return gb.find((v) => v.localService) ?? gb[0] ?? voices.find((v) => lang(v).startsWith('en')) ?? null
}

/**
 * What to say for the next manoeuvre, once per stage: when it becomes the next one ("In 80 m,
 * turn left at the Atrium") and again close to it ("Turn left now at the Atrium"). Pure: feed it
 * the next manoeuvre and how far it is; it returns the words, or null when nothing new.
 */
export function createTurnAnnouncer({arriveLabel, nearM = NEAR_M}) {
  const said = new Map() // manoeuvre -> 'ahead' | 'near'
  return {
    next(manoeuvre, distanceM) {
      if (!manoeuvre || !Number.isFinite(distanceM)) return null
      const stage = said.get(manoeuvre)
      if (manoeuvre.type === 'arrive') {
        if (stage) return null
        said.set(manoeuvre, 'ahead')
        return turnBanner(manoeuvre, distanceM, arriveLabel)
      }
      if (distanceM <= nearM) {
        if (stage === 'near') return null
        said.set(manoeuvre, 'near')
        const verb = {left: 'Turn left', right: 'Turn right', 'slight-left': 'Bear left', 'slight-right': 'Bear right'}[manoeuvre.type] ?? 'Continue'
        return `${verb} now${manoeuvre.landmark ? ` at ${landmarkPhrase(manoeuvre.landmark)}` : ''}`
      }
      if (stage) return null
      said.set(manoeuvre, 'ahead')
      return turnBanner(manoeuvre, distanceM, arriveLabel)
    },
  }
}

/** Is the switch on? Remembered between visits. */
export function voiceOn(storage = globalThis.localStorage) {
  try {
    return storage?.getItem(KEY) === '1'
  } catch {
    return false
  }
}

export function setVoiceOn(on, storage = globalThis.localStorage) {
  try {
    storage?.setItem(KEY, on ? '1' : '0')
  } catch {
    // storage blocked: the switch works for this visit only
  }
}

/**
 * The speaker for one screen. say() speaks only when the switch is on, the page is visible and the
 * words are new, and cancels anything still being read first, so it never talks over itself.
 * It stops when the tab is hidden and when the screen calls stop() (the trip ended).
 */
export function createVoice({win = globalThis, doc = globalThis.document, storage = globalThis.localStorage} = {}) {
  const supported = speechSupported(win)
  let last = ''
  const synth = supported ? win.speechSynthesis : null
  const stop = () => {
    try {
      synth?.cancel()
    } catch {
      // nothing to stop
    }
  }
  const onVisibility = () => {
    if (doc?.hidden) stop()
  }
  doc?.addEventListener?.('visibilitychange', onVisibility)

  const voice = {
    supported,
    get on() {
      return supported && voiceOn(storage)
    },
    /** Speak these words (if allowed). Returns true when they were handed to the browser. */
    say(text) {
      if (!supported || !text || !voiceOn(storage) || doc?.hidden || text === last) return false
      try {
        stop()
        const utterance = new win.SpeechSynthesisUtterance(text)
        utterance.lang = 'en-GB'
        const chosen = pickVoice(synth.getVoices?.() ?? [])
        if (chosen) utterance.voice = chosen
        synth.speak(utterance)
        last = text
        return true
      } catch {
        return false
      }
    },
    /** Turn it on or off. On: say so, inside the tap (iPhone only lets a page speak after one). */
    set(on) {
      setVoiceOn(on, storage)
      if (!on) stop()
      else {
        last = ''
        voice.say('Spoken directions on')
      }
    },
    stop,
    destroy() {
      stop()
      doc?.removeEventListener?.('visibilitychange', onVisibility)
    },
  }
  return voice
}
