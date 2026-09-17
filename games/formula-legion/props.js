// props.js — level furniture: choice gates, enemy walls and coin trails.
// Reads already-computed event state (z, colHp, cleared...) and turns it into
// meshes; no gameplay math here.

import * as THREE from "three";
import { LANE_HALF_WIDTH } from "./levels.js";

const BAD = 0xff4d6d;
const KIND_COLOR = {
  countAdd: 0x3ddc84,
  countMul: 0x5ee6c8,
  rateUp: 0xffd23f,
  tierUp: 0x8ab4ff,
  shieldUp: 0x63e2ff,
  countSub: BAD,
  countDiv: 0xff7a5c,
  rateDown: 0xc46bff,
  risk: 0xb06bff,
};

function hex(n) {
  return "#" + n.toString(16).padStart(6, "0");
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Big camera-facing chip: the op's value plus what stat it touches. */
function labelSprite(op) {
  const color = KIND_COLOR[op.kind] || 0xffffff;
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 256;
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 512, 256);

  ctx.fillStyle = "rgba(8,10,16,0.82)";
  roundRect(ctx, 14, 14, 484, 228, 34);
  ctx.fill();
  ctx.lineWidth = 10;
  ctx.strokeStyle = hex(color);
  ctx.stroke();

  ctx.shadowColor = hex(color);
  ctx.shadowBlur = 26;
  ctx.fillStyle = "#ffffff";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = "bold 128px system-ui, -apple-system, sans-serif";
  ctx.fillText(op.label, 256, 108);
  ctx.shadowBlur = 0;

  ctx.font = "bold 44px system-ui, -apple-system, sans-serif";
  ctx.fillStyle = hex(color);
  ctx.letterSpacing = "4px";
  ctx.fillText(op.sub, 256, 198);

  const tex = new THREE.CanvasTexture(c);
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const s = new THREE.Sprite(mat);
  s.scale.set(3.0, 1.5, 1);
  return s;
}

function fieldTexture(color) {
  const c = document.createElement("canvas");
  c.width = 64;
  c.height = 128;
  const ctx = c.getContext("2d");
  const g = ctx.createLinearGradient(0, 128, 0, 0);
  g.addColorStop(0, hex(color));
  g.addColorStop(0.6, hex(color));
  g.addColorStop(1, "rgba(0,0,0,0)");
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 128);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "rgba(255,255,255,0.35)";
  for (let y = 0; y < 128; y += 8) ctx.fillRect(0, y, 64, 2);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

function buildGate(ev) {
  const g = new THREE.Group();
  g.position.set(0, 0, ev.z);
  const halfW = LANE_HALF_WIDTH;
  const sides = [];

  for (const side of [-1, 1]) {
    const op = side < 0 ? ev.left : ev.right;
    const color = KIND_COLOR[op.kind] || 0xffffff;
    const sideGroup = new THREE.Group();
    sideGroup.position.x = side * halfW * 0.5;

    const tex = fieldTexture(color);
    tex.repeat.set(2, 1);
    const field = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW - 0.1, 4.2),
      new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        opacity: 0.4,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
      })
    );
    field.position.y = 2.1;
    sideGroup.add(field);

    const frameMat = new THREE.MeshBasicMaterial({ color });
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 4.6, 0.16), frameMat);
    post.position.set(-(halfW - 0.1) / 2, 2.3, 0);
    sideGroup.add(post);
    const post2 = post.clone();
    post2.position.x = (halfW - 0.1) / 2;
    sideGroup.add(post2);
    const beam = new THREE.Mesh(new THREE.BoxGeometry(halfW - 0.1, 0.2, 0.2), frameMat);
    beam.position.y = 4.6;
    sideGroup.add(beam);

    // ground pad so it's obvious which half you're standing in
    const pad = new THREE.Mesh(
      new THREE.PlaneGeometry(halfW - 0.3, 4),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.22,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
    );
    pad.rotation.x = -Math.PI / 2;
    pad.position.set(0, 0.04, -2.6);
    sideGroup.add(pad);

    const label = labelSprite(op);
    label.position.set(0, 5.6, 0);
    sideGroup.add(label);

    g.add(sideGroup);
    sides.push({ group: sideGroup, field, pad, label, frameMat, tex, color });
  }

  const divider = new THREE.Mesh(
    new THREE.BoxGeometry(0.1, 5.0, 0.3),
    new THREE.MeshBasicMaterial({ color: 0xffffff })
  );
  divider.position.y = 2.5;
  g.add(divider);

  return { group: g, sides };
}

