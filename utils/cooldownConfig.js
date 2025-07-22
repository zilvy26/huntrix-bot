// utils/cooldownConfig.js

module.exports = {
  Pull: {
    default: 75 * 1000,
    reductions: [
      { id: '1387230787929243780', percent: 20 }, // Booster
      { id: '1394845122180677662', percent: 20 }, // Maknae
      { id: '1394846623971938465', percent: 25 }, // Visual
      { id: '1394847239557615666', percent: 30 }, // Leader
      { id: '1394448143206322267', percent: 10 } // Huntrixbot
    ]
  },       
  Daily: 24 * 60 * 60 * 1000,  
  Perform: {
    default: 30 * 60 * 1000,
    reductions: [
      { id: '1394847239557615666', percent: 20 }, // Leader
    ]
  },
  Rehearsal:  45 * 60 * 1000,
  Pull10: {
    default: 1.25 * 60 * 60 * 1000,
    reductions: [
      { id: '1387230787929243780', percent: 20 }, // Booster
      { id: '1394845122180677662', percent: 20 }, // Maknae
      { id: '1394846623971938465', percent: 25 }, // Visual
      { id: '1394847239557615666', percent: 30 }, // Leader
    ]
  },
  Battle: {
    default: 20 * 60 * 1000,
    reductions: [
      { id: '1394846623971938465', percent: 15 }, // Visual
      { id: '1394847239557615666', percent: 20 }, // Leader
    ]
  },
  // Add more as needed
};