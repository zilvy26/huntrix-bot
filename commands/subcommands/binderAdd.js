const UserInventory = require('../../models/UserInventory');

module.exports = async function(interaction) {
  await interaction.deferReply();

  const userId = interaction.user.id;
  const page = interaction.options.getInteger('page');
  const slot = interaction.options.getInteger('slot');
  const cardCode = interaction.options.getString('code')?.toUpperCase();

  if (page < 1 || page > 3 || slot < 1 || slot > 8) {
    return interaction.editReply('Page must be 1–3 and slot must be 1–8.');
  }

  const inventory = await UserInventory.findOne({ userId });
  if (!inventory) {
    return interaction.editReply('Could not load your inventory.');
  }

  const cardOwned = inventory.cards.some(c => c.cardCode === cardCode);
  if (!cardOwned) {
    return interaction.editReply(`You don’t own a card with code \`${cardCode}\`.`);
  }

  // Ensure binder exists and has 3 pages
  inventory.binder = inventory.binder ?? [];
  while (inventory.binder.length < 3) inventory.binder.push([]);

  // Ensure the page has 8 slots
  while (inventory.binder[page - 1].length < 8) {
    inventory.binder[page - 1].push(null);
  }

  const prevCard = inventory.binder[page - 1][slot - 1];
  inventory.binder[page - 1][slot - 1] = cardCode;

  await inventory.save();

  const message = prevCard && prevCard !== cardCode
    ? `Replaced \`${prevCard}\` with \`${cardCode}\` in page ${page}, slot ${slot}.`
    : `Card \`${cardCode}\` added to page ${page}, slot ${slot}.`;

  return interaction.editReply(message);
};