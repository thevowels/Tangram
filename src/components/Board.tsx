import { forwardRef, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent } from "react";
import { PIECE_BY_ID, PIECES, piecePolygon, pieceTransform, type PieceState } from "../geometry/pieces";
import { bounds, cornerJoints, groupCentroid, toPath, type Poly, type Vec } from "../geometry/polygon";
import { snap, turnBy } from "../game/actions";
import { slotSnap } from "../game/check";
import {
  lockedIds,
  dragTo,
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
  /** The puzzle's exact spots (solution placed on the board): close, correctly turned pieces pull in. */
  slots?: PieceState[];
  solved?: boolean;
  /** Pieces to point at (the tutorial's current target): they pulse. */
  hint?: string[];
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

/** Two fingers twisting the selection in place (neither of them dragging it). */
interface FreeTwist {
  ids: string[];
  fingers: Map<number, Vec>;
  startAngle: number;
  applied: number; // 45° steps applied so far
}

/**
 * A finger resting near the selection (on empty space or a floating button), waiting to see
 * what it becomes: a tap, a one-finger dial (if it moves), or a two-finger twist.
 */
interface Pending {
  pointerId: number;
  at: Vec;
  startTime: number;
  /** What a plain tap does: press the button it started on, or clear the selection. */
  onTap(): void;
  fromButton: boolean;
}

/** One finger circling inside the zone: the selection turns to follow it, like a joystick. */
interface Dial {
  pointerId: number;
  ids: string[];
  centre: Vec;
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
/** How far around the selection a finger may land and still twist it. */
const ZONE_MARGIN = { units: 0.9, px: 56 };
/** A dial finger this close to the centre has no meaningful angle; ignore it until it moves out. */
const DIAL_DEAD_ZONE = 0.35;

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
      for (const [a, b] of cornerJoints(polys[i], polys[j], STICK_TOL, STICK_MIN_LENGTH)) {
        const members = pieces.filter((_, k) => group[k] === group[i]).map((p) => p.id);
        joints.push({ a, b, piece: pieces[i].id, group: members });
      }
    }
  }
  return joints;
}

