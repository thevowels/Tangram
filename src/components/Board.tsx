import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { PIECE_BY_ID, PIECES, piecePolygon, pieceTransform, type PieceState } from "../geometry/pieces";
import { bounds, groupCentroid, sharedEdges, toPath, type Poly, type Vec } from "../geometry/polygon";
import { snap, turnBy } from "../game/actions";
import {
  lockedIds,
  moveWithPush,
  STICK_MIN_LENGTH,
  STICK_TOL,
  stickyGroups,
  type Board as BoardSize,
} from "../physics/resolve";

interface Props {
  board: BoardSize;
  pieces: PieceState[];
  /** Selected piece ids: one piece, or a whole joined group. */
  selected: string[];
  guide?: Poly[];
  solved?: boolean;
  onSelect(ids: string[]): void;
  /** Live updates while dragging. */
  onChange(pieces: PieceState[]): void;
  /** A move finished (drop); good time to check for a solution. */
  onSettle(pieces: PieceState[]): void;
  onRotate(ids: string[], dir: 1 | -1): void;
  onFlip(ids: string[]): void;
}

interface Drag {
  /** Pieces being moved: one piece, or a whole group when grabbed by a joint. */
  ids: string[];
  pointerId: number;
  grab: Vec; // pointer offset from the first piece's centre
  start: Vec;
  startTime: number;
  moved: boolean;
  wasSelected: boolean;
  at: Vec; // latest pointer position
}

/** A second finger twisting the dragged piece(s) around the first one. */
interface Twist {
  pointerId: number;
  at: Vec;
  startAngle: number;
  applied: number; // 45° steps applied so far
}

/** A stretch of edge shared by two joined pieces. */
interface Joint {
  a: Vec;
  b: Vec;
  piece: string;
  group: string[];
}

const TAP_TIME = 300;
const TAP_PX = 6; // movement under this many screen px still counts as a tap
const BUTTON_PX = 22; // radius of the floating action buttons on screen
const JOINT_HIT_PX = { touch: 22, mouse: 12 }; // grab width of a joint line on screen

const buzz = (ms: number) => navigator.vibrate?.(ms);
const angleOf = (a: Vec, b: Vec) => (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI;
const wrap180 = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Blend two #rrggbb colours; t=0 gives `a`, t=1 gives `b`. */
function mix(a: string, b: string, t: number) {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return "#" + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, "0")).join("");
}

/**
 * Keep a continuous display angle per piece so CSS transitions take the short way round
 * (e.g. 315° → 360°, not 315° → 0°).
 */
function useDisplayAngles(pieces: PieceState[]) {
  const angles = useRef(new Map<string, number>());
  const out = new Map<string, number>();
  for (const p of pieces) {
    const target = pieceTransform(p).deg;
    const prev = angles.current.get(p.id);
    let deg = target;
    if (prev !== undefined) deg = prev + wrap180(target - prev);
    out.set(p.id, deg);
  }
  angles.current = out;
  return out;
}

/** Every shared edge between joined pieces, tagged with the group it belongs to. */
function findJoints(pieces: PieceState[]): Joint[] {
  const polys = pieces.map(piecePolygon);
  const group = stickyGroups(pieces, new Set(), polys);
  const joints: Joint[] = [];
  for (let i = 0; i < pieces.length; i++) {
    for (let j = i + 1; j < pieces.length; j++) {
      for (const [a, b] of sharedEdges(polys[i], polys[j], STICK_TOL, STICK_MIN_LENGTH)) {
        const members = pieces.filter((_, k) => group[k] === group[i]).map((p) => p.id);
        joints.push({ a, b, piece: pieces[i].id, group: members });
      }
    }
  }
  return joints;
}

