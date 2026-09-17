// render.js — three.js visuals for Formula Legion. Pure state (levels.js,
// legion.js, combat.js) is never imported for logic here; this module only
// reads already-computed fields (legion.x/count, event.z/hp/cleared/...) and
// turns them into meshes. No gameplay math lives in this file.

import * as THREE from "three";
import { LANE_HALF_WIDTH, RANGE } from "./levels.js";

export const LEGION_CAP = 600; // visual cap; HUD count text always shows the real number
const LEGION_SPACING = 0.5;
const GATE_COLORS = {
  countAdd: 0x4fd18c,
  countSub: 0xff5d73,
  countMul: 0x5b8cff,
  countDiv: 0xffb347,
  fireRateAdd: 0xffd23f,
  fireRateSub: 0x8a6d3f,
  damageAdd: 0xff7a1a,
  damageSub: 0x6b4a4a,
};

function makeLabelSprite(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 128;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "rgba(0,0,0,0)";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.font = "bold 72px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = "#0b0d12";
  ctx.lineWidth = 10;
  ctx.strokeStyle = "#" + color.toString(16).padStart(6, "0");
  ctx.strokeText(text, canvas.width / 2, canvas.height / 2);
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  const mat = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(mat);
  sprite.scale.set(4, 2, 1);
  return sprite;
}

export function createGround(scene, level) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x262a33, flatShading: true });
  const geo = new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + 2, 0.4, level.length + 60);
  const ground = new THREE.Mesh(geo, mat);
  ground.position.set(0, -0.2, level.length / 2 - 20);
  scene.add(ground);

  const stripeMat = new THREE.MeshBasicMaterial({ color: 0x3a3f4d });
  for (const side of [-1, 1]) {
    const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.15, 0.05, level.length + 60), stripeMat);
    stripe.position.set(side * LANE_HALF_WIDTH, 0.03, level.length / 2 - 20);
    scene.add(stripe);
  }
  return ground;
}

/** Build all gate/wave meshes for a level up front (levels are finite). */
export function createLevelVisuals(scene, level) {
  const group = new THREE.Group();
  scene.add(group);

  for (const ev of level.events) {
    if (ev.type === "gate") {
      const halfW = LANE_HALF_WIDTH;
      const gateGroup = new THREE.Group();
      gateGroup.position.set(0, 0, ev.z);

      // Left half [-halfW, 0] and right half [0, halfW], each its own panel
      // + label, plus a thin bright divider down the middle so the split
      // reads as an actual fork the player has to steer into.
      for (const side of [-1, 1]) {
        const op = side < 0 ? ev.left : ev.right;
        const color = GATE_COLORS[op.kind] || 0xffffff;
        const mat = new THREE.MeshLambertMaterial({ color, transparent: true, opacity: 0.6, flatShading: true });
        const panel = new THREE.Mesh(new THREE.BoxGeometry(halfW - 0.08, 3.2, 0.4), mat);
        panel.position.set(side * halfW * 0.5, 1.6, 0);
        gateGroup.add(panel);

        const label = makeLabelSprite(op.label, color);
        label.position.set(side * halfW * 0.5, 3.4, 0);
        gateGroup.add(label);
      }

      const dividerMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
      const divider = new THREE.Mesh(new THREE.BoxGeometry(0.08, 3.6, 0.5), dividerMat);
      divider.position.set(0, 1.8, 0);
      gateGroup.add(divider);

      group.add(gateGroup);
      ev._mesh = gateGroup;
    } else {
      const waveGroup = new THREE.Group();
      waveGroup.position.set(0, 0, ev.z);
      const mat = new THREE.MeshLambertMaterial({ color: 0xff3b4a, flatShading: true });
      // One dummy array per column (ev.colX[c]) so column HP can drive that
      // column's dummies independently — the whole point of columns is that
      // clearing one doesn't touch the others.
      const colDummies = ev.colX.map(() => []);
      for (let r = 0; r < ev.rows; r++) {
        for (let c = 0; c < ev.cols; c++) {
          const dummy = new THREE.Mesh(new THREE.BoxGeometry(0.55, 1.4, 0.55), mat);
          dummy.position.set(ev.colX[c], 0.7, r * 0.9);
          waveGroup.add(dummy);
          colDummies[c].push(dummy);
        }
      }
      group.add(waveGroup);
      ev._mesh = waveGroup;
      ev._colDummies = colDummies;
    }
  }

  return group;
}

