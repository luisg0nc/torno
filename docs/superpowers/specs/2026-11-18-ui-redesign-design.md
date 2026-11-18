# torno's UI redesign: one window from five picks

The window is rebuilt. The picks were made in five parts, and the five became one window. In the shell, layout blue
becomes a material. The session dock is organised around the project's builds, and the left column is one route card
read from top to bottom. A tool's controls stand on the part it acts on, tied to it by leaders. Export, the keys and the
asks live in the window itself, not in sheets over it. This spec says what that window is, in words, tokens and
numbers, and orders the work so that a plan and a build can follow without the mockups.

**Visual reference** (local branches, kept out of `main`): `design/unified` holds the window as decided,
`design/mockups/unified/window.html` with its states (`?state=`), its pictures `design/mockups/unified/window-*.png`,
`language.md` and `decisions.md`. The parts are `design/shell`, `design/session`, `design/inspector`, `design/tools` and
`design/sheets`, each with `design/mockups/<part>/README.md`, `current.md` and the chosen file
(`shell/b-layout-blue.html`, `session/b-revisions.html`, `inspector/b-route-card.html`, `tools/c-at-hand.html`,
`sheets/b-bench.html`). Where this spec and a mockup differ, this spec wins.

## Why

Each part's `current.md` says what is weak today. The main faults:

- The window has no structure. Seven kinds of floating card look alike, and four kinds of bar compete for the foot of
  the view. A raised-by-n system and a seven-size e2e test keep them apart (`tools/current.md`).
- A tool's controls are far from the tool: the palette is at the left, its bar at the foot and Measure's reading in a
  corner.
- The left column shows one panel at a time. That splits what belongs together: a part, its marks, the checks on it.
  The model's checks and the person's dimensions are in two panels (`inspector/current.md`).
- A turn's outcome and the builds sit in three places that never meet: the status line, the build lines and the strip
  at the turn's end. Numbers that should be a table are written as prose (`session/current.md`).
- The front door reads like a settings page, and the folder's name is hidden in a panel that can be closed
  (`shell/current.md`).
- Export, the keys and the changes are sheets that cover the part (`sheets/current.md`).

## Decided (Luis, 2026-11-17 and 2026-11-18)

- **Picks:** Shell B (layout blue), Session B (revisions), Inspector B (route card), Tools C (at hand, all of it as
  mocked), Sheets B (on the bench).
- **Borrowings:** Shell C's order on the page of projects (Needs you, Working, then the rest) and its composer on the
  empty folder. Session A's aligned table of what a build changed. Session C's leader on hover over a ref. Inspector A's
  two-line rows and its tolerance gauge. Inspector D comes later, as the route card's part-in-focus state: leave room for
  it, do not build it. Sheets A's weight on each line of the export. Sheets C's keys found by a sentence in search.
- **Type:** Instrument Sans and Martian Mono everywhere.
- **Section 10** of the design spec takes the three changes of the unified design: the grotesque sans, the dyed
  layout-blue field on screens with no model, and radii that grow with the size of the thing. The design invariants in
  `CLAUDE.md` change to match. Both texts are written out below.
- **Reviews (#172)** keep red and green. Shape tells them apart from who made a mark: hatched against solid, the minus
  and plus pens, and the other marks dimmed while reviewing.
- **Claude's proposals** (a suggested view, a proposed layer, a proposed named set) are drawn in Claude's green.
- **#174 is "tracings"** (refs `T1`), and the view's tab says "Tracing", as the merged code has it.
- **The sketch panel** moves from floating over the view to the head of the route card.
- **Merged code against the mockup:** the code's behaviour and names win, and the mockup's look and placement win. Each
  such place is listed under "The merged features in the new window" and under "Names and behaviour kept".
- **Delivery:** one branch, `work/redesign`, one PR at the end, built in stages that each leave the app working with
  green tests.

## Goals

- One window, light and dark, that carries every pick and every borrowing, and no other features.
- One set of tokens. Both faces are bundled with the app and never fetched. One rule for leaders, one for radii, one for
  motion.
- Every behaviour that works today keeps working: every key, every rule of the merged features, every ask, every
  number and how exact it is. The redesign moves controls and changes how they look. It changes what they do only where
  this spec says so.
- The foot of the view goes back to the hint, the triad and the grid step. `--bar-lift`, `--hint-lift`, `data-raised`,
  `--stack-side`, `--strip-top` and the narrow-view stacking all go.
- The manual, the rules, `CLAUDE.md`, the README pictures, the export page and the site agree with the window at the
  end.

## Non-goals

- The 3D render itself: three.js, the camera, the lights, how parts, marks, scans, sections and sketches are drawn in 3D.
  The tags, the leaders, the section's rule and the explode track are drawn over the view, on the overlay canvas or in
  the DOM, and do not enter the scene.
- The board's layout. The board takes the new tokens and type, and its tools move into the reed's look (below), but its
  canvas, cards and frames keep their layout.
- The exported page's layout. It takes the new tokens and faces only. Sheets B's page without a side panel is left for
  later (ruling 6).
- Inspector D's part in focus. The card's head is built so that a focus state can take its place later.
- New features. A borrowed idea that needs data torno does not have yet is listed with that data, or is left out.
- Translations of the window. It stays in English, as today.

## Anti-goals

- No blue field on a screen that shows a model. The dye is for screens without one.
- No more than one leader that does not belong to the tool in hand. A leader never crosses text.
- No colour alone for a state. Every sign also has a word, a shape or a hatch, as today.
- No text dimmed by `opacity`, and nothing animates without end. `styles.test.ts` keeps both rules.
- No network font, no font CDN. The mockups load Google Fonts, and the app must not.
- No control-room look: no black, red or amber dashboards, no condensed uppercase labels, no corner-tick frames.

---

## 1. The design language

The idea stays a toolroom surface plate: calm, light and exact, with the part the only loud thing on a screen that
shows one. Layout blue is now a material too: the dye a machinist paints on steel before scribing. It covers whole
screens only where there is no model (the first screen, the empty folder, the prompt side of a new project). Everywhere
else it marks one thing at a time: what is pressed, the tool in hand, a leader, the band of a mode.

### Tokens

Names follow `tokens.css`. **New** marks a token that does not exist today; **changed** marks a new value.

| Token | Light | Dark | Use |
|---|---|---|---|
| `--surface` | `#F1EFEA` | `#1A1C1F` | the view's ground, the title bar, the rail, the builds strip |
| `--panel` | `#FAF9F6` | `#222529` | the route card, the dock, the status line |
| `--raise` **new** | `#FFFFFF` | `#2A2D32` | what floats: tags, popovers, fields, the selected segment, the composer |
| `--ink` **changed** | `#20242B` (was `#22252A`) | `#E9E7E2` | text |
| `--muted` **changed** | `#62666D` (was `#646970`) | `#9EA3AA` (was `#9A9FA6`) | secondary text |
| `--hairline` | `#DAD6CE` | `#33373C` | dividers |
| `--field-edge` **changed in dark** | `#8A857B` | `#747A82` (was `#6C727A`) | the edges of inputs, 3:1 |
| `--scroll-thumb` | `#84888E` | `#72777E` | unchanged |
| `--accent` | `#1D46B8` | `#7C9BF7` | layout blue |
| `--accent-wash` | `#E3E9F8` | `#252F4A` | pressed, in sight, picked, lit |
| `--on-accent` **new** | `#FFFFFF` | `#0F1630` | text and icons on the accent |
| `--dye` **new** | `#1D46B8` | `#16275A` | the dyed field; a deep blue in dark, not the light accent |
| `--scribe` **new** | `#829EEB` | `#5577DA` | lines drawn on the dye (the vise, its dimensions) |
| `--on-dye` **new** | `#F3F6FE` | `#E8EDFC` | text on the dye |
| `--on-dye-muted` **new** | `#C3D0F5` | `#A9BAEC` | secondary text on the dye |
| `--user-mark` | `#CF3F2C` | `#F0705E` | the person's marks and sketches, Don't want |
| `--agent-mark` | `#288156` | `#5CC492` | Claude's marks, layers, proposed views and sets, Want |
| `--on-mark` **new** | `#FFFFFF` | `#1A1C1F` | text on a mark's chip |
| `--ok` `--warn` `--fail` | `#1B5B3C` `#8C5C16` `#9B2B1D` | `#A9E6C8` `#CBAA6A` `#F9B2A7` | verdicts, read as text; unchanged |
| `--warn-wash` **new** | `#F4ECDD` | `#332B1E` | the ground of Needs you and of an ask |
| `--fail-wash` **new** | `#F6E6E2` | `#3A2826` | the ground of a failed build or check |
| `--band` **new** | `#DCE6DF` | `#2A3A31` | the band of a gauge |
| `--band-edge` **new** | `#7FA08C` | `#4E7A61` | the ends of a gauge's band |
| `--route` **new** | `#C9C4BA` | `#41464C` | the route line down the card and its section dots |
| `--float-shadow` **replaces `--palette-shadow`** | `0 1px 2px rgb(32 36 43 / .07), 0 8px 24px -6px rgb(32 36 43 / .16)` | `0 1px 2px rgb(0 0 0 / .35), 0 10px 26px -6px rgb(0 0 0 / .5)` | the one shadow: what floats over the view or a pane |
| `--scrim` **new** | `color-mix(in srgb, var(--surface) 70%, transparent)` | same | behind the keys |
| diff, part palette, sets, tracing layers, axes, deviation, scan plain, drawing ink, ANSI, terminal | as today | as today | unchanged |

Two values differ from `language.md`. In light, `--scribe` moves from `#7E9BEA` to `#829EEB`, because the old value was
2.96:1 on the dye and a drawn line needs 3:1. In dark, `--field-edge` moves from `#6C727A` to `#747A82`, because fields now
stand on `--raise`, where the old value was 2.85:1. Both changes are small enough not to show.

The dark theme still follows the system (`prefers-color-scheme`), as today. The mockup's `data-theme` switch is a mockup
control, not a feature.

### Contrast

All values below are WCAG ratios computed from the tokens above, light / dark.

| Text | on surface | on panel | on raise | on accent wash | on warn wash | on fail wash |
|---|---|---|---|---|---|---|
| ink | 13.6 / 13.8 | 14.8 / 12.5 | 15.6 / 11.2 | 12.8 / 10.7 | 13.3 / 11.3 | 12.9 / 11.2 |
| muted | 5.0 / 6.7 | 5.5 / 6.1 | 5.8 / 5.4 | 4.8 / 5.2 | 4.9 / 5.5 | 4.8 / 5.5 |
| accent | 7.0 / 6.4 | 7.6 / 5.8 | 8.0 / 5.2 | 6.6 / 5.0 | 6.8 / 5.2 | 6.6 / 5.2 |
| ok | 7.0 / 12.1 | 7.7 / 10.9 | 8.1 / 9.8 | 6.6 / 9.4 | 6.9 / 9.9 | 6.7 / 9.8 |
| warn | 5.0 / 7.7 | 5.5 / 7.0 | 5.7 / 6.3 | 4.7 / 6.0 | 4.9 / 6.3 | 4.7 / 6.3 |
| fail | 6.6 / 9.7 | 7.2 / 8.8 | 7.6 / 7.9 | 6.3 / 7.6 | 6.5 / 7.9 | 6.3 / 7.9 |

Also: on-dye on dye 7.4 / 12.2, on-dye-muted on dye 5.2 / 7.4, scribe on dye 3.1 / 3.4, on-accent on accent 8.0 / 6.7,
on-mark on user-mark 4.8 / 5.8, on-mark on agent-mark 4.8 / 7.9, field edge on panel 3.5 / 3.6, on surface 3.2 / 3.9, on
raise 3.7 / 3.2, route on panel 1.7 / 1.6, band edge on band 2.3 / 2.5. Every text pair passes 4.5:1, every edge of a
field 3:1.

`shared/contrast.test.ts` adds these rules, in both themes:

- `--ink`, `--muted`, `--accent` and the three verdicts at 4.5:1 on `--raise`, `--warn-wash` and `--fail-wash`, as they
  are held today on surface, panel and accent wash (`--ink` 7:1).
- `--on-accent` on `--accent`, `--on-dye` and `--on-dye-muted` on `--dye`, and `--on-mark` on both mark colours: 4.5:1.
- `--scribe` on `--dye`: 3:1 (drawn). `--field-edge` on `--raise`: 3:1.
- `--route` on `--panel` and `--hairline` on `--raise`: between 1.15 and 2, as a hairline.
- `--band-edge` on `--band`: 2:1 at least, and the gauge's tick (`--ok` or `--fail`) 3:1 on `--band`.
- The dye is only the accent's hue: `--dye` light equals `--accent` light.

### Type

**Instrument Sans** (the interface) and **Martian Mono** (every number, ref, file name, key cap and code). Both are under
the SIL Open Font License.

**How they ship.** They come from npm packages, as IBM Plex does today (`@fontsource/ibm-plex-*` 5.3.0, imported as CSS
in `renderer/main.tsx`): `@fontsource/instrument-sans` with weights 400, 500 and 600, and `@fontsource/martian-mono`
with 300, 400 and 500, both in the latin subset. Vite bundles the woff2 files into the renderer, and the CSP stays
`font-src 'self' data:`. The two Plex packages are removed once nothing reads them. The builder checks that both
packages exist at a pinned version, and that their latin subset covers `× ± ≈ ⌀ ° ² ³ → − µ` and the Portuguese
letters. A glyph Martian Mono lacks falls back to `ui-monospace` and is listed in the plan. The places that name the font
in TypeScript change too: `viewport/overlay.ts` (its `document.fonts.load` and the label fonts), `viewport/alignPoints.ts`,
`viewport/heldValue.ts`, `viewport/sketchHint.ts`, `viewport/sectionDrawing.ts`, `ui/SessionPane.tsx` (the terminal's
font) and `main/export/html.ts` (the faces written into an exported page). Each reads `--font-ui` and `--font-mono` or one
constant in `shared/`, never a family name of its own.

**The scale.**

| Role | Size / weight / tracking |
|---|---|
| Plate headline (a screen with no model) | 52 to 86 px, 600, −0.035 em, line 1 |
| Page title (`parts`) | 40 px, 600, −0.035 em, line 0.95 |
| Dialog heading, empty-state heading | 22 to 26 px, 600, −0.02 em |
| Route card section | 16 px, 600, −0.01 em |
| Pane title, sheet title, card head | 13.5 to 15 px, 600 |
| Body, controls | 13.5 px, 400, line 1.42 |
| Chat text | 13.5 px, 400, line 1.55, at most 62 ch |
| Rows, secondary | 12.5 px |
| Small, captions, tooltips | 11.5 to 12 px |
| Tables of numbers | Martian Mono 10.5 px |

The tokens become `--font-ui: 'Instrument Sans', system-ui, sans-serif`, `--font-mono: 'Martian Mono', ui-monospace,
monospace`, `--text-size: 13.5px`, `--text-leading: 1.42` and `--text-small: 12px`, with `--text-row: 12.5px` new.

**The mono rule.** Martian Mono is wide. Set inline in a line of sans, it runs at `0.86em` with `letter-spacing:
-0.02em`, tabular figures, and `0.12em` of margin on each side (class `num`, as today). Without that margin, a sans space
beside it all but vanishes ("Done in58 s"). In a column or a table it is set at its own size (10.5 to 11.5 px) with no
margin. Key caps (`kbd`) are mono 9.5 px in a 18 px box. Sentence case everywhere. No uppercase labels.

### Spacing, radii, sizes

Spacing steps are 4, 8, 12, 16, 24 and 32 px (`--space-1` to `--space-6`; 24 and 32 are new).

The radius grows with how far a thing floats off the page:

| Token | Value | For |
|---|---|---|
| `--radius-inline` **new** | 4 px | chips and refs in a line, key caps |
| `--radius-control` | 6 px | buttons, fields, rows, segments |
| `--radius-float` **replaces `--radius-palette`** | 10 px | tags, popovers, cards in the dock, the composer's box |
| `--radius-sheet` **new** | 14 px | the compass's cube tile, the empty folder's composer, the keyboard |
| `--radius-full` **new** | 999 px | the reed, pills, bands, the caption, a tool's name |

The window's sizes are tokens too: `--title-h: 40px`, `--rail-w: 52px` (was 56), `--card-w: 296px` (the card's default,
which replaces `--panel-w: 248px`), `--dock-w: 420px` (was 520), `--status-h: 28px`. At a window narrower than 1360 px the
defaults are `--card-w: 264px` and `--dock-w: 384px`. Widths the person set by dragging stay theirs (below).

