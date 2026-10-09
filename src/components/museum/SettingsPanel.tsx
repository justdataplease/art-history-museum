"use client";

// The gallery's settings (O, or the Settings button top-left): walking speed, the canvas surface, and the
// on-screen controls (H). Saved in this browser (settings.ts).

import { useEffect, useRef } from "react";
import { setSettings, useSettings, type Pace } from "./settings";
import styles from "./museum.module.css";

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
          <p>{touch ? "Tap the floor to go there." : s.pace === "run" ? "You run by default." : "Hold W for a few seconds to run."}</p>
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
        <button type="button" className={styles.settingsDone} onClick={() => onClose(true)}>
          Done
        </button>
      </div>
    </div>
  );
}
