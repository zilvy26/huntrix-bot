const Reminder = require('../models/Reminder');

module.exports = async function sendReminder(client, reminder) {
  try {
    const { userId, channelId, command } = reminder;
    const message = `<@${userId}>, \`${command}\` cooldown is over!`;

    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(() => null);
      if (channel) await channel.send(message);
    } else {
      const user = await client.users.fetch(userId).catch(() => null);
      if (user) await user.send(message);
    }

    await Reminder.deleteOne({ _id: reminder._id });
  } catch (err) {
    console.error('Failed to send reminder:', err.message);
  }
};