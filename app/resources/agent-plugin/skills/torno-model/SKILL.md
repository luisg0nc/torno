---
name: torno-model
description: The contract of a torno model file (Params, assembly, printables, make_<part>) with a template. Use before writing a new model, restructuring one, or when a build fails with no_scene or no_model.
---

# The torno model file

torno imports the model file of the project folder and rebuilds it on every save. Do not run it yourself to
preview it: check the build with `mcp__torno__scene` and look with `mcp__torno__look`.

## Before the first model

Before the first build of a new project, and before a new feature that depends on something not given, settle what
would make the build wrong:

- how the thing is arranged or mounted: what it sits on or against, which way it faces, which layout;
- which bought part it holds (a board, a switch, a battery), when the person neither named it nor gave its STEP file;
- how a drawing reads: whether a doodle's 2 cm is the gap or the outside, which view it is;
- any size that decides fit or function and has no source: the parts it mates with, holes and fasteners, clearances,
  the overall size. A size has a source when the person gave it, in the first prompt or as a size card on the board
  (read them with `mcp__torno__board` when the prompt does not say them), or when `brief.md`, a reference picture's note, a PDF, a scan (≈, to a few
  mm) or another project says it. A size the person gave is not asked again.

Ask the person in one round, before you build, with `AskUserQuestion`, only what would change the build. Where the
question is about shape, put a sketch of each choice in its option (`preview`): an answer to a picture holds better
than one to words. For a size, one option is a typical value labelled as typical ("0.2 mm per side, usual for PLA at
a 0.4 mm nozzle"). The person may answer "build with assumptions". What does not decide fit (a fillet, a chamfer, a
wall) is an assumption they can change afterwards in `Params`, not a question. If nothing would change the build, ask
nothing. Never ask more than one round for a change.

Then build with the answers. What is still unknown is built as assumed: a field of `Params` whose comment begins
`assumed:`, and your reply lists the assumptions.

## Writing down the brief

`brief.md` is the person's own words: what they wrote on torno's new project page and what they change in their
editor. Never edit it (torno refuses the edit). What you learn or settle with them (an answer, a choice, a size, a
rule) goes on the brief as a card of yours, with `mcp__torno__add_card`: one card per topic, its text beginning with
the topic's name ("Mount: an adjustable arm: base, link and head, ..."), a size as a size card, a rule in the frame
named Rules. When a topic changes later, change your card of it (`card` and `text`) rather than add another: the
person sees the change in the prompt that made it, and what it said before stays visible to them. Read the board first
(`mcp__torno__board`) to find your card of that topic.

## Seeing a value while building

You cannot run the model, but torno gives back what it prints. To see a value, `print()` it in the model (or
`assert` it: a failed assert fails the build and comes back with its traceback). The last 15 lines of what the build
printed come with the answer to your edit, and in `output` of `mcp__torno__scene`, whether the build worked or failed;
build123d's own warnings are among them. Remove the `print` once it has served.

## A CLAUDE.md that names another way to see the build

Claude Code also reads the `CLAUDE.md` files of the workspace and of the person; torno's first prompt of a session
lists them. What torno's tools say of the build is current: a file that names another viewer, report or export step
is about another way of working. Follow its advice on how to model, not on how to see the build, which is
`mcp__torno__scene`, `mcp__torno__look` and `mcp__torno__measure`.

## Saying what an edit should change

Before an edit that should change something you can state, call `mcp__torno__expect` with what it should do: a part's
`volume`, `faces`, `edges` or `size` as a `value` or a `change` with a `tolerance`, a `measure` check with the `expected`
number, and `unchanged` for the parts it must leave alone. The answer to the edit then says in one line how many checks
the next successful build met and which it did not, with the numbers. It is told once, holds nothing back, and is no
mark; a miss is a reason to look, not a failure. A ref to a face of a part whose face count changed is said as moved and
is not measured: describe it again.

## Which file

- The project folder holds one model file: a top-level `*.py` that is not a test (`test_*.py`, `*_test.py`,
  `conftest.py`), not a dotfile and not `__init__.py`.
- If there are several, the model is the one named after the folder, `-` and `_` counting as the same
  (`helmet-stand/helmet_stand.py`). Otherwise the build fails with `no_model` or as ambiguous.
- Scratch scripts go outside the project folder or in a `tools/` subfolder of it, so the folder keeps one model
  file. Never write in `.torno/`: it is torno's own.

## What torno takes from it

The file is imported as a module (its `if __name__ == "__main__":` block does not run). The first convention it
follows is used:

