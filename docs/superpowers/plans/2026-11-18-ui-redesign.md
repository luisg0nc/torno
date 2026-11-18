# The UI redesign: implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The window is rebuilt as the spec's one window from five picks. That means a new type and set of tokens, a
title bar, a rail that indexes a route card, a view whose tools stand on the part through tags and leaders, a session
dock organised by the builds strip, and export, keys and changes in the window. Screens with no model get the dyed field,
and the page of projects becomes a bench. Every behaviour of today is kept.

**Architecture:**
- Pure rules come first, each in a small file with its own unit tests: leader geometry, tag placement, the column's
  folding, the merged checks' order, the gauge's window, the strip's nodes, the slip's rows, the export weights, the
  keyboard map and its sentences, the bench's shelves. Components are thin over them.
- The shell becomes one CSS grid (`App.tsx`, `styles/layout.css`). New components live beside the ones they replace
  in `app/src/renderer/ui/`. New stylesheets are added to `styles/app.css` in cascade order.
- Tags and leaders are placed outside React per frame, like the mark labels today. `viewport/overlay.ts` projects, and
  `LeaderLayer` draws one SVG above the panes.
- Main changes are few and separate: the frameless window and its bridge, export weights per item, the bench's box and
  scale, and the waiting question on a card.

**Tech stack:** Electron, TypeScript, React, three.js, electron-vite, vitest, Playwright (hidden window), pnpm.

