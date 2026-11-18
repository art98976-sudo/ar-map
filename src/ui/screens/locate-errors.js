/** Plain words for each failure, with steps for iPhone or Android. */
export function locationErrorCopy(code, device = {os: 'other'}) {
  const ios = device.os === 'ios'
  switch (code) {
    case 'denied':
      return {
        icon: 'pin',
        tone: 'warn',
        title: 'Location access is off',
        body: 'Directions need your location to know where you are starting from.',
        steps: ios
          ? [
              'Tap “aA” in the Safari address bar, then Website Settings.',
              'Set Location to Allow.',
              'Still blocked? Open Settings → Privacy & Security → Location Services → Safari Websites → While Using the App.',
            ]
          : ['Tap the icon left of the address bar.', 'Tap Permissions.', 'Turn on Location.'],
        primary: {action: 'reload', label: 'Try again'},
      }
    case 'unavailable':
      return {
        icon: 'pin',
        tone: 'warn',
        title: 'Your location is turned off',
        body: 'Your phone could not find its position. Location may be switched off.',
        steps: ios
          ? ['Open Settings → Privacy & Security.', 'Turn on Location Services.', 'Come back and tap Try again.']
          : ['Swipe down from the top of the screen.', 'Turn on Location.', 'Come back and tap Try again.'],
        primary: {action: 'retry', label: 'Try again'},
      }
    case 'no-route':
      return {
        icon: 'map',
        tone: 'warn',
        title: 'We could not plan a route',
        body: 'Something went wrong while planning the walk. Check your connection and try again.',
        primary: {action: 'retry', label: 'Try again'},
      }
    case 'no-indoor-route':
      return {
        icon: 'map',
        tone: 'warn',
        title: 'Indoor route unavailable',
        body: 'MazeMap could not connect a route from this floor. Choose the room and floor where you are standing, check your connection, then try again.',
        primary: {action: 'retry', label: 'Try again'},
      }
    case 'indoor-map-failed':
      return {
        icon: 'map',
        tone: 'warn',
        title: "Indoor map didn't load",
        body: 'The route goes inside a building, and its floor plan could not be downloaded. Without it the arrows could point the wrong way, so AR will not start.',
        primary: {action: 'retry', label: 'Retry'},
        mapLabel: 'Show 2D route',
        noStartChoice: true,
      }
    case 'timeout':
      return {
        icon: 'sun',
        tone: 'warn',
        title: 'We could not find you',
        body: 'GPS took too long. Step outside, away from tall buildings, and try again.',
        primary: {action: 'retry', label: 'Try again'},
      }
    default:
      return {
        icon: 'alert',
        tone: 'bad',
        title: 'Location is not available',
        body: 'This browser cannot share your location. Try Safari on iPhone or Chrome on Android.',
        primary: {action: 'retry', label: 'Try again'},
      }
  }
}
