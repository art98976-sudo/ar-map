// Device and browser check, run before we ask for the camera.
// Pure functions: everything comes in through `env`, so unit tests can fake any phone.
import {t} from '../i18n/i18n.js'

/** In-app browsers (Instagram, Facebook, etc.) often block the camera or motion sensors. */
const IN_APP_BROWSERS = [
  {name: 'Instagram', test: /Instagram/i},
  {name: 'Facebook', test: /FBAN|FBAV|FB_IAB/i},
  {name: 'Messenger', test: /Messenger/i},
  {name: 'TikTok', test: /musical_ly|TikTok|Bytedance/i},
  {name: 'Snapchat', test: /Snapchat/i},
  {name: 'LinkedIn', test: /LinkedInApp/i},
  {name: 'WeChat', test: /MicroMessenger/i},
  {name: 'Line', test: /\bLine\//i},
  {name: 'X', test: /Twitter/i},
]

/**
 * Work out OS, browser and version from the user agent.
 * iPadOS reports itself as a Mac, so we also look at touch support.
 */
export function parseUserAgent(ua, {maxTouchPoints = 0} = {}) {
  const info = {os: 'other', osVersion: null, browser: 'other', inAppBrowser: null, mobile: false}

  const iosMatch = ua.match(/(?:iPhone|iPad|iPod).*? OS (\d+)[_.](\d+)/)
  const isIpadOs = /Macintosh/.test(ua) && maxTouchPoints > 1
  if (iosMatch || isIpadOs) {
    info.os = 'ios'
    info.mobile = true
    if (iosMatch) {
      info.osVersion = Number(`${iosMatch[1]}.${iosMatch[2]}`)
    } else {
      const v = ua.match(/Version\/(\d+)\.(\d+)/)
      info.osVersion = v ? Number(`${v[1]}.${v[2]}`) : null
    }
  } else if (/Android/.test(ua)) {
    info.os = 'android'
    info.mobile = true
    const v = ua.match(/Android (\d+)(?:\.(\d+))?/)
    info.osVersion = v ? Number(`${v[1]}.${v[2] || 0}`) : null
  } else if (/Windows/.test(ua)) {
    info.os = 'windows'
  } else if (/Macintosh|Mac OS X/.test(ua)) {
    info.os = 'mac'
  } else if (/Linux|CrOS/.test(ua)) {
    info.os = 'linux'
  }

  if (/CriOS/.test(ua)) info.browser = 'chrome'
  else if (/FxiOS|Firefox/.test(ua)) info.browser = 'firefox'
  else if (/EdgiOS|EdgA|Edg\//.test(ua)) info.browser = 'edge'
  else if (/SamsungBrowser/.test(ua)) info.browser = 'samsung'
  else if (/Chrome\//.test(ua)) info.browser = 'chrome'
  else if (/Safari\//.test(ua) && /Version\//.test(ua)) info.browser = 'safari'

  const inApp = IN_APP_BROWSERS.find((b) => b.test.test(ua))
  if (inApp) info.inAppBrowser = inApp.name

  return info
}

/** Minimum versions where the 8th Wall engine runs reliably. */
const MIN_VERSION = {ios: 15, android: 9}

/**
 * Decide whether AR can run.
 * Returns {status, device, checks, primaryIssue}
 *   status: 'supported' | 'unsupported'
 *   checks: list shown on screen, each {id, label, ok, detail}
 *   primaryIssue: the one problem to explain to the user (or null)
 */
export function checkDevice(env) {
  const device = parseUserAgent(env.userAgent || '', {maxTouchPoints: env.maxTouchPoints})

  const checks = [
    {
      id: 'secure',
      label: t('device.secure'),
      ok: !!env.isSecureContext,
      detail: t('device.secureDetail'),
    },
    {
      id: 'camera',
      label: t('device.camera'),
      ok: !!env.hasGetUserMedia,
      detail: t('device.cameraDetail'),
    },
    {
      id: 'graphics',
      label: t('device.graphics'),
      ok: !!env.hasWebGL,
      detail: t('device.graphicsDetail'),
    },
    {
      id: 'motion',
      label: t('device.motion'),
      ok: device.mobile && !!env.hasDeviceMotion,
      detail: t('device.motionDetail'),
    },
  ]

  let primaryIssue = null
  if (device.inAppBrowser) {
    primaryIssue = {
      code: 'in-app-browser',
      title: t('device.openIn', {browser: device.os === 'ios' ? 'Safari' : 'Chrome'}),
      body: t('device.inAppBody', {app: device.inAppBrowser, target: device.os === 'ios' ? 'Safari' : t('device.inAppTarget')}),
    }
  } else if (!device.mobile) {
    primaryIssue = {
      code: 'desktop',
      title: t('device.desktopTitle'),
      body: t('device.desktopBody'),
    }
  } else if (device.osVersion && device.osVersion < MIN_VERSION[device.os]) {
    primaryIssue = {
      code: 'old-os',
      title: t('device.oldTitle'),
      body: t('device.oldBody', {os: device.os === 'ios' ? 'iOS' : 'Android', min: MIN_VERSION[device.os], version: device.osVersion}),
    }
  } else {
    const failed = checks.find((c) => !c.ok)
    if (failed) primaryIssue = {code: failed.id, title: t('device.notHere'), body: failed.detail}
  }

  return {status: primaryIssue ? 'unsupported' : 'supported', device, checks, primaryIssue}
}

/**
 * The reason AR cannot run here, or null if it can.
 * forced: ?force=1 lets a laptop webcam run the camera test (development and demos).
 */
export function deviceIssue(forced = false, env = readBrowserEnv()) {
  const {primaryIssue} = checkDevice(env)
  return forced && primaryIssue?.code === 'desktop' ? null : primaryIssue
}

/** Read the real browser environment. Kept separate so `checkDevice` stays testable. */
function readBrowserEnv(win = window) {
  let hasWebGL = false
  try {
    const canvas = win.document.createElement('canvas')
    hasWebGL = !!(canvas.getContext('webgl2') || canvas.getContext('webgl'))
  } catch {
    // WebGL blocked (privacy mode, old GPU): hasWebGL stays false
  }
  return {
    userAgent: win.navigator.userAgent,
    maxTouchPoints: win.navigator.maxTouchPoints || 0,
    isSecureContext: win.isSecureContext,
    hasGetUserMedia: !!win.navigator.mediaDevices?.getUserMedia,
    hasWebGL,
    hasDeviceMotion: 'DeviceMotionEvent' in win,
  }
}
