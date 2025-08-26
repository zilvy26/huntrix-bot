// utils/safeReply.js (strict, single-message)
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
    if (TRANSIENT.has(codeOf(err))) return true;
    console.warn('safeDefer failed:', err?.message || err);
    return false;
  }
}

async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;  // set true for Mode B if you want

  // disallow empty sends
  const hasBody = !!data.content ||
    (Array.isArray(data.embeds) && data.embeds.length) ||
    (Array.isArray(data.files) && data.files.length) ||
    (Array.isArray(data.components) && data.components.length);
  if (!hasBody) { console.warn('safeReply: skipped empty payload'); return null; }

  if ('ephemeral' in data) { const eph = !!data.ephemeral; delete data.ephemeral; data.flags = eph ? EPH_FLAG : data.flags; }

  try {
    if (!interaction.deferred && !interaction.replied && !preferFollowUp && !isComponent(interaction)) {
      return await interaction.reply(data);
    }
    if (isComponent(interaction)) return await interaction.followUp(data);

    // Mode A: edit first output if deferred and not forcing followUp
    if (interaction.deferred && !preferFollowUp) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); }
    }

    // Mode B: first output is followUp
    return await interaction.followUp(data);
  } catch (err) {
    const code = codeOf(err);
    if (code !== 10062 && code !== 10015) { try { return await interaction.followUp(data); } catch {} }
    console.warn(`safeReply final fail (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

function withAckGuard(){ return { end(){} }; }  // disabled
async function ackFast(){ return { ok:true, mode:'skip', ms:0 }; } // don’t use

module.exports = safeReply;
module.exports.safeReply = safeReply;
module.exports.safeDefer = safeDefer;
module.exports.withAckGuard = withAckGuard;
module.exports.ackFast = ackFast;