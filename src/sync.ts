// Optional cloud sync. localStorage stays the source of truth: the server only ever merges, and
// any failure is silent and simply retried next time. There is no sign-in: a random sync code
// (shown in the Badges sheet) identifies the player; the server stores only its hash.

import {
  formatCode,
  mergePayload,
  normalizeCode,
  validatePayload,
  type SyncDesign,
  type SyncPayload,
} from "../shared/progress";
import {
  loadDeleted,
  loadDesigns,
  loadNickname,
  loadProgress,
  saveDeleted,
  saveDesigns,
  saveNickname,
  saveProgress,
  type Design,
} from "./storage";

const KEY = "tangram.sync";

export interface SyncState {
  /** normalised sync code, once this device has an account */
  code?: string;
  /** the player deleted their online data: don't create a new account until they turn sync back on */
  off?: boolean;
  /** time of the last successful sync */
  last?: number;
}

export function loadSync(): SyncState {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as SyncState;
  } catch {
    return {};
  }
}

function saveSync(s: SyncState) {
  localStorage.setItem(KEY, JSON.stringify(s));
  notify();
}

/** Fired after anything here changes local progress, designs or sync state. */
export const SYNC_EVENT = "tangram:sync";
const notify = () => window.dispatchEvent(new Event(SYNC_EVENT));

// ---- local ↔ payload ----

export function localPayload(): SyncPayload {
  const designs: SyncDesign[] = loadDesigns().map((d) => ({
    name: d.name,
    savedAt: d.savedAt,
    data: d,
  }));
  for (const [name, at] of Object.entries(loadDeleted())) designs.push({ name, savedAt: at, data: null });
  const nickname = loadNickname();
  return { progress: loadProgress(), designs, ...(nickname ? { nickname } : {}) };
}

/** Store a payload from the server, merged with whatever changed here while it was in flight. */
function applyLocal(remote: SyncPayload) {
  const merged = mergePayload(localPayload(), remote);
  saveProgress(merged.progress);
  saveDesigns(
    merged.designs
      .filter((d) => d.data !== null)
      .map((d) => ({
        ...(d.data as Design),
        name: d.name,
        savedAt: d.savedAt,
      })),
  );
  saveDeleted(Object.fromEntries(merged.designs.filter((d) => d.data === null).map((d) => [d.name, d.savedAt])));
  if (merged.nickname) saveNickname(merged.nickname);
}

// ---- requests ----

class AuthError extends Error {}

async function request(method: string, path: string, code?: string, body?: unknown): Promise<unknown> {
  const res = await fetch(`/api/${path}`, {
    method,
    headers: {
      ...(code ? { authorization: `Bearer ${code}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 401) throw new AuthError("Unknown sync code");
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

async function upload(code: string) {
  const merged = validatePayload(await request("PUT", "progress", code, localPayload()));
  if (!merged) throw new Error("Malformed reply");
  applyLocal(merged);
}

/** Everything that talks to the server runs one at a time, so a background sync can't interleave. */
let queue: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const p = queue.then(task);
  queue = p.catch(() => {});
  return p;
}

/**
 * Send local progress up and take the merged result back. `create` makes an account first if this
 * device has none (done lazily, on the first solve or saved design, so visitors leave no rows).
 */
export function syncNow(create = false): Promise<void> {
  return serial(() => syncOnce(create));
}

async function syncOnce(create: boolean) {
  try {
    let s = loadSync();
    if (s.off) return;
    if (!s.code) {
      if (!create) return;
      const { code } = (await request("POST", "player")) as { code: string };
      s = { code: normalizeCode(code) ?? undefined };
      saveSync(s);
    }
    if (!s.code) return;
    await upload(s.code);
    saveSync({ ...loadSync(), last: Date.now() });
  } catch (e) {
    // the account is gone (deleted from another device): forget it; local data stays
    if (e instanceof AuthError) saveSync({});
  }
}

let timer: ReturnType<typeof setTimeout> | undefined;
let pendingCreate = false;

/** Sync shortly after a change, batching bursts of changes. */
export function scheduleSync(create = false) {
  pendingCreate ||= create;
  clearTimeout(timer);
  timer = setTimeout(() => {
    const c = pendingCreate;
    pendingCreate = false;
    void syncNow(c);
  }, 1500);
}

// ---- actions from the Badges sheet (these report errors) ----

/** Create an account now (or turn sync back on after deleting). */
export async function enableSync() {
  if (loadSync().off) saveSync({});
  await syncNow(true);
  if (!loadSync().code) throw new Error("Couldn't reach the server. Try again later.");
}

/**
 * Switch this device to another device's code: progress here is merged into that account, and
 * this device's own account (if any) is deleted, since everything in it now lives in the other one.
 */
export async function switchToCode(input: string) {
  const code = normalizeCode(input);
  if (!code) throw new Error("That doesn't look like a sync code (TAN-XXXXX-XXXXX).");
  return serial(async () => {
    const old = loadSync().code;
    if (old === code) return;
    try {
      await upload(code);
    } catch (e) {
      throw new Error(
        e instanceof AuthError ? "No progress found for that code." : "Couldn't reach the server. Try again later.",
      );
    }
    saveSync({ code, last: Date.now() });
    if (old) await request("DELETE", "player", old).catch(() => {});
  });
}

/** Delete this player's online data. What's on this device stays. */
export const deleteOnline = () =>
  serial(async () => {
    const { code } = loadSync();
    if (code) {
      try {
        await request("DELETE", "player", code);
      } catch (e) {
        if (!(e instanceof AuthError)) throw new Error("Couldn't reach the server. Try again later.");
      }
    }
    saveSync({ off: true });
  });

export const displayCode = (code: string) => formatCode(code);

/** A sync code handed over in the address (`#sync=…`, from the QR code), removed once read. */
export function codeFromUrl(): string | null {
  const m = location.hash.match(/^#sync=([\w-]+)$/);
  if (!m) return null;
  history.replaceState(null, "", location.pathname + location.search);
  return normalizeCode(m[1]) && m[1];
}
