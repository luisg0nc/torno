"""Find an object's model file, import it and collect its scene."""

import ast
import importlib.util
import inspect
import io
import math
import re
import sys
import tokenize
import traceback as tb_module
import weakref
from pathlib import Path
from types import ModuleType, TracebackType
from typing import Any

_PRINT_FUNCTIONS = ("printables", "printable")
_MAKER_PREFIX = "make_"


class Layouts(dict):
    """The model's layouts, layout → name → shape, and which of the parts in them are ``references``: bought
    parts the model puts in the assembly to be seen and checked against, never printed, counted or exported
    as a part (``references(p)``), and the ``tags`` the model gave the faces and edges of their parts (``_tags``):
    ``(layout, part)`` → tag → ``{"faces": [...], "edges": [...]}``. A dict in every other respect, so what reads
    layouts reads this."""

    references: frozenset[str] = frozenset()
    # The ``Params`` fields ``references(p)`` read, in the order it read them; None when that could not be told (the
    # caller then takes it that they read every one).
    references_read: tuple[str, ...] | None = None
    tags: dict[tuple[str, str], dict[str, dict[str, list[int]]]] = {}  # noqa: RUF012 - replaced, never changed in place


class LoadError(Exception):
    """A model could not be found or loaded. ``kind`` is a protocol error kind."""

    def __init__(self, kind: str, message: str, traceback: str = "") -> None:
        super().__init__(message)
        self.kind = kind
        self.message = message
        self.traceback = traceback


def choose_model(dir: Path) -> Path:
    """Return the model file of an object folder.

    Candidates are the top-level ``*.py`` files that are not tests, dotfiles
    or ``__init__.py``. Of several, the one named after the folder is the
    model, with ``-`` and ``_`` treated alike (``helmet-stand/helmet_stand.py``).
    The app's ``scanWorkspace`` chooses by the same rule.
    """
    candidates = sorted(p for p in dir.glob("*.py") if p.is_file() and _is_candidate(p.name))
    if not candidates:
        raise LoadError("no_model", f"no model file in {dir}")
    if len(candidates) == 1:
        return candidates[0]
    named = [p for p in candidates if _same_name(p.stem, dir.name)]
    if len(named) == 1:
        return named[0]
    names = ", ".join(p.name for p in candidates)
    raise LoadError("no_model", f"more than one model file in {dir}: {names}")


def load_scene(dir: Path, model: str) -> dict[str, dict[str, Any]]:
    """Import ``dir/model`` and return its scene as layout → name → shape."""
    return load_model(dir, model)[0]


def load_model(
    dir: Path, model: str, overrides: dict[str, Any] | None = None, report: dict[str, Any] | None = None
) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """Import ``dir/model``: its scene as layout → name → shape, its ``Params`` (``read_params``), its
    groups of parts (``_groups``) and the checks it declares (``_checks``).

    ``overrides`` are values for fields of ``Params`` to build with instead of the file's defaults (see
    ``apply_overrides``); ``report``, when given, is filled with ``applied`` and ``dropped``."""
    path = (Path(dir) / model).resolve()
    try:
        module = _import_model(path)
        applied, dropped = apply_overrides(module, path, overrides or {})
        _OVERRIDDEN[module] = applied
        if report is not None:
            report["applied"], report["dropped"] = applied, dropped
        scene = _collect_scene(module)
        scene = _references(module, scene) if scene else scene
        groups = _groups(module, scene) if scene else []
        checks = _checks(module, scene, groups) if scene else []
        if not isinstance(scene, Layouts):
            scene = Layouts(scene)
        scene.tags = _tags(module, scene) if scene else {}
    except LoadError:
        raise
    except Exception as e:
        raise LoadError("exception", str(e), _model_traceback(e, path)) from e
    if not scene:
        raise LoadError("no_scene", _no_scene(module, model))
    return scene, read_params(module, path, applied), groups, checks


# The values a loaded model's ``Params()`` is made with (see ``apply_overrides``), by module.
_OVERRIDDEN: "weakref.WeakKeyDictionary[ModuleType, dict[str, Any]]" = weakref.WeakKeyDictionary()


