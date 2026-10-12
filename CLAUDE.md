# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An interactive tangram player: React + TypeScript (Vite) deployed as a Cloudflare Worker with static assets. It has two modes:
- **Free play:** arrange the 7 tans; save designs to localStorage; export PNG.
- **Puzzles:** fill one of 20 hand-authored silhouettes (`scripts/figures.ts`). `tangram_asset.jpg` is the user's original inspiration sheet; it isn't used by the code.

## Commands

```bash
npm run dev          # Vite dev server (runs the Worker in workerd via @cloudflare/vite-plugin)
npm run build        # tsc -b (app + worker projects) then vite build → dist/client + dist/tangram
npm test             # vitest run (all src/**/*.test.ts)
npx vitest run -t "push physics"   # run a single describe/test by name
npm run puzzles      # rebuild src/data/puzzles.json from scripts/figures.ts + write scripts/out/preview.png
npm run deploy       # build + wrangler deploy (requires wrangler login)
```

Vitest uses its own `vitest.config.ts` on purpose. Loading `vite.config.ts` pulls in the Cloudflare plugin, which fails under vitest with "There is already a server associated with the config".

## Architecture

**Units and coordinates.** Everything is in "tan units": a small triangle has legs of 1, so the 7 pieces total area 8. The board is an SVG whose `viewBox` is the board size in tan units. Pointer positions are converted with `getScreenCTM().inverse()`, and screen px per unit comes from `getScreenCTM().a`, because the viewBox is letterboxed inside the element.

**Responsive layouts** (`src/game/layout.ts`). There is no visible board: the SVG fills the `.stage` element and pieces sit directly on the page backdrop. So the board is fitted to the stage:
- `useFitLayout` in `App.tsx` measures the stage with a ResizeObserver and calls `fitLayout(w, h)`.
- `fitLayout` picks landscape (silhouette left, tray right) or portrait (silhouette top, tray below), whichever gives bigger pieces. Each has a minimum size (`MIN_LANDSCAPE` / `MIN_PORTRAIT`), and px-per-unit is capped at `MAX_UNIT_PX`.
- The board's aspect ratio matches the stage exactly, so the invisible walls are the stage edges. The silhouette and tray stay grouped around the centre.
- Pieces are created only once the layout is known; `usePieces` starts with `null`.
- On every resize, `remap()` moves each piece by its offset from the nearest anchor (silhouette or tray in puzzles, board centre in free play), so a half-built figure survives resizes and phone rotation.
- Saved designs store the `Layout` they were made on and are remapped when loaded.
- `LANDSCAPE` / `PORTRAIT` are fixed reference layouts, used by tests and as the fallback for old saves.
- If you change minimum sizes or anchors, make sure the tallest silhouette (≈6.6 units) still clears the tray; the `layouts` tests check the tray fits.

**Piece model** (`src/geometry/pieces.ts`):
- Each piece's `shape` is its polygon in the classic 2√2 square layout, re-centered on its centroid. `rot: 0` therefore means "as in the square", and `squareLayout()` reproduces the solved square.
- `PieceState` is `{id, x, y, rot (degrees, [0, 360)), flipped}`. World polygons always come from `piecePolygon()`.
- The UI only produces 45° multiples: buttons and taps use `step45()`, and the twist gesture snaps to 45°. Free angles are representable but not used.
- Free-play designs saved before rotations were in degrees stored 45° steps (0..7). `loadDesigns()` migrates any design without `v: 2`.
- `flipped` mirrors the local shape before rotating. `piecePolygon()` reverses the vertex order then, so winding stays consistent.
- **Every piece is flippable.** `flip()` in `game/actions.ts` mirrors left↔right *on screen*, not along the piece's own axis. Since R(rot)·M = M·R(-rot), that means `rot → -rot` plus toggling `flipped`.
- Rendering doesn't use `piecePolygon()`. Each `<path>` draws the local `shape` with a CSS transform `translate · scaleX(sx) · rotate(deg)` from `pieceTransform()`, so rotate/flip/snap animate via CSS transitions. Transitions are switched off while dragging (`.board.is-dragging`).
- `useDisplayAngles` in `Board.tsx` keeps angles continuous, so 315°→0° animates the short way. A test checks that `pieceTransform` and `piecePolygon` agree; keep them in sync.

