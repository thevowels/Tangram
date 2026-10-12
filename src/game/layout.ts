import { PIECES, piecePolygon, SQUARE_SIDE, type PieceState } from "../geometry/pieces";
import { bounds, type Poly, type Vec } from "../geometry/polygon";
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

/** Bounding box relative to an anchor point (e.g. a silhouette around its centroid). */
export interface Extent {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** How far apart the tray's pieces start (1 = assembled square). */
const TRAY_SPREAD = 1.2;
/** Space between the silhouette and the tray, and around everything, in tan units. */
const GAP = 0.6;
const MARGIN = 0.35;
/**
 * Extra room beyond the bare minimum so pieces can be dragged and turned freely: generous
 * along the axis pieces travel (tray → silhouette), a little across it.
 */
const SLACK = 1.2;
const CROSS_SLACK = 1.04;
/** Free play has no silhouette: leave room to build a good-sized figure with the pieces. */
const FREE_MIN = { landscape: [10, 7], portrait: [7.5, 10] } as const;
/** Cap on screen px per tan unit, so pieces don't get comically big on large monitors. */
const MAX_UNIT_PX = 130;

const extentOf = (polys: Poly[], at: Vec): Extent => {
  const b = bounds(polys);
  return { minX: b.minX - at[0], minY: b.minY - at[1], maxX: b.maxX - at[0], maxY: b.maxY - at[1] };
};
const widthOf = (e: Extent) => e.maxX - e.minX;
const heightOf = (e: Extent) => e.maxY - e.minY;

let trayExtentCache: Extent | null = null;
/** Bounds of the starting tray around its anchor point. */
function trayExtent(): Extent {
  if (!trayExtentCache) {
    const at: Vec = [5000, 5000];
    trayExtentCache = extentOf(exploded(at, TRAY_SPREAD, { width: 1e4, height: 1e4 }).map(piecePolygon), at);
  }
  return trayExtentCache;
}

/** Smallest board (tan units) that fits the silhouette and the tray with room to play. */
function needs(orientation: Layout["orientation"], figure?: Extent): [number, number] {
  if (!figure) return [...FREE_MIN[orientation]];
  const t = trayExtent();
  const [fw, fh, tw, th] = [widthOf(figure), heightOf(figure), widthOf(t), heightOf(t)];
  return orientation === "landscape"
    ? [(fw + GAP + tw) * SLACK + 2 * MARGIN, Math.max(fh, th) * CROSS_SLACK + 2 * MARGIN]
    : [Math.max(fw, tw) * CROSS_SLACK + 2 * MARGIN, (fh + GAP + th) * SLACK + 2 * MARGIN];
}

/** A board of `width` × `height` with the silhouette and tray side by side, centred together. */
export function makeLayout(
  orientation: Layout["orientation"],
  width: number,
  height: number,
  figure?: Extent,
): Layout {
  const board = { width, height };
  if (!figure) return { orientation, board, target: [width / 2, height / 2], tray: [width / 2, height / 2] };
  const t = trayExtent();
  if (orientation === "landscape") {
    const left = (width - (widthOf(figure) + GAP + widthOf(t))) / 2;
    return {
      orientation,
      board,
      target: [left - figure.minX, height / 2 - (figure.minY + figure.maxY) / 2],
      tray: [left + widthOf(figure) + GAP - t.minX, height / 2 - (t.minY + t.maxY) / 2],
    };
  }
  const top = (height - (heightOf(figure) + GAP + heightOf(t))) / 2;
  return {
    orientation,
    board,
    target: [width / 2 - (figure.minX + figure.maxX) / 2, top - figure.minY],
    tray: [width / 2 - (t.minX + t.maxX) / 2, top + heightOf(figure) + GAP - t.minY],
  };
}

/** Bounds of a silhouette (centred on its centroid, as stored in puzzles.json). */
export const figureExtent = (loops: Poly[]): Extent => extentOf(loops, [0, 0]);

// Reference layouts sized for the largest figures (tests, and old saves without a layout).
const REFERENCE: Extent = { minX: -4.75, minY: -3.75, maxX: 3.25, maxY: 2.8 };
export const LANDSCAPE = makeLayout("landscape", 20, 10, REFERENCE);
export const PORTRAIT = makeLayout("portrait", 10, 16, REFERENCE);

/**
 * Pick the orientation that gives the biggest pieces for a play area of `w`×`h` px, sized
 * to this puzzle's silhouette (or to free play when there isn't one).
 */
export function fitLayout(w: number, h: number, figure?: Extent): Layout {
  const [wl, hl] = needs("landscape", figure);
  const [wp, hp] = needs("portrait", figure);
  const uL = Math.min(w / wl, h / hl);
  const uP = Math.min(w / wp, h / hp);
  const orientation = uL >= uP * 0.95 ? "landscape" : "portrait";
  const unit = Math.min(orientation === "landscape" ? uL : uP, MAX_UNIT_PX);
  const round = (v: number) => Math.round(v * 100) / 100;
  return makeLayout(orientation, round(w / unit), round(h / unit), figure);
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

export const trayLayout = (l: Layout) => exploded(l.tray, TRAY_SPREAD, l.board);
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
