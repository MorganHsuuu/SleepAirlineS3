/** Sleep Airline i18n — zh / en (localStorage only; not logged to research DB) */
(function (global) {
  const STORAGE_KEY = 'sleepAirline_locale';

  const DICT = {
    zh: {
      'meta.title': '甦醒航班 | Sleep Airline',
      'brand.name': '✈ 甦醒航班',
      'brand.sub': 'SLEEP AIRLINE',
      'login.terminal': 'Terminal 航站',
      'login.createTerminal': '建立 Terminal',
      'login.shareInvite': '分享邀請',
      'login.passportKicker': 'Boarding Identity',
      'login.passportTitle': '我的護照',
      'login.pid': '乘客 ID',
      'login.name': '姓名',
      'login.pidPh': '例：p_4821_morgan',
      'login.namePh': '你的名字',
      'login.submit': '同意並登機',
      'login.submitReturning': '登入',
      'login.submitting': '登入中…',
      'login.fillAll': '請填寫所有欄位。',
      'login.terminalDigits': 'Terminal 須為四位數字（0000–9999）。',
      'login.created': '已建立 Terminal T-{digits} · 按分享邀請隊友加入',
      'login.shareNeedTerminal': '請先輸入或建立四位數 Terminal。',
      'login.shareOk': '航站連結已分享',
      'login.shareCopied': '航站連結已複製 · 隊友開啟後會自動帶入 Terminal',
      'login.shareFail': '無法複製連結，請手動分享：{url}',
      'consent.kicker': '研究參與',
      'consent.title': '一起完成這趟研究航程',
      'consent.copy': '甦醒航班同時是一項學術研究。登機後，航程、姓名、頭像與夜空留言將用於小隊互動及後續研究分析；研究成果發表前會移除可識別個人的資訊。請閱讀研究說明，確認願意參與後再繼續登機。',
      'consent.agree': '我已閱讀研究說明，並願意參與本研究。',
      'consent.details': '查看資料使用方式',
      'consent.fullDetails': '閱讀完整研究說明',
      'consent.back': '返回登機',
      'consent.need': '請先勾選研究參與同意，才能登入。',
      'share.terminalTitle': '甦醒航班 Terminal T-{digits}',
      'share.terminalText': '加入我的航站 Terminal T-{digits}，一起飛！',
      'share.arrivalText': '歡迎搭乘 Sleep Airline ✈ 今天我在 {flag} {city}{countryPart} 降落！',
      'share.countryPart': '・{country}',
      'board.shareNeed': '無法分享：請先登入並確認 Terminal 代碼。',
      'board.kicker': '小隊動態',
      'board.empty': '本 Terminal 尚無航班記錄',
      'board.broadcasts': '夜空留言 ▾',
      'board.memosEmpty': '還沒有人寫給夜空。起飛等待時可以留一句。',
      'top.preview': 'UI 示範',
      'top.theme': '切換日夜',
      'top.memories': '我的夜航回憶',
      'top.logout': '登出',
      'top.replayTour': '導覽',
      'account.kicker': '帳戶',
      'account.research': '研究說明',
      'account.avatarHint': '點擊更換頭像',
      'account.avatarAria': '上傳頭像',
      'account.avatarOk': '頭像已更新',
      'account.avatarFail': '頭像上傳失敗，請改用較小的照片再試。',
      'avatar.kicker': '護照照片',
      'avatar.title': '要設定頭像嗎？',
      'avatar.copy': '小隊看板與飛機氣泡會用這張照片；現在沒有也沒關係，之後可從帳戶設定。',
      'avatar.never': '不再提醒我',
      'avatar.later': '稍後',
      'avatar.now': '上傳照片',
      'fx.memoLabel': '給夜空的一句話',
      'fx.memoPh': '最多二十字，可空白',
      'trail.mine': '我的航跡',
      'trail.friends': '隊友航跡',
      'compass.float': '選擇航向',
      'compass.chip': '方向',
      'ready.dep': '今晚起飛地',
      'ready.takeoff': '準備啟航',
      'ready.takeoffAria': '準備啟航，選擇航向',
      'ready.go': '起飛',
      'ready.goAria': '起飛',
      'fly.mood': '飛行中',
      'fly.moodDir': '飛行中 · {dir}',
      'fly.window': '望向窗外',
      'fly.whisper': '雲層在舷窗外緩緩流過…',
      'fly.whisper0': '雲層在舷窗外緩緩流過…',
      'fly.whisper1': '前方仍是一片溫柔的天光…',
      'fly.whisper2': '夜航仍在向前…',
      'fly.whisper3': '讓睡意帶你穿過這片寧靜…',
      'fly.whisper4': '航程像一條發光的細線，延伸向遠方…',
      'fly.echo': '起飛回聲',
      'fly.reminderKicker': '降落提醒',
      'fly.reminderText': '醒來時通知欄會留一則，提醒你回來降落。',
      'fly.reminderBtn': '啟用提醒',
      'reminder.unsupported': '此瀏覽器暫不支援手機通知；請用 HTTPS 網址或加入主畫面後再試。',
      'reminder.unavailable': '不可用',
      'reminder.blocked': '通知已被封鎖，請到系統通知設定重新允許 Sleep Airline。',
      'reminder.blockedBtn': '已封鎖',
      'reminder.enabledOk': '降落提醒已送到通知欄，明天打開還看得到。',
      'reminder.enabledLocal': '降落提醒已送到這台裝置的通知欄。',
      'reminder.denied': '尚未允許通知，因此無法啟用降落提醒。',
      'reminder.swFail': '目前無法啟用通知。請確認網站是 HTTPS，或從手機主畫面開啟。',
      'fly.landConfirm': '再按一次下方按鈕，確認開始下降',
      'fly.land': '降落',
      'fly.landConfirmBtn': '確定降落',
      'fly.landConfirmAria': '再按一次確定降落',
      'land.stamp': '已抵達',
      'land.statsDuration': '飛行時間',
      'land.statsDistance': '航程',
      'land.echo': '小隊回聲',
      'land.sceneryAlt': '降落風景',
      'land.sceneryLoading': '窗外漸漸亮了起來…',
      'land.window': '看看窗外',
      'land.windowAria': '看看窗外風景',
      'land.windowClose': '收起窗外',
      'land.windowCloseAria': '收起舷窗',
      'land.share': '分享這趟',
      'land.next': '✓ 準備下一趟',
      'land.welcome': '歡迎抵達',
      'land.welcomeCountry': '歡迎抵達 · {country}',
      'status.notStarted': '待起飛',
      'status.inFlight': '飛行中',
      'status.landed': '已降落',
      'status.boarding': '準備登機',
      'status.cancelled': '已取消',
      'status.landedCountry': '已降落 · {country}',
      'status.flyingElapsed': '飛行中 · 已飛 {duration}',
      'board.tagFlying': '✈ 飛行中',
      'board.tagLanded': '✓ 抵達',
      'board.bcTakeoff': '{name} · 起飛',
      'board.bcLand': '{name} · 降落 → {flag} {city} · {country}',
      'board.flewFor': '飛了 {duration}',
      'board.elapsed': '已飛 {duration}',
      'board.waiting': '待起飛',
      'board.destPending': '目的地待揭曉',
      'compass.title': '今晚的航向',
      'compass.sub': '拖動磁針 · 藍點是小隊好友所在方位',
      'compass.autoHint': '由系統為你選擇方向',
      'compass.fate': '⚓ 讓命運決定',
      'compass.confirm': '確認航向',
      'compass.openNeed': '羅盤已開啟：請選好航向後按「確認航向」。',
      'compass.radarTitle': '小隊雷達 · 好友方位',
      'compass.friendDir': '{dir}方',
      'compass.friendTitle': '{name} · {dir}方 · {status}',
      'geo.unknown': '未知',
      'geo.passenger': '乘客',
      'geo.teammate': '隊友',
      'geo.noMemo': '這趟還沒留言',
      'geo.departure': '出發地',
      'dur.hoursMins': '{h} 小時 {mm} 分',
      'dur.mins': '{m} 分鐘',
      'msg.loginToFly': '請先登入後再起飛。',
      'msg.alreadyFlying': '你已在飛行中，請按「降落」。',
      'msg.nextThenFly': '請先點「準備下一趟」，再選航向起飛。',
      'msg.cannotCompass': '目前無法選擇航向，請重新整理頁面後再試。',
      'fx.tower': '塔台連線中…',
      'fx.launching': '起飛中…',
      'mate.noBroadcast': '這位隊友還沒有機長廣播。',
      'mate.memo': '夜空留言',
      'mate.scenery': '窗外風景',
      'seg.mine': '我的航段',
      'seg.theirs': '{name}的航段',
      'seg.info': '航段資訊',
      'sharePreview.title': '分享預覽',
      'sharePreview.download': '下載圖卡',
      'sharePreview.send': '分享',
      'memories.title': '我的夜航回憶',
      'memories.sub': '左右滑動 · 翻閱最近五趟航程',
      'lang.zh': '中文',
      'lang.en': 'EN',
      'lang.switch': '語言',
      'dir.auto': '自動',
      'dir.eastbound': '向東',
      'dir.westbound': '向西',
      'dir.northbound': '向北',
      'dir.southbound': '向南',
      'dir.northeast': '東北',
      'dir.northwest': '西北',
      'dir.southeast': '東南',
      'dir.southwest': '西南',
      'dir.circular': '環形',
      'dir.unknown': '未知',
      'dir.hint': '今晚傾向醒在{dir}方的城市',
      'dir.hintAuto': '由系統為你選擇方向',
      'msg.demoTakeoff': '示範模式無法真正起飛。請登出後登入，再測試起飛。',
      'msg.demoLand': '示範模式無法降落。請登出後登入，再測試降落。',
      'msg.uiDemoTakeoff': '目前為 UI 示範。請先登出，登入後再測試起飛。',
      'msg.uiDemoLand': '目前為 UI 示範。請先登出，登入後再測試降落。',
      'msg.noFlight': '目前沒有飛行中的航班。',
      'msg.closeMate': '請先收起隊友詳情（點背景或 Esc），再按降落。',
      'msg.takeoffBlocked': '請先選擇航向後再起飛。',
      'fx.takeoffPrep': '塔台連線中 · 請稍候…',
      'fx.takeoffSync': '同步航線與小隊雷達…',
      'fx.takeoffBroadcast': '機長整理起飛廣播…',
      'fx.broadcastPlaying': '機長廣播中…',
      'fx.takeoffGo': '推進器啟動 · 準備離地…',
      'onboard.skip': '略過',
      'onboard.next': '下一步',
      'onboard.start': '開始飛行',
      'onboard.story1.title': '今夜，你將起飛',
      'onboard.story1.body': '選擇航向，讓睡眠帶你降落在未知城市。',
      'onboard.story2.title': '入睡，即是啟航',
      'onboard.story2.body': '起飛後安心休息；醒來時，按下降落，揭曉你的目的地。',
      'onboard.story3.title': '小隊同行',
      'onboard.story3.body': '看板會看見隊友的航跡；每一次降落，都留下夜航回憶。',
      'onboard.spot1': '這是羅盤：拖動磁針或點方位，選擇今夜航向。',
      'onboard.spot2': '準備好後，按下起飛——機長會為你廣播。',
      'onboard.spot3': '小隊看板顯示同 Terminal 隊友的動態。',
      'onboard.spot4': '醒來後，下方會出現「降落」——回來按它，揭曉城市與風景。',
      'onboard.done': '導覽完成 · 祝你一夜好眠',
    },
    en: {
      'meta.title': 'Sleep Airline',
      'brand.name': '✈ Sleep Airline',
      'brand.sub': 'SLEEP AIRLINE',
      'login.terminal': 'Terminal',
      'login.createTerminal': 'Create Terminal',
      'login.shareInvite': 'Share invite',
      'login.passportKicker': 'Boarding Identity',
      'login.passportTitle': 'My passport',
      'login.pid': 'Passenger ID',
      'login.name': 'Name',
      'login.pidPh': 'e.g. p_4821_morgan',
      'login.namePh': 'Your name',
      'login.submit': 'Agree & board',
      'login.submitReturning': 'Board',
      'login.submitting': 'Boarding…',
      'login.fillAll': 'Please fill in all fields.',
      'login.terminalDigits': 'Terminal must be 4 digits (0000–9999).',
      'login.created': 'Created Terminal T-{digits} · Share to invite teammates',
      'login.shareNeedTerminal': 'Enter or create a 4-digit Terminal first.',
      'login.shareOk': 'Terminal link shared',
      'login.shareCopied': 'Link copied · teammates will get the Terminal filled in',
      'login.shareFail': 'Could not copy. Share manually: {url}',
      'consent.kicker': 'Research',
      'consent.title': 'Join this research journey',
      'consent.copy': 'Sleep Airline is also an academic study. After boarding, your flights, name, photo and sky note support squad interactions and later research analysis. Identifying information is removed before findings are published. Please read the research notice and continue when you are comfortable taking part.',
      'consent.agree': 'I have read the research notice and agree to take part.',
      'consent.details': 'How your data is used',
      'consent.fullDetails': 'Read the full research notice',
      'consent.back': 'Back to boarding',
      'consent.need': 'Please agree to the research notice before signing in.',
      'share.terminalTitle': 'Sleep Airline Terminal T-{digits}',
      'share.terminalText': 'Join my Terminal T-{digits} and fly with me!',
      'share.arrivalText': 'Welcome aboard Sleep Airline ✈ I landed in {flag} {city}{countryPart} today!',
      'share.countryPart': ' · {country}',
      'board.shareNeed': 'Cannot share: sign in and confirm your Terminal code.',
      'board.kicker': 'Squad board',
      'board.empty': 'No flights in this Terminal yet',
      'board.broadcasts': 'Sky notes ▾',
      'board.memosEmpty': 'No sky notes yet. Leave one while waiting at the tower.',
      'top.preview': 'UI demo',
      'top.theme': 'Day / night',
      'top.memories': 'My night flights',
      'top.logout': 'Log out',
      'top.replayTour': 'Tour',
      'account.kicker': 'Account',
      'account.research': 'Research',
      'account.avatarHint': 'Tap to change photo',
      'account.avatarAria': 'Upload avatar',
      'account.avatarOk': 'Avatar updated',
      'account.avatarFail': 'Could not upload the photo. Try a smaller image.',
      'avatar.kicker': 'Passport photo',
      'avatar.title': 'Add a profile photo?',
      'avatar.copy': 'It appears on the squad board and plane bubbles. You can always add one later from your account.',
      'avatar.never': 'Don’t remind me again',
      'avatar.later': 'Later',
      'avatar.now': 'Upload photo',
      'fx.memoLabel': 'A line for the night sky',
      'fx.memoPh': '20 characters, optional',
      'trail.mine': 'My trails',
      'trail.friends': 'Squad trails',
      'compass.float': 'Choose heading',
      'compass.chip': 'Heading',
      'ready.dep': 'Tonight’s departure',
      'ready.takeoff': 'Ready to fly',
      'ready.takeoffAria': 'Ready to fly — choose a heading',
      'ready.go': 'Take off',
      'ready.goAria': 'Take off',
      'fly.mood': 'In flight',
      'fly.moodDir': 'In flight · {dir}',
      'fly.window': 'Look outside',
      'fly.whisper': 'Clouds drift past the window…',
      'fly.whisper0': 'Clouds drift past the window…',
      'fly.whisper1': 'Soft light still ahead…',
      'fly.whisper2': 'The night flight keeps going…',
      'fly.whisper3': 'Let sleep carry you through the quiet…',
      'fly.whisper4': 'The route is a thin glowing line into the distance…',
      'fly.echo': 'Takeoff echo',
      'fly.reminderKicker': 'Landing reminder',
      'fly.reminderText': 'A note will stay in your notifications until you come back to land.',
      'fly.reminderBtn': 'Enable',
      'reminder.unsupported': 'Notifications aren’t supported here. Use HTTPS or Add to Home Screen.',
      'reminder.unavailable': 'Unavailable',
      'reminder.blocked': 'Notifications are blocked. Allow Sleep Airline in system settings.',
      'reminder.blockedBtn': 'Blocked',
      'reminder.enabledOk': 'Landing reminder is in your notification tray — it’ll still be there when you wake.',
      'reminder.enabledLocal': 'Landing reminder saved on this device’s notification tray.',
      'reminder.denied': 'Notification permission denied — reminder not enabled.',
      'reminder.swFail': 'Couldn’t enable notifications. Use HTTPS or open from the home screen.',
      'fly.landConfirm': 'Press again below to confirm descent',
      'fly.land': 'Land',
      'fly.landConfirmBtn': 'Confirm land',
      'fly.landConfirmAria': 'Press again to confirm landing',
      'land.stamp': 'Arrived',
      'land.statsDuration': 'Flight time',
      'land.statsDistance': 'Distance',
      'land.echo': 'Squad echo',
      'land.sceneryAlt': 'Landing scenery',
      'land.sceneryLoading': 'The window is brightening…',
      'land.window': 'Look outside',
      'land.windowAria': 'Look outside at the scenery',
      'land.windowClose': 'Close window',
      'land.windowCloseAria': 'Close the window',
      'land.share': 'Share this flight',
      'land.next': '✓ Ready for next',
      'land.welcome': 'Welcome',
      'land.welcomeCountry': 'Welcome to {country}',
      'status.notStarted': 'Waiting',
      'status.inFlight': 'In flight',
      'status.landed': 'Landed',
      'status.boarding': 'Boarding',
      'status.cancelled': 'Cancelled',
      'status.landedCountry': 'Landed · {country}',
      'status.flyingElapsed': 'Flying · {duration}',
      'board.tagFlying': '✈ In flight',
      'board.tagLanded': '✓ Arrived',
      'board.bcTakeoff': '{name} · Takeoff',
      'board.bcLand': '{name} · Landed → {flag} {city} · {country}',
      'board.flewFor': 'flew {duration}',
      'board.elapsed': '{duration} flown',
      'board.waiting': 'Waiting',
      'board.destPending': 'Destination TBA',
      'compass.title': 'Tonight’s heading',
      'compass.sub': 'Drag the needle · blue dots are squad friends',
      'compass.autoHint': 'Let the system choose your heading',
      'compass.fate': '⚓ Leave it to fate',
      'compass.confirm': 'Confirm heading',
      'compass.openNeed': 'Compass is open: pick a heading, then tap Confirm.',
      'compass.radarTitle': 'Squad radar · friend bearings',
      'compass.friendDir': '{dir}',
      'compass.friendTitle': '{name} · {dir} · {status}',
      'geo.unknown': 'Unknown',
      'geo.passenger': 'Passenger',
      'geo.teammate': 'Teammate',
      'geo.noMemo': 'No sky note yet',
      'geo.departure': 'Departure',
      'dur.hoursMins': '{h}h {mm}m',
      'dur.mins': '{m} min',
      'msg.loginToFly': 'Sign in before takeoff.',
      'msg.alreadyFlying': 'You’re already in flight — tap Land.',
      'msg.nextThenFly': 'Tap “Ready for next”, then choose a heading to take off.',
      'msg.cannotCompass': 'Cannot open the compass right now. Refresh and try again.',
      'fx.tower': 'Connecting to tower…',
      'fx.launching': 'Taking off…',
      'mate.noBroadcast': 'This teammate has no captain broadcast yet.',
      'mate.memo': 'Sky note',
      'mate.scenery': 'Window view',
      'seg.mine': 'My segment',
      'seg.theirs': '{name}’s segment',
      'seg.info': 'Segment info',
      'sharePreview.title': 'Share preview',
      'sharePreview.download': 'Download card',
      'sharePreview.send': 'Share',
      'memories.title': 'My night flights',
      'memories.sub': 'Swipe · last five journeys',
      'lang.zh': '中文',
      'lang.en': 'EN',
      'lang.switch': 'Language',
      'dir.auto': 'Auto',
      'dir.eastbound': 'East',
      'dir.westbound': 'West',
      'dir.northbound': 'North',
      'dir.southbound': 'South',
      'dir.northeast': 'Northeast',
      'dir.northwest': 'Northwest',
      'dir.southeast': 'Southeast',
      'dir.southwest': 'Southwest',
      'dir.circular': 'Circular',
      'dir.unknown': 'Unknown',
      'dir.hint': 'Tonight you tend to wake in cities to the {dir}',
      'dir.hintAuto': 'Let the system choose your heading',
      'msg.demoTakeoff': 'Demo mode cannot take off. Log out, sign in, then try again.',
      'msg.demoLand': 'Demo mode cannot land. Log out, sign in, then try again.',
      'msg.uiDemoTakeoff': 'UI demo only. Log out, sign in, then take off.',
      'msg.uiDemoLand': 'UI demo only. Log out, sign in, then land.',
      'msg.noFlight': 'No active flight.',
      'msg.closeMate': 'Close teammate details first (backdrop or Esc), then land.',
      'msg.takeoffBlocked': 'Choose a heading before takeoff.',
      'fx.takeoffPrep': 'Connecting to tower…',
      'fx.takeoffSync': 'Syncing route & squad radar…',
      'fx.takeoffBroadcast': 'Captain preparing takeoff PA…',
      'fx.broadcastPlaying': 'Captain speaking…',
      'fx.takeoffGo': 'Engines up · ready to leave…',
      'onboard.skip': 'Skip',
      'onboard.next': 'Next',
      'onboard.start': 'Begin flight',
      'onboard.story1.title': 'Tonight, you take off',
      'onboard.story1.body': 'Pick a heading. Sleep carries you to an unknown city.',
      'onboard.story2.title': 'Sleep is departure',
      'onboard.story2.body': 'Rest after takeoff. When you wake, land to reveal your destination.',
      'onboard.story3.title': 'Fly with your squad',
      'onboard.story3.body': 'The board shows teammates’ trails. Every landing becomes a night-flight memory.',
      'onboard.spot1': 'This is the compass: drag the needle or tap a bearing to choose tonight’s heading.',
      'onboard.spot2': 'When ready, take off — the captain will address you.',
      'onboard.spot3': 'The squad board shows everyone in your Terminal.',
      'onboard.spot4': 'When you wake, a Land button appears below — come back to reveal city and scenery.',
      'onboard.done': 'Tour complete · sleep well',
    },
  };

  let locale = 'zh';
  const listeners = new Set();

  function detectDefault() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === 'zh' || saved === 'en') return saved;
    } catch { /* ignore */ }
    const nav = String(navigator.language || '').toLowerCase();
    return nav.startsWith('en') ? 'en' : 'zh';
  }

  function getLocale() {
    return locale;
  }

  function htmlLang(loc) {
    return loc === 'en' ? 'en' : 'zh-TW';
  }

  function t(key, vars) {
    const table = DICT[locale] || DICT.zh;
    let str = table[key] ?? DICT.zh[key] ?? key;
    if (vars && typeof vars === 'object') {
      Object.keys(vars).forEach((k) => {
        str = str.replace(new RegExp(`\\{${k}\\}`, 'g'), String(vars[k] ?? ''));
      });
    }
    return str;
  }

  function applyDomTranslations(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach((el) => {
      const key = el.getAttribute('data-i18n');
      if (!key) return;
      const attr = el.getAttribute('data-i18n-attr');
      const value = t(key);
      if (attr) {
        attr.split(',').map((a) => a.trim()).filter(Boolean).forEach((a) => {
          if (a === 'text') el.textContent = value;
          else el.setAttribute(a, value);
        });
      } else {
        el.textContent = value;
      }
    });
    scope.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) el.setAttribute('placeholder', t(key));
    });
    scope.querySelectorAll('[data-i18n-aria]').forEach((el) => {
      const key = el.getAttribute('data-i18n-aria');
      if (key) el.setAttribute('aria-label', t(key));
    });
    scope.querySelectorAll('[data-i18n-title]').forEach((el) => {
      const key = el.getAttribute('data-i18n-title');
      if (key) el.setAttribute('title', t(key));
    });
    document.title = t('meta.title');
    document.documentElement.lang = htmlLang(locale);
    document.querySelectorAll('[data-locale-btn]').forEach((btn) => {
      const loc = btn.getAttribute('data-locale-btn');
      btn.classList.toggle('is-active', loc === locale);
      btn.setAttribute('aria-pressed', loc === locale ? 'true' : 'false');
    });
  }

  function setLocale(next, opts) {
    const loc = next === 'en' ? 'en' : 'zh';
    const silent = opts && opts.silent;
    if (loc === locale && !opts?.force) {
      applyDomTranslations();
      return locale;
    }
    locale = loc;
    try { localStorage.setItem(STORAGE_KEY, locale); } catch { /* ignore */ }
    applyDomTranslations();
    if (!silent) listeners.forEach((fn) => { try { fn(locale); } catch { /* ignore */ } });
    return locale;
  }

  function onLocaleChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  function init() {
    locale = detectDefault();
    applyDomTranslations();
  }

  global.SleepI18n = {
    t,
    getLocale,
    setLocale,
    applyDomTranslations,
    onLocaleChange,
    init,
    htmlLang,
  };
})(typeof window !== 'undefined' ? window : globalThis);
