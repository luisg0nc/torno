---
paths:
  - "app/src/renderer/ui/openFolder.ts"
  - "app/src/renderer/ui/openFolder.test.ts"
  - "app/src/main/index.ts"
  - "app/src/main/recent.ts"
  - "app/src/main/recent.test.ts"
  - "app/src/main/example.ts"
  - "app/src/main/example.test.ts"
  - "app/src/main/quit.ts"
  - "app/src/main/quit.test.ts"
  - "app/src/renderer/ui/Welcome.tsx"
  - "app/src/renderer/ui/FolderMenu.tsx"
  - "app/src/renderer/ui/WorkspaceQuestion.tsx"
  - "app/src/renderer/ui/Confirm.tsx"
  - "app/src/renderer/closing.ts"
  - "app/src/renderer/closing.test.ts"
  - "app/src/renderer/App.tsx"
  - "app/src/renderer/ui/Logo.tsx"
  - "app/src/renderer/ui/plate/Plate.tsx"
  - "app/src/renderer/ui/plate/ScribedVise.tsx"
  - "app/src/renderer/ui/plate/Plate.test.ts"
  - "app/src/renderer/styles/plate.css"
  - "app/src/renderer/styles/welcome.css"
  - "app/e2e/welcome.spec.ts"
  - "app/e2e/quit.spec.ts"
---

# The first screen, recent folders, the example, and the window's questions

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## The first screen (`app/src/main`)

- The folders opened lately are `recent` in torno's own config file
  (`~/.config/torno/config.json`, on macOS `~/Library/Application Support/torno/config.json`, or `TORNO_CONFIG`; `src/main/recent.ts`):
  the newest first, eight at most, beside `workspace`. Never in a workspace.
  One that is no longer a folder is shown struck and leaves the list only
  when the person removes it. A test run reads and writes no config file but
  one it names with `TORNO_CONFIG`, and Electron keeps its own profile in a folder of the run in the temporary
  folder (`testProfile.ts`).
- The example is a copy of the project in `app/resources/example` (`EXAMPLE_OBJECTS` in
  `src/main/example.ts`: one, `enclosure`, a model written after the `torno-model` skill's template, with its
  `brief.md` and, in its `.torno/`, `marks.json` and `scene.json` and nothing else of it:
  `copiedOfExample`; `kernel/tests/test_example.py` builds it and holds its marks to the build) made in the
  system's temporary folder when it is asked for, once in a run, with a marker file at its top
  (`EXAMPLE_MARKER`). It is removed at the end of `will-quit`, after the
  writes that were under way and the sessions have ended (`removeExample`),
  and one a crash left is removed at the next start (`sweepExamples`): only
  ever a real folder that marker names, of a torno that no longer runs.
  `WorkspaceInfo.example` says the open folder is it, and the window says
  `EXAMPLE_NOTE` under the workspace's name.
  The example's own folder is never opened in place and never written to (the kernel's test workspace has nothing
  to do with it). **Keeping it** (`keepExample`, channel `workspace:keepExample`; the root CLAUDE.md names it among the writes
  outside `.torno/`) copies the open copy, with whatever was made in it (not the marker, `__pycache__`, links, nor
  `.torno/session.json` and `state.md`, which are of the run), to a new folder at the path the save dialog gave
  (under test `pickSave`): planned first (256 MB, 5,000 entries, 12 deep at most), written in a hidden
  `.<name>.torno-new-<random>` beside it, the name taken by `mkdir` and the hidden folder renamed onto it as the last
  step, refused for any name that is taken in any case; the copy to keep is `ws.info.root`, which must carry the
  marker. The folder is then opened and remembered like one chosen in "Open folder"; the temporary copy stays until
  quit, as ever. The copy is
  not remembered: not as the workspace to open next, not as a recent folder.

## Agents (`app/src/main`)

