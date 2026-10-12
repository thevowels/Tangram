// Hand-authored tangram figures. Each figure is the 7 pieces placed edge to edge; the puzzle
// silhouette is their exact union, so outlines are crisp and every puzzle is solvable.
//
// Coordinates: tan units (small triangle legs = 1), y grows downward. Directions are degrees
// clockwise on screen: 0 → right, 90 → down, 180 → left, 270 → up; diagonals in between.
import type { PieceKind } from "../src/geometry/pieces";
import type { Poly, Vec } from "../src/geometry/polygon";

export interface FigurePiece {
  kind: PieceKind;
  pts: Poly;
}

export interface Figure {
  name: string;
  category: "Shapes" | "Things" | "Animals" | "People";
  pieces: FigurePiece[];
}

const SQRT2 = Math.SQRT2;

/** Point `len` units from `p` in direction `deg`. Exact for multiples of 45°. */
export function go(p: Vec, deg: number, len = 1): Vec {
  const k = (((deg % 360) + 360) % 360) / 45;
  const diag = Math.SQRT1_2;
  const dirs: Vec[] = [[1, 0], [diag, diag], [0, 1], [-diag, diag], [-1, 0], [-diag, -diag], [0, -1], [diag, -diag]];
  const d = Number.isInteger(k) ? dirs[k] : ([Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)] as Vec);
  return [p[0] + d[0] * len, p[1] + d[1] * len];
}

const LEG: Record<"small" | "medium" | "large", number> = { small: 1, medium: SQRT2, large: 2 };

/** Right triangle with its right angle at `c` and legs pointing `dir` and `dir + 90`. */
export const tri = (kind: "small" | "medium" | "large", c: Vec, dir: number): FigurePiece => ({
  kind,
  pts: [c, go(c, dir, LEG[kind]), go(c, dir + 90, LEG[kind])],
});

/** Unit square with corner `c` and sides pointing `dir` and `dir + 90`. */
export const sq = (c: Vec, dir: number): FigurePiece => {
  const a = go(c, dir);
  return { kind: "square", pts: [c, a, go(a, dir + 90), go(c, dir + 90)] };
};

/** Parallelogram: side 1 from `p` towards `dir`, long side √2 towards `dir + turn` (±45). */
export const para = (p: Vec, dir: number, turn: 45 | -45): FigurePiece => {
  const a = go(p, dir);
  return { kind: "parallelogram", pts: [p, a, go(a, dir + turn, SQRT2), go(p, dir + turn, SQRT2)] };
};

/** Any piece from literal vertices (validated against the real shapes by the build script). */
export const raw = (kind: PieceKind, ...pts: Vec[]): FigurePiece => ({ kind, pts });

const shift = (pieces: FigurePiece[], dx: number, dy: number): FigurePiece[] =>
  pieces.map((p) => ({ ...p, pts: p.pts.map(([x, y]): Vec => [x + dx, y + dy]) }));

/** Transpose (x, y) → (y, x): a mirror, so pieces stay congruent (flips are allowed). */
const transpose = (pieces: FigurePiece[]): FigurePiece[] =>
  pieces.map((p) => ({ ...p, pts: p.pts.map(([x, y]): Vec => [y, x]) }));

/** Rotate 90° clockwise on screen: (x, y) → (-y, x). */
const turn = (pieces: FigurePiece[]): FigurePiece[] =>
  pieces.map((p) => ({ ...p, pts: p.pts.map(([x, y]): Vec => [-y, x]) }));

// ---- reusable sub-assemblies ----

/** M, 2×S, square and parallelogram tiling the 2×2 square [0,2]×[0,2]. */
const smallSquare = (): FigurePiece[] => [
  raw("square", [0, 0], [1, 0], [1, 1], [0, 1]),
  raw("small", [0, 1], [1, 1], [0, 2]),
  raw("medium", [0, 2], [2, 2], [1, 1]),
  raw("parallelogram", [1, 0], [1, 1], [2, 2], [2, 1]),
  raw("small", [1, 0], [2, 0], [2, 1]),
];

/** M, 2×S, square and parallelogram tiling the 4×1 strip [0,4]×[0,1]. */
const strip = (): FigurePiece[] => [
  raw("small", [0, 0], [1, 0], [0, 1]),
  raw("parallelogram", [1, 0], [2, 0], [1, 1], [0, 1]),
  raw("medium", [1, 1], [3, 1], [2, 0]),
  raw("small", [2, 0], [3, 0], [3, 1]),
  raw("square", [3, 0], [4, 0], [4, 1], [3, 1]),
];

/** Two large triangles forming a "roof": apex at `a`, base 4 wide, 2 below the apex. */
const roof = (a: Vec): FigurePiece[] => [
  raw("large", a, [a[0] - 2, a[1] + 2], [a[0], a[1] + 2]),
  raw("large", a, [a[0], a[1] + 2], [a[0] + 2, a[1] + 2]),
];

