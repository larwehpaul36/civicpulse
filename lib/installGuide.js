// Who needs the "add to Home Screen" instructions? On iPhones and iPads, web notifications only work once the site has been
// added to the Home Screen. Android and computers do not need that step. Pure functions, so tests/installGuide.test.mjs covers them.
export function isIOS({ ua = '', platform = '', maxTouchPoints = 0 } = {}) {
  // Newer iPads report themselves as a Mac, so a Mac with a touch screen is an iPad.
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1);
}

export function needsInstallGuide(env = {}) {
  return isIOS(env) && !env.standalone;
}

// Reads the facts from the browser. Never throws: if anything is missing the guide is simply not shown.
export function readEnvironment(win = typeof window === 'undefined' ? null : window) {
  try {
    const nav = win.navigator;
    return {
      ua: nav.userAgent || '', platform: nav.platform || '', maxTouchPoints: nav.maxTouchPoints || 0,
      standalone: nav.standalone === true || !!win.matchMedia?.('(display-mode: standalone)').matches,
    };
  } catch { return {}; }
}
