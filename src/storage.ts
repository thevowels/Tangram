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

/** puzzle id → best time in ms */
export const loadSolved = () => read<Record<string, number>>(SOLVED, {});
export const saveSolved = (s: Record<string, number>) => localStorage.setItem(SOLVED, JSON.stringify(s));
