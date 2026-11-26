"""The parts shelf: what ``common/parts/<id>/part.py`` of a workspace say, read and drawn in a worker.

Nothing here writes a file or changes a shape. A part is imported under a name of its own and asked, with its
default ``Params``, for its ``body(p)`` (the part as bought), its ``cutout(p)`` and its ``keepout(p)``; each is
drawn as outlines in millimetres of the B-rep's cross-section (``section``), never of a mesh. One part that fails
is that part's ``error``, never the whole answer. See ``.claude/rules/shelf.md`` for the contract.
"""

import contextlib
import dataclasses
import inspect
import itertools
import json
import keyword
import re
import signal
import sys
import time
from collections.abc import Iterator
from pathlib import Path
from typing import Any

from . import extent, loader, section

MOST_PARTS = 60
MOST_FILES = 100  # the other files of a part's folder that are listed
MOST_POINTS = 400  # of one outline
MOST_OUTLINES = 40  # of one drawing of a part
PART_SECONDS = 30.0  # what one part has to be imported and drawn
PLAN_Z = -0.5  # the plane of a plan, inside a panel
_ID = re.compile(r"[a-z_][a-z0-9_]{0,47}")
_made = itertools.count(1)


class _PartTime(BaseException):
    """A part took longer than it has. Not an ``Exception``: a model's ``except Exception`` must not take it in."""


def is_part_id(name: str) -> bool:
    """A folder that can be a part: a lower-case Python identifier of 48 characters at most, not a keyword
    (``isPartId`` in ``shared/shelf.ts``: one rule, said in two places)."""
    return bool(_ID.fullmatch(name)) and not keyword.iskeyword(name)


def part_ids(root: Path) -> list[str]:
    """The folders of ``<root>/common/parts`` that are parts, sorted, ``MOST_PARTS`` at most. A folder that is a
    link, one whose name is no identifier and one with no plain ``part.py`` are not."""
    parts = root / "common" / "parts"
    try:
        names = sorted(entry.name for entry in parts.iterdir())
    except OSError:
        return []
    found = []
    for name in names:
        folder = parts / name
        file = folder / "part.py"
        if not is_part_id(name) or folder.is_symlink() or not folder.is_dir():
            continue
        if file.is_symlink() or not file.is_file():
            continue
        found.append(name)
    return found[:MOST_PARTS]


def read(root: Path, deadline: float | None = None) -> dict[str, Any]:
    """Every part of the shelf of ``root``, in order of their ids: ``{"parts": [...]}``.

    ``deadline`` (``time.monotonic``) is when the whole op runs out: no part is started after it, and one that is
    running has what is left of it, at most ``PART_SECONDS``.
    """
    root = root.resolve()
    sys.dont_write_bytecode = True  # a part is read, and the shelf writes nothing
    sys.path.insert(0, str(root))
    parts = []
    for id in part_ids(root):
        left = PART_SECONDS if deadline is None else max(1.0, min(PART_SECONDS, deadline - time.monotonic()))
        parts.append(_alone(root, id, left))
    return {"parts": parts}


@contextlib.contextmanager
def _within(seconds: float) -> Iterator[None]:
    """Raise ``_PartTime`` in this thread once ``seconds`` have passed, unless the block is done."""

    def late(*_: Any) -> None:
        raise _PartTime

    previous = signal.signal(signal.SIGALRM, late)
    signal.setitimer(signal.ITIMER_REAL, seconds)
    try:
        yield
    finally:
        signal.setitimer(signal.ITIMER_REAL, 0)
        signal.signal(signal.SIGALRM, previous)


def _alone(root: Path, id: str, seconds: float) -> dict[str, Any]:
    """One part, whatever it does: what could be read of it, and ``error`` for what could not."""
    folder = root / "common" / "parts" / id
    told: dict[str, Any] = {"id": id, "name": id, "what": "", "params": [], "files": _files(folder)}
    try:
        with _within(seconds):
            _read_part(root, folder, told)
    except _PartTime:
        told["error"] = f"the part took more than {seconds:g} s to be imported and drawn and was stopped"
    # What is written must be JSON: a size that is NaN, text with half a character.
    try:
        json.dumps(told, ensure_ascii=False, allow_nan=False).encode("utf-8")
    except (ValueError, UnicodeError):
        reason = "a size or a text of the part cannot be written as JSON (a NaN, an infinity or half a character)"
        told = {"id": id, "name": id, "what": "", "params": [], "files": told["files"], "error": reason}
    return told


def _files(folder: Path) -> list[str]:
    """The plain files of the folder beside ``part.py``: not hidden, not a link, sorted."""
    try:
        entries = sorted(folder.iterdir())
    except OSError:
        return []
    names = [e.name for e in entries if e.name != "part.py" and not e.name.startswith(".") and e.is_file() and not e.is_symlink()]
    return names[:MOST_FILES]


def _read_part(root: Path, folder: Path, told: dict[str, Any]) -> None:
    path = (folder / "part.py").resolve()
    errors: list[str] = []
    try:
        module = _import(path, folder.name)
    except (Exception, SystemExit) as e:
        told["error"] = loader._model_traceback(e, path).rstrip()
        return
    try:
        told["name"], told["what"] = _said(module, told["id"])
        told["params"] = loader.read_params(module, path)
        made = _made_params(module)
    except Exception as e:
        errors.append(loader._model_traceback(e, path).rstrip())
        made = None
    for function, draw in (("body", _body), ("cutout", _cutout), ("keepout", _keepout)):
        if not callable(getattr(module, function, None)):
            if function == "body":
                errors.append("part.py has no body(p): the part as bought")
            continue
        try:
            told[function] = draw(_shape(module, function, made))
        except _PartTime:
            raise
        except (Exception, SystemExit) as e:
            errors.append(f"{function}(p): " + loader._model_traceback(e, path).rstrip())
    if errors:
        told["error"] = "\n\n".join(errors)


