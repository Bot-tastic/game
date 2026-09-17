// main.js — boot, input, the run loop and everything that glues the city,
// the car, the physics and the UI together.

import * as THREE from "three";
import { onPointer, createLoop, showToast } from "../../shared/game-utils.js";
import { createCar, updateCar, updateCamera, resetCar, setDamageVisual, speedNorm, MAX_SPEED } from "./car.js";
import { createWorld, updateWorld, resetWorld, DRAW_DISTANCE } from "./world.js";
import { createFX } from "./fx.js";
import { checkCollisions } from "./physics.js";
import {
  createScoreState,
  registerSmash,
  registerNearMiss,
  registerAir,
  tickScore,
  applyDamage,
  loadBest,
  saveBestIfNeeded,
  COMBO_WINDOW,
} from "./scoring.js";
import * as audio from "./audio.js";

const $ = (id) => document.getElementById(id);

const canvas = $("game");
const menuOverlay = $("menu-overlay");
const gameoverOverlay = $("gameover-overlay");
const controlsEl = $("controls");
const startBtn = $("start-btn");
const retryBtn = $("retry-btn");
const brakeBtn = $("brake-btn");
const boostBtn = $("boost-btn");
const muteBtn = $("mute-btn");
const bloomToggle = $("bloom-toggle");
const popupsEl = $("popups");
const flashEl = $("flash");
const toastEl = $("toast");

const scoreValueEl = $("score-value");
const bestValueEl = $("best-value");
const distValueEl = $("dist-value");
const speedValueEl = $("speed-value");
const damageFillEl = $("damage-fill");
const boostFillEl = $("boost-fill");
const comboEl = $("combo");
const comboXEl = $("combo-x");
const comboBarEl = $("combo-bar-fill");
const rampageEl = $("rampage");

const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

canvas.style.touchAction = "none";
canvas.addEventListener("contextmenu", (e) => e.preventDefault());

// ---------------------------------------------------------------- renderer
const scene = new THREE.Scene();
const FOG_COLOR = new THREE.Color(0x1d1130);
scene.fog = new THREE.Fog(FOG_COLOR, 55, 250);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 900);
camera.position.set(0, 4, -9.5);
scene.add(camera);

// Dusk key light from the low sun down the road, cool bounce from the sky.
scene.add(new THREE.AmbientLight(0x4a3f7a, 0.55));
scene.add(new THREE.HemisphereLight(0x8e9bff, 0x3a2438, 1.7));
const keyLight = new THREE.DirectionalLight(0xffc08a, 2.1);
keyLight.position.set(-24, 26, 52);
scene.add(keyLight);
const rimLight = new THREE.DirectionalLight(0xff4d8d, 1.1);
rimLight.position.set(30, 14, -30);
scene.add(rimLight);

// ------------------------------------------------------------ postprocessing
let composer = null;
let bloomPass = null;
let bloomWanted = true;
const forceBloom = new URLSearchParams(location.search).has("bloom");

async function setupBloom() {
  try {
    // Warm the addon graph one module at a time. Fetching the whole tree at
    // once means a burst of parallel requests, which flaky mobile networks
    // (and sandboxed proxies) drop; once cached, the real imports are free.
    for (const path of [
      "three/addons/shaders/CopyShader.js",
      "three/addons/shaders/LuminosityHighPassShader.js",
      "three/addons/shaders/OutputShader.js",
      "three/addons/postprocessing/Pass.js",
      "three/addons/postprocessing/ShaderPass.js",
      "three/addons/postprocessing/MaskPass.js",
    ]) {
      try {
        await import(/* @vite-ignore */ path);
      } catch {
        /* optional warm-up: the real import below reports any hard failure */
      }
    }

    const { EffectComposer } = await import("three/addons/postprocessing/EffectComposer.js");
    const { RenderPass } = await import("three/addons/postprocessing/RenderPass.js");
    const { UnrealBloomPass } = await import("three/addons/postprocessing/UnrealBloomPass.js");
    const { OutputPass } = await import("three/addons/postprocessing/OutputPass.js");
    const size = new THREE.Vector2(window.innerWidth, window.innerHeight);
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    bloomPass = new UnrealBloomPass(size, 0.62, 0.7, 0.72);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
    handleResize();
  } catch {
    composer = null; // offline / blocked CDN: plain forward rendering still works
  }
}

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
  if (composer) {
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.4));
    composer.setSize(w, h);
  }
}
window.addEventListener("resize", handleResize);
window.addEventListener("orientationchange", handleResize);
handleResize();

