// utils/reminderHandler.js
const User = require('../models/User');
const Reminder = require('../models/Reminder');

module.exports = async function handleReminders(interaction, commandName, duration) {
  const user = interaction.userData;

  const remind =
    interaction.options.getBoolean('reminder') ??
    user?.reminderPreferences?.reminder ?? false;

  const remindInChannel =
    interaction.options.getBoolean('remindinchannel') ??
    user?.reminderPreferences?.remindInChannel ?? true;

  // Save new prefs if changed
  if (
    user?.reminderPreferences?.reminder !== remind ||
    user?.reminderPreferences?.remindInChannel !== remindInChannel
  ) {
    user.reminderPreferences = { reminder: remind, remindInChannel };
    try { await user.save(); } catch {}
  }

  if (!remind) return;

  const expiresAt = new Date(Date.now() + duration);

  // Store reminder; worker poller will deliver on time
  await Reminder.create({
    userId: interaction.user.id,
    channelId: remindInChannel && interaction.channel?.id ? interaction.channel.id : null,
    command: commandName,
    expiresAt
  });

  // No setTimeout here — reliability comes from the worker poller.
};