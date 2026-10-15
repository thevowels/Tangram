import type { Medal as Tier } from "../game/medals";

const METAL: Record<Tier, [string, string, string]> = {
  // light, base, edge
  gold: ["#fff6c4", "#ffc83d", "#b97c06"],
  silver: ["#ffffff", "#d3dae6", "#7f8a9c"],
  bronze: ["#ffd9b5", "#d98a48", "#87441a"],
};
const RANK: Record<Tier, string> = { gold: "1", silver: "2", bronze: "3" };

/**
 * A prize medal like 🥇: two ribbon straps (in the pieces' red and blue) holding a metal disc
 * with its place on it. `size` is the width; it's a little taller than wide.
 */
export function Medal({ tier, size = 26, label }: { tier: Tier; size?: number; label?: string }) {
  const [light, base, edge] = METAL[tier];
  const id = `medal-${tier}`;
  const h = size * 1.3;
  return (
    <svg
      className={`medal medal-${tier}`}
      width={size}
      height={h}
      // inline size: the picker's thumbnail rules (.card svg) must not resize it
      style={{ width: size, height: h }}
      viewBox="0 0 32 42"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={id} x1="0.15" y1="0" x2="0.85" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.5" stopColor={base} />
          <stop offset="1" stopColor={edge} />
        </linearGradient>
      </defs>
      {/* ribbon straps; inline fills so the picker's `.card svg path` rule can't repaint them */}
      <path d="M5 0 H13 L19.5 17 H11.5 Z" style={{ fill: "#ff4d6d" }} />
      <path d="M8.2 0 H10.2 L16.7 17 H14.7 Z" style={{ fill: "#fff", fillOpacity: 0.55 }} />
      <path d="M19 0 H27 L20.5 17 H12.5 Z" style={{ fill: "#3a86ff" }} />
      <path d="M21.8 0 H23.8 L17.3 17 H15.3 Z" style={{ fill: "#fff", fillOpacity: 0.55 }} />
      <rect x="12" y="14.5" width="8" height="4" rx="1.5" fill={edge} />
      <circle cx="16" cy="29" r="12" fill={`url(#${id})`} stroke={edge} strokeWidth="1.4" />
      <circle cx="16" cy="29" r="8.6" fill="none" stroke={light} strokeOpacity="0.7" strokeWidth="1" />
      <text
        x="16"
        y="33.4"
        textAnchor="middle"
        fontSize="12.5"
        fontWeight="900"
        fontFamily="system-ui, sans-serif"
        style={{ fill: edge }}
      >
        {RANK[tier]}
      </text>
    </svg>
  );
}
