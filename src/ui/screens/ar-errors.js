import {t} from '../../i18n/i18n.js'

/** What to tell the user for each failure. Plain words, and always a next step. */
export function errorCopy(code, device = {os: 'other'}) {
  const ios = device.os === 'ios'
  const action = (name, key = 'common.tryAgain') => ({action: name, label: t(key), icon: 'refresh'})
  switch (code) {
    case 'camera-denied':
      return {
        icon: 'camera',
        tone: 'warn',
        title: t('arErr.cameraTitle'),
        body: t('arErr.cameraBody'),
        steps: ios
          ? [t('arErr.cameraIos1'), t('arErr.cameraIos2'), t('arErr.cameraIos3')]
          : [t('steps.androidIcon'), t('steps.androidPermissions'), t('arErr.cameraAndroid3')],
        primary: action('reload'),
      }
    case 'motion-denied':
      return {
        icon: 'compass',
        tone: 'warn',
        title: t('arErr.motionTitle'),
        body: t(ios ? 'arErr.motionBodyIos' : 'arErr.motionBody'),
        steps: ios
          ? [t('arErr.motionIos1'), t('arErr.motionIos2'), t('arErr.motionIos3')]
          : [t('steps.androidIcon'), t('steps.androidPermissions'), t('arErr.motionAndroid3')],
        primary: action('reload', 'arErr.motionAction'),
      }
    case 'offline':
      return {
        icon: 'wifiOff',
        tone: 'warn',
        title: t('arErr.offlineTitle'),
        body: t('arErr.offlineBody'),
        primary: action('retry'),
      }
    case 'timeout':
      return {
        icon: 'wifiOff',
        tone: 'warn',
        title: t('arErr.slowTitle'),
        body: t('arErr.slowBody'),
        primary: action('retry'),
      }
    case 'camera-missing':
      return {
        icon: 'camera',
        tone: 'bad',
        title: t('arErr.noCameraTitle'),
        body: t('arErr.noCameraBody'),
        primary: action('reload'),
      }
    case 'camera-failed':
      return {
        icon: 'camera',
        tone: 'bad',
        title: t('arErr.cameraFailedTitle'),
        body: t('arErr.cameraFailedBody'),
        primary: action('reload'),
      }
    case 'webgl-lost':
      return {
        icon: 'camera',
        tone: 'warn',
        title: t('arErr.lostTitle'),
        body: t('arErr.lostBody'),
        primary: action('reload', 'arErr.lostAction'),
      }
    case 'runtime':
      return {
        icon: 'alert',
        tone: 'bad',
        title: t('arErr.runtimeTitle'),
        body: t('arErr.runtimeBody'),
        primary: action('reload', 'common.reload'),
      }
    default:
      return {
        icon: 'alert',
        tone: 'bad',
        title: t('arErr.otherTitle'),
        body: t('arErr.otherBody'),
        primary: action('retry'),
      }
  }
}
