import { STEPS, type Step } from "../game/tutorial";

const TEXT: Record<Step, { title: string; touch: string; mouse: string }> = {
  goal: {
    title: "Fill the shadow",
    touch:
      "Every puzzle is a shadow to fill with all seven pieces. Five are already in place here: finish the square with the other two.",
    mouse:
      "Every puzzle is a shadow to fill with all seven pieces. Five are already in place here: finish the square with the other two.",
  },
  drag: {
    title: "Move a piece",
    touch: "Press a glowing piece and drag it toward the shadow.",
    mouse: "Drag a glowing piece toward the shadow.",
  },
  turn: {
    title: "Turn a piece",
    touch: "The triangle is turned the wrong way. Tap it to select it, then tap it again (or ↻) to turn it. Two fingers can twist it too.",
    mouse: "The triangle is turned the wrong way. Click it to select it, then click it again (or ↻, or R) to turn it.",
  },
  flip: {
    title: "Flip a piece",
    touch: "The parallelogram is mirrored. Select it and tap ⇋ to flip it over.",
    mouse: "The parallelogram is mirrored. Select it and press ⇋ (or F) to flip it over.",
  },
  finish: {
    title: "Finish the square",
    touch: "Move both into the shadow. Close is enough: pieces click into place, and a golden edge means locked.",
    mouse: "Move both into the shadow. Close is enough: pieces click into place, and a golden edge means locked.",
  },
};

/** The lesson card above the board: what to do now, progress dots, and a way out. */
export function Coach({
  step,
  touch,
  onNext,
  onSkip,
}: {
  step: Step;
  touch: boolean;
  onNext(): void;
  onSkip(): void;
}) {
  const t = TEXT[step];
  const i = STEPS.indexOf(step);
  return (
    <div className="coach" role="status" aria-live="polite">
      <div className="coach-text">
        <strong>
          <span className="coach-num">{i + 1}</span> {t.title}
        </strong>
        <span>{touch ? t.touch : t.mouse}</span>
      </div>
      <div className="coach-foot">
        <span className="coach-dots" aria-label={`Step ${i + 1} of ${STEPS.length}`}>
          {STEPS.map((s, j) => (
            <span key={s} className={j < i ? "done" : j === i ? "now" : ""} />
          ))}
        </span>
        <button className="link" onClick={onSkip}>
          Skip tutorial
        </button>
        {step === "goal" && (
          <button className="primary" onClick={onNext}>
            Got it
          </button>
        )}
      </div>
    </div>
  );
}
