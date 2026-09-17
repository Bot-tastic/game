// car.js — the player vehicle: arcade handling with lateral momentum and
// drift, a boost and a brake, ramp launches with real air time, visible
// damage, and the chase camera that sells all of it.
//
// The car stays pinned at world Z = 0; only X (lateral) and Y (air) move.

import * as THREE from "three";
import { DRIVE_LIMIT, ROAD_HALF } from "./world.js";
import { createGlowTexture } from "./textures.js";

export const MIN_SPEED = 14;
export const CRUISE_SPEED = 46;
export const MAX_SPEED = 86;
export const BOOST_SPEED = 78;

const ACCEL = 13;
const BRAKE = 42;
const DRAG_OFFROAD = 9;

const TURN_ACCEL = 46; // lateral accel from full steering lock
const GRIP = 7.2; // how fast lateral velocity is scrubbed off
const DRIFT_GRIP = 2.3; // …once the tyres let go
const DRIFT_THRESHOLD = 9.5;

const GRAVITY = -40;
const CAR_HALF_WIDTH = 0.95;
const CAR_HALF_DEPTH = 2.05;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const damp = (cur, target, rate, dt) => cur + (target - cur) * Math.min(1, rate * dt);

function buildCar(scene) {
  const group = new THREE.Group();
  const shell = new THREE.Group();
  group.add(shell);

  const bodyMat = new THREE.MeshPhongMaterial({ color: 0xff3355, shininess: 60, specular: 0x88445a, flatShading: true });
  const trimMat = new THREE.MeshPhongMaterial({ color: 0x1b1f2b, shininess: 30, flatShading: true });
  const glassMat = new THREE.MeshPhongMaterial({ color: 0x0e1726, shininess: 120, specular: 0x88aaff, flatShading: true });
  const rubberMat = new THREE.MeshLambertMaterial({ color: 0x121419, flatShading: true });
  const rimMat = new THREE.MeshPhongMaterial({ color: 0xd8dde8, shininess: 90, flatShading: true });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, mat);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    shell.add(m);
    return m;
  };

  // chunky low-poly muscle silhouette
  add(new THREE.BoxGeometry(1.9, 0.5, 4.1), bodyMat, 0, 0.62, 0);
  add(new THREE.BoxGeometry(1.75, 0.34, 1.7), bodyMat, 0, 0.98, 1.05); // hood
  add(new THREE.BoxGeometry(1.7, 0.5, 1.5), bodyMat, 0, 1.12, -0.7); // rear deck
  const cabin = add(new THREE.BoxGeometry(1.55, 0.62, 1.7), glassMat, 0, 1.32, -0.05);
  add(new THREE.BoxGeometry(1.62, 0.16, 1.75), bodyMat, 0, 1.64, -0.05); // roof
  add(new THREE.BoxGeometry(1.3, 0.12, 0.42), trimMat, 0, 1.5, -1.62, -0.25); // spoiler blade
  add(new THREE.BoxGeometry(0.12, 0.26, 0.12), trimMat, -0.5, 1.36, -1.55);
  add(new THREE.BoxGeometry(0.12, 0.26, 0.12), trimMat, 0.5, 1.36, -1.55);
  add(new THREE.BoxGeometry(2.0, 0.22, 0.4), trimMat, 0, 0.5, 2.03); // bumper
  add(new THREE.BoxGeometry(2.0, 0.22, 0.34), trimMat, 0, 0.5, -2.03);
  add(new THREE.BoxGeometry(0.34, 0.3, 2.6), trimMat, -0.98, 0.5, 0); // side skirts
  add(new THREE.BoxGeometry(0.34, 0.3, 2.6), trimMat, 0.98, 0.5, 0);
  add(new THREE.BoxGeometry(0.5, 0.2, 0.7), trimMat, 0, 1.2, 1.3); // scoop

  // headlights + brake lights (unlit materials so they read as light sources)
  const headMat = new THREE.MeshBasicMaterial({ color: 0xfff0cc, toneMapped: false });
  const brakeMat = new THREE.MeshBasicMaterial({ color: 0x5a1220, toneMapped: false });
  add(new THREE.BoxGeometry(0.5, 0.18, 0.1), headMat, -0.62, 0.86, 2.06);
  add(new THREE.BoxGeometry(0.5, 0.18, 0.1), headMat, 0.62, 0.86, 2.06);
  const brakeL = add(new THREE.BoxGeometry(0.55, 0.16, 0.1), brakeMat, -0.58, 0.95, -2.06);
  const brakeR = add(new THREE.BoxGeometry(0.55, 0.16, 0.1), brakeMat, 0.58, 0.95, -2.06);

  // wheels: front pair steers, all four compress on landing
  const wheelGeo = new THREE.CylinderGeometry(0.42, 0.42, 0.34, 10);
  wheelGeo.rotateZ(Math.PI / 2);
  const rimGeo = new THREE.BoxGeometry(0.36, 0.36, 0.36);
  const wheels = [];
  for (const [x, z, steers] of [
    [-0.95, 1.35, true],
    [0.95, 1.35, true],
    [-0.95, -1.35, false],
    [0.95, -1.35, false],
  ]) {
    const hub = new THREE.Group();
    hub.position.set(x, 0.42, z);
    const tyre = new THREE.Mesh(wheelGeo, rubberMat);
    const rim = new THREE.Mesh(rimGeo, rimMat);
    rim.position.x = x < 0 ? -0.06 : 0.06;
    hub.add(tyre, rim);
    shell.add(hub);
    wheels.push({ hub, tyre, rim, steers, baseY: 0.42 });
  }

  // The headlights throw a pool of light on the tarmac instead of a visible
  // cone — volumetric cones read as a ghost artifact from this camera angle.
  const glowTex = createGlowTexture();
  const beamMat = new THREE.MeshBasicMaterial({ visible: false });

  const poolGeo = new THREE.PlaneGeometry(17, 38);
  poolGeo.rotateX(-Math.PI / 2);
  const roadPool = new THREE.Mesh(
    poolGeo,
    new THREE.MeshBasicMaterial({
      map: glowTex,
      color: 0xffdcae,
      transparent: true,
      opacity: 0.2,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    })
  );
  roadPool.position.set(0, 0.05, 13);
  roadPool.renderOrder = 3;
  group.add(roadPool);

  // damage layer: scorched panels that fade in as the meter fills
  const scorchMat = new THREE.MeshBasicMaterial({ color: 0x14161c, transparent: true, opacity: 0 });
  const scorch = [];
  for (const [x, y, z, w, h, dd] of [
    [0.55, 1.0, 1.1, 0.9, 0.2, 1.0],
    [-0.7, 0.7, -0.6, 0.6, 0.5, 1.4],
    [0, 1.66, -0.2, 1.2, 0.1, 1.2],
  ]) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, dd), scorchMat.clone());
    m.position.set(x, y, z);
    shell.add(m);
    scorch.push(m);
  }

  const headLight = new THREE.PointLight(0xffd7a8, 2.6, 52, 1.8);
  headLight.position.set(0, 1.6, 6);
  group.add(headLight);

  scene.add(group);
  return { group, shell, wheels, bodyMat, brakeL, brakeR, roadPool, beamMat, scorch, cabin, headLight };
}