// ---- the classic square (side 2√2), shared with pieces.ts's layout ----
const h = Math.SQRT1_2;
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
const classicSmall = (): FigurePiece[] => [
  raw("medium", Mbc, C, Mcd),
  raw("small", P, B, Mbc),
  raw("small", O, R, Q),
  raw("square", O, P, Mbc, R),
  raw("parallelogram", D, Q, R, Mcd),
];

function cat(): FigurePiece[] {
  // sitting, facing left: diamond head with pointed ears, straight chest, rounded back,
  // feet tucked under, tail curling up behind
  const T: Vec = [0, 0];
  const head = sq(T, 45);
  const earL = raw("small", T, go(T, 135), go(T, 225));
  const earR = raw("small", T, go(T, 45), go(T, 315));
  const [nx, ny] = go(T, 90, SQRT2); // chin
  const body1 = raw("large", [nx, ny], [nx + 2, ny + 2], [nx, ny + 2]);
  const body2 = raw("large", [nx, ny + 2], [nx + 2, ny + 2], [nx, ny + 4]);
  const feet = raw("medium", [nx, ny + 4], [nx + 2, ny + 4], [nx + 1, ny + 3]);
  const tail = raw("parallelogram", [nx + 2, ny + 4], [nx + 3, ny + 4], [nx + 4, ny + 3], [nx + 3, ny + 3]);
  return [head, earL, earR, body1, body2, feet, tail];
}

function fish(): FigurePiece[] {
  // facing right: diamond body, fins on top and bottom, forked tail
  const top: Vec = [0, -SQRT2];
  const bottom: Vec = [0, SQRT2];
  const nose: Vec = [SQRT2, 0];
  const back: Vec = [-SQRT2, 0];
  const body1 = raw("large", back, top, nose);
  const body2 = raw("large", back, bottom, nose);
  const dorsal = raw("small", top, go(top, 135), go(top, 225));
  const belly = raw("small", bottom, go(bottom, 225), go(bottom, 135));
  const tail = raw("medium", back, go(back, 225, SQRT2), go(back, 135, SQRT2));
  const upper = para(go(back, 225, SQRT2), 180, 45);
  const lower = sq(go(back, 135, SQRT2), 180);
  return [body1, body2, dorsal, belly, tail, upper, lower];
}

