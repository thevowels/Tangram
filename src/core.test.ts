import { describe, expect, it } from "vitest";
import { PIECES, piecePolygon, pieceTransform, squareLayout, type PieceState } from "./geometry/pieces";
import { area, bounds, cornerJoints, groupCentroid, mtv, sharedEdges, type Poly } from "./geometry/polygon";
import { findSnap } from "./geometry/snap";
import { groupOf, hasOverlap, isLocked, moveWithPush, transformWithPush } from "./physics/resolve";
import { centreOn, coverage, evaluate, fitToOutline, perfectFit, settleFlush, slotSnap, type Puzzle } from "./game/check";
import { flip, rotate, step45 } from "./game/actions";
import { figureExtent, fitLayout, LANDSCAPE, placeSilhouette, PORTRAIT, remap, trayLayout } from "./game/layout";
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

  it("only flush edges that also meet at a corner join pieces", () => {
    const a: Poly = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const cornerOnly: Poly = [[1, 1], [2, 1], [2, 2], [1, 2]]; // touches at a point
    const slid: Poly = [[1, 0.5], [2, 0.5], [2, 1.5], [1, 1.5]]; // flush, corners don't meet
    const aligned: Poly = [[1, 0], [2, 0], [2, 1], [1, 1]]; // flush, corners meet
    const half: Poly = [[1, 0], [1.5, 0], [1, 0.5]]; // shorter edge starting at a shared corner
    expect(cornerJoints(a, cornerOnly)).toHaveLength(0);
    expect(sharedEdges(a, slid)).toHaveLength(1);
    expect(cornerJoints(a, slid)).toHaveLength(0);
    expect(cornerJoints(a, aligned)).toHaveLength(1);
    expect(cornerJoints(a, half)).toHaveLength(1);
  });

  it("pieces slid partway along each other are pushed separately", () => {
    const sq = { id: "SQ", x: 6, y: 5, rot: 45, flipped: false }; // axis-aligned unit square
    const right = piecePolygon(sq).reduce((m, p) => Math.max(m, p[0]), -Infinity);
    const other = { id: "S1", x: 0, y: 0, rot: 0, flipped: true }; // vertical leg on its left
    // put the small triangle's vertical leg against the square's right side, shifted down 0.4
    const poly = piecePolygon(other);
    const minX = Math.min(...poly.map((p) => p[0]));
    const minY = Math.min(...poly.map((p) => p[1]));
    const top = Math.min(...piecePolygon(sq).map((p) => p[1]));
    const slid = { ...other, x: right - minX, y: top + 0.4 - minY };
    // flush along a parallel edge (the old rule would have joined them)...
    expect(sharedEdges(piecePolygon(sq), piecePolygon(slid)).length).toBeGreaterThan(0);
    // ...but no shared corner, so they stay separate
    expect(groupOf([sq, slid], "SQ")).toEqual(["SQ"]);
    // aligned to the square's top corner, they join
    const aligned = { ...slid, y: top - minY };
    expect(new Set(groupOf([sq, aligned], "SQ"))).toEqual(new Set(["SQ", "S1"]));
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

describe("board fits each puzzle (playable on every screen)", () => {
  const screens: [string, number, number][] = [
    ["small phone", 320, 470],
    ["phone", 375, 600],
    ["phone landscape", 740, 290],
    ["tablet", 768, 900],
    ["desktop", 1240, 600],
    ["wide desktop", 1880, 860],
  ];
  const inside = (polys: Poly[], b: { width: number; height: number }) => {
    const e = 1e-6;
    return polys.flat().every(([x, y]) => x >= -e && y >= -e && x <= b.width + e && y <= b.height + e);
  };

  for (const p of puzzles) {
    it(`${p.name}`, () => {
      for (const [screen, w, h] of screens) {
        const l = fitLayout(w, h, figureExtent(p.polygons as Poly[]));
        const guide = placeSilhouette(p.polygons as Poly[], l.target);
        const tray = trayLayout(l);
        const trayPolys = tray.map(piecePolygon);
        const where = `${p.name} on ${screen}`;

        expect(inside(guide, l.board), `${where}: silhouette fits`).toBe(true);
        expect(inside(trayPolys, l.board), `${where}: tray fits`).toBe(true);
        expect(hasOverlap(tray), `${where}: tray pieces apart`).toBe(false);
        const g = bounds(guide);
        const t = bounds(trayPolys);
        const apart = t.minX >= g.maxX || t.maxX <= g.minX || t.minY >= g.maxY || t.maxY <= g.minY;
        expect(apart, `${where}: tray clear of the silhouette`).toBe(true);

        // play it: turn each piece in the tray, then put it in its solution spot
        const b = { ...l.board, outline: guide };
        let state: PieceState[] | null = tray;
        for (const s of p.solution) {
          const cur = state!.find((q) => q.id === s.id)!;
          state = transformWithPush(state!, { ...cur, rot: s.rot, flipped: s.flipped }, b);
          expect(state, `${where}: ${s.id} can turn in the tray`).not.toBeNull();
          state = transformWithPush(state!, { ...s, x: s.x + l.target[0], y: s.y + l.target[1] }, b);
          expect(state, `${where}: ${s.id} can be placed`).not.toBeNull();
        }
        expect(evaluate(state!, guide).solved, `${where}: solved`).toBe(true);
      }
    });
  }

  it("pieces get much bigger than the old fixed board", () => {
    // old board: at least 18 × 9.5 units on landscape screens
    const old = Math.min(1240 / 18, 600 / 9.5);
    const square = puzzles.find((q) => q.name === "Square")!;
    const l = fitLayout(1240, 600, figureExtent(square.polygons as Poly[]));
    expect(1240 / l.board.width).toBeGreaterThan(old * 1.5);
  });
});

describe("solving clicks every piece into its exact place", () => {
  // deterministic jitter
  let seed = 7;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  for (const p of puzzles) {
    it(`${p.name}: a slightly-off solution snaps to a perfect fit`, () => {
      // built elsewhere on the board, each piece a little off, and the identical pieces swapped:
      // the other large/small triangle, turned so it has the same outline
      const swap: Record<string, string> = { L1: "L2", L2: "L1", S1: "S2", S2: "S1" };
      const r5 = (v: number) => (Math.round(v * 1e5) / 1e5 + 0).toFixed(5); // + 0 turns -0 into 0
      const outline = (st: PieceState) =>
        piecePolygon(st)
          .map(([x, y]) => `${r5(x - st.x)},${r5(y - st.y)}`)
          .sort()
          .join(" ");
      const asOther = (s: PieceState): PieceState => {
        const id = swap[s.id];
        if (!id) return s;
        for (const flipped of [false, true])
          for (let rot = 0; rot < 360; rot += 45)
            if (outline({ ...s, id, rot, flipped }) === outline(s)) return { ...s, id, rot, flipped };
        throw new Error("no matching orientation");
      };
      const sloppy = p.solution.map((s) => {
        const o = asOther(s);
        return { ...o, x: o.x + 5 + rand() * 0.2, y: o.y + 3 + rand() * 0.2 };
      });
      const exact = perfectFit(sloppy, p.solution)!;
      expect(exact).not.toBeNull();
      expect(hasOverlap(exact)).toBe(false);
      expect(coverage(exact, p.polygons as Poly[])).toBeGreaterThan(0.999);
      // every piece now sits exactly on a solution slot, shifted to where the figure was built
      // (the square is unique, so it tells us the shift)
      const samePoly = (a: Poly, b: Poly) =>
        a.length === b.length && a.every(([x, y]) => b.some(([u, v]) => Math.hypot(x - u, y - v) < 1e-9));
      const slots = p.solution.map(piecePolygon);
      const sq = exact.find((e) => e.id === "SQ")!;
      const sqSlot = p.solution.find((e) => e.id === "SQ")!;
      const offset = [sq.x - sqSlot.x, sq.y - sqSlot.y];
      for (const q of exact) {
        const back = piecePolygon({ ...q, x: q.x - offset[0], y: q.y - offset[1] });
        expect(slots.some((slot) => samePoly(back, slot)), `${p.name}: ${q.id} on a slot`).toBe(true);
      }
    });
  }

  it("a figure finished on the silhouette lands exactly on it", () => {
    const sq = puzzles.find((q) => q.name === "Square")!;
    const at: [number, number] = [6, 4];
    // built on the outline, but one piece left a bit off (which skews the pieces' centre)
    const sloppy = sq.solution.map((s, i) => ({ ...s, x: s.x + at[0] + (i === 0 ? 0.2 : 0), y: s.y + at[1] }));
    const exact = perfectFit(sloppy, sq.solution, at)!;
    exact.forEach((q) => {
      const s = sq.solution.find((t) => t.id === q.id)!;
      expect(q.x).toBeCloseTo(s.x + at[0], 9);
      expect(q.y).toBeCloseTo(s.y + at[1], 9);
    });
  });

  it("a figure finished far from the outline is moved exactly onto it", () => {
    const cat = puzzles.find((q) => q.name === "Cat")!;
    const outlineAt: [number, number] = [5, 5];
    const elsewhere = cat.solution.map((s) => ({ ...s, x: s.x + 14, y: s.y + 7.3 }));
    const exact = perfectFit(elsewhere, cat.solution, outlineAt)!;
    expect(exact).not.toBeNull();
    exact.forEach((q) => {
      const s = cat.solution.find((t) => t.id === q.id)!;
      expect(q.x).toBeCloseTo(s.x + outlineAt[0], 9);
      expect(q.y).toBeCloseTo(s.y + outlineAt[1], 9);
    });
  });

  it("the fallback can centre a whole figure on the outline", () => {
    const sq = squareLayout([12, 6]);
    const moved = centreOn(sq, [3, 4]);
    const c = groupCentroid(moved.map(piecePolygon));
    expect(c[0]).toBeCloseTo(3, 9);
    expect(c[1]).toBeCloseTo(4, 9);
    // a rigid move: shape unchanged
    moved.forEach((q, i) => expect(q.rot).toBe(sq[i].rot));
    expect(hasOverlap(moved)).toBe(false);
  });

  it("doesn't force an unrelated arrangement onto a solution", () => {
    const swan = puzzles.find((q) => q.name === "Swan")!;
    expect(perfectFit(squareLayout([3, 3]), swan.solution)).toBeNull();
  });

  it("the fallback closes small gaps between pieces", () => {
    const [l1, l2] = squareLayout([5, 5]).filter((q) => q.id === "L1" || q.id === "L2");
    const gapped = [l1, { ...l2, x: l2.x - 0.1 }]; // pulled 0.1 apart along x
    const settled = settleFlush(gapped, []);
    const [a, b] = settled.map(piecePolygon);
    expect(cornerJoints(a, b).length).toBeGreaterThan(0);
  });
});

describe("pieces pull into their exact spot when close", () => {
  const fox = puzzles.find((q) => q.name === "Fox")!;
  const at: [number, number] = [6, 5];
  const slots = fox.solution.map((s) => ({ ...s, x: s.x + at[0], y: s.y + at[1] }));
  const slot = (id: string) => slots.find((s) => s.id === id)!;

  it("a correctly turned piece a little off its spot pulls in exactly", () => {
    const sq = { ...slot("SQ"), x: slot("SQ").x + 0.15, y: slot("SQ").y - 0.1 }; // ~0.18 off
    const r = slotSnap([sq], ["SQ"], slots)!;
    expect(r).not.toBeNull();
    expect(r.pieces[0].x).toBeCloseTo(slot("SQ").x, 9);
    expect(r.pieces[0].y).toBeCloseTo(slot("SQ").y, 9);
  });

  it("too far away: no pull", () => {
    const sq = { ...slot("SQ"), x: slot("SQ").x + 0.4 }; // beyond SLOT_SNAP_DISTANCE (0.25)
    expect(slotSnap([sq], ["SQ"], slots)).toBeNull();
  });

  it("turned the wrong way: no pull", () => {
    const pa = { ...slot("PA"), x: slot("PA").x + 0.1, rot: (slot("PA").rot + 90) % 360 };
    expect(slotSnap([pa], ["PA"], slots)).toBeNull();
  });

  it("a spot that's already taken stays put", () => {
    const placed = slot("SQ");
    // the other square can't exist, so use the two small triangles: S1 sits in its spot already
    const s1 = slot("S1");
    const s2 = { ...s1, id: "S2" as const, x: s1.x + 0.15 }; // same outline, near the taken spot
    const s2Shape = piecePolygon(s2);
    expect(s2Shape.length).toBe(3);
    const r = slotSnap([placed, s1, s2], ["S2"], slots);
    // S2 may only go to the *other* small-triangle spot, which is far away: no pull
    expect(r).toBeNull();
  });

  it("the identical large triangles can take each other's spot", () => {
    // L2 turned to have exactly L1-spot's outline, slightly off
    const target = slot("L1");
    let l2: PieceState | null = null;
    for (const flipped of [false, true])
      for (let rot = 0; rot < 360 && !l2; rot += 45) {
        const c = { ...target, id: "L2", rot, flipped };
        const key = (st: PieceState) =>
          piecePolygon(st)
            .map(([x, y]) => `${(Math.round((x - st.x) * 1e5) / 1e5 + 0).toFixed(5)},${(Math.round((y - st.y) * 1e5) / 1e5 + 0).toFixed(5)}`)
            .sort()
            .join(" ");
        if (key(c) === key(target)) l2 = c;
      }
    const near = { ...l2!, x: target.x - 0.15, y: target.y + 0.1 };
    const r = slotSnap([near], ["L2"], slots)!;
    expect(r).not.toBeNull();
    expect(r.pieces[0].x).toBeCloseTo(target.x, 9);
    expect(r.pieces[0].y).toBeCloseTo(target.y, 9);
  });

  it("a joined group pulls in as one when every member fits", () => {
    const ids = ["S1", "S2", "M"]; // the fox's ears and head
    const group = ids.map((id) => ({ ...slot(id), x: slot(id).x + 0.15, y: slot(id).y + 0.05 }));
    const r = slotSnap(group, ids, slots)!;
    expect(r).not.toBeNull();
    r.pieces.forEach((p) => {
      expect(p.x).toBeCloseTo(slot(p.id).x, 9);
      expect(p.y).toBeCloseTo(slot(p.id).y, 9);
    });
  });
});

describe("finishing locks any valid arrangement edge to edge", () => {
  let seed = 11;
  const rand = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) * 2 - 1;

  for (const p of puzzles) {
    it(`${p.name}: knocked-loose pieces fit back exactly without the stored solution`, () => {
      const outline = p.polygons as Poly[];
      const loose = p.solution.map((s) => ({ ...s, x: s.x + rand() * 0.12, y: s.y + rand() * 0.12 }));
      const fitted = fitToOutline(loose, outline);
      // back on its exact spot, edge to edge (the arrangement is rigid once every corner meets)
      fitted.forEach((q) => {
        const s = p.solution.find((t) => t.id === q.id)!;
        expect(Math.hypot(q.x - s.x, q.y - s.y), `${p.name} ${q.id}`).toBeLessThan(1e-4);
      });
      expect(coverage(fitted, outline, false)).toBeGreaterThan(0.999);
      expect(hasOverlap(fitted)).toBe(false);
    });
  }

  it("a genuinely different solution (the Square built turned 90°) locks exactly", () => {
    const square = puzzles.find((q) => q.name === "Square")!;
    const outline = square.polygons as Poly[];
    // the stored solution turned 90° about the square's centre: every piece in a new place
    const turned = square.solution.map((s) => ({ ...s, x: -s.y, y: s.x, rot: (s.rot + 90) % 360 }));
    expect(coverage(turned, outline, false)).toBeGreaterThan(0.999); // it is a valid solution...
    expect(perfectFit(turned, square.solution)).toBeNull(); // ...but not the stored one
    const loose = turned.map((t, i) => ({ ...t, x: t.x + (i % 2 ? 0.09 : -0.08), y: t.y + (i % 3 ? 0.07 : -0.1) }));
    const fitted = fitToOutline(loose, outline);
    fitted.forEach((q, i) => expect(Math.hypot(q.x - turned[i].x, q.y - turned[i].y)).toBeLessThan(1e-4));
    expect(coverage(fitted, outline, false)).toBeGreaterThan(0.999);
    expect(hasOverlap(fitted)).toBe(false);
  });

  it("leaves pieces alone when they don't form the figure", () => {
    const swan = puzzles.find((q) => q.name === "Swan")!;
    const wrong = squareLayout([0, 0]);
    expect(fitToOutline(wrong, swan.polygons as Poly[])).toEqual(wrong);
  });
});
