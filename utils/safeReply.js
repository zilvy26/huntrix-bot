// utils/safeReply.js
const EPH_FLAG = 1 << 6;
const TRANSIENT = new Set([10062, 40060, 10015, 'InteractionAlreadyReplied']);
const isComponent = (i) => i?.isButton?.() || i?.isStringSelectMenu?.() || false;
const codeOf = (e) => e?.code || e?.rawError?.code || e?.status;

async function safeDefer(interaction, { ephemeral = false } = {}) {
  const flags = ephemeral ? EPH_FLAG : undefined;
  try {
    if (interaction.deferred || interaction.replied) return true;

    if (isComponent(interaction)) {               // components
      await interaction.deferUpdate();
      return true;
    }
    if (interaction.isChatInputCommand?.() || interaction.isModalSubmit?.()) {
      await interaction.deferReply({ flags });    // slash/modal
      return true;
    }
    if (interaction.isRepliable?.()) {
      await interaction.deferReply({ flags });
      return true;
    }
    return false;
  } catch (err) {
    if (!TRANSIENT.has(codeOf(err))) console.warn('safeDefer failed:', err?.message || err);
    return true;
  }
}

/**
 * Buttons/components: update() -> editReply() -> (suppress; NO followUp)
 * Slash/Modal: if deferred -> editReply(); else -> reply(); fallback may followUp.
 * - preferFollowUp (only for slash/modal): force a followUp instead of editReply/reply.
 */
async function safeReply(interaction, payload, { preferFollowUp = false } = {}) {
  const data = typeof payload === 'string' ? { content: payload } : (payload || {});

  // disallow empty sends
  const hasBody = !!data.content
    || (Array.isArray(data.embeds) && data.embeds.length)
    || (Array.isArray(data.files) && data.files.length)
    || (Array.isArray(data.components) && data.components.length);
  if (!hasBody) { console.warn('safeReply: skipped empty payload'); return null; }

  // map ephemeral -> flags
  if ('ephemeral' in data) {
    const eph = !!data.ephemeral;
    delete data.ephemeral;
    data.flags = eph ? EPH_FLAG : data.flags;
  }

  try {
    // ===== COMPONENTS (buttons/menus): EDIT ONLY =====
    if (isComponent(interaction)) {
      // best path: edits the message the button is on
      if (typeof interaction.update === 'function') {
        try { return await interaction.update(data); } catch {}
      }
      // fallback: edit original reply
      try { return await interaction.editReply(data); } catch {}
      // final: suppress to avoid creating a new message
      console.warn('[safeReply] component edit failed; suppressing followUp to prevent duplicates.');
      return null;
    }

    // ===== SLASH / MODAL =====
    if (preferFollowUp) {
      // caller explicitly wants a new message
      return await interaction.followUp(data);
    }

    if (interaction.deferred && !interaction.replied) {
      try { return await interaction.editReply(data); } 
      catch {
        // edit failed — allowed to follow up for slash/modal
        return await interaction.followUp(data);
      }
    }

    if (!interaction.deferred && !interaction.replied) {
      try { return await interaction.reply(data); } 
      catch {
        // reply failed — try follow up
        return await interaction.followUp(data);
      }
    }

    // already replied — normal follow-up is allowed for slash/modal
    return await interaction.followUp(data);

  } catch (err) {
    const code = codeOf(err);
    // last-chance: only for slash/modal; components already returned above
    if (!isComponent(interaction) && code !== 10062 && code !== 10015) {
      try { return await interaction.followUp(data); } catch {}
    }
    console.warn(`safeReply final fail (${code ?? 'no-code'}):`, err?.message || err);
    return null;
  }
}

module.exports = { safeReply, safeDefer };