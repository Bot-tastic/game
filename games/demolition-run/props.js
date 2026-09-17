// props.js — the breakable street furniture.
//
// Every prop type is a handful of primitives merged into ONE geometry with
// baked vertex colours, drawn as a single InstancedMesh per type (plus an
// optional unlit "glow" mesh for neon parts). Breaking a prop hides its
// instance and hands the debris over to fx.js, with per-material recipes so
// glass, wood, concrete and sheet metal all come apart differently.

import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

const CAPACITY = 26;
const FAR = new THREE.Matrix4().makeTranslation(0, -900, 0);

function tint(geo, hex) {
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  const c = new THREE.Color(hex);
  for (let i = 0; i < n; i++) {
    const j = 0.88 + Math.random() * 0.24; // per-vertex grain so flats aren't dead
    arr[i * 3] = c.r * j;
    arr[i * 3 + 1] = c.g * j;
    arr[i * 3 + 2] = c.b * j;
  }
  geo.setAttribute("color", new THREE.BufferAttribute(arr, 3));
  return geo;
}

function place(geo, [x, y, z], rot) {
  if (rot) geo.rotateX(rot[0] || 0), geo.rotateY(rot[1] || 0), geo.rotateZ(rot[2] || 0);
  geo.translate(x, y, z);
  return geo;
}

const box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
const cyl = (rt, rb, h, s = 8) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r, h, s = 8) => new THREE.ConeGeometry(r, h, s);

function part(geo, color, pos, rot) {
  return tint(place(geo, pos, rot), color);
}

// ---------------------------------------------------------------- builders
// Each returns { solid: [geo], glow: [geo] }. Origin sits on the ground.

