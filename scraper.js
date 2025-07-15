const puppeteer = require('puppeteer');
const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb+srv://smithtaggart15:3U8pODunzZu9luDh@cluster0.f4y4i0g.mongodb.net/'; // or your Atlas URI
const DB_NAME = 'tee-times';
const COLLECTION_NAME = 'tee_times';

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

async function scrapeDays(courseName, courseUrl, db, daysToScrape = 3) {
  const browser = await puppeteer.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.dateFormat');

  const collection = db.collection(COLLECTION_NAME);

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
        const dataWithMeta = teeTimes.map(t => ({
          ...t,
          date: currentDateText,
          course: courseName,
          scrapedAt: new Date()
        }));

        // Insert into MongoDB
        await collection.insertMany(dataWithMeta);
        console.log(`✅ Inserted ${dataWithMeta.length} tee times into MongoDB`);
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

// Main entry point
(async () => {
  const client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    const db = client.db(DB_NAME);

    for (const course of courses) {
      await scrapeDays(course.name, course.url, db, 5);
    }

    console.log('\n🎯 All done.');
  } catch (err) {
    console.error(err);
  } finally {
    await client.close();
  }
})();
