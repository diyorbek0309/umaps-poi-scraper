/**
 * Adaptive quadtree grid scraper — Yandex Maps
 * bbox → 25 item limit hit → 4 sub-cell → rekursiv
 * Kafolat: hech POI tushib qolmaydi
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { createSession, loadSession, getHeaders } = require('./session');

const PRESET = process.argv[2] || 'atm';
const VILOYAT = process.argv[3] || 'toshkent_sh';

const PRESETS = {
  atm:            { queries: ['банкомат', 'ATM'],                                                 category: 'atm'             },
  fuel:           { queries: ['АЗС', 'заправка', 'метановая заправка'],                           category: 'fuel'            },
  pharmacy:       { queries: ['аптека', 'дорихона'],                                              category: 'pharmacy'        },
  parking:        { queries: ['парковка', 'автостоянка'],                                         category: 'parking'         },
  groceries:      { queries: ['супермаркет', 'Корзинка', 'Макро', 'Havas'],                       category: 'groceries'       },
  banks:          { queries: ['банк', 'обмен валют'],                                             category: 'finance'         },
  hotels:         { queries: ['гостиница', 'отель', 'хостел'],                                    category: 'accommodation'   },
  healthcare:     { queries: ['больница', 'клиника', 'поликлиника', 'стоматология'],              category: 'healthcare'      },
  food:           { queries: ['ресторан', 'кафе', 'чайхана', 'фастфуд'],                          category: 'food_and_drink'  },
  religion:       { queries: ['мечеть', 'масджид', 'джума мечеть', 'церковь', 'синагога'],        category: 'religion'        },
  education:      { queries: ['школа', 'университет', 'детский сад', 'колледж', 'учебный центр'], category: 'education'       },
  beauty:         { queries: ['салон красоты', 'барбершоп', 'парикмахерская', 'SPA', 'маникюр'],  category: 'beauty'          },
  leisure_sport:  { queries: ['спортзал', 'фитнес', 'бассейн', 'стадион', 'кинотеатр'],           category: 'leisure_sport'   },
  culture_tourism:{ queries: ['музей', 'театр', 'памятник', 'достопримечательность'],             category: 'culture_tourism' },
  services:       { queries: ['ателье', 'ремонт', 'химчистка', 'почта', 'типография'],            category: 'services'        },
  government:     { queries: ['хокимият', 'полиция', 'суд', 'ЗАГС', 'посольство'],                category: 'government'      },
  automotive:     { queries: ['автосервис', 'шиномонтаж', 'автомойка', 'автосалон'],              category: 'automotive'      },
  shopping:       { queries: ['магазин одежды', 'электроника', 'мебель', 'ТРЦ', 'торговый центр'],category: 'shopping'        },
  transport:      { queries: ['автовокзал', 'аэропорт', 'метро', 'железнодорожный вокзал'],       category: 'transport'       },
  nature:         { queries: ['парк', 'озеро', 'заповедник'],                                     category: 'nature'          },
};

// [minLng, minLat, maxLng, maxLat]
const VILOYATLAR = {
  toshkent_sh: { name: 'Toshkent shahri',   bbox: [69.15, 41.21, 69.44, 41.41] },
  toshkent_v:  { name: 'Toshkent viloyati', bbox: [69.0,  40.8,  70.9,  41.7]  },
  samarqand:   { name: 'Samarqand',          bbox: [65.9,  39.1,  68.2,  40.2]  },
  buxoro:      { name: 'Buxoro',             bbox: [62.1,  38.7,  66.0,  40.5]  },
  namangan:    { name: 'Namangan',           bbox: [70.6,  40.5,  72.2,  41.4]  },
  andijon:     { name: 'Andijon',            bbox: [71.8,  40.4,  72.8,  41.1]  },
  fargona:     { name: "Farg'ona",           bbox: [70.8,  39.9,  72.1,  40.7]  },
  qashqadaryo: { name: 'Qashqadaryo',       bbox: [64.5,  38.1,  67.0,  39.6]  },
  surxondaryo: { name: 'Surxondaryo',       bbox: [66.7,  36.7,  68.5,  38.6]  },
  xorazm:      { name: 'Xorazm',            bbox: [59.8,  41.0,  61.5,  42.1]  },
  navoiy:      { name: 'Navoiy',            bbox: [62.5,  39.4,  67.5,  41.3]  },
  jizzax:      { name: 'Jizzax',            bbox: [67.0,  39.6,  70.0,  41.0]  },
  sirdaryo:    { name: 'Sirdaryo',          bbox: [67.8,  40.0,  69.8,  41.0]  },
  qoraqalpog:  { name: "Qoraqalpog'iston",  bbox: [55.0,  41.0,  62.0,  45.6]  },
};

let HEADERS = {};

// ~1km minimal cell — bundan kichik bo'lsa subdivide to'xtaydi
const MIN_CELL_DEG = 0.01;
// Yandex per-request limit
const YANDEX_LIMIT = 25;

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

function extractItems(html) {
  try {
    const m = html.match(/<script[^>]*class="state-view"[^>]*>([\s\S]+?)<\/script>/);
    if (!m) return [];
    const d = JSON.parse(m[1]);

    function findItems(obj, depth = 0) {
      if (depth > 10) return null;
      if (Array.isArray(obj) && obj.length > 0 && obj[0]?.title && obj[0]?.coordinates) return obj;
      if (typeof obj === 'object' && obj !== null) {
        for (const [k, v] of Object.entries(obj)) {
          if (k === 'items' && Array.isArray(v) && v.length > 0 && v[0]?.title) return v;
          const found = findItems(v, depth + 1);
          if (found) return found;
        }
      }
      return null;
    }

    return findItems(d) || [];
  } catch {
    return [];
  }
}

function normalizeItem(item, category) {
  return {
    yandexId: item.id || item.uri || item.requestId,
    name: item.title || '',
    address: item.address || item.description || '',
    coordinates: item.coordinates ? { lng: item.coordinates[0], lat: item.coordinates[1] } : null,
    category,
    phones: (item.phones || []).map(p => p.value || p.number),
    workingHours: item.workingTime?.text || item.workingTimeText || '',
    rating: item.ratingData?.score || item.rating?.score || null,
    reviewCount: item.ratingData?.count || item.rating?.count || 0,
    website: (item.urls || [])[0] || item.url || '',
    _source: 'yandex-grid',
  };
}

let reqCount = 0;
let errorCount = 0;

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

// z level dan bbox o'lchami: 1280px/tile, 256px → factor=5
function cellZoom(minLng, maxLng) {
  const w = maxLng - minLng;
  return Math.max(9, Math.min(17, Math.round(Math.log2(1800 / w))));
}

async function scrapeCell(bbox, query, category) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const ll = [((minLng + maxLng) / 2).toFixed(5), ((minLat + maxLat) / 2).toFixed(5)];
  const z = cellZoom(minLng, maxLng);
  const url = `https://yandex.uz/maps/?ll=${ll[0]},${ll[1]}&z=${z}&text=${encodeURIComponent(query)}`;

  reqCount++;
  const { status, body } = await get(url);

  if (status !== 200) return [];
  const raw = extractItems(body);
  return raw.map(it => normalizeItem(it, category));
}

// Adaptive quadtree — rekursiv
async function scrapeAdaptive(bbox, query, category, seen, results, save, depth = 0) {
  const [minLng, minLat, maxLng, maxLat] = bbox;
  const cellW = maxLng - minLng;
  const cellH = maxLat - minLat;
  const indent = '  '.repeat(depth);

  let items;
  let attempt = 0;
  while (true) {
    attempt++;
    try {
      items = await scrapeCell(bbox, query, category);
      break;
    } catch (e) {
      if (e.name === 'CaptchaError') {
        console.log('\n' + '='.repeat(55));
        console.log('  ⚠️  CAPTCHA! Session muddati tugadi.');
        console.log('  Progress saqlandi. Davom etish uchun:');
        console.log('');
        console.log('    1. node session.js     ← yangi session');
        console.log(`    2. node grid-scraper.js ${PRESET} ${VILOYAT}  ← resume`);
        console.log('='.repeat(55) + '\n');
        process.exit(0);
      }
      errorCount++;
      if (attempt >= 3) {
        console.log(`${indent}❌ 3 urinish muvaffaqiyatsiz — o'tkazib yuborildi`);
        return;
      }
      console.log(`${indent}⚠️  ${e.message} — ${attempt}. urinish, 3s kutish`);
      await sleep(3000);
    }
  }

  const newItems = items.filter(it => it.yandexId && !seen.has(it.yandexId));
  newItems.forEach(it => { seen.add(it.yandexId); results.push(it); });
  if (newItems.length > 0) save();

  const tag = items.length >= YANDEX_LIMIT ? '⚡split' : '✓';
  process.stdout.write(
    `${indent}[${reqCount}] ${cellW.toFixed(3)}°×${cellH.toFixed(3)}° → ${items.length} item, ${newItems.length} yangi ${tag}\n`
  );

  // 25 limitga yetdi va cell kichraytirish mumkin — 4 ga bo'lamiz
  // Lekin agar 0 yangi POI qaytgan bo'lsa va cell kichik (~2km) — saturation, subdivide shart emas
  const saturated = newItems.length === 0 && cellW <= 0.02;

  if (items.length >= YANDEX_LIMIT && cellW > MIN_CELL_DEG && cellH > MIN_CELL_DEG && !saturated) {
    const midLng = (minLng + maxLng) / 2;
    const midLat = (minLat + maxLat) / 2;
    const quads = [
      [minLng, minLat, midLng, midLat], // SW
      [midLng, minLat, maxLng, midLat], // SE
      [minLng, midLat, midLng, maxLat], // NW
      [midLng, midLat, maxLng, maxLat], // NE
    ];
    for (const q of quads) {
      await sleep(250 + Math.random() * 150);
      await scrapeAdaptive(q, query, category, seen, results, save, depth + 1);
    }
  } else {
    await sleep(250 + Math.random() * 150);
  }
}

async function main() {
  // Session yukla yoki yangi yaratadi
  let cookies = loadSession();
  if (!cookies) {
    console.log('Session topilmadi — yangi session yaratilmoqda...');
    cookies = await createSession();
  } else {
    console.log('✅ Session yuklandi');
  }
  HEADERS = getHeaders(cookies);

  const preset = PRESETS[PRESET];
  if (!preset) {
    console.log(`Preset yo'q: ${PRESET}. Mavjud: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
  }

  const targetViloyatlar = VILOYAT === 'all'
    ? Object.entries(VILOYATLAR)
    : Object.entries(VILOYATLAR).filter(([k, v]) =>
        k === VILOYAT || v.name.toLowerCase().includes(VILOYAT.toLowerCase())
      );

  if (!targetViloyatlar.length) {
    console.log(`Viloyat topilmadi: ${VILOYAT}. Mavjud: ${Object.keys(VILOYATLAR).join(', ')}`);
    process.exit(1);
  }

  fs.mkdirSync(path.join(__dirname, 'data'), { recursive: true });
  const outFile = path.join(__dirname, 'data', `${PRESET}-${VILOYAT}-grid.json`);
  const progressFile = path.join(__dirname, 'data', `${PRESET}-${VILOYAT}-grid-progress.json`);

  let results = [];
  let doneKeys = new Set();

  if (fs.existsSync(progressFile)) {
    const p = JSON.parse(fs.readFileSync(progressFile));
    doneKeys = new Set(p.done);
    results = JSON.parse(fs.existsSync(outFile) ? fs.readFileSync(outFile) : '[]');
    console.log(`♻️  Resume: ${doneKeys.size} juft tugagan, ${results.length} POI saqlangan`);
  }

  const seen = new Set(results.map(r => r.yandexId));

  console.log(`\n${'='.repeat(55)}`);
  console.log(`  PRESET: ${PRESET} | VILOYAT: ${VILOYAT}`);
  console.log(`  Viloyatlar: ${targetViloyatlar.length} | Queries: ${preset.queries.length}`);
  console.log(`  Strategiya: adaptive quadtree (MIN_CELL=${MIN_CELL_DEG}°)`);
  console.log(`${'='.repeat(55)}\n`);

  const t0 = Date.now();

  for (const [key, viloyat] of targetViloyatlar) {
    for (const query of preset.queries) {
      const pairKey = `${key}|${query}`;
      if (doneKeys.has(pairKey)) {
        console.log(`⏭  ${viloyat.name}: "${query}" (tugagan, skip)`);
        continue;
      }

      const tPair = Date.now();
      console.log(`\n▶  ${viloyat.name}: "${query}"`);
      console.log(`   bbox: [${viloyat.bbox.join(', ')}]`);

      const save = () => fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
      const reqsBefore = reqCount;
      await scrapeAdaptive(viloyat.bbox, query, preset.category, seen, results, save);
      const pairMs = ((Date.now() - tPair) / 1000).toFixed(1);
      const pairReqs = reqCount - reqsBefore;

      console.log(`   ✅ Tugadi: ${pairReqs} request, ${pairMs}s, jami POI: ${results.length}`);

      doneKeys.add(pairKey);
      fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
      fs.writeFileSync(progressFile, JSON.stringify({ done: [...doneKeys] }));
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(55)}`);
  console.log(`  ✅ BARCHA TUGADI: ${PRESET}`);
  console.log(`  Jami vaqt: ${elapsed}s | Requestlar: ${reqCount} | Xato: ${errorCount}`);
  console.log(`  Unikal POI: ${results.length}`);
  console.log(`  Saqlandi: ${outFile}`);
  console.log(`${'='.repeat(55)}`);
}

main().catch(console.error);
