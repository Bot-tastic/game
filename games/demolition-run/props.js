// props.js — prop kit-meshes + instanced pooling for Demolition Run.
//
// Pass 1 scope: build a pooled InstancedMesh per prop type and hand back
// live prop-instance records with a fixed, documented shape. Pass 2
// (physics.js / scoring.js) reads these records every frame to do
// collision detection and scoring — it does NOT re-derive anything from
// the InstancedMesh matrices, so keeping x/z in sync on this record IS the
// contract (world.js updates x/z as segments scroll).
//
// ---------------------------------------------------------------------
// REQUIRED live prop-instance record shape (verbatim — do not diverge):
//
// {
//   typeId: "lamppost" | "sign" | "cone" | "trashcan" | "ragdoll" | "parkedcar" | "barrier",
//   instanceIndex: <int>,      // index into that type's InstancedMesh, needed for setMatrixAt calls when Pass 2 animates a destroyed prop flying/settling
//   x: <number>,               // current world X (lateral)
//   z: <number>,               // current world Z (updated every frame as the world scrolls — world.js must keep this field's value in sync with the actual mesh position it set, since Pass 2's collision code in physics.js will read x/z directly from this record, not by re-deriving it from the InstancedMesh matrix)
//   halfWidth: <number>,        // approximate AABB half-extent in X, for Pass 2's collision math — pick a reasonable value per type (e.g. lamppost ~0.15, parkedcar ~1.0, barrier ~2.0)
//   halfDepth: <number>,        // approximate AABB half-extent in Z, similarly per type
//   state: "standing",          // Pass 1 always creates props in "standing" state; Pass 2 will transition this to "flying"/"settling"/"despawned"
//   velocity: { x: 0, y: 0, z: 0 },       // present but unused/zero in Pass 1 — Pass 2 will set these when a prop is hit
//   angularVelocity: { x: 0, y: 0, z: 0 }, // present but unused/zero in Pass 1
//   damageCausing: <bool>,      // true for "parkedcar" and "barrier" only, false for all other types
//   basePoints: <number>,       // per the point table: cone 25, trashcan 30, sign 40, lamppost 60, ragdoll 75, barrier 90, parkedcar 150
// }
// ---------------------------------------------------------------------

import * as THREE from "three";

const POOL_CAPACITY = 60;

// Static per-type facts. halfWidth/halfDepth are approximate AABB half-extents.
// damageCausing/basePoints are static facts about the type per the spec.
const PROP_DEFS = {
  lamppost: { halfWidth: 0.15, halfDepth: 0.15, damageCausing: false, basePoints: 60, color: 0xffe94f },
  sign: { halfWidth: 0.35, halfDepth: 0.1, damageCausing: false, basePoints: 40, color: 0xff9d1f },
  cone: { halfWidth: 0.3, halfDepth: 0.3, damageCausing: false, basePoints: 25, color: 0xff5a1f },
  trashcan: { halfWidth: 0.35, halfDepth: 0.35, damageCausing: false, basePoints: 30, color: 0x37d3a3 },
  ragdoll: { halfWidth: 0.3, halfDepth: 0.3, damageCausing: false, basePoints: 75, color: 0xd9a689 },
  parkedcar: { halfWidth: 1.0, halfDepth: 2.0, damageCausing: true, basePoints: 150, color: 0xd63b5c },
  barrier: { halfWidth: 2.0, halfDepth: 0.4, damageCausing: true, basePoints: 90, color: 0xffce1f },
};

// Per-instance color variety for the two prop types the eye lingers on most
// (parked cars line the street constantly; ragdolls are the most numerous
// "characters"). Applied via InstancedMesh.setColorAt on spawn; every other
// type keeps its single PROP_DEFS.color for simplicity/perf.
const COLOR_VARIANT_TYPES = {
  parkedcar: [0xd63b5c, 0x3b8fd6, 0xf5c518, 0x3bd67a, 0xf5822a, 0x9d5cf5, 0x3bd6cf],
  ragdoll: [0xd9a689, 0xf5c9a0, 0x8a5a3a, 0xe8b4d9, 0x8ac9f5, 0xf5e08a],
};

function buildGeometry(typeId) {
  switch (typeId) {
    case "lamppost":
      // Single tapered cylinder standing in for "pole with lamp head" — a
      // working pooled single-draw-call prop is the goal for v1, not visual
      // fidelity of a multi-part lamp.
      return new THREE.CylinderGeometry(0.05, 0.08, 4, 6);
    case "sign":
      // Flat box "sign face"; its Y offset is baked into each instance's
      // transform so it reads as mounted atop a post height.
      return new THREE.BoxGeometry(0.6, 0.6, 0.05);
    case "cone":
      return new THREE.ConeGeometry(0.3, 0.6, 8);
    case "trashcan":
      return new THREE.CylinderGeometry(0.35, 0.3, 0.8, 8);
    case "ragdoll":
      // CapsuleGeometry available since r138.
      return new THREE.CapsuleGeometry(0.25, 1.0, 4, 8);
    case "parkedcar":
      return new THREE.BoxGeometry(1.7, 1.2, 3.6);
    case "barrier":
      return new THREE.BoxGeometry(3.2, 0.9, 0.6);
    default:
      throw new Error(`props.js: unknown typeId "${typeId}"`);
  }
}

