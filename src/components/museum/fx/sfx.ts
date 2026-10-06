// Synthesized sound for the studio (WebAudio, no files): the whoosh of a
// throw, a wet paint splat with its patter of droplets, an egg's crack and
// squelch, shell bits ticking on the floor, the swish of a loaded brush, the
// paintball marker's air "thup" with a rattle of the hopper, a ball's pop on
// the wall, the refill, a blade's whoosh, canvas tearing and steel scraping
// plaster; and the room around it: a low thud as the lights dip, a distant
// alarm bell, the conservator's solvent wipes and a closing chime.
//
// Everything plays through one bus: a gentle compressor, and a send into a
// convolution reverb whose impulse response is synthesized for a large,
// hard-walled gallery (early reflections, ~2 s decay, darker as it dies).
// Panned and attenuated by where the event is relative to the listener.
// Silent while the museum is muted (M).

import { latch } from "./latch";

const MUTE_KEY = "timeline-museum:music-muted";

export interface Spatial {
  /** -1 (left) … 1 (right) */
  pan: number;
  /** metres from the listener */
  dist: number;
}

let mutedSource: (() => boolean) | null = null;
/** Follow the museum's own mute state instead of the stored preference. */
export function setSfxMutedSource(fn: (() => boolean) | null): void {
  mutedSource = fn;
}

