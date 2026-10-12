import { useEffect, useState } from "react";

const KEY = "tangram.tip.joints";

/** One-time hint about joined pieces, shown over the board until dismissed (or for a while). */
export function JointTip() {
  const [show, setShow] = useState(() => !localStorage.getItem(KEY));
  const dismiss = () => {
    localStorage.setItem(KEY, "1");
    setShow(false);
  };
  useEffect(() => {
    if (!show) return;
    const t = setTimeout(dismiss, 12000);
    return () => clearTimeout(t);
  }, [show]);
  if (!show) return null;
  return (
    <div className="tip" role="status">
      <span>
        Pieces joined along an edge stick together. <strong>Drag the glowing joint</strong> to move them as one,
        or drag a piece to pull it out.
      </span>
      <button className="tip-close" onClick={dismiss} aria-label="Dismiss tip">
        ✕
      </button>
    </div>
  );
}
