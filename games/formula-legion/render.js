// render.js — renderer, camera, sky and the art-directed track for Formula
// Legion. Everything here is procedural: canvas-drawn textures, shader
// gradients and instanced geometry. No gameplay math lives in this file.

import * as THREE from "three";
import { LANE_HALF_WIDTH, RANGE, COLUMN_HALF_SPAN } from "./levels.js";

const reduceMotion =
  typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

export function prefersReducedMotion() {
  return reduceMotion;
}

/** Rough "can this device afford bloom" check — conservative on mobile. */
export function canAffordBloom() {
  if (reduceMotion) return false;
  const cores = navigator.hardwareConcurrency || 2;
  const mem = navigator.deviceMemory || 4;
  return cores >= 4 && mem >= 3;
}

// ---- canvas texture helpers ------------------------------------------------

function canvasTex(w, h, draw, repeatX = 1, repeatY = 1) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeatX, repeatY);
  t.anisotropy = 4;
  return t;
}

function hex(n) {
  return "#" + n.toString(16).padStart(6, "0");
}

// ---- renderer / composer ---------------------------------------------------

export function createRenderer(canvas, { bloom = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, bloom ? 1.5 : 1.25));
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, 1, 0.1, 900);

  return { renderer, scene, camera };
}

/** Lazily wire EffectComposer + UnrealBloomPass; resolves to null on failure. */
export async function createComposer(renderer, scene, camera) {
  try {
    const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }] = await Promise.all([
      import("three/addons/postprocessing/EffectComposer.js"),
      import("three/addons/postprocessing/RenderPass.js"),
      import("three/addons/postprocessing/UnrealBloomPass.js"),
    ]);
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.62, 0.5, 0.72);
    composer.addPass(bloom);
    return composer;
  } catch {
    return null;
  }
}

// ---- lighting --------------------------------------------------------------

export function createLights(scene) {
  const hemi = new THREE.HemisphereLight(0xaab8ff, 0x1a1420, 1.5);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 1.5);
  key.position.set(-8, 18, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0xff6bb5, 0.9);
  rim.position.set(9, 5, -12);
  scene.add(rim);
  return { hemi, key, rim };
}

export function applyTheme(scene, lights, theme) {
  scene.fog = new THREE.Fog(theme.fog, 34, 190);
  scene.background = new THREE.Color(theme.fog);
  lights.hemi.color.setHex(theme.light);
  lights.hemi.groundColor.setHex(theme.road);
  lights.key.color.setHex(theme.light);
  lights.rim.color.setHex(theme.accent);
}

// ---- sky -------------------------------------------------------------------

const SKY_VERT = `
varying vec3 vPos;
void main() {
  vPos = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const SKY_FRAG = `
