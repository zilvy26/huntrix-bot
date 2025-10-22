// utils/globalPullConfig.js

// Hardcoded rarity weights
const RARITY_WEIGHTS = {
  '1S': 36,
  '2S': 29.55,
  '3S': 20.45,
  '4S': 12,
  '5S': 2,
};

// Hardcoded multipliers for eras (always lowercased keys!)
const ERA_MULTIPLIERS = {
  'sco25': 0.045,
  'fox tale (demo)': 1,
};

// Hardcoded multipliers for specific card codes (always lowercased keys!)
const CODE_MULTIPLIERS = {
  'gi-elsco25': 55,
};

const MIN_WEIGHT = 0.00001;
const MAX_WEIGHT = 10000;

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