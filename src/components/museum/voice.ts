// The audio guide's voices. Two engines, one interface (speak lines, one at a time, with the line being read):
// - the browser's own voice (Web Speech API), the most natural of those it offers: Edge's "Natural" voices,
//   Safari's Premium and Enhanced ones, Android's network (neural) voices, Google's, never the novelty voices.
//   The guide's voice unless the visitor chooses the AI one;
// - the natural voice: Kokoro, a neural text-to-speech model, run in a worker on this device's graphics card
//   (public/voice/kokoro-worker.js). It sounds like a person reading, but it is heavy: it needs WebGPU and a
//   one-time ~330 MB download (kept by the browser), and it loads only when the visitor chooses it (Settings →
//   Audio guide → Natural), never by itself; while it loads, and where it cannot run, the browser's voice reads.
// Both read at the guide's speed (settings.ts guideSpeed); sentences are a breath apart.

export type NaturalState = "unsupported" | "idle" | "loading" | "ready" | "error";

/** Kokoro's voices worth hearing (its own grades: Heart A, Bella A-, Emma B-, Michael and George C). */
export const NATURAL_VOICES: { id: string; label: string }[] = [
  { id: "af_heart", label: "Heart" },
  { id: "af_bella", label: "Bella" },
  { id: "bf_emma", label: "Emma (British)" },
  { id: "am_michael", label: "Michael" },
  { id: "bm_george", label: "George (British)" },
];

/** The model's weights and the voices, bytes (onnx-community/Kokoro-82M-v1.0-ONNX, fp32). */
const MODEL_BYTES = 330e6;
/** The breath between two sentences, seconds (at speed 1). */
const BREATH = 0.28;
/** Where the worker's library keeps the model (transformers.js: Cache Storage, keyed by the file's URL). */
const MODEL_CACHE = "transformers-cache";
const MODEL_FILE = /Kokoro-82M-v1\.0-ONNX\/resolve\/[^/]+\/onnx\/model\.onnx$/;

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

// ------------------------------------------------------------------------------------------------ natural

class NaturalVoice {
  state: NaturalState = "idle";
  /** Download progress while loading, 0..1. */
  progress = 0;
  /** The model is in this browser already (downloaded once, by choosing the natural voice): choosing it again
   *  downloads nothing. Null until `checkDevice()` answers. */
  onDevice: boolean | null = null;
  private worker: Worker | null = null;
  private supported: Promise<boolean> | null = null;
  private stored: Promise<boolean> | null = null;
  private ctx: AudioContext | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (b: AudioBuffer) => void; reject: (e: Error) => void }>();
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
  getOnDevice = () => this.onDevice;

  /** A WebGPU adapter here (the model is too slow without one). */
  canRun(): Promise<boolean> {
    if (typeof navigator === "undefined") return Promise.resolve(false);
    const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    this.supported ??= gpu
      ? gpu.requestAdapter().then((a) => !!a).catch(() => false)
      : Promise.resolve(false);
    return this.supported.then((ok) => {
      if (!ok && this.state === "idle") {
        this.state = "unsupported";
        this.emit();
      }
      return ok;
    });
  }

  /** Whether the model is on this device (see `onDevice`). */
  checkDevice(): Promise<boolean> {
    this.stored ??= (async () => {
      try {
        if (!("caches" in window) || !(await caches.has(MODEL_CACHE))) return false;
        const keys = await (await caches.open(MODEL_CACHE)).keys();
        return keys.some((r) => MODEL_FILE.test(r.url)) && (await this.canRun());
      } catch {
        return false;
      }
    })().then((yes) => {
      this.onDevice = yes;
      this.emit();
      return yes;
    });
    return this.stored;
  }

  /** Start downloading and warming the model (once). */
  async load(): Promise<void> {
    if (this.worker || !(await this.canRun())) return;
    this.state = "loading";
    this.emit();
    const w = new Worker("/voice/kokoro-worker.js", { type: "module" });
    this.worker = w;
    w.onmessage = ({ data: m }) => {
      if (m.type === "progress") {
        // files announce themselves as they start: count against the whole model (~330 MB) from the first
        this.progress = Math.min(0.99, m.loaded / Math.max(m.total, MODEL_BYTES));
        this.emit();
      } else if (m.type === "ready") {
        this.state = "ready";
        this.progress = 1;
        this.onDevice = true;
        this.stored = Promise.resolve(true);
        this.emit();
      } else if (m.type === "audio") {
        const job = this.waiting.get(m.id);
        if (!job) return;
        this.waiting.delete(m.id);
        const ctx = this.audio();
        const buf = ctx.createBuffer(1, m.samples.length, m.sr);
        buf.copyToChannel(m.samples, 0);
        job.resolve(buf);
      } else if (m.type === "error") {
        if (m.id && this.waiting.has(m.id)) {
          this.waiting.get(m.id)!.reject(new Error(m.error));
          this.waiting.delete(m.id);
        } else {
          this.state = "error";
          this.emit();
        }
      }
    };
    w.onerror = () => {
      this.state = "error";
      this.emit();
    };
    w.postMessage({ type: "load" });
  }

  private audio(): AudioContext {
    return (this.ctx ??= new AudioContext());
  }

  private synth(text: string, voice: string, speed: number): Promise<AudioBuffer> {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.waiting.set(id, { resolve, reject });
      this.worker!.postMessage({ type: "speak", id, text, voice, speed });
    });
  }

  /** Read the lines in turn; the next is made while one is heard. */
  speak(lines: string[], voice: string, o: SpeakOptions): Speaking {
    const ctx = this.audio();
    void ctx.resume();
    let stopped = false;
    let current: AudioBufferSourceNode | null = null;
    const made = new Map<number, Promise<AudioBuffer>>();
    const make = (k: number) => {
      if (k >= lines.length) return null;
      let p = made.get(k);
      if (!p) {
        p = this.synth(lines[k], voice, o.speed);
        p.catch(() => {});
        made.set(k, p);
      }
      return p;
    };
    const play = async (k: number) => {
      if (stopped) return;
      if (k >= lines.length) return o.onEnd();
      let buf: AudioBuffer;
      try {
        buf = await make(k)!;
      } catch {
        return o.onEnd();
      }
      void make(k + 1);
      if (stopped) return;
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.connect(ctx.destination);
      src.onended = () => {
        if (current === src) current = null;
        play(k + 1);
      };
      current = src;
      src.start(ctx.currentTime + (k === 0 ? 0.02 : BREATH / o.speed));
      o.onLine(lines[k]);
    };
    void play(0);
    return {
      stop: () => {
        stopped = true;
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
