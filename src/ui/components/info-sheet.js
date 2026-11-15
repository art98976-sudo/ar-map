// About, privacy, the disclaimer and the licence notices we must show
// (8th Wall engine, MazeMap, OpenStreetMap, fonts). Opened from the ⓘ button on the map.
import {html, raw} from '../dom.js'
import {APP} from '../../config.js'
import {getLocale, SOURCE_LOCALE, t} from '../../i18n/i18n.js'

export function infoSheetContent() {
  const english = getLocale().id === SOURCE_LOCALE
  // In a translation, the legal notices stay in their English original, marked as such.
  const en = english ? '' : raw(' lang="en-GB" dir="ltr"')
  return html`
    <div class="about">
      <img src="/brand/stirling-logo.svg" alt="${APP.university}" width="160" height="40" />
      <h2 class="sheet__title" id="info-title" tabindex="-1">${t('about.title', {app: APP.name})}</h2>
      <p class="about__note" data-disclaimer>${english ? APP.disclaimer : t('about.disclaimer')}</p>
      ${english ? '' : html`<p class="about__note" data-draft>${t('about.draft')}</p>`}
      <p>${t('about.lede')}</p>

      <section class="about__block">
        <h3>${t('about.privacy')}</h3>
        <p>${t('about.privacyCamera')}</p>
        <p>${t('about.privacyRoute')}</p>
        <p data-privacy-counts>${t('about.privacyCounts')}</p>
        <p data-privacy-errors>${t('about.privacyErrors')}</p>
      </section>

      <section class="about__block">
        <h3>${t('about.maps')}</h3>
        <p>${t('about.mapsMazeMap')}</p>
        <p>
          ${t('about.mapsOsm')}
          <a class="link" href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener"${en}>Open Database Licence</a>.
        </p>
      </section>

      <section class="about__block">
        <h3>${t('about.engine')}</h3>
        ${english ? '' : html`<p class="about__note">${t('about.inEnglish')}</p>`}
        <p${en}>
          This product includes the XR Engine software developed by Niantic Spatial, Inc. Copyright © 2026 Niantic Spatial,
          Inc. All rights reserved. The XR Engine is licensed under the
          <a class="link" href="https://github.com/8thwall/engine/blob/main/LICENSE" target="_blank" rel="noopener">XR Engine License Agreement</a>,
          and is provided “as is”, without warranties of any kind (see section 4, Disclaimers, of that agreement). Its full
          licence text is also served with this site at
          <a class="link" href="/external/xr/LICENSE" target="_blank" rel="noopener">/external/xr/LICENSE</a>.
        </p>
      </section>

      <section class="about__block">
        <h3>${t('about.software')}</h3>
        <ul class="about__list"${en}>
          <li>three.js, MIT licence</li>
          <li>Inter typeface by The Inter Project Authors, SIL Open Font Licence 1.1</li>
        </ul>
      </section>
    </div>
  `
}
