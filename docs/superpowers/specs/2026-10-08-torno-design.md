# torno: design

Date: 2026-10-08. Status: draft for review. Sections 3, 4, 6 and 8 include the results of two feasibility spikes run the same day.

## 1. What torno is

Torno is a desktop workbench for making CAD parts with an AI coding agent. The agent (Claude Code first, any terminal LLM CLI later) writes build123d Python. Torno shows the result and gives the human and the agent a shared, exact way to talk about geometry.

Torno is not a modeller. It has no sketcher, no feature tree and no way to edit a solid by hand. Every tool in it exists either to **tell the agent something** (point, mark, sketch, place a rough shape, state a dimension) or to **read the part** (measure, cut, compare with a scan, look from a view).

The name is Portuguese for lathe.

### Why it is needed (evidence from the micra-intake session)

One session, 19 hours, about 28 human messages:

- 13 of 22 attached images were screenshots of a viewer; 9 had red ink drawn on them. Claude received pixels, never the location.
- About 9 of 20 substantive turns were corrections of something Claude had declared good.
- One open-mesh slit took 5 messages and 100 minutes, because Claude could not see what the user was looking at or which viewer judged it.
- Two freehand sketches each ended, in one message, a misunderstanding that had survived two or three rounds of text.
- Claude wrote 17 throwaway scripts to load, align, slice and clash-check the scan, and the scan viewer was republished by hand 16 times.

### Success criteria

1. A user can click a spot on the part, type "this edge is ugly", and the agent receives the part, face, coordinates, normal and camera, with no screenshot taken by hand.
2. The agent can ask torno for exactly the view the user is looking at, and for a section or a measurement, and gets an image or exact numbers back.
3. Saving the model file updates the viewport in about a second for a small part, with the previous build kept on screen when the new one fails.
4. A Polycam scan can be imported, aligned and overlaid without writing a script, and the agent can query clearance against it.
5. The existing objects in `~/objects` open without changes to their code.

### Out of scope

Direct modelling, parametric sliders, slicer integration, multi-user collaboration, cloud sync, Windows and macOS packaging, a custom chat UI (the session layer leaves room for one).

## 2. Concepts

| Term | Meaning |
|---|---|
| Workspace | A folder of objects sharing one Python environment (`~/objects`). |
| Object | One folder with one model file (`airbox.py`). The unit a session works on. |
| Scene | What the model file produces: named parts, grouped in layouts. |
| Layout | One arrangement of the parts: `assembly` (as mounted) or `print` (posed for the bed). |
| Reference | A part shown for context that is not printed (a filter, a pipe). |
| Scan | An imported mesh with a stored transform into the object's frame. |
| Mark | Anything the user or the agent places on the scene to communicate. Section 5. |
| Ref | A stable text handle for geometry: `lid`, `lid/F12`, `lid/E40`, `M3` for a mark, `S1` for a scan. |
| Revision | A counter that increases with each successful build. |

## 3. Architecture

Three processes.

```
┌─ Electron main (TypeScript) ─────────────────────────────┐
│ window · workspace state · file watcher                  │
│ sessions (node-pty)      MCP server (HTTP, 127.0.0.1)    │
│ hook endpoint (HTTP)     kernel supervisor               │
└──────┬───────────────────────────┬───────────────────────┘
       │ IPC (contextIsolated)     │ stdio, framed JSON + binary
┌──────┴───────────────┐   ┌───────┴──────────────────────┐
│ Renderer             │   │ Python kernel                │
│ React + Zustand      │   │ build123d · ocp-tessellate   │
│ three.js viewport    │   │ numpy                        │
│ xterm.js sessions    │   │ supervisor + forked workers  │
└──────────────────────┘   └──────────────────────────────┘
```

**Electron**, not Tauri: this machine is NVIDIA on Wayland, which is the documented weak case for WebKitGTK. Electron pins one Chromium, and node-pty plus xterm.js is a proven terminal stack (nerv uses it).

**No daemon.** nerv keeps a daemon so sessions outlive the window. Torno does not: closing the window ends the PTYs, and sessions are resumed with `--resume`. This removes a process, a socket protocol and an install step.

**State ownership.** Main owns durable state (marks, scans, views, layer settings) and writes it to disk. The renderer holds a mirror in Zustand and sends intents. The kernel owns geometry. Per-frame state (camera while orbiting, hover) stays inside the viewport code and never passes through React.

### Repository layout

