import { lockViewport, onPointer, fitCanvasToScreen, createLoop, showToast } from "../../shared/game-utils.js";
import { P, createBike, placeBike, launchBike, stepBike } from "./physics.js";
import { buildLevel, createEndless, makeBot } from "./levels.js";
import { THEMES, LEVEL_COUNT, LEVELS_PER_WORLD } from "./themes.js";
import { BIKES, CHALLENGES, bikeById, drawBike } from "./bikes.js";
import { Sound, vibrate } from "./audio.js";
import { FX } from "./fx.js";
import { Camera, Trail, drawBackground, worldTransform, drawTrack, drawMarkers, drawGems, drawRider, drawSpeedLines } from "./render.js";

// ---------------------------------------------------------------- save

const SAVE_KEY = "rider-save-v1";
const GIFT_COOLDOWN = 4 * 3600 * 1000;
const REVIVE_COST = 30;

function defaultSave() {
  return {
    gems: 0,
    bike: "neon",
    owned: ["neon"],
    levels: {},
    unlocked: 1,
    bestEndless: 0,
    stats: { flips: 0, maxFlip: 0, perfects: 0, loops: 0, crashes: 0, distance: 0, gemsTotal: 0, levelsDone: 0 },
    settings: { sfx: true, music: true, vibe: true },
    lastGift: 0,
    tutorial: false,
  };
}

function loadSave() {
  const d = defaultSave();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return d;
    const s = JSON.parse(raw);
    return { ...d, ...s, stats: { ...d.stats, ...(s.stats || {}) }, settings: { ...d.settings, ...(s.settings || {}) } };
  } catch {
    return d;
  }
}

let save = loadSave();
function persist() {
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify(save));
  } catch {
    // private mode / quota
  }
}

// ---------------------------------------------------------------- dom

const $ = (id) => document.getElementById(id);
const canvas = $("game");
const ctx = canvas.getContext("2d");
const toastEl = $("toast");
let W = 0;
let H = 0;
lockViewport(canvas);
fitCanvasToScreen(canvas, (w, h) => {
  W = w;
  H = h;
});

const sound = new Sound();
const fx = new FX();
const camera = new Camera();
const trail = new Trail();

const screens = ["scr-menu", "scr-levels", "scr-garage", "scr-settings"];
const overlays = ["ov-pause", "ov-complete", "ov-over", "ov-confirm"];

function showScreen(id) {
  for (const s of screens) $(s).hidden = s !== id;
  for (const o of overlays) $(o).hidden = true;
  $("hud").hidden = true;
  $("tap").hidden = true;
  $("hint").hidden = true;
  if (id === "scr-menu") refreshMenu();
  if (id === "scr-levels") renderLevels();
  if (id === "scr-garage") renderGarage();
  if (id === "scr-settings") renderSettings();
}

function toast(text) {
  showToast(toastEl, text, 1600);
}

// ---------------------------------------------------------------- run state

let S = null; // current run
let paused = false;
let time = 0;
let acc = 0;
const ev = [];
let holdKeys = 0;
const holdPointers = new Set();
const isHolding = () => holdKeys > 0 || holdPointers.size > 0;

const AUTOPLAY = new URLSearchParams(location.search).has("autoplay");

function startRun(mode, level = 1) {
  if (mode !== "demo") sound.unlock();
  let world;
  let theme;
  if (mode === "level") {
    world = buildLevel(level);
    theme = world.theme;
    const prev = save.levels[level];
    if (prev && prev.gems) {
      const got = new Set(prev.gems);
      for (const g of world.track.gems) if (got.has(g.id)) g.old = true;
    }
  } else {
    world = createEndless(mode === "demo" ? (Math.random() * 1e9) | 0 : (Date.now() & 0xffffff) + 7);
    theme = THEMES[0];
  }
  const bike = createBike();
  placeBike(bike, world.track, world.start);
  S = {
    mode, level, world, track: world.track, bike, theme, themeIdx: 0,
    lastCp: world.start, flips: 0, crashes: 0, trick: 0, score: 0, combo: 0, comboT: 0,
    runGems: [], gemCount: 0, perfects: 0, finishT: -1, overT: -1, respawnT: -1, launchT: -1,
    slowT: 0, revived: false, bestJump: 0, bot: mode === "demo" || AUTOPLAY ? makeBot({ flips: true, maxFlips: 2 }) : null,
    def: bikeById(mode === "demo" ? BIKES[(Math.random() * 12) | 0].id : save.bike),
    tutorial: mode === "level" && level === 1 && !save.tutorial,
  };
  if (mode === "demo") launchBike(bike);
  camera.snap();
  trail.clear();
  fx.clear();
  acc = 0;
  paused = false;
  if (mode !== "demo") {
    for (const s of screens) $(s).hidden = true;
    for (const o of overlays) $(o).hidden = true;
    $("hud").hidden = false;
    $("tap").hidden = false;
    $("hint").hidden = !S.tutorial;
    $("hud-level").textContent = mode === "level" ? `LEVEL ${level}` : "ENDLESS";
    $("hud-progress-wrap").hidden = mode !== "level";
    $("hud-score").hidden = mode === "level";
    $("hud-flips").hidden = mode !== "level";
    buildProgressMarks();
    updateHud(true);
  }
  sound.setMusic(true, theme.musicRoot);
}

