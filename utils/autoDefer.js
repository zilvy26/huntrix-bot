module.exports = async function autoDefer(interaction, type = 'reply') {
  if (interaction.deferred || interaction.replied) return;

  try {
    if (type === 'update') {
      await interaction.deferUpdate();
    } else {
      await interaction.deferReply();
    }
  } catch (err) {
    console.warn(`Auto-defer failed [${type}]:`, err.message);
  }
};