```
torno/
  app/                Electron app (pnpm, TypeScript, Vite)
    src/main/         shell, sessions, mcp, hooks, kernel client, store
    src/renderer/     ui/, viewport/, state/
    src/shared/       types shared by main and renderer (marks, refs, protocol)
  kernel/             Python package torno_kernel (uv)
  docs/
```

### Files torno writes

In each object folder, `.torno/`:

```
.torno/
  marks.json          all marks, open and resolved
  scene.json          layer visibility, colours, the section, how far each layout is exploded, the saved views
  thumb.png, thumb.json  a picture of the last build, for the page of objects
  agent.json          the view of this object's sessions, chat or terminal (Claude Code only since 2026-10-16)
  exports/            HTML files the person exported (ignored by git)
  scans.json          every scan: its source (path, size, hash), how it was imported, one transform per layout
  scans/<id>/         mesh.bin (the scan, in mm, Z up) and one .mask per region painted on it
  views/              images the agent asked for (latest N)
  state.md            a plain-text summary any LLM can read
```

`state.md` exists so an agent with no MCP support still has the build status, the open marks and the refs. Everything is plain JSON or Markdown, safe to commit. `scans/.gitignore` leaves `mesh.bin` out: it is rebuilt from the source.

## 4. Kernel

### Loading a model

The kernel imports the object's model file as a module, so `if __name__ == "__main__"` does not run and nothing is exported. It then finds the scene, first match wins:

1. `torno_scene()` if the module defines it. Returns a `torno.Scene`, for full control (layouts, references, colours).
2. Convention: `Params()` then `assembly(p)` → layout `assembly`; `printables(p)` or `printable(p)` → layout `print`. Each returns `dict[str, Part]`.
3. Module-level build123d shapes, by variable name.

So today's objects load unchanged. `airbox.py` has only `printable`, so it shows a print layout until it gains an `assembly`.

A small helper package, `torno`, is importable from models: `torno.Scene`, `torno.reference(shape)`, `torno.tag(face_or_edge, "name")`. Tagged geometry gets a named ref (`lid/mount_face`) that survives topology changes. The helper is optional.

### Process model

Measured on this machine: importing build123d takes 2 to 4 s, the helmet stand builds and tessellates in about 1 s, and `airbox.py` takes about 30 s. So:

- A **supervisor** imports build123d once and stays up.
- Each build runs in a **forked worker** (`os.fork`): 20 to 40 ms of overhead instead of 4 s, and a crash, a segfault in `fillet` or a timeout kills only the worker.
- The newest successful worker stays alive as the **query server** for its revision, because it holds the exact shapes. Measure, section and clearance go to it. A scan is imported by a process of its own (`python -m torno_kernel.scans`), never by the supervisor or a worker; trimesh is an optional extra of the kernel package that only that process asks for.
- A build in progress is killed when a newer save arrives.
- Slow models show a "building" state with elapsed time over the previous revision.

Rules the spike proved necessary:

- **The supervisor only imports.** It never loads a model, builds geometry, tessellates or answers a query. One OCC boolean or tessellation in the parent starts OCC's thread pool, and every worker forked afterwards deadlocks. The one allowed warm-up is `Text("warm", 10)`, which loads fontconfig and saves 1.5 s per worker.
- **Workers never fork.**
- **Every build has a timeout**, as the backstop for a deadlock.
- **Workers call `prctl(PR_SET_DUMPABLE, 0)` after fork**, otherwise systemd-coredump delays crash detection by 2 to 3 s.

The kernel is started with the workspace's own environment so the model's imports resolve:
`uv run --no-sync --project <workspace> --with-editable <torno>/kernel python -m torno_kernel`.
`--no-sync` leaves the workspace's `.venv` and lockfile untouched; the kernel's own dependencies (ocp-tessellate, numpy) go into a uv overlay.

### Output of a build

Per part: tessellation from ocp-tessellate (vertices, normals, triangles, edge segments, `triangles_per_face`, `segments_per_edge`, face and edge types), the part's location, bounding box, volume, validity, and a content hash so unchanged parts are not re-sent.

Vertices are in the part's local frame and the location is sent beside them; the viewport applies it. Refs and coordinates exchanged with the user and the agent are always in the object's frame. Per face and edge: type, area or length, centroid, normal or axis. On failure: the traceback, with the previous revision kept and marked stale.

### Queries (exact, on the B-rep; those of a scan approximate, and saying so)

