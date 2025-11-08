const mongoose = require('mongoose');
const User = require('../models/User'); // adjust path if needed
require('dotenv').config();

// === CONFIG ===
const MONGO_URI = process.env.MONGO_URI; // <-- change this

(async () => {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB');

    const users = await User.find({}, { userId: 1, username: 1, patterns: 1, sopop: 1 });
    console.log(`Found ${users.length} users`);

    const operations = users.map(user => {
      const sopopToPatterns = user.sopop * 2500;
      const newBalance = Math.floor((user.patterns + sopopToPatterns) * 1.85);

      return {
        updateOne: {
          filter: { _id: user._id },
          update: {
            $set: {
              patterns: newBalance,
              sopop: 0 // optional: reset sopop
            }
          }
        }
      };
    });

    if (operations.length > 0) {
      const result = await User.bulkWrite(operations);
      console.log(`🎉 Bulk update completed!`);
      console.log(`Matched: ${result.matchedCount}, Modified: ${result.modifiedCount}`);
    } else {
      console.log('No users found to update.');
    }

    await mongoose.disconnect();
    console.log('✅ Disconnected from MongoDB');
  } catch (error) {
    console.error('❌ Error during conversion:', error);
  }
})();