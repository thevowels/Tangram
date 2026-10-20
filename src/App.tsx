import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import { Board } from "./components/Board";
import { CelebrationLayer, RevealMedal } from "./components/Celebration";
import { medal, MEDAL_NAME } from "./game/medals";
import { randomNext } from "./game/next";
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
  loadNickname,
  loadProgress,
  recordSolve,
  saveDesigns,
  saveNickname,
  saveProgress,
  type Design,
  type Progress,
} from "./storage";
import { computeBadges, newlyEarned, type Badge } from "./game/badges";
import { BadgesSheet, BadgeToast } from "./components/Badges";
import { NicknamePrompt } from "./components/Nickname";
import { logEvent } from "./analytics";
import { Coach } from "./components/Coach";
import {
  currentStep,
  HINT,
  markTutorialDone,
  stepDone,
  STEPS,
  TUTORIAL_PUZZLE,
  tutorialDone,
  tutorialPuzzle,
  tutorialStart,
  type Step,
} from "./game/tutorial";
import { codeFromUrl, scheduleSync, SYNC_EVENT, syncNow } from "./sync";
import puzzlesJson from "./data/puzzles.json";

const PUZZLES = puzzlesJson as unknown as Puzzle[];
const TUTORIAL = tutorialPuzzle(PUZZLES.find((p) => p.id === TUTORIAL_PUZZLE)!);

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

