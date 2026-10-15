import { describe, expect, it } from "vitest";
import { NAME_PARTS, randomNickname } from "./game/names";
import { formatCount } from "./components/PuzzlePicker";
import {
  cleanNickname,
  mergeNickname,
  CODE_ALPHABET,
  CODE_LENGTH,
  emptyProgress,
  formatCode,
  generateCode,
  LIMITS,
  mergeDesigns,
  mergePayload,
  mergeProgress,
  normalizeCode,
  validatePayload,
  type Progress,
  type SyncPayload,
} from "../shared/progress";

const a: Progress = {
  v: 2,
  solved: {
    p01: { best: 40_000, first: "2026-10-10" },
    p02: { best: 9_000, first: "2026-10-12" },
  },
  designsSaved: 3,
  exports: 1,
};
const b: Progress = {
  v: 2,
  solved: {
    p01: { best: 30_000, first: "2026-10-11" },
    p03: { best: 70_000, first: "2026-10-14" },
  },
  designsSaved: 1,
  exports: 4,
};

describe("progress merge", () => {
  it("keeps the best time, the earliest day and the larger counters", () => {
    expect(mergeProgress(a, b)).toEqual({
      v: 2,
      solved: {
        p01: { best: 30_000, first: "2026-10-10" },
        p02: { best: 9_000, first: "2026-10-12" },
        p03: { best: 70_000, first: "2026-10-14" },
      },
      designsSaved: 3,
      exports: 4,
    });
  });

  it("is commutative and idempotent", () => {
    expect(mergeProgress(a, b)).toEqual(mergeProgress(b, a));
    const ab = mergeProgress(a, b);
    expect(mergeProgress(ab, ab)).toEqual(ab);
    expect(mergeProgress(ab, a)).toEqual(ab);
    expect(mergeProgress(emptyProgress(), a)).toEqual(a);
  });

  it("lets the latest save of a design win, deletions included", () => {
    const merged = mergeDesigns(
      [
        { name: "Cat", savedAt: 100, data: { v: 1 } },
        { name: "Dog", savedAt: 300, data: { v: 1 } },
      ],
      [
        { name: "Cat", savedAt: 200, data: null },
        { name: "Dog", savedAt: 250, data: null },
        { name: "Owl", savedAt: 50, data: { v: 2 } },
      ],
    );
    expect(merged).toEqual([
      { name: "Dog", savedAt: 300, data: { v: 1 } },
      { name: "Cat", savedAt: 200, data: null },
      { name: "Owl", savedAt: 50, data: { v: 2 } },
    ]);
  });
});

describe("payload validation", () => {
  const good: SyncPayload = {
    progress: a,
    designs: [{ name: "Cat", savedAt: 5, data: { pieces: [] } }],
  };

  it("accepts a well-formed payload unchanged", () => {
    expect(validatePayload(JSON.parse(JSON.stringify(good)))).toEqual(good);
    expect(mergePayload(good, good)).toEqual(good);
  });

  it("rejects the wrong overall shape", () => {
    for (const bad of [null, 1, "x", [], {}, { progress: a }, { progress: { ...a, v: 1 }, designs: [] }]) {
      expect(validatePayload(bad)).toBeNull();
    }
  });

  it("drops entries that don't fit instead of failing the sync", () => {
    const v = validatePayload({
      progress: {
        v: 2,
        solved: {
          p01: { best: 1000.4, first: "2026-10-10" },
          "../x": { best: 1, first: "2026-10-10" },
          p02: { best: -5, first: "2026-10-10" },
          p03: { best: 5, first: "yesterday" },
          p04: { best: 9e12, first: "2026-10-10" },
        },
        designsSaved: -1,
        exports: "7",
      },
      designs: [
        { name: "", savedAt: 1, data: {} },
        { name: "x".repeat(LIMITS.maxNameLength + 1), savedAt: 1, data: {} },
        { name: "Big", savedAt: 1, data: "y".repeat(LIMITS.maxDesignBytes) },
        { name: "Ok", savedAt: 2, data: { a: 1 } },
        { name: "Gone", savedAt: 3 },
      ],
    });
    expect(v).toEqual({
      progress: {
        v: 2,
        solved: {
          p01: { best: 1000, first: "2026-10-10" },
          p04: { best: LIMITS.maxBestMs, first: "2026-10-10" },
        },
        designsSaved: 0,
        exports: 0,
      },
      designs: [
        { name: "Ok", savedAt: 2, data: { a: 1 } },
        { name: "Gone", savedAt: 3, data: null },
      ],
    });
  });
});