export function createCar(scene) {
  const v = buildCar(scene);
  const car = {
    ...v,
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: MIN_SPEED,
    yaw: 0,
    roll: 0,
    pitch: 0,
    wheelSpin: 0,
    steerInput: 0,
    steerVisual: 0,
    braking: false,
    boosting: false,
    boostFuel: 1,
    airborne: false,
    airTime: 0,
    lastAirTime: 0,
    landed: false,
    onRamp: null,
    drift: 0,
    distance: 0,
    suspension: 0,
    damage: 0,
    halfWidth: CAR_HALF_WIDTH,
    halfDepth: CAR_HALF_DEPTH,
    offRoad: false,
    shake: 0,
    baseColor: new THREE.Color(0xff3355),
  };
  resetCar(car);
  return car;
}

export function resetCar(car) {
  car.x = 0;
  car.y = 0;
  car.vx = 0;
  car.vy = 0;
  car.speed = MIN_SPEED;
  car.yaw = 0;
  car.roll = 0;
  car.pitch = 0;
  car.steerInput = 0;
  car.steerVisual = 0;
  car.boosting = false;
  car.boostFuel = 1;
  car.airborne = false;
  car.airTime = 0;
  car.lastAirTime = 0;
  car.landed = false;
  car.onRamp = null;
  car.drift = 0;
  car.distance = 0;
  car.suspension = 0;
  car.damage = 0;
  car.shake = 0;
  car.group.position.set(0, 0, 0);
  car.group.rotation.set(0, 0, 0);
  setDamageVisual(car, 0);
}

