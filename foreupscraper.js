const puppeteer = require("puppeteer-extra");
const StealthPlugin = require("puppeteer-extra-plugin-stealth");
const { MongoClient } = require("mongodb");
require("dotenv").config();

const MONGO_URI = process.env.MONGO_URI;
const DB_NAME = process.env.DB_NAME;
const COLLECTION_NAME = process.env.COLLECTION_NAME;

const courses = [
  {
    name: "Thanksgiving Point",
    url: "https://foreupsoftware.com/index.php/booking/19645/2034?wmode=opaque#/teetimes",
    buttonText: "Public",
  },
  // {
  //   name: "Gladstan",
  //   url: "https://foreupsoftware.com/index.php/booking/index/18922?_gl=1*9acldx*_ga*MTE1MDQxODcwNy4xNzU0MjU2MTc1*_ga_WQPLP348DP*czE3NTQyNzM3NjEkbzIkZzAkdDE3NTQyNzM3NjEkajYwJGwwJGgw#/teetimes",
  //   buttonText: "Public",
  // },
  // {
  //   name: "The Oaks at Spanish Fork",
  //   url: "https://foreupsoftware.com/index.php/booking/21698/8633#teetimes",
  //   buttonText: "Public Tee Times",
  // },
  // {
  //   name: "Sleepy Ridge",
  //   url: "https://foreupsoftware.com/index.php/booking/19396/1726#teetimes",
  //   buttonText: "I agree",
  // },

  // {
  //   name: "Timpanogos",
  //   url: "https://app.foreupsoftware.com/index.php/booking/6279/49#/teetimes",
  //   buttonText: "Online Tee Times",
  // },
];

async function scrapeDays(course, db, daysToScrape = 5) {
  puppeteer.use(StealthPlugin());

  const browser = await puppeteer.launch({
    headless: false,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-blink-features=AutomationControlled",
    ],
  });
  const page = await browser.newPage();

  const buttonText = course.buttonText || "Public";
  const courseName = course.name;
  const courseUrl = course.url;

  await page.goto(courseUrl, { waitUntil: "networkidle2", timeout: 60000 });

  const buttonClicked = await page.evaluate((btnText) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const target = buttons.find((b) => b.textContent.trim().includes(btnText));
    if (target) {
      target.click();
      return true;
    }
    return false;
  }, buttonText);

  if (!buttonClicked) {
    console.warn(
      `⚠️ Button with text "${buttonText}" not found for course ${course.name}`
    );
  }

  // Click the active day cell to ensure the calendar starts on the correct date
  await page.evaluate(() => {
    const activeDay = document.querySelector("td.active.day");
    if (activeDay) activeDay.click();
  });
  await new Promise((res) => setTimeout(res, 5000)); // Wait for UI to update

  const collection = db.collection(COLLECTION_NAME);

  for (let i = 0; i < daysToScrape; i++) {
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
        {
          timeout: 5000,
        }
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

            if (time) {
              const match = time.match(/(\d{1,2}:\d{2})\s*([APMapm]{2})/);
              if (match) time = `${match[1]} ${match[2].toUpperCase()}`;
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

            return { time, minPlayers, maxPlayers, price };
          })
          .filter(Boolean);
      });

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
        const activeDayNum = await page.evaluate(() =>
          document.querySelector("td.active.day")?.textContent.trim()
        );
        const monthYear = await page.evaluate(() =>
          document.querySelector(".datepicker-switch")?.textContent.trim()
        );

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
        await collection.deleteMany({
          course: courseName,
          date: formattedDate,
        });
        console.log(
          `🧹 Removed old tee times for ${courseName} on ${formattedDate}`
        );

        await collection.insertMany(dataWithMeta);
        console.log(`✅ Inserted ${dataWithMeta.length} tee times`);
      }

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
      await new Promise((res) => setTimeout(res, 2500));
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
