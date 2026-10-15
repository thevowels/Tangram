// Shared by the app (src/) and the Worker (worker/): the progress model, how two copies merge,
// validation of anything that crosses the network, and the sync-code format.

export interface SolveRecord {
  /** best time in ms */
  best: number;
  /** local date of the first solve, YYYY-MM-DD */
  first: string;
}

export interface Progress {
  v: 2;
  solved: Record<string, SolveRecord>;
  designsSaved: number;
  exports: number;
}

/**
 * A free-play design as synced: the app's Design object is carried as opaque JSON.
 * `data: null` marks a deletion, so a design deleted on one device doesn't come back from another.
 */
export interface SyncDesign {
  name: string;
  savedAt: number;
  data: unknown;
}

export interface SyncPayload {
  progress: Progress;
  designs: SyncDesign[];
}

export const emptyProgress = (): Progress => ({
  v: 2,
  solved: {},
  designsSaved: 0,
  exports: 0,
});

// ---- merging (used on both sides, so any two devices converge to the same result) ----

/** Best time wins, earliest first day wins, counters take the larger value. */
export function mergeProgress(a: Progress, b: Progress): Progress {
  const solved: Record<string, SolveRecord> = { ...a.solved };
  for (const [id, r] of Object.entries(b.solved)) {
    const mine = solved[id];
    solved[id] = mine
      ? {
          best: Math.min(mine.best, r.best),
          first: mine.first < r.first ? mine.first : r.first,
        }
      : { ...r };
  }
  return {
    v: 2,
    solved,
    designsSaved: Math.max(a.designsSaved, b.designsSaved),
    exports: Math.max(a.exports, b.exports),
  };
}

/** Designs are keyed by name; the most recently saved version wins. */
export function mergeDesigns(a: SyncDesign[], b: SyncDesign[]): SyncDesign[] {
  const byName = new Map<string, SyncDesign>();
  for (const d of [...a, ...b]) {
    const cur = byName.get(d.name);
    if (!cur || d.savedAt > cur.savedAt) byName.set(d.name, d);
  }
  return [...byName.values()].sort((x, y) => y.savedAt - x.savedAt);
}

export const mergePayload = (a: SyncPayload, b: SyncPayload): SyncPayload => ({
  progress: mergeProgress(a.progress, b.progress),
  designs: mergeDesigns(a.designs, b.designs),
});

// ---- validation (never trust what comes over the wire) ----

export const LIMITS = {
  maxPuzzles: 500,
  /** designs plus deletion markers */
  maxDesigns: 100,
  maxDesignBytes: 8_000,
  maxNameLength: 60,
  maxCounter: 1_000_000,
  /** a day: slower solves are stored as a day */
  maxBestMs: 86_400_000,
  maxBodyBytes: 1_000_000,
};

const PUZZLE_ID = /^p\d{2,3}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const isInt = (n: unknown, max = Number.MAX_SAFE_INTEGER): n is number =>
  typeof n === "number" && Number.isInteger(n) && n >= 0 && n <= max;
const isObject = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);

/**
 * Returns a clean payload, or null if its overall shape is wrong. Individual entries that don't
 * fit (an odd puzzle id, an oversized design) are dropped rather than failing the whole sync.
 */
export function validatePayload(x: unknown): SyncPayload | null {
  if (!isObject(x) || !isObject(x.progress) || !Array.isArray(x.designs)) return null;
  const p = x.progress;
  if (p.v !== 2 || !isObject(p.solved)) return null;
  const solved: Record<string, SolveRecord> = {};
  for (const [id, r] of Object.entries(p.solved).slice(0, LIMITS.maxPuzzles)) {
    if (!PUZZLE_ID.test(id) || !isObject(r)) continue;
    const { best, first } = r;
    if (typeof best !== "number" || !(best > 0) || typeof first !== "string" || !DAY.test(first)) continue;
    solved[id] = { best: Math.min(Math.round(best), LIMITS.maxBestMs), first };
  }
  const designs: SyncDesign[] = [];
  for (const d of x.designs.slice(0, LIMITS.maxDesigns)) {
    if (!isObject(d)) continue;
    const { name, savedAt, data } = d;
    if (typeof name !== "string" || !name.trim() || name.length > LIMITS.maxNameLength || !isInt(savedAt)) continue;
    if (JSON.stringify(data ?? null).length > LIMITS.maxDesignBytes) continue;
    designs.push({ name, savedAt, data: data ?? null });
  }
  const counter = (n: unknown) => (isInt(n) ? Math.min(n, LIMITS.maxCounter) : 0);
  return {
    progress: {
      v: 2,
      solved,
      designsSaved: counter(p.designsSaved),
      exports: counter(p.exports),
    },
    designs,
  };
}

// ---- sync codes: TAN-XXXXX-XXXXX ----

/** 31 characters with no look-alikes (no 0/O, 1/I/L). */
export const CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const CODE_LENGTH = 10;

/** Display form of a normalised code. */
export const formatCode = (code: string) => `TAN-${code.slice(0, 5)}-${code.slice(5)}`;

/**
 * Accept what people type or paste ("tan-7k4q2-92xmq", spaces, missing dashes) and return the
 * normalised 10-character code, or null if it can't be a valid code.
 */
export function normalizeCode(input: string): string | null {
  let s = input.toUpperCase().replace(/[\s-]/g, "");
  if (s.length === CODE_LENGTH + 3 && s.startsWith("TAN")) s = s.slice(3);
  if (s.length !== CODE_LENGTH) return null;
  for (const ch of s) if (!CODE_ALPHABET.includes(ch)) return null;
  return s;
}

/** A fresh random code from a cryptographic source (browser or Worker). */
export function generateCode(random: (n: number) => Uint8Array): string {
  let out = "";
  // rejection sampling keeps every character equally likely
  while (out.length < CODE_LENGTH) {
    for (const b of random(16)) {
      if (b < 248 && out.length < CODE_LENGTH) out += CODE_ALPHABET[b % 31];
    }
  }
  return out;
}