// ------------------------------------------------------------------ actors
const world = createWorld(scene);
const fx = createFX(scene);
const car = createCar(scene);
camera.add(fx.windLines);

let scoreState = createScoreState();
let best = loadBest();
bestValueEl.textContent = best.toLocaleString();

/** @type {"menu"|"playing"|"crashing"|"gameover"} */
let state = "menu";
let timeScale = 1;
let slowmo = 0;
let zoomPunch = 0;
let extraShake = 0;
let crashTimer = 0;
let smokeAccum = 0;
let hudAccum = 0;
let comboShown = false;

// ------------------------------------------------------------------ input
const input = { steer: 0, braking: false, boosting: false };
const keys = new Set();
let dragOrigin = null;
let dragSteer = 0;
const STEER_RANGE = 78; // CSS px of drag for full lock

onPointer(canvas, {
  onDown: (x) => {
    if (state !== "playing") return;
    dragOrigin = x;
    dragSteer = 0;
  },
  onMove: (x) => {
    if (state !== "playing" || dragOrigin == null) return;
    dragSteer = Math.max(-1, Math.min(1, (x - dragOrigin) / STEER_RANGE));
    // Let the anchor trail the finger so you can always steer further.
    if (dragSteer >= 1) dragOrigin = x - STEER_RANGE;
    if (dragSteer <= -1) dragOrigin = x + STEER_RANGE;
  },
  onUp: () => {
    dragOrigin = null;
    dragSteer = 0;
  },
});

function bindPad(el, prop) {
  const on = (e) => {
    e.preventDefault();
    input[prop] = true;
    el.classList.add("active");
    el.setPointerCapture?.(e.pointerId);
  };
  const off = (e) => {
    e.preventDefault();
    input[prop] = false;
    el.classList.remove("active");
  };
  el.addEventListener("pointerdown", on, { passive: false });
  el.addEventListener("pointerup", off, { passive: false });
  el.addEventListener("pointercancel", off, { passive: false });
  el.addEventListener("pointerleave", off, { passive: false });
}
bindPad(brakeBtn, "braking");
bindPad(boostBtn, "boosting");

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key.toLowerCase();
  keys.add(k);
  if (k === " " || k === "arrowup" || k === "arrowdown") e.preventDefault();
  if (k === "m") toggleMute();
  if ((k === " " || k === "enter") && state !== "playing") {
    if (state === "menu") startRun();
    else if (state === "gameover") startRun();
  }
});
window.addEventListener("keyup", (e) => keys.delete(e.key.toLowerCase()));
window.addEventListener("blur", () => keys.clear());

function readInput() {
  let steer = dragSteer;
  if (keys.has("arrowleft") || keys.has("a")) steer -= 1;
  if (keys.has("arrowright") || keys.has("d")) steer += 1;
  input.steer = Math.max(-1, Math.min(1, steer));
  input.boosting = input.boosting || keys.has(" ") || keys.has("arrowup") || keys.has("w");
  input.braking = input.braking || keys.has("arrowdown") || keys.has("s");
}

function toggleMute() {
  const m = audio.toggleMute();
  muteBtn.classList.toggle("muted", m);
}
muteBtn.addEventListener("click", (e) => {
  e.preventDefault();
  toggleMute();
});

bloomToggle.addEventListener("change", () => {
  bloomWanted = bloomToggle.checked;
  if (bloomPass) bloomPass.enabled = bloomWanted;
});

// -------------------------------------------------------------------- HUD
const _proj = new THREE.Vector3();

