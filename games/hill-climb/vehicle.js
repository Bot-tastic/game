// vehicle.js — the buggy: a rigid chassis on two sprung, slip-modelled wheels.
//
// Units are metres, kilograms and seconds, y-up. The solver runs a fixed
// number of substeps per frame so a stiff spring never blows up on a long
// frame, and every force is clamped: an arcade car that flips is fun, an
// arcade car that teleports is a bug.
//
// Forces, in the order they are applied each substep:
//   1. gravity + aero drag on the chassis
//   2. suspension spring/damper along the chassis' up axis (wheel <-> chassis)
//   3. a positional constraint keeping each wheel on that axis
//   4. ground contact: penetration push-out, normal restitution, tyre slip
//   5. driver torque — engine/brake on the wheels, air control on the chassis

const SUB = 6; // physics substeps per frame

export const CHASSIS = { w: 2.0, h: 0.62, mass: 260 };
export const WHEEL = { r: 0.42, mass: 32 };
const WHEEL_I = 0.5 * WHEEL.mass * WHEEL.r * WHEEL.r;
const INERTIA = (CHASSIS.mass * (CHASSIS.w * CHASSIS.w + 1.1 * 1.1)) / 12;

// Suspension anchors in chassis-local space (x forward, y up).
const ANCHOR = [
  { x: -0.78, y: -0.1 }, // rear
  { x: 0.82, y: -0.1 }, // front
];
const REST = 0.52;
const MIN_LEN = 0.2;

// The driver's head: hitting the ground with it ends the run.
export const HEAD = { x: -0.02, y: 0.72, r: 0.2 };

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export function createVehicle(terrain, tune, x = 6) {
  const y = terrain.groundY(x) + REST + WHEEL.r + 0.02;
  const car = {
    x,
    y,
    vx: 0,
    vy: 0,
    angle: 0,
    av: 0,
    tune,
    grounded: false,
    airTime: 0,
    flipTurns: 0, // signed turns completed while airborne
    wheels: ANCHOR.map((a) => ({
      x: x + a.x,
      y: terrain.groundY(x + a.x) + WHEEL.r,
      vx: 0,
      vy: 0,
      spin: 0,
      rot: 0,
      onGround: false,
      load: 0,
      slip: 0,
      comp: 0,
      nx: 0,
      ny: 1,
    })),
    crashed: false,
    crashReason: "",
    // Read by the renderer/audio each frame.
    engineRpm: 0,
    speed: 0,
  };
  return car;
}

/** World-space suspension anchor for wheel i. */
function anchorOf(car, i) {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  const a = ANCHOR[i];
  return { x: car.x + a.x * c - a.y * s, y: car.y + a.x * s + a.y * c };
}

function pointOf(car, lx, ly) {
  const c = Math.cos(car.angle);
  const s = Math.sin(car.angle);
  return { x: car.x + lx * c - ly * s, y: car.y + lx * s + ly * c };
}

export const headPoint = (car) => pointOf(car, HEAD.x, HEAD.y);

/** Apply an impulse-like force at a world point: linear plus the torque it makes. */
function applyImpulse(car, jx, jy, px, py) {
  car.vx += jx / CHASSIS.mass;
  car.vy += jy / CHASSIS.mass;
  const rx = px - car.x;
  const ry = py - car.y;
  car.av += (rx * jy - ry * jx) / INERTIA;
}

function applyForce(car, fx, fy, px, py, dt) {
  applyImpulse(car, fx * dt, fy * dt, px, py);
}

/**
 * Closest point on the terrain polyline to (px, py), searched over the few
 * segments that can possibly be within `r`. Returns the contact normal and
 * penetration depth, or null when the circle is clear of the ground.
 */
