// The audio guide's light AI voice (src/components/museum/voice.ts): Piper, a small neural text-to-speech model
// (VITS, about 63 MB a voice), run in the visitor's browser on the processor (WebAssembly, one thread). It keeps
// ahead of speech on a modest laptop (here a sentence takes about a seventh of the time it lasts) and leaves the
// graphics card to the gallery, so it works where the studio voice (kokoro-worker.js, WebGPU) cannot. Its code
// comes from jsdelivr (pinned), the voices from Hugging Face (rhasspy/piper-voices); the browser keeps the voice
// (Cache API), so only the first visit downloads it. Text becomes phonemes with eSpeak NG (the phonemizer
// package, as Piper itself does), phonemes become the voice's ids (its .onnx.json), the model makes the audio.
//
// Messages in:  {type: "load", voice} | {type: "speak", id, text, speed}
// Messages out: {type: "progress", loaded, total} | {type: "ready"} | {type: "audio", id, sr, samples, ms}
//               | {type: "error", id?, error}

const ORT = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.wasm.min.mjs";
const PHONEMIZER = "https://cdn.jsdelivr.net/npm/phonemizer@1.2.1/dist/phonemizer.js";
const VOICES = "https://huggingface.co/rhasspy/piper-voices/resolve/main";
/** Where the voices are kept (voice.ts reads it to tell whether a voice is on this device). */
const CACHE = "museum-voice";
/** A voice's model, bytes, when its server does not say (the medium voices are all about this size). */
const MODEL_BYTES = 63.5e6;

let ort = null;
let phonemize = null;
let voice = null; // { id, session, config }
let loading = null;

/** en_GB-cori-medium -> en/en_GB/cori/medium/en_GB-cori-medium */
function voicePath(id) {
  const [lang, name, quality] = id.split("-");
  return `${VOICES}/${lang.split("_")[0]}/${lang}/${name}/${quality}/${id}`;
}

/** The file, from the browser's cache or downloaded (and kept), reporting progress. */
async function fetchKept(url, progress) {
  const cache = await caches.open(CACHE).catch(() => null);
  const hit = await cache?.match(url).catch(() => null);
  if (hit) return new Uint8Array(await hit.arrayBuffer());
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`${res.status} ${url}`);
  const total = Number(res.headers.get("content-length")) || 0;
  const reader = res.body.getReader();
  const parts = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    loaded += value.length;
    progress?.(loaded, total);
  }
  const bytes = new Uint8Array(loaded);
  let at = 0;
  for (const p of parts) {
    bytes.set(p, at);
    at += p.length;
  }
  await cache?.put(url, new Response(bytes, { headers: { "content-type": "application/octet-stream" } })).catch(() => {});
  return bytes;
}

async function load(id) {
  ort ??= await import(ORT);
  ort.env.wasm.numThreads = 1; // the page is not cross-origin isolated: no threads, and the gallery keeps the rest
  phonemize ??= (await import(PHONEMIZER)).phonemize;
  const base = voicePath(id);
  const config = await (await fetchKept(`${base}.onnx.json`).then((b) => new Response(b))).json();
  const model = await fetchKept(`${base}.onnx`, (loaded, total) =>
    self.postMessage({ type: "progress", loaded, total: Math.max(total, MODEL_BYTES) })
  );
  const session = await ort.InferenceSession.create(model, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
  voice?.session.release?.();
  voice = { id, session, config };
  // the first run sets up the model's buffers: spend it now, not on the visitor's first painting
  await synth("Welcome.", 1);
  self.postMessage({ type: "ready", voice: id });
}

const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const twoDigits = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? `-${ONES[n % 10]}` : ""));
const DECADES = { twenty: "twenties", thirty: "thirties", forty: "forties", fifty: "fifties", sixty: "sixties",
  seventy: "seventies", eighty: "eighties", ninety: "nineties", ten: "tens" };

