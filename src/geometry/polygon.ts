export type Vec = [number, number];
export type Poly = Vec[];

export const EPS = 1e-3;

export const add = (a: Vec, b: Vec): Vec => [a[0] + b[0], a[1] + b[1]];
export const sub = (a: Vec, b: Vec): Vec => [a[0] - b[0], a[1] - b[1]];
export const scale = (a: Vec, k: number): Vec => [a[0] * k, a[1] * k];
export const dot = (a: Vec, b: Vec) => a[0] * b[0] + a[1] * b[1];
export const len = (a: Vec) => Math.hypot(a[0], a[1]);

export function area(poly: Poly): number {
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function centroid(poly: Poly): Vec {
  let cx = 0;
  let cy = 0;
  let a = 0;
  for (let i = 0; i < poly.length; i++) {
    const [x1, y1] = poly[i];
    const [x2, y2] = poly[(i + 1) % poly.length];
    const cross = x1 * y2 - x2 * y1;
    a += cross;
    cx += (x1 + x2) * cross;
    cy += (y1 + y2) * cross;
  }
  return [cx / (3 * a), cy / (3 * a)];
}

export function bounds(polys: Poly[]) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of polys) {
    for (const [x, y] of p) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  }
  return { minX, minY, maxX, maxY };
}

function project(poly: Poly, axis: Vec): [number, number] {
  let min = Infinity;
  let max = -Infinity;
  for (const p of poly) {
    const d = dot(p, axis);
    if (d < min) min = d;
    if (d > max) max = d;
  }
  return [min, max];
}

/**
 * Separating Axis Theorem for convex polygons. Returns the minimum translation vector
 * that moves `b` out of `a`, or null when they don't overlap (touching counts as apart).
 */
export function mtv(a: Poly, b: Poly): Vec | null {
  let best = Infinity;
  let bestAxis: Vec = [0, 0];
  for (const poly of [a, b]) {
    for (let i = 0; i < poly.length; i++) {
      const e = sub(poly[(i + 1) % poly.length], poly[i]);
      const l = len(e);
      if (l < 1e-9) continue;
      const axis: Vec = [-e[1] / l, e[0] / l];
      const [minA, maxA] = project(a, axis);
      const [minB, maxB] = project(b, axis);
      const overlap = Math.min(maxA, maxB) - Math.max(minA, minB);
      if (overlap <= EPS) return null;
      if (overlap < best) {
        best = overlap;
        // point the axis from a toward b
        const dir = (minB + maxB) / 2 - (minA + maxA) / 2 >= 0 ? 1 : -1;
        bestAxis = scale(axis, dir);
      }
    }
  }
  return scale(bestAxis, best);
}

export const overlaps = (a: Poly, b: Poly) => mtv(a, b) !== null;

/** Even-odd point-in-polygon test over a set of loops. */
export function pointInLoops(x: number, y: number, loops: Poly[]): boolean {
  let inside = false;
  for (const loop of loops) {
    for (let i = 0, j = loop.length - 1; i < loop.length; j = i++) {
      const [xi, yi] = loop[i];
      const [xj, yj] = loop[j];
      if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
  }
  return inside;
}

/** Closest point on segment ab to p. */
export function closestOnSegment(p: Vec, a: Vec, b: Vec): Vec {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  if (l2 < 1e-12) return a;
  const t = Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  return add(a, scale(ab, t));
}

export const toPath = (loops: Poly[]) =>
  loops.map((l) => "M" + l.map(([x, y]) => `${x.toFixed(4)},${y.toFixed(4)}`).join("L") + "Z").join("");

/** Smallest distance between the outlines of two polygons (0 when they touch). */
export function polyDistance(a: Poly, b: Poly): number {
  let d = Infinity;
  for (const [pts, poly] of [[a, b], [b, a]] as const) {
    for (const v of pts) {
      for (let i = 0; i < poly.length; i++) {
        const c = closestOnSegment(v, poly[i], poly[(i + 1) % poly.length]);
        d = Math.min(d, Math.hypot(c[0] - v[0], c[1] - v[1]));
      }
    }
  }
  return d;
}

/**
 * Stretches where an edge of `a` lies flush against an edge of `b`: parallel, within `tol`
 * of each other, overlapping by more than `minLen`. Corner-to-corner touches don't count.
 */
export function sharedEdges(a: Poly, b: Poly, tol = 0.02, minLen = 0.1): [Vec, Vec][] {
  const out: [Vec, Vec][] = [];
  for (let i = 0; i < a.length; i++) {
    const p1 = a[i];
    const d = sub(a[(i + 1) % a.length], p1);
    const L = len(d);
    if (L < 1e-9) continue;
    const u: Vec = [d[0] / L, d[1] / L];
    const n: Vec = [-u[1], u[0]];
    for (let j = 0; j < b.length; j++) {
      const q1 = b[j];
      const q2 = b[(j + 1) % b.length];
      const e = sub(q2, q1);
      const el = len(e);
      if (el < 1e-9 || Math.abs(u[0] * e[1] - u[1] * e[0]) / el > 1e-3) continue; // not parallel
      if (Math.abs(dot(sub(q1, p1), n)) > tol) continue; // not on the same line
      const t1 = dot(sub(q1, p1), u);
      const t2 = dot(sub(q2, p1), u);
      const lo = Math.max(0, Math.min(t1, t2));
      const hi = Math.min(L, Math.max(t1, t2));
      if (hi - lo > minLen) out.push([add(p1, scale(u, lo)), add(p1, scale(u, hi))]);
    }
  }
  return out;
}

/** Area-weighted centre of several (non-overlapping) polygons. */
export function groupCentroid(polys: Poly[]): Vec {
  let ax = 0;
  let ay = 0;
  let total = 0;
  for (const p of polys) {
    const a = Math.abs(area(p));
    const [cx, cy] = centroid(p);
    ax += cx * a;
    ay += cy * a;
    total += a;
  }
  return [ax / total, ay / total];
}
