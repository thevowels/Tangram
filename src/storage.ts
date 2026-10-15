import type { PieceState } from "./geometry/pieces";
import type { Layout } from "./game/layout";

export interface Design {
  name: string;
  pieces: PieceState[];
  /** 2 = rotations in degrees; older saves stored 45° steps (0..7). */
  v?: 2;
  /** Board the design was made on, so it can be remapped onto the current screen. */
  layout?: Layout;
  savedAt: number;
}

const DESIGNS = "tangram.designs";
const SOLVED = "tangram.solved";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export const loadDesigns = () =>
  read<Design[]>(DESIGNS, []).map((d) =>
    d.v === 2 ? d : { ...d, v: 2 as const, pieces: d.pieces.map((p) => ({ ...p, rot: p.rot * 45 })) },
  );
export const saveDesigns = (d: Design[]) => localStorage.setItem(DESIGNS, JSON.stringify(d));

// ---- progress (v2): what badges and stats are computed from ----

const PROGRESS = "tangram.progress";

export interface SolveRecord {
  /** best time in ms */
  best: number;
  /** local date of the first solve, YYYY-MM-DD */
  first: string;
}

export interface Progress {
  v: 2;
  solved: Record<string, SolveRecord>;
  designsSaved: number;
  exports: number;
}

/** Today's local date as YYYY-MM-DD. */
export const today = (d = new Date()) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Build v2 progress from the old `tangram.solved` map ({id: bestMs}); dates unknown → `day`. */
export function migrateProgress(oldSolved: Record<string, number>, designs: number, day: string): Progress {
  return {
    v: 2,
    solved: Object.fromEntries(Object.entries(oldSolved).map(([id, best]) => [id, { best, first: day }])),
    designsSaved: designs,
    exports: 0,
  };
}

export function loadProgress(): Progress {
  const p = read<Progress | null>(PROGRESS, null);
  if (p?.v === 2) return p;
  const migrated = migrateProgress(read<Record<string, number>>(SOLVED, {}), loadDesigns().length, today());
  saveProgress(migrated);
  return migrated;
}

export const saveProgress = (p: Progress) => localStorage.setItem(PROGRESS, JSON.stringify(p));

/** A solve: keeps the best time and the first day. */
export function recordSolve(p: Progress, id: string, rawMs: number, day = today()): Progress {
  const ms = Math.round(rawMs);
  const prev = p.solved[id];
  return {
    ...p,
    solved: { ...p.solved, [id]: prev ? { best: Math.min(prev.best, ms), first: prev.first } : { best: ms, first: day } },
  };
}

export const bump = (p: Progress, key: "designsSaved" | "exports"): Progress => ({ ...p, [key]: p[key] + 1 });

/** puzzle id → best time in ms (what the picker shows). */
export const bestTimes = (p: Progress) => Object.fromEntries(Object.entries(p.solved).map(([id, r]) => [id, r.best]));
