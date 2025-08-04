const User = require('../models/User');
const Reminder = require('../models/Reminder');
const sendReminder = require('./sendReminder'); // ✅ Add this

module.exports = async function handleReminders(interaction, commandName, duration) {
  const user = interaction.userData;

  const remind = interaction.options.getBoolean('reminder') 
    ?? user?.reminderPreferences?.reminder ?? false;

  const remindInChannel = interaction.options.getBoolean('remindinchannel') 
    ?? user?.reminderPreferences?.remindInChannel ?? true;

  // Save new preferences
  if (
    user.reminderPreferences?.reminder !== remind ||
    user.reminderPreferences?.remindInChannel !== remindInChannel
  ) {
    user.reminderPreferences = {
      reminder: remind,
      remindInChannel: remindInChannel
    };
    await user.save();
  }

  if (!remind) return;

  const expiresAt = new Date(Date.now() + duration);

  const reminder = await Reminder.create({
    userId: interaction.user.id,
    channelId: remindInChannel ? interaction.channel.id : null,
    command: commandName,
    expiresAt
  });

  // ✅ Schedule the reminder immediately so it works without a restart
  setTimeout(() => sendReminder(interaction.client, reminder), duration);
};