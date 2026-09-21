// audio.js — everything is synthesised at runtime (Web Audio oscillators and
// shaped noise), so there are no files to 404 and nothing to preload.
//
// The star is the engine: two detuned saws through a lowpass, with pitch and
// filter cutoff driven continuously by wheel speed, plus a separate noise bed
// for wheelspin. Sound effects are one-shots on a shared bus. Mute state is
// persisted next to the rest of the game's storage.

import { loadHighScore, saveHighScore } from "../../shared/game-utils.js";
import { storeKey } from "./stages.js";

export function createAudio() {
  let ctx = null;
  let master = null;
  let sfxGain = null;
  let engine = null;
  let noiseBuf = null;
  let muted = loadHighScore(storeKey("muted"), 0) === 1;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.8;
    sfxGain.connect(master);

    const len = Math.floor(ctx.sampleRate * 1.5);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noiseSource() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    return src;
  }

  function buildEngine() {
    if (engine) return engine;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(master);

    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 500;
    lp.Q.value = 6;
    lp.connect(out);

    const oscA = ctx.createOscillator();
    oscA.type = "sawtooth";
    const oscB = ctx.createOscillator();
    oscB.type = "square";
    oscB.detune.value = -9;
    const gA = ctx.createGain();
    gA.gain.value = 0.5;
    const gB = ctx.createGain();
    gB.gain.value = 0.28;
    oscA.connect(gA).connect(lp);
    oscB.connect(gB).connect(lp);
    oscA.start();
    oscB.start();

    // Wheelspin/road bed: filtered noise whose level follows tyre slip.
    const spin = ctx.createGain();
    spin.gain.value = 0;
    const spinFilter = ctx.createBiquadFilter();
    spinFilter.type = "bandpass";
    spinFilter.frequency.value = 1400;
    spinFilter.Q.value = 0.8;
    const spinSrc = noiseSource();
    spinSrc.connect(spinFilter).connect(spin).connect(master);
    spinSrc.start();

    engine = { out, lp, oscA, oscB, spin };
    return engine;
  }

  function env(node, t, a, d, peak) {
    node.gain.cancelScheduledValues(t);
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + d);
  }

  function tone(freq, { type = "sine", dur = 0.18, gain = 0.3, slide = 0, delay = 0 } = {}) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    const g = ctx.createGain();
    env(g, t, 0.012, dur, gain);
    osc.connect(g).connect(sfxGain);
    osc.start(t);
    osc.stop(t + dur + 0.08);
  }

  function thud(level = 1) {
    if (!ensure() || muted) return;
    const t = ctx.currentTime;
    const src = noiseSource();
    const f = ctx.createBiquadFilter();
    f.type = "lowpass";
    f.frequency.setValueAtTime(700 * level, t);
    f.frequency.exponentialRampToValueAtTime(90, t + 0.3);
    const g = ctx.createGain();
    env(g, t, 0.006, 0.28, 0.5 * level);
    src.connect(f).connect(g).connect(sfxGain);
    src.start(t);
    src.stop(t + 0.4);
  }

  const SFX = {
    coin: () => {
      tone(1180, { type: "triangle", dur: 0.09, gain: 0.22 });
      tone(1760, { type: "triangle", dur: 0.12, gain: 0.18, delay: 0.06 });
    },
    fuel: () => {
      tone(420, { type: "sine", dur: 0.14, gain: 0.26, slide: 420 });
      tone(880, { type: "sine", dur: 0.2, gain: 0.2, delay: 0.1 });
    },
    click: () => tone(560, { type: "square", dur: 0.06, gain: 0.14 }),
    buy: () => {
      tone(520, { type: "square", dur: 0.09, gain: 0.2 });
      tone(780, { type: "square", dur: 0.14, gain: 0.18, delay: 0.07 });
      tone(1040, { type: "square", dur: 0.2, gain: 0.16, delay: 0.15 });
    },
    deny: () => tone(150, { type: "square", dur: 0.2, gain: 0.2, slide: -60 }),
    land: () => thud(1),
    bigland: () => {
      thud(1.4);
      tone(90, { type: "sine", dur: 0.3, gain: 0.35, slide: -40 });
    },
    flip: () => {
      tone(660, { type: "triangle", dur: 0.12, gain: 0.2 });
      tone(990, { type: "triangle", dur: 0.16, gain: 0.18, delay: 0.08 });
    },
    crash: () => {
      thud(1.6);
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      const src = noiseSource();
      const f = ctx.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.setValueAtTime(2200, t);
      f.frequency.exponentialRampToValueAtTime(240, t + 0.5);
      const g = ctx.createGain();
      env(g, t, 0.01, 0.5, 0.42);
      src.connect(f).connect(g).connect(sfxGain);
      src.start(t);
      src.stop(t + 0.6);
    },
    dry: () => {
      // Out of fuel: a couple of dying cranks.
      tone(220, { type: "sawtooth", dur: 0.16, gain: 0.2, slide: -120 });
      tone(190, { type: "sawtooth", dur: 0.2, gain: 0.16, slide: -110, delay: 0.24 });
    },
    warn: () => tone(740, { type: "square", dur: 0.1, gain: 0.16 }),
  };

  return {
    unlock() {
      const c = ensure();
      if (c && c.state === "suspended") c.resume();
    },
    sfx(name) {
      if (!ensure() || muted) return;
      const fn = SFX[name];
      if (fn) fn();
    },
    /**
     * Continuous engine voice. `rpm` is wheel spin in rad/s, `load` 0..1 is
     * how hard the throttle is down, `slip` 0..1 how much the tyres are
     * losing. Called once per frame; all values are ramped, never stepped.
     */
    engine(rpm, load, slip, running) {
      if (!ctx || muted) return;
      const e = buildEngine();
      const t = ctx.currentTime;
      const target = running ? 0.055 + load * 0.075 : 0;
      const freq = 46 + Math.min(rpm, 90) * 3.1;
      e.oscA.frequency.setTargetAtTime(freq, t, 0.06);
      e.oscB.frequency.setTargetAtTime(freq * 0.5, t, 0.06);
      e.lp.frequency.setTargetAtTime(360 + Math.min(rpm, 90) * 26 + load * 300, t, 0.08);
      e.out.gain.setTargetAtTime(target, t, 0.09);
      e.spin.gain.setTargetAtTime(running ? slip * 0.06 : 0, t, 0.08);
    },
    stopEngine() {
      if (!ctx || !engine) return;
      engine.out.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
      engine.spin.gain.setTargetAtTime(0, ctx.currentTime, 0.08);
    },
    get muted() {
      return muted;
    },
    toggleMute() {
      muted = !muted;
      saveHighScore(storeKey("muted"), muted ? 1 : 0);
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.05);
      return muted;
    },
  };
}