**Spec:** `docs/superpowers/specs/2026-11-18-ui-redesign-design.md`. Read it whole before any task, and read section 8
(Luis's rulings) and section 4 (names and behaviour kept) twice. A task's "spec §" points at the part it builds. The
visual reference is the local branch `design/unified` (`design/mockups/unified/window.html?state=…`). Where it differs
from the spec, the spec wins.

## Global Constraints

- **The code's behaviour and names win; the spec's look and placement win.** No key row of `shared/keys.ts` changes, no
  word a person or Claude reads changes unless the spec says so, no MCP tool changes.
- **Tokens:** every colour, radius and shadow comes from `styles/tokens.css`. The radii are `--radius-inline` 4 px,
  `--radius-control` 6 px, `--radius-float` 10 px, `--radius-sheet` 14 px and `--radius-full` 999 px. The one shadow is
  `--float-shadow`. The easing is `--ease: cubic-bezier(.2, .8, .2, 1)`.
- **Faces:** Instrument Sans (400, 500, 600) and Martian Mono (300, 400, 500), from `@fontsource/instrument-sans` and
  `@fontsource/martian-mono`, latin subset, bundled. Nothing is fetched. The CSP stays `font-src 'self' data:`.
- **Mono in a line:** `.num` is `0.86em`, `letter-spacing: -0.02em`, tabular figures, `margin-inline: 0.12em`.
- **Sentence case. Every number, ref, file name and key cap is in the mono face.**
- **No text dimmed by `opacity`, and nothing animates without end** (`styles.test.ts`). A dimmed mark or label is a
  colour mixed toward its ground. The working dot is still, and no caret blinks.
- **`prefers-reduced-motion: reduce` turns every animation and transition off.** Count-ups show the final value.
- **The dye (`--dye`) is only on screens with no model:** the first screen, the empty folder, and the new project's
  prompt side.
- **Leaders:** always the accent, 1 px, a 3 px ring, one straight leg and a 12 px shoulder. The tool in hand owns the
  view's leaders, and at most one borrowed leader exists at a time. A leader never crosses text, and marks have none.
- **Sizes:** `--title-h` 40, `--rail-w` 52, `--card-w` 296 (264 below 1360 px of window), `--dock-w` 420 (384 below
  1360), `--status-h` 28. `VIEWPORT_MIN` is 420.
- **Tests:** never a visible window (`TORNO_TEST=1`, `show: false`), never `page.screenshot()`, never the clipboard. The
  stand-in agent (`TORNO_AGENT_CMD=node app/test/fake-agent.mjs`) is used, never `claude`. Read `.claude/rules/e2e-hidden-window.md`
  and `e2e-stand-in-agent.md` before touching e2e.
- **Each task leaves the four suites green:** `pnpm test`, `pnpm test:kernel`, `(cd kernel && uv run pytest -q)`,
  `pnpm test:e2e`, and `pnpm -C app typecheck`. While iterating, run the focused file. Run all four before the commit.
  From Claude's shell `pnpm` may not be on PATH and the display variables are unset: from `app/`, use
  `export PATH="$PWD/node_modules/.bin:$PATH" XDG_RUNTIME_DIR=/run/user/1000 WAYLAND_DISPLAY=wayland-1 DISPLAY=:0`, then
  `electron-vite build && node scripts/build-viewer.mjs` for the build and `playwright test e2e/<file>` for one spec.
  Never run heavy jobs side by side: the machine is short on memory.
- **Do not disturb the live desktop:** no visible window, no focus stealing, no touching running dev servers or other
  worktrees, no kill by a broad pattern.
- **The manual and the rules change with the code, in the same commit** (`CLAUDE.md`, Commits). `readme.test.ts` holds
  the manual's `#`/`##` headings exactly and in order: add no heading and rename none.
- **Commits:** one per task at least, with a message that says the change and ends with
  `Co-Authored-By: Claude <noreply@anthropic.com>`. Never push. The PR is opened by Luis or on his word.
- **Worktrees** for parallel tasks go inside the repo at `.worktrees/<branch>`. Each branches from `work/redesign` at
  the commit named in the parallel table, and is merged back (fast-forward or a merge commit) and removed when done.

## Review Focus

1. **Folded card at 1280 × 800 with a tall head** (a sketch open, or 30 refs selected). The head caps at 60 % of the
   card and scrolls inside, and the sections stay reachable. Test: Task 16 (`head caps at 60 % of the card`).
2. **A tag whose subject leaves the screen or is seen edge on** while the camera turns. The tag docks above the hint
   with no leader and does not jump between sides on every frame. Test: Task 17 (`placeTag keeps its side while it still
   fits`, `docks with no subject`).
3. **Old `localStorage` values** (`torno.column` in the old `{open,width}` shape, a missing or throwing storage, a
   width wider than the window allows). They read as defaults, clamped. Tests: Task 5 (`readDock`), Task 9
   (`readColumn`).
4. **A history of 0, 1 or 41 builds, with a failed build first or a build running while none has landed.** The strip
   draws, folds and keeps the build on show in sight. Test: Task 28 (`stripNodes` cases).
5. **Export weights that do not add up**, or an export of several projects, or a plan refused over 64 MB. The rule
   never claims more than the total, and a refused plan shows no rule. Test: Task 33 (`items sum to bytes`), Task 34
   (refusal).

---

## Stage 1: foundation

### Task 1: Tokens and their contrast

Spec §1 "Tokens", "Contrast".

**Files:**
- Modify: `app/src/renderer/styles/tokens.css` (the new tokens, the changed values, light and dark)
- Modify: `app/src/shared/contrast.test.ts`
- Modify: `app/src/renderer/viewport/theme.ts` (`LIGHT_THEME.ink`, `.muted`), `app/src/renderer/viewport/sectionDrawing.ts`
  (`SHEET`), `app/src/main/index.ts` (`SURFACE` unchanged, checked), `app/src/export/page.css` (its token block),
  `app/src/renderer/ui/drawing/make.ts` fallbacks if they name ink
- Modify: `.claude/rules/styles-themes.md`

**Interfaces:**
- Produces: tokens `--raise`, `--on-accent`, `--dye`, `--scribe`, `--on-dye`, `--on-dye-muted`, `--on-mark`,
  `--warn-wash`, `--fail-wash`, `--band`, `--band-edge`, `--route`, `--scrim`, `--ease`, `--space-5: 24px`, `--space-6:
  32px`, `--text-row: 12.5px`. `--ink` becomes `#20242B`, `--muted` becomes `#62666D`, the dark `--muted` becomes
  `#9EA3AA` and the dark `--field-edge` becomes `#747A82`. `--text-size` becomes `13.5px` and `--text-leading` `1.42`.
  Values are exactly the spec's table.

- [ ] **Step 1: Write the failing tests** in `contrast.test.ts`, both themes, using its existing `contrast()` and token
  reader:

```ts
it('holds text on the new grounds', () => {
  for (const t of [light, dark]) {
    for (const g of ['--raise', '--warn-wash', '--fail-wash']) {
      expect(contrast(t['--ink'], t[g])).toBeGreaterThanOrEqual(7)
      for (const f of ['--muted', '--accent', '--ok', '--warn', '--fail']) expect(contrast(t[f], t[g])).toBeGreaterThanOrEqual(4.5)
    }
  }
})
it('holds text on the accent, the dye and the marks', () => {
  for (const t of [light, dark]) {
    expect(contrast(t['--on-accent'], t['--accent'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-dye'], t['--dye'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-dye-muted'], t['--dye'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-mark'], t['--user-mark'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--on-mark'], t['--agent-mark'])).toBeGreaterThanOrEqual(4.5)
    expect(contrast(t['--scribe'], t['--dye'])).toBeGreaterThanOrEqual(3)
    expect(contrast(t['--field-edge'], t['--raise'])).toBeGreaterThanOrEqual(3)
  }
})
it('draws the route and the band as hairlines', () => {
  for (const t of [light, dark]) {
    const r = contrast(t['--route'], t['--panel']); expect(r).toBeGreaterThanOrEqual(1.15); expect(r).toBeLessThanOrEqual(2)
    const h = contrast(t['--hairline'], t['--raise']); expect(h).toBeGreaterThanOrEqual(1.15); expect(h).toBeLessThanOrEqual(2)
    expect(contrast(t['--band-edge'], t['--band'])).toBeGreaterThanOrEqual(2)
    expect(contrast(t['--ok'], t['--band'])).toBeGreaterThanOrEqual(3)
    expect(contrast(t['--fail'], t['--band'])).toBeGreaterThanOrEqual(3)
  }
  expect(light['--dye']).toBe(light['--accent'])
})
```

  Replace the existing rule "`--panel` on `--accent` ≥ 4.5" with `--on-accent`, and "`--panel` on `--user-mark`" with
  `--on-mark` (spec §5). Keep every other rule, including the dark `--warn` `#CBAA6A`.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/shared/contrast.test.ts`. Expected: FAIL (tokens missing).
- [ ] **Step 3: Add the tokens** to `tokens.css` (light block, then the dark block). Make the light values written out
  elsewhere follow (`LIGHT_THEME`, `SHEET`, `page.css`), as the existing tests demand.
- [ ] **Step 4: Run** `contrast.test.ts`, `export/page.test.ts` and `styles/styles.test.ts`. Expected: PASS. Then the
  four suites.
- [ ] **Step 5:** Update `styles-themes.md` with the new tokens and rules. Commit: "Tokens: the redesign's grounds,
  dye, washes, band and route, held to their contrasts".

### Task 2: The faces, bundled

Spec §1 "Type".

**Files:**
- Modify: `app/package.json`, `pnpm-lock.yaml` (add `@fontsource/instrument-sans`, `@fontsource/martian-mono` at
  pinned versions, published at least two weeks ago; keep the Plex packages until Task 42)
- Modify: `app/src/renderer/main.tsx` (imports: instrument-sans latin 400, 500, 600; martian-mono latin 300, 400, 500)
- Create: `app/src/shared/fonts.ts`
- Modify: `app/src/renderer/styles/tokens.css` (`--font-ui`, `--font-mono`), `app/src/renderer/styles/controls.css`
  (`.num` rule), `viewport/overlay.ts`, `viewport/alignPoints.ts`, `viewport/heldValue.ts`, `viewport/sketchHint.ts`,
  `viewport/sectionDrawing.ts`, `ui/SessionPane.tsx`, `main/export/html.ts` (`FONTS`: Instrument Sans 400, 600;
  Martian Mono 400)
- Test: `app/src/shared/fonts.test.ts`, `app/src/main/export/html.test.ts`

**Interfaces:**
- Produces: `shared/fonts.ts` exports `UI_FACE = 'Instrument Sans'`, `MONO_FACE = 'Martian Mono'`,
  `canvasFont(px: number, weight?: 400 | 500 | 600, mono?: boolean): string` (for example `'500 12px "Martian Mono",
  ui-monospace, monospace'`).

- [ ] **Step 1: Write the failing tests.** `fonts.test.ts`: `canvasFont(12, 500, true)` equals `'500 12px "Martian
  Mono", ui-monospace, monospace'`, and `canvasFont(12)` equals `'400 12px "Instrument Sans", system-ui, sans-serif'`. Also
  assert that no file under `app/src` other than `shared/fonts.ts`, `tokens.css`, `main/export/html.ts` and `page.css`
  contains `IBM Plex` or `Instrument Sans` or `Martian Mono` (a glob read, as `styles.test.ts` does). In `html.test.ts`, the
  page's fonts are Instrument Sans 400 and 600 and Martian Mono 400.
- [ ] **Step 2: Run** both. Expected: FAIL.
- [ ] **Step 3:** Add the packages, the imports and `shared/fonts.ts`, and replace every family name in TypeScript with
  `canvasFont` or the constants. Set the tokens, and set `.num` as in the Global Constraints. Check that the latin woff2
  of Martian Mono has `× ± ≈ ⌀ ° ² ³ → − µ`, by reading the cmap with a short node script using `fontkit` from a temp
  folder, not a dependency. List a missing glyph in the commit message: it falls back to `ui-monospace`.
- [ ] **Step 4: Run** the tests, then the four suites. `e2e/themes.spec.ts` must still pass.
- [ ] **Step 5:** Update `styles-themes.md` (faces) and commit: "Type: Instrument Sans and Martian Mono, bundled".

### Task 3: Radii, the one shadow, and the style rules

Spec §1 "Spacing, radii, sizes".

**Files:**
- Modify: `app/src/renderer/styles/tokens.css` (`--radius-inline`, `--radius-float` replacing `--radius-palette`,
  `--radius-sheet`, `--radius-full`, `--float-shadow` replacing `--palette-shadow`, and the size tokens `--title-h`,
  `--card-w`, `--dock-w` 420, `--rail-w` 52; `--panel-w` stays as an alias of `--card-w` until Task 9)
- Modify: every stylesheet that uses `--radius-palette` or `--palette-shadow` (rename only), `app/src/export/page.css`
- Modify: `app/src/renderer/styles/styles.test.ts`

- [ ] **Step 1: Write the failing tests** in `styles.test.ts`:
  - `uses radii from the tokens`: every `border-radius` value in `renderer/styles/*.css` other than `tokens.css` is a
    `var(--radius-*)`, `0`, `50%`, or a `var(--radius-*)` list. Hard numbers go except in an allow-list for the
    keyboard's keys (`7px`, Task 35) and the tracing's title block (`2px`).
  - `has one shadow`: no `box-shadow` value with a blur over 4 px other than `var(--float-shadow)`. Insets and rings are
    allowed.
  - `no --palette-shadow or --radius-palette is left`.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/renderer/styles/styles.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Rename the tokens. Replace the hard radii with tokens, picking by what floats: 4 for an inline chip,
  6 for a control, 10 for a popover or card, 14 for a sheet.
- [ ] **Step 4: Run** the test, then the four suites.
- [ ] **Step 5: Commit**: "Shape: radii that grow with what floats, and one shadow".

### Task 4: Leader geometry and `LeaderLayer`

Spec §1 "The leader rule".

**Files:**
- Create: `app/src/shared/leader.ts`, `app/src/shared/leader.test.ts`
- Create: `app/src/renderer/ui/LeaderLayer.tsx`, `app/src/renderer/state/leaders.ts`,
  `app/src/renderer/styles/leaders.css` (added to `app.css` before `late.css`)
- Create: `.claude/rules/leaders.md` (paths: the files above) and add it to `CLAUDE.md`'s "Rules by area" under "The
  view"

**Interfaces:**
- Produces:
  - `type Pt = { x: number; y: number }`, `type Box = { x: number; y: number; w: number; h: number }`
  - `interface LeaderPath { ring: Pt; leg: [Pt, Pt]; shoulder: [Pt, Pt] }`
  - `leaderPath(subject: Pt, tag: Box, clip?: Box): LeaderPath | null`: the shoulder is 12 px into the tag's nearest
    edge, at that edge's middle clamped to the subject's side. With `clip` (a pane's box) and the tag outside it, the leg
    stops at the clip's edge at the tag's height (a borrowed leader). It is null when the subject is inside the tag.
  - `crossesBoxes(path: LeaderPath, boxes: Box[]): boolean`
  - `RING_R = 3`, `SHOULDER = 12`
  - `state/leaders.ts`: `setToolLeaders(list: Array<{ id: string; subject: Pt; tag: Box }>)`, `borrowLeader(l: { subject:
    Pt; chip: Box; clip: Box } | null)`, `subscribeLeaders(fn)`. These are plain stores, not React state per frame.
  - `<LeaderLayer />`: one `svg` at the window's size, `pointer-events: none`, `z-index` above the panes and below
    popovers. It draws circles r 3 (fill `--raise`, 1.5 px accent stroke) and polylines 1 px in `--accent`. A leader
    draws out once in 0.24 s (stroke-dashoffset), and is off under reduced motion.

- [ ] **Step 1: Write the failing tests** (`leader.test.ts`):

```ts
it('ends in a 12 px shoulder into the nearest edge', () => {
  const p = leaderPath({ x: 100, y: 200 }, { x: 160, y: 100, w: 80, h: 30 })!
  expect(p.ring).toEqual({ x: 100, y: 200 })
  expect(p.shoulder[1].y).toBe(130)          // the tag's bottom edge
  expect(Math.abs(p.shoulder[1].y - p.shoulder[0].y) + Math.abs(p.shoulder[1].x - p.shoulder[0].x)).toBe(12)
  expect(p.leg[1]).toEqual(p.shoulder[0])
})
it('is null when the subject is under the tag', () => {
  expect(leaderPath({ x: 170, y: 110 }, { x: 160, y: 100, w: 80, h: 30 })).toBeNull()
})
it('stops at the pane edge for a borrowed leader', () => {
  const p = leaderPath({ x: 300, y: 300 }, { x: 900, y: 500, w: 40, h: 18 }, { x: 0, y: 0, w: 700, h: 800 })!
  expect(p.shoulder[1].x).toBe(700); expect(p.shoulder[1].y).toBe(509)
})
it('says when it crosses text', () => {
  const p = leaderPath({ x: 0, y: 0 }, { x: 200, y: 200, w: 40, h: 20 })!
  expect(crossesBoxes(p, [{ x: 90, y: 90, w: 20, h: 20 }])).toBe(true)
  expect(crossesBoxes(p, [{ x: 0, y: 150, w: 20, h: 20 }])).toBe(false)
})
```

- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/shared/leader.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `leader.ts`, the store and `LeaderLayer`. Mount it in `App.tsx`, empty for now.
- [ ] **Step 4: Run** the test, then the four suites.
- [ ] **Step 5:** Write `leaders.md` (the rule in five lines, from spec §1). Commit: "Leaders: one shape, one layer".

---

## Stage 2: the shell

### Task 5: The shell grid and the dock's kept width

Spec §2 "Layout".

**Files:**
- Modify: `app/src/renderer/App.tsx` (the grid; dock width from `state/dock.ts`), `app/src/renderer/styles/layout.css`
  (the grid in place of absolute positions; keep the view's own inner rules for now)
- Create: `app/src/renderer/state/dock.ts`, `app/src/renderer/state/dock.test.ts`
- Modify: `app/src/renderer/state/column.ts` (`VIEWPORT_MIN` 420, `clampLeft` uses it)
- Modify: `.claude/rules/left-column.md`, `.claude/rules/session-pane.md`, `docs/manual.md` (the dock's width is kept)

**Interfaces:**
- Produces: `DOCK_DEFAULT = 420`, `DOCK_NARROW = 384`, `NARROW_WINDOW = 1360`,
  `dockDefault(windowWidth: number): number`, `readDock(storage: Storage | null): number | null`,
  `writeDock(storage: Storage | null, w: number): void` (key `torno.dock`, try/catch), and
  `clampDock(w: number, windowWidth: number, leftWidth: number): number`. Shell CSS variables are `--title-h`,
  `--rail-w`, `--card-w`, `--dock-w` and `--status-h`. A hidden dock or card is a `0` column.

- [ ] **Step 1: Write the failing tests** (`dock.test.ts`): `dockDefault(1440) === 420`, `dockDefault(1280) === 384`,
  `readDock` of a throwing storage is null, of `'abc'` is null, and of `'500'` is 500. `clampDock(2000, 1440, 348)`
  leaves the view `VIEWPORT_MIN` wide (`=== 1440 - 348 - 420`). `writeDock` with a throwing storage does not throw.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement. In `App.tsx`, the shell is `display: grid` with `grid-template-columns: var(--rail-w)
  var(--card-w) minmax(0, 1fr) var(--dock-w)` and rows `var(--title-h) minmax(0, 1fr) var(--status-h)`. The title row is
  empty for now, 40 px on `--surface`. Today's left `aside` spans the rail and card columns. Drags write the variables as
  today, and the dock's drag ends in `writeDock`.
- [ ] **Step 4: Run** the unit test, then `e2e/boot.spec.ts` (its dock and panel limits use the new numbers: update its
  expected widths to 420 and `VIEWPORT_MIN` 420), then the four suites.
- [ ] **Step 5:** Commit: "Shell: one grid, and the dock's width is kept".

### Task 6: The frameless window and its controls

Spec §2 "The title bar" (main side).

**Files:**
- Modify: `app/src/main/index.ts` (`titleBarStyle: 'hidden'`, `titleBarOverlay: { color, symbolColor, height: 40 }`
  where `process.platform !== 'linux'` or Electron reports support, `minWidth: 1100`, `minHeight: 700`)
- Modify: `app/src/preload/index.ts`, `app/src/shared/bridge.ts` (`window: { minimize(): void; toggleMaximize(): void;
  close(): void; drawsControls(): boolean; onMaximized(fn: (max: boolean) => void): () => void }`)
- Modify: `app/src/main/ipc.ts` (handlers; `close` goes through the existing close question)
- Test: `app/src/main/window.test.ts` (a pure `frameOptions(platform: NodeJS.Platform, dark: boolean)` exported from a new
  `app/src/main/frame.ts`)

**Interfaces:**
- Produces: `frameOptions(platform, dark): Pick<BrowserWindowConstructorOptions, 'titleBarStyle' | 'titleBarOverlay'>`
  and `bridge.window.*` as above. `drawsControls()` is true where torno must draw the three buttons.

- [ ] **Step 1: Write the failing test**: `frameOptions('win32', false)` gives `titleBarStyle: 'hidden'` and an overlay of
  height 40 with `color: '#F1EFEA'`. `frameOptions('linux', true)` gives `titleBarStyle: 'hidden'` and no overlay.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/main/window.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement and wire. Tests keep `show: false`. Nothing in the hidden window depends on the frame.
- [ ] **Step 4: Run** the test, `e2e/quit.spec.ts` and `e2e/boot.spec.ts`, then the four suites.
- [ ] **Step 5:** Add "the window's own title bar and controls on Linux" to the manual's "Not yet verified on a visible
  screen" (its to-try part; keep the required words). Commit: "Window: no native frame; the controls through the
  bridge".

### Task 7: The title bar

Spec §2 "The title bar".

**Files:**
- Create: `app/src/renderer/ui/TitleBar.tsx`, `app/src/renderer/ui/titleSigns.ts`, `app/src/renderer/ui/titleSigns.test.ts`,
  `app/src/renderer/styles/titlebar.css` (into `app.css` after `layout.css`)
- Modify: `app/src/renderer/App.tsx` (mount in the title row), `ui/FolderMenu.tsx` (opens from the crumb),
  `ui/ObjectList.tsx` (becomes the project crumb's menu), `styles/late.css` (folder menu rules move to `titlebar.css`)
- Modify: `docs/manual.md` ("Run", "The page of projects": where the folder and projects are), `.claude/rules/left-column.md`,
  `.claude/rules/session-pane.md`, `e2e/helpers.ts`, `e2e/objects.ts`, `e2e/workspace.spec.ts`, `e2e/session.spec.ts`

**Interfaces:**
- Consumes: `bridge.window.*` (Task 6), `switcherSign` and `sessionSign.ts`.
- Produces: `titleSigns(objects: ObjectCard[], openId: string | null, max = 2): { shown: Array<{ id: string; name: string;
  state: 'working' | 'needs_input' }>; more: number }`, waiting first. The crumbs are buttons named by the folder and the
  project (accessible names `Folder parts`, `Project intake`), and each sign is a button whose name is the project's.

- [ ] **Step 1: Write the failing test** (`titleSigns.test.ts`): four projects, two working and one waiting, the open one
  working. Expect the waiting one first, then one working other than the open, then `more === 0`. With five others,
  `more === 3`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement `TitleBar` (`-webkit-app-region: drag`, controls `no-drag`): the vise `Logo` at 18 px, the
  folder crumb with `FolderMenu`, `/`, the project crumb with the project menu (All projects, then each project), the
  signs as pills (warn wash for needs you), and the drawn window controls when `drawsControls()`. The Projects panel loses
  the folder `h1`.
- [ ] **Step 3b:** Update the e2e helpers to open the folder menu from `getByRole('button', { name: /^Folder / })`.
- [ ] **Step 4: Run** the unit test, `e2e/workspace.spec.ts`, `e2e/welcome.spec.ts`, `e2e/session.spec.ts` and
  `e2e/show.spec.ts`, then the four suites.
- [ ] **Step 5:** Commit: "Title bar: the folder, the project, and who works or waits".

### Task 8: The rail of icons

Spec §2 "The rail" (look only; the index comes in Task 9).

**Files:**
- Modify: `app/src/renderer/ui/Rail.tsx`, `app/src/renderer/styles/rail.css`, `app/src/renderer/ui/Rail.test.ts`
- Create: `app/src/renderer/ui/RailTip.tsx`

**Interfaces:**
- Produces: `<RailTip label: string; for: HTMLElement>`, a tooltip shown on hover and `:focus-visible`, `aria-hidden`,
  ink pill 12 px. The rail buttons keep their accessible names and `aria-pressed`.

- [ ] **Step 1: Write the failing test** (`Rail.test.ts`): the markup has no visible word under an icon (no `.rail-label`
  element), each button keeps its `aria-label`, and Projects pressed on the page carries `data-dyed`.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement: 52 px, 36 × 36 buttons with radius 9, 19 px icons stroked 1.35, the dyed tile for Projects
  on the page, the accent wash for the open panel, badges 16 px mono 9 px, and Keys at the foot.
- [ ] **Step 4: Run** the test and `e2e/boot.spec.ts`, then the four suites.
- [ ] **Step 5:** Commit: "Rail: icons only, names in tips".

---

## Stage 3: the route card

### Task 9: The card, its sections, and the rail as index

Spec §2 "The route card" (frame, route, folding), "The rail" (index).

**Files:**
- Create: `app/src/renderer/ui/card/RouteCard.tsx`, `app/src/renderer/ui/card/CardSection.tsx`,
  `app/src/renderer/ui/card/sections.ts`
- Create (empty stylesheets, listed in `app.css` in this order before `late.css`, so later tasks never edit `app.css`):
  `styles/card.css`, `styles/card-hand.css`, `styles/card-needs.css`, `styles/card-parts.css`, `styles/card-checks.css`,
  `styles/card-marks.css`, `styles/card-misc.css`
- Modify: `app/src/renderer/state/column.ts`, `app/src/renderer/state/column.test.ts`, `app/src/renderer/ui/Rail.tsx`,
  `app/src/renderer/ui/railBadges.ts` (+ test), `app/src/renderer/App.tsx`
- Delete: `app/src/renderer/ui/PanelHost.tsx`, `app/src/renderer/ui/SectionTitle.tsx`
- Modify: `docs/manual.md` (the left column), `.claude/rules/left-column.md`, `e2e/helpers.ts` (`openSection(page,
  name)` in place of opening a panel), and every e2e spec that calls the old helper

**Interfaces:**
- Produces:
  - `type SectionId = 'needs' | 'parts' | 'params' | 'checks' | 'marks' | 'scans' | 'tracings' | 'profile'`
  - `SECTIONS: Array<{ id: SectionId; title: string; icon: IconName }>` in that order, with the titles "Needs you",
    "Parts", "Parameters", "Checks", "Marks", "Scans", "Tracings" and "Print profile"
  - `interface ColumnPrefs { folded: SectionId[]; width: number }`, `COLUMN_DEFAULT = { folded: ['params', 'scans',
    'tracings', 'profile'], width: 296 }`, `readColumn(raw: string | null): ColumnPrefs` (old `{open,width}` reads as the
    default folding with that width), `CARD_DEFAULT = 296`, `CARD_NARROW = 264`, `RAIL_W = 52`
  - `store.column` keeps `ColumnPrefs`, and `actions.toggleSection(id)`, `actions.showSection(id)` (unfold and scroll)
  - `<CardSection id title said needs?>`, whose `said` is the head's one line (ReactNode, mono). Children are the body.
    Attributes: `data-section`, `data-folded`, `data-here`, `data-needs`.
  - The card's slots: `<RouteCard head={…}>`, whose head slot is filled in Task 10. Each section's body is today's
    component for now: `Layers` → parts, `ParamsPanel` → params (the Parameters part only; Checks and Print profile move
    out of it), `ChecksPanel` + `ChecksSummary` → checks, `MarksPanel` → marks, `ScansPanel` → scans, `TracingRows` →
    tracings, `PrintProfile` → profile, and an empty `needs`.
  - `railBadges.ts`: `badgeText(section: SectionId, data)` for every section.

- [ ] **Step 1: Write the failing tests**: `column.test.ts` (`readColumn('{"open":"marks","width":300}')` gives the default
  folding at width 300; `readColumn('nope')` gives the default; `readColumn(null)` gives the default), and
  `railBadges.test.ts` (a badge for `needs` with 3 waiting, `checks` counting failing model checks plus failing
  dimensions, `tracings` none).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the card: the route line (1 px `--route` at 17.5 px), section dots (9 px; accent when
  `data-here`, a `--fail` ring when `data-needs`), heads 16 px 600 with the `said` line in mono 10.5 px muted and an
  ellipsis, a click on a head folds, and the In hand slot pinned above the scroll. An `IntersectionObserver` on the heads
  sets `data-here` and drives `aria-current` on the rail's index. The rail holds Projects, a hairline, the eight section
  icons and Keys. A press is `showSection`.
- [ ] **Step 4: Run** the unit tests, then `e2e/groups.spec.ts`, `e2e/references.spec.ts`, `e2e/params.spec.ts`,
  `e2e/marks.spec.ts`, `e2e/scan.spec.ts` and `e2e/checks.spec.ts` on the new helper, then the four suites.
- [ ] **Step 5:** Commit: "Route card: the project read top to bottom, the rail its index".

### Task 10: In hand

Spec §2 "The head: what is in your hand", §3 "Named sets" (Making one).

**Files:**
- Create: `app/src/renderer/ui/card/InHand.tsx`, `app/src/renderer/ui/card/inHand.ts`, `app/src/renderer/ui/card/inHand.test.ts`
- Modify: `app/src/renderer/ui/Selection.tsx` (its logic is reused; its bar at the foot of the view goes),
  `app/src/renderer/ui/ViewportPane.tsx` (unmount `Selection`), `app/src/renderer/ui/sets/MakeSet.tsx` (renders inside
  the head), `styles/card-hand.css`, `styles/overlays.css` (remove the selection bar's rules)
- Modify: `docs/manual.md` (Marks: Select, Insert, Note; Named sets: Making one), `.claude/rules/sets.md`,
  `.claude/rules/marks-window.md`, `e2e/pick.spec.ts`, `e2e/sets.spec.ts`, `e2e/section.spec.ts` (`.pick-readout` stays)

**Interfaces:**
- Produces: `type HeadKind = 'empty' | 'selection' | 'sketch' | 'review' | 'makeSet'`, and `headKind(state: { refs:
  number; sketchOpen: boolean; roundOpen: boolean; makingSet: boolean }): HeadKind` with the priority sketch, then
  review, then makeSet, then selection, then empty. `HEAD_MAX_SHARE = 0.6`, `SHOWN_REFS = 4`.

- [ ] **Step 1: Write the failing tests**: `headKind` for each combination (a sketch wins over a review). With 6 refs the
  head lists 4 and "and 2 more" (render with `renderToStaticMarkup`). Insert and Note are disabled with the reason when
  the build is stale.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement: "In hand", "`2` picked, shift-click adds", refs on the accent wash (mono 11.5 / 10.5), and
  **Insert in prompt**, **Note each**, **Name a set** (`Ctrl+G`) and **Clear**. Name a set opens `MakeSet` in the head.
  The head is capped at 60 % of the card and scrolls inside.
- [ ] **Step 4: Run** the unit tests, `e2e/pick.spec.ts` and `e2e/sets.spec.ts`, then the four suites.
- [ ] **Step 5:** Commit: "In hand: the selection at the head of the card".

### Task 11: Needs you, and the Marks section regrouped

Spec §2 "Needs you", "Marks".

**Files:**
- Modify: `app/src/renderer/ui/markGroups.ts` (+ test), `app/src/renderer/ui/MarksPanel.tsx`, `ui/MarkRow.tsx`,
  `ui/ResolvedSummary.tsx`
- Create: `app/src/renderer/ui/card/NeedsYou.tsx`
- Modify: `styles/card-needs.css`, `styles/card-marks.css`, `styles/marks.css` (row look: two lines, actions as words on
  the active row)
- Modify: `docs/manual.md` (Marks: the groups), `.claude/rules/marks-window.md`, `e2e/marks.spec.ts`,
  `e2e/reanchor.spec.ts`, `e2e/review.spec.ts`

**Interfaces:**
- Produces: `splitMarkGroups(groups: MarkGroups): { needs: { toReview; fromAgent; failingChecks }; marks: { toSend;
  withAgent; resolved } }`. The checks group goes to the Checks section (Task 12). The rule of `groupMarks` is unchanged.

- [ ] **Step 1: Write the failing test** in `markGroups.test.ts`: from a fixture with one mark of each group, `split…`
  puts each where the spec says, and `needs.failingChecks` holds only the failing dimensions.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement. Needs you rows: the chip, the words, the source at the right, "**Resolved by Claude:**" in
  `--agent-mark`, then **OK** / **Reopen…**, and Review / OK all with the walk. Marks keeps **Review this build** and the
  round rows at its head.
- [ ] **Step 4: Run** the unit test and the three e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Card: Needs you, and Marks by who acts next".

### Task 12: The gauge and one Checks section

Spec §2 "Checks".

**Files:**
- Create: `app/src/renderer/ui/card/Gauge.tsx`, `app/src/renderer/ui/card/gauge.ts`, `app/src/renderer/ui/card/gauge.test.ts`,
  `app/src/renderer/ui/card/checksOrder.ts`, `app/src/renderer/ui/card/checksOrder.test.ts`,
  `app/src/renderer/ui/card/Checks.tsx`
- Modify: `ui/ChecksPanel.tsx`, `ui/ChecksSummary.tsx` (merged into `Checks.tsx`; their tests move), `ui/checkRows.ts`,
  `styles/card-checks.css`
- Modify: `docs/manual.md` (Measuring and dimensions; Projects and builds: checks), `.claude/rules/checks-and-profile.md`,
  `.claude/rules/dimensions.md`, `e2e/checks.spec.ts`, `e2e/measure.spec.ts`

**Interfaces:**
- Produces:
  - `gaugeWindow(lo: number | null, hi: number | null, v: number | null): { min: number; max: number }`: the band
    widened by twice its width each side, or out to the value when that is further. An open end (null) runs the window
    to the value plus the band's width.
  - `gaugeSaid(v: number, lo: number | null, hi: number | null): string`, for example `'2.8, outside 2.95 to 3.05'`
  - `type CheckRow = { kind: 'model' | 'dimension'; id: string; name: string; verdict: 'passes' | 'fails' | 'not run' | 'not
    measured'; value?: number; lo?: number | null; hi?: number | null; line: string; mark?: string }`
  - `mergedChecks(model: ModelCheck[], dimensions: Mark[], build: number): CheckRow[]`, failing first, then not run or not
    measured, then passing; stable within each.
  - `<Gauge row: CheckRow; from?: number>`: 64 × 16 SVG, with a tick slide from `from` (0.7 s).

- [ ] **Step 1: Write the failing tests**:

```ts
expect(gaugeWindow(2.95, 3.05, 2.8)).toEqual({ min: 2.75, max: 3.25 })   // band 0.1, widened 0.2 each side, value inside that
expect(gaugeWindow(2.95, 3.05, 2.5).min).toBe(2.5)
expect(gaugeWindow(null, 256, 248).max).toBeGreaterThan(256)
expect(gaugeSaid(2.8, 2.95, 3.05)).toBe('2.8, outside 2.95 to 3.05')
expect(gaugeSaid(3, 2.95, 3.05)).toBe('3, inside 2.95 to 3.05')
expect(mergedChecks(model, dims, 41).map((r) => r.verdict)).toEqual(['fails', 'fails', 'not run', 'passes', 'passes'])
```

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the rows: a grid of 28 px, 1fr and 64 px; the chip or a 3 × 28 bar in `--agent-mark`; line
  one with the name and the verdict word; line two the value in mono; the gauge; and the fail wash on failing rows. A
  moved tick slides, and the row lights once after a build (`state/landing.ts`). The model's notes go under the list,
  and Pin to board goes in the section's menu.
- [ ] **Step 4: Run** the unit tests and the two e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Checks: the model's and yours in one list, with a gauge".

### Task 13: Parts and Named sets

Spec §2 "Parts", §3 "Named sets".

**Files:**
- Modify: `app/src/renderer/ui/Layers.tsx` (+ test), `ui/sets/SetRows.tsx`, `ui/layerMarks.ts`, `styles/card-parts.css`,
  `styles/panels.css` and `styles/sets.css` (rules moved or restyled)
- Create: `app/src/renderer/ui/card/lit.ts`, `app/src/renderer/ui/card/lit.test.ts`
- Modify: `docs/manual.md` (Marks: layers), `.claude/rules/left-column.md`, `.claude/rules/sets.md`, `e2e/groups.spec.ts`,
  `e2e/references.spec.ts`, `e2e/sets.spec.ts`

**Interfaces:**
- Produces: `litRows(part: string | null, marks: Mark[], checks: CheckRow[]): { marks: Set<string>; checks: Set<string>
  }`, the rows lit when the pointer is on a part in the view (from `peek`). Rows carry `data-lit`.

- [ ] **Step 1: Write the failing tests**: `litRows('airbox-tub', …)` lights M3 and M5 (on that part) and the check
  "tub wall", and nothing of the lid. `Layers.test.ts` keeps its assertions and adds that a set row has a dashed swatch
  in `var(--set-2)` and its name `#deck` in `num`, with a "Named sets" subheading when a set spans parts.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the look: 28 px rows, a 4 × 18 swatch, mono names, the defect in `--fail`, the count pill,
  "hidden", group headers in the sans, the 10 px dashed set swatch, and a proposal in `--agent-mark` with Accept /
  Dismiss. The tracing rows leave Layers (Task 15).
- [ ] **Step 4: Run** the unit tests and the three e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Card: Parts, Named sets, and rows lit from the view".

### Task 14: Parameters, Scans and Print profile

Spec §2 "Parameters", "Scans", "Print profile". Ruling 1 (the title is "Parameters").

**Files:**
- Modify: `app/src/renderer/ui/ParamsPanel.tsx` (+ test), `ui/paramRows.ts`, `ui/ScansPanel.tsx`, `ui/PrintProfile.tsx`,
  `styles/card-misc.css`, `styles/panels.css`, `styles/scans.css`
- Modify: `docs/manual.md`, `.claude/rules/params.md`, `.claude/rules/scans-window.md`, `e2e/params.spec.ts`,
  `e2e/scan.spec.ts`

**Interfaces:**
- Consumes: `Gauge`, `gaugeWindow` (Task 12) for a parameter whose metadata has `min` and `max`.

- [ ] **Step 1: Write the failing test** in `ParamsPanel.test.ts`: a parameter with min 1 and max 5 renders a `Gauge`
  (`svg.gauge`, with `aria-label` from `gaugeSaid`), and one without a range renders none. The existing assertions stay
  (`param-value num`, `data-param`, the label "Parameters").
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement the look. The heads' `said` lines are `103, 2 tried, 2 assumed`, `2, 1 unaligned` and
  `Bambu X1C, PETG`, with **Import scan…** in the Scans head.
- [ ] **Step 4: Run** the test and the two e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Card: Parameters, Scans and Print profile".

### Task 15: The Tracings section

Spec §2 "Tracings", §3 "Tracings" (the panel).

**Files:**
- Create: `app/src/renderer/ui/card/Tracings.tsx`
- Modify: `app/src/renderer/ui/TracingRows.tsx`, `ui/tracings/TracingPanel.tsx` (+ test; rendered inside the section
  while the Tracing view shows), `ui/tracings/LayerRows.tsx`, `ui/tracings/PhotoRows.tsx`, `ui/tracings/TracingView.tsx`
  (no longer mounts the panel at its top left), `styles/card-misc.css`, `styles/tracings.css`
- Modify: `docs/manual.md` (The tracing view, A photo under a tracing, A tracing in the 3D view),
  `.claude/rules/tracings.md`, `.claude/rules/viewport-overlay.md`, `e2e/tracings.spec.ts`, `e2e/tracing-3d.spec.ts`,
  `e2e/lineup.spec.ts`

- [ ] **Step 1: Write the failing test** in `TracingPanel.test.ts`: rendered in the section, it keeps every word it
  asserts today (`4.731 px/mm`, `2.1°`, `not exact`, `Fade`, `Line up again`, `Swap photo`, `Remove photo`, `Hide`) and
  has `data-section="tracings"` as its container.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement: one row per tracing (`T1`, name, photo file), the line-up line, the eye of Show in 3D on the
  row, **New tracing** in the head's line, and the open tracing's panel unfolded in the section with the section in sight
  while the Tracing view shows.
- [ ] **Step 4: Run** the test and the three e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Card: Tracings, with the open tracing's panel".

### Task 16: The sketch and the review round in the head

Spec §3 "3D sketches" (the panel), "Reviews" (the round's panel). Ruling: the sketch panel moves to the card's head.

**Files:**
- Modify: `app/src/renderer/ui/sketch/SketchPanel.tsx` (+ test), `ui/review/RoundPanel.tsx` (+ test),
  `ui/card/InHand.tsx` (the `sketch` and `review` kinds), `ui/ViewportPane.tsx` (no `SketchPanel` over the view),
  `App.tsx` (no `RoundPanel` over the view), `styles/card-hand.css`, `styles/sketch.css`, `styles/reviews.css`
- Modify: `docs/manual.md` (3D sketches: "The panel"; Reviews: "After the next build"), `.claude/rules/marks-window.md`,
  `e2e/sketch.spec.ts`, `e2e/review.spec.ts`

**Interfaces:**
- Consumes: `headKind` (Task 10).
- Produces: the Snap and X-ray switches move into `SketchPanel` (from `SketchPens`, which keeps the pens until Task 18).

- [ ] **Step 1: Write the failing tests**: `SketchPanel.test.ts` asserts the order chip, "Sketch", "draft, goes with your
  next prompt", Name, "Take it", the ⌀ field, "Planes and strokes", the Snap and X-ray switches, Comment, Undo and Done,
  and its container has `data-head="sketch"`. `RoundPanel.test.ts` keeps its words and has `data-head="review"`. A new
  `inHand.test.ts` case, `head caps at 60 % of the card`, renders with a card height of 600 and expects a `max-height`
  of 360 px on the head.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. While the head holds the sketch or round, the selection is not shown. It returns at Done or
  End.
- [ ] **Step 4: Run** the tests, `e2e/sketch.spec.ts` and `e2e/review.spec.ts`, then the four suites.
- [ ] **Step 5:** Commit: "Card head: the open sketch and the review round".

---

## Stage 4: the view's chrome

### Task 17: Tag placement and the `Tag` component

Spec §2 "Tags".

**Files:**
- Create: `app/src/shared/tagPlace.ts`, `app/src/shared/tagPlace.test.ts`
- Create: `app/src/renderer/ui/view/Tag.tsx`, `app/src/renderer/ui/view/useTagAt.ts`, `app/src/renderer/styles/tags.css`
  (into `app.css` after `layout.css`; also create there, empty, `styles/compass.css`, `styles/bands.css`,
  `styles/caption.css` and `styles/procedures.css` for Tasks 18 to 25)
- Modify: `app/src/renderer/ui/notePlacement.ts` (uses `placeTag`), `app/src/renderer/viewport/overlay.ts` (an exported
  `projectToPane(p: Vec3): Pt | null`, null when behind the camera)

**Interfaces:**
- Consumes: `Pt`, `Box`, `leaderPath`, `setToolLeaders` (Task 4).
- Produces:
  - `type Side = 'above' | 'right' | 'below' | 'left' | 'docked'`
  - `placeTag(subject: Pt | null, size: { w: number; h: number }, view: Box, avoid: Box[], prefer?: Side): { box: Box; side: Side }`:
    it tries `prefer` (the last side), then above, right, below and left, each clamped inside `view` with 60 px clear on
    the left for the reed. It skips a side that covers the subject or meets an `avoid` box. With no subject, or no side
    that fits, it is `docked` at the bottom middle above the hint (`view.h - 56 - size.h`).
  - `<Tag id subject={Vec3 | null} prefer?>`, whose children are the tag's contents. It registers its leader with
    `setToolLeaders` unless docked. It is positioned outside React per frame (a subscription to the camera, as
    `marks/labels.ts`), with `--raise`, a hairline, `--radius-float`, `--float-shadow` and 4 px padding.
  - `useTagAt(id)` is the per-frame hook for a tool's code.

- [ ] **Step 1: Write the failing tests** (`tagPlace.test.ts`):

```ts
const view = { x: 0, y: 0, w: 670, h: 800 }
it('goes above when there is room', () => expect(placeTag({ x: 300, y: 400 }, { w: 120, h: 30 }, view, []).side).toBe('above'))
it('keeps its side while it still fits', () => expect(placeTag({ x: 300, y: 400 }, { w: 120, h: 30 }, view, [], 'right').side).toBe('right'))
it('avoids the compass', () => expect(placeTag({ x: 600, y: 60 }, { w: 120, h: 30 }, view, [{ x: 538, y: 0, w: 132, h: 330 }]).side).not.toBe('above'))
it('stays clear of the reed', () => expect(placeTag({ x: 20, y: 400 }, { w: 120, h: 30 }, view, []).box.x).toBeGreaterThanOrEqual(60))
it('docks with no subject', () => expect(placeTag(null, { w: 120, h: 30 }, view, [])).toEqual({ box: { x: 275, y: 714, w: 120, h: 30 }, side: 'docked' }))
```

- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement `placeTag`, `projectToPane`, `Tag` and `useTagAt`. `notePlacement.placeBeside` calls
  `placeTag`, and `notePlacement.test.ts` must stay green.
- [ ] **Step 4: Run** the unit tests, then the four suites.
- [ ] **Step 5:** Add tags to `.claude/rules/leaders.md`. Commit: "Tags: placed beside their subject, tied by a leader".

### Task 18: The reed

Spec §2 "The reed", §3 "3D sketches" (the pens), "Tracings" (the tools).

**Files:**
- Modify: `app/src/renderer/ui/ToolPalette.tsx` (the name pill, Select's scope, Measure's choices from its strip, Shape's
  choice, Draw's pens), `ui/sketch/SketchPens.tsx` (deleted; its test moves to `ToolPalette`), `ui/tracings/Palette.tsx`
  (+ test; same look; Trace's and Ink's choices in the pill), `ui/projectBoard/Palette.tsx` (the look only),
  `state/tools.ts`, `styles/tools.css`, `styles/regions.css`, `styles/sketch.css`
- Create: `app/src/renderer/ui/view/reedPill.ts`, `app/src/renderer/ui/view/reedPill.test.ts`
- Modify: `docs/manual.md` (Marks: the tools; Keys: "Point at a tool of the palette…" becomes the reed),
  `.claude/rules/viewport-overlay.md`, `e2e/tools.spec.ts`, `e2e/measure.spec.ts`, `e2e/sketch.spec.ts`, `e2e/sets.spec.ts`

**Interfaces:**
- Produces: `pillOf(tool: ToolName, state: { scope: SelectScope; scopeOpen: boolean; sketching: boolean }): null | {
  name: string; key: string; choices: Array<{ id: string; label: string; key?: string }> }`. Select gives null unless
  `scopeOpen` or `scope !== 'any'`. Measure gives Distance, Angle, ⌀, r and `T` thickness. Shape gives its four. Draw
  gives Free `B`, Line `L`, Points `P` and Erase `C`. Region gives Brush and Box. Align gives a name only.

- [ ] **Step 1: Write the failing tests** (`reedPill.test.ts`): Select with scope `any` and the pill not open gives null;
  with scope `set` it gives Any, Face, Edge, Part and Set; Draw's choices are exactly the four pens with keys `B L P C`.
  `ToolPalette` markup: no key letter in a button, each button with `aria-keyshortcuts`, and the pressed tool's pill with
  its key cap. Keep the `data-tool` attributes.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement: groups as pills on the panel at 94 %, 34 px round buttons, the accent circle for the tool in
  hand, and the name growing out in 0.22 s (off under reduced motion). The tips and quiet scan tools are as today. Keys
  goes to the rail. Measure's strip at the bottom left is removed (its reading moves to Task 23).
- [ ] **Step 4: Run** the unit tests and the four e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Reed: the tool in hand grows its name and choices".

### Task 19: The caption at the pointer, and the hint

Spec §2 "Who owns each edge of the view" (caption, hint). Ruling 5.

**Files:**
- Modify: `app/src/renderer/ui/ToolHint.tsx` (becomes the caption at the pointer, keeping `aria-live="polite"` and its
  words), `state/step.ts` (+ test), `ui/AgentLine.tsx`, `viewport/highlight.ts` (the readout's look),
  `viewport/sketchHint.ts` (its box takes the caption's look; a snap is an accent caption), `styles/caption.css`,
  `styles/tools.css`, `styles/overlays.css`
- Create: `app/src/renderer/ui/view/Hint.tsx` (bottom middle: the pointer hint, the agent's line, a sketch's standing line)
- Modify: `docs/manual.md` (Keys: the line that says what the tool waits for), `.claude/rules/viewport-overlay.md`,
  `e2e/tools.spec.ts`, `e2e/measure.spec.ts`

**Interfaces:**
- Produces: `CAPTION_USES = 10`, `CAPTION_PAUSE_MS = 500`, `toolUses(storage): number` and `countToolUse(storage)` (key
  `torno.toolUses`, try/catch), and `captionShows(uses: number, stillMs: number): boolean`.

- [ ] **Step 1: Write the failing tests** (`step.test.ts`): `captionShows(3, 0)` is true, `captionShows(10, 100)` is false,
  `captionShows(10, 500)` is true, and `toolUses` of a throwing storage is 0.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement. The caption is an ink pill 18 px below and right of the pointer, positioned outside React.
  The words in the live region are always present, and only the visual shows on the pause rule. The bottom middle hint
  is a pill on the panel at 92 %.
- [ ] **Step 4: Run** the test and the two e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Caption: what the tool waits for, at the pointer".

### Task 20: The compass

Spec §2 "The compass". Ruling 2.

**Files:**
- Create: `app/src/renderer/ui/view/Compass.tsx`, `app/src/renderer/ui/view/ViewCube.tsx`,
  `app/src/renderer/ui/view/compass.ts`, `app/src/renderer/ui/view/compass.test.ts`
- Modify: `ui/ViewBar.tsx` and `ui/ViewsStrip.tsx` (their logic moves into `Compass`; the files go),
  `ui/ExplodeControl.tsx` (`ExplodeToggle` in the compass), `viewport/viewCube.ts` and `viewport/overlay.ts` (the live cube
  is drawn into the tile's box, only while sketching; `CUBE_HALF_PX` 34), `styles/compass.css`; delete `styles/viewbars.css`
  and `styles/views.css` (from `app.css`)
- Modify: `docs/manual.md` (Explode and saved views; Section), `.claude/rules/saved-views.md`, `.claude/rules/explode.md`,
  `e2e/views.spec.ts`, `e2e/explode.spec.ts` ("the view bar is one row" becomes "the compass fits at 1280 × 800"),
  `e2e/spread.spec.ts`

**Interfaces:**
- Produces:
  - `foldSavedViews(s: { toolHasTags: boolean; explodeOpen: boolean; procedure: boolean; stackBottom: number; topTag:
    number | null }): 'stack' | 'pill' | 'none'`. It gives `none` while Align or Region is in hand, `pill` while a
    tool with tags is in hand or explode is open or the stack would meet a tag, and `stack` otherwise.
  - `<ViewCube>`: an SVG of a still iso cube whose faces are buttons named `Top view, 4`, `Front view, 2`, `Right view, 3`,
    with a corner button `Iso view, 1` and "···" (Back, Left, Bottom). The face of the view on screen has `data-on`.
    While sketching the tile shows the live canvas cube instead, with the caption "Planes".

- [ ] **Step 1: Write the failing tests**: `foldSavedViews` for each case, and `ViewCube` markup (the four buttons by name,
  `data-on` on Front when the view is Front).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the compass at the top right: the cube tile (118 × 112, `--radius-sheet`), Perspective / Ortho
  with `O`, the layout, Fit `F`, Explode, and the saved views (on, proposed in `--agent-mark` dashed with Keep and
  Discard, "+ Save view `N more`" opening `ViewsStrip`'s list and menu as a popover). The padlock for Draw sits on a face.
- [ ] **Step 4: Run** the unit tests and the three e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Compass: the views at the top right".

### Task 21: Bands

Spec §2 "A band", §3 "Reviews" (the bar), "Tracings" (line-up).

**Files:**
- Create: `app/src/renderer/ui/view/Band.tsx`, `app/src/renderer/ui/view/band.ts`, `app/src/renderer/ui/view/band.test.ts`
- Modify: `ui/CompareBar.tsx`, `ui/ReviewBar.tsx` (+ test), `ui/tracings/NewTracing.tsx` (`FacePickBar`),
  `ui/tracings/LineUp.tsx` (its bar), `ui/projectBoard/BoardSwitch.tsx` (steps aside under a band), `ui/BuildStatus.tsx`
  or `App.tsx` (the failed-build band's state), `styles/bands.css`, `styles/reviews.css`, `styles/align.css`,
  `styles/tracings.css`
- Modify: `docs/manual.md` (Reviews: the bar; Compare; the line-up), `.claude/rules/viewport-overlay.md`,
  `e2e/compare.spec.ts`, `e2e/review.spec.ts`, `e2e/lineup.spec.ts`, `e2e/tracings.spec.ts`, `e2e/history.spec.ts`

**Interfaces:**
- Produces: `type BandKind = 'export' | 'review' | 'failed' | 'sketch' | 'compare' | 'lineup' | 'facePick'` and
  `bandOf(s: { exportOpen; roundOpen; lineup; facePick; comparing; sketching; failedOnShow }): BandKind | null`, with the
  priority export, then lineup, facePick, review, compare, sketch, failed. `<Band kind tone: 'accent' | 'quiet'>` is 34 px
  and `--radius-full`, with a drop of 8 px in 0.3 s.

- [ ] **Step 1: Write the failing tests**: `bandOf` priorities (export over review; review over sketch), and
  `ReviewBar.test.ts` keeping its words (`Review of h41` becomes the band's "Reviewing `h41`", `Plain`, `End`, `Send
  review`, the counts in `num`) with the container `data-band="review"`.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. Review pens are pills with a round sign disc (Task 24 defines the disc's CSS class
  `.sign-disc`; use it here). The sketch band reads "Sketching `M7` on `XZ, y = 40`". The failed band reads "On show:
  `h40`. The build after it failed." The compare band holds Before, Overlay, After, Side by side and Back to live.
- [ ] **Step 4: Run** the unit tests and the five e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Bands: one sentence at the top left for a mode of the whole view".

### Task 22: Section's tag and its rule

Spec §2 "Tags" (Section).

**Files:**
- Modify: `app/src/renderer/ui/SectionBar.tsx` (becomes `SectionTag`, in a `Tag`), `viewport/overlay.ts` (draws the rule
  and the handle: `drawSectionRule(plane, bounds)`), `tools/sectionTool.ts` (dragging the handle on the rule),
  `styles/tags.css`, `styles/overlays.css`
- Create: `app/src/renderer/viewport/sectionRule.ts`, `app/src/renderer/viewport/sectionRule.test.ts`
- Modify: `docs/manual.md` (Section), `.claude/rules/section.md`, `e2e/section.spec.ts` (the controls by their names: X Y
  Z, "Plane position in millimetres", "From a face", "Flip", "Off"; the slider "Offset along the normal" is now the rule's
  handle with `role="slider"` and the same name)

**Interfaces:**
- Produces: `ruleTicks(min: number, max: number): Array<{ at: number; label?: string }>`, every 5 mm with a label every
  20 mm, and `handleAt(offset: number, min: number, max: number): number` (0 to 1).

- [ ] **Step 1: Write the failing tests**: `ruleTicks(-10, 100)` has 23 ticks and labels at 0, 20, 40, 60, 80 and 100.
  `handleAt(44, -10, 100)` is about 0.4909. In the e2e test, the tag's box is inside the view and does not meet the
  reed's or the compass's box at 1440 × 900 and 1280 × 800.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. Middle and Make a tracing go in the tag's menu. The problem tag is in `--fail` on
  `--fail-wash`. The caption reads "Drag along the rule, or the plane `Esc`".
- [ ] **Step 4: Run** the unit tests and `e2e/section.spec.ts`, then the four suites.
- [ ] **Step 5:** Commit: "Section: its controls on the plane, its rule on the ground".

### Task 23: Measure's tag; Explode's tag and track

Spec §2 "Tags" (Measure, Explode).

**Files:**
- Modify: `app/src/renderer/tools/measureTool.ts` (the reading's subject point: the line's middle),
  `viewport/heldValue.ts`, `ui/ExplodeControl.tsx` (`ExplodeBar` becomes `ExplodeTag`), `viewport/overlay.ts`
  (`drawExplodeTrack`), `styles/tags.css`; delete `styles/explode.css` (from `app.css`)
- Create: `app/src/renderer/ui/view/MeasureTag.tsx`
- Modify: `docs/manual.md` (Measuring; Explode), the design spec's section 7 sentence ("the last one stays in the tool's
  strip" becomes "in the tool's tag"), `.claude/rules/explode.md`, `.claude/rules/dimensions.md`, `e2e/measure.spec.ts`,
  `e2e/explode.spec.ts`

- [ ] **Step 1: Write the failing tests**: in `e2e/measure.spec.ts`, the reading `36.00 mm` and "Keep as a dimension" are
  in an element with `data-tag="measure"` inside the view, and `Enter` keeps a dimension as today. In
  `e2e/explode.spec.ts`, `E` shows the tag with its `role="status"` line, and `window.__tornoTest.exploded()` holds as
  today.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. The reading is mono 19 px with its unit at 11 px and the words "between faces, exact · `Δz
  36.00`". Explode's tag holds the amount, "apart, for the view only", From centre X Y Z, ×0.5 to ×4 and "`E` puts them
  together". The track is graduated 0 to 100 % with a handle.
- [ ] **Step 4: Run** both e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Measure and Explode: their readings beside the parts".

### Task 24: The tags of Compare, a sketch, a tracing, and the review's signs

Spec §2 "Tags" (Compare, the sketch plane), §3 "3D sketches", "Reviews" (signs), "Tracings" (Should be here, Measure).

**Files:**
- Create: `app/src/renderer/ui/view/changeTags.ts`, `app/src/renderer/ui/view/changeTags.test.ts`
- Modify: `ui/CompareBar.tsx` (the corner boxes go; tags and "and N more" in the band), `ui/sketch/SketchPanel.tsx` (the
  offset tag tied to the plane's handle), `ui/tracings/offsetTool.ts` and `ui/tracings/measureTool.ts` (their notes
  become tags with leaders in the tracing view; no Tell Claude button), `ui/chat/RefChip.tsx` and `ui/MarkRow.tsx` (the
  `.sign-disc` before a chip with an intent), `viewport/marks/labels.ts` (the disc beside a chip in the view; dimmed
  marks mixed toward the ground while the review band is on), `styles/tags.css`, `styles/reviews.css`, `styles/marks.css`
- Modify: `docs/manual.md` (Reviews: signs; Compare; the tracing tools), `.claude/rules/tracings.md`,
  `.claude/rules/marks-window.md`, `e2e/compare.spec.ts`, `e2e/review.spec.ts`, `e2e/tracing-measures.spec.ts`,
  `e2e/tracing-marks.spec.ts`

**Interfaces:**
- Produces: `changeTags(summary: TurnSummary, max = 4): { tags: Array<{ subject: string; text: string }>; more: number }`
  from `turnSummary` and `netParts`, with the parts whose volume changed most first and a flipped dimension before parts.
  `.sign-disc` is an 18 px round, mono 12 px 600 in `--on-mark`: `[data-sign="-"]` is a hatch of `--user-mark` (2 px
  stripes at 135°, the mark colour mixed 70 % toward white between) and `[data-sign="+"]` is solid `--agent-mark`.

- [ ] **Step 1: Write the failing tests**: `changeTags` from a fixture of 6 changed parts and one flip gives 4 tags (the
  flip first) and `more === 3`. `IntentMenu.test.ts` and `MarkRow.test.ts`: a don't-want mark renders `.sign-disc[data-sign="-"]`
  before its chip, keeping `− M8` in its accessible text.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. The dimmed marks use `color-mix`, not `opacity` (styles test). Should be here's tag keeps the
  words "`M15` head bolt 4 should be here · `1.8 mm` left, `0.6 mm` up".
- [ ] **Step 4: Run** the unit tests and the four e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Tags for Compare, the sketch plane and tracings; signs on review marks".

### Task 25: Procedure cards, the note card, Confirm, and the scan read question

Spec §2 "Procedure cards", "The note card", "Drop a scan, the scan read question", "Confirm".

**Files:**
- Modify: `app/src/renderer/ui/AlignBar.tsx`, `ui/align/*`, `ui/RegionBar.tsx`, `ui/NotePopover.tsx` (+ test),
  `ui/Confirm.tsx`, `ui/ScanReadSheet.tsx`, `styles/procedures.css`, `styles/align.css`, `styles/regions.css`,
  `styles/controls.css`, `styles/scans.css`, `styles/overlays.css`
- Create: `app/src/renderer/ui/Popover.tsx` (anchored to an element, with a stem, used by Confirm and later by the
  strip and export)
- Create: `app/src/renderer/ui/scanDial.ts`, `app/src/renderer/ui/scanDial.test.ts`
- Modify: `docs/manual.md` (Scans: the question; Align; Region), `.claude/rules/scans-window.md`,
  `.claude/rules/scans-regions.md`, `e2e/align.spec.ts`, `e2e/region.spec.ts`, `e2e/scan.spec.ts`, `e2e/confirm.spec.ts`

**Interfaces:**
- Produces: `<Popover anchor: HTMLElement; side?: 'below' | 'above'; width?: number; onClose>` (radius 10, `--raise`,
  stem, `Escape` closes, focus returns to the anchor). `dialSizes(asRead: [number, number, number]): Array<{ unit: 'mm' | 'cm' |
  'm' | 'in' | 'ft'; size: string }>` (the scan's box as read, in mm) gives the longest side for each unit, in mono form (`0.412`, `4.12`, `412`, `10.46`,
  `125.6`).

- [ ] **Step 1: Write the failing tests**: `dialSizes([0.412, 0.18, 0.29])` gives `412` for `m` and `10.46` for `in`
  (the longest side times the unit's millimetres, through `shared/format.ts`). `confirm.spec.ts`: the confirm is a `role="alertdialog"` anchored to its button, with the
  safe button focused and `Escape` cancelling. `align.spec.ts` and `region.spec.ts` find the cards by their titles
  "Align scan" and "Region of a scan".
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the cards at the bottom right (300 px, Align 320), Align's steps as a vertical sequence, and
  Region's count and actions. The note card takes the tag look with no leader. The scan question is a card under the
  switch, tied to the scan's corner by a leader, with the dashed box at the unit pointed at drawn on the overlay.
- [ ] **Step 4: Run** the unit test and the four e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Procedures at the bottom right; Confirm as a popover; the scan asked about in the view".

### Task 26: The foot of the view, freed

Spec §2 "The bottom of the view".

**Files:**
- Modify: `app/src/renderer/styles/layout.css` (remove `--bar-lift`, `--hint-lift`, `--bar-floor`, `--bar-side`,
  `--stack-side`, `--strip-top`, `[data-narrow]` and `[data-raised]` rules), `ui/ViewportPane.tsx` (no `data-narrow`),
  `viewport/overlay.ts` (remove `BAR_SIDE` and `NARROW_BELOW`; keep `TRIAD_CLEAR`), `viewport/overlay.test.ts`
- Modify: `e2e/section.spec.ts` (the test "the bar stays clear of the triad…" is replaced), `e2e/themes.spec.ts`
  (`data-raised` and `data-narrow` checks go), `e2e/stable.ts` (comment), `.claude/rules/viewport-overlay.md`

- [ ] **Step 1: Write the failing tests**: in `overlay.test.ts`, `layout.css` contains none of the removed names. In
  `section.spec.ts`, a new test "nothing over the reed, the compass or the band" runs at 1440 × 900 and 1280 × 800, with
  a selection and without, with Section in hand: the tag's box meets none of `.reed`, `.compass` and `.band`, and lies
  inside the view's box.
- [ ] **Step 2: Run** them. Expected: FAIL (the old names are still there).
- [ ] **Step 3:** Remove the old rules and code.
- [ ] **Step 4: Run** `overlay.test.ts`, `section.spec.ts` and `themes.spec.ts`, then the four suites.
- [ ] **Step 5:** Commit: "View: the foot holds the hint, the triad and the grid step, nothing else".

---

## Stage 5: the session dock

### Task 27: The dock's header and its menus

Spec §2 "The session dock" (header).

**Files:**
- Modify: `app/src/renderer/ui/SessionPane.tsx`, `ui/chat/ModelMenu.tsx`, `ui/chat/ModeMenu.tsx`, `ui/chat/EffortMenu.tsx`
  (inside one model button's menu), `ui/chat/PromptsOnly.tsx` (reached from "more"), `styles/session.css`
- Create (empty, listed in `app.css` after `chat.css`): `styles/strip.css`, `styles/chat-prompt.css`,
  `styles/chat-slip.css`, `styles/chat-foot.css`
- Modify: `docs/manual.md` (The agent: the session pane), `.claude/rules/session-pane.md`, `.claude/rules/chat-pane.md`,
  `e2e/session.spec.ts`, `e2e/account.spec.ts`, `e2e/instructions.spec.ts`, `e2e/agents.spec.ts`

- [ ] **Step 1: Write the failing test** in `e2e/session.spec.ts`: the header has "Claude Code", the state word, one
  button whose name starts with the model, the Chat / Terminal segment, and a "More" button whose menu has End, Resume,
  New session, Prompts only, What Claude Code reads and Hide session. End on a busy session still asks.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement. What the next prompt carries moves into the composer's box (Task 32 renders it; until then
  keep the line). The instruction files go under "What Claude Code reads". The `agent.json` note is one warn line above
  the composer.
- [ ] **Step 4: Run** the four e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Dock: one header row".

### Task 28: The builds strip

Spec §2 "The builds strip", "The status line" (ticks). Ruling 9.

**Files:**
- Create: `app/src/renderer/ui/strip/BuildsStrip.tsx`, `app/src/renderer/ui/strip/strip.ts`,
  `app/src/renderer/ui/strip/strip.test.ts`
- Modify: `ui/SessionPane.tsx` (the strip on top in chat, terminal, no session), `ui/chat/TurnBuilds.tsx` (goes),
  `ui/chat/TurnEnd.tsx`, `ui/BuildStatus.tsx` (+ test; ticks), `styles/strip.css`, `styles/status.css`
- Modify: `docs/manual.md` (Projects and builds: the history; The chat), `.claude/rules/builds-history.md`,
  `.claude/rules/chat-transcript.md`, `e2e/history.spec.ts`, `e2e/history-cause.spec.ts`, `e2e/loop.spec.ts`

**Interfaces:**
- Consumes: `useHistory`, `useThumb`, the build state in the store.
- Produces:
  - `type StripNode = { id: string; kind: 'built' | 'failed' | 'running'; by: string; saved: boolean; starred: boolean;
    onShow: boolean; reviewing: boolean; after?: string }`
  - `stripNodes(history: HistoryEntry[], live: { status: 'idle' | 'building' | 'ok' | 'failed'; onShow: string | null;
    failedAfter?: string; reviewing?: string; prompt?: number }): StripNode[]`, oldest to newest
  - `bracketOf(nodes: StripNode[], promptsInSight: number[]): { from: number; to: number; label: string } | null`
  - `STRIP_FOLD_BELOW = 640`, `stripFolded(dockHeight: number): boolean`
  - `ticksOf(nodes: StripNode[], n = 8): StripNode[]` for the status line

- [ ] **Step 1: Write the failing tests** (`strip.test.ts`): an empty history gives no node; a failed build after h40 is a
  `failed` node with `after: 'h40'` and h40 `onShow`; a running build is the last node, `running`; a person's save is
  `saved` with `by: 'you saved'`; the bracket over prompts 14 covers h41's index; `stripFolded(639)` is true and
  `stripFolded(640)` false; 41 builds give 8 ticks with the one on show among them when it is older.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement the strip (136 px, `--surface`): the head line with the count and what a pick does, the nodes
  (62 × 44 pictures, ids in mono, the muted line), the failed hatch, the running outline with its seconds, the bracket
  that follows the conversation's scroll, a node landing in 0.7 s, the sideways scroll keeping the build on show in sight,
  and the fold under 640 px. In the status line, the ticks replace the history button. `HistorySheet` is reached from
  "More".
- [ ] **Step 4: Run** the unit test and the three e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Builds strip: the project's memory on top of the dock".

### Task 29: A node's menu: compare, star, pin, review, go back; a failed node's error

Spec §2 "The builds strip" (click, failed), "Go back". Ruling 4.

**Files:**
- Modify: `app/src/renderer/ui/strip/BuildsStrip.tsx`, `ui/chat/GoBack.tsx` (in a `Popover` from the node; the struck
  preview), `ui/BuildErrorSheet.tsx` (+ test; in a `Popover` from the failed node), `ui/chat/Items.tsx` (prompts struck
  while Go back asks), `styles/strip.css`
- Create: `app/src/renderer/ui/strip/nodeMenu.ts`, `app/src/renderer/ui/strip/nodeMenu.test.ts`
- Modify: `docs/manual.md` (Go back; Compare; a failed build), `.claude/rules/goback.md`, `.claude/rules/builds-history.md`,
  `e2e/history.spec.ts`, `e2e/finalfix.spec.ts`, `e2e/compare.spec.ts`

**Interfaces:**
- Consumes: `Popover` (Task 25), `stripNodes` (Task 28), `planLines` (`GoBack.tsx`).
- Produces: `nodeMenu(node: StripNode, s: { canReview: boolean; goBackTo: string | null }): Array<'compare' | 'star' |
  'unstar' | 'pin' | 'review' | 'goback'>`. `goback` appears only when `goBackTo` is set (the prompt after the build exists
  and the `goback` rule allows it). `review` appears only for `built` nodes when `canReview`. A failed node's menu is its
  error.

- [ ] **Step 1: Write the failing tests**: `nodeMenu` for a built, on-show node with no later prompt gives no `goback`; a
  starred node gives `unstar`. `e2e/history.spec.ts`: with the stand-in agent, two turns, then "Go back to here" on the
  first node opens the confirm from that node, lists the plan's lines, and strikes the second prompt in the conversation.
  Confirming restores the files as today.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. The failed node's popover has the error tail, **Copy**, **Whole error** and **Ask Claude Code
  to fix it**.
- [ ] **Step 4: Run** the unit test and the three e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Strip: a build's menu, Go back from a node, a failed build's error".

### Task 30: The conversation in prompts

Spec §2 "The conversation" (heads, blocks, tools, turn end, queued).

**Files:**
- Modify: `app/src/renderer/ui/chat/Items.tsx` (+ `items.test.ts`), `ui/chat/ChatPane.tsx`, `ui/chat/TurnEnd.tsx`,
  `ui/chat/ToolCard.tsx`, `ui/chat/fold.ts`, `ui/chat/SaveLine.tsx`, `styles/chat-prompt.css`, `styles/chat.css`
- Modify: `docs/manual.md` (The chat), `.claude/rules/chat-transcript.md`, `.claude/rules/chat-cards-and-refs.md`,
  `e2e/chat.spec.ts`, `e2e/talk.spec.ts`, `e2e/chatbridge.spec.ts`

- [ ] **Step 1: Write the failing test** in `items.test.ts`: a prompt renders a head with "Prompt", its number in `num`
  and `h40 → h41`, and the person's words in `.chat-you`. A torno tool chip has `data-torno`. The turn end has "Done in"
  with the seconds in `num`, "See changes", "Compare", and a "More" button whose menu has Go back, Star and Pin. The
  existing class assertions (`chat-item chat-added`, `chat-item chat-build`) are updated to the new names in the same
  test.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement the look from the spec. "Show text" and "Earlier in this conversation" keep their words.
- [ ] **Step 4: Run** the test and the three e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Chat: the conversation cut into prompts".

### Task 31: The build slip and its table

Spec §2 "The build slip" (Session A's table).

**Files:**
- Modify: `app/src/renderer/ui/chat/BuildLine.tsx` (+ test), `ui/chat/turnSummary.ts`, `styles/chat-slip.css`
- Create: `app/src/renderer/ui/chat/slipTable.ts`, `app/src/renderer/ui/chat/slipTable.test.ts`,
  `app/src/renderer/ui/chat/CountUp.tsx`
- Modify: `docs/manual.md` (The chat: what a build line says), `.claude/rules/build-digest.md` (the window's side),
  `e2e/loop.spec.ts`, `e2e/chat.spec.ts`

**Interfaces:**
- Produces: `slipTable(line: BuildLineData, max = 6): { flips: Flip[]; rows: Array<{ part: string; before: string; after:
  string; change: string; exact: boolean }>; hidden: number; unchanged: number }`, sorted by the size of the change. The
  numbers are formatted through `shared/format.ts`, and `≈` stays where not exact. `<CountUp from to format>` counts once
  in 0.7 s and shows `to` at once under reduced motion.

- [ ] **Step 1: Write the failing tests**: from the fixture of h40 → h41 (four parts changed, five unchanged),
  `slipTable` gives the rows in the order tub, lid, snorkel-fwd, snorkel, with `change` `+6.3 %` on the first,
  `unchanged === 5` and `hidden === 0`. With eight changed it gives 6 rows and `hidden === 2`. `BuildLine.test.ts`: the
  table has a head row "Volume, mm³", `h40`, `h41`, "change", and its cells in `num`. The failed form keeps "The build
  after".
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the slip on `--surface` (radius 10), with the flip row and the table.
- [ ] **Step 4: Run** the unit tests and the two e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Slip: what a build changed, in columns".

### Task 32: The foot: tasks, suggestions, the box, and the ask

Spec §2 "The foot", "An ask". The borrowed leader: §1 "The leader rule" 3.

**Files:**
- Modify: `app/src/renderer/ui/chat/Composer.tsx`, `ui/chat/Tasks.tsx`, `ui/chat/Suggestions.tsx`,
  `ui/chat/WaitingNotes.tsx`, `ui/chat/ReviewChip.tsx`, `ui/chat/SetTagChip.tsx`, `ui/chat/AskCard.tsx`,
  `ui/QuestionCard.tsx` (into the dock's foot; no longer over the view), `ui/chat/RefChip.tsx` (borrows a leader on hover),
  `ui/ViewportPane.tsx` (no `QuestionCard`), `styles/chat-foot.css`, `styles/chat.css`, `styles/overlays.css`
- Create: `app/src/renderer/ui/chat/AskTakeover.tsx`
- Modify: `docs/manual.md` (The chat: the composer, asks), `.claude/rules/asks.md`, `.claude/rules/chat-pane.md`,
  `.claude/rules/chat-cards-and-refs.md`, `e2e/chatask.spec.ts`, `e2e/chattrust.spec.ts`, `e2e/chat.spec.ts`,
  `e2e/startchat.spec.ts`, `e2e/terminal.ts` (if needed)

**Interfaces:**
- Consumes: `borrowLeader` (Task 4), `projectToPane` (Task 17).

- [ ] **Step 1: Write the failing tests**: in `chatask.spec.ts`, with the stand-in agent asking a question of three
  options, the takeover is at the dock's foot with a `--warn` top edge (`data-ask`), its options are buttons with keys
  `1` to `3`, pointing at one sets `data-hot` on its ref chip, and "None of these" works as today. Torno's own ask
  (`QuestionCard`) appears in the same place while the dock shows, and while the dock is hidden the status line's
  needs-you button shows the dock and focuses it (`focusAsk`).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the task line, the suggestions, the box (`--raise`, `--field-edge`, radius 10) with what goes
  with the prompt inside it, the placeholders as today, and Stop and Queue while working.
- [ ] **Step 4: Run** the four e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Dock foot: the box holds what goes with the prompt; asks take over the foot".

---

## Stage 6: export, keys, changes

### Task 33: Export weights per item (main)

Spec §2 "Export, on the bench" (per-line weights).

**Files:**
- Modify: `app/src/shared/exportdata.ts` (`ExportPlan.items`), `app/src/main/export/build.ts` (`exportPlan`),
  `app/src/main/export/build.test.ts`

**Interfaces:**
- Produces: `ExportPlan.items: Array<{ id: string; kind: 'page' | 'object' | 'marks' | 'resolved' | 'off' | 'scan';
  object?: string; bytes: number }>`. The page itself is `kind 'page'`, each project is `'object'`, and each scan is
  `'scan'`. The sum of `bytes` equals `ExportPlan.bytes`. Items not ticked are listed with the bytes they would add and
  `on: false`.

- [ ] **Step 1: Write the failing tests** (`build.test.ts`): `items sum to bytes` for a plan with one project, marks and
  a scan (only the ticked items count toward the sum); an unticked scan's item has `on: false` and its weight; a refused
  plan (over 64 MB) still lists items.
- [ ] **Step 2: Run** `pnpm -C app exec vitest run src/main/export/build.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement from the sizes `exportPlan` already works out.
- [ ] **Step 4: Run** it, then the four suites.
- [ ] **Step 5:** Commit: "Export plan: what each line weighs".

### Task 34: Export in the dock

Spec §2 "Export, on the bench". Rulings 6 and 7.

**Files:**
- Modify: `app/src/renderer/ui/ExportSheet.tsx` (docked in the dock below the strip; tiles; lines with weights; the
  rule; saving; saved hand-off), `ui/SessionPane.tsx` (the session's 40 px foot band while export is open),
  `ui/BuildStatus.tsx` (the saved file lands where Export… was, with its read-back popover), `ui/view/Band.tsx` (the
  export band), `ui/ViewportPane.tsx` (the 2 px frame; the left-out tag), `styles/sheets.css`, `styles/status.css`
- Create: `app/src/renderer/ui/export/weighRule.ts`, `app/src/renderer/ui/export/weighRule.test.ts`
- Modify: `docs/manual.md` (Export, STEP STL and 3MF, A picture of the view and a tracing), `.claude/rules/export-page.md`,
  `.claude/rules/export-saving.md`, `e2e/export.spec.ts`, `e2e/packaged.spec.ts` (if it opens export), `e2e/show.spec.ts`

**Interfaces:**
- Consumes: `ExportPlan.items` (Task 33), `Popover` (Task 25), `Band` (Task 21).
- Produces: `weighRule(items, budget: number): { segments: Array<{ kind; share: number }>; over: number; ticks: number[] }`.
  The shares are of the budget, the overflow past the budget is its own share, and the ticks are 0, half the budget and
  the budget.

- [ ] **Step 1: Write the failing tests**: `weighRule` of items of 413 kB, 2 kB and 1.1 MB on a 12 MB budget gives three
  segments whose shares add to the total over the budget, `over === 0` and ticks `[0, 6 MB, 12 MB]` in bytes. Over the
  budget, `over` is the overflow's share. `export.spec.ts` keeps its flows on new selectors: the tiles by name ("A page",
  "CAD", "Slicer", "Picture", "Tracing"), lines by their switches, "Export page", and saved shows the file in the status
  line with "Show in folder". With an ask arriving while export is open, the dock's foot band says "needs you".
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. Close and `Esc` return the dock to the conversation. Picture and Tracing are dimmed with the
  reason in their title when not of the project on show.
- [ ] **Step 4: Run** the unit test and the e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Export: on the bench, in the dock, with what each line weighs".

### Task 35: The keyboard and its sentences

Spec §2 "The keys".

**Files:**
- Create: `app/src/shared/keyboard.ts`, `app/src/shared/keyboard.test.ts`, `app/src/shared/keySentences.ts`,
  `app/src/shared/keySentences.test.ts`
- Modify: `app/src/renderer/ui/KeySheet.tsx`, `styles/keys.css`
- Modify: `docs/manual.md` (Keys: the first paragraphs only; the tables stay generated), `.claude/rules/keys.md`,
  `e2e/tools.spec.ts` or a key spec that opens `?`

**Interfaces:**
- Produces:
  - `KEYBOARD: Array<Array<{ code: string; label: string; w?: number; mod?: true }>>`, the US QWERTY rows from `` ` `` to
    Space, with `Esc` and `F6`
  - `capOf(code: string, context: Context, rows = cheatSheet()): { does: string | null; tool: boolean; view: boolean }`
  - `sentencesFor(query: string, rows = cheatSheet()): Array<{ context: Context; sentence: string; notHeard?: string }>`.
    For example `sentencesFor('explo')` includes `{ context: 'Viewport', sentence: 'In the view, E explodes the parts,
    and E again puts them together.' }`. Sentences are built from the rows' `does`, never written by hand per key.

- [ ] **Step 1: Write the failing tests**: every single-key row of `KEYS` (no modifier) has a cap in `KEYBOARD`; `capOf('KeyE',
  'Viewport').tool` is false and `.view` true; `capOf('KeyD', 'Viewport').tool` is true; `sentencesFor('E')` has one
  sentence per context where `E` is heard (Viewport, Region); `sentencesFor('zzz')` is empty.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the sheet rising from the foot (400 px, a scrim above). The places are chips, then the
  keyboard (56 × 48 keys), modifier keys listed under it, search on the right with sentences, the count line, and
  "No key says …".
- [ ] **Step 4: Run** the unit tests, `readme.test.ts` and the e2e spec, then the four suites.
- [ ] **Step 5:** Commit: "Keys: a keyboard you can read, and answers in sentences".

### Task 36: Changes over the view

Spec §2 "Changes of a turn".

**Files:**
- Modify: `app/src/renderer/ui/chat/ChangesSheet.tsx`, `App.tsx` (the sheet covers the view's area only),
  `ui/chat/Items.tsx` (the turn lit while open), `styles/sheets.css`, `styles/chat.css`
- Modify: `docs/manual.md` (The chat: See changes), `.claude/rules/chat-log-and-undo.md`, `e2e/chat.spec.ts` (See
  changes)

**Interfaces:**
- Consumes: `changeTags` (Task 24), `actions.compare`.

- [ ] **Step 1: Write the failing test** in `e2e/chat.spec.ts`: "See changes" opens `role="dialog"` named "Changes in this
  turn" inside the view's box (not over the card or dock), with the file tabs and the diff. `Escape` closes it, and the
  turn's `data-open` goes.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement: the top half has the parts with tags and the `h40` / `h41` scrubber through Compare, and the
  bottom half the code.
- [ ] **Step 4: Run** it, then the four suites.
- [ ] **Step 5:** Commit: "Changes: the parts and the code together, over the view".

---

## Stage 7: screens without a model, and the bench

### Task 37: The dyed plate and the first screen

Spec §2 "The first screen", §1 "Motion" (the vise).

**Files:**
- Create: `app/src/renderer/ui/plate/Plate.tsx`, `app/src/renderer/ui/plate/ScribedVise.tsx`,
  `app/src/renderer/styles/plate.css` (into `app.css` before `welcome.css`)
- Modify: `app/src/renderer/ui/Welcome.tsx`, `ui/Readiness.tsx` (line glyphs), `ui/readyLines.ts`, `styles/welcome.css`,
  `styles/ready.css`, `ui/Logo.tsx` (a `scribed` form)
- Modify: `docs/manual.md` (Run, Five minutes with torno), `.claude/rules/first-screen.md`, `.claude/rules/readiness.md`,
  `e2e/welcome.spec.ts`, `e2e/login.spec.ts`

**Interfaces:**
- Produces: `<Plate headline: string; lead?: ReactNode; drawing?: 'vise' | 'vise-unknown'>` on `--dye`, with the vise in
  `--on-dye` lines that draw themselves in 1.6 s, the dimensions in `--scribe` and the text in mono `--on-dye-muted`.
  `prefers-reduced-motion` shows it drawn.

- [ ] **Step 1: Write the failing test** in `welcome.spec.ts`: first run and returning, the plate has `data-plate`, the
  heading "torno", the tagline words, and the recent folders as rows with Remove on a missing one. "Open folder" and
  "Open the example" work as today.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement the split: the plate is 780 / 1440 of the width and the right side is padded 64.
- [ ] **Step 4: Run** the two e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "First screen: the dyed plate and the recent folders".

### Task 38: The empty folder's composer

Spec §2 "The empty folder".

**Files:**
- Modify: `app/src/renderer/ui/EmptyWorkspace.tsx` (+ test), `ui/onboard/NewObject.tsx` (`openNewObject` takes the words
  and attachments), `styles/cards.css` or `styles/plate.css`
- Create: `app/src/renderer/ui/plate/folderFromWords.ts`, `app/src/renderer/ui/plate/folderFromWords.test.ts`
- Modify: `docs/manual.md` (Making a new project), `.claude/rules/new-object-create.md`, `e2e/objects-create.spec.ts`,
  `e2e/onboard.spec.ts`

**Interfaces:**
- Produces: `folderFromWords(words: string, taken: string[]): string`, a valid folder name (letters, digits, `-`, `_`)
  from the first nouns. For example, "A clip that holds a 6 mm cable…" gives `cable-clip`, and a taken name gets `-2`.
  The fallback is `project`.

- [ ] **Step 1: Write the failing tests**: `folderFromWords('A clip that holds a 6 mm cable to the edge of a desk', [])` is
  a valid name (matches `objectName.ts`'s rule) and `folderFromWords('', [])` is `'project'`. A taken name gets
  `-2`. `e2e/objects-create.spec.ts`: in an empty folder, typing words and pressing Start makes the folder and starts the
  stand-in session with those words as its first prompt.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the composer: the box, the add-chips (Photo, Doodle, Bought part, Scan, opening today's
  pickers), "Goes in `parts/…` ▾" (editable), Start, the link to the full page carrying what was typed, and the
  `pyproject.toml` fold.
- [ ] **Step 4: Run** the unit test and the two e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "Empty folder: say what we are making, and start".

### Task 39: The new project page

Spec §2 "The new project page".

**Files:**
- Modify: `app/src/renderer/ui/onboard/NewObject.tsx`, `ui/onboard/Slot.tsx`, `ui/onboard/DraftPane.tsx` (+ test; on the
  dye), `ui/onboard/SizesSlot.tsx`, `ui/onboard/RulesSlot.tsx`, `ui/onboard/ReferenceItems.tsx`, `styles/onboard.css`
- Modify: `docs/manual.md` (Making a new project), `.claude/rules/new-object-page.md`, `.claude/rules/new-object-onboard.md`,
  `e2e/onboard.spec.ts`, `e2e/objects-create.spec.ts`

- [ ] **Step 1: Write the failing test** in `DraftPane.test.ts`: the pane has `data-plate`, "What Claude gets first", and
  the line "Makes `parts/cable-clip/` with …", with the existing draft text assertions kept.
- [ ] **Step 2: Run** it. Expected: FAIL.
- [ ] **Step 3:** Implement the layout. The slots keep their contents and rules. The dock is hidden on this page.
- [ ] **Step 4: Run** the test and the two e2e specs, then the four suites.
- [ ] **Step 5:** Commit: "New project: the brief on paper, what Claude gets on the dye".

### Task 40: The bench's data (main)

Spec §2 "The page of projects" (data this needs).

**Files:**
- Modify: `app/src/shared/show.ts` (`ObjectCard.box`, `ObjectCard.waiting`), `app/src/shared/thumbnail.ts` (+ test; a
  bench mode), `app/src/main/show/cards.ts` (+ test; `thumb.json` keeps `box`; `waiting` from `main/asks.ts`),
  `app/src/renderer/viewport/thumbnail.ts`, `app/src/renderer/state/thumbs.ts` (+ test)

**Interfaces:**
- Produces:
  - `ObjectCard.box?: { x: number; y: number; z: number; exact: boolean }` (mm, of the layout pictured)
  - `ObjectCard.waiting?: { question: string; since: number }` (the question cut to 140 characters)
  - `BENCH_MM_PER_PX = 0.5`, and `thumbnailPlan(scene, view, { bench: true })`, which gives a fixed iso camera, a
    transparent ground and the scale `BENCH_MM_PER_PX`, so that a picture's pixel size is `box / BENCH_MM_PER_PX`
    projected. `thumb.json` gains `box` and `bench: true`.

- [ ] **Step 1: Write the failing tests**: `thumbnail.test.ts` (the bench plan's camera is the iso direction and its scale
  is fixed whatever the parts' size); `cards.test.ts` (a `thumb.json` with `box` reads into `ObjectCard.box`, one
  without gives none, and a session waiting on an ask gives `waiting.question` cut to 140 characters).
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. The kernel's box comes from the scene, exact where the B-rep's is. No build is started for a
  picture, as today.
- [ ] **Step 4: Run** the tests, then the four suites.
- [ ] **Step 5:** Commit: "Cards: a project's size and what its session waits on".

### Task 41: The bench

Spec §2 "The page of projects".

**Files:**
- Modify: `app/src/renderer/ui/ShowPage.tsx`, `ui/cards.ts` (+ test), `styles/cards.css`
- Create: `app/src/renderer/ui/bench.ts`, `app/src/renderer/ui/bench.test.ts`
- Modify: `docs/manual.md` (The page of projects), `.claude/rules/page-of-objects.md`, `e2e/show.spec.ts`, `e2e/objects.ts`

**Interfaces:**
- Consumes: `ObjectCard.box`, `.waiting` (Task 40).
- Produces: `shelvesOf(cards: ObjectCard[], openId: string | null): { needs: ObjectCard[]; working: ObjectCard[]; rest:
  ObjectCard[] }`, with the rest ordered by `sourcesMtimeMs`, newest first, and `benchScale(cards, shelfWidth: number):
  number` (one scale for the page, fitting the widest shelf).

- [ ] **Step 1: Write the failing tests**: `shelvesOf` with one waiting, one building and six others gives 1, 1 and 6,
  with the rest ordered by mtime; `benchScale` makes the widest shelf fit. `show.spec.ts`: the page shows "Needs you",
  "Working" and "The rest", an unbuilt project as "Size not known until it builds", True scale / Grid switching, and
  the keys (arrows, Enter, `/`, Escape) as today.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement the shelves (2 px ink), the 50 mm bars, the labels and the ask card with **Answer**. At a
  window 800 px tall or less the page scales to 86 %.
- [ ] **Step 4: Run** the unit tests and the e2e spec, then the four suites.
- [ ] **Step 5:** Commit: "Page of projects: a bench at true scale, who needs you first".

---

## Stage 8: outside the window, and the end

### Task 42: The site, the export page, and Plex removed

Spec §5 (the site, the export page). Ruling 8: faces and tokens only.

**Files:**
- Modify: `site/assets/site.css`, `site/index.html` (preload), `app/scripts/build-site.mjs` (copies Instrument Sans 400,
  500, 600 and Martian Mono 400 woff2), `app/src/export/page.css` (faces, any token left)
- Modify: `app/package.json`, `pnpm-lock.yaml` (remove `@fontsource/ibm-plex-sans`, `@fontsource/ibm-plex-mono`),
  `app/src/renderer/main.tsx`

- [ ] **Step 1: Write the failing test**: `fonts.test.ts` (Task 2) gains "no `IBM Plex` anywhere in `app/src`, `site/`
  or `app/scripts`", and `export/page.test.ts` checks the page's tokens against the window's.
- [ ] **Step 2: Run** them. Expected: FAIL.
- [ ] **Step 3:** Implement. Build the site (`node app/scripts/build-site.mjs` or its script) into a temp folder and check
  that the fonts are there.
- [ ] **Step 4: Run** the tests, then the four suites.
- [ ] **Step 5:** Commit: "Site and export page in the new faces; Plex removed".

### Task 43: Section 10, the invariants, the rules, the manual's last pass

Spec §1 ("Section 10, as it will read", "The design invariants"), §5.

**Files:**
- Modify: `docs/superpowers/specs/2026-10-08-torno-design.md` (section 10 replaced word for word; section 7's Measure
  sentence if Task 23 did not), `CLAUDE.md` (the invariants; "Rules by area" lists `leaders`)
- Modify: every `.claude/rules/*.md` whose `paths:` name a file that moved or went (`grep` each `paths:` entry against the
  tree; none may point at nothing)
- Modify: `docs/manual.md` ("Not yet verified on a visible screen": the new window's items in its to-try part, keeping its
  required words; a last read for "panel", "palette", "view bar", "strip of views", "the bar at the foot")

- [ ] **Step 1: Write the failing test**: a new `app/src/rules.test.ts` that reads every `.claude/rules/*.md`, takes its
  `paths:` globs, and expects each to match at least one file. Run it to see which rules point at removed files.
- [ ] **Step 2: Run** it. Expected: FAIL on the rules of removed files (`PanelHost`, `ViewBar`, `ViewsStrip`, …).
- [ ] **Step 3:** Fix every rule, write section 10 and the invariants, and do the manual's pass.
- [ ] **Step 4: Run** `rules.test.ts` and `readme.test.ts`, then the four suites.
- [ ] **Step 5:** Commit: "Design spec, CLAUDE.md and rules follow the new window".

### Task 44: The README pictures

Spec §5 (README pictures).

**Files:**
- Modify: `docs/images/*.png` (the same files, taken again), `README.md` (its words about the window)

- [ ] **Step 1:** Read Luis's recipe for the pictures: the `TORNO_README_*` settings in `app/e2e/readme.spec.ts` and
  `readme-workspace.ts`. The renames and scan ids that recipe needs are not in the repo. Ask the director (t4) for them
  before running, and do not guess them.
- [ ] **Step 2:** Run `readme.spec.ts` in the hidden window with those settings, from `app/`, as the Global Constraints
  say. It writes the pictures through its own capture path, never `page.screenshot()`.
- [ ] **Step 3:** Look at every picture (Read tool) in light and dark: the new window, nothing cut, no private path or
  name in it. Update `README.md`'s words where they name a place in the window.
- [ ] **Step 4: Run** `readme.test.ts` (README anchors), then the four suites.
- [ ] **Step 5:** Commit: "README: pictures of the new window".

### Task 45: Whole-branch review, then the PR

- [ ] **Step 1:** Run the four suites and the typecheck once more on `work/redesign`, one after another. All must pass;
  record the counts.
- [ ] **Step 2:** One whole-branch review by the `reviewer` agent on Opus (read-only): the diff of `work/redesign`
  against `main`, the spec and this plan. Brief it to check the spec's rulings (section 8), the "names and behaviour kept"
  list (section 4), the Global Constraints, and the five lines of Review Focus, and to report verified findings ranked by
  severity.
- [ ] **Step 3:** Fix what it confirms, a commit per fix, with the suites green after each.
- [ ] **Step 4:** Audit before publishing (the repo is public): search the branch's diff and every commit message for
  absolute paths, user names, hostnames and anything from outside the repo.
- [ ] **Step 5:** Write the PR's title and body (short, plain, humanized; linked to the issues it closes, if any) and
  hand them to the director. Do not push and do not open the PR: Luis does, or says to.

---

## Order and parallel work

Serial means the task waits for the one before it on `work/redesign`. A parallel group's tasks branch from the same
commit into their own worktrees (`.worktrees/<branch>`). They touch disjoint files (the stylesheets they need were created
empty by the task before), and they merge back in any order. Then the next task starts.

| Stage | Tasks | Order |
|---|---|---|
| 1 | 1, 2, 3, 4 | **1, 2, 3 serial** (all three edit `tokens.css`). **4 in parallel with 1 to 3** (new files only, plus one line in `App.tsx` and `app.css`: merge it last) |
| 2 | 5, 6, 7, 8 | **5 and 6 in parallel** (renderer grid vs main and bridge). Then **7 and 8 in parallel** (7: `TitleBar`, `App.tsx`; 8: `Rail.tsx`, `rail.css`) |
| 3 | 9 to 16 | 9 first (it creates the card's stylesheets). Then **10, 11, 12, 13, 14 and 15 in parallel** (each owns its components and its `card-*.css`; 11 and 12 both read `markGroups.ts`: 11 owns it, 12 consumes `splitMarkGroups` from 11, so **12 after 11**). 16 after 10 |
| 4 | 17 to 26 | 17 first (it creates the view's stylesheets). Then **18, 19, 20 and 21 in parallel** (reed, caption, compass, bands: separate components and stylesheets; 18 and 19 both touch `tools.css`, so 19 puts the caption's rules in `caption.css` only). Then **22, 23 and 25 in parallel**, then 24 (it uses the bands and the review band of 21). 26 last |
| 5 | 27 to 32 | 27 first (it creates the dock's stylesheets). 28, then 29. **30 and 31 in parallel** with 28 and 29 (chat items and the slip vs the strip). 32 last (it touches `Composer`, `AskCard` and `ViewportPane`) |
| 6 | 33 to 36 | **33, 35 and 36 in parallel**. 34 after 33 |
| 7 | 37 to 41 | **37 and 40 in parallel**. Then **38 and 39 serial** (both touch `NewObject.tsx`). 41 after 40 |
| 8 | 42 to 45 | Serial: 42, 43, 44, 45 |

Every e2e run is one at a time on this machine, even when tasks are built in parallel: run the suites of a parallel
task after its siblings have merged, or in turn.

**Task count:** stage 1: 4 · stage 2: 4 · stage 3: 8 · stage 4: 10 · stage 5: 6 · stage 6: 4 · stage 7: 5 · stage 8: 4. Total 45.
