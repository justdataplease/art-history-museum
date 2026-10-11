// The audio guide's voices. Two kinds, one interface (speak lines, one at a time, with the line being read):
// - the browser's own voice (Web Speech API), the most natural of those it offers: Edge's "Natural" voices,
//   Safari's Premium and Enhanced ones, Android's network (neural) voices, Google's, never the novelty voices.
//   The guide's voice unless the visitor chooses the AI one;
// - the AI voice: a neural text-to-speech model run in a worker on this device, downloaded once (the browser
//   keeps it) and only when the visitor chooses it (Settings → Audio guide → Natural), never by itself. Two models:
//   · light (Piper, public/voice/piper-worker.js): about 75 MB, on the processor, a sentence in a seventh of the
//     time it lasts here and well ahead of speech on a modest laptop; it leaves the graphics card to the gallery.
//     Every computer;
//   · studio (Kokoro, public/voice/kokoro-worker.js): the most like a person, but it needs WebGPU on a strong
//     graphics card (on the processor it is slower than speech) and about 330 MB.
//   "Best for this computer" (the default) takes the studio voice only on a strong graphics card. Each voice is
//   timed as it reads: a studio voice that cannot keep well ahead gives way to the light one, and where even the
//   light one falls behind, the browser's voice reads (both remembered on this device).
// Sentences are made one at a time, the one about to be heard first, then the next, and the guide asks for the
// first sentence of the painting the visitor is turning to before it starts (prefetch). A long sentence is made in
// pieces at its commas, so the voice starts sooner. All at the guide's speed (settings.ts guideSpeed).

export type NaturalState = "idle" | "loading" | "ready" | "slow" | "error";
export type NaturalEngine = "piper" | "kokoro";

export interface NaturalVoiceInfo {
  id: string;
  label: string;
  engine: NaturalEngine;
}

/** The AI voices: Piper's clearest public-domain voices (LibriVox readers), and Kokoro's best (its own grades:
 *  Heart A, Bella A-, Emma B-, Michael and George C). */
export const NATURAL_VOICES: NaturalVoiceInfo[] = [
  { id: "en_GB-cori-medium", label: "Cori (British)", engine: "piper" },
  { id: "en_US-kristin-medium", label: "Kristin", engine: "piper" },
  { id: "en_US-john-medium", label: "John", engine: "piper" },
  { id: "af_heart", label: "Heart", engine: "kokoro" },
  { id: "af_bella", label: "Bella", engine: "kokoro" },
  { id: "bf_emma", label: "Emma (British)", engine: "kokoro" },
  { id: "am_michael", label: "Michael", engine: "kokoro" },
  { id: "bm_george", label: "George (British)", engine: "kokoro" },
];
const LIGHT = "en_GB-cori-medium";
const STUDIO = "af_heart";
/** Each model's download, MB (Piper: the voice, the runtime and eSpeak; Kokoro: its weights and voices). */
export const ENGINE_MB: Record<NaturalEngine, number> = { piper: 75, kokoro: 330 };
const MODEL_BYTES: Record<NaturalEngine, number> = { piper: 63.5e6, kokoro: 330e6 };
const WORKER: Record<NaturalEngine, string> = { piper: "/voice/piper-worker.js", kokoro: "/voice/kokoro-worker.js" };

/** The breath between two sentences, and between two pieces of one, seconds (at speed 1). */
const BREATH = 0.28;
const JOIN = 0.05;
/** Keeping up: seconds of work per second of speech, over a voice's first sentences. The studio voice must keep
 *  well ahead (its work is on the graphics card the gallery draws with); the light one only ahead. */
const TOO_SLOW: Record<NaturalEngine, number> = { kokoro: 0.4, piper: 0.95 };
const JUDGE_AFTER = 3;
/** Sentences kept, made (replays and the painting turned back to cost nothing). */
const KEEP = 60;