1. **`Params` with `assembly(p)` and/or `printables(p)` (or `printable(p)`).** `Params()` is made with no
   arguments and passed to each. Each returns a `dict` of part name to build123d shape (anything else fails the
   build). `assembly` gives the layout `assembly`: the parts as they are put together. `printables` gives the
   layout `print`: the parts as they are printed (flat side down, each on its own). Where parts of the print
   layout overlap, torno spreads them apart along +X for display, and refuses distances, clearances and overlaps
   between parts it moved: fit is checked in `assembly`.
2. **Else `Params` with `make_<part>(p)` functions**, the module's own, each taking `p` alone: one part per
   function, named after it, in the layout `main`. Only what returns a solid is kept.
3. **Else the solid shapes at the top level of the module** (names not starting with `_`) are the parts of
   `main`.

A layout with no part is dropped; a file that gives none fails with `no_scene`, saying what it found.

## Groups

When parts belong together (one of two alternatives, a sub-assembly, the pieces a part is cut into), say so in
the model with an optional `groups(p)`, beside `assembly` and `printables`. It is called with the same `Params()`
and returns a `dict` of group name to the names of its parts:

```
def groups(p: Params):
    return {"flat": ["flat-left", "flat-centre", "flat-right"], "aggressive": ["aggressive-left", "aggressive-right"]}
```

- One level only, and a part is in one group at most. A group is across layouts, by part name: in each layout it
  is those of its parts the layout has.
- A group name has no `/`, is not of the form `M<n>`, and is not the name of a part. A part name it lists must be
  in some layout. Otherwise the build fails saying what is wrong: a part renamed and not in its group is told at
  once.
- The user sees the groups in the layers list (fold, hide, show only that group). Group names are taken wherever
  parts are named: `parts` of `mcp__torno__show`, `mcp__torno__look` and `mcp__torno__save_view`, `refs` of
  `mcp__torno__highlight` and `ref` of `mcp__torno__describe` (the box of its parts and their volume).
  `mcp__torno__scene` and `state.md` list them.
- Name the parts with the group as a prefix (`flat-centre`), so that a reader of the file sees it too.
- Asked to group parts, edit `groups(p)` in the model: torno keeps no groups of its own.

## Tags

A face number (`lid/F12`) is renumbered whenever the model's topology changes. When a face or an edge matters across
edits (a mounting face, the edge a dimension is on, the screw holes), name it in the model with an optional
`tags(p, parts)`, beside `assembly` and `printables`. It is called once for each layout with the dict of parts that
layout's function returned, and returns part name to tag name to a face, an edge, or a list of them, **taken from
those very shapes**:

```
def tags(p: Params, parts):
    lid = parts["lid"]
    return {"lid": {"top": lid.faces().sort_by(Axis.Z)[-1], "screw_holes": lid.faces().filter_by(GeomType.CYLINDER)}}
```

- The ref is `lid/@top`; a tag of several (`lid/@screw_holes`) is taken whole by `mcp__torno__highlight` and
  `mcp__torno__ask`, and refused where one face or edge is needed (it names them). `describe`, `measure`, marks and
  dimensions take a tag of one. `mcp__torno__scene` lists each part's tags with the faces and edges they are now.
- A mark placed on a tagged face or edge keeps the tag, and every build looks for it first: it follows the face when
  the numbers shift or the face moves. Prefer a tag to a bare `F12` in anything that must outlive an edit.
- `parts` is that layout's own dict, so a part the layout lacks is not in it (a reference is in the assembly only):
  take a face of it only `if "608" in parts`. A tag name is a letter or `_`, then letters, digits, `_`, `.` or `-`. A tag that names nothing the part has (a
  face of another part or taken before an edit, a solid, an empty list) fails the build and says which. A part
  the layout lacks is skipped; a part no layout has fails.
- The shapes are the layout's own, so in a `print` layout that poses a part differently a selection by direction
  (`sort_by(Axis.Z)[-1]`) may pick another face than in `assembly`: choose faces by something that does not depend on
  the pose, or tag them where the layouts agree.
- Asked to name a face, edit `tags(p, parts)` in the model: torno keeps no tags of its own. No `torno` import is
  needed.

## References: bought parts

A printed part is usually made around something bought: a screw, a bearing, a board, a motor. Put it in the model with an
optional `references(p)`, beside `assembly` and `groups`. It is called with the same `Params()` and returns a `dict`
of name to shape, in the frame of the assembly:

```
from bd_warehouse.bearing import SingleRowDeepGrooveBallBearing

def references(p: Params):
    return {"608": Pos(0, 0, 4) * SingleRowDeepGrooveBallBearing(size="M8-22-7", bearing_type="SKT")}
```

