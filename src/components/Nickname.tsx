import { useEffect, useRef, useState } from "react";
import { cleanNickname, NICKNAME_MAX } from "../../shared/progress";
import { randomNickname } from "../game/names";

/**
 * A nickname field with a random suggestion as its placeholder: leave it empty to take the
 * suggestion, or roll 🎲 for another. `onSave(name, typed)` gets the cleaned name.
 */
function NicknameForm({
  initial = "",
  submitLabel,
  onSave,
  onCancel,
  autoFocus,
}: {
  initial?: string;
  submitLabel: string;
  onSave(name: string, typed: boolean): void;
  onCancel?(): void;
  autoFocus?: boolean;
}) {
  const [value, setValue] = useState(initial);
  const [suggestion, setSuggestion] = useState(() => randomNickname());
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const typed = value.trim() !== "";
    const name = cleanNickname(typed ? value : suggestion);
    if (!name) {
      setError("That name can’t be used. Try letters, numbers and spaces, up to 20.");
      return;
    }
    onSave(name, typed);
  };

  return (
    <form
      className="nickname-form"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="nickname-row">
        <input
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setError(null);
          }}
          placeholder={suggestion}
          maxLength={NICKNAME_MAX + 10}
          autoFocus={autoFocus}
          autoComplete="nickname"
          spellCheck={false}
          aria-label="Nickname"
        />
        <button
          type="button"
          className="icon-btn"
          aria-label="Suggest another name"
          title="Suggest another name"
          onClick={() => {
            setSuggestion((s) => randomNickname(Math.random, s));
            setValue("");
            setError(null);
          }}
        >
          🎲
        </button>
      </div>
      {error && (
        <p className="nickname-error" role="alert">
          {error}
        </p>
      )}
      <div className="nickname-actions">
        {onCancel && (
          <button type="button" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button className="primary">{submitLabel}</button>
      </div>
    </form>
  );
}

/** Asked once, on a player's first visit. Closing it keeps the suggested name. */
export function NicknamePrompt({ onSave }: { onSave(name: string, typed: boolean): void }) {
  // closing without choosing keeps a random name, so the prompt never comes back
  const fallback = useRef(randomNickname());
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onSave(fallback.current, false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onSave]);

  return (
    <div className="sheet-backdrop">
      <div className="sheet nickname-sheet" role="dialog" aria-modal="true" aria-labelledby="nickname-title">
        <div className="nickname-hero" aria-hidden>
          👋
        </div>
        <h2 id="nickname-title">What should we call you?</h2>
        <p className="muted">
          Your name goes on the pictures you save. Leave it blank to use the suggestion, or roll 🎲 for another.
        </p>
        <NicknameForm submitLabel="Let's play" onSave={onSave} autoFocus />
        <p className="muted small">You can change it any time under 🏅.</p>
      </div>
    </div>
  );
}

/** The nickname line at the top of the badges sheet, editable in place. */
export function NicknameRow({ name, onSave }: { name: string | null; onSave(name: string, typed: boolean): void }) {
  const [editing, setEditing] = useState(false);
  if (editing)
    return (
      <div className="nickname-edit">
        <NicknameForm
          initial={name ?? ""}
          submitLabel="Save"
          autoFocus
          onCancel={() => setEditing(false)}
          onSave={(n, typed) => {
            onSave(n, typed);
            setEditing(false);
          }}
        />
      </div>
    );
  return (
    <div className="nickname-line">
      <span aria-hidden>👤</span>
      <strong>{name ?? "No name yet"}</strong>
      <button className="link" onClick={() => setEditing(true)}>
        {name ? "Change" : "Set a name"}
      </button>
    </div>
  );
}
