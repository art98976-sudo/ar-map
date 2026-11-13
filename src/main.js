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

const root = document.getElementById('app')

// Group D: the short link on a poster, /p/<id>, opens that place's card with Go ready.
const short = /^\/p\/([\w.-]+)\/?$/.exec(window.location.pathname)
if (short) window.history.replaceState(null, '', `/#/?${new URLSearchParams({to: decodeURIComponent(short[1]), go: '1'})}`)

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

window.addEventListener('offline', () => showToast('Offline, showing saved map', {tone: 'warning'}))
window.addEventListener('online', () => showToast('Back online', {tone: 'success'}))

document.documentElement.classList.remove('no-js')
startOpening()
registerServiceWorker()
router.start()
