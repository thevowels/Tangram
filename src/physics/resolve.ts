import { piecePolygon, type PieceState } from "../geometry/pieces";
import { bounds, centroid, cornerJoints, len, mtv, pointInLoops, sharedEdges, sub, type Poly, type Vec } from "../geometry/polygon";

export interface Board {
  width: number;
  height: number;
  /** Puzzle silhouette: pieces that fit it exactly lock in place (see `isLocked`). */
  outline?: Poly[];
}

const MAX_ITER = 30;
const STEP = 0.2; // max distance per sub-step so fast drags can't tunnel through pieces
/** Edges closer than this (and parallel) count as joined. */
export const STICK_TOL = 0.02;
/** ...if they overlap by at least this much; corner-to-corner touches don't stick. */
export const STICK_MIN_LENGTH = 0.1;

const asIds = (ids: string | string[]) => (Array.isArray(ids) ? ids : [ids]);

/** Shift a set of pieces so that, together, they stay inside the board. */
function clampAll(pieces: PieceState[], ids: Set<string>, board: Board): PieceState[] {
  const b = bounds(pieces.filter((p) => ids.has(p.id)).map(piecePolygon));
  let dx = 0;
  let dy = 0;
  if (b.minX < 0) dx = -b.minX;
  else if (b.maxX > board.width) dx = board.width - b.maxX;
  if (b.minY < 0) dy = -b.minY;
  else if (b.maxY > board.height) dy = board.height - b.maxY;
  if (!dx && !dy) return pieces;
  return pieces.map((p) => (ids.has(p.id) ? { ...p, x: p.x + dx, y: p.y + dy } : p));
}

/**
 * A piece fits the outline exactly when it lies inside the silhouette and one of its edges
 * runs flush along the silhouette's border.
 */
export function isLocked(poly: Poly, outline: Poly[]): boolean {
  const c = centroid(poly);
  const inside = [c, ...poly.map(([x, y]): Vec => [c[0] + (x - c[0]) * 0.9, c[1] + (y - c[1]) * 0.9])].every(
    ([x, y]) => pointInLoops(x, y, outline),
  );
  return inside && outline.some((loop) => sharedEdges(poly, loop, STICK_TOL, STICK_MIN_LENGTH).length > 0);
}

/**
 * Ids of pieces held by the outline: every piece that fits it exactly, plus everything
 * joined edge-to-edge to one of those. Pieces in `exclude` (being moved) are never locked.
 */
export function lockedIds(pieces: PieceState[], board: Board, exclude: Set<string> = new Set()): Set<string> {
  if (!board.outline) return new Set();
  const polys = pieces.map(piecePolygon);
  const group = stickyGroups(pieces, exclude, polys);
  const lockedGroups = new Set(
    pieces.map((p, i) => (!exclude.has(p.id) && isLocked(polys[i], board.outline!) ? group[i] : -1)).filter((g) => g >= 0),
  );
  return new Set(pieces.filter((p, i) => !exclude.has(p.id) && lockedGroups.has(group[i])).map((p) => p.id));
}

/**
 * Group index for each piece: pieces joined edge-to-edge (transitively) share a group.
 * Joined means a flush, parallel stretch of edge that also meets at a shared corner
 * (`cornerJoints`); pieces slid partway along each other stay separate.
 * Pieces in `exclude` never join anything (each keeps its own index).
 */
export function stickyGroups(
  pieces: PieceState[],
  exclude: Set<string> = new Set(),
  polys: Poly[] = pieces.map(piecePolygon),
): number[] {
  const parent = pieces.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < pieces.length; i++) {
    if (exclude.has(pieces[i].id)) continue;
    for (let j = i + 1; j < pieces.length; j++) {
      if (exclude.has(pieces[j].id) || find(i) === find(j)) continue;
      if (cornerJoints(polys[i], polys[j], STICK_TOL, STICK_MIN_LENGTH).length) parent[find(j)] = find(i);
    }
  }
  return pieces.map((_, i) => find(i));
}

