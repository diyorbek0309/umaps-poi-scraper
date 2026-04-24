/**
 * Yandex POI Details Scraper — Phase 2
 * Grid scraperdan keyin har bir POI ning to'liq ma'lumotini oladi:
 * - Telefon (formatli)
 * - Ish vaqti (haftalik)
 * - Reyting (5 ball + count)
 * - Rasm URL lari (avatars.mds.yandex.net)
 * - Ijtimoiy tarmoqlar (Telegram, Facebook, Instagram)
 * - Xususiyatlar (features: open_24h, delivery, wifi, etc.)
 * - Kategoriyalar (Yandex seoname)
 * - Tarmoq (chain) — agar bor bo'lsa
 *
 * Ishlatish:
 *   node details-scraper.js <preset>-<viloyat>
 *   node details-scraper.js atm-toshkent_sh
 *   node details-scraper.js all                    — barcha grid fayllar
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { createSession, loadSession, getHeaders } = require('./session');

const TARGET = process.argv[2] || 'all';

let HEADERS = {};
let reqCount = 0;
let errorCount = 0;

class CaptchaError extends Error {
  constructor() { super('captcha'); this.name = 'CaptchaError'; }
}

function get(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        res.resume();
        const loc = res.headers.location || '';
        if (loc.includes('showcaptcha') || loc.includes('captcha')) {
          return reject(new CaptchaError());
        }
        const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
        return get(next).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(20000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractItem(html) {
  const m = html.match(/<script[^>]*class="state-view"[^>]*>([\s\S]+?)<\/script>/);
  if (!m) return null;
  try {
    const d = JSON.parse(m[1]);
    return d?.stack?.[0]?.results?.items?.[0] || null;
  } catch {
    return null;
  }
}

// %s template ni real URL ga aylantirish (orig = original size)
function expandPhotoUrl(template, size = 'orig') {
  return template?.replace('%s', size);
}

// Yandex workingTime → "Mo-Fr 09:00-19:00, Sa 10:00-18:00"
function formatWorkingTime(wt) {
  if (!Array.isArray(wt)) return '';
  const days = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
  const result = [];
  for (let i = 0; i < wt.length; i++) {
    const day = wt[i];
    if (!day || !day.length) {
      result.push(`${days[i]} closed`);
    } else {
      const slots = day.map(s => {
        const f = `${String(s.from.hours).padStart(2, '0')}:${String(s.from.minutes || 0).padStart(2, '0')}`;
        const t = `${String(s.to.hours).padStart(2, '0')}:${String(s.to.minutes || 0).padStart(2, '0')}`;
        return `${f}-${t}`;
      });
      result.push(`${days[i]} ${slots.join(',')}`);
    }
  }
  return result.join('; ');
}

function normalizePhones(phones) {
  if (!Array.isArray(phones)) return [];
  return phones.map(p => ({
    value: p.value || p.number,
    formatted: p.number,
    type: p.type || 'phone',
  }));
}

function normalizeFeatures(features) {
  if (!Array.isArray(features)) return [];
  return features.map(f => ({
    id: f.id,
    name: f.name,
    type: f.type,
    important: !!f.important,
    value: f.type === 'bool' ? f.value : (Array.isArray(f.value) ? f.value.map(v => v.id || v.name) : f.value),
  }));
}

function enrichPOI(basePoi, item) {
  if (!item) return null;
  return {
    ...basePoi,
    name: item.title || basePoi.name,
    address: item.fullAddress || item.address || basePoi.address,
    phones: normalizePhones(item.phones),
    workingHours: item.workingTimeText || formatWorkingTime(item.workingTime) || basePoi.workingHours,
    workingTimeRaw: item.workingTime || null,
    rating: item.ratingData?.ratingValue ?? basePoi.rating,
    ratingCount: item.ratingData?.ratingCount || 0,
    reviewCount: item.ratingData?.reviewCount || basePoi.reviewCount || 0,
    websites: item.urls || (basePoi.website ? [basePoi.website] : []),
    socialLinks: (item.socialLinks || []).map(s => ({
      type: s.type,
      url: s.href,
      handle: s.readableHref,
    })),
    photos: (item.photos?.items || []).map(p => ({
      orig: expandPhotoUrl(p.urlTemplate, 'orig'),
      large: expandPhotoUrl(p.urlTemplate, 'XXL'),
      thumb: expandPhotoUrl(p.urlTemplate, 'M'),
      alt: p.alt,
    })),
    photosCount: item.photos?.count || 0,
    logo: expandPhotoUrl(item.businessImages?.logo?.urlTemplate, 'XXL'),
    yandexCategories: (item.categories || []).map(c => ({
      id: c.id,
      name: c.name,
      seoname: c.seoname,
      class: c.class,
    })),
    features: normalizeFeatures(item.features),
    featureGroups: item.featureGroups || [],
    chain: item.chain ? {
      id: item.chain.id,
      name: item.chain.name,
      seoname: item.chain.seoname,
      cityCount: item.chain.quantityInCity,
    } : null,
    businessProperties: item.businessProperties || {},
    verified: !!item.businessProperties?.has_verified_owner,
    _detailedAt: new Date().toISOString(),
    _source: 'yandex-detail',
  };
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function fetchDetails(yandexId) {
  const url = `https://yandex.uz/maps/org/${yandexId}/`;
  reqCount++;
  const { status, body } = await get(url);
  if (status !== 200) return null;
  return extractItem(body);
}

async function processFile(gridFile) {
  const baseName = path.basename(gridFile, '.json'); // e.g. atm-toshkent_sh-grid
  const outFile = gridFile.replace('-grid.json', '-detailed.json');
  const progressFile = gridFile.replace('-grid.json', '-detailed-progress.json');

  const pois = JSON.parse(fs.readFileSync(gridFile));
  let detailed = [];
  let doneIds = new Set();

  if (fs.existsSync(progressFile)) {
    const p = JSON.parse(fs.readFileSync(progressFile));
    doneIds = new Set(p.done);
    detailed = JSON.parse(fs.existsSync(outFile) ? fs.readFileSync(outFile) : '[]');
    console.log(`♻️  Resume: ${doneIds.size} tugagan, ${detailed.length} detail saqlangan`);
  }

  const todo = pois.filter(p => p.yandexId && !doneIds.has(p.yandexId));
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  FAYL: ${baseName}`);
  console.log(`  Jami POI: ${pois.length} | Tugagan: ${doneIds.size} | Qoldi: ${todo.length}`);
  console.log(`${'='.repeat(55)}\n`);

  const t0 = Date.now();
  for (let i = 0; i < todo.length; i++) {
    const poi = todo[i];
    const idx = i + 1;
    const t = Date.now();

    let attempt = 0;
    while (true) {
      attempt++;
      try {
        const item = await fetchDetails(poi.yandexId);
        if (item) {
          const enriched = enrichPOI(poi, item);
          detailed.push(enriched);
          doneIds.add(poi.yandexId);
          const ms = Date.now() - t;
          const tag = enriched.photos.length ? `📷${enriched.photos.length}` : '';
          const phoneTag = enriched.phones.length ? '📞' : '';
          const socialTag = enriched.socialLinks.length ? '🔗' : '';
          console.log(`[${idx}/${todo.length}] ${poi.name?.substring(0, 40)} → ${ms}ms ${phoneTag}${tag}${socialTag}`);
        } else {
          console.log(`[${idx}/${todo.length}] ⚠️  ${poi.name?.substring(0, 40)} → state-view yo'q, skip`);
          doneIds.add(poi.yandexId);
        }
        break;
      } catch (e) {
        if (e.name === 'CaptchaError') {
          console.log('\n' + '='.repeat(55));
          console.log('  ⚠️  CAPTCHA! Session muddati tugadi.');
          console.log('  Progress saqlandi. Davom etish uchun:');
          console.log('    1. node session.js');
          console.log(`    2. node details-scraper.js ${TARGET}`);
          console.log('='.repeat(55) + '\n');
          fs.writeFileSync(outFile, JSON.stringify(detailed, null, 2));
          fs.writeFileSync(progressFile, JSON.stringify({ done: [...doneIds] }));
          process.exit(0);
        }
        errorCount++;
        if (attempt >= 3) {
          console.log(`[${idx}/${todo.length}] ❌ ${poi.name?.substring(0, 40)} — 3 urinish muvaffaqiyatsiz`);
          break;
        }
        console.log(`[${idx}/${todo.length}] ⚠️  ${e.message} — retry ${attempt}`);
        await sleep(2000);
      }
    }

    // Har 5 POIda fayl saqlash
    if (idx % 5 === 0 || idx === todo.length) {
      fs.writeFileSync(outFile, JSON.stringify(detailed, null, 2));
      fs.writeFileSync(progressFile, JSON.stringify({ done: [...doneIds] }));
    }

    await sleep(300 + Math.random() * 200);
  }

  fs.writeFileSync(outFile, JSON.stringify(detailed, null, 2));
  fs.writeFileSync(progressFile, JSON.stringify({ done: [...doneIds] }));

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  ✅ TUGADI: ${baseName}`);
  console.log(`  Vaqt: ${elapsed}s | Requestlar: ${reqCount} | Xato: ${errorCount}`);
  console.log(`  Saqlandi: ${outFile}`);
  console.log(`${'='.repeat(55)}\n`);
}

async function main() {
  let cookies = loadSession();
  if (!cookies) {
    console.log('Session topilmadi — yangi session yaratilmoqda...');
    cookies = await createSession();
  } else {
    console.log('✅ Session yuklandi');
  }
  HEADERS = getHeaders(cookies);

  const dataDir = path.join(__dirname, 'data');
  let files = [];

  if (TARGET === 'all') {
    files = fs.readdirSync(dataDir)
      .filter(f => f.endsWith('-grid.json'))
      .map(f => path.join(dataDir, f));
  } else {
    const f = path.join(dataDir, `${TARGET}-grid.json`);
    if (!fs.existsSync(f)) {
      console.log(`Fayl topilmadi: ${f}`);
      console.log('Mavjud grid fayllar:');
      fs.readdirSync(dataDir)
        .filter(x => x.endsWith('-grid.json'))
        .forEach(x => console.log('  ' + x.replace('-grid.json', '')));
      process.exit(1);
    }
    files = [f];
  }

  if (!files.length) {
    console.log('Grid fayllar topilmadi. Avval grid-scraper ishlating.');
    process.exit(1);
  }

  console.log(`📦 ${files.length} ta fayl boshqariladi`);
  for (const f of files) {
    await processFile(f);
  }

  console.log('\n🎉 BARCHA TUGADI!');
}

main().catch(console.error);
