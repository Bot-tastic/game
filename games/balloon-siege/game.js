// The simulation. Deliberately free of DOM and rendering concerns so it can be
// stepped headlessly by the balance tool in tools/.
//
// Presentation is decoupled through `state.events`: the sim appends {kind,...}
// records and whoever is driving it drains them each frame for particles and
// sound. Nothing in here needs to know whether anyone is watching.

import { BLOONS, DIFFICULTIES, GAME_SPEED, MAPS, WORLD, canDamage, totalPops } from "./config.js";
import { buildPath, offPath, pointAt } from "./path.js";
import { ROUND_COUNT, buildSchedule, roundReward } from "./rounds.js";
import {
  HERO_ID, HERO_MAX_LEVEL, TOWER_BY_ID, TOWER_RADIUS,
  heroLevel, nextUpgrade, resolveStats, sellValue, upgradeBlocked,
} from "./towers.js";

export const TARGET_MODES = ["first", "last", "strong", "close"];

let nextId = 1;

export function createGame({ mapId, difficultyId, startRound = 1 }) {
  const map = MAPS.find((m) => m.id === mapId) ?? MAPS[0];
  const difficulty = DIFFICULTIES.find((d) => d.id === difficultyId) ?? DIFFICULTIES[1];
  return {
    map,
    path: buildPath(map.points),
    difficulty,
    lives: difficulty.lives,
    cash: difficulty.cash,
    round: startRound,
    phase: "build", // build | wave | won | lost
    bloons: [],
    towers: [],
    projectiles: [],
    effects: [],
    schedule: [],
    spawnIdx: 0,
    waveTime: 0,
    leaked: 0,
    popsTotal: 0,
    cashEarned: 0,
    heroXp: 0,
    heroLevel: 1,
    events: [],
  };
}

// ------------------------------------------------------------ placement ----

export function canPlace(state, x, y, radius = TOWER_RADIUS) {
  if (x < radius || y < radius || x > WORLD.w - radius || y > WORLD.h - radius) return false;
  if (!offPath(state.path, x, y, radius)) return false;
  for (const t of state.towers) {
    if (Math.hypot(t.x - x, t.y - y) < radius + TOWER_RADIUS - 4) return false;
  }
  return true;
}

/** True when this tower type is already on the board and only one is allowed. */
export function alreadyPlaced(state, defId) {
  const def = TOWER_BY_ID[defId];
  return !!def?.unique && state.towers.some((t) => t.defId === defId);
}

export function placeTower(state, defId, x, y) {
  const def = TOWER_BY_ID[defId];
  if (!def || state.cash < def.cost || alreadyPlaced(state, defId)) return null;
  if (!canPlace(state, x, y)) return null;
  state.cash -= def.cost;
  const tower = {
    id: nextId++,
    defId,
    x,
    y,
    tiers: [0, 0],
    level: def.hero ? state.heroLevel : 1,
    cooldown: 0,
    abilityCd: 0,
    buffT: 0,
    buff: null,
    angle: 0,
    target: def.base.defaultTarget ?? "first",
    shotCount: 0,
    pops: 0,
  };
  state.towers.push(tower);
  state.events.push({ kind: "build", x, y });
  return tower;
}

export function buyUpgrade(state, tower, pathIndex) {
  const def = TOWER_BY_ID[tower.defId];
  if (upgradeBlocked(def, tower.tiers, pathIndex)) return false;
  const up = nextUpgrade(def, tower.tiers, pathIndex);
  if (!up || state.cash < up.cost) return false;
  state.cash -= up.cost;
  tower.tiers[pathIndex]++;
  state.events.push({ kind: "upgrade", x: tower.x, y: tower.y, name: up.name });
  return true;
}

export function sellTower(state, tower) {
  const def = TOWER_BY_ID[tower.defId];
  state.cash += sellValue(def, tower.tiers);
  state.towers = state.towers.filter((t) => t !== tower);
  state.events.push({ kind: "sell", x: tower.x, y: tower.y });
}

/** Resolved stats, memoised per tower. This is called for every tower on every
 * simulation tick *and* every frame (targeting, drawing, the ability bar); at
 * 3x speed with twenty towers that was a few hundred object rebuilds a second
 * for numbers that only change when something is bought. */
