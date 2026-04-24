/**
 * HTTP-based scraper test
 * 1. Browser bilan 1 marta session + API URL/headers ushlaymiz
 * 2. Keyin axios bilan to'g'ridan-to'g'ri HTTP so'rovlar qilamiz
 */

const { chromium } = require('playwright');
const https = require('https');
const fs = require('fs');

let capturedRequest = null;

async function captureSession() {
  console.log('🌐 Browser orqali session va API URL ushlash...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({ locale: 'ru', viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();

  // Request ni ushlaymiz (response emas) — to'liq URL + headers
  page.on('request', (req) => {
    const url = req.url();
    if ((url.includes('/maps/api/search') || url.includes('/maps-api/search')) && !capturedRequest) {
      capturedRequest = {
        url,
        headers: req.headers(),
      };
      console.log('\n✅ API request ushlandi!');
      console.log('URL:', url.substring(0, 200));
    }
  });

  await page.goto('https://yandex.uz/maps/', { waitUntil: 'domcontentloaded' });

  // CAPTCHA tekshirish
  await page.waitForTimeout(2000);
  const hasCaptcha = await page.$('form[action*="captcha"], .captcha, [class*="captcha"]');
  if (hasCaptcha) {
    console.log('⚠️  CAPTCHA! Yoching va Enter bosing...');
    await new Promise(r => process.stdin.once('data', r));
  }

  // Bitta qidiruv qilamiz — API URL ni ushlash uchun
  await page.goto(
    `https://yandex.uz/maps/?ll=69.2797,41.3111&z=12&text=${encodeURIComponent('банкомат')}`,
    { waitUntil: 'domcontentloaded', timeout: 20000 }
  );
  await page.waitForTimeout(3000);

  // Cookie larni olish
  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  await browser.close();

  return { cookieStr, capturedRequest };
}

async function httpRequest(url, headers) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, data }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function buildSearchUrl(baseUrl, overrides = {}) {
  const url = new URL(baseUrl);
  for (const [k, v] of Object.entries(overrides)) {
    url.searchParams.set(k, v);
  }
  return url.toString();
}

async function main() {
  // 1. Session ushlash
  const { cookieStr, capturedRequest: captured } = await captureSession();

  if (!captured) {
    console.log('❌ API URL ushlashni uddalamadi. Qayta urinib ko\'ring.');
    process.exit(1);
  }

  console.log('\n📋 Ushlangan ma\'lumotlar:');
  console.log('Cookie uzunligi:', cookieStr.length);
  console.log('API URL pattern:', captured.url.substring(0, 150));

  // 2. Xuddi shu URL bilan HTTP so'rov — faqat cookie yangilangan
  const testHeaders = {
    ...captured.headers,
    cookie: cookieStr,
    referer: 'https://yandex.uz/maps/',
  };

  // Test 1 — Toshkent: банкомат
  console.log('\n⚡ Test 1 — to\'g\'ridan HTTP (Toshkent, банкомат)...');
  const t1 = Date.now();
  try {
    const res1 = await httpRequest(captured.url, testHeaders);
    const ms1 = Date.now() - t1;
    if (res1.data?.data?.items) {
      console.log(`✅ ${res1.data.data.items.length} POI — ${ms1}ms`);
    } else if (res1.data?.features) {
      console.log(`✅ ${res1.data.features.length} POI — ${ms1}ms`);
    } else {
      console.log(`⚠️  Status ${res1.status} — ${ms1}ms`);
      console.log('Keys:', typeof res1.data === 'object' ? Object.keys(res1.data) : res1.data?.substring?.(0, 100));
    }
  } catch (e) {
    console.log('❌ Xato:', e.message);
  }

  // Test 2 — Samarqand: boshqa shahar
  const url2 = buildSearchUrl(captured.url, {
    ll: '66.9597,39.6542',
    text: 'банкомат',
  });
  console.log('\n⚡ Test 2 — Samarqand (cookie saqlanib qolganmi?)...');
  const t2 = Date.now();
  try {
    const res2 = await httpRequest(url2, testHeaders);
    const ms2 = Date.now() - t2;
    if (res2.data?.data?.items) {
      console.log(`✅ ${res2.data.data.items.length} POI — ${ms2}ms`);
    } else {
      console.log(`⚠️  Status ${res2.status} — ${ms2}ms`);
    }
  } catch (e) {
    console.log('❌ Xato:', e.message);
  }

  // Test 3 — 30 soniyadan keyin (session hali tirikmikan?)
  console.log('\n⏱ 30 soniya kutish — session muddatini tekshirish...');
  await new Promise(r => setTimeout(r, 30000));

  console.log('⚡ Test 3 — 30s keyin...');
  const t3 = Date.now();
  try {
    const res3 = await httpRequest(captured.url, testHeaders);
    const ms3 = Date.now() - t3;
    if (res3.data?.data?.items) {
      console.log(`✅ ${res3.data.data.items.length} POI — ${ms3}ms — Session tirik!`);
    } else {
      console.log(`❌ Status ${res3.status} — Session o'ldi`);
    }
  } catch (e) {
    console.log('❌ Xato:', e.message);
  }

  // Natijani saqlash
  fs.writeFileSync('http-test-result.json', JSON.stringify({
    apiUrl: captured.url,
    headers: testHeaders,
    cookieLength: cookieStr.length,
    testedAt: new Date().toISOString(),
  }, null, 2));

  console.log('\n💾 http-test-result.json ga saqlandi (keyingi testlar uchun)');
}

main().catch(console.error);
