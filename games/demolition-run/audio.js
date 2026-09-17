// audio.js — everything you hear is synthesised with the Web Audio API.
// The context is only created on a user gesture (autoplay policy), and the
// whole thing routes through one master gain so muting is a single ramp.

let ctx = null;
let master = null;
let musicGain = null;
let engine = null;
let muted = false;
let musicTimer = null;
let step = 0;

function now() {
  return ctx.currentTime;
}

function noiseBuffer(seconds = 1) {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

let sharedNoise = null;

/** Create the audio graph. Must be called from a user-gesture handler. */
export function initAudio() {
  if (ctx) {
    if (ctx.state === "suspended") ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();

  master = ctx.createGain();
  master.gain.value = muted ? 0 : 0.85;
  master.connect(ctx.destination);

  sharedNoise = noiseBuffer(2);

  // ---- engine: two detuned saws through a moving lowpass, plus intake noise
  const engGain = ctx.createGain();
  engGain.gain.value = 0;
  const engFilter = ctx.createBiquadFilter();
  engFilter.type = "lowpass";
  engFilter.frequency.value = 700;
  engFilter.Q.value = 6;
  engGain.connect(engFilter);
  engFilter.connect(master);

  const oscA = ctx.createOscillator();
  oscA.type = "sawtooth";
  const oscB = ctx.createOscillator();
  oscB.type = "square";
  oscB.detune.value = -12;
  const subOsc = ctx.createOscillator();
  subOsc.type = "triangle";

  const subGain = ctx.createGain();
  subGain.gain.value = 0.5;
  subOsc.connect(subGain);
  subGain.connect(engGain);
  oscA.connect(engGain);
  const bGain = ctx.createGain();
  bGain.gain.value = 0.35;
  oscB.connect(bGain);
  bGain.connect(engGain);

  const intake = ctx.createBufferSource();
  intake.buffer = sharedNoise;
  intake.loop = true;
  const intakeFilter = ctx.createBiquadFilter();
  intakeFilter.type = "bandpass";
  intakeFilter.frequency.value = 900;
  intakeFilter.Q.value = 1.2;
  const intakeGain = ctx.createGain();
  intakeGain.gain.value = 0;
  intake.connect(intakeFilter);
  intakeFilter.connect(intakeGain);
  intakeGain.connect(master);

  // ---- tyre squeal: resonant band-passed noise, gated by the drift amount
  const squeal = ctx.createBufferSource();
  squeal.buffer = sharedNoise;
  squeal.loop = true;
  const squealFilter = ctx.createBiquadFilter();
  squealFilter.type = "bandpass";
  squealFilter.frequency.value = 2400;
  squealFilter.Q.value = 12;
  const squealGain = ctx.createGain();
  squealGain.gain.value = 0;
  squeal.connect(squealFilter);
  squealFilter.connect(squealGain);
  squealGain.connect(master);

  oscA.start();
  oscB.start();
  subOsc.start();
  intake.start();
  squeal.start();

  engine = { oscA, oscB, subOsc, engGain, engFilter, intakeGain, intakeFilter, squealGain, squealFilter };

  musicGain = ctx.createGain();
  musicGain.gain.value = 0.0;
  musicGain.connect(master);
}

export function isMuted() {
  return muted;
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.setTargetAtTime(muted ? 0 : 0.85, now(), 0.05);
  return muted;
}

/** Engine tone tracks speed; `load` widens the filter under boost. */
export function updateEngine(speedNorm, boosting, driftAmount, alive) {
  if (!ctx || !engine) return;
  const t = now();
  const rpm = 60 + speedNorm * 150 + (boosting ? 40 : 0);
  engine.oscA.frequency.setTargetAtTime(rpm, t, 0.08);
  engine.oscB.frequency.setTargetAtTime(rpm * 1.5, t, 0.08);
  engine.subOsc.frequency.setTargetAtTime(rpm * 0.5, t, 0.08);
  engine.engFilter.frequency.setTargetAtTime(500 + speedNorm * 1800 + (boosting ? 900 : 0), t, 0.1);
  engine.engGain.gain.setTargetAtTime(alive ? 0.075 + speedNorm * 0.05 : 0, t, 0.15);
  engine.intakeGain.gain.setTargetAtTime(alive ? speedNorm * 0.035 + (boosting ? 0.05 : 0) : 0, t, 0.12);
  engine.intakeFilter.frequency.setTargetAtTime(600 + speedNorm * 2200, t, 0.12);
  engine.squealGain.gain.setTargetAtTime(alive ? driftAmount * 0.09 : 0, t, 0.06);
  engine.squealFilter.frequency.setTargetAtTime(1800 + driftAmount * 1800, t, 0.08);
}

function burst({ duration = 0.3, freq = 400, type = "lowpass", q = 1, gain = 0.5, curve = 0.5 }) {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.setValueAtTime(freq, now());
  f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * curve), now() + duration);
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0008, now() + duration);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start();
  src.stop(now() + duration + 0.02);
}

function tone({ freq = 200, endFreq = 60, duration = 0.2, type = "sine", gain = 0.3 }) {
  if (!ctx) return;
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, now());
  o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), now() + duration);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, now());
  g.gain.exponentialRampToValueAtTime(0.0008, now() + duration);
  o.connect(g);
  g.connect(master);
  o.start();
  o.stop(now() + duration + 0.02);
}