### The leader rule

A leader ties a control or a reading to the thing it is about, as a callout does on a drawing.

1. **Shape.** A 3 px ring on the subject (`--raise` fill, 1.5 px accent stroke), one straight leg, and a 12 px shoulder
   into the nearest edge of the tag. No curves, no arrowheads. The line is 1 px in the accent.
2. **Owner.** The tool in hand owns the leaders in the view: Section's tag, Measure's reading, Explode's track, the
   sketch plane's offset, the tags of Compare, a tracing's Should be here. A tool may have several tags. They belong to
   that one tool.
3. **One borrowed leader.** Pointing at a ref outside the view borrows one leader while the pointer stays (a chip in the
   chat, an option of an ask, a row of the card). The leader may leave the view. Its leg then stops at the edge of the
   pane at the chip's height, and the chip itself is ringed (`data-hot`: a 2 px gap in the pane's ground, then a 1.5 px
   accent ring). It never runs through text. A borrowed leader is only drawn when its subject is on screen in the view.
   Otherwise the chip is ringed and the view lights the subject, as today.
4. **Marks have none.** A mark's chip sits on its point. Pointing at a part raises its marks and checks in the card (the
   accent wash and a 2 px accent bar on the left of each row) instead of drawing lines to them.
5. **Colour.** Always the accent. A leader never says who made something: its chip does.

**How it is drawn.** Each leader is drawn by one layer: an SVG at the size of the window, above every pane and below
popovers (`LeaderLayer`, in `ui/`). It takes a subject point in window pixels and a tag's box, and draws the ring, the
leg and the shoulder. The tags of the tool in hand belong to the view and are placed from 3D points each time the camera
moves, through the overlay's projection (as `marks/labels.ts` places the chips today), never through React per frame. A
borrowed leader takes the chip's box from the DOM and the subject's point from the view, through the same projection.
The leader's draw is the only motion (0.24 s, after its tag pops in 0.2 s).

### Motion

Motion is used only where something changed, and only once.

| Moment | Motion |
|---|---|
| The vise on a dyed plate | its outline draws itself in 1.6 s (`stroke-dashoffset`), the dimensions fade in at 1.1 s, the part fills at 1.4 s |
| A build lands | its node slides into the strip (0.7 s, 34 px). The table's new numbers count up from the old ones (0.7 s). Each gauge tick that moved slides to its new place (0.7 s) |
| A leader | its tag pops (0.2 s, from scale 0.94), then the leader draws out from the subject (0.24 s) |
| The tool in hand | its name grows out of the reed (0.22 s, `clip-path` from the left) |
| A band, a docked sheet, an ask | drops or slides 8 to 40 px (0.28 to 0.4 s) |
| A saved file | lands in the status line where Export… was (0.8 s) |
| The keys | rise from the foot (0.32 s) |

The easing is one token, `--ease: cubic-bezier(.2, .8, .2, 1)`. `prefers-reduced-motion: reduce` turns all of it off:
things appear in place at once, and a number shows its new value without counting.

**Kept from today, against the mockup.** The mockup pulses the dot of a session at work and blinks a caret. The rule
"nothing animates without end" (`styles.test.ts`) stays. The dot of a working session is still, and the status line's
build beats with the count of its seconds (`data-beat`), as today. The text caret is the system's own.

### Section 10, as it will read

The design spec's section 10 is replaced by this text:

> ## 10. Design language
>
> Its own, and deliberately far from a dark control room.
>
> - **Idea:** a toolroom surface plate. Calm, light, exact. The part is the only loud thing on a screen that has a part.
>   Layout blue, the dye machinists paint on steel before scribing it, is also a material: a field of it covers the
>   screens that have no model (the first screen, an empty folder, the prompt side of a new project), with the vise
>   scribed on it in fine lines. Everywhere else it marks one thing at a time.
> - **Layout:** a title bar with the folder and the project, a rail of icons at the left, the route card of the project
>   beside it, the view in the middle, the session docked at the right and a status line at the foot. The route card
>   reads the project from top to bottom (what is in your hand, what needs you, the parts, parameters, checks, marks,
>   scans, tracings, the print profile), and the rail is its index. The tools are a slim reed at the left of the view.
>   A tool's controls stand beside what they act on, tied to it by leaders. The view's own controls are a compass at its
>   top right. The session's builds strip is the project's memory and stays at the top of the dock in every mode. No
>   frames within frames.
> - **Colour:** warm paper-grey surfaces and graphite text in light mode, with a matching dark mode. One accent, layout
>   blue. User marks are red pencil, agent marks are green, so authorship is visible at a glance. Claude's green also
>   marks what Claude proposed (a saved view, a named set, a tracing's layer). In a review, red and green also mean Don't
>   want and Want, told apart from authorship by shape: hatched against solid, a round minus or plus beside the number,
>   and the other marks dimmed. Parts use a muted, distinguishable palette.
> - **Logo** (2026-10-16): torno is Portuguese for a bench vise. The mark is one seen from the side: its jaws and slide
>   holding a part in layout blue, its screw and handle, its base, the vise in graphite on the paper grey. The logo is
>   the mark over the name in the sans, semibold, lowercase. The icon is `scripts/torno.svg` (and `torno-16.svg`, drawn
>   again on whole pixels for 16 px), the window's `app/resources/icon.png` is made from it, and `ui/Logo.tsx` draws the
>   same in the window: in the theme's ink and accent, in one colour where it stands in for a picture, or scribed in
>   lines on the dye.
> - **Type:** Instrument Sans, a grotesque, for the interface, and Martian Mono, with tabular figures, for every number,
>   ref, file name and key. Both are bundled with the app. Sentence case. No all-caps labels.
> - **Feel:** hairline dividers, no glow, no ornament. Radii grow with how far a thing floats: 4 px for a chip in a line,
>   6 px for a control, 10 px for a tag or a popover, 14 px for a sheet, round for the reed, pills and bands. Motion only
>   where it explains a change (a build landing, a leader drawing out, a tool taken up), once, and none when the system
>   asks for less.
> - **Keyboard:** single-key tools (`V` select, `M` measure, `X` section, `P` pin, `A` arrow, `D` draw, `S` shape, `B`
>   region of a scan, `L` align scan), `E` explode, and `?` for the keys. While a sketch is open its own keys take over
>   (the pens `B`, `L`, `P`, `C`, the planes `Shift+1` to `Shift+3`, x-ray `I`).

### The design invariants in `CLAUDE.md`, as they will read

The two lines

> - No control-room look: no black/red/amber, no condensed uppercase labels, no corner-tick frames. Follow spec section
>   10 and the tokens in Task 4.
> - UI text is sentence case. Every number and ref is set in the monospace face.

become

> - No control-room look: no black/red/amber, no condensed uppercase labels, no corner-tick frames. Follow spec section 10
>   and `app/src/renderer/styles/tokens.css`. The dyed blue field (`--dye`) is only for screens with no model on them.
> - UI text is sentence case, in Instrument Sans. Every number, ref, file name and key is in Martian Mono (`num`: 0.86 em
>   with 0.12 em of margin in a line of text). Both faces are bundled; nothing is fetched.
> - Radii come from the four tokens (`--radius-inline`, `-control`, `-float`, `-sheet`) or are round. The one shadow is
>   `--float-shadow`. One accent; a leader is always the accent, and only the tool in hand and one pointed-at ref draw
>   leaders.

The parenthesis "(The tokens in Task 4 are `app/src/renderer/styles/tokens.css`.)" goes, since the line names the file.

---

## 2. The window

### Layout

```
 title bar 40: vise · folder ▾ / project ▾ ··········· who works, who waits · window controls
┌────┬──────────────┬──────────────────────────────────┬──────────────────┐
│    │ head: in hand│ switch or band            compass│ builds strip     │
│rail│──────────────│                                  │──────────────────│
│ 52 │ route card   │ reed       the part       tags   │ conversation, in │
│    │ 296 (264)    │                                  │ prompts          │
│    │              │ triad      hint      card · grid │ composer or ask  │
└────┴──────────────┴──────────────────────────────────┴──────────────────┘
 status 28: project · builds as ticks · build · checks · parts ··· Export… · build123d
```

At 1440 × 900 the view is about 670 px wide, and at 1280 × 800 about 560. The shell becomes one CSS grid
(`grid-template-columns: var(--rail-w) var(--card-w) minmax(0, 1fr) var(--dock-w)`, rows `var(--title-h) minmax(0, 1fr)
var(--status-h)`), in place of the absolute positions of `styles/layout.css` today. A hidden card or dock is a zero
column. The view keeps a minimum width (`VIEWPORT_MIN`, now 420 px), and the card's and dock's drags respect it.

| Part | Owner | Who sets its width |
|---|---|---|
| Title bar | the shell | full width |
| Rail | the shell | fixed, 52 px |
| Route card | the project | `--card-w`, dragged at its right edge (`LeftEdge`, as today); a double click puts the default back |
| View | the tool in hand, the compass, a mode's band | what is left |
| Dock | the session and the builds | `--dock-w`, dragged at its left edge (`.dock-edge`, as today); hidden by its key and its menu; made full height as today |
| Status line | the project's build | full width |

The card's width and whether it is folded stay the window's (`localStorage`, `torno.column`). The dock's width becomes
the window's too, under `torno.dock`. Today it is lost on reload (`App.tsx:348`), and the person's drag should last. Both
are read and written in try/catch, as today.

### Who owns each edge of the view

| Place | Owner | Holds |
|---|---|---|
| Top left | what the view is | the switch Model / Board / Tracing. A mode's band takes this place while it is on |
| Top right | the compass | the cube, Perspective / Ortho, the layout, Fit, Explode, the saved views |
| Left middle | the reed | the tools. The one in hand grows its name, key and few choices |
| On the part | the tool in hand | tags and leaders, the plane, the rule, the track |
| Bottom right | a procedure | the Align and Region cards, above the grid step |
| Bottom middle | the hint | how to move the camera, the agent's line, a sketch's snapping |
| Bottom left | the triad | axes; a tracing's `u, v` readout and scale bar |
| Bottom right corner | the grid step | `grid 20 mm` or the scale bar |
| The frame | export | a 2 px accent edge, inset 8 px, radius 12: this view is the preview |

At the pointer, a **caption** (an ink pill, `--ink` ground, `--surface` text, 12 px, radius 9, 18 px below and right of
the pointer) says what the tool in hand waits for, with `Esc`. It is today's step line (`ToolHint`), moved to where the
eye is. It keeps the `aria-live="polite"` region and its words (`stepFor`, `hintLine`). The bottom middle keeps the pointer
hint (once per install, as today) and the agent's line (`AgentLine`).

### The title bar

The window loses its native frame: `titleBarStyle: 'hidden'`, with `titleBarOverlay` (colour `--surface`, symbols
`--muted`, height 40) where the platform draws it. Where it does not (Linux builds without it), torno draws the three
window controls (46 × 40 each, `--muted` 10 px glyphs) and asks main through the bridge to minimise, maximise or close
(`bridge.ts` gets `window.minimize`, `window.toggleMaximize`, `window.close`; close goes through the existing close
question). The bar is a drag region (`-webkit-app-region: drag`), and its controls are `no-drag`.

From the left: the vise (18 px, `Logo`), then the folder as a crumb (`parts ▾`, 600) that opens the folder menu
(`FolderMenu`, as today: recent folders, Open folder…, Open the example, Check what torno needs). Then `/` in
`--field-edge`, and the project (`intake ▾`, 500), which opens a short menu of the folder's projects with All projects at
its head. On the page of projects, and with no project, only the folder shows. On the new project page, the crumb reads
"New project". At the right, before the window controls, are the **session signs** of the folder's other projects: a
pill each, `guitar-wall-stand is working` (a still `--muted` dot) or `intake needs you` (`--warn-wash` ground, `--warn`
text, 600). At most two pills show, then `+N`. A click opens that project and its ask. These are the signs `switcherSign`
and `sessionSign.ts` already compute, and their words and `aria-description` rules are kept. The folder's name leaves the
Projects panel, since the panel goes.

### The rail

The rail is 52 px of icons on `--surface`, with names in tooltips (an ink pill, 12 px, 6 px right of the icon, shown at
once on hover and on keyboard focus). Each button is 36 × 36, radius 9, with a 19 px icon stroked 1.35 in `--muted`.

- **Projects** at the top. Pressed while the page of projects is up, it is a dyed tile (`--dye` ground, white icon; the
  accent with `--on-accent` in dark). It carries the warn dot of another project's session that waits (8 px, ringed in the
  surface), as the Projects icon does today.
