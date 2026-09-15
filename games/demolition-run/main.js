// main.js — boot/orchestration for Demolition Run.
//
// Pass 1 scope: scene/renderer/camera setup, resize handling, the
// state-machine variable, the render loop, and steering/brake input
// wiring. Collision, scoring, damage and the game-over transition are
// Pass 2's job (physics.js/scoring.js), built on top of the car/world
// contracts documented in car.js/world.js/props.js.

import { onPointer, createLoop } from "../../shared/game-utils.js";
import * as THREE from "three";
import { createCar, updateCar, updateCamera, beginSteer, updateSteer, endSteer, resetCar } from "./car.js";
import { createWorld, updateWorld, resetWorld } from "./world.js";
import { checkCollisions, updateFlyingProps, isHitCooldownActive, DAMAGE_COOLDOWN, DAMAGE_AMOUNTS, PARKEDCAR_DAMAGE_SPEED_THRESHOLD } from "./physics.js";
import { createScoreState, awardPoints, applyDamage, loadBest, saveBestIfNeeded } from "./scoring.js";

const canvas = document.getElementById("game");
const startBtn = document.getElementById("start-btn");
const menuOverlay = document.getElementById("menu-overlay");
const brakeBtn = document.getElementById("brake-btn");
const retryBtn = document.getElementById("retry-btn");
const gameoverOverlay = document.getElementById("gameover-overlay");
const scoreValueEl = document.getElementById("score-value");
const bestValueEl = document.getElementById("best-value");
const distValueEl = document.getElementById("dist-value");
const finalScoreEl = document.getElementById("final-score");
const finalDistanceEl = document.getElementById("final-distance");
const finalBestEl = document.getElementById("final-best");
const damageFillEl = document.getElementById("damage-fill");

// ---- score/damage/high-score state ----
let scoreState = createScoreState();
let best = loadBest();
bestValueEl.textContent = String(best);

canvas.style.touchAction = "none";

// ---- state machine ----
/** @type {"menu"|"playing"|"gameover"} */
let state = "menu";

// ---- braking, owned by the car controller (wired directly here) ----
let braking = false;
brakeBtn.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  braking = true;
});
brakeBtn.addEventListener("pointerup", (e) => {
  e.preventDefault();
  braking = false;
});
brakeBtn.addEventListener("pointercancel", (e) => {
  e.preventDefault();
  braking = false;
});

// ---- three.js scene setup ----
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d12);
scene.fog = new THREE.Fog(0x0b0d12, 40, 220);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
renderer.shadowMap.enabled = false;

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 260);

const hemiLight = new THREE.HemisphereLight(0x8899aa, 0x11141a, 1.1);
scene.add(hemiLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(-15, 30, 20);
dirLight.castShadow = false;
scene.add(dirLight);

function handleResize() {
  const w = window.innerWidth;
  const h = window.innerHeight;
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  renderer.setSize(w, h, false);
}
window.addEventListener("resize", handleResize);
window.addEventListener("orientationchange", handleResize);
handleResize();

// ---- car + world ----
const car = createCar(scene);
const world = createWorld(scene);

// Initial camera placement matching the car's rest pose.
updateCamera(camera, car, 0);

// ---- steering input (top-level composition point) ----
onPointer(canvas, {
  onDown: (x) => {
    if (state !== "playing") return;
    beginSteer(car, x);
  },
  onMove: (x) => {
    if (state !== "playing") return;
    updateSteer(car, x);
  },
  onUp: () => {
    endSteer(car);
  },
});

// ---- start flow ----
startBtn.addEventListener("click", () => {
  menuOverlay.hidden = true;
  resetCar(car);
  car._hitCooldown = 0;
  resetWorld(world);
  scoreState = createScoreState();
  updateHud();
  state = "playing";
  loop.start();
});

// ---- retry flow ----
retryBtn.addEventListener("click", () => {
  gameoverOverlay.hidden = true;
  resetCar(car);
  car._hitCooldown = 0;
  resetWorld(world);
  scoreState = createScoreState();
  updateHud();
  state = "playing";
  loop.start();
});

/** Score/damage-driven collision hit handling, shared each frame. */
function onPropHit(prop) {
  awardPoints(scoreState, prop, car.speed);

  if (!prop.damageCausing) return;
  if (isHitCooldownActive(car)) return;

  let amount = 0;
  if (prop.typeId === "parkedcar") {
    if (car.speed > PARKEDCAR_DAMAGE_SPEED_THRESHOLD) amount = DAMAGE_AMOUNTS.parkedcar;
  } else if (prop.typeId === "barrier") {
    amount = DAMAGE_AMOUNTS.barrier;
  }

  if (amount > 0) {
    applyDamage(scoreState, amount);
    car._hitCooldown = DAMAGE_COOLDOWN;
  }
}

/** Push current score/damage/distance state into the HUD DOM. */
function updateHud() {
  scoreValueEl.textContent = String(scoreState.score);
  distValueEl.textContent = String(Math.round(car.distanceTraveled));

  damageFillEl.style.width = scoreState.damage + "%";
  damageFillEl.classList.toggle("crit", scoreState.damage >= 85);
  damageFillEl.classList.toggle("warn", scoreState.damage >= 60 && scoreState.damage < 85);
}

function triggerGameOver() {
  state = "gameover";
  best = saveBestIfNeeded(scoreState.score, best);
  bestValueEl.textContent = String(best);
  finalScoreEl.textContent = String(scoreState.score);
  finalDistanceEl.textContent = String(Math.round(car.distanceTraveled));
  finalBestEl.textContent = String(best);
  gameoverOverlay.hidden = false;
}

// ---- update / render ----
function update(dt) {
  if (state !== "playing") return;
  updateCar(car, dt, { braking });
  updateCamera(camera, car, dt);
  updateWorld(world, dt, car.speed);

  checkCollisions(world, car, dt, onPropHit);
  updateFlyingProps(world, dt);

  updateHud();

  if (scoreState.damage >= 100 && state === "playing") {
    triggerGameOver();
  }
}

function render() {
  renderer.render(scene, camera);
}

const loop = createLoop({ update, render });
// Render once immediately so the menu isn't over a blank canvas, then wait
// for Start to actually begin the simulation loop.
render();
