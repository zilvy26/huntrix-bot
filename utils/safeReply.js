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
// src/utils/safeReply.js  (replace the middle of safeReply)

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

    // ⬇️ NEW: for slash/modal, if we've already ACKed (deferred OR replied),
    // prefer editing the original response.
    if ((interaction.isChatInputCommand?.() || interaction.isModalSubmit?.())
        && (interaction.deferred || interaction.replied)
        && !preferFollowUp) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); }
    }

    // Fallback
    return await interaction.followUp(data);
  } catch (err) {
    // ... keep your existing catch body ...
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

// utils/safeReply.js

function isTransientErr(err) {
  const code = err?.code || err?.rawError?.code;
  return code === 10062 /* Unknown interaction */ ||
         code === 40060 /* Already acknowledged */ ||
         code === 'InteractionAlreadyReplied' ||
         code === 10015 /* Unknown webhook */;
}

/**
 * Race-based ACK for slash/modals.
 * Returns { ok:boolean, mode:'defer'|'reply'|'already'|'fail', ms:number }
 */
async function ackFast(interaction, { ephemeral = false, bannerText = 'Working…', raceMs = 2000 } = {}) {
  const start = Date.now();

  if (interaction.deferred || interaction.replied) {
    return { ok: true, mode: 'already', ms: 0 };
  }

  // Fire both paths
  const pDefer = interaction.deferReply({ ephemeral })
    .catch(e => { if (!isTransientErr(e)) console.warn('ackFast defer error:', e?.message || e); });

  // Small stagger reduces same-tick bucket collisions
  const pReply = new Promise(r => setTimeout(r, 80))
    .then(() => interaction.reply({ ephemeral, content: bannerText }))
    .catch(e => { if (!isTransientErr(e)) console.warn('ackFast reply error:', e?.message || e); });

  // Helper: see which settles first successfully
  const tag = async (p, name) => p.then(() => name).catch(() => null);
  let mode = await Promise.race([
    tag(pDefer, 'defer'),
    tag(pReply, 'reply'),
    new Promise(r => setTimeout(() => r(null), raceMs))
  ]);

  // If neither finished during the race window, wait to see if one eventually wins
  if (!mode) {
    try {
      await Promise.any([pDefer, pReply]);
      // Determine which one actually won by observing the interaction flags
      mode = interaction.deferred ? 'defer' : (interaction.replied ? 'reply' : 'fail');
    } catch {
      mode = 'fail';
    }
  }

  return {
    ok: interaction.deferred || interaction.replied,
    mode,
    ms: Date.now() - start
  };
}

module.exports = safeReply;
module.exports.safeReply = safeReply;
module.exports.safeDefer = safeDefer;
module.exports.withAckGuard = withAckGuard;
module.exports.ackFast = ackFast;