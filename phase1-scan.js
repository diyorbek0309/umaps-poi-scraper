const { chromium } = require('playwright');
const fs = require('fs');

// === KONFIGURATSIYA ===
const BOUNDS = { minLat: 41.20, maxLat: 41.40, minLon: 69.10, maxLon: 69.40 };
const GRID_STEP = 0.02; // ~2.2 km
const CATEGORIES = [
  'restoran', 'kafe', 'dorixona', 'bank',
  'supermarket', 'maktab', 'kasalxona', 'masjid',
  'mehmonxona', 'avtoservis', 'sport zal', 'gozallik saloni',
  'stomatologiya', 'bolalar bogchasi', 'kinoteatr',
];
const MAX_SCROLL = 6;
const OUTPUT = '/Users/diyorbek0309/Documents/Projects/u-maps/scraper/phase1-results.json';
const PROGRESS_FILE = '/Users/diyorbek0309/Documents/Projects/u-maps/scraper/phase1-progress.json';

function generateGrid() {
  const cells = [];
  for (let lat = BOUNDS.minLat; lat < BOUNDS.maxLat; lat += GRID_STEP) {
    for (let lon = BOUNDS.minLon; lon < BOUNDS.maxLon; lon += GRID_STEP) {
      cells.push({
        lat: +(lat + GRID_STEP / 2).toFixed(4),
        lon: +(lon + GRID_STEP / 2).toFixed(4),
        spn: +(GRID_STEP / 2).toFixed(4),
      });
    }
  }
  return cells;
}

