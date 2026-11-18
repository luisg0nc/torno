---
paths:
  - "app/src/renderer/styles/**"
  - "app/src/shared/contrast.ts"
  - "app/src/shared/contrast.test.ts"
  - "app/src/renderer/viewport/theme.ts"
  - "app/src/renderer/viewport/sectionDrawing.ts"
  - "app/src/renderer/viewport/sectionDrawing.test.ts"
  - "app/src/export/page.css"
  - "app/e2e/themes.spec.ts"
---

# Stylesheets, tokens, light and dark

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## About this folder (`app/src/renderer`)

The UI (`ui/`), the three.js viewport (`viewport/`), the tools that point at it (`tools/`), the store
(`state/`) and the stylesheets (`styles/`: `tokens.css`, and `app.css`, which is nothing but the list of
the stylesheets by area in the order of the cascade; `styles.test.ts` holds it to that).

## Light and dark (`app/src/renderer`)

- The tokens (`app/src/renderer/styles/tokens.css`) are held to their
  contrasts by `shared/contrast.test.ts`, which reads the file: whatever is
  read as text is 4.5:1 on the ground it stands on (`--ink` 7:1; `--muted`,
  `--accent`, `--ok`, `--warn`, `--fail` on `--surface` and `--panel`; the
  accent on its wash; the sixteen terminal colours on the panel, but the dark
  theme's black); what is only drawn is 3:1 (the two mark colours on the
  surface); a hairline is between 1.15 and 2; the edge of an input or a text area is `--field-edge`, 3:1 on both (WCAG 1.4.11). A token is changed there first.
- **Faces** (spec 2026-11-18 §1): Instrument Sans (400, 500, 600) for the interface and Martian Mono (300, 400, 500) for every number, ref, file name,
  key cap and code, from `@fontsource/instrument-sans` and `@fontsource/martian-mono` (pinned, latin subset, imported in `renderer/main.tsx`,
  bundled; the CSP stays `font-src 'self' data:`). The names are written in four files only: `shared/fonts.ts` (`UI_FACE`, `MONO_FACE`, `canvasFont`,
  for a canvas, a terminal and a file), `tokens.css` (`--font-ui`, `--font-mono`), `main/export/html.ts` (`FONTS`: the faces an exported page carries, Instrument
  Sans 400 and 600, Martian Mono 400) and `export/page.css`; `shared/fonts.test.ts` holds it. Martian Mono has no 600: canvas text in it is 500.
  Its latin subset lacks `≈ ⌀ →` (they fall back to `ui-monospace`); it has `× ± ° ² ³ − µ`. `.num` (in `layout.css`) is `0.86em`, `-0.02em`, tabular figures,
  `0.12em` of margin each side; a column or table sets its own size and no margin.
