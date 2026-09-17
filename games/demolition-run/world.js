// world.js — the neon-dusk city: gradient sky, parallax skyline, scrolling
// street segments, wet-road light pools, ramps and the prop spawn tables.
//
// Convention (unchanged from before): the car is pinned at world Z = 0 and
// the world scrolls toward -Z. Segments recycle off the back and re-roll.

import * as THREE from "three";
import { createRoadTexture, createSidewalkTexture, createFacadeTextures, createGlowTexture } from "./textures.js";
import { createPropsPool, spawnProp, despawnProp, updatePropTransform } from "./props.js";

export const SEGMENT_LENGTH = 40;
export const ROAD_HALF = 7; // drivable asphalt half-width
export const SIDEWALK_OUTER = 12; // buildings start here
export const DRIVE_LIMIT = 10.6; // how far onto the pavement you can get
export const DRAW_DISTANCE = 340;

const SEGMENT_COUNT = Math.ceil(DRAW_DISTANCE / SEGMENT_LENGTH) + 2;
const RECYCLE_Z = -60;

const BUILDINGS_PER_SEGMENT = 6;
const LIGHTPOOLS_PER_SEGMENT = 8;

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const FAR = new THREE.Matrix4().makeTranslation(0, -900, 0);

function mulberry32(seed) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ------------------------------------------------------------------- sky
function createSky(scene) {
  const geo = new THREE.SphereGeometry(600, 24, 16);
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: {
      uTop: { value: new THREE.Color(0x140b30) },
      uMid: { value: new THREE.Color(0x1d0c36) },
      uHorizon: { value: new THREE.Color(0x58203f) },
      uGlow: { value: new THREE.Color(0xff9a5c) },
    },
    vertexShader: `
      varying vec3 vPos;
      void main() {
        vPos = position;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      varying vec3 vPos;
      uniform vec3 uTop, uMid, uHorizon, uGlow;
      void main() {
        vec3 d = normalize(vPos);
        float h = clamp(d.y * 1.15 + 0.08, -1.0, 1.0);
        vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.34, h));
        col = mix(col, uTop, smoothstep(0.38, 1.05, h));
        // sun bloom sitting low, straight down the road
        float sun = pow(max(0.0, dot(d, normalize(vec3(0.06, 0.05, 1.0)))), 90.0);
        float haze = pow(max(0.0, dot(d, normalize(vec3(0.06, 0.02, 1.0)))), 16.0);
        // keep the glow pinned to the horizon so it never bleaches the sky
        float low = smoothstep(0.42, -0.05, h);
        col += uGlow * (sun * 1.8 + haze * 0.75) * low;
        col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, h));
        // faint star field up high
        float st = step(0.9986, fract(sin(dot(floor(d.xy * 300.0), vec2(12.9898, 78.233))) * 43758.5453));
        col += vec3(st) * smoothstep(0.18, 0.7, h) * 1.35;
        gl_FragColor = vec4(col, 1.0);
      }`,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -10;
  scene.add(mesh);
  return mesh;
}

