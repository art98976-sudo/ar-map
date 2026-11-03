// Home: brand hero, Start AR, campus map, and how it works.
import {html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'
import {APP} from '../../config.js'

export function homeScreen(root, {navigate}) {
  render(
    root,
    html`
      <div class="home">
        <section class="hero">
          <div class="hero__pattern" aria-hidden="true"></div>
          <div class="hero__inner">
            <img class="hero__logo" src="/brand/stirling-logo-white.svg" alt="${APP.university}" width="168" height="42" />
            <p class="eyebrow eyebrow--light">${APP.name}</p>
            <h1 class="hero__title" tabindex="-1">Find your way with arrows on the floor.</h1>
            <p class="hero__lede">
              Scan a Welcome AR sign and follow live directions to any building or room on campus.
            </p>
          </div>
        </section>

        <section class="home__panel" aria-label="Get started">
          <button class="btn btn--primary btn--lg btn--block" data-action="start">
            ${icon('camera')}<span>Start AR</span>
          </button>
          <button class="btn btn--secondary btn--lg btn--block" data-action="map">
            ${icon('map')}<span>Campus map</span>
          </button>
          <p class="privacy-note">
            ${icon('lock', {size: 16})}
            <span>The camera feed stays on your phone. No sign-in and no tracking.</span>
          </p>
        </section>

        <section class="how" aria-labelledby="how-title">
          <h2 id="how-title" class="section-title">How it works</h2>
          <ol class="how__steps">
            <li class="how__step">
              <span class="how__icon">${icon('search')}</span>
              <div><strong>Choose a destination</strong><span>A building, a room or a service.</span></div>
            </li>
            <li class="how__step">
              <span class="how__icon">${icon('scan')}</span>
              <div>
                <strong>Scan a Welcome AR sign</strong>
                <span>You'll find them at entrances, stairs and lifts.</span>
              </div>
            </li>
            <li class="how__step">
              <span class="how__icon">${icon('footsteps')}</span>
              <div><strong>Follow the arrows</strong><span>They appear on the floor and guide you there.</span></div>
            </li>
          </ol>
        </section>

        <footer class="site-footer">
          <img src="/brand/stirling-logo.svg" alt="${APP.university}" width="120" height="30" />
          <a href="#/about" class="link">About and licences</a>
        </footer>
      </div>
    `,
  )

  return onAction(root, {
    start: () => navigate('/search'),
    map: () => navigate('/map'),
  })
}