function startDemo() {
  startRun("demo");
}

function buildProgressMarks() {
  const wrap = $("hud-cp-marks");
  wrap.innerHTML = "";
  if (S.mode !== "level") return;
  const span = S.track.finish.x - S.world.startX;
  for (const cp of S.track.checkpoints) {
    const m = document.createElement("i");
    m.style.left = `${((cp.x - S.world.startX) / span) * 100}%`;
    wrap.appendChild(m);
  }
}

const FLIP_NAMES = ["", "FLIP!", "DOUBLE FLIP!", "TRIPLE FLIP!", "QUAD FLIP!", "PENTA FLIP!"];

function handleEvent(e) {
  const b = S.bike;
  const demo = S.mode === "demo";
  const sfx = (n, a) => !demo && sound.play(n, a);
  switch (e.type) {
    case "takeoff":
      sfx("jump");
      break;
    case "flip":
      fx.popup(FLIP_NAMES[Math.min(e.n, 5)] + (e.n > 5 ? ` x${e.n}` : ""), S.theme.accent, 30 + Math.min(e.n, 4) * 4);
      sfx("flip", e.n);
      break;
    case "land": {
      if (e.airTime > 0.22) {
        sfx("land");
        fx.dust(b.x, b.y, S.theme.line, Math.cos(b.angle), 6 + Math.min(10, Math.round(e.impact / 80)));
        fx.shake = Math.max(fx.shake, Math.min(8, e.impact / 120));
      }
      if (e.flips > 0) {
        S.combo++;
        S.comboT = 0;
        const base = (100 * e.flips * (e.flips + 1)) / 2;
        const mult = 1 + (S.combo - 1) * 0.5;
        let pts = Math.round(base * mult);
        if (e.perfect) pts += 100;
        S.trick += pts;
        S.flips += e.flips;
        S.bestJump = Math.max(S.bestJump, e.flips);
        if (e.perfect) {
          S.perfects++;
          fx.popup("PERFECT!", "#ffffff", 40, `+${pts}${S.combo > 1 ? `  COMBO x${S.combo}` : ""}`);
          fx.ring(b.x, b.y - 20, S.theme.accent, 120, 0.5);
          sfx("perfect");
          if (!demo) vibrate(save.settings.vibe, 25);
        } else {
          fx.popup(`+${pts}`, S.theme.line, 28, S.combo > 1 ? `COMBO x${S.combo}` : "");
        }
        if (!demo) {
          save.stats.flips += e.flips;
          save.stats.maxFlip = Math.max(save.stats.maxFlip, e.flips);
          if (e.perfect) save.stats.perfects++;
          if (S.tutorial) {
            S.tutorial = false;
            save.tutorial = true;
            $("hint").hidden = true;
            toast("Nice! Flip for stars ★");
          }
          checkChallenges();
        }
      }
      break;
    }
    case "boost":
      sfx("boost");
      break;
    case "loop":
      sfx("loop");
      fx.popup("LOOP!", S.theme.line, 26);
      S.trick += 50;
      if (!demo) save.stats.loops++;
      break;
    case "gem": {
      const g = e.gem;
      fx.gemBurst(g.x, g.y);
      sfx("gem", S.gemCount % 8);
      if (!g.old) {
        S.gemCount++;
        if (S.mode === "level") S.runGems.push(g.id);
      }
      break;
    }
    case "checkpoint":
      S.lastCp = e.cp;
      if (!e.cp.hidden) {
        sfx("checkpoint");
        fx.popup("CHECKPOINT", "#ffffff", 24);
        fx.ring(e.cp.x, e.cp.y - 60, S.theme.accent, 90, 0.5);
      }
      break;
    case "finish":
      S.finishT = time;
      sfx("finish");
      for (let k = 0; k < 4; k++) fx.spark(b.x + 100 + k * 60, b.y - 160, k % 2 ? S.theme.accent : S.theme.line, 20, 500, 1.1);
      if (!demo) vibrate(save.settings.vibe, [30, 40, 30]);
      break;
    case "crash":
      fx.shatter(e.x, e.y, e.angle, e.vx || b.v * Math.cos(e.angle), e.vy || 0, S.def.color === "#ffffff" ? "#ffffff" : S.def.color, S.def.rider);
      S.combo = 0;
      S.slowT = 0.55;
      trail.clear();
      if (demo) {
        S.respawnT = time + 1.2;
        break;
      }
      sound.play("crash");
      vibrate(save.settings.vibe, [70, 40, 90]);
      S.crashes++;
      save.stats.crashes++;
      if (S.mode === "level") S.respawnT = time + 1.25;
      else S.overT = time + 1.3;
      break;
  }
}