`describe(ref)`, `distance(a, b)`, `angle(a, b)`, `radius(ref)`, `thickness(point, direction)`, `bbox(ref)` (approximate on freeform faces, and labelled so), `mass(ref, density)`, `section(plane)` → outlines per part, `overlap(a, b)` → volume and box, `clearance(a, b)` → minimum distance and where, `scan_clash(part, scan)` → scan points inside the part in clusters, the deepest and where, the nearest outside, and the scan's triangles that go through its surface, whether or not a vertex of theirs is inside; `scan_deviation(part or faces, scan)` → how far apart they lie, as min, mean, max and percentiles; `scan_section(plane, scan)` → the scan's polylines in a plane. These three are approximate by nature and say so: only the distance from a reported scan point to the B-rep is exact. `mesh_check(part)` → open edges after welding and where.

### Geometry identity

A face ref is the part name plus the face's index in OCC explorer order (`lid/F12`); this matches `part.faces()`. Edge indices come from the kernel's own table (`TopExp.MapShapes`), because the tessellation includes degenerate edges that `part.edges()` omits. Indices change when topology changes. Torno does not try to track faces through rebuilds. Instead:

- Marks are anchored to a **point in the model frame**, with the ref recorded as a hint.
- After each build, each anchor is re-projected to the nearest surface of the same part. The ref is updated; if the surface moved more than a tolerance, the mark is flagged `drifted`; if the part is gone, `orphaned`.
- Everything sent to the agent carries a descriptor beside the ref: "planar face, normal +Z, z = 20, 1180 mm²".
- `torno.tag` gives permanent names where the author wants them.

## 5. Marks

A mark is the unit of communication. One list, one data model, shown in the viewport and in a side list, numbered `M1`, `M2`, … so that images and data refer to the same thing.

| Kind | Made by | Says |
|---|---|---|
| Pin | click a point | "here" + a note |
| Pick | click a face, edge or part | "this one" + a note |
| Arrow | drag from a point | "move this that way" (direction and length in mm) |
| Stroke | draw freehand | on the surface, or on a locked view plane: a profile, an outline, a scribble |
| Shape | place a box, cylinder, sphere or plane with a gizmo | intent: `add`, `remove`, `keep-out`, `reference` |
| Dimension | two picks | measured value; optionally "should be 12 mm" |
| Region | paint or box on a scan | "this part of the scan", with a note saying what it is |

Common fields: `id`, `kind`, `author` (`user` or `agent`), `note`, `anchors` (point, normal, ref, descriptor), `camera`, `revision`, `status` (`draft` → `sent` → `resolved`, plus `drifted`, `orphaned`).

Strokes drawn on a locked orthographic view are stored as 2D polylines in millimetres on a named plane (for example "plane XZ at y = 40"). That is the form in which a hand-drawn profile is directly usable by build123d.

The agent can create marks too (`add_mark`), to ask "do you mean this face?" or to show where a change was made, and resolves the user's marks when it has acted on them. The panel lists marks by what is to be done with them (to send, with the agent, to review, resolved); what the agent resolved waits under "To review" as one summary, with Review and OK all, until the person acknowledges it.

**Pinned dimensions** are dimension marks that stay. They are re-measured on every build. With an expected value and tolerance they show pass or fail. This is the ruler that verifies.

With no marks, the Marks section says what a mark is for, and no key: "Point at the part to leave a note for the agent. A mark goes with your next prompt, and stays here until the agent resolves it." A tool's key is shown only on the tool palette (its button and tooltip) and on the sheet of keys (`?`).

## 6. The agent link

### Sessions

The real CLI in a PTY, drawn with xterm.js, one or more per object. Launch arguments for Claude Code:

- `--session-id <uuid>` (new) or `--resume <id>`
- `--mcp-config` pointing at torno's HTTP MCP server, with the object in the URL path
- `--settings` with hooks posting to torno (does not touch `~/.claude/settings.json`)
- `--append-system-prompt` with a short description of torno's tools and the ref syntax
- `--allowedTools mcp__torno__*`

An **agent adapter** says how one CLI is started so that it knows torno (command, arguments, where the MCP server is, the system prompt) and whether it posts hooks. Claude Code does. Copilot CLI is the second adapter and does not: it reads its instructions from a folder torno names, is told of the build and the marks through .torno/prompt.md when the person presses "Send marks", and its status is only running or ended. The agent is chosen per object. Codex, Gemini CLI and opencode are not written: none was at hand to read the flags of.

*2026-10-16:* support for Copilot CLI was removed, and with it the machinery for an agent without hooks ("Send marks", `.torno/prompt.md`, `.torno/agent/`) and the choice of agent. Torno runs Claude Code only; `.torno/agent.json` keeps only the view, and a file naming Copilot CLI is read as Claude Code with a note saying so. Git history keeps the adapter should it come back.

