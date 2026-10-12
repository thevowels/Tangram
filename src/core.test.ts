import { describe, expect, it } from "vitest";
import { PIECES, piecePolygon, pieceTransform, squareLayout, type PieceState } from "./geometry/pieces";
import { area, mtv, sharedEdges, type Poly } from "./geometry/polygon";
import { findSnap } from "./geometry/snap";
import { groupOf, hasOverlap, isLocked, moveWithPush, transformWithPush } from "./physics/resolve";
import { coverage, type Puzzle } from "./game/check";
import { flip, rotate, step45 } from "./game/actions";
import { LANDSCAPE, PORTRAIT, remap, trayLayout } from "./game/layout";
import puzzlesJson from "./data/puzzles.json";

const puzzles = puzzlesJson as unknown as Puzzle[];
const board = { width: 20, height: 12 };

describe("pieces", () => {
  it("total area is 8 and the square layout has no overlaps", () => {
    const total = PIECES.reduce((s, p) => s + Math.abs(area(p.shape)), 0);
    expect(total).toBeCloseTo(8, 6);
    expect(hasOverlap(squareLayout([1, 1]))).toBe(false);
  });

  it("flipping keeps area and winding", () => {
    const s: PieceState = { id: "PA", x: 5, y: 5, rot: 135, flipped: true };
    expect(area(piecePolygon(s))).toBeCloseTo(area(piecePolygon({ ...s, flipped: false })), 6);
  });
});

