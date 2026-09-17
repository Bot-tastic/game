// fx.js — pooled combat spectacle: tracer bullets with trails, muzzle
// flashes, spark/debris particles and floating damage numbers. Everything is
// a fixed-size pool of instances so nothing allocates during play.

import * as THREE from "three";

const HIDE = new THREE.Matrix4().makeScale(0, 0, 0);
const BULLET_SPEED = 90;

function additive(color) {
  return new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export function createFx(scene, { bullets = 420, sparks = 320, flashes = 90, numbers = 12 } = {}) {
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();

  // --- tracers ---
  const tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.09, 0.09, 1), additive(0xffffff), bullets);
  tracerMesh.frustumCulled = false;
  tracerMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(bullets * 3), 3);
  scene.add(tracerMesh);
  const tracers = [];
  for (let i = 0; i < bullets; i++) tracers.push({ on: false, x: 0, y: 0, z: 0, left: 0, len: 2.4 });

  // --- muzzle flashes ---
  const flashMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.7, 0.7), additive(0xfff3b0), flashes);
  flashMesh.frustumCulled = false;
  scene.add(flashMesh);
  const flashList = [];
  for (let i = 0; i < flashes; i++) flashList.push({ on: false, x: 0, y: 0, z: 0, t: 0 });

  // --- sparks / debris ---
  const sparkMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.16, 0.16, 0.16), additive(0xffffff), sparks);
  sparkMesh.frustumCulled = false;
  sparkMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(sparks * 3), 3);
  scene.add(sparkMesh);
  const sparkList = [];
  for (let i = 0; i < sparks; i++) {
    sparkList.push({ on: false, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, t: 0, life: 1, size: 1 });
  }

  // --- floating damage numbers ---
  const numberList = [];
  for (let i = 0; i < numbers; i++) {
    const c = document.createElement("canvas");
    c.width = 256;
    c.height = 128;
    const tex = new THREE.CanvasTexture(c);
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, depthTest: false })
    );
    sprite.visible = false;
    sprite.renderOrder = 20;
    scene.add(sprite);
    numberList.push({ sprite, canvas: c, tex, t: 0, life: 0.9, x: 0, y: 0, z: 0 });
  }

  return {
    dummy,
    col,
    tracerMesh,
    tracers,
    tracerCursor: 0,
    flashMesh,
    flashList,
    flashCursor: 0,
    sparkMesh,
    sparkList,
    sparkCursor: 0,
    numberList,
    numberCursor: 0,
  };
}

export function spawnTracer(fx, x, y, z, distance, color) {
  const t = fx.tracers[fx.tracerCursor];
  const i = fx.tracerCursor;
  fx.tracerCursor = (fx.tracerCursor + 1) % fx.tracers.length;
  t.on = true;
  t.x = x;
  t.y = y;
  t.z = z;
  t.left = Math.max(1, distance);
  t.len = 2.2 + Math.random() * 1.6;
  fx.col.setHex(color);
  fx.tracerMesh.setColorAt(i, fx.col);
  if (fx.tracerMesh.instanceColor) fx.tracerMesh.instanceColor.needsUpdate = true;
}

export function spawnFlash(fx, x, y, z) {
  const f = fx.flashList[fx.flashCursor];
  fx.flashCursor = (fx.flashCursor + 1) % fx.flashList.length;
  f.on = true;
  f.x = x;
  f.y = y;
  f.z = z;
  f.t = 0;
}

export function spawnSparks(fx, x, y, z, n, color, power = 1) {
  for (let i = 0; i < n; i++) {
    const s = fx.sparkList[fx.sparkCursor];
    const idx = fx.sparkCursor;
    fx.sparkCursor = (fx.sparkCursor + 1) % fx.sparkList.length;
    s.on = true;
    s.x = x;
    s.y = y;
    s.z = z;
    const a = Math.random() * Math.PI * 2;
    const sp = (2 + Math.random() * 7) * power;
    s.vx = Math.cos(a) * sp * 0.5;
    s.vy = 2 + Math.random() * 6 * power;
    s.vz = Math.sin(a) * sp * 0.5 - 1;
    s.t = 0;
    s.life = 0.45 + Math.random() * 0.5;
    s.size = (0.5 + Math.random()) * power;
    fx.col.setHex(color).multiplyScalar(0.8 + Math.random() * 0.8);
    fx.sparkMesh.setColorAt(idx, fx.col);
  }
  if (fx.sparkMesh.instanceColor) fx.sparkMesh.instanceColor.needsUpdate = true;
}