/** Ids of every piece joined (edge-to-edge, transitively) to `id`, including itself. */
export function groupOf(pieces: PieceState[], id: string): string[] {
  const g = stickyGroups(pieces);
  const i = pieces.findIndex((p) => p.id === id);
  return pieces.filter((_, j) => g[j] === g[i]).map((p) => p.id);
}

/**
 * Push pieces apart until nothing overlaps. The pieces in `fixed` (the ones being moved)
 * stay put; whatever they hit gets pushed, and that pushes its neighbours in turn. Pieces
 * joined edge-to-edge move as one rigid group, so collisions never break up a built figure.
 * The fixed pieces are their own body: nothing else joins them during the move.
 * Returns null when the arrangement can't be settled (e.g. pieces jammed against a wall).
 */
export function resolve(
  pieces: PieceState[],
  fixed: string | string[],
  board: Board,
  /** Pieces that move freely but don't join groups this time (e.g. one that was just turned). */
  loose: string[] = [],
): PieceState[] | null {
  const fixedIds = new Set(asIds(fixed));
  const out = pieces.map((p) => ({ ...p }));
  const polys = out.map(piecePolygon);

  // fast path: nothing overlaps, so there's nothing to push (the common case while dragging)
  let anyOverlap = false;
  for (let i = 0; i < out.length && !anyOverlap; i++) {
    for (let j = i + 1; j < out.length; j++) {
      if (mtv(polys[i], polys[j])) {
        anyOverlap = true;
        break;
      }
    }
  }
  if (!anyOverlap) return out;

  const FIXED = -1;
  const group = stickyGroups(out, new Set([...fixedIds, ...loose]), polys).map((g, i) =>
    fixedIds.has(out[i].id) ? FIXED : g,
  );
  const members = (g: number) => out.map((_, i) => i).filter((i) => group[i] === g);
  // groups held by the outline behave like walls: they never get pushed
  const locked = lockedIds(out, board, fixedIds);
  const lockedGroups = new Set(out.map((p, i) => (locked.has(p.id) ? group[i] : null)).filter((g) => g !== null));

  const shiftGroup = (g: number, dx: number, dy: number) => {
    for (const i of members(g)) {
      out[i] = { ...out[i], x: out[i].x + dx, y: out[i].y + dy };
      polys[i] = piecePolygon(out[i]);
    }
  };

  for (let iter = 0; iter < MAX_ITER; iter++) {
    let collided = false;
    for (let i = 0; i < out.length; i++) {
      for (let j = i + 1; j < out.length; j++) {
        const gi = group[i];
        const gj = group[j];
        if (gi === gj) continue;
        const m = mtv(polys[i], polys[j]); // moves j out of i
        if (!m) continue;
        collided = true;
        // push slightly further than needed so the pair ends up just touching
        const k = 1 + 1e-3 / Math.max(len(m), 1e-9);
        const li = lockedGroups.has(gi);
        const lj = lockedGroups.has(gj);
        if ((gi === FIXED && lj) || (gj === FIXED && li) || (li && lj)) return null; // blocked
        if (gj === FIXED || lj) shiftGroup(gi, -m[0] * k, -m[1] * k);
        else if (gi === FIXED || li) shiftGroup(gj, m[0] * k, m[1] * k);
        else {
          shiftGroup(gi, (-m[0] * k) / 2, (-m[1] * k) / 2);
          shiftGroup(gj, (m[0] * k) / 2, (m[1] * k) / 2);
        }
      }
    }
    // keep every pushed group inside the board, as a whole
    for (const g of new Set(group)) {
      if (g === FIXED || lockedGroups.has(g)) continue;
      const b = bounds(members(g).map((i) => polys[i]));
      let dx = 0;
      let dy = 0;
      if (b.minX < 0) dx = -b.minX;
      else if (b.maxX > board.width) dx = board.width - b.maxX;
      if (b.minY < 0) dy = -b.minY;
      else if (b.maxY > board.height) dy = board.height - b.maxY;
      if (dx || dy) shiftGroup(g, dx, dy);
    }
    if (!collided) break;
  }
  // never hand back overlapping pieces (e.g. an overlap hidden inside one group)
  return hasOverlap(out) ? null : out;
}

