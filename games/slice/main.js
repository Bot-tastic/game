import {
  lockViewport,
  onPointer,
  loadHighScore,
  saveHighScore,
  createLoop,
  fitCanvasToScreen,
} from "../../shared/game-utils.js";

const HIGH_SCORE_KEY = "game-tastic:slice:highscore";

const FRUIT_COLORS = ["#ff4d4d", "#ff9f43", "#3ddc84", "#8e5bff", "#ff5d8f"];
const BOMB_COLOR = "#1a1a1a";

const canvas = document.getElementById("game");
const scoreValueEl = document.getElementById("score-value");
const bestValueEl = document.getElementById("best-value");
const menuOverlay = document.getElementById("menu-overlay");
const gameoverOverlay = document.getElementById("gameover-overlay");
const startBtn = document.getElementById("start-btn");
const retryBtn = document.getElementById("retry-btn");
const finalScoreEl = document.getElementById("final-score");
const finalBestEl = document.getElementById("final-best");

lockViewport(canvas);

let cssWidth = window.innerWidth;
let cssHeight = window.innerHeight;
fitCanvasToScreen(canvas, (w, h) => {
  cssWidth = w;
  cssHeight = h;
});

let bestScore = loadHighScore(HIGH_SCORE_KEY, 0);
bestValueEl.textContent = String(bestScore);

let score = 0;
let objects = []; // active fruit/bombs
let particles = []; // slice-burst particles
let spawnTimer = 0;
let running = false;

let pointerDown = false;
let lastX = 0;
let lastY = 0;
let sliceCombo = 0;
let trail = []; // recent pointer points for the fading slash trail

function randRange(min, max) {
  return min + Math.random() * (max - min);
}

function spawnWave() {
  const roll = Math.random();
  let count = 1;
  if (roll > 0.9) count = 3;
  else if (roll > 0.6) count = 2;

  for (let i = 0; i < count; i++) {
    spawnObject();
  }
}

function spawnObject() {
  const isBomb = Math.random() < 0.12;
  const radius = randRange(30, 40);
  const x = randRange(radius, Math.max(radius, cssWidth - radius));
  const y = cssHeight - randRange(0, cssHeight * 0.1);
  const vy = randRange(-17, -13);
  const vx = randRange(-2, 2);
  const color = isBomb
    ? BOMB_COLOR
    : FRUIT_COLORS[Math.floor(Math.random() * FRUIT_COLORS.length)];

  objects.push({
    x,
    y,
    vx,
    vy,
    radius,
    isBomb,
    color,
    sliced: false,
    rotation: Math.random() * Math.PI * 2,
    spin: randRange(-2, 2),
  });
}

function spawnSliceParticles(obj) {
  // Split into two half-circle-ish particles that fly apart and fade.
  for (let i = 0; i < 2; i++) {
    const dir = i === 0 ? -1 : 1;
    particles.push({
      x: obj.x,
      y: obj.y,
      vx: obj.vx + dir * randRange(2, 5),
      vy: obj.vy - randRange(1, 3),
      radius: obj.radius * 0.7,
      color: obj.color,
      side: dir,
      life: 0,
      maxLife: randRange(0.3, 0.4),
    });
  }
}

function pointSegmentDistance(px, py, ax, ay, bx, by) {
  const abx = bx - ax;
  const aby = by - ay;
  const lenSq = abx * abx + aby * aby;
  let t = 0;
  if (lenSq > 0) {
    t = ((px - ax) * abx + (py - ay) * aby) / lenSq;
    t = Math.max(0, Math.min(1, t));
  }
  const cx = ax + abx * t;
  const cy = ay + aby * t;
  const dx = px - cx;
  const dy = py - cy;
  return Math.sqrt(dx * dx + dy * dy);
}

function triggerGameOver() {
  running = false;
  loop.stop();
  if (score > bestScore) {
    bestScore = score;
    saveHighScore(HIGH_SCORE_KEY, bestScore);
  }
  finalScoreEl.textContent = String(score);
  finalBestEl.textContent = String(bestScore);
  bestValueEl.textContent = String(bestScore);
  gameoverOverlay.hidden = false;
}

function handleSliceSegment(x0, y0, x1, y1) {
  for (const obj of objects) {
    if (obj.sliced) continue;
    const dist = pointSegmentDistance(obj.x, obj.y, x0, y0, x1, y1);
    if (dist < obj.radius) {
      obj.sliced = true;
      if (obj.isBomb) {
        triggerGameOver();
        return;
      }
      sliceCombo += 1;
      score += 10 * sliceCombo;
      scoreValueEl.textContent = String(score);
      spawnSliceParticles(obj);
    }
  }
  if (running) {
    objects = objects.filter((o) => !o.sliced);
  }
}

