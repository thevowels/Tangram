import type { ReactNode } from "react";

interface Props {
  selected: string[];
  onRotate(dir: 1 | -1): void;
  onFlip(): void;
  onReset(): void;
  children?: ReactNode;
}

export function Toolbar({ selected, onRotate, onFlip, onReset, children }: Props) {
  return (
    <div className="toolbar">
      <button disabled={!selected.length} onClick={() => onRotate(-1)} title="Rotate left (Shift+R)">
        <span aria-hidden>↺</span> Left
      </button>
      <button disabled={!selected.length} onClick={() => onRotate(1)} title="Rotate right (R)">
        <span aria-hidden>↻</span> Right
      </button>
      <button disabled={!selected.length} onClick={onFlip} title="Flip (F)">
        <span aria-hidden>⇋</span> Flip
      </button>
      <span className="spacer" />
      <button onClick={onReset}>Reset</button>
      {children}
    </div>
  );
}
