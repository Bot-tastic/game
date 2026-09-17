// fx.js — debris chunks, sparks, dust/smoke and the wind-line speed rig.
// All three particle systems are fixed-capacity pools written straight into
// typed arrays, so a big smash never allocates mid-frame.

import * as THREE from "three";
import { createGlowTexture, createSmokeTexture } from "./textures.js";

const DEBRIS_CAP = 340;
const SPARK_CAP = 420;
const SMOKE_CAP = 220;

const GRAVITY = -38;

// Per-point size + colour shader, shared by sparks and smoke.
function pointsMaterial(map, blending) {
  return new THREE.ShaderMaterial({
    uniforms: { uMap: { value: map }, uScale: { value: 620 } },
    vertexShader: `
      attribute float aSize;
      attribute vec3 aColor;
      varying vec3 vColor;
      uniform float uScale;
      void main() {
        vColor = aColor;
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        gl_PointSize = aSize * (uScale / max(1.0, -mv.z));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform sampler2D uMap;
      varying vec3 vColor;
      void main() {
        vec4 t = texture2D(uMap, gl_PointCoord);
        gl_FragColor = vec4(vColor * t.rgb, t.a);
        if (gl_FragColor.a < 0.01) discard;
      }`,
    transparent: true,
    depthWrite: false,
    blending,
  });
}

function makePointSystem(cap, map, blending) {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(cap * 3);
  const size = new Float32Array(cap);
  const col = new Float32Array(cap * 3);
  for (let i = 0; i < cap; i++) pos[i * 3 + 1] = -900;
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));
  geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
  geo.setDrawRange(0, cap);
  geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e4);
  const points = new THREE.Points(geo, pointsMaterial(map, blending));
  points.frustumCulled = false;
  return { geo, pos, size, col, points, cap, cursor: 0, live: [] };
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _v = new THREE.Vector3();
const _s = new THREE.Vector3();
const _c = new THREE.Color();
const HIDDEN = new THREE.Matrix4().makeTranslation(0, -900, 0);