- A reference is **not a part**. It is drawn in a neutral grey (with the tag "bought" in the layers list), picked and
  measured like a part, and `mcp__torno__check` takes it as the obstacle it is: `clearance` and `overlap` between a
  part and a reference, and `interference` of the layout (a reference is never judged against another reference). It is
  not in the `print` layout, not counted by `bed`, has no mass, takes no `thin`, `overhang` or `mesh` check, and is in no
  STL or 3MF; a STEP holds it only when the person ticks it. `mcp__torno__scene` and `describe` say `role: reference`.
- It is in every layout but `print`, so it needs an `assembly(p)` (or `make_<part>(p)` functions). Its name is its own:
  not a part's, no `/`, not of the form `M<n>`. `checks(p)` and `groups(p)` may name it
  (`{"name": "bearing seat", "kind": "clearance", "a": "housing", "b": "608", "min": 0.05, "max": 0.3}`).
- A standard part: use `bd_warehouse` (in torno's kernel, see the `build123d` skill), with `simple=True` for a screw.
  A vendor's part: read its STEP in the model, `import_step(Path(__file__).parent / "reference" / "608zz.step")`
  (`from pathlib import Path`; the folder `reference/` of the project is where the person puts such a file), and return it among the
  references. torno reads no file itself. A STEP can be big and is read at every build: say so if a build is slow.
  A part of many solids or an assembly is taken as the solids it holds, in one shape; its labels are lost.
- Parts bought for several projects go in `common/` (a save there builds every project that imports from it), as
  `common/parts.py` with a maker for each, rather than a copy in each model.
- Give each a place that is true: a reference at the wrong place makes a `clearance` that passes for the wrong reason.
  Say where it is from (a datasheet, a measurement) in a comment of `Params`.

## Checks

What must stay true when a size changes can be declared in the model, with an optional `checks(p)` beside `groups`.
It is called with the same `Params()` and returns a list of declarations, which torno measures with the kernel after
every build. A declaration is data, not a function: torno says whether each result is exact.

```
def checks(p: Params):
    return [
        {"name": "lid fits the tub", "kind": "clearance", "a": "lid", "b": "tub", "min": p.clearance - 0.05, "max": p.clearance + 0.05},
        {"name": "tub is one body", "kind": "solids", "a": "tub", "equals": 1},
        {"name": "walls", "kind": "thin", "a": "tub", "min": 1.2, "layout": "print"},
        {"name": "fits the bed", "kind": "bed", "size": [256, 256, 256]},
    ]
```

- `name` and `kind` are required. `a` and `b` are part names or group names (a group stands for its parts), never a
  face or edge number, which changes with the model. `layout` is optional.
- Kinds: `clearance` (the least distance between `a` and `b`), `overlap` (the volume they share: wants none
  unless told), `solids` (how many solids `a` has), `volume` (mm³), `thin` (a wall under `min` mm), `overhang`
  (faces facing down steeper than `angle`, 45 by default), `mesh` (the part's mesh is closed) and `bed` (the layout
  fits `size`).
- What is wanted: `min` and/or `max`, or `equals`, or `expected` with `tolerance` or `percent`. Read sizes from
  `Params`, as everywhere else.
- A declaration that is not one fails the build and says what is wrong. A check that does not pass never fails the
  build: it is told to you after the build, after the user's dimensions, and listed in the window as the model's own
  checks. It is not a stop sign: it holds nothing back.
- Read a result for what it says. `thin` is found by sampling, so "none found" is not "none there"; a volume that is
  not exact says so. A pass is what was measured, not proof that the part is right: do not tell the user that the
  part is verified.
- The user's dimensions stay the user's. A check never replaces one, and never silences one.
- Do not make a check pass by weakening it. torno compares each build's checks with the build before and tells the
  user when you removed one or made it easier to pass (`min` lowered, `max` raised, a larger bed). If a requirement
  really changed, say so in your answer when you change the check.

## Fitting a part to another project

A lid made for a box, a mount made for a part another project holds: import the other project's maker rather than
copying its numbers, and put its part in `assembly(p)` only, never in `printables(p)` (it is not printed here), so
that `check clearance` and `check overlap` work across the two. Put the other project's folder on `sys.path` first
(`sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "box"))`) and `import box`.

torno reads which files the model imported from beside its folder (`uses` in `mcp__torno__scene` and `state.md`):
a save in one of them builds this project again, and the project's card says `A source has changed since`. It
declares nothing of its own. If two projects import each other, both show each other in `uses`; Python will
usually refuse the cycle, so break it by moving what they share into `common/`.

## Params is the one source of sizes

Every size, clearance and count is a field of `Params`, with a default; functions read `p.wall`, never a number
written inline. A change of size is then one edit, and the parts that must fit each other read the same field.

Every size says where it comes from: its comment begins with the source and a colon, and the rest says why. The
sources are `brief`, `M<n>` (a mark), `S<n> ≈` (a scan), `ref <file>` (a reference picture's note), `object` (another
project), `datasheet <name>`, `person` (an answer in the chat), `derived` (worked out from other fields) and
`assumed`. A size with no source is shown to the person as having none; torno tells you the assumed ones after a build
and does not check any of them.

```py
wall: float = 2.0       # assumed: 5 perimeters at 0.4 mm
board_w: float = 55.2   # datasheet: ESP32-S3 DevKitC-1 v1.1
clearance: float = 0.2  # person: "0.2 per side"
```

**Units.** torno's window shows each value with its unit, and `scene` tells it (`unit`). Say nothing and a `float` is
shown in mm and an `int` with no unit. Declare any other in the field's own `metadata`, as written text: `"deg"` for an
angle (shown `15°`), `"count"` for a count (shown as the number alone), `"%"`, `""` for none, or any other unit
(`"rpm"`). A float that is an angle, a count, a ratio or a per cent must say so, or the person reads it as millimetres;
so must an `int` that is a length (`"mm"`). torno converts nothing: the unit says what the number your model reads is in.

```py
tilt: float = field(default=15.0, metadata={"unit": "deg"})  # person: "tilted 15 degrees"
spread: float = field(default=1.5, metadata={"unit": ""})    # assumed: how much wider the foot is than the top
```

**Trying other values.** The person may try another value for a field in torno's window (a literal number or bool, or a
`Literal`); torno then builds with it, and tells you under `params` (`value` against `default`) and in the first lines of
each prompt. The file always wins: such a value is dropped when you change that default, so to keep one, edit the default.
To learn what a different value gives without editing, call `try_params` (it builds a copy and throws it away). Both reach
the model only through `p`: pass `p` on to helpers, and never make `Params()` inside a function. A range for a slider is the
field's own `metadata`: `wall: float = field(default=2.0, metadata={"min": 1, "max": 5, "step": 0.2})`.

