// Web Audio synthesis. No files, so nothing can 404 and nothing to preload.
// Everything is rate-limited: a late round fires hundreds of shots a second and
// one oscillator per shot would both sound awful and stall the audio thread.

let ctx = null;
let master = null;
let muted = false;
const lastPlayed = new Map();

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.35;
  master.connect(ctx.destination);
  return ctx;
}

export function resumeAudio() {
  const c = ensure();
  if (c && c.state === "suspended") c.resume();
}

export function setMuted(value) {
  muted = value;
  if (master) master.gain.value = muted ? 0 : 0.35;
}

export function isMuted() {
  return muted;
}

/** Returns false when this sound played too recently to play again. */
function throttle(key, minGap) {
  const now = ctx.currentTime;
  const last = lastPlayed.get(key) ?? -1;
  if (now - last < minGap) return false;
  lastPlayed.set(key, now);
  return true;
}

function tone({ freq, freq2, type = "sine", dur = 0.12, gain = 0.3, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (freq2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, freq2), t0 + dur);
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  osc.connect(g).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.02);
}

function noise({ dur = 0.2, gain = 0.3, filterFreq = 1200, delay = 0 }) {
  const c = ensure();
  if (!c || muted) return;
  const t0 = c.currentTime + delay;
  const frames = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, frames, c.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < frames; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / frames);
  const src = c.createBufferSource();
  src.buffer = buf;
  const filter = c.createBiquadFilter();
  filter.type = "lowpass";
  filter.frequency.setValueAtTime(filterFreq, t0);
  const g = c.createGain();
  g.gain.setValueAtTime(gain, t0);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  src.connect(filter).connect(g).connect(master);
  src.start(t0);
}

export const sfx = {
  pop() {
    if (!ensure() || !throttle("pop", 0.035)) return;
    tone({ freq: 620 + Math.random() * 380, freq2: 180, type: "triangle", dur: 0.07, gain: 0.16 });
  },
  shoot() {
    if (!ensure() || !throttle("shoot", 0.06)) return;
    tone({ freq: 900, freq2: 420, type: "square", dur: 0.04, gain: 0.05 });
  },
  blast() {
    if (!ensure() || !throttle("blast", 0.08)) return;
    noise({ dur: 0.22, gain: 0.22, filterFreq: 900 });
  },
  moabPop() {
    if (!ensure()) return;
    noise({ dur: 0.6, gain: 0.4, filterFreq: 600 });
    tone({ freq: 180, freq2: 40, type: "sawtooth", dur: 0.5, gain: 0.25 });
  },
  leak() {
    if (!ensure() || !throttle("leak", 0.12)) return;
    tone({ freq: 240, freq2: 90, type: "sawtooth", dur: 0.28, gain: 0.22 });
  },
  build() {
    tone({ freq: 420, freq2: 720, type: "sine", dur: 0.14, gain: 0.25 });
  },
  upgrade() {
    tone({ freq: 520, freq2: 900, type: "sine", dur: 0.12, gain: 0.22 });
    tone({ freq: 780, freq2: 1180, type: "sine", dur: 0.14, gain: 0.18, delay: 0.08 });
  },
  sell() {
    tone({ freq: 500, freq2: 260, type: "sine", dur: 0.16, gain: 0.2 });
  },
  denied() {
    tone({ freq: 180, freq2: 140, type: "square", dur: 0.12, gain: 0.16 });
  },
  ability() {
    if (!ensure()) return;
    noise({ dur: 0.35, gain: 0.26, filterFreq: 2400 });
    tone({ freq: 300, freq2: 1200, type: "sawtooth", dur: 0.3, gain: 0.22 });
    tone({ freq: 900, freq2: 1600, type: "triangle", dur: 0.25, gain: 0.16, delay: 0.06 });
  },
  roundStart() {
    tone({ freq: 330, freq2: 495, type: "triangle", dur: 0.2, gain: 0.24 });
  },
  roundEnd() {
    [523, 659, 784].forEach((f, i) =>
      tone({ freq: f, type: "triangle", dur: 0.22, gain: 0.2, delay: i * 0.09 }));
  },
  victory() {
    [523, 659, 784, 1046].forEach((f, i) =>
      tone({ freq: f, type: "triangle", dur: 0.4, gain: 0.26, delay: i * 0.14 }));
  },
  defeat() {
    [392, 330, 262].forEach((f, i) =>
      tone({ freq: f, freq2: f * 0.6, type: "sawtooth", dur: 0.5, gain: 0.22, delay: i * 0.18 }));
  },
};