- The redesign's tokens (spec 2026-11-18 §1), all in `tokens.css`, light and dark: `--raise` (what floats: tags, popovers, fields,
  the composer), `--on-accent` (on `--accent`), `--dye` with `--scribe`, `--on-dye` and `--on-dye-muted` (the dyed field and
  what is drawn and said on it; `--dye` is `--accent` in light, a deep blue in dark), `--on-mark` (on both mark colours),
  `--warn-wash` and `--fail-wash` (the grounds of Needs you, an ask, a failed build or check), `--band` and `--band-edge` (a
  gauge), `--route` (the line down the card and its section dots), `--float-shadow` (the one shadow), `--scrim`, `--ease`,
  `--space-5` and `--space-6`, `--text-row` (12.5px; `--text-size` is 13.5px, `--text-leading` 1.42). The radius grows with
  how far a thing floats: `--radius-inline` 4px (chips and refs in a line, key caps), `--radius-control` 6px (buttons, fields,
  rows, segments), `--radius-float` 10px (tags, popovers, cards in the dock, the composer), `--radius-sheet` 14px (the cube
  tile, the empty folder's composer, the keyboard), `--radius-full` 999px (pills, bands, the caption); a `border-radius` in the
  window's sheets is one of these, `0`, `50%` or `inherit` (keys.css keeps 7px for the keyboard's keys and chat.css 12px 12px
  12px 3px for the person's words, which the spec states; the export tiles take `--radius-control` and the frame round the
  view it previews `--radius-float`; a tracing's title block is drawn in SVG), and the one shadow is `--float-shadow`: no other `box-shadow` has a blur over 4px (insets and rings are free);
  `styles.test.ts` holds both, and that `--palette-shadow` and `--radius-palette` are gone (also in `export/page.css`). The
  window's sizes are tokens: `--title-h` 40px, `--card-w` 296px, `--rail-w` 52px, `--dock-w` 420px, `--status-h` 28px and `--panel-w`
  (an alias of `--card-w`); a window under 1360px takes `--card-w` 264px and `--dock-w` 384px (a media query in `tokens.css`). `RAIL_W`,
  `LEFT_DEFAULT`, `LEFT_MIN` in `state/column.ts` and `DOCK_DEFAULT`, `DOCK_NARROW` in `state/dock.ts` are held to the tokens. The new text pairs are held in
  `contrast.test.ts` in both themes: `--ink` 7:1 and `--muted`, `--accent` and the verdicts 4.5:1 on `--raise`, `--warn-wash`
  and `--fail-wash`; `--on-accent` on `--accent`, `--on-dye` and `--on-dye-muted` on `--dye`, `--on-mark` on both marks 4.5:1;
  `--scribe` on `--dye` and `--field-edge` on `--raise` 3:1 (the dark `--field-edge` is `#747A82` for that); `--route` on
  `--panel` and `--hairline` on `--raise` hairlines (1.15 to 2); `--band-edge` on `--band` 2:1, `--ok` and `--fail` on `--band`
  3:1; `--dye` equals `--accent` in light. Text on a chip is `--on-accent` or `--on-mark`, never `--panel`.
- A verdict (`--ok`, `--fail`) is no mark's colour to the eye, in both
  themes: 1.5:1 at least from the mark colour of its hue (`--agent-mark`,
  `--user-mark`), darker in light and lighter in dark. A verdict is read, a
  mark is drawn. Muted words and the verdicts are 4.5:1 on `--accent-wash`
  too. The dark `--warn` is an ochre, not an amber.
- An edit drawn as a diff has its own two washes, no red and no green (`--diff-removed-wash`, a grey between the panel and
  the hairline; `--diff-added-wash`, the value of `--accent-wash`): `--ink` 7:1 and `--muted` 4.5:1 on both, the blue 60° of hue
  at least from both marks and both verdicts (`contrast.test.ts`).
- A mark's lines (a pin's leader, an arrow's shaft, a stroke, a dimension's
  lines, a shape's outline) are drawn over a casing in `--panel`, 2 px wider
  (`MarkColours.casing`, `Parts.cased` in `viewport/marks/markObjects.ts`; in
  an exported page `.mark-casing` under `.mark-line`, as SVG over the
  canvas). The line is 3:1 on its casing; the casing is 3:1 on every part
  colour in dark and 2:1 in light, where no panel-coloured casing can do more
  against pastel parts.
- The person's ink on a picture of the view is `--drawing-ink`, magenta in both themes: 3:1 on its casing and on the
  ground, 30° of hue at least from either mark colour, and no axis's, the accent's or `--deviation-near`
  (`contrast.test.ts`). `ui/drawing/make.ts` writes the light values out for where the stylesheet cannot be read.
- What the system draws follows the theme: `color-scheme` is one scheme at a time, said outright in
  `tokens.css` (never `light dark`, which left the native light scrollbars in the dark theme), and every
  scroller of the window has the thin bar in `--scroll-thumb` (`late.css`). `e2e/themes.spec.ts` holds both.
- No text is dimmed by `opacity`, and nothing animates without end
  (`styles/styles.test.ts` reads the stylesheets): the dot of a session at
  work is still, and a build's beats with the count of its seconds
  (`data-beat`, set by `BuildStatus` once a second). The axes (`--axis-x`, `-y`, `-z`) are the gizmo's and the triad's, in the view and in a
  picture, and are neither mark colour.
- The eight named-set colours (`--set-1` to `--set-8`, light and dark, `Theme.sets` and `LIGHT_THEME.sets` in `viewport/theme.ts`) are muted,
  none red or green (those are the person's and the agent's), each at least 30° of hue from both mark colours and from the verdicts, and
  at 3:1 on `--surface` in both themes; `shared/contrast.test.ts` holds them and that `LIGHT_THEME.sets` is the tokens. A set is drawn in
  its colour on a layer of its own (`set` in `viewport/highlight.ts`, one set at a time); a proposal's faces are hatched and its edges
  dashed, and its swatch in Layers dashed, so that colour is not the only thing that says it is Claude's.
- The eight layer colours of a tracing (`--layer-blue` … `--layer-olive`, light and dark) are held as the sets are, and told from the ink
  the outline is drawn in (1.5:1), at 3:1 on `--surface` and `--panel`; `LAYER_INKS` in `shared/tracingSvg.ts` is the light values, for a file, and `Theme.layers` in `viewport/theme.ts` the ones the 3D view draws a tracing's layers in (read from the tokens, held to them by `contrast.test.ts`).
- The light values are written out where no stylesheet is read
  (`viewport/theme.ts` `LIGHT_THEME`, `viewport/sectionDrawing.ts` `SHEET`,
  `viewport/overlay.ts` `AXIS_COLOURS`, `SURFACE` in `src/main/index.ts`,
  `src/export/page.css`, and the ink of the launcher's icons, `scripts/torno*.svg`): the same test, and `export/page.test.ts`, hold them
  to the tokens.
