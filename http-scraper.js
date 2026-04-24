/**
 * HTTP-based Yandex Maps scraper — browsersiz
 * SSR dan POI data olish: ~50-100ms/request vs 5-10s browser
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const PRESET = process.argv[2] || 'atm';
const VILOYAT = process.argv[3] || 'all'; // viloyat nomi yoki 'all'

const PRESETS = {
  atm:      { queries: ['банкомат', 'ATM'], category: 'atm' },
  fuel:     { queries: ['АЗС', 'заправка', 'метановая заправка'], category: 'fuel' },
  pharmacy: { queries: ['аптека', 'дорихона'], category: 'pharmacy' },
  parking:  { queries: ['парковка', 'автостоянка'], category: 'parking' },
  groceries:{ queries: ['супермаркет', 'Корзинка', 'Макро', 'Havas'], category: 'groceries' },
  banks:    { queries: ['банк', 'обмен валют'], category: 'finance' },
  hotels:   { queries: ['гостиница', 'отель', 'хостел'], category: 'accommodation' },
  healthcare:{ queries: ['больница', 'клиника', 'поликлиника'], category: 'healthcare' },
  food:     { queries: ['ресторан', 'кафе', 'чайхана'], category: 'food_and_drink' },
  religion: { queries: ['мечеть', 'масджид', 'джума мечеть', 'церковь', 'синагога'], category: 'religion' },
};

// Viloyatlar bo'yicha taqsimlash
const VILOYATLAR = {
  toshkent_sh: { name: 'Toshkent shahri',   ll: '69.2797,41.3111', bbox: [69.15,41.21,69.44,41.41] },
  toshkent_v:  { name: 'Toshkent viloyati', ll: '69.8,41.2',       bbox: [69.0,40.8,70.9,41.7]  },
  samarqand:   { name: 'Samarqand',          ll: '66.9597,39.6542', bbox: [65.9,39.1,68.2,40.2]  },
  buxoro:      { name: 'Buxoro',             ll: '64.4211,39.7745', bbox: [62.1,38.7,66.0,40.5]  },
  namangan:    { name: 'Namangan',           ll: '71.6726,40.9983', bbox: [70.6,40.5,72.2,41.4]  },
  andijon:     { name: 'Andijon',            ll: '72.3440,40.7821', bbox: [71.8,40.4,72.8,41.1]  },
  fargona:     { name: "Farg'ona",           ll: '71.7910,40.3834', bbox: [70.8,39.9,72.1,40.7]  },
  qashqadaryo: { name: 'Qashqadaryo',       ll: '65.7989,38.8521', bbox: [64.5,38.1,67.0,39.6]  },
  surxondaryo: { name: 'Surxondaryo',       ll: '67.2784,37.2241', bbox: [66.7,36.7,68.5,38.6]  },
  xorazm:      { name: 'Xorazm',            ll: '60.6348,41.5513', bbox: [59.8,41.0,61.5,42.1]  },
  navoiy:      { name: 'Navoiy',            ll: '65.3792,40.1034', bbox: [62.5,39.4,67.5,41.3]  },
  jizzax:      { name: 'Jizzax',            ll: '67.8422,40.1158', bbox: [67.0,39.6,70.0,41.0]  },
  sirdaryo:    { name: 'Sirdaryo',          ll: '68.7842,40.4897', bbox: [67.8,40.0,69.8,41.0]  },
  qoraqalpog:  { name: "Qoraqalpog'iston",  ll: '59.6035,42.4628', bbox: [55.0,41.0,62.0,45.6]  },
};

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'ru-RU,ru;q=0.9,en;q=0.8',
  'Accept-Encoding': 'identity',
};

function get(url, redirects = 0) {
  if (redirects > 3) return Promise.reject(new Error('too many redirects'));
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: HEADERS }, (res) => {
      if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307) {
        res.resume();
        const loc = res.headers.location;
        if (!loc) return reject(new Error('redirect without location'));
        const next = loc.startsWith('http') ? loc : new URL(loc, url).toString();
        return get(next, redirects + 1).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.setTimeout(15000, () => { req.destroy(); reject(new Error('timeout')); });
  });
}

function extractItems(html) {
  try {
    const jsonBlobs = html.match(/<script[^>]*class="state-view"[^>]*>([\s\S]+?)<\/script>/);
    if (!jsonBlobs) return [];
    const d = JSON.parse(jsonBlobs[1]);

    function findItems(obj, depth = 0) {
      if (depth > 8) return null;
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
    workingHours: item.workingTime?.text || '',
    rating: item.rating?.score || null,
    reviewCount: item.rating?.count || 0,
    website: item.url || '',
    _source: 'yandex-http',
  };
}

async function scrapeCity(ll, query, category) {
  const url = `https://yandex.uz/maps/?ll=${ll}&z=13&text=${encodeURIComponent(query)}`;
  const { status, body } = await get(url);
  if (status !== 200) return [];
  const items = extractItems(body);
  return items.map(it => normalizeItem(it, category));
}

async function main() {
  const preset = PRESETS[PRESET];
  if (!preset) {
    console.log(`Preset yo'q: ${PRESET}. Mavjud: ${Object.keys(PRESETS).join(', ')}`);
    process.exit(1);
  }

  const targetViloyatlar = VILOYAT === 'all'
    ? Object.values(VILOYATLAR)
    : Object.entries(VILOYATLAR)
        .filter(([k, v]) => k === VILOYAT || v.name.toLowerCase().includes(VILOYAT.toLowerCase()))
        .map(([, v]) => v);

  if (!targetViloyatlar.length) {
    console.log(`Viloyat topilmadi: ${VILOYAT}`);
    process.exit(1);
  }

  const outFile = path.join(__dirname, 'data', `${PRESET}-${VILOYAT}-http.json`);
  const progressFile = path.join(__dirname, 'data', `${PRESET}-${VILOYAT}-http-progress.json`);

  let results = [];
  let done = new Set();
  if (fs.existsSync(progressFile)) {
    const p = JSON.parse(fs.readFileSync(progressFile));
    done = new Set(p.done);
    results = JSON.parse(fs.existsSync(outFile) ? fs.readFileSync(outFile) : '[]');
    console.log(`♻️  Resume: ${done.size} tugagan, ${results.length} POI saqlangan`);
  }

  const seen = new Set(results.map(r => r.yandexId));
  const total = targetViloyatlar.length * preset.queries.length;
  let idx = 0;
  const t0 = Date.now();

  console.log(`\n${'='.repeat(50)}`);
  console.log(`  PRESET: ${PRESET} | VILOYAT: ${VILOYAT}`);
  console.log(`  Viloyatlar: ${targetViloyatlar.length} | Queries: ${preset.queries.length}`);
  console.log(`  Jami requests: ${total}`);
  console.log(`${'='.repeat(50)}\n`);

  for (const viloyat of targetViloyatlar) {
    for (const query of preset.queries) {
      idx++;
      const key = `${viloyat.name}|${query}`;
      if (done.has(key)) {
        console.log(`[${idx}/${total}] ⏭  ${viloyat.name}: "${query}" (skip)`);
        continue;
      }

      const t = Date.now();
      try {
        const items = await scrapeCity(viloyat.ll, query, preset.category);
        const newItems = items.filter(it => it.yandexId && !seen.has(it.yandexId));
        newItems.forEach(it => { seen.add(it.yandexId); results.push(it); });

        const ms = Date.now() - t;
        console.log(`[${idx}/${total}] ${viloyat.name}: "${query}" → ${items.length} item, ${newItems.length} yangi | ${ms}ms`);

        done.add(key);
        fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
        fs.writeFileSync(progressFile, JSON.stringify({ done: [...done] }));

        // Rate limit — 300-500ms oraliq
        await new Promise(r => setTimeout(r, 300 + Math.random() * 200));
      } catch (e) {
        console.log(`[${idx}/${total}] ❌ ${viloyat.name}: "${query}" — ${e.message}`);
        await new Promise(r => setTimeout(r, 2000));
      }
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  ✅ TUGADI: ${preset.category}`);
  console.log(`  Vaqt: ${elapsed}s`);
  console.log(`  Jami: ${results.length} unikal POI`);
  console.log(`  Saqlandi: ${outFile}`);
  console.log(`${'='.repeat(50)}`);
}

main().catch(console.error);