describe("SAT", () => {
  const sq = (x: number, y: number): Poly => [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
  it("touching squares don't overlap", () => {
    expect(mtv(sq(0, 0), sq(1, 0))).toBeNull();
  });
  it("overlapping squares give the minimal push", () => {
    const m = mtv(sq(0, 0), sq(0.8, 0.1))!;
    expect(m[0]).toBeCloseTo(0.2, 6);
    expect(m[1]).toBeCloseTo(0, 6);
  });
});

describe("push physics", () => {
  it("dragging through a cluster never leaves overlaps", () => {
    let state = squareLayout([8, 4]);
    // throw the large triangle around the board, through the others
    const targets: [number, number][] = [[12, 6], [9, 5], [15, 9], [3, 3], [10, 6], [18, 11]];
    for (const t of targets) {
      state = moveWithPush(state, "L1", t, board);
      expect(hasOverlap(state)).toBe(false);
    }
  });

  it("pushes neighbours instead of passing through them", () => {
    const start: PieceState[] = [
      { id: "SQ", x: 5, y: 5, rot: 0, flipped: false },
      { id: "S1", x: 8, y: 5, rot: 0, flipped: false },
    ];
    const after = moveWithPush(start, "SQ", [8, 5], board);
    const s1 = after.find((p) => p.id === "S1")!;
    expect(s1.x).toBeGreaterThan(8);
    expect(hasOverlap(after)).toBe(false);
  });

  it("pieces joined along an edge are pushed as one rigid group", () => {
    // the two large triangles of the classic square share their long edge
    const pair = squareLayout([6, 3]).filter((p) => p.id === "L1" || p.id === "L2");
    const hitter = { id: "SQ", x: 2, y: 4.4, rot: 0, flipped: false };
    const after = moveWithPush([hitter, ...pair], "SQ", [6.5, 4.4], board);
    const d1 = [after[1].x - pair[0].x, after[1].y - pair[0].y];
    const d2 = [after[2].x - pair[1].x, after[2].y - pair[1].y];
    expect(Math.hypot(d1[0], d1[1])).toBeGreaterThan(0.1);
    expect(d2[0]).toBeCloseTo(d1[0], 9);
    expect(d2[1]).toBeCloseTo(d1[1], 9);
    expect(hasOverlap(after)).toBe(false);
  });

  it("a corner-to-corner touch does not join pieces", () => {
    const a: Poly = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const corner: Poly = [[1, 1], [2, 1], [2, 2], [1, 2]];
    const flush: Poly = [[1, 0.5], [2, 0.5], [2, 1.5], [1, 1.5]];
    expect(sharedEdges(a, corner)).toHaveLength(0);
    const shared = sharedEdges(a, flush);
    expect(shared).toHaveLength(1);
    expect(Math.hypot(shared[0][1][0] - shared[0][0][0], shared[0][1][1] - shared[0][0][1])).toBeCloseTo(0.5, 9);
  });

  it("a whole group can be dragged rigidly", () => {
    const state = squareLayout([6, 3]);
    const ids = state.map((p) => p.id);
    const after = moveWithPush(state, ids, [state[0].x + 3, state[0].y + 1], board);
    after.forEach((p, i) => {
      expect(p.x - state[i].x).toBeCloseTo(3, 6);
      expect(p.y - state[i].y).toBeCloseTo(1, 6);
    });
  });

  it("rotating and flipping a group keeps it joined and overlap-free", () => {
    const state = squareLayout([6, 3]);
    const pair = ["L1", "SQ", "S1"];
    const turned = rotate(state, pair, 1, board)!;
    expect(hasOverlap(turned)).toBe(false);
    const flipped = flip(turned, pair, board)!;
    expect(hasOverlap(flipped)).toBe(false);
    const moved = flipped.filter((p) => pair.includes(p.id));
    expect(new Set(groupOf(moved, "L1"))).toEqual(new Set(pair));
  });

  it("rotation pushes neighbours", () => {
    const state = squareLayout([8, 4]);
    const l1 = state.find((p) => p.id === "L1")!;
    const r = transformWithPush(state, { ...l1, rot: 45 }, board);
    expect(r).not.toBeNull();
    expect(hasOverlap(r!)).toBe(false);
  });
});

describe("snapping", () => {
  it("pulls a nearby piece into vertex contact", () => {
    const sq = { id: "SQ", x: 5, y: 5, rot: 45, flipped: false };
    const s1 = { id: "S1", x: 5, y: 5, rot: 0, flipped: false };
    // place S1 to the right of the square with a small gap
    const pSq = piecePolygon(sq);
    const maxX = Math.max(...pSq.map((p) => p[0]));
    const pS1 = piecePolygon(s1);
    const minX = Math.min(...pS1.map((p) => p[0]));
    const placed = { ...s1, x: s1.x + (maxX - minX) + 0.1 };
    const snap = findSnap([sq, placed], "S1");
    expect(snap).not.toBeNull();
    expect(snap!.offset[0]).toBeLessThan(0);
  });
});

describe("puzzles", () => {
  it("are grouped into categories", () => {
    expect(puzzles.length).toBeGreaterThanOrEqual(20);
    expect(new Set(puzzles.map((p) => p.category))).toEqual(new Set(["Shapes", "Things", "Animals", "People"]));
  });

  for (const p of puzzles) {
    it(`${p.name}: stored solution uses all 7 pieces, no overlaps, and fills the outline`, () => {
      expect(new Set(p.solution.map((s) => s.id)).size).toBe(7);
      expect(hasOverlap(p.solution)).toBe(false);
      expect(coverage(p.solution, p.polygons as Poly[], false)).toBeGreaterThan(0.99);
    });
  }

  it("the classic square layout solves the Square anywhere on the board", () => {
    const square = puzzles.find((p) => p.name === "Square")!;
    expect(coverage(squareLayout([3, 3]), square.polygons as Poly[])).toBeGreaterThan(0.99);
  });

  it("the square layout does not solve the Swan", () => {
    const swan = puzzles.find((p) => p.name === "Swan")!;
    expect(coverage(squareLayout([3, 3]), swan.polygons as Poly[])).toBeLessThan(0.7);
  });
});

describe("locking to the outline", () => {
  const square = () => puzzles.find((p) => p.name === "Square")!;
  const at = (dx: number, dy: number) => ({
    outline: (square().polygons as Poly[]).map((l) => l.map(([x, y]): [number, number] => [x + dx, y + dy])),
    solution: square().solution.map((s) => ({ ...s, x: s.x + dx, y: s.y + dy })),
  });

  it("a piece placed exactly in the silhouette is locked; a stray one isn't", () => {
    const { outline, solution } = at(10, 6);
    const l1 = solution.find((s) => s.id === "L1")!;
    expect(isLocked(piecePolygon(l1), outline)).toBe(true);
    expect(isLocked(piecePolygon({ ...l1, x: l1.x + 5 }), outline)).toBe(false);
    expect(isLocked(piecePolygon({ ...l1, x: l1.x + 0.3 }), outline)).toBe(false);
  });

  it("locked pieces aren't pushed: the mover stops against them", () => {
    const { outline, solution } = at(10, 6);
    const l1 = solution.find((s) => s.id === "L1")!;
    const hitter = { id: "SQ", x: l1.x, y: l1.y - 4, rot: 0, flipped: false };
    const b = { ...board, outline };
    const after = moveWithPush([l1, hitter], "SQ", [l1.x, l1.y], b);
    expect(after[0]).toEqual(l1);
    expect(hasOverlap(after)).toBe(false);
    expect(after[1].y).toBeLessThan(l1.y);
  });

  it("without an outline the same piece would be pushed", () => {
    const { solution } = at(10, 6);
    const l1 = solution.find((s) => s.id === "L1")!;
    const hitter = { id: "SQ", x: l1.x, y: l1.y - 4, rot: 0, flipped: false };
    const after = moveWithPush([l1, hitter], "SQ", [l1.x, l1.y], board);
    expect(after[0]).not.toEqual(l1);
  });
});

describe("rotation steps", () => {
  it("steps to the next 45° multiple in each direction", () => {
    expect(step45(0, 1)).toBe(45);
    expect(step45(0, -1)).toBe(315);
    expect(step45(30, 1)).toBe(45);
    expect(step45(30, -1)).toBe(0);
    expect(step45(315, 1)).toBe(0);
  });
});

describe("flip", () => {
  const board = { width: 20, height: 12 };
  for (const id of PIECES.map((p) => p.id)) {
    it(`mirrors ${id} left-right on screen`, () => {
      const s: PieceState = { id, x: 10, y: 6, rot: 135, flipped: false };
      const flipped = flip([s], [id], board)![0];
      const mirrored = piecePolygon(s).map(([x, y]) => `${(20 - x).toFixed(4)},${y.toFixed(4)}`).sort();
      const got = piecePolygon(flipped).map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).sort();
      expect(got).toEqual(mirrored);
    });
  }

  it("CSS transform matches piecePolygon", () => {
    for (const flipped of [false, true]) {
      for (let rot = 0; rot < 360; rot += 22.5) {
        const s: PieceState = { id: "PA", x: 3, y: 4, rot, flipped };
        const { sx, deg } = pieceTransform(s);
        const a = (deg * Math.PI) / 180;
        const viaCss = PIECES.find((p) => p.id === "PA")!.shape.map(([x, y]) => [
          sx * (x * Math.cos(a) - y * Math.sin(a)) + 3,
          x * Math.sin(a) + y * Math.cos(a) + 4,
        ]);
        const direct = piecePolygon(s);
        const key = (pts: number[][]) => pts.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).sort();
        expect(key(viaCss)).toEqual(key(direct));
      }
    }
  });
});

describe("layouts", () => {
  it("tray fits each board without overlaps", () => {
    for (const l of [LANDSCAPE, PORTRAIT]) {
      const t = trayLayout(l);
      expect(hasOverlap(t)).toBe(false);
      for (const p of t.map(piecePolygon).flat()) {
        expect(p[0]).toBeGreaterThanOrEqual(-1e-6);
        expect(p[0]).toBeLessThanOrEqual(l.board.width + 1e-6);
        expect(p[1]).toBeLessThanOrEqual(l.board.height + 1e-6);
      }
    }
  });

  it("remap keeps pieces placed on the silhouette relative to it", () => {
    const onTarget = { id: "SQ", x: LANDSCAPE.target[0] + 0.5, y: LANDSCAPE.target[1], rot: 0, flipped: false };
    const out = remap([onTarget], LANDSCAPE, PORTRAIT, true)[0];
    expect(out.x).toBeCloseTo(PORTRAIT.target[0] + 0.5, 6);
    expect(out.y).toBeCloseTo(PORTRAIT.target[1], 6);
  });
});
