// The Ember apps people can download, and which one this device most likely wants (no React, so it can be tested).
// /bonfire/download sends ?os=mac to the Mac dmg and anything else to the Windows installer; Android has its own page.
export const APP_TARGETS = {
  windows: { name: 'Windows', path: '/bonfire/download?os=windows', about: 'Desktop notifications, game status and more.' },
  mac: { name: 'macOS', path: '/bonfire/download?os=mac', about: 'Desktop notifications, game status and more.' },
  android: { name: 'Android', path: '/bonfire/android/', about: 'Notifications, swipe gestures and a smoother phone experience.' },
};

// 'windows', 'mac', 'android', or null when there is no app for this device (iPhone, iPad, Linux): the person picks one
export function detectAppTarget(ua = '', touchPoints = 0) {
  if (/Android/i.test(ua)) return 'android';
  if (/iPhone|iPad|iPod/i.test(ua)) return null;
  if (/Macintosh|Mac OS X/i.test(ua)) return touchPoints > 1 ? null : 'mac'; // an iPad's browser says it is a Mac, but a Mac has no touch screen
  if (/Windows/i.test(ua)) return 'windows';
  return null;
}
