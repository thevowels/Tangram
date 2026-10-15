// Gameplay report from the anonymous daily counters in D1 (table daily_events).
//
//   npm run analytics                 # production database, last 30 days
//   npm run analytics -- --days 7
//   npm run analytics -- --local      # the local dev database
//
// Uses your wrangler login, like the other wrangler commands.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const days = Number(args[args.indexOf("--days") + 1]) || 30;
const where = args.includes("--local") ? "--local" : "--remote";
const since = new Date(Date.now() - (days - 1) * 86_400_000).toISOString().slice(0, 10);

const names: Record<string, string> = Object.fromEntries(
  (JSON.parse(readFileSync(new URL("../src/data/puzzles.json", import.meta.url), "utf8")) as { id: string; name: string }[]).map(
    (p) => [p.id, p.name],
  ),
);

type Row = { day: string; event: string; puzzle_id: string; count: number; ms_sum: number; pct_sum: number };

function query(sql: string): Row[] {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "DB", where, "--json", "--command", sql], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  });
  return (JSON.parse(out) as { results: Row[] }[])[0].results;
}

const rows = query(`SELECT * FROM daily_events WHERE day >= '${since}'`);

const time = (ms: number) => {
  const s = Math.round(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};
const sum = (event: string, field: "count" | "ms_sum" | "pct_sum" = "count", puzzle?: string) =>
  rows.filter((r) => r.event === event && (puzzle === undefined || r.puzzle_id === puzzle)).reduce((t, r) => t + r[field], 0);

console.log(`\nTangram gameplay since ${since} (${days} days, ${where.slice(2)} database)\n`);
console.table({
  "puzzles started": sum("start"),
  "puzzles solved": sum("solve"),
  "puzzles abandoned": sum("quit"),
  "free play opened": sum("free_open"),
  "designs saved": sum("design_save"),
  "pictures exported": sum("export"),
});

const perPuzzle = [...new Set(rows.filter((r) => r.puzzle_id && r.event === "start").map((r) => r.puzzle_id))].map((id) => {
  const starts = sum("start", "count", id);
  const solves = sum("solve", "count", id);
  const quits = sum("quit", "count", id);
  return {
    puzzle: `${id} ${names[id] ?? "?"}`,
    starts,
    solves,
    "solve rate": starts ? `${Math.round((solves / starts) * 100)}%` : "–",
    "avg solve": solves ? time(sum("solve", "ms_sum", id) / solves) : "–",
    quits,
    "quit after": quits ? time(sum("quit", "ms_sum", id) / quits) : "–",
    "quit at match": quits ? `${Math.round(sum("quit", "pct_sum", id) / quits)}%` : "–",
    rate: starts ? solves / starts : 0,
  };
});

if (perPuzzle.length) {
  console.log("\nPer puzzle, hardest first (lowest solve rate):");
  console.table(perPuzzle.sort((a, b) => a.rate - b.rate || b.starts - a.starts).map(({ rate: _, ...r }) => r));
}

const byDay = [...new Set(rows.map((r) => r.day))].sort();
if (byDay.length) {
  console.log("\nPer day:");
  console.table(
    byDay.map((day) => {
      const on = (event: string) => rows.filter((r) => r.day === day && r.event === event).reduce((t, r) => t + r.count, 0);
      return { day, started: on("start"), solved: on("solve"), abandoned: on("quit"), "free play": on("free_open") };
    }),
  );
}