export const Board = forwardRef<SVGSVGElement, Props>(function Board(
  { board, pieces, selected, guide, solved, onSelect, onChange, onSettle, onRotate, onFlip },
  ref,
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const drag = useRef<Drag | null>(null);
  const twist = useRef<Twist | null>(null);
  const [dragging, setDragging] = useState<string[]>([]);
  const [twisting, setTwisting] = useState(false);
  const [hoverGroup, setHoverGroup] = useState<string[]>([]);
  const [flash, setFlash] = useState<{ at: Vec; key: number } | null>(null);
  const [unitPx, setUnitPx] = useState(40); // screen px per board unit
  const touch = useMemo(() => matchMedia("(pointer: coarse)").matches, []);
  const angles = useDisplayAngles(pieces);
  const joints = useMemo(() => findJoints(pieces), [pieces]);
  const locked = useMemo(() => lockedIds(pieces, board, new Set(dragging)), [pieces, board, dragging]);

  useLayoutEffect(() => {
    const svg = svgRef.current!;
    // the viewBox is letterboxed inside the element, so ask the CTM rather than the width
    const update = () => setUnitPx(svg.getScreenCTM()?.a || 40);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(svg);
    return () => ro.disconnect();
  }, [board.width]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 450);
    return () => clearTimeout(t);
  }, [flash]);

  const toWorld = (e: PointerEvent): Vec => {
    const svg = svgRef.current!;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM()!.inverse());
    return [p.x, p.y];
  };

  const capture = (e: PointerEvent) => {
    try {
      svgRef.current!.setPointerCapture(e.pointerId);
    } catch {
      // synthetic or already-released pointers can't be captured; harmless
    }
  };

  /** Second finger down while dragging: twist the piece(s) around the first finger. */
  const startTwist = (e: PointerEvent) => {
    const d = drag.current!;
    if (twist.current || e.pointerId === d.pointerId) return;
    const w = toWorld(e);
    capture(e);
    twist.current = { pointerId: e.pointerId, at: w, startAngle: angleOf(d.at, w), applied: 0 };
    d.moved = true;
    setDragging(d.ids);
    setTwisting(true);
  };

  /** Rotate in 45° steps as the angle between the two fingers changes. */
  const applyTwist = () => {
    const d = drag.current;
    const t = twist.current;
    if (!d || !t) return;
    const steps = Math.round(wrap180(angleOf(d.at, t.at) - t.startAngle) / 45);
    if (steps === t.applied) return;
    const next = turnBy(piecesRef.current, d.ids, (steps - t.applied) * 45, board);
    if (!next) return;
    t.applied = steps;
    piecesRef.current = next;
    // the grabbed piece's centre may have swung round the group centre: keep the grip
    const anchor = next.find((p) => p.id === d.ids[0])!;
    d.grab = [d.at[0] - anchor.x, d.at[1] - anchor.y];
    onChange(next);
    buzz(5);
  };

  const startDrag = (e: PointerEvent, ids: string[]) => {
    const anchor = piecesRef.current.find((q) => q.id === ids[0])!;
    const w = toWorld(e);
    capture(e);
    drag.current = {
      ids,
      pointerId: e.pointerId,
      grab: [w[0] - anchor.x, w[1] - anchor.y],
      start: w,
      startTime: performance.now(),
      moved: false,
      wasSelected: sameSet(ids, selected),
      at: w,
    };
    onSelect(ids);
  };

  /** Pressing a piece moves just that piece (pulling it out of any group). */
  const onPieceDown = (e: PointerEvent, id: string) => {
    if (solved) return;
    e.stopPropagation();
    if (drag.current) startTwist(e);
    else startDrag(e, [id]);
  };

  /** Pressing a joint line moves the whole joined group. */
  const onJointDown = (e: PointerEvent, j: Joint) => {
    if (solved) return;
    e.stopPropagation();
    if (drag.current) startTwist(e);
    else startDrag(e, [j.piece, ...j.group.filter((id) => id !== j.piece)]);
  };

  const onBoardDown = (e: PointerEvent) => {
    if (drag.current) startTwist(e);
    else onSelect([]);
  };

  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const w = toWorld(e);
    if (twist.current?.pointerId === e.pointerId) {
      twist.current.at = w;
      applyTwist();
      return;
    }
    if (d.pointerId !== e.pointerId) return;
    d.at = w;
    if (!d.moved) {
      if (Math.hypot(w[0] - d.start[0], w[1] - d.start[1]) * unitPx < TAP_PX) return;
      d.moved = true;
      setDragging(d.ids);
    }
    const next = moveWithPush(piecesRef.current, d.ids, [w[0] - d.grab[0], w[1] - d.grab[1]], board);
    piecesRef.current = next;
    onChange(next);
    applyTwist();
  };

  const onUp = (e: PointerEvent) => {
    if (twist.current?.pointerId === e.pointerId) {
      // second finger lifted: keep dragging with the first
      twist.current = null;
      setTwisting(false);
      return;
    }
    const d = drag.current;
    if (!d || d.pointerId !== e.pointerId) return;
    drag.current = null;
    twist.current = null;
    setTwisting(false);
    setDragging([]);
    if (!d.moved) {
      // tapping what's already selected rotates it; the first tap only selects
      if (performance.now() - d.startTime < TAP_TIME && d.wasSelected) onRotate(d.ids, 1);
      return;
    }
    const snapped = snap(piecesRef.current, d.ids, guide ?? [], board);
    if (snapped) {
      piecesRef.current = snapped.pieces;
      setFlash({ at: snapped.at, key: Date.now() });
      buzz(8);
    }
    onSettle(piecesRef.current);
  };

  // draw the selection on top
  const ordered = [...pieces].sort((a, b) => Number(selected.includes(a.id)) - Number(selected.includes(b.id)));
  // the floating controls follow a moving piece on desktop (faded); on touch they get out of the way
  const moving = dragging.length > 0;
  const selPieces = !solved && (!moving || !touch) ? pieces.filter((p) => selected.includes(p.id)) : [];
  const groupSelected = selected.length > 1;
  const hitWidth = (touch ? JOINT_HIT_PX.touch : JOINT_HIT_PX.mouse) / unitPx;

  return (
    <svg
      ref={(el) => {
        svgRef.current = el;
        if (typeof ref === "function") ref(el);
        else if (ref) ref.current = el;
      }}
      className={"board" + (dragging.length ? " is-dragging" : "") + (twisting ? " is-twisting" : "")}
      viewBox={`0 0 ${board.width} ${board.height}`}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onPointerDown={onBoardDown}
    >
      <defs>
        {PIECES.map((p) => (
          <linearGradient key={p.id} id={`tan-${p.id}`} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={mix(p.color, "#ffffff", 0.28)} />
            <stop offset="0.55" stopColor={p.color} />
            <stop offset="1" stopColor={mix(p.color, "#1a0b3d", 0.22)} />
          </linearGradient>
        ))}
      </defs>
      {guide && <path className={solved ? "guide solved" : "guide"} d={toPath(guide)} fillRule="evenodd" />}
      {ordered.map((p) => {
        const def = PIECE_BY_ID[p.id];
        const { sx } = pieceTransform(p);
        return (
          <path
            key={p.id}
            className={
              "piece" +
              (selected.includes(p.id) ? (groupSelected ? " in-group" : " selected") : "") +
              (dragging.includes(p.id) ? " lifted" : "") +
              (hoverGroup.includes(p.id) ? " group-hover" : "") +
              (locked.has(p.id) && !solved ? " locked" : "") +
              (solved ? " solved" : "")
            }
            d={toPath([def.shape])}
            style={{ transform: `translate(${p.x}px, ${p.y}px) scaleX(${sx}) rotate(${angles.get(p.id)}deg)` }}
            fill={`url(#tan-${p.id})`}
            onPointerDown={(e) => onPieceDown(e, p.id)}
          />
        );
      })}
      {groupSelected && !dragging.length && (
        <path className="group-outline" d={toPath(selPieces.map(piecePolygon))} />
      )}
      {!solved && (
        <g className={"joints" + (dragging.length ? " hidden" : "")}>
          {joints.map((j, i) => (
            <g key={i}>
              <line className="joint" x1={j.a[0]} y1={j.a[1]} x2={j.b[0]} y2={j.b[1]} />
              <line
                className="joint-hit"
                x1={j.a[0]}
                y1={j.a[1]}
                x2={j.b[0]}
                y2={j.b[1]}
                strokeWidth={hitWidth}
                onPointerDown={(e) => onJointDown(e, j)}
                onPointerEnter={() => setHoverGroup(j.group)}
                onPointerLeave={() => setHoverGroup([])}
              >
                <title>Drag to move the joined pieces together</title>
              </line>
            </g>
          ))}
        </g>
      )}
      {twisting && dragging.length > 0 && (() => {
        const [cx, cy] = groupCentroid(pieces.filter((q) => dragging.includes(q.id)).map(piecePolygon));
        return <circle className="twist-ring" cx={cx} cy={cy} r={dragging.length > 1 ? 2.6 : 1.7} />;
      })()}
      {selPieces.length > 0 && (
        <PieceActions
          moving={moving}
          ids={selected}
          polys={selPieces.map(piecePolygon)}
          board={board}
          unitPx={unitPx}
          onRotate={onRotate}
          onFlip={onFlip}
        />
      )}
      {flash && <circle key={flash.key} className="snap-flash" cx={flash.at[0]} cy={flash.at[1]} r={0.25} />}
    </svg>
  );
});

