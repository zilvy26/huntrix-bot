// utils/cooldownConfig.js

module.exports = {
  Pull: {
    default: 60 * 1000,
    reductions: [
      { id: '1387230787929243780', percent: 37 }, // Booster
      { id: '1394448143206322267', percent: 10 }
    ]
  },       
  Daily: 24 * 60 * 60 * 1000,  
  Perform: 30 * 60 * 1000,
  Rehearsal: 2 * 60 * 60 * 1000,
  Pull10: 1 * 60 * 60 * 1000,
  Battle: 20 * 60 * 1000,
  // Add more as needed
};