// utils/safeReply.js
const EPH_FLAG = 1 << 6;
const TRANSIENT = new Set([10062, 40060, 10015, 'InteractionAlreadyReplied']);
const isComponent = (i) => i?.isButton?.() || i?.isStringSelectMenu?.() || false;
const codeOf = (e) => e?.code || e?.rawError?.code || e?.status;

async function safeDefer(interaction, { ephemeral = false } = {}) {
  const flags = ephemeral ? EPH_FLAG : undefined;
  try {
    if (interaction.deferred || interaction.replied) return true;
    if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) { await interaction.deferReply({ flags }); return true; }
    if (isComponent(interaction)) { await interaction.deferUpdate(); return true; }
    if (interaction.isRepliable?.()) { await interaction.deferReply({ flags }); return true; }
    return false;
  } catch (err) {
    if (!TRANSIENT.has(codeOf(err))) console.warn('safeDefer failed:', err?.message || err);
    return true;
  }
}

async function safeReply(interaction, payload, { preferFollowUp = false, componentFollowUp = false } = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const hasBody =
    !!data.content ||
    (Array.isArray(data.embeds) && data.embeds.length) ||
    (Array.isArray(data.files) && data.files.length) ||
    (Array.isArray(data.components) && data.components.length);
  if (!hasBody) { console.warn('safeReply: skipped empty payload'); return null; }

  if ('ephemeral' in data) { const eph = !!data.ephemeral; delete data.ephemeral; data.flags = eph ? EPH_FLAG : data.flags; }

  try {
    // Components: prefer update() -> editReply() -> followUp()
    if (isComponent(interaction)) {
      if (componentFollowUp) return await interaction.followUp(data); // opt-in to new msg
      if (typeof interaction.update === 'function') { try { return await interaction.update(data); } catch {} }
      try { return await interaction.editReply(data); } catch {}
      return await interaction.followUp(data);
    }

    if (interaction.deferred && !interaction.replied && !preferFollowUp) {
      try { return await interaction.editReply(data); } catch { return await interaction.followUp(data); }
    }
    if (!interaction.deferred && !interaction.replied && !preferFollowUp) {
      return await interaction.reply(data);
    }
    return await interaction.followUp(data);
  } catch (err) {
    const code = codeOf(err);
    if (code !== 10062 && code !== 10015) { try { return await interaction.followUp(data); } catch {} }
    console.warn(`safeReply final fail (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

module.exports = { safeReply, safeDefer };