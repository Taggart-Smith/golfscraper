// cliTeeTimes.js
import { MongoClient } from 'mongodb';
import inquirer from 'inquirer';

const MONGO_URI = 'mongodb+srv://smithtaggart15:3U8pODunzZu9luDh@cluster0.f4y4i0g.mongodb.net/';
const DB_NAME = 'golf';
const COLLECTION_NAME = 'tee_times';

async function cliTeeTimes() {
  const client = new MongoClient(MONGO_URI);

  try {
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);

    const courses = await collection.distinct('course');

    // Prompt for course selection
    const courseAnswer = await inquirer.prompt([{
      type: 'list',
      name: 'course',
      message: 'Select a course (or choose "All Courses"):',
      choices: ['All Courses', ...courses],
    }]);

    // Prompt for date input
    const dateAnswer = await inquirer.prompt([{
      type: 'input',
      name: 'date',
      message: 'Enter a date (YYYY-MM-DD) or leave blank for all dates:',
      validate: input =>
        !input || /^\d{4}-\d{2}-\d{2}$/.test(input) || 'Please enter a valid date (YYYY-MM-DD)',
    }]);

    const course = courseAnswer.course;
    const date = dateAnswer.date;

    // Build MongoDB query filter
    const filter = {};
    if (course !== 'All Courses') {
      filter.course = course;
    }

    if (date) {
      const dateObj = new Date(date);
      const nextDay = new Date(dateObj);
      nextDay.setDate(dateObj.getDate() + 1);
      filter.dateISO = { $gte: dateObj, $lt: nextDay };
    }

    // Query the collection
    const teeTimes = await collection.find(filter).sort({ dateISO: 1, time: 1 }).toArray();

    if (teeTimes.length === 0) {
      console.log('\n❌ No tee times found.');
      return;
    }

    // Group tee times by course and date for neat display
    const grouped = {};
    teeTimes.forEach(tt => {
      const key = `${tt.course} | ${tt.date}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(tt);
    });

    // Display the results
    for (const key in grouped) {
      console.log(`\n⛳ ${key}`);
      grouped[key].forEach(tee => {
        console.log(`🕒 ${tee.time} | ${tee.minPlayers}-${tee.maxPlayers} players | $${tee.price?.toFixed(2)}`);
      });
    }
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await client.close();
  }
}

cliTeeTimes();
