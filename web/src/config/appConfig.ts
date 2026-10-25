/**
 * Settings for the AR arrows, the arrival moment, the AR screen and the first-run tutorial.
 * Change text, distances and timings here; the rest of the app reads them from this file.
 *
 * Distances are in metres, times in milliseconds.
 */
export const APP_CONFIG = {
  /** Feature 1: the animated arrows on the ground. */
  arrows: {
    /** Gap between arrows along the route. */
    spacingM: 1.75,
    /** Only the next stretch of route gets arrows, to keep the view clean. */
    showAheadM: 13,
    /** Arrows start this far in front of your feet, and fade in over the next metre. */
    firstArrowM: 1,
    /** Height above the detected floor. A little lift stops the arrows flickering into the ground. */
    liftM: 0.015,
    /** One wave of light runs from the nearest arrow to the farthest in this time, then repeats. */
    waveCycleMs: 1500,
    /** Length of the bright band of the wave. */
    waveWidthM: 3,
    /** Brightness of an arrow the wave is not passing over (0 to 1). */
    dimLevel: 0.65,
    /** The wave gently grows and shrinks each arrow between these sizes. */
    scaleMin: 0.95,
    scaleMax: 1.05,
    /** Opacity of the nearest arrows and of the farthest ones. */
    nearOpacity: 1,
    farOpacity: 0.12,
    /**
     * How quickly arrows glide to a corrected position (per second). Higher follows faster;
     * lower is smoother. Ground tracking only: the camera view is already smoothed.
     */
    glidePerSecond: 8,
  },

  /** Feature 2: arriving at the destination. */
  arrival: {
    /** You have arrived within this distance of the destination. */
    radiusM: 5,
    /** The pin floats this high above the destination. */
    pinHeightM: 1.4,
    /** The pin bobs up and down by this much... */
    pinBobM: 0.08,
    /** ...once in this time. */
    pinBobPeriodMs: 1800,
    /** The pin pops in over this time when it first comes into view. */
    pinPopMs: 450,
    /** Arrows fade out over this time once you have arrived. */
    arrowFadeMs: 900,
    /** Vibration on arrival: buzz, pause, buzz. Ignored where phones cannot vibrate. */
    vibrationMs: [90, 70, 140],
  },

  /** Feature 3: the AR screen. */
  arScreen: {
    /** Each short message shows for this long. One at a time. */
    toastMs: 2500,
    /** The bottom bar fades after this long without a touch. A tap brings it back. */
    idleFadeMs: 5000,
    /** Debug text on the AR screen. Off by default; ?ardebug=1 in the address also turns it on. */
    debug: false,
  },

  /** Feature 4: the tutorial shown the first time the app opens. */
  onboarding: {
    /** Saved in the browser once the tutorial has been seen or skipped. */
    storageKey: 'stirling-campus-map:onboarding-seen',
    /** A swipe longer than this changes the screen. */
    swipePx: 50,
  },

  /** All text these features show. */
  text: {
    /** Top bar while walking, e.g. "Turn left in 20 m". */
    nextIn: (instruction: string, distance: string) => `${instruction} in ${distance}`,
    /** Top bar when the next step is the destination. */
    arriveIn: (distance: string) => `Arrive in ${distance}`,
    arrivedTitle: (place: string) => `You've arrived at ${place}`,
    navigateElsewhere: 'Navigate somewhere else',
    done: 'Done',
    showTutorial: 'Show tutorial again',
    onboarding: {
      label: 'Welcome',
      slides: [
        { icon: 'search', title: 'Search a place', body: 'Find any building or room on campus.' },
        { icon: 'ar', title: 'Switch to AR', body: 'Tap the AR button to see directions in your camera.' },
        { icon: 'arrows', title: 'Follow the arrows', body: 'Point your phone at the floor and follow the arrows on the ground.' },
      ],
      safety: "Always watch where you're walking.",
      skip: 'Skip',
      next: 'Next',
      getStarted: 'Get started',
      goTo: (n: number) => `Go to screen ${n}`,
    },
  },
} as const;

export type OnboardingIcon = (typeof APP_CONFIG.text.onboarding.slides)[number]['icon'];