uniform vec3 top;
uniform vec3 bottom;
uniform float time;
varying vec3 vPos;
void main() {
  vec3 dir = normalize(vPos);
  // The horizon (dir.y == 0) must land on the bottom colour, not halfway up
  // the ramp, or all the player ever sees is the dark zenith colour.
  float h = clamp(dir.y, 0.0, 1.0);
  vec3 col = mix(bottom, top, pow(h, 0.55));
  // warm glow hugging the horizon line
  float glow = pow(1.0 - clamp(abs(dir.y) * 3.2, 0.0, 1.0), 2.0);
  col += bottom * glow * 0.55;
  // soft moving bands for a sense of drift
  float band = sin(dir.x * 6.0 + time * 0.25) * cos(dir.z * 5.0 - time * 0.18);
  col += bottom * band * 0.06 * (1.0 - h);
  gl_FragColor = vec4(col, 1.0);
}`;

export function createSky(scene) {
  const geo = new THREE.SphereGeometry(500, 24, 16);
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      top: { value: new THREE.Color(0x120f2e) },
      bottom: { value: new THREE.Color(0x5c2b8a) },
      time: { value: 0 },
    },
    vertexShader: SKY_VERT,
    fragmentShader: SKY_FRAG,
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  scene.add(mesh);

  // stars
  const starGeo = new THREE.BufferGeometry();
  const N = 420;
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    const u = Math.random() * 2 - 1;
    const a = Math.random() * Math.PI * 2;
    const r = 420;
    const s = Math.sqrt(1 - u * u);
    pos[i * 3] = Math.cos(a) * s * r;
    pos[i * 3 + 1] = Math.abs(u) * r * 0.9 + 20;
    pos[i * 3 + 2] = Math.sin(a) * s * r;
  }
  starGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  const starTex = canvasTex(32, 32, (ctx, w) => {
    const g = ctx.createRadialGradient(w / 2, w / 2, 0, w / 2, w / 2, w / 2);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, w);
  });
  const stars = new THREE.Points(
    starGeo,
    new THREE.PointsMaterial({ size: 4.5, map: starTex, transparent: true, depthWrite: false, fog: false })
  );
  stars.frustumCulled = false;
  scene.add(stars);

  // drifting cloud slabs
  const cloudTex = canvasTex(256, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    for (let i = 0; i < 26; i++) {
      const x = Math.random() * w;
      const y = h * 0.5 + (Math.random() - 0.5) * h * 0.55;
      const r = 18 + Math.random() * 42;
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, "rgba(255,255,255,0.34)");
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
  });
  const clouds = new THREE.Group();
  for (let i = 0; i < 5; i++) {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(420, 120),
      new THREE.MeshBasicMaterial({
        map: cloudTex,
        transparent: true,
        opacity: 0.5,
        depthWrite: false,
        fog: false,
        blending: THREE.AdditiveBlending,
      })
    );
    m.position.set((i - 2) * 120, 70 + i * 26, -260 - i * 30);
    m.userData.drift = 2 + i * 1.3;
    clouds.add(m);
  }
  clouds.frustumCulled = false;
  scene.add(clouds);

  return { mesh, mat, stars, clouds };
}

export function updateSky(sky, camera, time, theme) {
  sky.mesh.position.copy(camera.position);
  sky.stars.position.copy(camera.position);
  sky.clouds.position.z = camera.position.z;
  sky.clouds.position.x = 0;
  sky.mat.uniforms.time.value = time;
  sky.stars.visible = !!theme.stars;
  for (const c of sky.clouds.children) {
    c.position.x += c.userData.drift * 0.016;
    if (c.position.x > 320) c.position.x = -320;
  }
}

// ---- track -----------------------------------------------------------------

function roadTexture(theme) {
  return canvasTex(
    256,
    256,
    (ctx, w, h) => {
      ctx.fillStyle = hex(theme.road);
      ctx.fillRect(0, 0, w, h);
      // subtle plating
      ctx.strokeStyle = "rgba(255,255,255,0.05)";
      ctx.lineWidth = 2;
      for (let y = 0; y < h; y += 32) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(w, y);
        ctx.stroke();
      }
      ctx.strokeStyle = "rgba(255,255,255,0.03)";
      for (let x = 0; x < w; x += 64) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
      // speckle
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.05})`;
        ctx.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    },
    2,
    24
  );
}

function stripeTexture(theme) {
  return canvasTex(
    64,
    256,
    (ctx, w, h) => {
      ctx.clearRect(0, 0, w, h);
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(255,255,255,0)");
      g.addColorStop(0.42, hex(theme.edge));
      g.addColorStop(0.5, "#ffffff");
      g.addColorStop(0.58, hex(theme.edge));
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    },
    1,
    1
  );
}