function respawn() {
  const b = S.bike;
  placeBike(b, S.track, S.lastCp);
  trail.clear();
  S.respawnT = -1;
  S.launchT = time + 0.45;
  camera.snap();
}

function finishLevel() {
  const n = S.level;
  const lvl = S.world;
  const starFlips = S.flips >= lvl.flipTarget;
  const starClean = S.crashes === 0;
  const stars = 1 + (starFlips ? 1 : 0) + (starClean ? 1 : 0);
  const prev = save.levels[n] || { stars: 0, gems: [] };
  const wasDone = prev.stars > 0;
  const gemSet = new Set(prev.gems || []);
  let newGems = 0;
  for (const id of S.runGems) {
    if (!gemSet.has(id)) {
      gemSet.add(id);
      newGems++;
    }
  }
  save.levels[n] = { stars: Math.max(prev.stars, stars), gems: [...gemSet], best: Math.max(prev.best || 0, S.trick) };
  save.unlocked = Math.max(save.unlocked, Math.min(LEVEL_COUNT, n + 1));
  save.gems += newGems;
  save.stats.gemsTotal += newGems;
  save.stats.distance += Math.round(S.bike.distance / 100);
  if (!wasDone) save.stats.levelsDone++;
  checkChallenges();
  persist();

  $("cmp-title").textContent = n === LEVEL_COUNT ? "ALL LEVELS DONE!" : `LEVEL ${n} COMPLETE`;
  const starsEl = $("cmp-stars");
  starsEl.innerHTML = "";
  for (let i = 0; i < 3; i++) {
    const s = document.createElement("span");
    s.textContent = "★";
    if (i < stars) {
      s.className = "on";
      s.style.animationDelay = `${0.25 + i * 0.3}s`;
      setTimeout(() => sound.play("star", i), 250 + i * 300);
    }
    starsEl.appendChild(s);
  }
  $("cmp-req").innerHTML =
    `<li class="${"ok"}">★ Finish the level</li>` +
    `<li class="${starFlips ? "ok" : ""}">★ ${lvl.flipTarget}+ flips (${S.flips})</li>` +
    `<li class="${starClean ? "ok" : ""}">★ No crashes (${S.crashes})</li>`;
  $("cmp-gems").textContent = `+${newGems}  (${gemSet.size}/${lvl.gemTotal} found)`;
  $("cmp-score").textContent = S.trick.toLocaleString();
  $("btn-next").hidden = n >= LEVEL_COUNT;
  $("ov-complete").hidden = false;
  $("hud").hidden = true;
}

