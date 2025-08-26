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

  // Save prefs if changed
  if (
    user?.reminderPreferences?.reminder !== remind ||
    user?.reminderPreferences?.remindInChannel !== remindInChannel
  ) {
    user.reminderPreferences = { reminder: remind, remindInChannel };
    try { await user.save(); } catch {}
  }

  if (!remind) return;

  const expiresAt = new Date(Date.now() + duration);

  // ✅ Prefer interaction.channelId (always present for guild invocations in our shim)
  // Only store a channel when we're actually in a guild text/thread. If the command
  // was run in DMs, channelId should be null so we fall back to DM later.
  const isGuild = !!interaction.guildId || interaction.inGuild?.();
  const chanId =
    remindInChannel && isGuild
      ? (interaction.channel?.id || interaction.channelId || null)
      : null;

  await Reminder.create({
    userId: interaction.user.id,
    channelId: chanId,       // <-- now correctly set
    command: commandName,
    expiresAt
  });
};