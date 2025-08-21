// utils/awaitUserButton.js
const { ComponentType } = require('discord.js');

/**
 * Waits for a button click by a specific user on the original reply.
 * @param {ChatInputCommandInteraction} interaction - original slash interaction (already replied/deferred)
 * @param {string} userId - allowed clicker ID
 * @param {string[]} ids - allowed customIds
 * @param {number} timeoutMs - collector timeout (default 120s)
 * @returns {Promise<import('discord.js').ButtonInteraction | null>}
 */
module.exports = async function awaitUserButton(interaction, userId, ids, timeoutMs = 120000) {
  let msg;
  try {
    msg = await interaction.fetchReply();
  } catch (e) {
    // If the reply was deleted or never existed, there’s nothing to collect on
    console.warn('[awaitUserButton] fetchReply failed:', e?.message || e);
    return null;
  }

  const filter = i => i.user.id === userId && ids.includes(i.customId);

  const collector = msg.createMessageComponentCollector({
    componentType: ComponentType.Button,
    time: timeoutMs,
    filter
  });

  return new Promise(resolve => {
    let resolved = false;

    collector.on('collect', async i => {
      // ACK the button ASAP
      if (!i.deferred && !i.replied) {
        try {
          await i.deferUpdate();
        } catch (err) {
          const code = err?.code || err?.rawError?.code;
          // 10062 = Unknown interaction (expired/used), 40060 = already acked
          if (code !== 10062 && code !== 40060) {
            console.warn('[awaitUserButton] deferUpdate failed',
              { customId: i.customId, msgId: msg.id, code, err: err?.message || err });
          }
          // Continue anyway; caller can still act on i (or ignore)
        }
      }

      if (!resolved) {
        resolved = true;
        resolve(i);
        collector.stop('answered');
      }
    });

    collector.on('end', (_, resolved) => {
      if (!resolved) resolve(null); // timeout / cancelled
    });
  });
};