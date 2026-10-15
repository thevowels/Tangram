import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Board } from "./components/Board";
import { Confetti } from "./components/Confetti";
import { Logo } from "./components/Logo";
import { formatTime, PuzzlePicker } from "./components/PuzzlePicker";
import { Toolbar } from "./components/Toolbar";
import { JointTip } from "./components/Tip";
import { exportBoardImage } from "./exportImage";
import { puzzleIdFromUrl, puzzleLink, SITE_URL } from "./site";
import { flip, rotate } from "./game/actions";
import { centreOn, evaluate, fitToOutline, perfectFit, settleFlush, slotSnap, type Puzzle } from "./game/check";
import {
  figureExtent,
  fitLayout,
  freeLayout,
  LANDSCAPE,
  placeSilhouette,
  remap,
  trayLayout,
  type Extent,
  type Layout,
} from "./game/layout";
import { piecePolygon, type PieceState } from "./geometry/pieces";
import { bounds, type Poly } from "./geometry/polygon";
import {
  bestTimes,
  bump,
  loadDesigns,
  markDeleted,
  loadProgress,
  recordSolve,
  saveDesigns,
  saveProgress,
  type Design,
  type Progress,
} from "./storage";
import { computeBadges, newlyEarned, type Badge } from "./game/badges";
import { BadgesSheet, BadgeToast } from "./components/Badges";
import { codeFromUrl, scheduleSync, SYNC_EVENT, syncNow } from "./sync";
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

/**
 * Fit a board layout to the element's size; null until it has been measured. In puzzles the
 * board is sized for that puzzle's silhouette (`figure`), so small figures get big pieces.
 */
function useFitLayout(ref: RefObject<HTMLElement | null>, figure?: Extent) {
  const [layout, setLayout] = useState<Layout | null>(null);
  useLayoutEffect(() => {
    const el = ref.current!;
    const update = () => {
      const { width, height } = el.getBoundingClientRect();
      if (width < 50 || height < 50) return;
      const next = fitLayout(width, height, figure);
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
  }, [ref, figure]);
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
  /** The puzzle's exact spots: a piece turned the right way near its spot pulls in. */
  slots?: PieceState[],
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
      if (next) settle((slots && slotSnap(next, ids, slots)?.pieces) || next);
    },
    [settle, board, slots],
  );

  const doFlip = useCallback(
    (ids: string[]) => {
      if (!ids.length || !piecesRef.current || !board) return;
      const next = flip(piecesRef.current, ids, board);
      if (next) settle((slots && slotSnap(next, ids, slots)?.pieces) || next);
    },
    [settle, board, slots],
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
          slots,
          selected,
          onSelect: setSelected,
          onChange: setPieces,
          onSettle: settle,
          onRotate: doRotate,
          onFlip: doFlip,
        }
      : null;

  return { pieces, selected, doRotate, doFlip, reset, replace: setPieces, boardProps };
}

function FreePlay({ onTrack }: { onTrack(kind: "designsSaved" | "exports"): void }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const layout = useFitLayout(stageRef);
  const noop = useCallback(() => {}, []);
  const g = usePieces(layout, freeLayout, noop, false);
  const [designs, setDesigns] = useState<Design[]>(loadDesigns);
  const [name, setName] = useState("");
  // designs saved on another device arrive with a sync
  useEffect(() => {
    const reload = () => setDesigns(loadDesigns());
    window.addEventListener(SYNC_EVENT, reload);
    return () => window.removeEventListener(SYNC_EVENT, reload);
  }, []);

  const save = () => {
    if (!g.pieces || !layout) return;
    const n = name.trim() || `Design ${designs.length + 1}`;
    const d: Design = { name: n, pieces: g.pieces, layout, v: 2, savedAt: Date.now() };
    const next = [d, ...designs.filter((x) => x.name !== n)];
    setDesigns(next);
    saveDesigns(next);
    setName("");
    onTrack("designsSaved");
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
    markDeleted(n);
    scheduleSync();
  };

  const exportPng = () => {
    if (!svgRef.current || !layout) return;
    onTrack("exports");
    void exportBoardImage(svgRef.current, layout.board, {
      filename: "tangram.jpg",
      caption: { title: "My Tangram", subtitle: "Made in free play" },
      link: SITE_URL,
    });
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
          <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Name your design" />
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
  onTrack,
  onNext,
  onBack,
}: {
  puzzle: Puzzle;
  onSolved(ms: number): void;
  onTrack(kind: "exports"): void;
  onNext(): void;
  onBack(): void;
}) {
  const stageRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const figure = useMemo(() => figureExtent(puzzle.polygons), [puzzle]);
  const layout = useFitLayout(stageRef, figure);
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

  // set once usePieces exists below; lets the solve check pull pieces into place
  const replacePieces = useRef<(p: PieceState[]) => void>(() => {});

  const check = useCallback(
    (pieces: PieceState[]) => {
      if (!guide) return;
      const { match, solved } = evaluate(pieces, guide);
      setMatch(match);
      if (solved) {
        // close the last little gaps: every piece clicks into its exact place (100% match)
        // ...and wherever it was built, the finished figure glides onto the outline
        // the stored solution clicks in exactly; any other valid arrangement is moved onto the
        // outline and fitted edge to edge (the outline anchors it), with a plain snap as last resort
        const exact = perfectFit(pieces, puzzle.solution, layout?.target);
        let finished = exact;
        let locked = !!exact;
        if (!finished) {
          const onOutline = layout ? centreOn(pieces, layout.target) : pieces;
          const fitted = fitToOutline(onOutline, guide);
          locked = fitted !== onOutline;
          finished = locked ? fitted : settleFlush(onOutline, guide);
        }
        replacePieces.current(finished);
        if (locked) setMatch(1); // locked exactly to the outline: a true 100%
        const ms = performance.now() - start.current;
        setSolvedIn(ms);
        onSolved(ms);
        navigator.vibrate?.([30, 60, 30]);
      }
    },
    [guide, onSolved, puzzle, layout],
  );

  const slots = useMemo(
    () =>
      layout ? puzzle.solution.map((s) => ({ ...s, x: s.x + layout.target[0], y: s.y + layout.target[1] })) : undefined,
    [puzzle, layout],
  );
  const g = usePieces(layout, trayLayout, check, true, guide ?? undefined, slots);
  replacePieces.current = g.replace;
  const pct = Math.round(match * 100);

  /** Save the figure (and the pieces around it) as an image, captioned with the puzzle. */
  const exportPng = () => {
    if (!svgRef.current || !layout || !guide || !g.pieces) return;
    const b = bounds([...guide, ...g.pieces.map(piecePolygon)]);
    const pad = 0.5;
    onTrack("exports");
    void exportBoardImage(svgRef.current, layout.board, {
      filename: `tangram-${puzzle.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}.jpg`,
      crop: { minX: b.minX - pad, minY: b.minY - pad, maxX: b.maxX + pad, maxY: b.maxY + pad },
      caption: {
        title: puzzle.name,
        subtitle: solvedIn !== null ? `Solved in ${formatTime(solvedIn)}` : `In progress · ${pct}% matched`,
      },
      link: puzzleLink(puzzle.id),
    });
  };

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
        {g.boardProps && guide && <Board ref={svgRef} {...g.boardProps} guide={guide} solved={solvedIn !== null} />}
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
                <button onClick={exportPng}>
                  <span aria-hidden>⤓</span> Save image
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
      >
        <button onClick={exportPng}>
          <span aria-hidden>⤓</span> Export
        </button>
      </Toolbar>
    </>
  );
}

