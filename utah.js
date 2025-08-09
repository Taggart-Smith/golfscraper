const puppeteer = require("puppeteer");
const { MongoClient } = require("mongodb");
require("dotenv").config();

// MongoDB Config
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

// Golf courses to scrape
const courses = [
  {
    name: "Soldier Hollow",
    url: "https://stateparks.utah.gov/golf/soldier-hollow/teetime/",
  },
];

async function scrapeDays(course, db, daysToScrape = 5) {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
  });

  const page = await browser.newPage();
  await page.goto(course.url, { waitUntil: "networkidle2", timeout: 60000 });

  const collection = db.collection(COLLECTION_NAME);

  // Get iframe
  await page.waitForSelector("iframe");
  const iframeHandle = await page.$("iframe");
  const frame = await iframeHandle.contentFrame();

  for (let dayIndex = 0; dayIndex < daysToScrape; dayIndex++) {
    await frame.waitForSelector("#selectDatePicker");

    // Get current date
    const currentDateText = await frame.$eval("#selectDatePicker", (el) =>
      el.innerText.trim()
    );
    console.log(
      `\n${course.name} - Scraping tee times for ${currentDateText}...`
    );

    // Scrape tee times
    try {
      const noTeeTimes = await frame.$('[data-testid="no-records-found"]');

      if (noTeeTimes) {
        console.log(`⚠️ No tee times available for ${currentDateText}`);
        clickNextDay(frame, currentDateText);
      } else {
        // Scrape tee times only if the "no tee times" element is not found
        await frame.waitForSelector(
          '[data-testid="teetimes-tile-header-component"]',
          { timeout: 6000 }
        );

        const teeTimeCards = await frame.$$eval(
          '[data-testid="teetimes-tile-header-component"]',
          (cards) => {
            return cards.map((card) => {
              const time =
                card
                  .querySelector('[data-testid="teetimes-tile-time"]')
                  ?.textContent.trim() || "";
              return { time };
            });
          }
        );

        console.log(`🟢 Found ${teeTimeCards.length} tee times`);
        console.table(teeTimeCards);
      }

      // Optionally save to MongoDB
      if (teeTimeCards.length > 0) {
        await collection.insertMany(
          teeTimeCards.map((t) => ({
            course: course.name,
            date: currentDateText,
            ...t,
          }))
        );
      }
    } catch (err) {
      console.error(
        `${course.name} - Failed for ${currentDateText}: ${err.message}`
      );
    }

    // If not the last day, click the next day
    async function clickNextDay(frame, prevDate) {
      const clicked = await frame.evaluate(() => {
        const current = document.querySelector('button[aria-selected="true"]');
        if (!current) return false;

        const buttons = Array.from(
          document.querySelectorAll('button[role="gridcell"]')
        );
        const index = buttons.indexOf(current);
        if (buttons[index + 1]) {
          buttons[index + 1].click();
          return true;
        }
        return false;
      });

      if (clicked) {
        // Wait for the date to change
        await frame.waitForFunction(
          (oldDate) => {
            const el = document.querySelector("#selectDatePicker");
            return el && el.innerText.trim() !== oldDate;
          },
          {},
          prevDate
        );
        return true;
      } else {
        console.log("⚠️ No next day found.");
        return false;
      }
    }
  }

  await browser.close();
}

async function main() {
  const client = new MongoClient(MONGO_URI);
  try {
    console.log("🚀 Starting tee time scraper...");
    await client.connect();
    const db = client.db(DB_NAME);
    for (const course of courses) {
      console.log(`\n📍 Scraping: ${course.name}`);
      await scrapeDays(course, db, 5);
    }
    console.log("✅ Finished scraping.");
  } catch (err) {
    console.error("❌ Error in scraper:", err);
  } finally {
    await client.close();
  }
}

main();