function endlessOver() {
  const b = S.bike;
  const prevBest = save.bestEndless;
  S.runGemsTotal = (S.runGemsTotal || 0) + S.gemCount;
  commitEndless();
  const best = save.bestEndless;
  const isBest = S.score > prevBest;
  $("over-score").textContent = S.score.toLocaleString();
  $("over-best").textContent = best.toLocaleString();
  $("over-new").hidden = !isBest;
  $("over-dist").textContent = `${Math.round(b.distance / 100)} m`;
  $("over-flips").textContent = S.flips;
  $("over-gems").textContent = S.runGemsTotal;
  const canRevive = !S.revived && save.gems >= REVIVE_COST;
  $("btn-revive").textContent = `Revive 💎 ${REVIVE_COST}`;
  $("btn-revive").hidden = S.revived;
  $("btn-revive").disabled = !canRevive;
  $("ov-over").hidden = false;
  $("hud").hidden = true;
}

// Bank everything earned so far in this endless run. Safe to call repeatedly.
function commitEndless() {
  if (!S || S.mode !== "endless") return;
  S.score = Math.floor(S.bike.distance / 10) + S.trick;
  save.bestEndless = Math.max(save.bestEndless, S.score);
  save.gems += S.gemCount;
  save.stats.gemsTotal += S.gemCount;
  S.gemCount = 0;
  const m = Math.round(S.bike.distance / 100);
  save.stats.distance += m - (S.distBanked || 0);
  S.distBanked = m;
  checkChallenges();
  persist();
}

function checkChallenges() {
  for (const bk of BIKES) {
    if (!bk.challenge || save.owned.includes(bk.id)) continue;
    if (CHALLENGES[bk.challenge].test(save.stats, save)) {
      save.owned.push(bk.id);
      persist();
      sound.play("unlock");
      setTimeout(() => toast(`NEW BIKE: ${bk.name}!`), 300);
    }
  }
}

// ---------------------------------------------------------------- loop

function update(dt) {
  time += dt;
  if (!S) return;
  const b = S.bike;
  if (!paused) {
    let scale = 1;
    if (S.slowT > 0) {
      S.slowT -= dt;
      scale = 0.3;
    }
    if (S.launchT > 0 && time >= S.launchT) {
      S.launchT = -1;
      if (b.mode === "ready") launchBike(b);
    }
    if (S.world.extend) S.world.extend(b.x + 7000);
    acc += dt * scale;
    let steps = 0;
    while (acc >= P.DT && steps < 10) {
      acc -= P.DT;
      steps++;
      ev.length = 0;
      const hold = S.bot ? S.bot(b, S.track) : isHolding() && S.launchT < 0;
      stepBike(b, S.track, hold, P.DT, ev);
      for (const e of ev) handleEvent(e);
    }
    if (b.mode === "ground") {
      S.comboT += dt;
      if (S.comboT > 2.5) S.combo = 0;
    }
    if (b.mode !== "crashed" && b.mode !== "ready") {
      const c = Math.cos(b.angle);
      const s = Math.sin(b.angle);
      trail.push(b.x - 27 * c + 13 * s, b.y - 27 * s - 13 * c);
    }
    fx.update(dt * (S.slowT > 0 ? 0.5 : 1));

    if (S.respawnT > 0 && time >= S.respawnT) {
      if (S.mode === "demo") startDemo();
      else respawn();
    }
    if (S.overT > 0 && time >= S.overT) {
      S.overT = -1;
      endlessOver();
    }
    if (S.finishT > 0 && time > S.finishT + 1.5 && S.mode === "level" && $("ov-complete").hidden) {
      S.finishT = Infinity;
      finishLevel();
    }
    if (S.mode === "demo" && b.finished) startDemo();

    // endless: change world every 12 km
    if (S.mode !== "level") {
      const ti = Math.floor(Math.max(0, b.x) / 12000) % THEMES.length;
      if (ti !== S.themeIdx) {
        S.themeIdx = ti;
        S.theme = THEMES[ti];
        if (S.mode === "endless") {
          fx.popup(S.theme.name.toUpperCase(), S.theme.accent, 30, "NEW ZONE");
          sound.setMusic(true, S.theme.musicRoot);
        }
      }
    }
  }
  camera.update(dt, b, S.track, W, H);

  const playing = S.mode !== "demo" && !paused && (b.mode === "ground" || b.mode === "air");
  sound.engine(playing ? "on" : "off", b.mode === "air" ? Math.hypot(b.vx, b.vy) : b.v, b.mode === "air");
  if (S.mode !== "demo" && !$("hud").hidden) updateHud();
}

