// utils/safeReply.js (backward-compatible exports + robust logic)

/** type guards */
function isComponent(i) { return i?.isButton?.() || i?.isStringSelectMenu?.() || false; }

/** Defer safely (no-throw if already acked) */
async function safeDefer(interaction, options = {}) {
  try {
    if (interaction.deferred || interaction.replied) return true;
    if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) {
      await interaction.deferReply(options);             // slash / modal
      return true;
    }
    if (isComponent(interaction)) {
      await interaction.deferUpdate();                   // buttons / menus
      return true;
    }
    if (interaction.isRepliable?.()) {
      await interaction.deferReply(options);
      return true;
    }
    return false;
  } catch (err) {
  const code = err?.code || err?.rawError?.code;
  if (
    code === 10062 /* Unknown interaction */ ||
    code === 40060 /* Interaction already acknowledged */ ||
    code === 'InteractionAlreadyReplied'
  ) {
    return true;
  }
  console.warn('safeDefer: failed to defer:', err?.message || err);
  return false;
}
}

/** Auto reply/editReply/followUp with fallbacks */
async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;
  const comp = isComponent(interaction);

  try {
    if (!interaction.deferred && !interaction.replied) {
      // Fresh — send first reply
      return await interaction.reply(data);
    }

    if (comp) {
      // After deferUpdate(), there is no original reply to edit
      return await interaction.followUp(data);
    }

    if (interaction.deferred && !preferFollowUp) {
      try {
        return await interaction.editReply(data);
      } catch {
        return await interaction.followUp(data);
      }
    }

    return await interaction.followUp(data);
  } catch (err) {
    const code = err?.code || err?.rawError?.code || err?.status;

    // Try followUp once for transient cases
    if (code !== 10062 /* Unknown interaction */) {
      try { return await interaction.followUp(data); } catch {}
    }

    // Last resort: send to channel (non-ephemeral)
    try {
      if (interaction.channel?.send) {
        const { content, embeds, files, components, allowedMentions } = data;
        return await interaction.channel.send({
          content: content ?? ' ', embeds, files, components, allowedMentions
        });
      }
    } catch {}

    console.warn(`safeReply failed (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

/** Guard: auto-defer if no reply within X ms */
function withAckGuard(interaction, { timeoutMs = 450, ephemeral = false } = {}) {
  const t = setTimeout(() => {
    if (!interaction.deferred && !interaction.replied) safeDefer(interaction, { ephemeral });
  }, timeoutMs);
  return { end: () => clearTimeout(t) };
}

/* ---- Exports (both styles supported) ---- */
module.exports = safeReply;                      // default/function export
module.exports.safeReply = safeReply;           // named export
module.exports.safeDefer = safeDefer;
module.exports.withAckGuard = withAckGuard;