/** Build the whole static track for a level: road, rails, scenery, debris. */
export function createTrack(scene, level) {
  const theme = level.theme;
  const group = new THREE.Group();
  scene.add(group);
  const len = level.length + 220;
  const midZ = len / 2 - 60;

  // road surface
  const roadTex = roadTexture(theme);
  roadTex.repeat.set(2, len / 12);
  const road = new THREE.Mesh(
    new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2, len),
    new THREE.MeshLambertMaterial({ map: roadTex })
  );
  road.rotation.x = -Math.PI / 2;
  road.position.set(0, 0, midZ);
  group.add(road);

  // flowing energy stripes down the lane guides
  const stripeTex = stripeTexture(theme);
  const stripes = [];
  for (const x of [-COLUMN_HALF_SPAN, 0, COLUMN_HALF_SPAN]) {
    const t = stripeTex.clone();
    t.needsUpdate = true;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(1, len / 10);
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(0.5, len),
      new THREE.MeshBasicMaterial({
        map: t,
        transparent: true,
        opacity: x === 0 ? 0.5 : 0.34,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.02, midZ);
    group.add(m);
    stripes.push(t);
  }

  // glowing edge rails
  const railMat = new THREE.MeshBasicMaterial({ color: theme.edge });
  const shoulderMat = new THREE.MeshLambertMaterial({ color: theme.prop, flatShading: true });
  for (const side of [-1, 1]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.18, len), railMat);
    rail.position.set(side * LANE_HALF_WIDTH, 0.42, midZ);
    group.add(rail);
    const shoulder = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.7, len), shoulderMat);
    shoulder.position.set(side * (LANE_HALF_WIDTH + 1.3), 0.1, midZ);
    group.add(shoulder);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(1.6, len),
      new THREE.MeshBasicMaterial({
        color: theme.edge,
        transparent: true,
        opacity: 0.18,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.set(side * (LANE_HALF_WIDTH + 0.4), 0.06, midZ);
    group.add(glow);
  }

  // ---- instanced side scenery ----
  const dummy = new THREE.Object3D();
  const pillarStep = 13;
  const pillarCount = Math.ceil(len / pillarStep) * 2;

  const pillars = new THREE.InstancedMesh(
    new THREE.CylinderGeometry(0.55, 0.9, 1, 6),
    new THREE.MeshLambertMaterial({ color: theme.prop, flatShading: true }),
    pillarCount
  );
  const caps = new THREE.InstancedMesh(
    new THREE.BoxGeometry(1.5, 0.28, 1.5),
    new THREE.MeshBasicMaterial({ color: theme.accent }),
    pillarCount
  );
  const banners = new THREE.InstancedMesh(
    new THREE.PlaneGeometry(0.1, 4.4),
    new THREE.MeshBasicMaterial({ color: theme.edge, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    pillarCount
  );
  let pi = 0;
  for (let z = -60; z < len - 60; z += pillarStep) {
    for (const side of [-1, 1]) {
      if (pi >= pillarCount) break;
      const h = 5 + ((Math.sin(z * 0.13 + side) + 1) / 2) * 7;
      dummy.position.set(side * (LANE_HALF_WIDTH + 3.4), h / 2, z);
      dummy.scale.set(1, h, 1);
      dummy.rotation.set(0, 0, 0);
      dummy.updateMatrix();
      pillars.setMatrixAt(pi, dummy.matrix);

      dummy.position.set(side * (LANE_HALF_WIDTH + 3.4), h + 0.15, z);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      caps.setMatrixAt(pi, dummy.matrix);

      dummy.position.set(side * (LANE_HALF_WIDTH + 2.6), h * 0.55, z);
      dummy.rotation.set(0, side * 0.25, 0);
      dummy.scale.set(1, 1, 1);
      dummy.updateMatrix();
      banners.setMatrixAt(pi, dummy.matrix);
      pi++;
    }
  }
  pillars.count = caps.count = banners.count = pi;
  pillars.frustumCulled = caps.frustumCulled = banners.frustumCulled = false;
  group.add(pillars, caps, banners);

  // arches every ~52 units
  const archCount = Math.ceil(len / 52) + 2;
  const arches = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + 9, 0.9, 1.1),
    new THREE.MeshLambertMaterial({ color: theme.prop, flatShading: true }),
    archCount
  );
  const archGlow = new THREE.InstancedMesh(
    new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + 9.4, 0.14, 0.2),
    new THREE.MeshBasicMaterial({ color: theme.edge }),
    archCount
  );
  let ai = 0;
  for (let z = -20; z < len - 60 && ai < archCount; z += 52) {
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(1, 1, 1);
    dummy.position.set(0, 9.4, z);
    dummy.updateMatrix();
    arches.setMatrixAt(ai, dummy.matrix);
    dummy.position.set(0, 8.85, z);
    dummy.updateMatrix();
    archGlow.setMatrixAt(ai, dummy.matrix);
    ai++;
  }
  arches.count = archGlow.count = ai;
  arches.frustumCulled = archGlow.frustumCulled = false;
  group.add(arches, archGlow);

  // spectator stands — tiny bobbing figures behind the shoulders
  const specCount = Math.min(520, Math.ceil(len / 3) * 2);
  const spectators = new THREE.InstancedMesh(
    new THREE.BoxGeometry(0.3, 0.55, 0.3),
    new THREE.MeshLambertMaterial({ vertexColors: false, flatShading: true }),
    specCount
  );
  spectators.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(specCount * 3), 3);
  const cA = new THREE.Color(theme.accent);
  const cB = new THREE.Color(theme.edge);
  const specSeed = new Float32Array(specCount);
  const specBase = new Float32Array(specCount * 3);
  for (let i = 0; i < specCount; i++) {
    const side = i % 2 === 0 ? -1 : 1;
    const z = -50 + (i / specCount) * len + (Math.random() - 0.5) * 3;
    const row = Math.floor(Math.random() * 3);
    const x = side * (LANE_HALF_WIDTH + 5.6 + row * 1.1);
    const y = 1.4 + row * 0.7;
    specBase[i * 3] = x;
    specBase[i * 3 + 1] = y;
    specBase[i * 3 + 2] = z;
    specSeed[i] = Math.random() * Math.PI * 2;
    const col = cA.clone().lerp(cB, Math.random()).multiplyScalar(0.7 + Math.random() * 0.6);
    spectators.setColorAt(i, col);
  }
  spectators.frustumCulled = false;
  if (spectators.instanceColor) spectators.instanceColor.needsUpdate = true;
  group.add(spectators);

  // floating debris slabs overhead
  const debrisCount = 70;
  const debris = new THREE.InstancedMesh(
    new THREE.OctahedronGeometry(0.6, 0),
    new THREE.MeshLambertMaterial({ color: theme.prop, flatShading: true }),
    debrisCount
  );
  const debrisData = [];
  for (let i = 0; i < debrisCount; i++) {
    debrisData.push({
      x: (Math.random() * 2 - 1) * 26,
      y: 6 + Math.random() * 16,
      z: -40 + Math.random() * len,
      rx: Math.random() * Math.PI,
      ry: Math.random() * Math.PI,
      sp: 0.2 + Math.random() * 0.6,
      s: 0.4 + Math.random() * 1.4,
    });
  }
  debris.frustumCulled = false;
  group.add(debris);

  return {
    group,
    stripes,
    spectators,
    specSeed,
    specBase,
    debris,
    debrisData,
    dummy,
    len,
  };
}

