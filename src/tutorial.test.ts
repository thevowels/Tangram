import { describe, expect, it } from "vitest";
import { piecePolygon, type PieceState } from "./geometry/pieces";
import type { Poly } from "./geometry/polygon";
import { coverage, slotSnap, type Puzzle } from "./game/check";
import { flip, rotate } from "./game/actions";
import { figureExtent, fitLayout, placeSilhouette } from "./game/layout";
import { hasOverlap, moveWithPush } from "./physics/resolve";
import {
  currentStep,
  FLIP_PIECE,
  PLACED,
  stepDone,
  TURN_PIECE,
  TUTORIAL_PUZZLE,
  tutorialPuzzle,
  tutorialStart,
  type Step,
} from "./game/tutorial";
import puzzlesJson from "./data/puzzles.json";

const square = (puzzlesJson as unknown as Puzzle[]).find((p) => p.id === TUTORIAL_PUZZLE)!;
const lesson = tutorialPuzzle(square);
const SCREENS: [number, number][] = [
  [1240, 600],
  [800, 900],
  [390, 640],
  [345, 600],
  [700, 360],
];

const outlineOf = (pieces: PieceState[]) => pieces.map(piecePolygon).map((p) => p.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]).sort().join()).join("|");

describe("tutorial", () => {
  it("the turned square's solution still fills the square", () => {
    expect(coverage(lesson.solution, lesson.polygons as Poly[])).toBeGreaterThan(0.99);
  });

  for (const [w, h] of SCREENS) {
    it(`starts with five pieces in place and two that need a turn and a flip (${w}×${h})`, () => {
      const l = fitLayout(w, h, figureExtent(lesson.polygons as Poly[]));
      const start = tutorialStart(l, lesson.solution);
      expect(hasOverlap(start)).toBe(false);
      const slots = lesson.solution.map((s) => ({ ...s, x: s.x + l.target[0], y: s.y + l.target[1] }));
      for (const id of PLACED) {
        const p = start.find((x) => x.id === id)!;
        const s = slots.find((x) => x.id === id)!;
        expect(Math.hypot(p.x - s.x, p.y - s.y)).toBeLessThan(1e-6);
      }
      const spot = (id: string) => slots.find((s) => s.id === id)!;
      const shapeOf = (p: PieceState) => outlineOf([{ ...p, x: 0, y: 0 }]);
      // two 45° turns put the triangle the right way; one flip fixes the parallelogram
      const m = start.find((p) => p.id === TURN_PIECE)!;
      expect(shapeOf(m)).not.toBe(shapeOf(spot(TURN_PIECE)));
      let turned = start;
      for (let i = 0; i < 2; i++) turned = rotate(turned, [TURN_PIECE], -1, l.board) ?? turned;
      expect(shapeOf(turned.find((p) => p.id === TURN_PIECE)!)).toBe(shapeOf(spot(TURN_PIECE)));
      const flipped = flip(start, [FLIP_PIECE], l.board)!;
      expect(shapeOf(flipped.find((p) => p.id === FLIP_PIECE)!)).toBe(shapeOf(spot(FLIP_PIECE)));
    });

    it(`both open spots can be reached by a straight drag, in either order (${w}×${h})`, () => {
      const l = fitLayout(w, h, figureExtent(lesson.polygons as Poly[]));
      const outline = placeSilhouette(lesson.polygons as Poly[], l.target);
      const board = { ...l.board, outline };
      const slots = lesson.solution.map((s) => ({ ...s, x: s.x + l.target[0], y: s.y + l.target[1] }));
      // pieces already turned/flipped the right way, still in the tray
      const ready = tutorialStart(l, lesson.solution).map((p) => {
        const s = slots.find((x) => x.id === p.id)!;
        return p.id === TURN_PIECE || p.id === FLIP_PIECE ? { ...p, rot: s.rot, flipped: s.flipped } : p;
      });
      const place = (pieces: PieceState[], id: string) => {
        const s = slots.find((x) => x.id === id)!;
        const moved = moveWithPush(pieces, id, [s.x, s.y], board);
        return slotSnap(moved, [id], slots)?.pieces ?? moved;
      };
      for (const order of [
        [TURN_PIECE, FLIP_PIECE],
        [FLIP_PIECE, TURN_PIECE],
      ]) {
        const done = order.reduce(place, ready);
        expect(coverage(done, outline, false), order.join(" then ")).toBeGreaterThan(0.99);
      }
    });
  }

  it("steps pass as the player does them, in any order", () => {
    const start: PieceState[] = [
      { id: TURN_PIECE, x: 5, y: 1, rot: 90, flipped: false },
      { id: FLIP_PIECE, x: 5, y: 3, rot: 0, flipped: true },
    ];
    const moved = start.map((p) => (p.id === TURN_PIECE ? { ...p, x: 3 } : p));
    const turned = start.map((p) => (p.id === TURN_PIECE ? { ...p, rot: 45 } : p));
    const flippedNow = start.map((p) => (p.id === FLIP_PIECE ? { ...p, flipped: false } : p));
    expect(stepDone("drag", start, start, false)).toBe(false);
    expect(stepDone("drag", start, moved, false)).toBe(true);
    expect(stepDone("turn", start, turned, false)).toBe(true);
    expect(stepDone("flip", start, flippedNow, false)).toBe(true);
    expect(stepDone("finish", start, start, true)).toBe(true);
    expect(currentStep(new Set<Step>())).toBe("goal");
    expect(currentStep(new Set<Step>(["goal", "turn"]))).toBe("drag");
    expect(currentStep(new Set<Step>(["goal", "drag", "turn", "flip"]))).toBe("finish");
  });
});
