const Reminder = require('../models/Reminder');

module.exports = async function sendReminder(client, reminder) {
  try {
    const { userId, channelId, command } = reminder;
    const message = `<@${userId}>, \`${command}\` cooldown is over!`;

    let sent = false;

    if (channelId) {
      try {
        const channel = await client.channels.fetch(channelId);

        if (channel?.isTextBased?.()) {
          await channel.send(message);
          sent = true;
        }
      } catch (err) {
        console.warn(`⚠️ Could not send reminder to channel ${channelId}: ${err.message}`);
      }
    }

    // Fallback: Send DM
    if (!sent) {
      try {
        const user = await client.users.fetch(userId);
        if (user) await user.send(message);
      } catch (err) {
        console.warn(`⚠️ Could not send reminder DM to ${userId}: ${err.message}`);
      }
    }

    await Reminder.deleteOne({ _id: reminder._id });
  } catch (err) {
    console.error('❌ Failed to send reminder:', err.message);
  }
};