let hudCache = {};
function setText(id, v) {
  if (hudCache[id] !== v) {
    hudCache[id] = v;
    $(id).textContent = v;
  }
}

function updateHud(force) {
  if (force) hudCache = {};
  const b = S.bike;
  if (S.mode === "level") {
    const span = S.track.finish.x - S.world.startX;
    const p = Math.max(0, Math.min(1, (b.x - S.world.startX) / span));
    const pct = `${(p * 100).toFixed(1)}%`;
    if (hudCache.prog !== pct) {
      hudCache.prog = pct;
      $("hud-progress").style.width = pct;
    }
    setText("hud-flips", `↻ ${S.flips}/${S.world.flipTarget}`);
  } else {
    setText("hud-score", (Math.floor(b.distance / 10) + S.trick).toLocaleString());
  }
  setText("hud-gems", String(S.mode === "level" ? S.runGems.length : save.gems + S.gemCount));
  setText("hud-combo", S.combo > 1 ? `COMBO x${S.combo}` : "");
  const showTap = b.mode === "ready" && S.launchT < 0;
  if ($("tap").hidden === showTap) $("tap").hidden = !showTap;
}

function render() {
  if (!W) return;
  const dpr = canvas.width / W;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const theme = S ? S.theme : THEMES[0];
  drawBackground(ctx, theme, camera, W, H, time);
  if (!S) return;
  const b = S.bike;
  ctx.save();
  worldTransform(ctx, camera, W, H, fx.shake);
  drawTrack(ctx, S.track, camera, W, H, theme, time);
  drawMarkers(ctx, S.track, camera, W, H, theme, time, b.cpIndex);
  drawGems(ctx, S.track, camera, W, time);
  trail.draw(ctx, S.def, time);
  if (b.mode !== "crashed") {
    const blink = S.launchT > 0 ? (Math.floor(time * 12) % 2 ? 0.35 : 1) : 1;
    drawRider(ctx, b, S.def, time, blink);
  }
  fx.drawWorld(ctx);
  ctx.restore();
  if (b.boostT > 0 && b.mode !== "crashed") drawSpeedLines(ctx, W, H, Math.min(1, b.boostT), theme.line);
  if (S.mode !== "demo") fx.drawScreen(ctx, W, H);
  if (S.mode === "demo" || !$("scr-levels").hidden) {
    // dim the attract-mode demo behind menus
    ctx.fillStyle = "rgba(5,3,15,0.35)";
    ctx.fillRect(0, 0, W, H);
  }
}

createLoop({ update, render }).start();

// ---------------------------------------------------------------- input

onPointer(canvas, {
  onDown(x, y, e) {
    sound.unlock();
    holdPointers.add(e.pointerId);
    pressed();
  },
  onUp(x, y, e) {
    holdPointers.delete(e.pointerId);
  },
});

function pressed() {
  if (!S || S.mode === "demo" || paused) return;
  if (S.bike.mode === "ready" && S.launchT < 0) {
    launchBike(S.bike);
    $("tap").hidden = true;
  }
}

const HOLD_KEYS = new Set(["Space", "ArrowUp", "KeyW", "Enter"]);
const keysDown = new Set();
window.addEventListener("keydown", (e) => {
  if (HOLD_KEYS.has(e.code)) {
    if (S && S.mode !== "demo" && !paused && $("ov-complete").hidden && $("ov-over").hidden) e.preventDefault();
    else return;
    if (!keysDown.has(e.code)) {
      keysDown.add(e.code);
      holdKeys++;
      sound.unlock();
      pressed();
    }
  } else if (e.code === "Escape" || e.code === "KeyP") {
    if (S && S.mode !== "demo") togglePause();
  } else if (e.code === "KeyR" && S && S.mode === "level" && !paused) {
    startRun("level", S.level);
  }
});
window.addEventListener("keyup", (e) => {
  if (keysDown.delete(e.code)) holdKeys = Math.max(0, holdKeys - 1);
});
window.addEventListener("blur", () => {
  keysDown.clear();
  holdKeys = 0;
  holdPointers.clear();
});
document.addEventListener("visibilitychange", () => {
  if (document.hidden && S && S.mode !== "demo" && !paused && $("ov-complete").hidden && $("ov-over").hidden) togglePause(true);
});

