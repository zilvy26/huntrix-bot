// commands/boutique/template.js
const Template = require('../../../models/Template');
const User = require('../../../models/User');
const UserTemplateInventory = require('../../../models/UserTemplateInventory');
const { hasCompleteEra } = require('../../../services/eligibility');
const { safeReply } = require('../../../utils/safeReply');

module.exports = async function boutiqueTemplate(interaction) {

    const userId = interaction.user.id;
    const label = interaction.options.getString('label', true).trim();

    // 1) find template (visible or not is your choice; using active only)
    const tpl = await Template.findOne(
      { label: { $regex: `^${label}$`, $options: 'i' }, active: true },
      { label: 1, acquire: 1 }
    ).lean();
    if (!tpl) {
      return safeReply(interaction, { content: `No active template labeled **${label}**.` });
    }

    // 2) check inventory: already owned?
    const inv = await UserTemplateInventory.ensure(userId);
    if (inv.templates.includes(tpl.label)) {
      return safeReply(interaction, { content: `You already own **${tpl.label}**.` });
    }

    // 3) gates (OR logic: pass if ANY qualifies; tweak to ALL if you prefer)
    const gates = tpl.acquire || {};
    let eligible = false;
    let reason = 'You do not meet the requirements.';

    // available == free claim
    if (gates.available) { eligible = true; reason = ''; }

    // price
    let user = await User.findOne({ userId });
    let costOK = false;
    if (!eligible && gates.price != null) {
      const balance = user?.sopop ?? 0;
      if (balance >= gates.price) { eligible = true; costOK = true; reason = ''; }
      else reason = `Not enough Sopop. Need ${gates.price.toLocaleString()}.`;
    }

    // roles
    if (!eligible && gates.roles?.length) {
      const userRoleIds = interaction.member?.roles?.cache?.map(r => r.id) || [];
      if (gates.roles.some(rid => userRoleIds.includes(rid))) { eligible = true; reason = ''; }
      else reason = 'Missing required role.';
    }

    // era complete
    if (!eligible && gates.requireEra) {
      if (gates.requireEraComplete) {
        const ok = await hasCompleteEra(userId, gates.requireEra);
        if (ok) { eligible = true; reason = ''; }
        else reason = `You must own ALL cards from the **${gates.requireEra}** era.`;
      }
    }

    if (!eligible) return safeReply(interaction, { content: `${reason}` });

    // 4) charge if needed
    if (gates.price != null) {
      const balance = user?.sopop ?? 0;
      if (balance < gates.price) {
        return safeReply(interaction, { content: `Not enough Sopop.` });
      }
      user.sopop = balance - gates.price;
      await user.save();
    }

    // 5) grant ownership
    inv.templates.push(tpl.label);
    await inv.save();

    return safeReply(interaction, {
      content: `You obtained **${tpl.label}**! Use \`/editprofile template_label:${tpl.label}\` to equip it.`
    });
  };