function groundContact(terrain, px, py, r) {
  const step = terrain.STEP;
  const i0 = Math.floor((px - r) / step);
  const i1 = Math.floor((px + r) / step) + 1;
  let best = null;
  for (let i = i0; i <= i1; i++) {
    const ax = i * step;
    const ay = terrain.sample(i);
    const bx = (i + 1) * step;
    const by = terrain.sample(i + 1);
    const dx = bx - ax;
    const dy = by - ay;
    const t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy), 0, 1);
    const cx = ax + dx * t;
    const cy = ay + dy * t;
    let ox = px - cx;
    let oy = py - cy;
    let d = Math.hypot(ox, oy);
    if (d > r) continue;
    if (d < 1e-6) {
      // Dead centre on the segment: fall back to the segment's own normal.
      const len = Math.hypot(dx, dy);
      ox = -dy / len;
      oy = dx / len;
      d = 1e-6;
    } else {
      ox /= d;
      oy /= d;
    }
    if (oy < 0 && py > cy) {
      ox = -ox;
      oy = -oy;
    }
    const depth = r - d;
    if (!best || depth > best.depth) best = { nx: ox, ny: oy, depth, cx, cy };
  }
  return best;
}

/**
 * Advance one frame. `input` is { throttle: -1..1, brake: bool } where a
 * positive throttle drives forward and a negative one reverses; in the air the
 * same axis pitches the chassis, exactly as the genre expects.
 */