function togglePause(force) {
  if (!S || S.mode === "demo") return;
  if (!$("ov-complete").hidden || !$("ov-over").hidden) return;
  paused = force === true ? true : !paused;
  $("ov-pause").hidden = !paused;
  $("hud").hidden = paused;
  if (paused) {
    $("pause-info").textContent = S.mode === "level" ? `Level ${S.level} · ${S.flips} flips · ${S.crashes} crashes` : `Score ${(Math.floor(S.bike.distance / 10) + S.trick).toLocaleString()}`;
  }
  sound.play("click");
}

// ---------------------------------------------------------------- menus

function totalStars() {
  return Object.values(save.levels).reduce((a, l) => a + (l.stars || 0), 0);
}

function giftReady() {
  return Date.now() - save.lastGift >= GIFT_COOLDOWN;
}

function refreshMenu() {
  $("menu-gems").textContent = save.gems;
  $("menu-best").textContent = save.bestEndless.toLocaleString();
  $("menu-stars").textContent = totalStars();
  $("menu-stars-max").textContent = LEVEL_COUNT * 3;
  $("btn-levels").textContent = `▶  Level ${Math.min(save.unlocked, LEVEL_COUNT)}`;
  const ready = giftReady();
  $("btn-gift").classList.toggle("ready", ready);
  if (ready) $("gift-label").textContent = "Free gift!";
  else {
    const ms = GIFT_COOLDOWN - (Date.now() - save.lastGift);
    const h = Math.floor(ms / 3600000);
    const m = Math.ceil((ms % 3600000) / 60000);
    $("gift-label").textContent = `Gift in ${h}h ${m}m`;
  }
}
setInterval(() => {
  if (!$("scr-menu").hidden) refreshMenu();
}, 30000);

function goMenu() {
  if (S && S.mode === "endless") commitEndless();
  persist();
  startDemo();
  showScreen("scr-menu");
}

let worldPage = 0;
function renderLevels() {
  const wi = worldPage;
  const theme = THEMES[wi];
  $("world-name").textContent = `World ${wi + 1} · ${theme.name}`;
  let ws = 0;
  for (let i = 1; i <= LEVELS_PER_WORLD; i++) ws += save.levels[wi * LEVELS_PER_WORLD + i]?.stars || 0;
  $("world-stars").textContent = `★ ${ws}/${LEVELS_PER_WORLD * 3}`;
  $("scr-levels").style.setProperty("--world", theme.line);
  $("scr-levels").style.setProperty("--world-accent", theme.accent);
  $("world-prev").disabled = wi === 0;
  $("world-next").disabled = wi === THEMES.length - 1;
  const grid = $("level-grid");
  grid.innerHTML = "";
  for (let i = 1; i <= LEVELS_PER_WORLD; i++) {
    const n = wi * LEVELS_PER_WORLD + i;
    const st = save.levels[n]?.stars || 0;
    const locked = n > save.unlocked;
    const btn = document.createElement("button");
    btn.className = "r-level" + (locked ? " locked" : "") + (n === save.unlocked ? " current" : "");
    btn.innerHTML = `<b>${locked ? "🔒" : n}</b><span>${"★".repeat(st)}<em>${"★".repeat(3 - st)}</em></span>`;
    btn.disabled = locked;
    btn.addEventListener("click", () => {
      sound.play("click");
      startRun("level", n);
    });
    grid.appendChild(btn);
  }
}

// garage
let garageSel = null;
function bikeStatus(bk) {
  if (save.owned.includes(bk.id)) return save.bike === bk.id ? "selected" : "owned";
  if (bk.challenge) return "challenge";
  return "buy";
}

