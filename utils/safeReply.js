module.exports = async function safeReply(interaction, options = {}) {
  try {
    // Remove ephemeral if it's editReply
    const cleanOptions = { ...options };
    if (interaction.replied || interaction.deferred) {
      delete cleanOptions.ephemeral;
      return await interaction.editReply(cleanOptions);
    } else {
      return await interaction.reply(cleanOptions);
    }
  } catch (err) {
    console.warn('Failed to reply to interaction:', err.message);
  }
};