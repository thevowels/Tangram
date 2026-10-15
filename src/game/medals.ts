// Speed medals: gold, silver or bronze for a puzzle's best time against its par.
// Fixed rules (not other players' times), so a medal once earned never drops.

import type { Puzzle } from "./check";

export type Medal = "gold" | "silver" | "bronze";

/**
 * Puzzles that are harder than their outline suggests. The par heuristic counts outline
 * corners, but a few simple-looking shapes are classically tricky. Retune from
 * `npm run analytics` (average solve time per puzzle) once there's data.
 */
const PAR_OVERRIDE: Record<string, number> = {
  p01: 120_000, // Square: famously hard for 6 corners
  p02: 120_000, // Triangle
};

/** Par in ms: 30 s plus 6 s per outline corner (Trapezoid ≈ 1:00, Jumper ≈ 2:36). */
export function par(puzzle: Pick<Puzzle, "id" | "polygons">): number {
  const corners = puzzle.polygons.reduce((n, loop) => n + loop.length, 0);
  return PAR_OVERRIDE[puzzle.id] ?? 30_000 + 6_000 * corners;
}

/** Gold at or under par, silver within twice par, bronze for any slower solve. */
export function medal(bestMs: number, puzzle: Pick<Puzzle, "id" | "polygons">): Medal {
  const p = par(puzzle);
  return bestMs <= p ? "gold" : bestMs <= 2 * p ? "silver" : "bronze";
}

export const MEDAL_NAME: Record<Medal, string> = { gold: "Gold", silver: "Silver", bronze: "Bronze" };
