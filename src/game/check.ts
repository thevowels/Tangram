import { PIECE_BY_ID, piecePolygon, type PieceState } from "../geometry/pieces";
import { area, bounds, centroid, groupCentroid, mtv, pointInLoops, type Poly } from "../geometry/polygon";
import { findSnap } from "../geometry/snap";

// outlines are exact unions of the pieces, so a real solution scores ≈1
export const SOLVE_THRESHOLD = 0.94;
const GRID = 160;
// Sample off-centre by irrational-ish fractions so sample points never sit exactly on the
// (often integer-coordinate) edges shared by two pieces, where they'd count as in neither.
const OFF_X = 0.5371;
const OFF_Y = 0.4617;

export interface Puzzle {
  id: string;
  name: string;
  category: string;
  /** Silhouette loops (even-odd), centered on the origin, area 8. */
  polygons: Poly[];
  /** One arrangement of the 7 pieces that makes the silhouette (same coordinates). */
  solution: PieceState[];
}

/** Area-weighted centroid of an even-odd silhouette. */
export function silhouetteCentroid(loops: Poly[]): [number, number] {
  let ax = 0;
  let ay = 0;
  let total = 0;
  for (const l of loops) {
    const a = area(l);
    const [cx, cy] = centroid(l);
    // holes have opposite winding in the extracted data, so signed area handles them
    ax += cx * a;
    ay += cy * a;
    total += a;
  }
  return [ax / total, ay / total];
}

/**
 * Intersection-over-union of the placed pieces against the silhouette, sampled on a grid.
 * With `align`, the pieces are compared by shape only: their combined centroid is moved onto
 * the silhouette's, so it doesn't matter where on the board the figure is built.
 */
export function coverage(pieces: PieceState[], silhouette: Poly[], align = true): number {
  const polys = pieces.map(piecePolygon);
  let ax = 0;
  let ay = 0;
  let total = 0;
  for (const p of polys) {
    const a = Math.abs(area(p));
    const [cx, cy] = centroid(p);
    ax += cx * a;
    ay += cy * a;
    total += a;
  }
  const [sx, sy] = silhouetteCentroid(silhouette);
  const dx = align ? sx - ax / total : 0;
  const dy = align ? sy - ay / total : 0;
  const shifted = polys.map((p) => p.map(([x, y]): [number, number] => [x + dx, y + dy]));

  const b = bounds([...shifted, ...silhouette]);
  const size = Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const cell = size / GRID;
  let inter = 0;
  let union = 0;
  for (let gy = 0; gy < GRID; gy++) {
    const y = b.minY + (gy + OFF_Y) * cell;
    if (y > b.maxY) break;
    for (let gx = 0; gx < GRID; gx++) {
      const x = b.minX + (gx + OFF_X) * cell;
      if (x > b.maxX) break;
      const s = pointInLoops(x, y, silhouette);
      const p = shifted.some((poly) => pointInLoops(x, y, [poly]));
      if (s && p) inter++;
      if (s || p) union++;
    }
  }
  return union ? inter / union : 0;
}

/** Match against the silhouette where it's drawn, plus whether the figure is solved anywhere. */
export function evaluate(pieces: PieceState[], placedSilhouette: Poly[]) {
  const inPlace = coverage(pieces, placedSilhouette, false);
  const solved = inPlace >= SOLVE_THRESHOLD || coverage(pieces, placedSilhouette) >= SOLVE_THRESHOLD;
  return { match: inPlace, solved };
}

/** How far a piece may sit from its exact slot and still be pulled into it on solve. */
const MAX_FIT_DISTANCE = 0.8;
/** A finished figure this close to the drawn silhouette lands exactly on it. */
const SNAP_TO_OUTLINE = 0.5;

const shapeKey = (s: PieceState) => {
  const p = piecePolygon(s);
  const [cx, cy] = centroid(p);
  return p.map(([x, y]) => [x - cx, y - cy]);
};
const sameShape = (a: number[][], b: number[][]) =>
  a.length === b.length && a.every(([x, y]) => b.some(([u, v]) => Math.hypot(x - u, y - v) < 1e-3));

/**
 * Snap a solved-but-slightly-off arrangement onto the puzzle's exact solution, so the figure
 * is a perfect match with no gaps. Each piece goes to the nearest solution slot of the same
 * shape and orientation (so the two large / two small triangles are interchangeable), with
 * the slots placed where the pieces actually are (the figure may be built anywhere), or exactly
 * on the silhouette when it was built on it.
 * Returns null if the pieces don't correspond to this solution (e.g. an alternative one).
 */
export function perfectFit(
  pieces: PieceState[],
  solution: PieceState[],
  /** Where the silhouette is drawn: a figure built (nearly) on it snaps exactly onto it. */
  outlineAt?: [number, number],
): PieceState[] | null {
  let [cx, cy] = groupCentroid(pieces.map(piecePolygon));
  if (outlineAt && Math.hypot(cx - outlineAt[0], cy - outlineAt[1]) < SNAP_TO_OUTLINE) [cx, cy] = outlineAt;
  const slots = solution.map((s) => ({ ...s, x: s.x + cx, y: s.y + cy }));
  const pairs: { piece: number; slot: number; d: number }[] = [];
  pieces.forEach((p, i) => {
    const shape = shapeKey(p);
    slots.forEach((s, j) => {
      // same kind, and already turned to the slot's exact outline (identical pieces like the two
      // large triangles have different base orientations, so compare geometry, not rot values)
      if (PIECE_BY_ID[s.id].kind !== PIECE_BY_ID[p.id].kind || !sameShape(shape, shapeKey(s))) return;
      const d = Math.hypot(p.x - s.x, p.y - s.y);
      if (d <= MAX_FIT_DISTANCE) pairs.push({ piece: i, slot: j, d });
    });
  });
  pairs.sort((a, b) => a.d - b.d);
  const slotOf = new Map<number, number>();
  const taken = new Set<number>();
  for (const { piece, slot } of pairs) {
    if (slotOf.has(piece) || taken.has(slot)) continue;
    slotOf.set(piece, slot);
    taken.add(slot);
  }
  if (slotOf.size !== pieces.length) return null;
  // same outline, so only the position changes (state x/y is the piece's centroid)
  return pieces.map((p, i) => {
    const s = slots[slotOf.get(i)!];
    return { ...p, x: s.x, y: s.y };
  });
}

/**
 * Fallback for arrangements that don't match the stored solution: repeatedly snap each piece
 * flush against its neighbours and the outline (never creating overlaps) to close small gaps.
 */
export function settleFlush(pieces: PieceState[], outline: Poly[], passes = 4): PieceState[] {
  let state = pieces;
  for (let pass = 0; pass < passes; pass++) {
    let moved = false;
    for (const p of state) {
      const s = findSnap(state, p.id, outline, 0.25);
      if (!s) continue;
      const next = state.map((q) => (q.id === p.id ? { ...q, x: q.x + s.offset[0], y: q.y + s.offset[1] } : q));
      const polys = next.map(piecePolygon);
      const i = next.findIndex((q) => q.id === p.id);
      if (polys.some((other, j) => j !== i && mtv(other, polys[i]))) continue;
      state = next;
      moved = true;
    }
    if (!moved) break;
  }
  return state;
}
