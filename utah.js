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

/**
 * Clicks the next available day in the date picker inside the iframe.
 * @param {Frame} frame - Puppeteer frame for the iframe.
 * @param {string} prevDate - The current date text before changing.
 * @returns {boolean} - Returns true if it clicked a new day, false if no next day was found.
 */
async function clickNextDay(frame, prevDate) {
  console.log("📅 Attempting to click next day...");
  await frame.waitForSelector(
    ".MuiIconButton-root.MuiIconButton-colorPrimary",
    { visible: true, timeout: 10000 }
  );
  await frame.waitForSelector('div[role="grid"]', { visible: true, timeout: 10000 });
  await frame.waitForFunction(
    () => document.querySelectorAll('button[role="gridcell"]').length > 0,
    { timeout: 10000 }
  );

  const clicked = await frame.evaluate(() => {
    const cells = [...document.querySelectorAll('button[role="gridcell"]')];
    const currentIndex = cells.findIndex(
      (btn) => btn.getAttribute("aria-selected") === "true"
    );
    if (currentIndex === -1) return false;

    for (let i = currentIndex + 1; i < cells.length; i++) {
      const btn = cells[i];
      if (!btn.disabled) {
        btn.click();
        return true;
      }
    }
    return false;
  });

  if (!clicked) {
    console.log("⚠️ No next enabled day found.");
    return false;
  }

  console.log("✅ Clicked next day. Waiting for date change...");
  await frame.waitForFunction(
    (oldDate) => {
      const el = document.querySelector("#selectDatePicker");
      return el && el.innerText.trim() !== oldDate;
    },
    { timeout: 10000 },
    prevDate
  );

  return true;
}


async function scrapeDays(course, db, daysToScrape = 5) {
  const browser = await puppeteer.launch({
    headless: false,
    slowMo: 100,
  });

  const page = await browser.newPage();
  await page.goto(course.url, { waitUntil: "networkidle2", timeout: 60000 });

  const collection = db.collection(COLLECTION_NAME);

  // Get iframe once
  await page.waitForSelector("iframe");
  const iframeHandle = await page.$("iframe");
  const frame = await iframeHandle.contentFrame();

  const calendarButtonSelector = 'button[aria-label="date-filter"]';

  // Step 2: Open calendar
  await frame.click(calendarButtonSelector);

  for (let i = 0; i < daysToScrape; i++) {
    await frame.waitForSelector("#selectDatePicker");

    const currentDateText = await frame.$eval("#selectDatePicker", (el) =>
      el.innerText.trim()
    );

    console.log(
      `\n${course.name} - Scraping tee times for ${currentDateText}...`
    );

    let teeTimeCards = [];
    try {
      const noTeeTimes = await frame.$('[data-testid="no-records-found"]');

      if (noTeeTimes) {
        console.log(`⚠️ No tee times available for ${currentDateText}`);
      } else {
        await frame.waitForSelector(
          '[data-testid="teetimes-tile-header-component"]',
          { timeout: 6000 }
        );
        teeTimeCards = await frame.$$eval(
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

    // Move to next day if not the last loop
    if (i < daysToScrape - 1) {
      const moved = await clickNextDay(frame, currentDateText);
      if (!moved) break;
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