/** Impact sounds, flavoured per prop material. */
export function playImpact(kind, force = 1) {
  if (!ctx) return;
  const f = Math.min(1.6, 0.5 + force);
  switch (kind) {
    case "glass":
      burst({ duration: 0.45, freq: 6500, type: "highpass", q: 0.7, gain: 0.32 * f, curve: 0.5 });
      for (let i = 0; i < 5; i++) {
        setTimeout(() => tone({ freq: 2200 + Math.random() * 3600, endFreq: 1400, duration: 0.09, type: "triangle", gain: 0.07 * f }), i * 45);
      }
      break;
    case "wood":
      burst({ duration: 0.22, freq: 1400, type: "bandpass", q: 1.4, gain: 0.34 * f, curve: 0.3 });
      tone({ freq: 190, endFreq: 60, duration: 0.18, type: "square", gain: 0.13 * f });
      break;
    case "metal":
      burst({ duration: 0.3, freq: 3200, type: "bandpass", q: 3, gain: 0.26 * f, curve: 0.4 });
      tone({ freq: 850, endFreq: 300, duration: 0.3, type: "triangle", gain: 0.12 * f });
      break;
    case "soft":
      burst({ duration: 0.25, freq: 700, type: "lowpass", q: 0.8, gain: 0.3 * f, curve: 0.3 });
      break;
    case "heavy":
      burst({ duration: 0.5, freq: 900, type: "lowpass", q: 1.2, gain: 0.45 * f, curve: 0.22 });
      tone({ freq: 110, endFreq: 38, duration: 0.45, type: "sine", gain: 0.42 * f });
      break;
    default:
      burst({ duration: 0.25, freq: 1200, type: "lowpass", q: 1, gain: 0.3 * f, curve: 0.35 });
  }
}

export function playBoost() {
  if (!ctx) return;
  const src = ctx.createBufferSource();
  src.buffer = sharedNoise;
  const f = ctx.createBiquadFilter();
  f.type = "bandpass";
  f.Q.value = 2.5;
  f.frequency.setValueAtTime(320, now());
  f.frequency.exponentialRampToValueAtTime(5200, now() + 0.45);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0008, now());
  g.gain.exponentialRampToValueAtTime(0.3, now() + 0.12);
  g.gain.exponentialRampToValueAtTime(0.0008, now() + 0.55);
  src.connect(f);
  f.connect(g);
  g.connect(master);
  src.start();
  src.stop(now() + 0.6);
}

export function playLanding(force = 1) {
  playImpact("heavy", force * 0.8);
  burst({ duration: 0.18, freq: 2600, type: "highpass", q: 1, gain: 0.16 * force });
}

export function playPickup() {
  if (!ctx) return;
  [660, 880, 1320].forEach((fr, i) =>
    setTimeout(() => tone({ freq: fr, endFreq: fr, duration: 0.14, type: "triangle", gain: 0.16 }), i * 70)
  );
}

export function playCombo(level) {
  if (!ctx) return;
  const base = 420 * Math.pow(1.09, Math.min(level, 24));
  tone({ freq: base, endFreq: base * 1.5, duration: 0.14, type: "square", gain: 0.1 });
}

export function playRampage() {
  if (!ctx) return;
  [220, 330, 440, 660].forEach((fr, i) =>
    setTimeout(() => tone({ freq: fr, endFreq: fr * 2, duration: 0.3, type: "sawtooth", gain: 0.13 }), i * 90)
  );
}

export function playCrash() {
  if (!ctx) return;
  playImpact("heavy", 1.6);
  burst({ duration: 1.2, freq: 1800, type: "lowpass", q: 0.7, gain: 0.4, curve: 0.08 });
  tone({ freq: 300, endFreq: 30, duration: 1.1, type: "sawtooth", gain: 0.25 });
}

// ---- music bed: a slow synthwave arpeggio over a pulsing bass ----
const SCALE = [0, 3, 5, 7, 10, 12, 15];
const ROOTS = [55, 55, 73.42, 65.41];

function musicStep() {
  if (!ctx || !musicGain) return;
  const bar = Math.floor(step / 8) % ROOTS.length;
  const root = ROOTS[bar];
  const t = now();

  // bass pulse on every other step
  if (step % 2 === 0) {
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.value = root;
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(240, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 0.28);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0008, t);
    g.gain.exponentialRampToValueAtTime(0.5, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.3);
    o.connect(f);
    f.connect(g);
    g.connect(musicGain);
    o.start(t);
    o.stop(t + 0.34);
  }

  // arpeggio
  const note = SCALE[(step * 3) % SCALE.length];
  const freq = root * 4 * Math.pow(2, note / 12);
  const o = ctx.createOscillator();
  o.type = "triangle";
  o.frequency.value = freq;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0008, t);
  g.gain.exponentialRampToValueAtTime(0.16, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0008, t + 0.42);
  o.connect(g);
  g.connect(musicGain);
  o.start(t);
  o.stop(t + 0.46);

  // hat
  if (step % 2 === 1) burst({ duration: 0.05, freq: 9000, type: "highpass", q: 1, gain: 0.05 });

  step++;
}

export function startMusic() {
  if (!ctx || musicTimer) return;
  musicGain.gain.setTargetAtTime(0.5, now(), 1.2);
  musicTimer = setInterval(musicStep, 250);
}

export function stopMusic() {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  if (musicGain && ctx) musicGain.gain.setTargetAtTime(0, now(), 0.3);
}

export function setMusicIntensity(v) {
  if (!ctx || !musicGain) return;
  musicGain.gain.setTargetAtTime(0.32 + v * 0.35, now(), 0.5);
}
