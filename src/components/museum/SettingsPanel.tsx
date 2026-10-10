"use client";

// The gallery's settings (O, or the Settings button top-left): walking speed, the canvas surface, the on-screen
// controls (H), and the audio guide's voice and speed. Saved in this browser (settings.ts).

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GUIDE_SPEEDS, getSettings, setSettings, useSettings, type GuideVoice, type Pace } from "./settings";
import { NATURAL_VOICES, browserVoices, naturalVoice, pickBrowserVoice, speakBrowser, type Speaking } from "./voice";
import styles from "./museum.module.css";

const SAMPLE =
  "The audio guide reads to you in front of the works people come to see: what you see in the painting first, then its story.";

const PACES: { key: Pace; label: string }[] = [
  { key: "slow", label: "Stroll" },
  { key: "normal", label: "Walk" },
  { key: "fast", label: "Brisk" },
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
  // the AI voice: whether this device runs it, whether it is here already, and its download (only choosing it starts
  // it; Auto never uses it)
  const natural = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getState, () => "idle" as const);
  const progress = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getProgress, () => 0);
  const onDevice = useSyncExternalStore(naturalVoice.subscribe, naturalVoice.getOnDevice, () => null);
  const [canRun, setCanRun] = useState<boolean | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  useEffect(() => {
    void naturalVoice.canRun().then(setCanRun);
    void naturalVoice.checkDevice();
    if (!("speechSynthesis" in window)) return;
    const list = () => setVoices(browserVoices());
    list();
    window.speechSynthesis.addEventListener?.("voiceschanged", list);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", list);
  }, []);
  const sample = useRef<Speaking | null>(null);
  useEffect(() => () => sample.current?.stop(), []);
  const hear = () => {
    sample.current?.stop();
    const g = getSettings();
    const o = { speed: g.guideSpeed, onLine: () => {}, onEnd: () => {} };
    const wants = g.guideVoice === "natural";
    if (wants) void naturalVoice.load();
    sample.current = wants && natural === "ready"
      ? naturalVoice.speak([SAMPLE], g.naturalVoice, o)
      : speakBrowser([SAMPLE], pickBrowserVoice(g.browserVoice), o);
  };
  const voiceNote =
    canRun === false
      ? "This device cannot run the natural voice (it needs WebGPU): the browser's best voice reads."
      : natural === "loading"
        ? `The natural voice is downloading: ${Math.round(progress * 100)}% (about 330 MB, once; the browser keeps it). The browser's voice reads meanwhile.`
        : natural === "error"
          ? "The natural voice would not start here: the browser's voice reads."
          : s.guideVoice === "natural" && (natural === "ready" || onDevice)
            ? "The natural voice reads, run on this device: it sounds like a person, but it is heavy on a slower computer. Auto reads with the browser's own voice."
            : "Auto reads with the browser's most natural voice (Edge's Natural voices are the best; on a phone, the system's neural voices). Natural (AI) runs a neural voice on this device: choosing it downloads it (about 330 MB, once) and it is heavy to run. Nothing downloads unless you choose it.";
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
              { key: "natural", label: onDevice || natural === "ready" ? "Natural (AI)" : "Natural (AI · 330 MB)" },
              { key: "browser", label: "Browser's voice" },
            ]}
            onPick={(guideVoice) => {
              setSettings({ guideVoice });
              if (guideVoice === "natural") void naturalVoice.load();
            }}
          />
          <p>{voiceNote}</p>
          {canRun !== false && s.guideVoice === "natural" && (
            <div className={styles.seg} style={{ marginTop: 10 }}>
              {NATURAL_VOICES.map((v) => (
                <button key={v.id} type="button" aria-pressed={s.naturalVoice === v.id} onClick={() => setSettings({ naturalVoice: v.id })}>
                  {v.label}
                </button>
              ))}
            </div>
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
          <button type="button" className={styles.hear} onClick={hear}>
            ▶ Hear it
          </button>
        </section>
        <button type="button" className={styles.settingsDone} onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
