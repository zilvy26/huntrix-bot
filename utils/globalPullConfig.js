// utils/globalPullConfig.js

// Hardcoded rarity weights
const RARITY_WEIGHTS = {
  '1S': 36,
  '2S': 29,
  '3S': 20.25,
  '4S': 12,
  '5S': 2.75,
};

// Hardcoded multipliers for eras (always lowercased keys!)
const ERA_MULTIPLIERS = {
  'vir25': 0.44,
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