const SLOW_KEY = "timeline-museum:voice-too-slow";
/** Where the models are kept (the workers' caches, keyed by the file's URL). */
const PIPER_CACHE = "museum-voice";
const KOKORO_CACHE = "transformers-cache";
const KOKORO_FILE = /Kokoro-82M-v1\.0-ONNX\/resolve\/[^/]+\/onnx\/model\.onnx$/;

export interface Speaking {
  stop(): void;
  pause(): void;
  resume(): void;
}
export interface SpeakOptions {
  speed: number;
  onLine: (text: string) => void;
  onEnd: () => void;
}

export function voiceInfo(id: string): NaturalVoiceInfo | undefined {
  return NATURAL_VOICES.find((v) => v.id === id);
}

/** Words a clause can start on: a piece with no comma to break at breaks before one. */
const JOINERS = /\s(?=(?:and|but|or|which|who|whose|where|when|while|with|without|by|for|from|in|into|on|of|after|before|because|as|that)\s)/g;

/** A piece longer than `max`, broken before the joining word nearest `target` characters in (none: as it is). */
function breakAt(p: string, max: number, target: number): string[] {
  if (p.length <= max) return [p];
  let at = -1;
  for (const m of p.matchAll(JOINERS)) {
    const i = m.index!;
    if (i < 20 || p.length - i < 20) continue;
    if (at < 0 || Math.abs(i - target) < Math.abs(at - target)) at = i;
  }
  if (at < 0) return [p];
  const rest = p.slice(at + 1);
  return [p.slice(0, at), ...breakAt(rest, max, rest.length / 2)];
}

/** A sentence in pieces the voice can start on sooner: a long one at its commas, semicolons and dashes (else before
 *  a joining word), each piece long enough to carry its own tune; the first sentence of a reading sooner still. */
export function pieces(line: string, first: boolean): string[] {
  const max = first ? 70 : 150;
  if (line.length <= max) return [line];
  const min = first ? 24 : 45;
  const out: string[] = [];
  let cur = "";
  for (const part of line.split(/(?<=[,;:—])\s+/)) {
    if (cur.length >= (out.length ? 45 : min)) {
      out.push(cur);
      cur = part;
    } else cur = cur ? `${cur} ${part}` : part;
  }
  if (cur) {
    if (out.length && cur.length < 20) out[out.length - 1] += ` ${cur}`;
    else out.push(cur);
  }
  return out.flatMap((p, i) => breakAt(p, max, first && i === 0 ? 45 : p.length / 2));
}

type Verdicts = Partial<Record<NaturalEngine, boolean>>;
function readSlow(): Verdicts {
  try {
    return JSON.parse(localStorage.getItem(SLOW_KEY) ?? "{}") as Verdicts;
  } catch {
    return {};
  }
}

// ------------------------------------------------------------------------------------------------ the AI voice

interface Job {
  key: string;
  text: string;
  speed: number;
  /** The reading that will hear it (made first), or AHEAD: asked for ahead (the painting the visitor is turning to). */
  owner: number;
  resolve: (b: AudioBuffer) => void;
  reject: (e: Error) => void;
}
const AHEAD = 0;

class NaturalVoice {
  state: NaturalState = "idle";
  /** Download progress while loading, 0..1. */
  progress = 0;
  /** The voice loaded (or loading), and its model. */
  voice: string | null = null;
  engine: NaturalEngine | null = null;
  /** Why the voice reading is not the one chosen: the studio voice was too slow here (the light one reads). */
  fellBack = false;
  /** Bumped when a voice's files are found on (or put on) this device, so `onDevice` readers re-render. */
  devices = 0;
  private worker: Worker | null = null;
  private wanted: string | null = null;
  private claim: Promise<void> = Promise.resolve();
  private adapter: Promise<{ ok: boolean; strong: boolean }> | null = null;
  private stored = new Map<string, boolean>();
  private checking = new Map<string, Promise<boolean>>();
  private ctx: AudioContext | null = null;
  private queue: Job[] = [];
  private busy: Job | null = null;
  private sentAt = 0;
  private readings = 0;
  private made = new Map<string, Promise<AudioBuffer>>();
  private timing = { work: 0, speech: 0, n: 0 };
  private slow: Verdicts = {};
  private listeners = new Set<() => void>();

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  private emit() {
    this.listeners.forEach((f) => f());
  }
  getState = () => this.state;
  getProgress = () => this.progress;
  getDevices = () => this.devices;

