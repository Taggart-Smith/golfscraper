const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const BASE_URL = 'https://app.membersports.com/tee-times/3689/4748/0/0/0';

async function scrapeDays(daysToScrape = 3) {
  const browser = await puppeteer.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  await page.goto(BASE_URL, { waitUntil: 'networkidle2', timeout: 60000 });

  await page.waitForSelector('.dateFormat');

  for (let i = 0; i < daysToScrape; i++) {
    const currentDateText = await page.$eval('.dateFormat', el => el.innerText.trim());
    console.log(`\nChecking tee times for ${currentDateText}...`);

    try {
      await page.waitForSelector('.tee-time-slot, .teeTime.ng-star-inserted', { timeout: 3000 });

      const teeTimes = await page.evaluate(() => {
        const teeTimesContainer = document.querySelector('.teeTimes.ng-star-inserted');
        if (!teeTimesContainer) return [];

        return Array.from(teeTimesContainer.querySelectorAll('.teeTime.ng-star-inserted')).map(slot => {
            const time = slot.querySelector('.timeCol')?.innerText?.trim();
            const available = slot.querySelector('.availableBookings')?.innerText?.trim();
            if (!time || !available) return null; // Skip if either is missing
            return { time, available };
            }).filter(Boolean);

      });

      if (teeTimes.length === 0) {
        console.log(`No tee times available for ${currentDateText}`);
      } else {
        console.table(teeTimes);

        // Format filename from date
        const filenameSafeDate = currentDateText.replace(/[^\w]/g, '-'); // e.g., "Jul-8-2025"
        const filepath = path.join(__dirname, `tee-times-${filenameSafeDate}.json`);

        // Add date to each record
        const dataWithDate = teeTimes.map(t => ({ ...t, date: currentDateText }));

        // Write to file
        fs.writeFileSync(filepath, JSON.stringify(dataWithDate, null, 2));
        console.log(`✅ Saved to ${filepath}`);
      }
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log(`No tee times available for ${currentDateText}`);
      } else {
        throw error;
      }
    }

    // Click next day
    const rightChevron = await page.$('.dateNavigation img[src*="chevron-right"]');
    if (!rightChevron) {
      console.warn('Could not find "Next Day" chevron. Stopping.');
      break;
    }

    const prevDate = currentDateText;

    await Promise.all([
      rightChevron.click(),
      page.waitForFunction(
        (prev) => {
          const el = document.querySelector('.dateFormat');
          return el && el.innerText.trim() !== prev;
        },
        {},
        prevDate
      )
    ]);
  }

  await browser.close();
}

scrapeDays(5);
