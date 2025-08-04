const Reminder = require('../models/Reminder');

module.exports = async function sendReminder(client, reminder) {
  try {
    const { userId, channelId, command } = reminder;
    const message = `⏰ <@${userId}>, \`${command}\` cooldown is over!`;

    console.log(`🔔 Triggering reminder:
- User: ${userId}
- Command: ${command}
- Channel: ${channelId || 'DM'}
- Expires: ${reminder.expiresAt}`);

    if (channelId) {
      const channel = await client.channels.fetch(channelId).catch(err => {
        console.error(`❌ Could not fetch channel ${channelId}:`, err.message);
        return null;
      });

      if (channel) {
        const target = channel.isThread() ? channel : (channel.threads?.cache.first() || channel);
        await target.send(message).catch(err => {
          console.error(`❌ Failed to send message in ${channelId}:`, err.message);
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