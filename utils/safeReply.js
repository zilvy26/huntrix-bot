module.exports = async function safeReply(interaction, options = {}) {
  try {
    if (interaction.replied || interaction.deferred) {
      return await interaction.editReply(options);
    } else {
      return await interaction.reply(options);
    }
  } catch (err) {
    console.warn('Failed to reply to interaction:', err.message);
  }
};