import { bounds, toPath, type Poly } from "../geometry/polygon";
import type { Puzzle } from "../game/check";

interface Props {
  puzzles: Puzzle[];
  solved: Record<string, number>;
  onPick(p: Puzzle): void;
}

export const formatTime = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

// card accents cycle through the piece colours
const ACCENTS = ["#ff4d6d", "#3a86ff", "#ffbe0b", "#00d4c8", "#8ac926", "#c77dff", "#fb5607"];

function Thumb({ loops }: { loops: Poly[] }) {
  const b = bounds(loops);
  const pad = 0.3;
  return (
    <svg viewBox={`${b.minX - pad} ${b.minY - pad} ${b.maxX - b.minX + pad * 2} ${b.maxY - b.minY + pad * 2}`}>
      <path d={toPath(loops)} fillRule="evenodd" />
    </svg>
  );
}

export function PuzzlePicker({ puzzles, solved, onPick }: Props) {
  const done = puzzles.filter((p) => p.id in solved).length;
  return (
    <div className="picker">
      <div className="picker-hero">
        <div>
          <h2>Pick a shape</h2>
          <p>Use all seven pieces to fill the silhouette.</p>
        </div>
        <div className="progress" aria-label={`${done} of ${puzzles.length} solved`}>
          <span className="progress-count">
            {done}
            <small>/{puzzles.length}</small>
          </span>
          <span className="meter">
            <span style={{ width: `${(done / puzzles.length) * 100}%` }} />
          </span>
        </div>
      </div>
      {[...new Set(puzzles.map((p) => p.category))].map((category, ci) => (
        <section key={category} className="picker-section">
          <h3>{category}</h3>
          <div className="picker-grid">
            {puzzles
              .filter((p) => p.category === category)
              .map((p, i) => (
                <button
                  key={p.id}
                  className={"card" + (p.id in solved ? " done" : "")}
                  style={{ "--accent": ACCENTS[(ci * 3 + i) % ACCENTS.length] } as React.CSSProperties}
                  onClick={() => onPick(p)}
                >
                  <Thumb loops={p.polygons} />
                  <span className="card-name">{p.name}</span>
                  {p.id in solved && <span className="card-badge">✓ {formatTime(solved[p.id])}</span>}
                </button>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}