// -------------------------------------------------------------- skyline
// Three merged silhouette bands sitting well beyond the fog, each with a
// baked vertical gradient so the horizon reads as depth, not a flat cut-out.
function createSkyline(scene) {
  const group = new THREE.Group();
  const bands = [];
  const SPAN = 2400;

  for (const [z, height, baseHex, topHex, count] of [
    [900, 210, 0x160d2a, 0x3d2560, 40],
    [680, 150, 0x110a20, 0x2c1a48, 44],
    [470, 100, 0x0c0718, 0x1d1132, 48],
  ]) {
    const base = new THREE.Color(baseHex);
    const top = new THREE.Color(topHex);
    const positions = [];
    const colors = [];

    for (let i = 0; i < count; i++) {
      const w = 48 + Math.random() * 120;
      const h = height * (0.3 + Math.random() * 0.85);
      const g = new THREE.BoxGeometry(w, h, 24);
      g.translate(-SPAN / 2 + (i / count) * SPAN + Math.random() * 40, h / 2, 0);
      const pos = g.attributes.position.array;
      const idx = g.index.array;
      for (let k = 0; k < idx.length; k++) {
        const j = idx[k] * 3;
        positions.push(pos[j], pos[j + 1], pos[j + 2]);
        const t = Math.min(1, pos[j + 1] / (height * 1.0));
        colors.push(
          base.r + (top.r - base.r) * t,
          base.g + (top.g - base.g) * t,
          base.b + (top.b - base.b) * t
        );
      }
      g.dispose();
    }

    const bg = new THREE.BufferGeometry();
    bg.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    bg.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
    const band = new THREE.Mesh(bg, mat);
    band.frustumCulled = false;
    band.position.set(0, -4, z);
    band.userData = { z, offset: 0, rate: 900 / z };
    group.add(band);
    bands.push(band);
  }

  // Low, hazy moon hanging over the far blocks.
  const moon = new THREE.Mesh(
    new THREE.CircleGeometry(30, 32),
    new THREE.MeshBasicMaterial({ color: 0xffd9a8, fog: false, toneMapped: false })
  );
  moon.position.set(-210, 150, 980);
  moon.frustumCulled = false;
  group.add(moon);

  // Far ground: a fog-coloured slab so the sky never leaks in below the
  // horizon where the street segments run out.
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(4000, 2600),
    new THREE.MeshBasicMaterial({ color: 0x1d1130, fog: false })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.set(0, -1.2, 700);
  ground.frustumCulled = false;
  group.add(ground);

  scene.add(group);
  return { group, bands, moon, ground };
}

// -------------------------------------------------------------- segments
function createSegmentMaterials() {
  const roadTex = createRoadTexture(ROAD_HALF, SEGMENT_LENGTH);
  const walkTex = createSidewalkTexture();
  const facade = createFacadeTextures();

  return {
    road: new THREE.MeshPhongMaterial({
      map: roadTex,
      shininess: 48,
      specular: 0x5a6a95,
      emissive: 0x150e24,
    }),
    walk: new THREE.MeshLambertMaterial({ map: walkTex }),
    kerb: new THREE.MeshLambertMaterial({ color: 0x45485a }),
    building: new THREE.MeshLambertMaterial({
      map: facade.map,
      emissive: 0xffffff,
      emissiveMap: facade.emissiveMap,
      emissiveIntensity: 2.1,
    }),
  };
}

export function createWorld(scene) {
  const mats = createSegmentMaterials();
  const sky = createSky(scene);
  const skyline = createSkyline(scene);
  const pool = createPropsPool(scene);
  const glowTex = createGlowTexture();

  // Buildings + light pools + ramps live in global instanced pools indexed
  // by segment slot, so the whole city is a handful of draw calls.
  const buildingMesh = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1, 1, 1),
    mats.building,
    SEGMENT_COUNT * BUILDINGS_PER_SEGMENT
  );
  buildingMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  buildingMesh.frustumCulled = false;
  scene.add(buildingMesh);

  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const lightPoolMesh = new THREE.InstancedMesh(
    poolGeo,
    new THREE.MeshBasicMaterial({
      map: glowTex,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      fog: true,
      toneMapped: false,
    }),
    SEGMENT_COUNT * LIGHTPOOLS_PER_SEGMENT
  );
  lightPoolMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  lightPoolMesh.frustumCulled = false;
  lightPoolMesh.renderOrder = 2;
  scene.add(lightPoolMesh);

  // Ramp: a wedge you can launch off.
  const rampShape = new THREE.BufferGeometry();
  {
    const w = 3.0, l = 6.0, h = 1.5;
    const v = [
      -w, 0, -l, w, 0, -l, w, h, l, -w, h, l, // deck
      -w, 0, -l, -w, h, l, -w, 0, l,
      w, 0, -l, w, 0, l, w, h, l,
      -w, 0, l, w, h, l, w, 0, l,
    ];
    const pos = [];
    const quad = (a, b, c, d) => pos.push(...a, ...b, ...c, ...a, ...c, ...d);
    const P = (i) => [v[i * 3], v[i * 3 + 1], v[i * 3 + 2]];
    quad(P(0), P(1), P(2), P(3));
    pos.push(...P(4), ...P(5), ...P(6));
    pos.push(...P(7), ...P(8), ...P(9));
    pos.push(...P(10), ...P(11), ...P(12));
    rampShape.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    rampShape.computeVertexNormals();
  }
  const rampMesh = new THREE.InstancedMesh(
    rampShape,
    new THREE.MeshLambertMaterial({ color: 0xffb020, flatShading: true }),
    SEGMENT_COUNT
  );
  rampMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  rampMesh.frustumCulled = false;
  scene.add(rampMesh);

  // Per-slot static street geometry.
  const segments = [];
  for (let i = 0; i < SEGMENT_COUNT; i++) {
    const group = new THREE.Group();

    const road = new THREE.Mesh(new THREE.BoxGeometry(ROAD_HALF * 2, 0.2, SEGMENT_LENGTH), mats.road);
    road.position.y = -0.1;
    group.add(road);

    const walkW = SIDEWALK_OUTER - ROAD_HALF;
    for (const side of [-1, 1]) {
      const walk = new THREE.Mesh(new THREE.BoxGeometry(walkW, 0.22, SEGMENT_LENGTH), mats.walk);
      walk.position.set(side * (ROAD_HALF + walkW / 2), 0.11, 0);
      group.add(walk);
      const kerb = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.3, SEGMENT_LENGTH), mats.kerb);
      kerb.position.set(side * (ROAD_HALF + 0.17), 0.15, 0);
      group.add(kerb);
    }

    scene.add(group);
    segments.push({ group, slot: i, baseZ: 0, props: [], ramp: null, segmentIndex: 0 });
  }

  const world = {
    scene,
    pool,
    segments,
    liveProps: [],
    ramps: [],
    buildingMesh,
    lightPoolMesh,
    rampMesh,
    sky,
    skyline,
    mats,
    nextIndex: 0,
    scrollZ: 0,
    difficulty: 0,
  };

  resetWorld(world);
  return world;
}

