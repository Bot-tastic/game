// rules.js — the tuning constants a run is balanced around, shared by the game
// and the headless level verifier so both burn fuel and pay out identically.

export const FUEL = {
  max: 100,
  idle: 0.8, // units/second just for running
  gas: 1.9, // extra units/second at full throttle
  pickup: 42,
};

export const COIN_VALUE = 10;
export const AIR_BONUS = 12; // coins per second of airtime, paid on landing
export const FLIP_BONUS = 120;
