// physics.js — collision detection + impulse/fling/settle reactions for
// Demolition Run's props.
//
// Contract:
//   checkCollisions(world, car, onHit)
//       Called every frame while state === "playing". Scans world.liveProps
//       for props in state "standing" within a small Z window of the car
//       (car.z is always 0), does an AABB overlap test against the car's
//       box, and on overlap:
//         - calls onHit(prop) so the caller (main.js) can score it and,
//           for damage-causing types, apply damage per the rules below
//         - transitions prop.state -> "flying" and seeds its
//           velocity/angularVelocity for updateFlyingProps to animate.
//       Ticks car._hitCooldown (an invulnerability window) down by dt each
//       frame; only checkCollisions itself reads/sets it (the cooldown only
//       gates *damage*, not scoring/fling — see onHit contract below).
//
//   updateFlyingProps(world, dt)
//       Advances every prop in "flying" or "settling" state: gravity/bounce
//       arc for small debris, a special flat slide+yaw-spin for parkedcar,
//       and a fixed toppling bias for lamppost/sign. Updates each prop's
//       visual instance transform via props.js's updatePropInstanceTransform
//       each frame, and calls despawnProp once a settled prop's timer
//       expires (transitioning it to "despawned" — world.js itself still
//       owns removing the record from world.liveProps when its segment
//       eventually recycles).
//
// Damage rule (decided by main.js's onHit callback, using the exported
// DAMAGE_AMOUNTS/PARKEDCAR_DAMAGE_SPEED_THRESHOLD below so the numbers live
// in one place):
//   - parkedcar: +18 damage, but only if car.speed > 20 (0.5 * MAX_SPEED=40)
//   - barrier:   +22 damage, always
//   - everything else: no damage, score only
//   - after any damage-causing hit, car._hitCooldown is set to ~1s; while
//     that cooldown is active, checkCollisions still fires onHit for
//     scoring/fling but skips re-arming damage (main.js should honor
//     car._hitCooldown itself when deciding whether to call applyDamage,
//     per the exported helper `isHitCooldownActive`/`DAMAGE_COOLDOWN`).

import * as THREE from "three";
import { despawnProp } from "./props.js";

// props.js does not export a way to add a height/rotation offset on top of
// its own ground-contact transform, and it's Pass 1's finished/read-only
// work, so physics.js writes flying-prop transforms directly via the same
// InstancedMesh.setMatrixAt pattern props.js itself uses. This duplicates
// props.js's internal baseYOffset table (ground-contact Y per type) — kept
// here defensively, matching the existing duplicated-constant pattern
// already established between car.js/world.js (STREET_HALF_WIDTH,
// CAR_HALF_WIDTH).
const BASE_Y_OFFSET = {
  lamppost: 2.0,
  sign: 1.4,
  cone: 0.3,
  trashcan: 0.4,
  ragdoll: 0.75,
  parkedcar: 0.6,
  barrier: 0.45,
};

const CAR_HALF_DEPTH = 1.6; // half the visual car's length along Z
const Z_CHECK_WINDOW = 3; // cheap early-out: only look at props within this |z|

const CAR_FORWARD_BIAS = 0.6;
const BASE_LAUNCH_SPEED = 22;
const SPIN_MAX = 11;
const GRAVITY = 18;
const BOUNCE_DAMPING = 0.45;
const SETTLE_DESPAWN_DELAY = 2.2;

const MAX_SPEED = 40; // must match car.js's MAX_SPEED

export const DAMAGE_COOLDOWN = 1.0; // seconds of invulnerability after a damaging hit
export const DAMAGE_AMOUNTS = { parkedcar: 18, barrier: 22 };
export const PARKEDCAR_DAMAGE_SPEED_THRESHOLD = 0.5 * MAX_SPEED; // 20

const NO_BOUNCE_TYPES = new Set(["ragdoll"]);
const TOPPLE_TYPES = new Set(["lamppost", "sign"]);

const PARKEDCAR_SLIDE_DURATION = 0.4;

