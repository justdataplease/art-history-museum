// The film deck: loads a film and plays it, and tells the room what the projector is throwing.
//
// Two ways to play (Film.kind):
// - projected ("file", "hls"): a <video> open to other sites (crossOrigin), read as a texture for the screen, and
//   every few frames drawn into a tiny canvas whose average colour lights the room and whose pixels colour the
//   beam. HLS (ERT's archive) through hls.js where the browser has no HLS of its own. A file
//   whose host refuses other sites plays as a DOM <video> behind the screen instead (like an embed);
// - embedded ("youtube", "vimeo", "dailymotion"): the provider's player (an <iframe>) placed on the screen
//   (FilmNook: drei Html behind a hole in the canvas), driven by its postMessage API. Its picture cannot be
//   read, so the room's light flickers in a neutral colour.
//
// One deck per gallery (its films' corner); React reads its state through subscribe/getState (useSyncExternalStore).

import * as THREE from "three";
import type { Film } from "@/lib/types";

export type DeckStatus = "idle" | "loading" | "playing" | "paused" | "ended" | "error";
export interface DeckState {
  film: Film | null;
  status: DeckStatus;
  /** How the picture reaches the screen: a texture, or a DOM element behind the canvas. */
  mode: "texture" | "dom" | null;
  time: number;
  duration: number;
  error: string | null;
}

const SAMPLE_W = 48;
const SAMPLE_H = 27;
const SAMPLE_MS = 70;

type HlsLike = { loadSource(u: string): void; attachMedia(v: HTMLVideoElement): void; destroy(): void; on(e: string, f: (...a: unknown[]) => void): void };

export class FilmDeck {
  state: DeckState = { film: null, status: "idle", mode: null, time: 0, duration: 0, error: null };
  private listeners = new Set<() => void>();
  readonly video: HTMLVideoElement | null;
  /** The picture, for the screen (projected films). */
  readonly texture: THREE.VideoTexture | null;
  /** The picture, tiny: the beam's colours. */
  readonly small: THREE.CanvasTexture | null;
  private sampleCtx: CanvasRenderingContext2D | null = null;
  private lastSample = 0;
  private sampledTime = -1;
  /** The light the screen gives the room (linear RGB, 0..1). */
  readonly light = new THREE.Color(0, 0, 0);
  private hls: HlsLike | null = null;
  private sourceIndex = 0;
  private offError: (() => void) | null = null;
  /** The embedded player's frame (FilmNook registers it). */
  private frame: HTMLIFrameElement | null = null;
  private frameReady = false;
  private pendingPlay = false;
  private loadId = 0;
  volume = 1;