/** Years as they are said (eSpeak reads 1599 as a number): fifteen ninety-nine, nineteen hundred, nineteen oh
 *  five, twenty twelve; the 1590s; 1599–1606 as "1599 to 1606". */
function sayYears(text) {
  return text
    .replace(/\b(1\d{3}|20\d{2})\s*[–—-]\s*(1\d{3}|20\d{2})\b/g, "$1 to $2")
    .replace(/\b(1\d|20)([1-9])0s\b/g, (_, hi, d) => `${twoDigits(+hi)} ${DECADES[twoDigits(+d * 10)]}`)
    .replace(/(^|[^\d,.])(1\d|20)(\d\d)(?![\d,%]|\.\d)/g, (all, pre, hi, lo) => {
      const n = +lo;
      if ((hi === "20" || hi === "10") && n < 10) return all; // two thousand and five, one thousand
      return `${pre}${twoDigits(+hi)} ${n === 0 ? "hundred" : n < 10 ? `oh ${ONES[n]}` : twoDigits(n)}`;
    });
}

/** Clause by clause, as Piper's own phonemizer: eSpeak's phonemes, then the clause's punctuation (a comma, colon
 *  or semicolon followed by a space), so the voice pauses and rises where the text does. */
async function toPhonemes(text, lang) {
  const parts = sayYears(text).replace(/[“”«»]/g, '"').replace(/[‘’]/g, "'").split(/([.,;:!?]+(?=\s|$))/);
  let out = "";
  for (let i = 0; i < parts.length; i += 2) {
    const words = parts[i].replace(/["()[\]{}]/g, " ").trim();
    if (words) out += (await phonemize(words, lang)).join(" ").replace(/\([a-z-]+\)/g, "");
    const p = parts[i + 1]?.trim().slice(-1);
    if (p) out += /[,;:]/.test(p) ? `${p} ` : p;
  }
  return out.trim();
}

/** Phonemes to the voice's ids: start, a pad after each, end (Piper's phonemes_to_ids). */
function toIds(phonemes, map) {
  const pad = map._[0];
  const ids = [map["^"][0], pad];
  for (const ch of phonemes.normalize("NFD")) {
    const m = map[ch];
    if (!m) continue;
    ids.push(...m, pad);
  }
  ids.push(map.$[0]);
  return ids;
}

async function synth(text, speed) {
  const { session, config } = voice;
  const ids = toIds(await toPhonemes(text, config.espeak?.voice || "en-us"), config.phoneme_id_map);
  const inf = config.inference ?? {};
  const feeds = {
    input: new ort.Tensor("int64", BigInt64Array.from(ids, BigInt), [1, ids.length]),
    input_lengths: new ort.Tensor("int64", BigInt64Array.from([BigInt(ids.length)]), [1]),
    scales: new ort.Tensor("float32", Float32Array.from([inf.noise_scale ?? 0.667, (inf.length_scale ?? 1) / speed, inf.noise_w ?? 0.8]), [3]),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor("int64", BigInt64Array.from([0n]), [1]);
  const out = await session.run(feeds);
  const samples = new Float32Array(out.output.data);
  // every sentence at the same loudness (Piper normalises each to its peak)
  let peak = 0;
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]));
  const gain = peak > 0.01 ? 0.9 / peak : 1;
  for (let i = 0; i < samples.length; i++) samples[i] *= gain;
  return { samples, sr: config.audio.sample_rate };
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "load") {
      // one voice at a time: a second asked for while the first loads waits for it, then replaces it
      loading = (loading ?? Promise.resolve()).catch(() => {}).then(() =>
        voice?.id === m.voice ? self.postMessage({ type: "ready", voice: m.voice }) : load(m.voice)
      );
      await loading;
    } else if (m.type === "speak") {
      await loading;
      const t = performance.now();
      const { samples, sr } = await synth(m.text, m.speed);
      self.postMessage({ type: "audio", id: m.id, sr, samples, ms: performance.now() - t }, [samples.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, error: String((err && err.message) || err) });
  }
};
