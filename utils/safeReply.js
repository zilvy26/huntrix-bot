// utils/safeReply.js (STRICT, single-message only)

const EPH_FLAG = 1 << 6;
const TRANSIENT = new Set([10062, 40060, 10015, 'InteractionAlreadyReplied']);

const isComponent = (i) => i?.isButton?.() || i?.isStringSelectMenu?.() || false;
const codeOf = (e) => e?.code || e?.rawError?.code || e?.status;

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

async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;

  // Prevent “empty message”
  const hasBody =
    !!data.content ||
    (Array.isArray(data.embeds) && data.embeds.length) ||
    (Array.isArray(data.files) && data.files.length) ||
    (Array.isArray(data.components) && data.components.length);
  if (!hasBody) {
    // map ephemeral then bail with a warning, but DO NOT send anything
    if ('ephemeral' in data) delete data.ephemeral;
    console.warn('safeReply: skipped empty payload to avoid extra blank message');
    return null;
  }
  // map ephemeral -> flags
  if ('ephemeral' in data) {
    const eph = !!data.ephemeral;
    delete data.ephemeral;
    data.flags = eph ? EPH_FLAG : data.flags;
  }

  try {
    if (!interaction.deferred && !interaction.replied && !preferFollowUp && !isComponent(interaction)) {
      return await interaction.reply(data);
    }

    if (isComponent(interaction)) {
      return await interaction.followUp(data); // after deferUpdate()
    }

    if (interaction.deferred && !preferFollowUp) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); }
    }

    return await interaction.followUp(data);
  } catch (err) {
    const code = codeOf(err);
    // one last attempt with followUp unless interaction is gone
    if (code !== 10062 && code !== 10015) {
      try { return await interaction.followUp(data); } catch {}
    }
    console.warn(`safeReply final fail (${code ?? 'no-code'}):`, err?.message || err);
    return null; // 🚫 no channel.send fallback = no second message
  }
}

function withAckGuard(_interaction, { timeoutMs = 0 } = {}) {
  return { end() {} }; // disabled by default (prevents accidental placeholders)
}

async function ackFast(interaction, {
  ephemeral = false,
  replyFallback = false,     // default off => defer-only
  replyDelayMs = 120,
  raceTimeoutMs = 800
} = {}) {
  const flags = ephemeral ? EPH_FLAG : undefined;
  const start = Date.now();
  if (interaction.deferred || interaction.replied) {
    return { ok: true, mode: 'already', ms: 0 };
  }

  let settled = false;
  let mode = 'fail';
  const settle = (m) => { if (!settled) { settled = true; mode = m; } };

  const pDefer = interaction.deferReply({ flags })
    .then(() => settle('defer'))
    .catch((e) => { if (!TRANSIENT.has(codeOf(e))) console.warn('ackFast defer error:', e?.message || e); });

  const pReply = replyFallback
    ? new Promise((r) => setTimeout(r, replyDelayMs))
        .then(() => interaction.reply({ flags, content: '\u200b' }))
        .then(() => settle('reply'))
        .catch((e) => { if (!TRANSIENT.has(codeOf(e))) console.warn('ackFast reply error:', e?.message || e); })
    : Promise.resolve();

  await Promise.race([
    Promise.allSettled([pDefer, pReply]),
    new Promise(res => setTimeout(res, raceTimeoutMs))
  ]);

  if (settled) return { ok: true, mode, ms: Date.now() - start };
  try { await Promise.any([pDefer, pReply]); return { ok: true, mode, ms: Date.now() - start }; }
  catch { return { ok: false, mode: 'fail', ms: Date.now() - start }; }
}

module.exports = safeReply;
module.exports.safeReply = safeReply;
module.exports.safeDefer = safeDefer;
module.exports.withAckGuard = withAckGuard;
module.exports.ackFast = ackFast;