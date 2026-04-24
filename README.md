# U-Maps POI Scraper

Yandex Maps dan O'zbekiston bo'yicha POI (Point of Interest) ma'lumotlarini yig'ish uchun scraper.

**Usul:** Playwright headed browser + Yandex `/maps/api/search` API response interceptor  
**Qamrov:** 24 ta shahar — Toshkent dan Kogon gacha  
**Natija:** Nom, manzil, telefon, ish vaqti, koordinata, rasm, xususiyatlar

---

## Talablar

- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **npm** (Node.js bilan birga keladi)

---

## O'rnatish

```bash
cd scraper
npm install
npx playwright install chromium
```

---

## Ishga tushirish

### Asosiy buyruq

```bash
node uzbekistan-scraper.js <preset> <split>
```

- `<preset>` — kategoriya nomi (pastda ro'yxat)
- `<split>` — `a` yoki `b` (parallel 2 brauzer uchun)

### Parallel 2 ta terminalda ishlatish (tavsiya)

```bash
# Terminal 1
node uzbekistan-scraper.js pharmacy a

# Terminal 2
node uzbekistan-scraper.js pharmacy b
```

`a` — 12 shahar (Toshkent → Guliston)  
`b` — 12 shahar (Termiz → Kogon)

---

## Kategoriyalar (presetlar)

| Preset | Kategoriya | Taxminiy soni |
|--------|-----------|---------------|
| `atm` | Bankomatlar | ~5,000–8,000 |
| `fuel` | AYOQSH (yoqilg'i) | ~2,000–3,000 |
| `pharmacy` | Dorixonalar | ~3,000–5,000 |
| `parking` | Avtoturargohlar | ~1,000–2,000 |
| `groceries` | Oziq-ovqat do'konlari | ~5,000–8,000 |
| `banks` | Banklar | ~1,000–2,000 |
| `hotels` | Mehmonxonalar | ~1,500–3,000 |
| `healthcare` | Kasalxona/klinikalar | ~2,000–4,000 |
| `food` | Restoran/kafe | ~8,000–15,000 |
| `religion` | Masjid/cherkov/ibodatxona | ~10,000–15,000 |

---

## Qamrab olingan shaharlar

| Split A (12 shahar) | Split B (12 shahar) |
|---------------------|---------------------|
| Toshkent | Termiz |
| Samarqand | Qo'qon |
| Buxoro | Marg'ilon |
| Namangan | Chirchiq |
| Andijon | Olmaliq |
| Farg'ona | Angren |
| Nukus | Xiva |
| Qarshi | Shahrisabz |
| Navoiy | Denov |
| Urganch | Bekobod |
| Jizzax | Zarafshon |
| Guliston | Kogon |

---

## CAPTCHA

Yandex Maps ba'zan CAPTCHA ko'rsatadi. Scraper avtomatik aniqlaydi va to'xtaydi:

```
⚠️  CAPTCHA aniqlandi! Brauzerda yechib, Enter bosing...
```

1. Brauzer oynasiga o'ting
2. CAPTCHA ni yoching
3. Terminalga qaytib **Enter** bosing — scraper davom etadi

---

## Progress va qayta ishga tushirish

Scraper progress ni avtomatik saqlaydi:

```
data/
  pharmacy-progress-a.json   ← qaysi shahar/query tugagan
  pharmacy-progress-b.json
```

Agar scraper to'xtasa (CAPTCHA, internet, xato) — xuddi shu buyruqni qayta ishlating:

```bash
node uzbekistan-scraper.js pharmacy a
```

Tugagan shaharlarni o'tkazib ketadi, qolganidan davom etadi.

---

## Natija fayllari

```
data/
  pharmacy-uzbekistan-a.json   ← split A natijalari
  pharmacy-uzbekistan-b.json   ← split B natijalari
```

### Birlashtirish (merge)

Ikki split tugagandan keyin birlashtiring:

```bash
node -e "
const fs = require('fs');
const a = JSON.parse(fs.readFileSync('data/pharmacy-uzbekistan-a.json'));
const b = JSON.parse(fs.readFileSync('data/pharmacy-uzbekistan-b.json'));
const seen = new Set();
const merged = [...a, ...b].filter(p => {
  if (seen.has(p.yandexId)) return false;
  seen.add(p.yandexId);
  return true;
});
fs.writeFileSync('data/pharmacy-uzbekistan-merged.json', JSON.stringify(merged, null, 2));
console.log('Merged:', merged.length, 'unikal POI');
"
```

---

## POI ma'lumot strukturasi

```json
{
  "yandexId": "1018907124",
  "name": "Dori-Darmon",
  "address": "Toshkent, Chilonzor, Bunyodkor ko'chasi 12",
  "coordinates": { "lat": 41.2995, "lng": 69.2401 },
  "category": "pharmacy",
  "phones": ["+998 71 123-45-67"],
  "workingHours": "Mo-Fr 09:00-20:00, Sa 10:00-18:00",
  "rating": 4.3,
  "reviewCount": 127,
  "website": "https://doridarmon.uz",
  "photos": ["https://..."],
  "features": { "open_24h": false, "delivery": true }
}
```

---

## Maslahatlar

- **Tezlik:** ~200–300 POI/daqiqa (ikkala split parallel)
- **Vaqt:** Katta kategoriya (food, religion) — 2–4 soat
- **Internet:** Barqaror ulanish kerak — VPN ishlatmang (Yandex bloklanishi mumkin)
- **Brauzer:** Headless emas — grafik interfeys bilan ishlatiladi, ekran yopilmasin
- **Tungi ishlatish:** Kompyuter uyquqa ketmasligi uchun energy saver ni o'chiring

---

## Mavjud ma'lumotlar

| Kategoriya | Fayl | Soni |
|-----------|------|------|
| ATM | `data/atm-uzbekistan-merged.json` | 5,151 |
| Fuel | `data/fuel-uzbekistan-merged.json` | 1,137 |
| Religion | `data/religion-uzbekistan-*.json` | jarayonda |

---

# 🚀 Grid Scraper (yangi, tezroq) — JAMOA UCHUN

Yangi `grid-scraper.js` browsersiz HTTP + adaptive quadtree algoritm ishlatadi.
Browser-based scraperdan **2-3x ko'proq POI**, **3x tezroq**.

## Algoritm

1. Viloyat bbox bo'yicha qidiradi (Yandex 25 item limit)
2. Agar 25 ga yetsa — bbox 4 ga bo'linadi (NW, NE, SW, SE)
3. Har sub-cell uchun rekursiv → 1km gacha
4. Kafolat: hech POI tushib qolmaydi

## O'rnatish (jamoadoshlar uchun)

```bash
git clone https://github.com/diyorbek0309/u-maps-scraper.git
cd u-maps-scraper
npm install
npx playwright install chromium
```

## Ishga tushirish

### 1-qadam: Session yaratish (1 marta, 2 soatga amal qiladi)

```bash
node session.js
```

Brauzer ochiladi → CAPTCHA chiqsa yoching → avtomatik yopiladi.
`data/session.json` yaratiladi.

### 2-qadam: Scraper ishga tushirish

```bash
node grid-scraper.js <preset> <viloyat>
```

Misol:
```bash
node grid-scraper.js atm samarqand
node grid-scraper.js pharmacy buxoro
node grid-scraper.js food toshkent_sh
```

### 3-qadam: Bir necha viloyat ketma-ket

```bash
for v in samarqand buxoro navoiy; do
  node grid-scraper.js atm $v
done
```

## Viloyat kalitlari

`toshkent_sh`, `toshkent_v`, `samarqand`, `buxoro`, `namangan`, `andijon`,
`fargona`, `qashqadaryo`, `surxondaryo`, `xorazm`, `navoiy`, `jizzax`,
`sirdaryo`, `qoraqalpog`

## Jamoa taqsimoti (tavsiya)

Har kim o'z laptopidan ishlatadi (turli IP → CAPTCHA bottleneck yo'q).

| Jamoadosh | Viloyatlar |
|-----------|-----------|
| Sanat Ullixo'jayev | toshkent_sh, toshkent_v |
| Shaxruh Atanazarov | samarqand, buxoro, navoiy |
| Muxriddin Satipboyev | fargona, andijon, namangan |
| Diyorbek Boltayev | qashqadaryo, surxondaryo |
| Diyorbek Olimov | xorazm, qoraqalpog, jizzax, sirdaryo |

## CAPTCHA holat

Har 250-300 requestdan keyin CAPTCHA chiqishi mumkin:

```
⚠️  CAPTCHA! Session muddati tugadi.
Progress saqlandi. Davom etish uchun:
  1. node session.js                            ← yangi session
  2. node grid-scraper.js atm samarqand         ← resume
```

`session.json` ni yangilang, scraperni qayta ishga tushiring — tugagan
joylar skip bo'ladi, qolgani davom etadi.

## Natija fayllari

```
data/
  atm-samarqand-grid.json           ← natija
  atm-samarqand-grid-progress.json  ← progress (resume uchun)
```

## Birlashtirish (oxirida, 1 odam qiladi)

Barcha jamoadoshlar fayllarini bir papkaga yig'ib:

```bash
node -e "
const fs = require('fs');
const path = require('path');
const PRESET = 'atm';
const seen = new Set();
const merged = [];
fs.readdirSync('./data')
  .filter(f => f.startsWith(PRESET + '-') && f.endsWith('-grid.json'))
  .forEach(f => {
    const data = JSON.parse(fs.readFileSync(path.join('./data', f)));
    data.forEach(p => {
      if (!seen.has(p.yandexId)) { seen.add(p.yandexId); merged.push(p); }
    });
    console.log(f, '→', data.length);
  });
fs.writeFileSync('data/' + PRESET + '-uzbekistan-grid-merged.json', JSON.stringify(merged, null, 2));
console.log('Merged:', merged.length);
"
```

## Tezlik solishtirish

| Strategiya | POI (Toshkent sh) | Vaqt | CAPTCHA |
|-----------|------|------|---------|
| Browser (eski) | ~250 | 30+ daq | Ha (manual) |
| HTTP grid (yangi) | **619** | ~10 daq | Avtomatik handle |

## Maslahatlar

- **VPN yo'q** — Yandex bloklashi mumkin, real IP ishlating
- **Headless emas** — session.js ekran yopilmasin
- **Rate limit** — 250-450ms request orasi (tartibga keltirilgan)
- **Resume har doim ishlaydi** — har yangi POI da fayl saqlanadi
