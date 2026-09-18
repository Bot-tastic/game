// The 40-round table.
//
// A round is a list of groups; each group releases `count` bloons of one type,
// `spacing` seconds apart, starting `delay` seconds into the round. Groups run
// in parallel, which is what makes the later rounds feel like a real push
// rather than a single queue.

/** @param camo — camo bloons are invisible to towers without detection. */
function g(type, count, spacing, delay = 0, camo = false) {
  return { type, count, spacing, delay, camo };
}

export const ROUNDS = [
  [g("red", 20, 0.55)],
  [g("red", 32, 0.42)],
  [g("red", 16, 0.5), g("blue", 10, 0.5, 4)],
  [g("blue", 16, 0.42), g("red", 12, 0.5, 3)],
  [g("blue", 28, 0.38)],
  [g("blue", 16, 0.4), g("green", 9, 0.6, 3)],
  [g("green", 13, 0.5), g("blue", 16, 0.4, 2)],
  [g("green", 22, 0.36)],
  [g("green", 12, 0.45), g("yellow", 10, 0.6, 4)],
  [g("yellow", 26, 0.32)],
  [g("yellow", 16, 0.36), g("green", 14, 0.45, 2)],
  [g("green", 22, 0.35), g("yellow", 10, 0.5, 3, true)],
  [g("pink", 16, 0.4), g("yellow", 12, 0.4, 2)],
  [g("pink", 22, 0.32), g("yellow", 12, 0.45, 4)],
  [g("black", 13, 0.5), g("pink", 10, 0.4, 3)],
  [g("white", 12, 0.5), g("black", 9, 0.55, 2)],
  [g("lead", 10, 0.7), g("pink", 14, 0.4, 3)],
  [g("pink", 20, 0.34, 0, true), g("black", 8, 0.5, 4)],
  [g("black", 14, 0.42), g("white", 14, 0.42, 1.5)],
  [g("rainbow", 10, 0.7), g("black", 10, 0.45, 4)],
  [g("lead", 12, 0.6), g("pink", 22, 0.3, 2)],
  [g("rainbow", 20, 0.45)],
  [g("ceramic", 8, 0.9), g("rainbow", 10, 0.5, 4)],
  [g("rainbow", 16, 0.5, 0, true), g("lead", 8, 0.7, 3)],
  [g("ceramic", 14, 0.7), g("white", 14, 0.4, 3)],
  [g("lead", 20, 0.45), g("rainbow", 14, 0.5, 3)],
  [g("ceramic", 18, 0.6), g("black", 18, 0.35, 4)],
  [g("rainbow", 26, 0.35), g("lead", 12, 0.6, 3)],
  [g("ceramic", 20, 0.5), g("rainbow", 18, 0.4, 5)],
  [g("moab", 1, 1), g("ceramic", 10, 0.6, 6)],
  [g("ceramic", 24, 0.45, 0, true), g("lead", 14, 0.5, 4)],
  [g("moab", 2, 4), g("ceramic", 16, 0.5, 4)],
  [g("moab", 3, 3.5), g("ceramic", 20, 0.45, 5)],
  [g("ceramic", 32, 0.35), g("rainbow", 24, 0.35, 4, true)],
  [g("moab", 4, 3), g("ceramic", 20, 0.45, 6)],
  [g("rainbow", 40, 0.28, 0, true), g("lead", 18, 0.45, 4)],
  [g("bfb", 1, 1), g("moab", 2, 4, 8)],
  [g("moab", 5, 2.8), g("ceramic", 26, 0.35, 5)],
  [g("bfb", 1, 6), g("moab", 4, 3.5, 8)],
  [g("zomg", 1, 1), g("bfb", 1, 8, 22), g("ceramic", 16, 0.4, 12)],
];

export const ROUND_COUNT = ROUNDS.length;

/** Cash handed out for surviving a round. Grows quadratically so the top-tier
 * upgrades stay reachable in the last third — a linear payout left the player
 * permanently one round behind the bloons. */
export function roundReward(round) {
  return Math.round(100 + round * 8 + round * round * 1.6);
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
