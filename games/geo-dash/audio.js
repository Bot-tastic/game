// audio.js — a tiny synth + step sequencer built on Web Audio. No files: every
// sound here is oscillators and shaped noise, so nothing can 404 or rot.
//
// Each level theme picks a root note, a chord progression and a drum intensity,
// which is enough to give the ten levels distinct musical identities without
// shipping ten hand-written songs. The transport is a 25ms lookahead scheduler
// (the standard Web Audio pattern — setTimeout drift never reaches the notes).

import { loadHighScore, saveHighScore } from "../../shared/game-utils.js";
import { storeKey } from "./levels.js";

const SEMI = (n) => 440 * Math.pow(2, n / 12);

// Minor-ish progressions, as semitone offsets from the level root.
const PROGRESSIONS = [
  [0, -3, -5, -7],
  [0, -5, -3, -7],
  [0, 0, -4, -2],
  [0, -7, -5, -3],
];

// 16-step bass rhythms (1 = note on).
const BASS_PATTERNS = [
  [1, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1, 0, 0, 1, 0],
  [1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1],
  [1, 0, 0, 0, 1, 0, 1, 0, 1, 0, 0, 0, 1, 1, 0, 0],
];

const LEAD_PATTERNS = [
  [0, 3, 7, 3, 10, 7, 3, 0, 0, 5, 7, 12, 10, 7, 5, 3],
  [12, 10, 7, 10, 12, 15, 12, 10, 7, 5, 7, 10, 12, 10, 7, 5],
  [0, 7, 12, 7, 0, 7, 12, 15, 14, 12, 10, 7, 5, 7, 10, 12],
];

