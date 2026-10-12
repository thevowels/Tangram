import { piecePolygon, type PieceState } from "./pieces";
import { closestOnSegment, len, mtv, sub, type Poly, type Vec } from "./polygon";

export const SNAP_DISTANCE = 0.2;
// vertex-to-vertex matches win over vertex-to-edge matches of similar distance
const EDGE_PENALTY = 0.05;

export interface Snap {
  offset: Vec;
  /** Where the contact happens, for feedback. */
  at: Vec;
}

interface Candidate extends Snap {
  score: number;
}

function collect(moving: Poly, target: Poly, out: Candidate[], threshold: number) {
  for (const v of moving) {
    for (const w of target) {
      const d = sub(w, v);
      const l = len(d);
      if (l < threshold) out.push({ offset: d, at: w, score: l });
    }
  }
  // vertex of the moving piece onto target edges, and target vertices onto moving edges
  for (const v of moving) {
    for (let i = 0; i < target.length; i++) {
      const p = closestOnSegment(v, target[i], target[(i + 1) % target.length]);
      const d = sub(p, v);
      const l = len(d);
      if (l < threshold) out.push({ offset: d, at: p, score: l + EDGE_PENALTY });
    }
  }
  for (const w of target) {
    for (let i = 0; i < moving.length; i++) {
      const p = closestOnSegment(w, moving[i], moving[(i + 1) % moving.length]);
      const d = sub(w, p);
      const l = len(d);
      if (l < threshold) out.push({ offset: d, at: w, score: l + EDGE_PENALTY });
    }
  }
}

/**
 * Find a small translation for the moving piece(s) that brings a vertex or edge into contact
 * with another piece (or a guide outline) without creating overlaps.
 */
export function findSnap(
  pieces: PieceState[],
  ids: string | string[],
  guides: Poly[] = [],
  threshold = SNAP_DISTANCE,
): Snap | null {
  const moving = new Set(Array.isArray(ids) ? ids : [ids]);
  const polys = pieces.filter((p) => moving.has(p.id)).map(piecePolygon);
  if (!polys.length) return null;
  const others = pieces.filter((p) => !moving.has(p.id)).map(piecePolygon);

  const candidates: Candidate[] = [];
  for (const poly of polys) {
    for (const o of others) collect(poly, o, candidates, threshold);
    for (const g of guides) collect(poly, g, candidates, threshold);
  }
  candidates.sort((a, b) => a.score - b.score);

  for (const c of candidates) {
    if (len(c.offset) < 1e-6) return null; // already snapped
    const ok = polys.every((poly) => {
      const moved = poly.map(([x, y]): Vec => [x + c.offset[0], y + c.offset[1]]);
      return others.every((o) => !mtv(o, moved));
    });
    if (ok) return { offset: c.offset, at: c.at };
  }
  return null;
}