function popup(text, worldX, worldY, worldZ, cls = "") {
  if (worldZ < -4) return;
  _proj.set(worldX, worldY, worldZ).project(camera);
  if (_proj.z > 1) return;
  const el = document.createElement("div");
  el.className = "pop " + cls;
  el.textContent = text;
  const px = Math.min(88, Math.max(12, (_proj.x * 0.5 + 0.5) * 100));
  const py = Math.min(86, Math.max(16, (-_proj.y * 0.5 + 0.5) * 100));
  el.style.left = px.toFixed(2) + "%";
  el.style.top = py.toFixed(2) + "%";
  popupsEl.appendChild(el);
  setTimeout(() => el.remove(), 900);
}

function flash(strength = 1) {
  if (reducedMotion) return;
  flashEl.style.setProperty("--s", strength);
  flashEl.classList.add("on");
  setTimeout(() => flashEl.classList.remove("on"), 60);
}

function updateHud() {
  scoreValueEl.textContent = scoreState.score.toLocaleString();
  distValueEl.innerHTML = Math.round(car.distance) + "<small>m</small>";
  speedValueEl.textContent = Math.round(car.speed * 3.1);

  const hull = 100 - scoreState.damage;
  damageFillEl.style.width = hull + "%";
  damageFillEl.classList.toggle("warn", hull <= 55 && hull > 25);
  damageFillEl.classList.toggle("crit", hull <= 25);
  boostFillEl.style.width = (car.boostFuel * 100).toFixed(0) + "%";

  const active = scoreState.combo >= 2;
  if (active !== comboShown) {
    comboEl.classList.toggle("on", active);
    comboShown = active;
  }
  if (active) {
    comboXEl.textContent = "x" + (scoreState.multiplier % 1 === 0 ? scoreState.multiplier : scoreState.multiplier.toFixed(1));
    comboBarEl.style.width = ((scoreState.comboTimer / COMBO_WINDOW) * 100).toFixed(0) + "%";
  }
}

// ------------------------------------------------------------------ events
function onSmash(rec, force) {
  const def = rec.def;

  if (def.pickup) {
    applyDamage(scoreState, def.damage);
    setDamageVisual(car, scoreState.damage);
    audio.playPickup();
    popup("+REPAIR", rec.x, rec.y + 1.4, rec.z, "heal");
    return;
  }

  const res = registerSmash(scoreState, rec, speedNorm(car));
  audio.playImpact(def.sound, force);
  if (scoreState.combo % 3 === 0) audio.playCombo(scoreState.combo);

  const big = def.heavy || def.points >= 150;
  popup("+" + res.points, rec.x, rec.y + def.h * 0.8, rec.z, big ? "big" : "");
  comboEl.classList.remove("pulse");
  void comboEl.offsetWidth;
  comboEl.classList.add("pulse");

  // Heavy props hurt, scrub speed, punch the camera and bend time a little.
  car.speed = Math.max(12, car.speed * (1 - def.drag * (def.heavy ? 1 : 0.5)));
  car.shake = Math.min(1.6, car.shake + (big ? 0.8 : 0.22) * force);
  if (big) {
    zoomPunch = Math.max(zoomPunch, 0.9);
    slowmo = Math.max(slowmo, 0.28);
    flash(1);
  }

  if (def.damage > 0) {
    const dmg = def.damage * (0.55 + force * 0.6);
    applyDamage(scoreState, dmg);
    setDamageVisual(car, scoreState.damage);
    fx.spawnSparks(car.x, 0.7, 1.6, 16, 0xffd08a, 12);
  }

  if (res.rampageStarted) {
    document.body.classList.add("rampaging");
    rampageEl.classList.remove("on");
    void rampageEl.offsetWidth;
    rampageEl.classList.add("on");
    audio.playRampage();
    flash(1);
  }
}

let lastNearMiss = 0;
function onNearMiss(rec) {
  const pts = registerNearMiss(scoreState);
  const t = performance.now();
  if (t - lastNearMiss < 700) return;
  lastNearMiss = t;
  popup("NEAR MISS +" + pts, rec.x, rec.y + 1.2, rec.z, "miss");
}

