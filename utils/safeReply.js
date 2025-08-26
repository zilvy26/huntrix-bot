// utils/safeReply.js
function isComponent(i) {
  return i?.isButton?.() || i?.isStringSelectMenu?.() || false;
}

const TRANSIENT = new Set([
  10062, // Unknown interaction (expired or already used)
  40060, // Interaction already acknowledged
  10015, // Unknown webhook
  'InteractionAlreadyReplied'
]);

const EPH_FLAG = 1 << 6; // ephemeral flag for interaction responses

function codeOf(err){ return err?.code || err?.rawError?.code || err?.status; }

/** Defer safely: slash/modal => deferReply; components => deferUpdate */
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
    console.warn('safeDefer: failed to defer:', err?.message || err);
    return false;
  }
}

/** Reply/Edit/FollowUp safely. For components, prefer followUp after deferUpdate. */
async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;

  // map `ephemeral: true` to `flags` for all reply/edit/followUp calls
  if ('ephemeral' in data) {
    const eph = !!data.ephemeral;
    delete data.ephemeral;
    data.flags = eph ? EPH_FLAG : data.flags;
  }

  try {
    // If nothing was sent yet and caller didn't force followUp, use reply
    if (!interaction.deferred && !interaction.replied && !preferFollowUp) {
      return await interaction.reply(data);
    }

    // Components are always followUp after deferUpdate
    if (isComponent(interaction)) {
      return await interaction.followUp(data);
    }

    // If we previously deferred, first output should be an edit of the original
    if (interaction.deferred && !preferFollowUp) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); } // fallback if edit fails
    }

    // Otherwise follow up
    return await interaction.followUp(data);
  } catch (err) {
    const code = codeOf(err);
    // Try one more followUp unless it’s an “interaction gone” kind of error
    if (code !== 10062 && code !== 10015) {
      try { return await interaction.followUp(data); } catch {}
    }

    // Last resort: send to channel (avoids total silence)
    try {
      if (interaction.channel?.send) {
        const { content, embeds, files, components, allowedMentions } = data;
        return await interaction.channel.send({
          content: content ?? ' ',
          embeds, files, components, allowedMentions
        });
      }
    } catch {}

    console.warn(`safeReply failed (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

/**
 * Watchdog: auto-defer after ~timeoutMs if your handler is still busy.
 * Set timeoutMs = 0 or null to disable globally (no-op).
 */
function withAckGuard(interaction, { timeoutMs = 0, options = {} } = {}) {
  if (!timeoutMs) {
    // disabled by default to prevent stray placeholders
    return { end(){} };
  }
  let timer = setTimeout(async () => {
    try {
      if (!interaction.deferred && !interaction.replied) {
        await safeDefer(interaction, options);
      }
    } catch {}
  }, timeoutMs);

  return { end() { if (timer) { clearTimeout(timer); timer = null; } } };
}

function isTransientErr(err) {
  const code = codeOf(err);
  return code === 10062 || code === 40060 || code === 'InteractionAlreadyReplied' || code === 10015;
}

/**
 * Fast ACK for slash/modals (defer-only by default):
 * - try deferReply(flags) immediately
 * - optional: also try a tiny reply(flags) later if `replyFallback: true`
 *
 * Returns: { ok, mode:'defer'|'reply'|'already'|'fail', ms }
 */
async function ackFast(interaction, {
  ephemeral = false,
  bannerText = '\u200b',     // only used if replyFallback:true
  replyFallback = false,     // 🚫 default: do NOT create a visible placeholder
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

  // A) prefer defer (invisible ack)
  const pDefer = interaction.deferReply({ flags })
    .then(() => settle('defer'))
    .catch((e) => { if (!isTransientErr(e)) console.warn('ackFast defer error:', e?.message || e); });

  // B) optional visible reply branch (disabled unless replyFallback:true)
  const pReply = replyFallback
    ? new Promise((r) => setTimeout(r, replyDelayMs))
        .then(() => interaction.reply({ flags, content: bannerText }))
        .then(() => settle('reply'))
        .catch((e) => { if (!isTransientErr(e)) console.warn('ackFast reply error:', e?.message || e); })
    : Promise.resolve();

  await Promise.race([
    Promise.allSettled([pDefer, pReply]),
    new Promise(res => setTimeout(res, raceTimeoutMs))
  ]);

  if (settled) return { ok: true, mode, ms: Date.now() - start };

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
module.exports.ackFast = ackFast;