export function stepVehicle(car, terrain, stage, input, dt) {
  const h = dt / SUB;
  const tune = car.tune;
  const grip = stage.grip * tune.tires;
  const gravity = stage.gravity;

  for (let s = 0; s < SUB; s++) {
    // --- 1. gravity + drag -------------------------------------------------
    car.vy -= gravity * h;
    const sp = Math.hypot(car.vx, car.vy);
    if (sp > 0.01) {
      // Quadratic: stage.drag is the deceleration in m/s^2 at 1 m/s, so the
      // whole term is drag * v^2. Keep it small — this force acts in the air
      // too, and a heavy one turns every jump into a belly flop.
      const dec = stage.drag * sp * h;
      car.vx -= car.vx * dec;
      car.vy -= car.vy * dec;
    }
    // Barely any angular damping: the chassis is supposed to keep rotating
    // once a kicker has thrown it, which is what makes flips (and landing on
    // your head) possible.
    car.av *= 1 - 0.12 * h;

    const cosA = Math.cos(car.angle);
    const sinA = Math.sin(car.angle);
    const upx = -sinA;
    const upy = cosA;

    let anyGround = false;

    for (let i = 0; i < 2; i++) {
      const w = car.wheels[i];
      w.vy -= gravity * h;

      const an = anchorOf(car, i);
      // Chassis velocity at the anchor (rigid body: v + ω × r).
      const rx = an.x - car.x;
      const ry = an.y - car.y;
      const avx = car.vx - car.av * ry;
      const avy = car.vy + car.av * rx;

      // --- 2. suspension ---------------------------------------------------
      const dx = w.x - an.x;
      const dy = w.y - an.y;
      let along = -(dx * upx + dy * upy); // extension downward, metres
      const travel = REST * tune.suspension;
      const relV = -((w.vx - avx) * upx + (w.vy - avy) * upy);
      const comp = travel - along;
      const k = 26000 / tune.suspension;
      const c = 1150 * Math.sqrt(tune.suspension);
      let force = k * comp - c * relV;
      force = clamp(force, -9000, 26000);
      w.comp = clamp(comp / travel, -0.6, 1);
      // Push the wheel down the axis, the chassis up it.
      w.vx += (-upx * force * h) / WHEEL.mass;
      w.vy += (-upy * force * h) / WHEEL.mass;
      applyForce(car, upx * force, upy * force, an.x, an.y, h);

      // --- 3. keep the wheel on the suspension axis ------------------------
      // This is the constraint that makes the car a car: the wheel may only
      // travel along the chassis' up axis, so everything it picks up from the
      // ground along the forward axis is handed to the chassis as an impulse
      // (mass-weighted, including the torque about the centre of mass) rather
      // than quietly discarded.
      const lat = dx * cosA + dy * sinA;
      if (Math.abs(lat) > 1e-5) {
        w.x -= cosA * lat;
        w.y -= sinA * lat;
      }
      const latV = (w.vx - avx) * cosA + (w.vy - avy) * sinA;
      if (latV !== 0) {
        const cross = rx * sinA - ry * cosA;
        const kMass = 1 / WHEEL.mass + 1 / CHASSIS.mass + (cross * cross) / INERTIA;
        const j = -latV / kMass;
        w.vx += (cosA * j) / WHEEL.mass;
        w.vy += (sinA * j) / WHEEL.mass;
        applyImpulse(car, -cosA * j, -sinA * j, an.x, an.y);
      }
      // Hard travel limits so nothing ever passes through the chassis.
      along = -((w.x - an.x) * upx + (w.y - an.y) * upy);
      const maxLen = travel + 0.22;
      if (along < MIN_LEN || along > maxLen) {
        const want = clamp(along, MIN_LEN, maxLen);
        w.x -= upx * (want - along);
        w.y -= upy * (want - along);
      }

      w.x += w.vx * h;
      w.y += w.vy * h;

      // --- 4. ground contact ------------------------------------------------
      const hit = groundContact(terrain, w.x, w.y, WHEEL.r);
      w.onGround = !!hit;
      if (hit) {
        anyGround = true;
        w.nx = hit.nx;
        w.ny = hit.ny;
        w.x += hit.nx * hit.depth;
        w.y += hit.ny * hit.depth;
        const vn = w.vx * hit.nx + w.vy * hit.ny;
        if (vn < 0) {
          const j = -(1 + 0.12) * vn;
          w.vx += hit.nx * j;
          w.vy += hit.ny * j;
        }
        // Normal load drives the friction limit; suspension force is the
        // honest source for it, floored so a fully extended wheel still bites.
        w.load = clamp(force, 600, 20000);
        const tx = hit.ny;
        const ty = -hit.nx;
        const vt = w.vx * tx + w.vy * ty;
        const slip = w.spin * WHEEL.r - vt;
        const maxF = grip * w.load * 1.05;
        const ft = clamp(slip * 900, -maxF, maxF);
        w.slip = clamp(slip / 6, -1, 1);
        w.vx += (tx * ft * h) / WHEEL.mass;
        w.vy += (ty * ft * h) / WHEEL.mass;
        w.spin -= (ft * WHEEL.r * h) / WHEEL_I;
      } else {
        w.load = 0;
        w.slip = 0;
        w.spin *= 1 - 0.7 * h;
      }

      // --- 5. driver ---------------------------------------------------------
      const share = i === 0 ? 1 - tune.awd * 0.5 : tune.awd;
      let torque = 0;
      if (input.throttle !== 0 && share > 0) {
        const power = 2400 * tune.engine * share;
        // Torque falls off as the wheel spins up: a crude but effective
        // stand-in for a power curve, and it caps top speed.
        const fade = 1 / (1 + Math.abs(w.spin) / 38);
        torque = input.throttle * power * fade;
      }
      if (input.brake) torque -= clamp(w.spin, -1, 1) * 2600;
      torque -= w.spin * 11; // rolling resistance + driveline drag
      w.spin += (torque * h) / WHEEL_I;
      w.spin = clamp(w.spin, -180, 180);
      w.rot += w.spin * h;

      // Engine torque reacts into the chassis: gas lifts the nose, and on a
      // steep climb it will happily loop the car over backwards. Scaled with
      // gravity, or a low-gravity stage would backflip off its own start line.
      if (w.onGround && torque !== 0) {
        car.av += -torque * 0.00035 * clamp(gravity / 15, 0.22, 1) * h;
      }
    }

    // Air control: the throttle axis pitches the car.
    if (!anyGround) {
      car.av += input.throttle * 6.2 * h;
      if (input.brake) car.av -= 4.4 * h;
    }
    car.av = clamp(car.av, -13, 13);

    car.x += car.vx * h;
    car.y += car.vy * h;
    car.angle += car.av * h;
    car.grounded = anyGround;
  }

  car.speed = Math.hypot(car.vx, car.vy);
  car.engineRpm = Math.max(Math.abs(car.wheels[0].spin), Math.abs(car.wheels[1].spin));
  if (car.grounded) {
    if (car.airTime > 0.35) car.landed = car.airTime;
    car.airTime = 0;
    car.flipTurns = 0;
    car.flipStart = car.angle;
  } else {
    car.airTime += dt;
    if (car.flipStart == null) car.flipStart = car.angle;
    car.flipTurns = (car.angle - car.flipStart) / (Math.PI * 2);
  }

  // Head strike ends the run.
  const head = headPoint(car);
  if (!car.crashed && groundContact(terrain, head.x, head.y, HEAD.r)) {
    car.crashed = true;
    car.crashReason = "neck";
  }
  return car;
}

export { pointOf, anchorOf, groundContact, REST };
