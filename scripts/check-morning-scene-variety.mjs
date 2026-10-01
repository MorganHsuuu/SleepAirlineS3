import assert from 'node:assert/strict';

const morningModule = await import('../src/lib/ai/morning-content.ts');
const { findReliableDestinationSubject } = await import(
  '../src/lib/ai/destination-subjects.ts'
);
const {
  ARRIVAL_SCENE_THEMES,
  generateMorningArrival,
  parseMorningResponse,
  selectArrivalSceneTheme,
} = morningModule;

assert.ok(Array.isArray(ARRIVAL_SCENE_THEMES), '應公開可檢查的抵達主題定義');
assert.deepEqual(
  ARRIVAL_SCENE_THEMES.map(({ id, weight }) => [id, weight]),
  [
    ['landmark', 30],
    ['nature', 25],
    ['food', 20],
    ['street-market', 15],
    ['culture-life', 10],
  ]
);
assert.equal(
  ARRIVAL_SCENE_THEMES.reduce((total, theme) => total + theme.weight, 0),
  100,
  '主題權重總和應為 100'
);

const selections = [
  [0, 'landmark'],
  [0.299999, 'landmark'],
  [0.3, 'nature'],
  [0.549999, 'nature'],
  [0.55, 'food'],
  [0.749999, 'food'],
  [0.75, 'street-market'],
  [0.899999, 'street-market'],
  [0.9, 'culture-life'],
  [0.999999, 'culture-life'],
];
for (const [randomValue, expectedId] of selections) {
  assert.equal(selectArrivalSceneTheme(randomValue).id, expectedId);
}

const SAFE_SAFETY_CHECK = {
  containsNegativeEmotionalLanguage: false,
  containsPressureLanguage: false,
  containsLonelinessLanguage: false,
  containsUnverifiedCulturalClaim: false,
};

const savedApiKey = process.env.OPENAI_API_KEY;
const savedApi = process.env.OPENAI_API;
delete process.env.OPENAI_API_KEY;
delete process.env.OPENAI_API;

