"""Where a part's name is written in the model, for a rename the person asked for (``part_sites``).

Read only: the kernel never writes a file. It reads the project's own ``.py`` files (and the ones the build
imported from elsewhere in the workspace, ``uses``) by the AST and answers with each place the name is written as
a plain string literal (or, for a model of ``make_<part>`` functions, the function's name and every use of it),
with the exact span in bytes, the text there and the text to put in its place. Main checks the bytes again and
writes them. A name that is not written plainly, or is written somewhere that is not plainly that part, is refused
with a sentence, and nothing is answered of where it is.
"""

import ast
import hashlib
import io
import keyword
import re
import sys
import tokenize
from pathlib import Path
from typing import Any

from .loader import _MAKER_PREFIX, _PRINT_FUNCTIONS

# The functions of the model's contract that name parts by their keys: what a literal inside them says is the part.
_DEFINES = ("assembly", *_PRINT_FUNCTIONS, "references")
_NAMES = (*_DEFINES, "groups", "tags", "checks")
# Folders whose files are never the model's.
_NOT_OWN = {".venv", "venv", "site-packages", "__pycache__", "node_modules", ".git", ".torno"}
# What is read at most: a project is a few files.
MOST_FILES = 200
MOST_FILE_BYTES = 1024 * 1024
_MARK_ID = re.compile(r"M\d+")


class Refused(Exception):
    """Why the name cannot be renamed here, in a sentence for the person."""


def part_sites(dir: Path, model: str, module: Any, part: str, to: str, parts: set[str], uses: list[str]) -> dict[str, Any]:
    """Where ``part`` is written in the model, and what to write there to name it ``to``; or ``refused``.

    ``dir`` is the project's folder, ``model`` its model file, ``module`` the model as the build loaded it (which
    convention it follows), ``parts`` the names of every part and reference of the build, ``uses`` the files it
    imported from elsewhere in the workspace (from the workspace, with ``/``). The answer is ``sites`` (``file``
    from the workspace with ``/``, ``line``, ``start`` and ``end`` in bytes, ``old`` and ``new`` text) and ``files``,
    the SHA-256 of each file named as it was read.
    """
    try:
        return _sites(Path(dir), model, module, part, to, parts, uses)
    except Refused as e:
        return {"refused": str(e)}


def _sites(dir: Path, model: str, module: Any, part: str, to: str, parts: set[str], uses: list[str]) -> dict[str, Any]:
    if part not in parts:
        raise Refused(f"{part} is not a part of the last build.")
    if to in parts:
        raise Refused(f"{to} is already the name of a part.")
    params = hasattr(module, "Params")
    defines = params and (hasattr(module, "assembly") or any(hasattr(module, f) for f in _PRINT_FUNCTIONS))
    makers = params and not defines and callable(getattr(module, _MAKER_PREFIX + part, None))
    if not defines and not makers:
        raise Refused(f"{part} is a shape the model leaves at the top of its file, not a part it names: rename its variable in the model.")
    if makers and not (to.isidentifier() and not keyword.iskeyword(to)):
        raise Refused(f"This model names its parts by its {_MAKER_PREFIX}<part> functions, so the new name must be a Python name: letters, digits and _, not starting with a digit.")
    root = dir.parent
    own = _own_files(dir)
    model_file = (dir / model).resolve()
    read: dict[Path, bytes] = {}
    for path in [*own, *(root / u for u in uses)]:
        if path in read:
            continue
        try:
            if path.stat().st_size > MOST_FILE_BYTES:
                raise Refused(f"{_name(root, path)} is too large to read for a rename.")
            read[path] = path.read_bytes()
        except OSError as e:
            raise Refused(f"{_name(root, path)} cannot be read: {e.strerror or e}.") from e
    sites: list[dict[str, Any]] = []
    defined = False
    for path, source in read.items():
        try:
            tree = ast.parse(source, filename=str(path))
        except (SyntaxError, ValueError) as e:
            raise Refused(f"{_name(root, path)} does not parse as Python, so where {part} is named cannot be told.") from e
        is_model = path == model_file
        is_own = path in own
        found = _find(tree, part, makers, is_model)
        for kind, node, where in found:
            at = f"{_name(root, path)} line {node.lineno}"
            if kind == "fstring":
                raise Refused(f"{part} is written inside an f-string at {at}: rename it in the model by hand, or ask Claude.")
            if kind == "ref":
                raise Refused(f"{part} is written as part of a ref at {at}: rename it in the model by hand, or ask Claude.")
            if kind == "attribute":
                raise Refused(f"{_MAKER_PREFIX}{part} is used as an attribute at {at}: rename it in the model by hand, or ask Claude.")
            if kind == "other" or not is_own:
                place = "in a file of another folder" if not is_own else f"outside {_and_or(_NAMES)}"
                raise Refused(f"{part} is also written at {at}, {place}, where it may not be this part. Rename it in the model by hand, or ask Claude.")
            if where in _DEFINES or kind == "def":
                defined = True
            sites.append(_site(root, path, source, node, kind, part, to))
    if not defined:
        if makers:
            raise Refused(f"{_MAKER_PREFIX}{part} is not defined in {model}, so torno cannot rename it.")
        raise Refused(f"{part} is not written as a plain name in {_and_or(_DEFINES)} of {model}: it is built from a variable or comes from another file. Rename it in the model by hand, or ask Claude.")
    if makers:
        taken = _MAKER_PREFIX + to
        if any(_defines_name(ast.parse(source), taken) for path, source in read.items() if path in own):
            raise Refused(f"{taken} is already a name in the model.")
    sites.sort(key=lambda s: (s["file"], s["start"]))
    files = {_name(root, path): hashlib.sha256(source).hexdigest() for path, source in read.items() if any(s["file"] == _name(root, path) for s in sites)}
    return {"sites": sites, "files": files}