describe("sync codes", () => {
  it("generates codes from the unambiguous alphabet", () => {
    let seed = 7;
    const random = (n: number) => Uint8Array.from({ length: n }, () => (seed = (seed * 1103515245 + 12345) % 256));
    const code = generateCode(random);
    expect(code).toHaveLength(CODE_LENGTH);
    for (const ch of code) expect(CODE_ALPHABET).toContain(ch);
    expect(CODE_ALPHABET).not.toMatch(/[01ILO]/);
    const real = generateCode((n) => crypto.getRandomValues(new Uint8Array(n)));
    expect(normalizeCode(formatCode(real))).toBe(real);
  });

  it("accepts what people type or paste", () => {
    expect(formatCode("7K4Q292XMQ")).toBe("TAN-7K4Q2-92XMQ");
    expect(normalizeCode("TAN-7K4Q2-92XMQ")).toBe("7K4Q292XMQ");
    expect(normalizeCode(" tan 7k4q2 92xmq ")).toBe("7K4Q292XMQ");
    expect(normalizeCode("7k4q292xmq")).toBe("7K4Q292XMQ");
    expect(normalizeCode("TAN-7K4Q2-92XM")).toBeNull();
    expect(normalizeCode("TAN-0K4Q2-92XMQ")).toBeNull();
    expect(normalizeCode("")).toBeNull();
    // a code that itself starts with TAN, typed without the prefix
    expect(normalizeCode("tanxy23456")).toBe("TANXY23456");
    expect(normalizeCode("TAN-TANXY-23456")).toBe("TANXY23456");
  });
});

describe("nicknames", () => {
  it("tidies names and keeps any script", () => {
    expect(cleanNickname("  Aung   Phyo ")).toBe("Aung Phyo");
    expect(cleanNickname("အောင်")).toBe("အောင်");
    expect(cleanNickname("Zoë_the-Fox")).toBe("Zoë_the-Fox");
    expect(cleanNickname("a\u200bb\u0007c")).toBe("abc");
  });

  it("refuses empty, too long, odd symbols and blocked words", () => {
    for (const bad of ["", "   ", "...", "x".repeat(21), "<script>", "Admin", "S h i t head", "the.Moderator"]) {
      expect(cleanNickname(bad), bad).toBeNull();
    }
    expect(cleanNickname("Grape Fox")).toBe("Grape Fox");
  });

  it("every random name is a valid nickname", () => {
    for (const a of NAME_PARTS.adjectives) for (const n of NAME_PARTS.animals) expect(cleanNickname(`${a} ${n}`)).toBe(`${a} ${n}`);
    expect(randomNickname(() => 0)).toBe(`${NAME_PARTS.adjectives[0]} ${NAME_PARTS.animals[0]}`);
    let i = 0;
    const seq = [0, 0, 0.5, 0.5];
    expect(randomNickname(() => seq[i++], randomNickname(() => 0))).not.toBe(randomNickname(() => 0));
  });

  it("merges: the latest change wins, ties settle the same way on both sides", () => {
    const old = { name: "Old", at: 1 };
    const fresh = { name: "New", at: 2 };
    expect(mergeNickname(old, fresh)).toEqual(fresh);
    expect(mergeNickname(fresh, old)).toEqual(fresh);
    expect(mergeNickname(undefined, old)).toEqual(old);
    const a = { name: "Swift Fox", at: 0 };
    const b = { name: "Brave Owl", at: 0 };
    expect(mergeNickname(a, b)).toEqual(mergeNickname(b, a));
    expect(mergeNickname(a, { name: "Aung", at: 5 })).toEqual({ name: "Aung", at: 5 });
  });

  it("travels in the payload and is validated there", () => {
    const base = { progress: emptyProgress(), designs: [] };
    expect(validatePayload({ ...base, nickname: { name: " Aung ", at: 3 } })).toEqual({
      ...base,
      nickname: { name: "Aung", at: 3 },
    });
    expect(validatePayload({ ...base, nickname: { name: "admin", at: 3 } })).toEqual(base);
    expect(validatePayload({ ...base, nickname: "Aung" })).toEqual(base);
    expect(mergePayload({ ...base, nickname: { name: "A", at: 1 } }, base).nickname).toEqual({ name: "A", at: 1 });
  });
});

describe("stats formatting", () => {
  it("shortens big counts", () => {
    expect([5, 999, 1000, 1234, 9950, 12_345].map(formatCount)).toEqual(["5", "999", "1k", "1.2k", "9.9k", "12k"]);
  });
});