function isMuted(): boolean {
  if (mutedSource) return mutedSource();
  try {
    return window.localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

type Ctx = AudioContext;

class Sfx {
  private ctx: Ctx | null = null;
  private noise: AudioBuffer | null = null;
  private master: GainNode | null = null;
  private verb: GainNode | null = null;
  private brushSrc: AudioBufferSourceNode | null = null;
  private brushGain: GainNode | null = null;
  private brushFilter: BiquadFilterNode | null = null;
  private alarm: { gain: GainNode; stop: () => void } | null = null;
  private alarmLevel = 0;

  /** Build the graph now (the hall's impulse takes a moment): call while nothing else is happening. */
  prepare(): void {
    this.get();
  }

  /** Create / resume the context. Call from a user gesture the first time. */
  unlock(): void {
    const c = this.get();
    if (c && c.state === "suspended") c.resume().catch(() => {});
  }

  /** Leaving the gallery: stop and close the context (the next visit makes a new one). */
  close(): void {
    const c = this.ctx;
    const a = this.alarm;
    this.alarm = null;
    this.alarmLevel = 0;
    try {
      a?.stop();
    } catch {
      /* already stopped */
    }
    this.brushSrc = this.brushGain = this.brushFilter = null;
    this.ctx = this.master = this.verb = null;
    this.noise = null;
    if (c && c.state !== "closed") c.close().catch(() => {});
  }

  private get(): Ctx | null {
    // a context closed under us (the latch's, on leaving): start afresh
    if (this.ctx && this.ctx.state === "closed") this.close();
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    let c = latch.audio;
    if (!c) {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!AC) return null;
      try {
        c = new AC();
      } catch {
        return null;
      }
    }
    this.ctx = c;
    this.master = c.createGain();
    this.master.gain.value = 0.9;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    // the hall
    const conv = c.createConvolver();
    conv.buffer = hallImpulse(c);
    const wet = c.createGain();
    wet.gain.value = 0.55;
    const pre = c.createGain();
    pre.connect(conv).connect(wet).connect(this.master);
    this.verb = pre;
    const len = Math.floor(c.sampleRate * 2);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    return c;
  }

  private ready(): Ctx | null {
    if (isMuted()) return null;
    const c = this.get();
    if (!c) return null;
    if (c.state !== "running") {
      c.resume().catch(() => {});
      // (resume is async: this event is skipped, the next one plays)
      return null;
    }
    return c;
  }

  /** An output chain for one event: pan + distance gain (+ a send into the hall). */
  private out(c: Ctx, sp: Spatial, level: number, room = 0.12): AudioNode {
    const g = c.createGain();
    g.gain.value = level / (1 + 0.28 * Math.max(0, sp.dist - 1));
    let last: AudioNode = g;
    if (typeof c.createStereoPanner === "function") {
      const p = c.createStereoPanner();
      p.pan.value = Math.max(-1, Math.min(1, sp.pan * 0.85));
      g.connect(p);
      last = p;
    }
    last.connect(this.master!);
    if (room > 0 && this.verb) {
      const send = c.createGain();
      // distant events are heard more through the room than directly
      send.gain.value = room * (1 + 0.15 * Math.max(0, sp.dist - 1));
      last.connect(send).connect(this.verb);
    }
    return g;
  }

  private noiseSrc(c: Ctx): AudioBufferSourceNode {
    const s = c.createBufferSource();
    s.buffer = this.noise;
    s.loop = true;
    return s;
  }

  /** A burst of filtered noise with an exponential decay. */
  private burst(
    c: Ctx,
    dest: AudioNode,
    at: number,
    opts: { type: BiquadFilterType; freq: number; q?: number; freqTo?: number; attack?: number; decay: number; level: number },
  ): void {
    const s = this.noiseSrc(c);
    const f = c.createBiquadFilter();
    f.type = opts.type;
    f.frequency.setValueAtTime(opts.freq, at);
    if (opts.freqTo) f.frequency.exponentialRampToValueAtTime(opts.freqTo, at + opts.decay);
    f.Q.value = opts.q ?? 0.7;
    const g = c.createGain();
    const atk = opts.attack ?? 0.002;
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(opts.level, at + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, at + atk + opts.decay);
    s.connect(f).connect(g).connect(dest);
    s.start(at, Math.random() * 1.5);
    s.stop(at + atk + opts.decay + 0.05);
  }

  private thump(c: Ctx, dest: AudioNode, at: number, from: number, to: number, decay: number, level: number): void {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + decay);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0001, at + decay);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + decay + 0.05);
  }

  /** A sine partial with its own decay (rings, chimes). */
  private ring(c: Ctx, dest: AudioNode, at: number, f: number, decay: number, level: number, attack = 0.002): void {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(f, at);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, at + attack + decay);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + attack + decay + 0.05);
  }

  // ------------------------------------------------------------- the room

  /** The lights dip: a heavy, far-off thud, as if a breaker had dropped. */
  unlockThud(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0, dist: 6 }, 0.9, 0.5);
    this.thump(c, dest, t, 72, 34, 0.9, 0.9);
    this.burst(c, dest, t, { type: "lowpass", freq: 260, freqTo: 70, attack: 0.004, decay: 0.7, level: 0.5 });
    // the hum of the lamps dropping out
    const o = c.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(100, t);
    o.frequency.exponentialRampToValueAtTime(62, t + 0.5);
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 400;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
    o.connect(lp).connect(g).connect(dest);
    o.start(t);
    o.stop(t + 0.6);
  }

  /**
   * A distant alarm bell, heard mostly through the halls (level 0..1; 0
   * lets the bell ring out and stops it). Call as often as you like.
   */
  setAlarm(level: number): void {
    const want = Math.max(0, Math.min(1, level));
    const c = want > 0 ? this.ready() : this.ctx;
    if (!c || (want > 0 && isMuted())) {
      if (this.alarm) this.stopAlarm();
      return;
    }
    if (want > 0 && !this.alarm) this.alarm = this.startAlarm(c);
    if (!this.alarm) return;
    if (Math.abs(want - this.alarmLevel) < 0.01) return;
    this.alarmLevel = want;
    const t = c.currentTime;
    this.alarm.gain.gain.setTargetAtTime(want * 0.16, t, want > 0 ? 0.6 : 0.25);
    if (want === 0) {
      const a = this.alarm;
      this.alarm = null;
      this.alarmLevel = 0;
      setTimeout(() => a.stop(), 2500);
    }
  }

  private stopAlarm(): void {
    const a = this.alarm;
    this.alarm = null;
    this.alarmLevel = 0;
    if (!a || !this.ctx) return;
    a.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.05);
    setTimeout(() => a.stop(), 400);
  }

  private startAlarm(c: Ctx): { gain: GainNode; stop: () => void } {
    const t = c.currentTime;
    // a bell: inharmonic partials struck ~17 times a second by its clapper
    const bell = c.createGain();
    bell.gain.value = 0;
    const lfo = c.createOscillator();
    lfo.type = "sawtooth";
    lfo.frequency.value = 17;
    const depth = c.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(bell.gain);
    const offset = c.createConstantSource();
    offset.offset.value = 0.5;
    offset.connect(bell.gain);
    const oscs: OscillatorNode[] = [];
    for (const [f, a] of [
      [880, 0.5],
      [880 * 2.76, 0.22],
      [880 * 5.4, 0.08],
      [880 * 1.5, 0.12],
    ] as const) {
      const o = c.createOscillator();
      o.type = "sine";
      o.frequency.value = f * (1 + (Math.random() - 0.5) * 0.004);
      const g = c.createGain();
      g.gain.value = a;
      o.connect(g).connect(bell);
      oscs.push(o);
    }
    // far away, down the halls: dull, mostly reverberant, slightly left
    const lp = c.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 1500;
    const level = c.createGain();
    level.gain.value = 0;
    bell.connect(lp).connect(level);
    const dest = this.out(c, { pan: -0.35, dist: 14 }, 1, 0.9);
    level.connect(dest);
    lfo.start(t);
    offset.start(t);
    oscs.forEach((o) => o.start(t));
    return {
      gain: level,
      stop: () => {
        try {
          lfo.stop();
          offset.stop();
          oscs.forEach((o) => o.stop());
        } catch {
          // already stopped
        }
        level.disconnect();
      },
    };
  }

  /** Keep loops honest about the mute (call while anything is going). */
  tick(): void {
    if (!isMuted()) return;
    if (this.alarm) this.stopAlarm();
    if (this.brushSrc) this.brushStop();
  }

  // ------------------------------------------------------------ the tools

  /** The throw leaving the hand. */
  whoosh(duration: number): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0.25, dist: 0.5 }, 0.5);
    this.burst(c, dest, t, { type: "bandpass", freq: 500, freqTo: 1600, q: 1.2, attack: duration * 0.35, decay: duration * 0.7, level: 0.22 });
  }

  /** Paint hitting a surface; `size` 0..1. */
  splat(sp: Spatial, size = 0.7): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 1);
    this.thump(c, dest, t, 150, 48, 0.14, 0.55 * (0.6 + 0.4 * size));
    // the wet slap
    this.burst(c, dest, t, { type: "bandpass", freq: 1100, freqTo: 420, q: 0.9, decay: 0.11, level: 0.75 });
    this.burst(c, dest, t, { type: "lowpass", freq: 2600, freqTo: 600, decay: 0.16, level: 0.35 });
    // spray
    this.burst(c, dest, t + 0.004, { type: "highpass", freq: 2400, decay: 0.22, level: 0.12 });
    // droplets landing after
    const n = 6 + Math.floor(Math.random() * 8);
    for (let i = 0; i < n; i++) {
      const at = t + 0.03 + Math.random() * Math.random() * 0.45;
      this.burst(c, dest, at, {
        type: "bandpass",
        freq: 2500 + Math.random() * 4000,
        q: 2.5,
        decay: 0.012 + Math.random() * 0.02,
        level: 0.04 + Math.random() * 0.1,
      });
    }
  }

  /** An egg: crack, then squelch. */
  egg(sp: Spatial): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 1);
    // crisp crack: a few clicks inside ~20 ms
    for (let i = 0; i < 4; i++) {
      this.burst(c, dest, t + i * 0.0045 + Math.random() * 0.003, {
        type: "highpass",
        freq: 2800 + Math.random() * 2000,
        decay: 0.006 + Math.random() * 0.006,
        level: 0.5 - i * 0.08,
      });
    }
    this.burst(c, dest, t, { type: "bandpass", freq: 4200, q: 4, decay: 0.03, level: 0.3 });
    this.thump(c, dest, t + 0.008, 110, 60, 0.08, 0.35);
    // the gooey squelch: a resonant sweep down
    this.burst(c, dest, t + 0.012, { type: "bandpass", freq: 1500, freqTo: 320, q: 7, attack: 0.01, decay: 0.2, level: 0.5 });
    this.burst(c, dest, t + 0.02, { type: "lowpass", freq: 900, freqTo: 250, decay: 0.18, level: 0.25 });
  }

  /** A bit of shell landing on the floor. */
  clink(sp: Spatial, speed: number): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, Math.min(1, speed * 0.5));
    this.burst(c, dest, t, { type: "bandpass", freq: 3500 + Math.random() * 3500, q: 6, decay: 0.018, level: 0.25 });
  }

  /** Brush on canvas: a continuous swish shaped by speed (m/s). */
  brush(speed: number): void {
    const c = this.ready();
    if (!c) {
      this.brushStop();
      return;
    }
    if (!this.brushSrc) {
      const s = this.noiseSrc(c);
      const f = c.createBiquadFilter();
      f.type = "bandpass";
      f.frequency.value = 1800;
      f.Q.value = 0.6;
      const hs = c.createBiquadFilter();
      hs.type = "highshelf";
      hs.frequency.value = 5000;
      hs.gain.value = -8;
      const g = c.createGain();
      g.gain.value = 0;
      s.connect(f).connect(hs).connect(g).connect(this.out(c, { pan: 0, dist: 1 }, 1));
      s.start();
      this.brushSrc = s;
      this.brushGain = g;
      this.brushFilter = f;
    }
    const t = c.currentTime;
    const v = Math.min(1, speed / 1.5);
    this.brushGain!.gain.setTargetAtTime(0.03 + 0.22 * v, t, 0.04);
    this.brushFilter!.frequency.setTargetAtTime(1300 + 2200 * v, t, 0.05);
  }

  brushStop(): void {
    const c = this.ctx;
    const s = this.brushSrc;
    const g = this.brushGain;
    this.brushSrc = null;
    this.brushGain = null;
    this.brushFilter = null;
    if (!c || !s || !g) return;
    const t = c.currentTime;
    g.gain.setTargetAtTime(0, t, 0.05);
    s.stop(t + 0.3);
  }

  /** The marker: a pop of compressed air, a short hiss, the hopper rattling. */
  marker(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const jit = 0.94 + 0.12 * Math.random();
    const dest = this.out(c, { pan: 0.22, dist: 0.4 }, 0.7, 0.18);
    this.thump(c, dest, t, 210 * jit, 90, 0.05, 0.6);
    this.burst(c, dest, t, { type: "bandpass", freq: 1700 * jit, q: 1.1, attack: 0.001, decay: 0.03, level: 0.65 });
    this.burst(c, dest, t + 0.003, { type: "highpass", freq: 4200, attack: 0.002, decay: 0.12, level: 0.22 });
    // agitator: a few balls knocking about in the hopper
    const rattle = this.out(c, { pan: 0.18, dist: 0.35 }, 0.25, 0);
    const n = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      this.burst(c, rattle, t + 0.025 + Math.random() * 0.06, { type: "bandpass", freq: 2200 + Math.random() * 1800, q: 5, decay: 0.008, level: 0.18 + Math.random() * 0.12 });
    }
  }

  /** A paintball bursting on a surface: a crisp pop and a small wet slap. */
  ballHit(sp: Spatial): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + Math.min(0.03, sp.dist / 340);
    const dest = this.out(c, sp, 0.75, 0.16);
    this.burst(c, dest, t, { type: "highpass", freq: 2500, attack: 0.0008, decay: 0.012, level: 0.6 });
    this.thump(c, dest, t, 240, 110, 0.04, 0.35);
    this.burst(c, dest, t + 0.002, { type: "bandpass", freq: 1300, freqTo: 600, q: 1, decay: 0.06, level: 0.4 });
  }

  /** Lid up, a fresh bag of balls poured in, lid down (over `dur` seconds). */
  refill(dur: number): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0.2, dist: 0.35 }, 0.55, 0.08);
    this.burst(c, dest, t + 0.05, { type: "bandpass", freq: 2600, q: 4, decay: 0.01, level: 0.5 });
    const n = 26;
    for (let i = 0; i < n; i++) {
      const at = t + 0.15 + (dur - 0.35) * (i / n) + Math.random() * 0.03;
      this.burst(c, dest, at, { type: "bandpass", freq: 1800 + Math.random() * 2400, q: 4, decay: 0.01 + Math.random() * 0.01, level: 0.08 + Math.random() * 0.12 });
    }
    this.burst(c, dest, t + dur - 0.08, { type: "bandpass", freq: 2000, q: 3, decay: 0.014, level: 0.55 });
    this.thump(c, dest, t + dur - 0.08, 230, 140, 0.05, 0.25);
  }

  /** A blade through the air. */
  swordWhoosh(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0, dist: 0.4 }, 0.55, 0.12);
    this.burst(c, dest, t + 0.03, { type: "bandpass", freq: 380, freqTo: 1900, q: 1.6, attack: 0.09, decay: 0.12, level: 0.5 });
    this.burst(c, dest, t + 0.14, { type: "bandpass", freq: 1900, freqTo: 500, q: 1.4, attack: 0.01, decay: 0.16, level: 0.35 });
  }

  /** Canvas tearing under a blade: a fast, granular rip. */
  rip(sp: Spatial, length: number): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dur = Math.min(0.5, 0.12 + length * 0.4);
    const dest = this.out(c, sp, 0.65, 0.2);
    this.burst(c, dest, t, { type: "bandpass", freq: 1400, freqTo: 2400, q: 0.9, attack: 0.01, decay: dur, level: 0.25 });
    const n = Math.round(dur * 160);
    for (let i = 0; i < n; i++) {
      this.burst(c, dest, t + (i / n) * dur + Math.random() * 0.004, {
        type: "bandpass",
        freq: 1500 + Math.random() * 3000,
        q: 1.8,
        decay: 0.004 + Math.random() * 0.008,
        level: 0.12 + Math.random() * 0.22,
      });
    }
  }

  /** Steel dragged across plaster, wood or gilding. */
  scrape(sp: Spatial, metal: boolean, length: number): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dur = Math.min(0.45, 0.1 + length * 0.35);
    const dest = this.out(c, sp, 0.5, 0.2);
    this.burst(c, dest, t, { type: "bandpass", freq: 2400, freqTo: 1600, q: 3, attack: 0.01, decay: dur, level: 0.35 });
    for (let i = 0; i < 14; i++) {
      this.burst(c, dest, t + Math.random() * dur, { type: "highpass", freq: 3500, decay: 0.006, level: 0.08 + Math.random() * 0.1 });
    }
    if (metal) this.ring(c, dest, t, 3100 + 300 * Math.random(), 0.4, 0.06);
  }

  // -------------------------------------------------------- the conservator

  /** The conservator arrives: a soft breath of solvent and a rising shimmer. */
  conservator(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0, dist: 1 }, 0.7);
    this.burst(c, dest, t, { type: "lowpass", freq: 700, freqTo: 2600, attack: 0.5, decay: 0.9, level: 0.12 });
    [659.25, 987.77, 1318.5].forEach((f, i) => this.ring(c, dest, t + 0.12 + i * 0.09, f, 1.2, 0.035, 0.05));
  }

  /** One work coming clean: a soft wipe. */
  wipe(sp: Spatial): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 0.6, 0.15);
    this.burst(c, dest, t, { type: "bandpass", freq: 900, freqTo: 2400, q: 0.8, attack: 0.18, decay: 0.35, level: 0.14 });
    this.ring(c, dest, t + 0.25, 1975.5 + Math.random() * 40, 0.6, 0.018, 0.02);
  }

  /** All clean: a quiet major chord. */
  restored(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0, dist: 1 }, 0.7, 0.35);
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.ring(c, dest, t + i * 0.06, f, 1.8, 0.04, 0.03));
  }
}

export const sfx = new Sfx();

/**
 * Impulse response of a large, hard-walled gallery: a few early reflections
 * off the near walls, then a dense tail (~2 s) that loses its top end as it
 * decays. Stereo, decorrelated.
 */
function hallImpulse(c: AudioContext): AudioBuffer {
  const rate = c.sampleRate;
  const len = Math.floor(rate * 2.4);
  const buf = c.createBuffer(2, len, rate);
  const taps = [0.011, 0.019, 0.027, 0.034, 0.047, 0.058, 0.071];
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) {
      const t = i / rate;
      const env = Math.exp(-t * 3.1) * Math.min(1, t / 0.012);
      // a one-pole low-pass that closes over time: the tail darkens
      const k = 0.85 - 0.75 * Math.min(1, t / 1.6);
      lp = lp * k + (Math.random() * 2 - 1) * (1 - k);
      d[i] = lp * env * 0.9;
    }
    for (const tap of taps) {
      const i = Math.floor((tap + (ch ? 0.0023 : 0)) * rate);
      if (i < len) d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.5 - tap * 4);
    }
  }
  return buf;
}
