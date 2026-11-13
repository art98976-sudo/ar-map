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
import {showToast} from './ui/components/toast.js'

const root = document.getElementById('app')

const router = createRouter({
  root,
  routes: {
    '/': homeScreen,
    '/locate': locateScreen,
    '/ar': arScreen,
    '/premium': premiumScreen,
    '/indoor': indoorScreen,
  },
})

// Never leave a blank screen: report unexpected errors and keep the app usable.
window.addEventListener('error', (event) => console.error('[app] error', event.error || event.message))
window.addEventListener('unhandledrejection', (event) => console.error('[app] unhandled', event.reason))

window.addEventListener('offline', () => showToast('You are offline', {tone: 'warning'}))
window.addEventListener('online', () => showToast('Back online', {tone: 'success'}))

document.documentElement.classList.remove('no-js')
router.start()
