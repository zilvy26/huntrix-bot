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
module.exports = async function awaitUserButton(interaction, user, customIds = [], timeout = 60000) {
  if (!interaction.replied && !interaction.deferred) {
    throw new Error('Interaction must be replied or deferred before awaiting a button.');
  }

  const msg = await interaction.fetchReply();

  return new Promise((resolve) => {
    const collector = msg.createMessageComponentCollector({
      componentType: ComponentType.Button,
      time: timeout,
      filter: (btn) => {
        return btn.user.id === user.id && customIds.includes(btn.customId);
      }
    });

    collector.on('collect', (btnInteraction) => {
      collector.stop('collected');
      resolve(btnInteraction);
    });

    collector.on('end', (_, reason) => {
      if (reason !== 'collected') resolve(null);
    });
  });
};