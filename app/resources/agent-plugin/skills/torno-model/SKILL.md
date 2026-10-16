---
name: torno-model
description: The contract of a torno model file (Params, assembly, printables, make_<part>) with a template. Use before writing a new model, restructuring one, or when a build fails with no_scene or no_model.
---

# The torno model file

torno imports the model file of the object folder and rebuilds it on every save. Do not run it yourself to
preview it: check the build with `mcp__torno__scene` and look with `mcp__torno__look`.

## Which file

- The object folder holds one model file: a top-level `*.py` that is not a test (`test_*.py`, `*_test.py`,
  `conftest.py`), not a dotfile and not `__init__.py`.
- If there are several, the model is the one named after the folder, `-` and `_` counting as the same
  (`helmet-stand/helmet_stand.py`). Otherwise the build fails with `no_model` or as ambiguous.
- Scratch scripts go outside the object folder or in a `tools/` subfolder of it, so the folder keeps one model
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

## Params is the one source of sizes

Every size, clearance and count is a field of `Params`, with a default; functions read `p.wall`, never a number
written inline. A change of size is then one edit, and the parts that must fit each other read the same field.

## Template

```python
"""A box with a lid that sits on it."""

from dataclasses import dataclass

from build123d import Axis, Box, Location, Pos, Rot, fillet


@dataclass(frozen=True)
class Params:
    width: float = 60.0
    depth: float = 40.0
    height: float = 30.0
    wall: float = 2.0
    lid_height: float = 4.0
    clearance: float = 0.2
    rounding: float = 1.0


def make_tub(p: Params):
    outer = Box(p.width, p.depth, p.height)
    inner = Pos(0, 0, p.wall) * Box(p.width - 2 * p.wall, p.depth - 2 * p.wall, p.height)
    tub = outer - inner
    return fillet(tub.edges().filter_by(Axis.Z), p.rounding)


def make_lid(p: Params):
    plate = Box(p.width, p.depth, p.wall)
    lip_w = p.width - 2 * p.wall - 2 * p.clearance
    lip_d = p.depth - 2 * p.wall - 2 * p.clearance
    lip = Pos(0, 0, -(p.lid_height - p.wall) / 2 - p.wall / 2) * Box(lip_w, lip_d, p.lid_height - p.wall)
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


# Parts that belong together, for the layers list and the tools (optional; see Groups):
# def groups(p: Params):
#     return {"box": ["tub", "lid"]}
```

Having both `assembly` and `printables`, this file has the layouts `assembly` and `print`; the `make_` functions
are only helpers here, since the first convention wins.
