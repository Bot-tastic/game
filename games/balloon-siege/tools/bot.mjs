// The reference player used by the balance tools.
//
// It is meant to be *mediocre but sane*: it builds a fixed roster, commits each
// tower to one upgrade path instead of sprinkling cheap upgrades everywhere,
// fires abilities the moment they come off cooldown, and never sends a wave
// early. A decent human should beat it comfortably; if it sails through Hard on
// the Brutal map, the game is too easy.
//
// An earlier version bought the cheapest available upgrade anywhere, which made
// it *worse* the more money it had — it never reached tier 3 and so never
// unlocked a single ability. That made every measurement taken with it useless.

import { WORLD } from "../config.js";
import { abilityOf, abilityReady, activateAbility, canPlace, createGame, placeTower, buyUpgrade, startRound, update } from "../game.js";
import { TOWER_BY_ID, nextUpgrade, upgradeBlocked } from "../towers.js";
import { distanceToPath } from "../path.js";

const DT = 1 / 60;

/** Build roster by round, and the path each tower commits to. */
export const PLAN = [
  { round: 1, id: "dart" }, { round: 1, id: "dart" }, { round: 2, id: "hero" },
  { round: 4, id: "dart" }, { round: 5, id: "tack" }, { round: 7, id: "sniper" },
  { round: 9, id: "bomb" }, { round: 12, id: "ice" }, { round: 14, id: "farm" },
  { round: 16, id: "wizard" }, { round: 19, id: "bomb" }, { round: 22, id: "wizard" },
  { round: 25, id: "farm" }, { round: 27, id: "sniper" }, { round: 29, id: "tack" },
  { round: 31, id: "super" }, { round: 33, id: "wizard" }, { round: 35, id: "bomb" },
  { round: 37, id: "super" },
];

const MAIN_PATH = { dart: 0, tack: 1, bomb: 0, ice: 0, sniper: 0, wizard: 0, super: 0, farm: 0, hero: 0 };

function spotScore(state, x, y, range) {
  let covered = 0;
  const step = 24;
  for (let d = 0; d < state.path.length; d += step) {
    let acc = 0;
    for (const s of state.path.segs) {
      if (d <= acc + s.len) {
        const px = s.x1 + s.dx * (d - acc);
        const py = s.y1 + s.dy * (d - acc);
        if (Math.hypot(px - x, py - y) <= range) covered += step;
        break;
      }
      acc += s.len;
    }
  }
  return covered;
}

function bestSpot(state, defId) {
  const stats = TOWER_BY_ID[defId].base;
  const range = Math.min(stats.range, 200);
  let best = null;
  let bestScore = 0;
  for (let x = 30; x <= WORLD.w - 30; x += 30) {
    for (let y = 30; y <= WORLD.h - 30; y += 30) {
      if (!canPlace(state, x, y)) continue;
      // Support towers just need somewhere safe; attackers want coverage.
      const score = stats.support ? 1000 - distanceToPath(state.path, x, y) : spotScore(state, x, y, range);
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

function spend(state, plan) {
  for (const entry of plan) {
    if (entry.done || entry.round > state.round) continue;
    const def = TOWER_BY_ID[entry.id];
    if (state.cash < def.cost) continue;
    const spot = bestSpot(state, entry.id);
    if (spot && placeTower(state, entry.id, spot.x, spot.y)) entry.done = true;
  }
  // Level the roster along each tower's committed path: always advance the
  // tower that is furthest behind, so everything reaches tier 3 eventually
  // rather than everything stalling at tier 1.
  for (let guard = 0; guard < 60; guard++) {
    let pick = null;
    for (const t of state.towers) {
      const def = TOWER_BY_ID[t.defId];
      if (!def.paths.length) continue;
      const p = MAIN_PATH[t.defId] ?? 0;
      const path = upgradeBlocked(def, t.tiers, p) ? 1 - p : p;
      if (upgradeBlocked(def, t.tiers, path)) continue;
      const up = nextUpgrade(def, t.tiers, path);
      if (!up || up.cost > state.cash) continue;
      const rank = t.tiers[0] + t.tiers[1];
      if (!pick || rank < pick.rank || (rank === pick.rank && up.cost < pick.cost)) {
        pick = { tower: t, path, cost: up.cost, rank };
      }
    }
    if (!pick) break;
    if (!buyUpgrade(state, pick.tower, pick.path)) break;
  }
}

/** Fire every ability the moment it is ready and there is anything to hit. */
function useAbilities(state) {
  if (!state.bloons.length) return;
  for (const t of state.towers) {
    if (abilityReady(t)) activateAbility(state, t);
  }
}

/**
 * Play a full run. `endless: true` gives the bot unlimited lives so the result
 * is total lives leaked — a continuous signal, which is what tuning needs.
 * A win/lose flag alone is too coarse: spawnCluster uses Math.random(), so a
 * knife-edge build flips outcomes between runs for no real reason.
 */
export function playRun(mapId, difficultyId, { endless = false, onRound } = {}) {
  const state = createGame({ mapId, difficultyId });
  if (endless) state.lives = 1e7;
  const plan = PLAN.map((p) => ({ ...p }));

  while (state.phase !== "won" && state.phase !== "lost") {
    spend(state, plan);
    const cashAtStart = state.cash;
    const leakAtStart = state.leaked;
    const round = state.round;
    if (!startRound(state)) break;
    let t = 0;
    const tick = () => { useAbilities(state); update(state, DT); t += DT; };
    while (state.phase === "wave" && t < 400) tick();
    while (state.bloons.length > 0 && state.phase !== "lost" && t < 600) tick();
    onRound?.({ round, secs: t, leaked: state.leaked - leakAtStart, cashAtStart, state });
    if (state.phase === "lost") break;
  }
  return state;
}
