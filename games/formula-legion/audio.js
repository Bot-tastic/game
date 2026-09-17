// audio.js — Web Audio synth for Formula Legion. Everything is generated at
// runtime (no sample files). Nothing is created until unlock() is called from
// a real user gesture.

let ctx = null;
let master = null;
let musicGain = null;
let sfxGain = null;
let noiseBuf = null;
let muted = false;
let musicTimer = null;
let step = 0;

const SCALE = [0, 3, 5, 7, 10, 12, 15]; // minor pentatonic-ish

function noise() {
  if (noiseBuf) return noiseBuf;
  const len = Math.floor(ctx.sampleRate * 0.5);
  noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  return noiseBuf;
}

/** Create/resume the audio graph. Must be called from a user gesture. */
export function unlock() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);
    musicGain = ctx.createGain();
    musicGain.gain.value = 0.16;
    musicGain.connect(master);
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.8;
    sfxGain.connect(master);
  }
  if (ctx.state === "suspended") ctx.resume();
  return true;
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
  return muted;
}

function tone({ freq, type = "sine", t0 = 0, dur = 0.2, gain = 0.3, slideTo = null, dest = null }) {
  if (!ctx) return;
  const now = ctx.currentTime + t0;
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, now);
  if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), now + dur);
  g.gain.setValueAtTime(0.0001, now);
  g.gain.exponentialRampToValueAtTime(gain, now + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  osc.connect(g);
  g.connect(dest || sfxGain);
  osc.start(now);
  osc.stop(now + dur + 0.05);
}

function burst({ t0 = 0, dur = 0.18, gain = 0.3, freq = 1200, q = 1, type = "bandpass", sweepTo = null }) {
  if (!ctx) return;
  const now = ctx.currentTime + t0;
  const src = ctx.createBufferSource();
  src.buffer = noise();
  src.playbackRate.value = 0.8 + Math.random() * 0.5;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(freq, now);
  filt.Q.value = q;
  if (sweepTo) filt.frequency.exponentialRampToValueAtTime(Math.max(60, sweepTo), now + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now);
  g.gain.exponentialRampToValueAtTime(0.0001, now + dur);
  src.connect(filt);
  filt.connect(g);
  g.connect(sfxGain);
  src.start(now);
  src.stop(now + dur + 0.05);
}

// ---- game sounds ----

/** Gunfire whose body scales with how many units are firing. */
export function gunfire(count, tier) {
  if (!ctx) return;
  const layers = Math.min(4, 1 + Math.floor(Math.log2(Math.max(1, count))));
  const base = 900 + tier * 220;
  for (let i = 0; i < layers; i++) {
    burst({ t0: i * 0.012, dur: 0.06 + i * 0.02, gain: 0.1 / (i + 1), freq: base / (i + 1), q: 1.6 });
  }
  tone({ freq: 90 + tier * 8, type: "square", dur: 0.07, gain: 0.05 + Math.min(0.09, count / 900), slideTo: 45 });
}

export function gateChime(good) {
  if (!ctx) return;
  const root = good ? 523 : 330;
  const steps = good ? [0, 4, 7] : [0, -3, -7];
  steps.forEach((s, i) => {
    tone({ freq: root * Math.pow(2, s / 12), type: "triangle", t0: i * 0.05, dur: 0.3, gain: 0.22 });
  });
}

export function coin() {
  tone({ freq: 1320, type: "square", dur: 0.09, gain: 0.12 });
  tone({ freq: 1980, type: "square", t0: 0.06, dur: 0.1, gain: 0.1 });
}

export function crack() {
  burst({ dur: 0.09, gain: 0.16, freq: 2600, q: 0.8, type: "highpass" });
}

export function shatter() {
  burst({ dur: 0.5, gain: 0.34, freq: 3200, sweepTo: 180, type: "lowpass", q: 2 });
  tone({ freq: 160, type: "sawtooth", dur: 0.4, gain: 0.2, slideTo: 40 });
}

export function hurt() {
  tone({ freq: 260, type: "sawtooth", dur: 0.32, gain: 0.26, slideTo: 70 });
  burst({ dur: 0.25, gain: 0.18, freq: 500, type: "lowpass" });
}

export function shield() {
  tone({ freq: 700, type: "sine", dur: 0.35, gain: 0.25, slideTo: 1500 });
}

export function upgrade() {
  [0, 5, 9, 12].forEach((s, i) =>
    tone({ freq: 440 * Math.pow(2, s / 12), type: "triangle", t0: i * 0.06, dur: 0.35, gain: 0.2 })
  );
}

export function fanfare() {
  [0, 4, 7, 12, 16].forEach((s, i) => {
    tone({ freq: 392 * Math.pow(2, s / 12), type: "triangle", t0: i * 0.09, dur: 0.6, gain: 0.22 });
    tone({ freq: 196 * Math.pow(2, s / 12), type: "sine", t0: i * 0.09, dur: 0.6, gain: 0.14 });
  });
}

export function defeat() {
  [0, -2, -5, -12].forEach((s, i) =>
    tone({ freq: 330 * Math.pow(2, s / 12), type: "sawtooth", t0: i * 0.16, dur: 0.7, gain: 0.2 })
  );
}

// ---- music bed ----

function musicStep(intensity) {
  if (!ctx) return;
  const bar = Math.floor(step / 8) % 4;
  const roots = [55, 65.4, 49, 58.3];
  const root = roots[bar];
  // bass pulse
  if (step % 2 === 0) {
    tone({ freq: root, type: "sawtooth", dur: 0.28, gain: 0.28, dest: musicGain });
  }
  // arp
  const n = SCALE[(step * 3) % SCALE.length];
  tone({
    freq: root * 4 * Math.pow(2, n / 12),
    type: "triangle",
    dur: 0.22,
    gain: 0.12 + intensity * 0.08,
    dest: musicGain,
  });
  if (step % 4 === 2) burst({ dur: 0.05, gain: 0.04 + intensity * 0.04, freq: 6000, type: "highpass" });
  step++;
}

export function startMusic() {
  if (!ctx || musicTimer) return;
  step = 0;
  musicTimer = setInterval(() => musicStep(intensityLevel), 145);
}

export function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = null;
}

let intensityLevel = 0;
/** 0..1 — nudges the music bed's brightness as levels get harder. */
export function setIntensity(v) {
  intensityLevel = Math.max(0, Math.min(1, v));
}
