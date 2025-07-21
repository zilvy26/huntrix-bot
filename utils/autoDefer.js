module.exports = async function autoDefer(interaction, type = 'reply') {
  try {
    if (!interaction.deferred && !interaction.replied) {
      return type === 'update' ? await interaction.deferUpdate() : await interaction.deferReply();
    }
  } catch (err) {
    console.warn('Auto-defer failed:', err.message);
  }
};