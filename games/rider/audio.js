// WebAudio synth: engine drone, sound effects and a small procedural soundtrack.

const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);

export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.musicRoot = 57;
    this._musicTimer = null;
    this._step = 0;
    this._nextTime = 0;
    this.musicWanted = false;
  }

  unlock() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      const comp = ctx.createDynamicsCompressor();
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(comp);
      this.sfxBus = ctx.createGain();
      this.sfxBus.connect(this.master);
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.55;
      this.musicBus.connect(this.master);

      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

      // Engine: two detuned saws through a low-pass.
      this.engGain = ctx.createGain();
      this.engGain.gain.value = 0;
      this.engFilter = ctx.createBiquadFilter();
      this.engFilter.type = "lowpass";
      this.engFilter.frequency.value = 700;
      this.engFilter.connect(this.engGain);
      this.engGain.connect(this.sfxBus);
      this.engA = ctx.createOscillator();
      this.engA.type = "sawtooth";
      this.engB = ctx.createOscillator();
      this.engB.type = "square";
      this.engA.connect(this.engFilter);
      const sub = ctx.createGain();
      sub.gain.value = 0.5;
      this.engB.connect(sub);
      sub.connect(this.engFilter);
      this.engA.frequency.value = 60;
      this.engB.frequency.value = 30;
      this.engA.start();
      this.engB.start();
    }
    if (this.ctx.state === "suspended") this.ctx.resume();
    this.applyToggles();
  }

  applyToggles() {
    if (!this.ctx) return;
    this.sfxBus.gain.value = this.sfxOn ? 1 : 0;
    if (this.musicWanted && this.musicOn) this._startMusic();
    else this._stopMusic();
  }

  setMusic(wanted, root) {
    this.musicWanted = wanted;
    if (root) this.musicRoot = root;
    this.applyToggles();
  }

  engine(state, speed, air) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const on = state === "on";
    const f = 45 + Math.min(speed, 1400) * 0.07 + (air ? 18 : 0);
    this.engA.frequency.setTargetAtTime(f, t, 0.08);
    this.engB.frequency.setTargetAtTime(f / 2, t, 0.08);
    this.engFilter.frequency.setTargetAtTime(air ? 500 : 650 + speed * 0.9, t, 0.1);
    this.engGain.gain.setTargetAtTime(on ? (air ? 0.035 : 0.06) : 0, t, 0.06);
  }

  _env(node, t, a, peak, dec) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + a + dec);
  }

  _tone(type, f0, f1, dur, vol, when = 0, bus) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    this._env(g, t, 0.005, vol, dur);
    o.connect(g);
    g.connect(bus || this.sfxBus);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  _noise(dur, vol, type, f0, f1, when = 0, q = 1, bus) {
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const s = ctx.createBufferSource();
    s.buffer = this.noise;
    const fl = ctx.createBiquadFilter();
    fl.type = type;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(f0, t);
    fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    this._env(g, t, 0.01, vol, dur);
    s.connect(fl);
    fl.connect(g);
    g.connect(bus || this.sfxBus);
    s.start(t, Math.random() * 0.5);
    s.stop(t + dur + 0.05);
  }

  play(name, arg = 0) {
    if (!this.ctx || !this.sfxOn) return;
    switch (name) {
      case "click":
        this._tone("square", 900, 700, 0.04, 0.05);
        break;
      case "jump":
        this._noise(0.18, 0.12, "highpass", 1500, 3500);
        break;
      case "land":
        this._tone("sine", 140, 45, 0.18, 0.35);
        this._noise(0.12, 0.1, "lowpass", 900, 200);
        break;
      case "flip":
        this._noise(0.35, 0.12, "bandpass", 400, 2400, 0, 3);
        this._tone("triangle", midi(72 + Math.min(arg, 5) * 2), midi(79 + Math.min(arg, 5) * 2), 0.2, 0.08);
        break;
      case "perfect":
        [76, 80, 83, 88].forEach((n, i) => this._tone("triangle", midi(n), midi(n), 0.16, 0.12, i * 0.06));
        break;
      case "gem":
        this._tone("sine", 1500 + arg * 40, 2300 + arg * 40, 0.09, 0.12);
        this._tone("sine", 3000, 3000, 0.12, 0.04, 0.05);
        break;
      case "boost":
        this._tone("sawtooth", 160, 900, 0.45, 0.09);
        this._noise(0.5, 0.1, "bandpass", 300, 3000, 0, 2);
        break;
      case "loop":
        [67, 71, 74, 79].forEach((n, i) => this._tone("square", midi(n), midi(n), 0.08, 0.05, i * 0.05));
        break;
      case "crash":
        this._noise(0.9, 0.5, "lowpass", 2500, 120);
        this._tone("sawtooth", 160, 30, 0.6, 0.2);
        this._tone("sine", 90, 25, 0.8, 0.4);
        break;
      case "checkpoint":
        this._tone("square", midi(79), midi(79), 0.1, 0.07);
        this._tone("square", midi(84), midi(84), 0.18, 0.07, 0.1);
        break;
      case "finish":
        [72, 76, 79, 84, 79, 84].forEach((n, i) => this._tone("square", midi(n), midi(n), i === 5 ? 0.5 : 0.12, 0.07, i * 0.11));
        break;
      case "star":
        this._tone("triangle", midi(84 + arg * 4), midi(84 + arg * 4), 0.3, 0.12);
        break;
      case "unlock":
        [72, 79, 84, 88, 91].forEach((n, i) => this._tone("triangle", midi(n), midi(n), 0.18, 0.1, i * 0.07));
        break;
      case "denied":
        this._tone("square", 220, 160, 0.2, 0.06);
        break;
    }
  }

  // ---- music: 4-bar minor progression, bass + arp + drums
  _startMusic() {
    if (this._musicTimer || !this.ctx) return;
    this._nextTime = this.ctx.currentTime + 0.1;
    this._musicTimer = setInterval(() => this._schedule(), 25);
  }

  _stopMusic() {
    if (this._musicTimer) clearInterval(this._musicTimer);
    this._musicTimer = null;
  }

  _schedule() {
    const ctx = this.ctx;
    const spb = 60 / 118 / 4; // 16th notes
    const prog = [0, -4, 3, -2]; // i  VI  III  VII
    while (this._nextTime < ctx.currentTime + 0.12) {
      const step = this._step % 64;
      const bar = Math.floor(step / 16);
      const s = step % 16;
      const root = this.musicRoot + prog[bar];
      const when = this._nextTime - ctx.currentTime;
      const minor = bar === 0;
      const chord = [0, minor ? 3 : 4, 7, 12];
      if (s % 4 === 0) this._kick(when);
      if (s % 4 === 2) this._noise(0.04, 0.05, "highpass", 7000, 9000, when, 1, this.musicBus);
      if (s === 4 || s === 12) this._noise(0.12, 0.07, "bandpass", 1800, 1200, when, 1, this.musicBus);
      if (s % 2 === 0) {
        const n = root - 24 + (s % 8 === 6 ? 12 : 0);
        this._tone("sawtooth", midi(n), midi(n), spb * 1.6, 0.05, when, this.musicBus);
      }
      const an = root + chord[(s + bar) % 4] + (s >= 8 ? 12 : 0);
      this._tone("triangle", midi(an), midi(an), spb * 0.9, 0.035, when, this.musicBus);
      this._step++;
      this._nextTime += spb;
    }
  }

  _kick(when) {
    this._tone("sine", 150, 40, 0.18, 0.3, when, this.musicBus);
  }
}

export function vibrate(on, pattern) {
  if (!on) return;
  try {
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    // unsupported
  }
}