// -------------------------------------------------------------------- flow
function startRun() {
  audio.initAudio();
  audio.startMusic();
  menuOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  controlsEl.hidden = false;
  document.body.classList.remove("rampaging");
  resetCar(car);
  resetWorld(world);
  fx.reset();
  scoreState = createScoreState();
  timeScale = 1;
  slowmo = 0;
  zoomPunch = 0;
  extraShake = 0;
  crashTimer = 0;
  input.braking = false;
  input.boosting = false;
  dragOrigin = null;
  dragSteer = 0;
  brakeBtn.classList.remove("active");
  boostBtn.classList.remove("active");
  camera.position.set(0, 4, -9.5);
  car.roadPool.visible = true;
  updateHud();
  state = "playing";
  loop.start();
}

startBtn.addEventListener("click", startRun);
retryBtn.addEventListener("click", startRun);

const VERDICTS = [
  [0, "The insurance company has questions."],
  [8000, "Respectable carnage."],
  [20000, "The district will remember you."],
  [45000, "Certified wrecking ball."],
  [90000, "Someone stop this person."],
];

function beginCrash() {
  state = "crashing";
  crashTimer = 0;
  slowmo = 1;
  car.shake = 1.6;
  audio.playCrash();
  audio.stopMusic();
  flash(1);
  fx.spawnDebris(car.x, 1.2, 0, { count: 26, color: 0x8b2f3f, speed: 18, size: 0.4, spread: 2.2, life: 2 });
  fx.spawnSparks(car.x, 1.2, 0, 50, 0xffb257, 22);
  fx.spawnSmoke(car.x, 1.2, 0, 22, 0x59504e, { size: 1.4, grow: 3.2, life: 2.2, rise: 5 });
  document.body.classList.remove("rampaging");
}

function showGameOver() {
  state = "gameover";
  best = saveBestIfNeeded(scoreState.score, best);
  bestValueEl.textContent = best.toLocaleString();
  $("final-score").textContent = scoreState.score.toLocaleString();
  $("final-distance").textContent = Math.round(car.distance) + "m";
  $("final-smashes").textContent = String(scoreState.smashes);
  $("final-combo").textContent = "x" + scoreState.bestCombo;
  $("final-best").textContent = best.toLocaleString();
  let verdict = VERDICTS[0][1];
  for (const [min, text] of VERDICTS) if (scoreState.score >= min) verdict = text;
  $("verdict").textContent = verdict;
  controlsEl.hidden = true;
  gameoverOverlay.hidden = false;
  loop.stop();
}

// -------------------------------------------------------------------- loop
let frameCount = 0;
let perfAccum = 0;
let perfChecked = false;