function renderGarage() {
  $("garage-gems").textContent = save.gems;
  if (!garageSel) garageSel = save.bike;
  const grid = $("garage-grid");
  grid.innerHTML = "";
  for (const bk of BIKES) {
    const st = bikeStatus(bk);
    const card = document.createElement("button");
    card.className = `r-bike ${st}` + (bk.id === garageSel ? " sel" : "");
    const c = document.createElement("canvas");
    c.width = 120;
    c.height = 80;
    const g = c.getContext("2d");
    g.translate(60, 66);
    g.scale(1.15, 1.15);
    drawBike(g, bk, 0.3, 0, st === "buy" || st === "challenge" ? 0.35 : 1);
    card.appendChild(c);
    const label = document.createElement("span");
    label.textContent = st === "buy" ? `💎 ${bk.cost}` : st === "challenge" ? "🏆" : bk.name;
    card.appendChild(label);
    card.addEventListener("click", () => {
      garageSel = bk.id;
      sound.play("click");
      renderGarage();
    });
    grid.appendChild(card);
  }
  const bk = bikeById(garageSel);
  const st = bikeStatus(bk);
  $("garage-name").textContent = bk.name;
  const act = $("garage-action");
  act.disabled = false;
  act.className = "btn btn--primary";
  if (st === "selected") {
    $("garage-info").textContent = "Riding this one.";
    act.textContent = "Selected ✓";
    act.disabled = true;
  } else if (st === "owned") {
    $("garage-info").textContent = "Unlocked.";
    act.textContent = "Ride it";
  } else if (st === "challenge") {
    $("garage-info").textContent = `Challenge: ${CHALLENGES[bk.challenge].text}`;
    act.textContent = "Locked 🏆";
    act.disabled = true;
  } else {
    $("garage-info").textContent = save.gems >= bk.cost ? "Unlock with gems." : `Need ${bk.cost - save.gems} more gems.`;
    act.textContent = `Unlock 💎 ${bk.cost}`;
    act.disabled = save.gems < bk.cost;
  }
}

$("garage-action").addEventListener("click", () => {
  const bk = bikeById(garageSel);
  const st = bikeStatus(bk);
  if (st === "owned") {
    save.bike = bk.id;
    sound.play("click");
  } else if (st === "buy") {
    if (save.gems < bk.cost) {
      sound.play("denied");
      return;
    }
    save.gems -= bk.cost;
    save.owned.push(bk.id);
    save.bike = bk.id;
    sound.play("unlock");
    toast(`${bk.name} unlocked!`);
  }
  persist();
  renderGarage();
});

// animated garage preview
const prev = $("garage-preview");
const pctx = prev.getContext("2d");
let prevRot = 0;
function drawPreview() {
  requestAnimationFrame(drawPreview);
  if ($("scr-garage").hidden) return;
  const r = prev.getBoundingClientRect();
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  if (prev.width !== Math.round(r.width * dpr)) {
    prev.width = Math.round(r.width * dpr);
    prev.height = Math.round(r.height * dpr);
  }
  const w = r.width;
  const h = r.height;
  pctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pctx.clearRect(0, 0, w, h);
  const bk = bikeById(garageSel || save.bike);
  prevRot += 0.12;
  const gy = h * 0.8;
  pctx.strokeStyle = "rgba(32,242,255,0.25)";
  pctx.lineWidth = 8;
  pctx.beginPath();
  pctx.moveTo(0, gy);
  pctx.lineTo(w, gy);
  pctx.stroke();
  pctx.strokeStyle = "#20f2ff";
  pctx.lineWidth = 2.5;
  pctx.stroke();
  // trail
  const tr = bk.trail;
  for (let i = 0; i < 26; i++) {
    const f = i / 26;
    pctx.globalAlpha = f * 0.8;
    pctx.strokeStyle = tr === "rainbow" ? `hsl(${(i * 14 + time * 240) % 360},100%,62%)` : tr;
    pctx.lineWidth = 2 + f * 6;
    pctx.beginPath();
    const x0 = w / 2 - 45 - (26 - i) * 6;
    pctx.moveTo(x0, gy - 2 + Math.sin(time * 6 + i * 0.5) * 2 * (1 - f));
    pctx.lineTo(x0 + 6, gy - 2 + Math.sin(time * 6 + (i + 1) * 0.5) * 2 * (1 - f));
    pctx.stroke();
  }
  pctx.globalAlpha = 1;
  pctx.save();
  const s = Math.min(2.2, h / 95);
  pctx.translate(w / 2, gy);
  pctx.scale(s, s);
  const lift = Math.max(0, Math.sin(time * 1.5)) * 0.25;
  pctx.rotate(-lift);
  drawBike(pctx, bk, prevRot, time, 1);
  pctx.restore();
}
requestAnimationFrame(drawPreview);