- **The window has no native frame** (`createWindow` in `index.ts`, `frame.ts`): `titleBarStyle: 'hidden'`, at least 1120 × 700 (`MIN_WINDOW`: the card and the dock leave the view its 420 px).
  Where the platform draws its controls (`frameOptions`: Windows, macOS) it is given `titleBarOverlay` of the bar's
  height (40) in `--surface` and `--muted` symbols, and keeps them with the system theme (`setTitleBarOverlay`); on Linux there is
  no overlay, `bridge.window.drawsControls()` is true and the window draws the three buttons, asking main through
  `bridge.window.minimize`, `toggleMaximize` and `close` (channels `window:minimize`, `window:toggleMaximize`, `window:close`;
  a sender other than the window is ignored). `close` is `win.close()`, so it meets the question below. `onMaximized`
  tells the window (`window:maximized`) when it is maximised, and once on load.
  The title bar keeps its content out of the platform's controls: `.title-row` is padded by the Window Controls Overlay's
  `env(titlebar-area-x)` and `titlebar-area-width`, and on macOS (`bridge.window.platform` set on `<html>` as
  `data-platform` in `main.tsx`) at least 78 px at the left for the traffic lights; Linux has none of it (`titlebar.css`).
- **Closing the window ends torno and every session in it, so it is asked first.** Main holds the window's
  `close` (`createWindow` in `index.ts`) and sends `window:closeAsked`; the window answers `window:closeAnswer`
  at once (`App.tsx`, from `renderer/closing.ts` `closingWhy`): `true` when nothing would be cut short, and the
  window closes; `false` while it asks the person in a dialog over the whole window (`ui/WorkspaceQuestion.tsx`: "Close torno?",
  "Keep it open" in focus), and then `true` only on "Close torno". The dialog lists what is cut short, a line each, with the
  object it is of as a link to it (`closingWhy` returns `{ objectId, what }` items): a session working or waiting for an
  answer (`busyWith`), a prompt written and not sent, a new object not made, a first prompt held, a painting of a region
  holding what is not kept (`unkept`), an import, an export being written. A window that does not answer within
  `CLOSE_ANSWER_MS` (1.5 s), or is loading or crashed, is closed without one; a quit that does not come through
  the window (`before-quit`, as `app.close()` of a test) is not held. Under test the question is answered by
  clicking it (`e2e/session.spec.ts`).

## The first screen (`app/src/renderer`)

