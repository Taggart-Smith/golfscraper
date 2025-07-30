const puppeteer = require("puppeteer");
const { MongoClient } = require("mongodb");
require("dotenv").config();

// MongoDB Config
const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

// Courses to scrape (add more as needed)
const courses = [
  {
    name: "Thanksgiving Point",
    url: "https://foreupsoftware.com/index.php/booking/19645/2034?wmode=opaque#/teetimes",
  },
  // Add more courses here if needed
];

async function scrapeDays(courseName, courseUrl, db, daysToScrape = 5) {
  const browser = await puppeteer.launch({ headless: false, slowMo: 50 });
  const page = await browser.newPage();
  await page.goto(courseUrl, { waitUntil: "networkidle2" });
  await page.waitForSelector(".booking-classes button", { timeout: 10000 });
  // Wait for the Public button using XPath
  await page.waitForSelector("button"); // waits for all buttons to load
  await page.evaluate(() => {
    const buttons = [...document.querySelectorAll("button")];
    const publicButton = buttons.find((btn) =>
      btn.textContent.trim().includes("Public")
    );
    if (publicButton) publicButton.click();
  });
//   await page.waitForTimeout(1000);
  console.log('✅ Clicked "Public" button (via querySelector fallback).');

  for (let i = 0; i < daysToScrape; i++) {
    // Wait for tee times to load
    await page.waitForSelector(".time-summary-ob-holes-full-text", {
      timeout: 15000,
    });

    // Get the current date from the calendar
    const currentDateText = await page.evaluate(() => {
      // Try to find the selected date in the calendar
      const selected = document.querySelector(
        ".DayPicker-Day--selected, .selected, .calendar-day.selected"
      );
      return selected
        ? selected.getAttribute("aria-label") || selected.innerText.trim()
        : null;
    });

    console.log(
      `\n${courseName} - Scraping tee times for ${currentDateText || "Unknown Date"}...`
    );

    try {
      const teeTimes = await page.evaluate(() => {
        return Array.from(document.querySelectorAll(".time-tile-ob-no-details"))
          .map((card) => {
            const time = card
              .querySelector(".times-booking-start-time-label")
              ?.innerText.trim();
            const course = card
              .querySelector(".times-booking-teesheet-name")
              ?.innerText.trim();
            const side = card
              .querySelector(".times-booking-side-name")
              ?.innerText.trim();
            const playersRaw = card
              .querySelector(".time-summary-ob-player-count")
              ?.innerText.trim();
            const playersMatch = playersRaw ? playersRaw.match(/\d+/) : null;
            const players = playersMatch ? parseInt(playersMatch[0]) : null;
            const price = card
              .querySelector(".js-booking-green-fee")
              ?.innerText.replace(/[^\d.]/g, "");

            return {
              time,
              course,
              side,
              players,
              price: price ? parseFloat(price) : null,
            };
          })
          .filter((t) => t.time && t.course && t.price);
      });

      // Remove old tee times for this course and date
      const collection = db.collection(COLLECTION_NAME);
      await collection.deleteMany({
        course: courseName,
        date: currentDateText,
      });
      console.log(
        `🧹 Removed old tee times for ${courseName} on ${currentDateText}`
      );

      if (teeTimes.length === 0) {
        console.log(
          `${courseName} - No tee times found for ${currentDateText}`
        );
      } else {
        const today = new Date();
        let parsedDate = new Date(currentDateText);
        if (isNaN(parsedDate)) parsedDate = today;

        const dataWithMeta = teeTimes.map((t) => ({
          ...t,
          course: courseName,
          date: currentDateText,
          dateISO: parsedDate,
          scrapedAt: new Date(),
        }));

        await collection.insertMany(dataWithMeta);
        console.log(`✅ Inserted ${dataWithMeta.length} tee times`);
      }
    } catch (error) {
      if (error.name === "TimeoutError") {
        console.log(
          `${courseName} - Timeout: No tee times found for ${currentDateText}`
        );
      } else {
        console.error(
          `❌ Error for ${courseName} - ${currentDateText}:`,
          error.message
        );
      }
    }

    // Move to next day by clicking the next day button in the calendar
    const nextDayBtn = await page.$(
      'button[aria-label="Next Day"], .DayPicker-NavButton--next, .calendar-next, .chevron-right'
    );
    if (!nextDayBtn) {
      console.warn(
        `${courseName} - Could not find "Next Day" button. Stopping.`
      );
      break;
    }

    const prevDate = currentDateText;
    await Promise.all([
      nextDayBtn.click(),
      page.waitForFunction(
        (prev) => {
          const selected = document.querySelector(
            ".DayPicker-Day--selected, .selected, .calendar-day.selected"
          );
          const newDate = selected
            ? selected.getAttribute("aria-label") || selected.innerText.trim()
            : null;
          return newDate && newDate !== prev;
        },
        {},
        prevDate
      ),
    ]);
    await page.waitForTimeout(1000); // Give UI time to update
  }

  await browser.close();
}

(async () => {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);

    for (const course of courses) {
      try {
        await scrapeDays(course.name, course.url, db, 5);
      } catch (scrapeError) {
        console.error(`❌ Scraper error for ${course.name}:`, scrapeError);
      }
    }

    console.log("\n🎯 All scraping completed!");
  } catch (mongoError) {
    console.error("❌ MongoDB connection error:", mongoError.message);
  } finally {
    await client.close();
  }
})();