def _own_files(dir: Path) -> list[Path]:
    """The ``.py`` files of the project's own folder, none of a hidden folder or an environment, resolved."""
    found: list[Path] = []
    for path in sorted(dir.rglob("*.py")):
        relative = path.relative_to(dir)
        if any(p.startswith(".") or p in _NOT_OWN for p in relative.parts) or path.is_symlink() or not path.is_file():
            continue
        found.append(path.resolve())
        if len(found) > MOST_FILES:
            raise Refused(f"The project has more than {MOST_FILES} Python files, too many to read for a rename.")
    return found


def _name(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def _and_or(names: tuple[str, ...]) -> str:
    said = [f"{n}(p)" for n in dict.fromkeys(names)]
    return said[0] if len(said) == 1 else f"{', '.join(said[:-1])} or {said[-1]}"


def _find(tree: ast.AST, part: str, makers: bool, is_model: bool) -> list[tuple[str, ast.AST, str | None]]:
    """Each place the name is written: ``(kind, node, the contract function it is in)``. ``kind`` is ``literal``
    (a string that is the name, inside a function of the contract), ``other`` (that string anywhere else),
    ``fstring``, ``ref`` (``part/...`` or ``layout:part``), ``def`` and ``name`` (a model of makers: the function
    and a use of it) or ``attribute`` (``x.make_part``)."""
    maker = _MAKER_PREFIX + part
    found: list[tuple[str, ast.AST, str | None]] = []
    in_fstring: set[int] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.JoinedStr):
            in_fstring.update(id(v) for v in node.values)
            for v in node.values:
                if isinstance(v, ast.FormattedValue) and isinstance(v.format_spec, ast.JoinedStr):
                    in_fstring.update(id(x) for x in v.format_spec.values)
    # The literals of the contract's functions that stand where a part's name stands: a key or a value of a dict, an
    # index, an item of a list, a side of a comparison, a keyword's value. One passed to a call or kept in a variable may be
    # a label or a word of the model's, not the part.
    contract: dict[int, str] = {}
    if is_model and isinstance(tree, ast.Module):
        for statement in tree.body:
            if isinstance(statement, (ast.FunctionDef, ast.AsyncFunctionDef)) and statement.name in _NAMES:
                for parent in ast.walk(statement):
                    for child in _name_places(parent):
                        contract.setdefault(id(child), statement.name)
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            text = node.value
            if text == part:
                kind = "fstring" if id(node) in in_fstring else ("literal" if id(node) in contract else "other")
                found.append((kind, node, contract.get(id(node))))
            elif text.startswith(part + "/") or text.endswith(":" + part) or (":" + part + "/") in text:
                found.append(("ref", node, None))
            elif makers and text == maker:
                found.append(("other", node, None))
            elif id(node) in in_fstring and part in text:
                found.append(("fstring", node, None))
        elif isinstance(node, ast.JoinedStr) and id(node) in contract and _may_make(node, part):
            # An f-string where a part's name stands, that may make this one: where else it is named cannot be told.
            found.append(("fstring", node, None))
        elif makers and isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and node.name == maker:
            found.append(("def" if is_model and node in getattr(tree, "body", []) else "other", node, None))
        elif makers and isinstance(node, ast.Name) and node.id == maker:
            found.append(("name", node, None))
        elif makers and isinstance(node, ast.Attribute) and node.attr == maker:
            found.append(("attribute", node, None))
        elif makers and isinstance(node, ast.alias) and maker in (node.name, node.asname):
            found.append(("other", node, None))
    return found


def _may_make(node: ast.JoinedStr, part: str) -> bool:
    """Whether the f-string could give ``part``: its plain pieces in order, anything where it has a value."""
    pattern = "".join(re.escape(v.value) if isinstance(v, ast.Constant) else ".*" for v in node.values)
    return re.fullmatch(pattern, part, re.DOTALL) is not None


