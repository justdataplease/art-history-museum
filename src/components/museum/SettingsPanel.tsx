"use client";

// The gallery's settings (O, or the Settings button top-left): walking speed, the canvas surface, the graphics
// (quality.ts), the on-screen controls (H), and the audio guide's voice and speed. Saved in this browser
// (settings.ts).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GUIDE_SPEEDS, getSettings, setSettings, useSettings, type GuideVoice, type Pace } from "./settings";
import { currentQuality, forgetSteppedDown, tierFor, weakReason, type GraphicsChoice } from "./quality";
import {
  NATURAL_VOICES,
  POCKET_MB,
  browserVoices,
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
  // the AI voice (Pocket): whether it is here already, and its download (only choosing it starts it; Auto never
  // uses it)
  const natural = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getState, () => "idle" as const);
  const progress = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getProgress, () => 0);
  useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getDevices, () => 0);
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
  // with the voice chosen: the AI one waits until it can read (the browser's in its place would pass for it)
  const hear = async () => {
    sample.current?.stop();
    sample.current = null;
    const g = getSettings();
    const o = { speed: g.guideSpeed, onLine: () => {}, onEnd: () => {} };
    if (g.guideVoice === "natural") {
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
  // Pocket's model: its download until it is here (then a second voice is only its own few MB)
  const here = naturalVoice.onDevice();
  const mb = here === false ? POCKET_MB : null;
  const reading = naturalVoice.voice ? voiceInfo(naturalVoice.voice) : undefined;
  const voiceNote =
    s.guideVoice !== "natural"
      ? `Auto reads with the browser's most natural voice (Edge's Natural voices are the best; on a phone, the system's neural voices). Natural (AI) runs Kyutai's Pocket voices on this device: choosing it downloads them once${mb ? ` (about ${mb} MB)` : ""}. Nothing downloads unless you choose it.`
      : natural === "slow"
        ? "This device cannot keep ahead of the Pocket voices while it draws the gallery: the browser's voice reads."
        : natural === "error"
          ? "The AI voice would not start here: the browser's voice reads."
          : natural === "loading"
            ? `${reading?.label ?? "The AI voice"} is downloading: ${Math.round(progress * 100)}% (${here ? "a few MB" : `about ${POCKET_MB} MB`}, once; the browser keeps it). The browser's voice reads meanwhile.`
            : reading
              ? `${reading.label}, a voice of Kyutai's Pocket TTS (CC BY 4.0), reads on this device's processor at its own pace: the reading speed does not change it.`
              : `The Pocket voices sound very natural and run on this device's processor, best on a recent computer (about ${POCKET_MB} MB, once).`;
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
    naturalVoice.load(aiVoice);
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
          <Choice<GuideVoice>
            value={s.guideVoice}
            options={[
              { key: "auto", label: "Auto" },
              { key: "natural", label: mb ? `Natural (AI · ${mb} MB)` : "Natural (AI)" },
              { key: "browser", label: "Browser's voice" },
            ]}
            onPick={(guideVoice) => {
              setSettings({ guideVoice });
              if (guideVoice === "natural") naturalVoice.load(getSettings().aiVoice);
            }}
          />
          <p>{voiceNote}</p>
          {s.guideVoice === "natural" && (
            <>
              <p className={styles.voiceKind}>Pocket · very natural, made on this device, about {POCKET_MB} MB once</p>
              <div className={styles.seg}>
                {NATURAL_VOICES.map((v) => (
                  <button key={v.id} type="button" aria-pressed={s.aiVoice === v.id} onClick={() => pickAi(v.id)}>
                    {v.label}
                  </button>
                ))}
              </div>
            </>
          )}
          {voices.length > 0 && s.guideVoice !== "natural" && (
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