/** Paint the damage meter onto the car: soot, then a darkened shell. */
export function setDamageVisual(car, damage) {
  car.damage = damage;
  const t = clamp(damage / 100, 0, 1);
  car.bodyMat.color.copy(car.baseColor).lerp(new THREE.Color(0x33242a), t * 0.8);
  car.bodyMat.shininess = 60 * (1 - t * 0.8);
  for (let i = 0; i < car.scorch.length; i++) {
    car.scorch[i].material.opacity = clamp((t - i * 0.22) * 2.2, 0, 0.92);
  }
}

/**
 * Advance the car. `input` = { steer: -1..1, braking, boosting }.
 * `ramps` is world.ramps; the car rides any ramp it overlaps and launches
 * off the lip with whatever vertical speed the slope gives it.
 */
export function updateCar(car, dt, input, ramps) {
  car.steerInput = clamp(input.steer || 0, -1, 1);
  car.braking = !!input.braking;
  const wantBoost = !!input.boosting && car.boostFuel > 0.02 && !car.braking;
  car.boosting = wantBoost;

  // ---- boost fuel: spends fast, trickles back
  car.boostFuel = clamp(car.boostFuel + (wantBoost ? -0.42 : 0.135) * dt, 0, 1);

  // ---- longitudinal
  const target = car.braking ? MIN_SPEED : wantBoost ? BOOST_SPEED : CRUISE_SPEED;
  if (car.braking) car.speed -= BRAKE * dt;
  else if (car.speed < target) car.speed += ACCEL * (wantBoost ? 2.6 : 1) * dt;
  else car.speed -= ACCEL * 0.5 * dt;

  car.offRoad = Math.abs(car.x) > ROAD_HALF - 0.4;
  if (car.offRoad && !car.airborne) car.speed -= DRAG_OFFROAD * dt;
  car.speed = clamp(car.speed, MIN_SPEED, MAX_SPEED);

  // ---- lateral: accelerate sideways, then let grip scrub it off
  const speedFactor = clamp(car.speed / CRUISE_SPEED, 0.35, 1.35);
  const airFactor = car.airborne ? 0.3 : 1;
  car.vx += car.steerInput * TURN_ACCEL * speedFactor * airFactor * dt;

  const sliding = Math.abs(car.vx) > DRIFT_THRESHOLD;
  const grip = (sliding ? DRIFT_GRIP : GRIP) * (car.offRoad ? 0.65 : 1) * (car.braking ? 1.6 : 1);
  car.vx -= car.vx * Math.min(1, grip * dt);
  car.vx = clamp(car.vx, -34, 34);

  car.x += car.vx * dt;
  if (car.x > DRIVE_LIMIT) {
    car.x = DRIVE_LIMIT;
    car.vx = Math.min(0, car.vx) * 0.4;
  } else if (car.x < -DRIVE_LIMIT) {
    car.x = -DRIVE_LIMIT;
    car.vx = Math.max(0, car.vx) * 0.4;
  }

  car.drift = damp(car.drift, clamp((Math.abs(car.vx) - DRIFT_THRESHOLD * 0.55) / 16, 0, 1), 8, dt);

  // ---- ramps & air
  car.landed = false;
  let ramp = null;
  for (const r of ramps) {
    if (Math.abs(r.z) < r.halfDepth && Math.abs(car.x - r.x) < r.halfWidth + 0.7) {
      ramp = r;
      break;
    }
  }

  if (ramp && !car.airborne) {
    car.onRamp = ramp;
    car.y = (ramp.height * (ramp.halfDepth - ramp.z)) / (2 * ramp.halfDepth);
    car.vy = (ramp.height / (2 * ramp.halfDepth)) * car.speed * 2.4;
    car.pitch = damp(car.pitch, -0.2, 8, dt);
  } else {
    if (car.onRamp && !ramp) {
      // just cleared the lip — commit the launch
      car.airborne = true;
      car.airTime = 0;
      car.onRamp = null;
    }
    if (car.airborne || car.y > 0.01) {
      car.airborne = true;
      car.airTime += dt;
      car.vy += GRAVITY * dt;
      car.y += car.vy * dt;
      car.pitch = damp(car.pitch, clamp(-car.vy * 0.014, -0.34, 0.3), 3.5, dt);
      if (car.y <= 0) {
        car.y = 0;
        car.landed = true;
        car.lastAirTime = car.airTime;
        car.suspension = clamp(-car.vy / 26, 0.25, 1);
        car.shake = Math.max(car.shake, car.suspension * 0.9);
        car.vy = 0;
        car.airborne = false;
        car.airTime = 0;
      }
    } else {
      car.y = 0;
      car.vy = 0;
      car.airborne = false;
      car.onRamp = null;
    }
  }

  car.distance += car.speed * dt;

  // ---- pose: steer into the slide, lean into the turn, squat under power
  car.steerVisual = damp(car.steerVisual, car.steerInput, 12, dt);
  const yawTarget = clamp(-car.vx * 0.022 - car.steerVisual * 0.06, -0.62, 0.62);
  car.yaw = damp(car.yaw, yawTarget, 9, dt);
  const rollTarget = clamp(car.vx * 0.011 + car.steerVisual * 0.035, -0.22, 0.22);
  car.roll = damp(car.roll, rollTarget, 8, dt);
  if (!car.airborne) {
    const pitchTarget = car.braking ? 0.06 : car.boosting ? -0.05 : -0.015;
    car.pitch = damp(car.pitch, pitchTarget, 6, dt);
  }
  car.suspension = damp(car.suspension, 0, 7, dt);
  car.shake = Math.max(0, car.shake - dt * 2.2);

  // ---- mesh sync
  car.group.position.set(car.x, car.y, 0);
  car.group.rotation.set(car.pitch, car.yaw, car.roll);
  car.shell.position.y = -car.suspension * 0.24;
  car.shell.scale.set(1 + car.suspension * 0.08, 1 - car.suspension * 0.16, 1 + car.suspension * 0.06);

  car.wheelSpin += car.speed * dt * 2.4;
  for (const w of car.wheels) {
    w.hub.rotation.x = car.wheelSpin;
    if (w.steers) w.hub.rotation.y = car.steerVisual * 0.42 - car.vx * 0.012;
    w.hub.position.y = w.baseY - car.suspension * 0.2 * (car.airborne ? -0.5 : 1);
  }

  const braking = car.braking || car.speed < CRUISE_SPEED * 0.55;
  car.brakeL.material.color.setHex(braking ? 0xff2f4a : 0x5a1220);
  car.brakeR.material.color.setHex(braking ? 0xff2f4a : 0x5a1220);
  car.roadPool.position.z = 13 + car.speed * 0.08;
  car.roadPool.visible = !car.airborne;
}