## Template

```python
"""A box with a lid that sits on it."""

from dataclasses import dataclass

from build123d import Axis, Box, Location, Pos, Rot, fillet


@dataclass(frozen=True)
class Params:
    width: float = 60.0  # brief: "about 60 by 40"
    depth: float = 40.0  # brief: "about 60 by 40"
    height: float = 30.0  # assumed: not in the brief
    wall: float = 2.0  # assumed: 5 perimeters at 0.4 mm
    lid_height: float = 4.0  # assumed: plate 2 mm plus a 2 mm lip
    clearance: float = 0.2  # person: "0.2 per side"
    rounding: float = 1.0  # assumed: a soft edge


def make_tub(p: Params):
    outer = Box(p.width, p.depth, p.height)
    inner = Pos(0, 0, p.wall) * Box(p.width - 2 * p.wall, p.depth - 2 * p.wall, p.height)
    tub = outer - inner
    return fillet(tub.edges().filter_by(Axis.Z), p.rounding)


def make_lid(p: Params):
    plate = Box(p.width, p.depth, p.wall)
    lip_w = p.width - 2 * p.wall - 2 * p.clearance
    lip_d = p.depth - 2 * p.wall - 2 * p.clearance
    lip = Box(lip_w, lip_d, p.lid_height - p.wall)
    # Rounded as the tub's inside is, or its square corners would reach into the tub's rounded ones.
    lip = Pos(0, 0, -(p.lid_height - p.wall) / 2 - p.wall / 2) * fillet(lip.edges().filter_by(Axis.Z), p.rounding)
    return plate + lip


def assembly(p: Params):
    """As put together: the lid on the tub."""
    return {
        "tub": make_tub(p),
        "lid": make_lid(p).moved(Location((0, 0, p.height / 2 + p.wall / 2))),
    }


def printables(p: Params):
    """As printed: each part flat on the bed (torno spreads them apart along X)."""
    return {
        "tub": make_tub(p),
        "lid": Rot(180, 0, 0) * make_lid(p),
    }


def checks(p: Params):
    """What must stay true when a size changes; torno measures it at every build (see Checks)."""
    return [
        {"name": "lid does not overlap the tub", "kind": "overlap", "a": "lid", "b": "tub"},
        {"name": "tub is one body", "kind": "solids", "a": "tub", "equals": 1},
    ]


# Parts that belong together, for the layers list and the tools (optional; see Groups):
# def groups(p: Params):
#     return {"box": ["tub", "lid"]}
```

Having both `assembly` and `printables`, this file has the layouts `assembly` and `print`; the `make_` functions
are only helpers here, since the first convention wins.