async function phase1() {
  const startTime = Date.now();
  const grid = generateGrid();

  // Oldingi natijalarni yuklash
  let allPois = [];
  const seenOrgIds = new Set();
  let completedKeys = new Set();

  if (fs.existsSync(OUTPUT)) {
    try {
      allPois = JSON.parse(fs.readFileSync(OUTPUT, 'utf-8'));
      allPois.forEach(p => { if (p.yandexOrgId) seenOrgIds.add(p.yandexOrgId); });
    } catch (e) {}
  }
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      completedKeys = new Set(JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf-8')).done || []);
    } catch (e) {}
  }

  console.log(`Grid: ${grid.length} katak | ${CATEGORIES.length} kategoriya | Jami: ${grid.length * CATEGORIES.length} query`);
  console.log(`Davom: ${allPois.length} POI, ${completedKeys.size} query bajarilgan\n`);

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
  let queryCount = 0;
  const totalQueries = grid.length * CATEGORIES.length - completedKeys.size;

  for (const cell of grid) {
    for (const cat of CATEGORIES) {
      const key = `${cell.lat},${cell.lon},${cat}`;
      if (completedKeys.has(key)) continue;

      queryCount++;
      const elapsed = Math.round((Date.now() - startTime) / 1000);
      const speed = queryCount > 1 ? (elapsed / (queryCount - 1)).toFixed(1) : '?';
      const eta = queryCount > 1 ? Math.round((totalQueries - queryCount) * (elapsed / (queryCount - 1)) / 60) : '?';

      if (queryCount % 10 === 1) {
        const pct = Math.round(queryCount / totalQueries * 100);
        console.log(`[${pct}%] ${queryCount}/${totalQueries} | ${allPois.length} POI (${seenOrgIds.size} unikal) | ${Math.floor(elapsed/60)}m | ETA: ~${eta}m`);
      }

      const url = `https://yandex.uz/maps/10335/tashkent/search/${encodeURIComponent(cat)}/?ll=${cell.lon}%2C${cell.lat}&spn=${cell.spn}%2C${cell.spn}&z=15`;

      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 12000 });
      } catch (e) {
        completedKeys.add(key);
        continue;
      }

      // Captcha
      const hasCaptcha = await page.$('.CheckboxCaptcha, [class*="Captcha"]');
      if (hasCaptcha) {
        console.log('  [!] CAPTCHA! Brauzerda yeching...');
        await page.waitForSelector('.search-business-snippet-view', { timeout: 120000 });
      }

      const hasResults = await page.waitForSelector('.search-business-snippet-view', { timeout: 4000 }).catch(() => null);
      if (!hasResults) {
        completedKeys.add(key);
        continue;
      }
      await page.waitForTimeout(800);

      // og:image dan koordinatalar
      const coords = await page.evaluate(() => {
        const og = document.querySelector('meta[property="og:image"]');
        if (!og) return [];
        const m = (og.getAttribute('content') || '').match(/pt=([^&]+)/);
        if (!m) return [];
        return decodeURIComponent(m[1]).split('~').map(p => {
          const [lon, lat] = p.split(',').map(Number);
          return (!isNaN(lon) && !isNaN(lat)) ? { lon, lat } : null;
        }).filter(Boolean);
      });

      // Scroll
      let prev = 0;
      for (let s = 0; s < MAX_SCROLL; s++) {
        await page.evaluate(() => {
          const c = document.querySelector('.scroll__container');
          if (c) c.scrollTop += 800;
        });
        await page.waitForTimeout(800);
        const n = await page.$$eval('.search-snippet-view', els => els.length);
        if (n === prev) break;
        prev = n;
      }

      // DOM dan barcha snippetlarni o'qish (CLICK YO'Q)
      const snippets = await page.$$eval('.search-snippet-view', (els) => {
        return els.map(el => {
          const biz = el.querySelector('.search-business-snippet-view');
          if (!biz) return null;
          const name = biz.querySelector('.search-business-snippet-view__title')?.textContent?.trim();
          if (!name) return null;

          // Org link dan orgId olish
          const link = el.querySelector('a[href*="/org/"]');
          const href = link?.getAttribute('href') || '';
          const orgMatch = href.match(/\/org\/([^/]+)/);
          const orgId = orgMatch ? orgMatch[1] : null;

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
            orgId,
          };
        }).filter(Boolean);
      });

      // Yangi POIlarni qo'shish
      let newCount = 0;
      for (let i = 0; i < snippets.length; i++) {
        const s = snippets[i];
        if (s.orgId && seenOrgIds.has(s.orgId)) continue;
        if (s.orgId) seenOrgIds.add(s.orgId);

        allPois.push({
          name: s.name,
          address: s.address,
          category: s.category,
          rating: s.rating,
          reviewCount: s.reviewCount,
          coordinates: coords[i] || null,
          yandexOrgId: s.orgId,
          yandexUrl: s.orgId ? `https://yandex.uz/maps/org/${s.orgId}/` : null,
          // Phase 2 da to'ldiriladi:
          phone: null,
          hours: null,
          website: null,
          socials: null,
          photos: null,
          subcategories: null,
        });
        newCount++;
      }

      completedKeys.add(key);

      // Har 20 queryda saqlash
      if (queryCount % 20 === 0) {
        fs.writeFileSync(OUTPUT, JSON.stringify(allPois, null, 2), 'utf-8');
        fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
          done: Array.from(completedKeys),
          totalPois: allPois.length,
          unique: seenOrgIds.size,
          ts: new Date().toISOString(),
        }), 'utf-8');
      }
    }
  }

  await browser.close();

  // Yakuniy saqlash
  fs.writeFileSync(OUTPUT, JSON.stringify(allPois, null, 2), 'utf-8');
  fs.writeFileSync(PROGRESS_FILE, JSON.stringify({
    done: Array.from(completedKeys),
    totalPois: allPois.length,
    unique: seenOrgIds.size,
    ts: new Date().toISOString(),
    completed: true,
  }), 'utf-8');

  const elapsed = Math.round((Date.now() - startTime) / 1000);
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  PHASE 1 TUGADI`);
  console.log(`  Vaqt:          ${Math.floor(elapsed / 60)} min ${elapsed % 60} sek`);
  console.log(`  Jami POI:      ${allPois.length} (${seenOrgIds.size} unikal)`);
  console.log(`  Koordinatalar: ${allPois.filter(p => p.coordinates).length}`);
  console.log(`  Querylar:      ${completedKeys.size}`);
  console.log(`  Saqlandi:      ${OUTPUT}`);
  console.log(`\n  Keyingi qadam: node phase2-details.js`);
  console.log('='.repeat(55));
}

phase1().catch(console.error);
