const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SEARCHES = [
  'ресторан',
  'банкомат',
  'аптека',
  'гостиница',
  'АЗС',
  'салон красоты',
  'фитнес',
  'автосервис',
];

const OUTPUT_DIR = path.join(__dirname, 'yandex-api-responses');

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({ headless: false, slowMo: 100 });
  const context = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    locale: 'ru',
  });
  const page = await context.newPage();

  // Barcha API responslarni ushlab olish
  const capturedResponses = [];

  page.on('response', async (response) => {
    const url = response.url();
    // Yandex Maps search/business API endpointlarini ushlaymiz
    if (
      url.includes('/search/') ||
      url.includes('/business/') ||
      url.includes('/categories') ||
      url.includes('/orgpage') ||
      url.includes('/serp') ||
      url.includes('suggest') ||
      url.includes('geocode') ||
      url.includes('discovery')
    ) {
      try {
        const contentType = response.headers()['content-type'] || '';
        if (contentType.includes('json') || contentType.includes('javascript') || contentType.includes('protobuf')) {
          const body = await response.text().catch(() => null);
          if (body && body.length > 50) {
            capturedResponses.push({
              url: url.substring(0, 200),
              status: response.status(),
              size: body.length,
              contentType,
            });

            // JSON parse qilishga urinish
            try {
              const json = JSON.parse(body);
              const keys = Object.keys(json);
              // features, featureGroups, filters, filterGroups bormi?
              const hasFeatures = body.includes('"features"');
              const hasFeatureGroups = body.includes('"featureGroups"');
              const hasFilters = body.includes('"filters"');
              const hasFilterGroups = body.includes('"filterGroups"');

              if (hasFeatures || hasFeatureGroups || hasFilters || hasFilterGroups) {
                const filename = `response_${capturedResponses.length}.json`;
                fs.writeFileSync(path.join(OUTPUT_DIR, filename), JSON.stringify(json, null, 2));
                console.log(`  💾 SAVED ${filename} (${(body.length / 1024).toFixed(1)}KB) — features:${hasFeatures} featureGroups:${hasFeatureGroups} filters:${hasFilters} filterGroups:${hasFilterGroups}`);
              }
            } catch {}
          }
        }
      } catch {}
    }
  });

  console.log('Opening Yandex Maps...');
  await page.goto('https://yandex.uz/maps/10335/tashkent/?ll=69.2797%2C41.3111&z=14&lang=ru', {
    waitUntil: 'domcontentloaded', timeout: 60000
  }).catch(() => {});
  await page.waitForTimeout(5000);

  // CAPTCHA check
  const isCaptcha = await page.evaluate(() =>
    document.body.innerText.toLowerCase().includes('robot') ||
    document.body.innerText.toLowerCase().includes('captcha')
  );
  if (isCaptcha) {
    console.log('⚠️  CAPTCHA! Qo\'lda yeching, Enter bosing...');
    await new Promise(r => process.stdin.once('data', r));
    await page.waitForTimeout(3000);
  }

  // Search inputni topish
  const searchInput = await page.$('input[placeholder*="qidirish" i], input[placeholder*="search" i], input[placeholder*="Поиск" i], input[class*="search"]');

  if (!searchInput) {
    console.log('Search input not found!');
    const inputs = await page.$$eval('input', els => els.map(e => ({ ph: e.placeholder, cls: e.className?.substring(0, 50) })));
    console.log('Available inputs:', inputs);
    await browser.close();
    return;
  }

  for (const query of SEARCHES) {
    console.log(`\n🔍 Searching: "${query}"`);
    capturedResponses.length = 0;

    await searchInput.click({ clickCount: 3 });
    await page.waitForTimeout(300);
    await searchInput.fill(query);
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    await page.waitForTimeout(6000);

    // Birinchi natijani bosish (detail ko'rish uchun)
    const firstResult = await page.$('[class*="search-snippet"], [class*="card"], [class*="business-item"]');
    if (firstResult) {
      await firstResult.click().catch(() => {});
      await page.waitForTimeout(4000);
    }

    console.log(`  Captured ${capturedResponses.length} API responses`);
    capturedResponses.forEach(r => {
      console.log(`    ${r.status} ${r.url.substring(0, 100)} (${(r.size / 1024).toFixed(1)}KB)`);
    });

    // Orqaga qaytish
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }

  // Barcha saqlangan fayllarni ko'rish
  const savedFiles = fs.readdirSync(OUTPUT_DIR).filter(f => f.endsWith('.json'));
  console.log(`\n✅ Done! Saved ${savedFiles.length} JSON responses to ${OUTPUT_DIR}`);

  await page.waitForTimeout(2000);
  await browser.close();
}

run().catch(console.error);
