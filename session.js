/**
 * Yandex Maps session manager
 * Playwright bilan bir marta login → cookie saqlash → HTTP requestlarda ishlatish
 *
 * Ishlatish:
 *   node session.js          — yangi session yaratish
 *   require('./session').getHeaders()  — grid-scraper ichida
 */

const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const SESSION_FILE = path.join(__dirname, 'data', 'session.json');

async function createSession() {
  console.log('🌐 Browser ochilmoqda — Yandex Maps session yaratish...');
  const browser = await chromium.launch({ headless: false });
  const context = await browser.newContext({
    locale: 'ru',
    viewport: { width: 1280, height: 800 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  });
  const page = await context.newPage();

  console.log('📍 Yandex Maps ga o\'tilmoqda...');
  await page.goto('https://yandex.uz/maps/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2000);

  // Bitta qidiruv qilib cookie yig'amiz
  await page.goto(
    `https://yandex.uz/maps/?ll=69.2797,41.3111&z=12&text=${encodeURIComponent('банкомат')}`,
    { waitUntil: 'domcontentloaded', timeout: 20000 }
  );

  // CAPTCHA bo'lsa — URL /showcaptcha bo'ladi. Yechilguncha kutamiz (max 3 daqiqa)
  if (page.url().includes('captcha') || page.url().includes('showcaptcha')) {
    console.log('\n⚠️  CAPTCHA aniqlandi! Brauzerda yoching...');
    console.log('   (Avtomatik davom etadi — Enter bosish shart emas)\n');
    await page.waitForURL('**/maps/**', { timeout: 180000 });
    console.log('   ✅ CAPTCHA yechildi!\n');
  }

  await page.waitForTimeout(2000);

  const cookies = await context.cookies();
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join('; ');

  await browser.close();

  fs.mkdirSync(path.dirname(SESSION_FILE), { recursive: true });
  fs.writeFileSync(SESSION_FILE, JSON.stringify({
    cookies: cookieStr,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString(), // 2h
  }));

  console.log(`\n✅ Session saqlandi: ${SESSION_FILE}`);
  console.log(`   Cookie uzunligi: ${cookieStr.length} chars`);
  console.log(`   Amal qilish muddati: 2 soat`);
  return cookieStr;
}

function loadSession() {
  if (!fs.existsSync(SESSION_FILE)) return null;
  const s = JSON.parse(fs.readFileSync(SESSION_FILE));
  if (new Date() > new Date(s.expiresAt)) {
    console.log('⚠️  Session muddati tugagan — yangi session kerak');
    return null;
  }
  return s.cookies;
}

function getHeaders(cookies) {
  return {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
    'Accept-Encoding': 'identity',
    'Cookie': cookies,
    'Referer': 'https://yandex.uz/maps/',
  };
}

module.exports = { createSession, loadSession, getHeaders };

// Directly run: node session.js
if (require.main === module) {
  createSession().catch(console.error);
}
