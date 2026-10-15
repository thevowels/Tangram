import { describe, expect, it } from "vitest";
import type { PieceState } from "./geometry/pieces";
import type { Poly, Vec } from "./geometry/polygon";
import { coverage, slotSnap, type Puzzle } from "./game/check";
import { figureExtent, fitLayout, placeSilhouette, trayLayout } from "./game/layout";
import { dragTo, hasOverlap, type Board } from "./physics/resolve";
import puzzlesJson from "./data/puzzles.json";

const PUZZLES = puzzlesJson as unknown as Puzzle[];

/**
 * A hand-made drag of the last piece into its spot: pointer moves of ~0.15 units that wobble
 * sideways by up to `wobble`, ending a little off the exact spot (fingers aren't precise).
 */
function handPath(from: Vec, to: Vec, wobble: number, endOff: Vec): Vec[] {
  const n = Math.max(8, Math.ceil(Math.hypot(to[0] - from[0], to[1] - from[1]) / 0.15));
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const l = Math.hypot(dx, dy) || 1;
  const side: Vec = [-dy / l, dx / l];
  return Array.from({ length: n }, (_, i) => {
    const t = (i + 1) / n;
    const w = Math.sin(t * Math.PI * 3) * wobble * (1 - t * 0.5);
    return [from[0] + dx * t + side[0] * w + endOff[0] * t, from[1] + dy * t + side[1] * w + endOff[1] * t];
  });
}

type Mover = (pieces: PieceState[], id: string, target: Vec, board: Board) => PieceState[];

/** Every puzzle, every piece as the last one: how often does a wobbly hand drag finish it? */
function lastPieceSuccess(move: Mover, from: "tray" | "outside" = "tray") {
  let ok = 0;
  let total = 0;
  const failures: string[] = [];
  let overlaps = 0;
  for (const p of PUZZLES) {
    const l = fitLayout(1240, 600, figureExtent(p.polygons as Poly[]));
    const outline = placeSilhouette(p.polygons as Poly[], l.target);
    const board = { ...l.board, outline };
    const slots = p.solution.map((s) => ({ ...s, x: s.x + l.target[0], y: s.y + l.target[1] }));
    const tray = trayLayout(l);
    for (const last of slots) {
      // from the tray, or from just outside the figure straight out from the spot (a short approach)
      const out = Math.hypot(last.x - l.target[0], last.y - l.target[1]) || 1;
      const t =
        from === "tray"
          ? tray.find((x) => x.id === last.id)!
          : {
              x: last.x + ((last.x - l.target[0]) / out) * 1.5,
              y: last.y + ((last.y - l.target[1]) / out) * 1.5,
            };
      // everything else in place; the last piece in the tray, already turned the right way
      let pieces = slots.map((s) => (s.id === last.id ? { ...s, x: t.x, y: t.y } : s));
      if (hasOverlap(pieces)) continue;
      total++;
      for (const target of handPath([t.x, t.y], [last.x, last.y], 0.12, [0.09, -0.07])) {
        pieces = move(pieces, last.id, target, board);
        if (hasOverlap(pieces)) overlaps++;
      }
      pieces = slotSnap(pieces, [last.id], slots)?.pieces ?? pieces;
      if (coverage(pieces, outline, false) > 0.99) ok++;
      else failures.push(`${p.id} ${last.id}`);
    }
  }
  return { ok, total, failures, overlaps };
}

// With plain push physics (moveWithPush) these drags finished only 92/342 from the tray and
// 207/266 on a short approach: a hair of wobble catches a neighbour's corner and the piece stops
// at the entrance of its spot. dragTo finishes all of them.
describe("dragging the last piece in by hand", () => {
  it("dragTo finishes it from just outside", () => {
    const { ok, total, failures, overlaps } = lastPieceSuccess((ps, id, t, b) => dragTo(ps, id, t, b), "outside");
    expect(overlaps).toBe(0);
    expect(failures).toEqual([]);
  }, 60_000);

  it("dragTo slips a roughly aimed piece into its spot", () => {
    const { ok, total, failures, overlaps } = lastPieceSuccess((ps, id, t, b) => dragTo(ps, id, t, b));
    expect(overlaps).toBe(0);
    expect(failures).toEqual([]);
    expect(ok).toBe(total);
  }, 60_000);
});
