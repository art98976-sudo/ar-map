// About, privacy, the disclaimer and the licence notices we must show
// (8th Wall engine, MazeMap, OpenStreetMap, fonts). Opened from the ⓘ button on the map.
import {html} from '../dom.js'
import {APP} from '../../config.js'

export function infoSheetContent() {
  return html`
    <div class="about">
      <img src="/brand/stirling-logo.svg" alt="${APP.university}" width="160" height="40" />
      <h2 class="sheet__title" id="info-title" tabindex="-1">About ${APP.name}</h2>
      <p class="about__note" data-disclaimer>${APP.disclaimer}</p>
      <p>
        Augmented-reality wayfinding for the ${APP.university} campus. Pick a place on the map and follow the arrows on
        the ground. No app to install.
      </p>

      <section class="about__block">
        <h3>Privacy</h3>
        <p>
          The camera feed is processed on your phone and is never uploaded or stored. We do not ask you to sign in and we
          do not collect personal data.
        </p>
        <p>
          To plan a walk, your position and destination are sent to the University's map provider, MazeMap. Motion sensors
          and the compass stay on your phone. Recent searches are kept in this browser only.
        </p>
        <p data-privacy-counts>We count trips anonymously (started, arrived, phone and browser type) to improve the app: no location, destination or ID.</p>
        <p data-privacy-errors>If something goes wrong, we count only the kind of problem (for example “camera blocked” or “3D graphics lost”), never any details, location, route or ID.</p>
      </section>

      <section class="about__block">
        <h3>Maps</h3>
        <p>Campus map, buildings and indoor floors: the University of Stirling MazeMap campus map, © MazeMap.</p>
        <p>
          Walking routes in Stirling, backup paths on campus, the campus boundary and some places: © OpenStreetMap contributors, available under the
          <a class="link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">Open Database Licence</a>.
        </p>
      </section>

      <section class="about__block">
        <h3>AR engine</h3>
        <p>
          This product includes the XR Engine software developed by Niantic Spatial, Inc. Copyright © 2026 Niantic Spatial,
          Inc. All rights reserved. The XR Engine is licensed under the
          <a class="link" href="https://github.com/8thwall/engine/blob/main/LICENSE" target="_blank" rel="noopener">XR Engine License Agreement</a>,
          and is provided “as is”, without warranties of any kind (see section 4, Disclaimers, of that agreement). Its full
          licence text is also served with this site at
          <a class="link" href="/external/xr/LICENSE" target="_blank" rel="noopener">/external/xr/LICENSE</a>.
        </p>
      </section>

      <section class="about__block">
        <h3>Open-source software</h3>
        <ul class="about__list">
          <li>three.js, MIT licence</li>
          <li>Inter typeface by The Inter Project Authors, SIL Open Font Licence 1.1</li>
        </ul>
      </section>
    </div>
  `
}