export function towerStats(tower) {
  const key = `${tower.tiers[0]},${tower.tiers[1]}:${tower.level ?? 1}`;
  if (tower.statsKey !== key) {
    tower.statsKey = key;
    tower.statsCache = resolveStats(TOWER_BY_ID[tower.defId], tower.tiers, tower.level ?? 1);
  }
  return tower.statsCache;
}

// -------------------------------------------------------------- abilities --

export function abilityOf(tower) {
  return towerStats(tower).ability ?? null;
}

export function abilityReady(tower) {
  return !!abilityOf(tower) && (tower.abilityCd ?? 0) <= 0;
}

/** Abilities ignore every immunity — a 40-second cooldown that whiffs on a lead
 * bloon would just be a trap. That is what dmgType "ability" is for. */
function abilityProjectile(tower, extra) {
  return {
    dmgType: "ability",
    pierce: 9999,
    owner: tower,
    hits: new Set(),
    moabBonus: 0,
    ...extra,
  };
}

export function activateAbility(state, tower) {
  const ab = abilityOf(tower);
  if (!ab || (tower.abilityCd ?? 0) > 0) return false;
  tower.abilityCd = ab.cooldown;

  if (ab.kind === "cash") {
    state.cash += ab.amount;
    state.cashEarned += ab.amount;
    state.events.push({ kind: "income", x: tower.x, y: tower.y, amount: ab.amount });
  } else if (ab.kind === "buff") {
    tower.buffT = ab.dur;
    tower.buff = ab;
  } else if (ab.kind === "freeze") {
    for (const b of state.bloons) {
      if (b.hp <= 0) continue;
      if (Math.hypot(b.x - tower.x, b.y - tower.y) > ab.radius) continue;
      const def = BLOONS[b.type];
      if (def.moab) {
        b.slowAmt = Math.max(b.slowAmt, ab.moabSlow);
        b.slowT = Math.max(b.slowT, ab.dur);
      } else {
        b.freezeT = Math.max(b.freezeT, ab.dur);
      }
    }
    state.events.push({ kind: "ability", x: tower.x, y: tower.y, r: Math.min(ab.radius, 900), ab: ab.id, color: "#9fe8ff" });
  } else if (ab.kind === "strike") {
    // Strongest blimp anywhere, falling back to the strongest bloon on screen.
    let best = null;
    let bestKey = -Infinity;
    for (const b of state.bloons) {
      if (b.hp <= 0) continue;
      const key = (BLOONS[b.type].moab ? 1e6 : 0) + b.maxHp * 100 + b.dist;
      if (key > bestKey) { bestKey = key; best = b; }
    }
    if (best) {
      const proj = abilityProjectile(tower, { damage: ab.dmg });
      state.events.push({ kind: "snipe", x1: tower.x, y1: tower.y, x2: best.x, y2: best.y });
      best.slowAmt = Math.max(best.slowAmt, ab.slow);
      best.slowT = Math.max(best.slowT, ab.dur);
      damage(state, best, ab.dmg, proj);
    }
    state.events.push({ kind: "ability", x: tower.x, y: tower.y, r: 60, ab: ab.id, color: "#fff6b0" });
  } else if (ab.kind === "nuke") {
    state.effects.push({
      x: tower.x, y: tower.y, radius: ab.radius, dmg: ab.dmg,
      ticksLeft: ab.ticks, interval: ab.ticks > 1 ? ab.dur / ab.ticks : 0.05,
      t: 0, color: ab.color ?? "#ffb020", owner: tower,
    });
    state.events.push({ kind: "ability", x: tower.x, y: tower.y, r: ab.radius, ab: ab.id, color: ab.color ?? "#ffb020" });
  }
  return true;
}

function updateEffects(state, dt) {
  const alive = [];
  for (const e of state.effects) {
    e.t -= dt;
    while (e.ticksLeft > 0 && e.t <= 0) {
      e.t += e.interval;
      e.ticksLeft--;
      const proj = abilityProjectile(e.owner, { damage: e.dmg });
      for (const b of state.bloons) {
        if (b.hp <= 0) continue;
        if (Math.hypot(b.x - e.x, b.y - e.y) > e.radius + b.r) continue;
        damage(state, b, e.dmg, proj);
      }
      state.events.push({ kind: "blast", x: e.x, y: e.y, r: e.radius, color: e.color });
    }
    if (e.ticksLeft > 0) alive.push(e);
  }
  state.effects = alive;
}