function barCanvas() {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  return c;
}

function drawBar(c, frac, hp, color, boss) {
  const ctx = c.getContext("2d");
  ctx.clearRect(0, 0, 256, 64);
  ctx.fillStyle = "rgba(6,8,12,0.85)";
  roundRect(ctx, 4, 20, 248, 24, 12);
  ctx.fill();
  ctx.strokeStyle = "rgba(255,255,255,0.25)";
  ctx.lineWidth = 2;
  ctx.stroke();
  const w = Math.max(0, Math.min(1, frac)) * 240;
  if (w > 2) {
    ctx.fillStyle = color;
    roundRect(ctx, 8, 24, w, 16, 8);
    ctx.fill();
  }
  ctx.fillStyle = "#ffffff";
  ctx.font = "bold 22px system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(boss ? `BOSS ${Math.ceil(hp)}` : String(Math.ceil(hp)), 128, 10);
}

function buildWall(ev, theme) {
  const g = new THREE.Group();
  g.position.set(0, 0, ev.z);
  const blockW = ev.boss ? 1.35 : 1.05;
  const blockH = ev.boss ? 1.3 : 1.05;

  const bodyMat = new THREE.MeshLambertMaterial({
    color: ev.boss ? 0x4a1230 : 0x5a1f2c,
    flatShading: true,
  });
  const trimMat = new THREE.MeshBasicMaterial({ color: ev.boss ? theme.accent : 0xff4d6d });

  const columns = [];
  for (let c = 0; c < ev.cols; c++) {
    const colGroup = new THREE.Group();
    colGroup.position.x = ev.colX[c];
    const blocks = [];
    for (let r = 0; r < ev.rows; r++) {
      const b = new THREE.Group();
      const body = new THREE.Mesh(new THREE.BoxGeometry(blockW, blockH, 0.9), bodyMat);
      b.add(body);
      const trim = new THREE.Mesh(new THREE.BoxGeometry(blockW * 0.82, 0.1, 0.06), trimMat);
      trim.position.set(0, blockH * 0.28, 0.48);
      b.add(trim);
      const eye = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.22, 0.06), trimMat);
      eye.position.set(0, -blockH * 0.1, 0.48);
      b.add(eye);
      b.position.set(0, blockH * 0.6 + r * (blockH + 0.06), 0);
      colGroup.add(b);
      blocks.push(b);
    }

    const bc = barCanvas();
    drawBar(bc, 1, ev.colMax[c], "#ff4d6d", ev.boss);
    const tex = new THREE.CanvasTexture(bc);
    const bar = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
    bar.scale.set(2.2, 0.55, 1);
    bar.position.set(0, blockH * 0.6 + ev.rows * (blockH + 0.06) + 0.7, 0);
    colGroup.add(bar);

    g.add(colGroup);
    columns.push({ group: colGroup, blocks, bar, canvas: bc, tex, lastFrac: 1, redraw: 0 });
  }

  return { group: g, columns, bodyMat, trimMat, blockH };
}

/** Build every gate/wall mesh plus the level-wide coin and boss-shot pools. */
export function createLevelProps(scene, level) {
  const root = new THREE.Group();
  scene.add(root);
  const theme = level.theme;

  for (const ev of level.events) {
    if (ev.type === "gate") {
      const built = buildGate(ev);
      root.add(built.group);
      ev._vis = built;
    } else if (ev.type === "wall") {
      const built = buildWall(ev, theme);
      root.add(built.group);
      ev._vis = built;
    }
  }

  // coins — one instanced mesh for the whole level
  const coinItems = [];
  for (const ev of level.events) {
    if (ev.type === "coins") for (const it of ev.items) coinItems.push(it);
  }
  const coins = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.34, 0),
    new THREE.MeshBasicMaterial({ color: 0xffd23f }),
    Math.max(1, coinItems.length)
  );
  coins.count = coinItems.length;
  coins.frustumCulled = false;
  root.add(coins);

  const shotCap = 24;
  const shots = new THREE.InstancedMesh(
    new THREE.IcosahedronGeometry(0.42, 0),
    new THREE.MeshBasicMaterial({ color: theme.accent }),
    shotCap
  );
  shots.count = 0;
  shots.frustumCulled = false;
  root.add(shots);

  return { root, coinItems, coins, shots, shotCap, dummy: new THREE.Object3D(), theme };
}

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);

