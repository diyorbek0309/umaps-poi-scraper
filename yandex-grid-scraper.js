const { chromium } = require('playwright');
const fs = require('fs');

// === KONFIGURATSIYA ===
const CITY = 'tashkent';
const CITY_ID = '10335';

// Toshkent chegaralari
const BOUNDS = {
  minLat: 41.20, maxLat: 41.40,
  minLon: 69.10, maxLon: 69.40,
};

// Grid o'lchami — 0.02° ≈ 2.2 km
const GRID_STEP = 0.02;

// Har bir katakda qidiriladigan kategoriyalar
const CATEGORIES = [
  'restoran', 'kafe', 'dorixona', 'bank',
  'supermarket', 'maktab', 'kasalxona', 'masjid',
  'mehmonxona', 'avtoservis', 'sport zal', 'gozallik saloni',
  'stomatologiya', 'bolalar bogchasi', 'kinoteatr',
];

const MAX_SCROLL = 8;
const OUTPUT = '/Users/diyorbek0309/Documents/Projects/u-maps/scraper/tashkent-grid-pois.json';
const PROGRESS_FILE = '/Users/diyorbek0309/Documents/Projects/u-maps/scraper/scraper-progress.json';

// === GRID YARATISH ===
function generateGrid() {
  const cells = [];
  for (let lat = BOUNDS.minLat; lat < BOUNDS.maxLat; lat += GRID_STEP) {
    for (let lon = BOUNDS.minLon; lon < BOUNDS.maxLon; lon += GRID_STEP) {
      cells.push({
        centerLat: +(lat + GRID_STEP / 2).toFixed(4),
        centerLon: +(lon + GRID_STEP / 2).toFixed(4),
        spnLat: +(GRID_STEP / 2).toFixed(4),
        spnLon: +(GRID_STEP / 2).toFixed(4),
      });
    }
  }
  return cells;
}