export function createFX(scene) {
  const glowTex = createGlowTexture();
  const smokeTex = createSmokeTexture();

  // ---- debris: instanced boxes that tumble, bounce once and shrink away
  const debrisGeo = new THREE.BoxGeometry(1, 1, 1);
  const debrisMat = new THREE.MeshLambertMaterial({ flatShading: true });
  const debrisMesh = new THREE.InstancedMesh(debrisGeo, debrisMat, DEBRIS_CAP);
  debrisMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  debrisMesh.frustumCulled = false;
  for (let i = 0; i < DEBRIS_CAP; i++) {
    debrisMesh.setMatrixAt(i, HIDDEN);
    debrisMesh.setColorAt(i, _c.setHex(0xffffff));
  }
  debrisMesh.instanceMatrix.needsUpdate = true;
  scene.add(debrisMesh);

  const debris = [];
  for (let i = 0; i < DEBRIS_CAP; i++) {
    debris.push({
      i,
      alive: false,
      p: new THREE.Vector3(),
      v: new THREE.Vector3(),
      rot: new THREE.Euler(),
      spin: new THREE.Vector3(),
      scale: new THREE.Vector3(1, 1, 1),
      life: 0,
      maxLife: 1,
      bounced: 0,
      glass: false,
    });
  }
  let debrisCursor = 0;

  const sparks = makePointSystem(SPARK_CAP, glowTex, THREE.AdditiveBlending);
  const smoke = makePointSystem(SMOKE_CAP, smokeTex, THREE.AdditiveBlending);
  scene.add(sparks.points, smoke.points);

  const sparkState = [];
  for (let i = 0; i < SPARK_CAP; i++) sparkState.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, color: new THREE.Color() });
  const smokeState = [];
  for (let i = 0; i < SMOKE_CAP; i++) smokeState.push({ alive: false, p: new THREE.Vector3(), v: new THREE.Vector3(), life: 0, maxLife: 1, size: 1, grow: 1, color: new THREE.Color() });

  // ---- wind lines: short additive streaks parented to the camera
  const LINE_COUNT = 90;
  const linePos = new Float32Array(LINE_COUNT * 6);
  const lineGeo = new THREE.BufferGeometry();
  lineGeo.setAttribute("position", new THREE.BufferAttribute(linePos, 3));
  const lineMat = new THREE.LineBasicMaterial({
    color: 0xbfe6ff,
    transparent: true,
    opacity: 0,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(lineGeo, lineMat);
  lines.frustumCulled = false;
  const lineSeeds = [];
  for (let i = 0; i < LINE_COUNT; i++) {
    lineSeeds.push({ a: Math.random() * Math.PI * 2, r: 2.5 + Math.random() * 9, z: -Math.random() * 60, speed: 0.7 + Math.random() * 0.8 });
  }

  function allocDebris() {
    for (let n = 0; n < DEBRIS_CAP; n++) {
      const d = debris[debrisCursor];
      debrisCursor = (debrisCursor + 1) % DEBRIS_CAP;
      if (!d.alive) return d;
    }
    return debris[debrisCursor];
  }

  function allocPoint(sys, state) {
    for (let n = 0; n < sys.cap; n++) {
      const i = sys.cursor;
      sys.cursor = (sys.cursor + 1) % sys.cap;
      if (!state[i].alive) return i;
    }
    return sys.cursor;
  }

  /** Burst of tumbling chunks at (x,y,z). `dir` biases them along the hit. */
  function spawnDebris(x, y, z, opts = {}) {
    const {
      count = 10,
      color = 0xffffff,
      colorJitter = 0.12,
      speed = 10,
      size = 0.3,
      sizeJitter = 0.5,
      flat = false,
      dirZ = 1,
      spread = 1,
      life = 1.5,
      glass = false,
    } = opts;
    for (let i = 0; i < count; i++) {
      const d = allocDebris();
      d.alive = true;
      d.p.set(x + (Math.random() - 0.5) * spread, y + Math.random() * spread * 0.8, z + (Math.random() - 0.5) * spread);
      d.v.set(
        (Math.random() - 0.5) * speed * 1.1,
        Math.random() * speed * 0.75 + 2,
        dirZ * (0.35 + Math.random()) * speed * 0.9
      );
      d.rot.set(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28);
      d.spin.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16, (Math.random() - 0.5) * 16);
      const s = size * (1 - sizeJitter / 2 + Math.random() * sizeJitter);
      if (flat) d.scale.set(s * (1 + Math.random()), s * 0.18, s * (1 + Math.random()));
      else d.scale.set(s, s * (0.6 + Math.random() * 0.8), s * (0.6 + Math.random() * 0.8));
      d.life = 0;
      d.maxLife = life * (0.7 + Math.random() * 0.6);
      d.bounced = 0;
      d.glass = glass;
      _c.setHex(color);
      const j = 1 - colorJitter / 2 + Math.random() * colorJitter;
      _c.multiplyScalar(j);
      debrisMesh.setColorAt(d.i, _c);
    }
    if (debrisMesh.instanceColor) debrisMesh.instanceColor.needsUpdate = true;
  }

  function spawnSparks(x, y, z, count = 14, color = 0xffc66b, speed = 14) {
    for (let i = 0; i < count; i++) {
      const idx = allocPoint(sparks, sparkState);
      const s = sparkState[idx];
      s.alive = true;
      s.p.set(x, y, z);
      s.v.set((Math.random() - 0.5) * speed, Math.random() * speed * 0.8 + 3, (Math.random() - 0.2) * speed);
      s.life = 0;
      s.maxLife = 0.28 + Math.random() * 0.45;
      s.size = 0.06 + Math.random() * 0.1;
      s.color.setHex(color);
    }
  }

  function spawnSmoke(x, y, z, count = 6, color = 0x8894b0, opts = {}) {
    const { speed = 2.5, size = 0.7, grow = 2.4, life = 0.9, rise = 2.5 } = opts;
    for (let i = 0; i < count; i++) {
      const idx = allocPoint(smoke, smokeState);
      const s = smokeState[idx];
      s.alive = true;
      s.p.set(x + (Math.random() - 0.5) * 0.8, y + Math.random() * 0.4, z + (Math.random() - 0.5) * 0.8);
      s.v.set((Math.random() - 0.5) * speed, Math.random() * rise, (Math.random() - 0.5) * speed);
      s.life = 0;
      s.maxLife = life * (0.7 + Math.random() * 0.6);
      s.size = size * (0.7 + Math.random() * 0.6);
      s.grow = grow;
      s.color.setHex(color);
    }
  }

  /** Scroll every live particle with the world so debris stays on the road. */
  function update(dt, scrollDz) {
    // debris
    for (const d of debris) {
      if (!d.alive) continue;
      d.life += dt;
      d.v.y += GRAVITY * dt;
      d.p.x += d.v.x * dt;
      d.p.y += d.v.y * dt;
      d.p.z += d.v.z * dt - scrollDz;
      if (d.p.y < d.scale.y * 0.5) {
        d.p.y = d.scale.y * 0.5;
        if (d.bounced < 3 && d.v.y < -2) {
          d.v.y *= -(d.glass ? 0.18 : 0.38);
          d.v.x *= 0.62;
          d.v.z *= 0.62;
          d.spin.multiplyScalar(0.55);
          d.bounced++;
        } else {
          d.v.set(d.v.x * 0.9, 0, d.v.z * 0.9);
          d.spin.multiplyScalar(0.9);
        }
      }
      d.rot.x += d.spin.x * dt;
      d.rot.y += d.spin.y * dt;
      d.rot.z += d.spin.z * dt;

      const t = d.life / d.maxLife;
      if (t >= 1 || d.p.z < -26) {
        d.alive = false;
        debrisMesh.setMatrixAt(d.i, HIDDEN);
        continue;
      }
      const shrink = t > 0.72 ? 1 - (t - 0.72) / 0.28 : 1;
      _q.setFromEuler(_e.set(d.rot.x, d.rot.y, d.rot.z));
      _s.set(d.scale.x * shrink, d.scale.y * shrink, d.scale.z * shrink);
      _m.compose(d.p, _q, _s);
      debrisMesh.setMatrixAt(d.i, _m);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;

    // sparks
    for (let i = 0; i < SPARK_CAP; i++) {
      const s = sparkState[i];
      if (!s.alive) {
        sparks.size[i] = 0;
        continue;
      }
      s.life += dt;
      const t = s.life / s.maxLife;
      if (t >= 1) {
        s.alive = false;
        sparks.size[i] = 0;
        sparks.pos[i * 3 + 1] = -900;
        continue;
      }
      s.v.y += GRAVITY * 0.55 * dt;
      s.p.x += s.v.x * dt;
      s.p.y += s.v.y * dt;
      s.p.z += s.v.z * dt - scrollDz;
      if (s.p.y < 0.04) {
        s.p.y = 0.04;
        s.v.y *= -0.3;
        s.v.x *= 0.7;
        s.v.z *= 0.7;
      }
      sparks.pos[i * 3] = s.p.x;
      sparks.pos[i * 3 + 1] = s.p.y;
      sparks.pos[i * 3 + 2] = s.p.z;
      sparks.size[i] = s.size * (1 - t * 0.5);
      const f = (1 - t) * (1 - t);
      sparks.col[i * 3] = s.color.r * f * 2.2;
      sparks.col[i * 3 + 1] = s.color.g * f * 2.2;
      sparks.col[i * 3 + 2] = s.color.b * f * 2.2;
    }
    sparks.geo.attributes.position.needsUpdate = true;
    sparks.geo.attributes.aSize.needsUpdate = true;
    sparks.geo.attributes.aColor.needsUpdate = true;

    // smoke
    for (let i = 0; i < SMOKE_CAP; i++) {
      const s = smokeState[i];
      if (!s.alive) {
        smoke.size[i] = 0;
        continue;
      }
      s.life += dt;
      const t = s.life / s.maxLife;
      if (t >= 1) {
        s.alive = false;
        smoke.size[i] = 0;
        smoke.pos[i * 3 + 1] = -900;
        continue;
      }
      s.v.multiplyScalar(1 - 1.6 * dt);
      s.p.x += s.v.x * dt;
      s.p.y += s.v.y * dt;
      s.p.z += s.v.z * dt - scrollDz;
      smoke.pos[i * 3] = s.p.x;
      smoke.pos[i * 3 + 1] = s.p.y;
      smoke.pos[i * 3 + 2] = s.p.z;
      smoke.size[i] = s.size * (1 + t * s.grow);
      const f = Math.sin(Math.min(1, t * 1.6) * Math.PI) * 0.75;
      smoke.col[i * 3] = s.color.r * f;
      smoke.col[i * 3 + 1] = s.color.g * f;
      smoke.col[i * 3 + 2] = s.color.b * f;
    }
    smoke.geo.attributes.position.needsUpdate = true;
    smoke.geo.attributes.aSize.needsUpdate = true;
    smoke.geo.attributes.aColor.needsUpdate = true;
  }

  /** Wind streaks: only visible once you're genuinely moving fast. */
  function updateWindLines(dt, intensity) {
    lineMat.opacity += (Math.max(0, intensity) * 0.55 - lineMat.opacity) * Math.min(1, dt * 6);
    if (lineMat.opacity < 0.01) {
      lines.visible = false;
      return;
    }
    lines.visible = true;
    const len = 4 + intensity * 26;
    for (let i = 0; i < LINE_COUNT; i++) {
      const s = lineSeeds[i];
      s.z += (30 + intensity * 190) * s.speed * dt;
      if (s.z > -1) {
        s.z = -58 - Math.random() * 14;
        s.a = Math.random() * Math.PI * 2;
        s.r = 2.5 + Math.random() * 9;
      }
      const x = Math.cos(s.a) * s.r;
      const y = Math.sin(s.a) * s.r * 0.65;
      linePos[i * 6] = x;
      linePos[i * 6 + 1] = y;
      linePos[i * 6 + 2] = s.z;
      linePos[i * 6 + 3] = x;
      linePos[i * 6 + 4] = y;
      linePos[i * 6 + 5] = s.z - len * s.speed;
    }
    lineGeo.attributes.position.needsUpdate = true;
  }

  function reset() {
    for (const d of debris) {
      d.alive = false;
      debrisMesh.setMatrixAt(d.i, HIDDEN);
    }
    debrisMesh.instanceMatrix.needsUpdate = true;
    for (let i = 0; i < SPARK_CAP; i++) {
      sparkState[i].alive = false;
      sparks.size[i] = 0;
      sparks.pos[i * 3 + 1] = -900;
    }
    for (let i = 0; i < SMOKE_CAP; i++) {
      smokeState[i].alive = false;
      smoke.size[i] = 0;
      smoke.pos[i * 3 + 1] = -900;
    }
    sparks.geo.attributes.position.needsUpdate = true;
    sparks.geo.attributes.aSize.needsUpdate = true;
    smoke.geo.attributes.position.needsUpdate = true;
    smoke.geo.attributes.aSize.needsUpdate = true;
  }

  return { spawnDebris, spawnSparks, spawnSmoke, update, updateWindLines, reset, windLines: lines, glowTex, smokeTex };
}