export function updateLevelProps(props, level, playerZ, legionX, time) {
  const d = props.dummy;

  for (const ev of level.events) {
    const vis = ev._vis;
    if (!vis) continue;
    const near = ev.z > playerZ - 8 && ev.z < playerZ + 210;

    if (ev.type === "gate") {
      vis.group.visible = near && !ev.applied;
      if (!vis.group.visible) continue;
      const pick = legionX < 0 ? 0 : 1;
      // Gates stay visible far down the track, but their labels would pile up
      // into an unreadable clump in perspective — so only the approaching gate
      // carries readable text.
      const dz = ev.z - playerZ;
      const labelFade = Math.max(0, Math.min(1, 1 - (dz - 16) / 20));
      for (let i = 0; i < 2; i++) {
        const s = vis.sides[i];
        const on = i === pick;
        s.field.material.opacity = on ? 0.62 : 0.24;
        s.pad.material.opacity = on ? 0.4 : 0.1;
        s.tex.offset.y = (time * 0.35) % 1;
        const pulse = on ? 1 + Math.sin(time * 9) * 0.05 : 1;
        s.label.scale.set(3.0 * pulse, 1.5 * pulse, 1);
        s.label.visible = labelFade > 0.02;
        s.label.material.opacity = (on ? 1 : 0.72) * labelFade;
      }
      continue;
    }

    if (ev.type === "wall") {
      vis.group.visible = near && !(ev.resolved && ev.cleared);
      if (!vis.group.visible) continue;
      for (let c = 0; c < vis.columns.length; c++) {
        const col = vis.columns[c];
        const frac = ev.colMax[c] > 0 ? Math.max(0, ev.colHp[c] / ev.colMax[c]) : 0;
        const live = frac <= 0 ? 0 : Math.max(1, Math.ceil(frac * col.blocks.length));
        for (let b = 0; b < col.blocks.length; b++) {
          const blk = col.blocks[b];
          const show = b < live;
          blk.visible = show;
          if (show && b === live - 1) {
            // the block currently taking fire jitters and flashes
            const inner = (frac * col.blocks.length) % 1 || 1;
            blk.scale.setScalar(0.82 + inner * 0.18);
            blk.rotation.z = (1 - inner) * Math.sin(time * 40) * 0.06;
          } else {
            blk.scale.setScalar(1);
            blk.rotation.z = 0;
          }
        }
        col.bar.visible = frac > 0;
        if (frac > 0 && (Math.abs(frac - col.lastFrac) > 0.02 || col.redraw === 0)) {
          col.lastFrac = frac;
          col.redraw = 1;
          drawBar(col.canvas, frac, ev.colHp[c], frac > 0.5 ? "#ff4d6d" : "#ffb020", ev.boss);
          col.tex.needsUpdate = true;
        }
      }
    }
  }

  // coins
  let ci = 0;
  for (const it of props.coinItems) {
    if (it.taken || it.z < playerZ - 4 || it.z > playerZ + 140) {
      props.coins.setMatrixAt(ci++, HIDE);
      continue;
    }
    d.position.set(it.x, 1.0 + Math.sin(time * 3 + it.z) * 0.18, it.z);
    d.rotation.set(0, time * 2.4, 0.4);
    d.scale.setScalar(1);
    d.updateMatrix();
    props.coins.setMatrixAt(ci++, d.matrix);
  }
  props.coins.instanceMatrix.needsUpdate = true;

  // boss projectiles
  let si = 0;
  for (const ev of level.events) {
    if (ev.type !== "wall" || !ev.shots) continue;
    for (const s of ev.shots) {
      if (si >= props.shotCap) break;
      d.position.set(s.x, 1.1, s.z);
      d.rotation.set(time * 6, time * 5, 0);
      d.scale.setScalar(1 + Math.sin(time * 18) * 0.12);
      d.updateMatrix();
      props.shots.setMatrixAt(si++, d.matrix);
    }
  }
  props.shots.count = si;
  if (si > 0) props.shots.instanceMatrix.needsUpdate = true;
}

/** World positions of a column's currently-visible blocks (for shatter FX). */
export function columnBlockPositions(ev, col, out) {
  out.length = 0;
  const vis = ev._vis;
  if (!vis) return out;
  const c = vis.columns[col];
  if (!c) return out;
  for (const b of c.blocks) {
    if (!b.visible) continue;
    out.push(ev.colX[col], b.position.y, ev.z);
  }
  return out;
}