export default function App() {
  const [mode, setMode] = useState<Mode>("puzzles");
  // `?p=<id>` opens that puzzle directly (shared links and export QR codes use this)
  const [puzzle, setPuzzle] = useState<Puzzle | null>(
    () => PUZZLES.find((p) => p.id === puzzleIdFromUrl()) ?? null,
  );

  // keep the address in sync, so the current puzzle can be shared by copying the URL
  useEffect(() => {
    const want = mode === "puzzles" && puzzle ? `?p=${puzzle.id}` : "";
    if (location.search !== want) history.replaceState(null, "", location.pathname + want);
  }, [mode, puzzle]);
  const touch = useMedia("(pointer: coarse)");
  const [progress, setProgress] = useState<Progress>(loadProgress);
  const progressRef = useRef(progress);
  const solved = useMemo(() => bestTimes(progress), [progress]);
  const badges = useMemo(() => computeBadges(progress, PUZZLES), [progress]);
  const [toasts, setToasts] = useState<Badge[]>([]);
  // a sync code handed over by QR (`#sync=…`) opens the sheet ready to use it
  const [incomingCode] = useState(codeFromUrl);
  const [showBadges, setShowBadges] = useState(incomingCode !== null);

  // progress from other devices: on load, and whenever a sync brings something new
  useEffect(() => {
    const reload = () => {
      const p = loadProgress();
      progressRef.current = p;
      setProgress(p);
    };
    window.addEventListener(SYNC_EVENT, reload);
    void syncNow();
    return () => window.removeEventListener(SYNC_EVENT, reload);
  }, []);

  /** Apply a change to progress: save it, and celebrate any badge it unlocks. */
  const updateProgress = useCallback((change: (p: Progress) => Progress) => {
    const before = progressRef.current;
    const after = change(before);
    progressRef.current = after;
    setProgress(after);
    saveProgress(after);
    const fresh = newlyEarned(before, after, PUZZLES);
    if (fresh.length) setToasts((t) => [...t, ...fresh]);
  }, []);
  const dismissToast = useCallback(() => setToasts((t) => t.slice(1)), []);
  const track = useCallback(
    (kind: "designsSaved" | "exports") => {
      updateProgress((p) => bump(p, kind));
      // a saved design is worth keeping, so it creates the account like a solve does
      scheduleSync(kind === "designsSaved");
    },
    [updateProgress],
  );

  const onSolved = useCallback(
    (ms: number) => {
      if (!puzzle) return;
      updateProgress((p) => recordSolve(p, puzzle.id, ms));
      scheduleSync(true);
    },
    [puzzle, updateProgress],
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
        <button className="badge-chip" onClick={() => setShowBadges(true)} aria-label="Badges and sync">
          <span aria-hidden>🏅</span> {badges.filter((b) => b.earned).length}
          <small>/{badges.length}</small>
        </button>
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
        {mode === "free" && <FreePlay onTrack={track} />}
        {mode === "puzzles" &&
          (puzzle ? (
            <PuzzlePlay
              key={puzzle.id}
              puzzle={puzzle}
              onSolved={onSolved}
              onTrack={track}
              onNext={next}
              onBack={() => setPuzzle(null)}
            />
          ) : (
            <PuzzlePicker puzzles={PUZZLES} solved={solved} onPick={setPuzzle} />
          ))}
      </main>
      {showBadges && (
        <BadgesSheet badges={badges} incomingCode={incomingCode} onClose={() => setShowBadges(false)} />
      )}
      <BadgeToast badge={toasts[0]} onDone={dismissToast} />
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