- A 24 px hairline.
- **The index of the route card**, one icon per section: Needs you, Parts, Parameters, Checks, Marks, Scans, Tracings,
  Print profile. A press scrolls the card to that section and unfolds it. The section in sight has the accent wash and
  the accent icon (`aria-current="true"`). A badge (16 px, radius 8, mono 9 px) carries what `railBadges.ts` says today:
  the count of Needs you, parts switched off, the model's checks that fail plus failing dimensions (on `--fail`), the
  scans not aligned, the marks to review. The words go into the button's `aria-description`, and the badge is
  `aria-hidden`.
- **Keys** at the foot, which opens the keys.

The rail shows the index only while a project is open. On the page of projects, on the new project page and with no
project, it holds Projects and Keys alone. The F6 region `left` now covers the rail and the card. Tab order is the rail,
then the card.

### The first screen

The first screen splits in two. On the left is a field of `--dye` (780 of 1440 px). On it the vise is scribed in
`--on-dye` lines (0.5 px at its scale), with a dimension or two in `--scribe` and mono `--on-dye-muted` text, and its
part fills in the accent wash after the outline draws itself. At the bottom left is `torno` at 86 px (600, −0.035 em,
`--on-dye`), and under it the tagline at 21 px: "Make CAD parts with an AI agent." in `--on-dye` and "It writes the model
in build123d; you point at what to change." in `--on-dye-muted`. The right side is on `--surface`, padded 64 px:

- **Returning:** "Recent folders" (26 px). Each folder is a row 68 px high: a small iso drawing of one of its projects (or
  a dashed box when it is missing), its name (600) and path (mono), and at the right `8 projects` and when it was last
  opened. A missing folder is struck through, with "Not found" and **Remove**. Under the rows are **Open folder**
  (primary, 42 px, radius 10) and **Open the example**.
- **First run:** the same side, with the folder idea in one sentence in place of the list, and the same two buttons.
- **Readiness** under the buttons as one line when all is well ("✓ Claude Code `2.1.4` and build123d `0.13.0` are ready",
  the tick in `--ok`), or the lines of what is missing (below).
- At the foot, in `--muted` 12.5 px: "torno writes only into a `.torno` folder inside each project, and the new folder
  when you make a project."

The words, the order of the rule (a folder is opened before anything else) and the list's behaviour (`Welcome.tsx`, the
`first-screen` rule) are kept. Until the list answers, only the plate shows.

### The empty folder

The empty folder uses the same split: Shell B's dyed plate, with the vise drawing itself and a `? mm` dimension. "Nothing
in the vise yet" is at 52 px, and under it "No projects in `parts`. Say what you want made and Claude Code writes the
model." The right side holds Shell C's composer:

- "What are we making?" (26 px) and a lead line, "Say it plainly. Add photos, a doodle, a bought part or a scan. Nothing
  is written until you start."
- A box (radius 14, 1.5 px accent edge, a 4 px accent-wash halo, `--raise`) with the text at 17 px, and under the text
  the add-chips **Photo**, **Doodle**, **Bought part**, **Scan** (28 px, dashed `--field-edge`, radius full). The box's
  foot holds "Goes in `parts/cable-clip` ▾" (the folder name torno offers from the words, editable) and **Start**.
- "Or open the full new project page for sizes and rules, or open the example to look around."
- Readiness, as on the first screen, and the scope line at the foot.

**Start** does what "Start: make the project and ask Claude" does on the new project page today (`new-object-create`):
it makes the folder with what was added and starts the session with the words as its first prompt. The chips open the
same pickers as the page's slots (photo dialog, ink pad for Doodle, the bought-part and scan slots). The full page takes
over what was typed. Where the folder has a `pyproject.toml` but no project, the fold for people with models
(`EmptyWorkspace`) stays, as a line under the box.

### The page of projects

The page of projects becomes a bench. The page is on `--surface`, padded 26 px 40 px. The head holds `parts` (40 px)
and "8 projects in `~/cad/parts`" in muted, and at the right a filter field (200 px, `/` cap), a **True scale / Grid**
segment, **Export…** and **+ New project** (primary).

- **Needs you** (in `--warn`, with a warn dot and the count) and **Working** (an accent dot) stand side by side, each on
  its own shelf. Under Needs you each project shows what it waits on: Claude's question in a `--warn-wash` card (radius
  10, at most 300 px), "**Claude asks:** …" with **Answer** and "waiting 4 min". Under Working: "Building `h8` for `0:42`".
- **The rest** is on one shelf, most recently changed first. Its heading reads "most recently changed first, all at the
  same scale, the bar is 50 mm".
- A **shelf** is a 2 px `--ink` line. The projects stand on it at one scale for the whole page, their iso pictures
  side by side 40 px apart, with a 50 mm scale bar at the right end of each shelf. Under each picture: the name (14 px,
  600, with **Open** in the accent on the one that is open, and a 4 px accent bar under its picture), the build line
  (a dot in the verdict's colour and `Built, h41`, `Build failed, h5` in `--fail`, `A source changed since` in `--warn`),
  and its size `150 × 80 × 92 mm` in mono 10 px light, then `4 open marks, 1 check fails`.
- A project not built in this run stands as a dashed box (120 × 80, dashed `--field-edge`) that says "Size not known
  until it builds". The page never claims a size the kernel did not give.
- **Grid** shows the same items fitted to equal boxes, for when sizes differ too much to read.
- At 1280 × 800 the page scales to 86 % (`zoom`) rather than wrap the shelves.

The keys of the page (arrows, Enter, `/` or a letter filters, Escape peels back) and what a card says about its picture
(`cards.ts`: stale, cut, apart, left out) are kept. Its quiet words go under the name in place of the chips.

**Data this needs** (main and shared, not the renderer):

- `ObjectCard.box`: the size of the last build of the layout pictured, in mm, with `exact` (the kernel's box of the
  B-rep), kept in `thumb.json` beside `at` and `layout` so that a project built in an earlier run still has it.
- Thumbnails at a known scale. `thumbnailPlan` frames each picture so that its parts fill it, and a bench needs the scale.
  The plan gains a mode with a fixed millimetres per pixel at a fixed iso camera and a transparent ground. The page draws
  each picture at `box × scale`. For a thumbnail on file with no box, the project stands in Grid's look until its next
  build.
- `ObjectCard.waiting`: when the session waits on an ask, the ask's question (the first 140 characters, as the card shows
  it) and since when. Main has it (the asks store); the card does not carry it today.

### The new project page

Shell B's page, as mocked. The left (on `--surface`) holds "New project. Nothing is written until you start." and
**Discard**. Then the name as `parts / cable-clip` at 40 px (the folder in `--muted`, the name in ink, a caret), with its
rule below ("The folder's name: letters, digits, − and _."). Then "What are we making?" and the brief box. The photos,
doodles and files are a row of picture tiles with their names (mono) and notes, followed by dashed tiles **Sketch it**
(or press `S`, the doodle) and **Drop anything** (photos, STEP, PDF, scans). Then **Sizes I know** and **Rules** as two
cards, and "Also: Bought part, Scan, Other project, Link or PDF" as links that open those slots. The right (540 px) is a
`--dye` field: "What Claude gets first" (26 px, `--on-dye`), "Written from this page as you add to it." Then the draft
prompt in `--on-dye` and `--on-dye-muted` (references as outlined chips, sizes in mono), and at its foot what will be made
("Makes `parts/cable-clip/` with `cable_clip.py`, `brief.md` and `reference/`."). Then the model and effort selects (on the
dye, `--raise` at 12 % over the dye, `--on-dye` text) and **Start: make the project and ask Claude** (`--raise` ground,
accent text, 44 px), with "Or make it without starting Claude" under it. The seven slots of today (`NewObject.tsx`,
`Slot.tsx`) become this layout with the same contents and rules (`new-object-*` rules, `DraftPane` for the preview). The
dock is hidden on this page, as the draft pane is the preview.

### Readiness, the folder menu, the window's questions

- **Readiness** (`Readiness.tsx`) keeps its three forms and its words. A line is a glyph (✓ in `--ok`, ! in `--warn`, × in
  `--fail`), then the name in ink, then the version or the reason in mono muted, then the action as a button. The block
  is one line when all is well. The sheet form becomes a popover (radius 10) from the folder menu's item.
- **The folder menu** hangs from the folder crumb, as a popover (radius 10, `--raise`, `--float-shadow`). Its rows are
  as today.
- **The window's questions** (Close torno?, leaving a folder; `WorkspaceQuestion`) stay a centred `alertdialog` (radius
  14, 480 px), the only centred sheet left. Their words and order are kept.

### The route card

The card is 296 px (264 at a narrow window), on `--panel`, with a hairline at its right. It is the project read from top
to bottom. A **route line** runs down its left (1 px `--route`, 17.5 px from the left edge), and each section has a dot on
it (9 px). The dot is hollow in `--route`, filled accent for the section in sight, and ringed in `--fail` where something
in the section fails or waits. A section's head is its name (16 px, 600) and one line of what it holds, in mono 10.5 px
muted, cut with an ellipsis (`10, 2 hidden, 1 defect`, with the failing count in `--fail`). A click on the head folds or
unfolds the section. Folded, a section is its head alone, so the whole project fits on one screen. Sections are padded
14 px at the right and 34 px at the left, past the route.

`PanelHost` and the one-panel-at-a-time rail go. `state/column.ts` keeps `{ folded: SectionId[], width }` under
`torno.column`. An old value (`{ open, width }`) reads as the defaults with its width. The default folding: Needs you,
Parts, Checks and Marks open; Parameters, Scans, Tracings and Print profile folded. A section with nothing in it shows
its head with "none" and does not unfold. Which section is in sight is found by an `IntersectionObserver` on the heads,
and it drives the rail.

**The head: what is in your hand.** It is pinned at the top of the card, above the scroll. A 9 px accent square sits on
the route at its left. Its contents are whatever is in your hand:

