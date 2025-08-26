// utils/safeReply.js — strict one-message helpers (no watchdog, no dupes)

const EPH_FLAG = 1 << 6;
const TRANSIENT = new Set([10062, 40060, 10015, 'InteractionAlreadyReplied']);
const isComponent = (i) => i?.isButton?.() || i?.isStringSelectMenu?.() || false;
const codeOf = (e) => e?.code || e?.rawError?.code || e?.status;

/** ACK explicitly (slash/modal => deferReply; components => deferUpdate). */
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
    if (!TRANSIENT.has(codeOf(err))) {
      console.warn('safeDefer failed:', err?.message || err);
    }
    return true; // treat as acked on transient issues
  }
}

/** Send once: edit if deferred, else reply, else followUp. Never sends empty payload. */
async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;

  const hasBody =
    !!data.content ||
    (Array.isArray(data.embeds) && data.embeds.length) ||
    (Array.isArray(data.files) && data.files.length) ||
    (Array.isArray(data.components) && data.components.length);
  if (!hasBody) {
    console.warn('safeReply: skipped empty payload');
    return null;
  }

  if ('ephemeral' in data) {
    const eph = !!data.ephemeral;
    delete data.ephemeral;
    data.flags = eph ? EPH_FLAG : data.flags;
  }

  try {
    // components always follow up after deferUpdate()
    if (isComponent(interaction)) {
      return await interaction.followUp(data);
    }

    // first output after defer should be an edit
    if (interaction.deferred && !interaction.replied && !preferFollowUp) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); }
    }

    // fresh interaction => reply (counts as ACK)
    if (!interaction.deferred && !interaction.replied && !preferFollowUp) {
      return await interaction.reply(data);
    }

    // otherwise normal follow-up
    return await interaction.followUp(data);

  } catch (err) {
    const code = codeOf(err);
    if (code !== 10062 && code !== 10015) {
      try { return await interaction.followUp(data); } catch {}
    }
    console.warn(`safeReply final fail (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

// legacy no-ops so old imports don’t break
async function ackFast(){ return { ok:true, mode:'skip', ms:0 }; }
function withAckGuard(){ return { end(){} }; }

module.exports = { safeReply, safeDefer, ackFast, withAckGuard };