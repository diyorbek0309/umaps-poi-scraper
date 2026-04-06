const { chromium } = require('playwright');
const fs = require('fs');

// === KONFIGURATSIYA ===
const QUERIES = ['dorixona'];
const CITY = 'tashkent';
const CITY_ID = '10335';
const MAX_SCROLL = 3;
const OUTPUT = '/Users/diyorbek0309/Documents/Projects/u-maps/scraper/tashkent-pois.json';
const TIME_LIMIT_MS = 30 * 60 * 1000; // 30 daqiqa

async function scrapeYandexMaps() {
  const startTime = Date.now();

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
  const allPois = [];
  const seenOrgIds = new Set(); // Dublikatlarni oldini olish

  for (let qi = 0; qi < QUERIES.length; qi++) {
    const query = QUERIES[qi];
    const elapsed = Date.now() - startTime;
    if (elapsed > TIME_LIMIT_MS) {
      console.log(`\n⏰ 30 daqiqa tugadi! ${qi}/${QUERIES.length} query bajarildi.`);
      break;
    }

    const remaining = Math.round((TIME_LIMIT_MS - elapsed) / 60000);
    console.log(`\n=== [${qi + 1}/${QUERIES.length}] "${query}" | ${allPois.length} POI | ${remaining} min qoldi ===`);

    try {
      await page.goto(
        `https://yandex.uz/maps/${CITY_ID}/${CITY}/search/${encodeURIComponent(query)}/`,
        { waitUntil: 'domcontentloaded', timeout: 20000 }
      );
    } catch (e) {
      console.log(`  [!] Sahifa yuklanmadi, keyingisiga o'tamiz`);
      continue;
    }

    // Captcha
    const hasCaptcha = await page.$('.CheckboxCaptcha, [class*="Captcha"]');
    if (hasCaptcha) {
      console.log('  [!] CAPTCHA! Brauzerda yeching...');
      await page.waitForSelector('.search-business-snippet-view', { timeout: 120000 });
    }

    const hasResults = await page.waitForSelector('.search-business-snippet-view', { timeout: 8000 }).catch(() => null);
    if (!hasResults) {
      console.log('  [!] Natija topilmadi, keyingisiga o\'tamiz');
      continue;
    }
    await page.waitForTimeout(1500);

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
    for (let i = 0; i < MAX_SCROLL; i++) {
      await page.evaluate(() => {
        const list = document.querySelector('.scroll__container');
        if (list) list.scrollTop += 800;
      });
      await page.waitForTimeout(1200);
      const count = await page.$$eval('.search-snippet-view', els => els.length);
      if (count === prevCount) break;
      prevCount = count;
    }
    console.log(`  ${prevCount} ta snippet | ${markerCoords.length} marker`);

    // Har bir snippet
    const snippetCount = await page.$$eval('.search-snippet-view', els => els.length);

    for (let i = 0; i < snippetCount; i++) {
      // Vaqt tekshiruvi
      if (Date.now() - startTime > TIME_LIMIT_MS) break;

      try {
        const snippets = await page.$$('.search-snippet-view');
        if (i >= snippets.length) break;

        // DOM dan asosiy ma'lumot + galeriya
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
            hours: biz.querySelector('.business-working-status-view')?.textContent?.trim() || null,
            photos,
          };
        });

        if (!domData) continue;

        // Click → detail sahifa
        await snippets[i].click();
        await page.waitForTimeout(1200);

        const orgUrl = page.url();
        const orgMatch = orgUrl.match(/\/org\/([^/]+)/);
        const orgId = orgMatch ? orgMatch[1] : null;

        // Dublikat tekshiruvi
        if (orgId && seenOrgIds.has(orgId)) {
          await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
          await page.waitForTimeout(500);
          continue;
        }
        if (orgId) seenOrgIds.add(orgId);

        // "Jadval" tugmasini bosib haftalik ish vaqtini ochish
        const jadvalBtn = await page.$('text=Jadval');
        if (jadvalBtn) {
          await jadvalBtn.click();
          await page.waitForTimeout(600);
        }

        // Detail sahifadan barcha ma'lumot
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
          const mainCategory = bcTexts.length >= 3 ? bcTexts[2] : null; // [Yandex Maps, Toshkent, Kategoriya]

          // O'ziga xos jihatlari (features)
          const featEls = document.querySelectorAll('.orgpage-features-view__item, .business-features-view__text');
          let features = Array.from(featEls).map(el => el.textContent?.trim()).filter(Boolean);
          // Agar bo'sh bo'lsa, "O'ziga xos jihatlari" section ichidan olish
          if (features.length === 0) {
            const section = document.querySelector('.orgpage-categories-info-view');
            if (section) {
              const nextSibling = section.parentElement;
              // section matnidan o'qish
            }
          }

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

          // Haftalik ish vaqti jadvali
          const scheduleItems = document.querySelectorAll('.business-working-intervals-view__item');
          const workingHours = Array.from(scheduleItems).map(item => {
            const day = item.querySelector('.business-working-intervals-view__day')?.textContent?.trim();
            const interval = item.querySelector('.business-working-intervals-view__interval')?.textContent?.trim();
            return day && interval ? { day, hours: interval } : null;
          }).filter(Boolean);

          // Qo'shimcha rasmlar
          const photoEls = document.querySelectorAll('.search-snippet-gallery-view__item img, .media-wrapper img');
          const photos = Array.from(photoEls)
            .map(img => (img.getAttribute('src') || '').replace(/\d+x\d+/, '600x400'))
            .filter(s => s.startsWith('http'));

          return { phones, website, subcategories, mainCategory, features, socials, photos, workingHours };
        });

        // Rasmlarni birlashtirish
        const allPhotos = [...new Set([...domData.photos, ...detail.photos])];
        const coords = markerCoords[i] || null;

        const poi = {
          name: domData.name,
          address: domData.address,
          category: detail.mainCategory || domData.category,
          subcategories: detail.subcategories.length > 0 ? detail.subcategories : null,
          rating: domData.rating,
          reviewCount: domData.reviewCount,
          hours: detail.workingHours.length > 0 ? detail.workingHours : domData.hours,
          phone: detail.phones.length > 0 ? detail.phones : null,
          website: detail.website,
          socials: detail.socials.length > 0 ? detail.socials : null,
          features: detail.features.length > 0 ? detail.features : null,
          photos: allPhotos.length > 0 ? allPhotos : null,
          coordinates: coords,
          yandexOrgId: orgId,
          yandexUrl: orgId ? `https://yandex.uz/maps/org/${orgId}/` : null,
          query,
        };

        allPois.push(poi);
        const coordStr = coords ? `✓` : '?';
        const photoStr = allPhotos.length > 0 ? `${allPhotos.length}p` : '-';
        const socialStr = detail.socials.length > 0 ? `${detail.socials.length}s` : '-';
        console.log(`  ${allPois.length}. ${poi.name} | ${coordStr} | ${detail.phones[0] || '-'} | ${photoStr} | ${socialStr}`);

        // Ortga
        await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => {});
        await page.waitForSelector('.search-business-snippet-view', { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(600);

      } catch (err) {
        console.log(`  [!] Xato: ${err.message.substring(0, 60)}`);
        try {
          await page.goto(
            `https://yandex.uz/maps/${CITY_ID}/${CITY}/search/${encodeURIComponent(query)}/`,
            { waitUntil: 'domcontentloaded', timeout: 15000 }
          );
          await page.waitForTimeout(2000);
        } catch (e) {}
      }
    }

    // Har bir query dan keyin saqlash (xavfsizlik uchun)
    fs.writeFileSync(OUTPUT, JSON.stringify(allPois, null, 2), 'utf-8');
  }

  await browser.close();

  // === YAKUNIY STATISTIKA ===
  const elapsed = Math.round((Date.now() - startTime) / 1000);
  const stats = {
    total: allPois.length,
    unique: seenOrgIds.size,
    withCoords: allPois.filter(p => p.coordinates).length,
    withPhone: allPois.filter(p => p.phone?.length).length,
    withPhotos: allPois.filter(p => p.photos?.length).length,
    withSocials: allPois.filter(p => p.socials?.length).length,
    withFeatures: allPois.filter(p => p.features?.length).length,
    withSubcats: allPois.filter(p => p.subcategories?.length).length,
    totalPhotos: allPois.reduce((s, p) => s + (p.photos?.length || 0), 0),
    categories: [...new Set(allPois.map(p => p.category).filter(Boolean))].length,
  };

  console.log(`\n${'='.repeat(55)}`);
  console.log(`  Vaqt:              ${Math.floor(elapsed / 60)} min ${elapsed % 60} sek`);
  console.log(`  Jami POI:          ${stats.total} (${stats.unique} unikal)`);
  console.log(`  Koordinatalari:    ${stats.withCoords}`);
  console.log(`  Telefon:           ${stats.withPhone}`);
  console.log(`  Rasmlar:           ${stats.withPhotos} POI (jami ${stats.totalPhotos} ta)`);
  console.log(`  Ijtimoiy:          ${stats.withSocials}`);
  console.log(`  O'ziga xos:        ${stats.withFeatures}`);
  console.log(`  Subkategoriya:     ${stats.withSubcats}`);
  console.log(`  Kategoriyalar:     ${stats.categories} xil`);
  console.log(`  Saqlandi:          ${OUTPUT}`);
  console.log('='.repeat(55));
}

scrapeYandexMaps().catch(console.error);
