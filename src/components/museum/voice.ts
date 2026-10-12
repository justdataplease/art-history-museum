// The audio guide's voices. Two kinds, one interface (speak lines, one at a time, with the line being read):
// - the browser's own voice (Web Speech API), the most natural of those it offers: Edge's "Natural" voices,
//   Safari's Premium and Enhanced ones, Android's network (neural) voices, Google's, never the novelty voices.
//   The guide's voice unless the visitor chooses Pocket;
// - Pocket (Kyutai's Pocket TTS, public/voice/pocket-worker.js and pocket-core.js): a neural text-to-speech model,
//   very natural, run in a worker on this device's processor, downloaded once (about 120 MB, the browser keeps it)
//   and only when the visitor chooses one of its four voices (Settings → Audio guide → Natural), never by itself.
//   It works hard (here 0.4 s for a second of speech, and about 300 MB of memory), so it is timed as it reads: where
//   it cannot keep ahead, the browser's voice reads (remembered on this device). It has no speed control: it speaks
//   at its own pace, whatever the guide's speed.
// Sentences are made one at a time, the one about to be heard first, then the next, and the guide asks for the
// first sentence of the painting the visitor is turning to before it starts (prefetch). A long sentence is made in
// pieces at its commas, so the voice starts sooner. The browser's voice reads at the guide's speed (settings.ts
// guideSpeed).

export type NaturalState = "idle" | "loading" | "ready" | "slow" | "error";

export interface NaturalVoiceInfo {
  id: string;
  label: string;
}

/** Pocket's English voices: Alba, a Scottish reader; Jane, George and Michael, British speakers of the VCTK corpus
 *  (their ids are its package's voices/<id>.bin). Natural starts with the first. */
export const NATURAL_VOICES: NaturalVoiceInfo[] = [
  { id: "alba", label: "Alba (Scottish)" },
  { id: "jane", label: "Jane (British)" },
  { id: "george", label: "George (British)" },
  { id: "michael", label: "Michael (British)" },
];
/** Pocket's download, MB: its package, a voice and the runtime. */
export const POCKET_MB = 120;
/** What the download is counted against until its files have all announced themselves (the worker counts its whole
 *  download from the first file, its package's list in hand: here only the least it takes, a voice's few MB when the
 *  model is in already). */
const MODEL_BYTES = 3e6;
const WORKER = "/voice/pocket-worker.js";

/** The breath between two sentences, and between two pieces of one, seconds. */
const BREATH = 0.28;
const JOIN = 0.05;
/** Keeping up: seconds of work per second of speech, over Pocket's first sentences (on the processor, it need only
 *  keep ahead). */
const TOO_SLOW = 0.9;
const JUDGE_AFTER = 3;
/** Sentences kept, made (replays and the painting turned back to cost nothing). */
const KEEP = 60;

/** Pocket too slow on this device ({pocket: true}). */
const SLOW_KEY = "timeline-museum:voice-too-slow";
/** Where the model is kept (the worker's cache, keyed by the file's URL). */
const POCKET_CACHE = "museum-voice-pocket";
const POCKET_FILE = /\/flow_lm_main\.onnx$/;

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

function readSlow(): boolean {
  try {
    return (JSON.parse(localStorage.getItem(SLOW_KEY) ?? "{}") as { pocket?: boolean }).pocket === true;
  } catch {
    return false;
  }
}

// ------------------------------------------------------------------------------------------------ Pocket

interface Job {
  key: string;
  text: string;
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
  /** The voice loaded (or loading). */
  voice: string | null = null;
  /** Bumped when the model is found on (or put on) this device, so `onDevice` readers re-render. */
  devices = 0;
  private worker: Worker | null = null;
  private wanted: string | null = null;
  private stored: boolean | null = null;
  private asked = false;
  private ctx: AudioContext | null = null;
  private queue: Job[] = [];
  private busy: Job | null = null;
  private sentAt = 0;
  private readings = 0;
  private made = new Map<string, Promise<AudioBuffer>>();
  private timing = { work: 0, speech: 0, n: 0 };
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

  /** Whether Pocket's model is on this device already (downloaded once): choosing a voice downloads nothing but its
   *  own few MB. Null until the browser has answered. */
  onDevice(): boolean | null {
    if (this.stored === null && !this.asked) {
      this.asked = true;
      void (async () => {
        try {
          if (!("caches" in window) || !(await caches.has(POCKET_CACHE))) return false;
          const keys = await (await caches.open(POCKET_CACHE)).keys();
          return keys.some((r) => POCKET_FILE.test(r.url));
        } catch {
          return false;
        }
      })().then((yes) => {
        this.stored ||= yes;
        this.devices++;
        this.emit();
      });
    }
    return this.stored;
  }

  /** Start downloading and warming the voice chosen (once; another Pocket voice replaces the one loaded, the model
   *  staying). Where Pocket was too slow, nothing loads ("slow": the browser's voice reads). */
  load(choice: string) {
    // Settings and the guide ask together: once
    if (this.wanted === choice && this.state !== "error") return;
    this.wanted = choice;
    const slow = readSlow();
    // (not a Pocket voice: settings.ts gives a voice since removed back to the browser's, so it never reaches here)
    if (slow || !voiceInfo(choice)) {
      this.drop();
      return this.set(slow ? "slow" : "idle");
    }
    if (this.worker) this.reset();
    else this.start();
    this.voice = choice;
    this.progress = 0;
    this.timing = { work: 0, speech: 0, n: 0 };
    this.set("loading");
    this.worker!.postMessage({ type: "load", voice: choice });
  }

