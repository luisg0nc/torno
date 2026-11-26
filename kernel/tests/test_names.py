"""Where a part's name is written in the model, for a rename by hand (``names.part_sites``): read only."""

import hashlib
import sys

import pytest

from torno_kernel import names, queries
from torno_kernel.loader import _import_model, load_model
from torno_kernel.tess import build_scene

MODEL = '''
from dataclasses import dataclass
from build123d import Box, Pos

@dataclass(frozen=True)
class Params:
    wall: float = 2.0

def _shell(p):
    return Box(40, 30, 20)

def assembly(p):
    return {"shell": _shell(p), 'lid': Pos(0, 0, 15) * Box(40, 30, 3)}

def printables(p):
    parts = {"lid": Box(40, 30, 3)}
    parts["shell"] = _shell(p)
    return parts

def groups(p):
    return {"case": ["shell", "lid"]}

def tags(p, parts):
    if "shell" in parts:
        return {"shell": {"top": parts["shell"].faces()[-1]}}
    return {}

def checks(p):
    return [dict(name="fits", kind="clearance", a="shell", b="lid", min=0.0)]
'''

MAKERS = '''
from dataclasses import dataclass
from build123d import Box

@dataclass(frozen=True)
class Params:
    wall: float = 2.0

def make_shell(p):
    return Box(40, 30, 20)

def make_lid(p):
    return Box(40, 30, 3)

def groups(p):
    return {"case": ["shell", "lid"]}

def _both(p):
    return make_shell(p), make_lid(p)
'''


@pytest.fixture(autouse=True)
def no_bytecode(monkeypatch):
    monkeypatch.setattr(sys, "dont_write_bytecode", True)


def project(tmp_path, source, name="box", model="box.py", extra=None):
    folder = tmp_path / name
    folder.mkdir()
    (folder / model).write_text(source)
    for file, text in (extra or {}).items():
        path = tmp_path / file
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(text)
    return folder


def sites(folder, part, to, model="box.py", uses=()):
    layouts, *_ = load_model(folder, model)
    module = _import_model((folder / model).resolve())
    parts = {name for layout in layouts.values() for name in layout}
    return names.part_sites(folder, model, module, part, to, parts, list(uses))


def apply(folder, answer):
    root = folder.parent
    by_file: dict[str, list] = {}
    for s in answer["sites"]:
        by_file.setdefault(s["file"], []).append(s)
    for file, found in by_file.items():
        data = (root / file).read_bytes()
        assert hashlib.sha256(data).hexdigest() == answer["files"][file]
        for s in sorted(found, key=lambda s: -s["start"]):
            assert data[s["start"] : s["end"]].decode() == s["old"]
            data = data[: s["start"]] + s["new"].encode() + data[s["end"] :]
        (root / file).write_bytes(data)


def test_every_plain_literal_of_the_part_in_the_contract_is_a_site(tmp_path):
    folder = project(tmp_path, MODEL)
    answer = sites(folder, "shell", "front case")
    assert "refused" not in answer, answer
    assert {s["file"] for s in answer["sites"]} == {"box/box.py"}
    assert all(s["old"] == '"shell"' and s["new"] == '"front case"' for s in answer["sites"])
    # assembly, printables' subscript, groups, tags (in, key, index), checks' keyword.
    assert len(answer["sites"]) == 7
    apply(folder, answer)
    layouts, _, groups, declared = load_model(folder, "box.py")
    assert set(layouts["assembly"]) == {"front case", "lid"}
    assert set(layouts["print"]) == {"front case", "lid"}
    assert groups == [{"name": "case", "parts": ["front case", "lid"]}]
    assert layouts.tags[("assembly", "front case")]["top"]["faces"]
    assert declared[0]["a"] == "front case"


def test_the_quotes_of_the_model_are_kept_and_a_name_that_needs_others_gets_them(tmp_path):
    folder = project(tmp_path, MODEL)
    lid = sites(folder, "lid", "cover")
    assert [s["new"] for s in lid["sites"] if s["old"] == "'lid'"] == ["'cover'"]
    quoted = sites(folder, "shell", 'the "case"')
    assert all(s["new"] == "'the \"case\"'" for s in quoted["sites"])
    apply(folder, quoted)
    layouts, *_ = load_model(folder, "box.py")
    assert 'the "case"' in layouts["assembly"]


def test_a_utf8_line_before_a_site_does_not_shift_its_span(tmp_path):
    folder = project(tmp_path, MODEL.replace("def _shell(p):", "# peça à medida\ndef _shell(p):").replace('{"shell": _shell(p)', '{"ção": 1} and {"shell": _shell(p)'))
    answer = sites(folder, "shell", "caixa")
    apply(folder, answer)
    layouts, *_ = load_model(folder, "box.py")
    assert "caixa" in layouts["assembly"]


def test_a_name_built_from_a_variable_is_refused(tmp_path):
    source = MODEL.replace('return {"shell": _shell(p), \'lid\'', 'NAME = "shell"\n    return {NAME: _shell(p), \'lid\'')
    answer = sites(project(tmp_path, source), "shell", "case")
    assert "refused" in answer
    assert "line" in answer["refused"]


def test_a_name_from_an_fstring_is_refused(tmp_path):
    source = MODEL.replace('return {"shell": _shell(p), \'lid\'', 'return {f"sh{\'ell\'}": _shell(p), \'lid\'').replace("groups(p):\n    return {\"case\": [\"shell\", \"lid\"]}", "groups(p):\n    return {}").replace('if "shell" in parts:\n        return {"shell": {"top": parts["shell"].faces()[-1]}}\n', "").replace('a="shell"', 'a="lid"')
    answer = sites(project(tmp_path, source), "shell", "case")
    assert "refused" in answer