export function disposeLevelVisuals(scene, group) {
  scene.remove(group);
  group.traverse((obj) => {
    if (obj.geometry) obj.geometry.dispose();
    if (obj.material) {
      if (obj.material.map) obj.material.map.dispose();
      obj.material.dispose();
    }
  });
}

/** Hide/show gate + wave meshes relative to playerZ (cheap distance culling
 * isn't required at this event count, but hides passed gates for clarity). */
export function updateLevelVisuals(level, playerZ) {
  for (const ev of level.events) {
    if (!ev._mesh) continue;
    if (ev.type === "gate") {
      ev._mesh.visible = ev.z > playerZ - 4;
      continue;
    }
    ev._mesh.visible = ev.z > playerZ - 4 && !ev.resolved;
  }
}

/** Hide a column's dummies proportionally to its own remaining HP —
 * columns clear independently, so this must never look at the wave total. */
export function updateWaveDummies(ev) {
  if (!ev._colDummies) return;
  for (let c = 0; c < ev._colDummies.length; c++) {
    const dummies = ev._colDummies[c];
    const colMax = ev.hpEach * ev.rows;
    const remaining = colMax > 0 ? Math.max(0, ev.colHp[c] / colMax) : 0;
    const visibleCount = ev.colHp[c] <= 0 ? 0 : Math.max(1, Math.round(remaining * dummies.length));
    for (let i = 0; i < dummies.length; i++) dummies[i].visible = i < visibleCount;
  }
}

/** Build the legion crowd's instanced meshes once (capacity LEGION_CAP). */
export function createLegionCrowd(scene) {
  const bodyGeo = new THREE.CylinderGeometry(0.28, 0.32, 1.1, 6);
  const headGeo = new THREE.SphereGeometry(0.22, 6, 6);
  const mat = new THREE.MeshLambertMaterial({ color: 0x5b8cff, flatShading: true });

  const bodies = new THREE.InstancedMesh(bodyGeo, mat, LEGION_CAP);
  const heads = new THREE.InstancedMesh(headGeo, mat, LEGION_CAP);
  bodies.count = 0;
  heads.count = 0;
  // Instances are positioned via per-instance matrices far from this mesh's
  // own local origin (at world Z = playerZ, which grows into the hundreds+
  // over a level) — three.js only frustum-culls using the geometry's own
  // untransformed bounding sphere at that local origin, so without this the
  // whole crowd gets silently culled the moment playerZ moves any distance
  // from 0, even though every instance is right in front of the camera.
  bodies.frustumCulled = false;
  heads.frustumCulled = false;
  scene.add(bodies, heads);

  const dummy = new THREE.Object3D();
  return { bodies, heads, dummy };
}

/** How many legion members are actually rendered, and how many columns
 * their grid formation uses — shared with main.js so it can pick a random
 * *real* crowd-member position (e.g. for a muzzle flash) that matches
 * exactly what's on screen. */
export function visibleLegionCount(legion) {
  return Math.min(LEGION_CAP, legion.count);
}

export function legionLayoutCols(visible) {
  return Math.max(1, Math.ceil(Math.sqrt(visible * 1.3)));
}

/** World position of crowd-grid slot `i` (body height; add ~0.7 for head). */
export function legionSlotPosition(legion, playerZ, i, cols) {
  const col = i % cols;
  const row = Math.floor(i / cols);
  const fx = (col - (cols - 1) / 2) * LEGION_SPACING;
  const fz = -row * LEGION_SPACING * 0.9;
  return { x: legion.x + fx, y: 0.55, z: playerZ + fz };
}

