import { useEffect } from "react";
import type { Badge } from "../game/badges";

/** A sheet listing every badge: earned ones in colour, locked ones dimmed with how to earn them. */
export function BadgesSheet({ badges, onClose }: { badges: Badge[]; onClose(): void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const earned = badges.filter((b) => b.earned).length;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label="Badges" onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2>Badges</h2>
          <span className="pill">
            {earned}/{badges.length}
          </span>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <ul className="badge-list">
          {badges.map((b) => (
            <li key={b.id} className={"badge" + (b.earned ? " earned" : "")}>
              <span className="badge-emoji" aria-hidden>
                {b.emoji}
              </span>
              <span className="badge-text">
                <strong>{b.title}</strong>
                <small>{b.hint}</small>
              </span>
              {b.earned ? (
                <span className="badge-done" aria-label="Earned">
                  ✓
                </span>
              ) : (
                b.need > 1 && (
                  <span className="badge-progress" aria-label={`${b.have} of ${b.need}`}>
                    <span className="meter">
                      <span style={{ width: `${(b.have / b.need) * 100}%` }} />
                    </span>
                    {b.have}/{b.need}
                  </span>
                )
              )}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

/** "Badge unlocked" toasts, one at a time. */
export function BadgeToast({ badge, onDone }: { badge: Badge | undefined; onDone(): void }) {
  useEffect(() => {
    if (!badge) return;
    navigator.vibrate?.([20, 40, 20]);
    const t = setTimeout(onDone, 3200);
    return () => clearTimeout(t);
  }, [badge, onDone]);
  if (!badge) return null;
  return (
    <div className="toast" role="status" key={badge.id} onClick={onDone}>
      <span className="toast-emoji" aria-hidden>
        {badge.emoji}
      </span>
      <span>
        <small>Badge unlocked</small>
        <strong>{badge.title}</strong>
      </span>
    </div>
  );
}
