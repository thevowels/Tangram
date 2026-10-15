// Anonymous gameplay analytics: which puzzles get started, solved or abandoned, and how long
// they take. Each event only bumps a daily counter on the server (no player id, no IP, no
// cookies), and nothing is sent when the browser asks not to be tracked.

import type { GameEvent } from "../shared/progress";

const optedOut = () => {
  const n = navigator as Navigator & { globalPrivacyControl?: boolean };
  return n.globalPrivacyControl === true || n.doNotTrack === "1";
};

/** Fire and forget; survives the page closing (sendBeacon), never throws. */
export function logEvent(event: GameEvent) {
  try {
    if (optedOut()) return;
    const body = JSON.stringify(event);
    if (navigator.sendBeacon?.("/api/event", body)) return;
    void fetch("/api/event", { method: "POST", body, keepalive: true }).catch(() => {});
  } catch {
    // analytics must never break the game
  }
}
