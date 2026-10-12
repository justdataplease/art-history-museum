// Pocket TTS (Kyutai, CC BY 4.0; Greek: myned-ai) on onnxruntime-web. One
// language's package (bundle.json and its files, made by pocket-bundle.py) in,
// 24 kHz audio out. The loop follows Kyutai's pocket_tts and the exporter's
// KV-delta contract (lookbe/pocket-tts-onnx-export): the flow LM returns only
// the attention rows it adds, written here into a 16-bit cache that starts as
// the chosen voice's (the model having heard the speaker), one cache per
// chunk of text; each step makes one 80 ms frame (12.5 a second), refined by
// one flow step and turned into sound by the Mimi decoder.
// Plain ES module: the browser's worker and Node (tests) both import it.

const FLOAT = 0, INT64 = 1, BOOL = 2, HALF = 3;
const asJson = (bytes) => JSON.parse(new TextDecoder().decode(bytes));

// ------------------------------------------------------------------ tokenizer
// SentencePiece (unigram) as data (tokenizer.json): the most likely split of
// the text into pieces, a letter the model has no piece for as its UTF-8 bytes.
export function makeTokenizer(spec) {
  const NORMAL = 1, UNKNOWN = 2, USER = 4, BYTE = 6;
  const pieces = new Map();
  const bytes = new Int32Array(256).fill(-1);
  let longest = 1;
  let lowest = 0;
  spec.pieces.forEach(([piece, score, type], id) => {
    if (type === BYTE) bytes[parseInt(piece.slice(3, 5), 16)] = id;
    else if (type === NORMAL || type === USER) {
      pieces.set(piece, { id, score: type === USER ? 0 : score });
      longest = Math.max(longest, [...piece].length);
      lowest = Math.min(lowest, score);
    } else if (type === UNKNOWN) spec.unk ??= id;
  });
  const unkScore = lowest - 10;
  const encoder = new TextEncoder();

  return function encode(text) {
    let s = spec.normalizer === 'nmt_nfkc' ? text.normalize('NFKC') : text;
    if (spec.remove_extra_whitespaces) s = s.trim().replace(/ +/g, ' ');
    if (!s) return [];
    if (spec.add_dummy_prefix) s = ` ${s}`;
    const chars = [...s.replace(/ /g, '▁')];
    const n = chars.length;
    const best = new Float64Array(n + 1).fill(-Infinity);
    const from = new Int32Array(n + 1);
    const ids = new Int32Array(n + 1);
    best[0] = 0;
    for (let i = 0; i < n; i++) {
      if (best[i] === -Infinity) continue;
      let single = false;
      let piece = '';
      for (let len = 1; len <= longest && i + len <= n; len++) {
        piece += chars[i + len - 1];
        const hit = pieces.get(piece);
        if (!hit) continue;
        if (len === 1) single = true;
        const score = best[i] + hit.score;
        if (score > best[i + len]) { best[i + len] = score; from[i + len] = i; ids[i + len] = hit.id; }
      }
      if (!single && best[i] + unkScore > best[i + 1]) { best[i + 1] = best[i] + unkScore; from[i + 1] = i; ids[i + 1] = -1; }
    }
    const out = [];
    for (let at = n; at > 0; at = from[at]) {
      if (ids[at] >= 0) out.push(ids[at]);
      else if (spec.byte_fallback) {
        const b = encoder.encode(chars.slice(from[at], at).join(''));
        for (let k = b.length - 1; k >= 0; k--) out.push(bytes[b[k]]);
      } else out.push(spec.unk);
    }
    return out.reverse();
  };
}

// --------------------------------------------------------------------- text
const TERMINAL = '.!?…';
const WEAK = ',;:-–—';
const CLOSERS = '"\'”’)]»';
const isUpper = (c) => c !== c.toLowerCase() && c === c.toUpperCase();

