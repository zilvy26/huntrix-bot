const Reminder = require('../models/Reminder');

module.exports = async function sendReminder(client, reminder) {
  try {
    const { userId, channelId, command } = reminder;
    const message = `<@${userId}>, \`${command}\` cooldown is over!`;

    console.log(`Sending reminder for ${command} to user ${userId}${channelId ? ` in channel ${channelId}` : ' via DM'}`);

    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(err => {
        console.error(`❌ Could not fetch channel ${channelId}:`, err.message);
        return null;
      });
      if (channel) {
        await channel.send(message).catch(err => {
          console.error(`❌ Failed to send message in channel ${channelId}:`, err.message);
        });
      }
    } else {
      const user = await client.users.fetch(userId).catch(err => {
        console.error(`❌ Could not fetch user ${userId}:`, err.message);
        return null;
      });
      if (user) {
        await user.send(message).catch(err => {
          console.error(`❌ Failed to send DM to user ${userId}:`, err.message);
        });
      }
    }

    await Reminder.deleteOne({ _id: reminder._id }).catch(err => {
      console.error(`❌ Failed to delete reminder ${reminder._id}:`, err.message);
    });
  } catch (err) {
    console.error('❌ Unexpected error in sendReminder:', err);
  }
};