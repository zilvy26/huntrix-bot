// utils/cooldownConfig.js

module.exports = {
  pull: {
    default: 60 * 1000,
    booster: 30 * 1000
  },        
  daily: 24 * 60 * 60 * 1000,  
  perform: 30 * 60 * 1000,
  rehearsal: 2 * 60 * 60 * 1000,
  pull10: 1 * 60 * 60 * 1000,
  battle: 20 * 60 * 1000,
  // Add more as needed
};