// pocket_tts's prepare_text_prompt: the text as the model was trained on it.
export function prepareText(text, rules) {
  let t = String(text || '').trim();
  const swap = rules.replace_characters || {};
  if (Object.keys(swap).length) {
    t = [...t].map((c) => (c in swap ? swap[c] : c)).join('').split(/\s+/).filter(Boolean).join(' ');
    t = t.replace(/([.!?…])\s*[,;:]/g, '$1');
  }
  if (!t) return { text: '', after: 1 };
  t = t.replace(/[\n\r]/g, ' ').replace(/ {2}/g, ' ');
  if (rules.remove_semicolons) t = t.replace(/;/g, ',');
  const words = t.split(/\s+/).filter(Boolean).length;
  if (rules.capitalize_first_letter && !isUpper(t[0])) t = t[0].toUpperCase() + t.slice(1);
  if (rules.append_terminal_punctuation) {
    let end = t.length;
    while (end > 0 && (CLOSERS + ' ').includes(t[end - 1])) end--;
    const core = t.slice(0, end);
    const closers = t.slice(end).trim();
    if (core && !TERMINAL.includes(core[core.length - 1])) {
      if (WEAK.includes(core[core.length - 1])) t = core.replace(new RegExp(`[${WEAK.replace('-', '\\-')} ]+$`), '') + '.' + closers;
      else t += '.';
    }
  }
  if (rules.pad_with_spaces_for_short_inputs && t.split(/\s+/).length < 5) t = ' '.repeat(8) + t;
  return { text: t, after: words <= 4 ? 3 : 1 };
}

// Chunks the model makes one at a time: whole sentences, as many as fit `max`
// tokens; a longer sentence at its commas, then between words.
export function chunkText(text, encode, max, questionMark = '?') {
  // (in Greek ";" is the question mark: a sentence ends there too)
  const term = questionMark === ';' ? '.!?;…' : '.!?…';
  const ends = new RegExp(`[^${term}]+[${term}]+["'”’)\\]»]*|[^${term}]+$`, 'g');
  const sentences = (text.match(ends) || [text]).map((s) => s.trim()).filter(Boolean);
  const size = (s) => encode(s).length;
  const parts = [];
  for (const s of sentences) {
    if (size(s) <= max) { parts.push(s); continue; }
    let cur = '';
    for (const clause of s.split(/(?<=[,;:])\s+/)) {
      if (size(clause) > max) {
        if (cur) { parts.push(cur); cur = ''; }
        let run = '';
        for (const w of clause.split(' ')) {
          if (run && size(`${run} ${w}`) > max) { parts.push(run); run = w; } else run = run ? `${run} ${w}` : w;
        }
        if (run) parts.push(run);
      } else if (cur && size(`${cur} ${clause}`) > max) { parts.push(cur); cur = clause; } else cur = cur ? `${cur} ${clause}` : clause;
    }
    if (cur) parts.push(cur);
  }
  const chunks = [];
  for (const p of parts) {
    const last = chunks.length - 1;
    if (last >= 0 && size(`${chunks[last]} ${p}`) <= max) chunks[last] = `${chunks[last]} ${p}`;
    else chunks.push(p);
  }
  return chunks;
}

// ------------------------------------------------------------------- files
// PTS1: the decoder's starting state; PKV1: a voice (attention rows, float16).
function readStates(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let o = 4;
  const count = view.getUint32(o, true); o += 4;
  const out = [];
  for (let i = 0; i < count; i++) {
    const code = view.getUint8(o); const rank = view.getUint8(o + 1); o += 2;
    const dims = [];
    for (let r = 0; r < rank; r++) { dims.push(view.getUint32(o, true)); o += 4; }
    const length = view.getUint32(o, true); o += 4;
    const raw = bytes.slice(o, o + length).buffer; o += length;
    const data = code === FLOAT ? new Float32Array(raw) : code === INT64 ? new BigInt64Array(raw) : code === HALF ? new Uint16Array(raw) : new Uint8Array(raw);
    out.push({ type: ['float32', 'int64', 'bool', 'float16'][code], data, dims });
  }
  return out;
}

