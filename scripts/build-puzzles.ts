// Builds src/data/puzzles.json from the hand-authored figures in scripts/figures.ts.
// Usage: npm run puzzles   (also writes scripts/out/preview.png to eyeball the figures)
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { PIECES, piecePolygon, type PieceState } from "../src/geometry/pieces";
import { area, bounds, centroid, closestOnSegment, mtv, polyDistance, type Poly, type Vec } from "../src/geometry/polygon";
import { FIGURES, type Figure } from "./figures";

const root = join(import.meta.dirname, "..");
const OUT_JSON = join(root, "src/data/puzzles.json");
const OUT_PREVIEW = join(root, "scripts/out/preview.png");

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const key = (poly: Poly) =>
  poly
    .map(([x, y]) => `${r6(x).toFixed(4)},${r6(y).toFixed(4)}`)
    .sort()
    .join(" ");

/** Find the id/rotation/flip that reproduces a piece polygon exactly. */
function matchState(kind: string, pts: Poly, free: Set<string>): PieceState | null {
  const [cx, cy] = centroid(pts);
  const target = key(pts);
  for (const def of PIECES) {
    if (def.kind !== kind || !free.has(def.id)) continue;
    for (const flipped of [false, true]) {
      for (let rot = 0; rot < 360; rot += 45) {
        const s: PieceState = { id: def.id, x: cx, y: cy, rot, flipped };
        if (key(piecePolygon(s)) === target) return s;
      }
    }
  }
  return null;
}

function build(fig: Figure) {
  const errors: string[] = [];
  const free = new Set(PIECES.map((p) => p.id));
  const states: PieceState[] = [];
  for (const piece of fig.pieces) {
    const s = matchState(piece.kind, piece.pts, free);
    if (!s) {
      errors.push(`${piece.kind} ${JSON.stringify(piece.pts.map((p) => p.map(r6)))} is not a valid ${piece.kind}`);
      continue;
    }
    free.delete(s.id);
    states.push(s);
  }
  if (free.size) errors.push(`unused pieces: ${[...free].join(", ")}`);

  const polys = states.map(piecePolygon);
  for (let i = 0; i < polys.length; i++) {
    for (let j = i + 1; j < polys.length; j++) {
      if (mtv(polys[i], polys[j])) errors.push(`${states[i].id} overlaps ${states[j].id}`);
    }
  }
  // every piece should touch the rest of the figure
  const reached = new Set([0]);
  for (let changed = true; changed; ) {
    changed = false;
    for (let i = 0; i < polys.length; i++) {
      if (reached.has(i)) continue;
      if ([...reached].some((j) => polyDistance(polys[i], polys[j]) < 1e-6)) {
        reached.add(i);
        changed = true;
      }
    }
  }
  if (reached.size !== polys.length) errors.push("pieces are not all connected");

  // normalise: centroid of the whole figure at the origin
  let ax = 0;
  let ay = 0;
  for (const p of polys) {
    const [cx, cy] = centroid(p);
    const a = Math.abs(area(p));
    ax += cx * a;
    ay += cy * a;
  }
  ax /= 8;
  ay /= 8;
  const solution = states.map((s) => ({ ...s, x: r6(s.x - ax), y: r6(s.y - ay) }));

  const loops = outline(solution.map(piecePolygon)).map(dropCollinear);
  return { errors, solution, loops };
}

/**
 * Outline of non-overlapping polygons that share edges: weld vertices, split edges where
 * another vertex touches them, cancel segments used in both directions (shared edges), and
 * chain what's left into loops. Robust to √2 rounding, unlike general polygon clipping.
 */
