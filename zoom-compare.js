const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CENTER = { lat: 41.3111, lng: 69.2797 };
const ZOOMS = [6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20];
const OUTPUT_DIR = path.join(__dirname, 'zoom-screenshots');

async function getZoom(page) {
  return page.evaluate(() => {
    const t = document.body.innerText;
    const m = t.match(/ZOOM\s+([\d.]+)/i);
    return m ? parseFloat(m[1]) : null;
  });
}

async function run() {
  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // === U-Maps ===
  console.log('\n=== U-Maps screenshots ===');
  const uCtx = await browser.newContext({
    viewport: { width: 1280, height: 800 },
    permissions: [],
    storageState: undefined,
  });
  const uPage = await uCtx.newPage();

  // localStorage tozalash (eski zoom saqlanmasligi uchun)
  await uPage.addInitScript(() => {
    localStorage.clear();
    navigator.geolocation.getCurrentPosition = (s, e) => e?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1 });
    navigator.geolocation.watchPosition = (s, e) => { e?.({ code: 1, message: 'denied', PERMISSION_DENIED: 1 }); return 0; };
  });

  console.log('  Loading...');
  await uPage.goto('https://u-maps.xdevs.uz/', { waitUntil: 'networkidle', timeout: 45000 }).catch(() => {});
  await uPage.waitForTimeout(5000);

  let curZoom = await getZoom(uPage);
  console.log(`  Initial zoom: ${curZoom}`);

  // Custom zoom buttons: birinchi = +, ikkinchi = -
  const zoomBtns = uPage.locator('.zoom-btn');
  const btnCount = await zoomBtns.count();
  console.log(`  Zoom buttons count: ${btnCount}`);

  // Qaysi biri + va qaysi biri - ekanini aniqlash
  // + bosganda zoom oshadi, - bosganda tushadi
  const testZoom = await getZoom(uPage);
  await zoomBtns.nth(0).click();
  await uPage.waitForTimeout(800);
  const afterFirst = await getZoom(uPage);
  console.log(`  Before: ${testZoom}, after btn[0]: ${afterFirst}`);

  let zoomInIdx = 0, zoomOutIdx = 1;
  if (afterFirst !== null && testZoom !== null && afterFirst < testZoom) {
    zoomInIdx = 1;
    zoomOutIdx = 0;
  }
  console.log(`  Zoom IN = btn[${zoomInIdx}], Zoom OUT = btn[${zoomOutIdx}]`);

  // Oldin - bosib, testni qaytarish
  await zoomBtns.nth(zoomOutIdx).click();
  await uPage.waitForTimeout(800);

  // Sorted zoom levellarga borish
  for (const targetZ of ZOOMS) {
    curZoom = await getZoom(uPage);
    if (curZoom === null) { console.log(`  Zoom ${targetZ}: SKIP (no data)`); continue; }

    let diff = targetZ - Math.round(curZoom);

    while (diff !== 0) {
      if (diff > 0) {
        await zoomBtns.nth(zoomInIdx).click();
      } else {
        await zoomBtns.nth(zoomOutIdx).click();
      }
      await uPage.waitForTimeout(600);
      curZoom = await getZoom(uPage);
      if (curZoom === null) break;
      diff = targetZ - Math.round(curZoom);
    }
    await uPage.waitForTimeout(2500); // tiles yuklanishini kutish

    curZoom = await getZoom(uPage);
    console.log(`  Zoom ${targetZ}: actual=${curZoom}`);
    await uPage.screenshot({ path: path.join(OUTPUT_DIR, `umaps_z${String(targetZ).padStart(2, '0')}.png`) });
  }
  await uPage.close();
  await uCtx.close();

  // === Yandex Maps ===
  console.log('\n=== Yandex Maps screenshots ===');
  const yCtx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const yPage = await yCtx.newPage();

  for (const z of ZOOMS) {
    const url = `https://yandex.uz/maps/?ll=${CENTER.lng}%2C${CENTER.lat}&z=${z}&l=map`;
    console.log(`  Zoom ${z}...`);
    await yPage.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
    await yPage.waitForTimeout(5000);
    await yPage.keyboard.press('Escape');
    await yPage.waitForTimeout(1000);

    await yPage.screenshot({ path: path.join(OUTPUT_DIR, `yandex_z${String(z).padStart(2, '0')}.png`) });
    console.log(`  Zoom ${z}: ✅`);
  }

  await browser.close();
  console.log(`\n✅ Done!`);
}

run().catch(console.error);