export function spawnNumber(fx, x, y, z, text, color, big = false) {
  const n = fx.numberList[fx.numberCursor];
  fx.numberCursor = (fx.numberCursor + 1) % fx.numberList.length;
  const ctx = n.canvas.getContext("2d");
  ctx.clearRect(0, 0, 256, 128);
  ctx.font = `bold ${big ? 86 : 66}px system-ui, -apple-system, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineWidth = 12;
  ctx.strokeStyle = "rgba(6,8,12,0.9)";
  ctx.strokeText(text, 128, 64);
  ctx.fillStyle = color;
  ctx.fillText(text, 128, 64);
  n.tex.needsUpdate = true;
  n.t = 0;
  n.life = big ? 1.3 : 0.85;
  n.x = x + (Math.random() - 0.5) * 0.8;
  n.y = y;
  n.z = z;
  n.sprite.visible = true;
  n.sprite.scale.set(big ? 3 : 1.9, big ? 1.5 : 0.95, 1);
}

export function updateFx(fx, dt) {
  const d = fx.dummy;

  // tracers
  const step = BULLET_SPEED * dt;
  for (let i = 0; i < fx.tracers.length; i++) {
    const t = fx.tracers[i];
    if (!t.on) {
      fx.tracerMesh.setMatrixAt(i, HIDE);
      continue;
    }
    t.z += step;
    t.left -= step;
    if (t.left <= 0) {
      t.on = false;
      fx.tracerMesh.setMatrixAt(i, HIDE);
      continue;
    }
    d.position.set(t.x, t.y, t.z);
    d.rotation.set(0, 0, 0);
    d.scale.set(1, 1, t.len);
    d.updateMatrix();
    fx.tracerMesh.setMatrixAt(i, d.matrix);
  }
  fx.tracerMesh.instanceMatrix.needsUpdate = true;

  // flashes
  for (let i = 0; i < fx.flashList.length; i++) {
    const f = fx.flashList[i];
    if (!f.on) {
      fx.flashMesh.setMatrixAt(i, HIDE);
      continue;
    }
    f.t += dt;
    const k = f.t / 0.08;
    if (k >= 1) {
      f.on = false;
      fx.flashMesh.setMatrixAt(i, HIDE);
      continue;
    }
    d.position.set(f.x, f.y, f.z);
    d.rotation.set(0, 0, f.t * 30);
    d.scale.setScalar((1 - k) * 1.5 + 0.3);
    d.updateMatrix();
    fx.flashMesh.setMatrixAt(i, d.matrix);
  }
  fx.flashMesh.instanceMatrix.needsUpdate = true;

  // sparks
  for (let i = 0; i < fx.sparkList.length; i++) {
    const s = fx.sparkList[i];
    if (!s.on) {
      fx.sparkMesh.setMatrixAt(i, HIDE);
      continue;
    }
    s.t += dt;
    if (s.t >= s.life) {
      s.on = false;
      fx.sparkMesh.setMatrixAt(i, HIDE);
      continue;
    }
    s.vy -= 16 * dt;
    s.x += s.vx * dt;
    s.y += s.vy * dt;
    s.z += s.vz * dt;
    const k = 1 - s.t / s.life;
    d.position.set(s.x, Math.max(0.05, s.y), s.z);
    d.rotation.set(s.t * 9, s.t * 7, 0);
    d.scale.setScalar(s.size * k);
    d.updateMatrix();
    fx.sparkMesh.setMatrixAt(i, d.matrix);
  }
  fx.sparkMesh.instanceMatrix.needsUpdate = true;

  // damage numbers
  for (const n of fx.numberList) {
    if (!n.sprite.visible) continue;
    n.t += dt;
    if (n.t >= n.life) {
      n.sprite.visible = false;
      continue;
    }
    const k = n.t / n.life;
    n.sprite.position.set(n.x, n.y + k * 2.4, n.z);
    n.sprite.material.opacity = 1 - k * k;
  }
}
