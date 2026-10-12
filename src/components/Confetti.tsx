import { useMemo } from "react";
import { PIECES } from "../geometry/pieces";

const SHAPES = ["polygon(0 0, 100% 0, 0 100%)", "polygon(0 0, 100% 0, 100% 100%, 0 100%)", "polygon(30% 0, 100% 0, 70% 100%, 0 100%)"];

/** A burst of little tans falling over the board. */
export function Confetti({ count = 46 }: { count?: number }) {
  const bits = useMemo(
    () =>
      Array.from({ length: count }, (_, i) => ({
        left: Math.random() * 100,
        size: 8 + Math.random() * 12,
        delay: Math.random() * 0.5,
        duration: 1.6 + Math.random() * 1.4,
        drift: (Math.random() - 0.5) * 160,
        spin: (Math.random() - 0.5) * 1080,
        color: PIECES[i % PIECES.length].color,
        shape: SHAPES[i % SHAPES.length],
      })),
    [count],
  );
  return (
    <div className="confetti" aria-hidden>
      {bits.map((b, i) => (
        <span
          key={i}
          style={
            {
              left: `${b.left}%`,
              width: b.size,
              height: b.size,
              background: b.color,
              clipPath: b.shape,
              animationDelay: `${b.delay}s`,
              animationDuration: `${b.duration}s`,
              "--drift": `${b.drift}px`,
              "--spin": `${b.spin}deg`,
            } as React.CSSProperties
          }
        />
      ))}
    </div>
  );
}
