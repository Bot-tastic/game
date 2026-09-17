// render.js — three.js visuals for Formula Legion. Pure state (levels.js,
// legion.js, combat.js) is never imported for logic here; this module only
// reads already-computed fields (legion.x/count, event.z/hp/cleared/...) and
// turns them into meshes. No gameplay math lives in this file.

import * as THREE from "three";
import { LANE_HALF_WIDTH, RANGE } from "./levels.js";

const LEGION_CAP = 25; // visual cap; HUD count text always shows the real number
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

/** Position the legion crowd grid centered on (legion.x, 0, playerZ). */
export function updateLegionCrowd(crowd, legion, playerZ) {
  const visible = Math.min(LEGION_CAP, legion.count);
  const cols = Math.max(1, Math.min(5, Math.ceil(Math.sqrt(visible))));
  const spacing = 0.62;

  crowd.bodies.count = visible;
  crowd.heads.count = visible;

  for (let i = 0; i < visible; i++) {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const fx = (col - (cols - 1) / 2) * spacing;
    const fz = -row * spacing * 0.9;
    crowd.dummy.position.set(legion.x + fx, 0.55, playerZ + fz);
    crowd.dummy.updateMatrix();
    crowd.bodies.setMatrixAt(i, crowd.dummy.matrix);
    crowd.dummy.position.y = 1.25;
    crowd.dummy.updateMatrix();
    crowd.heads.setMatrixAt(i, crowd.dummy.matrix);
  }
  crowd.bodies.instanceMatrix.needsUpdate = true;
  crowd.heads.instanceMatrix.needsUpdate = true;
}

const BULLET_TRAVEL_TIME = 0.12; // seconds for a tracer to cross from muzzle to target
const _bulletDummy = new THREE.Object3D();

/** Pool of tracer "bullets" so shooting is actually visible. Cheap: one
 * InstancedMesh, round-robin reuse, no per-bullet allocation after setup. */
export function createBulletPool(scene, capacity = 24) {
  const geo = new THREE.SphereGeometry(0.09, 6, 6);
  const mat = new THREE.MeshBasicMaterial({ color: 0xfff2a0 });
  const mesh = new THREE.InstancedMesh(geo, mat, capacity);
  mesh.frustumCulled = false; // same InstancedMesh culling gotcha as the legion crowd
  mesh.count = capacity;
  scene.add(mesh);

  const bullets = [];
  for (let i = 0; i < capacity; i++) {
    bullets.push({ active: false, t: 0, from: new THREE.Vector3(), to: new THREE.Vector3() });
    _bulletDummy.position.set(0, -1000, 0);
    _bulletDummy.scale.set(0, 0, 0);
    _bulletDummy.updateMatrix();
    mesh.setMatrixAt(i, _bulletDummy.matrix);
  }
  mesh.instanceMatrix.needsUpdate = true;
  return { mesh, bullets, cursor: 0 };
}

/** Fire one tracer from `fromVec3` to `toVec3` (both THREE.Vector3-likes). */
export function spawnBullet(pool, fromVec3, toVec3) {
  const b = pool.bullets[pool.cursor];
  pool.cursor = (pool.cursor + 1) % pool.bullets.length;
  b.active = true;
  b.t = 0;
  b.from.copy(fromVec3);
  b.to.copy(toVec3);
}

export function updateBullets(pool, dt) {
  for (let i = 0; i < pool.bullets.length; i++) {
    const b = pool.bullets[i];
    if (!b.active) continue;
    b.t += dt / BULLET_TRAVEL_TIME;
    if (b.t >= 1) {
      b.active = false;
      _bulletDummy.position.set(0, -1000, 0);
      _bulletDummy.scale.set(0, 0, 0);
    } else {
      _bulletDummy.position.lerpVectors(b.from, b.to, b.t);
      _bulletDummy.scale.set(1, 1, 1);
    }
    _bulletDummy.updateMatrix();
    pool.mesh.setMatrixAt(i, _bulletDummy.matrix);
  }
  pool.mesh.instanceMatrix.needsUpdate = true;
}

/** Damped third-person chase camera following the legion, framed low and
 * close so the crowd itself reads clearly in the lower half of the screen
 * (rather than a distant top-down view where it's a tiny speck). */
export function updateCamera(camera, legion, playerZ, dt) {
  const targetPos = new THREE.Vector3(legion.x * 0.6, 3.4, playerZ - 5.5);
  const damping = Math.min(1, 6 * dt);
  camera.position.lerp(targetPos, damping);
  camera.lookAt(legion.x, 0.9, playerZ + RANGE * 0.4);
}