// ----------------------------------------------------------------- wave ----

/** A round may be started during the previous one, once everything in it has
 * spawned. Sending the next wave early is the main way an aggressive player
 * gets ahead on cash, and it is what stops the mid-game from being a wait. */
export function canStartRound(state) {
  if (state.phase === "build") return state.round <= ROUND_COUNT;
  return false;
}

export function startRound(state) {
  if (!canStartRound(state)) return false;
  state.schedule = buildSchedule(state.round);
  state.spawnIdx = 0;
  state.waveTime = 0;
  state.phase = "wave";
  state.events.push({ kind: "roundStart", round: state.round });
  return true;
}

function spawnBloon(state, type, camo, dist = 0) {
  const def = BLOONS[type];
  state.bloons.push({
    id: nextId++,
    type,
    dist,
    hp: def.hp,
    maxHp: def.hp,
    camo,
    r: def.r,
    slowT: 0,
    slowAmt: 0,
    freezeT: 0,
    x: 0,
    y: 0,
  });
}

/** Paid out the moment a round has finished spawning, not when the board is
 * clear — that is what lets the next round overlap the tail of this one. */
function endRound(state) {
  const payout = Math.round(roundReward(state.round) * state.difficulty.reward);
  state.cash += payout;
  state.cashEarned += payout;
  for (const t of state.towers) {
    const s = towerStats(t);
    if (s.income) {
      const income = Math.round(s.income * state.difficulty.reward);
      state.cash += income;
      state.cashEarned += income;
      state.events.push({ kind: "income", x: t.x, y: t.y, amount: income });
    }
    if (s.lifeGain) state.lives += s.lifeGain;
  }
  state.events.push({ kind: "roundEnd", round: state.round, payout });
  state.round++;
  state.phase = "build";
}

// --------------------------------------------------------------- damage ----

/** Applies `amount` damage from `proj` to `bloon`. Returns true if it landed,
 * which is what consumes a projectile's pierce. */
function damage(state, bloon, amount, proj) {
  if (bloon.hp <= 0) return false;
  if (!canDamage(bloon, proj)) {
    state.events.push({ kind: "immune", x: bloon.x, y: bloon.y });
    return false;
  }
  const def = BLOONS[bloon.type];
  // Blimp bonuses: without them the top-tier upgrades cannot keep up with the
  // HP curve of the last five rounds on the shorter maps.
  const dealt = def.moab && proj.moabBonus ? amount * proj.moabBonus : amount;
  bloon.hp -= dealt;
  if (def.moab) state.events.push({ kind: "dmg", x: bloon.x, y: bloon.y, amount: Math.round(dealt) });

  if (proj.slow) {
    const resist = def.slowResist ?? 1;
    const amt = proj.slow * resist;
    if (amt > bloon.slowAmt || bloon.slowT <= 0) bloon.slowAmt = amt;
    bloon.slowT = Math.max(bloon.slowT, proj.slowDur ?? 1.5);
  }
  if (proj.freeze && !def.moab) bloon.freezeT = Math.max(bloon.freezeT, proj.freeze);
  if (proj.moabSlow && def.moab) {
    bloon.slowAmt = Math.max(bloon.slowAmt, proj.moabSlow);
    bloon.slowT = Math.max(bloon.slowT, 3);
  }

  if (bloon.hp <= 0) popBloon(state, bloon, proj);
  else state.events.push({ kind: "hit", x: bloon.x, y: bloon.y, color: def.color });
  return true;
}

/** Hero XP. Everything the defence pops feeds it, so the hero keeps climbing
 * even while it is not the tower doing the work — the point is a number that
 * visibly grows across a run, not a second economy to micromanage. */
