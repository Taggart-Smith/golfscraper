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

// Format DB date for consistency
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

// Clicks the next day in the date picker
async function clickNextDay(frame, prevDate) {
  console.log("📅 Attempting to click next day...");
  await frame.waitForSelector(
    ".MuiIconButton-root.MuiIconButton-colorPrimary",
    { visible: true, timeout: 10000 }
  );
  await frame.waitForSelector('div[role="grid"]', {
    visible: true,
    timeout: 10000,
  });
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
  const browser = await puppeteer.launch({ headless: false, slowMo: 100 });
  const page = await browser.newPage();
  await page.goto(course.url, { waitUntil: "networkidle2", timeout: 60000 });

  const collection = db.collection(COLLECTION_NAME);

  // Get iframe context
  await page.waitForSelector("iframe");
  const iframeHandle = await page.$("iframe");
  const frame = await iframeHandle.contentFrame();

  const calendarButtonSelector = 'button[aria-label="date-filter"]';
  await frame.waitForSelector(calendarButtonSelector, { visible: true });
  await frame.click(calendarButtonSelector);

  for (let i = 0; i < daysToScrape; i++) {
    await frame.waitForSelector("#selectDatePicker");

    const currentDateText = await frame.$eval("#selectDatePicker", (el) =>
      el.innerText.trim()
    );

    console.log(
      `\n${course.name} - Scraping tee times for ${currentDateText}...`
    );

    try {
      const noTeeTimes = await frame.$('[data-testid="no-records-found"]');

      if (noTeeTimes) {
        console.log(`⚠️ No tee times available for ${currentDateText}`);
      } else {
        await frame.waitForSelector(
          '[data-testid="teetimes-tile-header-component"]',
          {
            timeout: 6000,
          }
        );

        const teeTimes = await frame.$$eval(
          '[data-testid="teetimes-tile-header-component"]',
          (cards) => {
            return cards.map((card) => {
              const time =
                card
                  .querySelector('[data-testid="teetimes-tile-time"]')
                  ?.textContent.trim() || "";

              const priceText = (() => {
                const paragraphs = Array.from(
                  card.querySelectorAll(
                    ".MuiTypography-root.MuiTypography-body1"
                  )
                );
                const priceIndex = paragraphs.findIndex(
                  (el) => el.textContent.trim() === "Price:"
                );
                if (priceIndex !== -1 && paragraphs[priceIndex + 1]) {
                  return paragraphs[priceIndex + 1].textContent.trim();
                }
                return null;
              })();

              const price = priceText
                ? parseFloat(priceText.replace(/[^0-9.]/g, ""))
                : null;
              console.log("🧪 Card HTML:", card.innerHTML);

              const playersText = card
                .querySelector(
                  '[data-testid="teetimes-tile-available-players"]'
                )
                ?.textContent.trim();
              const [minPlayers, maxPlayers] = playersText
                ? playersText.split("-").map((p) => parseInt(p.trim(), 10))
                : [1, 4];

              return { time, price, minPlayers, maxPlayers };
            });
          }
        );

        // Format date for DB
        const parsedDate = new Date(currentDateText);
        const dateISO = parsedDate;
        const formattedDate = formatDbDate(parsedDate);
        const scrapedAt = new Date();

        const dataWithMeta = teeTimes.map((t) => ({
          time: t.time,
          course: course.name,
          minPlayers: t.minPlayers,
          maxPlayers: t.maxPlayers,
          price: t.price,
          date: formattedDate,
          dateISO,
          scrapedAt,
        }));

        // Delete old entries for this course + date
        await collection.deleteMany({
          course: course.name,
          date: formattedDate,
        });
        console.log(
          `🧹 Removed old tee times for ${course.name} on ${formattedDate}`
        );

        await collection.insertMany(dataWithMeta);
        console.log(`✅ Inserted ${dataWithMeta.length} tee times`);
      }
    } catch (err) {
      console.error(
        `${course.name} - Failed for ${currentDateText}: ${err.message}`
      );
    }

    // Advance to next day if needed
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
      await scrapeDays(course, db, 5); // Adjust number of days if needed
    }
    console.log("✅ Finished scraping.");
  } catch (err) {
    console.error("❌ Error in scraper:", err);
  } finally {
    await client.close();
  }
}

main();
