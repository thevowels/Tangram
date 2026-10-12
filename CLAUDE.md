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
npm run deploy       # build + wrangler deploy: normally done by CI from main, see below
```

Vitest uses its own `vitest.config.ts` on purpose. Loading `vite.config.ts` pulls in the Cloudflare plugin, which fails under vitest with "There is already a server associated with the config".

## CI / deploy (`.github/workflows/`)

- **`ci.yml`** runs on every PR and on pushes to `main`, in this order:
  1. `npm test`
  2. `npm run build` (typecheck + build)
  3. a puzzles check: `npm run puzzles`, then `git diff --exit-code src/data/puzzles.json`.
- If you edit `scripts/figures.ts`, run `npm run puzzles` and commit the regenerated JSON, or CI fails.
- **`deploy.yml`** runs on every push to `main` (and manually via workflow_dispatch). It tests, then runs `npm run deploy` with the `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` repo secrets.
- **Production follows `main`.** Don't run `npm run deploy` from feature branches; it overwrites the live Worker until the next merge.

## Architecture

**Units and coordinates.** Everything is in "tan units": a small triangle has legs of 1, so the 7 pieces total area 8. The board is an SVG whose `viewBox` is the board size in tan units. Pointer positions are converted with `getScreenCTM().inverse()`, and screen px per unit comes from `getScreenCTM().a`, because the viewBox is letterboxed inside the element.

**Responsive layouts** (`src/game/layout.ts`). There is no visible board: the SVG fills the `.stage` element and pieces sit directly on the page backdrop.
- `useFitLayout(ref, figure?)` in `App.tsx` measures the stage, then calls `fitLayout(w, h, figure)`.
- **The board is sized per puzzle.** `needs()` computes the smallest board that fits *that* silhouette (`figureExtent()`) plus the starting tray (`trayExtent()`, the square exploded by `TRAY_SPREAD`):
  - `GAP` between silhouette and tray, `MARGIN` around everything;
  - `SLACK` along the axis pieces travel, `CROSS_SLACK` across it.
  - Free play uses `FREE_MIN`.
- `fitLayout` then picks landscape (silhouette left, tray right) or portrait (silhouette top, tray below), whichever gives bigger pieces, capped at `MAX_UNIT_PX`.
- `makeLayout` centres the silhouette and tray together.
- **Small figures get big pieces; wide ones are limited by the screen.** The Dog is 8 units wide, so on a ~345px phone it can't exceed ~43px per unit.
- **Playability tests:** the `board fits each puzzle` tests check every puzzle on six screen sizes:
  - the silhouette and the tray fit, without overlapping;
  - the tray pieces start apart;
  - every piece can be turned in the tray and placed into the solution.
  Run them after touching any of these constants.
- Pieces are created only once the layout is known; `usePieces` starts with `null`.
- On every resize, `remap()` moves each piece by its offset from the nearest anchor (silhouette or tray in puzzles, board centre in free play), so a half-built figure survives resizes and phone rotation. Saved designs store the `Layout` they were made on and are remapped when loaded.

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
  - "Share an edge" means `cornerJoints()` in `geometry/polygon.ts`: a flush, parallel stretch (`sharedEdges()`, within `STICK_TOL`, overlapping ≥ `STICK_MIN_LENGTH`) where **at least one end is a corner of both pieces**. That's the user's rule: together the pieces must form a clean new corner or a continued edge.
  - Pieces slid partway along each other, or touching only at a corner or tip, do **not** join.
  - Outline locking (`isLocked`) deliberately still uses plain `sharedEdges()`, because a correctly placed piece can sit mid-way along the silhouette's border.
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
- **`transformWithPush` (turn/flip/snap) never refuses just because the turned piece hits something immovable.** If neighbours can't be pushed (locked to the outline, or jammed), it retries with the turned piece itself nudged clear (`resolve(…, [], board, ids)`).
- `resolve` never returns overlapping pieces.
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
- **Two-finger twist:** only fingers inside the selection's **zone** count. The zone is a circle around the selection with margin `ZONE_MARGIN` (`zoneOf` / `inZone`), shown as a faint `.twist-zone` ring on touch screens.
  - **Drag + twist** (`Twist`): one finger drags the piece and a second lands in the zone; the angle between them rotates in 45° steps.
  - **Free twist** (`FreeTwist`): a finger landing on empty space inside the zone becomes `pending`. If a second finger lands in the zone, on a piece or not, both fingers rotate the selection in place. Lifting either finger ends it, then snaps and settles.
  - **One-finger dial** (`Dial`): if the pending finger moves ≥ `TAP_PX` before a second one arrives, it becomes a joystick-style dial. The selection turns in 45° steps to follow the finger's angle around the zone centre, ignoring the `DIAL_DEAD_ZONE` near the centre. No touch marker is drawn; only the ring highlights. Works with a mouse too.
  - A pending finger lifted quickly counts as a tap on empty space and clears the selection.
  - **The floating buttons** sit inside the ring, so they start a `pending` too (`onButtonDown`). A tap presses the button, and moving from one starts the dial.
  - `secondFinger()` routes any extra finger to the active gesture instead of starting a competing one.
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
