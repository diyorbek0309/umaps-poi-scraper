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

### 4-qadam (ixtiyoriy): To'liq detail (Phase 2)

Grid scraper asosiy ma'lumot beradi (nom, manzil, koordinata, kategoriya).
Telefon, ish vaqti, rasm, ijtimoiy tarmoq va xususiyatlar uchun:

```bash
node details-scraper.js atm-samarqand    # bitta fayl
node details-scraper.js all              # barcha grid fayllar
```

Qo'shimcha maydonlar: `phones`, `workingHours`, `workingTimeRaw`,
`rating`, `ratingCount`, `reviewCount`, `socialLinks`, `photos[]`,
`logo`, `yandexCategories`, `features`, `featureGroups`, `chain`,
`verified`, `businessProperties`.

Tezlik: ~3-5 POI/sek. 619 POI ≈ 3-4 daqiqa.

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

### Phase 1 — `*-grid.json` (asosiy)

```json
{
  "yandexId": "146209345047",
  "name": "Uzum Bank",
  "address": "Ташкент, 1-й проезд Дархан, 8A",
  "coordinates": { "lat": 41.318337, "lng": 69.299149 },
  "category": "atm",
  "phones": ["+998787770799"],
  "workingHours": "пн-пт 09:00–19:00",
  "rating": null,
  "reviewCount": 0,
  "website": "https://uzumbank.uz/",
  "_source": "yandex-grid"
}
```

### Phase 2 — `*-detailed.json` (kengaytirilgan)

```json
{
  "yandexId": "146209345047",
  "name": "Uzum Bank",
  "address": "Ташкент, 1-й проезд Дархан, 8A",
  "coordinates": { "lat": 41.318337, "lng": 69.299149 },
  "category": "atm",
  "phones": [
    { "value": "+998787770799", "formatted": "+998 78 777 07 99", "type": "phone" }
  ],
  "workingHours": "пн-пт 09:00–19:00",
  "workingTimeRaw": [null, [{"from":{"hours":9,"minutes":0}, "to":{"hours":19,"minutes":0}}], ...],
  "rating": 4.5,
  "ratingCount": 10,
  "reviewCount": 8,
  "websites": ["https://uzumbank.uz/"],
  "socialLinks": [
    { "type": "telegram", "url": "https://t.me/UzumBank_Robot", "handle": "@UzumBank_Robot" },
    { "type": "facebook", "url": "https://www.facebook.com/uzumbank", "handle": "..." }
  ],
  "photos": [
    {
      "orig": "https://avatars.mds.yandex.net/get-altay/.../orig",
      "large": "https://avatars.mds.yandex.net/get-altay/.../XXL",
      "thumb": "https://avatars.mds.yandex.net/get-altay/.../M",
      "alt": "Банкомат Uzum Bank, Ташкент, фото"
    }
  ],
  "photosCount": 11,
  "logo": "https://avatars.mds.yandex.net/get-altay/.../XXL",
  "yandexCategories": [
    { "id": "184105402", "name": "Банкомат", "seoname": "atm", "class": "currency exchange" }
  ],
  "features": [
    { "id": "cash_to_card", "name": "внесение наличных", "type": "bool", "value": true, "important": true }
  ],
  "featureGroups": [
    { "name": "Доступность", "featureIds": ["wheelchair_access"] }
  ],
  "chain": {
    "id": "243127652355",
    "name": "Uzum Bank",
    "seoname": "uzum_bank",
    "cityCount": 292
  },
  "verified": true,
  "businessProperties": { "has_verified_owner": true, ... },
  "_source": "yandex-detail",
  "_detailedAt": "2026-04-24T15:30:00.000Z"
}
```

---

## Maslahatlar

- **VPN yo'q** — Yandex bloklashi mumkin, real IP ishlating
- **Headless emas** — `session.js` ishlaganda ekran yopilmasin
- **Rate limit** — 250-450ms request orasi (tartibga keltirilgan)
- **Resume har doim ishlaydi** — har yangi POI da fayl saqlanadi
- **Tungi ishlatish** — kompyuter uyquga ketmasligi uchun energy saver o'chirilsin
