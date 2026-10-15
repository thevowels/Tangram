import { useMemo } from "react";
import type { Medal as Tier } from "../game/medals";
import { Medal } from "./Medal";

/**
 * What plays when a puzzle is finished. Swap here:
 * - "flakes": bright gold foil flakes, like birthday confetti, fluttering down over the board;
 * - "shine": soft rays turning behind the caption's medal, with twinkling sparkles.
 * Neither covers the figure: the player gets to enjoy the shape they made.
 */
export type CelebrationEffect = "flakes" | "shine";
export const CELEBRATION_EFFECT: CelebrationEffect = "flakes";

const reducedMotion = () => window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

/** The board-wide part of the celebration (the flakes), drawn over the stage but never blocking it. */
export function CelebrationLayer({ effect = CELEBRATION_EFFECT }: { effect?: CelebrationEffect }) {
  if (reducedMotion() || effect !== "flakes") return null;
  return <GoldFlakes />;
}

/** The caption's medal, revealed: it pops in with a spin and a glint (and rays, with "shine"). */
export function RevealMedal({
  tier,
  label,
  effect = CELEBRATION_EFFECT,
}: {
  tier: Tier;
  label: string;
  effect?: CelebrationEffect;
}) {
  return (
    <span className="reveal-medal">
      {effect === "shine" && <Shine />}
      <span className="reveal-medal-pop">
        <Medal tier={tier} size={40} label={label} />
      </span>
    </span>
  );
}

// gold leaf: pale champagne to deep gold, plus a little white glitter
const GOLD: [string, string][] = [
  ["#fffbe0", "#ffd54a"],
  ["#fff1a8", "#f5b400"],
  ["#ffe68a", "#e09a00"],
  ["#fffdf2", "#ffe27a"],
  ["#ffd96b", "#c98500"],
];

/** Bright gold foil flakes (and a few glitter specks) fluttering down, catching the light as they turn. */
function GoldFlakes({ count = 90 }: { count?: number }) {
  const flakes = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => {
        const glitter = i % 5 === 0;
        const [light, deep] = GOLD[i % GOLD.length];
        const w = glitter ? 3 + Math.random() * 3 : 6 + Math.random() * 8;
        return {
          glitter,
          left: Math.random() * 100,
          w,
          h: glitter ? w : w * (0.45 + Math.random() * 0.4),
          delay: Math.random() * 1.4,
          duration: 2.8 + Math.random() * 2.2,
          flutter: 0.5 + Math.random() * 0.7,
          sway: (Math.random() - 0.3) * 90,
          spin: (Math.random() - 0.5) * 900,
          background: glitter ? "#fffbe6" : `linear-gradient(135deg, ${light}, ${deep} 55%, ${light})`,
        };
      }),
    [count],
  );
  return (
    <div className="flakes" aria-hidden>
      {flakes.map((f, i) => (
        <span
          key={i}
          className={f.glitter ? "glitter" : ""}
          style={
            {
              left: `${f.left}%`,
              width: f.w,
              height: f.h,
              background: f.background,
              animationDelay: `${f.delay}s, ${f.delay}s`,
              animationDuration: `${f.duration}s, ${f.flutter}s`,
              "--sway": `${f.sway}px`,
              "--spin": `${f.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}

/** Soft rays turning behind the medal, with a few twinkling sparkles. */
function Shine() {
  const sparkles = useMemo(
    () =>
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2 + Math.random() * 0.5;
        const r = 26 + Math.random() * 18;
        return { x: Math.cos(a) * r, y: Math.sin(a) * r, delay: Math.random() * 1.2, size: 6 + Math.random() * 6 };
      }),
    [],
  );
  return (
    <span className="shine" aria-hidden>
      <span className="shine-rays" />
      {sparkles.map((s, i) => (
        <span
          key={i}
          className="sparkle"
          style={{ translate: `${s.x}px ${s.y}px`, width: s.size, height: s.size, animationDelay: `${s.delay}s` }}
        />
      ))}
    </span>
  );
}
