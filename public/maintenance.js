'use strict';
(function (root) {
  function createLongPress(open, schedule = setTimeout, cancel = clearTimeout) {
    let timer = null, origin = null;
    const reset = () => { if (timer !== null) cancel(timer); timer = null; origin = null; };
    return {
      start(x, y) { reset(); origin = [x, y]; timer = schedule(() => { reset(); open(); }, 4000); },
      move(x, y) { if (origin && Math.hypot(x - origin[0], y - origin[1]) > 12) reset(); },
      cancel: reset,
    };
  }
  function mount() {
    if (!root.document || root.document.getElementById('maintenance-hotspot')) return;
    const params = new URLSearchParams(root.location.search);
    const ua = root.navigator.userAgent || '';
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(root.location.hostname);
    const pi = !/Android|iPhone|iPad/i.test(ua) && /Linux|X11|Wayland/i.test(ua) && /aarch64|armv[6-8]|arm64|Raspberry/i.test(ua);
    if (!local && params.get('kiosk') !== '1' && params.get('device') !== '1' && !pi) return;
    const style = root.document.createElement('style');
    style.textContent = '#maintenance-hotspot{position:fixed;right:18%;bottom:12%;width:48px;height:48px;padding:0;border:0;opacity:0;background:transparent;z-index:20001;touch-action:none;user-select:none}#maintenance-message{position:fixed;bottom:22%;left:50%;transform:translateX(-50%);max-width:65%;color:white;mix-blend-mode:difference;opacity:.24;font:12px/1.5 sans-serif;z-index:20002;pointer-events:none}';
    root.document.head.appendChild(style);
    const hotspot = root.document.createElement('button');
    hotspot.id = 'maintenance-hotspot'; hotspot.type = 'button'; hotspot.tabIndex = -1;
    hotspot.setAttribute('aria-label', '開啟維護終端機');
    const message = root.document.createElement('div'); message.id = 'maintenance-message';
    message.setAttribute('role', 'status');
    root.document.body.append(hotspot, message);
    let opening = false, messageTimer;
    async function openTerminal() {
      if (opening) return;
      opening = true; clearTimeout(messageTimer);
      try {
        const abort = new AbortController();
        const timeout = setTimeout(() => abort.abort(), 5000);
        let response;
        try {
          response = await fetch('http://127.0.0.1:8766/api/maintenance/terminal', {
            method: 'POST', headers: { 'X-Sleep-Airline-Maintenance': '1' },
            signal: abort.signal, targetAddressSpace: 'loopback',
          });
        } finally { clearTimeout(timeout); }
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || `HTTP ${response.status}`);
        message.textContent = '已開啟維護終端機';
        messageTimer = setTimeout(() => { message.textContent = ''; }, 3000);
      } catch (error) {
        console.error('[maintenance terminal]', error);
        message.textContent = `無法開啟終端機：${error.message}。請確認本機配對服務已更新並啟動。`;
      } finally { opening = false; }
    }
    const gesture = createLongPress(openTerminal);
    hotspot.addEventListener('pointerdown', e => {
      if (e.button !== 0) return;
      e.preventDefault(); hotspot.setPointerCapture?.(e.pointerId); gesture.start(e.clientX, e.clientY);
    });
    hotspot.addEventListener('pointermove', e => gesture.move(e.clientX, e.clientY));
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) hotspot.addEventListener(name, gesture.cancel);
    hotspot.addEventListener('contextmenu', e => e.preventDefault());
    root.addEventListener('blur', gesture.cancel);
    root.document.addEventListener('visibilitychange', () => { if (root.document.hidden) gesture.cancel(); });
    root.document.addEventListener('keydown', e => {
      if (e.ctrlKey && e.altKey && e.code === 'KeyM' && !e.repeat) { e.preventDefault(); void openTerminal(); }
    });
  }
  if (typeof module !== 'undefined' && module.exports) module.exports = { createLongPress };
  else mount();
})(globalThis);
