const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');

const CATEGORIES_TO_CHECK = [
  // Eng muhim — boshqa turdagi feature'lar chiqishi kutiladi
  'Ресторан', 'Кафе', 'Бар', 'Ночной клуб',
  'Гостиница', 'Хостел', 'Курорт', 'Апартаменты',
  'Больница', 'Клиника', 'Аптека', 'Стоматология',
  'Банкомат', 'Банк',
  'АЗС', 'Автомойка', 'Автосервис',
  'Салон красоты', 'Барбершоп', 'Спа',
  'Фитнес', 'Бассейн', 'Стадион',
  'Школа', 'Университет', 'Детский сад',
  'Супермаркет', 'Торговый центр',
  'Мечеть', 'Церковь',
  'Музей', 'Театр', 'Кинотеатр',
  'Парковка', 'Прачечная',
  'Ветеринарная клиника',
];

async function run() {
  const browser = await chromium.launch({ headless: false, slowMo: 200 });
  const context = await browser.newContext({
    viewport: { width: 500, height: 900 },
    locale: 'ru',
  });
  const page = await context.newPage();

  console.log('Opening Yandex Maps...');
  console.log('>>> CAPTCHA chiqsa qo\'lda yeching, keyin Enter bosing <<<\n');

  await page.goto('https://yandex.uz/maps/?ll=69.2797,41.3111&z=14&l=map&lang=ru', {
    waitUntil: 'domcontentloaded', timeout: 60000
  }).catch(() => {});
  await page.waitForTimeout(5000);

  // CAPTCHA tekshirish
  const isCaptcha = await page.evaluate(() =>
    document.body.innerText.includes('robot') || document.body.innerText.includes('captcha')
  );
  if (isCaptcha) {
    console.log('⚠️  CAPTCHA! Qo\'lda yeching, Enter bosing...');
    await new Promise(r => process.stdin.once('data', r));
    await page.waitForTimeout(3000);
  }

  // Context menu orqali "Obyekt qo'shish"
  console.log('Right-clicking on map...');
  await page.mouse.click(250, 450, { button: 'right' });
  await page.waitForTimeout(2000);

  // "Obyekt qo'shish" yoki "Добавить организацию" bosiladi
  const addItem = await page.$('text=/Obyekt|Добавить|qoʻshish/i');
  if (addItem) {
    console.log('Clicking "Obyekt qo\'shish"...');
    await addItem.click();
    await page.waitForTimeout(4000);
  } else {
    console.log('Add button not found in context menu');
    await browser.close();
    return;
  }

  await page.screenshot({ path: path.join(__dirname, 'zoom-screenshots', 'yandex-add-form.png') });

  // Forma elementlarini tekshirish
  const formInfo = await page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input'));
    return inputs.map(i => ({
      placeholder: i.placeholder,
      name: i.name,
      type: i.type,
      value: i.value,
      ariaLabel: i.getAttribute('aria-label'),
    }));
  });
  console.log('\nInputs:', JSON.stringify(formInfo, null, 2));

  // Kategoriya inputni topish
  let catInput = null;
  for (const selector of [
    'input[placeholder*="Начните"]',
    'input[placeholder*="категори"]',
    'input[placeholder*="Boshlang"]',
    'input[placeholder*="typing"]',
    'input[placeholder*="tanlang"]',
  ]) {
    catInput = await page.$(selector);
    if (catInput) {
      console.log(`Category input found: ${selector}`);
      break;
    }
  }

  if (!catInput) {
    // Barcha inputlardan ikkinchisi odatda category bo'ladi (birinchisi = address)
    const allInputs = await page.$$('input[type="text"], input:not([type])');
    if (allInputs.length >= 2) {
      catInput = allInputs[1]; // ikkinchi input — category
      console.log('Using second input as category');
    }
  }

  const results = {};

  if (catInput) {
    for (const cat of CATEGORIES_TO_CHECK) {
      console.log(`\n=== ${cat} ===`);

      // Avval mavjud kategoriyani o'chirish
      const removeBtns = await page.$$('[class*="tag"] [class*="close"], [class*="chip"] [class*="close"], [class*="tag"] button, [class*="category"] [class*="remove"]');
      for (const btn of removeBtns) {
        await btn.click().catch(() => {});
        await page.waitForTimeout(300);
      }
      await page.waitForTimeout(500);

      // Kategoriya kiritish
      await catInput.click();
      await page.waitForTimeout(300);
      await catInput.fill('');
      await catInput.fill(cat);
      await page.waitForTimeout(2000);

      // Suggestion tanlash
      const suggestions = await page.$$('[class*="suggest"] [class*="item"], [class*="popup"] [class*="item"], [class*="list-item"], [role="option"]');
      if (suggestions.length > 0) {
        const sugText = await suggestions[0].textContent();
        console.log(`  Selected: ${sugText?.trim()}`);
        await suggestions[0].click();
        await page.waitForTimeout(2500);
      } else {
        // Enter bosish
        await page.keyboard.press('Enter');
        await page.waitForTimeout(2000);
      }

      // Page contentni olish — Features, Accessibility va boshqalar
      const pageData = await page.evaluate(() => {
        const body = document.body.innerText;
        const result = {
          features: [],
          accessibility: [],
          allSections: [],
        };

        // "Unknown" yoki "Неизвестно" yonidagi labellarni topish
        const allElements = document.querySelectorAll('*');
        let currentSection = '';

        for (const el of allElements) {
          const text = el.textContent?.trim();
          if (!text) continue;

          // Section sarlavhalari
          if (text.match(/^(Features|Особенности|Xususiyatlar)/i) && text.length < 30) {
            currentSection = 'features';
          }
          if (text.match(/^(For people with|Для людей|Nogironlar)/i) && text.length < 50) {
            currentSection = 'accessibility';
          }

          // Unknown dropdown bor elementlar
          if (text.match(/Unknown|Неизвестно/i) && el.closest('[class*="row"], [class*="field"], [class*="attribute"]')) {
            const row = el.closest('[class*="row"], [class*="field"], [class*="attribute"]');
            const label = row?.textContent?.replace(/Unknown|Неизвестно/gi, '').trim();
            if (label && label.length < 80) {
              if (currentSection === 'accessibility') {
                result.accessibility.push(label);
              } else {
                result.features.push(label);
              }
            }
          }
        }

        // Yandex specific: scrollable sections
        const sections = body.match(/(Features|Особенности|Xususiyatlar)\s*\d+/gi);
        if (sections) {
          result.allSections = sections;
        }

        return result;
      });

      results[cat] = pageData;
      console.log(`  Features (${pageData.features.length}):`, pageData.features.slice(0, 8));
      console.log(`  Accessibility (${pageData.accessibility.length}):`, pageData.accessibility.slice(0, 5));

      // Screenshot
      await page.screenshot({
        path: path.join(__dirname, 'zoom-screenshots', `yandex-feat-${cat.replace(/\s+/g, '_')}.png`)
      });
    }
  } else {
    console.log('Category input NOT found!');
    await page.screenshot({ path: path.join(__dirname, 'zoom-screenshots', 'yandex-debug.png') });
  }

  // Natijalarni saqlash
  const outFile = path.join(__dirname, 'yandex-category-features.json');
  fs.writeFileSync(outFile, JSON.stringify(results, null, 2));
  console.log(`\n✅ Results saved: ${outFile}`);
  console.log(`Categories checked: ${Object.keys(results).length}`);

  await page.waitForTimeout(3000);
  await browser.close();
}

run().catch(console.error);
