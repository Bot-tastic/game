import { lockViewport, onPointer, createLoop, fitCanvasToScreen } from "../../shared/game-utils.js";
import { renderJoinScreen } from "../../shared/multiplayer/trystero-room.js";

const canvas = document.getElementById("game");
const menuOverlay = document.getElementById("menu-overlay");
const leftOverlay = document.getElementById("left-overlay");
const resultOverlay = document.getElementById("result-overlay");
const resultTitle = document.getElementById("result-title");
const resultStat = document.getElementById("result-stat");
const joinContainer = document.getElementById("join-container");
const scoreYouEl = document.getElementById("score-you");
const scoreOppEl = document.getElementById("score-opp");
const leftBackBtn = document.getElementById("left-back-btn");
const resultBackBtn = document.getElementById("result-back-btn");

const ctx = canvas.getContext("2d");
lockViewport(canvas);

leftBackBtn.addEventListener("click", () => location.reload());
resultBackBtn.addEventListener("click", () => location.reload());

const WIN_SCORE = 7;
const PADDLE_H_FRAC = 0.2;
const PADDLE_W_FRAC = 0.02;
const PADDLE_MARGIN_FRAC = 0.03;
const BALL_R_FRAC = 0.012;

let cw = window.innerWidth;
let ch = window.innerHeight;

fitCanvasToScreen(canvas, (w, h) => {
  cw = w;
  ch = h;
});

let role = null; // 'host' | 'guest'
let room = null;
let sendBall, getBall, sendPaddle, getPaddle;

let playing = false;
let matchOver = false;
let frameCount = 0;
let lastPaddleSend = 0;

// Local player's own paddle vertical center, normalized 0-1 of canvas height.
let myPaddleNormY = 0.5;
// Opponent's paddle, normalized 0-1, from network.
let oppPaddleNormY = 0.5;

// Host-authoritative ball physics state (px, in host's own canvas space).
const ball = { x: 0, y: 0, vx: 0, vy: 0 };
let servingSpeed = 0.35 * ch;

// Scores are role-based on the wire: score1 = host's score, score2 = guest's score.
let score1 = 0;
let score2 = 0;

// Guest-only: latest received ball state (normalized), used purely for rendering.
let latestBall = { bx: 0.5, by: 0.5, vx: 0, vy: 0 };

function myScore() {
  return role === "host" ? score1 : score2;
}
function oppScore() {
  return role === "host" ? score2 : score1;
}

function updateScoreHud() {
  scoreYouEl.textContent = String(myScore());
  scoreOppEl.textContent = String(oppScore());
}

