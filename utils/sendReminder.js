// utils/sendReminder.js
const Reminder = require('../models/Reminder');
const { sendChannelMessage, sendDM } = require('./discordRest');

module.exports = async function sendReminder(reminderDocOrId) {
  // Accept either a Reminder document/object or just {_id,...}
  const rem = reminderDocOrId._id ? reminderDocOrId
                                  : await Reminder.findById(reminderDocOrId).lean();
  if (!rem) return;

  const { _id, userId, channelId, command } = rem;
  const message = `<@${userId}>, \`/${command}\` cooldown is over!`;

  let delivered = false;

  // Try channel first (if provided)
  if (channelId) {
    try {
      await sendChannelMessage(channelId, { content: message });
      delivered = true;
    } catch (err) {
      console.warn(`⚠️ Could not send reminder to channel ${channelId}: ${err?.message || err}`);
    }
  }

  // Fallback to DM
  if (!delivered) {
    try {
      await sendDM(userId, { content: message });
      delivered = true;
    } catch (err) {
      // This usually means DMs are closed
      console.warn(`⚠️ Could not send reminder DM to ${userId}: ${err?.message || err}`);
    }
  }

  // Clean up the reminder (whether delivered or we tried)
  try {
    await Reminder.deleteOne({ _id });
  } catch (err) {
    console.warn(`⚠️ Could not delete reminder ${_id}: ${err?.message || err}`);
  }
};