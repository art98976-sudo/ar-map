// App start: load styles, register screens, start the router.
import './styles/tokens.css'
import './styles/base.css'
import './styles/components.css'
import './styles/screens.css'
import './styles/home.css'
import './styles/ar.css'
import './styles/search.css'
import './styles/premium.css'

import {createRouter} from './ui/router.js'
import {homeScreen} from './ui/screens/home.js'
import {arScreen} from './ui/screens/ar.js'
import {locateScreen} from './ui/screens/locate.js'
import {premiumScreen} from './premium/premium.js'
import {indoorScreen} from './ui/screens/indoor.js'
import {statsScreen} from './ui/screens/stats.js'
import {qrScreen} from './ui/screens/qr.js'
import {showToast} from './ui/components/toast.js'
import {startOpening} from './ui/opening.js'
import {registerServiceWorker} from './offline.js'
import {watchGlobalErrors} from './stats/errors.js'
import {setStart} from './route/start-point.js'

const root = document.getElementById('app')

// Group D: the short link on a poster, /p/<id>, opens that place's card with Go ready.
const short = /^\/p\/([\w.-]+)\/?$/.exec(window.location.pathname)
if (short) window.history.replaceState(null, '', `/#/?${new URLSearchParams({to: decodeURIComponent(short[1]), go: '1'})}`)

// Item 8: a calibration sign, /c/<id>: start the trip exactly there (place and direction), then
// ask where to. An unknown sign just opens the map.
const signPath = /^\/c\/([\w.-]+)\/?$/.exec(window.location.pathname)
// The sign data loads only for a sign's link; the screens wait for it (no top-level await, which
// would split the start-up code into many small files).
const signReady = signPath
  ? import('./route/markers.js')
      .then(({findMarker, markerStart}) => {
        const marker = findMarker(decodeURIComponent(signPath[1]))
        if (marker) setStart(markerStart(marker))
        window.history.replaceState(null, '', marker ? `/#/?${new URLSearchParams({sign: marker.id})}` : '/#/')
      })
      .catch(() => window.history.replaceState(null, '', '/#/'))
  : Promise.resolve()

const router = createRouter({
  root,
  routes: {
    '/': homeScreen,
    '/locate': locateScreen,
    '/ar': arScreen,
    '/premium': premiumScreen,
    '/indoor': indoorScreen,
    '/stats': statsScreen,
    '/qr': qrScreen,
  },
})

// Never leave a blank screen: report unexpected errors and keep the app usable.
window.addEventListener('error', (event) => console.error('[app] error', event.error || event.message))
window.addEventListener('unhandledrejection', (event) => console.error('[app] unhandled', event.reason))
// And count them anonymously: the kind only, never the message (src/stats/errors.js).
watchGlobalErrors(window)

window.addEventListener('offline', () => showToast('Offline, showing saved map', {tone: 'warning'}))
window.addEventListener('online', () => showToast('Back online', {tone: 'success'}))

document.documentElement.classList.remove('no-js')
startOpening()
registerServiceWorker()
signReady.then(() => router.start())