/** Floating rotate / flip buttons beside the selection, sized in screen pixels. */
function PieceActions({
  moving,
  ids,
  polys,
  board,
  unitPx,
  onRotate,
  onFlip,
}: {
  moving: boolean;
  ids: string[];
  polys: Poly[];
  board: BoardSize;
  unitPx: number;
  onRotate(ids: string[], dir: 1 | -1): void;
  onFlip(ids: string[]): void;
}) {
  const r = BUTTON_PX / unitPx;
  const gap = r * 0.5;
  const b = bounds(polys);
  const width = r * 6 + gap * 2;
  // above the selection if there's room, otherwise below; kept inside the board
  let y = b.minY - r - gap;
  if (y - r < 0) y = b.maxY + r + gap;
  y = Math.min(Math.max(y, r), board.height - r);
  let x = (b.minX + b.maxX) / 2 - width / 2 + r;
  x = Math.min(Math.max(x, r), board.width - width + r);

  const what = ids.length > 1 ? "group" : "piece";
  const buttons: { label: string; icon: string; act(): void }[] = [
    { label: `Rotate ${what} left`, icon: "↺", act: () => onRotate(ids, -1) },
    { label: `Rotate ${what} right`, icon: "↻", act: () => onRotate(ids, 1) },
    { label: `Flip ${what}`, icon: "⇋", act: () => onFlip(ids) },
  ];
  return (
    <g className={"piece-actions" + (moving ? " moving" : "")}>
      {buttons.map((btn, i) => (
        <g key={btn.label} transform={`translate(${x + i * (2 * r + gap)}, ${y})`}>
          <g
            className="action"
            role="button"
            aria-label={btn.label}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => {
              e.stopPropagation();
              btn.act();
            }}
          >
            <title>{btn.label}</title>
            <circle r={r} />
            <text fontSize={r * 1.15} dy={r * 0.4}>
              {btn.icon}
            </text>
          </g>
        </g>
      ))}
    </g>
  );
}
