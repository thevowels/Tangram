import {
  LIMITS,
  formatCode,
  generateCode,
  mergePayload,
  normalizeCode,
  validateEvent,
  validatePayload,
  type GameEvent,
  type SyncDesign,
  type SyncPayload,
} from "../shared/progress";

interface Env {
  DB: D1Database;
  CREATE_LIMIT: RateLimit;
  API_LIMIT: RateLimit;
}

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "cache-control": "no-store" } });
const error = (status: number, message: string) => json({ error: message }, status);

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const clientIp = (req: Request) => req.headers.get("cf-connecting-ip") ?? "local";

/** The player whose sync code is in `Authorization: Bearer <code>`, or null. */
async function authenticate(req: Request, env: Env): Promise<string | null> {
  const code = normalizeCode(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  if (!code) return null;
  const row = await env.DB.prepare("SELECT id FROM players WHERE code_hash = ?")
    .bind(await sha256(code))
    .first<{ id: string }>();
  return row?.id ?? null;
}

async function readPayload(env: Env, player: string): Promise<SyncPayload> {
  const [solves, designs, counters, who] = await env.DB.batch([
    env.DB.prepare("SELECT puzzle_id, best_ms, first_on FROM solves WHERE player_id = ?").bind(player),
    env.DB.prepare("SELECT name, data, saved_at FROM designs WHERE player_id = ? ORDER BY saved_at DESC").bind(player),
    env.DB.prepare("SELECT designs_saved, exports FROM counters WHERE player_id = ?").bind(player),
    env.DB.prepare("SELECT nickname, nickname_at FROM players WHERE id = ?").bind(player),
  ]);
  const n = who.results[0] as { nickname: string | null; nickname_at: number | null } | undefined;
  const s = solves.results as {
    puzzle_id: string;
    best_ms: number;
    first_on: string;
  }[];
  const d = designs.results as {
    name: string;
    data: string;
    saved_at: number;
  }[];
  const c = (counters.results[0] ?? { designs_saved: 0, exports: 0 }) as {
    designs_saved: number;
    exports: number;
  };
  return {
    progress: {
      v: 2,
      solved: Object.fromEntries(s.map((r) => [r.puzzle_id, { best: r.best_ms, first: r.first_on }])),
      designsSaved: c.designs_saved,
      exports: c.exports,
    },
    designs: d.map((r) => ({
      name: r.name,
      savedAt: r.saved_at,
      data: JSON.parse(r.data),
    })),
    ...(n?.nickname ? { nickname: { name: n.nickname, at: n.nickname_at ?? 0 } } : {}),
  };
}

/** Merge an upload into the stored copy, writing only what changed, and return the merged result. */
async function putPayload(env: Env, player: string, incoming: SyncPayload): Promise<SyncPayload> {
  const stored = await readPayload(env, player);
  const merged = mergePayload(stored, incoming);
  const db = env.DB;
  const writes: D1PreparedStatement[] = [];

  for (const [id, r] of Object.entries(merged.progress.solved)) {
    const was = stored.progress.solved[id];
    if (was && was.best === r.best && was.first === r.first) continue;
    // min() in SQL as well, so two devices syncing at once still converge
    writes.push(
      db
        .prepare(
          `INSERT INTO solves (player_id, puzzle_id, best_ms, first_on) VALUES (?, ?, ?, ?)
           ON CONFLICT (player_id, puzzle_id) DO UPDATE SET
             best_ms = min(best_ms, excluded.best_ms), first_on = min(first_on, excluded.first_on)`,
        )
        .bind(player, id, r.best, r.first),
    );
  }

  const storedDesigns = new Map(stored.designs.map((d) => [d.name, d.savedAt]));
  const keep: SyncDesign[] = merged.designs.slice(0, LIMITS.maxDesigns);
  for (const d of keep) {
    if (storedDesigns.get(d.name) === d.savedAt) continue;
    writes.push(
      db
        .prepare(
          `INSERT INTO designs (player_id, name, data, saved_at) VALUES (?, ?, ?, ?)
           ON CONFLICT (player_id, name) DO UPDATE SET data = excluded.data, saved_at = excluded.saved_at
           WHERE excluded.saved_at > designs.saved_at`,
        )
        .bind(player, d.name, JSON.stringify(d.data), d.savedAt),
    );
  }
  for (const d of merged.designs.slice(LIMITS.maxDesigns)) {
    if (storedDesigns.has(d.name))
      writes.push(db.prepare("DELETE FROM designs WHERE player_id = ? AND name = ?").bind(player, d.name));
  }

  const { designsSaved, exports } = merged.progress;
  if (designsSaved !== stored.progress.designsSaved || exports !== stored.progress.exports) {
    writes.push(
      db
        .prepare(
          `INSERT INTO counters (player_id, designs_saved, exports) VALUES (?, ?, ?)
           ON CONFLICT (player_id) DO UPDATE SET
             designs_saved = max(designs_saved, excluded.designs_saved), exports = max(exports, excluded.exports)`,
        )
        .bind(player, designsSaved, exports),
    );
  }

  if (merged.nickname && merged.nickname.at !== stored.nickname?.at) {
    writes.push(
      db
        .prepare("UPDATE players SET nickname = ?, nickname_at = ? WHERE id = ? AND coalesce(nickname_at, -1) < ?")
        .bind(merged.nickname.name, merged.nickname.at, player, merged.nickname.at),
    );
  }

  if (writes.length) {
    writes.push(db.prepare("UPDATE players SET updated_at = ? WHERE id = ?").bind(Date.now(), player));
    await db.batch(writes);
  }
  return { ...merged, designs: keep };
}

async function createPlayer(env: Env): Promise<string> {
  const code = generateCode((n) => crypto.getRandomValues(new Uint8Array(n)));
  const now = Date.now();
  await env.DB.prepare("INSERT INTO players (id, code_hash, created_at, updated_at) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), await sha256(code), now, now)
    .run();
  return code;
}

async function deletePlayer(env: Env, player: string) {
  await env.DB.batch(
    ["solves", "designs", "counters"]
      .map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE player_id = ?`).bind(player))
      .concat(env.DB.prepare("DELETE FROM players WHERE id = ?").bind(player)),
  );
}

/** Solvers shown per puzzle only from this many, so no one's own time can be read off a card. */
const MIN_SOLVERS = 5;
/** Times above this count as this in the average, so one forgotten tab doesn't skew it. */
const AVG_CAP_MS = 10 * 60_000;
const STATS_TTL = 300;

/** Per-puzzle solver counts and average best times, cached for a few minutes at the edge. */
async function stats(env: Env): Promise<Response> {
  const cache = caches.default;
  const key = new Request("https://stats.cache/api/stats");
  const hit = await cache.match(key);
  if (hit) return hit;
  const { results } = await env.DB.prepare(
    `SELECT puzzle_id AS id, count(*) AS solvers, avg(min(best_ms, ?)) AS avg_ms
     FROM solves GROUP BY puzzle_id HAVING count(*) >= ?`,
  )
    .bind(AVG_CAP_MS, MIN_SOLVERS)
    .all<{ id: string; solvers: number; avg_ms: number }>();
  const body = Object.fromEntries(results.map((r) => [r.id, { solvers: r.solvers, avgMs: Math.round(r.avg_ms) }]));
  const res = Response.json(body, { headers: { "cache-control": `public, max-age=${STATS_TTL}` } });
  await cache.put(key, res.clone());
  return res;
}

/** One anonymous event: bumps today's counter (UTC) for that event and puzzle. */
async function recordEvent(env: Env, ev: GameEvent) {
  await env.DB.prepare(
    `INSERT INTO daily_events (day, event, puzzle_id, count, ms_sum, pct_sum) VALUES (?, ?, ?, 1, ?, ?)
     ON CONFLICT (day, event, puzzle_id) DO UPDATE SET
       count = count + 1, ms_sum = ms_sum + excluded.ms_sum, pct_sum = pct_sum + excluded.pct_sum`,
  )
    .bind(new Date().toISOString().slice(0, 10), ev.e, ev.p ?? "", ev.ms ?? 0, ev.pct ?? 0)
    .run();
}

async function readBody(req: Request): Promise<unknown> {
  const text = await req.text();
  if (text.length > LIMITS.maxBodyBytes) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

async function api(req: Request, env: Env, path: string): Promise<Response> {
  if (path === "/api/health") return json({ ok: true });
  if (path === "/api/stats" && req.method === "GET") return stats(env);

  const ip = clientIp(req);
  if (!(await env.API_LIMIT.limit({ key: ip })).success) return error(429, "Too many requests");

  if (path === "/api/event" && req.method === "POST") {
    const event = validateEvent(await readBody(req));
    if (!event) return error(400, "Malformed event");
    await recordEvent(env, event);
    return new Response(null, { status: 204 });
  }

  if (path === "/api/player" && req.method === "POST") {
    if (!(await env.CREATE_LIMIT.limit({ key: ip })).success) return error(429, "Too many requests");
    return json({ code: formatCode(await createPlayer(env)) }, 201);
  }

  if (path === "/api/player" || path === "/api/progress") {
    const player = await authenticate(req, env);
    if (!player) return error(401, "Unknown sync code");

    if (path === "/api/player" && req.method === "DELETE") {
      await deletePlayer(env, player);
      return json({ deleted: true });
    }
    if (path === "/api/progress" && req.method === "GET") return json(await readPayload(env, player));
    if (path === "/api/progress" && req.method === "PUT") {
      if (Number(req.headers.get("content-length") ?? 0) > LIMITS.maxBodyBytes) return error(413, "Too large");
      const payload = validatePayload(await readBody(req));
      if (!payload) return error(400, "Malformed progress");
      return json(await putPayload(env, player, payload));
    }
    return error(405, "Method not allowed");
  }
  return error(404, "Not found");
}

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/")) {
      try {
        return await api(request, env, url.pathname);
      } catch (e) {
        console.error(e);
        return error(500, "Server error");
      }
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