function readVoice(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (new TextDecoder().decode(bytes.subarray(0, 4)) !== 'PKV1') throw new Error('not a voice');
  const [layers, rows, heads, dim] = [4, 8, 12, 16].map((at) => view.getUint32(at, true));
  const block = heads * rows * dim;
  const data = new Uint16Array(bytes.slice(20).buffer);
  const kv = [];
  for (let l = 0; l < layers * 2; l++) kv.push(data.subarray(l * block, (l + 1) * block));
  return { layers, rows, heads, dim, kv };
}

function gaussian(n, std) {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const u = Math.max(1e-12, Math.random());
    out[i] = Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * Math.random()) * std;
  }
  return out;
}

// ------------------------------------------------------------------ engine
// get(name) -> Promise<Uint8Array>: a file of the package ("bundle.json",
// "flow_lm_main.onnx", "voices/eleni.bin", ...).
export async function openPocket(ort, get, { sessionOptions = {} } = {}) {
  const meta = asJson(await get('bundle.json'));
  const encode = makeTokenizer(asJson(await get('tokenizer.json')));
  const mimiStart = readStates(await get('mimi_init.bin'));
  const options = { executionProviders: ['wasm'], graphOptimizationLevel: 'all', ...sessionOptions };
  const net = {};
  for (const name of ['text_conditioner', 'flow_lm_main', 'flow_lm_flow', 'mimi_decoder']) {
    net[name] = await ort.InferenceSession.create(await get(`${name}.onnx`), options);
  }
  const { layers, heads, head_dim: dim, capacity: cap, latent_dim: LAT, conditioning_dim: COND } = meta;
  const T = (type, data, dims) => new ort.Tensor(type, data, dims);
  const emptySeq = T('float32', new Float32Array(0), [1, 0, LAT]);
  const emptyText = T('float32', new Float32Array(0), [1, 0, COND]);
  const s0 = T('float32', Float32Array.of(0), [1, 1]);
  const t1 = T('float32', Float32Array.of(1), [1, 1]);
  const question = meta.language === 'greek' ? ';' : '?';

  const voices = new Map();
  const voiceOf = (id) => {
    if (!voices.has(id)) {
      const reading = get(`voices/${id}.bin`).then(readVoice);
      reading.catch(() => voices.delete(id));
      voices.set(id, reading);
    }
    return voices.get(id);
  };

  // The flow LM's state for one chunk: the voice's rows in a fresh cache.
  function startState(voice) {
    const caches = [];
    const steps = [];
    for (let l = 0; l < layers; l++) {
      for (const which of [0, 1]) {
        const cache = new Uint16Array(heads * cap * dim);
        const rows = voice.kv[l * 2 + which];
        for (let h = 0; h < heads; h++) cache.set(rows.subarray(h * voice.rows * dim, (h + 1) * voice.rows * dim), h * cap * dim);
        caches.push(cache);
      }
      steps.push(voice.rows);
    }
    return { caches, steps };
  }
  const feeds = (state) => {
    const f = {};
    for (let l = 0; l < layers; l++) {
      f[`state_${l * 3}`] = T('float16', state.caches[l * 2], [1, heads, cap, dim]);
      f[`state_${l * 3 + 1}`] = T('float16', state.caches[l * 2 + 1], [1, heads, cap, dim]);
      f[`state_${l * 3 + 2}`] = T('int64', BigInt64Array.of(BigInt(state.steps[l])), [1]);
    }
    return f;
  };
  // The new rows of each layer, written at its step (the cache wraps, as the graph does).
  function merge(state, out) {
    for (let l = 0; l < layers; l++) {
      const off = state.steps[l];
      for (const which of [0, 1]) {
        const rows = out[`out_state_${l * 3 + which}`];
        const n = rows.dims[2];
        // the 16-bit floats' bits (where the runtime has Float16Array it hands
        // those, and copying them into a Uint16Array would convert the numbers)
        const src = new Uint16Array(rows.data.buffer, rows.data.byteOffset, rows.data.length);
        const dst = state.caches[l * 2 + which];
        for (let h = 0; h < heads; h++) {
          for (let r = 0; r < n; r++) {
            const at = (h * cap + ((off + r) % cap)) * dim;
            dst.set(src.subarray((h * n + r) * dim, (h * n + r + 1) * dim), at);
          }
        }
      }
      state.steps[l] = Number(out[`out_state_${l * 3 + 2}`].data[0]);
    }
  }

  // One piece of text -> { samples, sr, frames }.
  async function synth(text, voiceId, { temperature = meta.temperature, onFrame } = {}) {
    const voice = await voiceOf(voiceId);
    const prepared = prepareText(text, meta.text);
    if (!prepared.text) return { samples: new Float32Array(0), sr: meta.sample_rate, frames: 0 };
    // what one chunk may hold: the voice, its tokens and the frames it makes
    const room = cap - voice.rows;
    const maxTokens = Math.max(8, Math.min(meta.max_tokens, Math.floor(room / 4)));
    const fps = meta.sample_rate / meta.samples_per_frame;
    const audio = [];
    let frames = 0;
    for (const piece of chunkText(prepared.text, encode, maxTokens, question)) {
      // as pocket_tts: each chunk prepared again, two frames more after its end,
      // an end heard only from the sixth frame, and no longer than its words need
      const { text: chunk, after: guess } = prepareText(piece, meta.text);
      const after = meta.frames_after_eos ?? guess + 2;
      const ids = encode(chunk);
      const state = startState(voice);
      let emb = (await net.text_conditioner.run({ token_ids: T('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]) })).embeddings;
      if (emb.dims.length === 2) emb = T('float32', emb.data, [1, ...emb.dims]);
      merge(state, await net.flow_lm_main.run({ sequence: emptySeq, text_embeddings: emb, ...feeds(state) }));
      const maxFrames = Math.max(1, Math.min(room - ids.length - 1, Math.ceil((ids.length / 3 + 2) * fps)));
      let mimi = Object.fromEntries(mimiStart.map((s, i) => [`state_${i}`, T(s.type, s.data, s.dims)]));
      let latent = T('float32', new Float32Array(LAT).fill(NaN), [1, 1, LAT]);
      const pending = [];
      let eos = -1;
      const decode = async () => {
        const buf = new Float32Array(pending.length * LAT);
        pending.forEach((x, k) => buf.set(x, k * LAT));
        const out = await net.mimi_decoder.run({ latent: T('float32', buf, [1, pending.length, LAT]), ...mimi });
        mimi = Object.fromEntries(mimiStart.map((_, i) => [`state_${i}`, out[`out_state_${i}`]]));
        audio.push(new Float32Array(out.audio_frame.data));
        pending.length = 0;
      };
      for (let step = 0; step < maxFrames; step++) {
        const out = await net.flow_lm_main.run({ sequence: latent, text_embeddings: emptyText, ...feeds(state) });
        if (eos < 0 && step >= 6 && out.eos_logit.data[0] > meta.eos_threshold) eos = step;
        if (eos >= 0 && step >= eos + after) break;
        const x = gaussian(LAT, Math.sqrt(temperature));
        const flow = await net.flow_lm_flow.run({ c: out.conditioning, s: s0, t: t1, x: T('float32', x, [1, LAT]) });
        for (let i = 0; i < LAT; i++) x[i] += flow.flow_dir.data[i];
        merge(state, out);
        latent = T('float32', x, [1, 1, LAT]);
        pending.push(x);
        frames++;
        onFrame?.(frames);
        if (pending.length >= 15) await decode();
      }
      if (pending.length) await decode();
    }
    const samples = new Float32Array(audio.reduce((s, a) => s + a.length, 0));
    let at = 0;
    for (const a of audio) { samples.set(a, at); at += a.length; }
    for (let i = 0; i < samples.length; i++) samples[i] = Math.max(-1, Math.min(1, samples[i]));
    return { samples, sr: meta.sample_rate, frames };
  }

  // Frees the networks (another language is about to be loaded).
  async function close() {
    for (const session of Object.values(net)) await session.release?.();
  }

  return { synth, close, meta, encode, sr: meta.sample_rate, voice: voiceOf };
}
