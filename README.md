# U-Maps POI Scraper

Yandex Maps dan O'zbekiston bo'yicha POI (Point of Interest) ma'lumotlarini yig'ish uchun scraper.

**Usul:** Browsersiz HTTP + adaptive quadtree algoritm
**Qamrov:** 14 viloyat — bbox bo'yicha to'liq qoplash
**Natija:** Nom, manzil, telefon, ish vaqti, koordinata, rating

---

## Talablar

- **Node.js** v18+ — [nodejs.org](https://nodejs.org)
- **npm** (Node.js bilan birga keladi)

---

## O'rnatish

```bash
git clone https://github.com/diyorbek0309/umaps-poi-scraper.git
cd umaps-poi-scraper
npm install
npx playwright install chromium
```

---

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

Misollar:

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

---

## Algoritm

1. Viloyat bbox bo'yicha qidiradi (Yandex 25 item limit har request)
2. Agar 25 ga yetsa — bbox 4 ga bo'linadi (NW, NE, SW, SE)
3. Har sub-cell uchun rekursiv → 1km gacha
4. Kafolat: hech POI tushib qolmaydi

---

## Kategoriyalar (presetlar)

| Preset | Kategoriya |
|--------|-----------|
| `atm` | Bankomatlar |
| `fuel` | AYOQSH (yoqilg'i) |
| `pharmacy` | Dorixonalar |
| `parking` | Avtoturargohlar |
| `groceries` | Oziq-ovqat do'konlari |
| `banks` | Banklar |
| `hotels` | Mehmonxonalar |
| `healthcare` | Kasalxona/klinikalar/stomatologiya |
| `food` | Restoran/kafe/chayxona |
| `religion` | Masjid/cherkov/ibodatxona |
| `education` | Maktab/universitet/bolalar bog'chasi |
| `beauty` | Go'zallik salonlari/sartaroshxona/SPA |
| `leisure_sport` | Sport/fitnes/basseyn/kino |
| `culture_tourism` | Muzey/teatr/yodgorlik |
| `services` | Maishiy xizmatlar (ta'mir, pochta) |
| `government` | Davlat xizmatlari (hokimiyat, IIB) |
| `automotive` | Avtoservis/shinomontaj/avtomoyka |
| `shopping` | Kiyim/elektronika/mebel/TRC |
| `transport` | Avtovokzal/aeroport/metro |
| `nature` | Park/ko'l/qo'riqxona |

---

## Viloyat kalitlari

`toshkent_sh`, `toshkent_v`, `samarqand`, `buxoro`, `namangan`, `andijon`,
`fargona`, `qashqadaryo`, `surxondaryo`, `xorazm`, `navoiy`, `jizzax`,
`sirdaryo`, `qoraqalpog`

---

## CAPTCHA holat

Har 250-300 requestdan keyin CAPTCHA chiqishi mumkin. Scraper avtomatik
to'xtaydi va progress ni saqlaydi:

```
⚠️  CAPTCHA! Session muddati tugadi.
Progress saqlandi. Davom etish uchun:
  1. node session.js                            ← yangi session
  2. node grid-scraper.js atm samarqand         ← resume
```

`session.json` yangilang, scraperni qayta ishga tushiring — tugagan joylar
skip bo'ladi, qolgani davom etadi.

---

## Natija fayllari

```
data/
  atm-samarqand-grid.json           ← natija
  atm-samarqand-grid-progress.json  ← progress (resume uchun)
```

### Birlashtirish

Barcha viloyat fayllarini bittaga merge qilish:

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
  "website": "https://doridarmon.uz"
}
```

---

## Maslahatlar

- **VPN yo'q** — Yandex bloklashi mumkin, real IP ishlating
- **Headless emas** — `session.js` ishlaganda ekran yopilmasin
- **Rate limit** — 250-450ms request orasi (tartibga keltirilgan)
- **Resume har doim ishlaydi** — har yangi POI da fayl saqlanadi
- **Tungi ishlatish** — kompyuter uyquga ketmasligi uchun energy saver o'chirilsin
