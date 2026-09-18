// Headless balance check: plays every map and difficulty with the reference bot
// in tools/bot.mjs and reports how far it gets.
//   node games/balloon-siege/tools/simulate.mjs                 full sweep
//   node games/balloon-siege/tools/simulate.mjs canyon hard     one verbose run
//   node games/balloon-siege/tools/simulate.mjs --leaks [runs]  leaked-lives table
//
// The leaks table is the one to tune against: it plays with unlimited lives, so
// it reports how much threat got through rather than a coarse win/lose flag.

import { MAPS, DIFFICULTIES } from "../config.js";
import { ROUND_COUNT } from "../game.js";
import { playRun } from "./bot.mjs";

const [, , arg1, arg2] = process.argv;

if (arg1 === "--leaks") {
  const runs = Number(arg2 ?? 3);
  for (const map of MAPS) {
    const cells = [];
    for (const diff of DIFFICULTIES) {
      let total = 0;
      for (let i = 0; i < runs; i++) total += playRun(map.id, diff.id, { endless: true }).leaked;
      cells.push(`${diff.id}:${String(Math.round(total / runs)).padStart(5)}`);
    }
    console.log(`${map.id.padEnd(11)} ${map.difficulty.padEnd(9)} ${cells.join("  ")}`);
  }
} else if (arg1) {
  const log = [];
  const state = playRun(arg1, arg2 ?? "normal", {
    onRound: ({ round, secs, leaked, cashAtStart, state: s }) => {
      log.push(
        `r${String(round).padStart(2)} ${secs.toFixed(0).padStart(3)}s  ` +
        `lives ${String(s.lives).padStart(4)}${leaked > 0 ? ` (-${leaked})` : "     "}  ` +
        `cash ${String(cashAtStart).padStart(5)}→${String(s.cash).padStart(5)}  ` +
        `towers ${String(s.towers.length).padStart(2)}  hero L${s.heroLevel}`,
      );
    },
  });
  console.log(log.join("\n"));
  console.log(`\n${state.phase.toUpperCase()} — reached round ${Math.min(state.round, ROUND_COUNT)}/${ROUND_COUNT}, ${state.lives} lives left`);
} else {
  for (const map of MAPS) {
    for (const diff of DIFFICULTIES) {
      const state = playRun(map.id, diff.id);
      const outcome = state.phase === "won"
        ? `WON with ${state.lives} lives`
        : `lost on round ${Math.min(state.round, ROUND_COUNT)}`;
      console.log(`${map.id.padEnd(11)} ${diff.id.padEnd(7)} ${outcome}`);
    }
  }
}
