/** What to tell the user for each failure. Plain words, and always a next step. */
export function errorCopy(code, device = {os: 'other'}) {
  const ios = device.os === 'ios'
  switch (code) {
    case 'camera-denied':
      return {
        icon: 'camera',
        tone: 'warn',
        title: 'Camera access is off',
        body: 'AR needs the camera to see the ground and draw the arrows. Turn it on, then try again.',
        steps: ios
          ? ['Tap “aA” in the Safari address bar.', 'Tap Website Settings.', 'Set Camera to Allow.']
          : ['Tap the icon left of the address bar.', 'Tap Permissions.', 'Turn on Camera.'],
        primary: {action: 'reload', label: 'Try again', icon: 'refresh'},
      }
    case 'motion-denied':
      return {
        icon: 'compass',
        tone: 'warn',
        title: 'Motion access is off',
        body: ios
          ? 'Motion keeps the arrows fixed to the floor while you walk. Reload, then tap Allow when asked.'
          : 'Motion keeps the arrows fixed to the floor while you walk. Reload, then allow motion when asked.',
        steps: ios
          ? ['Tap Reload and allow motion below.', 'Tap Allow when Safari asks about motion.', 'Still no prompt? Close this tab and open the link again.']
          : ['Tap the icon left of the address bar.', 'Tap Permissions.', 'Turn on Motion sensors.'],
        primary: {action: 'reload', label: 'Reload and allow motion', icon: 'refresh'},
      }
    case 'offline':
      return {
        icon: 'wifiOff',
        tone: 'warn',
        title: 'You are offline',
        body: 'Connect to Wi-Fi (eduroam works) or mobile data to download AR the first time.',
        primary: {action: 'retry', label: 'Try again', icon: 'refresh'},
      }
    case 'timeout':
      return {
        icon: 'wifiOff',
        tone: 'warn',
        title: 'This is taking too long',
        body: 'The connection looks slow. Move closer to Wi-Fi and try again.',
        primary: {action: 'retry', label: 'Try again', icon: 'refresh'},
      }
    case 'camera-missing':
      return {
        icon: 'camera',
        tone: 'bad',
        title: 'No rear camera found',
        body: 'AR needs the camera on the back of your phone. Try a different phone, or use the 2D map.',
        primary: {action: 'reload', label: 'Try again', icon: 'refresh'},
      }
    case 'camera-failed':
      return {
        icon: 'camera',
        tone: 'bad',
        title: 'The camera did not start',
        body: 'Another app may be using it. Close other camera apps, then try again.',
        primary: {action: 'reload', label: 'Try again', icon: 'refresh'},
      }
    case 'webgl-lost':
      return {
        icon: 'camera',
        tone: 'warn',
        title: 'AR paused',
        body: 'Your phone stopped the 3D graphics, often to save memory or after a while in the background.',
        primary: {action: 'reload', label: 'Tap to reload AR', icon: 'refresh'},
      }
    case 'runtime':
      return {
        icon: 'alert',
        tone: 'bad',
        title: 'AR stopped',
        body: 'Something went wrong on this device. Reloading usually fixes it.',
        primary: {action: 'reload', label: 'Reload', icon: 'refresh'},
      }
    default:
      return {
        icon: 'alert',
        tone: 'bad',
        title: 'AR could not load',
        body: 'Check your connection and try again.',
        primary: {action: 'retry', label: 'Try again', icon: 'refresh'},
      }
  }
}