function outline(polys: Poly[]): Poly[] {
  const TOL = 1e-6;
  const pts: Vec[] = [];
  const weld = (p: Vec) => {
    let i = pts.findIndex((q) => Math.hypot(q[0] - p[0], q[1] - p[1]) < TOL);
    if (i < 0) i = pts.push(p) - 1;
    return i;
  };
  const rings = polys.map((p) => (area(p) < 0 ? [...p].reverse() : p).map(weld));

  const segs = new Map<string, number>(); // "a,b" → count of directed segment a→b
  for (const ring of rings) {
    for (let k = 0; k < ring.length; k++) {
      const a = ring[k];
      const b = ring[(k + 1) % ring.length];
      // every welded vertex lying inside segment a→b splits it
      const along = pts
        .map((p, i) => ({ i, t: projectT(pts[a], pts[b], p) }))
        .filter(({ i, t }) => i !== a && i !== b && t > TOL && t < 1 - TOL && onSegment(pts[a], pts[b], pts[i]))
        .sort((u, v) => u.t - v.t)
        .map((u) => u.i);
      const chain = [a, ...along, b];
      for (let c = 0; c + 1 < chain.length; c++) {
        const fwd = `${chain[c]},${chain[c + 1]}`;
        const back = `${chain[c + 1]},${chain[c]}`;
        if (segs.get(back)) segs.set(back, segs.get(back)! - 1);
        else segs.set(fwd, (segs.get(fwd) ?? 0) + 1);
      }
    }
  }
  const out = new Map<number, number[]>();
  for (const [k, n] of segs) {
    if (!n) continue;
    const [a, b] = k.split(",").map(Number);
    if (!out.has(a)) out.set(a, []);
    out.get(a)!.push(b);
  }
  const loops: Poly[] = [];
  for (const start of [...out.keys()]) {
    while (out.get(start)?.length) {
      const loop = [start];
      let cur = out.get(start)!.pop()!;
      while (cur !== start) {
        loop.push(cur);
        cur = out.get(cur)!.pop()!;
      }
      loops.push(loop.map((i) => pts[i]));
    }
  }
  return loops;
}

const projectT = (a: Vec, b: Vec, p: Vec) => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy);
};
const onSegment = (a: Vec, b: Vec, p: Vec) => {
  const c = closestOnSegment(p, a, b);
  return Math.hypot(c[0] - p[0], c[1] - p[1]) < 1e-6;
};

/** Remove vertices that lie on a straight edge (left over from shared piece edges). */
function dropCollinear(ring: Poly): Poly {
  const out: Poly = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[(i - 1 + ring.length) % ring.length];
    const b = ring[i];
    const c = ring[(i + 1) % ring.length];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) > 1e-9) out.push([r6(b[0]), r6(b[1])]);
  }
  return out;
}

const puzzles = [];
let failed = false;
for (const [i, fig] of FIGURES.entries()) {
  const { errors, solution, loops } = build(fig);
  if (errors.length) {
    failed = true;
    console.error(`✗ ${fig.name}:\n  ${errors.join("\n  ")}`);
  } else {
    console.log(`✓ ${fig.name} (${loops.length} loop${loops.length > 1 ? "s" : ""})`);
  }
  puzzles.push({
    id: "p" + String(i + 1).padStart(2, "0"),
    name: fig.name,
    category: fig.category,
    ...(fig.also ? { also: fig.also } : {}),
    polygons: loops,
    solution,
  });
}

if (!failed) writeFileSync(OUT_JSON, JSON.stringify(puzzles) + "\n");

// preview sheet: silhouette on top, the solution below
const CELL = 220;
const COLS = 6;
const rows = Math.ceil(puzzles.length / COLS);
const colors = Object.fromEntries(PIECES.map((p) => [p.id, p.color]));
const cells = puzzles.map((p, i) => {
  const b = bounds(p.polygons);
  const s = (CELL - 50) / Math.max(b.maxX - b.minX, b.maxY - b.minY);
  const ox = (i % COLS) * CELL + CELL / 2 - ((b.minX + b.maxX) / 2) * s;
  const oy = Math.floor(i / COLS) * CELL + CELL / 2 + 8 - ((b.minY + b.maxY) / 2) * s;
  const tx = ([x, y]: Vec) => `${(ox + x * s).toFixed(1)},${(oy + y * s).toFixed(1)}`;
  const pieces = p.solution
    .map((st) => `<polygon points="${piecePolygon(st).map(tx).join(" ")}" fill="${colors[st.id]}" stroke="#fff" stroke-width="1.5"/>`)
    .join("");
  const outline = `<path d="${p.polygons.map((l) => "M" + l.map(tx).join("L") + "Z").join("")}" fill="none" stroke="#000" stroke-width="2.5" fill-rule="evenodd"/>`;
  const label = `<text x="${(i % COLS) * CELL + CELL / 2}" y="${Math.floor(i / COLS) * CELL + 20}" font-size="16" font-family="sans-serif" text-anchor="middle">${p.name}</text>`;
  return pieces + outline + label;
});
mkdirSync(join(root, "scripts/out"), { recursive: true });
await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${COLS * CELL}" height="${rows * CELL}"><rect width="100%" height="100%" fill="#fff"/>${cells.join("")}</svg>`))
  .png()
  .toFile(OUT_PREVIEW);
console.log(failed ? "Not written: fix the errors above." : `Wrote ${puzzles.length} puzzles → ${OUT_JSON}`);
if (failed) process.exitCode = 1;