def _params(module: ModuleType) -> Any:
    """The model's ``Params``, made with the overrides this load carries (none: its defaults)."""
    import dataclasses

    made = module.Params()
    applied = _OVERRIDDEN.get(module)
    return dataclasses.replace(made, **applied) if applied else made


_NOT_USES = {".venv", "venv", "site-packages", "__pycache__", ".torno", "node_modules", ".git"}


def used_files(dir: Path, model: str) -> list[str]:
    """The Python files of the workspace that the model imported, outside its own folder: another project's
    module, ``common/``. Paths relative to the workspace (the folder above ``dir``), with ``/``, in order.

    Read from ``sys.modules`` after the load, so it is what the model really imported, never what torno
    declares. The model itself, build123d and the standard library are not among them. A project that
    imports another which imports it back is listed by both: Python alone decides if that works.
    """
    own = (Path(dir) / model).resolve().parent
    root = own.parent
    found: set[str] = set()
    for name, module in list(sys.modules.items()):
        if name.startswith("torno_model_"):  # a model loaded as a model (a test process loads many), not imported
            continue
        file = getattr(module, "__file__", None)
        if not isinstance(file, str) or not file.endswith(".py"):
            continue
        try:
            path = Path(file).resolve()
            relative = path.relative_to(root)
        except (OSError, ValueError):
            continue
        if own in path.parents or _NOT_USES.intersection(relative.parts):
            continue
        found.add(relative.as_posix())
    return sorted(found)


_MARK_ID = re.compile(r"M\d+")


# The layout of parts to print: bought parts have no place in it.
_NOT_FOR_REFERENCES = "print"


