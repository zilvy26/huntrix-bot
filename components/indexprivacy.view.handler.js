// components/indexprivacy.view.handler.js
const IndexPrivacy = require('../models/IndexPrivacy');
const indexPrivacyCmd = require('../commands/global/indexprivacy'); // reuse buildViewUI

const PREFIX = 'iprv|';

function parse(customId) {
  // iprv|noop
  // iprv|close|<ownerId>|X
  // iprv|view|<ownerId>|<bucket>|<page>|<ACTION>   ACTION ∈ {F,P,N,L,SB}
  if (!customId.startsWith(PREFIX)) return null;
  const parts = customId.split('|');
  if (parts[1] === 'noop')  return { type: 'noop' };
  if (parts[1] === 'close') return { type: 'close', ownerId: parts[2] };
  if (parts[1] === 'view')  return {
    type: 'view',
    ownerId: parts[2],
    bucket: parts[3],
    page: Number(parts[4]) || 1,
    action: parts[5] // F/P/N/L/SB
  };
  return null;
}

async function handle(interaction) {
  const data = parse(interaction.customId || '');
  if (!data) return false; // not ours

  if (data.type === 'noop') {
    await interaction.deferUpdate();
    return true;
  }

  if (data.type === 'close') {
    if (interaction.user.id !== data.ownerId) {
      await interaction.reply({ content: 'Only the owner can close this view.', ephemeral: true });
      return true;
    }
    const msg = interaction.message;
    const embeds = msg.embeds?.map(e => e) ?? [];
    if (embeds[0]) {
      const desc = embeds[0].data?.description || '';
      embeds[0].data.description = `${desc}\n\n*Closed.*`;
    }
    await interaction.update({ embeds, components: [] });
    return true;
  }

  // type === 'view'
  if (interaction.user.id !== data.ownerId) {
    await interaction.reply({ content: 'You cannot control another user’s privacy view.', ephemeral: true });
    return true;
  }

  const doc = await IndexPrivacy.findOne({ userId: data.ownerId });
  if (!doc) {
    await interaction.update({ content: 'No privacy document found.', embeds: [], components: [] });
    return true;
  }

  let bucket = data.bucket;
  let page = data.page;

  if (!['cards','groups','names','eras'].includes(bucket)) bucket = 'cards';
  if (data.action === 'SB') page = 1; // switching bucket resets to page 1

  // For last-page jump we need total pages
  if (['F','P','N','L'].includes(data.action)) {
    const list = doc[bucket] || [];
    const perPage = 20; // keep in sync with DEFAULT_PAGE_SIZE
    const totalPages = Math.max(1, Math.ceil(list.length / perPage));
    if (data.action === 'F') page = 1;
    if (data.action === 'L') page = totalPages;
    page = Math.min(Math.max(1, page), totalPages);
  }

  const ui = indexPrivacyCmd.buildViewUI({
    viewer: interaction.user,
    ownerId: data.ownerId,
    doc,
    bucket,
    page
  });
  await interaction.update(ui);
  return true;
}

module.exports = {
  idPrefix: PREFIX,
  canHandle: (interaction) => interaction.isButton() && (interaction.customId || '').startsWith(PREFIX),
  handle,
};
