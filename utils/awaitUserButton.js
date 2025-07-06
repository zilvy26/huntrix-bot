const { ComponentType } = require('discord.js');

/**
 * Waits for a button interaction from a specific user.
 *
 * @param {CommandInteraction} interaction - The original interaction (must already be replied or deferred)
 * @param {User} user - The user who is allowed to click
 * @param {string[]} customIds - Array of customIds to listen for (e.g., ['confirm', 'cancel'])
 * @param {number} timeout - How long to wait for interaction (in ms, default: 60s)
 * @returns {Promise<ButtonInteraction|null>} - The interaction if confirmed, or null on timeout
 */
module.exports = async function awaitUserButton(interaction, userId, ids, timeout = 120000) {
  const message = await interaction.fetchReply();
  return new Promise((resolve) => {
    const collector = message.createMessageComponentCollector({
      filter: i => i.user.id === userId && ids.includes(i.customId),
      time: timeout
    });

    collector.on('collect', async (btnInteraction) => {
  try {
    if (!btnInteraction.replied && !btnInteraction.deferred) {
      await btnInteraction.deferUpdate(); // Prevent "already acknowledged" error
    }
  } catch (e) {
    console.warn('Button defer failed:', e.message);
  }

  collector.stop('collected');
  resolve(btnInteraction);
});

    collector.on('end', (_, reason) => {
      if (reason !== 'collected') resolve(null);
    });
  });
};