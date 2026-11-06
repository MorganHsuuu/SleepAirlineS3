'use strict';
(function (root) {
  function run(env, start, waiting = () => {}) {
    const device = env.FlightDeviceControls?.shouldProbeLocalBridge?.();
    if (!device || !env.navigator?.locks?.request) return Promise.resolve().then(start);
    // A restored bfcache page must reacquire ownership before its old timers run.
    env.addEventListener('pageshow', event => { if (event.persisted) env.location.reload(); });
    let acquired = false;
    const timer = env.setTimeout(() => { if (!acquired) waiting(); }, 150);
    return env.navigator.locks.request('sleep-airline-device-window', async () => {
      acquired = true; env.clearTimeout(timer);
      let release;
      const closed = new Promise(resolve => { release = resolve; });
      const hide = () => {
        for (const [name, options] of [['stopPlayback', undefined], ['stopTowerSignalLoop', undefined], ['stopFlightSfx', { fade: false }], ['stopLandingMusic', { fade: false }]]) {
          try { Promise.resolve(env.BroadcastAudio?.[name]?.(options)).catch(() => {}); } catch { /* closing */ }
        }
        release();
      };
      env.addEventListener('pagehide', hide, { once: true });
      try { await start(); await closed; }
      finally { env.removeEventListener('pagehide', hide); }
    }).finally(() => env.clearTimeout(timer));
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { run };
  else root.KioskSession = { run: (start, waiting) => run(root, start, waiting) };
})(globalThis);
