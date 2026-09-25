/** First-login onboarding: airline narrative story + spotlight tour */
(function (global) {
  const STORAGE_PREFIX = 'sleepAirline_onboardingDone_v1::';

  function t(key, vars) {
    return global.SleepI18n?.t?.(key, vars) ?? key;
  }

  function storageKey(passengerId) {
    return STORAGE_PREFIX + String(passengerId || 'anon');
  }

  function isDone(passengerId) {
    try {
      return localStorage.getItem(storageKey(passengerId)) === '1';
    } catch {
      return false;
    }
  }

  function markDone(passengerId) {
    try {
      localStorage.setItem(storageKey(passengerId), '1');
    } catch { /* ignore */ }
  }

  function ensureRoots() {
    let story = document.getElementById('onboard-story');
    let tour = document.getElementById('onboard-tour');
    if (!story) {
      story = document.createElement('div');
      story.id = 'onboard-story';
      story.className = 'onboard-story hidden';
      story.setAttribute('aria-hidden', 'true');
      document.body.appendChild(story);
    }
    if (!tour) {
      tour = document.createElement('div');
      tour.id = 'onboard-tour';
      tour.className = 'onboard-tour hidden';
      tour.setAttribute('aria-hidden', 'true');
      document.body.appendChild(tour);
    }
    return { story, tour };
  }

  function storyPages() {
    return [
      { title: t('onboard.story1.title'), body: t('onboard.story1.body') },
      { title: t('onboard.story2.title'), body: t('onboard.story2.body') },
      { title: t('onboard.story3.title'), body: t('onboard.story3.body') },
    ];
  }

  function spotlightSteps() {
    return [
      {
        sel: '#compass-sheet',
        text: t('onboard.spot1'),
        open: 'compass',
        tipMode: 'top',
      },
      {
        sel: '#btn-takeoff',
        text: t('onboard.spot2'),
        closeSheets: true,
      },
      {
        sel: '#board-card .board-head, #board-card',
        text: t('onboard.spot3'),
        closeSheets: true,
      },
      {
        sel: '#btn-land, #flight-panel .dock-panel--cta, #ready-panel .dock-panel--cta',
        text: t('onboard.spot4'),
        closeSheets: true,
      },
    ];
  }

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async function prepareStep(step) {
    if (step.open === 'compass') {
      window.SleepAirlineSheets?.prepareCompassTour?.();
      await delay(60);
      // force：略過 canPickCompass（降落面板／飛行中）阻擋
      window.SleepAirlineSheets?.open?.('compass-sheet', { force: true });
      await delay(120);
      // 再確認一次：CSS phase / 動畫未就緒時重試
      const sheet = document.getElementById('compass-sheet');
      if (!sheet?.classList.contains('show')) {
        document.body.dataset.uiPhase = 'ready';
        window.SleepAirlineSheets?.open?.('compass-sheet', { force: true });
      }
      await delay(380);
      // 等 sheet 滑入可視區
      for (let n = 0; n < 8; n += 1) {
        if (isVisibleTarget(sheet)) break;
        document.body.dataset.uiPhase = 'ready';
        sheet?.classList.add('show');
        document.getElementById('sheet-mask')?.classList.add('show');
        document.body.classList.add('sheet-open');
        await delay(80);
      }
    } else if (step.closeSheets) {
      window.SleepAirlineSheets?.close?.();
      // 關掉羅盤後把 ready dock 找回來，讓「準備啟航」可被高亮
      document.getElementById('ready-panel')?.classList.remove('hidden');
      document.body.dataset.uiPhase = document.body.dataset.uiPhase === 'flying'
        ? 'flying'
        : 'ready';
      await delay(220);
    }
  }

  function isVisibleTarget(el) {
    if (!el) return false;
    if (el.classList.contains('hidden') || el.hasAttribute('hidden')) return false;
    if (el.closest('.hidden,[hidden]')) return false;
    // compass / sheets use .show instead of removing hidden
    if (el.classList.contains('sheet') && !el.classList.contains('show')) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    if (r.width < 4 || r.height < 4) return false;
    if (r.bottom < 8 || r.top > window.innerHeight - 8) return false;
    return true;
  }

  function pickTarget(sel) {
    const parts = String(sel || '').split(',').map((s) => s.trim()).filter(Boolean);
    for (const part of parts) {
      const el = document.querySelector(part);
      if (isVisibleTarget(el)) return el;
    }
    return null;
  }

  function runStory(passengerId) {
    return new Promise((resolve) => {
      const { story } = ensureRoots();
      const pages = storyPages();
      let i = 0;

      const finish = () => {
        story.classList.add('hidden');
        story.setAttribute('aria-hidden', 'true');
        story.innerHTML = '';
        document.body.classList.remove('onboard-open');
        resolve();
      };

      const render = () => {
        const page = pages[i];
        const isLast = i >= pages.length - 1;
        story.innerHTML = `
          <div class="onboard-story-card" role="dialog" aria-modal="true" aria-labelledby="onboard-story-title">
            <div class="onboard-story-kicker">SLEEP AIRLINE · ${i + 1}/${pages.length}</div>
            <h2 id="onboard-story-title" class="onboard-story-title">${page.title}</h2>
            <p class="onboard-story-body">${page.body}</p>
            <div class="onboard-story-actions">
              <button type="button" class="onboard-link" data-act="skip">${t('onboard.skip')}</button>
              <button type="button" class="onboard-primary" data-act="next">${isLast ? t('onboard.start') : t('onboard.next')}</button>
            </div>
          </div>`;
        story.classList.remove('hidden');
        story.setAttribute('aria-hidden', 'false');
        document.body.classList.add('onboard-open');
        story.querySelector('[data-act="skip"]')?.addEventListener('click', finish);
        story.querySelector('[data-act="next"]')?.addEventListener('click', () => {
          if (isLast) finish();
          else {
            i += 1;
            render();
          }
        });
      };

      render();
    });
  }

  function tipPlacement(rect, tipMode) {
    const tipH = 150;
    const tipW = Math.min(340, window.innerWidth - 32);
    let top;
    if (tipMode === 'top') {
      // 永遠放在螢幕上方中央，避開底部羅盤 sheet
      top = Math.max(18, Math.min(56, window.innerHeight * 0.06));
      return {
        top,
        left: Math.max(16, (window.innerWidth - tipW) / 2),
        width: tipW,
      };
    }
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (spaceBelow < tipH + 20 && spaceAbove > tipH + 16) {
      top = Math.max(12, rect.top - tipH - 12);
    } else if (spaceBelow >= tipH + 16) {
      top = Math.min(window.innerHeight - tipH - 12, rect.bottom + 12);
    } else {
      top = Math.max(12, Math.min(window.innerHeight - tipH - 12, (window.innerHeight - tipH) / 2));
    }
    const centerX = rect.left + rect.width / 2;
    let left = centerX - tipW / 2;
    left = Math.max(16, Math.min(left, window.innerWidth - tipW - 16));
    return { top, left, width: tipW };
  }

  function runSpotlight(passengerId) {
    return new Promise((resolve) => {
      const { tour } = ensureRoots();
      const steps = spotlightSteps();
      let i = 0;

      const finish = () => {
        window.SleepAirlineSheets?.close?.();
        tour.classList.add('hidden');
        tour.setAttribute('aria-hidden', 'true');
        tour.innerHTML = '';
        document.body.classList.remove('onboard-tour-open');
        document.querySelectorAll('.onboard-hole-target').forEach((el) => el.classList.remove('onboard-hole-target'));
        resolve();
      };

      const render = async () => {
        if (i >= steps.length) {
          finish();
          return;
        }
        const step = steps[i];
        await prepareStep(step);
        const target = pickTarget(step.sel);
        document.querySelectorAll('.onboard-hole-target').forEach((el) => el.classList.remove('onboard-hole-target'));
        let holeStyle = 'display:none';
        let tipStyle = 'top:12%;left:50%;transform:translateX(-50%);width:min(340px,calc(100vw - 32px));';
        if (target) {
          // 羅盤 sheet：只高亮可見區域，不抬升 z-index（否則會蓋住「下一步」）
          target.classList.add('onboard-hole-target');
          const r = target.getBoundingClientRect();
          const pad = step.open === 'compass' ? 4 : 10;
          const holeTop = Math.max(8, r.top - pad);
          const holeH = Math.min(r.height + pad * 2, window.innerHeight - holeTop - 24);
          holeStyle = `top:${holeTop}px;left:${Math.max(8, r.left - pad)}px;width:${Math.min(r.width + pad * 2, window.innerWidth - 16)}px;height:${holeH}px;`;
          const place = tipPlacement(r, step.tipMode);
          tipStyle = `top:${place.top}px;left:${place.left}px;width:${place.width}px;transform:none;`;
        } else if (step.tipMode === 'top') {
          const place = tipPlacement({ top: 0, left: 0, width: window.innerWidth, bottom: 0, height: 0, right: window.innerWidth }, 'top');
          tipStyle = `top:${place.top}px;left:${place.left}px;width:${place.width}px;transform:none;`;
        }
        const isLast = i >= steps.length - 1;
        tour.innerHTML = `
          <div class="onboard-scrim" data-act="skip"></div>
          <div class="onboard-hole" style="${holeStyle}"></div>
          <div class="onboard-tip glass" style="${tipStyle}" role="dialog" aria-live="polite">
            <p class="onboard-tip-text">${step.text}</p>
            <div class="onboard-tip-actions">
              <button type="button" class="onboard-link" data-act="skip">${t('onboard.skip')}</button>
              <button type="button" class="onboard-primary" data-act="next">${isLast ? t('onboard.start') : t('onboard.next')}</button>
            </div>
            <div class="onboard-tip-progress">${i + 1} / ${steps.length}</div>
          </div>`;
        tour.classList.remove('hidden');
        tour.setAttribute('aria-hidden', 'false');
        document.body.classList.add('onboard-tour-open');
        tour.querySelectorAll('[data-act="skip"]').forEach((el) => el.addEventListener('click', finish));
        tour.querySelector('[data-act="next"]')?.addEventListener('click', () => {
          i += 1;
          void render();
        });
      };

      void render();
    });
  }

  async function start({ passengerId, force } = {}) {
    if (!passengerId) return;
    if (!force && isDone(passengerId)) return;
    try {
      await runStory(passengerId);
      await runSpotlight(passengerId);
    } finally {
      markDone(passengerId);
    }
  }

  async function replay(passengerId) {
    await start({ passengerId, force: true });
  }

  global.SleepOnboarding = {
    start,
    replay,
    isDone,
    markDone,
  };
})(typeof window !== 'undefined' ? window : globalThis);