export const FIGURES: Figure[] = [
  // ---- Shapes ----
  {
    name: "Square",
    category: "Shapes",
    pieces: [raw("large", A, B, O), raw("large", A, O, D), ...classicSmall()],
  },
  {
    name: "Triangle",
    category: "Shapes",
    pieces: (() => {
      const F: Vec = [4 * h, 8 * h];
      const X: Vec = [2 * h, 6 * h];
      return turn([...classicSmall(), raw("large", C, D, X), raw("large", C, F, X)]);
    })(),
  },
  {
    name: "Rectangle",
    category: "Shapes",
    pieces: [raw("large", [0, 0], [2, 0], [0, 2]), raw("large", [2, 0], [2, 2], [0, 2]), ...shift(smallSquare(), 2, 0)],
  },
  {
    name: "Parallelogram",
    category: "Shapes",
    pieces: [raw("large", [2, 0], [2, 2], [0, 2]), raw("large", [4, 0], [6, 0], [4, 2]), ...shift(smallSquare(), 2, 0)],
  },
  {
    name: "Trapezoid",
    category: "Shapes",
    pieces: [raw("large", [2, 0], [2, 2], [0, 2]), raw("large", [4, 0], [4, 2], [6, 2]), ...shift(smallSquare(), 2, 0)],
  },

  // ---- Things ----
  {
    name: "House",
    category: "Things",
    pieces: [...roof([2, 0]), ...shift(smallSquare(), 1, 2)],
  },
  {
    name: "Sailboat",
    category: "Things",
    pieces: [
      raw("large", [2, 0], [2, 2], [0, 2]),
      raw("large", [3, 0], [3, 2], [5, 2]),
      raw("small", [0, 2], [1, 2], [1, 3]),
      raw("square", [1, 2], [2, 2], [2, 3], [1, 3]),
      raw("small", [2, 2], [3, 3], [2, 3]),
      raw("parallelogram", [2, 2], [3, 2], [4, 3], [3, 3]),
      raw("medium", [3, 2], [5, 2], [4, 3]),
    ],
  },
  {
    name: "Arrow",
    category: "Things",
    pieces: [
      raw("large", [4, 0], [6, 2], [4, 2]),
      raw("large", [4, 4], [6, 2], [4, 2]),
      ...shift(strip(), 0, 1.5),
    ],
  },
  {
    name: "Bridge",
    category: "Things",
    pieces: [...strip(), raw("large", [0, 1], [2, 1], [0, 3]), raw("large", [4, 1], [2, 1], [4, 3])],
  },
  {
    name: "Rocket",
    category: "Things",
    pieces: [
      ...transpose(strip()),
      raw("large", [0, 2], [0, 4], [-2, 4]),
      raw("large", [1, 2], [1, 4], [3, 4]),
    ],
  },
  {
    name: "Tree",
    category: "Things",
    pieces: [
      ...roof([2, 2]),
      raw("small", [0.5, 2], [1.5, 2], [1.5, 1]),
      raw("small", [1.5, 1], [2.5, 2], [1.5, 2]),
      raw("parallelogram", [1.5, 1], [2.5, 1], [3.5, 2], [2.5, 2]),
      raw("medium", [1, 1], [3, 1], [2, 0]),
      raw("square", [1.5, 4], [2.5, 4], [2.5, 5], [1.5, 5]),
    ],
  },

  // ---- Animals ----
  { name: "Cat", category: "Animals", pieces: cat() },
  {
    name: "Rabbit",
    category: "Animals",
    pieces: [
      raw("large", [0, 2], [2, 2], [0, 4]),
      raw("large", [2, 2], [2, 4], [0, 4]),
      raw("square", [2, 1], [3, 1], [3, 2], [2, 2]),
      raw("parallelogram", [2, 1], [2, 0], [1, -1], [1, 0]),
      raw("small", [2, 0], [3, 0], [3, 1]),
      raw("medium", [2, 2], [3, 3], [2, 4]),
      raw("small", [0, 3], [-1, 3], [0, 4]),
    ],
  },
  {
    name: "Swan",
    category: "Animals",
    pieces: [
      raw("large", [1, 2], [3, 2], [1, 4]),
      raw("large", [3, 2], [3, 4], [1, 4]),
      raw("parallelogram", [1, 2], [1, 1], [0, 0], [0, 1]),
      raw("square", [-1, -1], [0, -1], [0, 0], [-1, 0]),
      raw("small", [-1, -1], [-1, 0], [-2, 0]),
      raw("small", [2, 2], [3, 2], [3, 1]),
      raw("medium", [3, 2], [3, 4], [4, 3]),
    ],
  },
  {
    name: "Dog",
    category: "Animals",
    pieces: [
      raw("large", [0, 1], [2, 1], [2, 3]),
      raw("large", [2, 1], [4, 1], [4, 3]),
      raw("square", [4, 0], [5, 0], [5, 1], [4, 1]),
      raw("small", [5, 0], [5, 1], [6, 1]),
      raw("small", [4, 0], [5, 0], [4, -1]),
      raw("parallelogram", [0, 1], [-1, 0], [-2, 0], [-1, 1]),
      raw("medium", [4, 1], [5, 2], [4, 3]),
    ],
  },
  { name: "Fish", category: "Animals", pieces: fish() },
  {
    name: "Turtle",
    category: "Animals",
    pieces: [
      ...roof([2, 0]),
      raw("square", [4, 1], [5, 1], [5, 2], [4, 2]),
      raw("small", [1, 2], [1, 3], [0, 3]),
      raw("small", [3, 2], [3, 3], [4, 3]),
      raw("medium", [1, 2], [3, 2], [2, 3]),
      raw("parallelogram", [0, 2], [-1, 2], [-2, 3], [-1, 3]),
    ],
  },
  {
    name: "Giraffe",
    category: "Animals",
    pieces: [
      raw("large", [0, 2], [2, 2], [0, 4]),
      raw("large", [2, 2], [2, 4], [0, 4]),
      raw("small", [0, 4], [1, 4], [0, 5]),
      raw("small", [2, 4], [2, 5], [1, 4]),
      raw("square", [1, 1], [2, 1], [2, 2], [1, 2]),
      raw("parallelogram", [1, 1], [1, 0], [2, -1], [2, 0]),
      raw("medium", [2, -1], [2, 1], [3, 0]),
    ],
  },

  // ---- People ----
  {
    name: "Walker",
    category: "People",
    pieces: [
      raw("square", [1, 0], [2, 0], [2, 1], [1, 1]),
      raw("large", [0.5, 1], [2.5, 1], [0.5, 3]),
      raw("large", [2.5, 1], [2.5, 3], [0.5, 3]),
      raw("small", [0.5, 1], [0.5, 2], [-0.5, 2]),
      raw("small", [2.5, 1], [2.5, 2], [3.5, 2]),
      raw("medium", [0.5, 3], [1.5, 4], [0.5, 5]),
      raw("parallelogram", [2.5, 3], [2.5, 4], [3.5, 5], [3.5, 4]),
    ],
  },
  {
    name: "Dancer",
    category: "People",
    pieces: [
      raw("square", [1, 0], [2, 0], [2, 1], [1, 1]),
      raw("small", [1, 1], [0, 1], [0, 0]),
      raw("small", [2, 1], [3, 1], [3, 0]),
      raw("medium", [0.5, 1], [2.5, 1], [1.5, 2]),
      ...roof([1.5, 2]),
      raw("parallelogram", [1, 4], [2, 4], [3, 5], [2, 5]),
    ],
  },
];
