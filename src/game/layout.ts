import { PIECES, SQUARE_SIDE, type PieceState } from "../geometry/pieces";
import type { Poly, Vec } from "../geometry/polygon";
import { resolve, type Board } from "../physics/resolve";

/**
 * A board size (in tan units) plus where things go on it. The board has no visible edge: it's
 * fitted to the play area on screen, so its aspect ratio follows the screen. Wide areas put the
 * silhouette left and the piece tray right; tall areas put the silhouette on top, tray below.
 */
export interface Layout {
  orientation: "landscape" | "portrait";
  board: Board;
  /** Where the silhouette is drawn in puzzle mode. */
  target: Vec;
  /** Where loose pieces start in puzzle mode. */
  tray: Vec;
}

// Minimum board sizes that fit the largest silhouette (≈6.2 × 6.6) plus the tray.
const MIN_LANDSCAPE = { width: 18, height: 9.5 };
const MIN_PORTRAIT = { width: 9.5, height: 14.5 };
/** Cap on screen px per tan unit, so pieces don't get comically big on large monitors. */
const MAX_UNIT_PX = 72;

function makeLayout(orientation: Layout["orientation"], width: number, height: number): Layout {
  const board = { width, height };
  // silhouette and tray stay grouped around the centre, however big the board is
  return orientation === "landscape"
    ? { orientation, board, target: [width / 2 - 4.3, height / 2], tray: [width / 2 + 4.7, height / 2] }
    : { orientation, board, target: [width / 2, height / 2 - 3.4], tray: [width / 2, height / 2 + 3.9] };
}

export const LANDSCAPE = makeLayout("landscape", 20, 10);
export const PORTRAIT = makeLayout("portrait", 10, 15);

/** Pick the orientation that gives the biggest pieces for a play area of `w`×`h` px. */
export function fitLayout(w: number, h: number): Layout {
  const uL = Math.min(w / MIN_LANDSCAPE.width, h / MIN_LANDSCAPE.height);
  const uP = Math.min(w / MIN_PORTRAIT.width, h / MIN_PORTRAIT.height);
  const orientation = uL >= uP * 0.95 ? "landscape" : "portrait";
  const unit = Math.min(orientation === "landscape" ? uL : uP, MAX_UNIT_PX);
  const round = (v: number) => Math.round(v * 100) / 100;
  return makeLayout(orientation, round(w / unit), round(h / unit));
}

const center = (l: Layout): Vec => [l.board.width / 2, l.board.height / 2];

/** The classic square, pulled apart around `at` so every piece is free. */
function exploded(at: Vec, factor: number, board: Board): PieceState[] {
  const half = SQUARE_SIDE / 2;
  const pieces = PIECES.map((p) => ({
    id: p.id,
    x: at[0] + (p.home[0] - half) * factor,
    y: at[1] + (p.home[1] - half) * factor,
    rot: 0,
    flipped: false,
  }));
  return resolve(pieces, "", board) ?? pieces;
}

export const trayLayout = (l: Layout) => exploded(l.tray, 1.6, l.board);
export const freeLayout = (l: Layout) => exploded(center(l), 1, l.board);

export const placeSilhouette = (loops: Poly[], at: Vec): Poly[] =>
  loops.map((l) => l.map(([x, y]): Vec => [x + at[0], y + at[1]]));

/**
 * Carry pieces over when the layout changes (window resized, phone rotated). Each piece keeps
 * its offset from the nearest anchor (silhouette or tray in puzzle mode, board centre in free
 * play), so half-built figures survive.
 */
export function remap(pieces: PieceState[], from: Layout, to: Layout, puzzle: boolean): PieceState[] {
  const fromAnchors = puzzle ? [from.target, from.tray] : [center(from)];
  const toAnchors = puzzle ? [to.target, to.tray] : [center(to)];
  const moved = pieces.map((p) => {
    let best = 0;
    let bestD = Infinity;
    fromAnchors.forEach(([ax, ay], i) => {
      const d = Math.hypot(p.x - ax, p.y - ay);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    return {
      ...p,
      x: p.x - fromAnchors[best][0] + toAnchors[best][0],
      y: p.y - fromAnchors[best][1] + toAnchors[best][1],
    };
  });
  return resolve(moved, "", to.board) ?? moved;
}