const BUILDERS = {
  cone: () => ({
    solid: [
      part(cone(0.32, 0.72, 8), 0xff6a1f, [0, 0.4, 0]),
      part(box(0.62, 0.06, 0.62), 0xe8792f, [0, 0.03, 0]),
      part(cyl(0.2, 0.24, 0.1, 8), 0xf4f6ff, [0, 0.46, 0]),
    ],
    glow: [],
  }),
  hydrant: () => ({
    solid: [
      part(cyl(0.2, 0.24, 0.66, 8), 0xe0233f, [0, 0.33, 0]),
      part(cyl(0.22, 0.16, 0.16, 8), 0xe0233f, [0, 0.73, 0]),
      part(cyl(0.09, 0.09, 0.42, 6), 0xd8d9e2, [0, 0.4, 0], [0, 0, Math.PI / 2]),
      part(cyl(0.3, 0.34, 0.08, 8), 0x9b1a2e, [0, 0.04, 0]),
    ],
    glow: [],
  }),
  trashcan: () => ({
    solid: [
      part(cyl(0.34, 0.28, 0.82, 10), 0x3e7f6e, [0, 0.41, 0]),
      part(cyl(0.37, 0.37, 0.08, 10), 0x2c5a4e, [0, 0.84, 0]),
      part(cyl(0.08, 0.08, 0.08, 6), 0x9fe3cf, [0, 0.9, 0]),
    ],
    glow: [],
  }),
  fence: () => {
    const solid = [
      part(box(0.1, 1.0, 0.1), 0x6b4a2f, [-1.1, 0.5, 0]),
      part(box(0.1, 1.0, 0.1), 0x6b4a2f, [1.1, 0.5, 0]),
    ];
    for (let i = -4; i <= 4; i++) solid.push(part(box(0.2, 0.9, 0.07), 0x8a6340, [i * 0.26, 0.48, 0]));
    solid.push(part(box(2.4, 0.1, 0.05), 0x5c3f28, [0, 0.8, 0.03]));
    return { solid, glow: [] };
  },
  barricade: () => {
    const solid = [
      part(box(0.09, 0.9, 0.09), 0x2a2d38, [-0.85, 0.45, 0], [0, 0, 0.2]),
      part(box(0.09, 0.9, 0.09), 0x2a2d38, [0.85, 0.45, 0], [0, 0, -0.2]),
    ];
    for (let i = 0; i < 6; i++) {
      solid.push(part(box(0.32, 0.26, 0.09), i % 2 ? 0xf2f4fa : 0xf04a2a, [-0.8 + i * 0.32, 0.78, 0]));
      solid.push(part(box(0.32, 0.26, 0.09), i % 2 ? 0xf04a2a : 0xf2f4fa, [-0.8 + i * 0.32, 0.42, 0]));
    }
    return { solid, glow: [] };
  },
  haybale: () => ({
    solid: [
      part(cyl(0.6, 0.6, 1.1, 10), 0xd8b05a, [0, 0.6, 0], [0, 0, Math.PI / 2]),
      part(box(1.14, 0.08, 0.5), 0x8d6a2c, [0, 0.62, 0]),
    ],
    glow: [],
  }),
  stall: () => ({
    solid: [
      part(box(0.08, 1.1, 0.08), 0x5c4326, [-0.9, 0.55, -0.5]),
      part(box(0.08, 1.1, 0.08), 0x5c4326, [0.9, 0.55, -0.5]),
      part(box(0.08, 1.1, 0.08), 0x5c4326, [-0.9, 0.55, 0.5]),
      part(box(0.08, 1.1, 0.08), 0x5c4326, [0.9, 0.55, 0.5]),
      part(box(2.0, 0.1, 1.2), 0x7d5a33, [0, 0.9, 0]),
      part(box(2.2, 0.16, 0.7), 0xff4d6d, [0, 1.42, -0.32], [0.45, 0, 0]),
      part(box(2.2, 0.16, 0.7), 0xffd166, [0, 1.42, 0.32], [-0.45, 0, 0]),
      part(box(1.6, 0.3, 0.8), 0x4fbf8b, [0, 1.1, 0]),
    ],
    glow: [],
  }),
  storefront: () => ({
    solid: [
      part(box(3.4, 0.28, 0.34), 0x1d2030, [0, 0.14, 0]),
      part(box(0.22, 2.4, 0.34), 0x1d2030, [-1.7, 1.2, 0]),
      part(box(0.22, 2.4, 0.34), 0x1d2030, [1.7, 1.2, 0]),
      part(box(3.4, 0.3, 0.4), 0x1d2030, [0, 2.4, 0]),
      part(box(3.1, 2.1, 0.1), 0x63d8ff, [0, 1.25, 0]),
    ],
    glow: [part(box(3.2, 0.34, 0.12), 0xff4d8d, [0, 2.4, 0.18]), part(box(3.0, 1.9, 0.04), 0x2a7d96, [0, 1.25, 0.08])],
  }),
  signpost: () => ({
    solid: [
      part(cyl(0.06, 0.07, 2.2, 6), 0xb7bcc9, [0, 1.1, 0]),
      part(box(0.9, 0.62, 0.07), 0x1c2130, [0, 2.0, 0]),
    ],
    glow: [part(box(0.78, 0.5, 0.05), 0x5ee6c8, [0, 2.0, 0.06])],
  }),
  neonsign: () => ({
    solid: [
      part(cyl(0.07, 0.08, 1.4, 6), 0x2a2f3d, [0, 0.7, 0]),
      part(box(0.16, 1.9, 0.16), 0x1a1e29, [0, 2.1, 0]),
    ],
    glow: [
      part(box(0.7, 1.7, 0.08), 0xff4d8d, [0.38, 2.1, 0]),
      part(box(0.1, 1.9, 0.1), 0xffd166, [-0.02, 2.1, 0]),
    ],
  }),
  lamppost: () => ({
    solid: [
      part(cyl(0.09, 0.14, 5.0, 6), 0x2f3542, [0, 2.5, 0]),
      part(cyl(0.3, 0.34, 0.14, 8), 0x2f3542, [0, 0.07, 0]),
      part(box(0.12, 0.12, 1.5), 0x2f3542, [0, 4.95, 0.7]),
      part(box(0.44, 0.16, 0.9), 0x3b4252, [0, 4.82, 1.35]),
    ],
    glow: [part(box(0.36, 0.06, 0.78), 0xffd9a0, [0, 4.73, 1.35])],
  }),
  parkedcar: () => ({
    solid: [
      part(box(1.8, 0.62, 4.0), 0xcf3b57, [0, 0.66, 0]),
      part(box(1.62, 0.56, 1.9), 0x2b3242, [0, 1.2, -0.25]),
      part(box(1.7, 0.16, 0.3), 0x1b1f2a, [0, 0.62, 2.02]),
      part(box(1.7, 0.16, 0.3), 0x1b1f2a, [0, 0.62, -2.02]),
      part(cyl(0.34, 0.34, 0.26, 8), 0x14161d, [-0.9, 0.34, 1.3], [0, 0, Math.PI / 2]),
      part(cyl(0.34, 0.34, 0.26, 8), 0x14161d, [0.9, 0.34, 1.3], [0, 0, Math.PI / 2]),
      part(cyl(0.34, 0.34, 0.26, 8), 0x14161d, [-0.9, 0.34, -1.3], [0, 0, Math.PI / 2]),
      part(cyl(0.34, 0.34, 0.26, 8), 0x14161d, [0.9, 0.34, -1.3], [0, 0, Math.PI / 2]),
    ],
    glow: [part(box(1.3, 0.1, 0.06), 0xff3b3b, [0, 0.72, -2.04])],
  }),
  barrier: () => ({
    solid: [
      part(box(3.0, 0.2, 1.0), 0x9aa0ad, [0, 0.1, 0]),
      part(box(2.6, 0.78, 0.44), 0xb8bec9, [0, 0.5, 0]),
      part(box(2.6, 0.2, 0.3), 0xffb020, [0, 0.9, 0]),
    ],
    glow: [],
  }),
  repair: () => ({
    solid: [part(box(0.66, 0.66, 0.66), 0x1c3a33, [0, 1.0, 0])],
    glow: [
      part(box(0.2, 0.74, 0.2), 0x5ee6c8, [0, 1.0, 0]),
      part(box(0.74, 0.2, 0.2), 0x5ee6c8, [0, 1.0, 0]),
      part(box(0.2, 0.2, 0.74), 0x5ee6c8, [0, 1.0, 0]),
    ],
  }),
};