*2026-10-16:* while the New object page is up, the session pane says what Claude Code will start with in the new object (its name, whether it is described, how many photos, doodles, scans and objects), filled in as the draft is made, in place of New session and Resume of the object that was open; the list selects nothing, the Marks section is hidden and the status line reads "New object" alone. A session of the object that was open that is still live stays whole, with a note that it is that object's and goes on. Leaving the page brings everything back as it was.

Session status (idle, working, needs input) comes from HTTP hooks: `UserPromptSubmit`, `Stop`, `Notification`, `PermissionRequest`, `SessionEnd`. (`SessionStart` does not fire as an HTTP hook and is not used.) Torno does not read Claude's private files.

### Three ways information reaches the agent

1. **With every prompt.** A `UserPromptSubmit` hook returns `additionalContext`: build status and revision, the current selection, and every `draft` mark as text. Those marks become `sent`. The user points, types a sentence in the terminal, and the agent has both.
2. **On request.** The agent calls MCP tools.
3. **By insertion.** "Insert ref" pastes `lid/F12` or `M3` at the terminal cursor, as a bracketed paste, never auto-submitted.

*2026-10-16:* in the chat a prompt can also carry a drawing on the view: the agent's picture of the view with the person's ink, and a caption naming what the ink lies over by ref (`2026-10-16-torno-draw-on-view-design.md`).

### MCP tools

| Tool | Returns |
|---|---|
| `scene()` | parts, layouts, scans, build status, revision, what is visible, the user's camera, the saved views and whether the view is exploded |
| `marks(status?)` | marks as data |
| `scans()` | the scans with their alignment in the layout, size, source |
| `look(view?, parts?, section?, marks?, scans?, size?, explode?)` | an image. No arguments means exactly what the user sees. `view` is a preset name, a named view, or a camera. Each image has axes, a scale bar and mark numbers. |
| `describe(ref)` | exact geometry of a part, face or edge, and its neighbours |
| `measure(kind, a, b?)` | distance, angle, radius, thickness, bbox, mass |
| `section(plane, parts?, scan?)` | image plus outlines in mm |
| `check(kind, a, b?)` | overlap, clearance, mesh |
| `scan_clash(part, scan?, ignore?)` | scan points inside a part, in clusters, the deepest and the nearest outside; approximate |
| `scan_deviation(part, faces?, scan?, region?, from?)` | how far a part, or faces of it, lies from a scan; approximate |
| `highlight(refs, note?)` | shows the user those refs |
| `show(view?, parts?, section?, scans?, explode?)` | changes the user's viewport |
| `save_view(name, …)` | proposes a saved view to the user |
| `add_mark(...)`, `resolve_mark(id, note?)` | writes marks |

Images come from the same renderer the user sees (a render target in the window, 20 to 30 ms at 1024 × 768), so the two sides never disagree about what is on screen. The long edge is capped at 2000 px, above which the CLI downscales.

After each build torno also writes a contact sheet (four views per layout) and the mesh check into `.torno/`, and the next prompt's context says whether the build passed.

## 7. Viewport

Custom, on plain three.js with three-mesh-bvh. It is the centre of the product and needs torno's own picking, mark rendering, scan handling and look, so it is not a wrapped third-party viewer. The kernel's tessellation format (ocp-tessellate) is the input.

- **Parts:** one mesh per part with per-face triangle ranges, plus true B-rep edges as lines. Z up, millimetres.
- **Picking:** BVH raycast; the triangle index maps to a face through the cumulative `triangles_per_face`. Edges and vertices are picked within a pixel radius. Hover highlights the face or edge and shows its type and size.
- **Layers:** every part, reference and scan has visibility, colour and opacity. Layout switch between assembly and print. Explode slider: per layout, for display only. Nothing is marked, measured or cut while the parts are drawn apart, and no position told to the agent is an exploded one. A section is never drawn exploded.
- **Views:** standard views, perspective/orthographic toggle, named views saved per object.
- **Section:** one plane, axis-aligned or taken from a picked face, dragged along its normal, with stencil caps coloured per part. Scans are clipped without caps.
- **Measure:** point, edge and face snapping; live readout from the mesh while hovering, the committed value from the kernel.
- **Scans:** drawn with vertex colours baked from the texture, opacity slider, one mesh for drawing, picking and checking (reduced only above 2 M triangles).
- **Render on demand**, not a continuous loop.

## 8. Scans

