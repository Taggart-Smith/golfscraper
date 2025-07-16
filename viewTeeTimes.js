const { MongoClient } = require('mongodb');

// MongoDB Config
const MONGO_URI = 'mongodb+srv://smithtaggart15:3U8pODunzZu9luDh@cluster0.f4y4i0g.mongodb.net/';
const DB_NAME = 'golf';
const COLLECTION_NAME = 'tee_times';

// Get CLI args
const targetCourse = process.argv[2]; // e.g. "Fox Hollow"
const targetDateArg = process.argv[3]; // e.g. "2025-07-18"
const targetDateISO = targetDateArg ? new Date(targetDateArg) : null;

async function viewTeeTimes() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    // Build query filter
    const matchFilter = {};
    if (targetCourse) matchFilter.course = targetCourse;
    if (targetDateISO) {
      // Match only the specific day (ignore time)
      const nextDay = new Date(targetDateISO);
      nextDay.setDate(nextDay.getDate() + 1);
      matchFilter.dateISO = { $gte: targetDateISO, $lt: nextDay };
    }

    const teeTimes = await collection.find(matchFilter)
      .sort({ dateISO: 1, time: 1 })
      .toArray();

    if (teeTimes.length === 0) {
      console.log(`❌ No tee times found.`);
      return;
    }

    const groupedByCourseAndDate = {};

    teeTimes.forEach(tt => {
      const key = `${tt.course} | ${tt.date}`;
      if (!groupedByCourseAndDate[key]) {
        groupedByCourseAndDate[key] = [];
      }
      groupedByCourseAndDate[key].push(tt);
    });

    for (const key of Object.keys(groupedByCourseAndDate)) {
      console.log(`\n⛳ ${key}`);
      for (const tee of groupedByCourseAndDate[key]) {
        console.log(
          `🕒 ${tee.time} | ${tee.minPlayers || "-"}-${tee.maxPlayers || "-"} players | $${tee.price?.toFixed(2) || "N/A"}`
        );
      }
    }

    console.log('\n✅ Tee times listed successfully.\n');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

viewTeeTimes();
