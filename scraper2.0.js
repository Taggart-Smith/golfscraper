const puppeteer = require('puppeteer');
const { MongoClient } = require('mongodb');

const MONGO_URI = 'mongodb+srv://smithtaggart15:3U8pODunzZu9luDh@cluster0.f4y4i0g.mongodb.net/';
const DB_NAME = 'tee-times';
const COLLECTION_NAME = 'tee_times_2.0';

const courses = [
  {
    name: 'Fox Hollow',
    url: 'https://app.membersports.com/tee-times/15396/18907/0/0/0'
  },
  {
    name: 'Cedar Hills',
    url: 'https://app.membersports.com/tee-times/15381/18891/0/0/0'
  },
  // Add more courses as needed
];

async function scrapeDays(courseName, courseUrl, db, daysToScrape = 3) {
  const browser = await puppeteer.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  await page.goto(courseUrl, { waitUntil: 'networkidle2', timeout: 60000 });
  await page.waitForSelector('.dateFormat');

  const collection = db.collection(COLLECTION_NAME);

  for (let i = 0; i < daysToScrape; i++) {
    const currentDateText = await page.$eval('.dateFormat', el => el.innerText.trim());
    console.log(`\n${courseName} - Scraping tee times for ${currentDateText}...`);

    try {
      await page.waitForSelector('.tee-time-slot, .teeTime.ng-star-inserted', { timeout: 3000 });

      const teeTimes = await page.evaluate(() => {
        const container = document.querySelector('.teeTimes.ng-star-inserted');
        if (!container) return [];

        return Array.from(container.querySelectorAll('.teeTime.ng-star-inserted')).map(slot => {
          const time = slot.querySelector('.timeCol')?.innerText?.trim();
          const available = slot.querySelector('.availableBookings')?.innerText?.trim();
          const playersText = slot.querySelector('.playersCol')?.innerText?.trim();
          const priceText = slot.querySelector('.amount')?.innerText?.trim();
          

          if (!time || !available) return null;

          const players = playersText ? parseInt(playersText.replace(/[^\d]/g, '')) : null;
          const price = priceText ? parseFloat(priceText.replace(/[^0-9.]/g, '')) : null;

          return { time, available, players, price };
        }).filter(Boolean);
      });

      // Clean up old tee times for this course and date
      await collection.deleteMany({ course: courseName, date: currentDateText });
      console.log(`🧹 Removed old tee times for ${courseName} on ${currentDateText}`);

      if (teeTimes.length === 0) {
        console.log(`${courseName} - No tee times found for ${currentDateText}`);
      } else {
        const dataWithMeta = teeTimes.map(t => ({
          ...t,
          date: currentDateText,
          course: courseName,
          scrapedAt: new Date()
        }));

        await collection.insertMany(dataWithMeta);
        console.log(dataWithMeta.map(t => t.available));

        console.log(`✅ Inserted ${dataWithMeta.length} tee times`);
      }
    } catch (error) {
      if (error.name === 'TimeoutError') {
        console.log(`${courseName} - Timeout: No tee times found for ${currentDateText}`);
      } else {
        console.error(`❌ Error for ${courseName} - ${currentDateText}:`, error.message);
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

(async () => {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    for (const course of courses) {
      await scrapeDays(course.name, course.url, db, 5);
    }

    console.log('\n🎯 All scraping completed!');
  } catch (err) {
    console.error('❌ MongoDB connection error:', err.message);
  } finally {
    await client.close();
  }
})();
