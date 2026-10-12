import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Board } from "./components/Board";
import { Confetti } from "./components/Confetti";
import { Logo } from "./components/Logo";
import { formatTime, PuzzlePicker } from "./components/PuzzlePicker";
import { Toolbar } from "./components/Toolbar";
import { JointTip } from "./components/Tip";
import { flip, rotate } from "./game/actions";
import { evaluate, type Puzzle } from "./game/check";
import { fitLayout, freeLayout, LANDSCAPE, placeSilhouette, remap, trayLayout, type Layout } from "./game/layout";
import type { PieceState } from "./geometry/pieces";
import type { Poly } from "./geometry/polygon";
import { loadDesigns, loadSolved, saveDesigns, saveSolved, type Design } from "./storage";
import puzzlesJson from "./data/puzzles.json";

const PUZZLES = puzzlesJson as unknown as Puzzle[];

type Mode = "free" | "puzzles";

function useMedia(query: string) {
  const [match, setMatch] = useState(() => matchMedia(query).matches);
  useEffect(() => {
    const mq = matchMedia(query);
    const on = () => setMatch(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

/** Fit a board layout to the element's size; null until it has been measured. */
function useFitLayout(ref: RefObject<HTMLElement | null>) {
  const [layout, setLayout] = useState<Layout | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 50 || height < 50) return;
      const next = fitLayout(width, height);
      setLayout((prev) =>
        prev &&
        prev.board.width === next.board.width &&
        prev.board.height === next.board.height
          ? prev
          : next,
      );
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref]);
  return layout;
}

/**
 * Piece state + selection + rotate/flip commands (buttons, tap and keyboard).
 * Pieces are created once the play area is measured, and carried over when it resizes.
 */
function usePieces(
  layout: Layout | null,
  initial: (l: Layout) => PieceState[],
  onSettle: (p: PieceState[]) => void,
  puzzle: boolean,
  outline?: Poly[],
) {
  // the physics board: the screen-fitted size plus, in puzzles, the silhouette pieces lock to
  const board = useMemo(() => (layout ? { ...layout.board, outline } : null), [layout, outline]);
  const [pieces, setPieces] = useState<PieceState[] | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;

  const prevLayout = useRef<Layout | null>(null);
  useEffect(() => {
    if (!layout || prevLayout.current === layout) return;
    const prev = prevLayout.current;
    setPieces((p) => (p && prev ? remap(p, prev, layout, puzzle) : initial(layout)));
    prevLayout.current = layout;
  }, [layout, puzzle, initial]);

  const settle = useCallback(
    (next: PieceState[]) => {
      setPieces(next);
      onSettle(next);
    },
    [onSettle],
  );

  const doRotate = useCallback(
    (ids: string[], dir: 1 | -1) => {
      if (!ids.length || !piecesRef.current || !board) return;
      const next = rotate(piecesRef.current, ids, dir, board);
      if (next) settle(next);
    },
    [settle, board],
  );

  const doFlip = useCallback(
    (ids: string[]) => {
      if (!ids.length || !piecesRef.current || !board) return;
      const next = flip(piecesRef.current, ids, board);
      if (next) settle(next);
    },
    [settle, board],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const k = e.key.toLowerCase();
      if (k === "r") doRotate(selected, e.shiftKey ? -1 : 1);
      else if (k === "e") doRotate(selected, -1);
      else if (k === "f") doFlip(selected);
      else if (k === "escape") setSelected([]);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selected, doRotate, doFlip]);

  const reset = (next: PieceState[]) => {
    setPieces(next);
    setSelected([]);
  };

  const boardProps =
    board && pieces
      ? {
          board,
          pieces,
          selected,
          onSelect: setSelected,
          onChange: setPieces,
          onSettle: settle,
          onRotate: doRotate,
          onFlip: doFlip,
        }
      : null;

  return { pieces, selected, doRotate, doFlip, reset, boardProps };
}

