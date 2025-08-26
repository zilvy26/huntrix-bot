// utils/safeReply.js — strict one-message helpers

const EPH_FLAG = 1 << 6;
const TRANSIENT = new Set([10062, 40060, 10015, 'InteractionAlreadyReplied']);
const isComponent = (i) => i?.isButton?.() || i?.isStringSelectMenu?.() || false;
const codeOf = (e) => e?.code || e?.rawError?.code || e?.status;

/** Call this yourself to ACK (slash/modal => deferReply; components => deferUpdate). */
async function safeDefer(interaction, { ephemeral = false } = {}) {
  const flags = ephemeral ? EPH_FLAG : undefined;
  try {
    if (interaction.deferred || interaction.replied) return true;

    if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) {
      await interaction.deferReply({ flags });
      return true;
    }
    if (isComponent(interaction)) {
      await interaction.deferUpdate();
      return true;
    }
    if (interaction.isRepliable?.()) {
      await interaction.deferReply({ flags });
      return true;
    }
    return false;
  } catch (err) {
    if (TRANSIENT.has(codeOf(err))) return true;
    console.warn('safeDefer failed:', err?.message || err);
    return false;
  }
}

/** Send once: edit if deferred, otherwise reply, otherwise followUp. Never sends empty payload. */
async function safeReply(interaction, payload) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});

  // map ephemeral -> flags for all methods
  if ('ephemeral' in data) {
    const eph = !!data.ephemeral;
    delete data.ephemeral;
    data.flags = eph ? EPH_FLAG : data.flags;
  }

  // prevent 50006 (cannot send empty message)
  const hasBody =
    !!data.content ||
    (Array.isArray(data.embeds) && data.embeds.length) ||
    (Array.isArray(data.files) && data.files.length) ||
    (Array.isArray(data.components) && data.components.length);
  if (!hasBody) {
    console.warn('safeReply: skipped empty payload');
    return null;
  }

  try {
    // Components use followUp after deferUpdate()
    if (isComponent(interaction)) {
      return await interaction.followUp(data);
    }

    // If we deferred, first output should be editReply
    if (interaction.deferred && !interaction.replied) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); }
    }

    // If not deferred/replied yet, reply now (counts as the ack)
    if (!interaction.deferred && !interaction.replied) {
      return await interaction.reply(data);
    }

    // Otherwise, normal followUp
    return await interaction.followUp(data);
  } catch (err) {
    const code = codeOf(err);
    // one retry with followUp unless interaction is gone
    if (code !== 10062 && code !== 10015) {
      try { return await interaction.followUp(data); } catch {}
    }
    console.warn(`safeReply final fail (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

// Legacy stubs so old calls don’t do anything noisy
async function ackFast() { return { ok: true, mode: 'skip', ms: 0 }; }
function withAckGuard() { return { end() {} }; }

module.exports = safeReply;
module.exports.safeReply = safeReply;
module.exports.safeDefer = safeDefer;
module.exports.ackFast = ackFast;
module.exports.withAckGuard = withAckGuard;