export function hasOverlap(pieces: PieceState[]): boolean {
  const polys = pieces.map(piecePolygon);
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (mtv(polys[i], polys[j])) return true;
    }
  }
  return false;
}

/** Translate the moving pieces by `delta`, keep them on the board, and settle everything else. */
function tryShift(pieces: PieceState[], ids: Set<string>, delta: Vec, board: Board): PieceState[] | null {
  const moved = pieces.map((p) => (ids.has(p.id) ? { ...p, x: p.x + delta[0], y: p.y + delta[1] } : p));
  return resolve(clampAll(moved, ids, board), [...ids], board);
}

/** One small step: go straight, else slide along one axis, else go as far as possible. */
function step(pieces: PieceState[], ids: Set<string>, delta: Vec, board: Board): PieceState[] {
  const direct = tryShift(pieces, ids, delta, board);
  if (direct) return direct;

  const [dx, dy] = delta;
  const slides: Vec[] = Math.abs(dx) >= Math.abs(dy) ? [[dx, 0], [0, dy]] : [[0, dy], [dx, 0]];
  for (const s of slides) {
    if (!s[0] && !s[1]) continue;
    const r = tryShift(pieces, ids, s, board);
    if (r) return r;
  }

  let lo = 0;
  let hi = 1;
  let best = pieces;
  for (let i = 0; i < 8; i++) {
    const t = (lo + hi) / 2;
    const r = tryShift(pieces, ids, [dx * t, dy * t], board);
    if (r) {
      best = r;
      lo = t;
    } else {
      hi = t;
    }
  }
  return best;
}

/**
 * Move a piece (or a set of pieces, rigidly) so that the first one ends up at `target`,
 * pushing other pieces out of the way.
 */
export function moveWithPush(pieces: PieceState[], ids: string | string[], target: Vec, board: Board): PieceState[] {
  const set = new Set(asIds(ids));
  const anchor = pieces.find((p) => p.id === asIds(ids)[0])!;
  const delta = sub(target, [anchor.x, anchor.y]);
  const n = Math.max(1, Math.ceil(len(delta) / STEP));
  let state = pieces;
  for (let i = 0; i < n; i++) {
    const a = state.find((p) => p.id === anchor.id)!;
    const goal: Vec = [anchor.x + (delta[0] * (i + 1)) / n, anchor.y + (delta[1] * (i + 1)) / n];
    state = step(state, set, sub(goal, [a.x, a.y]), board);
    const b = state.find((p) => p.id === anchor.id)!;
    // blocked (e.g. against a locked piece or a jammed wall): further steps won't get anywhere
    if (Math.hypot(b.x - a.x, b.y - a.y) < 1e-4) break;
  }
  return state;
}

/**
 * Replace some pieces' states (rotation/flip/snap) and push neighbours away. If that's
 * impossible because the changed pieces now hit something immovable (a piece locked to the
 * outline, or a jammed wall), let the changed pieces themselves be nudged clear instead of
 * refusing. Returns null only if nothing works.
 */
export function transformWithPush(
  pieces: PieceState[],
  next: PieceState | PieceState[],
  board: Board,
): PieceState[] | null {
  const list = Array.isArray(next) ? next : [next];
  const byId = new Map(list.map((p) => [p.id, p]));
  const replaced = clampAll(
    pieces.map((p) => byId.get(p.id) ?? p),
    new Set(byId.keys()),
    board,
  );
  const ids = [...byId.keys()];
  return resolve(replaced, ids, board) ?? resolve(replaced, [], board, ids);
}