export function createAudio() {
  let ctx = null;
  let master = null;
  let musicGain = null;
  let sfxGain = null;
  let noiseBuf = null;
  let timer = null;

  let muted = loadHighScore(storeKey("muted"), 0) === 1;
  let theme = null;
  let step16 = 0;
  let nextNoteTime = 0;
  let stepDur = 0.125;
  let playing = false;
  let startTime = 0;

  function ensure() {
    if (ctx) return ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(ctx.destination);

    musicGain = ctx.createGain();
    musicGain.gain.value = 0.34;
    musicGain.connect(master);

    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.85;
    sfxGain.connect(master);

    const len = Math.floor(ctx.sampleRate * 1.2);
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    return ctx;
  }

  function noise(dest, t, dur, { hp = 0, lp = 18000, gain = 0.3, q = 1 } = {}) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.playbackRate.value = 1;
    let node = src;
    if (hp) {
      const f = ctx.createBiquadFilter();
      f.type = "highpass";
      f.frequency.value = hp;
      f.Q.value = q;
      node.connect(f);
      node = f;
    }
    if (lp < 18000) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.value = lp;
      node.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(dest);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  function tone(dest, t, dur, freq, { type = "sawtooth", gain = 0.2, lp = 0, detune = 0, slideTo = 0, attack = 0.005 } = {}) {
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    osc.detune.value = detune;
    let node = osc;
    if (lp) {
      const f = ctx.createBiquadFilter();
      f.type = "lowpass";
      f.frequency.setValueAtTime(lp, t);
      f.frequency.exponentialRampToValueAtTime(Math.max(200, lp * 0.35), t + dur);
      f.Q.value = 6;
      osc.connect(f);
      node = f;
    }
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    node.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  function kick(t, strength = 1) {
    const osc = ctx.createOscillator();
    osc.type = "sine";
    osc.frequency.setValueAtTime(170, t);
    osc.frequency.exponentialRampToValueAtTime(42, t + 0.13);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.9 * strength, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    osc.connect(g);
    g.connect(musicGain);
    osc.start(t);
    osc.stop(t + 0.24);
    noise(musicGain, t, 0.03, { hp: 1200, gain: 0.12 * strength });
  }

  function snare(t) {
    noise(musicGain, t, 0.16, { hp: 1400, lp: 8000, gain: 0.34 });
    tone(musicGain, t, 0.1, 190, { type: "triangle", gain: 0.12, slideTo: 120 });
  }

  function hat(t, open) {
    noise(musicGain, t, open ? 0.12 : 0.035, { hp: 7000, gain: open ? 0.1 : 0.075 });
  }

  function scheduleStep(s, t) {
    if (!theme) return;
    const prog = PROGRESSIONS[theme.prog];
    const bar = Math.floor(step16 / 16) % 4;
    const chordRoot = theme.root + prog[bar];
    const bassPat = BASS_PATTERNS[theme.bass];
    const leadPat = LEAD_PATTERNS[theme.lead];
    const i = s % 16;

    // Drums
    if (i % 4 === 0) kick(t, i === 0 ? 1 : 0.85);
    if (theme.energy > 1 && i === 10) kick(t, 0.6);
    if (i === 4 || i === 12) snare(t);
    if (theme.energy > 0 && i % 2 === 1) hat(t, i === 7 || i === 15);
    if (theme.energy > 2 && i % 2 === 0) hat(t, false);

    // Bass
    if (bassPat[i]) {
      tone(musicGain, t, stepDur * 1.7, SEMI(chordRoot - 24), {
        type: "sawtooth",
        gain: 0.3,
        lp: 520 + theme.energy * 130,
      });
    }

    // Chord stabs on the off-beats
    if (i % 8 === 2 || i % 8 === 6) {
      for (const iv of [0, 3, 7]) {
        tone(musicGain, t, stepDur * 1.3, SEMI(chordRoot - 12 + iv), {
          type: "triangle",
          gain: 0.075,
          detune: iv === 3 ? 6 : 0,
        });
      }
    }

    // Lead arpeggio
    if (theme.energy > 0) {
      const n = leadPat[i];
      tone(musicGain, t, stepDur * 1.1, SEMI(chordRoot + n), {
        type: theme.energy > 2 ? "square" : "sawtooth",
        gain: 0.085,
        lp: 2600,
      });
      if (theme.energy > 1) {
        tone(musicGain, t + stepDur * 0.5, stepDur * 0.9, SEMI(chordRoot + n + 12), {
          type: "square",
          gain: 0.035,
          lp: 4200,
        });
      }
    }
  }

  function tick() {
    if (!playing || !ctx) return;
    while (nextNoteTime < ctx.currentTime + 0.18) {
      scheduleStep(step16, nextNoteTime);
      nextNoteTime += stepDur;
      step16++;
    }
  }

  return {
    get muted() {
      return muted;
    },
    get ready() {
      return !!ctx;
    },

    /** Must be called from a user gesture before anything will sound. */
    unlock() {
      const c = ensure();
      if (c && c.state === "suspended") c.resume();
      return !!c;
    },

    toggleMute() {
      muted = !muted;
      saveHighScore(storeKey("muted"), muted ? 1 : 0);
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, ctx.currentTime, 0.02);
      return muted;
    },

    playTheme(def) {
      if (!ensure()) return;
      const id = def.id;
      theme = {
        root: [0, 2, -1, 3, 1, -2, 4, 2, 0, -3][(id - 1) % 10] - 5,
        prog: (id - 1) % PROGRESSIONS.length,
        bass: (id - 1) % BASS_PATTERNS.length,
        lead: Math.floor((id - 1) / 3) % LEAD_PATTERNS.length,
        energy: Math.min(3, Math.floor((id - 1) / 3)),
      };
      stepDur = 60 / def.bpm / 4;
      step16 = 0;
      nextNoteTime = ctx.currentTime + 0.08;
      startTime = nextNoteTime;
      playing = true;
      clearInterval(timer);
      timer = setInterval(tick, 25);
      tick();
    },

    stop() {
      playing = false;
      clearInterval(timer);
      timer = null;
    },

    /** Seconds since the loop's downbeat — drives the on-beat visual pulse. */
    elapsed() {
      return ctx && playing ? ctx.currentTime - startTime : 0;
    },

    sfx(name, opt = {}) {
      if (!ctx || muted) return;
      const t = ctx.currentTime + 0.001;
      if (name === "jump") {
        tone(sfxGain, t, 0.09, 420, { type: "square", gain: 0.1, slideTo: 760 });
      } else if (name === "land") {
        noise(sfxGain, t, 0.07, { hp: 200, lp: 2400, gain: 0.14 });
      } else if (name === "pad") {
        tone(sfxGain, t, 0.3, 260, { type: "sawtooth", gain: 0.16, slideTo: 1400, lp: 3000 });
        noise(sfxGain, t, 0.22, { hp: 2000, gain: 0.1 });
      } else if (name === "orb") {
        tone(sfxGain, t, 0.26, 880, { type: "sine", gain: 0.16, slideTo: 1320 });
        tone(sfxGain, t, 0.26, 1320, { type: "sine", gain: 0.08 });
      } else if (name === "coin") {
        tone(sfxGain, t, 0.07, 1180, { type: "square", gain: 0.1 });
        tone(sfxGain, t + 0.06, 0.14, 1760, { type: "square", gain: 0.1 });
      } else if (name === "portal") {
        noise(sfxGain, t, 0.45, { hp: 400, lp: 6000, gain: 0.16 });
        for (let i = 0; i < 3; i++) {
          tone(sfxGain, t + i * 0.04, 0.4, SEMI(-9 + i * 7), { type: "sawtooth", gain: 0.09, lp: 2400 });
        }
      } else if (name === "die") {
        noise(sfxGain, t, 0.5, { hp: 100, lp: 3000, gain: 0.34 });
        tone(sfxGain, t, 0.45, 340, { type: "sawtooth", gain: 0.22, slideTo: 45, lp: 1600 });
      } else if (name === "win") {
        [0, 4, 7, 12, 16, 19].forEach((n, i) => {
          tone(sfxGain, t + i * 0.09, 0.4, SEMI(n), { type: "square", gain: 0.13, lp: 4000 });
        });
      } else if (name === "checkpoint") {
        tone(sfxGain, t, 0.16, 660, { type: "triangle", gain: 0.13 });
        tone(sfxGain, t + 0.1, 0.22, 990, { type: "triangle", gain: 0.13 });
      } else if (name === "click") {
        tone(sfxGain, t, 0.05, 520 * (opt.up ? 1.4 : 1), { type: "square", gain: 0.07 });
      }
    },
  };
}