def _import(path: Path, id: str) -> Any:
    """The part's module, under a name no other import of it has, so that a project that imports it as
    ``common.parts.<id>.part`` and the shelf never share one module's state."""
    import importlib.util

    name = f"torno_part_{id}_{next(_made)}"
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise ImportError(f"{path} cannot be imported")
    module = importlib.util.module_from_spec(spec)
    folder = str(path.parent)
    sys.path.insert(0, folder)
    sys.modules[name] = module  # dataclasses look the module up while it executes
    try:
        spec.loader.exec_module(module)
    finally:
        with contextlib.suppress(ValueError):
            sys.path.remove(folder)
    return module


def _said(module: Any, id: str) -> tuple[str, str]:
    """The module docstring: its first line is the part's name, the rest what it is, on one line."""
    doc = inspect.cleandoc(module.__doc__ or "")
    first, _, rest = doc.partition("\n")
    return first.strip() or id, " ".join(rest.split())


def _made_params(module: Any) -> Any:
    params = getattr(module, "Params", None)
    return params() if isinstance(params, type) and dataclasses.is_dataclass(params) else None


def _shape(module: Any, function: str, made: Any) -> Any:
    """What ``module.<function>(p)`` gives, as a build123d shape that has a solid."""
    from build123d import Shape

    shape = getattr(module, function)(made)
    if not isinstance(shape, Shape) or not shape.solids():
        what = type(shape).__name__ if not isinstance(shape, Shape) else "a shape with no solid"
        raise TypeError(f"{function}(p) must return a part with a solid, got {what}")
    return shape


def _box(shape: Any) -> dict[str, list[float]]:
    low, high = extent.box(shape)
    return {"min": low, "max": high}


def _body(shape: Any) -> dict[str, Any]:
    box = _box(shape)
    return {"bbox": box, "side": _side(shape, box)}


def _cutout(shape: Any) -> dict[str, Any]:
    box = _box(shape)
    plan, size = _plan(shape, circle=True)
    if not plan:
        raise ValueError(
            f"cutout(p) has nothing at z = {PLAN_Z:g} mm, inside a panel: it must run through the panel, from a few mm below z = 0 up to it"
        )
    return {"side": _side(shape, box), "plan": plan, "size": size}


def _keepout(shape: Any) -> dict[str, Any]:
    box = _box(shape)
    return {"bbox": box, "side": _side(shape, box), "plan": _plan(shape)[0]}


def _cut(shape: Any, origin: list[float], normal: list[float], x: list[float], y: list[float], snaps: bool = False) -> dict[str, Any]:
    """The cross-section ``section`` makes of one shape by a plane, with the axes ``x`` and ``y`` laid in it."""
    args = {
        "layout": "shelf",
        "plane": {"origin": origin, "normal": normal},
        "axes": {"x": x, "y": y},
        "snaps": snaps,
    }
    return section.section({"shelf:part": shape}, args)["parts"][0]


def _side(shape: Any, box: dict[str, list[float]]) -> list[dict[str, Any]]:
    """The section by the XZ plane through the middle of the box in Y: ``x`` is X across, ``y`` is Z up."""
    middle = (box["min"][1] + box["max"][1]) / 2
    cut = _cut(shape, [0.0, middle, 0.0], [0.0, -1.0, 0.0], [1.0, 0.0, 0.0], [0.0, 0.0, 1.0])
    return _outlines(cut["loops"])


def _plan(shape: Any, circle: bool = False) -> tuple[list[dict[str, Any]], dict[str, float] | None]:
    """The section by the XY plane at ``PLAN_Z``, and with ``circle`` its size: ``{d}`` when it is one circle (of the
    B-rep's own circle), else ``{w, h}`` of the box of its points."""
    cut = _cut(shape, [0.0, 0.0, PLAN_Z], [0.0, 0.0, 1.0], [1.0, 0.0, 0.0], [0.0, 1.0, 0.0], snaps=circle)
    loops = cut["loops"]
    if not circle or not loops:
        return _outlines(loops), None
    if len(loops) == 1 and not loops[0]["corners"] and len(loops[0]["circles"]) == 1:
        return _outlines(loops), {"d": 2 * loops[0]["circles"][0]["radius"]}
    points = [p for loop in loops for p in loop["points"]]
    us, vs = [p[0] for p in points], [p[1] for p in points]
    return _outlines(loops), {"w": max(us) - min(us), "h": max(vs) - min(vs)}


def _outlines(loops: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The loops of a cut as told: ``points`` in millimetres, ``hole`` for a hole; the largest ``MOST_OUTLINES``,
    each of ``MOST_POINTS`` points at most."""
    told = []
    for loop in loops[:MOST_OUTLINES]:
        if not loop["closed"]:
            continue
        outline = {"points": _thin(loop["points"])}
        if (loop["area"] or 0) < 0:
            outline["hole"] = True
        told.append(outline)
    return told


def _thin(points: list[list[float]]) -> list[list[float]]:
    """The points, or fewer of them when there are over ``MOST_POINTS``: the ring through the ones that keep its
    shape within a tolerance that doubles from the section's own until they fit."""
    import numpy as np

    if len(points) <= MOST_POINTS:
        return [[float(u), float(v)] for u, v in points]
    ring = np.vstack([np.array(points), np.array(points[:1])])
    tolerance = section.DEFLECTION
    while len(ring) - 1 > MOST_POINTS:
        tolerance *= 2
        ring = section._thinned(ring, tolerance)
    return [[float(u), float(v)] for u, v in ring[:-1]]
