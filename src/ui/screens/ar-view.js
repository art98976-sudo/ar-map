// The AR screen's HTML: loading, the live view and the error page.
import {html} from '../dom.js'
import {icon} from '../icons.js'

export const loadingView = () => html`
    <div class="page page--narrow page--center loading">
      <div class="progress-ring" style="--p: 0" data-progress role="progressbar" aria-label="Loading AR" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle class="progress-ring__track" cx="60" cy="60" r="52" />
          <circle class="progress-ring__bar" cx="60" cy="60" r="52" pathLength="100" />
        </svg>
        <span class="progress-ring__value" data-progress-text>0%</span>
      </div>
      <h1 class="page__title" tabindex="-1">Preparing AR</h1>
      <p class="page__lede" data-loading-text>Downloading the AR engine. This happens once.</p>
      <button class="btn btn--ghost" type="button" data-action="exit" aria-label="Cancel">Cancel</button>
    </div>
`

export const liveView = ({showDebug, routeSource, pillText, startTitle}) => html`
  <div class="ar" role="group" aria-label="AR camera view" tabindex="-1" data-autofocus>
    <canvas class="ar__canvas" data-canvas aria-label="Camera view"></canvas>
    <div class="ar__veil" data-veil>
      <span class="spinner" aria-hidden="true"></span>
      <p data-veil-text role="status">Waiting for the camera…</p>
    </div>

    <header class="ar__top">
      <button class="icon-btn icon-btn--glass" data-action="exit" aria-label="Exit AR">${icon('close')}</button>
      ${showDebug
        ? html`<div class="chip chip--glass" data-tracking-chip data-tone="pending" aria-live="polite">
            <span class="chip__dot"></span><span data-tracking-label>Starting tracking</span>
          </div>`
        : ''}
    </header>
    ${showDebug
      ? html`<button class="debug-toggle chip chip--glass" type="button" data-action="debug" aria-label="Show debug panel" aria-expanded="false" aria-controls="ar-debug">
          ${icon('info', {size: 16})}<span>Debug</span>
        </button>`
      : ''}


    <div class="ar__hints">
    <p class="ar__hint" data-compass-pill role="status" hidden>Wave your phone in a figure-8</p>
    <p class="ar__hint" data-locating role="status" hidden>Locating you…</p>
    <button class="ar__hint ar__hint--action" type="button" data-action="go-live" hidden>Switch to live location?</button>
    <button class="ar__hint ar__hint--action" type="button" data-action="repick" hidden>Off route? Choose your start again</button>
    <p class="ar__hint" data-position-hint role="status" hidden>Finding your position. Follow the map for now.</p>
    <p class="ar__hint" data-reroute-hint role="status" hidden>Finding a new route</p>
    <p class="ar__hint" data-approx-hint role="status" ${routeSource === 'direct' ? '' : 'hidden'}>Approximate route - check the 2D map</p>
    </div>

    <p class="ar-pill" data-trip-pill>${pillText}</p>

    <section class="ar-map" data-compass-map aria-label="Map of the route">
      <div class="ar-map__canvas" data-map-canvas></div>
      <canvas class="ar-map__fallback" data-minimap width="320" height="320" aria-label="Plan of the route" hidden></canvas>
      <p class="ar-map__status" data-map-status role="status">Loading map…</p>
      <button class="ar-map__tap" type="button" data-action="toggle-map" aria-label="Expand map" aria-expanded="false">
        <span class="ar-map__expand" data-map-expand>${icon('expand', {size: 18})}</span>
      </button>
    </section>

    <section class="ar-guide" data-start aria-labelledby="start-title" hidden>
      <h1 class="ar-guide__title" data-start-title id="start-title" tabindex="-1">${startTitle}</h1>
      <p class="ar-guide__text" data-start-note role="status" hidden>Hold your phone up, looking ahead.</p>
      <button class="btn btn--primary btn--block" type="button" data-action="start-walk" disabled>
        <span class="spinner spinner--sm" aria-hidden="true"></span><span data-start-label aria-live="polite">Getting ready…</span>
      </button>
    </section>

    <div class="arrival" data-arrival hidden></div>

    ${showDebug
      ? html`<section class="ar-live" data-live-debug aria-label="Live alignment">
          <dl class="ar-live__rows">
            <div><dt>Compass</dt><dd data-live="compass">–</dd></div>
            <div><dt>Source</dt><dd data-live="source">–</dd></div>
            <div><dt>Tilt (beta)</dt><dd data-live="beta">–</dd></div>
            <div><dt>SLAM yaw</dt><dd data-live="camera">–</dd></div>
            <div><dt>Align yaw</dt><dd data-live="align">–</dd></div>
            <div><dt>1st segment</dt><dd data-live="segment">–</dd></div>
            <div><dt>Look (route)</dt><dd data-live="look">–</dd></div>
          </dl>
        </section>`
      : ''}

    ${showDebug
      ? html`<section class="ar-debug" id="ar-debug" data-debug hidden aria-label="Debug panel">
      <h2 class="ar__sheet-title">Debug</h2>
      <dl class="stats">
        <div class="stats__row"><dt>Camera</dt><dd data-stat="camera">Starting…</dd></div>
        <div class="stats__row"><dt>World tracking</dt><dd data-stat="tracking">Starting…</dd></div>
        <div class="stats__row"><dt>Phase</dt><dd data-stat="phase">–</dd></div>
        <div class="stats__row"><dt>GPS accuracy</dt><dd data-stat="gps">–</dd></div>
        <div class="stats__row"><dt>Compass heading</dt><dd data-stat="heading">–</dd></div>
        <div class="stats__row"><dt>To entrance (route)</dt><dd data-stat="remaining">–</dd></div>
        <div class="stats__row"><dt>To entrance (GPS)</dt><dd data-stat="gpsdist">–</dd></div>
        <div class="stats__row"><dt>Off route</dt><dd data-stat="offroute">–</dd></div>
        <div class="stats__row"><dt>Route match</dt><dd data-stat="match">–</dd></div>
        <div class="stats__row"><dt>Match quality</dt><dd data-stat="quality">–</dd></div>
        <div class="stats__row"><dt>Next manoeuvre</dt><dd data-stat="turn">–</dd></div>
        <div class="stats__row"><dt>Camera height</dt><dd data-stat="height">–</dd></div>
        <div class="stats__row"><dt>Ground</dt><dd data-stat="ground">–</dd></div>
        <div class="stats__row"><dt>Floor below phone</dt><dd data-stat="floor">–</dd></div>
        <div class="stats__row"><dt>Route source</dt><dd data-stat="source">${routeSource}</dd></div>
        <div class="stats__row"><dt>Route points</dt><dd data-stat="route-points">–</dd></div>
        <div class="stats__row"><dt>Turns</dt><dd data-stat="turns">–</dd></div>
        <div class="stats__row"><dt>Start gap (GPS to path)</dt><dd data-stat="start-gap">–</dd></div>
        <div class="stats__row"><dt>Frame rate</dt><dd data-stat="fps">–</dd></div>
      </dl>
      <div class="ar-debug__floor">
        <button class="btn btn--secondary" type="button" data-action="floor-grid" aria-pressed="false">Floor grid</button>
        <button class="btn btn--secondary" type="button" data-action="floor-down" aria-label="Floor 5 cm lower">Floor −5 cm</button>
        <button class="btn btn--secondary" type="button" data-action="floor-up" aria-label="Floor 5 cm higher">Floor +5 cm</button>
      </div>
      <button class="btn btn--secondary btn--block" type="button" data-action="recalibrate" aria-label="Recalibrate compass">
        ${icon('compass')}<span>Recalibrate compass</span>
      </button>
    </section>`
      : ''}
  </div>
`

export const errorView = (copy) => html`
    <div class="page page--narrow page--center error-state">
      <span class="error-state__icon" data-tone="${copy.tone}">${icon(copy.icon, {size: 32})}</span>
      <h1 class="page__title" tabindex="-1">${copy.title}</h1>
      <p class="page__lede">${copy.body}</p>
      ${copy.steps
        ? html`<ol class="steps-list">
            ${copy.steps.map((s) => html`<li>${s}</li>`)}
          </ol>`
        : ''}
      <div class="error-state__actions">
        <button class="btn btn--primary btn--lg btn--block" type="button" data-action="${copy.primary.action}" aria-label="${copy.primary.label}">
          ${icon(copy.primary.icon)}<span>${copy.primary.label}</span>
        </button>
        <button class="btn btn--secondary btn--lg btn--block" type="button" data-action="map" aria-label="View 2D map instead">
          ${icon('map')}<span>View 2D map instead</span>
        </button>
      </div>
    </div>
`
