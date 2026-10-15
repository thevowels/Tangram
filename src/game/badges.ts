import type { Progress } from "../storage";

interface PuzzleRef {
  id: string;
  category: string;
}

export interface Badge {
  id: string;
  emoji: string;
  title: string;
  /** How to earn it (shown while locked); never names a specific puzzle. */
  hint: string;
  earned: boolean;
  /** Progress towards it, e.g. [7, 18]. */
  have: number;
  need: number;
}

type Rule = Omit<Badge, "earned" | "have" | "need"> & {
  count(p: Progress, puzzles: PuzzleRef[]): [have: number, need: number];
};

const solvedIn = (p: Progress, puzzles: PuzzleRef[], category: string): [number, number] => {
  const inCat = puzzles.filter((q) => q.category === category);
  return [inCat.filter((q) => q.id in p.solved).length, inCat.length];
};
const times = (p: Progress) => Object.values(p.solved).map((r) => r.best);
const days = (p: Progress) => new Set(Object.values(p.solved).map((r) => r.first)).size;

const RULES: Rule[] = [
  { id: "first", emoji: "👣", title: "First Steps", hint: "Solve any puzzle", count: (p) => [Math.min(1, Object.keys(p.solved).length), 1] },
  { id: "shapes", emoji: "🔷", title: "Shape Shifter", hint: "Solve every shape", count: (p, q) => solvedIn(p, q, "Shapes") },
  { id: "things", emoji: "🛠️", title: "Handy", hint: "Solve every thing", count: (p, q) => solvedIn(p, q, "Things") },
  { id: "animals", emoji: "🦊", title: "Zookeeper", hint: "Solve every animal", count: (p, q) => solvedIn(p, q, "Animals") },
  { id: "people", emoji: "🧑", title: "People Person", hint: "Solve every person", count: (p, q) => solvedIn(p, q, "People") },
  {
    id: "all",
    emoji: "👑",
    title: "Grand Master",
    hint: "Solve every puzzle",
    count: (p, q) => [q.filter((x) => x.id in p.solved).length, q.length],
  },
  { id: "quick", emoji: "⚡", title: "Quick Hands", hint: "Solve a puzzle in under 30 seconds", count: (p) => [Math.min(1, times(p).filter((t) => t < 30_000).length), 1] },
  { id: "speed", emoji: "🏎️", title: "Speedster", hint: "Solve 10 puzzles in under a minute each", count: (p) => [Math.min(10, times(p).filter((t) => t < 60_000).length), 10] },
  { id: "regular", emoji: "📅", title: "Regular", hint: "Solve puzzles on 3 different days", count: (p) => [Math.min(3, days(p)), 3] },
  { id: "devoted", emoji: "🔥", title: "Devoted", hint: "Solve puzzles on 10 different days", count: (p) => [Math.min(10, days(p)), 10] },
  { id: "designer", emoji: "🎨", title: "Designer", hint: "Save a design in free play", count: (p) => [Math.min(1, p.designsSaved), 1] },
  { id: "showoff", emoji: "📸", title: "Show-off", hint: "Export a picture", count: (p) => [Math.min(1, p.exports), 1] },
];

/** Every badge with whether it's earned and how far along the player is. */
export function computeBadges(p: Progress, puzzles: PuzzleRef[]): Badge[] {
  return RULES.map(({ count, ...b }) => {
    const [have, need] = count(p, puzzles);
    return { ...b, have, need, earned: need > 0 && have >= need };
  });
}

/** Badges earned in `after` that weren't in `before` (for the unlock toast). */
export function newlyEarned(before: Progress, after: Progress, puzzles: PuzzleRef[]): Badge[] {
  const had = new Set(computeBadges(before, puzzles).filter((b) => b.earned).map((b) => b.id));
  return computeBadges(after, puzzles).filter((b) => b.earned && !had.has(b.id));
}