// settings
function renderSettings() {
  const set = save.settings;
  const tog = (id, on) => {
    $(id).textContent = on ? "ON" : "OFF";
    $(id).classList.toggle("on", on);
  };
  tog("set-sfx", set.sfx);
  tog("set-music", set.music);
  tog("set-vibe", set.vibe);
  const st = save.stats;
  $("stats").innerHTML = [
    ["Levels finished", `${st.levelsDone}/${LEVEL_COUNT}`],
    ["Stars", `${totalStars()}/${LEVEL_COUNT * 3}`],
    ["Total flips", st.flips],
    ["Best single jump", `${st.maxFlip} flips`],
    ["Perfect landings", st.perfects],
    ["Loops", st.loops],
    ["Crashes", st.crashes],
    ["Distance", `${st.distance.toLocaleString()} m`],
    ["Gems found", st.gemsTotal],
    ["Best endless", save.bestEndless.toLocaleString()],
    ["Bikes", `${save.owned.length}/${BIKES.length}`],
  ]
    .map(([k, v]) => `<li><span>${k}</span><b>${v}</b></li>`)
    .join("");
}

function applySettings() {
  sound.sfxOn = save.settings.sfx;
  sound.musicOn = save.settings.music;
  sound.applyToggles();
}
for (const [id, key] of [["set-sfx", "sfx"], ["set-music", "music"], ["set-vibe", "vibe"]]) {
  $(id).addEventListener("click", () => {
    sound.unlock();
    save.settings[key] = !save.settings[key];
    applySettings();
    persist();
    sound.play("click");
    if (key === "vibe") vibrate(save.settings.vibe, 30);
    renderSettings();
  });
}

$("set-reset").addEventListener("click", () => {
  $("ov-confirm").hidden = false;
});
$("confirm-no").addEventListener("click", () => {
  $("ov-confirm").hidden = true;
});
$("confirm-yes").addEventListener("click", () => {
  const settings = save.settings;
  save = defaultSave();
  save.settings = settings;
  persist();
  $("ov-confirm").hidden = true;
  toast("Progress reset");
  renderSettings();
});

// buttons
const click = (id, fn) =>
  $(id).addEventListener("click", (e) => {
    sound.unlock();
    sound.play("click");
    fn(e);
  });

click("btn-levels", () => {
  worldPage = Math.floor((Math.min(save.unlocked, LEVEL_COUNT) - 1) / LEVELS_PER_WORLD);
  showScreen("scr-levels");
});
click("btn-endless", () => startRun("endless"));
click("btn-garage", () => {
  garageSel = save.bike;
  showScreen("scr-garage");
});
click("btn-settings", () => showScreen("scr-settings"));
click("btn-gift", () => {
  if (!giftReady()) {
    toast("Come back later for another gift");
    return;
  }
  const amount = 15 + Math.floor(Math.random() * 26);
  save.gems += amount;
  save.lastGift = Date.now();
  persist();
  sound.play("unlock");
  toast(`🎁 +${amount} gems!`);
  refreshMenu();
});
for (const id of ["levels-back", "garage-back", "settings-back"]) click(id, () => showScreen("scr-menu"));
click("world-prev", () => {
  worldPage = Math.max(0, worldPage - 1);
  renderLevels();
});
click("world-next", () => {
  worldPage = Math.min(THEMES.length - 1, worldPage + 1);
  renderLevels();
});
click("btn-pause", () => togglePause());
click("pause-resume", () => togglePause());
click("pause-restart", () => {
  if (S.mode === "endless") commitEndless();
  startRun(S.mode, S.level);
});
click("pause-menu", goMenu);
click("btn-next", () => startRun("level", Math.min(LEVEL_COUNT, S.level + 1)));
click("btn-retry", () => startRun("level", S.level));
click("cmp-menu", () => {
  goMenu();
  worldPage = Math.floor((Math.min(save.unlocked, LEVEL_COUNT) - 1) / LEVELS_PER_WORLD);
  showScreen("scr-levels");
});
click("btn-revive", () => {
  if (S.revived || save.gems < REVIVE_COST) return;
  save.gems -= REVIVE_COST;
  persist();
  S.revived = true;
  $("ov-over").hidden = true;
  $("hud").hidden = false;
  respawn();
  sound.play("unlock");
});
click("over-retry", () => {
  commitEndless();
  startRun("endless");
});
click("over-menu", goMenu);

// boot
applySettings();
startDemo();
showScreen("scr-menu");
// Music needs a user gesture; the first tap anywhere starts audio.
window.addEventListener("pointerdown", () => sound.unlock(), { once: true });
