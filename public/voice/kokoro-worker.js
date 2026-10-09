// The audio guide's natural voice (src/components/museum/voice.ts): Kokoro, an open text-to-speech model, run in
// the visitor's browser on the graphics card (WebGPU). Its code comes from jsdelivr (pinned), its weights and
// voices from Hugging Face; the browser keeps them (Cache API), so only the first visit downloads them (~330 MB).
// Only the full-precision weights speak on WebGPU (fp16 and the quantised ones come out silent or garbled), and
// on the processor alone it is slower than speech, so this runs only where a WebGPU adapter is found.
//
// Messages in:  {type: "load"} | {type: "speak", id, text, voice, speed}
// Messages out: {type: "progress", loaded, total} | {type: "ready"} | {type: "audio", id, sr, samples}
//               | {type: "error", id?, error}

const LIB = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

let tts = null;
let loading = null;
const files = new Map();

async function load() {
  const kokoro = await import(LIB);
  tts = await kokoro.KokoroTTS.from_pretrained(MODEL, {
    dtype: "fp32",
    device: "webgpu",
    progress_callback: (p) => {
      if (p.status !== "progress" || !p.total) return;
      files.set(p.file, [p.loaded, p.total]);
      let loaded = 0;
      let total = 0;
      for (const [l, t] of files.values()) {
        loaded += l;
        total += t;
      }
      self.postMessage({ type: "progress", loaded, total });
    },
  });
  // the first sentence compiles the GPU's shaders (seconds): spend it now, not on the visitor's first painting
  await tts.generate("Welcome.", { voice: "af_heart" });
  self.postMessage({ type: "ready" });
}

self.onmessage = async ({ data: m }) => {
  try {
    if (m.type === "load") {
      loading ??= load();
      await loading;
    } else if (m.type === "speak") {
      if (!tts) await (loading ??= load());
      const a = await tts.generate(m.text, { voice: m.voice, speed: m.speed });
      const samples = a.audio;
      // the model's peaks run a little over full scale
      for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i] * 0.94));
      self.postMessage({ type: "audio", id: m.id, sr: a.sampling_rate, samples }, [samples.buffer]);
    }
  } catch (err) {
    self.postMessage({ type: "error", id: m.id, error: String((err && err.message) || err) });
  }
};
