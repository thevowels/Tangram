import type { Medal as Tier } from "../game/medals";

const METAL: Record<Tier, [string, string, string]> = {
  // light, base, edge
  gold: ["#fff3b0", "#ffc94a", "#c98a12"],
  silver: ["#ffffff", "#cfd6e2", "#8b95a7"],
  bronze: ["#ffd7b0", "#d9894a", "#8e4a1e"],
};

/** A small round medal in gold, silver or bronze, with a tan (triangle) emblem. */
export function Medal({ tier, size = 26, label }: { tier: Tier; size?: number; label?: string }) {
  const [light, base, edge] = METAL[tier];
  const id = `medal-${tier}`;
  return (
    <svg
      className={`medal medal-${tier}`}
      width={size}
      height={size}
      style={{ width: size, height: size }}
      viewBox="0 0 32 32"
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <defs>
        <linearGradient id={id} x1="0.2" y1="0" x2="0.8" y2="1">
          <stop offset="0" stopColor={light} />
          <stop offset="0.55" stopColor={base} />
          <stop offset="1" stopColor={edge} />
        </linearGradient>
      </defs>
      <circle cx="16" cy="16" r="14.5" fill={`url(#${id})`} stroke={edge} strokeWidth="1.5" />
      <circle cx="16" cy="16" r="10.5" fill="none" stroke={light} strokeOpacity="0.55" strokeWidth="1" />
      {/* a tan: the small right triangle */}
      {/* inline style: the picker's thumbnail rules (.card svg path) must not repaint it */}
      <path d="M10.5 20.5 L21.5 20.5 L16 11.5 Z" style={{ fill: edge, fillOpacity: 0.75 }} />
    </svg>
  );
}