// Baseline "ground contact" Y offset per type — i.e. how high the geometry's
// local origin (its center, since all these geometries are centered) needs
// to sit above y=0 so its base rests on the road.
function baseYOffset(typeId) {
  switch (typeId) {
    case "lamppost":
      return 2.0; // half of height 4
    case "sign":
      return 1.4; // mounted up at roughly sign-post height
    case "cone":
      return 0.3;
    case "trashcan":
      return 0.4;
    case "ragdoll":
      return 0.75; // capsule radius 0.25 + half length 0.5
    case "parkedcar":
      return 0.6;
    case "barrier":
      return 0.45;
    default:
      return 0;
  }
}

const FAR_AWAY_Y = -500; // parking unused instances well out of view

/**
 * Build one InstancedMesh per prop type with a fixed capacity. Returns a
 * "pool" handle: { meshes: {typeId: InstancedMesh}, free: {typeId: number[]},
 * defs: PROP_DEFS }. Adds all meshes to `scene`.
 */
export function createPropsPool(scene) {
  const meshes = {};
  const free = {};

  for (const typeId of Object.keys(PROP_DEFS)) {
    const def = PROP_DEFS[typeId];
    const geometry = buildGeometry(typeId);
    const hasColorVariants = !!COLOR_VARIANT_TYPES[typeId];
    const material = new THREE.MeshLambertMaterial({
      color: def.color,
      flatShading: true,
      vertexColors: hasColorVariants,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, POOL_CAPACITY);
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (hasColorVariants) {
      // Pre-fill every instance slot with the base color so unspawned
      // instances (parked far away) still have a valid color attribute.
      const c = new THREE.Color(def.color);
      for (let i = 0; i < POOL_CAPACITY; i++) mesh.setColorAt(i, c);
      mesh.instanceColor.needsUpdate = true;
    }

    // Park every instance far away/invisible until spawned.
    const m = new THREE.Matrix4();
    for (let i = 0; i < POOL_CAPACITY; i++) {
      m.makeTranslation(0, FAR_AWAY_Y, 0);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;

    scene.add(mesh);
    meshes[typeId] = mesh;
    free[typeId] = [];
    for (let i = POOL_CAPACITY - 1; i >= 0; i--) free[typeId].push(i);
  }

  return { meshes, free, defs: PROP_DEFS, capacity: POOL_CAPACITY };
}

const _matrix = new THREE.Matrix4();
const _quatIdentity = new THREE.Quaternion();
const _scaleOne = new THREE.Vector3(1, 1, 1);
const _pos = new THREE.Vector3();
const _colorScratch = new THREE.Color();

/**
 * Spawn a prop of `typeId` at world (x, z). Finds a free instance slot,
 * writes its transform, and returns a live prop-instance record following
 * the shape documented at the top of this file. Returns null if the pool
 * for that type is exhausted (callers should treat this as "skip").
 */
export function spawnProp(pool, typeId, x, z, rotationY = 0) {
  const def = pool.defs[typeId];
  if (!def) throw new Error(`props.js: unknown typeId "${typeId}"`);

  const freeList = pool.free[typeId];
  if (freeList.length === 0) return null; // pool exhausted, skip spawn

  const instanceIndex = freeList.pop();
  const mesh = pool.meshes[typeId];

  const y = baseYOffset(typeId);
  _pos.set(x, y, z);
  const quat = rotationY
    ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotationY)
    : _quatIdentity;
  _matrix.compose(_pos, quat, _scaleOne);
  mesh.setMatrixAt(instanceIndex, _matrix);
  mesh.instanceMatrix.needsUpdate = true;

  const variants = COLOR_VARIANT_TYPES[typeId];
  if (variants) {
    const hex = variants[Math.floor(Math.random() * variants.length)];
    mesh.setColorAt(instanceIndex, _colorScratch.setHex(hex));
    mesh.instanceColor.needsUpdate = true;
  }

  return {
    typeId,
    instanceIndex,
    x,
    z,
    halfWidth: def.halfWidth,
    halfDepth: def.halfDepth,
    state: "standing",
    velocity: { x: 0, y: 0, z: 0 },
    angularVelocity: { x: 0, y: 0, z: 0 },
    damageCausing: def.damageCausing,
    basePoints: def.basePoints,
    // Extra field beyond the required contract, kept only so
    // updatePropTransform() can preserve the spawn-time rotation on scroll
    // updates. Pass 2 is free to ignore this field.
    rotationY: rotationY,
  };
}

/**
 * Return a prop's instance slot to the free pool (park it far away/invisible)
 * so world.js's recycling can reuse the slot for a future spawn.
 */
export function despawnProp(pool, record) {
  const mesh = pool.meshes[record.typeId];
  _matrix.makeTranslation(0, FAR_AWAY_Y, 0);
  mesh.setMatrixAt(record.instanceIndex, _matrix);
  mesh.instanceMatrix.needsUpdate = true;
  pool.free[record.typeId].push(record.instanceIndex);
}

/**
 * Update a prop instance's world transform in place — used by world.js every
 * frame to keep the mesh transform and the record's x/z fields in sync as
 * the world scrolls. Pass rotationY only if you want to preserve a spawned
 * rotation (world.js tracks this itself if needed; Pass 1 keeps rotation 0
 * for simplicity on scroll updates apart from spawn-time random rotation
 * baked in once).
 */
export function updatePropTransform(pool, record) {
  const mesh = pool.meshes[record.typeId];
  const y = baseYOffset(record.typeId);
  _pos.set(record.x, y, record.z);
  const quat = record.rotationY
    ? new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), record.rotationY)
    : _quatIdentity;
  _matrix.compose(_pos, quat, _scaleOne);
  mesh.setMatrixAt(record.instanceIndex, _matrix);
  mesh.instanceMatrix.needsUpdate = true;
}