try {
  const categorySamples = [
    [0, 'landmark', /Taipei 101/i],
    [0.3, 'nature', /Yangmingshan|陽明山/i],
    [0.55, 'food', /beef noodles|牛肉麵/i],
    [0.75, 'street-market', /Dihua Street|迪化街/i],
    [0.9, 'culture-life', /Taipei Metro|台北捷運/i],
  ];

  for (const [randomValue, expectedId, subjectPattern] of categorySamples) {
    const result = await generateMorningArrival(
      {
        country: 'Taiwan',
        city: 'Taipei',
        localGreeting: '早安',
        weatherSummary: '氣溫 24°C，大致晴朗',
        localTimeLabel: '當地上午 8:10',
      },
      randomValue
    );
    const theme = selectArrivalSceneTheme(randomValue);
    assert.equal(theme.id, expectedId);
    assert.match(result.voiceText, subjectPattern);
    assert.match(result.localFeature, subjectPattern);
    assert.match(result.imagePrompt, subjectPattern);
    assert.match(result.voiceText, /24°C|24 度|24度/);
    assert.match(result.voiceText, /上午 8:10/);
  }

  const taipei = await generateMorningArrival({ country: 'Taiwan', city: 'Taipei' }, 0);
  assert.match(`${taipei.voiceText} ${taipei.imagePrompt}`, /Taipei 101/i);

  const cairo = await generateMorningArrival({ country: 'Egypt', city: 'Cairo' }, 0);
  assert.match(`${cairo.voiceText} ${cairo.imagePrompt}`, /Giza pyramids|吉薩金字塔/i);

  const alexandria = await generateMorningArrival(
    { country: 'Egypt', city: 'Alexandria' },
    0
  );
  assert.doesNotMatch(`${alexandria.voiceText} ${alexandria.imagePrompt}`, /pyramid|金字塔/i);
  assert.match(`${alexandria.voiceText} ${alexandria.imagePrompt}`, /Qaitbay|蓋特貝/i);

  const gapFailures = [];
  const verifyGap = async (name, check) => {
    try {
      await check();
    } catch (error) {
      gapFailures.push(`${name}: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  await verifyGap('目的地別名只做完整分段匹配', () => {
    const falsePositiveCities = [
      ['Khagrachhari', 'Bangladesh'],
      ['Prayagraj', 'India'],
      ['Sagrada Família', 'Spain'],
      ['East London', 'South Africa'],
      ['Londonderry', 'United Kingdom'],
    ];
    for (const [city, country] of falsePositiveCities) {
      assert.equal(
        findReliableDestinationSubject(city, country),
        null,
        `${city} 不得因 substring 誤配可靠地標`
      );
    }
    assert.match(findReliableDestinationSubject('Cairo', 'Egypt')?.en ?? '', /Giza pyramids/i);
    assert.match(findReliableDestinationSubject('Giza', 'Egypt')?.en ?? '', /Giza pyramids/i);
    assert.match(findReliableDestinationSubject('開羅', '埃及')?.zh ?? '', /吉薩金字塔/);
  });

  await verifyGap('常見城市使用具體可靠地標', async () => {
    const landmarkSamples = [
      ['Paris', 'France', /Eiffel Tower|艾菲爾鐵塔/i],
      ['Rio de Janeiro', 'Brazil', /Christ the Redeemer|救世基督像/i],
      ['Tokyo', 'Japan', /Tokyo Tower|東京鐵塔/i],
      ['London', 'United Kingdom', /Tower Bridge|倫敦塔橋/i],
      ['Rome', 'Italy', /Colosseum|羅馬競技場/i],
      ['Barcelona', 'Spain', /Sagrada Família|聖家堂/i],
      ['Sydney', 'Australia', /Sydney Opera House|雪梨歌劇院/i],
      ['New York', 'United States', /Statue of Liberty|自由女神像/i],
    ];
    for (const [city, country, subjectPattern] of landmarkSamples) {
      const result = await generateMorningArrival({ city, country }, 0);
      assert.match(result.voiceText, subjectPattern, `${city} 語音應有具體地標`);
      assert.match(result.localFeature, subjectPattern, `${city} localFeature 應有具體地標`);
      assert.match(result.imagePrompt, subjectPattern, `${city} 圖片應沿用具體地標`);
    }
  });

  await verifyGap('常見城市缺類型題材時切換可靠地標', async () => {
    for (const randomValue of [0.3, 0.55, 0.75, 0.9]) {
      const result = await generateMorningArrival(
        { city: 'Paris', country: 'France' },
        randomValue
      );
      assert.match(result.voiceText, /Eiffel Tower|艾菲爾鐵塔/i);
      assert.match(result.localFeature, /Eiffel Tower|艾菲爾鐵塔/i);
      assert.match(result.imagePrompt, /Eiffel Tower|艾菲爾鐵塔/i);
      assert.doesNotMatch(
        `${result.voiceText} ${result.imagePrompt}`,
        /真實城市風貌與地理環境|real urban character and geographic setting/i
      );
    }
  });

  await verifyGap('KNOWN 城市別名只做精確匹配', async () => {
    const newTaipei = await generateMorningArrival(
      { city: 'New Taipei City', country: 'Taiwan' },
      0.3
    );
    assert.match(newTaipei.localFeature, /真實城市風貌與地理環境/);
    assert.doesNotMatch(
      `${newTaipei.voiceText} ${newTaipei.imagePrompt}`,
      /Yangmingshan|陽明山/i
    );

    const taipei = await generateMorningArrival({ city: 'Taipei', country: 'Taiwan' }, 0.3);
    assert.match(`${taipei.voiceText} ${taipei.imagePrompt}`, /Yangmingshan|陽明山/i);
    const taipeiZh = await generateMorningArrival({ city: '台北', country: '台灣' }, 0.3);
    assert.match(`${taipeiZh.voiceText} ${taipeiZh.imagePrompt}`, /Yangmingshan|陽明山/i);
  });

  await verifyGap('未知城市安全降級而不捏造料理', async () => {
    const result = await generateMorningArrival(
      { city: 'Exampleville', country: 'Exampleland' },
      0.55
    );
    assert.match(result.localFeature, /真實城市風貌與地理環境/);
    assert.match(result.voiceText, /真實城市風貌與地理環境/);
    assert.match(result.imagePrompt, /real urban character and geographic setting/i);
    assert.doesNotMatch(`${result.voiceText} ${result.imagePrompt}`, /料理|dish|landmark|地標/i);
  });

  await verifyGap('夜間 fallback 不產生晨光衝突', async () => {
    for (const localTimeLabel of ['當地晚上 11:30', '當地深夜', '當地入夜']) {
      for (const randomValue of [0, 0.3, 0.55, 0.75, 0.9]) {
        const result = await generateMorningArrival(
          {
            city: 'Cairo',
            country: 'Egypt',
            localTimeLabel,
          },
          randomValue
        );
        assert.match(result.voiceText, new RegExp(localTimeLabel));
        assert.match(result.imagePrompt, new RegExp(localTimeLabel));
        assert.match(`${result.voiceText} ${result.imagePrompt}`, /夜間|夜晚|night/i);
        assert.doesNotMatch(
          `${result.voiceText} ${result.imagePrompt}`,
          /清晨|晨光|morning|dawn|soft morning light/i
        );
      }
    }
  });

  await verifyGap('沒有時間時使用中性自然光', async () => {
    const result = await generateMorningArrival({ city: 'Paris', country: 'France' }, 0);
    assert.match(result.voiceText, /柔和自然光/);
    assert.match(result.imagePrompt, /soft natural light/i);
    assert.doesNotMatch(
      `${result.voiceText} ${result.imagePrompt}`,
      /清晨|晨光|morning|dawn/i
    );
  });

  await verifyGap('模型 themeId 不一致時拒絕結果', () => {
    const baseResponse = {
      destination: { country: 'France', city: 'Paris' },
      localGreeting: 'Bonjour',
      voiceText:
        'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。艾菲爾鐵塔映著塞納河岸，歡迎抵達Paris，今天的旅程從這裡開始。',
      localFeature: '艾菲爾鐵塔',
      imagePrompt:
        'The Eiffel Tower beside the Seine in Paris, matching the narration, realistic, no text',
      imageKeywords: ['Eiffel Tower'],
      safetyCheck: SAFE_SAFETY_CHECK,
    };
    const mismatched = parseMorningResponse(
      JSON.stringify({
        ...baseResponse,
        sceneTheme: {
          themeId: 'food',
          subject: { zh: '艾菲爾鐵塔', en: 'Eiffel Tower' },
        },
      }),
      { city: 'Paris', country: 'France' },
      'landmark'
    );
    assert.equal(mismatched, null);

    const matched = parseMorningResponse(
      JSON.stringify({
        ...baseResponse,
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: '艾菲爾鐵塔', en: 'Eiffel Tower' },
        },
      }),
      { city: 'Paris', country: 'France' },
      'landmark'
    );
    assert.ok(matched, 'themeId 與同一主題一致時應接受');

    const divergent = parseMorningResponse(
      JSON.stringify({
        ...baseResponse,
        imagePrompt: 'A plate of croissants in a Paris bakery, realistic, no text',
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: '艾菲爾鐵塔', en: 'Eiffel Tower' },
        },
      }),
      { city: 'Paris', country: 'France' },
      'landmark'
    );
    assert.equal(divergent, null, 'imagePrompt 未描述共同 subject 時應拒絕');

    const croissantAsLandmark = parseMorningResponse(
      JSON.stringify({
        ...baseResponse,
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。巴黎可頌擺在街角櫥窗，歡迎抵達Paris，今天的旅程從這裡開始。',
        localFeature: '巴黎可頌',
        imagePrompt: 'Paris croissants in a bakery window, realistic, no text',
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: '巴黎可頌', en: 'Paris croissants' },
        },
      }),
      { city: 'Paris', country: 'France' },
      'landmark'
    );
    assert.equal(croissantAsLandmark, null, '可頌不可冒充 Paris 的 landmark');

    const mixedSubjectNames = parseMorningResponse(
      JSON.stringify({
        ...baseResponse,
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。巴黎可頌擺在街角櫥窗，歡迎抵達Paris，今天的旅程從這裡開始。',
        localFeature: '巴黎可頌',
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: '巴黎可頌', en: 'Eiffel Tower' },
        },
      }),
      { city: 'Paris', country: 'France' },
      'landmark'
    );
    assert.equal(mixedSubjectNames, null, '可靠地標的中英文 subject 都必須吻合');

    for (const unsafeSafetyCheck of [
      undefined,
      {
        ...SAFE_SAFETY_CHECK,
        containsPressureLanguage: 'false',
      },
      {
        ...SAFE_SAFETY_CHECK,
        containsPressureLanguage: true,
      },
    ]) {
      const parsed = parseMorningResponse(
        JSON.stringify({
          ...baseResponse,
          safetyCheck: unsafeSafetyCheck,
          sceneTheme: {
            themeId: 'landmark',
            subject: { zh: '艾菲爾鐵塔', en: 'Eiffel Tower' },
          },
        }),
        { city: 'Paris', country: 'France' },
        'landmark'
      );
      assert.equal(parsed, null, 'safetyCheck 缺漏、非 boolean 或 true 都應拒絕');
    }
  });

  await verifyGap('未知城市模型 landmark 無可靠資料時拒絕', () => {
    const unverifiableUnknownLandmark = parseMorningResponse(
      JSON.stringify({
        destination: { country: 'Exampleland', city: 'Exampleville' },
        localGreeting: 'Hello',
        voiceText:
          'Hello。早安，Sleep Airline 已抵達今天的目的地——Exampleville。想像塔樓映著街道，歡迎抵達Exampleville，今天的旅程從這裡開始。',
        localFeature: '想像塔樓',
        imagePrompt: 'Imaginary Tower in Exampleville, realistic, no text',
        imageKeywords: ['Imaginary Tower'],
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: '想像塔樓', en: 'Imaginary Tower' },
        },
      }),
      { city: 'Exampleville', country: 'Exampleland' },
      'landmark'
    );
    assert.equal(unverifiableUnknownLandmark, null, '沒有可靠資料的 landmark 應拒絕');
  });

  await verifyGap('Paris 泛稱 Tower 不得通過 landmark 驗證', () => {
    const parsed = parseMorningResponse(
      JSON.stringify({
        destination: { country: 'France', city: 'Paris' },
        localGreeting: 'Bonjour',
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。Tower 映著塞納河岸，歡迎抵達Paris，今天的旅程從這裡開始。',
        localFeature: 'Tower',
        imagePrompt: 'Tower beside the Seine in Paris, realistic, no text',
        imageKeywords: ['Tower'],
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: 'Tower', en: 'Tower' },
        },
      }),
      { city: 'Paris', country: 'France' },
      'landmark'
    );
    assert.equal(parsed, null);
  });

  await verifyGap('Alexandria 可信地標可通過驗證', () => {
    const parsed = parseMorningResponse(
      JSON.stringify({
        destination: { country: 'Egypt', city: 'Alexandria' },
        localGreeting: '早安',
        voiceText:
          '早安。Sleep Airline 已抵達今天的目的地——Alexandria。蓋特貝城堡立在地中海港口邊，石造城牆映著海面。歡迎抵達Alexandria，今天的旅程從這裡開始。',
        localFeature: '蓋特貝城堡',
        imagePrompt:
          'The Citadel of Qaitbay beside Alexandria harbour, realistic local light, no text',
        imageKeywords: ['Citadel of Qaitbay'],
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: '蓋特貝城堡', en: 'Citadel of Qaitbay' },
        },
        safetyCheck: SAFE_SAFETY_CHECK,
      }),
      { city: 'Alexandria', country: 'Egypt' },
      'landmark'
    );
    assert.ok(parsed, 'KNOWN_SCENE_SUBJECTS 的 Alexandria 地標應被視為可信');
  });

  await verifyGap('模型不得竄改 Paris 目的地為 Tokyo', () => {
    const parsed = parseMorningResponse(
      JSON.stringify({
        destination: { country: 'Japan', city: 'Tokyo' },
        localGreeting: 'Bonjour',
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Tokyo。艾菲爾鐵塔映著河岸，歡迎抵達Tokyo，今天的旅程從這裡開始。',
        localFeature: '艾菲爾鐵塔',
        imagePrompt: 'The Eiffel Tower beside a river in Tokyo, realistic, no text',
        imageKeywords: ['Eiffel Tower'],
        sceneTheme: {
          themeId: 'landmark',
          subject: { zh: '艾菲爾鐵塔', en: 'Eiffel Tower' },
        },
        safetyCheck: {
          containsNegativeEmotionalLanguage: false,
          containsPressureLanguage: false,
          containsLonelinessLanguage: false,
          containsUnverifiedCulturalClaim: false,
        },
      }),
      { city: 'Paris', country: 'France' },
      'landmark'
    );
    assert.equal(parsed, null);
  });

  await verifyGap('模型未驗證文化聲明必須拒絕', () => {
    const parsed = parseMorningResponse(
      JSON.stringify({
        destination: { country: 'France', city: 'Paris' },
        localGreeting: 'Bonjour',
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。巴黎龍肉端上餐桌，香氣沿著街角散開。歡迎抵達Paris，今天的旅程從這裡開始。',
        localFeature: '巴黎龍肉',
        imagePrompt: 'Paris dragon meat served as local food, realistic, no text',
        imageKeywords: ['Paris dragon meat'],
        sceneTheme: {
          themeId: 'food',
          subject: { zh: '巴黎龍肉', en: 'Paris dragon meat' },
        },
        safetyCheck: {
          containsNegativeEmotionalLanguage: false,
          containsPressureLanguage: false,
          containsLonelinessLanguage: false,
          containsUnverifiedCulturalClaim: true,
        },
      }),
      { city: 'Paris', country: 'France' },
      'food'
    );
    assert.equal(parsed, null);
  });

  await verifyGap('夜間暴雨拒絕晨光並附加伺服器限制', () => {
    const input = {
      city: 'Paris',
      country: 'France',
      localTimeLabel: '當地深夜',
      weatherSummary: '氣溫 12°C，大雨',
    };
    const base = {
      destination: { country: 'France', city: 'Paris' },
      localGreeting: 'Bonjour',
      voiceText:
        'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。當地深夜氣溫 12°C，正在下大雨。塞納河岸映著雨中的城市燈光，歡迎抵達Paris，今天的旅程從這裡開始。',
      localFeature: '塞納河岸',
      imagePrompt: 'The Seine riverfront in Paris during heavy rain, realistic, no text',
      imageKeywords: ['Seine riverfront'],
      sceneTheme: {
        themeId: 'nature',
        subject: { zh: '塞納河岸', en: 'Seine riverfront' },
      },
      safetyCheck: {
        containsNegativeEmotionalLanguage: false,
        containsPressureLanguage: false,
        containsLonelinessLanguage: false,
        containsUnverifiedCulturalClaim: false,
      },
    };
    const conflicting = parseMorningResponse(
      JSON.stringify({
        ...base,
        imagePrompt:
          'The Seine riverfront in Paris during heavy rain at sunrise with dawn light, realistic, no text',
      }),
      input,
      'nature'
    );
    assert.equal(conflicting, null);

    const conflictingVoice = parseMorningResponse(
      JSON.stringify({
        ...base,
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。當地深夜氣溫 12°C，正在下大雨，清晨晨光照著河岸。塞納河岸映著城市燈光，歡迎抵達Paris，今天的旅程從這裡開始。',
      }),
      input,
      'nature'
    );
    assert.equal(conflictingVoice, null);

    const missingTemperature = parseMorningResponse(
      JSON.stringify({
        ...base,
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。當地深夜正在下大雨。塞納河岸映著城市燈光，歡迎抵達Paris，今天的旅程從這裡開始。',
      }),
      input,
      'nature'
    );
    assert.equal(missingTemperature, null);

    const missingWeather = parseMorningResponse(
      JSON.stringify({
        ...base,
        voiceText:
          'Bonjour。早安，Sleep Airline 已抵達今天的目的地——Paris。當地深夜氣溫 12°C。塞納河岸映著城市燈光，歡迎抵達Paris，今天的旅程從這裡開始。',
      }),
      input,
      'nature'
    );
    assert.equal(missingWeather, null);

    const valid = parseMorningResponse(JSON.stringify(base), input, 'nature');
    assert.ok(valid);
    assert.match(valid.imagePrompt, /Local time: 當地深夜/);
    assert.match(valid.imagePrompt, /night lighting/i);
    assert.match(valid.imagePrompt, /Weather: 氣溫 12°C，大雨/);
  });

  if (gapFailures.length) {
    assert.fail(`規格缺口仍存在：\n- ${gapFailures.join('\n- ')}`);
  }
} finally {
  if (savedApiKey === undefined) delete process.env.OPENAI_API_KEY;
  else process.env.OPENAI_API_KEY = savedApiKey;
  if (savedApi === undefined) delete process.env.OPENAI_API;
  else process.env.OPENAI_API = savedApi;
}

console.log('✓ 抵達主題依權重抽選一次，fallback 語音與圖片共用真實目的地主題');