function gainXp(state, amount) {
  if (state.heroLevel >= HERO_MAX_LEVEL) return;
  state.heroXp += amount;
  const lvl = heroLevel(state.heroXp);
  if (lvl === state.heroLevel) return;
  state.heroLevel = lvl;
  for (const t of state.towers) {
    if (t.defId === HERO_ID) {
      t.level = lvl;
      state.events.push({ kind: "heroLevel", x: t.x, y: t.y, level: lvl });
    }
  }
}

function popBloon(state, bloon, proj) {
  const def = BLOONS[bloon.type];
  bloon.hp = 0;
  state.popsTotal++;
  const reward = Math.max(1, Math.round((1 + (def.cashBonus ?? 0)) * state.difficulty.reward));
  state.cash += reward;
  state.cashEarned += reward;
  gainXp(state, 1 + (def.cashBonus ?? 0) * 2);
  if (proj.owner) proj.owner.pops++;
  state.events.push({
    kind: "pop",
    x: bloon.x,
    y: bloon.y,
    color: def.color,
    r: bloon.r,
    moab: !!def.moab,
    reward: def.cashBonus ? reward : 0,
  });

  // Children inherit camo and trail slightly behind so they fan out visibly.
  def.children.forEach((child, i) => {
    const back = i * (BLOONS[child].r * 0.9);
    spawnBloon(state, child, bloon.camo, Math.max(0, bloon.dist - back));
  });
}

/** Damage everything within `radius` of (x, y), respecting remaining pierce. */
function explode(state, x, y, radius, amount, proj) {
  let left = proj.pierce;
  for (const b of state.bloons) {
    if (left <= 0) break;
    if (b.hp <= 0) continue;
    if (Math.hypot(b.x - x, b.y - y) > radius + b.r) continue;
    if (damage(state, b, amount, proj)) left--;
  }
  state.events.push({ kind: "blast", x, y, r: radius });
}

// --------------------------------------------------------------- towers ----

function visible(bloon, stats) {
  return !bloon.camo || !!stats.camo;
}

function pickTarget(tower, stats, bloons, range) {
  let best = null;
  let bestKey = -Infinity;
  for (const b of bloons) {
    if (b.hp <= 0 || !visible(b, stats)) continue;
    const d = Math.hypot(b.x - tower.x, b.y - tower.y);
    if (d > range + b.r) continue;
    let key;
    if (tower.target === "first") key = b.dist;
    else if (tower.target === "last") key = -b.dist;
    else if (tower.target === "close") key = -d;
    else key = totalPops(b.type) * 1000 + b.dist; // strong
    if (key > bestKey) {
      bestKey = key;
      best = b;
    }
  }
  return best;
}

function makeProjectile(tower, stats, extra) {
  return {
    damage: stats.damage ?? 1,
    pierce: stats.pierce ?? 1,
    dmgType: stats.dmgType ?? "sharp",
    popsLead: !!stats.popsLead,
    popsBlack: !!stats.popsBlack,
    popsWhite: !!stats.popsWhite,
    blast: stats.blast ?? 0,
    slow: stats.slow ?? 0,
    slowDur: stats.slowDur ?? 0,
    freeze: stats.freeze ?? 0,
    moabSlow: stats.moabSlow ?? 0,
    moabBonus: stats.moabBonus ?? 0,
    tint: stats.tint ?? null,
    owner: tower,
    hits: new Set(),
    life: stats.projLife ?? 1.6,
    ...extra,
  };
}

