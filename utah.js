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
  {
    name: "Wasatch",
    url: "https://stateparks.utah.gov/golf/wasatch/teetime/",
  },
  {
    name: "Palisade",
    url: "https://stateparks.utah.gov/golf/palisade/teetime/",
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
  return `${days[dateObj.getDay()]}, ${months[dateObj.getMonth()]} ${dateObj.getDate()}, ${dateObj.getFullYear()}`;
}

// Clicks the next day in the date picker
async function clickNextDay(frame, prevDate) {
  console.log("📅 Attempting to click next day...");
  await frame.waitForSelector(
    ".MuiIconButton-root.MuiIconButton-colorPrimary",
    { visible: true }
  );
  await frame.waitForSelector('div[role="grid"]', { visible: true });
  await frame.waitForFunction(
    () => document.querySelectorAll('button[role="gridcell"]').length > 0
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

  await frame.waitForFunction(
    (oldDate) => {
      const el = document.querySelector("#selectDatePicker");
      return el && el.innerText.trim() !== oldDate;
    },
    {},
    prevDate
  );

  return true;
}

// Main scraper
async function scrapeDays(course, db, daysToScrape = 5) {
  const browser = await puppeteer.launch({
    headless: "new",
    slowMo: 100,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.goto(course.url, { waitUntil: "networkidle2", timeout: 60000 });

  const collection = db.collection(COLLECTION_NAME);

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
          '[data-testid="teetimes-tile-header-component"]'
        );

        const teeTimes = await frame.evaluate(() => {
          const headers = Array.from(
            document.querySelectorAll(
              '[data-testid="teetimes-tile-header-component"]'
            )
          );
          const contents = Array.from(
            document.querySelectorAll(
              '[data-testid="teetimes-tile-content-component"]'
            )
          );

          const count = Math.min(headers.length, contents.length);
          const result = [];

          for (let i = 0; i < count; i++) {
            const header = headers[i];
            const content = contents[i];

            const time =
              header
                .querySelector('[data-testid="teetimes-tile-time"]')
                ?.textContent.trim() || "";

            const playersText = header
              .querySelector('[data-testid="teetimes-tile-available-players"]')
              ?.textContent.trim();
            const [minPlayers, maxPlayers] = playersText
              ? playersText.split("-").map((p) => parseInt(p.trim(), 10))
              : [1, 4];

            const priceText = (() => {
              const priceEl = Array.from(
                content.querySelectorAll(
                  ".MuiTypography-root.MuiTypography-body1"
                )
              ).find((el) => /^\$\d+(\.\d{2})?$/.test(el.textContent.trim()));
              return priceEl?.textContent.trim() ?? null;
            })();

            const price = priceText
              ? parseFloat(priceText.replace(/[^0-9.]/g, ""))
              : null;

            result.push({ time, price, minPlayers, maxPlayers });
          }

          return result;
        });

        const parsedDate = new Date(currentDateText);
        const formattedDate = formatDbDate(parsedDate);
        const scrapedAt = new Date();

        const dataWithMeta = teeTimes.map((t) => ({
          time: t.time,
          course: course.name,
          minPlayers: t.minPlayers,
          maxPlayers: t.maxPlayers,
          price: t.price,
          date: formattedDate,
          dateISO: parsedDate,
          scrapedAt,
        }));

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