function FreePlay({
  nickname,
  onTrack,
}: {
  nickname: string | null;
  onTrack(kind: "designsSaved" | "exports"): void;
}) {
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
      caption: {
        title: "My Tangram",
        subtitle: nickname ? `Made by ${nickname} in free play` : "Made in free play",
      },
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
  nickname,
  tutorial,
  touch,
  best,
  onSolved,
  onTrack,
  onNext,
  onBack,
}: {
  puzzle: Puzzle;
  nickname: string | null;
  /** Play this as the first-run lesson (the puzzle is the Square, mostly filled in). */
  tutorial?: { onFinish(goFree: boolean): void; onSkip(): void };
  touch: boolean;
  /** Best time before this attempt, to tell a new best. */
  best?: number;
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
  // the best before this attempt: App's copy updates the moment this solve is saved
  const previousBest = useRef(best);
  const [solvedIn, setSolvedIn] = useState<number | null>(null);
  const [match, setMatch] = useState(0);
  const [now, setNow] = useState(0);

  const lesson = !!tutorial;
  // analytics: a start, then either a solve or a quit (leaving, or closing the page, unsolved)
  const session = useRef({ started: false, ended: false, mounted: false, best: 0 });
  useEffect(() => {
    const s = session.current;
    s.mounted = true;
    if (!s.started) {
      s.started = true;
      logEvent(lesson ? { e: "tutorial_start" } : { e: "start", p: puzzle.id });
    }
    const quit = () => {
      if (s.ended) return;
      s.ended = true;
      const ms = performance.now() - start.current;
      logEvent(lesson ? { e: "tutorial_skip", ms } : { e: "quit", p: puzzle.id, ms, pct: s.best * 100 });
    };
    window.addEventListener("pagehide", quit);
    return () => {
      window.removeEventListener("pagehide", quit);
      s.mounted = false;
      // StrictMode remounts at once in development; only a real unmount counts as leaving
      setTimeout(() => !s.mounted && quit(), 0);
    };
  }, [puzzle.id, lesson]);

  useEffect(() => {
    if (solvedIn !== null) return;
    const t = setInterval(() => setNow(performance.now() - start.current), 1000);
    return () => clearInterval(t);
  }, [solvedIn]);

  // set once usePieces exists below; lets the solve check pull pieces into place
  const replacePieces = useRef<(p: PieceState[]) => void>(() => {});

  // counts the player's own moves (drops, turns, flips): the lesson's steps are checked only then
  const [moves, setMoves] = useState(0);

  const check = useCallback(
    (pieces: PieceState[]) => {
      if (!guide) return;
      setMoves((n) => n + 1);
      const { match, solved } = evaluate(pieces, guide);
      setMatch(match);
      session.current.best = Math.max(session.current.best, match);
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
        // the lesson's mostly-built square doesn't count as solving the real Square
        if (!lesson) onSolved(ms);
        if (!session.current.ended) {
          session.current.ended = true;
          logEvent(lesson ? { e: "tutorial_done", ms } : { e: "solve", p: puzzle.id, ms });
        }
        navigator.vibrate?.([30, 60, 30]);
      }
    },
    [guide, onSolved, puzzle, layout, lesson],
  );

  const slots = useMemo(
    () =>
      layout ? puzzle.solution.map((s) => ({ ...s, x: s.x + layout.target[0], y: s.y + layout.target[1] })) : undefined,
    [puzzle, layout],
  );
  const initial = useCallback(
    (l: Layout) => (lesson ? tutorialStart(l, puzzle.solution) : trayLayout(l)),
    [lesson, puzzle],
  );
  const g = usePieces(layout, initial, check, true, guide ?? undefined, slots);

  // the lesson: steps pass as the player does them (in any order), compared with the start.
  // The board resizes as the coach card's text changes (and on rotation), which shifts every
  // piece; the start is shifted the same way, and steps are only checked after the player's own
  // moves, so a resize never counts as a drag.
  const lessonStart = useRef<{ pieces: PieceState[]; layout: Layout } | null>(null);
  useEffect(() => {
    if (!lesson || !g.pieces || !layout || !guide) return;
    const start = lessonStart.current;
    if (!start) {
      lessonStart.current = { pieces: g.pieces, layout };
      setMatch(evaluate(g.pieces, guide).match); // five pieces start in place: show it
    } else if (start.layout !== layout) {
      lessonStart.current = { pieces: remap(start.pieces, start.layout, layout, true), layout };
    }
  }, [lesson, g.pieces, layout, guide]);
  const [passed, setPassed] = useState<Set<Step>>(new Set());
  useEffect(() => {
    if (!lesson || !moves || !g.pieces || !lessonStart.current) return;
    const from = lessonStart.current.pieces;
    const now = g.pieces;
    setPassed((p) => {
      const add = STEPS.filter((s) => !p.has(s) && stepDone(s, from, now, solvedIn !== null));
      return add.length ? new Set([...p, ...add]) : p;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lesson, moves, solvedIn]);
  const step = currentStep(passed);
  replacePieces.current = g.replace;
  const pct = Math.round(match * 100);

  // the finish caption goes in the space the tray leaves free: beside the figure in landscape,
  // below it in portrait (measured from the drawn shadow, which is where the figure ends up)
  const [finishBox, setFinishBox] = useState<React.CSSProperties | undefined>();
  const isNewBest = solvedIn !== null && previousBest.current !== undefined && Math.round(solvedIn) < previousBest.current;
  useLayoutEffect(() => {
    const stage = stageRef.current;
    const shadow = svgRef.current?.querySelector(".guide");
    if (solvedIn === null || !stage || !shadow || !layout) return;
    const s = stage.getBoundingClientRect();
    const f = shadow.getBoundingClientRect();
    const pad = 12;
    if (layout.orientation === "landscape") {
      const left = f.right - s.left + pad;
      setFinishBox({ left, right: pad, top: 0, bottom: 0 });
    } else {
      setFinishBox({ left: pad, right: pad, top: f.bottom - s.top + pad, bottom: 0 });
    }
  }, [solvedIn, layout]);

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
        subtitle:
          solvedIn !== null
            ? `Solved${nickname ? ` by ${nickname}` : ""} in ${formatTime(solvedIn)}`
            : `${nickname ? `${nickname} · in progress` : "In progress"} · ${pct}% matched`,
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
        <h2>{lesson ? "How to play" : puzzle.name}</h2>
        {!lesson && <span className="pill">⏱ {formatTime(solvedIn ?? now)}</span>}
        <span className="pill match" title="How much of the silhouette your pieces cover">
          <span className="meter">
            <span style={{ width: `${pct}%` }} />
          </span>
          {pct}%
        </span>
      </div>
      {tutorial && solvedIn === null && (
        <Coach
          step={step}
          touch={touch}
          onNext={() => setPassed((p) => new Set([...p, "goal"]))}
          onSkip={tutorial.onSkip}
        />
      )}
      <div className="stage" ref={stageRef}>
        {g.boardProps && guide && (
          <Board
            ref={svgRef}
            {...g.boardProps}
            guide={guide}
            solved={solvedIn !== null}
            hint={lesson ? HINT[step] : undefined}
          />
        )}
        {!lesson && <JointTip />}
        {/* gold flakes over the board; nothing covers the figure itself */}
        {solvedIn !== null && <CelebrationLayer />}
        {tutorial && solvedIn !== null && (
          <div className="finish" role="status" style={finishBox}>
            <p className="finish-line">
              <strong>🎉 You're ready!</strong>
            </p>
            <p className="finish-note">
              Pieces that share an edge stick together: drag the thin line between them to move them as one.
            </p>
            <div className="finish-actions">
              <button className="primary" onClick={() => tutorial.onFinish(false)}>
                Start playing →
              </button>
              <button onClick={() => tutorial.onFinish(true)}>Free play</button>
            </div>
          </div>
        )}
        {!lesson && solvedIn !== null && (
          <div className="finish" role="status" style={finishBox}>
            <p className="finish-line">
              <RevealMedal
                tier={medal(solvedIn, puzzle)}
                label={`${MEDAL_NAME[medal(solvedIn, puzzle)]} medal`}
              />
              <span className={`finish-tier ${medal(solvedIn, puzzle)}`}>{MEDAL_NAME[medal(solvedIn, puzzle)]}!</span>
              <span>{puzzle.name}</span>
              <span className="finish-dot" aria-hidden>
                ·
              </span>
              <strong>{formatTime(solvedIn)}</strong>
              {isNewBest && <span className="finish-best">new best</span>}
            </p>
            <div className="finish-actions">
              <button className="primary" onClick={onNext}>
                Next puzzle →
              </button>
              <button onClick={exportPng}>
                <span aria-hidden>⤓</span> Save image
              </button>
              <button onClick={onBack}>All puzzles</button>
            </div>
          </div>
        )}
      </div>
      <Toolbar
        selected={g.selected}
        onRotate={(d) => g.doRotate(g.selected, d)}
        onFlip={() => g.doFlip(g.selected)}
        onReset={() => {
          if (layout) g.reset(initial(layout));
          setMatch(0);
        }}
      >
        {!lesson && (
          <button onClick={exportPng}>
            <span aria-hidden>⤓</span> Export
          </button>
        )}
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
  const [nickname, setNickname] = useState(() => loadNickname()?.name ?? null);
  // first visit: ask for a name (not when arriving with a sync code, which brings its own)
  const [askName, setAskName] = useState(() => nickname === null && incomingCode === null);
  // first visit: after the name, a short lesson (unless they bring a sync code or have played before)
  const [lesson, setLesson] = useState(
    () => !tutorialDone() && incomingCode === null && Object.keys(loadProgress().solved).length === 0,
  );
  const [enterCode, setEnterCode] = useState(false);
  const endLesson = useCallback((next: Mode) => {
    markTutorialDone();
    setLesson(false);
    setMode(next);
  }, []);
  const lessonHandlers = useMemo(
    () => ({ onFinish: (goFree: boolean) => endLesson(goFree ? "free" : "puzzles"), onSkip: () => endLesson("puzzles") }),
    [endLesson],
  );

  /** A name the player typed beats names on other devices; an untouched suggestion never does. */
  const changeNickname = useCallback((name: string, typed: boolean) => {
    saveNickname({ name, at: typed ? Date.now() : 0 });
    setNickname(name);
    setAskName(false);
    scheduleSync();
  }, []);

  // progress from other devices: on load, and whenever a sync brings something new
  useEffect(() => {
    const reload = () => {
      const p = loadProgress();
      progressRef.current = p;
      setProgress(p);
      setNickname(loadNickname()?.name ?? null);
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
      const inPuzzle = mode === "puzzles" && puzzle;
      logEvent(kind === "exports" ? { e: "export", ...(inPuzzle ? { p: puzzle.id } : {}) } : { e: "design_save" });
      // a saved design is worth keeping, so it creates the account like a solve does
      scheduleSync(kind === "designsSaved");
    },
    [updateProgress, mode, puzzle],
  );

  useEffect(() => {
    if (mode === "free") logEvent({ e: "free_open" });
  }, [mode]);

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
    setPuzzle(randomNext(PUZZLES, puzzle.id, progressRef.current.solved));
  };

  const playing = lesson || mode === "free" || puzzle !== null;
  const switchMode = (m: Mode) => {
    if (lesson) endLesson(m);
    else setMode(m);
  };

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
          <button className={mode === "puzzles" ? "active" : ""} onClick={() => switchMode("puzzles")}>
            Puzzles
          </button>
          <button className={mode === "free" ? "active" : ""} onClick={() => switchMode("free")}>
            Free play
          </button>
        </nav>
      </header>
      <main>
        {lesson && (
          <PuzzlePlay
            key="tutorial"
            puzzle={TUTORIAL}
            nickname={nickname}
            tutorial={lessonHandlers}
            touch={touch}
            onSolved={onSolved}
            onTrack={track}
            onNext={lessonHandlers.onSkip}
            onBack={lessonHandlers.onSkip}
          />
        )}
        {!lesson && mode === "free" && <FreePlay nickname={nickname} onTrack={track} />}
        {!lesson &&
          mode === "puzzles" &&
          (puzzle ? (
            <PuzzlePlay
              key={puzzle.id}
              puzzle={puzzle}
              nickname={nickname}
              touch={touch}
              best={solved[puzzle.id]}
              onSolved={onSolved}
              onTrack={track}
              onNext={next}
              onBack={() => setPuzzle(null)}
            />
          ) : (
            <PuzzlePicker puzzles={PUZZLES} solved={solved} onPick={setPuzzle} onHowTo={() => setLesson(true)} />
          ))}
      </main>
      {showBadges && (
        <BadgesSheet
          badges={badges}
          incomingCode={incomingCode}
          enterCode={enterCode}
          nickname={nickname}
          onNickname={changeNickname}
          onClose={() => {
            setShowBadges(false);
            setEnterCode(false);
          }}
        />
      )}
      {askName && (
        <NicknamePrompt
          onSave={changeNickname}
          onHaveCode={() => {
            // played before: no name or lesson needed, the account brings them
            setAskName(false);
            setLesson(false);
            setEnterCode(true);
            setShowBadges(true);
          }}
        />
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