function fire(state, tower, stats, target) {
  const speed = stats.projSpeed ?? 400;

  if (stats.hitscan) {
    const proj = makeProjectile(tower, stats, { x: target.x, y: target.y });
    let left = stats.pierce ?? 1;
    const ordered = [target, ...state.bloons.filter((b) => b !== target && b.hp > 0 && visible(b, stats))];
    for (const b of ordered) {
      if (left <= 0) break;
      if (damage(state, b, stats.damage, proj)) left--;
    }
    state.events.push({ kind: "snipe", x1: tower.x, y1: tower.y, x2: target.x, y2: target.y });
    return;
  }

  if (stats.radial) {
    const n = stats.count;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + tower.shotCount * 0.19;
      state.projectiles.push(makeProjectile(tower, stats, {
        x: tower.x, y: tower.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
      }));
    }
    state.events.push({ kind: "shoot", x: tower.x, y: tower.y, tower: tower.defId });
    return;
  }

  const baseAngle = Math.atan2(target.y - tower.y, target.x - tower.x);
  const n = stats.count ?? 1;
  const spread = stats.spread ?? 0;
  for (let i = 0; i < n; i++) {
    const a = baseAngle + (n > 1 ? (i / (n - 1) - 0.5) * spread : 0);
    const fireball = stats.fireball && (tower.shotCount % stats.fireball === 0);
    state.projectiles.push(makeProjectile(tower, stats, {
      x: tower.x,
      y: tower.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      homing: stats.homing ? target : null,
      turnRate: stats.homing ? (stats.projSpeed ?? 400) : 0,
      speed,
      blast: fireball ? Math.max(stats.blast ?? 0, 42) : (stats.blast ?? 0),
      cluster: stats.cluster ?? 0,
    }));
  }
  state.events.push({ kind: "shoot", x: tower.x, y: tower.y, tower: tower.defId });
}

function updateTowers(state, dt) {
  for (const tower of state.towers) {
    if (tower.abilityCd > 0) {
      tower.abilityCd -= dt;
      if (tower.abilityCd <= 0) {
        tower.abilityCd = 0;
        state.events.push({ kind: "abilityReady", x: tower.x, y: tower.y });
      }
    }

    const base = towerStats(tower);
    // An active buff is a temporary copy of the stats, so it expires cleanly
    // without ever writing back into the tower's real numbers.
    let stats = base;
    if (tower.buffT > 0) {
      tower.buffT -= dt;
      stats = { ...base };
      if (tower.buff?.rateMul) stats.rate = (stats.rate ?? 1) * tower.buff.rateMul;
      if (tower.buff?.pierce) stats.pierce = (stats.pierce ?? 1) + tower.buff.pierce;
      if (tower.buffT <= 0) tower.buff = null;
    }

    if (stats.support) continue;
    const range = stats.range;

    if (stats.aura) {
      for (const b of state.bloons) {
        if (b.hp <= 0 || !visible(b, stats)) continue;
        if (Math.hypot(b.x - tower.x, b.y - tower.y) > range) continue;
        if (BLOONS[b.type].immune?.includes("cold")) continue;
        const amt = stats.aura * (BLOONS[b.type].slowResist ?? 1);
        if (amt > b.slowAmt || b.slowT <= 0) b.slowAmt = amt;
        b.slowT = Math.max(b.slowT, 0.2);
      }
    }

    tower.cooldown -= dt;
    if (tower.cooldown > 0) continue;

    if (stats.pulse) {
      const inRange = state.bloons.filter(
        (b) => b.hp > 0 && visible(b, stats) && Math.hypot(b.x - tower.x, b.y - tower.y) <= range + b.r,
      );
      if (!inRange.length) continue;
      const proj = makeProjectile(tower, stats, { x: tower.x, y: tower.y });
      let left = stats.pierce;
      for (const b of inRange) {
        if (left <= 0) break;
        if (damage(state, b, stats.damage, proj)) left--;
      }
      state.events.push({ kind: "pulse", x: tower.x, y: tower.y, r: range });
      tower.shotCount++;
      tower.cooldown = 1 / stats.rate;
      continue;
    }

    const target = pickTarget(tower, stats, state.bloons, range);
    if (!target) continue;

    tower.angle = Math.atan2(target.y - tower.y, target.x - tower.x);
    fire(state, tower, stats, target);
    tower.shotCount++;
    tower.cooldown = 1 / stats.rate;
  }
}

// ---------------------------------------------------------- projectiles ----

