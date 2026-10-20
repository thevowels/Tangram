/**
 * The puzzle "Next puzzle" opens: a random one the player hasn't solved yet, never the current
 * one. Once everything is solved, any other puzzle.
 */
export function randomNext<T extends { id: string }>(
  puzzles: T[],
  currentId: string,
  solved: Record<string, unknown>,
  random: () => number = Math.random,
): T {
  const others = puzzles.filter((p) => p.id !== currentId);
  if (!others.length) return puzzles[0];
  const unsolved = others.filter((p) => !(p.id in solved));
  const pool = unsolved.length ? unsolved : others;
  return pool[Math.floor(random() * pool.length)];
}