- **Nothing:** "In hand" (13 px, 600) and "Click a face, an edge or a part to hold it here." in muted.
- **A selection** (`Selection.tsx` moves in from the foot of the view): "In hand", then "`2` picked, shift-click adds".
  Each ref is a block on the accent wash (radius 6): the ref in mono 11.5 px, 500, and the kernel's descriptor under it
  in mono 10.5 px muted (`face, plane, 1 240 mm²`, `36.00 mm from F12`). The actions **Insert in prompt** (primary),
  **Note each**, **Name a set** (`Ctrl+G`) and **Clear** follow. When the build is stale or the parts are apart, the
  buttons are disabled with the reason as today. With more than four refs, the list shows four and "and N more".
- **A sketch** (`SketchPanel` moves here; see the merged features).
- **A review round** (`RoundPanel` and the round's items move here; see the merged features).
- **Naming a set** (`MakeSet`): the box opens under the selection, in the head.

The head grows to fit, up to 60 % of the card's height, and scrolls inside itself beyond that. The sections below slide
down while it is tall. Inspector D's focus state will be another kind of head. Nothing in the card assumes the head is
short.

**Needs you.** This is what waits on the person, from three sources, in the order below. Each is a two-line row (Inspector
A's): the chip, the words, and at the right a muted verdict or source.

1. The marks Claude resolved and you have not judged (today's "To review", with **Review** and **OK all**, and the walk
   "Reviewing 1 of 2 · M5"). A row: `M5` "round the lip, `2 mm`" … "to review". Under it, "**Resolved by Claude:** filleted the
   lip at `2 mm`" (the bold in `--agent-mark`, 500), then **OK** and **Reopen…**.
2. The marks Claude left for you (today's "From the agent", with **Answer in chat** and the tick).
3. The checks that fail, model and dimension both, as one-line pointers to their rows under Checks.

The section's ground is the panel. A failing check's row in the section has no wash of its own; its row under Checks has
one. `groupMarks` (`markGroups.ts`) is split, and its rule is unchanged.

**Parts** (today's Layers, `Layers.tsx`). One row per part, 28 px: a 4 × 18 px swatch in the part's colour, the name in
mono 11.5 px, and at the right the first defect in `--fail` ("not closed"), the open marks as a count in a 16 px pill
(the pill in `--fail` when one is a failing check), or "hidden" in muted for a part switched off (its swatch at 40 %, its
name muted). The opacity slider, Show only and the eye appear on hover and on keyboard focus, as today. Groups of parts
(`groups(p)`) are headers with a fold chevron and the eye that can be mixed. A group header's name is in the sans,
because it is the model's name for several parts. **Named sets** follow as their own subheading (muted 12 px), each row a
10 px dashed swatch in the set's colour (`--set-n`), `#deck`, and "deck face, `2` faces". A set of one part stands under
that part, as today. References keep their neutral swatch and "bought". The rows of the tracings shown in 3D (today's
`TracingRows`, "Tracings" in Layers) move to the Tracings section. Pointing at a part's row lights the part (`peek`). A
part pointed at in the view lights its rows in the card: its row, its marks' rows and its checks' rows get the wash and
the accent bar (`data-lit`). The row's name is a button that selects, and a double click frames the part, as today.

**Parameters** (today's Parameters of `ParamsPanel`, mocked as "Sizes"). The head's line is `103, 2 tried, 2 assumed`.
The rows keep today's controls (number, toggle, choice, slider) and the box of tried values, with **Ask the agent to bake
them in** and **Reset all**. A parameter with a range in its metadata gets Inspector A's gauge at the right of its row.
Pin to board stays in the section's menu.

**Checks.** This is one list of the model's own checks (`checks(p)`, today under Params) and the person's dimension
checks (today the "Checks" group of the marks list), failing first, then not measured or not run, then passing. A row is
Inspector A's two lines in a three-column grid (28 px, 1fr, 64 px):

- Left: the dimension's mark chip (`M3`) for a person's check, or a 3 × 28 px bar in `--agent-mark` for the model's.
- Line 1: the name (12.5 px), and at its right the verdict word in its colour (`passes` `--ok`, `fails` `--fail`, `not
  run` / `not measured` `--warn`).
- Line 2: the value and what was wanted, in mono 10.5 px muted (`2.8 mm, wanted 3 ± 0.05`; `0.12 mm a side, band 0.2 to
  0.4`).
- Right: the **gauge**, 64 × 16 px. It has a hairline axis, the wanted band as a 6 px `--band` rect with `--band-edge` caps
  (an open end has no cap and runs off the side), and the value as a 2 px tick in `--ok` or `--fail`. When the value is
  outside the band, a dashed 1.5 px line in `--fail` runs from the tick to the near end. The gauge's window is the band
  widened by twice its width each side, or by the value when that is further. A one-sided check (`at least 1.6`) shows
  the band open to its far side.
- A failing row has the `--fail-wash` ground (radius 6). After a build, each tick that moved slides from its old value
  (0.7 s), and the row lights once with the accent wash.

The gauge has an `aria-label` in words ("2.8, outside 2.95 to 3.05"). A dimension and a model check on the same thing
stay two rows. The model's check notes ("made easier since r7") stay under the list. `ChecksPanel` and `ChecksSummary`
merge into this section. `checkRows.ts` and `checksSaid` are its words. Pin to board stays in the menu.

**Marks** (`MarksPanel`, `MarkRow`). At its head, outside its scroll as today, are **Review this build** and a row for
each review round. Then the groups **To send**, **With the agent** and **Resolved** (folded), since To review and From
the agent moved to Needs you and Checks to Checks. The head's line is `4 open, 1 sketch, 1 to send`. A row is two lines:
the chip and the note (the whole note while the row is active, wrapped, not cut), then the kind and words of trouble in
muted 11.5 px ("moved: check it", "its part is hidden"). The row's actions show as words on the active row (Go to view,
Re-place, Edit, Answer in chat, Resolve, Reopen, Delete) and as icons on hover elsewhere. The active row also opens out
the dimension's Should be fields (`DimensionFields`) or a shape's numbers (`ShapeFields`), as today. Ask Claude Code to
commit, the undo line after a delete, and the part filter chip are kept in place.

**Scans** (`ScansPanel`). The head says `2, 1 unaligned`. The rows and the one opened beneath are as today. **Import
scan…** is in the head's line. The scan read question moves to the view (below).

**Tracings.** The head says `1, T1 front of intake`. One row per tracing: `T1` (mono, 500), its name, and at the right its
photo's file. Under the open or shown one, a line: "Photo lined up by `4` points, `0.42 mm` a pixel. Redrawn at each
build." **New tracing** is in the head's line. A click on a row opens it in the Tracing view. The eye of a tracing shown in
3D (today's `TracingRows` in Layers) is on its row. While the Tracing view shows one, this section holds that tracing's
panel (see the merged features).

**Print profile** (`PrintProfile`). The head says `Bambu X1C, PETG`. The contents are as today.

### The view's chrome

**The switch** (`BoardSwitch`) sits at the top left, 14 px in: a segment Model / Board / Tracing on the panel at 92 %
with `--float-shadow`. Tracing shows only when the project has a tracing. `Ctrl+Tab` cycles, as today. While a mode's band
is on, the switch steps aside, and the band holds its place.

**A band** (new, one component) is a pill 34 px high (radius full) at the top left: the accent ground, `--on-accent`
text 12.5 px, 500, a drop of 8 px in 0.3 s. Its buttons sit inside as 26 px pills: primary ones are `--on-accent`
grounds with accent text, quiet ones are transparent. A **quiet band** is `--raise` with ink text and a hairline, for a
mode that only informs. The bands:

| Mode | Band |
|---|---|
| Export open | "What the page will show `intake h41`" (accent) |
| A review round open | "Reviewing `h41`", the pens, the counts, Items, End, Send review (accent; see the merged features) |
| A failed build, the one before on show | "On show: `h40`. The build after it failed." with a `--fail` dot (quiet) |
| A sketch open | "Sketching `M7` on `XZ, y = 40`" (quiet) |
| Compare | "Comparing `h40` with live `h41`", Before / Overlay / After / Side by side, Back to live (quiet) |
| Lining up a tracing's photo | "Lining up the photo of `T1`", Straighten, Preview, Cancel, Done (accent) |
| Picking a face for a new tracing | the words of `FacePickBar` (quiet) |

Only one band shows. A review that is open stays on its band while a sketch opens inside it: the sketch's words go to the
card's head.

**The reed** (`ToolPalette`) sits at the left middle, 14 px in, centred vertically: groups of round 34 px buttons (17 px
icons stroked 1.35, ink), each group a pill on the panel at 94 % with `--float-shadow`, 5 px apart. The groups are as today:
inspect (Select `V`, Measure `M`, Section `X`), mark (Pin `P`, Arrow `A`, Draw `D`, Shape `S`, Region `B`) and the scan's
(Align `L`). Keys moves to the rail's foot. The key letters leave the buttons; they are in the tip and in the name.

- **The tool in hand** is a filled accent circle with `--on-accent` icon, and **its name grows out to the right**: a 30 px
  accent pill 6 px from the button, with the name (12.5 px, 600), its key cap (outlined in `--on-accent` at 45 %) and its
  few choices as an inner segment (`--on-accent` at 18 %, the pressed one `--on-accent` with accent text). The choices:
  - Measure: Distance / Angle, ⌀ / r, and `T` thickness, as today's strip.
  - Shape: box, cylinder, sphere, plane.
  - Draw: the pens Free (`B`), Line (`L`), Points (`P`), Erase (`C`) (see the merged features).
  - Region: Brush / Box. Align: none in the pill (its card holds its steps).
  - **Select is the tool at rest**: pressed without its name. Its scope (Any / Face / Edge / Part / Set) grows out when
    Select is clicked or `V` is pressed while it is in hand, and stays out while the scope is not Any, so that a scope
    left on Set can be seen.
- **The tip** (`ToolTip`) is as today (name, key cap, what it does, a note), placed right of the button, on hover and on
  `:focus-visible` only. A tool with its name grown out shows no tip.
- A scan's tool with no scan is quieter (`data-quiet`) and says why, as today.

**The compass** sits at the top right, 14 px in, items right-aligned, 7 px apart:

1. **The cube**, on a tile of 118 × 112 px (radius 14, the panel at 94 %, `--float-shadow`). Outside a sketch it is a
   **still** iso picture of a cube (an SVG in the DOM, new `ui/ViewCube.tsx`; faces `--panel` with a `--field-edge` stroke,
   labels 10 px sans with their key in mono 9 px muted): Top `4`, Front `2`, Right `3`, and the near corner Iso `1` as an
   accent dot, with "···" for Back, Left and Bottom in a small menu. A click on a face takes that standard view (as the view
   bar's buttons do today), and the face of the view on screen has the accent wash. Each face is a real button with its
   view's name and key, so the cube is reached by keys. **While a sketch is open** the tile shows today's live sketch cube
   instead (`viewport/viewCube.ts`, drawn on the overlay canvas and turned as the camera is, placed in the tile): its faces
   read XY, XZ, YZ with `⇧1` to `⇧3`, a click makes that plane the sketch's as today, and a "Planes" caption in the accent
   sits at the tile's top left (ruling 2).
2. **Perspective / Ortho**, a segment in a pill, with the `O` cap.
3. A row: the **layout** (`assembly ▾`, the layouts of today's view bar), **Fit** with its `F` cap, and **Explode**
   (pressed while apart, with the amount, `Explode 50 %`).
4. **The saved views**, stacked as pills (26 px): the active one ringed in the accent, then a proposed one (dashed 1 px
   `--agent-mark`, text in `--agent-mark`, on the surface, with **Keep** in ink underlined and **Discard** muted), then
   "**+ Save view** `3 more`". **N more** opens the list as a popover with the name field, rename, update, pin to board and
   delete (`ViewsStrip`'s menu). A layout that is gone is struck through. **While a tool with tags is in hand, or the stack
   would meet a tag, the saved views fold to one pill "Saved views `5`".** The compass hides its saved views while Align
   or Region is in hand.

`ViewBar` and `ViewsStrip` become the compass. The padlock on a view locked for Draw is a small lock on the face.

**Tags.** A tag is a control or a reading that stands beside what it is about, tied by a leader: `--raise`, a hairline,
radius 10, `--float-shadow`, 4 px padding, 12.5 px text. Inside it are 26 px controls (radius 7), values in mono 12 px on
a `--surface` well (radius 7), a hairline between groups, and a large reading in mono 19 px with its unit 11 px muted. A
problem is a second tag below the first, in `--fail` text on `--fail-wash`. Placement: beside the subject, clamped
inside the view, clear of the reed (60 px from the left), the compass and the band. When a tag would cover the subject or
another tag, it moves to the next of the four sides (`placeBeside` in `notePlacement.ts` is the rule, extended). When the
subject is off screen or seen edge on, the tag docks at the bottom of the view above the hint, and its leader is not drawn.
The tools' tags:

- **Section** (`SectionBar`): a tag on the plane's top edge with X / Y / Z (axis colours), the value field (`y 44.0 mm`),
  **From a face**, **Flip**, **Off**, and a menu with **Middle** and **Make a tracing**. "Everything is on the cut side"
  is its problem tag. The slider becomes a **rule on the ground** along the plane's normal: a line graduated every 5 mm,
  labelled every 20 mm in mono 10 px muted, with the plane's handle on it (a 16 px accent square, radius 4). Dragging the
  handle or the plane moves it. The rule and handle are drawn on the overlay canvas, in the frame of the object, and so
  are no part of the scene. The caption: "Drag along the rule, or the plane `Esc`".
- **Measure** (the strip of today): a tag at the middle of the measured line, a column holding the reading (`36.00 mm`,
  19 px), its words ("between faces, exact · `Δz 36.00`"; `≈` while live) and **Keep as a dimension** `↵` (primary). The
  caption: "Pick again to measure from here `Esc`". A problem replaces the reading ("The second end is on `S3`, a scan:
  Measure takes the model only.").
- **Explode** (`ExplodeBar`): a **track** standing beside the parts, graduated 0 to 100 %, with a handle (16 px accent
  square), and a tag at its top with the amount (`50 %`, 19 px), "apart, for the view only", **From centre** X Y Z, `×0.5
  ×1 ×2 ×4`, and "`E` puts them together". Its status line (for display only, or why nothing is drawn apart) is the
  tag's last line, still `role="status"`. Explode is not a tool. Its tag shows while the parts are apart or its button is
  pressed, and folds the saved views.
- **Compare** (`CompareBar`): its controls go to the quiet band. What changed is written on the parts that changed, as
  tags with leaders (`wall 2.8 → 3 mm`, `M3 2.8 → 3.0 ✓`), from the build's digest numbers (`turnSummary`, `netParts`).
  At most four tags; the rest are in the band's "and N more". Today's two boxes in the corners ("What changed", "Checks
  and marks") become those tags and the band's list.
- **The sketch plane:** see the merged features.

**Procedure cards** (Align and Region, today's `AlignBar` and `RegionBar`) sit at the bottom right above the grid step,
300 px wide (Align 320), as a card: `--raise`, radius 10, `--float-shadow`, padding 12, title 13.5 px 600 with its icon,
and "`Esc` put down" at its right.

- **Align scan:** the scan picker, then its steps as a vertical sequence: 1 Floor, 2 Pairs, 3 Nudge, each a number in a
  20 px circle (done: ink; current: accent; to come: hairline), a name and a muted line. The current step holds its body
  (`FloorBody`, `PairsBody` with the pairs listed in mono, `NudgeBody`). The rough question shows as a `--warn-wash` block
  with its two buttons ("Not yet", "Keep as rough"). The foot holds the state (muted), **Undo** and **Apply**. The pairs
  are drawn in the view as numbered dots (accent on the scan, hollow on the model) joined by a dashed accent line. That
  drawing exists today (`alignPoints.ts`) and only takes the new faces.
- **Region of a scan:** Brush / Box with the radius field and its `[` `]` caps, then **Erase** `E`, **Grow to flat** and
  **Undo** `Z`. The count follows (`1 284` triangles, 22 px mono, "on `S3` · ≈ `412 mm²`, approximate"), then a problem
  ("`S3` is hidden in Layers: show it to paint on it."), and the foot **Clear** and **Keep as a mark** `↵`.

Their words, steps and refusals are today's. Only the frame changes.

**The note card** (`NotePopover`) keeps its placement beside the new mark (`placeBeside`, clear of the reed, compass and
band). It takes the tag's look: the chip, the ref in mono, the delete icon, the text area, and "`↵` save · `Esc` leave it
for later". No leader: a mark has none.

**The bottom of the view.** The **triad** (bottom left, the canvas's as today) and the **grid step** or scale bar (bottom
right) stay. The **hint** (bottom middle, 14 px tall pill on the panel at 92 %, muted 12 px, the `?` cap) holds the
pointer hint once per install, the agent's line (`AgentLine`), and a sketch's standing line ("Snapping on, hold `Ctrl` to
drop it. X-ray `I`"). **The selection leaves the view** for the card's head. The **ask over the view** (`QuestionCard`
when the chat is not in sight) moves to the dock's foot band (below), so it no longer stands here. `layout.css` loses
`--bar-lift`, `--hint-lift`, `--triad-clear` as a lift, `--bar-side`, `--stack-side`, `--strip-top`, `data-raised`
and `data-narrow`. `overlay.ts` keeps `TRIAD_CLEAR`, and `BAR_SIDE` and `NARROW_BELOW` go with their tests.

**Drop a scan, the scan read question.** Sheets B asks the question in the view, by the scan. `ScanReadSheet` becomes a
card (330 px, the tag's look) at the top left of the view under the switch, tied by a leader to the scan's corner in the
view: "How is `S3` read?". Then the guess in a sentence with the size it would have and how it compares with the parts,
and the five units as a dial of mono cells (mm, cm, m, in, ft, each with the scan's size in it). The one read is on
`--surface`, the one pointed at is on the accent wash with an accent underline. Pointing at a unit draws the scan's box
at that size, dashed, in the view (a box on the overlay, not the scan), with its size. The up axis follows, then
**Read it in metres** (primary, worded for the unit chosen), **Keep mm** and **Later**. The scan's row in the card says
"asked in the view". When the change drops an alignment, its confirm is a popover from the button (below).

**Confirm** (`Confirm.tsx`) becomes a popover from the button that asked (290 px, radius 10, `--raise`, a stem to the
button), with a title in 13 px 600, a sentence, and the safe button focused beside the one that acts (outlined in
`--fail`). The words, focus and Escape are as today. It is used in the dock (End a busy session), the scans and Align.

### The session dock

The dock is 420 px on `--panel`, with a hairline at its left. From the top:

**The header** (40 px): "Claude Code" (13.5 px, 600), the state as a dot and a word (Starting, idle, working `0:42`,
needs you in `--warn` 600, Ended; ", retrying (attempt 3)"), then one mono button with the model (`opus-5-5 ▾`, whose
menu holds the model, mode and effort menus of today), the segment **Chat / Terminal**, and a "more" menu with End,
Resume, New session, Prompts only, and Hide session. The quiet lines of today under the header (what the next prompt
carries, the instruction files Claude Code reads, the `agent.json` note, a first prompt not sent, the aside of a new
project) move. What the prompt carries goes inside the composer's box. The instruction files and the `agent.json` note
go under "more" as "What Claude Code reads", and the note also shows as one warn line above the composer when it applies.
The draft aside stays as a line at the top of the conversation.

**The builds strip** (new, `BuildsStrip`, over `useHistory`). It stands on `--surface` with a hairline under it, 136 px
high with its bracket, at the top of the dock in every mode: chat, terminal, no session, and export.

- Its head line (11.5 px muted): "**Builds of intake** `41` kept", and at the right what a pick does now ("Pick one to
  compare, star or go back"; "A build is running"; "h40 is still on show"; "Your review is of h41"; "Exporting the build
  on show, h41").
- A track of nodes, newest at the right, 10 px apart, on a hairline at 22 px (`--field-edge` at 50 %). A node is 62 px
  wide: a 62 × 44 picture of the build (radius 7, a hairline ring), its id in mono 10.5 px, and a muted line under it:
  `prompt 14`, `you saved` (in `--user-mark`: the person's own save), `on show` (accent, 500, with a 2 px accent ring on
  the picture), `reviewing` (accent 600). A starred build has a 11 px star in `--warn` at the picture's corner.
- A **failed build** is a node hatched in `--fail-wash` with "failed" in `--fail`, its id "after h40". A click opens its
  error as a popover from the node (300 px): "The build after h40 failed", "Claude Code was told after its edit. Your next
  prompt carries it too.", then the error tail in mono on `--fail-wash`, then **Copy**, **Whole error** and **Ask Claude
  Code to fix it**. That is today's `BuildErrorSheet`, moved.
- A **running build** is an outlined node (1.5 px accent inset) with its seconds in mono, and "building" under it.
- A **bracket** (1.5 px accent, open at the top, radius 4 at its feet) under the nodes of the prompts in sight in the
  conversation, labelled "prompt 14, in sight below". It follows the scroll.
- A **click on a node** opens its menu: **Compare with live** (`actions.compare`), **Star** / **Unstar**, **Pin to
  board**, **Review this build**, and **Go back to here** (below). A double click compares.
- The track scrolls sideways with the wheel, and keeps the build on show in sight. Thumbnails are those `TurnBuilds`
  draws today (`useThumb`). With no picture, a node shows the id alone on the surface.
- When a build lands, its node slides in (0.7 s).

The strip replaces `TurnBuilds` at the turn's end and the history strip of the status line. `HistorySheet` stays
reachable from the more menu for the full list.

**Go back.** "Go back to here" on a node runs today's Go back (the `goback` rule: to before the prompt that came after
that build, the person confirms, files restored, Claude told). The confirm is a popover from the node with the plan's
lines (`GoBack.tsx`, `planLines`). While it asks, the nodes and prompts it would undo are drawn struck through and in
muted, in the strip and in the conversation. "Go back to before this prompt" also stays in each turn end's actions, which
the more menu of the turn holds.

**The conversation** (`ChatPane`, `Items`), cut into prompts. Each prompt starts with a head: "Prompt `14`" (mono 10.5,
500, ink), the builds it made (`h40 → h41`, the arrow in mono, the new id in accent 500; `h40 → failed` in `--fail`;
`h40 → …` while running), and a hairline to the right edge. Then:

- **The person's words** in a block of ink (`--ink` ground, `--panel` text, 13.5 px, line 1.45, radius 12 12 12 3, at most
  88 % wide). Refs inside are chips with a 1.5 px ink ring. Under it, "with `M3` `h40`" (what went with it) in muted
  11.5 px. "Show text" of what torno added stays there.
- **Claude's text** at 13.5 px, line 1.55, 62 ch at most, with live ref chips.
- **Tools** as chips (24 px, radius full, `--surface`): "Read **airbox.py**", "**Edit** airbox.py". A torno tool is on the
  accent wash with its name in accent. The one running has an accent ring. A fold ("Read 3 files, Grep ×2"), a tool
  card with a picture, a diff, and a task card keep today's contents in this look.
- **The build slip** (`BuildLine`, rebuilt). It is a block on `--surface` (radius 10, padding 10 12). The head line:
  "Built `h41` **ok** `51 s`" and **Show text** at the right. Then the dimension that flipped on its own row on the panel
  (radius 6): `M3` "tub wall `2.8 → 3.0 mm` **now passes**" (in `--ok`, 600; "now fails" in `--fail`). Then Session A's
  **table**: the columns part, previous build, this build, change. The head row is muted 11 px (`Volume, mm³`, `h40`,
  `h41`, `change`). The cells are mono 10.5 px, right-aligned, hairlines between rows, the previous build in muted and the
  change in accent (`+6.3 %`). A value that is not exact keeps its `≈`. The new numbers count up from the old ones once
  (0.7 s). It shows at most 6 parts, then "`5` parts did not change" or "`3` more changed" (a click unfolds them). The
  rows are those `BuildLine` builds today from the digest. Only the layout changes from prose to columns.
- A **failed build** slip is on `--fail-wash`: "The build after `h40` failed", the last line of the error in mono
  `--fail`, and the node in the strip holds the rest.
- **The turn's end**: "**Done in `58 s`**" (12 px, 600, ink) and the muted summary ("pulled look, measure"), then at the right
  **See changes** and **Compare** as quiet buttons with icons, and a "…" with Go back, Star and Pin. A save line between
  turns, the gone-back row and "Earlier in this conversation" keep today's words.
- **Queued prompts** show at the end as an outlined block (a hairline ring, muted text) under "Prompt `15` queued".

**The foot.** While Claude works, a task line shows above the box: "`2 of 4`", a meter of four 4 px bars (done in ink, the
current one accent, the rest hairline) and the current task in ink. The suggestions (up to three chips, 24 px, radius
full, a hairline edge; a fix in `--fail`) come next. Then **the box**: `--raise`, 1 px `--field-edge`, radius 10. Inside
it go what goes with the prompt (the drawn notes waiting, the attached view or board, a review's chip, a set's tag chip),
then the text (13.5 px), then a bar with **Attach view** and **Draw on view** as quiet buttons, the key hint (`Enter`, or
`Ctrl C` while working) and **Send** (primary), or **Stop** and **Queue** while working. The placeholder changes with
the state as today ("Claude Code is working: this goes next"; "The review goes as its own prompt. Add words to it here.").

**An ask** takes over the foot: a block with a 3 px `--warn` top edge on the panel, sliding up 40 px in 0.4 s. It holds a
title (14.5 px, 600), a muted line ("Point at an answer to see it in the view, or select a face there."), the options as
up to three cards in a row (radius 8, `--raise`; each a number in mono muted, its words, its ref in mono accent; the one
pointed at on the accent wash with an accent edge; keys `1` to `3`), then "Or say what to do instead" as a field and
**None of these**. Pointing at an option borrows the one leader to its ref in the view. A permission with a diff, a plan
and a question (`AskCard`) and torno's own ask (`QuestionCard`) all take this block. Their contents, buttons and rules
(`asks` rule, `pick`, "Answer with `lid/F12`") are today's. The header's state turns to "needs you" in `--warn`.

**The terminal view** keeps the strip on top and the terminal below it, in the terminal's ground (`termGround`), with the
inset of today. **No session** keeps the strip on top, then `StartChat` (the last conversation read-only under "Last
conversation, 2 days ago", Continue / New conversation by Send), in this look.

**The dock hidden.** The status line and the title bar's sign carry the session's state, as today (`sessionSign`).

### Export, on the bench

Export docks in the dock **below the builds strip**, in place of the conversation, sliding in 24 px in 0.28 s. The strip
stays: the ringed node is the build that will be exported (the build on show; picking another node does nothing new in
this redesign, see ruling 7). The conversation folds to a 40 px band at the dock's foot on `--surface`:
"● **Claude Code** idle, 1 mark to review" and **Back to the chat**. An ask that arrives while export is open turns that
band `--warn-wash` and says "needs you", with **Answer**.

- **Head:** "Export intake" (15 px, 600), and "Close `Esc`" at the right. The sheet's name no longer changes with the
  format.
- **Formats** as five tiles in a row (radius 8, a hairline; the chosen one on the accent wash with an accent ring and its
  name in accent). Each has a 32 × 26 line drawing, a name (11.5 px, 600) and its formats in mono 9 px: **A page** HTML,
  **CAD** STEP, **Slicer** 3MF STL (a segment inside picks which), **Picture** PNG, **Tracing** SVG PDF. Picture and
  Tracing are dimmed (40 %, still focusable, with the reason in the title) when the export is not of the project on show.
  The Tracing tile is today's "drawing of a section" and "a tracing of the project": its "Drawing of" list (the section
  on screen, `T1`, `T2`) is its first row.
- **What goes, and what each weighs:** one line per thing that can go, in groups by kind. A line is a toggle (28 × 16,
  accent when on), the name (with ref and build in mono), a muted line under it (`8 of 9 parts, 2 layouts, 1 saved view`;
  the warning for a scan in `--warn`), and at the right **its weight** in mono 10.5 px with a 7 px square of the line's
  colour. A line switched off has its weight struck through and muted. The lines are those of today's sheet: projects,
  switched-off parts, marks, resolved marks, scans, the page itself; and for STEP and mesh the parts, layout, tolerance
  and angle (`ModelChoices`); for PNG the size, marks and axes. Projects not built in this run stay links.
- **The weight:** the total in mono 30 px (`1.7 MB`), "of `12 MB`", and a rule from 0 to 12 MB with ticks at 0, 6 and 12
  (mono 9 px). Its fill is split into the lines' colours, in their order, and fills in once (0.7 s). Over 12 MB the
  rule runs to the budget and its overflow is drawn in `--fail` past the 12 MB tick, with the reason in words ("`S4`
  engine-bay.ply is reduced to 30 000 triangles"). Above 64 MB the action is disabled, and the refusal is said.
- **The foot:** "Nothing about this computer goes in the file." (muted 12 px), then **Cancel** and the action (**Export
  page**, **Export STEP** …).
- **Saving** shows "Making the file and reading it back…" in place of the foot. **Saved** closes the export: the file
  lands in the status line where Export… was, as "✓ `intake.html` `1.7 MB` **Show in folder**" on the accent wash, with
  the read-back ("Checked: STEP read back, 9 parts by name …") in a popover above it. The popover shows once, and on hover
  after that. **Open in browser** is in that popover for a page. The status keeps the file until the next build or 60 s.
- **The view is the preview.** A 2 px accent frame (inset 8, radius 12) goes round the view, and the export's band sits at
  its top left. What changes as lines are switched uses what the view can already do: marks shown or hidden, a switched-off
  part hidden, with a dashed tag at its place ("airbox-clip-3 is switched off: left out"). A scan switched on is shown. A
  STEP's bodies are not labelled in the view in this redesign (ruling 6).

Per-line weights need main to return the plan's weight per item, not only the total (`export` plan). Main has them while
it plans, and returns `items: { id, bytes }[]` beside `bytes`.

### The keys

`?`, or Keys on the rail, raises a keyboard from the foot of the window over the view and the card, 400 px high (the rail
and the status line stay), with a scrim fading in from 20 % of the height above it. It is not a centred sheet.

- **Left:** "Keys" (15 px) and the places as chips (Everywhere, In the view, With a tool in hand, Sketching, Board,
  Tracing, Projects, Session), with the place chosen in ink. Then **a drawn keyboard**: 56 × 48 keys (radius 7, a 3 px
  bottom edge) on `--surface`. Each key shows its letter in mono 12 px ink and, under it, what it does in the place chosen
  (muted 10 px). Tool keys are on the accent wash with the letter in accent. Keys heard in the view are outlined in
  `--field-edge`. Modifiers are greyer, and unbound keys have their letter at 45 %. A key pointed at or searched has a
  2 px accent outline. The layout is US QWERTY, generated from `KEYS` (`shared/keys.ts`) and one table of key positions.
  Keys with a modifier (`Ctrl+G`, `Shift+1`) are listed under the keyboard, by place.
- **Right (360 px):** a search field (accent edge and halo, `Esc` cap), and under it **answers as sentences** (Sheets C):
  "In the view, **E** explodes the parts, and **E** again puts them together." with a muted line saying where it is not
  heard ("Not while a field or the terminal has the keys"). One sentence per place the key or word is heard, made from
  `KEYS` rows (place, keys, what it does). The one for the place chosen is on the accent wash. The count line at the foot
  says "74 keys, 6 of the pointer. Tools are in the accent, keys heard in the view are outlined."
- The pointer group (`POINTER`) is the first place. Search matches what, keys and where, as today, and nothing found says
  "No key says …".

`KeySheet` becomes this. Its rules (the count said once, the pointer group, one table) are kept. The sentences are
generated, never written by hand, so that `readme.test.ts` and the manual's generated table stay the one truth.

### Changes of a turn

Sheets B splits the view: **See changes** opens a sheet over the view's area (not the card or the dock), whose top half is
the parts with each part's change written on it as a tag ("airbox-tub **+6.3 %** volume", "`M3` 2.8 → 3 mm ✓") and a
build scrubber (`h40` / `h41`) at its head with "Changes in this turn", "read only". Its bottom half is the code: file tabs
in mono ("airbox.py +3 −2"), "Changes, or the whole file" at the right, then the diff in mono 12 px with line numbers,
added lines on `--diff-added-wash` and removed on `--diff-removed-wash` in muted. The turn in the conversation gets an
accent bar and wash while its changes are open.

The top half draws the parts with the view as it is, the previous build's tags read from the digest, and the scrubber
showing the build before through Compare (`actions.compare`) when the history has it. Keeping the previous build's scene
for a true side by side is not built. `ChangesSheet`'s contents (not kept, too large, removed, several files) stay as
lines in the code half.

### The status line

28 px on `--panel`, a hairline above, 12 px muted, 16 px apart. From the left: the project (600, ink). Then the builds as
ticks (7 × 11 px each, the last eight: `--field-edge` at 50 %, the person's saves in `--user-mark` at 75 %, a failed one
in `--fail`, the one on show 13 px tall in the accent, a running one outlined), then the build's state ("`h41` built in
`51 s`", "Building `18 s`" with `data-beat`, "The build after `h40` failed" in `--fail`). Then **Rebuild** as a quiet
button, the checks that fail ("1 check fails" in `--fail`), the parts and defects, the git line (`GitText`), and the
needs-you button of another project. At the right are **Export…** (a 20 px button, radius 6) and `build123d 0.13.0` in
mono. Its rules (`BuildStatus`, the `role="status"`, the needs-you button and `focusAsk`) are kept.

### What each part replaces in `app/src/renderer`

| Part | Components (new, changed, gone) | Stylesheets |
|---|---|---|
| Shell grid | `App.tsx` (the grid, the dock width kept), `LeftEdge` (the card's edge) | `layout.css` rewritten (grid, no lifts); `app.css` keeps its order, `layout.css` first and `late.css` last |
| Title bar | new `TitleBar` (crumbs, signs, window controls); `FolderMenu` hangs from it; `Logo` | new `titlebar.css`; `late.css` loses the folder menu's rules |
| Rail | `Rail.tsx` (index of the card, Projects, Keys), `railBadges.ts` (adds Needs you, Checks, Tracings), `SessionDot` | `rail.css` |
| Route card | new `RouteCard` and `CardSection`; `PanelHost` and `SectionTitle` go; `Selection` becomes the In hand head; `Layers`, `sets/SetRows`, `ParamsPanel`, `ChecksPanel` + `ChecksSummary` (merged), `MarksPanel`, `MarkRow`, `ResolvedSummary`, `ScansPanel`, `TracingRows`, `tracings/TracingPanel`, `PrintProfile`, `ObjectList` (to the title bar's project menu); new `Gauge`; `state/column.ts` | `panels.css` becomes the card's; `marks.css`, `scans.css`, `sets.css`, `tracings.css` (the panel's part) restyled; `overlays.css` loses the selection bar |
| Reed | `ToolPalette` (the name pill, Select's scope, Measure's strip folded in), `tracings/Palette` in the same look, `projectBoard/Palette` takes the look | `tools.css`, `regions.css` (shape choice) |
| Caption and hint | `ToolHint` (to the pointer), `AgentLine` (bottom middle), `viewport/highlight.ts`'s readout styled as the caption | `tools.css`, `overlays.css` |
| Compass | new `Compass` from `ViewBar` and `ViewsStrip`; new `ViewCube` (the still cube); `viewport/viewCube.ts` draws the live one in the tile while sketching; `ExplodeToggle` | `viewbars.css` and `views.css` merge into `compass.css` |
| Bands | new `Band`; `CompareBar`, `ReviewBar`, `FacePickBar`, the line-up's bar, the failed build's notice become bands | new `bands.css`; `viewbars.css` goes |
| Tags and leaders | new `LeaderLayer`, `Tag`; `SectionBar`, `ExplodeBar`, Measure's strip, the sketch's offset, `tracings/offsetTool` become tags; the section rule and explode track drawn by `overlay.ts` | new `tags.css`; `explode.css` goes into it |
| Procedure cards | `AlignBar` (+ `align/*`), `RegionBar` | `align.css`, `regions.css` |
| Note card, confirm, scan read | `NotePopover`, `Confirm`, `ScanReadSheet` | `overlays.css`, `controls.css`, `scans.css` |
| Dock | `SessionPane` (header, more menu), new `BuildsStrip` (over `useHistory`, `useThumb`), `chat/ChatPane`, `chat/Items`, `chat/BuildLine` (the slip and table), `chat/TurnEnd`, `chat/TurnBuilds` (goes), `chat/GoBack` (popover from a node), `BuildErrorSheet` (popover from a node), `chat/Composer`, `chat/Suggestions`, `chat/Tasks`, `chat/AskCard` and `QuestionCard` (the foot takeover), `chat/StartChat`, `chat/PromptsOnly` | `session.css`, `chat.css` (largest change), new `strip.css` |
| Status line | `BuildStatus` (ticks, the saved file) | `status.css` |
| Export | `ExportSheet` docked in the dock (tiles, lines, weights, rule) | `sheets.css` (export's part) |
| Keys | `KeySheet` (keyboard, sentences); new `shared/keyboard.ts` (positions) and `shared/keySentences.ts` | `keys.css` |
| Changes | `chat/ChangesSheet` over the view | `chat.css` (its part) to `sheets.css` |
| Screens without a model | `Welcome`, `EmptyWorkspace` (composer), `onboard/NewObject` and `onboard/Slot` (the new layout), `onboard/DraftPane` on the dye, `Readiness`; new `Plate` (the dyed field and drawn vise) | `welcome.css`, `onboard.css`, `ready.css`, new `plate.css` |
| Page of projects | `ShowPage` (shelves, groups), `cards.ts` (words), `state/thumbs.ts` (the scale) | `cards.css` |
| Window questions | `WorkspaceQuestion` | `sheets.css` |
| Board | `projectBoard/*` keep their layout and take the tokens and faces | `board.css` (tokens only) |

---

## 3. The merged features in the new window

Each feature keeps all its behaviour, keys and words. Only where things stand and how they look changes.

### 3D sketches (#169, Draw)

| | Kept from the code | Placed and styled as |
|---|---|---|
| Name of the tool | **Draw** (`D`), and the thing it makes is a 3D sketch. The mockup's "Sketch" for the tool is not taken | the reed: Draw's button (a curve icon) grows "Draw `D`" and the pens |
| The pens | freehand `B`, line `L`, point to point `P`, eraser `C` | inside Draw's name pill as a segment: Free, Line, Points, Erase |
| Snap and X-ray switches | `Ctrl` held, the **Snap** switch, `I` and the **X-ray** switch | two switches in the card's head under "Planes and strokes"; the hint at the bottom middle says "Snapping on, hold `Ctrl` to drop it. X-ray `I`" |
| The sketch panel (`SketchPanel`) | the chip and draft/sent, name, how to take it (Exact / Rough / Flow, `K`), the diameter, planes and strokes with counts, "+ New plane: pick a face or a point", the strokes by id (`k1`), the offset (`Tab`), comment, Undo (`Ctrl+Z`), Done, `Esc` | **the head of the route card**: `M7` chip, "Sketch" (15 px, 600), "draft, goes with your next prompt" muted; Name field; "Take it" segment and the ⌀ field (mm); "Planes and strokes" rows (28 px, a small skewed plane glyph, the plane in mono, its count at the right; the active one on the wash with the accent bar); the strokes list folded under its plane; the two switches; Comment (a text area on `--raise`); Undo `Ctrl Z` and Done `Esc` (primary) |
| The offset field | typed in the panel, `Tab` focuses it | the field stays in the head, and the plane's handle in the view gets a **tag** tied to it by a leader: "XZ plane `y 40.0 mm` `Tab`" (the value on the well, in the axis colour) |
| The view cube | XY, XZ, YZ make the plane, `Shift+1` to `Shift+3` | the compass's tile shows the live sketch cube while sketching (ruling 2), "Planes" in accent on it |
| The pointer hint (`sketchHint.ts`) | what a point snaps to, a segment's length and angle, typing a length, `Enter` | the caption at the pointer (ink): "Line `42.0 mm` at `−58°`, type a length `Enter`"; a snap in an **accent caption**: "Snapped: hole centre `airbox-snorkel/E14`, exact" |
| A band | none today | the quiet band "Sketching `M7` on `XZ, y = 40`" |
| The pens strip (`SketchPens`) | its buttons and keys | goes; its contents are in the name pill and the head |
| The sketch's row, board card, Edit, held from prompts | as today | the row in Marks, in the new row look |

While the head holds the sketch, the card's sections slide down under it, and the selection's head returns at Done.
Section from the reed ends the sketch as Done, as today.

### Reviews (#172)

| | Kept from the code | Placed and styled as |
|---|---|---|
| Starting | **Review this build** (Marks' head, a build's menu in the strip, the line of the build on show, key `H`), one open round, refused while building or failed | the same places; the strip's node is labelled `reviewing` |
| The bar (`ReviewBar`) | `Review of h41`, **Plain / − Don't want / + Want** (`-`, `=`), counts `3 − · 2 +`, **Items**, **End**, **Send review** | **the accent band** at the top left: "Reviewing `h41`", then the pens as 26 px pills: Plain, "(−) Don't want", "(+) Want" (the chosen one `--on-accent` ground with ink text; each with its round sign), the counts in mono, **Items**, **End** (quiet) and **Send review** (primary) |
| The round's panel (`RoundPanel`) | each item with chip, note, Claude's answer, **OK** / **Still wrong** (+ note, **Send back**), "Not answered yet", **Start round 2**, Compare with the reviewed build | **the head of the route card** while a round is open or opened: "Review of `h41`" (15 px, 600), "goes as one prompt" muted, then one row per item (a 22 px column for the sign, then the words, then a muted line with the strokes or faces in mono), and the actions per item; the foot "Comment a stroke by clicking it" and **Send review** |
| Signs on marks | the chip and row carry `+` or `−` before the number (`− M8`); Don't want hatched in your colour and dashed lines; Want solid | the sign is a **round 18 px disc** (mono 12 px 600, `--on-mark`) before the square chip: "−" on a hatch of `--user-mark` (2 px stripes at 135°, with the mark colour mixed 70 % toward white between), "+" on solid `--agent-mark` for Want. In the view a round's item shows its disc and its note on a tag (no leader). Square chips with `M` stay the marks' |
| The other marks | not changed | while the band is on, the marks not in the round are drawn dimmed, their chips mixed 70 % toward the ground. That is a colour, not `opacity`, so the text rule holds |
| The chip in the composer | `Review of h41 · 3 − · 2 +`, Remove | in the composer's box, as a chip; the placeholder reads "The review goes as its own prompt. Add words to it here." |
| The board's frame | as today | the new tokens and type only |

The red disc of Don't want and the green disc of Want reuse the mark colours, and differ from authorship by shape (round
and signed against square and numbered) and by the hatch. That is the ruling.

### Named sets (#171)

| | Kept from the code | Placed and styled as |
|---|---|---|
| The word | **named set**, `#deck`, "Named sets" (the mockup's "Your groups" is not taken; groups are the model's) | the subheading "Named sets" under Parts |
| The rows (`SetRows`) | under their part when of one part, else under Named sets; swatch, `#deck`, count, Show only, the menu (Rename, Colour, Add / Take away selection, Re-pick, Make it a tag, Delete), `2 of 5 faces lost`, Undo | rows of the Parts section: a 10 px dashed square in the set's colour (`--set-n`; a proposal's dashed in `--agent-mark`), the name in mono, the count at the right; the menu on hover and focus |
| Making one (`MakeSet`) | `Ctrl+G` with a selection: name, comment, one of eight colours, `Enter` | **Name a set** in the In hand head; the box opens in the head under the selection, with the colours as eight 16 px swatches |
| In the view | Set scope in Select, lit in the set's colour, `#deck` in the readout | Select's scope in its grown pill (Set). The readout at the pointer is the caption |
| Claude's proposals | dashed, hatched faces, "Proposed by Claude", Accept / Dismiss | the row's swatch and text in `--agent-mark`, "Proposed by Claude" muted, **Accept** and **Dismiss** on the row |
| Refs in the chat and in asks | `#deck`, `lid/#deck` | chips in mono; a set's chip is outlined in its colour (1 px), the text in ink |

### Tracings (#174)

| | Kept from the code | Placed and styled as |
|---|---|---|
| The view and its switch | **Board / Model / Tracing** (the switch's word is "Tracing"), `Ctrl+Tab`, Tracing only with a tracing | the switch at the top left reads Model, Board, Tracing (in that order) |
| The picker | which tracing, then **New tracing** (a main plane and offset, the section, a face) | the first pill of the compass's place at the top right: "`T1` front of intake ▾" |
| Fit, 1:1 | **Fit** (`Shift+1`), **1:1** (`Shift+0`) | pills under the picker, with their caps |
| The tracing's panel (`TracingPanel`) | name, Rename, Remove (undo), plane, `redrawn for h57`, Model outline `exact` and its parts, Layers (colour, name, count, `by Claude`, eye, Add layer, cross, Undo), Photo (thumbnail, `4.73 px/mm`, `2.1°`, `5 points, straightened, fit 0.4 mm`, `not exact`, Fade, Hide, Line up again, Swap, Remove), Show in 3D, Export | **the Tracings section of the route card**, unfolded and in sight while the Tracing view shows one: the tracing's row opens out into these groups. The compass's place adds **Photo `55 %`** (the fade, a popover slider) and **Layers `2`** (a popover of the layer rows) for quick reach, and **Show in 3D** |
| The tools (`tracings/Palette`) | Select `V`, Trace `T` (Line, Circle, Label), Pin `P`, Ink `I` (its pens), Measure `M`, Should be here `O` | **the reed**, with these tools while the Tracing view shows. Trace's pill holds Line / Circle / Label, Ink's its pens |
| Should be here | the note at the pointer: "`M15` head bolt 4 should be here · `1.8 mm` left, `0.6 mm` up"; letting go makes the mark | a **tag tied by a leader** to the shape's ghost, with the same words. No "Tell Claude" button (the mockup's): the mark is a draft and goes with the next prompt, as the code does |
| Measure on a tracing | `exact on build h41` or `≈`, how it was found | a tag at the middle of the line, as Measure in 3D |
| The sheet | the grid, the `u`/`v` lines in axis colours, the parts named, the scale bar bottom left, the title block bottom right, `u, v` readout bottom left | as today in the new tokens and type; the title block: `--panel`, 1 px ink edge, radius 2 (a drawing's block), labels muted 11.5 px, values in mono |
| Claude's layers | in their layer colours (blue … olive), `by Claude` | as today; a layer Claude proposes, if one ever is, takes `--agent-mark` on its row only, never as a layer colour |
| Lining up the photo (`LineUp`) | the split view, numbered pairs, snapping, the live numbers, Preview, Straighten (`S`), Done (`Enter`), Cancel (`Esc`), the sentence on what a line-up is worth | the accent band "Lining up the photo of `T1`" with Straighten, Preview, Cancel and Done; the live numbers in the hint at the bottom middle ("scale `4.73 px/mm` · angle `2.1°` · fit `0.4 mm` (`5` points)") with the sentence under it in muted |
| A tracing in 3D | the eye in the Tracings rows, `tracingsShown` | the eye is on the tracing's row in the Tracings section |
| Export | the export's drawing of `T1` | the export's **Tracing** tile |

---

## 4. Names and behaviour kept against the mockup

The mockup is a picture, and in these places it is wrong about what torno does. The code wins, as ruled:

- **Draw**, not Sketch, is the tool (`D`). The sketch's pens are `B`, `L`, `P` and `C`, and x-ray is `I`, not `Shift+X` and
  `Shift+E`. The keys picture is generated from `KEYS`, so it cannot drift.
- **Parameters** is the section's name in the card (ruling 1).
- **Named sets**, not "Your groups". A set is lit in its own colour, not in a dashed accent outline.
- **Tracing** is the switch's word. The mockup's tab "T1 front" becomes the picker.
- **Should be here** makes a draft mark. There is no Tell Claude button.
- **Reviews** have a Plain pen, Items and End, as the code does.
- **Go back** stays "to before this prompt", with its confirmation. Picking a node offers it.
- **The ask over the view** today shows when the chat is not in sight. Now the dock's foot band carries it, and the dock
  shows itself on Answer.
- **Rebuild** stays in the status line.
- **The working dot** is still. The mockup's pulse is not taken.

---

## 5. What changes outside the renderer

- **Main:** the frameless window and the window controls' bridge (`main/index.ts`, `preload`, `shared/bridge.ts`). The
  export plan's weight per line (`main/export`). `thumb.json`'s box and the bench's thumbnail scale (`main/show/cards.ts`,
  `shared/thumbnail.ts`, `shared/show.ts`). `ObjectCard.waiting` (`main/show`). The faces written into an exported page
  (`main/export/html.ts`: Instrument Sans 400 and 600, Martian Mono 400).
- **`app/package.json`:** add `@fontsource/instrument-sans` and `@fontsource/martian-mono`, then remove the two Plex
  packages at the end.
- **`docs/manual.md`:** every place that says where a thing is: the rail and its panels become the route card and its
  index; the palette becomes the reed; the view bar and the strip of views become the compass; the bars at the foot become
  tags and procedure cards; the selection moves to In hand; the sketch panel and the round's panel move to the card's
  head; the builds strip; export in the dock; the keys; the first screen, the empty folder and the bench. "Not yet
  verified on a visible screen" gains the new window's items until Luis has looked. Each stage changes the manual with
  its code, in the same commit (`CLAUDE.md`, Commits).
- **`app/src/readme.test.ts`:** it holds the manual to the code: the generated tables of keys (`cheatSheet()`) and of
  the pointer, every tool's label and key, the MCP tools and prompts, the files and variables named, and the manual's
  `#`/`##` headings, exactly and in order. The redesign changes no heading: the new window is described inside the
  existing sections ("The agent", "Marks", "Explode and saved views", "The page of projects", "Export", "Keys" …). No key
  row changes, so the generated tables do not change. A new word in a row's text (a key's "does") is regenerated with
  `TORNO_README=write`. "Not yet verified on a visible screen" keeps its bold lead-in and required words, and gains the
  new window's items in its "to try" part.
- **Unit tests that read markup** move with their components: `Rail.test.ts` (the five panels' order becomes the card's
  index), `Layers.test.ts`, `ParamsPanel.test.ts`, `ChecksPanel` and `ChecksSummary` tests (merged), `ReviewBar.test.ts`
  (the band; its words stay), `BuildLine.test.ts` (the table), `BuildStatus.test.ts`, `SketchPanel` and `SketchPens`
  tests, `RoundPanel.test.ts`, `MakeSet.test.ts`, `tracings/Palette.test.ts`, `TracingPanel.test.ts`. Their assertions on
  words and numbers stay. Only class names and structure change. `viewport/overlay.test.ts` loses its checks of
  `--bar-side`, `--bar-lift`, `--hint-lift` and `[data-narrow]` in `layout.css`, and gains the cube's and the tags'.
- **`shared/contrast.test.ts`'s existing rules that name a token pair in a role that changes:** "`--panel` on `--accent`"
  becomes `--on-accent` on `--accent`; "`--panel` on `--user-mark`" becomes `--on-mark` on both mark colours. The rest
  stays, and the dark `--warn` stays `#CBAA6A`.
- **`.claude/rules/*.md`:** `styles-themes` (new tokens, faces, `--float-shadow`), `left-column` (the card, the index,
  `column.ts`'s new shape, the rail), `viewport-overlay` (no bars at the foot, the caption, tags and leaders, the
  compass, `section.spec` geometry), `explode` (the track and tag), `saved-views` (the compass's stack and its folding),
  `section` (the tag and rule), `session-pane` and `chat-pane` (header, strip, foot band, ask takeover), `chat-transcript`
  and `chat-cards-and-refs` (prompt heads, the slip, the borrowed leader), `builds-history` (the strip, Go back from a
  node), `export-page` (the dock, weights), `first-screen`, `page-of-objects` and `new-object-*` (the plates, the bench,
  the composer), `keys` (the keyboard, sentences), `scans-window` (the question in the view), `tracings`, `sets`, the
  marks rules that name the panel (`marks-window`, `checks-and-profile`, `params`), and `e2e-hidden-window` if a
  selector rule changes. A new rule, `leaders`, holds the leader rule and `LeaderLayer`. Each rule's `paths:` follow the
  files that move.
- **`CLAUDE.md`:** the design invariants (above), and the "Rules by area" list where a rule is added or renamed.
- **The design spec:** section 10 (above). Section 7's "the last one stays in the tool's strip" becomes "in the tool's
  tag".
- **The e2e specs:** their selectors follow the markup. The geometry checks of `section.spec.ts` (seven sizes, bars against
  corners, palette and strip) are replaced by checks of the new rules: no tag outside the view, no tag over the reed, the
  compass or the band, and the saved views folded while Section is in hand. `explode.spec.ts`'s "the view bar is one row
  at 1440 × 900" becomes "the compass fits at 1280 × 800". Specs that open a panel from the rail open a section instead.
  The full list of what each spec relies on is in the plan's first task.
- **The README pictures** (`docs/images/*.png`) are taken again at the end, by the recipe of
  `TORNO_README_*` settings, in the hidden window. The README's words about the window change with them.
- **The export page** (`app/src/export/page.css`, `export/page.test.ts`): the token block takes the new values and names
  that it carries (`--ink`, `--muted`, `--raise` if used, `--float-shadow`, `--radius-float`), and `--font-ui` and
  `--font-mono` become the new faces. The viewer's layout does not change.
- **The site** (`site/assets/site.css`, `app/scripts/build-site.mjs`): its palette and faces are the window's, as its
  first line says. It takes the new faces (woff2 copied from the packages, `font-display: swap`, preloaded) and the token
  values. Its layout does not change. Whether the site's hero takes the dyed field is ruling 8: a follow-up after the PR.
- **Light values written out** where no stylesheet is read (`viewport/theme.ts` `LIGHT_THEME`, `sectionDrawing.ts`
  `SHEET`, `overlay.ts` `AXIS_COLOURS`, `SURFACE` in `main/index.ts`, `ui/drawing/make.ts`): `--ink` changes, and they follow
  it, held by the existing tests.

### Changed in the build

What the build did differently from the text above, on purpose:

- The `ask.option` key row covers 1 to 9, not 1 to 3: the agent's own asks have options with keys too. torno's own
  question still takes 1 to 3.
- Section's `next` text and `left.resize`'s text are reworded, so that neither says "panel" or "bar".
- The MCP tools' words "Scans panel" became "Scans section".
- torno's own ask has "Or say what to do instead" as a button that focuses the box; torno's ask takes no text answer.
- The export tile and the frame take `--radius-control` and `--radius-float`, as the radius invariant says.

---

## 6. Stages

Each stage leaves the app working and the four suites green (`pnpm test`, `pnpm test:kernel`, the kernel's pytest,
`pnpm test:e2e`) with `pnpm -C app typecheck`. The manual and the rules change with the code in each stage.

1. **Foundation: tokens, faces, radii, leaders.** The new and changed tokens in `tokens.css` and `contrast.test.ts`.
   The faces bundled, and every place that names a font in TypeScript reads the tokens. The radius and shadow tokens, with
   every use of `--radius-palette` and `--palette-shadow` renamed. The `num` rule. `LeaderLayer` with its unit tests (the
   shape from a point and a box, the edge stop, no crossing a text box), not yet used. The export page and the light
   values written out follow the tokens. *Leaves:* today's layout in the new type and colours, every test green, the
   leader ready.
2. **The shell grid and the title bar.** The CSS grid in place of the absolute positions. The new widths, and the dock
   width kept. The frameless window, its controls and the bridge. The folder and project crumbs, and the session signs.
   The rail at 52 px, with icons only and tooltips, still opening today's panels. *Leaves:* the old panels, view and
   dock inside the new frame.
3. **The route card.** `PanelHost` goes. The sections, the route, folding, the rail as index, the In hand head with the
   selection moved in, Needs you, Parts with Named sets, Parameters, Checks (merged, with the gauge), Marks, Scans,
   Tracings (with `TracingRows` and, while the Tracing view shows, the tracing's panel), Print profile. `column.ts`'s new
   shape. The sketch panel and the round's panel move into the head. *Leaves:* the left column done. The view still has
   today's bars, less the selection's and the sketch panel.
4. **The view's chrome.** The reed with names that grow, the tips, the caption at the pointer. The compass (the still cube,
   the live sketch cube in its tile while sketching, the projection, the layout, Fit, Explode, the saved views and their folding). The bands. Tags and
   leaders for Section (with the rule), Measure, Explode (with the track), Compare, the sketch plane and Should be here.
   The procedure cards. The note card's look. The bottom freed: the old lifts go, and `section.spec.ts`'s geometry is
   replaced. The scan read question in the view. Confirm as a popover. *Leaves:* the view done.
5. **The session dock.** The header, the builds strip (nodes, failed and running nodes, bracket, the node's menu and Go
   back from it, the error popover), prompt heads and blocks, the slip with the aligned table and the count-up, the foot
   (tasks, suggestions, the box with what goes inside), the ask takeover and its borrowed leader, the terminal and no
   session under the strip. The status line's ticks. The borrowed leader from refs in the chat. *Leaves:* the dock done.
6. **Export, keys and changes.** Export in the dock (tiles, lines with weights, the rule, saved in the status line, the
   frame and band, the session's foot band), with main's weights per line. The keyboard and its sentences. Changes split
   over the view. *Leaves:* every sheet moved.
7. **The screens without a model and the bench.** The dyed plate and its drawn vise, the first screen, the empty folder
   with the composer, the new project page on the dye. The page of projects as a bench with Needs you and Working, and
   main's box, scale and waiting question. *Leaves:* the whole window.
8. **Outside the window, and the end.** The site's faces and tokens. The Plex packages removed. Section 10 and the
   `CLAUDE.md` invariants written in. The rules' last pass. The README pictures taken again. "Not yet verified on a visible
   screen" updated. The one PR.

Stages 3 to 5 touch different files and could be built side by side in worktrees, but each must rebase on the one
before: they share `layout.css`, `App.tsx` and the e2e specs.

---

## 7. Risks, and the testing of each stage

**Risks.**

- **Width.** The view is 560 px at 1280 × 800 with the card and dock open. Tags, the compass and a band must fit there.
  The e2e checks run at 1280 × 800 and 1440 × 900, and at the dock's widest drag.
- **Tags placed from 3D.** A tag can cover the part, another tag or the compass, or its subject can be off screen or edge
  on. The placement rule (four sides, then docked at the foot without a leader) is unit-tested as pure geometry, apart
  from three.js.
- **The frameless window on Linux.** `titleBarOverlay` support and the drag region differ by platform and window
  manager. torno's drawn controls are the fallback. A test cannot see the native frame, so this is checked by hand
  (listed under "Not yet verified on a visible screen").
- **Martian Mono is wide.** Tables of numbers and part names grow by about 15 %. The card's mono names are cut with an
  ellipsis and their title holds the whole name. A 10.5 px floor for mono keeps it readable.
- **The route card is the stacked column that the rail replaced to fix crowding.** Folding, the index and the head's
  height cap have to work, or the card is a long scroll again.
- **The builds strip takes about 136 px of the dock's height.** At 800 px tall, with an ask, the conversation is short. The
  strip folds to its head line and a row of ticks when the dock is under 640 px tall.
- **Moving the selection, the sketch panel and the round's panel** changes where e2e tests click. Each stage moves its
  tests with it.
- **True scale on the bench** needs main's box and a new thumbnail mode. Until a project is rebuilt it shows in Grid's
  look, so the bench is mixed for a while after the update.
- **Per-line weights** must add up to the total, or the rule lies. The test asserts the sum.
- **Scope creep from the mockups.** Sheets B's exported page, labelled STEP bodies, a dashed part in the preview and a
  true side-by-side of two builds' scenes are not built (Non-goals, rulings 6 and 7).

**Testing.**

| Stage | Tests |
|---|---|
| 1 | `shared/contrast.test.ts`: every pair and rule of "Contrast" above, both themes. `styles.test.ts`: no hex outside `tokens.css`, no `opacity` on text, no endless animation, every radius from the tokens or round, the one shadow token, `app.css`'s order. `export/page.test.ts`: the page's tokens equal the window's. `LeaderLayer` unit tests. `e2e/themes.spec.ts` in both themes. The full suites |
| 2 | Unit: the grid's widths, `torno.dock` read and written in try/catch. e2e in the hidden window: the window boots with the new frame at 1440 × 900 and 1280 × 800; the folder crumb opens the folder menu; the session signs name the other projects (stand-in agent); `focus.spec.ts`'s Tab order; F6 regions |
| 3 | Unit: `column.ts` (old shape read, folding kept), section heads' lines (`checksSaid`, `railBadges`), the merged checks' order, the gauge's window and its words. e2e: the rail's index scrolls the card; a part pointed at in the view lights its rows; selecting puts refs in In hand; Insert and Note; a sketch opens in the head; a review round in the head; a set made from the head; `groups.spec`, `references.spec` and the marks specs on their new selectors |
| 4 | Unit: tag placement (four sides, clamped, docked when off screen), the cube's faces to standard views, the saved views' folding rule, the caption's words (`stepFor`). e2e: Section's tag and rule, with `Esc` and a typed value; Measure's tag and Keep as a dimension; Explode's track and `E`; Compare's band; Align and Region cards; no tag over the reed, compass or band at both sizes; scan read in the view with the stand-in scan |
| 5 | Unit: the strip's nodes from `history` (saved, starred, failed, running, on show), the bracket's range from the scroll, the slip's table rows from the digest, count-up off under reduced motion. e2e with the stand-in agent: a turn lands a node and a slip; a failed build's node opens its error; Go back from a node with its confirm; an ask takes the foot and its option's leader; the terminal under the strip; no session |
| 6 | Unit: main's weights per line sum to the total; the sentences made from `KEYS` for each place; the keyboard map covers every single-key row of `KEYS`. e2e: export HTML and STEP from the dock to a file (the existing export specs on new selectors), saved in the status line; the keys rise and search answers in sentences; See changes splits the view |
| 7 | Unit: `thumbnailPlan`'s fixed scale; the page's groups (Needs you, Working, the rest) and order; the composer's folder name from words. e2e: first run and returning first screen; the empty folder's Start makes a project and starts the stand-in session; the bench with a built and an unbuilt project; Grid; the new project page |
| 8 | `readme.test.ts` with the whole manual; the site's build; every suite. The README pictures by hand in the hidden window |

No test opens a visible window, takes a screenshot or reads the clipboard (`e2e-hidden-window`). No test runs the real
agent (`e2e-stand-in-agent`).

---

## 8. Rulings (Luis, 2026-11-18)

Luis approved the spec on 2026-11-18 and took every recommendation of its open questions, as below. They are decided.

1. **The card's section is "Parameters"**, not the mockup's "Sizes", which is the board's size cards and the new
   project's "Sizes I know".
2. **The compass's cube is the still iso picture of the mockup; while a sketch is open it is the live sketch cube**
   (`viewCube.ts`), whose faces are the main planes.
3. **The rail's index keeps all eight icons** (Needs you, Parts, Parameters, Checks, Marks, Scans, Tracings, Print
   profile).
4. **Go back is offered from a node of the builds strip** and at each turn's end, both behind the same confirm.
5. **The caption at the pointer** replaces the step line at the foot. After a tool has been used ten times in this
   install, the caption shows only once the pointer has been still for half a second. The `aria-live` words are unchanged.
6. **Sheets B's exported page without a side panel, STEP bodies labelled in the preview, and a switched-off part drawn
   dashed** are a later issue. The export page takes the new tokens and type only.
7. **No export of another build by picking its node** in this redesign. The ring says which build goes.
8. **The site's hero on the dye** is a small follow-up after the PR. The PR gives the site the new faces and tokens only.
9. **The builds strip folds under 640 px of dock height** to its head line and a row of ticks.

Also approved: the working dot stays still and no caret blinks (the rule of `styles.test.ts`), and the merged code's names
are kept (Draw, its pens and keys, Named sets, Tracing, no Tell Claude button).
