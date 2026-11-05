// About, privacy and the licence notices we must show (8th Wall engine, MazeMap, fonts).
import {html, onAction, render} from '../dom.js'
import {icon} from '../icons.js'
import {APP} from '../../config.js'

export function aboutScreen(root, {navigate}) {
  render(
    root,
    html`
      <div class="page page--narrow">
        <header class="page__bar">
          <button class="icon-btn" data-action="back" aria-label="Back">${icon('arrowLeft')}</button>
        </header>
        <main class="about">
          <img src="/brand/stirling-logo.svg" alt="${APP.university}" width="160" height="40" />
          <h1 class="page__title" tabindex="-1">About ${APP.name}</h1>
          <p class="about__note" data-disclaimer>${APP.disclaimer}</p>
          <p class="page__lede">
            Augmented-reality wayfinding for the ${APP.university} campus. Pick a place, allow your location and follow the arrows on the ground.
            No app to install.
          </p>

          <section class="about__block">
            <h2>Privacy</h2>
            <p>
              The camera feed is processed on your phone and is never uploaded or stored. We do not ask you to sign in and
              we do not collect personal data.
            </p>
          </section>

          <section class="about__block">
            <h2>Maps</h2>
            <p>Campus map, buildings and indoor floors: the University of Stirling MazeMap campus map, © MazeMap.</p>
            <p>
              Backup walking paths: © OpenStreetMap contributors, available under the
              <a class="link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">Open Database Licence</a>.
            </p>
          </section>

          <section class="about__block">
            <h2>AR engine</h2>
            <p>
              This product includes the XR Engine software developed by Niantic Spatial, Inc. Copyright © 2026 Niantic
              Spatial, Inc. All rights reserved. The XR Engine is licensed under the
              <a class="link" href="https://github.com/8thwall/engine/blob/main/LICENSE" target="_blank" rel="noopener">XR Engine License Agreement</a>,
              and is provided “as is”, without warranties of any kind (see section 4, Disclaimers, of that agreement).
              Its full licence text is also served with this site at
              <a class="link" href="/external/xr/LICENSE" target="_blank" rel="noopener">/external/xr/LICENSE</a>.
            </p>
          </section>

          <section class="about__block">
            <h2>Open-source software</h2>
            <ul class="about__list">
              <li>three.js, MIT licence</li>
              <li>General Sans typeface by the Indian Type Foundry, ITF Free Font Licence</li>
            </ul>
          </section>
        </main>
      </div>
    `,
  )
  return onAction(root, {back: () => navigate('/')})
}
