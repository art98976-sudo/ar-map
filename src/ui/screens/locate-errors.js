import {t} from '../../i18n/i18n.js'

/** Plain words for each failure, with steps for iPhone or Android. */
export function locationErrorCopy(code, device = {os: 'other'}) {
  const ios = device.os === 'ios'
  const tryAgain = (action) => ({action, label: t('common.tryAgain')})
  switch (code) {
    case 'denied':
      return {
        icon: 'pin',
        tone: 'warn',
        title: t('locErr.deniedTitle'),
        body: t('locErr.deniedBody'),
        steps: ios
          ? [t('locErr.deniedIos1'), t('locErr.deniedIos2'), t('locErr.deniedIos3')]
          : [t('steps.androidIcon'), t('steps.androidPermissions'), t('locErr.deniedAndroid3')],
        primary: tryAgain('reload'),
      }
    case 'unavailable':
      return {
        icon: 'pin',
        tone: 'warn',
        title: t('locErr.offTitle'),
        body: t('locErr.offBody'),
        steps: ios
          ? [t('locErr.offIos1'), t('locErr.offIos2'), t('locErr.comeBack')]
          : [t('locErr.offAndroid1'), t('locErr.deniedAndroid3'), t('locErr.comeBack')],
        primary: tryAgain('retry'),
      }
    case 'no-route':
      return {
        icon: 'map',
        tone: 'warn',
        title: t('locErr.noRouteTitle'),
        body: t('locErr.noRouteBody'),
        primary: tryAgain('retry'),
      }
    case 'timeout':
      return {
        icon: 'sun',
        tone: 'warn',
        title: t('locErr.timeoutTitle'),
        body: t('locErr.timeoutBody'),
        primary: tryAgain('retry'),
      }
    default:
      return {
        icon: 'alert',
        tone: 'bad',
        title: t('locErr.otherTitle'),
        body: t('locErr.otherBody'),
        primary: tryAgain('retry'),
      }
  }
}
