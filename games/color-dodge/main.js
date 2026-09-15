import {
  lockViewport,
  onPointer,
  loadHighScore,
  saveHighScore,
  createLoop,
  fitCanvasToScreen,
} from "../../shared/game-utils.js";

const HIGHSCORE_KEY = "game-tastic:color-dodge:highscore";

const PALETTE = ["#ff4d4d", "#4d7bff", "#ffd24d", "#4dff88"];

const BALL_RADIUS = 16;
const GRAVITY = 0.4; // px per frame-equivalent
const TERMINAL_VELOCITY = 10; // px per frame-equivalent
const RING_SPACING = 220; // world-Y px between rings
const FIRST_RING_Y = 300; // world-Y of first ring
const RING_OUTER = 100;
const RING_INNER = 70;
const GENERATE_AHEAD = 800; // px buffer to keep rings generated ahead
const PRUNE_BEHIND_SCREENS = 1; // multiples of canvas height behind the ball to prune

const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const scoreValueEl = document.getElementById("score-value");
const bestValueEl = document.getElementById("best-value");
const menuOverlay = document.getElementById("menu-overlay");
const gameoverOverlay = document.getElementById("gameover-overlay");
const startBtn = document.getElementById("start-btn");
const retryBtn = document.getElementById("retry-btn");
const finalScoreEl = document.getElementById("final-score");
const finalBestEl = document.getElementById("final-best");

lockViewport(canvas);

let cw = window.innerWidth;
let ch = window.innerHeight;
fitCanvasToScreen(canvas, (w, h) => {
  cw = w;
  ch = h;
});

const STATE = { MENU: "menu", PLAYING: "playing", GAMEOVER: "gameover" };
let state = STATE.MENU;

let best = loadHighScore(HIGHSCORE_KEY, 0);
bestValueEl.textContent = String(best);

const ball = {
  worldY: 0,
  vy: 0,
  colorIndex: 0,
};

let score = 0;
let rings = [];
let lastRingWorldY = 0;

function normalizeAngle(a) {
  return ((a % 360) + 360) % 360;
}

function makeRing(worldY, currentScore) {
  // Random permutation of the 4 palette colors across the 4 segments.
  const colors = [...PALETTE];
  for (let i = colors.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [colors[i], colors[j]] = [colors[j], colors[i]];
  }
  const magnitude = Math.min(1.5 + currentScore * 0.02, 4);
  const sign = Math.random() < 0.5 ? -1 : 1;
  return {
    worldY,
    colors,
    rotation: 0, // accumulated degrees
    speed: magnitude * sign, // degrees per frame-equivalent
    passed: false,
  };
}

function generateRingsAhead() {
  while (lastRingWorldY - ball.worldY < GENERATE_AHEAD) {
    rings.push(makeRing(lastRingWorldY, score));
    lastRingWorldY += RING_SPACING;
  }
}

function pruneRings() {
  rings = rings.filter((r) => ball.worldY - r.worldY <= ch * PRUNE_BEHIND_SCREENS + RING_OUTER);
}

function resetGame() {
  ball.worldY = 0;
  ball.vy = 0;
  ball.colorIndex = 0;
  score = 0;
  rings = [];
  lastRingWorldY = FIRST_RING_Y;
  generateRingsAhead();
  scoreValueEl.textContent = "0";
}

function startGame() {
  resetGame();
  state = STATE.PLAYING;
  menuOverlay.hidden = true;
  gameoverOverlay.hidden = true;
}

function endGame() {
  state = STATE.GAMEOVER;
  if (score > best) {
    best = score;
    saveHighScore(HIGHSCORE_KEY, best);
    bestValueEl.textContent = String(best);
  }
  finalScoreEl.textContent = String(score);
  finalBestEl.textContent = String(best);
  gameoverOverlay.hidden = false;
}

function update(dt) {
  if (state !== STATE.PLAYING) return;

  const scale = dt * 60;
  const prevWorldY = ball.worldY;

  ball.vy = Math.min(ball.vy + GRAVITY * scale, TERMINAL_VELOCITY);
  ball.worldY += ball.vy * scale;

  generateRingsAhead();
  pruneRings();

  for (const ring of rings) {
    ring.rotation = normalizeAngle(ring.rotation + ring.speed * scale);
  }

  for (const ring of rings) {
    if (ring.passed) continue;
    if (prevWorldY < ring.worldY && ball.worldY >= ring.worldY) {
      const localAngle = normalizeAngle(90 - ring.rotation);
      const segmentIndex = Math.min(3, Math.floor(localAngle / 90));
      const segmentColor = ring.colors[segmentIndex];
      if (segmentColor === PALETTE[ball.colorIndex]) {
        ring.passed = true;
        score += 1;
        scoreValueEl.textContent = String(score);
      } else {
        endGame();
        return;
      }
    }
  }
}

function drawRingSegment(cx, cy, startDeg, endDeg, color) {
  const startRad = (startDeg * Math.PI) / 180;
  const endRad = (endDeg * Math.PI) / 180;
  ctx.beginPath();
  ctx.arc(cx, cy, RING_OUTER, startRad, endRad, false);
  ctx.arc(cx, cy, RING_INNER, endRad, startRad, true);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

function render() {
  const bg0 = "#0b0d12";
  const bg1 = "#14171f";
  const grad = ctx.createLinearGradient(0, 0, 0, ch);
  grad.addColorStop(0, bg1);
  grad.addColorStop(1, bg0);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, cw, ch);

  const cameraY = ball.worldY - 0.35 * ch;
  const cx = cw / 2;

  for (const ring of rings) {
    const screenY = ring.worldY - cameraY;
    if (screenY < -RING_OUTER - 10 || screenY > ch + RING_OUTER + 10) continue;
    for (let i = 0; i < 4; i++) {
      const startDeg = i * 90 + ring.rotation;
      const endDeg = startDeg + 90;
      drawRingSegment(cx, screenY, startDeg, endDeg, ring.colors[i]);
    }
  }

  const ballScreenY = 0.35 * ch;
  ctx.beginPath();
  ctx.arc(cx, ballScreenY, BALL_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = PALETTE[ball.colorIndex];
  ctx.fill();
}

const loop = createLoop({ update, render });
loop.start();

onPointer(canvas, {
  onDown: () => {
    if (state === STATE.PLAYING) {
      ball.colorIndex = (ball.colorIndex + 1) % PALETTE.length;
    }
  },
});

startBtn.addEventListener("click", startGame);
retryBtn.addEventListener("click", startGame);