  constructor() {
    if (typeof document === "undefined") {
      this.video = null;
      this.texture = null;
      this.small = null;
      return;
    }
    const v = document.createElement("video");
    v.playsInline = true;
    v.preload = "auto";
    v.crossOrigin = "anonymous";
    this.video = v;
    const tex = new THREE.VideoTexture(v);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    this.texture = tex;
    const c = document.createElement("canvas");
    c.width = SAMPLE_W;
    c.height = SAMPLE_H;
    this.sampleCtx = c.getContext("2d", { willReadFrequently: true });
    const small = new THREE.CanvasTexture(c);
    small.colorSpace = THREE.SRGBColorSpace;
    small.minFilter = THREE.LinearFilter;
    small.magFilter = THREE.LinearFilter;
    small.generateMipmaps = false;
    this.small = small;
    v.addEventListener("playing", () => this.set({ status: "playing", error: null }));
    v.addEventListener("pause", () => this.state.status === "playing" && this.set({ status: "paused" }));
    v.addEventListener("waiting", () => this.state.status === "playing" && this.set({ status: "loading" }));
    v.addEventListener("ended", () => this.set({ status: "ended" }));
    v.addEventListener("durationchange", () => this.set({ duration: Number.isFinite(v.duration) ? v.duration : 0 }));
    v.addEventListener("timeupdate", () => this.set({ time: v.currentTime }));
    if (typeof window !== "undefined") window.addEventListener("message", this.onMessage);
  }

  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => this.listeners.delete(f);
  };
  getState = () => this.state;
  private set(patch: Partial<DeckState>) {
    this.state = { ...this.state, ...patch };
    this.listeners.forEach((f) => f());
  }

  /** Projected films need an open host; the embeds need their provider. */
  static projected(f: Film): boolean {
    return f.kind === "file" || f.kind === "hls";
  }

  async load(film: Film, autoplay = true): Promise<void> {
    const id = ++this.loadId;
    this.unload();
    this.set({ film, status: "loading", mode: FilmDeck.projected(film) ? "texture" : "dom", time: 0, duration: film.seconds ?? 0, error: null });
    if (!FilmDeck.projected(film)) {
      this.pendingPlay = autoplay;
      return; // the scene mounts the provider's frame; register() starts it
    }
    const v = this.video;
    if (!v) return;
    v.crossOrigin = "anonymous";
    try {
      await this.attach(film, v);
    } catch (e) {
      if (id === this.loadId) this.set({ status: "error", error: String(e) });
      return;
    }
    if (id !== this.loadId) return;
    // a rendition the browser cannot play: the next one; none, and the host may refuse other sites: the first
    // as a DOM element (no texture, no colour)
    let next = this.sourceIndex + 1;
    const onError = () => {
      if (id !== this.loadId) return;
      const list = film.kind === "file" ? (film.sources ?? []) : [];
      if (v.crossOrigin !== null && next < list.length) {
        this.sourceIndex = next++;
        v.src = list[this.sourceIndex].src;
        v.load();
        if (autoplay) void v.play().catch(() => {});
        return;
      }
      if (film.kind !== "file" || v.crossOrigin === null) {
        v.removeEventListener("error", onError);
        this.set({ status: "error", error: "This film would not load in this browser." });
        return;
      }
      v.removeAttribute("crossorigin");
      this.set({ mode: "dom" });
      this.sourceIndex = list.findIndex((s) => v.canPlayType(s.type));
      v.src = list[Math.max(0, this.sourceIndex)]?.src ?? "";
      v.load();
      if (autoplay) void v.play().catch(() => {});
    };
    v.addEventListener("error", onError);
    this.offError = () => v.removeEventListener("error", onError);
    this.applyVolume();
    if (autoplay) void v.play().catch(() => this.set({ status: "paused" }));
  }

  private async attach(film: Film, v: HTMLVideoElement): Promise<void> {
    if (film.kind === "file") {
      const list = film.sources ?? [];
      this.sourceIndex = Math.max(0, list.findIndex((s) => v.canPlayType(s.type)));
      v.src = list[this.sourceIndex]?.src ?? "";
      v.load();
      return;
    }
    const url = film.src ?? "";
    // hls.js wherever it runs: a browser's own HLS (Chrome's now too) asks for byte ranges, and ERT's CDN answers
    // them gzipped, which the media stack cannot read (ERR_CONTENT_DECODING_FAILED). The browser's own only
    // where there is no MediaSource (an older iPhone).
    const { default: Hls } = await import("hls.js");
    if (!Hls.isSupported()) {
      if (!v.canPlayType("application/vnd.apple.mpegurl")) throw new Error("This browser cannot play the stream.");
      v.src = url;
      v.load();
      return;
    }
    const hls = new Hls({ maxBufferLength: 30, capLevelToPlayerSize: false }) as unknown as HlsLike;
    hls.on(Hls.Events.ERROR, (...args: unknown[]) => {
      const data = args[1] as { fatal?: boolean; details?: string } | undefined;
      if (data?.fatal) this.set({ status: "error", error: `The stream stopped (${data.details ?? "error"}).` });
    });
    hls.loadSource(url);
    hls.attachMedia(v);
    this.hls = hls;
  }

  unload() {
    this.offError?.();
    this.offError = null;
    this.pendingPlay = false;
    this.frameReady = false;
    this.hls?.destroy();
    this.hls = null;
    const v = this.video;
    if (v) {
      v.pause();
      v.removeAttribute("src");
      v.load();
    }
    this.light.setRGB(0, 0, 0);
  }

  play() {
    const f = this.state.film;
    if (!f) return;
    if (FilmDeck.projected(f)) {
      if (this.state.status === "ended" && this.video) this.video.currentTime = 0;
      void this.video?.play().catch(() => {});
    } else this.command("play");
  }
  pause() {
    const f = this.state.film;
    if (!f) return;
    if (FilmDeck.projected(f)) this.video?.pause();
    else this.command("pause");
  }
  toggle() {
    const s = this.state.status;
    if (s === "playing" || s === "loading") this.pause();
    else this.play();
  }
  seek(by: number) {
    const f = this.state.film;
    if (!f) return;
    if (FilmDeck.projected(f) && this.video) {
      const v = this.video;
      v.currentTime = Math.max(0, Math.min((v.duration || 1e9) - 0.5, v.currentTime + by));
    } else this.command("seek", this.state.time + by);
  }

  /** The visitor's distance from the screen sets the volume (a big room, one loudspeaker behind the screen). */
  setVolume(v: number) {
    if (Math.abs(v - this.volume) < 0.02) return;
    this.volume = v;
    this.applyVolume();
  }
  private applyVolume() {
    const vol = this.volume;
    if (this.video) this.video.volume = Math.min(1, Math.max(0, vol));
    this.command("volume", Math.round(vol * 100));
  }

  // ------------------------------------------------------------- the embedded players

  /** The provider's frame for the current film (null when it unmounts). */
  register(frame: HTMLIFrameElement | null) {
    this.frame = frame;
    this.frameReady = false;
  }
  /** The frame has loaded: listen to it, and start it when the visitor asked to. */
  frameLoaded() {
    const f = this.state.film;
    if (!f || !this.frame) return;
    this.frameReady = true;
    if (f.kind === "youtube") {
      this.post({ event: "listening", id: 1, channel: "widget" });
    } else if (f.kind === "vimeo") {
      for (const e of ["play", "pause", "ended", "timeupdate"]) this.post({ method: "addEventListener", value: e });
    }
    this.applyVolume();
    if (this.pendingPlay) {
      this.pendingPlay = false;
      this.command("play");
    }
    if (f.kind === "dailymotion") this.set({ status: "playing" }); // no events from it: autoplayed
  }

  private post(msg: object) {
    this.frame?.contentWindow?.postMessage(JSON.stringify(msg), "*");
  }

  private command(what: "play" | "pause" | "seek" | "volume", arg?: number) {
    const f = this.state.film;
    if (!f || FilmDeck.projected(f)) return;
    if (!this.frameReady) {
      if (what === "play") this.pendingPlay = true;
      return;
    }
    if (f.kind === "youtube") {
      const func = { play: "playVideo", pause: "pauseVideo", seek: "seekTo", volume: "setVolume" }[what];
      this.post({ event: "command", func, args: what === "seek" ? [arg ?? 0, true] : arg !== undefined ? [arg] : [] });
    } else if (f.kind === "vimeo") {
      const method = { play: "play", pause: "pause", seek: "setCurrentTime", volume: "setVolume" }[what];
      this.post({ method, value: what === "volume" ? (arg ?? 100) / 100 : arg });
    } else if (f.kind === "dailymotion") {
      // its frame takes no orders here: pausing stops it (the frame unmounts), playing loads it again
      if (what === "pause") this.set({ status: "paused" });
      if (what === "play") this.set({ status: "playing" });
    }
    if (what === "play" && f.kind !== "dailymotion") this.set({ status: "loading" });
  }

  private onMessage = (e: MessageEvent) => {
    const f = this.state.film;
    if (!f || FilmDeck.projected(f) || !this.frame || e.source !== this.frame.contentWindow) return;
    let d: Record<string, unknown>;
    try {
      d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
    } catch {
      return;
    }
    if (f.kind === "youtube") {
      const info = d.info as Record<string, unknown> | number | undefined;
      if (d.event === "onStateChange" && typeof info === "number") this.ytState(info);
      if (d.event === "infoDelivery" && info && typeof info === "object") {
        if (typeof info.playerState === "number") this.ytState(info.playerState);
        if (typeof info.currentTime === "number") this.set({ time: info.currentTime });
        if (typeof info.duration === "number" && info.duration > 0) this.set({ duration: info.duration });
      }
      if (d.event === "onError") this.set({ status: "error", error: "YouTube will not play this film here." });
    } else if (f.kind === "vimeo") {
      const ev = d.event as string | undefined;
      if (ev === "play") this.set({ status: "playing" });
      if (ev === "pause") this.set({ status: "paused" });
      if (ev === "ended") this.set({ status: "ended" });
      if (ev === "timeupdate") {
        const data = d.data as { seconds?: number; duration?: number } | undefined;
        this.set({ time: data?.seconds ?? this.state.time, duration: data?.duration ?? this.state.duration });
      }
    }
  };

  private ytState(s: number) {
    // -1 unstarted, 0 ended, 1 playing, 2 paused, 3 buffering, 5 cued
    if (s === 1) this.set({ status: "playing" });
    else if (s === 2) this.set({ status: "paused" });
    else if (s === 0) this.set({ status: "ended" });
    else if (s === 3) this.set({ status: "loading" });
  }

  // ------------------------------------------------------------- the picture's light

  /** Per frame: the tiny copy of the picture and its average colour (projected films; throttled). */
  sample(now: number): boolean {
    const v = this.video;
    const ctx = this.sampleCtx;
    if (!v || !ctx || this.state.mode !== "texture" || v.readyState < 2) return false;
    if (now - this.lastSample < SAMPLE_MS || v.currentTime === this.sampledTime) return false;
    this.lastSample = now;
    this.sampledTime = v.currentTime;
    try {
      ctx.drawImage(v, 0, 0, SAMPLE_W, SAMPLE_H);
      const px = ctx.getImageData(0, 0, SAMPLE_W, SAMPLE_H).data;
      let r = 0, g = 0, b = 0;
      for (let i = 0; i < px.length; i += 4) {
        r += px[i];
        g += px[i + 1];
        b += px[i + 2];
      }
      const n = (px.length / 4) * 255;
      // sRGB average -> linear
      this.light.setRGB(r / n, g / n, b / n, THREE.SRGBColorSpace);
      if (this.small) this.small.needsUpdate = true;
      return true;
    } catch {
      // a tainted frame (the host stopped sending CORS headers): no light from it
      return false;
    }
  }

  dispose() {
    this.unload();
    if (typeof window !== "undefined") window.removeEventListener("message", this.onMessage);
    this.texture?.dispose();
    this.small?.dispose();
  }
}

/** The provider's player for an embedded film: the frame's address. */
export function embedSrc(f: Film, origin: string): string | null {
  const id = encodeURIComponent(f.src ?? "");
  if (f.kind === "youtube") {
    return `https://www.youtube-nocookie.com/embed/${id}?enablejsapi=1&playsinline=1&rel=0&controls=0&modestbranding=1&iv_load_policy=3&disablekb=1&fs=0&origin=${encodeURIComponent(origin)}`;
  }
  if (f.kind === "vimeo") return `https://player.vimeo.com/video/${id}?api=1&controls=0&dnt=1&playsinline=1&title=0&byline=0&portrait=0`;
  if (f.kind === "dailymotion") return `https://www.dailymotion.com/embed/video/${id}?autoplay=1&queue-enable=false&ui-start-screen-info=false`;
  return null;
}
