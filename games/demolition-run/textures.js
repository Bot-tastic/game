// textures.js — every texture in the game is drawn on a <canvas> at boot.
// No external image files: they rot, and this keeps the art direction in code.

import * as THREE from "three";

function makeCanvas(w, h) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

function toTexture(canvas, repeatX = 1, repeatY = 1) {
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(repeatX, repeatY);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Wet, speckled asphalt with a dashed centre line and solid edge lines. */
export function createRoadTexture(laneHalfWidth = 6, segmentLength = 40) {
  const W = 256;
  const H = 512;
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");

  g.fillStyle = "#15161d";
  g.fillRect(0, 0, W, H);

  // Speckle + long smeared streaks so the road reads as wet, not flat grey.
  for (let i = 0; i < 2600; i++) {
    const v = 20 + Math.random() * 34;
    g.fillStyle = `rgba(${v},${v + 2},${v + 8},${0.25 + Math.random() * 0.4})`;
    g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 40; i++) {
    const x = Math.random() * W;
    g.strokeStyle = `rgba(90,110,150,${0.02 + Math.random() * 0.05})`;
    g.lineWidth = 6 + Math.random() * 26;
    g.beginPath();
    g.moveTo(x, 0);
    g.lineTo(x + (Math.random() - 0.5) * 30, H);
    g.stroke();
  }

  // Tyre-polished darker wheel tracks.
  for (const tx of [W * 0.3, W * 0.7]) {
    const grad = g.createLinearGradient(tx - 26, 0, tx + 26, 0);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    grad.addColorStop(0.5, "rgba(0,0,0,0.35)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = grad;
    g.fillRect(tx - 26, 0, 52, H);
  }

  const px = W / (laneHalfWidth * 2); // pixels per world unit across the road

  // Solid edge lines.
  g.fillStyle = "rgba(226,232,245,0.5)";
  g.fillRect(px * 0.55, 0, 4, H);
  g.fillRect(W - px * 0.55 - 4, 0, 4, H);

  // Dashed centre line (a duo, like a real two-way street).
  g.fillStyle = "rgba(255,214,102,0.62)";
  const dash = H / 8;
  for (let i = 0; i < 8; i++) {
    g.fillRect(W / 2 - 7, i * dash, 4, dash * 0.55);
    g.fillRect(W / 2 + 3, i * dash, 4, dash * 0.55);
  }

  return toTexture(c, 1, segmentLength / 10);
}

/** Pale kerb / sidewalk paving with slab joints. */
export function createSidewalkTexture() {
  const c = makeCanvas(128, 128);
  const g = c.getContext("2d");
  g.fillStyle = "#23242e";
  g.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 700; i++) {
    const v = 30 + Math.random() * 26;
    g.fillStyle = `rgba(${v},${v},${v + 6},0.5)`;
    g.fillRect(Math.random() * 128, Math.random() * 128, 2, 2);
  }
  g.strokeStyle = "rgba(10,10,14,0.85)";
  g.lineWidth = 3;
  for (let i = 0; i <= 128; i += 32) {
    g.beginPath();
    g.moveTo(0, i);
    g.lineTo(128, i);
    g.stroke();
    g.beginPath();
    g.moveTo(i, 0);
    g.lineTo(i, 128);
    g.stroke();
  }
  return toTexture(c, 2, 8);
}

const WINDOW_TINTS = ["#ffd98a", "#8ad4ff", "#ff9ec4", "#b8ffea", "#ffb066", "#c6a8ff"];

/**
 * Facade pair: `map` is the dark concrete + dim window grid, `emissive` is
 * black except for the lit windows, so buildings glow without a light budget.
 */
export function createFacadeTextures() {
  const W = 256;
  const H = 256;
  const albedo = makeCanvas(W, H);
  const emissive = makeCanvas(W, H);
  const a = albedo.getContext("2d");
  const e = emissive.getContext("2d");

  a.fillStyle = "#171a26";
  a.fillRect(0, 0, W, H);
  for (let i = 0; i < 1400; i++) {
    const v = 20 + Math.random() * 20;
    a.fillStyle = `rgba(${v},${v + 2},${v + 10},0.5)`;
    a.fillRect(Math.random() * W, Math.random() * H, 2, 2);
  }
  e.fillStyle = "#000000";
  e.fillRect(0, 0, W, H);

  const cols = 8;
  const rows = 8;
  const cw = W / cols;
  const rh = H / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const x = col * cw + cw * 0.22;
      const y = r * rh + rh * 0.2;
      const w = cw * 0.56;
      const h = rh * 0.5;
      const lit = Math.random() < 0.46;
      a.fillStyle = lit ? "#2b3450" : "#0f1119";
      a.fillRect(x, y, w, h);
      if (lit) {
        const tint = WINDOW_TINTS[(Math.random() * WINDOW_TINTS.length) | 0];
        e.fillStyle = tint;
        e.globalAlpha = 0.5 + Math.random() * 0.5;
        e.fillRect(x, y, w, h);
        e.globalAlpha = 1;
      }
    }
    // Floor slab shadow band.
    a.fillStyle = "rgba(0,0,0,0.35)";
    a.fillRect(0, r * rh + rh * 0.78, W, 3);
  }

  const map = toTexture(albedo, 1, 1);
  const emissiveMap = toTexture(emissive, 1, 1);
  return { map, emissiveMap };
}

/** Radial soft blob used for light pools, dust and headlight glow. */
export function createGlowTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.35, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Soft puffy blob with a bit of internal structure — smoke and dust. */
export function createSmokeTexture() {
  const S = 128;
  const c = makeCanvas(S, S);
  const g = c.getContext("2d");
  for (let i = 0; i < 14; i++) {
    const x = S / 2 + (Math.random() - 0.5) * S * 0.4;
    const y = S / 2 + (Math.random() - 0.5) * S * 0.4;
    const r = S * (0.12 + Math.random() * 0.2);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.32)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const SIGN_WORDS = ["NEON", "RAMEN", "MOTEL", "24H", "BAR", "SUSHI", "LOTTO", "OPEN", "CLUB", "TACOS"];
const SIGN_COLORS = ["#ff4d8d", "#5ee6c8", "#ffb020", "#7aa6ff", "#ff6b3d", "#c07bff"];

/** Vertical neon shop sign: glowing text on a dark board. */
export function createSignTexture(index) {
  const W = 128;
  const H = 256;
  const c = makeCanvas(W, H);
  const g = c.getContext("2d");
  const word = SIGN_WORDS[index % SIGN_WORDS.length];
  const color = SIGN_COLORS[index % SIGN_COLORS.length];

  g.fillStyle = "#07080c";
  g.fillRect(0, 0, W, H);
  g.strokeStyle = color;
  g.lineWidth = 5;
  g.strokeRect(9, 9, W - 18, H - 18);

  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillStyle = color;
  g.shadowColor = color;
  g.shadowBlur = 22;
  const size = Math.min(40, (W * 1.5) / word.length);
  g.font = `900 ${size}px system-ui, sans-serif`;
  const letters = word.split("");
  const step = (H - 60) / letters.length;
  letters.forEach((ch, i) => g.fillText(ch, W / 2, 46 + step * i));
  g.shadowBlur = 0;

  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return { texture: tex, color: new THREE.Color(color) };
}
