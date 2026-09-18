// Headless balance check: plays every round with a deliberately ordinary bot
// and reports how far it gets. Run with:
//   node games/balloon-siege/tools/simulate.mjs [map] [difficulty]
//
// The bot is meant to be mediocre — a decent human should do better. If the bot
// cruises to round 40 untouched the game is too easy; if it dies in the teens
// on Normal something is over-tuned.

import { MAPS, DIFFICULTIES } from "../config.js";
import { canPlace, createGame, placeTower, buyUpgrade, startRound, towerStats, update, ROUND_COUNT } from "../game.js";
import { TOWER_BY_ID, nextUpgrade, upgradeBlocked } from "../towers.js";
import { distanceToPath } from "../path.js";

const DT = 1 / 60;
// Buy order by round: roughly how a new player ramps up.
const PLAN = [
  { round: 1, id: "dart" }, { round: 1, id: "dart" }, { round: 3, id: "dart" },
  { round: 5, id: "tack" }, { round: 7, id: "sniper" }, { round: 9, id: "bomb" },
  { round: 12, id: "ice" }, { round: 14, id: "farm" }, { round: 16, id: "wizard" },
  { round: 19, id: "bomb" }, { round: 22, id: "wizard" }, { round: 25, id: "farm" },
  { round: 28, id: "sniper" }, { round: 31, id: "super" }, { round: 34, id: "wizard" },
];

/** Score a build spot by how much track it covers — the obvious human instinct. */
function spotScore(state, x, y, range) {
  let covered = 0;
  const step = 24;
  for (let d = 0; d < state.path.length; d += step) {
    const seg = state.path;
    let acc = 0;
    for (const s of seg.segs) {
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
  for (let x = 30; x <= 690; x += 30) {
    for (let y = 30; y <= 1150; y += 30) {
      if (!canPlace(state, x, y)) continue;
      // Support towers just need somewhere safe; attackers want coverage.
      const score = stats.support ? 1000 - distanceToPath(state.path, x, y) : spotScore(state, x, y, range);
      if (score > bestScore) { bestScore = score; best = { x, y }; }
    }
  }
  return best;
}

function spend(state, plan) {
  // 1. Anything still owed from the build plan for this round.
  for (const entry of plan) {
    if (entry.done || entry.round > state.round) continue;
    const def = TOWER_BY_ID[entry.id];
    if (state.cash < def.cost) continue;
    const spot = bestSpot(state, entry.id);
    if (spot && placeTower(state, entry.id, spot.x, spot.y)) entry.done = true;
  }
  // 2. Then upgrade, cheapest useful upgrade first, keeping a small reserve.
  for (let guard = 0; guard < 40; guard++) {
    let bestBuy = null;
    for (const t of state.towers) {
      const def = TOWER_BY_ID[t.defId];
      for (let p = 0; p < def.paths.length; p++) {
        if (upgradeBlocked(def, t.tiers, p)) continue;
        const up = nextUpgrade(def, t.tiers, p);
        if (!up || up.cost > state.cash) continue;
        if (!bestBuy || up.cost < bestBuy.cost) bestBuy = { tower: t, path: p, cost: up.cost };
      }
    }
    if (!bestBuy) break;
    if (!buyUpgrade(state, bestBuy.tower, bestBuy.path)) break;
  }
}

function run(mapId, difficultyId, { verbose = false } = {}) {
  const state = createGame({ mapId, difficultyId });
  const plan = PLAN.map((p) => ({ ...p }));
  const log = [];

  while (state.phase !== "won" && state.phase !== "lost") {
    spend(state, plan);
    const cashAtStart = state.cash;
    const livesAtStart = state.lives;
    const round = state.round;
    startRound(state);
    let t = 0;
    while (state.phase === "wave" && t < 300) {
      update(state, DT);
      t += DT;
    }
    if (state.phase === "wave") { log.push(`round ${round}: TIMEOUT`); break; }
    const lost = livesAtStart - state.lives;
    if (verbose) {
      log.push(
        `r${String(round).padStart(2)} ${t.toFixed(0).padStart(3)}s  ` +
        `lives ${String(state.lives).padStart(4)}${lost > 0 ? ` (-${lost})` : "     "}  ` +
        `cash ${String(cashAtStart).padStart(5)}→${String(state.cash).padStart(5)}  ` +
        `towers ${state.towers.length}`,
      );
    }
    if (state.phase === "lost") { log.push(`LOST on round ${round}`); break; }
  }
  return { state, log };
}

const [, , mapArg, diffArg] = process.argv;
if (mapArg) {
  const { state, log } = run(mapArg, diffArg ?? "normal", { verbose: true });
  console.log(log.join("\n"));
  console.log(`\n${state.phase.toUpperCase()} — reached round ${state.round}/${ROUND_COUNT}, ${state.lives} lives left`);
} else {
  for (const map of MAPS) {
    for (const diff of DIFFICULTIES) {
      const { state } = run(map.id, diff.id);
      const outcome = state.phase === "won" ? `WON with ${state.lives} lives` : `lost on round ${state.round}`;
      console.log(`${map.id.padEnd(11)} ${diff.id.padEnd(7)} ${outcome}`);
    }
  }
}
