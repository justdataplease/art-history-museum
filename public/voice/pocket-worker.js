// The audio guide's Pocket voices (src/components/museum/voice.ts): Pocket TTS, Kyutai's neural text-to-speech
// model (CC BY 4.0), run in the visitor's browser on the processor (WebAssembly, one thread). It sounds very like a
// person and needs no graphics card, but it works hard: here about 0.4 s for a second of speech and about 300 MB of
// memory, so it reads only when the visitor chooses it, and voice.ts times it as it reads (too slow, and the
// browser's voice takes over). Its code comes from jsdelivr (the runtime, pinned) and this site (pocket-core.js, the
// model's loop), the model from Hugging Face: one language's package (bundle.json lists its files and their sizes,
// about 116 MB) and a voice of a few MB (voices/<id>.bin, the model having heard the speaker). The browser keeps them
// (Cache API), so only the first visit downloads them, and a second Pocket voice is only its own few MB.
// Pocket has no speed control: it speaks at its own pace, whatever the guide's speed (voice.ts asks for none).
//
// Messages in:  {type: "load", voice} | {type: "speak", id, text, voice?}
// Messages out: {type: "progress", loaded, total} | {type: "ready", voice} | {type: "audio", id, sr, samples, ms}
//               | {type: "error", id?, error}

const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs";
// The English package's public copy on Hugging Face (justdataplz/pocket-tts-web, shared with everkept.net), pinned
// to a commit, not "main" (the browser keeps the files by their URL: a new revision is downloaded afresh, and the
// old one cleared once the new one reads). The folder holds bundle.json, the files it lists and voices/<id>.bin
// (alba, jane, george, michael).
const BUNDLE = "https://huggingface.co/justdataplz/pocket-tts-web/resolve/6b4b63629eade4a8fe97304421305ebe1d3e0deb/english";
/** Where the package is kept (voice.ts reads it to tell whether the Pocket voices are on this device). */
const CACHE = "museum-voice-pocket";
/** A voice's file, bytes, until its server says (they are 3 to 3.7 MB). */
const VOICE_BYTES = 3.5e6;

let ort = null;
let pocket = null; // the engine (pocket-core.js), once its package is open
let voice = null; // the voice read last
let loading = null;
/** The download under way: the bytes of the files already in, and all it will take. */
let done = 0;
let total = 0;

/** The file, from the browser's cache or downloaded (and kept), reporting progress. `bytes`: the size the package
 *  lists for it, so a download cut short is never kept (it would fail on every visit after). */
async function fetchKept(url, bytes, progress) {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url).catch(() => null);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`);
  const size = bytes || Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done: end, value } = await reader.read();
    if (end) break;
    parts.push(value);
    loaded += value.length;
    progress?.(loaded, size);
  }
  if (bytes && loaded !== bytes) throw new Error(`${url}: ${loaded} bytes of ${bytes}`);
  const out = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  await cache?.put(url, new Response(out, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return out;
}

/** A file of the package, counted in the download's progress (one kept already counts as in). */
async function file(name, bytes) {
  const b = await fetchKept(`${BUNDLE}/${name}`, bytes, (loaded, size) => {
    total = Math.max(total, done + size);
    self.postMessage({ type: "progress", loaded: done + loaded, total });
  });
  done += b.length;
  return b;
}

/** The files of an older package (BUNDLE moved to a new revision): 116 MB the browser need not keep. */
async function prune() {
  try {
    const cache = await caches.open(CACHE);
    for (const r of await cache.keys()) if (!r.url.startsWith(`${BUNDLE}/`)) await cache.delete(r);
  } catch {}
}

async function load(id) {
  done = 0;
  const first = !pocket;
  if (first) {
    ort ??= await import(ORT);
    ort.env.wasm.numThreads = 1; // the page is not cross-origin isolated: no threads, and the gallery keeps the rest
    const { openPocket } = await import("./pocket-core.js");
    const list = await fetchKept(`${BUNDLE}/bundle.json`);
    const sizes = new Map(JSON.parse(new TextDecoder().decode(list)).files.map((f) => [f.name, f.bytes]));
    // the whole download from the first file (the package's, then the voice's), so the bar moves evenly
    total = [...sizes.values()].reduce((a, b) => a + b, 0) + VOICE_BYTES;
    pocket = await openPocket(ort, (name) => (name === "bundle.json" ? Promise.resolve(list) : file(name, sizes.get(name))));
  } else total = VOICE_BYTES;
  // the voice: the model's memory of the speaker, read once
  await pocket.voice(id);
  // the first run sets up the model's buffers: spend it now, not on the visitor's first painting
  if (!voice) await pocket.synth("Welcome.", id);
  voice = id;
  self.postMessage({ type: "ready", voice: id });
  if (first) void prune();
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "load") {
      // one voice at a time: a second asked for while the first loads waits for it, then replaces it
      loading = (loading ?? Promise.resolve()).catch(() => {}).then(() =>
        voice === m.voice ? self.postMessage({ type: "ready", voice: m.voice }) : load(m.voice)
      );
      await loading;
    } else if (m.type === "speak") {
      await loading;
      const t = performance.now();
      const { samples, sr } = await pocket.synth(m.text, m.voice || voice);
      self.postMessage({ type: "audio", id: m.id, sr, samples, ms: performance.now() - t }, [samples.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, error: String((err && err.message) || err) });
  }
};