  /** WebGPU here (the studio voice can run), and whether its graphics card looks strong enough to read with it
   *  while the gallery draws: not a phone, not a software or integrated Intel adapter (Arc is fine), 8 cores and
   *  8 GB or more. Only a guess: the voice is timed as it reads (TOO_SLOW). */
  gpu(): Promise<{ ok: boolean; strong: boolean }> {
    if (typeof navigator === "undefined") return Promise.resolve({ ok: false, strong: false });
    type Info = { vendor?: string; architecture?: string; isFallbackAdapter?: boolean };
    type Adapter = { info?: Info; isFallbackAdapter?: boolean };
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<Adapter | null> } }).gpu;
    this.adapter ??= (gpu ? gpu.requestAdapter().catch(() => null) : Promise.resolve(null)).then((a) => {
      if (!a) return { ok: false, strong: false };
      const info = a.info ?? {};
      const vendor = (info.vendor ?? "").toLowerCase();
      const arch = (info.architecture ?? "").toLowerCase();
      const nav = navigator as Navigator & { deviceMemory?: number };
      const strong =
        !(info.isFallbackAdapter ?? a.isFallbackAdapter) &&
        !window.matchMedia("(pointer: coarse)").matches &&
        (nav.deviceMemory ?? 8) >= 8 &&
        (navigator.hardwareConcurrency ?? 4) >= 8 &&
        (["nvidia", "amd", "apple"].includes(vendor) || (vendor === "intel" && /^xe-hpg|^xe2/.test(arch)));
      return { ok: true, strong };
    });
    return this.adapter;
  }

  /** The voice to read with for the visitor's choice ("": the best for this computer): the studio voice only
   *  where WebGPU runs and has not been too slow; nothing where even the light voice was too slow. */
  async resolve(choice: string): Promise<string | null> {
    this.slow = readSlow();
    if (this.slow.piper) return null;
    const chosen = voiceInfo(choice);
    if (chosen?.engine === "piper") return chosen.id;
    const { ok, strong } = await this.gpu();
    if (chosen) return ok && !this.slow.kokoro ? chosen.id : LIGHT;
    return strong && !this.slow.kokoro ? STUDIO : LIGHT;
  }

  /** Whether the voice is on this device already (downloaded once): choosing it downloads nothing. Null until
   *  the browser has answered. */
  onDevice(id: string): boolean | null {
    if (this.stored.has(id)) return this.stored.get(id)!;
    if (!this.checking.has(id)) {
      this.checking.set(
        id,
        (async () => {
          try {
            if (!("caches" in window)) return false;
            const info = voiceInfo(id);
            if (!info) return false;
            const name = info.engine === "piper" ? PIPER_CACHE : KOKORO_CACHE;
            if (!(await caches.has(name))) return false;
            const keys = await (await caches.open(name)).keys();
            return info.engine === "piper"
              ? keys.some((r) => r.url.endsWith(`/${id}.onnx`))
              : keys.some((r) => KOKORO_FILE.test(r.url));
          } catch {
            return false;
          }
        })().then((yes) => {
          this.stored.set(id, yes);
          this.devices++;
          this.emit();
          return yes;
        })
      );
    }
    return null;
  }

  /** Start downloading and warming the voice for the visitor's choice (once; a different model replaces the one
   *  loaded, freeing it). Resolves once it is under way. */
  load(choice: string): Promise<void> {
    // claimed at once: Settings and the guide ask together, and two models would load at once
    if (this.wanted === choice && this.state !== "error") return this.claim;
    this.wanted = choice;
    return (this.claim = this.begin(choice));
  }

  private async begin(choice: string) {
    const id = await this.resolve(choice);
    if (this.wanted !== choice) return;
    if (!id) {
      this.drop();
      this.set("slow");
      return;
    }
    this.fellBack = (!!choice && choice !== id) || (!choice && this.slow.kokoro === true);
    if (id === this.voice && this.worker) return this.emit();
    const engine = voiceInfo(id)!.engine;
    if (this.engine !== engine || !this.worker) {
      this.drop();
      this.start(engine);
    } else this.reset();
    this.voice = id;
    this.progress = 0;
    this.timing = { work: 0, speech: 0, n: 0 };
    this.set("loading");
    this.worker!.postMessage(engine === "piper" ? { type: "load", voice: id } : { type: "load" });
  }

  /** Resolves when the voice asked for last can read (false: none will). */
  async whenReady(): Promise<boolean> {
    await this.claim;
    if (this.state === "ready") return true;
    if (this.state !== "loading") return false;
    return new Promise((resolve) => {
      const off = this.subscribe(() => {
        if (this.state === "loading") return;
        off();
        resolve(this.state === "ready");
      });
    });
  }

  private set(s: NaturalState) {
    this.state = s;
    this.emit();
  }

  private start(engine: NaturalEngine) {
    const w = new Worker(WORKER[engine], { type: "module" });
    this.worker = w;
    this.engine = engine;
    w.onmessage = ({ data: m }) => {
      if (w !== this.worker) return;
      if (m.type === "progress") {
        // files announce themselves as they start: count against the whole model from the first
        this.progress = Math.min(0.99, m.loaded / Math.max(m.total, MODEL_BYTES[engine]));
        this.emit();
      } else if (m.type === "ready") {
        // (a light voice chosen while another was loading: only the last one counts)
        if (m.voice && m.voice !== this.voice) return;
        this.progress = 1;
        this.stored.set(this.voice!, true);
        this.devices++;
        this.set("ready");
        this.pump();
      } else if (m.type === "audio") {
        const job = this.busy;
        if (!job) return;
        this.busy = null;
        const ms = performance.now() - this.sentAt;
        const samples = m.samples as Float32Array<ArrayBuffer>;
        // a model that runs but says nothing (some graphics cards give the studio voice silence, or NaN)
        let peak = 0;
        for (let i = 0; i < samples.length; i += 7) peak = Math.max(peak, Math.abs(samples[i]));
        if (!(peak > 1e-3)) {
          job.reject(new Error("silent"));
          this.made.delete(job.key);
          return this.giveWay(engine);
        }
        const buf = new AudioBuffer({ length: samples.length, sampleRate: m.sr });
        buf.copyToChannel(samples, 0);
        job.resolve(buf);
        this.judge(engine, ms, buf.duration * job.speed);
        this.pump();
      } else if (m.type === "error") {
        if (this.busy && this.state === "ready") {
          this.busy.reject(new Error(m.error));
          this.made.delete(this.busy.key);
          this.busy = null;
          this.pump();
        } else this.fail();
      }
    };
    w.onerror = () => {
      if (w === this.worker) this.fail();
    };
  }

  private fail() {
    this.drop();
    this.set("error");
  }

  /** The model's work against the speech it made (at speed 1), over its first sentences: too slow, and it gives
   *  way (the studio voice to the light one, the light one to the browser's voice), remembered on this device. */
  private judge(engine: NaturalEngine, ms: number, seconds: number) {
    const t = this.timing;
    if (t.n >= JUDGE_AFTER || seconds < 0.8) return;
    t.work += ms / 1000;
    t.speech += seconds;
    if (++t.n >= JUDGE_AFTER && t.work / t.speech > TOO_SLOW[engine]) this.giveWay(engine);
  }

  private giveWay(engine: NaturalEngine) {
    try {
      localStorage.setItem(SLOW_KEY, JSON.stringify({ ...readSlow(), [engine]: true }));
    } catch {}
    const choice = this.wanted ?? "";
    this.wanted = null;
    this.drop();
    void this.load(choice);
  }

  private reset() {
    const err = new Error("voice changed");
    for (const j of this.queue) j.reject(err);
    this.busy?.reject(err);
    this.queue = [];
    this.busy = null;
    this.made.clear();
  }

  private drop() {
    this.reset();
    this.worker?.terminate();
    this.worker = null;
    this.engine = null;
    this.voice = null;
  }

  private audio(): AudioContext {
    return (this.ctx ??= new AudioContext());
  }

  /** One sentence at a time to the worker, the ones a reading is waiting for first. */
  private pump() {
    if (this.busy || this.state !== "ready" || !this.worker || !this.queue.length) return;
    const i = Math.max(0, this.queue.findIndex((j) => j.owner !== AHEAD));
    const job = this.queue.splice(i, 1)[0];
    this.busy = job;
    this.sentAt = performance.now();
    this.worker.postMessage(
      this.engine === "piper"
        ? { type: "speak", id: 1, text: job.text, speed: job.speed }
        : { type: "speak", id: 1, text: job.text, voice: this.voice, speed: job.speed }
    );
  }

  private synth(text: string, speed: number, owner: number): Promise<AudioBuffer> {
    // no voice to make it (it gave way, or failed): the reading ends, and the guide goes on with the browser's
    if (!this.worker || (this.state !== "ready" && this.state !== "loading")) return Promise.reject(new Error("no voice"));
    const key = `${this.voice}|${speed}|${text}`;
    const had = this.made.get(key);
    if (had) {
      // asked for ahead and now about to be heard: this reading's, first in line
      if (owner !== AHEAD) for (const j of this.queue) if (j.key === key) j.owner = owner;
      this.made.delete(key);
      this.made.set(key, had);
      return had;
    }
    const p = new Promise<AudioBuffer>((resolve, reject) => {
      this.queue.push({ key, text, speed, owner, resolve, reject });
    });
    p.catch(() => this.made.get(key) === p && this.made.delete(key));
    this.made.set(key, p);
    while (this.made.size > KEEP) this.made.delete(this.made.keys().next().value!);
    this.pump();
    return p;
  }

  /** Forget the sentences of a reading (or those asked for ahead) not begun yet. */
  private forget(owner: number) {
    const left: Job[] = [];
    for (const j of this.queue) {
      if (j.owner === owner) j.reject(new Error("not needed"));
      else left.push(j);
    }
    this.queue = left;
  }

  /** Make the start of a reading ahead (the painting the visitor is turning to), if the voice is ready. */
  prefetch(lines: string[], speed: number) {
    if (this.state !== "ready" || !lines.length) return;
    // a painting walked past leaves nothing behind but the sentence begun
    this.forget(AHEAD);
    for (const text of pieces(lines[0], true).slice(0, 2)) void this.synth(text, speed, AHEAD).catch(() => {});
  }

  /** Read the lines in turn; the next piece is made while one is heard. */
  speak(lines: string[], o: SpeakOptions): Speaking {
    const me = ++this.readings;
    const ctx = this.audio();
    void ctx.resume();
    const parts = lines.flatMap((line, i) => pieces(line, i === 0).map((text, j) => ({ text, line, first: j === 0 })));
    let stopped = false;
    let current: AudioBufferSourceNode | null = null;
    // each piece asked for once: what was made is kept by the reading, even if the voice gives way meanwhile
    const got: Promise<AudioBuffer>[] = [];
    const make = (k: number) => (k < parts.length ? (got[k] ??= this.synth(parts[k].text, o.speed, me)) : null);
    const play = async (k: number) => {
      if (stopped) return;
      if (k >= parts.length) return o.onEnd();
      let buf: AudioBuffer;
      try {
        const p = make(k)!;
        void make(k + 1)?.catch(() => {});
        buf = await p;
      } catch {
        return stopped ? undefined : o.onEnd();
      }
      if (stopped) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => {
        if (current === src) current = null;
        void play(k + 1);
      };
      current = src;
      src.start(ctx.currentTime + (k === 0 ? 0.02 : (parts[k].first ? BREATH : JOIN) / o.speed));
      if (parts[k].first) o.onLine(parts[k].line);
    };
    void play(0);
    return {
      stop: () => {
        stopped = true;
        // (not what was asked for ahead: the guide stops one painting as it starts the next, made ahead)
        this.forget(me);
        if (current) {
          current.onended = null;
          try {
            current.stop();
          } catch {}
        }
        current = null;
      },
      // the context's clock stops: the sentence, and the breath before the next, wait
      pause: () => void ctx.suspend(),
      resume: () => void ctx.resume(),
    };
  }
}

