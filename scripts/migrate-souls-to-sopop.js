const mongoose = require('mongoose');
require('dotenv').config();

const MONGODB_URI = process.env.MONGO_URI;

mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
}).then(() => {
  console.log("✅ Connected to MongoDB");
  return mongoose.connection.db.collection('users');
}).then(async (collection) => {

  // Step 1: Set sopop = 1 for ALL users (overwrite if exists)
  const result1 = await collection.updateMany(
    {},
    { $set: { sopop: 1 } }
  );
  console.log(`💰 Set sopop = 1 for ${result1.modifiedCount} user(s)`);

  // Step 2: Set patterns = 5000 if missing
  const result2 = await collection.updateMany(
    { patterns: { $exists: true } },
    { $set: { patterns: 5000 } }
  );
  console.log(`🎯 Set patterns = 5000 for ${result2.modifiedCount} user(s)`);

  // Step 3: Remove old souls field
  const result3 = await collection.updateMany(
    { souls: { $exists: true } },
    { $unset: { souls: "" } }
  );
  console.log(`🧹 Removed souls from ${result3.modifiedCount} user(s)`);

  console.log("✅ Final migration complete.");
  mongoose.connection.close();
}).catch(err => {
  console.error("❌ Migration error:", err);
});