function setBuilding(world, slot, i, x, y, z, w, h, d, rotY) {
  _p.set(x, y, z);
  _e.set(0, rotY, 0);
  _q.setFromEuler(_e);
  _s.set(w, h, d);
  _m.compose(_p, _q, _s);
  world.buildingMesh.setMatrixAt(slot * BUILDINGS_PER_SEGMENT + i, _m);
}

function setLightPool(world, slot, i, x, z, size, color, strength) {
  _p.set(x, 0.035, z);
  _q.identity();
  _s.set(size, 1, size * 2.4);
  _m.compose(_p, _q, _s);
  const idx = slot * LIGHTPOOLS_PER_SEGMENT + i;
  world.lightPoolMesh.setMatrixAt(idx, _m);
  world.lightPoolMesh.setColorAt(idx, _c.setHex(color).multiplyScalar(strength));
}

function hideLightPool(world, slot, i) {
  world.lightPoolMesh.setMatrixAt(slot * LIGHTPOOLS_PER_SEGMENT + i, FAR);
}

const NEON_POOL_COLORS = [0xff4d8d, 0x5ee6c8, 0xffb020, 0x7aa6ff, 0xc07bff];

/** Re-roll one segment slot at `baseZ` for the given deterministic index. */
function generateSegment(world, seg, index, baseZ) {
  const rng = mulberry32(index * 2654435761);
  seg.segmentIndex = index;
  seg.baseZ = baseZ;
  seg.group.position.z = baseZ;

  for (const rec of seg.props) {
    despawnProp(world.pool, rec);
    const k = world.liveProps.indexOf(rec);
    if (k !== -1) world.liveProps.splice(k, 1);
  }
  seg.props.length = 0;

  if (seg.ramp) {
    const k = world.ramps.indexOf(seg.ramp);
    if (k !== -1) world.ramps.splice(k, 1);
    seg.ramp = null;
  }

  // ---- buildings: three blocks per side, varied width/height/setback
  let bi = 0;
  for (const side of [-1, 1]) {
    let z = -SEGMENT_LENGTH / 2;
    for (let n = 0; n < BUILDINGS_PER_SEGMENT / 2; n++) {
      const depth = SEGMENT_LENGTH / 3 - 1 + rng() * 2;
      const h = 12 + rng() * 30;
      const w = 9 + rng() * 9;
      const setback = rng() * 2;
      setBuilding(
        world,
        seg.slot,
        bi++,
        side * (SIDEWALK_OUTER + w / 2 + setback),
        h / 2,
        z + depth / 2,
        w,
        h,
        depth,
        0
      );
      z += depth;
    }
  }

  // ---- ramp: gets more common the further you get
  const rampChance = 0.18 + Math.min(0.3, world.difficulty * 0.22);
  if (index > 1 && rng() < rampChance) {
    const x = (rng() - 0.5) * (ROAD_HALF - 4);
    const z = baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.5;
    _p.set(x, 0, z);
    _q.identity();
    _s.set(1, 1, 1);
    _m.compose(_p, _q, _s);
    world.rampMesh.setMatrixAt(seg.slot, _m);
    seg.ramp = { x, z, halfWidth: 3.0, halfDepth: 6.0, height: 1.5, slot: seg.slot };
    world.ramps.push(seg.ramp);
  } else {
    world.rampMesh.setMatrixAt(seg.slot, FAR);
  }
  world.rampMesh.instanceMatrix.needsUpdate = true;

  // ---- props
  const plan = [];
  const d = world.difficulty; // 0..1, ramps hazards up with distance

  // Streetlights march down both kerbs, alternating.
  const lampZ = baseZ - SEGMENT_LENGTH / 2 + 8;
  plan.push({ type: "lamppost", x: -(ROAD_HALF + 0.8), z: lampZ });
  plan.push({ type: "lamppost", x: ROAD_HALF + 0.8, z: lampZ + SEGMENT_LENGTH / 2 });

  // Shop frontage against the buildings.
  for (const side of [-1, 1]) {
    if (rng() < 0.75) {
      const z = baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.8;
      plan.push({ type: rng() < 0.65 ? "storefront" : "stall", x: side * (SIDEWALK_OUTER - 1.0), z, rot: side < 0 ? Math.PI / 2 : -Math.PI / 2 });
    }
    if (rng() < 0.55) {
      const z = baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.8;
      plan.push({ type: "neonsign", x: side * (SIDEWALK_OUTER - 1.6), z });
    }
  }

  // Pavement clutter.
  const clutter = 3 + Math.floor(rng() * 3);
  const CLUTTER = ["trashcan", "hydrant", "fence", "haybale", "signpost", "stall"];
  for (let i = 0; i < clutter; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    const x = side * (ROAD_HALF + 1.1 + rng() * 3.4);
    const z = baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.9;
    plan.push({ type: CLUTTER[(rng() * CLUTTER.length) | 0], x, z, rot: rng() * 0.6 - 0.3 });
  }

  // On-road obstacles — cones are free points, cars and barriers hurt.
  if (rng() < 0.85) {
    const count = 3 + Math.floor(rng() * 4);
    const laneX = (rng() - 0.5) * (ROAD_HALF * 1.4);
    for (let i = 0; i < count; i++) {
      plan.push({ type: "cone", x: laneX + (rng() - 0.5) * 2.4, z: baseZ - SEGMENT_LENGTH / 2 + i * 2.6 + rng() * 2 });
    }
  }
  if (rng() < 0.5 + d * 0.3) {
    plan.push({ type: "barricade", x: (rng() - 0.5) * ROAD_HALF * 1.5, z: baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.8 });
  }
  if (index > 2 && rng() < 0.55 + d * 0.35) {
    const side = rng() < 0.5 ? -1 : 1;
    plan.push({ type: "parkedcar", x: side * (ROAD_HALF - 1.4 - rng() * 1.2), z: baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.8, rot: (rng() - 0.5) * 0.12 });
  }
  if (index > 4 && rng() < 0.18 + d * 0.4) {
    plan.push({ type: "barrier", x: (rng() - 0.5) * ROAD_HALF * 1.2, z: baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.6 });
  }
  if (index > 3 && rng() < 0.16) {
    plan.push({ type: "repair", x: (rng() - 0.5) * ROAD_HALF * 1.3, z: baseZ + (rng() - 0.5) * SEGMENT_LENGTH * 0.7 });
  }

  for (const item of plan) {
    // Never bury a prop inside the ramp — it would be unhittable.
    if (seg.ramp && Math.abs(item.x - seg.ramp.x) < 3.6 && Math.abs(item.z - seg.ramp.z) < 7.5) continue;
    const rec = spawnProp(world.pool, item.type, item.x, item.z, item.rot || 0);
    if (rec) {
      seg.props.push(rec);
      world.liveProps.push(rec);
    }
  }

  // ---- wet-road light pools under the streetlights + neon spill
  let li = 0;
  setLightPool(world, seg.slot, li++, -(ROAD_HALF - 1.2), lampZ + 1.2, 7, 0xffce9a, 0.5);
  setLightPool(world, seg.slot, li++, ROAD_HALF - 1.2, lampZ + SEGMENT_LENGTH / 2 + 1.2, 7, 0xffce9a, 0.5);
  const spills = 3 + Math.floor(rng() * 3);
  for (let i = 0; i < spills && li < LIGHTPOOLS_PER_SEGMENT; i++) {
    const side = rng() < 0.5 ? -1 : 1;
    setLightPool(
      world,
      seg.slot,
      li++,
      side * (ROAD_HALF * (0.5 + rng() * 0.6)),
      baseZ + (rng() - 0.5) * SEGMENT_LENGTH,
      5 + rng() * 5,
      NEON_POOL_COLORS[(rng() * NEON_POOL_COLORS.length) | 0],
      0.22 + rng() * 0.22
    );
  }
  while (li < LIGHTPOOLS_PER_SEGMENT) hideLightPool(world, seg.slot, li++);

  world.buildingMesh.instanceMatrix.needsUpdate = true;
  world.lightPoolMesh.instanceMatrix.needsUpdate = true;
  if (world.lightPoolMesh.instanceColor) world.lightPoolMesh.instanceColor.needsUpdate = true;
}