/** Closest distance from point (px,py) to segment (ax,ay)-(bx,by). */
function segmentDistance(ax, ay, bx, by, px, py) {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-6) return Math.hypot(px - ax, py - ay);
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function updateProjectiles(state, dt) {
  const alive = [];
  for (const p of state.projectiles) {
    if (p.homing && p.homing.hp > 0) {
      const want = Math.atan2(p.homing.y - p.y, p.homing.x - p.x);
      const cur = Math.atan2(p.vy, p.vx);
      let diff = ((want - cur + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
      const maxTurn = 7 * dt;
      const a = cur + Math.max(-maxTurn, Math.min(maxTurn, diff));
      p.vx = Math.cos(a) * p.speed;
      p.vy = Math.sin(a) * p.speed;
    }
    const px = p.x;
    const py = p.y;
    p.x += p.vx * dt;
    p.y += p.vy * dt;
    p.life -= dt;

    let spent = false;
    for (const b of state.bloons) {
      if (p.pierce <= 0) break;
      if (b.hp <= 0 || p.hits.has(b.id)) continue;
      // Swept against the step's travel segment: a fast dart covers more than a
      // bloon's diameter per tick and a point test would shoot straight through.
      if (segmentDistance(px, py, p.x, p.y, b.x, b.y) > b.r + 4) continue;
      p.hits.add(b.id);
      if (p.blast > 0) {
        explode(state, p.x, p.y, p.blast, p.damage, p);
        if (p.cluster) spawnCluster(state, p);
        spent = true;
        break;
      }
      if (damage(state, b, p.damage, p)) p.pierce--;
    }

    if (spent || p.pierce <= 0 || p.life <= 0) {
      if (!spent && p.life <= 0 && p.blast > 0 && p.cluster) spawnCluster(state, p);
      continue;
    }
    if (p.x < -60 || p.x > WORLD.w + 60 || p.y < -60 || p.y > WORLD.h + 60) continue;
    alive.push(p);
  }
  state.projectiles = alive;
}

function spawnCluster(state, parent) {
  for (let i = 0; i < parent.cluster; i++) {
    const a = (i / parent.cluster) * Math.PI * 2 + Math.random();
    state.projectiles.push({
      ...parent,
      hits: new Set(),
      pierce: Math.max(2, Math.round(parent.pierce * 0.5)),
      damage: Math.max(1, parent.damage - 1),
      blast: parent.blast * 0.6,
      cluster: 0,
      x: parent.x,
      y: parent.y,
      vx: Math.cos(a) * 170,
      vy: Math.sin(a) * 170,
      life: 0.45,
      homing: null,
    });
  }
}

// --------------------------------------------------------------- bloons ----

function updateBloons(state, dt) {
  const pathLen = state.path.length;
  const alive = [];
  for (const b of state.bloons) {
    if (b.hp <= 0) continue;
    const def = BLOONS[b.type];

    let speed = def.speed * state.map.speedMul;
    if (b.freezeT > 0) {
      b.freezeT -= dt;
      speed = 0;
    } else if (b.slowT > 0) {
      b.slowT -= dt;
      speed *= 1 - b.slowAmt;
    }
    b.dist += speed * dt;

    if (b.dist >= pathLen) {
      const cost = Math.min(totalPops(b.type), 200);
      state.lives -= cost;
      state.leaked += cost;
      state.events.push({ kind: "leak", amount: cost, moab: !!def.moab });
      continue;
    }
    const p = pointAt(state.path, b.dist);
    b.x = p.x;
    b.y = p.y;
    alive.push(b);
  }
  state.bloons = alive;
}

// ----------------------------------------------------------------- step ----

export function update(state, realDt) {
  if (state.phase === "won" || state.phase === "lost") return;
  const dt = realDt * GAME_SPEED;

  if (state.phase === "wave") {
    state.waveTime += dt;
    while (state.spawnIdx < state.schedule.length && state.schedule[state.spawnIdx].t <= state.waveTime) {
      const e = state.schedule[state.spawnIdx++];
      spawnBloon(state, e.type, e.camo);
    }
  }

  // Bloons move before towers fire so a tower never shoots at a stale position.
  updateBloons(state, dt);
  updateTowers(state, dt);
  updateEffects(state, dt);
  updateProjectiles(state, dt);

  if (state.lives <= 0) {
    state.lives = 0;
    state.phase = "lost";
    state.events.push({ kind: "lost" });
    return;
  }

  if (state.phase === "wave" && state.spawnIdx >= state.schedule.length) endRound(state);

  // The run is only won once the last round is both sent and cleaned up.
  if (state.phase === "build" && state.round > ROUND_COUNT && state.bloons.length === 0) {
    state.phase = "won";
    state.events.push({ kind: "won" });
  }
}

export { ROUND_COUNT };