def _references(module: ModuleType, scene: dict[str, dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """The model's ``references(p)``: bought parts (name → shape, in the frame of the assembly) added to every layout
    but the one to print, and named in the ``Layouts`` returned.

    Read only under the ``Params`` convention; the scene as it was without it. A reference is a part for everything
    that looks at the build (it is drawn, picked, measured, and a ``clearance`` or ``overlap`` may name it) and not
    for what makes a thing (the print layout, ``bed``, ``mass``, a mesh export). What is wrong with it fails the build.
    """
    function = getattr(module, "references", None)
    if not callable(function) or not hasattr(module, "Params"):
        return scene
    params, read = _tracked(_params(module))
    made = function(params)
    shape = "references() must return a dict of name to shape"
    if not isinstance(made, dict):
        raise LoadError("exception", f"{shape}, got {type(made).__name__}")
    parts = {name for layout in scene.values() for name in layout}
    for name, value in made.items():
        if not isinstance(name, str) or not name:
            raise LoadError("exception", f"{shape}, got the name {name!r}")
        if "/" in name:
            raise LoadError("exception", f"references(): a reference name has no /: {name}")
        if _MARK_ID.fullmatch(name):
            raise LoadError("exception", f"references(): {name} has the form of a mark's id; name it otherwise")
        if name in parts:
            raise LoadError("exception", f"references(): {name} is also the name of a part; a reference has a name of its own")
        if not _is_solid_shape(value):
            raise LoadError("exception", f"references(): {name} is not a shape with a solid in it, got {type(value).__name__}")
    if not made:
        return scene
    into = [layout for layout in scene if layout != _NOT_FOR_REFERENCES]
    if not into:
        raise LoadError(
            "exception", "references() need an assembly(p) (or make_<part>(p) parts) to stand in: the print layout has none of them"
        )
    laid = Layouts({layout: dict(named) for layout, named in scene.items()})
    one = {name: _one_shape(value) for name, value in made.items()}
    for layout in into:
        laid[layout].update(one)
    laid.references = frozenset(one)
    laid.references_read = tuple(read) if read is not None else None
    return laid


def _tracked(params: Any) -> tuple[Any, list[str] | None]:
    """``params`` and the list its fields are noted in as they are read. A copy of another class (a subclass), so what
    the model does with it (``dataclasses.replace``, which reads every field) is told as reading them; the list is
    None, and ``params`` as it was, when it cannot be copied that way (``__slots__``)."""
    import dataclasses

    read: list[str] = []
    if not dataclasses.is_dataclass(params) or not hasattr(params, "__dict__"):
        return params, None
    names = {f.name for f in dataclasses.fields(params)}

    class Tracked(type(params)):  # type: ignore[misc]
        def __getattribute__(self, name: str) -> Any:
            if name in names and name not in read:
                read.append(name)
            return super().__getattribute__(name)

    try:
        tracked = object.__new__(Tracked)
        tracked.__dict__.update(params.__dict__)
    except Exception:
        return params, None
    return tracked, read


def _one_shape(value: Any) -> Any:
    """A bought part as one shape. A library's part (a bearing from bd_warehouse, a STEP with an assembly in it) is a
    compound of children, a ball, a ring, a cage; those cannot be drawn as a part, so it is taken as the compound of
    its solids (where they are), which keeps the geometry and loses the labels."""
    if not getattr(value, "children", None):
        return value
    from build123d import Compound

    return Compound(list(value.solids()))


def _groups(module: ModuleType, scene: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    """The model's ``groups(p)``: group name → part names, one level, a part in one group at most.

    Read only under the ``Params`` convention (``assembly``/``printables``/``make_<part>``); ``[]`` without it.
    A group is across layouts, by part name. What is wrong with it fails the build, saying how.
    """
    function = getattr(module, "groups", None)
    if not callable(function) or not hasattr(module, "Params"):
        return []
    made = function(_params(module))
    shape = "groups() must return a dict of group name to part names"
    if not isinstance(made, dict):
        raise LoadError("exception", f"{shape}, got {type(made).__name__}")
    parts = {name for layout in scene.values() for name in layout}
    known = ", ".join(dict.fromkeys(name for layout in scene.values() for name in layout))
    owner: dict[str, str] = {}
    groups: list[dict[str, Any]] = []
    for name, members in made.items():
        if not isinstance(name, str) or not isinstance(members, (list, tuple)):
            raise LoadError("exception", f"{shape}, got {name!r}: {type(members).__name__}")
        if not all(isinstance(m, str) for m in members):
            raise LoadError("exception", f"{shape}: group {name} holds something that is not a part name")
        if not name:
            raise LoadError("exception", "groups(): a group name is not empty")
        if "/" in name:
            raise LoadError("exception", f"groups(): a group name has no /: {name}")
        if _MARK_ID.fullmatch(name):
            raise LoadError("exception", f"groups(): group {name} has the form of a mark's id; name it otherwise")
        if name in parts:
            raise LoadError("exception", f"groups(): group {name} has the name of a part; name it otherwise")
        if not members:
            raise LoadError("exception", f"groups(): group {name} has no parts")
        for member in members:
            if member not in parts:
                raise LoadError("exception", f"groups() names {member}, which no layout has; parts: {known}")
            if member in owner and owner[member] != name:
                raise LoadError(
                    "exception", f"groups(): {member} is in groups {owner[member]} and {name}; a part is in one at most"
                )
            owner[member] = name
        groups.append({"name": name, "parts": list(dict.fromkeys(members))})
    return groups


_TAG_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_.-]*")


def _tags(module: ModuleType, scene: dict[str, dict[str, Any]]) -> dict[tuple[str, str], dict[str, dict[str, list[int]]]]:
    """The model's ``tags(p, parts)``: part → tag → a face, an edge, or a list of them, taken from the shapes it
    was given. Called once per layout with that layout's parts, read only under the ``Params`` convention.

    Each face or edge is matched to the kernel's index (``topo``) by ``IsSame``, here, before the build spreads a
    print layout (a moved shape is not the same one). Returns ``(layout, part) → tag → {"faces": [...], "edges":
    [...]}``, the empty lists left out and the indices in the order given. A tag that names nothing the part has
    (a shape of another part, a solid, an empty list), a name that is no tag name, or a part no layout has fails
    the build, saying which.
    """
    function = getattr(module, "tags", None)
    if not callable(function) or not hasattr(module, "Params"):
        return {}
    from . import topo
    from .ocp import TopAbs_EDGE, TopAbs_FACE, TopExp, TopTools_IndexedMapOfShape

    shape = "tags() must return a dict of part name to a dict of tag name to a face, an edge or a list of them"
    params = _params(module)
    known = ", ".join(dict.fromkeys(name for layout in scene.values() for name in layout))
    found: dict[tuple[str, str], dict[str, dict[str, list[int]]]] = {}
    for layout, parts in scene.items():
        made = function(params, dict(parts))
        if not isinstance(made, dict):
            raise LoadError("exception", f"{shape}, got {type(made).__name__}")
        for part, named in made.items():
            if not isinstance(part, str) or not isinstance(named, dict):
                raise LoadError("exception", f"{shape}, got {part!r}: {type(named).__name__}")
            if part not in parts:
                if any(part in other for other in scene.values()):
                    continue  # a part the model keeps out of this layout
                raise LoadError("exception", f"tags() names {part}, which no layout has; parts: {known}")
            whole = getattr(parts[part], "wrapped", parts[part])
            maps = {}
            for kind in (TopAbs_FACE, TopAbs_EDGE):
                maps[kind] = TopTools_IndexedMapOfShape()
                TopExp.MapShapes_s(whole, kind, maps[kind])
            count = {"face": len(topo.faces(parts[part])), "edge": len(topo.edges(parts[part]))}
            tagged: dict[str, dict[str, list[int]]] = {}
            for tag, shapes in named.items():
                where = f"tags(): {part}/@{tag}"
                if not isinstance(tag, str) or not _TAG_NAME.fullmatch(tag):
                    raise LoadError(
                        "exception", f"tags(): {tag!r} is no tag name of {part}: a letter or _ first, then letters, digits, _ . -"
                    )
                items = list(shapes) if isinstance(shapes, (list, tuple)) else [shapes]
                if not items:
                    raise LoadError("exception", f"{where} is an empty list: it names no face or edge of {part}")
                indices: dict[str, list[int]] = {"faces": [], "edges": []}
                for item in items:
                    wrapped = getattr(item, "wrapped", None)
                    kind = wrapped.ShapeType() if wrapped is not None else None
                    if kind not in (TopAbs_FACE, TopAbs_EDGE):
                        raise LoadError("exception", f"{where} is {type(item).__name__}, not a face or an edge of {part}")
                    what = "face" if kind == TopAbs_FACE else "edge"
                    number = maps[kind].FindIndex(wrapped) - 1
                    if number < 0:
                        raise LoadError(
                            "exception",
                            f"{where} is a {what} that {part} does not have (the tag is stale: it was taken from another "
                            f"shape, or from {part} before it was changed); {part} has {count[what]} {what}s",
                        )
                    if number not in indices[what + "s"]:
                        indices[what + "s"].append(number)
                tagged[tag] = {side: numbers for side, numbers in indices.items() if numbers}
            if tagged:
                found[(layout, part)] = tagged
    return found


def _checks(module: ModuleType, scene: dict[str, dict[str, Any]], groups: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The model's ``checks(p)``: declarations in torno's vocabulary (``modelchecks``), read only under the
    ``Params`` convention; ``[]`` without it. Only their shape and the names they use are checked here: a
    malformed one fails the build, saying how. Measuring them is the worker's, once the build is tessellated."""
    function = getattr(module, "checks", None)
    if not callable(function) or not hasattr(module, "Params"):
        return []
    from . import modelchecks

    try:
        return modelchecks.validate(function(_params(module)), scene, groups)
    except modelchecks.Malformed as e:
        raise LoadError("exception", str(e)) from e


def read_params(module: ModuleType, path: Path, applied: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """The fields of the model's ``Params`` dataclass, in their order. Empty when it has none.

    Each is ``name``; ``type`` as written in the source (else as Python names
    it); ``default``, the value ``Params()`` holds, when it is a plain value
    JSON can say (a number, a string, a bool, None, or lists and dicts of
    them), else null; ``value``, what the build used (``default`` unless an
    override in ``applied`` was applied); ``literal``, whether the default in
    the source is a literal (``2.5``, ``-2``, ``"tray"``, ``None``), not an
    expression nor a ``default_factory``; ``editable``, what an override may
    be (``"float"``, ``"int"``, ``"bool"`` or ``"choice"``, else null);
    ``choices`` (a ``Literal``'s values, else null); ``metadata``, the plain
    numbers ``min``, ``max`` and ``step`` the field's own ``metadata`` gives
    (``{}`` without); and ``doc``, the comment at the end of the field's
    line, else the comment lines right above it, else a string right below
    it, else null. Reading it never fails a build: what cannot be read is
    left out.
    """
    try:
        import dataclasses

        params = getattr(module, "Params", None)
        if not (isinstance(params, type) and dataclasses.is_dataclass(params)):
            return []
        try:
            made = params()
        except Exception:
            made = None
        written = _written_fields(path)
        told = []
        for field in dataclasses.fields(params):
            if not field.init:
                continue
            source = written.get(field.name, {})
            value = getattr(made, field.name, None) if made is not None else None
            editable, choices = _offered(field, source, value)
            used = (applied or {}).get(field.name, value)
            told.append(
                {
                    "name": field.name,
                    "type": source.get("type") or _type_name(field.type),
                    "default": value if _plain(value) else None,
                    "value": used if _plain(used) else None,
                    "literal": bool(source.get("literal", False)),
                    "editable": editable,
                    "choices": choices,
                    "metadata": _range(field),
                    "doc": source.get("doc"),
                }
            )
        return told
    except Exception:
        return []


def _offered(field: Any, source: dict[str, Any], default: Any) -> tuple[str | None, list[Any] | None]:
    """What an override of this field may be, and the values of a ``Literal``: only a field whose default is a
    literal int, float or bool, or a ``Literal`` of strings, ints or bools with a default among them."""
    if not source.get("literal") or default is None:
        return None, None
    if isinstance(default, bool):
        return "bool", None
    if isinstance(default, (int, float)):
        if isinstance(default, float) and not math.isfinite(default):
            return None, None
        if source.get("choices") is None:
            # As annotated: `width: float = 40` takes 40.5.
            if source.get("type") in ("int", "float"):
                return source["type"], None
            return ("int" if isinstance(default, int) else "float"), None
    choices = source.get("choices")
    if choices and default in choices:
        return "choice", choices
    return None, None


def _range(field: Any) -> dict[str, float]:
    """The ``min``, ``max`` and ``step`` the field's own ``metadata`` gives, when they are plain numbers."""
    told: dict[str, float] = {}
    for key in ("min", "max", "step"):
        value = field.metadata.get(key)
        if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
            told[key] = value
    return told


def apply_overrides(module: ModuleType, path: Path, overrides: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, str]]]:
    """Which of ``overrides`` (field → value) the model's ``Params`` takes: ``(applied, dropped)``.

    A field is taken only when it is offered (``read_params``'s ``editable``) and the value is of its type: a
    bool for a bool, a whole number for an int, a number for a float (a whole one is made a float), one of its
    values for a ``Literal``. A range in the field's metadata is the window's to keep, not enforced here. Anything
    else is dropped, with ``name`` and ``reason`` naming the type that was wanted. An override equal to the default
    is applied all the same: it changes nothing.
    """
    if not overrides:
        return {}, []
    fields = {f["name"]: f for f in read_params(module, path)}
    applied: dict[str, Any] = {}
    dropped: list[dict[str, str]] = []
    for name, value in overrides.items():
        field = fields.get(name)
        if field is None:
            dropped.append({"name": name, "reason": "the model's Params has no such field"})
            continue
        kind = field["editable"]
        if kind is None:
            dropped.append(
                {"name": name, "reason": f"{name}: {field['type']} is not offered; only a number, a bool or a Literal with a literal default is"}
            )
        elif kind == "bool":
            if isinstance(value, bool):
                applied[name] = value
            else:
                dropped.append({"name": name, "reason": f"{name} is a bool; {value!r} is not"})
        elif kind == "int":
            if isinstance(value, int) and not isinstance(value, bool):
                applied[name] = value
            elif isinstance(value, float) and math.isfinite(value) and value == int(value):
                applied[name] = int(value)
            else:
                dropped.append({"name": name, "reason": f"{name} is an int; {value!r} is not a whole number"})
        elif kind == "float":
            if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                applied[name] = float(value)
            else:
                dropped.append({"name": name, "reason": f"{name} is a float; {value!r} is not a finite number"})
        else:
            if any(value == c and type(value) is type(c) for c in field["choices"]):
                applied[name] = value
            else:
                dropped.append({"name": name, "reason": f"{name} is one of {field['choices']!r}; {value!r} is not"})
    return applied, dropped


def _type_name(type: Any) -> str:
    return type if isinstance(type, str) else getattr(type, "__name__", None) or repr(type)


def _plain(value: Any, depth: int = 0) -> bool:
    """Whether JSON says ``value`` as it is: a NaN or an infinity it cannot."""
    if depth > 8:
        return False
    if value is None or isinstance(value, (bool, int, str)):
        return not isinstance(value, int) or isinstance(value, bool) or abs(value) < 2**63
    if isinstance(value, float):
        return math.isfinite(value)
    if isinstance(value, (list, tuple)):
        return len(value) <= 1000 and all(_plain(v, depth + 1) for v in value)
    if isinstance(value, dict):
        return len(value) <= 1000 and all(isinstance(k, str) and _plain(v, depth + 1) for k, v in value.items())
    return False


def _written_fields(path: Path) -> dict[str, dict[str, Any]]:
    """What the source says of each field of the top-level ``class Params``: type, literal, doc."""
    text = path.read_text(encoding="utf-8")
    tree = ast.parse(text)
    lines = text.splitlines()
    comments: dict[int, str] = {}
    for token in tokenize.generate_tokens(io.StringIO(text).readline):
        if token.type == tokenize.COMMENT:
            comments[token.start[0]] = token.string.lstrip("#").strip()
    found: dict[str, dict[str, Any]] = {}
    for node in tree.body:
        if not (isinstance(node, ast.ClassDef) and node.name == "Params"):
            continue
        body = node.body
        for i, statement in enumerate(body):
            if not (isinstance(statement, ast.AnnAssign) and isinstance(statement.target, ast.Name)):
                continue
            following = body[i + 1] if i + 1 < len(body) else None
            found[statement.target.id] = {
                "type": ast.unparse(statement.annotation),
                "literal": _literal(statement.value),
                "choices": _choices(statement.annotation),
                "doc": _doc(statement, following, comments, lines),
            }
    return found


def _choices(annotation: ast.expr) -> list[Any] | None:
    """The values of a ``Literal[...]`` annotation (strings, ints, bools), else None."""
    if not isinstance(annotation, ast.Subscript):
        return None
    name = getattr(annotation.value, "id", getattr(annotation.value, "attr", None))
    if name != "Literal":
        return None
    inner = annotation.slice
    items = inner.elts if isinstance(inner, ast.Tuple) else [inner]
    try:
        values = [ast.literal_eval(item) for item in items]
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return None
    if not values or not all(isinstance(v, (str, int)) for v in values):
        return None
    return values


def _literal(value: ast.expr | None) -> bool:
    if value is None:
        return False
    if isinstance(value, ast.Call) and getattr(value.func, "id", getattr(value.func, "attr", None)) == "field":
        given = {k.arg: k.value for k in value.keywords}
        return "default" in given and _literal(given["default"])
    try:
        ast.literal_eval(value)
    except (ValueError, TypeError, SyntaxError, MemoryError, RecursionError):
        return False
    return True


def _doc(statement: ast.stmt, following: ast.stmt | None, comments: dict[int, str], lines: list[str]) -> str | None:
    end = statement.end_lineno or statement.lineno
    if comments.get(end):
        return comments[end]
    above = []
    line = statement.lineno - 1
    while line >= 1 and lines[line - 1].strip().startswith("#"):
        above.insert(0, comments.get(line, ""))
        line -= 1
    said = " ".join(part for part in above if part)
    if said:
        return said
    if (
        isinstance(following, ast.Expr)
        and isinstance(following.value, ast.Constant)
        and isinstance(following.value.value, str)
    ):
        return inspect.cleandoc(following.value.value) or None
    return None


def _is_candidate(name: str) -> bool:
    return not (name.startswith(".") or name == "__init__.py" or _is_test_file(name))


def _same_name(a: str, b: str) -> bool:
    return a.replace("-", "_") == b.replace("-", "_")


def _is_test_file(name: str) -> bool:
    return name.startswith("test_") or name.endswith("_test.py") or name == "conftest.py"


def _import_model(path: Path) -> ModuleType:
    """Import the file as a module, so its ``__main__`` block does not run."""
    sys.path.insert(0, str(path.parent))
    name = f"torno_model_{path.stem}"
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module  # dataclasses look the module up while it executes
    spec.loader.exec_module(module)
    return module


def _collect_scene(module: ModuleType) -> dict[str, dict[str, Any]]:
    """The model's layouts, by the first convention it follows.

    ``Params`` with ``assembly(p)`` or ``printables(p)``; else ``Params`` with
    ``make_<part>(p)`` functions, as the layout ``main``; else its top-level
    shapes, as ``main`` too.
    """
    print_function = next((f for f in _PRINT_FUNCTIONS if hasattr(module, f)), None)
    has_assembly = hasattr(module, "assembly")
    layouts: dict[str, dict[str, Any]] = {}
    if hasattr(module, "Params") and (has_assembly or print_function):
        params = _params(module)
        if has_assembly:
            layouts["assembly"] = _parts(module.assembly(params), "assembly")
        if print_function:
            layouts["print"] = _parts(getattr(module, print_function)(params), print_function)
    else:
        if hasattr(module, "Params"):
            layouts["main"] = _made_parts(module)
        if not layouts.get("main"):
            layouts["main"] = _top_level_shapes(module)
    return {layout: parts for layout, parts in layouts.items() if parts}


def _makers(module: ModuleType) -> dict[str, Any]:
    """The model's own ``make_<part>`` functions that take the parameters alone, by part name."""
    makers = {}
    for name, value in vars(module).items():
        if not name.startswith(_MAKER_PREFIX) or name == _MAKER_PREFIX:
            continue
        # Its own: a maker imported from a library is a tool of the model, not a part of it.
        if not inspect.isfunction(value) or value.__module__ != module.__name__:
            continue
        if _takes_one_argument(value):
            makers[name.removeprefix(_MAKER_PREFIX)] = value
    return makers


def _takes_one_argument(function: Any) -> bool:
    """Whether ``function(p)`` is a complete call: one required parameter, a positional one."""
    try:
        parameters = inspect.signature(function).parameters.values()
    except (TypeError, ValueError):
        return False
    required = [
        p
        for p in parameters
        if p.default is p.empty and p.kind not in (p.VAR_POSITIONAL, p.VAR_KEYWORD)
    ]
    return len(required) == 1 and required[0].kind is not required[0].KEYWORD_ONLY


def _made_parts(module: ModuleType) -> dict[str, Any]:
    """Call every maker with ``Params()`` and keep what comes back as a solid shape."""
    makers = _makers(module)
    if not makers:
        return {}
    params = _params(module)
    made = {name: maker(params) for name, maker in makers.items()}
    return {name: value for name, value in made.items() if _is_solid_shape(value)}


def _no_scene(module: ModuleType, model: str) -> str:
    """Say what was looked for, and what stood in the way of what was found."""
    found = [f"{name}(p)" for name in ("assembly", *_PRINT_FUNCTIONS) if hasattr(module, name)]
    found += [f"{_MAKER_PREFIX}{name}(p)" for name in _makers(module)]
    if found and not hasattr(module, "Params"):
        them = "it" if len(found) == 1 else "them"
        return (
            f"{model} defines {_and(found)} but no Params class to call {them} with, "
            "and no top-level shapes"
        )
    return f"{model} defines no assembly(p), printables(p), make_<part>(p) or top-level shapes"


def _and(names: list[str]) -> str:
    return names[0] if len(names) == 1 else f"{', '.join(names[:-1])} and {names[-1]}"


def _parts(result: Any, function: str) -> dict[str, Any]:
    if not isinstance(result, dict):
        raise LoadError(
            "exception",
            f"{function}() must return a dict of name to shape, got {type(result).__name__}",
        )
    return dict(result)


def _top_level_shapes(module: ModuleType) -> dict[str, Any]:
    return {
        name: value
        for name, value in vars(module).items()
        if not name.startswith("_") and _is_solid_shape(value)
    }


def _is_solid_shape(value: Any) -> bool:
    # build123d comes from the user's workspace, so it is imported only here.
    from build123d import Shape

    return isinstance(value, Shape) and bool(value.solids())


def _model_traceback(e: BaseException, path: Path) -> str:
    """Format the traceback from the first frame in the model file onward."""
    tb: TracebackType | None = e.__traceback__
    while tb is not None and Path(tb.tb_frame.f_code.co_filename) != path:
        tb = tb.tb_next
    return "".join(tb_module.format_exception(type(e), e, tb))