// ------------------------------------------------------------------- defs
// points: base score. damage: what it does to YOU. drag: speed scrubbed off.
export const PROP_DEFS = {
  cone: { hw: 0.34, hd: 0.34, h: 0.7, points: 25, damage: 0, drag: 0.01, sound: "soft", debris: { count: 5, color: 0xff6a1f, speed: 13, size: 0.2, life: 1.1 } },
  hydrant: { hw: 0.32, hd: 0.32, h: 0.9, points: 90, damage: 0, drag: 0.05, sound: "metal", debris: { count: 7, color: 0xe0233f, speed: 11, size: 0.22 }, water: true },
  trashcan: { hw: 0.38, hd: 0.38, h: 0.9, points: 45, damage: 0, drag: 0.02, sound: "metal", debris: { count: 8, color: 0x3e7f6e, speed: 12, size: 0.24 }, litter: true },
  fence: { hw: 1.25, hd: 0.2, h: 1.0, points: 70, damage: 0, drag: 0.04, sound: "wood", debris: { count: 14, color: 0x8a6340, speed: 11, size: 0.3, flat: true, spread: 2.2 } },
  barricade: { hw: 0.95, hd: 0.2, h: 1.0, points: 60, damage: 0, drag: 0.03, sound: "wood", debris: { count: 11, color: 0xf04a2a, colorJitter: 0.9, speed: 12, size: 0.28, flat: true, spread: 1.6 } },
  haybale: { hw: 0.62, hd: 0.58, h: 1.2, points: 55, damage: 0, drag: 0.06, sound: "soft", debris: { count: 10, color: 0xd8b05a, speed: 9, size: 0.26, spread: 1.2 }, dust: 0xd8b05a },
  stall: { hw: 1.05, hd: 0.7, h: 1.6, points: 140, damage: 0, drag: 0.07, sound: "wood", debris: { count: 18, color: 0xffd166, colorJitter: 0.8, speed: 13, size: 0.28, spread: 2 } },
  storefront: { hw: 1.8, hd: 0.3, h: 2.6, points: 220, damage: 0, drag: 0.08, sound: "glass", debris: { count: 22, color: 0x9ae8ff, speed: 14, size: 0.3, flat: true, spread: 3, glass: true, life: 1.2 }, glass: true },
  signpost: { hw: 0.45, hd: 0.15, h: 2.3, points: 80, damage: 0, drag: 0.03, sound: "metal", debris: { count: 8, color: 0x9fb3c8, speed: 13, size: 0.24 } },
  neonsign: { hw: 0.42, hd: 0.2, h: 3.0, points: 160, damage: 0, drag: 0.05, sound: "glass", debris: { count: 14, color: 0xff4d8d, speed: 14, size: 0.26, glass: true }, glass: true },
  lamppost: { hw: 0.2, hd: 0.2, h: 5.0, points: 110, damage: 6, drag: 0.1, sound: "metal", debris: { count: 10, color: 0x3b4252, speed: 12, size: 0.3 } },
  parkedcar: { hw: 1.0, hd: 2.05, h: 1.5, points: 320, damage: 20, drag: 0.3, sound: "heavy", debris: { count: 20, color: 0xcf3b57, colorJitter: 0.5, speed: 15, size: 0.36, spread: 2.2 }, heavy: true },
  barrier: { hw: 1.55, hd: 0.55, h: 1.0, points: 180, damage: 16, drag: 0.26, sound: "heavy", debris: { count: 16, color: 0xb8bec9, speed: 13, size: 0.34, spread: 2.4 }, dust: 0xaeb6c4, heavy: true },
  repair: { hw: 0.5, hd: 0.5, h: 1.4, points: 0, damage: -30, drag: 0, sound: "pickup", debris: { count: 8, color: 0x5ee6c8, speed: 9, size: 0.2 }, pickup: true, spin: true },
};

