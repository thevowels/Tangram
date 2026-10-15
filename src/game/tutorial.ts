// The first-run lesson: the Square with five pieces already in place. The player finishes it
// with the other two: the medium triangle (drag it, and turn it: it starts turned) and the
// parallelogram (it starts mirrored, so it needs a flip).
//
// The square is turned a quarter so both open spots face the tray on the right. In the usual
// orientation the parallelogram's spot opens downward, and once the triangle is in, a beginner
// dragging straight from the tray gets stuck against it.

import type { PieceState } from "../geometry/pieces";
import { normDeg } from "../geometry/pieces";
import type { Puzzle } from "./check";
import { resolve } from "../physics/resolve";
import { trayLayout, type Layout } from "./layout";

export const TUTORIAL_PUZZLE = "p01";
/** Already in their spots when the lesson starts. */
export const PLACED = ["L1", "L2", "S1", "S2", "SQ"];
export const DRAG_PIECE = "M";
export const TURN_PIECE = "M";
export const FLIP_PIECE = "PA";

/** A quarter turn (rot 270): the parallelogram's spot ends up on the right edge. */
const TURN = 270;

/** The Square with its solution turned by `TURN` (a square silhouette is unchanged by it). */
export function tutorialPuzzle(square: Puzzle): Puzzle {
  const a = (TURN * Math.PI) / 180;
  const [cos, sin] = [Math.round(Math.cos(a)), Math.round(Math.sin(a))];
  return {
    ...square,
    solution: square.solution.map((s) => ({
      ...s,
      x: s.x * cos - s.y * sin,
      y: s.x * sin + s.y * cos,
      rot: normDeg(s.rot + TURN),
    })),
  };
}

/** Lesson pieces: four placed on the outline, three in the tray (one turned, one mirrored). */
export function tutorialStart(l: Layout, solution: PieceState[]): PieceState[] {
  const spot = (id: string) => solution.find((x) => x.id === id)!;
  // the triangle starts a quarter turn off; the parallelogram starts mirrored (flip restores it,
  // since a flip maps rot → -rot)
  const tray = trayLayout(l).map((p) =>
    p.id === TURN_PIECE
      ? { ...p, rot: normDeg(spot(p.id).rot + 90) }
      : p.id === FLIP_PIECE
        ? { ...p, rot: normDeg(-spot(p.id).rot), flipped: true }
        : p,
  );
  const pieces = tray.map((p) => {
    const s = PLACED.includes(p.id) ? solution.find((x) => x.id === p.id) : undefined;
    return s ? { ...s, x: s.x + l.target[0], y: s.y + l.target[1] } : p;
  });
  return resolve(pieces, PLACED, l.board) ?? pieces;
}

export type Step = "goal" | "drag" | "turn" | "flip" | "finish";
export const STEPS: Step[] = ["goal", "drag", "turn", "flip", "finish"];

const find = (pieces: PieceState[], id: string) => pieces.find((p) => p.id === id);

/** Has the player done what this step asks, compared with how the lesson started? */
export function stepDone(step: Step, start: PieceState[], now: PieceState[], solved: boolean): boolean {
  switch (step) {
    case "goal":
      return false; // the player reads it and taps "Got it"
    case "drag":
      return now.some((p) => {
        const s = find(start, p.id);
        return !PLACED.includes(p.id) && !!s && Math.hypot(p.x - s.x, p.y - s.y) > 0.3;
      });
    case "turn":
      return now.some((p) => !PLACED.includes(p.id) && find(start, p.id)?.rot !== p.rot);
    case "flip":
      return find(now, FLIP_PIECE)?.flipped !== find(start, FLIP_PIECE)?.flipped;
    case "finish":
      return solved;
  }
}

/** The step to show: the first one not done yet (steps done early are skipped). */
export function currentStep(passed: Set<Step>): Step {
  return STEPS.find((s) => !passed.has(s)) ?? "finish";
}

/** Which pieces to point at for a step. */
export const HINT: Record<Step, string[]> = {
  goal: [],
  drag: [DRAG_PIECE, FLIP_PIECE],
  turn: [TURN_PIECE],
  flip: [FLIP_PIECE],
  finish: [],
};

const DONE = "tangram.tutorial";
export const tutorialDone = () => {
  try {
    return localStorage.getItem(DONE) !== null;
  } catch {
    return true;
  }
};
export const markTutorialDone = () => localStorage.setItem(DONE, "1");
