// utils/globalPullConfig.js

// Hardcoded rarity weights
const RARITY_WEIGHTS = {
  '1S': 35,
  '2S': 30,
  '3S': 21,
  '4S': 12,
  '5S': 2,
};

// Hardcoded multipliers for eras (always lowercased keys!)
const ERA_MULTIPLIERS = {
  'vir25': 0.62,
};

// Hardcoded multipliers for specific card codes (always lowercased keys!)
const CODE_MULTIPLIERS = {
};

const MIN_WEIGHT = 0.01;
const MAX_WEIGHT = 10;

function getGlobalPullConfig() {
  return {
    rarityWeights: RARITY_WEIGHTS,
    eraMultipliers: ERA_MULTIPLIERS,
    codeMultipliers: CODE_MULTIPLIERS,
    minWeight: MIN_WEIGHT,
    maxWeight: MAX_WEIGHT,
  };
}

module.exports = { getGlobalPullConfig };