function update(rawDt) {
  frameCount++;

  // Cheap perf guard: if the first two seconds are slow, drop the bloom.
  if (!perfChecked && composer) {
    perfAccum += rawDt;
    if (perfAccum > 2.5) {
      perfChecked = true;
      const fps = frameCount / perfAccum;
      if (fps < 42 && bloomPass && !forceBloom) {
        bloomPass.enabled = false;
        bloomWanted = false;
        bloomToggle.checked = false;
        showToast(toastEl, "PERFORMANCE MODE", 900);
      }
    }
  }

  if (state === "gameover") return;

  slowmo = Math.max(0, slowmo - rawDt * 1.6);
  const targetScale = state === "crashing" ? 0.35 : 1 - slowmo * 0.55;
  timeScale += (targetScale - timeScale) * Math.min(1, rawDt * 8);
  const dt = rawDt * timeScale;

  zoomPunch = Math.max(0, zoomPunch - rawDt * 3.2);
  extraShake = Math.max(0, extraShake - rawDt * 2.5);

  if (state === "crashing") {
    crashTimer += rawDt;
    car.speed = Math.max(0, car.speed - 40 * rawDt);
    car.group.position.x = car.x;
    fx.spawnSmoke(car.x, 1.0, 0, 1, 0x4a4442, { size: 1.2, grow: 3, life: 1.6, rise: 4 });
    fx.update(dt, car.speed * dt);
    updateWorld(world, dt, car.speed, car.distance);
    updateCamera(camera, car, rawDt, { reducedMotion, extraShake: 0.4, zoomPunch: 0.6 });
    audio.updateEngine(0, false, 0, false);
    if (crashTimer > 1.5) showGameOver();
    return;
  }

  readInput();
  updateCar(car, dt, input, world.ramps);
  updateWorld(world, dt, car.speed, car.distance);
  checkCollisions(world, car, fx, onSmash, onNearMiss);
  fx.update(dt, car.speed * dt);

  const sn = speedNorm(car);
  fx.updateWindLines(rawDt, Math.max(0, sn - 0.35) * (car.boosting ? 1.6 : 1.1));
  updateCamera(camera, car, rawDt, { reducedMotion, extraShake, zoomPunch });

  // landing payoff
  if (car.landed && car.lastAirTime > 0.28) {
    const pts = registerAir(scoreState, car.lastAirTime);
    popup("AIR +" + pts, car.x, 1.6, 0, "big");
    audio.playLanding(Math.min(1.4, car.lastAirTime * 1.6));
    fx.spawnSmoke(car.x, 0.2, 0, 8, 0x8d93a6, { size: 0.7, grow: 2.6, life: 0.7 });
    fx.spawnSparks(car.x, 0.2, 0, 12, 0xffd08a, 9);
    extraShake = Math.max(extraShake, 0.5);
  } else if (car.landed) {
    fx.spawnSmoke(car.x, 0.2, 0, 3, 0x8d93a6, { size: 0.5, grow: 2, life: 0.5 });
  }

  // drift smoke off the rear tyres
  smokeAccum += dt * (car.drift * 26 + (car.offRoad ? 8 : 0));
  while (smokeAccum > 1) {
    smokeAccum -= 1;
    const side = car.vx > 0 ? -1 : 1;
    fx.spawnSmoke(car.x + side * 0.9, 0.15, -1.3, 1, car.offRoad ? 0x6b6252 : 0x77809a, {
      size: 0.45,
      grow: 2.4,
      life: 0.6,
      speed: 1.5,
      rise: 1.4,
    });
  }

  // damage tells: smoke, then fire
  if (scoreState.damage > 45 && Math.random() < dt * (scoreState.damage - 40) * 0.5) {
    fx.spawnSmoke(car.x, 1.1, 1.0, 1, 0x3a3a42, { size: 0.5, grow: 2.8, life: 1.2, rise: 3 });
  }
  if (scoreState.damage > 75 && Math.random() < dt * 22) {
    fx.spawnSparks(car.x + (Math.random() - 0.5) * 1.2, 1.1, 1.1, 2, 0xff7a2a, 5);
  }

  if (tickScore(scoreState, dt) && document.body.classList.contains("rampaging")) {
    document.body.classList.remove("rampaging");
  }
  if (scoreState.rampage <= 0) document.body.classList.remove("rampaging");

  audio.updateEngine(sn, car.boosting, car.drift, true);
  audio.setMusicIntensity(sn);

  hudAccum += rawDt;
  if (hudAccum > 0.06) {
    hudAccum = 0;
    updateHud();
  }

  if (scoreState.damage >= 100) beginCrash();
}

function render() {
  if (composer && bloomWanted && bloomPass?.enabled !== false) composer.render();
  else renderer.render(scene, camera);
}

const loop = createLoop({ update, render });

// Idle "attract" state: the menu sits over a slowly drifting city.
let attractRaf = null;
function attract(time) {
  if (state !== "menu") return;
  const t = time * 0.001;
  // Slow 3/4 orbit down the lit street so the menu sits over the city, not a void.
  camera.position.set(5.2 + Math.sin(t * 0.16) * 2.4, 2.6 + Math.sin(t * 0.26) * 0.3, -8.5);
  camera.lookAt(0.4, 1.5, 20);
  // The headlight pool is authored for the chase view; from this angle it
  // reads as a flat smear, so the attract shot goes without it.
  car.roadPool.visible = false;
  updateWorld(world, 1 / 60, 22, 0);
  fx.update(1 / 60, 22 / 60);
  car.wheelSpin += 0.4;
  for (const w of car.wheels) w.hub.rotation.x = car.wheelSpin;
  render();
  attractRaf = requestAnimationFrame(attract);
}

if (new URLSearchParams(location.search).has("debug")) {
  window.__dr = { crash: () => beginCrash(), state: () => state };
}

setupBloom().then(() => {
  render();
  attractRaf = requestAnimationFrame(attract);
});

startBtn.addEventListener("click", () => {
  if (attractRaf) cancelAnimationFrame(attractRaf);
  attractRaf = null;
});