export const naturalVoice = new NaturalVoice();

// ------------------------------------------------------------------------------------------------ the browser's

/** Voices that are effects, not readers (macOS's novelty set and the like). */
const NOVELTY = /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|organ|superstar|trinoids|whisper|wobble|zarvox|pipe organ)\b/i;

function rank(v: SpeechSynthesisVoice): number {
  let r = 0;
  if (/natural|neural/i.test(v.name)) r += 10; // Edge's online voices: nearly human
  if (/premium|enhanced|siri/i.test(v.name)) r += 8; // Apple's downloaded voices
  if (/-network\b/i.test(v.name) || /-network\b/i.test(v.voiceURI)) r += 9; // Android's neural (online) voices
  if (/google/i.test(v.name)) r += 5;
  if (/online/i.test(v.name)) r += 2;
  if (/\b(samantha|daniel|karen|moira|serena|tessa|ava|allison|susan)\b/i.test(v.name)) r += 2;
  if (/\b(david|zira|mark|hazel)\b/i.test(v.name) && /desktop|microsoft/i.test(v.name) && !/online/i.test(v.name)) r -= 3;
  if (v.lang === "en-GB" || v.lang === "en-US") r += 1;
  if (!v.localService) r += 1;
  return r;
}

/** This browser's English voices, the most natural first. */
export function browserVoices(): SpeechSynthesisVoice[] {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return [];
  return window.speechSynthesis
    .getVoices()
    .filter((v) => v.lang.toLowerCase().startsWith("en") && !NOVELTY.test(v.name))
    .sort((a, b) => rank(b) - rank(a));
}