- With no folder open the window is `ui/Welcome.tsx`, two halves of one grid (780 : 660, `welcome.css`) to the window's edges. At
  the left the dyed plate (`ui/plate/Plate.tsx`: `headline`, `lead`, `drawing` `'vise' | 'vise-unknown'`, `data-plate`, on `--dye`
  with `--on-dye` and `--on-dye-muted` for its words; styles in `plate.css`): "torno" at 86 px and the tagline "Make CAD parts with an
  AI agent." (`--on-dye`) "It writes the model in build123d; you point at what to change." (`--on-dye-muted`), and the vise scribed
  (`ui/plate/ScribedVise.tsx`): the outline in `--on-dye` at 0.5, the dimensions in `--scribe`, their numbers in mono `--on-dye-muted`,
  the part filled in `--accent-wash`. **It moves once**: the outline draws itself in 1.6 s (`stroke-dashoffset`, `pathLength` 1), the
  dimensions fade in at 1.1 s and the part fills at 1.4 s; the animations are in `prefers-reduced-motion: no-preference` only, so the
  vise otherwise stands drawn, and none is for ever (`styles.test.ts`). `vise-unknown` has a dashed part that never fills and `? mm`
  (the empty folder's plate). The dye is for screens with no model and for nothing else. At the right, on `--surface`, padded 64:
  on a first run the folder idea in a sentence ("An empty folder is fine: torno helps you make the first project."), after it "Open
  folder" (the one primary button, 42 px, radius 10) and, where torno runs from its repository, a quiet "Open the example" with its
  note (a temporary copy); coming back, "Recent folders" in place of the sentence, rows 68 px high, a mark (the small logo, until a
  project's own drawing is given: the dashed box where the folder is gone), the name (600) and the path in mono, and a folder that is
  gone struck, "Not found" and **Remove**; then the same two buttons. What torno needs follows (`Readiness`, one line when all is
  well), then the one footer: torno writes only into `.torno`, and the new folder of a project you make. Until the list has answered
  only the plate is shown. **The first screen has no title bar and the window no frame**, so the top 40 px (`welcome-drag`) is a
  `-webkit-app-region: drag` strip over both halves; the window controls (`BareControls`, `title-bare`) and every button are `no-drag`.
  The logo (`ui/Logo.tsx`) is the vise in `--ink` and the part in `--accent`; `scribed` is lines only, in `--on-dye`, for a dyed
  field; the same logo is in `--muted` over an empty view or page, and plain (one colour) where a picture is missing.
- For as long as the example is the open folder, the note at the top of the page of projects (`EXAMPLE_NOTE`) has a link-button,
  "Keep this as a folder…" (`KEEP` in `App.tsx`, through `leave`, so that it asks first as opening a folder does):
  main shows the save dialog and copies (`workspace.keepExample`); the folder it made is opened in place of the copy.
- With a folder open, the folder crumb of the title bar (`ui/TitleBar.tsx`, `Folder parts`) is a menu
  (`ui/FolderMenu.tsx`, hung from the crumb as a popover, `useMenu` for its keys): the recent folders, "Open folder…", "Open the
  example", "Refresh folder" (`workspace:refresh`: main `rescan`s, builds the project on screen again with `builds.update` or `rebuild`,
  and answers with the list, which `refreshWorkspace` puts in the store; it writes nothing) and "Check what torno needs". A folder torno is started with (`TORNO_WORKSPACE`) is added to the
  recent ones; the workspace to open next stays the one chosen in the window. The open folder's row is marked
  with a check and the word "current" in the muted face. A recent folder's row is two lines (name, path), so its
  style is `.menu-item.folder-item` (`titlebar.css`): `.folder-item` alone loses its height and padding to `.menu-item`,
  which comes later in the cascade (`e2e/finalfix.spec.ts` holds the rows apart). A folder that cannot be opened (one gone since the menu
  was read, one main refuses) leaves the workspace as it is and is said at the top of the page of projects, a `role="alert"`
  line with `openProblem`'s text, until the next action (`goTo` in `App.tsx` returns the problem).
- **The window's own questions are dialogs over the whole window, not strips of a section.** Closing torno and
  opening another folder while something would be cut short ask in `ui/WorkspaceQuestion.tsx`, a centred
  `alertdialog` (modal: nothing behind it takes a click or a key, Tab goes round within it, "Keep it open" /
  "Stay here" in focus, Escape presses it, even with the focus elsewhere). Its keys are heard before any other
  listener's (`keyGate`, added to the window when the module is read, before the window's own keys and the view's):
  while it stands no key reaches anything behind it, wherever the focus is, and a press on its backdrop leaves the
  focus in it. It stands over the sheet of what torno needs, which shares its layer (`data-question`). It lists a line for each thing with the
  object it is of, as a link that goes to that object (or to the page of a new one) and puts the question away
  (`closingWhy`, `leavingWhy` in `closing.ts` return those items). `ui/Confirm.tsx` is the question about one thing (a scan, a mark, the session, Align): a popover from the button that asked
  (`ui/Popover.tsx`: 290 px, `--raise`, radius 10, a stem to the anchor, `position: fixed` from the anchor's box by
  `popoverPlace.ts` so nothing clips it, and it takes off what a transformed ancestor adds; Escape closes it and the focus goes back to the
  anchor). The anchor is the `anchor` given, or the element that had the focus as the question came (the button pressed).
  The safe button has the focus; the one that acts is outlined in `--fail`.
- **The Board | Model | Tracing switch** is the main area's, not the first screen's: the first screen (no project open) has none, and a project opens on the model, or on the view it was left on
  (`board.md`, `tracings.md`). A project left on a tracing that is gone opens on the model.
