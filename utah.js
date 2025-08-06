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

  const courseName = course.name;
  const courseUrl = course.url;

  const page = await browser.newPage();
  await page.goto(courseUrl, { waitUntil: "networkidle2", timeout: 60000 });

  const collection = db.collection(COLLECTION_NAME);

  for (let i = 0; i < daysToScrape; i++) {
    await page.waitForSelector("iframe");

    // Get the iframe handle
    const iframeHandle = await page.$("iframe");
    const frame = await iframeHandle.contentFrame();

    await frame.waitForSelector("#selectDatePicker");
    const currentDateText = await frame.$eval("#selectDatePicker", (el) =>
      el.innerText.trim()
    );

    for (let i = 0; i < daysToScrape; i++) {
      const currentDateText = await frame.$eval("#selectDatePicker", (el) => {
        return el.value || el.innerText || "Unknown date";
      });

      console.log(
        `\n${courseName} - Scraping tee times for ${currentDateText}...`
      );
    }

    try {
      await iframe.waitForSelector(
        '[data-testid="teetimes-tile-header-component"]',
        { timeout: 6000 }
      );

      const teeTimeCards = await iframe.$$eval(() => {
        const container = document.querySelector(
          "[data-testid='teetimes-tile-header-component']"
        );
        if (!container) return [];

        return Array.from(
          document.querySelectorAll(
            '[data-testid="teetimes-tile-header-component"]'
          )
        )
          .map((card) => {
            let time =
              card
                .querySelector('[data-testid="teetimes-tile-time"]')
                ?.textContent.trim() || "";

            // You can extract more fields here as needed:
            // const price = card.querySelector('[data-testid="teetimes-price"]')?.textContent.trim() || '';
            // const availability = ...

            return { time };
          })
          .filter(Boolean); // Remove null values
      });

      console.log(
        `🟢 Found ${teeTimeCards.length} tee time cards for ${currentDateText}`
      );
      console.table(teeTimeCards);
    } catch (err) {
      console.error(
        `${course.name} - Failed to scrape for ${currentDateText}: ${err.message}`
      );
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
