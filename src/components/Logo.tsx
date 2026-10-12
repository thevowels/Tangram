import { PIECES } from "../geometry/pieces";
import { toPath } from "../geometry/polygon";

/** The seven tans in their classic square, rotated 45° as a little diamond mark. */
export function Logo() {
  const c = Math.SQRT2; // centre of the 2√2 square
  return (
    <svg className="logo" viewBox="-0.66 -0.66 4.15 4.15" aria-hidden>
      <g transform={`rotate(45 ${c} ${c})`}>
        {PIECES.map((p) => (
          <path
            key={p.id}
            d={toPath([p.shape.map(([x, y]) => [x + p.home[0], y + p.home[1]])])}
            fill={p.color}
            stroke="#1a1240"
            strokeWidth={0.06}
            strokeLinejoin="round"
          />
        ))}
      </g>
    </svg>
  );
}
