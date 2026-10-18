'use strict';

// Shared by the full-screen and classic pages. A Pi bridge is discovered on the
// same browser; ordinary visitors continue to use the page without device UI.
(function (root) {
  const enabled = true;
  const kioskStatusUrl = 'http://127.0.0.1:8766/api/status';

  // Chrome always logs failed loopback fetches. Ordinary laptops/phones have no
  // Pi kiosk, so skip 8766/8765 unless this looks like the hardware browser.
  function shouldProbeLocalBridge(nav = root.navigator, loc = root.location) {
    try {
      const params = new URLSearchParams(loc?.search || '');
      if (params.get('device') === '1' || params.get('kiosk') === '1') return true;
    } catch { /* ignore */ }
    const ua = String(nav?.userAgent || '');
    const platform = String(nav?.platform || '');
    if (/Android|iPhone|iPad|iPod/i.test(ua)) return false;
    return /(aarch64|armv[6-8]|arm64)/i.test(`${ua} ${platform}`) && /Linux|X11/i.test(`${ua} ${platform}`);
  }

  function showError(message) {
    if (!root.document) return;
    let panel = root.document.getElementById('device-error');
    if (!panel) {
      panel = root.document.createElement('div');
      panel.id = 'device-error';
      panel.className = 'device-error';
      panel.setAttribute('role', 'alert');
      root.document.body.appendChild(panel);
    }
    panel.textContent = message || '';
    panel.hidden = !message;
  }

  function validSample(data) {
    return data?.version === 2 && typeof data.session === 'string' && data.session.length > 0
      && ['takeoffCount', 'landCount'].every((key) => Number.isSafeInteger(data[key]) && data[key] >= 0)
      && typeof data.takeoffClosed === 'boolean' && typeof data.landClosed === 'boolean'
      && (data.direction === null || (Number.isInteger(data.direction) && data.direction >= 0 && data.direction < 8));
  }

  function createController({ getState, setDirection, takeoff, land, notify, setError }) {
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
        setError?.('adc', data.direction === null
          ? `ADS1115 讀取失敗：${data.adcError || '無法取得旋鈕讀值'}。請檢查 I2C、供電與接線。`
          : '');
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
    if (root.document) {
      root.document.addEventListener('pointerdown', () => {
        root.BroadcastAudio?.primeFromUserGesture?.();
        root.BroadcastAudio?.armWakeupCarrier?.();
      }, { once: true, capture: true });
    }
    if (!shouldProbeLocalBridge()) return;
    const errors = { bridge: '', adc: '' };
    const setError = (kind, message) => {
      errors[kind] = message;
      showError(errors.bridge || errors.adc);
    };
    const controller = createController({ ...adapter, setError });
    let connected = false;
    let kioskDetected = false;
    let bridgeExitCode = null;
    let kioskMisses = 0;
    async function probeKiosk() {
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 2500);
      try {
        const response = await fetch(kioskStatusUrl, {
          cache: 'no-store', signal: abort.signal, targetAddressSpace: 'loopback',
        });
        if (!response.ok) throw new Error('kiosk missing');
        const status = await response.json();
        kioskDetected = true;
        kioskMisses = 0;
        bridgeExitCode = status.bridgeExitCode;
      } catch {
        kioskDetected = false;
        kioskMisses += 1;
        bridgeExitCode = null;
        /* Ordinary web visitors have no local kiosk. */
      } finally {
        clearTimeout(timeout);
        const wait = kioskDetected
          ? 3000
          : Math.min(60000, 5000 * (2 ** Math.min(Math.max(kioskMisses - 1, 0), 3)));
        setTimeout(probeKiosk, wait);
      }
    }
    void probeKiosk();
    async function poll() {
      if (!kioskDetected) {
        setTimeout(poll, 2000);
        return;
      }
      const abort = new AbortController();
      const timeout = setTimeout(() => abort.abort(), 2500);
      try {
        const response = await fetch('http://127.0.0.1:8765/state', {
          cache: 'no-store', signal: abort.signal, targetAddressSpace: 'loopback',
        });
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();
        if (!validSample(data)) throw new Error('請啟動新版 device_bridge.py');
        if (typeof data.passengerId === 'string' && /^PAX-[A-Z0-9]{8,32}$/.test(data.passengerId)) {
          adapter.setPassenger?.(data.passengerId);
        } else if (data.passengerId === null) {
          root.location.replace('http://127.0.0.1:8766/device');
          return;
        }
        if (!connected) adapter.notify('裝置控制已連線，移開磁鐵後再靠近即可觸發');
        controller.accept(data);
        connected = true;
        setError('bridge', '');
      } catch (error) {
        controller.reset();
        if (connected || kioskDetected) {
          const detail = bridgeExitCode === null || bridgeExitCode === undefined
            ? error.message || '瀏覽器無法存取本機程式'
            : `橋接程式已結束，代碼 ${bridgeExitCode}`;
          setError('bridge', `裝置感測器未連線：${detail}。請查看樹莓派終端機與瀏覽器的本機網路權限。`);
          setError('adc', '');
        }
        connected = false;
      } finally {
        clearTimeout(timeout);
        setTimeout(poll, connected ? 150 : 2000);
      }
    }
    void poll();
  }

  const api = { enabled, start, createController, shouldProbeLocalBridge };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FlightDeviceControls = api;
})(globalThis);
