// The 40-round table.
//
// A round is a list of groups; each group releases `count` bloons of one type,
// `spacing` seconds apart, starting `delay` seconds into the round. Groups run
// in parallel, which is what makes the later rounds feel like a real push
// rather than a single queue.
//
// A round is "over" as soon as it has finished spawning, so these delays also
// set how soon the player may send the next one. Early rounds are kept short
// on purpose: nothing about round 3 is worth thirty seconds of watching.

/** @param camo — camo bloons are invisible to towers without detection. */
function g(type, count, spacing, delay = 0, camo = false) {
  return { type, count, spacing, delay, camo };
}

export const ROUNDS = [
  [g("red", 14, 0.42)],
  [g("red", 24, 0.32)],
  [g("red", 14, 0.36), g("blue", 8, 0.45, 2.5)],
  [g("blue", 16, 0.34), g("red", 12, 0.4, 2)],
  [g("blue", 26, 0.3)],
  [g("blue", 16, 0.32), g("green", 9, 0.5, 2.5)],
  [g("green", 13, 0.42), g("blue", 16, 0.34, 1.5)],
  [g("green", 22, 0.3)],
  [g("green", 12, 0.38), g("yellow", 10, 0.5, 3)],
  [g("yellow", 26, 0.28)],
  [g("yellow", 16, 0.32), g("green", 14, 0.4, 1.5)],
  [g("green", 22, 0.3), g("yellow", 10, 0.45, 2.5, true)],
  [g("pink", 16, 0.34), g("yellow", 12, 0.36, 1.5)],
  [g("pink", 22, 0.28), g("yellow", 12, 0.4, 3)],
  [g("black", 13, 0.44), g("pink", 10, 0.36, 2.5)],
  [g("white", 12, 0.44), g("black", 9, 0.5, 1.5)],
  [g("lead", 10, 0.6), g("pink", 14, 0.36, 2.5)],
  [g("pink", 20, 0.3, 0, true), g("black", 8, 0.45, 3)],
  [g("black", 14, 0.38), g("white", 14, 0.38, 1.2)],
  [g("rainbow", 10, 0.6), g("black", 10, 0.4, 3)],
  [g("lead", 12, 0.52), g("pink", 22, 0.26, 1.5)],
  [g("rainbow", 20, 0.4)],
  [g("ceramic", 8, 0.8), g("rainbow", 10, 0.44, 3)],
  [g("rainbow", 16, 0.44, 0, true), g("lead", 8, 0.6, 2.5)],
  [g("ceramic", 16, 0.56), g("white", 14, 0.36, 2.5)],
  [g("lead", 20, 0.4), g("rainbow", 18, 0.4, 2.5)],
  [g("ceramic", 22, 0.48), g("black", 20, 0.3, 3)],
  [g("rainbow", 30, 0.3), g("lead", 14, 0.48, 2.5), g("ceramic", 8, 0.7, 6)],
  [g("ceramic", 26, 0.42), g("rainbow", 20, 0.34, 4)],
  [g("moab", 2, 3), g("ceramic", 14, 0.5, 5)],
  [g("ceramic", 28, 0.36, 0, true), g("lead", 16, 0.42, 3)],
  [g("moab", 3, 3), g("ceramic", 20, 0.42, 3)],
  [g("moab", 4, 2.8), g("ceramic", 24, 0.38, 4)],
  [g("ceramic", 38, 0.3), g("rainbow", 28, 0.3, 3, true)],
  [g("moab", 6, 2.6), g("ceramic", 24, 0.38, 5)],
  [g("rainbow", 46, 0.24, 0, true), g("lead", 22, 0.38, 3), g("ceramic", 12, 0.6, 8)],
  [g("bfb", 1, 1), g("moab", 3, 3, 6), g("ceramic", 16, 0.4, 4)],
  [g("moab", 8, 2.4), g("ceramic", 30, 0.3, 4)],
  [g("bfb", 2, 5), g("moab", 5, 2.8, 7), g("ceramic", 20, 0.38, 3)],
  [g("zomg", 1, 1), g("bfb", 2, 7, 14), g("moab", 4, 3, 8), g("ceramic", 20, 0.36, 6)],
];

export const ROUND_COUNT = ROUNDS.length;

/** Rounds worth announcing. Everything else gets a plain round banner. */
export const ROUND_TITLES = {
  15: "Black bloons — no explosives",
  16: "White bloons — no ice",
  17: "Lead! Sharp shots bounce off",
  23: "Ceramics incoming",
  30: "MOAB INCOMING",
  37: "B.F.B. INCOMING",
  40: "Z.O.M.G. — final round",
};

/** Cash handed out for surviving a round. Grows quadratically so the top-tier
 * upgrades stay reachable in the last third — a linear payout left the player
 * permanently one round behind the bloons. */
export function roundReward(round) {
  return Math.round(110 + round * 9 + round * round * 1.0);
}

/** Flattened spawn schedule for one round: {t, type, camo} sorted by time. */
export function buildSchedule(round) {
  const out = [];
  for (const grp of ROUNDS[round - 1]) {
    for (let i = 0; i < grp.count; i++) {
      out.push({ t: grp.delay + i * grp.spacing, type: grp.type, camo: grp.camo });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}

/** Distinct bloon types in a round, strongest last — for the round preview. */
export function roundPreview(round) {
  const seen = [];
  for (const grp of ROUNDS[round - 1]) {
    if (!seen.some((s) => s.type === grp.type && s.camo === grp.camo)) {
      seen.push({ type: grp.type, camo: grp.camo });
    }
  }
  return seen;
}
