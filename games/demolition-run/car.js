// car.js — player car controller: visual mesh, steering, speed, chase camera.
//
// World coordinate convention (shared with world.js and Pass 2):
// The car's world Z position is FIXED at 0 forever — it never moves
// forward. "Driving forward" is simulated by the world (street segments,
// all props) scrolling toward the camera, i.e. everything else's Z
// decreases by `car.speed * dt` each frame. The car's Y position is also
// fixed at a constant ride height. Only the car's X (lateral/steering)
// actually changes over time.
//
// createCar(scene) returns a car handle object with (at minimum) these
// fields, which Pass 2 depends on:
//   car.group            THREE.Group — the car's visual mesh, already added to scene
//   car.x                number — current world X (lateral position)
//   car.z                number — always 0 (fixed)
//   car.y                number — always RIDE_HEIGHT (fixed)
//   car.targetX           number — steering target the actual x eases toward
//   car.speed             number — current forward speed, world-units/s
//   car.distanceTraveled  number — accumulates car.speed * dt every frame; never reset except by resetCar()
//
// updateCar(car, dt, { braking, dragging, dragX }) advances speed/steering
// easing/distance and syncs car.group's transform. Steering itself (drag
// tracking) is driven from main.js's onPointer callbacks, which set
// car.targetX directly (see setSteerTarget/beginSteer below) — updateCar
// only applies the easing + physics each frame, it does not read pointer
// events itself.

import * as THREE from "three";

export const FORWARD_ACCEL = 6; // world-units/s^2, added to speed while not braking
export const BRAKE_DECEL = 18; // world-units/s^2, subtracted from speed while braking
export const MIN_SPEED = 8; // world-units/s, speed floor
export const MAX_SPEED = 40; // world-units/s, speed ceiling
export const STEER_SENSITIVITY = 0.02; // world-units of lateral target per CSS px of drag
export const STREET_HALF_WIDTH = 6; // must match world.js's street geometry exactly
export const CAR_HALF_WIDTH = 0.9; // half the car's visual width, for steering clamp
export const LATERAL_EASE_RATE = 10; // per-second easing factor toward target X

export const RIDE_HEIGHT = 0.5; // car's fixed Y position

const CAM_X_FOLLOW = 0.6;
const CAM_HEIGHT = 4.5;
const CAM_POS_DAMPING = 6;
const LOOKAHEAD = 10;
const CAM_BASE_Z = 7; // camera sits behind car's fixed z=0, looking toward -Z

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function buildCarMesh() {
  const group = new THREE.Group();

  const bodyMat = new THREE.MeshLambertMaterial({ color: 0xff3b5c, flatShading: true });
  const cabinMat = new THREE.MeshLambertMaterial({ color: 0xff6b85, flatShading: true });
  const wheelMat = new THREE.MeshLambertMaterial({ color: 0x181a1f, flatShading: true });

  const body = new THREE.Mesh(new THREE.BoxGeometry(1.8, 1, 3.2), bodyMat);
  body.position.y = 0.5;
  group.add(body);

  const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.7, 1.6), cabinMat);
  cabin.position.set(0, 1.15, -0.3);
  group.add(cabin);

  const wheelGeo = new THREE.CylinderGeometry(0.4, 0.4, 0.35, 12);
  const wheelOffsets = [
    [-0.95, 0.4, 1.05],
    [0.95, 0.4, 1.05],
    [-0.95, 0.4, -1.05],
    [0.95, 0.4, -1.05],
  ];
  for (const [x, y, z] of wheelOffsets) {
    const wheel = new THREE.Mesh(wheelGeo, wheelMat);
    wheel.rotation.z = Math.PI / 2; // axis along X
    wheel.position.set(x, y, z);
    group.add(wheel);
  }

  return group;
}

/** Build the car mesh, add it to `scene`, and return the car state handle. */
export function createCar(scene) {
  const group = buildCarMesh();
  scene.add(group);

  const car = {
    group,
    x: 0,
    y: RIDE_HEIGHT,
    z: 0,
    targetX: 0,
    speed: MIN_SPEED,
    distanceTraveled: 0,
    // Steering-drag bookkeeping, used by main.js's onPointer callbacks.
    dragging: false,
    dragStartX: 0,
    steerStartTargetX: 0,
  };

  group.position.set(car.x, car.y, car.z);
  return car;
}

/** Reset the car to its initial state (called on Start/Retry). */
export function resetCar(car) {
  car.x = 0;
  car.targetX = 0;
  car.speed = MIN_SPEED;
  car.distanceTraveled = 0;
  car.dragging = false;
  car.dragStartX = 0;
  car.steerStartTargetX = 0;
  car.group.position.set(car.x, car.y, car.z);
  car.group.rotation.y = 0;
}

/** Call from onPointer's onDown(x, y) on the steering surface. */
export function beginSteer(car, x) {
  car.dragging = true;
  car.dragStartX = x;
  car.steerStartTargetX = car.targetX;
}

/** Call from onPointer's onMove(x, y) on the steering surface. */
export function updateSteer(car, x) {
  if (!car.dragging) return;
  const maxX = STREET_HALF_WIDTH - CAR_HALF_WIDTH;
  car.targetX = clamp(
    car.steerStartTargetX + (x - car.dragStartX) * STEER_SENSITIVITY,
    -maxX,
    maxX
  );
}

/** Call from onPointer's onUp(x, y) on the steering surface. */
export function endSteer(car) {
  car.dragging = false;
}

/**
 * Advance the car's speed and lateral easing by dt seconds. `braking` is a
 * boolean (module-level state owned by main.js, wired from the #brake-btn
 * pointer handlers). Syncs car.group's transform to match.
 */
export function updateCar(car, dt, { braking } = {}) {
  if (braking) {
    car.speed -= BRAKE_DECEL * dt;
  } else {
    car.speed += FORWARD_ACCEL * dt;
  }
  car.speed = clamp(car.speed, MIN_SPEED, MAX_SPEED);

  car.x += (car.targetX - car.x) * Math.min(1, LATERAL_EASE_RATE * dt);

  car.distanceTraveled += car.speed * dt;

  // z/y are fixed by convention — keep the group in sync regardless.
  car.group.position.set(car.x, car.y, car.z);
}

/**
 * Damped 3rd-person chase camera. car.z/car.y are fixed by convention, so
 * only X needs damping; Y/Z are just set directly each frame.
 */
export function updateCamera(camera, car, dt) {
  const desiredX = car.x * CAM_X_FOLLOW;
  camera.position.x += (desiredX - camera.position.x) * Math.min(1, CAM_POS_DAMPING * dt);
  camera.position.y = car.y + CAM_HEIGHT;
  camera.position.z = CAM_BASE_Z;
  camera.lookAt(camera.position.x * 0.5, car.y + 1, -LOOKAHEAD);
}
