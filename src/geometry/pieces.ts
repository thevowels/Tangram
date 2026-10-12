import { add, centroid, sub, type Poly, type Vec } from "./polygon";

export type PieceKind = "large" | "medium" | "small" | "square" | "parallelogram";

export interface PieceDef {
  id: string;
  kind: PieceKind;
  color: string;
  /** Local polygon centered on its centroid; rot=0 matches the classic square layout. */
  shape: Poly;
  /** Centroid position in the classic square layout (square spans 0..2√2). */
  home: Vec;
}

export interface PieceState {
  id: string;
  x: number;
  y: number;
  /** Rotation in degrees, [0, 360). Any angle is allowed; 45° multiples are the common case. */
  rot: number;
  flipped: boolean;
}

// The classic 7-piece square with side 2√2 (total area 8, small triangle legs = 1).
const h = Math.SQRT2 / 2;
const A: Vec = [0, 0];
const B: Vec = [4 * h, 0];
const C: Vec = [4 * h, 4 * h];
const D: Vec = [0, 4 * h];
const O: Vec = [2 * h, 2 * h];
const P: Vec = [3 * h, h];
const Q: Vec = [h, 3 * h];
const R: Vec = [3 * h, 3 * h];
const Mbc: Vec = [4 * h, 2 * h];
const Mcd: Vec = [2 * h, 4 * h];

const raw: { id: string; kind: PieceKind; color: string; poly: Poly }[] = [
  { id: "L1", kind: "large", color: "#ff4d6d", poly: [A, B, O] },
  { id: "L2", kind: "large", color: "#3a86ff", poly: [A, O, D] },
  { id: "M", kind: "medium", color: "#ffbe0b", poly: [Mbc, C, Mcd] },
  { id: "S1", kind: "small", color: "#00d4c8", poly: [P, B, Mbc] },
  { id: "S2", kind: "small", color: "#8ac926", poly: [O, R, Q] },
  { id: "SQ", kind: "square", color: "#c77dff", poly: [O, P, Mbc, R] },
  { id: "PA", kind: "parallelogram", color: "#fb5607", poly: [D, Q, R, Mcd] },
];

export const PIECES: PieceDef[] = raw.map(({ id, kind, color, poly }) => {
  const c = centroid(poly);
  return { id, kind, color, shape: poly.map((p) => sub(p, c)), home: c };
});

export const PIECE_BY_ID = Object.fromEntries(PIECES.map((p) => [p.id, p]));

export const SQUARE_SIDE = 4 * h;

/** World-space polygon for a piece state. */
export function piecePolygon(s: PieceState): Poly {
  const def = PIECE_BY_ID[s.id];
  const a = (s.rot * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const pts = def.shape.map(([x, y]): Vec => {
    const fx = s.flipped ? -x : x;
    return [fx * cos - y * sin + s.x, fx * sin + y * cos + s.y];
  });
  // mirroring reverses the winding; keep a consistent orientation
  return s.flipped ? pts.reverse() : pts;
}

/** The classic square arrangement with its top-left corner at `origin`. */
export function squareLayout(origin: Vec): PieceState[] {
  return PIECES.map((p) => {
    const [x, y] = add(origin, p.home);
    return { id: p.id, x, y, rot: 0, flipped: false };
  });
}

/**
 * The same placement as `piecePolygon`, expressed as translate · scaleX · rotate so it can be
 * used as an (animatable) CSS transform on the local shape: R(rot)·M = M·R(-rot).
 */
export function pieceTransform(s: PieceState): { sx: 1 | -1; deg: number } {
  return s.flipped ? { sx: -1, deg: -s.rot } : { sx: 1, deg: s.rot };
}

export const normDeg = (d: number) => ((d % 360) + 360) % 360;
