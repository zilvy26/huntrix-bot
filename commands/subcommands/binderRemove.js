const UserInventory = require('../../models/UserInventory');

module.exports = async function(interaction) {
  await interaction.deferReply();

  const userId = interaction.user.id;
  const page = interaction.options.getInteger('page');
  const slot = interaction.options.getInteger('slot');

  if (page < 1 || page > 3 || slot < 1 || slot > 8) {
    return interaction.editReply('Page must be 1–3 and slot must be 1–8.');
  }

  const inventory = await UserInventory.findOne({ userId });
  if (!inventory) return interaction.editReply('Inventory not found.');

  inventory.binder = inventory.binder || [[], [], []];
  inventory.binder[page - 1] = inventory.binder[page - 1] || Array(8).fill(null);

  const current = inventory.binder[page - 1][slot - 1];
  if (!current) {
    return interaction.editReply(`Slot ${slot} on page ${page} is already empty.`);
  }

  inventory.binder[page - 1][slot - 1] = null;
  await inventory.save();

  return interaction.editReply(`Removed card \`${current}\` from page ${page}, slot ${slot}.`);
};