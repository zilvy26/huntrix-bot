// src/utils/safeReply.js
const { MessageFlags } = require('discord.js');

// ---------- helpers ----------
function isComponent(i) {
  return i?.isButton?.() || i?.isStringSelectMenu?.() || false;
}
function codeOf(err) { return err?.code || err?.rawError?.code || err?.status; }
const TRANSIENT = new Set([
  10062,                  // Unknown interaction (expired / late)
  40060,                  // Already acknowledged
  10015,                  // Unknown webhook (stale token for edits)
  'InteractionAlreadyReplied'
]);

// Map opts.ephemeral -> flags (new API for initial response)
function flagsFrom(opts = {}) {
  return opts.ephemeral ? MessageFlags.Ephemeral : (opts.flags ?? undefined);
}

// ---------- DEFER ----------
/** Defer safely: slash/modal => deferReply; components => deferUpdate */
async function safeDefer(interaction, options = {}) {
  try {
    if (interaction.deferred || interaction.replied) return true;

    if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) {
      await interaction.deferReply({ flags: flagsFrom(options) });
      return true;
    }
    if (isComponent(interaction)) {
      await interaction.deferUpdate(); // components never take flags
      return true;
    }
    if (interaction.isRepliable?.()) {
      await interaction.deferReply({ flags: flagsFrom(options) });
      return true;
    }
    return false;
  } catch (err) {
    if (TRANSIENT.has(codeOf(err))) return true;
    console.warn('safeDefer: failed to defer:', err?.message || err);
    return false;
  }
}

// ---------- REPLY / EDIT / FOLLOWUP ----------
/**
 * Reply/Edit/FollowUp safely.
 * Components: try editing the clicked message first, then original reply, then followUp.
 * Slash/Modal: reply first if nothing sent; otherwise prefer editReply.
 */
async function safeReply(interaction, payload, opts = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});
  const preferFollowUp = !!opts.preferFollowUp;
  const isComp = isComponent(interaction);

  try {
    // 1) Components – EDIT IN PLACE first
    if (isComp && !preferFollowUp) {
      try {
        if (interaction.message?.editable ?? true) {
          return await interaction.message.edit(data);
        }
      } catch { /* fall through to editReply */ }

      try { return await interaction.editReply(data); }  // edits original slash reply
      catch { return await interaction.followUp(data); } // last resort
    }
    // 2) First response for slash/modals if nothing sent yet
    if (!interaction.deferred && !interaction.replied && !preferFollowUp) {
      const flags = flagsFrom(opts);
      return await interaction.reply({ ...data, flags });
    }

    // 3) Slash/Modal already ACKed -> prefer edit
    if ((interaction.isChatInputCommand?.() || interaction.isModalSubmit?.())
        && (interaction.deferred || interaction.replied)
        && !preferFollowUp) {
      try { return await interaction.editReply(data); }
      catch { return await interaction.followUp(data); }
    }

    // 4) Fallback
    return await interaction.followUp(data);

  } catch (err) {
    const code = codeOf(err);

    // One silent retry to followUp unless token is clearly dead
    if (code !== 10062 && code !== 10015) {
      try { return await interaction.followUp(data); } catch {}
    }

    // Optional last resort to channel (non‑ephemeral)
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

// ---------- WATCHDOG ----------
/** Auto‑defer after ~450ms if your code stalls pre‑ACK */
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

// ---------- RACE‑ACK ----------
/**
 * Race‑based ACK for slash/modals:
 * tries deferReply({flags}) immediately and a tiny reply({flags}) 80ms later.
 * Whichever wins first is the ACK.
 * Returns { ok:boolean, mode:'defer'|'reply'|'already'|'fail', ms:number }
 */
async function ackFast(
  interaction,
  { ephemeral = false, bannerText = '\u200b', raceMs = 2500 } = {}
) {
  const start = Date.now();

  if (interaction.deferred || interaction.replied) {
    return { ok: true, mode: 'already', ms: 0 };
  }

  const flags = flagsFrom({ ephemeral });

  let lastDeferErr, lastReplyErr;

  // Path A: defer (preferred)
  const pDefer = interaction.deferReply({ flags })
    .catch((e) => { lastDeferErr = e; });

  // Path B: small stagger, then minimal reply (invisible placeholder)
  const pReply = new Promise(r => setTimeout(r, 80))
    .then(() => interaction.reply({ content: bannerText, flags }))
    .catch((e) => { lastReplyErr = e; });

  // See who settles inside race window
  const tag = (p, name) => p.then(() => name).catch(() => null);
  let mode = await Promise.race([
    tag(pDefer, 'defer'),
    tag(pReply, 'reply'),
    new Promise(r => setTimeout(() => r(null), raceMs))
  ]);

  // If neither settled in time, wait to see if one eventually resolved
  if (!mode) {
    try { await Promise.any([pDefer, pReply]); } catch {}
    mode = interaction.deferred ? 'defer' : (interaction.replied ? 'reply' : 'fail');
  }

  const ok = interaction.deferred || interaction.replied;
  const ms = Date.now() - start;

  if (!ok) {
    const dCode = codeOf(lastDeferErr);
    const rCode = codeOf(lastReplyErr);
    console.warn('[ACK-FAIL]', 'deferErr=', dCode, 'replyErr=', rCode);
  }

  return { ok, mode, ms };
}

module.exports = safeReply;
module.exports.safeReply = safeReply;
module.exports.safeDefer = safeDefer;
module.exports.withAckGuard = withAckGuard;
module.exports.ackFast = ackFast;