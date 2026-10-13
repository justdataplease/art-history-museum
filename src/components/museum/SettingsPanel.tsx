"use client";

// The gallery's settings (O, or the Settings button top-left): walking speed, the canvas surface, the graphics
// (quality.ts), the on-screen controls (H), and the audio guide's voice (the natural voice, which of its four, and
// the lock that keeps it; or the browser's) and speed. Saved in this browser (settings.ts).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GUIDE_SPEEDS, getSettings, setSettings, useSettings, type GuideVoice, type Pace } from "./settings";
import { currentQuality, forgetSteppedDown, tierFor, weakReason, type GraphicsChoice } from "./quality";
import {
  NATURAL_VOICES,
  POCKET_MB,
  browserVoices,
  naturalPossible,
  naturalVoice,
  pickBrowserVoice,
  speakBrowser,
  voiceInfo,
  type Speaking,
} from "./voice";
import styles from "./museum.module.css";

const SAMPLE =
  "The audio guide reads to you in front of the works people come to see: what you see in the painting first, then its story.";

const PACES: { key: Pace; label: string }[] = [
  { key: "walk", label: "Walk" },
  { key: "run", label: "Run" },
];

function Choice<T extends string | boolean>({
  value,
  options,
  onPick,
}: {
  value: T;
  options: { key: T; label: string }[];
  onPick: (v: T) => void;
}) {
  return (
    <div className={styles.seg}>
      {options.map((o) => (
        <button key={String(o.key)} type="button" aria-pressed={value === o.key} onClick={() => onPick(o.key)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** `onClose(relock)`: relock when closed by a click (a gesture that may take the cursor back). */
export function SettingsPanel({ onClose, touch }: { onClose: (relock: boolean) => void; touch: boolean }) {
  const s = useSettings();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('button[aria-pressed="true"]')?.focus({ preventScroll: true });
  }, []);
  // the natural voice (Pocket): whether it is here already, its download (only a reading, or "Hear it", starts
  // it) and its trouble
  const natural = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getState, () => "idle" as const);
  const trouble = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getTrouble, () => null);
  const progress = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getProgress, () => 0);
  useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getDevices, () => 0);
  const possible = naturalPossible();
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    if (!("speechSynthesis" in window)) return;
    const list = () => setVoices(browserVoices());
    list();
    window.speechSynthesis.addEventListener?.("voiceschanged", list);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", list);
  }, []);
  const sample = useRef<Speaking | null>(null);
  const [preparing, setPreparing] = useState(false);
  useEffect(() => () => sample.current?.stop(), []);
  // with the voice chosen: the natural one waits until it can read (the browser's in its place would pass for it)
  const hear = async () => {
    sample.current?.stop();
    sample.current = null;
    const g = getSettings();
    const o = { speed: g.guideSpeed, onLine: () => {}, onEnd: () => {} };
    if (g.guideVoice === "natural" && possible) {
      naturalVoice.load(g.aiVoice);
      setPreparing(true);
      const ok = await naturalVoice.whenReady();
      setPreparing(false);
      if (ok) {
        sample.current = naturalVoice.speak([SAMPLE], o);
        return;
      }
    }
    sample.current = speakBrowser([SAMPLE], pickBrowserVoice(g.browserVoice), o);
  };
  // Pocket's download for the voice chosen, until it is here (the model and the voice; then another voice is only its
  // own few MB)
  const mb = possible ? naturalVoice.downloadMB(s.aiVoice) : null;
  const reading = naturalVoice.voice ? voiceInfo(naturalVoice.voice) : undefined;
  const voiceNote = !possible
    ? "This device cannot run the natural voice: the guide reads with the browser's most natural voice (Edge's Natural voices are the best; on a phone, the system's neural voices)."
    : s.guideVoice !== "natural"
      ? `The browser's most natural voice (Edge's Natural voices are the best; on a phone, the system's neural voices), or the one you choose. Natural runs Kyutai's Pocket voices on this device${mb ? `: about ${mb} MB to download, once, when the guide first reads` : ""}.`
      : natural === "slow"
        ? "The natural voice was too slow here while the gallery draws: the browser's voice reads for this visit. Choose Natural to try it again."
        : natural === "failed"
          ? "The natural voice would not load: the browser's voice reads for this visit. Choose Natural to try it again."
          : natural === "stuck"
            ? "The natural voice would not load. Always on: it tries again at the next painting."
            : natural === "loading" && trouble === "retrying"
              ? "The natural voice is having trouble loading: trying again…"
              : natural === "loading"
                ? `${reading?.label ?? "The natural voice"} is downloading: ${Math.round(progress * 100)}% (${mb === POCKET_MB ? `about ${POCKET_MB} MB` : "a few MB"}, once; the browser keeps it). The guide reads when it is here.`
                : trouble === "straining"
                  ? "The natural voice is having trouble keeping up here. Always on: it keeps reading."
                  : reading
                    ? `${reading.label}, a voice of Kyutai's Pocket TTS (CC BY 4.0), reads on this device's processor at its own pace: the reading speed does not change it.`
                    : `The Pocket voices sound very natural and run on this device's processor, best on a recent computer.${mb ? " They download when the guide first reads." : ""}`;
  // the graphics: what Auto chose here and why; what waits for the next gallery
  const autoWhy = weakReason();
  const tierNow = tierFor(s.graphics);
  const graphicsNote =
    (s.graphics === "auto"
      ? autoWhy
        ? `Auto draws fast here (${autoWhy}).`
        : "Auto draws everything here, and steps down by itself if walking stutters."
      : s.graphics === "fast"
        ? "Fast leaves out the floor's reflection, two of the ceiling's lights and the smoothing of edges, for slower computers."
        : "Full draws every light, the floor's reflection and smooth edges.") +
    (tierNow !== currentQuality().tier ? " The edges and the ceiling's lights change from the next gallery you open." : "");
  const pickGraphics = (graphics: GraphicsChoice) => {
    if (graphics === "auto" && s.graphics !== "auto") forgetSteppedDown();
    setSettings({ graphics });
  };
  const pickAi = (aiVoice: string) => {
    setSettings({ aiVoice });
    // in use: the new voice loads now (its own few MB); else at the guide's next reading
    if (natural === "ready" || natural === "loading") naturalVoice.load(aiVoice);
  };
  return (
    <div className={styles.settingsBack} onClick={() => onClose(true)}>
      <div
        ref={ref}
        className={styles.settings}
        role="dialog"
        aria-modal="true"
        aria-label="Gallery settings"
        onClick={(e) => e.stopPropagation()}
      >
        <h2>Settings</h2>
        <section>
          <h3>Speed</h3>
          <Choice value={s.pace} options={PACES} onPick={(pace) => setSettings({ pace })} />
          <p>
            {touch
              ? "Push the stick (bottom left) to walk, as far as you push it, that fast; double-tap the floor to go there."
              : s.pace === "run"
                ? "You run by default."
                : "Hold W for a few seconds to run."}
          </p>
        </section>
        <section>
          <h3>Canvas surface</h3>
          <Choice
            value={s.surface}
            options={[
              { key: true, label: "Weave and varnish" },
              { key: false, label: "Plain image" },
            ]}
            onPick={(surface) => setSettings({ surface })}
          />
          <p>The linen texture and varnish sheen on paintings. Plain shows each image as it is, matte.</p>
        </section>
        <section>
          <h3>Graphics</h3>
          <Choice<GraphicsChoice>
            value={s.graphics}
            options={[
              { key: "auto", label: "Auto" },
              { key: "fast", label: "Fast" },
              { key: "full", label: "Full" },
            ]}
            onPick={pickGraphics}
          />
          <p>{graphicsNote}</p>
        </section>
        <section>
          <h3>On-screen controls{touch ? "" : " (H)"}</h3>
          <Choice
            value={s.hud}
            options={[
              { key: true, label: "Shown" },
              { key: false, label: "Hidden" },
            ]}
            onPick={(hud) => setSettings({ hud })}
          />
          <p>Hidden leaves only the room and the paintings; a small button brings them back.</p>
        </section>
        <section>
          <h3>Audio guide</h3>
          {possible && (
            <Choice<GuideVoice>
              value={s.guideVoice}
              options={[
                { key: "natural", label: mb ? `Natural · ↓ ${mb} MB` : "Natural" },
                { key: "browser", label: "Browser's voice" },
              ]}
              onPick={(guideVoice) => {
                // (chosen again, after it gave way: it is tried again)
                if (guideVoice === "natural") naturalVoice.again();
                setSettings({ guideVoice });
              }}
            />
          )}
          <p>{voiceNote}</p>
          {possible && s.guideVoice === "natural" && (
            <>
              <p className={styles.voiceKind}>Pocket · very natural, made on this device, about {POCKET_MB} MB once</p>
              <div className={styles.seg}>
                {NATURAL_VOICES.map((v) => (
                  <button key={v.id} type="button" aria-pressed={s.aiVoice === v.id} onClick={() => pickAi(v.id)}>
                    {v.label}
                  </button>
                ))}
              </div>
              <label className={styles.lock}>
                <input
                  type="checkbox"
                  checked={s.naturalLock}
                  onChange={(e) => setSettings({ naturalLock: e.target.checked })}
                />
                <span>
                  Always the natural voice
                  <small>Even when it has trouble here, the browser's voice never takes its place.</small>
                </span>
              </label>
            </>
          )}
          {voices.length > 0 && (s.guideVoice !== "natural" || !possible) && (
            <select
              className={styles.voiceSelect}
              value={s.browserVoice}
              onChange={(e) => setSettings({ browserVoice: e.target.value })}
              aria-label="The browser's voice"
            >
              <option value="">Best: {voices[0].name}</option>
              {voices.map((v) => (
                <option key={v.voiceURI} value={v.voiceURI}>
                  {v.name} ({v.lang})
                </option>
              ))}
            </select>
          )}
          <h3 style={{ marginTop: 14 }}>Reading speed</h3>
          <Choice<string>
            value={String(s.guideSpeed)}
            options={GUIDE_SPEEDS.map((v) => ({ key: String(v), label: `${v}×` }))}
            onPick={(v) => setSettings({ guideSpeed: Number(v) })}
          />
          <button type="button" className={styles.hear} onClick={() => void hear()} disabled={preparing}>
            {preparing ? `Preparing the voice… ${Math.round(progress * 100)}%` : "▶ Hear it"}
          </button>
        </section>
        <button type="button" className={styles.settingsDone} onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
