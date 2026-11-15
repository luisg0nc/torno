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
- The light values are written out where no stylesheet is read
  (`viewport/theme.ts` `LIGHT_THEME`, `viewport/sectionDrawing.ts` `SHEET`,
  `viewport/overlay.ts` `AXIS_COLOURS`, `SURFACE` in `src/main/index.ts`,
  `src/export/page.css`): the same test, and `export/page.test.ts`, hold them
  to the tokens.
