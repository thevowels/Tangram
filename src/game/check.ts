import { PIECE_BY_ID, piecePolygon, type PieceState } from "../geometry/pieces";
import { area, bounds, centroid, closestOnSegment, groupCentroid, mtv, pointInLoops, type Poly } from "../geometry/polygon";
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
 * the slots placed on the drawn silhouette (`outlineAt`): a figure finished anywhere on the
 * board glides onto the outline. Without `outlineAt` the slots stay where the pieces are.
 * Returns null if the pieces don't correspond to this solution (e.g. an alternative one).
 */
export function perfectFit(
  pieces: PieceState[],
  solution: PieceState[],
  /** Where the silhouette is drawn: the finished figure is placed exactly on it. */
  outlineAt?: [number, number],
): PieceState[] | null {
  // match against slots around the pieces' own centre (wherever the figure was built)...
  const [gx, gy] = groupCentroid(pieces.map(piecePolygon));
  // ...but place the result on the outline
  const [cx, cy] = outlineAt ?? [gx, gy];
  const slots = solution.map((s) => ({ ...s, x: s.x + gx, y: s.y + gy }));
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
    return { ...p, x: s.x - gx + cx, y: s.y - gy + cy };
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

/**
 * Move a whole finished figure, rigidly, so its centre sits at `at` (used to bring a figure
 * that was built away from the outline onto it; all seven pieces are in the figure, so the
 * outline area is free).
 */
export function centreOn(pieces: PieceState[], at: [number, number]): PieceState[] {
  const [cx, cy] = groupCentroid(pieces.map(piecePolygon));
  return pieces.map((p) => ({ ...p, x: p.x + at[0] - cx, y: p.y + at[1] - cy }));
}

/** How close (centre to centre, tan units) a correctly turned piece must be to pull into its spot. */
export const SLOT_SNAP_DISTANCE = 0.25;

/**
 * Pull dropped (or just turned) pieces exactly into their spot on the outline: when a piece has
 * the same outline as one of the solution's spots (`slots`, already placed on the board) and
 * sits within `maxDist` of it, move it there. A joined group moves by one shared offset, and
 * only if every member then sits exactly on a free spot. Never creates overlaps.
 */
export function slotSnap(
  pieces: PieceState[],
  ids: string[],
  slots: PieceState[],
  maxDist = SLOT_SNAP_DISTANCE,
): { pieces: PieceState[]; at: [number, number] } | null {
  const moving = pieces.filter((p) => ids.includes(p.id));
  if (!moving.length) return null;
  const others = pieces.filter((p) => !ids.includes(p.id)).map(piecePolygon);
  const fits = (p: PieceState, s: PieceState) =>
    PIECE_BY_ID[s.id].kind === PIECE_BY_ID[p.id].kind && sameShape(shapeKey(p), shapeKey(s));

  // candidate shifts: any member onto any matching spot nearby
  const shifts: { dx: number; dy: number; d: number }[] = [];
  for (const p of moving) {
    for (const s of slots) {
      const d = Math.hypot(s.x - p.x, s.y - p.y);
      if (d > 1e-9 && d <= maxDist && fits(p, s)) shifts.push({ dx: s.x - p.x, dy: s.y - p.y, d });
    }
  }
  shifts.sort((a, b) => a.d - b.d);

  for (const { dx, dy } of shifts) {
    const moved = moving.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));
    // every member must land exactly on its own matching spot
    const used = new Set<number>();
    const ok = moved.every((p) => {
      const i = slots.findIndex((s, j) => !used.has(j) && Math.hypot(s.x - p.x, s.y - p.y) < 1e-6 && fits(p, s));
      if (i < 0) return false;
      used.add(i);
      return true;
    });
    if (!ok) continue;
    // ...and the spots must be free
    if (moved.some((p) => others.some((o) => mtv(o, piecePolygon(p))))) continue;
    const byId = new Map(moved.map((p) => [p.id, p]));
    const [ax, ay] = groupCentroid(moved.map(piecePolygon));
    return { pieces: pieces.map((p) => byId.get(p.id) ?? p), at: [ax, ay] };
  }
  return null;
}

/** How far a corner may be from its match and still be pulled to it when fitting. */
const FIT_REACH = 0.35;

/**
 * Lock a finished figure together exactly, for any valid arrangement (not just the stored
 * solution): every piece corner is pulled onto the nearest outline corner or neighbouring
 * piece corner (or, failing that, onto the nearest outline / piece edge), and all pieces shift
 * together in small relaxation steps, anchored by the fixed outline, until edges meet edge to
 * edge. Only translations change (rotations are already exact). The result is accepted only if
 * it matches the outline and nothing overlaps; otherwise the pieces come back unchanged.
 */
export function fitToOutline(pieces: PieceState[], outline: Poly[], iterations = 400): PieceState[] {
  const outlineVerts = outline.flat();
  const outlineEdges = outline.flatMap((l) => l.map((a, i) => [a, l[(i + 1) % l.length]] as const));
  let state = pieces.map((p) => ({ ...p }));

  for (let it = 0; it < iterations; it++) {
    const polys = state.map(piecePolygon);
    let worst = 0;
    const shifts = state.map((_, i) => {
      let sx = 0;
      let sy = 0;
      let weight = 0;
      for (const [vx, vy] of polys[i]) {
        // nearest corner: outline corners count double (they're fixed anchors)
        let best: [number, number] | null = null;
        let bestD = FIT_REACH;
        let w = 1;
        for (const [ox, oy] of outlineVerts) {
          const d = Math.hypot(ox - vx, oy - vy);
          if (d < bestD) [best, bestD, w] = [[ox, oy], d, 2];
        }
        polys.forEach((poly, j) => {
          if (j === i) return;
          for (const [px, py] of poly) {
            const d = Math.hypot(px - vx, py - vy);
            if (d < bestD) [best, bestD, w] = [[px, py], d, 1];
          }
        });
        // otherwise the nearest point on an outline edge (or a neighbour's edge)
        if (!best) {
          const edges = [
            ...outlineEdges.map((e) => [e, 2] as const),
            ...polys.flatMap((poly, j) =>
              j === i ? [] : poly.map((a, k) => [[a, poly[(k + 1) % poly.length]] as const, 1] as const),
            ),
          ];
          for (const [[a, b], ew] of edges) {
            const [cx, cy] = closestOnSegment([vx, vy], a, b);
            const d = Math.hypot(cx - vx, cy - vy);
            if (d < bestD) [best, bestD, w] = [[cx, cy], d, ew];
          }
        }
        if (best) {
          sx += (best[0] - vx) * w;
          sy += (best[1] - vy) * w;
          weight += w;
          worst = Math.max(worst, bestD);
        }
      }
      return weight ? ([sx / weight, sy / weight] as const) : ([0, 0] as const);
    });
    // move everyone part of the way (pieces pull on each other, so full steps would oscillate)
    state = state.map((p, i) => ({ ...p, x: p.x + shifts[i][0] * 0.5, y: p.y + shifts[i][1] * 0.5 }));
    if (worst < 1e-9) break;
  }

  const ok = coverage(state, outline, false) > 0.995 && !overlapping(state);
  return ok ? state : pieces;
}

const overlapping = (pieces: PieceState[]) => {
  const polys = pieces.map(piecePolygon);
  return polys.some((a, i) => polys.some((b, j) => j > i && mtv(a, b)));
};
