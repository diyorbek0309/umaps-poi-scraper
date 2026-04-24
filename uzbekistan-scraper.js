const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

// === KONFIGURATSIYA ===
const CONFIG = {
  // Qidiruv so'zlari — kategoriya bo'yicha
  // Birinchi argument sifatida o'zgartirish mumkin: node uzbekistan-scraper.js atm
  PRESETS: {
    atm: {
      queries: ['банкомат', 'ATM', 'терминал оплаты', 'платёжный терминал'],
      category: 'atm',
    },
    fuel: {
      queries: ['АЗС', 'заправка', 'газовая заправка', 'метановая заправка', 'АГНКС'],
      category: 'fuel',
    },
    pharmacy: {
      queries: ['аптека', 'дорихона', 'pharmacy'],
      category: 'pharmacy',
    },
    parking: {
      queries: ['парковка', 'автостоянка', 'parking'],
      category: 'parking',
    },
    groceries: {
      queries: ['супермаркет', 'продуктовый магазин', 'Корзинка', 'Макро', 'Havas'],
      category: 'groceries',
    },
    banks: {
      queries: ['банк', 'bank', 'обмен валют'],
      category: 'finance',
    },
    hotels: {
      queries: ['гостиница', 'отель', 'хостел', 'hotel'],
      category: 'accommodation',
    },
    healthcare: {
      queries: ['больница', 'клиника', 'поликлиника', 'стоматология'],
      category: 'healthcare',
    },
    food: {
      queries: ['ресторан', 'кафе', 'фастфуд', 'чайхана', 'столовая'],
      category: 'food_and_drink',
    },
    religion: {
      queries: ['мечеть', 'масджид', 'джума мечеть', 'церковь', 'храм', 'синагога'],
      category: 'religion',
    },
  },

  // O'zbekiston yirik shaharlari — ll va z bilan (city ID siz — 404 oldini olish)
  CITIES: [
    { name: 'Toshkent', ll: '69.2797,41.3111', z: 12 },
    { name: 'Samarqand', ll: '66.9597,39.6542', z: 13 },
    { name: 'Buxoro', ll: '64.4211,39.7745', z: 13 },
    { name: 'Namangan', ll: '71.6726,40.9983', z: 13 },
    { name: 'Andijon', ll: '72.3440,40.7821', z: 13 },
    { name: "Farg'ona", ll: '71.7910,40.3834', z: 13 },
    { name: 'Nukus', ll: '59.6035,42.4628', z: 13 },
    { name: 'Qarshi', ll: '65.7989,38.8521', z: 13 },
    { name: 'Navoiy', ll: '65.3792,40.1034', z: 13 },
    { name: 'Urganch', ll: '60.6348,41.5513', z: 13 },
    { name: 'Jizzax', ll: '67.8422,40.1158', z: 13 },
    { name: 'Guliston', ll: '68.7842,40.4897', z: 14 },
    { name: 'Termiz', ll: '67.2784,37.2241', z: 13 },
    { name: "Qo'qon", ll: '70.9429,40.5287', z: 13 },
    { name: "Marg'ilon", ll: '71.7244,40.4697', z: 14 },
    { name: 'Chirchiq', ll: '69.5831,41.4689', z: 13 },
    { name: 'Olmaliq', ll: '69.5983,40.8533', z: 14 },
    { name: 'Angren', ll: '70.1436,41.0169', z: 14 },
    { name: 'Xiva', ll: '60.6369,41.3786', z: 14 },
    { name: 'Shahrisabz', ll: '66.8308,39.0533', z: 14 },
    { name: 'Denov', ll: '67.8900,38.2800', z: 14 },
    { name: 'Bekobod', ll: '69.2200,40.2200', z: 14 },
    { name: 'Zarafshon', ll: '64.1850,41.5733', z: 14 },
    { name: 'Kogon', ll: '64.5500,39.7200', z: 14 },
  ],

  DELAY_MIN: 2000,  // So'rovlar orasidagi minimal pauza
  DELAY_MAX: 4000,
  SAVE_EVERY: 1,    // Har so'rovdan keyin saqlash
  MAX_ITEMS_PER_SEARCH: 500, // Yandex max 500 natija beradi
};

