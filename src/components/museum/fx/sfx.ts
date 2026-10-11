// Synthesized sound for the studio (WebAudio, no files): the whoosh of a
// throw, a wet paint splat with its patter of droplets, an egg's crack and
// squelch, shell bits ticking on the floor, a pizza's floppy slap, a burger's
// squelchy thud, an ice cream's plop (and buns bouncing, a cone's hollow
// tok), a dart's "fft" and its thunk and buzz, the swish of a loaded brush, a
// spray can's rattling ball and its hiss, the paintball marker's air "thup"
// with a rattle of the hopper, a ball's pop on the wall, the refill, a blade's
// whoosh, canvas tearing and steel scraping plaster; and the room around it: a
// low thud as the lights dip, a distant alarm bell, the conservator's solvent
// wipes and a closing chime.
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
  private hiss: { srcs: AudioScheduledSourceNode[]; nozzle: GainNode; wash: GainNode; tone: BiquadFilterNode } | null = null;
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
    this.hiss = null;
    this.ctx = this.master = this.verb = null;
    this.noise = null;
    if (c && c.state !== "closed") c.close().catch(() => {});
  }

  private get(): Ctx | null {
    // a context closed under us (the latch's, on leaving): start afresh
    if (this.ctx && this.ctx.state === "closed") this.close();
    if (this.ctx) return this.ctx;
    if (typeof window === "undefined") return null;
    // (the latch's context, unless it was closed: a studio unmounted and mounted again)
    let c = latch.audio?.state === "closed" ? null : latch.audio;
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
    if (this.hiss) this.sprayStop();
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

  /** A slice of pizza: a floppy, wet double slap (its middle, then the crust) and a sticky squelch. */
  pizza(sp: Spatial): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 0.95);
    const flap = 0.04 + Math.random() * 0.025;
    this.burst(c, dest, t, { type: "bandpass", freq: 760, freqTo: 280, q: 1.3, decay: 0.08, level: 0.75 });
    this.thump(c, dest, t, 140, 62, 0.09, 0.3);
    this.burst(c, dest, t + flap, { type: "bandpass", freq: 620, freqTo: 240, q: 1.5, decay: 0.07, level: 0.45 });
    this.thump(c, dest, t + flap, 120, 58, 0.07, 0.18);
    this.burst(c, dest, t + 0.015, { type: "bandpass", freq: 1300, freqTo: 420, q: 6, attack: 0.012, decay: 0.17, level: 0.3 });
    this.burst(c, dest, t + 0.005, { type: "highpass", freq: 2800, decay: 0.1, level: 0.05 });
  }

  /** The slice letting go of the wall: a sticky "schlup" rising, a soft pop. */
  peel(sp: Spatial): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 0.6, 0.1);
    this.burst(c, dest, t, { type: "bandpass", freq: 320, freqTo: 1500, q: 7, attack: 0.05, decay: 0.09, level: 0.32 });
    this.burst(c, dest, t + 0.13, { type: "bandpass", freq: 1800, q: 3, decay: 0.012, level: 0.15 });
  }

  /** A burger: a heavy, squelchy thud, the sauce squirting out, a few drops. */
  burger(sp: Spatial): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 1);
    this.thump(c, dest, t, 96, 38, 0.24, 0.85);
    this.burst(c, dest, t, { type: "lowpass", freq: 650, freqTo: 140, attack: 0.003, decay: 0.2, level: 0.55 });
    this.burst(c, dest, t + 0.01, { type: "bandpass", freq: 950, freqTo: 230, q: 7, attack: 0.015, decay: 0.24, level: 0.42 });
    this.burst(c, dest, t + 0.07, { type: "bandpass", freq: 480, freqTo: 1500, q: 5, attack: 0.02, decay: 0.07, level: 0.16 });
    for (let i = 0; i < 5; i++) {
      this.burst(c, dest, t + 0.05 + Math.random() * 0.3, { type: "bandpass", freq: 1800 + Math.random() * 2200, q: 3, decay: 0.012 + Math.random() * 0.013, level: 0.03 + Math.random() * 0.05 });
    }
  }

  /** An ice cream: a soft splodge and a cartoon plop or two. */
  icecream(sp: Spatial): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 0.9);
    this.burst(c, dest, t, { type: "lowpass", freq: 900, freqTo: 200, attack: 0.006, decay: 0.15, level: 0.5 });
    this.thump(c, dest, t, 110, 55, 0.12, 0.35);
    this.plop(c, dest, t + 0.012, 190, 560, 0.3);
    this.plop(c, dest, t + 0.1 + Math.random() * 0.04, 260, 720, 0.12);
  }

  /** A pitch flicking up, like a bubble. */
  private plop(c: Ctx, dest: AudioNode, at: number, from: number, to: number, level: number): void {
    const o = c.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(from, at);
    o.frequency.exponentialRampToValueAtTime(to, at + 0.045);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, at);
    g.gain.exponentialRampToValueAtTime(level, at + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.08);
    o.connect(g).connect(dest);
    o.start(at);
    o.stop(at + 0.12);
  }

  /** Food landing on the floor: a bun's springy little bounce, something soft, an empty cone's hollow tok. */
  foodLand(sp: Spatial, kind: "soft" | "bun" | "cone", speed: number): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, sp, 0.3 + 0.5 * Math.min(1, speed / 3), 0.1);
    if (kind === "bun") {
      this.thump(c, dest, t, 230, 150, 0.08, 0.45);
      this.burst(c, dest, t, { type: "lowpass", freq: 900, decay: 0.04, level: 0.25 });
    } else if (kind === "cone") {
      this.burst(c, dest, t, { type: "bandpass", freq: 1500, q: 5, decay: 0.03, level: 0.4 });
      this.ring(c, dest, t, 880 + Math.random() * 120, 0.05, 0.06);
      this.burst(c, dest, t + 0.008, { type: "highpass", freq: 3500, decay: 0.02, level: 0.06 });
    } else {
      this.burst(c, dest, t, { type: "bandpass", freq: 520, freqTo: 240, q: 1.2, decay: 0.05, level: 0.4 });
      this.thump(c, dest, t, 110, 60, 0.05, 0.25);
    }
  }

  /** A dart leaving the hand: a short, airy "fft". */
  dartThrow(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0.25, dist: 0.5 }, 0.45, 0.06);
    this.burst(c, dest, t, { type: "bandpass", freq: 1800, freqTo: 3800, q: 1.4, attack: 0.012, decay: 0.07, level: 0.2 });
    this.burst(c, dest, t + 0.01, { type: "highpass", freq: 5000, attack: 0.005, decay: 0.05, level: 0.05 });
  }

  /** A dart going in: crisp in wood and frames, duller in plaster, a papery "tuk" in canvas; then the shaft's buzz. */
  dartHit(sp: Spatial, surface: "canvas" | "plaster" | "gilt" | "wood" | "stone"): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime + Math.min(0.02, sp.dist / 340);
    const dest = this.out(c, sp, 0.85, 0.14);
    if (surface === "canvas") {
      this.burst(c, dest, t, { type: "bandpass", freq: 1400, freqTo: 700, q: 2, decay: 0.028, level: 0.5 });
      this.burst(c, dest, t, { type: "highpass", freq: 2600, decay: 0.035, level: 0.12 });
      this.thump(c, dest, t, 210, 120, 0.04, 0.2);
    } else if (surface === "plaster" || surface === "stone") {
      this.burst(c, dest, t, { type: "bandpass", freq: 900, q: 1.2, decay: 0.035, level: 0.5 });
      this.thump(c, dest, t, 170, 90, 0.06, 0.35);
      this.burst(c, dest, t + 0.002, { type: "highpass", freq: 4000, decay: 0.02, level: 0.08 });
    } else {
      this.burst(c, dest, t, { type: "highpass", freq: 3000, attack: 0.0006, decay: 0.006, level: 0.55 });
      this.burst(c, dest, t, { type: "bandpass", freq: 1900, q: 3, decay: 0.035, level: 0.45 });
      this.thump(c, dest, t, 280, 150, 0.05, 0.3);
    }
    this.twang(c, dest, t + 0.004, surface === "canvas" ? 0.03 : 0.07);
  }

  /** A stuck dart's shaft shivering: a soft buzzing tone beating at twice its wobble, dying away. */
  private twang(c: Ctx, dest: AudioNode, at: number, level: number): void {
    const o = c.createOscillator();
    o.type = "triangle";
    o.frequency.setValueAtTime(190 + Math.random() * 60, at);
    const beat = c.createGain();
    beat.gain.value = 0.5;
    const lfo = c.createOscillator();
    lfo.frequency.value = 16 + Math.random() * 4;
    const depth = c.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(beat.gain);
    const env = c.createGain();
    env.gain.setValueAtTime(0.0001, at);
    env.gain.exponentialRampToValueAtTime(level, at + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, at + 0.5);
    o.connect(beat).connect(env).connect(dest);
    o.start(at);
    lfo.start(at);
    o.stop(at + 0.55);
    lfo.stop(at + 0.55);
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

  /** The spray can's mixing ball: a few quick knocks inside the tin. */
  sprayShake(): void {
    const c = this.ready();
    if (!c) return;
    const t = c.currentTime;
    const dest = this.out(c, { pan: 0.22, dist: 0.45 }, 0.8, 0.1);
    const n = 3 + Math.floor(Math.random() * 3);
    for (let i = 0; i < n; i++) {
      // quick and a little uneven, softer as the shake stops
      const at = t + i * 0.055 + Math.random() * 0.012;
      const k = 1 - (0.35 * i) / n;
      // the ball's tick against the wall, and the tin's brief ring
      this.burst(c, dest, at, { type: "bandpass", freq: 3000 + Math.random() * 1400, q: 2.2, attack: 0.0006, decay: 0.012, level: 0.42 * k });
      this.ring(c, dest, at, 1850 + Math.random() * 120, 0.06, 0.04 * k);
      this.ring(c, dest, at, 4300 + Math.random() * 250, 0.035, 0.018 * k);
    }
    // the swing of the hand under the knocks
    this.burst(c, dest, t, { type: "lowpass", freq: 700, attack: 0.04, decay: 0.2, level: 0.05 });
  }

  /**
   * The can's hiss while it sprays, `near` 0 (into the air) … 1 (close to a
   * surface: a little louder and brighter, with the wash of paint landing).
   * Call every frame; ~30 ms attack.
   */
  spray(near: number): void {
    const c = this.ready();
    if (!c) {
      this.sprayStop();
      return;
    }
    if (!this.hiss) this.hiss = this.startHiss(c);
    const h = this.hiss;
    const v = Math.max(0, Math.min(1, near));
    const t = c.currentTime;
    h.nozzle.gain.setTargetAtTime(0.075 + 0.04 * v, t, 0.01);
    h.wash.gain.setTargetAtTime(0.05 * v, t, 0.02);
    h.tone.frequency.setTargetAtTime(6400 + 1800 * v, t, 0.06);
  }

  private startHiss(c: Ctx): NonNullable<Sfx["hiss"]> {
    const dest = this.out(c, { pan: 0.18, dist: 0.5 }, 1, 0.08);
    const src = this.noiseSrc(c);
    // the nozzle: a band of hiss high up over a little broadband air, nothing harsh on top
    const tone = c.createBiquadFilter();
    tone.type = "bandpass";
    tone.frequency.value = 7000;
    tone.Q.value = 1.1;
    const air = c.createBiquadFilter();
    air.type = "highpass";
    air.frequency.value = 2200;
    const airLevel = c.createGain();
    airLevel.gain.value = 0.35;
    const nozzle = c.createGain();
    nozzle.gain.value = 0;
    const top = c.createBiquadFilter();
    top.type = "lowpass";
    top.frequency.value = 10500;
    top.Q.value = 0.5;
    src.connect(tone).connect(nozzle);
    src.connect(air).connect(airLevel).connect(nozzle);
    nozzle.connect(top).connect(dest);
    // the paint landing: a softer, lower wash
    const land = c.createBiquadFilter();
    land.type = "bandpass";
    land.frequency.value = 2600;
    land.Q.value = 0.7;
    const wash = c.createGain();
    wash.gain.value = 0;
    src.connect(land).connect(wash).connect(dest);
    // the jet is never quite steady
    const lfo = c.createOscillator();
    lfo.frequency.value = 6.3;
    const depth = c.createGain();
    depth.gain.value = 0.004;
    lfo.connect(depth).connect(nozzle.gain);
    src.start();
    lfo.start();
    return { srcs: [src, lfo], nozzle, wash, tone };
  }

  /** Let go of the valve: ~80 ms release. */
  sprayStop(): void {
    const c = this.ctx;
    const h = this.hiss;
    this.hiss = null;
    if (!c || !h) return;
    const t = c.currentTime;
    h.nozzle.gain.setTargetAtTime(0, t, 0.025);
    h.wash.gain.setTargetAtTime(0, t, 0.025);
    for (const s of h.srcs) s.stop(t + 0.3);
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
