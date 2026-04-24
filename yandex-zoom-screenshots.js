const { chromium } = require('playwright');
const path = require('path');

const CENTER = { lat: 41.3111, lng: 69.2797 }; // Toshkent markazi
const ZOOMS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
const OUTPUT_DIR = path.join(__dirname, 'zoom-screenshots');

async function run() {
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

  // Birinchi sahifani ochish
  console.log('Yandex Maps ochilmoqda...');
  await page.goto(`https://yandex.uz/maps/?ll=${CENTER.lng}%2C${CENTER.lat}&z=10&l=map`, {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  }).catch(() => {});

  await page.waitForTimeout(3000);

  // CAPTCHA tekshirish
  const isCaptcha = await page.evaluate(() =>
    document.body.innerText.toLowerCase().includes('robot') ||
    document.body.innerText.toLowerCase().includes('captcha')
  );

  if (isCaptcha) {
    console.log('\n⚠️  CAPTCHA! Brauzerda yeching...\n');
    await page.waitForFunction(() => {
      return !document.body.innerText.toLowerCase().includes('robot') &&
             !document.body.innerText.toLowerCase().includes('captcha');
    }, { timeout: 300000 }); // 5 minut kutish
    console.log('✅ CAPTCHA yechildi!\n');
    await page.waitForTimeout(3000);
  }

  // Popup/banner yopish
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1000);

  // Har bir zoom uchun screenshot
  for (const z of ZOOMS) {
    const url = `https://yandex.uz/maps/?ll=${CENTER.lng}%2C${CENTER.lat}&z=${z}&l=map`;
    console.log(`Zoom ${z}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    await page.waitForTimeout(4000);

    // Popup yopish
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);

    // Search panel yopish (agar ochiq bo'lsa)
    const closeBtn = await page.$('button[class*="close"]');
    if (closeBtn) await closeBtn.click().catch(() => {});
    await page.waitForTimeout(500);

    await page.screenshot({
      path: path.join(OUTPUT_DIR, `yandex_z${String(z).padStart(2, '0')}.png`),
    });
    console.log(`  ✅ yandex_z${String(z).padStart(2, '0')}.png saqlandi`);

    // CAPTCHA tekshirish har safar
    const captcha = await page.evaluate(() =>
      document.body.innerText.toLowerCase().includes('robot') ||
      document.body.innerText.toLowerCase().includes('captcha')
    );
    if (captcha) {
      console.log('  ⚠️  CAPTCHA! Yeching...');
      await page.waitForFunction(() => {
        return !document.body.innerText.toLowerCase().includes('robot') &&
               !document.body.innerText.toLowerCase().includes('captcha');
      }, { timeout: 300000 });
      console.log('  ✅ CAPTCHA yechildi');
      await page.waitForTimeout(2000);
    }
  }

  console.log(`\n✅ Tayyor! ${ZOOMS.length} ta screenshot: ${OUTPUT_DIR}/yandex_z*.png`);
  await browser.close();
}

run().catch(console.error);