export const Board = forwardRef<SVGSVGElement, Props>(function Board(
  { board, pieces, selected, guide, slots, solved, hint, onSelect, onChange, onSettle, onRotate, onFlip },
  ref,
) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const piecesRef = useRef(pieces);
  piecesRef.current = pieces;
  const drag = useRef<Drag | null>(null);
  const twist = useRef<Twist | null>(null);
  const freeTwist = useRef<FreeTwist | null>(null);
  const pending = useRef<Pending | null>(null);
  const dial = useRef<Dial | null>(null);
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

  /** After a move or turn: pull into an exact spot if one is close, else snap to nearby edges. */
  const snapAfter = (ids: string[]) =>
    (slots && slotSnap(piecesRef.current, ids, slots)) || snap(piecesRef.current, ids, guide ?? [], board);

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

  /** The circle around some pieces inside which a second finger counts as twisting them. */
  const zoneOf = (ids: string[]) => {
    const polys = piecesRef.current.filter((p) => ids.includes(p.id)).map(piecePolygon);
    if (!polys.length) return null;
    const c = groupCentroid(polys);
    const reach = Math.max(...polys.flat().map(([x, y]) => Math.hypot(x - c[0], y - c[1])));
    return { c, r: reach + Math.max(ZONE_MARGIN.units, ZONE_MARGIN.px / unitPx) };
  };
  const inZone = (ids: string[], w: Vec) => {
    const z = zoneOf(ids);
    return !!z && Math.hypot(w[0] - z.c[0], w[1] - z.c[1]) <= z.r;
  };

  /** Two fingers near the selection: rotate it in place as they turn. */
  const startFreeTwist = (first: Pending, e: PointerEvent) => {
    const w = toWorld(e);
    capture(e);
    pending.current = null;
    freeTwist.current = {
      ids: selected,
      fingers: new Map([
        [first.pointerId, first.at],
        [e.pointerId, w],
      ]),
      startAngle: angleOf(first.at, w),
      applied: 0,
    };
    setDragging(selected);
    setTwisting(true);
  };

  const applyFreeTwist = () => {
    const t = freeTwist.current;
    if (!t) return;
    const [a, b] = [...t.fingers.values()];
    const steps = Math.round(wrap180(angleOf(a, b) - t.startAngle) / 45);
    if (steps === t.applied) return;
    const next = turnBy(piecesRef.current, t.ids, (steps - t.applied) * 45, board);
    if (!next) return;
    t.applied = steps;
    piecesRef.current = next;
    onChange(next);
    buzz(5);
  };

  /** The resting finger started moving: turn it into a one-finger rotation dial. */
  const startDial = (p: Pending, w: Vec) => {
    const z = zoneOf(selected);
    if (!z) return;
    pending.current = null;
    dial.current = { pointerId: p.pointerId, ids: selected, centre: z.c, startAngle: angleOf(z.c, p.at), applied: 0 };
    setDragging(selected);
    setTwisting(true);
    applyDial(w);
  };

  const applyDial = (w: Vec) => {
    const d = dial.current;
    if (!d || Math.hypot(w[0] - d.centre[0], w[1] - d.centre[1]) < DIAL_DEAD_ZONE) return;
    const steps = Math.round(wrap180(angleOf(d.centre, w) - d.startAngle) / 45);
    if (steps === d.applied) return;
    const next = turnBy(piecesRef.current, d.ids, (steps - d.applied) * 45, board);
    if (!next) return;
    d.applied = steps;
    piecesRef.current = next;
    onChange(next);
    buzz(5);
  };

  /** Second finger down while dragging: twist the piece(s) around the first finger. */
  const startTwist = (e: PointerEvent) => {
    const d = drag.current!;
    if (twist.current || e.pointerId === d.pointerId) return;
    const w = toWorld(e);
    if (!inZone(d.ids, w)) return; // only fingers near the piece count
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

  /**
   * A finger that lands while another is already busy: twist (if it's near the selection)
   * rather than start a second, competing gesture. Returns true if it was handled.
   */
  const secondFinger = (e: PointerEvent) => {
    if (freeTwist.current || dial.current) return true;
    if (drag.current) {
      startTwist(e);
      return true;
    }
    if (pending.current && pending.current.pointerId !== e.pointerId && inZone(selected, toWorld(e))) {
      startFreeTwist(pending.current, e);
      return true;
    }
    return false;
  };

  /** Pressing a piece moves just that piece (pulling it out of any group). */
  const onPieceDown = (e: PointerEvent, id: string) => {
    if (solved) return;
    e.stopPropagation();
    if (secondFinger(e)) return;
    pending.current = null;
    startDrag(e, [id]);
  };

  /** Pressing a joint line moves the whole joined group. */
  const onJointDown = (e: PointerEvent, j: Joint) => {
    if (solved) return;
    e.stopPropagation();
    if (secondFinger(e)) return;
    pending.current = null;
    startDrag(e, [j.piece, ...j.group.filter((id) => id !== j.piece)]);
  };

  /**
   * Empty space: near the selection, a finger waits for a second one to twist with;
   * anywhere else (or a lone tap) clears the selection.
   */
  /** A floating button: tap to press it, or start circling from it to use the dial. */
  const onButtonDown = (e: PointerEvent, act: () => void) => {
    e.stopPropagation();
    if (secondFinger(e)) return;
    capture(e);
    pending.current = { pointerId: e.pointerId, at: toWorld(e), startTime: performance.now(), onTap: act, fromButton: true };
  };

  const onBoardDown = (e: PointerEvent) => {
    if (secondFinger(e)) return;
    const w = toWorld(e);
    if (!solved && selected.length && inZone(selected, w)) {
      capture(e);
      pending.current = {
        pointerId: e.pointerId,
        at: w,
        startTime: performance.now(),
        onTap: () => onSelect([]),
        fromButton: false,
      };
    } else {
      onSelect([]);
    }
  };

  const onMove = (e: PointerEvent) => {
    const ft = freeTwist.current;
    if (ft?.fingers.has(e.pointerId)) {
      ft.fingers.set(e.pointerId, toWorld(e));
      applyFreeTwist();
      return;
    }
    if (dial.current?.pointerId === e.pointerId) {
      applyDial(toWorld(e));
      return;
    }
    const pd = pending.current;
    if (pd?.pointerId === e.pointerId) {
      const w = toWorld(e);
      // moved enough to mean it: the finger becomes a rotation dial
      if (Math.hypot(w[0] - pd.at[0], w[1] - pd.at[1]) * unitPx >= TAP_PX) startDial(pd, w);
      return;
    }
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
    const next = dragTo(piecesRef.current, d.ids, [w[0] - d.grab[0], w[1] - d.grab[1]], board);
    piecesRef.current = next;
    onChange(next);
    applyTwist();
  };

  const onUp = (e: PointerEvent) => {
    const ft = freeTwist.current;
    if (ft?.fingers.has(e.pointerId)) {
      // either finger lifted: the twist is over
      freeTwist.current = null;
      setTwisting(false);
      setDragging([]);
      if (ft.applied) {
        const snapped = snapAfter(ft.ids);
        if (snapped) piecesRef.current = snapped.pieces;
        onSettle(piecesRef.current);
      }
      return;
    }
    const dl = dial.current;
    if (dl?.pointerId === e.pointerId) {
      dial.current = null;
      setTwisting(false);
      setDragging([]);
      if (dl.applied) {
        const snapped = snapAfter(dl.ids);
        if (snapped) piecesRef.current = snapped.pieces;
        onSettle(piecesRef.current);
      }
      return;
    }
    const p = pending.current;
    if (p?.pointerId === e.pointerId) {
      // a tap that never became a dial: press the button, or (on empty space) deselect
      pending.current = null;
      if (p.fromButton || performance.now() - p.startTime < TAP_TIME) p.onTap();
      return;
    }
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
    const snapped = snapAfter(d.ids);
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
      <g className={"pieces" + (solved ? " solved-figure" : "")}>
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
              (solved ? " solved" : "") +
              (hint?.includes(p.id) && !solved ? " hint" : "")
            }
            d={toPath([def.shape])}
            style={{
              transform: `translate(${p.x}px, ${p.y}px) scaleX(${sx}) rotate(${angles.get(p.id)}deg)`,
              // solved: no light outline; a hair of the piece's own colour hides the seams
              ...(solved ? { stroke: `url(#tan-${p.id})` } : {}),
            }}
            fill={`url(#tan-${p.id})`}
            onPointerDown={(e) => onPieceDown(e, p.id)}
          />
        );
      })}
      </g>
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
      {!solved && (touch || twisting) && (() => {
        const ids = dragging.length ? dragging : selected;
        const z = ids.length ? zoneOf(ids) : null;
        return z && <circle className={"twist-zone" + (twisting ? " active" : "")} cx={z.c[0]} cy={z.c[1]} r={z.r} />;
      })()}
      {selPieces.length > 0 && (
        <PieceActions
          onButtonDown={onButtonDown}
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
  onButtonDown,
  moving,
  ids,
  polys,
  board,
  unitPx,
  onRotate,
  onFlip,
}: {
  onButtonDown(e: PointerEvent, act: () => void): void;
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
            onPointerDown={(e) => onButtonDown(e, btn.act)}
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