const PRESET = process.argv[2] || 'atm';
const SPLIT = process.argv[3] || 'all'; // 'a' = birinchi yarmi, 'b' = ikkinchi yarmi, 'all' = hammasi
const preset = CONFIG.PRESETS[PRESET];
if (!preset) {
  console.log(`Noto'g'ri preset: ${PRESET}`);
  console.log(`Mavjud presetlar: ${Object.keys(CONFIG.PRESETS).join(', ')}`);
  console.log(`Split: a (1-yarmi), b (2-yarmi), all (hammasi)`);
  process.exit(1);
}

// Shaharlarni split qilish
const allCities = CONFIG.CITIES;
const mid = Math.ceil(allCities.length / 2);
const cities = SPLIT === 'a' ? allCities.slice(0, mid)
             : SPLIT === 'b' ? allCities.slice(mid)
             : allCities;

const suffix = SPLIT !== 'all' ? `-${SPLIT}` : '';
const OUTPUT_DIR = path.join(__dirname, 'data');
const OUTPUT_FILE = path.join(OUTPUT_DIR, `${PRESET}-uzbekistan${suffix}.json`);
const PROGRESS_FILE = path.join(OUTPUT_DIR, `${PRESET}-progress${suffix}.json`);

function delay(min = CONFIG.DELAY_MIN, max = CONFIG.DELAY_MAX) {
  return new Promise(r => setTimeout(r, min + Math.random() * (max - min)));
}

