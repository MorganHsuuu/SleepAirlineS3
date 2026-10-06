'use strict';

// Shared by the full-screen and classic pages. Capture before pairing clears queries.
(function (root) {
  const enabled = new URLSearchParams(root.location?.search || '').get('device') === '1';

  function validSample(data) {
    return data?.version === 2 && typeof data.session === 'string' && data.session.length > 0
      && ['takeoffCount', 'landCount'].every((key) => Number.isSafeInteger(data[key]) && data[key] >= 0)
      && typeof data.takeoffClosed === 'boolean' && typeof data.landClosed === 'boolean'
      && (data.direction === null || (Number.isInteger(data.direction) && data.direction >= 0 && data.direction < 8));
  }

  function createController({ getState, setDirection, takeoff, land, notify }) {
    let previous = null;
    let pendingLand = false;
    let adcFailed = false;
    return {
      reset() { previous = null; pendingLand = false; },
      accept(data) {
        if (!validSample(data)) throw new Error('Expected device_bridge.py protocol v2');
        const state = getState();
        const canDepart = !state.busy && !state.sleepDial && ['ready', 'landed'].includes(state.stage);
        if (canDepart && data.direction !== null && data.direction !== state.direction) {
          setDirection(data.direction);
        }
        if (data.direction === null && !adcFailed) notify('旋鈕暫時無法讀取，請檢查 ADS1115 接線');
        adcFailed = data.direction === null;

        // First contact, a reconnect or a restarted Python process establishes a baseline.
        // A magnet left in place must never launch a flight on page load.
        const baseline = !previous || previous.session !== data.session
          || data.takeoffCount < previous.takeoffCount || data.landCount < previous.landCount;
        const takeoffEdge = !baseline && data.takeoffCount > previous.takeoffCount;
        const landEdge = !baseline && data.landCount > previous.landCount;
        previous = { ...data };
        if (baseline) { pendingLand = false; return; }

        if ((data.takeoffClosed && data.landClosed) || (takeoffEdge && landEdge)) {
          pendingLand = false;
          if (takeoffEdge || landEdge) notify('兩個磁簧同時觸發，請移開後再靠近其中一個');
          return;
        }
        if (['ready', 'landed'].includes(state.stage)) pendingLand = false;
        if (takeoffEdge && canDepart) {
          takeoff();
          return;
        }
        if (landEdge && ['takeoff', 'cruise'].includes(state.stage)) pendingLand = true;
        if (pendingLand && state.stage === 'cruise' && !state.busy) {
          pendingLand = false;
          land();
        }
      },
    };
  }

  function start(adapter) {
    if (!enabled) return;
    const controller = createController(adapter);
    let connected = false;
    let warned = false;
    // A real gesture is still required by browsers for audio playback.
    root.document.addEventListener('pointerdown', () => {
      root.BroadcastAudio?.primeFromUserGesture?.();
      root.BroadcastAudio?.armWakeupCarrier?.();
    }, { once: true, capture: true });
    async function poll() {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 2500);
      try {
        const response = await fetch('http://127.0.0.1:8765/state', {
          cache: 'no-store', signal: abort.signal, targetAddressSpace: 'loopback',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!validSample(data)) throw new Error('請啟動新版 device_bridge.py');
        if (!connected) adapter.notify('裝置控制已連線，移開磁鐵後再靠近即可觸發');
        controller.accept(data);
        connected = true;
        warned = false;
      } catch (error) {
        controller.reset();
        if (!warned) adapter.notify('裝置未連線，請啟動 device_bridge.py 並允許瀏覽器存取本機裝置');
        if (!warned) console.warn('Device controls:', error);
        warned = true;
        connected = false;
      } finally {
        clearTimeout(timeout);
        setTimeout(poll, connected ? 150 : 2000);
      }
    }
    void poll();
  }

  const api = { enabled, start, createController };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlightDeviceControls = api;
})(globalThis);
