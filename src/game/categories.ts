// A puzzle has one home category and may be listed under more (`also`), e.g. the Square is a
// Shape and one of the convex shapes under Math. It keeps one id, so progress is shared.

export interface CategoryRef {
  category: string;
  also?: string[];
}

export const inCategory = (p: CategoryRef, category: string): boolean =>
  p.category === category || !!p.also?.includes(category);

/** Categories shown first in the picker, in this order. */
const FIRST = ["Math"];

/** Every category: `FIRST`, then home categories in order of first appearance, then any only reached via `also`. */
export const categoriesOf = (puzzles: CategoryRef[]): string[] => {
  const all = new Set([...puzzles.map((p) => p.category), ...puzzles.flatMap((p) => p.also ?? [])]);
  return [...new Set([...FIRST.filter((c) => all.has(c)), ...all])];
};