export function resetWorld(world) {
  world.difficulty = 0;
  world.scrollZ = 0;
  for (let i = 0; i < world.segments.length; i++) {
    generateSegment(world, world.segments[i], i, i * SEGMENT_LENGTH - SEGMENT_LENGTH);
  }
  world.nextIndex = world.segments.length;
  for (const band of world.skyline.bands) {
    band.userData.offset = 0;
    band.position.x = 0;
  }
}

/** Scroll the street, recycle spent segments, drift the skyline. */
export function updateWorld(world, dt, carSpeed, distance) {
  const dz = carSpeed * dt;
  world.scrollZ += dz;
  world.difficulty = Math.min(1, distance / 6000);

  for (const seg of world.segments) {
    seg.baseZ -= dz;
    seg.group.position.z = seg.baseZ;
    for (const rec of seg.props) {
      rec.z -= dz;
      if (rec.state === "standing") {
        if (rec.def.spin) {
          rec.rotY += dt * 2.2;
          rec.y = 0.18 + Math.sin(performance.now() * 0.004 + rec.phase) * 0.18;
        }
        updatePropTransform(world.pool, rec);
      }
    }
    if (seg.ramp) {
      seg.ramp.z -= dz;
      _p.set(seg.ramp.x, 0, seg.ramp.z);
      _q.identity();
      _s.set(1, 1, 1);
      _m.compose(_p, _q, _s);
      world.rampMesh.setMatrixAt(seg.ramp.slot, _m);
      world.rampMesh.instanceMatrix.needsUpdate = true;
    }

    if (seg.baseZ + SEGMENT_LENGTH / 2 < RECYCLE_Z) {
      const newIndex = world.nextIndex++;
      generateSegment(world, seg, newIndex, seg.baseZ + world.segments.length * SEGMENT_LENGTH);
    }
  }

  // Skyline parallax: a slow sideways drift keeps the horizon alive.
  for (const band of world.skyline.bands) {
    band.userData.offset = (band.userData.offset + dz * 0.02 * band.userData.rate) % 400;
    band.position.x = -band.userData.offset;
  }
}

/** Drop the light pools + ramps back out of view (used on reset). */
export function hideWorldExtras(world) {
  for (let i = 0; i < world.lightPoolMesh.count; i++) world.lightPoolMesh.setMatrixAt(i, FAR);
  world.lightPoolMesh.instanceMatrix.needsUpdate = true;
}