function parseItem(item) {
  return {
    // Asosiy
    name: item.title || item.name || '',
    address: item.address || '',
    fullAddress: item.fullAddress || '',
    coordinates: item.coordinates ? { lng: item.coordinates[0], lat: item.coordinates[1] } : null,

    // Identifikator
    yandexId: item.id || null,
    yandexUri: item.uri || null,

    // Kategoriya
    categories: (item.categories || []).map(c => ({
      id: c.id,
      name: c.name,
      class: c.class,
      seoname: c.seoname,
    })),

    // Aloqa
    phones: (item.phones || []).map(p => ({
      type: p.type,
      formatted: p.formatted,
      country: p.country,
      prefix: p.prefix,
      number: p.number,
    })),
    urls: (item.urls || []).map(u => ({ type: u.type, value: u.value })),
    socialLinks: (item.socialLinks || []).map(s => ({ type: s.type, url: s.url })),

    // Ish vaqti
    workingTime: item.workingTime || null,
    workingTimeText: item.workingTimeText || null,
    currentWorkingStatus: item.currentWorkingStatus || null,

    // Reyting
    rating: item.ratingData?.totalRating || null,
    reviewCount: item.ratingData?.totalReviews || null,

    // Features (xususiyatlar)
    features: (item.features || []).map(f => ({
      id: f.id,
      name: f.name,
      value: f.value,
      type: f.type,
    })),
    featureGroups: item.featureGroups || [],

    // Rasmlar
    photoCount: Array.isArray(item.photos) ? item.photos.length : 0,
    photos: (Array.isArray(item.photos) ? item.photos : []).slice(0, 5).map(p => p?.url || p?.urlTemplate || null).filter(Boolean),

    // Meta
    region: item.region || null,
    metro: (item.metro || []).map(m => ({ name: m.name, distance: m.distance })),

    // Scraping meta
    _preset: PRESET,
    _category: preset.category,
    _scrapedAt: new Date().toISOString(),
  };
}

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  // Progress yuklash
  let results = [];
  const seenIds = new Set();
  let completedKeys = new Set();

  if (fs.existsSync(OUTPUT_FILE)) {
    try {
      results = JSON.parse(fs.readFileSync(OUTPUT_FILE, 'utf-8'));
      results.forEach(r => { if (r.yandexId) seenIds.add(r.yandexId); });
      console.log(`Davom: ${results.length} POI yuklandi (${seenIds.size} unikal)`);
    } catch {}
  }
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const prog = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
      completedKeys = new Set(prog.done || []);
    } catch {}
  }

  const totalQueries = cities.length * preset.queries.length;
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  PRESET: ${PRESET} (${preset.category}) | SPLIT: ${SPLIT}`);
  console.log(`  Queries: ${preset.queries.join(', ')}`);
  console.log(`  Cities: ${cities.length} (${cities[0].name} ... ${cities[cities.length-1].name})`);
  console.log(`  Total searches: ${totalQueries}`);
  console.log(`  Already done: ${completedKeys.size}`);
  console.log(`${'='.repeat(55)}\n`);

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'ru',
    viewport: { width: 1280, height: 800 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  // API response interceptor — turli URL patternlarni ushlash
  let lastApiResponse = null;
  page.on('response', async (response) => {
    const url = response.url();
    if (
      (url.includes('/maps/api/search') || url.includes('/maps-api/search')) &&
      response.status() === 200
    ) {
      try {
        const ct = response.headers()['content-type'] || '';
        if (!ct.includes('json')) return;
        const body = await response.text();
        const json = JSON.parse(body);
        if (json.data?.items?.length) {
          lastApiResponse = json.data;
          console.log(`  📡 API intercepted: ${json.data.items.length} items`);
        }
      } catch {}
    }
  });

  // Dastlab Yandex Maps ochish (session yaratish)
  console.log('Opening Yandex Maps...');
  await page.goto('https://yandex.uz/maps/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(5000);

  // CAPTCHA tekshirish
  const isCaptcha = await page.evaluate(() =>
    document.body.innerText.toLowerCase().includes('robot') || document.body.innerText.toLowerCase().includes('captcha')
  );
  if (isCaptcha) {
    console.log('\n⚠️  CAPTCHA! Brauzerda yeching...');
    // CAPTCHA yechilishini kutish — sahifada search snippet paydo bo'lguncha
    await page.waitForFunction(() => {
      return !document.body.innerText.toLowerCase().includes('robot') &&
             !document.body.innerText.toLowerCase().includes('captcha');
    }, { timeout: 300000 }).catch(() => {});
    await page.waitForTimeout(3000);
  }

  const startTime = Date.now();
  let queryCount = 0;

  for (const city of cities) {
    for (const query of preset.queries) {
      const key = `${city.name}|${query}`;
      if (completedKeys.has(key)) continue;

      queryCount++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);

      console.log(`\n[${queryCount}/${totalQueries - completedKeys.size}] ${city.name}: "${query}"`);

      // Xaritani shahar markaziga o'tkazish va qidirish
      lastApiResponse = null;

      // Oddiy URL — city ID siz (404 oldini olish)
      const searchUrl = `https://yandex.uz/maps/?ll=${city.ll}&z=${city.z}&text=${encodeURIComponent(query)}`;

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });
      } catch {
        console.log('  ⏱ Timeout, skipping...');
        completedKeys.add(key);
        continue;
      }

      // SSR sahifa yuklangandan keyin, Yandex AJAX call qilishini kutish
      // Agar API kelmasa — search inputga qayta yozish orqali trigger qilamiz
      await page.waitForTimeout(4000);

      if (!lastApiResponse) {
        // Search inputga yozib AJAX ni trigger qilish
        const searchInput = await page.$('input[class*="input__control"], input[placeholder*="qidirish" i], input[placeholder*="Поиск" i]');
        if (searchInput) {
          await searchInput.click({ clickCount: 3 }).catch(() => {});
          await page.waitForTimeout(300);
          await searchInput.fill('');
          await page.waitForTimeout(300);
          await searchInput.fill(query);
          await page.waitForTimeout(500);
          await page.keyboard.press('Enter');
          await page.waitForTimeout(5000);
        }
      }

      // CAPTCHA tekshirish
      const captcha = await page.evaluate(() =>
        document.body.innerText.toLowerCase().includes('robot') || document.body.innerText.toLowerCase().includes('captcha')
      );
      if (captcha) {
        console.log('  ⚠️  CAPTCHA! Brauzerda yeching...');
        await page.waitForFunction(() => {
          return !document.body.innerText.toLowerCase().includes('robot') &&
                 !document.body.innerText.toLowerCase().includes('captcha');
        }, { timeout: 300000 }).catch(() => {});
        // Qayta yuklash
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
        await page.waitForTimeout(5000);
      }

      if (!lastApiResponse) {
        // DOM dan snippet soni tekshirish
        const snippetCount = await page.$$eval('.search-snippet-view', els => els.length).catch(() => 0);
        console.log(`  API response yo'q (DOM snippets: ${snippetCount})`);

        if (snippetCount === 0) {
          completedKeys.add(key);
          await delay();
          continue;
        }

        // API kelmagan bo'lsa, scroll qilib kutib ko'ramiz
        await page.waitForTimeout(3000);
      }

      // Pagination — keyingi sahifalarni ham olish
      let totalNewPois = 0;
      let pageNum = 1;

      const processResponse = (data) => {
        if (!data?.items) return 0;
        let newCount = 0;
        for (const item of data.items) {
          const id = item.id;
          if (id && seenIds.has(id)) continue;
          if (id) seenIds.add(id);

          const parsed = parseItem(item);
          parsed._city = city.name;
          parsed._query = query;
          results.push(parsed);
          newCount++;
        }
        return newCount;
      };

      if (lastApiResponse) {
        const added = processResponse(lastApiResponse);
        totalNewPois += added;
        const totalInResponse = lastApiResponse.totalResultCount || lastApiResponse.items?.length || 0;
        console.log(`  Page 1: ${lastApiResponse.items?.length || 0} items, ${added} yangi (total: ${totalInResponse})`);

        // Agar ko'proq natija bo'lsa — scroll qilib keyingi sahifalarni olish
        const pageCount = lastApiResponse.pageCount || 1;
        if (pageCount > 1) {
          for (let p = 2; p <= Math.min(pageCount, 20); p++) {
            lastApiResponse = null;

            // Scroll down to load more
            await page.evaluate(() => {
              const c = document.querySelector('.scroll__container');
              if (c) c.scrollTop = c.scrollHeight;
            });
            await page.waitForTimeout(3000);

            // "Ko'proq ko'rsatish" tugmasini bosish
            const moreBtn = await page.$('[class*="load-more"], [class*="show-more"], button:has-text("Показать ещё")');
            if (moreBtn) {
              await moreBtn.click().catch(() => {});
              await page.waitForTimeout(3000);
            }

            if (lastApiResponse) {
              const added = processResponse(lastApiResponse);
              totalNewPois += added;
              console.log(`  Page ${p}: ${lastApiResponse.items?.length || 0} items, ${added} yangi`);
            }
          }
        }
      }

      console.log(`  ✅ Jami yangi: ${totalNewPois} | Total: ${results.length} (${seenIds.size} unikal)`);

      completedKeys.add(key);

      // Saqlash
      if (queryCount % CONFIG.SAVE_EVERY === 0) {
        fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
          done: Array.from(completedKeys),
          total: results.length,
          unique: seenIds.size,
          ts: new Date().toISOString(),
        }));
        console.log(`  💾 Saqlandi: ${results.length} POI`);
      }

      await delay();
    }
  }

  // Yakuniy saqlash
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(results, null, 2));
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    done: Array.from(completedKeys),
    total: results.length,
    unique: seenIds.size,
    ts: new Date().toISOString(),
    completed: true,
  }));

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  ✅ TUGADI: ${PRESET}`);
  console.log(`  Vaqt:     ${Math.floor(elapsed / 60)} min ${elapsed % 60} sek`);
  console.log(`  Jami POI: ${results.length} (${seenIds.size} unikal)`);
  console.log(`  Saqlandi: ${OUTPUT_FILE}`);
  console.log(`${'='.repeat(55)}`);

  await browser.close();
}

run().catch(console.error);