function paddleHalfH() {
  return (ch * PADDLE_H_FRAC) / 2;
}
function paddleW() {
  return cw * PADDLE_W_FRAC;
}
function ballRadius() {
  return cw * BALL_R_FRAC;
}
function hostPaddleX() {
  return cw * PADDLE_MARGIN_FRAC + paddleW() / 2;
}
function guestPaddleX() {
  return cw - cw * PADDLE_MARGIN_FRAC - paddleW() / 2;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function serve(direction) {
  const angleDeg = Math.random() * 60 - 30; // ±30°
  const angle = (angleDeg * Math.PI) / 180;
  const dir = direction || (Math.random() < 0.5 ? -1 : 1);
  servingSpeed = 0.35 * ch;
  ball.x = cw / 2;
  ball.y = ch / 2;
  ball.vx = dir * servingSpeed * Math.cos(angle);
  ball.vy = servingSpeed * Math.sin(angle);
}

function checkWin() {
  if (score1 >= WIN_SCORE || score2 >= WIN_SCORE) {
    matchOver = true;
    playing = false;
    loop.stop();
    showResult();
    return true;
  }
  return false;
}

function showResult() {
  const iWon = myScore() > oppScore();
  resultTitle.textContent = iWon ? "You Win!" : "You Lose";
  resultStat.innerHTML = `<strong>${myScore()}</strong> &mdash; <strong>${oppScore()}</strong>`;
  resultOverlay.hidden = false;
}

function showOpponentLeft() {
  if (matchOver) return;
  playing = false;
  loop.stop();
  leftOverlay.hidden = false;
}

function updateHost(dt) {
  ball.x += ball.vx * dt;
  ball.y += ball.vy * dt;

  const r = ballRadius();

  // Bounce off top/bottom.
  if (ball.y - r < 0) {
    ball.y = r;
    ball.vy = Math.abs(ball.vy);
  } else if (ball.y + r > ch) {
    ball.y = ch - r;
    ball.vy = -Math.abs(ball.vy);
  }

  const cap = 2 * (0.35 * ch);
  const halfH = paddleHalfH();

  // Host paddle (left) collision.
  const hx = hostPaddleX();
  const hostPx = myPaddleNormY_px();
  if (ball.vx < 0 && ball.x - r <= hx + paddleW() / 2 && ball.x > hx - paddleW()) {
    const withinY = ball.y >= hostPx - halfH && ball.y <= hostPx + halfH;
    if (withinY) {
      const speed = Math.min(Math.hypot(ball.vx, ball.vy) * 1.05, cap);
      const rel = clamp((ball.y - hostPx) / halfH, -1, 1);
      const angle = rel * (Math.PI / 4);
      ball.vx = Math.abs(speed * Math.cos(angle));
      ball.vy = speed * Math.sin(angle);
      ball.x = hx + paddleW() / 2 + r;
    }
  }

  // Guest paddle (right) collision.
  const gx = guestPaddleX();
  if (ball.vx > 0 && ball.x + r >= gx - paddleW() / 2 && ball.x < gx + paddleW()) {
    const oppPx = oppPaddleNormY * ch;
    const withinY = ball.y >= oppPx - halfH && ball.y <= oppPx + halfH;
    if (withinY) {
      const speed = Math.min(Math.hypot(ball.vx, ball.vy) * 1.05, cap);
      const rel = clamp((ball.y - oppPx) / halfH, -1, 1);
      const angle = rel * (Math.PI / 4);
      ball.vx = -Math.abs(speed * Math.cos(angle));
      ball.vy = speed * Math.sin(angle);
      ball.x = gx - paddleW() / 2 - r;
    }
  }

  // Scoring.
  if (ball.x + r < 0) {
    score2 += 1;
    updateScoreHud();
    if (!checkWin()) serve(1);
  } else if (ball.x - r > cw) {
    score1 += 1;
    updateScoreHud();
    if (!checkWin()) serve(-1);
  }
}

function myPaddleNormY_px() {
  return myPaddleNormY * ch;
}

function update(dt) {
  if (!playing) return;
  if (role === "host") {
    updateHost(dt);
  }
  frameCount++;
  if (role === "host" && frameCount % 2 === 0 && sendBall) {
    sendBall({
      bx: ball.x / cw,
      by: ball.y / ch,
      vx: ball.vx / ch,
      vy: ball.vy / ch,
      score1,
      score2,
    });
  }
}

function render() {
  ctx.clearRect(0, 0, cw, ch);

  // Background court.
  ctx.fillStyle = "#0b0d12";
  ctx.fillRect(0, 0, cw, ch);

  // Center line.
  ctx.strokeStyle = "rgba(154,160,172,0.35)";
  ctx.lineWidth = Math.max(2, cw * 0.004);
  ctx.setLineDash([cw * 0.015, cw * 0.015]);
  ctx.beginPath();
  ctx.moveTo(cw / 2, 0);
  ctx.lineTo(cw / 2, ch);
  ctx.stroke();
  ctx.setLineDash([]);

  const halfH = paddleHalfH();
  const pw = paddleW();

  const hostY = role === "host" ? myPaddleNormY_px() : oppPaddleNormY * ch;
  const guestY = role === "guest" ? myPaddleNormY_px() : oppPaddleNormY * ch;

  ctx.fillStyle = "#5ee6c8";
  ctx.fillRect(hostPaddleX() - pw / 2, hostY - halfH, pw, halfH * 2);
  ctx.fillStyle = "#ff5d8f";
  ctx.fillRect(guestPaddleX() - pw / 2, guestY - halfH, pw, halfH * 2);

  // Ball.
  let bx, by;
  if (role === "host") {
    bx = ball.x;
    by = ball.y;
  } else {
    bx = latestBall.bx * cw;
    by = latestBall.by * ch;
  }
  ctx.fillStyle = "#f2f3f5";
  ctx.beginPath();
  ctx.arc(bx, by, ballRadius(), 0, Math.PI * 2);
  ctx.fill();
}

const loop = createLoop({ update, render });

onPointer(canvas, {
  onDown: (x, y) => setMyPaddle(y),
  onMove: (x, y) => setMyPaddle(y),
});

function setMyPaddle(y) {
  if (!playing) return;
  const halfH = paddleHalfH();
  const clampedY = clamp(y, halfH, ch - halfH);
  myPaddleNormY = clampedY / ch;
  const now = performance.now();
  if (sendPaddle && now - lastPaddleSend >= 33) {
    lastPaddleSend = now;
    sendPaddle({ y: myPaddleNormY });
  }
}

function startMatch() {
  menuOverlay.hidden = true;
  playing = true;
  matchOver = false;
  score1 = 0;
  score2 = 0;
  updateScoreHud();

  sendPaddle({ y: myPaddleNormY });

  if (role === "host") {
    serve();
  }

  loop.start();
}

function wireRoom(r) {
  room = r;
  [sendBall, getBall] = room.makeAction("ballState");
  [sendPaddle, getPaddle] = room.makeAction("paddlePos");

  getPaddle((data) => {
    if (typeof data.y === "number") {
      oppPaddleNormY = data.y;
    }
  });

  if (role === "guest") {
    getBall((data) => {
      latestBall = data;
      score1 = data.score1;
      score2 = data.score2;
      updateScoreHud();
      if (!matchOver && (score1 >= WIN_SCORE || score2 >= WIN_SCORE)) {
        matchOver = true;
        playing = false;
        loop.stop();
        showResult();
      }
    });
  }

  room.onPeerLeave(() => {
    showOpponentLeft();
  });

  startMatch();
}

renderJoinScreen(joinContainer, {
  gameSlug: "pong-duel",
  onHostReady: ({ room: r, role: rl }) => {
    role = rl;
    wireRoom(r);
  },
  onGuestReady: ({ room: r, role: rl }) => {
    role = rl;
    wireRoom(r);
  },
  onError: (err) => {
    console.error("Pong Duel room error:", err);
  },
});