/** True while the car is still invulnerable from a very recent damaging hit. */
export function isHitCooldownActive(car) {
  return (car._hitCooldown || 0) > 0;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

/**
 * Scan for standing props overlapping the car's AABB. `onHit(prop)` is
 * called once per newly-hit prop (before its state flips away from
 * "standing"), so the caller can score/damage it using its original
 * typeId/basePoints/damageCausing fields. `dt` is used only to tick down
 * car._hitCooldown (the post-damage invulnerability window).
 */
export function checkCollisions(world, car, dt, onHit) {
  car._hitCooldown = Math.max(0, (car._hitCooldown || 0) - dt);

  for (const prop of world.liveProps) {
    if (prop.state !== "standing") continue;
    if (Math.abs(prop.z) >= Z_CHECK_WINDOW) continue;

    const carLeft = car.x - CAR_HALF_WIDTH_SAFE();
    const carRight = car.x + CAR_HALF_WIDTH_SAFE();
    const carFront = car.z + CAR_HALF_DEPTH;
    const carBack = car.z - CAR_HALF_DEPTH;

    const propLeft = prop.x - prop.halfWidth;
    const propRight = prop.x + prop.halfWidth;
    const propFront = prop.z + prop.halfDepth;
    const propBack = prop.z - prop.halfDepth;

    const overlapX = carLeft < propRight && carRight > propLeft;
    const overlapZ = carBack < propFront && carFront > propBack;
    if (!overlapX || !overlapZ) continue;

    onHit && onHit(prop);
    launchProp(prop, car);
  }
}

// car.js exports CAR_HALF_WIDTH but physics.js is only handed the car
// instance, not the module — read the constant lazily via a tiny shim so we
// don't need a circular import; car.js's CAR_HALF_WIDTH is a stable literal
// (0.9), duplicated here defensively in case of import-order issues.
const CAR_HALF_WIDTH = 0.9;
function CAR_HALF_WIDTH_SAFE() {
  return CAR_HALF_WIDTH;
}

/** Seed a hit prop's velocity/angularVelocity and flip it to "flying". */
function launchProp(prop, car) {
  let dx = prop.x - car.x;
  let dz = prop.z - car.z;
  const len = Math.hypot(dx, dz) || 1;
  dx /= len;
  dz /= len;
  dz += CAR_FORWARD_BIAS;
  const mag = Math.hypot(dx, dz) || 1;
  dx /= mag;
  dz /= mag;

  const speedFactor = clamp(car.speed / MAX_SPEED, 0.3, 1);
  const launchSpeed = BASE_LAUNCH_SPEED * speedFactor;

  prop.velocity.x = dx * launchSpeed;
  prop.velocity.z = dz * launchSpeed;
  prop.velocity.y = 6 + Math.random() * 5;

  if (prop.typeId === "parkedcar") {
    prop.angularVelocity.x = 0;
    prop.angularVelocity.y = (Math.random() * 2 - 1) * SPIN_MAX;
    prop.angularVelocity.z = 0;
    prop._slideTimer = 0;
  } else if (TOPPLE_TYPES.has(prop.typeId)) {
    // Mostly rotate around one horizontal axis for a "toppling" read.
    const primary = Math.random() < 0.5 ? "x" : "z";
    prop.angularVelocity.x = (Math.random() * 2 - 1) * SPIN_MAX * (primary === "x" ? 1 : 0.2);
    prop.angularVelocity.y = (Math.random() * 2 - 1) * SPIN_MAX * 0.2;
    prop.angularVelocity.z = (Math.random() * 2 - 1) * SPIN_MAX * (primary === "z" ? 1 : 0.2);
  } else {
    prop.angularVelocity.x = (Math.random() * 2 - 1) * SPIN_MAX;
    prop.angularVelocity.y = (Math.random() * 2 - 1) * SPIN_MAX;
    prop.angularVelocity.z = (Math.random() * 2 - 1) * SPIN_MAX;
  }

  prop.state = "flying";
  prop._settleTimer = 0;
  prop._flyingY = 0.05;
  prop._rotX = 0;
  prop._rotY = 0;
  prop._rotZ = 0;
  prop._hasBounced = false;
}

const _matrix = new THREE.Matrix4();
const _pos = new THREE.Vector3();
const _euler = new THREE.Euler();
const _quat = new THREE.Quaternion();
const _scaleOne = new THREE.Vector3(1, 1, 1);

/**
 * Write a flying/settling prop's current x/z/_flyingY/_rot* fields directly
 * into its InstancedMesh slot. record.x/record.z stay the plain world
 * position (the contract fields other systems read); the extra ground
 * clearance and rotation are visual-only, applied here.
 */
function applyVisualTransform(world, prop) {
  const mesh = world.pool.meshes[prop.typeId];
  const baseY = BASE_Y_OFFSET[prop.typeId] || 0;
  _pos.set(prop.x, baseY + (prop._flyingY || 0), prop.z);
  _euler.set(prop._rotX || 0, (prop._rotY || 0) + (prop.rotationY || 0), prop._rotZ || 0);
  _quat.setFromEuler(_euler);
  _matrix.compose(_pos, _quat, _scaleOne);
  mesh.setMatrixAt(prop.instanceIndex, _matrix);
  mesh.instanceMatrix.needsUpdate = true;
}

/** Advance every "flying"/"settling" prop by dt seconds. */
export function updateFlyingProps(world, dt) {
  for (const prop of world.liveProps) {
    if (prop.state !== "flying" && prop.state !== "settling") continue;

    if (prop.typeId === "parkedcar") {
      updateParkedCar(world, prop, dt);
      continue;
    }

    if (prop.state === "flying") {
      prop.velocity.y -= GRAVITY * dt;
      prop.x += prop.velocity.x * dt;
      prop.z += prop.velocity.z * dt;
      prop._flyingY = (prop._flyingY || 0) + prop.velocity.y * dt;
      prop._rotX = (prop._rotX || 0) + prop.angularVelocity.x * dt;
      prop._rotY = (prop._rotY || 0) + prop.angularVelocity.y * dt;
      prop._rotZ = (prop._rotZ || 0) + prop.angularVelocity.z * dt;

      if (prop._flyingY <= 0 && prop.velocity.y < 0) {
        if (!prop._hasBounced && !NO_BOUNCE_TYPES.has(prop.typeId)) {
          prop.velocity.y *= -BOUNCE_DAMPING;
          prop._hasBounced = true;
        } else {
          prop.state = "settling";
          prop._flyingY = 0;
        }
      }

      applyVisualTransform(world, prop);
    } else {
      // settling
      prop.angularVelocity.x *= 0.9;
      prop.angularVelocity.y *= 0.9;
      prop.angularVelocity.z *= 0.9;
      prop._rotX += prop.angularVelocity.x * dt;
      prop._rotY += prop.angularVelocity.y * dt;
      prop._rotZ += prop.angularVelocity.z * dt;
      prop._settleTimer += dt;

      applyVisualTransform(world, prop);

      if (prop._settleTimer >= SETTLE_DESPAWN_DELAY) {
        prop.state = "despawned";
        despawnProp(world.pool, prop);
      }
    }
  }
}

/** parkedcar special-case: flat slide + yaw-spin only, no gravity arc. */
function updateParkedCar(world, prop, dt) {
  if (prop.state === "flying") {
    prop.x += prop.velocity.x * dt;
    prop.z += prop.velocity.z * dt;
    prop._rotY = (prop._rotY || 0) + prop.angularVelocity.y * dt;
    prop._slideTimer = (prop._slideTimer || 0) + dt;

    applyVisualTransform(world, prop);

    if (prop._slideTimer >= PARKEDCAR_SLIDE_DURATION) {
      prop.state = "settling";
      prop._settleTimer = 0;
    }
  } else {
    // settling: damp the yaw spin to a stop, then despawn.
    prop.angularVelocity.y *= 0.9;
    prop._rotY += prop.angularVelocity.y * dt;
    prop._settleTimer += dt;

    applyVisualTransform(world, prop);

    if (prop._settleTimer >= SETTLE_DESPAWN_DELAY) {
      prop.state = "despawned";
      despawnProp(world.pool, prop);
    }
  }
}
