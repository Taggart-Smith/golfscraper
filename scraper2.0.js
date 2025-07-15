const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

// List of courses with URLs
const courses = [
  {
    name: 'FoxHollow',
    url: 'https://app.membersports.com/tee-times/15396/18907/0/0/0'
  },
  {
    name: 'CedarHills',
    url: 'https://app.membersports.com/tee-times/15381/18891/0/0/0'
  },
  // Add more courses here
];

async function scrapeDays(courseName, courseUrl, daysToScrape = 3) {
  const browser = await puppeteer.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.dateFormat');

  for (let i = 0; i < daysToScrape; i++) {
    const currentDateText = await page.$eval('.dateFormat', el => el.innerText.trim());
    console.log(`\n${courseName} - Checking tee times for ${currentDateText}...`);

    try {
      await page.waitForSelector('.tee-time-slot, .teeTime.ng-star-inserted', { timeout: 3000 });

      const teeTimes = await page.evaluate(() => {
        const teeTimesContainer = document.querySelector('.teeTimes.ng-star-inserted');
        if (!teeTimesContainer) return [];

        return Array.from(teeTimesContainer.querySelectorAll('.teeTime.ng-star-inserted')).map(slot => {
          const time = slot.querySelector('.timeCol')?.innerText?.trim();
          const available = slot.querySelector('.availableBookings')?.innerText?.trim();
          if (!time || !available) return null;
          return { time, available };
        }).filter(Boolean);
      });

      if (teeTimes.length === 0) {
        console.log(`${courseName} - No tee times available for ${currentDateText}`);
      } else {
        console.table(teeTimes);

        const filenameSafeDate = currentDateText.replace(/[^\w]/g, '-');
        const filepath = path.join(__dirname, `tee-times-${courseName}-${filenameSafeDate}.json`);

        const dataWithCourse = teeTimes.map(t => ({
          ...t,
          date: currentDateText,
          course: courseName
        }));

        fs.writeFileSync(filepath, JSON.stringify(dataWithCourse, null, 2));
        console.log(`✅ Saved to ${filepath}`);
      }
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log(`${courseName} - No tee times available for ${currentDateText}`);
      } else {
        throw error;
      }
    }

    const rightChevron = await page.$('.dateNavigation img[src*="chevron-right"]');
    if (!rightChevron) {
      console.warn(`${courseName} - Could not find "Next Day" chevron. Stopping.`);
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

// Run scrape for each course
(async () => {
  for (const course of courses) {
    await scrapeDays(course.name, course.url, 5);
  }
})();
