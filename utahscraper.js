const puppeteer = require('puppeteer');
require('dotenv').config();

(async () => {
  console.log('🚀 Starting tee time scraper...\n');

  const browser = await puppeteer.launch({ headless: false }); // Change to true in prod
  const page = await browser.newPage();

  const courses = [
    {
      name: 'Soldier Hollow',
      url: "https://stateparks.utah.gov/golf/soldier-hollow/teetime/",
    },
    // Add more courses here if needed
  ];

  for (const course of courses) {
    console.log(`📍 Scraping: ${course.name}`);

    await page.goto(course.url, { waitUntil: 'networkidle2' });

    // Wait for iframe to load
    const iframeElement = await page.waitForSelector('iframe');
    const iframe = await iframeElement.contentFrame();

    if (!iframe) {
      console.error(`❌ Could not access iframe for ${course.name}`);
      continue;
    }

    // Example of clicking a date picker inside iframe (if needed)
    const datePickerSelector = '#selectDatePicker';
    const datePicker = await iframe.$(datePickerSelector);

    if (datePicker) {
      await datePicker.click();
      console.log(`✅ Clicked on ${datePickerSelector} inside iframe`);
    } else {
      console.warn(`⚠️ Date picker (${datePickerSelector}) not found on ${course.name}`);
    }

    // Optional: Extract date text (update as needed)
    const dateText = await iframe.$eval(datePickerSelector, el => el.value).catch(() => 'Unknown date');
    console.log(`\n${course.name} - Scraping tee times for ${dateText}...\n`);

    // Wait for tee time card components
    try {
      await iframe.waitForSelector('[data-testid="teetimes-tile-header-component"]', { timeout: 7000 });

      const teeTimeCards = await iframe.$$eval(
        '[data-testid="teetimes-tile-header-component"]',
        (cards) =>
          cards.map((card) => {
            const time = card.querySelector('[data-testid="teetimes-tile-time"]')?.textContent.trim() || '';

            // You can extract more fields here as needed:
            // const price = card.querySelector('[data-testid="teetimes-price"]')?.textContent.trim() || '';
            // const availability = ...

            return { time};
          })
      );

      console.log(`🟢 Found ${teeTimeCards.length} tee time cards for ${dateText}`);
      console.table(teeTimeCards);

    } catch (err) {
      console.error(`${course.name} - Failed to scrape for ${dateText}: ${err.message}`);
    }
  }

  await browser.close();
})();
