// src/utils/safeReply.js
function isComponent(i) {
  return i?.isButton?.() || i?.isStringSelectMenu?.() || false;
}

const TRANSIENT = new Set([
  10062,                   // Unknown interaction (expired or already used)
  40060,                   // Interaction already acknowledged
  10015,                   // Unknown webhook (fetchReply on component / deleted original)
  'InteractionAlreadyReplied'
]);

function codeOf(err){ return err?.code || err?.rawError?.code || err?.status; }

/** Defer safely: slash/modal => deferReply; components => deferUpdate */
async function safeDefer(interaction, options = {}) {
  try {
    if (interaction.deferred || interaction.replied) return true;
    if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) {
      await interaction.deferReply(options);
      return true;
    }
    if (isComponent(interaction)) {
      await interaction.deferUpdate();
      return true;
    }
    if (interaction.isRepliable?.()) {
      await interaction.deferReply(options);
      return true;
    }
    return false;
  } catch (err) {
    if (TRANSIENT.has(codeOf(err))) return true;
    console.warn('safeDefer: failed to defer:', err?.message || err);
    return false;
  }
}

/** Reply/Edit/FollowUp safely. For components, prefer followUp after deferUpdate. */
async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;
  const isComp = isComponent(interaction);

  try {
    // First response if nothing was sent yet and we don't prefer followUp
    if (!interaction.deferred && !interaction.replied && !preferFollowUp) {
      return await interaction.reply(data);
    }

    // Components (after deferUpdate) cannot edit original reply; use followUp
    if (isComp) {
      return await interaction.followUp(data);
    }

    // Slash/modal after deferReply -> edit; fallback to followUp
    if (interaction.deferred && !preferFollowUp) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); }
    }

    return await interaction.followUp(data);
  } catch (err) {
    const code = codeOf(err);

    // One silent retry to followUp unless token is clearly dead
    if (code !== 10062 && code !== 10015) {
      try { return await interaction.followUp(data); } catch {}
    }

    // (Optional) last resort to channel (non-ephemeral). Comment out if undesired.
    try {
      if (interaction.channel?.send) {
        const { content, embeds, files, components, allowedMentions } = data;
        return await interaction.channel.send({ content: content ?? ' ', embeds, files, components, allowedMentions });
      }
    } catch {}

    console.warn(`safeReply failed (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

/** Watchdog: auto-defer after ~450ms if your code stalls before calling safeDefer */
function withAckGuard(interaction, { timeoutMs = 450, options = {} } = {}) {
  let timer = setTimeout(async () => {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await safeDefer(interaction, options);
      }
    } catch {}
  }, timeoutMs);

  return { end() { if (timer) { clearTimeout(timer); timer = null; } } };
}

// --- add below withAckGuard ---

function isTransientErr(err) {
  const code = codeOf(err);
  return code === 10062 /* Unknown interaction */ ||
         code === 40060 /* Already acknowledged */ ||
         code === 'InteractionAlreadyReplied' ||
         code === 10015 /* Unknown webhook */;
}

/**
 * Race-based ACK for slash/modals:
 * - tries deferReply() immediately
 * - also tries a tiny reply() 120ms later
 * whichever succeeds first "wins" the ACK
 *
 * Returns: { ok:boolean, mode:'defer'|'reply'|'already'|'fail', ms:number }
 *
 * NOTE: default ephemeral=false so your public commands stay public.
 * If a command MUST be ephemeral, you can pass { ephemeral:true } from the caller.
 */
async function ackFast(interaction, { ephemeral = false, bannerText = 'Working…' } = {}) {
  const start = Date.now();
  if (interaction.deferred || interaction.replied) {
    return { ok: true, mode: 'already', ms: 0 };
  }

  let settled = false;
  let mode = 'fail';

  const settle = (m) => { if (!settled) { settled = true; mode = m; } };

  // Path A: defer (preferred)
  const pDefer = interaction.deferReply({ ephemeral })
    .then(() => settle('defer'))
    .catch((e) => { if (!isTransientErr(e)) console.warn('ackFast defer error:', e?.message || e); });

  // Path B: tiny reply after a short stagger (to avoid same-tick bucket contention)
  const pReply = new Promise((r) => setTimeout(r, 120))
    .then(() => interaction.reply({ ephemeral, content: bannerText }))
    .then(() => settle('reply'))
    .catch((e) => { if (!isTransientErr(e)) console.warn('ackFast reply error:', e?.message || e); });

  // Wait briefly for either to win
  await Promise.race([
    Promise.allSettled([pDefer, pReply]),
    new Promise(res => setTimeout(res, 800))
  ]);

  if (settled) return { ok: true, mode, ms: Date.now() - start };

  // Neither finished quickly; wait a bit more to see if one eventually resolves
  try {
    await Promise.any([pDefer, pReply]);
    return { ok: true, mode, ms: Date.now() - start };
  } catch {
    return { ok: false, mode: 'fail', ms: Date.now() - start };
  }
}

module.exports = safeReply;
module.exports.safeReply = safeReply;
module.exports.safeDefer = safeDefer;
module.exports.withAckGuard = withAckGuard;