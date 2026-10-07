"use client";

import type { AxisTicks, Transform } from "./timeline-math";
import { xOf } from "./timeline-math";

/** The year ruler: labelled major ticks (centuries emphasised), mid and minor ticks. */
export function Axis({
  ticks,
  w,
  t,
  top,
}: {
  ticks: AxisTicks;
  w: number;
  t: Transform;
  top: number;
}) {
  const base = 30;
  let minor = "";
  let mid = "";
  let major = "";
  for (const y of ticks.minor) minor += `M${Math.round(xOf(y, w, t)) + 0.5} ${base}v-4`;
  for (const y of ticks.mid) mid += `M${Math.round(xOf(y, w, t)) + 0.5} ${base}v-7`;
  for (const y of ticks.major) major += `M${Math.round(xOf(y, w, t)) + 0.5} ${base}v-10`;
  // Three- and four-digit years need room on both sides of their tick.
  const labels = ticks.major.filter((year) => {
    const x = Math.round(xOf(year, w, t));
    return x >= 18 && x <= w - 18;
  });
  return (
    <svg className="tl-axis" width={w} height={36} style={{ top }} aria-hidden>
      <path className="ax-base" d={`M0 ${base + 0.5}H${w}`} />
      <path className="ax-minor" d={minor} />
      <path className="ax-mid" d={mid} />
      <path className="ax-major" d={major} />
      {labels.map((y) => (
        <text
          key={y}
          x={Math.round(xOf(y, w, t))}
          y={base - 15}
          className={y % 100 === 0 ? "ax-label century" : "ax-label"}
          textAnchor="middle"
        >
          {y}
        </text>
      ))}
    </svg>
  );
}
