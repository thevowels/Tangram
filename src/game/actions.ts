import { normDeg, piecePolygon, type PieceState } from "../geometry/pieces";
import { groupCentroid, type Poly, type Vec } from "../geometry/polygon";
import { findSnap } from "../geometry/snap";
import { transformWithPush, type Board } from "../physics/resolve";

/** The next 45° step from `rot` in direction `dir` (an off-grid angle goes to the nearest step that way). */
export function step45(rot: number, dir: 1 | -1) {
  const k = rot / 45;
  return normDeg((dir > 0 ? Math.floor(k + 1e-6) + 1 : Math.ceil(k - 1e-6) - 1) * 45);
}

const pick = (pieces: PieceState[], ids: string[]) => pieces.filter((p) => ids.includes(p.id));

/**
 * Turn a set of pieces rigidly by `deg` about their combined centre. A single piece just
 * rotates in place.
 */
export function turnGroup(members: PieceState[], deg: number): PieceState[] {
  const [cx, cy] = groupCentroid(members.map(piecePolygon));
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return members.map((p) => {
    const dx = p.x - cx;
    const dy = p.y - cy;
    // world rotation R(deg)·R(rot)·Mᶠ = R(rot + deg)·Mᶠ, flipped or not
    return { ...p, x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos, rot: normDeg(p.rot + deg) };
  });
}

/** Rotate a piece or group by one 45° step. Single pieces land on the next 45° multiple. */
export function rotate(pieces: PieceState[], ids: string[], dir: 1 | -1, board: Board) {
  const members = pick(pieces, ids);
  if (members.length === 1) {
    const p = members[0];
    return transformWithPush(pieces, { ...p, rot: step45(p.rot, dir) }, board);
  }
  return transformWithPush(pieces, turnGroup(members, dir * 45), board);
}

/** Turn a piece or group by `deg` (used by the two-finger twist). */
export function turnBy(pieces: PieceState[], ids: string[], deg: number, board: Board) {
  return transformWithPush(pieces, turnGroup(pick(pieces, ids), deg), board);
}

/**
 * Mirror a piece or group left↔right on screen, about its centre. Per piece, with
 * R(rot)·M = M·R(-rot), mirroring is rot → -rot plus toggling the flip.
 */
export function flip(pieces: PieceState[], ids: string[], board: Board) {
  const members = pick(pieces, ids);
  const [cx] = groupCentroid(members.map(piecePolygon));
  return transformWithPush(
    pieces,
    members.map((p) => ({ ...p, x: 2 * cx - p.x, rot: normDeg(-p.rot), flipped: !p.flipped })),
    board,
  );
}

/** Snap dropped piece(s) against the other pieces / the guide outline. */
export function snap(
  pieces: PieceState[],
  ids: string[],
  guides: Poly[],
  board: Board,
): { pieces: PieceState[]; at: Vec } | null {
  const s = findSnap(pieces, ids, guides);
  if (!s) return null;
  const next = transformWithPush(
    pieces,
    pick(pieces, ids).map((p) => ({ ...p, x: p.x + s.offset[0], y: p.y + s.offset[1] })),
    board,
  );
  return next ? { pieces: next, at: s.at } : null;
}
