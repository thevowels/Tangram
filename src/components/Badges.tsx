import { useEffect, useRef, useState } from "react";
import type { Badge } from "../game/badges";
import { normalizeCode } from "../../shared/progress";
import { SITE_URL } from "../site";
import { deleteOnline, displayCode, enableSync, loadSync, switchToCode, SYNC_EVENT, type SyncState } from "../sync";

/** A sheet listing every badge: earned ones in colour, locked ones dimmed with how to earn them. */
export function BadgesSheet({
  badges,
  incomingCode,
  onClose,
}: {
  badges: Badge[];
  /** a code from a scanned QR link, offered for use */
  incomingCode: string | null;
  onClose(): void;
}) {
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
        <SyncPanel incomingCode={incomingCode} />
      </div>
    </div>
  );
}

/** Sync across devices: the code, its QR, using another device's code, and deleting online data. */
function SyncPanel({ incomingCode }: { incomingCode: string | null }) {
  const [state, setState] = useState<SyncState>(loadSync);
  // a scanned code that this device already uses needs no action
  const offered = incomingCode && normalizeCode(incomingCode) !== state.code ? incomingCode : null;
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(
    incomingCode && !offered ? "This device already uses that code." : null,
  );
  const [entry, setEntry] = useState(offered ?? "");
  const [entering, setEntering] = useState(offered !== null);
  const [showQr, setShowQr] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [copied, setCopied] = useState(false);
  const ref = useRef<HTMLElement>(null);

  // arriving from a scanned code: show this section, not the top of the badge list
  useEffect(() => {
    if (incomingCode) ref.current?.scrollIntoView({ block: "end" });
  }, [incomingCode]);

  useEffect(() => {
    const reload = () => setState(loadSync());
    window.addEventListener(SYNC_EVENT, reload);
    return () => window.removeEventListener(SYNC_EVENT, reload);
  }, []);

  const run = async (action: () => Promise<void>, done?: string) => {
    setBusy(true);
    setMessage(null);
    try {
      await action();
      if (done) setMessage(done);
      return true;
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const code = state.code ? displayCode(state.code) : null;
  const copy = async () => {
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setMessage("Couldn't copy; select the code instead.");
    }
  };
  const use = async () => {
    if (await run(() => switchToCode(entry), "Done: this device now shares that progress.")) {
      setEntering(false);
      setEntry("");
    }
  };

  return (
    <section ref={ref} className="sync" aria-label="Sync across devices">
      <h3>Play on another device</h3>
      {code ? (
        <>
          <p className="muted">Enter this code on your other phone or computer to bring your progress along.</p>
          <div className="sync-code">
            <code>{code}</code>
            <button onClick={copy}>{copied ? "Copied" : "Copy"}</button>
            <button onClick={() => setShowQr((v) => !v)} aria-expanded={showQr}>
              QR
            </button>
          </div>
          {showQr && <QrCode text={`${SITE_URL}/#sync=${code}`} />}
          {state.last && <p className="muted small">Last synced {new Date(state.last).toLocaleString()}</p>}
        </>
      ) : state.off ? (
        <>
          <p className="muted">Sync is off. Your progress is kept on this device only.</p>
          <button className="primary" disabled={busy} onClick={() => run(enableSync)}>
            Turn sync back on
          </button>
        </>
      ) : (
        <>
          <p className="muted">
            Your progress is saved on this device. Solve a puzzle and you get a sync code to carry it to your other
            devices.
          </p>
          <button className="primary" disabled={busy} onClick={() => run(enableSync)}>
            Get my code now
          </button>
        </>
      )}

      {entering ? (
        <form
          className="sync-enter"
          onSubmit={(e) => {
            e.preventDefault();
            void use();
          }}
        >
          <input
            value={entry}
            onChange={(e) => setEntry(e.target.value)}
            placeholder="TAN-XXXXX-XXXXX"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-label="Sync code from another device"
          />
          <button className="primary" disabled={busy || !entry.trim()}>
            Use
          </button>
        </form>
      ) : (
        <button className="link" onClick={() => setEntering(true)}>
          I have a code from another device
        </button>
      )}

      {message && (
        <p className="sync-message" role="status">
          {message}
        </p>
      )}

      <p className="muted small">
        No email, no tracking. Your code is your key: keep it private. Progress on this device is merged with it.
      </p>
      {code &&
        (confirmDelete ? (
          <div className="sync-delete">
            <span>Delete your online progress? This device keeps its copy.</span>
            <button
              className="danger"
              disabled={busy}
              onClick={() => run(deleteOnline, "Online data deleted.").then(() => setConfirmDelete(false))}
            >
              Delete
            </button>
            <button onClick={() => setConfirmDelete(false)}>Cancel</button>
          </div>
        ) : (
          <button className="link danger-link" onClick={() => setConfirmDelete(true)}>
            Delete my online data
          </button>
        ))}
    </section>
  );
}

/** A dark-on-light QR code (the encoder is loaded on first use). */
function QrCode({ text }: { text: string }) {
  const [svg, setSvg] = useState<{ d: string; size: number } | null>(null);
  useEffect(() => {
    let live = true;
    void import("qrcode-generator").then(({ default: qrcode }) => {
      const qr = qrcode(0, "M");
      qr.addData(text);
      qr.make();
      const n = qr.getModuleCount();
      let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) d += `M${c + 2},${r + 2}h1v1h-1z`;
      if (live) setSvg({ d, size: n + 4 });
    });
    return () => {
      live = false;
    };
  }, [text]);
  if (!svg) return null;
  return (
    <svg
      className="sync-qr"
      viewBox={`0 0 ${svg.size} ${svg.size}`}
      role="img"
      aria-label="QR code with your sync link"
    >
      <rect width={svg.size} height={svg.size} fill="#fff" />
      <path d={svg.d} fill="#1a1240" shapeRendering="crispEdges" />
    </svg>
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