export function updateTrack(track, time, playerZ) {
  for (const t of track.stripes) t.offset.y = (time * 0.55) % 1;

  const d = track.dummy;
  // spectators bob; only those near the player need refreshing
  const spec = track.spectators;
  for (let i = 0; i < spec.count; i++) {
    const z = track.specBase[i * 3 + 2];
    if (Math.abs(z - playerZ) > 90) continue;
    const bob = Math.sin(time * 5 + track.specSeed[i]) * 0.18;
    d.position.set(track.specBase[i * 3], track.specBase[i * 3 + 1] + Math.max(0, bob), z);
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, 1);
    d.updateMatrix();
    spec.setMatrixAt(i, d.matrix);
  }
  spec.instanceMatrix.needsUpdate = true;

  for (let i = 0; i < track.debrisData.length; i++) {
    const o = track.debrisData[i];
    o.ry += o.sp * 0.01;
    o.rx += o.sp * 0.006;
    d.position.set(o.x, o.y + Math.sin(time * o.sp + i) * 0.5, o.z);
    d.rotation.set(o.rx, o.ry, 0);
    d.scale.setScalar(o.s);
    d.updateMatrix();
    track.debris.setMatrixAt(i, d.matrix);
  }
  track.debris.instanceMatrix.needsUpdate = true;
}

export function disposeObject(scene, obj) {
  if (!obj) return;
  scene.remove(obj);
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) {
      if (m.map) m.map.dispose();
      m.dispose();
    }
  });
}

// ---- camera ----------------------------------------------------------------

const _camTarget = new THREE.Vector3();
const _look = new THREE.Vector3();

export function createCameraRig() {
  return { shake: 0, kick: 0, fov: 62 };
}

export function addShake(rig, amount) {
  if (reduceMotion) return;
  rig.shake = Math.min(1.4, rig.shake + amount);
}

export function updateCamera(camera, rig, legion, playerZ, crowdSpread, dt, time) {
  const back = 13 + Math.min(9, crowdSpread * 1.1);
  const height = 7.2 + Math.min(4.5, crowdSpread * 0.55);
  _camTarget.set(legion.x * 0.55, height, playerZ - back);
  camera.position.lerp(_camTarget, Math.min(1, 6 * dt));

  rig.shake = Math.max(0, rig.shake - dt * 2.4);
  const s = rig.shake * rig.shake;
  const ox = Math.sin(time * 47) * s * 0.5;
  const oy = Math.cos(time * 39) * s * 0.4;
  camera.position.x += ox;
  camera.position.y += oy;

  _look.set(legion.x * 0.8, 1.6, playerZ + RANGE * 0.5);
  camera.lookAt(_look);
  camera.rotation.z += legion.lean * 0.12 + ox * 0.02;

  const targetFov = 62 + Math.min(7, crowdSpread * 0.8) + rig.kick;
  rig.kick = Math.max(0, rig.kick - dt * 3);
  if (Math.abs(camera.fov - targetFov) > 0.05) {
    camera.fov += (targetFov - camera.fov) * Math.min(1, 4 * dt);
    camera.updateProjectionMatrix();
  }
}