/** The browser's voices, once it has listed them (Chrome lists them a moment after the page loads: speaking
 *  before then reads with the system's default voice, the most mechanical). At most `wait` ms. */
export function voicesReady(wait = 1500): Promise<void> {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return Promise.resolve();
  const synth = window.speechSynthesis;
  if (synth.getVoices().length) return Promise.resolve();
  return new Promise((resolve) => {
    const done = () => {
      synth.removeEventListener?.("voiceschanged", done);
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(done, wait);
    synth.addEventListener?.("voiceschanged", done);
  });
}

/** The voice to read with: the one chosen (by its URI), else the best. */
export function pickBrowserVoice(uri: string): SpeechSynthesisVoice | null {
  const list = browserVoices();
  return list.find((v) => v.voiceURI === uri) ?? list[0] ?? null;
}

export function speakBrowser(lines: string[], voice: SpeechSynthesisVoice | null, o: SpeakOptions): Speaking {
  const synth = window.speechSynthesis;
  let stopped = false;
  if (!lines.length) {
    o.onEnd();
    return { stop() {}, pause() {}, resume() {} };
  }
  lines.forEach((text, j) => {
    const u = new SpeechSynthesisUtterance(text);
    if (voice) u.voice = voice;
    u.lang = voice?.lang ?? "en-GB";
    u.rate = o.speed;
    u.onstart = () => !stopped && o.onLine(text);
    if (j === lines.length - 1) u.onend = () => !stopped && o.onEnd();
    synth.speak(u);
  });
  return {
    stop: () => {
      stopped = true;
      synth.cancel();
    },
    pause: () => synth.pause(),
    resume: () => synth.resume(),
  };
}

// Test hook, as the gallery's (Gallery.tsx): an init script sets window.__MUSEUM_DEBUG__
if (typeof window !== "undefined" && (window as unknown as { __MUSEUM_DEBUG__?: boolean }).__MUSEUM_DEBUG__) {
  (window as unknown as { __voice?: NaturalVoice }).__voice = naturalVoice;
}
