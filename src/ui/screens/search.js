// "Where to?" The start of a trip: tap a destination, and the phone asks for what AR needs.
import {createDestinationSearch} from '../components/destination-search.js'
import {setCurrentDestination} from '../../nav/destinations.js'
import {deviceIssue} from '../../ar/device.js'
import {startPermissionRequests} from '../../ar/permissions.js'
import {html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'

export function searchScreen(root, {navigate, params}) {
  render(
    root,
    html`
      <div class="page page--narrow search-screen">
        <header class="page__bar">
          <button class="icon-btn" type="button" data-action="back" aria-label="Back">${icon('arrowLeft')}</button>
        </header>
        <main>
          <h1 class="page__title" tabindex="-1">Where do you want to go?</h1>
          <p class="page__lede">Search for a building, room or service. Then follow the arrows on the ground to the entrance.</p>
          <div class="search-screen__box" data-search></div>
        </main>
      </div>
    `,
  )

  const search = createDestinationSearch(root.querySelector('[data-search]'), {
    label: 'Search for a destination',
    onSelect: (dest) => {
      // First, inside the tap: iPhone only shows the motion prompt here.
      if (!deviceIssue(params.force === '1')) startPermissionRequests()
      setCurrentDestination(dest)
      const force = params.force === '1' ? '&force=1' : ''
      const debug = params.debug === '1' ? '&debug=1' : ''
      navigate(`/locate?to=${encodeURIComponent(dest.id)}${force}${debug}`)
    },
  })
  // Opening the keyboard straight away helps on Android; iPhone opens it on first tap.
  const focusTimer = setTimeout(() => search.focus(), 60)

  const off = onAction(root, {back: () => navigate('/')})
  return () => {
    clearTimeout(focusTimer)
    search.destroy()
    off()
  }
}