def test_the_name_written_anywhere_else_is_refused_naming_where(tmp_path):
    source = MODEL + '\nLABEL = "shell"\n'
    answer = sites(project(tmp_path, source), "shell", "case")
    assert "box/box.py line" in answer["refused"]
    # Passed to a call inside the contract: a label of the model's, perhaps, not plainly the part.
    source = MODEL.replace("return {\"shell\": _shell(p), 'lid'", "print(\"shell\")\n    return {\"shell\": _shell(p), 'lid'")
    assert "refused" in sites(project(tmp_path, source, name="two", model="two.py"), "shell", "case", model="two.py")


def test_the_name_in_common_or_in_another_file_of_the_project_is_refused(tmp_path):
    folder = project(tmp_path, MODEL, extra={"common/colours.py": 'COLOURS = {"shell": "red"}\n'})
    answer = sites(folder, "shell", "case", uses=["common/colours.py"])
    assert "another folder" in answer["refused"]
    folder = project(tmp_path, MODEL, name="b", model="b.py", extra={"b/helpers.py": 'WHICH = "shell"\n'})
    assert "b/helpers.py line 1" in sites(folder, "shell", "case", model="b.py")["refused"]


def test_a_ref_that_names_the_part_is_refused(tmp_path):
    source = MODEL + '\nTOP = "shell/@top"\n'
    assert "part of a ref" in sites(project(tmp_path, source), "shell", "case")["refused"]


def test_a_name_that_is_taken_or_unknown_is_refused(tmp_path):
    folder = project(tmp_path, MODEL)
    assert "already the name of a part" in sites(folder, "shell", "lid")["refused"]
    assert "not a part" in sites(folder, "nope", "x")["refused"]


def test_a_model_of_makers_renames_the_function_and_its_uses(tmp_path):
    folder = project(tmp_path, MAKERS)
    answer = sites(folder, "shell", "front_case")
    assert "refused" not in answer, answer
    olds = sorted(s["old"] for s in answer["sites"])
    assert olds == ['"shell"', "make_shell", "make_shell"]
    apply(folder, answer)
    layouts, _, groups, _ = load_model(folder, "box.py")
    assert set(layouts["main"]) == {"front_case", "lid"}
    assert groups[0]["parts"] == ["front_case", "lid"]


def test_a_model_of_makers_takes_a_python_name_only(tmp_path):
    folder = project(tmp_path, MAKERS)
    assert "Python name" in sites(folder, "shell", "front case")["refused"]
    source = MAKERS + "\ndef make_cover():\n    return None\n"
    assert "already a name" in sites(project(tmp_path, source, name="c", model="c.py"), "shell", "cover", model="c.py")["refused"]


def test_top_level_shapes_are_refused(tmp_path):
    folder = project(tmp_path, "from build123d import Box\nshell = Box(1, 1, 1)\n")
    assert "variable" in sites(folder, "shell", "case")["refused"]


def test_the_worker_answers_of_the_files_its_build_was_made_from(tmp_path):
    folder = project(tmp_path, MODEL)
    layouts, *_ = load_model(folder, "box.py")
    kept: dict = {}
    _, _, shapes = build_scene(layouts, "box.py", kept)
    kept["source",] = {"dir": str(folder), "model": "box.py", "uses": []}
    sys.modules["torno_model_box"] = _import_model((folder / "box.py").resolve())
    answer = queries.run(shapes, "part_sites", {"part": "shell", "to": "body"}, kept)
    assert len(answer["sites"]) == 7
    assert "Build again" in queries.run(shapes, "part_sites", {"part": "shell", "to": "case"}, {})["refused"]
    with pytest.raises(queries.QueryError):
        queries.run(shapes, "part_sites", {"part": "shell"}, kept)



def test_an_fstring_that_cannot_make_the_name_is_no_reason_to_refuse(tmp_path):
    source = MODEL.replace("return {\"shell\": _shell(p), 'lid'", "legs = {f\"leg{i}\": Box(1, 1, 1) for i in range(2)}\n    return {**legs, \"shell\": _shell(p), 'lid'")
    answer = sites(project(tmp_path, source), "shell", "body")
    assert len(answer["sites"]) == 7
    assert "refused" in sites(project(tmp_path, source, name="l", model="l.py"), "leg0", "foot", model="l.py")


def test_a_name_the_model_already_writes_for_a_part_is_refused_though_the_build_has_no_such_part(tmp_path):
    folder = project(tmp_path, MODEL)
    layouts, *_ = load_model(folder, "box.py")
    module = _import_model((folder / "box.py").resolve())
    parts = {name for layout in layouts.values() for name in layout}
    # Saved since the build: a part "case" the build does not know yet.
    (folder / "box.py").write_text(MODEL.replace("'lid': Pos", "\"body\": Box(1, 1, 1), 'lid': Pos"))
    answer = names.part_sites(folder, "box.py", module, "shell", "body", parts, [])
    assert "body is already written in box/box.py line" in answer["refused"]


def test_a_keyword_of_a_call_is_a_word_of_the_model_and_only_dict_keywords_name_a_part(tmp_path):
    source = MODEL.replace("def assembly(p):", "def _label(txt):\n    return txt\n\ndef assembly(p):").replace("return {\"shell\": _shell(p), 'lid'", "label = _label(txt=\"shell\")\n    return {\"shell\": _shell(p), 'lid'")
    answer = sites(project(tmp_path, source), "shell", "case")
    assert "box/box.py line" in answer["refused"]
    # dict(a="shell") in checks(p) is the part, as before.
    assert any(s["line"] == 29 for s in sites(project(tmp_path, MODEL, name="d", model="d.py"), "shell", "body", model="d.py")["sites"])