  /** Resolves when the voice asked for last can read (false: none will). */
  whenReady(): Promise<boolean> {
    if (this.state !== "loading") return Promise.resolve(this.state === "ready");
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

  private start() {
    const w = new Worker(WORKER, { type: "module" });
    this.worker = w;
    w.onmessage = ({ data: m }) => {
      if (w !== this.worker) return;
      if (m.type === "progress") {
        // files announce themselves as they start: count against the whole download from the first
        this.progress = Math.min(0.99, m.loaded / Math.max(m.total, MODEL_BYTES));
        this.emit();
      } else if (m.type === "ready") {
        // (a voice chosen while another was loading: only the last one counts)
        if (m.voice !== this.voice) return;
        this.progress = 1;
        // the model is here now, for all four voices (see onDevice)
        this.stored = true;
        this.devices++;
        this.set("ready");
        this.pump();
      } else if (m.type === "audio") {
        const job = this.busy;
        if (!job) return;
        this.busy = null;
        const ms = performance.now() - this.sentAt;
        const samples = m.samples as Float32Array<ArrayBuffer>;
        // a model that runs but says nothing (silence, or NaN): it gives way, as when too slow
        let peak = 0;
        for (let i = 0; i < samples.length; i += 7) peak = Math.max(peak, Math.abs(samples[i]));
        if (!(peak > 1e-3)) {
          job.reject(new Error("silent"));
          this.made.delete(job.key);
          return this.giveWay();
        }
        const buf = new AudioBuffer({ length: samples.length, sampleRate: m.sr });
        buf.copyToChannel(samples, 0);
        job.resolve(buf);
        this.judge(ms, buf.duration);
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

  /** The model's work against the speech it made, over its first sentences: too slow, and it gives way to the
   *  browser's voice, remembered on this device. */
  private judge(ms: number, seconds: number) {
    const t = this.timing;
    if (t.n >= JUDGE_AFTER || seconds < 0.8) return;
    t.work += ms / 1000;
    t.speech += seconds;
    if (++t.n >= JUDGE_AFTER && t.work / t.speech > TOO_SLOW) this.giveWay();
  }

  private giveWay() {
    try {
      localStorage.setItem(SLOW_KEY, JSON.stringify({ pocket: true }));
    } catch {}
    this.drop();
    this.set("slow");
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
    this.worker.postMessage({ type: "speak", id: 1, text: job.text, voice: this.voice });
  }

  private synth(text: string, owner: number): Promise<AudioBuffer> {
    // no voice to make it (it gave way, or failed): the reading ends, and the guide goes on with the browser's
    if (!this.worker || (this.state !== "ready" && this.state !== "loading")) return Promise.reject(new Error("no voice"));
    const key = `${this.voice}|${text}`;
    const had = this.made.get(key);
    if (had) {
      // asked for ahead and now about to be heard: this reading's, first in line
      if (owner !== AHEAD) for (const j of this.queue) if (j.key === key) j.owner = owner;
      this.made.delete(key);
      this.made.set(key, had);
      return had;
    }
    const p = new Promise<AudioBuffer>((resolve, reject) => {
      this.queue.push({ key, text, owner, resolve, reject });
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
  prefetch(lines: string[]) {
    if (this.state !== "ready" || !lines.length) return;
    // a painting walked past leaves nothing behind but the sentence begun
    this.forget(AHEAD);
    for (const text of pieces(lines[0], true).slice(0, 2)) void this.synth(text, AHEAD).catch(() => {});
  }

  /** Read the lines in turn, at Pocket's own pace (`o.speed` is the browser's voice's); the next piece is made while
   *  one is heard. */
  speak(lines: string[], o: SpeakOptions): Speaking {
    const me = ++this.readings;
    const ctx = this.audio();
    void ctx.resume();
    const parts = lines.flatMap((line, i) => pieces(line, i === 0).map((text, j) => ({ text, line, first: j === 0 })));
    let stopped = false;
    let current: AudioBufferSourceNode | null = null;
    // each piece asked for once: what was made is kept by the reading, even if the voice gives way meanwhile
    const got: Promise<AudioBuffer>[] = [];
    const make = (k: number) => (k < parts.length ? (got[k] ??= this.synth(parts[k].text, me)) : null);
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
      src.start(ctx.currentTime + (k === 0 ? 0.02 : parts[k].first ? BREATH : JOIN));
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

// The guide's earlier AI voices are gone (Piper's light voice, about 75 MB, and Kokoro's studio voice, about
// 330 MB): their files, kept by the browser in these caches, go too, and their too-slow verdicts. Nothing else on
// this site uses either cache (Pocket's is POCKET_CACHE).
const GONE_CACHES = ["museum-voice", "transformers-cache"];
if (typeof window !== "undefined") {
  try {
    if ("caches" in window) for (const name of GONE_CACHES) void caches.delete(name).catch(() => {});
  } catch {}
  try {
    if (readSlow()) localStorage.setItem(SLOW_KEY, JSON.stringify({ pocket: true }));
    else localStorage.removeItem(SLOW_KEY);
  } catch {}
}

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
