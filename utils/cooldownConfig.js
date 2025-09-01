// utils/cooldownConfig.js

module.exports = {
  Pull: {
    default: 90 * 1000,
    reductions: [
      { id: '1387230787929243780', percent: 15 }, // Booster
      { id: '1394845122180677662', percent: 20 }, // Maknae
      { id: '1394846623971938465', percent: 25 }, // Visual
      { id: '1394847239557615666', percent: 35 }, // Leader
      { id: '1394448143206322267', percent: 10 }, // Huntrixbot
      { id: '1412071548881473598', percent: 40 }, // All Rounder
    ]
  },       
  Daily: 24 * 60 * 60 * 1000,  
  Perform: {
    default: 30 * 60 * 1000,
    reductions: [
      { id: '1394847239557615666', percent: 25 }, // Leader
      { id: '1412071548881473598', percent: 35 }, // All Rounder
    ]
  },
  Rehearsal: {
    default: 45 * 60 * 1000,
    reductions: [
      { id: '1412071548881473598', percent: 20 }, // All Rounder
    ]
  },
  Pull10: {
    default: 1.25 * 60 * 60 * 1000,
    reductions: [
      { id: '1394448143206322267', percent: 10 }, // Huntrixbot
      { id: '1387230787929243780', percent: 15 }, // Booster
      { id: '1394845122180677662', percent: 20 }, // Maknae
      { id: '1394846623971938465', percent: 25 }, // Visual
      { id: '1394847239557615666', percent: 35 }, // Leader
      { id: '1412071548881473598', percent: 40 }, // All Rounder
    ]
  },
  Battle: {
    default: 20 * 60 * 1000,
    reductions: [
      { id: '1394846623971938465', percent: 15 }, // Visual
      { id: '1394847239557615666', percent: 25 }, // Leader
      { id: '1412071548881473598', percent: 35 }, // All Rounder
    ]
  },
  Vote: 12 * 60 * 60 * 1000,
  List: 7.5 * 60 * 1000,
  // Add more as needed
};