onPointer(canvas, {
  onDown: (x, y) => {
    if (!running) return;
    pointerDown = true;
    sliceCombo = 0;
    lastX = x;
    lastY = y;
    trail = [{ x, y }];
  },
  onMove: (x, y) => {
    if (!running || !pointerDown) return;
    handleSliceSegment(lastX, lastY, x, y);
    lastX = x;
    lastY = y;
    trail.push({ x, y });
    if (trail.length > 6) trail.shift();
  },
  onUp: () => {
    pointerDown = false;
    trail = [];
  },
});

function update(dt) {
  if (!running) return;

  const level = Math.floor(score / 10);
  const spawnInterval = Math.max(0.3, 0.8 - Math.min(0.5, level * 0.02));
  spawnTimer += dt;
  while (spawnTimer >= spawnInterval) {
    spawnTimer -= spawnInterval;
    spawnWave();
  }

  const scale = dt * 60;
  for (const obj of objects) {
    obj.vy += 0.25 * scale;
    obj.x += obj.vx * scale;
    obj.y += obj.vy * scale;
    obj.rotation += obj.spin * dt;
  }
  objects = objects.filter(
    (o) => !o.sliced && o.y < cssHeight + 60
  );

  for (const p of particles) {
    p.life += dt;
    p.vy += 0.25 * scale;
    p.x += p.vx * scale;
    p.y += p.vy * scale;
  }
  particles = particles.filter((p) => p.life < p.maxLife);
}

function drawFruit(obj) {
  ctx.save();
  ctx.translate(obj.x, obj.y);
  ctx.rotate(obj.rotation);
  ctx.beginPath();
  ctx.arc(0, 0, obj.radius, 0, Math.PI * 2);
  ctx.fillStyle = obj.color;
  ctx.fill();

  if (obj.isBomb) {
    ctx.strokeStyle = getComputedStyle(document.documentElement)
      .getPropertyValue("--accent-2")
      .trim() || "#ff5d8f";
    ctx.lineWidth = 3;
    ctx.stroke();
    // fuse/spark glyph
    ctx.strokeStyle = "#ffb020";
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(0, -obj.radius);
    ctx.lineTo(obj.radius * 0.3, -obj.radius * 1.4);
    ctx.stroke();
    ctx.fillStyle = "#ffb020";
    ctx.beginPath();
    ctx.arc(obj.radius * 0.3, -obj.radius * 1.4, 3, 0, Math.PI * 2);
    ctx.fill();
  } else {
    ctx.fillStyle = "rgba(255,255,255,0.25)";
    ctx.beginPath();
    ctx.arc(-obj.radius * 0.3, -obj.radius * 0.3, obj.radius * 0.3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function drawParticle(p) {
  const alpha = Math.max(0, 1 - p.life / p.maxLife);
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.translate(p.x, p.y);
  ctx.beginPath();
  ctx.arc(0, 0, p.radius, p.side < 0 ? Math.PI * 0.5 : -Math.PI * 0.5, p.side < 0 ? Math.PI * 1.5 : Math.PI * 0.5);
  ctx.closePath();
  ctx.fillStyle = p.color;
  ctx.fill();
  ctx.restore();
}

function drawTrail() {
  if (trail.length < 2) return;
  for (let i = 1; i < trail.length; i++) {
    const a = trail[i - 1];
    const b = trail[i];
    const alpha = i / trail.length;
    ctx.save();
    ctx.globalAlpha = alpha * 0.8;
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }
}

const ctx = canvas.getContext("2d");

function render() {
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  for (const obj of objects) drawFruit(obj);
  for (const p of particles) drawParticle(p);
  drawTrail();
}

const loop = createLoop({ update, render });

function resetGame() {
  score = 0;
  objects = [];
  particles = [];
  spawnTimer = 0;
  sliceCombo = 0;
  trail = [];
  pointerDown = false;
  scoreValueEl.textContent = "0";
}

function startGame() {
  resetGame();
  running = true;
  menuOverlay.hidden = true;
  gameoverOverlay.hidden = true;
  loop.start();
}

startBtn.addEventListener("click", startGame);
retryBtn.addEventListener("click", startGame);
