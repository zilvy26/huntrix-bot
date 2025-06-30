// batch-migrate-reminders.js
const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI;
if (!MONGODB_URI) {
  console.error("❌ Missing MONGODB_URI in .env");
  process.exit(1);
}

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => {
  console.log("✅ Connected!");
  return mongoose.connection.db.collection('users');
})
.then(async (collection) => {
  const filter = {
    $or: [
      { reminderPreferences: { $exists: false } },
      { 'reminderPreferences.reminder': { $exists: true } },
      { 'reminderPreferences.remindInChannel': { $exists: true } }
    ]
  };

  const update = {
    $set: {
      'reminderPreferences.reminder': true,
      'reminderPreferences.remindInChannel': true
    }
  };

  const result = await collection.updateMany(filter, update);
  console.log(`✅ ${result.modifiedCount} user(s) updated.`);
})
.catch(err => {
  console.error("❌ Error:", err);
})
.finally(() => {
  mongoose.connection.close();
});