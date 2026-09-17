// crowd.js — the player's legion, drawn as one InstancedMesh of low-poly
// soldiers. Handles the formation layout, the run cycle, spawn-in on
// multiply gates and pop-out on losses. No gameplay math here.

import * as THREE from "three";
import { teamColor } from "./legion.js";

export const LEGION_CAP = 340;
const GOLDEN = 2.399963229728653;
const SPAWN_TIME = 0.35;
const DIE_TIME = 0.28;

/** Merge a list of {geo, color} parts into one non-indexed vertex-coloured geometry. */
function mergeParts(parts) {
  const positions = [];
  const normals = [];
  const colors = [];
  for (const p of parts) {
    const g = p.geo.toNonIndexed();
    g.applyMatrix4(p.matrix);
    const pos = g.getAttribute("position");
    const nrm = g.getAttribute("normal");
    for (let i = 0; i < pos.count; i++) {
      positions.push(pos.getX(i), pos.getY(i), pos.getZ(i));
      normals.push(nrm.getX(i), nrm.getY(i), nrm.getZ(i));
      colors.push(p.color[0], p.color[1], p.color[2]);
    }
    g.dispose();
    p.geo.dispose();
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geo;
}

function part(geo, color, x, y, z) {
  const m = new THREE.Matrix4().makeTranslation(x, y, z);
  return { geo, color, matrix: m };
}

/** A recognisable little mech-trooper: legs, torso, pack, pauldrons, visor, gun. */
function soldierGeometry() {
  const BODY = [1, 1, 1];
  const DARK = [0.28, 0.3, 0.36];
  const HEAD = [0.78, 0.8, 0.86];
  const GLOW = [2.4, 2.6, 2.9];
  return mergeParts([
    part(new THREE.BoxGeometry(0.15, 0.45, 0.18), DARK, -0.13, 0.22, 0),
    part(new THREE.BoxGeometry(0.15, 0.45, 0.18), DARK, 0.13, 0.22, 0),
    part(new THREE.BoxGeometry(0.46, 0.5, 0.3), BODY, 0, 0.72, 0),
    part(new THREE.BoxGeometry(0.32, 0.3, 0.14), DARK, 0, 0.74, -0.21),
    part(new THREE.BoxGeometry(0.17, 0.19, 0.29), BODY, -0.3, 0.88, 0),
    part(new THREE.BoxGeometry(0.17, 0.19, 0.29), BODY, 0.3, 0.88, 0),
    part(new THREE.BoxGeometry(0.28, 0.26, 0.28), HEAD, 0, 1.11, 0),
    part(new THREE.BoxGeometry(0.22, 0.08, 0.04), GLOW, 0, 1.13, 0.15),
    part(new THREE.BoxGeometry(0.1, 0.1, 0.55), DARK, 0.3, 0.82, 0.2),
    part(new THREE.BoxGeometry(0.15, 0.15, 0.1), GLOW, 0.3, 0.82, 0.52),
  ]);
}

export function createCrowd(scene) {
  const geo = soldierGeometry();
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, LEGION_CAP);
  mesh.count = 0;
  // Instances sit far from the mesh's local origin (world Z grows through a
  // level) and three.js culls InstancedMesh by the untransformed geometry
  // bounds, so culling has to be off or the whole crowd vanishes.
  mesh.frustumCulled = false;
  mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(LEGION_CAP * 3), 3);
  scene.add(mesh);

  const units = [];
  for (let i = 0; i < LEGION_CAP; i++) {
    units.push({
      state: 0, // 0 empty, 1 alive, 2 dying
      t: 0,
      px: 0,
      pz: 0,
      py: 0,
      phase: Math.random() * Math.PI * 2,
      jx: (Math.random() * 2 - 1) * 0.16,
      jz: (Math.random() * 2 - 1) * 0.2,
      speed: 7.5 + Math.random() * 2.5,
      scale: 0,
    });
  }

  return {
    mesh,
    units,
    dummy: new THREE.Object3D(),
    color: new THREE.Color(0x4f8cff),
    shade: new THREE.Color(),
    alive: 0,
    spread: 1,
    a: 1,
    b: 1,
    deaths: [],
  };
}

function layout(crowd, count) {
  const n = Math.max(1, count);
  crowd.a = Math.min(2.5, 0.3 * Math.sqrt(n) + 0.28);
  crowd.b = Math.min(12, (n * 0.34) / (Math.PI * crowd.a) + 0.7);
  crowd.spread = Math.max(crowd.a, crowd.b * 0.6);
}

