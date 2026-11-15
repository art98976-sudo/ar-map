// Item 13: the interface in more than one language. British English (en-GB) is the source text,
// kept in code (./en-GB.js) and always in the main bundle; each other language is its own small
// file, loaded only when chosen (one chunk per language). The choice is kept on this device
// (localStorage) and nowhere else. Place names (buildings, roads, rooms) stay in English: they are
// what the signs on campus say.
//
//   t('card.go')                          "Go"
//   t('card.save', {name: 'Library'})     "Save Library"
//   t('time.min', {count: 3})             plural forms from Intl.PluralRules
//
// A key missing from a translation falls back to en-GB, so a half-finished language still works.
import EN from './en-GB.js'
import {EN_DIRECTIONS} from './directions-en.js'

const KEY = 'welcomeAR.locale.v1'

/**
 * The languages on offer. `label` is the language's own name (as people look for it), `speech` the
 * voice to ask the phone for, `number` the locale for digits and decimal marks.
 */
export const LOCALES = [
  {id: 'en-GB', label: 'English', dir: 'ltr', speech: 'en-GB', number: 'en-GB'},
  {id: 'zh-Hans', label: '简体中文', dir: 'ltr', speech: 'zh-CN', number: 'zh-Hans'},
  // Western digits, as on the campus signs and room numbers ("2B87"): see README, Languages.
  {id: 'ar', label: 'العربية', dir: 'rtl', speech: 'ar-SA', number: 'ar-u-nu-latn'},
  {id: 'es', label: 'Español', dir: 'ltr', speech: 'es-ES', number: 'es-ES'},
]
export const SOURCE_LOCALE = 'en-GB'

// One chunk per language, fetched on first use.
const LOADERS = {
  'zh-Hans': () => import('./locales/zh-Hans.js'),
  ar: () => import('./locales/ar.js'),
  es: () => import('./locales/es.js'),
}

let current = LOCALES[0]
let table = EN
let directions = EN_DIRECTIONS
let plurals = null
let numbers = null

const infoFor = (id) => LOCALES.find((l) => l.id === id) ?? null

/** The language in use: {id, label, dir, speech, number}. */
export const getLocale = () => current
export const isRtl = () => current.dir === 'rtl'
/** The voice to ask speechSynthesis for ("es-ES"). */
export const speechLang = () => current.speech

function pluralRules() {
  plurals ??= new Intl.PluralRules(current.id)
  return plurals
}

/** A number in the language's own way: "1.5" in English, "1,5" in Spanish. No thousands separator. */
export function formatNumber(value, {decimals} = {}) {
  if (!Number.isFinite(value)) return String(value)
  if (decimals != null) {
    return new Intl.NumberFormat(current.number, {minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: false}).format(value)
  }
  numbers ??= new Intl.NumberFormat(current.number, {maximumFractionDigits: 3, useGrouping: false})
  return numbers.format(value)
}

// Right to left: a filled-in name (English, left to right) goes in Unicode isolates (FSI ... PDI), so
// "Library entrance." never comes out as ".Library entrance" inside an Arabic sentence.
const isolate = (text) => (current.dir === 'rtl' && /[A-Za-z]/.test(text) ? `\u2068${text}\u2069` : text)

function fill(text, params) {
  if (!params) return text
  return text.replace(/\{(\w+)\}/g, (whole, name) => {
    if (!(name in params)) return whole
    const v = params[name]
    return typeof v === 'number' ? formatNumber(v) : isolate(String(v ?? ''))
  })
}

/**
 * The text for a key in the current language (en-GB if the translation has none), with {name}
 * placeholders filled. A value can be a plural set ({one, other, ...}, chosen by params.count) or a
 * function of params (for wording that changes with them).
 */
export function t(key, params) {
  let value = table[key]
  if (value == null) value = EN[key]
  if (value == null) {
    if (__DEV_TOOLS__) console.warn(`[i18n] no text for "${key}"`)
    return key
  }
  if (typeof value === 'function') return value(params ?? {})
  if (typeof value === 'object') {
    const count = params?.count
    const form = Number.isFinite(count) ? pluralRules().select(count) : 'other'
    value = value[form] ?? value.other ?? EN[key]?.other ?? ''
  }
  return fill(value, params)
}

/** "80 m" (whole metres, already rounded by the caller). */
export const metres = (n) => t('unit.m', {n})
/** "1.2 km", one decimal. */
export const kilometres = (km) => t('unit.km', {n: formatNumber(km, {decimals: 1})})
/** "3 min". */
export const minutes = (count) => t('time.min', {count})

/** Has this key text of its own in the current language (not the en-GB fallback)? */
export const hasText = (key) => table[key] != null

/** The turn-by-turn sentence templates for the current language (src/route/trip-steps.js). */
export const getDirections = () => directions

/** The saved choice, or en-GB. Storage may be blocked (private mode): then en-GB. */
export function savedLocale(storage = globalThis.localStorage) {
  try {
    const id = storage?.getItem(KEY)
    return infoFor(id) ? id : SOURCE_LOCALE
  } catch {
    return SOURCE_LOCALE
  }
}

/** Put lang and dir on <html>, so screen readers, fonts and the layout follow the language. */
export function applyToDocument(doc = globalThis.document) {
  const html = doc?.documentElement
  if (!html) return
  html.lang = current.id
  html.dir = current.dir
}

/**
 * Switch language: loads its file if needed, then lang/dir on <html>. Keeps the language in use
 * if the file cannot load (offline before its first use). Returns the language in use.
 * @param o.save remember the choice on this device (localStorage only)
 */
export async function setLocale(id, {save = true, doc = globalThis.document, storage = globalThis.localStorage} = {}) {
  const info = infoFor(id) ?? LOCALES[0]
  let next = {table: EN, directions: EN_DIRECTIONS}
  if (info.id !== SOURCE_LOCALE) {
    try {
      const module = await LOADERS[info.id]()
      next = {table: module.STRINGS, directions: module.DIRECTIONS ?? EN_DIRECTIONS}
    } catch (err) {
      console.warn(`[i18n] could not load ${info.id}`, err)
      return current
    }
  }
  current = info
  table = next.table
  directions = next.directions
  plurals = null
  numbers = null
  applyToDocument(doc)
  if (save) {
    try {
      storage?.setItem(KEY, info.id)
    } catch {
      // storage blocked: this visit only
    }
  }
  return current
}
