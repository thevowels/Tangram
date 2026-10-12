import { piecePolygon, type PieceState } from "../geometry/pieces";
import { area, bounds, centroid, pointInLoops, type Poly } from "../geometry/polygon";

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