**No-overlap physics** (`src/physics/resolve.ts`). Pieces never overlap; dragging pushes pieces out of the way.
- `resolve()` runs iterative SAT separation (`mtv()` in `geometry/polygon.ts`; all tans are convex). One piece is held fixed, pieces it overlaps are pushed fully, and other pairs split the push. Pieces are clamped to the board.
- **Sticky groups:** `stickyGroups()` links pieces that share an edge into connected components, recomputed on every `resolve()` call.
  - "Share an edge" means `sharedEdges()` in `geometry/polygon.ts` finds parallel edges within `STICK_TOL` that overlap by ≥ `STICK_MIN_LENGTH`. Corner-to-corner or tip-to-edge touches do **not** join pieces.
  - Collisions shift a whole group rigidly, and board clamping is per group, so bumping a built figure never breaks it apart.
- **Locking to the outline:** in puzzles the physics board carries `outline`, the placed silhouette. `usePieces` builds `{ ...layout.board, outline }`.
  - `isLocked()`: a piece is locked when it sits inside the silhouette with an edge flush against its border.
  - `lockedIds()`: locked pieces plus everything joined to them.
  - Locked groups are walls in `resolve()`: never pushed or clamped. A move that would push one returns `null`, so the mover stops or slides.
  - Dragging a locked piece yourself still works, because moving pieces are excluded. Locked pieces get the golden `.piece.locked` glow.
- **Performance:**
  - `resolve()` returns immediately when nothing overlaps; groups and locks are only computed once something collides.
  - `moveWithPush()` stops sub-stepping once a step makes no progress.
  - Keep both. Without them, pushing against a locked piece costs ~11 resolves × ~30 sub-steps per pointer move, and the page stalls.
- **What moves:** `resolve(pieces, fixed)`, `moveWithPush(pieces, ids, …)` and `transformWithPush(pieces, states[])` all accept several pieces, which then move as one rigid body. Those `fixed` pieces are excluded from grouping during the move, so nothing new latches onto the body mid-drag.
- `resolve()` returns `null` when it can't settle, e.g. pieces jammed against a wall.
- `moveWithPush()` subdivides a drag into ≤0.2-unit steps so pieces can't tunnel. Each step tries the direct move, then axis-aligned slides, then bisects toward the furthest valid point.
- `transformWithPush()` is used for rotate/flip/snap; a `null` result means the action is rejected.
- Touching (overlap ≤ `EPS`) is not a collision. That is what lets snapped pieces sit flush.

**Snapping** (`src/geometry/snap.ts`). On drop, `findSnap()` picks the smallest offset within `SNAP_DISTANCE`:
- Vertex↔vertex matches are preferred over vertex↔edge projections.
- Targets are the other pieces plus the puzzle silhouette ("guides").
- A candidate is skipped if it would create an overlap.
- The UI wiring is in `game/actions.ts` and `components/Board.tsx` (`onUp`).

**Solve detection** (`src/game/check.ts`). `coverage()` is a grid-sampled IoU (even-odd point-in-polygon) between the pieces and the silhouette. The sample grid is offset by odd fractions (`OFF_X`/`OFF_Y`) so samples never land exactly on the integer-coordinate edges shared by two pieces. `evaluate()` returns two things:
- the **in-place** match, shown as "Match %";
- `solved`, which is true when either the in-place IoU or the **centroid-aligned** IoU reaches `SOLVE_THRESHOLD`, so a figure built anywhere on the board counts.

No per-puzzle solution data exists. Any arrangement whose shape matches the silhouette wins.

**Puzzle authoring** (`scripts/figures.ts` → `scripts/build-puzzles.ts` → `src/data/puzzles.json`):
- **Authoring:** each figure lists its 7 pieces as exact polygons. Use helpers rather than hand-typing coordinates:
  - `tri` (right angle, legs in a direction), `sq`, `para`, `raw`, plus `go(p, deg, len)`, which is exact for 45° multiples;
  - sub-assemblies `smallSquare()` (2×2 square), `strip()` (4×1), `roof()` (two large triangles) and `classicSmall()`.
- **Validation** (`npm run puzzles`), per figure:
  - every polygon must be congruent to a real piece; it is matched to an id, rotation and flip;
  - all 7 pieces must be used, with no overlaps, and they must be connected.
  - Errors are printed and the JSON is not written.