async function scrapeYandexMaps() {
  const startTime = Date.now();
  const grid = generateGrid();
  console.log(`Grid: ${grid.length} ta katak | ${CATEGORIES.length} kategoriya | Jami: ${grid.length * CATEGORIES.length} query\n`);

  // Oldingi natijalarni yuklash (davom ettirish uchun)
  let allPois = [];
  const seenOrgIds = new Set();
  let completedCells = new Set();

  if (fs.existsSync(OUTPUT)) {
    try {
      allPois = JSON.parse(fs.readFileSync(OUTPUT, 'utf-8'));
      allPois.forEach(p => { if (p.yandexOrgId) seenOrgIds.add(p.yandexOrgId); });
      console.log(`Davom etish: ${allPois.length} ta oldingi POI yuklandi (${seenOrgIds.size} unikal)\n`);
    } catch (e) {}
  }
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const progress = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8'));
      completedCells = new Set(progress.completedCells || []);
      console.log(`${completedCells.size} ta katak allaqachon bajarilgan\n`);
    } catch (e) {}
  }

  const browser = await chromium.launch({
    headless: false,
    args: ['--disable-blink-features=AutomationControlled'],
  });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    locale: 'uz-UZ',
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => false });
  });

  const page = await context.newPage();

  for (let ci = 0; ci < grid.length; ci++) {
    const cell = grid[ci];
    const cellKey = `${cell.centerLat},${cell.centerLon}`;

    if (completedCells.has(cellKey)) continue;

    const elapsed = Math.round((Date.now() - startTime) / 60000);
    console.log(`\n[${'█'.repeat(Math.round(ci/grid.length*20))}${'░'.repeat(20-Math.round(ci/grid.length*20))}] Katak ${ci+1}/${grid.length} | ${allPois.length} POI | ${elapsed} min`);
    console.log(`  Koordinata: [${cell.centerLon}, ${cell.centerLat}]`);

    for (const category of CATEGORIES) {
      // URL bilan qidirish — ll va spn parametrlari bilan
      const searchUrl = `https://yandex.uz/maps/${CITY_ID}/${CITY}/search/${encodeURIComponent(category)}/?ll=${cell.centerLon}%2C${cell.centerLat}&spn=${cell.spnLon}%2C${cell.spnLat}&z=15`;

      try {
        await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 15000 });
      } catch (e) {
        continue;
      }

      // Captcha
      const hasCaptcha = await page.$('.CheckboxCaptcha, [class*="Captcha"]');
      if (hasCaptcha) {
        console.log('  [!] CAPTCHA! Brauzerda yeching...');
        await page.waitForSelector('.search-business-snippet-view', { timeout: 120000 });
      }

      const hasResults = await page.waitForSelector('.search-business-snippet-view', { timeout: 5000 }).catch(() => null);
      if (!hasResults) continue;

      await page.waitForTimeout(1000);

      // Koordinatalar og:image dan
      const markerCoords = await page.evaluate(() => {
        const ogImage = document.querySelector('meta[property="og:image"]');
        if (!ogImage) return [];
        const content = ogImage.getAttribute('content') || '';
        const ptMatch = content.match(/pt=([^&]+)/);
        if (!ptMatch) return [];
        return decodeURIComponent(ptMatch[1]).split('~').map(part => {
          const [lon, lat] = part.split(',').map(Number);
          return (!isNaN(lon) && !isNaN(lat)) ? { lon, lat } : null;
        }).filter(Boolean);
      });

      // Scroll
      let prevCount = 0;
      for (let s = 0; s < MAX_SCROLL; s++) {
        await page.evaluate(() => {
          const list = document.querySelector('.scroll__container');
          if (list) list.scrollTop += 800;
        });
        await page.waitForTimeout(1000);
        const count = await page.$$eval('.search-snippet-view', els => els.length);
        if (count === prevCount) break;
        prevCount = count;
      }

      // Har bir snippet
      const snippetCount = await page.$$eval('.search-snippet-view', els => els.length);
      let newInCategory = 0;

      for (let i = 0; i < snippetCount; i++) {
        try {
          const snippets = await page.$$('.search-snippet-view');
          if (i >= snippets.length) break;

          // DOM dan asosiy ma'lumot
          const domData = await snippets[i].evaluate((el) => {
            const biz = el.querySelector('.search-business-snippet-view');
            if (!biz) return null;
            const name = biz.querySelector('.search-business-snippet-view__title')?.textContent?.trim();
            if (!name) return null;

            const photoEls = biz.querySelectorAll('.search-snippet-gallery-view__item img');
            const photos = Array.from(photoEls)
              .map(img => (img.getAttribute('src') || '').replace(/\d+x\d+/, '600x400'))
              .filter(s => s.startsWith('http'));

            return {
              name,
              address: biz.querySelector('.search-business-snippet-view__address')?.textContent?.trim() || null,
              category: biz.querySelector('.search-business-snippet-view__categories')?.textContent?.trim() || null,
              rating: (() => {
                const r = biz.querySelector('.business-rating-badge-view__rating-text')?.textContent?.trim();
                return r ? parseFloat(r.replace(',', '.')) : null;
              })(),
              reviewCount: (() => {
                const r = biz.querySelector('.business-rating-with-text-view__count')?.textContent?.trim();
                return r ? parseInt(r.replace(/\D/g, '')) : null;
              })(),
              photos,
            };
          });

          if (!domData) continue;

          // Click → detail
          await snippets[i].click();
          await page.waitForTimeout(1000);

          const orgUrl = page.url();
          const orgMatch = orgUrl.match(/\/org\/([^/]+)/);
          const orgId = orgMatch ? orgMatch[1] : null;

          // Dublikat
          if (orgId && seenOrgIds.has(orgId)) {
            await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
            await page.waitForTimeout(400);
            continue;
          }
          if (orgId) seenOrgIds.add(orgId);

          // "Jadval" bosib ish vaqtini ochish
          const jadvalBtn = await page.$('text=Jadval');
          if (jadvalBtn) {
            await jadvalBtn.click();
            await page.waitForTimeout(500);
          }

          // Detail ma'lumotlar
          const detail = await page.evaluate(() => {
            // Telefon
            const phoneEls = document.querySelectorAll(
              '.orgpage-phones-view__phone-number, .card-phones-view__phone-number, a[href^="tel:"]'
            );
            const phones = Array.from(phoneEls)
              .map(el => (el.textContent?.trim() || '').replace(/Telefon raqamini.*$/i, '').replace(/Показать.*$/i, '').trim())
              .filter(Boolean);

            // Website
            const siteEl = document.querySelector('.business-urls-view__link a');
            const website = siteEl?.textContent?.trim() || null;

            // Subcategories
            const catItems = document.querySelectorAll('.orgpage-categories-info-view__item');
            const subcategories = Array.from(catItems).map(el => el.textContent?.trim()).filter(Boolean);

            // Breadcrumb → asosiy kategoriya
            const breadcrumbs = document.querySelectorAll('.breadcrumbs-view__breadcrumb');
            const bcTexts = Array.from(breadcrumbs).map(b => b.textContent?.trim()).filter(Boolean);
            const mainCategory = bcTexts.length >= 3 ? bcTexts[2] : null;

            // Haftalik ish vaqti
            const scheduleItems = document.querySelectorAll('.business-working-intervals-view__item');
            const workingHours = Array.from(scheduleItems).map(item => {
              const day = item.querySelector('.business-working-intervals-view__day')?.textContent?.trim();
              const interval = item.querySelector('.business-working-intervals-view__interval')?.textContent?.trim();
              return day && interval ? { day, hours: interval } : null;
            }).filter(Boolean);

            // Ijtimoiy tarmoqlar
            const socialEls = document.querySelectorAll(
              '.business-contacts-view__social-button a, .orgpage-contacts-view__social a, a[class*="social"]'
            );
            const socials = Array.from(socialEls)
              .map(a => {
                const href = a.getAttribute('href') || '';
                let platform = null;
                if (href.includes('instagram')) platform = 'instagram';
                else if (href.includes('t.me') || href.includes('telegram')) platform = 'telegram';
                else if (href.includes('facebook')) platform = 'facebook';
                else if (href.includes('youtube')) platform = 'youtube';
                else if (href.includes('tiktok')) platform = 'tiktok';
                else if (href.includes('twitter') || href.includes('x.com')) platform = 'twitter';
                else if (href) platform = 'other';
                return platform ? { platform, url: href } : null;
              })
              .filter(Boolean);

            // Rasmlar
            const photoEls = document.querySelectorAll('.search-snippet-gallery-view__item img, .media-wrapper img');
            const photos = Array.from(photoEls)
              .map(img => (img.getAttribute('src') || '').replace(/\d+x\d+/, '600x400'))
              .filter(s => s.startsWith('http'));

            return { phones, website, subcategories, mainCategory, workingHours, socials, photos };
          });

          const allPhotos = [...new Set([...domData.photos, ...detail.photos])];
          const coords = markerCoords[i] || null;

          const poi = {
            name: domData.name,
            address: domData.address,
            category: detail.mainCategory || domData.category,
            subcategories: detail.subcategories.length > 0 ? detail.subcategories : null,
            rating: domData.rating,
            reviewCount: domData.reviewCount,
            hours: detail.workingHours.length > 0 ? detail.workingHours : null,
            phone: detail.phones.length > 0 ? detail.phones : null,
            website: detail.website,
            socials: detail.socials.length > 0 ? detail.socials : null,
            photos: allPhotos.length > 0 ? allPhotos : null,
            coordinates: coords,
            yandexOrgId: orgId,
            yandexUrl: orgId ? `https://yandex.uz/maps/org/${orgId}/` : null,
          };

          allPois.push(poi);
          newInCategory++;

          // Ortga
          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForSelector('.search-business-snippet-view', { timeout: 6000 }).catch(() => {});
          await page.waitForTimeout(400);

        } catch (err) {
          try {
            await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 12000 });
            await page.waitForTimeout(1500);
          } catch (e) {}
        }
      }

      if (newInCategory > 0) {
        console.log(`  ${category}: +${newInCategory} yangi (jami: ${allPois.length})`);
      }
    }

    // Katakni bajarilgan deb belgilash
    completedCells.add(cellKey);

    // Har 5 katakda saqlash
    if (ci % 5 === 0 || ci === grid.length - 1) {
      fs.writeFileSync(OUTPUT, JSON.stringify(allPois, null, 2), 'utf-8');
      fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
        completedCells: Array.from(completedCells),
        totalPois: allPois.length,
        uniqueOrgs: seenOrgIds.size,
        lastUpdate: new Date().toISOString(),
      }), 'utf-8');
    }
  }

  await browser.close();

  // Yakuniy saqlash
  fs.writeFileSync(OUTPUT, JSON.stringify(allPois, null, 2), 'utf-8');

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const uniqueCats = [...new Set(allPois.map(p => p.category).filter(Boolean))];

  console.log(`\n${'='.repeat(55)}`);
  console.log(`  Vaqt:              ${Math.floor(elapsed / 60)} min ${elapsed % 60} sek`);
  console.log(`  Jami POI:          ${allPois.length} (${seenOrgIds.size} unikal)`);
  console.log(`  Koordinatalari:    ${allPois.filter(p => p.coordinates).length}`);
  console.log(`  Telefon:           ${allPois.filter(p => p.phone?.length).length}`);
  console.log(`  Rasmlar:           ${allPois.filter(p => p.photos?.length).length} POI`);
  console.log(`  Ish vaqti:         ${allPois.filter(p => p.hours?.length).length}`);
  console.log(`  Ijtimoiy:          ${allPois.filter(p => p.socials?.length).length}`);
  console.log(`  Subkategoriya:     ${allPois.filter(p => p.subcategories?.length).length}`);
  console.log(`  Kategoriyalar:     ${uniqueCats.length} xil`);
  console.log(`  Kataklar:          ${completedCells.size}/${grid.length}`);
  console.log(`  Saqlandi:          ${OUTPUT}`);
  console.log('='.repeat(55));
}

scrapeYandexMaps().catch(console.error);
