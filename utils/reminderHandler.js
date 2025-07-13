const User = require('../models/User');

/**
 * Handles reminder preference persistence and sets up reminders.
 * @param {object} interaction - Discord interaction
 * @param {string} commandName - The command being run
 * @param {number} duration - Cooldown duration (in ms)
 */
async function handleReminders(interaction, commandName, duration) {
  const user = interaction.userData;

  const remind = interaction.options.getBoolean('reminder') 
    ?? user?.reminderPreferences?.reminder ?? false;

  const remindInChannel = interaction.options.getBoolean('remindinchannel') 
    ?? user?.reminderPreferences?.remindInChannel ?? true;

  // Save new preferences if changed
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

  // Set reminder message
  if (remind) {
    setTimeout(async () => {
      const msg = `<@${interaction.user.id}>, \`/${commandName}\` cooldown is over!`;
      try {
        if (remindInChannel && interaction.channel) {
          await interaction.channel.send(msg);
        } else {
          await interaction.user.send(msg);
        }
      } catch (err) {
        console.warn(`❌ Reminder failed for ${interaction.user.id}:`, err.message);
      }
    }, duration);
  }
}

module.exports = handleReminders;