export const PROP_TYPES = Object.keys(PROP_DEFS);

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _one = new THREE.Vector3(1, 1, 1);

/** Build one instanced mesh (and optional glow mesh) per prop type. */
export function createPropsPool(scene) {
  const types = {};
  for (const id of PROP_TYPES) {
    const { solid, glow } = BUILDERS[id]();
    const geo = mergeGeometries(solid, false);
    geo.computeVertexNormals();
    const mat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    const mesh = new THREE.InstancedMesh(geo, mat, CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    mesh.frustumCulled = false;
    scene.add(mesh);

    let glowMesh = null;
    if (glow.length) {
      const ggeo = mergeGeometries(glow, false);
      const gmat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
      glowMesh = new THREE.InstancedMesh(ggeo, gmat, CAPACITY);
      glowMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      glowMesh.frustumCulled = false;
      scene.add(glowMesh);
    }

    for (let i = 0; i < CAPACITY; i++) {
      mesh.setMatrixAt(i, FAR);
      if (glowMesh) glowMesh.setMatrixAt(i, FAR);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (glowMesh) glowMesh.instanceMatrix.needsUpdate = true;

    const free = [];
    for (let i = CAPACITY - 1; i >= 0; i--) free.push(i);
    types[id] = { mesh, glowMesh, free, def: PROP_DEFS[id] };
  }
  return { types, capacity: CAPACITY };
}

function writeMatrix(entry, index, rec) {
  _p.set(rec.x, rec.y, rec.z);
  _e.set(rec.tiltX || 0, rec.rotY || 0, rec.tiltZ || 0);
  _q.setFromEuler(_e);
  _m.compose(_p, _q, rec.scale || _one);
  entry.mesh.setMatrixAt(index, _m);
  entry.mesh.instanceMatrix.needsUpdate = true;
  if (entry.glowMesh) {
    entry.glowMesh.setMatrixAt(index, _m);
    entry.glowMesh.instanceMatrix.needsUpdate = true;
  }
}

export function spawnProp(pool, typeId, x, z, rotY = 0) {
  const entry = pool.types[typeId];
  if (!entry || entry.free.length === 0) return null;
  const i = entry.free.pop();
  const rec = {
    typeId,
    def: entry.def,
    index: i,
    x,
    y: 0,
    z,
    rotY,
    tiltX: 0,
    tiltZ: 0,
    scale: new THREE.Vector3(1, 1, 1),
    halfWidth: entry.def.hw,
    halfDepth: entry.def.hd,
    height: entry.def.h,
    points: entry.def.points,
    state: "standing",
    phase: Math.random() * 6.28,
  };
  writeMatrix(entry, i, rec);
  return rec;
}

export function despawnProp(pool, rec) {
  if (rec.state === "gone") return;
  const entry = pool.types[rec.typeId];
  entry.mesh.setMatrixAt(rec.index, FAR);
  entry.mesh.instanceMatrix.needsUpdate = true;
  if (entry.glowMesh) {
    entry.glowMesh.setMatrixAt(rec.index, FAR);
    entry.glowMesh.instanceMatrix.needsUpdate = true;
  }
  entry.free.push(rec.index);
  rec.state = "gone";
}

export function updatePropTransform(pool, rec) {
  if (rec.state === "gone") return;
  writeMatrix(pool.types[rec.typeId], rec.index, rec);
}

/**
 * Blow a prop apart: hide the instance and emit the material-appropriate
 * debris/sparks/dust. `force` is roughly speed-normalised (0..1.4).
 */
export function breakProp(pool, rec, fx, force, dirX) {
  const def = rec.def;
  const d = def.debris || {};
  const y = rec.y + def.h * 0.45;
  const scale = 0.7 + force * 0.8;

  fx.spawnDebris(rec.x, y, rec.z, {
    count: Math.round((d.count || 8) * (0.65 + force * 0.5)),
    color: d.color || 0xcccccc,
    colorJitter: d.colorJitter ?? 0.2,
    speed: (d.speed || 11) * scale,
    size: d.size || 0.26,
    flat: !!d.flat,
    spread: d.spread || 0.9,
    glass: !!d.glass,
    life: d.life || 1.5,
    dirZ: -1,
  });

  if (def.glass) {
    fx.spawnSparks(rec.x, y, rec.z, 20, 0xbfefff, 15 * scale);
    fx.spawnSmoke(rec.x, y, rec.z, 4, 0x4a6a8a, { size: 0.5, grow: 2, life: 0.5 });
  } else if (def.heavy) {
    fx.spawnSparks(rec.x, rec.y + 0.35, rec.z, 24, 0xffb257, 16 * scale);
    fx.spawnSmoke(rec.x, y, rec.z, 9, 0x6b6f7d, { size: 1.0, grow: 2.6, life: 1.1 });
  } else if (def.sound === "metal") {
    fx.spawnSparks(rec.x, rec.y + 0.3, rec.z, 14, 0xffd28a, 14 * scale);
  }

  if (def.water) {
    fx.spawnSmoke(rec.x, rec.y + 0.6, rec.z, 16, 0x8fd8ff, { size: 0.5, grow: 3.4, life: 1.4, rise: 9, speed: 3 });
    fx.spawnSparks(rec.x, rec.y + 0.9, rec.z, 18, 0x9fdcff, 10);
  }
  if (def.dust) {
    fx.spawnSmoke(rec.x, rec.y + 0.4, rec.z, 12, def.dust, { size: 0.8, grow: 3, life: 1.2 });
  }
  if (def.litter) {
    fx.spawnDebris(rec.x, y, rec.z, { count: 6, color: 0xc7cbd6, speed: 9, size: 0.14, flat: true, dirZ: -1, life: 1.6 });
  }
  if (def.pickup) {
    fx.spawnSparks(rec.x, rec.y + 1.0, rec.z, 26, 0x5ee6c8, 9);
  }

  // A little sideways bias so debris flies off the side you clipped it from.
  despawnProp(pool, rec);
  return dirX;
}