def _name_places(node: ast.AST) -> list[ast.AST]:
    """The children of ``node`` that stand where a part's name may: what a literal there says is the part."""
    if isinstance(node, ast.Dict):
        return [n for n in (*node.keys, *node.values) if n is not None]
    if isinstance(node, ast.Subscript):
        return [node.slice]
    if isinstance(node, ast.Compare):
        return [node.left, *node.comparators]
    if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
        return list(node.elts)
    if isinstance(node, ast.keyword):
        return [node.value]
    if isinstance(node, ast.DictComp):
        return [node.key, node.value]
    return []


def _defines_name(tree: ast.AST, name: str) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)) and node.name == name:
            return True
        if isinstance(node, ast.Name) and node.id == name:
            return True
        if isinstance(node, ast.alias) and name in (node.name, node.asname):
            return True
    return False


def _line_starts(source: bytes) -> list[int]:
    """The byte at which each line begins, as Python counts lines (``\\n``, ``\\r\\n`` and a lone ``\\r`` end one)."""
    starts = [0]
    i, n = 0, len(source)
    while i < n:
        c = source[i]
        if c == 0x0A or (c == 0x0D and (i + 1 >= n or source[i + 1] != 0x0A)):
            starts.append(i + 1)
        i += 1
    return starts


def _site(root: Path, path: Path, source: bytes, node: Any, kind: str, part: str, to: str) -> dict[str, Any]:
    starts = _line_starts(source)
    bom = 3 if source.startswith(b"\xef\xbb\xbf") else 0

    def offset(line: int, col: int) -> int:
        return starts[line - 1] + col + (bom if line == 1 else 0)

    file = _name(root, path)
    if kind == "def":
        start, end = _def_name_span(source, node, starts, bom)
        old = source[start:end].decode("utf-8")
        new = _MAKER_PREFIX + to
        if old != _MAKER_PREFIX + part:
            raise Refused(f"Where {old} is defined in {file} cannot be placed exactly.")
    else:
        start, end = offset(node.lineno, node.col_offset), offset(node.end_lineno, node.end_col_offset)
        old = source[start:end].decode("utf-8", errors="replace")
        if kind == "name":
            new = _MAKER_PREFIX + to
            ok = old == _MAKER_PREFIX + part
        else:
            new = _literal(old, part, to)
            ok = _evaluates_to(old, part) and _evaluates_to(new, to)
        if not ok:
            raise Refused(f"Where {part} is written in {file} line {node.lineno} cannot be placed exactly.")
    return {"file": file, "line": node.lineno, "start": start, "end": end, "old": old, "new": new}


def _def_name_span(source: bytes, node: Any, starts: list[int], bom: int) -> tuple[int, int]:
    """The bytes of the name of a ``def``, found by the tokens from its line on (decorators come before it)."""
    line = node.lineno
    text = source[starts[line - 1] :].decode("utf-8", errors="replace")
    tokens = tokenize.generate_tokens(io.StringIO(text).readline)
    after_def = False
    for token in tokens:
        if token.type == tokenize.NAME and token.string == "def":
            after_def = True
        elif after_def and token.type == tokenize.NAME:
            (row, col), (_, end_col) = token.start, token.end
            line_text = text.splitlines(keepends=True)[row - 1]
            begin = starts[line - 1 + row - 1] + len(line_text[:col].encode("utf-8")) + (bom if line + row - 1 == 1 else 0)
            return begin, begin + len(token.string.encode("utf-8"))
    raise Refused("Where a function is defined cannot be placed exactly.")


def _literal(old: str, part: str, to: str) -> str:
    """The literal to write for ``to``: in the old one's quotes when it was a plain one and ``to`` fits in them, else Python's own."""
    for quote in ('"', "'"):
        if old == f"{quote}{part}{quote}" and quote not in to and "\\" not in to and not any(ord(c) < 32 for c in to):
            return f"{quote}{to}{quote}"
    return repr(to)


def _evaluates_to(text: str, value: str) -> bool:
    try:
        return ast.literal_eval(text) == value
    except (ValueError, SyntaxError, TypeError, MemoryError, RecursionError):
        return False


def query(shapes: dict[str, Any], args: dict[str, Any], kept: dict[Any, Any] | None) -> dict[str, Any]:
    """The query ``part_sites`` (``part``, ``to``), over the build this worker holds."""
    part, to = args.get("part"), args.get("to")
    if not isinstance(part, str) or not isinstance(to, str) or not part or not to:
        from .queries import QueryError

        raise QueryError("bad_request", "part_sites needs args.part and args.to, strings")
    source = (kept or {}).get(("source",))
    if not isinstance(source, dict):
        return {"refused": "The build does not say which files it was made from. Build again, then rename."}
    module = sys.modules.get(f"torno_model_{Path(source['model']).stem}")
    if module is None:
        return {"refused": "The model is not loaded in this build. Build again, then rename."}
    parts = {key.split(":", 1)[1] for key in shapes if ":" in key}
    return part_sites(Path(source["dir"]), source["model"], module, part, to, parts, list(source.get("uses", [])))