function FreePlay() {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = useFitLayout(stageRef);
  const noop = useCallback(() => {}, []);
  const g = usePieces(layout, freeLayout, noop, false);
  const [designs, setDesigns] = useState<Design[]>(loadDesigns);
  const [name, setName] = useState("");

  const save = () => {
    if (!g.pieces || !layout) return;
    const n = name.trim() || `Design ${designs.length + 1}`;
    const d: Design = { name: n, pieces: g.pieces, layout, v: 2, savedAt: Date.now() };
    const next = [d, ...designs.filter((x) => x.name !== n)];
    setDesigns(next);
    saveDesigns(next);
    setName("");
  };

  const load = (d: Design) => {
    if (!layout) return;
    const from = typeof d.layout === "object" ? d.layout : LANDSCAPE;
    g.reset(remap(d.pieces, from, layout, false));
  };

  const remove = (n: string) => {
    const next = designs.filter((d) => d.name !== n);
    setDesigns(next);
    saveDesigns(next);
  };

  const exportPng = () => {
    const svg = svgRef.current;
    if (!svg || !layout) return;
    const { width, height } = layout.board;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.querySelectorAll(".snap-flash, .piece-actions").forEach((n) => n.remove());
    const bg = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    Object.entries({ width: String(width), height: String(height), fill: "#1a1240" }).forEach(([k, v]) =>
      bg.setAttribute(k, v),
    );
    clone.insertBefore(bg, clone.firstChild);
    clone.querySelectorAll(".piece").forEach((n) => {
      n.removeAttribute("class");
      n.setAttribute("stroke", "rgba(255,255,255,0.35)");
      n.setAttribute("stroke-width", "0.03");
    });
    const scale = 80;
    clone.setAttribute("width", String(width * scale));
    clone.setAttribute("height", String(height * scale));
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }),
    );
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width * scale;
      canvas.height = height * scale;
      canvas.getContext("2d")!.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      const a = document.createElement("a");
      a.download = "tangram.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    };
    img.src = url;
  };

  return (
    <>
      <div className="stage" ref={stageRef}>
        {g.boardProps && <Board ref={svgRef} {...g.boardProps} />}
        <JointTip />
      </div>
      <Toolbar
        selected={g.selected}
        onRotate={(d) => g.doRotate(g.selected, d)}
        onFlip={() => g.doFlip(g.selected)}
        onReset={() => layout && g.reset(freeLayout(layout))}
      >
        <button onClick={exportPng}>
          <span aria-hidden>⤓</span> Export
        </button>
      </Toolbar>
      <div className="designs">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
        >
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name your design" />
          <button type="submit" className="primary">
            Save
          </button>
        </form>
        {designs.length > 0 && (
          <ul>
            {designs.map((d) => (
              <li key={d.name}>
                <button className="chip" onClick={() => load(d)}>
                  {d.name}
                </button>
                <button className="chip-x" onClick={() => remove(d.name)} aria-label={`Delete ${d.name}`}>
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </>
  );
}

function PuzzlePlay({
  puzzle,
  onSolved,
  onNext,
  onBack,
}: {
  puzzle: Puzzle;
  onSolved(ms: number): void;
  onNext(): void;
  onBack(): void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const layout = useFitLayout(stageRef);
  const guide = useMemo(
    () => (layout ? placeSilhouette(puzzle.polygons, layout.target) : null),
    [puzzle, layout],
  );
  const start = useRef(performance.now());
  const [solvedIn, setSolvedIn] = useState<number | null>(null);
  const [match, setMatch] = useState(0);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (solvedIn !== null) return;
    const t = setInterval(() => setNow(performance.now() - start.current), 1000);
    return () => clearInterval(t);
  }, [solvedIn]);

  const check = useCallback(
    (pieces: PieceState[]) => {
      if (!guide) return;
      const { match, solved } = evaluate(pieces, guide);
      setMatch(match);
      if (solved) {
        const ms = performance.now() - start.current;
        setSolvedIn(ms);
        onSolved(ms);
        navigator.vibrate?.([30, 60, 30]);
      }
    },
    [guide, onSolved],
  );

  const g = usePieces(layout, trayLayout, check, true, guide ?? undefined);
  const pct = Math.round(match * 100);

  return (
    <>
      <div className="play-header">
        <button className="icon-btn" onClick={onBack} aria-label="All puzzles">
          ←
        </button>
        <h2>{puzzle.name}</h2>
        <span className="pill">⏱ {formatTime(solvedIn ?? now)}</span>
        <span className="pill match" title="How much of the silhouette your pieces cover">
          <span className="meter">
            <span style={{ width: `${pct}%` }} />
          </span>
          {pct}%
        </span>
      </div>
      <div className="stage" ref={stageRef}>
        {g.boardProps && guide && <Board {...g.boardProps} guide={guide} solved={solvedIn !== null} />}
        <JointTip />
        {solvedIn !== null && (
          <div className="success">
            <Confetti />
            <div className="success-card">
              <h3>Solved!</h3>
              <p>
                {puzzle.name} in <strong>{formatTime(solvedIn)}</strong>
              </p>
              <div>
                <button className="primary" onClick={onNext}>
                  Next puzzle →
                </button>
                <button onClick={onBack}>All puzzles</button>
              </div>
            </div>
          </div>
        )}
      </div>
      <Toolbar
        selected={g.selected}
        onRotate={(d) => g.doRotate(g.selected, d)}
        onFlip={() => g.doFlip(g.selected)}
        onReset={() => {
          if (layout) g.reset(trayLayout(layout));
          setMatch(0);
        }}
      />
    </>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>("puzzles");
  const [puzzle, setPuzzle] = useState<Puzzle | null>(null);
  const [solved, setSolved] = useState<Record<string, number>>(loadSolved);
  const touch = useMedia("(pointer: coarse)");

  const onSolved = useCallback(
    (ms: number) => {
      if (!puzzle) return;
      setSolved((s) => {
        const next = { ...s, [puzzle.id]: Math.min(ms, s[puzzle.id] ?? Infinity) };
        saveSolved(next);
        return next;
      });
    },
    [puzzle],
  );

  const next = () => {
    if (!puzzle) return;
    const i = PUZZLES.findIndex((p) => p.id === puzzle.id);
    setPuzzle(PUZZLES[(i + 1) % PUZZLES.length]);
  };

  const playing = mode === "free" || puzzle !== null;

  return (
    <div className={"app" + (playing ? " playing" : "")}>
      <header>
        <div className="brand">
          <Logo />
          <h1>Tangram</h1>
        </div>
        <nav>
          <button className={mode === "puzzles" ? "active" : ""} onClick={() => setMode("puzzles")}>
            Puzzles
          </button>
          <button className={mode === "free" ? "active" : ""} onClick={() => setMode("free")}>
            Free play
          </button>
        </nav>
      </header>
      <main>
        {mode === "free" && <FreePlay />}
        {mode === "puzzles" &&
          (puzzle ? (
            <PuzzlePlay key={puzzle.id} puzzle={puzzle} onSolved={onSolved} onNext={next} onBack={() => setPuzzle(null)} />
          ) : (
            <PuzzlePicker puzzles={PUZZLES} solved={solved} onPick={setPuzzle} />
          ))}
      </main>
      <footer>
        {touch ? (
          <>
            Drag a piece to move it · drag a glowing joint to move joined pieces together · tap again or twist with
            two fingers to rotate
          </>
        ) : (
          <>
            Drag a piece to move it, or a glowing joint to move joined pieces together · click again or <kbd>R</kbd> /{" "}
            <kbd>Shift+R</kbd> to rotate · <kbd>F</kbd> to
            flip
          </>
        )}
        {" · "}pieces joined along an edge stay together when bumped
      </footer>
    </div>
  );
}