// --------------------------------------------------------------- camera
const CAM_HEIGHT = 4.0;
const CAM_BACK = 9.5;

/** Chase cam: lags behind, pulls back and widens with speed, shakes on hits. */
export function updateCamera(camera, car, dt, opts = {}) {
  const { reducedMotion = false, extraShake = 0, zoomPunch = 0 } = opts;
  const speedNorm = clamp((car.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1);

  const desiredX = car.x * 0.72 + car.vx * 0.06;
  const desiredY = CAM_HEIGHT + car.y * 0.75 + speedNorm * 0.7;
  const desiredZ = -CAM_BACK - speedNorm * 3.2 - car.drift * 1.2 + zoomPunch * 2.6;

  camera.position.x = damp(camera.position.x, desiredX, 5.5, dt);
  camera.position.y = damp(camera.position.y, desiredY, 6.5, dt);
  camera.position.z = damp(camera.position.z, desiredZ, 7, dt);

  const shake = reducedMotion ? 0 : (car.shake + extraShake) * 0.55;
  if (shake > 0.001) {
    const t = performance.now() * 0.06;
    camera.position.x += Math.sin(t * 1.7) * shake * 0.6;
    camera.position.y += Math.sin(t * 2.3) * shake * 0.45;
  }

  const fov = 62 + speedNorm * 16 + (car.boosting ? 6 : 0) - zoomPunch * 12;
  if (Math.abs(camera.fov - fov) > 0.05) {
    camera.fov = damp(camera.fov, fov, 5, dt);
    camera.updateProjectionMatrix();
  }

  const lookX = car.x * 0.55 + car.vx * 0.09;
  camera.lookAt(lookX, car.y * 0.6 + 1.5, 16 + speedNorm * 6);
  if (!reducedMotion) camera.rotation.z += car.roll * 0.25 + car.vx * 0.002;
}

export function speedNorm(car) {
  return clamp((car.speed - MIN_SPEED) / (MAX_SPEED - MIN_SPEED), 0, 1);
}