/** Position the legion crowd grid centered on (legion.x, 0, playerZ). */
export function updateLegionCrowd(crowd, legion, playerZ) {
  const visible = visibleLegionCount(legion);
  const cols = legionLayoutCols(visible);

  crowd.bodies.count = visible;
  crowd.heads.count = visible;

  for (let i = 0; i < visible; i++) {
    const pos = legionSlotPosition(legion, playerZ, i, cols);
    crowd.dummy.position.set(pos.x, pos.y, pos.z);
    crowd.dummy.updateMatrix();
    crowd.bodies.setMatrixAt(i, crowd.dummy.matrix);
    crowd.dummy.position.y = pos.y + 0.7;
    crowd.dummy.updateMatrix();
    crowd.heads.setMatrixAt(i, crowd.dummy.matrix);
  }
  crowd.bodies.instanceMatrix.needsUpdate = true;
  crowd.heads.instanceMatrix.needsUpdate = true;
}

export const BULLET_SPEED = 55; // world units/sec, straight-line +Z travel only
const _bulletDummy = new THREE.Object3D();

/** Pool of tracer "bullets" so shooting is actually visible. Every shot
 * travels straight forward (+Z) from wherever it was fired — no homing, no
 * lerping toward a target position — until it's gone `distance` units, at
 * which point it's freed. Capacity is fixed at creation (three.js
 * InstancedMesh can't grow its instance buffer later), sized generously so
 * a full synchronized legion volley — even several overlapping volleys in
 * flight from a high fire rate — is never actually short of slots. */
export function createBulletPool(scene, capacity = LEGION_CAP * 4) {
  const geo = new THREE.SphereGeometry(0.08, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff2a0 });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.frustumCulled = false; // same InstancedMesh culling gotcha as the legion crowd
  mesh.count = capacity;
  scene.add(mesh);

  const bullets = [];
  for (let i = 0; i < capacity; i++) {
    bullets.push({ active: false, x: 0, y: 0, z: 0, remaining: 0 });
    _bulletDummy.position.set(0, -1000, 0);
    _bulletDummy.scale.set(0, 0, 0);
    _bulletDummy.updateMatrix();
    mesh.setMatrixAt(i, _bulletDummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, bullets, cursor: 0 };
}

/** Fire one straight-forward tracer from `fromVec3`, traveling `distance`
 * world units in +Z before disappearing. Round-robins through the fixed
 * pool; with capacity sized as above this only ever reuses a slot whose
 * bullet has already finished traveling. */
export function spawnBullet(pool, fromVec3, distance) {
  const slot = pool.bullets[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.bullets.length;
  slot.active = true;
  slot.x = fromVec3.x;
  slot.y = fromVec3.y;
  slot.z = fromVec3.z;
  slot.remaining = distance;
}

export function updateBullets(pool, dt) {
  const step = BULLET_SPEED * dt;
  for (let i = 0; i < pool.bullets.length; i++) {
    const b = pool.bullets[i];
    if (!b.active) continue;
    b.z += step;
    b.remaining -= step;
    if (b.remaining <= 0) {
      b.active = false;
      _bulletDummy.position.set(0, -1000, 0);
      _bulletDummy.scale.set(0, 0, 0);
    } else {
      _bulletDummy.position.set(b.x, b.y, b.z);
      _bulletDummy.scale.set(1, 1, 1);
    }
    _bulletDummy.updateMatrix();
    pool.mesh.setMatrixAt(i, _bulletDummy.matrix);
  }
  pool.mesh.instanceMatrix.needsUpdate = true;
}

/** Damped third-person chase camera following the legion, pulled back far
 * enough to frame a large crowd formation (not just a handful of figures)
 * plus a useful stretch of the path ahead. */
export function updateCamera(camera, legion, playerZ, dt) {
  const targetPos = new THREE.Vector3(legion.x * 0.6, 7.5, playerZ - 12.5);
  const damping = Math.min(1, 6 * dt);
  camera.position.lerp(targetPos, damping);
  camera.lookAt(legion.x, 1.2, playerZ + RANGE * 0.45);
}