Import GLB, glTF, OBJ, PLY or STL by drop or dialog. The import process (trimesh) bakes vertex colours from the texture, converts to millimetres and Z up, and writes one mesh, `mesh.bin`; up to 2,000,000 triangles it is not reduced (Micra: 1.6 M, 3.4 s, 34 MB). The source is referenced by path, size and hash and never copied. Unit and up axis are assumed from the format and the size (glTF: metres, Y up), shown, and can be changed afterwards.

Alignment, in order of use:

1. **Floor:** pick three points or a patch on the scan; it becomes the XY plane.
2. **Pairs:** click matching points on scan and model (three or more); rigid fit with optional uniform scale.
3. **Nudge:** a gizmo, with numeric entry.

A transform is kept per layout; a scan with none for the layout shown is not aligned there and nothing is checked against it. After every build each alignment is checked against the model again. ICP refinement is deferred.

## 9. Show

The objects of a workspace are on one page of cards: a picture of the last build, its status, open marks and failing dimensions. **Export** writes one self-contained HTML file for one object or several: three.js and a small viewer inlined, meshes quantised and compressed, parts, layouts, explode, a clipping section, saved views, marks when asked, scans only when the person ticks them and then reduced to 60,000 triangles. It fetches nothing and opens from file://. Torno does not publish anything itself, and has no side-by-side comparison of objects.

## 10. Design language

Its own, and deliberately far from nerv's dark control room.

- **Idea:** a toolroom surface plate. Calm, light, exact. The part is the only loud thing on screen.
- **Layout:** the viewport fills the window. Tools float on it in one small palette. Layers and marks sit in a narrow column on the left; the session docks on the right and can be widened, hidden or made full height. No frames within frames.
- **Colour:** warm paper-grey surfaces and graphite text in light mode, with a matching dark mode. One accent, layout blue (the blue machinists paint on steel before scribing). User marks are red pencil, agent marks are green, so authorship is visible at a glance. Parts use a muted, distinguishable palette.
- **Logo** (2026-10-16): torno is Portuguese for a bench vise. The mark is one seen from the side: its jaws and slide holding a part in layout blue, its screw and handle, its base, the vise in graphite on the paper grey. The logo is the mark over the name in the sans, semibold, lowercase. The icon is `scripts/torno.svg` (and `torno-16.svg`, drawn again on whole pixels for 16 px), the window's `app/resources/icon.png` is made from it, and `ui/Logo.tsx` draws the same in the window: in the theme's ink and accent, or in one colour where it stands in for a picture.
- **Type:** a humanist sans for UI and a monospace with tabular figures for every number and ref. Sentence case. No all-caps labels.
- **Feel:** small radii, hairline dividers, no glow, no ornament. Motion only where it explains a change (camera moves, a rebuild landing).
- **Keyboard:** single-key tools (`P` pin, `A` arrow, `D` draw, `S` shape, `M` measure, `X` section), `E` explode, and `?` for the sheet of keys.

## 11. Errors

- **Build fails:** previous revision stays, dimmed, with the traceback one click away. The next prompt's context includes the error tail.
- **Kernel worker crashes or times out:** reported as a build failure with the signal; the supervisor is unaffected. If the supervisor dies it is restarted once, then reported.
- **Mark loses its anchor:** `drifted` or `orphaned`, shown in the list, reported to the agent.
- **Session exits:** the pane offers resume.
- **MCP call before the first build, or with an unknown ref:** a plain error message naming the valid refs.

## 12. Testing

- **Kernel:** pytest against small fixture models: scene discovery, tessellation shape, each query against known geometry, anchor re-projection across a topology change, crash isolation.
- **Main:** vitest: mark store, hook context text, MCP tools against a fake kernel, session launch arguments against a fake CLI.
- **Viewport:** unit tests for picking maths and face lookup; a Playwright Electron smoke test, in a hidden window, that opens a fixture object, picks a face, and checks the resulting mark.
- **End to end, by hand:** open `~/objects/micra-intake`, with the real Claude Code.

## 13. Milestones

Each is its own plan and ends in something usable.

1. **Loop.** Shell, kernel, open a workspace, rebuild on save, viewport with parts, layers, views and layouts, one embedded Claude Code session with MCP `scene` and `look`.
2. **Talk.** Picking, marks (pin, pick, arrow, stroke, shape), prompt context hook, insert ref, `marks`, `highlight`, `show`, `add_mark`, `resolve_mark`, `describe`.
3. **Read.** Measure, pinned dimensions, section cut, `measure`, `section`, `check` for overlap, clearance and mesh.
4. **Scan.** Import, align, overlay, regions, `scan_clash`.
5. **Show.** Explode, named views, the page of objects, HTML export, a second agent adapter, polish.