- **Outline:** the silhouette is built by edge cancellation (`outline()`): weld vertices, split edges at T-junctions, cancel shared segments, then chain the rest into loops. Don't swap in a polygon-clipping union; √2 rounding leaves seams along partially shared edges.
- **Loops:** multiple loops are normal. They come from holes or pieces touching at a single point, and are rendered and scored with even-odd.
- **Output:** each puzzle has `category`, `polygons` (centred on the figure's centroid) and the authored `solution`.
- **Tests:** the `puzzles` tests check every stored solution covers its outline at >99%.
- **Checking new figures:** always look at `scripts/out/preview.png` after adding one.

**State/UI** (`src/App.tsx`). The `usePieces` hook owns piece state, the selection, and the rotate/flip commands, and handles layout remapping. It returns `boardProps` to spread onto `<Board>`. `Board` reports live drag updates via `onChange` and finished moves via `onSettle`; puzzle mode runs `evaluate()` in `onSettle`. Persistence is localStorage only (`src/storage.ts`).

**Interaction model** (designed for touch first). The selection is a `string[]`: one piece, or a whole joined group.
- Pressing a **piece** moves only that piece, pulling it out of its group.
- Pressing a **joint** moves the whole group. Joints are the glowing lines `findJoints()` draws on every shared edge; each has an invisible `.joint-hit` line, `JOINT_HIT_PX` wide on screen, to grab. Hovering a joint highlights the group, and tapping one selects the group.
- Rotate, flip and twist work on the selection: `rotate`, `flip` and `turnBy` in `game/actions.ts`. For a group they turn or mirror about the group centroid via `turnGroup()`.
- Snapping on drop uses all moving pieces (`findSnap(pieces, ids, guides)`).
- While moving there's no selection border. The floating controls follow the moving piece on desktop, faded and inert (`.piece-actions.moving`); on touch they hide until the drop.
- `JointTip` shows a one-time explanation over the board; the flag is stored in localStorage under `tangram.tip.joints`.
- Pressing a piece selects it and starts a drag. Movement under `TAP_PX` screen px is a tap.
- Tapping an *already-selected* piece rotates it 45°. The first tap only selects; `Drag.wasSelected` is captured at pointer-down.
- **Two-finger twist:** while one finger drags a piece, a second finger down anywhere starts a `Twist`. The angle between the fingers rotates the piece in 45° steps (`applyTwist` → `setRotation`), and a dashed ring shows the twist. Lifting the second finger keeps the drag going.
- The selected piece gets floating ↺ ↻ ⇋ buttons (`PieceActions`), sized in screen px (`BUTTON_PX`) so they stay thumb-sized on phones. They are placed above the piece, or below if there's no room.
- The same actions are in the `Toolbar` and on the keys `R` / `Shift+R` (or `E`) / `F` / `Esc`.
- A snap triggers a short vibration (`navigator.vibrate`) and an orange flash at the contact point.

**Visual design** (`src/styles.css`):
- The theme is dark violet. `body` carries the gradient and dot-grid backdrop (`background-attachment: fixed`), and nothing frames the play area.
- Piece colours live in `PIECES` (`geometry/pieces.ts`) and are reused by the logo, the confetti and the picker card accents. `Board` turns each colour into a glossy `linearGradient` (`#tan-<id>`, via `mix()`).
- Buttons are translucent "glass" (`--glass*` variables); primary actions use the `--hot` gradient.
- The silhouette is a translucent fill with a dashed outline. Once solved, the pieces pulse with a glow (`.piece.solved`) and `Confetti` plays.
- SVG `filter: drop-shadow(...)` lengths on pieces are in board units, not screen px, so they are tiny values like `0.1px`.
- `prefers-reduced-motion` disables the animations.

**Mobile CSS** (`src/styles.css`):
- While playing, `.app.playing` is exactly `100dvh` and the board stage gets the leftover height.
- At ≤600px wide, the toolbar becomes equal-width 46px buttons and the footer is hidden.
- On short landscape screens (`max-height: 520px`), the toolbar becomes a vertical rail beside the board.
- The board has `touch-action: none`. The design-name input uses `font-size: 16px` to stop iOS from zooming into it.

**Worker** (`worker/index.ts`, `wrangler.jsonc`). Assets are served as an SPA (`not_found_handling: "single-page-application"`). Only `/api/*` reaches the Worker code (`run_worker_first`); currently it only has `/api/health`.
