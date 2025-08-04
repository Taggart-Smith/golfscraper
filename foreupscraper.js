const puppeteer = require("puppeteer");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

const courses = [
  {
    name: "Thanksgiving Point",
    url: "https://foreupsoftware.com/index.php/booking/19645/2034?wmode=opaque#/teetimes",
  },
  {
    name: "Gladstan",
    url: "https://foreupsoftware.com/index.php/booking/index/18922?_gl=1*9acldx*_ga*MTE1MDQxODcwNy4xNzU0MjU2MTc1*_ga_WQPLP348DP*czE3NTQyNzM3NjEkbzIkZzAkdDE3NTQyNzM3NjEkajYwJGwwJGgw#/teetimes",
  }
];

async function scrapeDays(courseName, courseUrl, db, daysToScrape = 5) {
  const browser = await puppeteer.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();

  await page.goto(courseUrl, { waitUntil: "networkidle2", timeout: 60000 });

  // Click the "Public" button
  const buttons = await page.$$("button");
  for (const btn of buttons) {
    const text = await page.evaluate((el) => el.textContent.trim(), btn);
    if (text.includes("Public")) {
      await btn.click();
      break;
    }
  }

  // Click the active day cell to ensure the calendar starts on the correct date
  await page.evaluate(() => {
    const activeDay = document.querySelector("td.active.day");
    if (activeDay) activeDay.click();
  });
  await new Promise((res) => setTimeout(res, 1000)); // Wait for UI to update

  const collection = db.collection(COLLECTION_NAME);

  for (let i = 0; i < daysToScrape; i++) {
    // Get the currently selected date directly from the UI
    const currentDateText = await page.evaluate(() => {
      const monthYear = document
        .querySelector(".datepicker-switch")
        ?.textContent.trim();
      const activeDay = document
        .querySelector("td.active.day")
        ?.textContent.trim();
      return activeDay && monthYear
        ? `${monthYear} ${activeDay}`
        : "Unknown date";
    });
    console.log(
      `\n${courseName} - Scraping tee times for ${currentDateText}...`
    );

    try {
      await page.waitForSelector(
        ".times-inner.time-tiles-aggregate-booking.js-times",
        { timeout: 10000 }
      );

      const teeTimes = await page.evaluate(() => {
        const container = document.querySelector(
          ".times-inner.time-tiles-aggregate-booking.js-times"
        );
        if (!container) return [];

        return Array.from(
          container.querySelectorAll(".time.time-tile-ob-no-details")
        )
          .map((slot) => {
            let time = slot
              .querySelector(".times-booking-start-time-label")
              ?.innerText?.trim();

            // Sanitize time: "HH:MM AM/PM" with a space before AM/PM
            if (time) {
              const match = time.match(/(\d{1,2}:\d{2})\s*([APMapm]{2})/);
              if (match) {
                time = `${match[1]} ${match[2].toUpperCase()}`;
              }
            }

            const minPlayers = 1;
            const maxPlayersText = slot
              .querySelector(".time-summary-ob-player-count")
              ?.innerText.trim();
            const maxPlayers = maxPlayersText
              ? parseInt(maxPlayersText.match(/\d+/)?.[0])
              : 4;
            const priceRaw = slot
              .querySelector(".js-booking-green-fee")
              ?.innerText?.trim();
            const price = priceRaw
              ? parseFloat(priceRaw.replace(/[^0-9.]/g, ""))
              : null;

            if (!time) return null;

            return {
              time,
              minPlayers,
              maxPlayers,
              price,
            };
          })
          .filter(Boolean);
      });

      // Format date as "MON, AUG 4, 2025"
      function formatDbDate(dateObj) {
        const days = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
        const months = [
          "JAN",
          "FEB",
          "MAR",
          "APR",
          "MAY",
          "JUN",
          "JUL",
          "AUG",
          "SEP",
          "OCT",
          "NOV",
          "DEC",
        ];
        const dayName = days[dateObj.getDay()];
        const monthName = months[dateObj.getMonth()];
        const dayNum = dateObj.getDate();
        const year = dateObj.getFullYear();
        return `${dayName}, ${monthName} ${dayNum}, ${year}`;
      }

      if (teeTimes.length === 0) {
        console.log(
          `${courseName} - No tee times found for ${currentDateText}`
        );
      } else {
        // Parse the active date from the calendar
        const activeDayNum = await page.evaluate(() => {
          return document.querySelector("td.active.day")?.textContent.trim();
        });
        const monthYear = await page.evaluate(() => {
          return document
            .querySelector(".datepicker-switch")
            ?.textContent.trim();
        });

        // Build a JS Date object from monthYear and activeDayNum
        let parsedDate = new Date(`${monthYear} ${activeDayNum}`);
        if (isNaN(parsedDate)) parsedDate = new Date();

        const formattedDate = formatDbDate(parsedDate);

        const dataWithMeta = teeTimes.map((t) => ({
          time: t.time,
          course: courseName,
          minPlayers: t.minPlayers || 1,
          maxPlayers: t.maxPlayers || 4,
          price: t.price || null,
          date: formattedDate,
          dateISO: parsedDate,
          scrapedAt: new Date(),
        }));

        await collection.insertMany(dataWithMeta);
        console.log(`✅ Inserted ${dataWithMeta.length} tee times`);
      }

      // Click "Next Day" and wait a bit
      const nextDayBtn = await page.$(
        ".ob-filters-date-selection-arrows.nextday"
      );
      if (!nextDayBtn) {
        console.warn(
          `${courseName} - Could not find "Next Day" button. Stopping.`
        );
        break;
      }

      await nextDayBtn.click();
      await new Promise((res) => setTimeout(res, 2500)); // Let next day's data load
    } catch (err) {
      console.log(
        `${courseName} - Failed to scrape for ${currentDateText}:`,
        err.message
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
      await scrapeDays(course.name, course.url, db, 5);
    }
    console.log("✅ Finished scraping.");
  } catch (err) {
    console.error("❌ Error in scraper:", err);
  } finally {
    await client.close();
  }
}

main();
