// utils/safeReply.js
/**
 * Safe reply helpers for discord.js v14.
 * - Works for slash commands, buttons, select menus, and modals.
 * - Chooses reply()/editReply()/followUp() automatically based on state.
 * - Includes safeDefer() and an ack guard to avoid the 3s timeout.
 */

function isComponent(interaction) {
  return interaction?.isButton?.() || interaction?.isStringSelectMenu?.() || false;
}

async function safeDefer(interaction, options = {}) {
  try {
    if (interaction.deferred || interaction.replied) return true;

    if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) {
      await interaction.deferReply(options); // { ephemeral?: boolean }
      return true;
    }

    if (isComponent(interaction)) {
      await interaction.deferUpdate(); // loading state on original message
      return true;
    }

    if (interaction.isRepliable?.()) {
      await interaction.deferReply(options);
      return true;
    }
    return false;
  } catch (err) {
    console.warn('safeDefer: failed to defer:', err?.message || err);
    return false;
  }
}

/**
 * Safely send content back (auto reply/editReply/followUp).
 * @param {Interaction} interaction
 * @param {object|string} payload
 * @param {{ preferFollowUp?: boolean }} opts
 */
async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;
  const isComp = isComponent(interaction);

  try {
    // Fresh interaction
    if (!interaction.deferred && !interaction.replied) {
      return await interaction.reply(data);
    }

    // Already acknowledged
    if (isComp) {
      // After deferUpdate() there is no original reply; use followUp
      return await interaction.followUp(data);
    }

    if (interaction.deferred && !preferFollowUp) {
      try {
        return await interaction.editReply(data);
      } catch (e) {
        // If edit fails (e.g. original deleted), try followUp
        return await interaction.followUp(data);
      }
    }

    return await interaction.followUp(data);
  } catch (err) {
    const code = err?.code || err?.rawError?.code || err?.status;
    const retryable = code === 503 || code === 'ECONNRESET' || code === 'ETIMEDOUT';
    const unknownInteraction = code === 10062; // token dead, don’t retry

    if (retryable && !unknownInteraction) {
      try {
        return await interaction.followUp(data);
      } catch (e2) {
        // swallow, try channel fallback below
      }
    }

    // Last resort (non-ephemeral)
    try {
      if (interaction?.channel?.send) {
        const { content, embeds, files, components, allowedMentions } = data;
        return await interaction.channel.send({
          content: content ?? ' ',
          embeds,
          files,
          components,
          allowedMentions
        });
      }
    } catch {}

    console.warn(`safeReply failed (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

/**
 * Ack guard: if nothing replied within timeoutMs, auto-defer.
 */
function withAckGuard(interaction, { timeoutMs = 450, ephemeral = false } = {}) {
  let timer = setTimeout(async () => {
    if (!interaction.deferred && !interaction.replied) {
      await safeDefer(interaction, { ephemeral });
    }
  }, timeoutMs);

  return {
    end: () => clearTimeout(timer),
  };
}

module.exports = {
  safeReply,
  safeDefer,
  withAckGuard,
};