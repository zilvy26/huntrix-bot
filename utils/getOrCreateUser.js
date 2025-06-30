const User = require('../models/User');

async function getOrCreateUser(interaction) {
  const userId = interaction.user.id;
  const username = interaction.user.username;

  let user = await User.findOne({ userId });

  if (!user) {
    user = await User.create({
      userId,
      username,
      reminderPreferences: {} // default values will be applied
    });
  } else {
    // Sync username if it changed
    if (user.username !== username) {
      user.username = username;
      await user.save();
    }
  }

  return user;
}

module.exports = getOrCreateUser;