function slotX(crowd, i, n) {
  const rr = Math.sqrt((i + 0.5) / n);
  return crowd.a * rr * Math.cos(i * GOLDEN);
}
function slotZ(crowd, i, n) {
  const rr = Math.sqrt((i + 0.5) / n);
  return crowd.b * rr * Math.sin(i * GOLDEN) - crowd.b * 0.18;
}

/**
 * Reconcile the rendered crowd with the real headcount. Newly added units
 * fade/scale in, removed ones start a pop-out and report their world
 * position so the caller can throw sparks there.
 */
export function syncCrowd(crowd, count, legionX, playerZ) {
  const want = Math.min(LEGION_CAP, Math.max(0, count));
  crowd.deaths.length = 0;
  let alive = 0;
  for (const u of crowd.units) if (u.state === 1) alive++;

  if (want > alive) {
    for (let i = 0; i < crowd.units.length && alive < want; i++) {
      const u = crowd.units[i];
      if (u.state !== 0) continue;
      u.state = 1;
      u.t = 0;
      u.scale = 0;
      u.px = legionX + (Math.random() * 2 - 1) * crowd.a * 1.4;
      u.pz = playerZ - crowd.b * (0.6 + Math.random() * 0.6);
      alive++;
    }
  } else if (want < alive) {
    for (let i = crowd.units.length - 1; i >= 0 && alive > want; i--) {
      const u = crowd.units[i];
      if (u.state !== 1) continue;
      u.state = 2;
      u.t = 0;
      crowd.deaths.push(u.px, 0.6, u.pz);
      alive--;
    }
  }
  crowd.alive = alive;
}

export function updateCrowd(crowd, legion, playerZ, dt, time) {
  const n = Math.max(1, crowd.alive);
  layout(crowd, n);

  crowd.color.setHex(teamColor(legion));
  const mesh = crowd.mesh;
  const d = crowd.dummy;
  const ease = Math.min(1, dt * 7);
  let write = 0;
  let slot = 0;

  for (let i = 0; i < crowd.units.length; i++) {
    const u = crowd.units[i];
    if (u.state === 0) continue;

    if (u.state === 1) {
      const tx = legion.x + slotX(crowd, slot, n) + u.jx;
      const tz = playerZ + slotZ(crowd, slot, n) + u.jz;
      slot++;
      u.px += (tx - u.px) * ease;
      u.pz += (tz - u.pz) * ease;
      u.t = Math.min(SPAWN_TIME, u.t + dt);
      const grow = u.t / SPAWN_TIME;
      u.scale = grow < 1 ? 0.2 + 0.8 * (1 - Math.pow(1 - grow, 3)) : 1;
    } else {
      u.t += dt;
      u.scale = Math.max(0, 1 - u.t / DIE_TIME);
      u.py = u.t * 3;
      if (u.t >= DIE_TIME) {
        u.state = 0;
        u.scale = 0;
        continue;
      }
    }

    const bob = Math.abs(Math.sin(time * u.speed + u.phase));
    d.position.set(u.px, 0.02 + bob * 0.13 + (u.state === 2 ? u.py : 0), u.pz);
    d.rotation.set(-bob * 0.08, Math.sin(time * 2 + u.phase) * 0.05, legion.lean * 0.9);
    const sq = u.scale * (1 + bob * 0.05);
    d.scale.set(u.scale, sq, u.scale);
    d.updateMatrix();
    mesh.setMatrixAt(write, d.matrix);

    // gentle per-unit shade variation so a big crowd doesn't read as one blob
    const v = 0.82 + ((i * 37) % 23) / 60;
    crowd.shade.copy(crowd.color).multiplyScalar(u.state === 2 ? 1.8 : v);
    mesh.setColorAt(write, crowd.shade);
    write++;
  }

  mesh.count = write;
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
}

/**
 * Walk the live units' muzzle positions, visiting at most `max` of them
 * (evenly strided, so a huge legion still fires from across the formation
 * without spawning a tracer per soldier).
 */
export function forEachMuzzle(crowd, max, cb) {
  const units = crowd.units;
  const alive = crowd.alive || 1;
  const stride = Math.max(1, Math.ceil(alive / max));
  let seen = 0;
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    if (u.state !== 1 || u.scale < 0.5) continue;
    if (seen % stride === 0) cb(u.px + 0.3, 0.85, u.pz + 0.5);
    seen++;
  }
}
