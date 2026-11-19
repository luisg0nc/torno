"""Bought parts in a model: ``references(p)``, read by the loader and left out of what is made."""

import re
import sys

import pytest

from torno_kernel import checks, export, measure, modelchecks, queries
from torno_kernel.loader import LoadError, load_model
from torno_kernel.tess import build_scene

# A housing with a bore for a 608 bearing (8 x 22 x 7), the bearing as a reference, and a plate to print.
MODEL = '''
from dataclasses import dataclass
from build123d import Box, Cylinder, Pos, Axis
from bd_warehouse.bearing import SingleRowDeepGrooveBallBearing

@dataclass(frozen=True)
class Params:
    bore: float = 22.2

def _bearing():
    return SingleRowDeepGrooveBallBearing(size="M8-22-7", bearing_type="SKT")

def _housing(p):
    return Box(40, 40, 7) - Cylinder(p.bore / 2, 7)

def assembly(p):
    return {"housing": _housing(p), "cap": Pos(0, 0, 10) * Box(40, 40, 3)}

def printables(p):
    return {"housing": _housing(p), "cap": Box(40, 40, 3)}

def references(p):
    return REFERENCES

def checks(p):
    return CHECKS
'''


@pytest.fixture(autouse=True)
def no_bytecode(monkeypatch):
    monkeypatch.setattr(sys, "dont_write_bytecode", True)


def write(tmp_path, references='{"608": _bearing()}', declarations="[]", source=MODEL):
    (tmp_path / "m.py").write_text(source.replace("REFERENCES", references).replace("CHECKS", declarations))
    return tmp_path


@pytest.fixture
def built(tmp_path):
    write(tmp_path)
    layouts, _, groups, declared = load_model(tmp_path, "m.py")
    kept: dict = {}
    scene, _, shapes = build_scene(layouts, "m.py", kept)
    return scene, shapes, kept, layouts


def part(scene, layout, name):
    return next(p for p in scene["parts"] if p["layout"] == layout and p["name"] == name)


def test_a_reference_stands_in_the_assembly_and_not_in_the_print_layout(built):
    scene, shapes, kept, layouts = built
    assert layouts.references == {"608"}
    assert set(layouts["assembly"]) == {"housing", "cap", "608"}
    assert set(layouts["print"]) == {"housing", "cap"}
    assert part(scene, "assembly", "608")["role"] == "reference"
    assert "role" not in part(scene, "assembly", "housing")
    assert [p["name"] for p in scene["parts"] if p["layout"] == "print"] == ["housing", "cap"]
    assert kept["reference", "assembly:608"] is True


def test_a_model_without_references_has_plain_layouts(tmp_path):
    write(tmp_path, source=MODEL.replace("def references(p):\n    return REFERENCES\n", ""))
    layouts, *_ = load_model(tmp_path, "m.py")
    assert not getattr(layouts, "references", None)
    assert set(layouts["assembly"]) == {"housing", "cap"}


def test_clearance_and_overlap_take_a_reference_as_an_obstacle(built):
    _, shapes, kept, _ = built
    # The bore (22.2) leaves 0.1 mm round the bearing's 22 mm outer ring.
    got = checks.check(shapes, {"kind": "clearance", "layout": "assembly", "a": "housing", "b": "608"}, kept)
    assert got["distance"] == pytest.approx(0.1, abs=1e-6)
    got = checks.check(shapes, {"kind": "overlap", "layout": "assembly", "a": "housing", "b": "608"}, kept)
    assert got["volume"] == pytest.approx(0, abs=1e-6)


def test_a_tight_bore_makes_the_bearing_interfere(tmp_path):
    write(tmp_path)
    (tmp_path / "m.py").write_text((tmp_path / "m.py").read_text().replace("22.2", "21.6"))
    layouts, *_ = load_model(tmp_path, "m.py")
    kept: dict = {}
    _, _, shapes = build_scene(layouts, "m.py", kept)
    got = checks.check(shapes, {"kind": "interference", "layout": "assembly"}, kept)
    assert [(p["a"], p["b"]) for p in got["interfering"]] == [("housing", "608")]
    assert got["references"] == ["608"]


def test_interference_does_not_judge_two_references_against_each_other(tmp_path):
    two = '{"608": _bearing(), "608b": _bearing()}'
    write(tmp_path, two)
    layouts, *_ = load_model(tmp_path, "m.py")
    kept: dict = {}
    _, _, shapes = build_scene(layouts, "m.py", kept)
    got = checks.check(shapes, {"kind": "interference", "layout": "assembly"}, kept)
    assert not any({p["a"], p["b"]} == {"608", "608b"} for p in got["interfering"] + got["touching"])
    # Four parts, six pairs, one of them two references.
    assert got["parts"] == 4 and got["pairs"] == 5


def test_bed_leaves_a_reference_out(built):
    _, shapes, kept, _ = built
    got = checks.check(shapes, {"kind": "bed", "layout": "assembly", "size": [50, 50, 50]}, kept)
    assert got["references"] == ["608"] and got["parts"] == ["housing", "cap"]
    # The housing's 7 mm and the cap's 3 mm 6.5 mm above it: the bearing, 22 wide and 7 high, adds to neither.
    assert got["size"] == pytest.approx([40, 40, 15], abs=1e-6)


def test_the_print_checks_refuse_a_reference(built):
    _, shapes, kept, _ = built
    for kind, extra in (("mesh", {}), ("overhang", {}), ("thin", {"min": 1})):
        with pytest.raises(queries.QueryError, match="608 is a reference"):
            checks.check(shapes, {"kind": kind, "layout": "assembly", "a": "608", **extra}, kept)


def test_mass_refuses_a_reference_and_volume_does_not(built):
    _, shapes, kept, _ = built
    with pytest.raises(queries.QueryError, match="608 is a reference"):
        measure.measure(shapes, {"kind": "mass", "a": {"ref": "assembly:608"}}, kept)
    assert measure.measure(shapes, {"kind": "volume", "a": {"ref": "assembly:608"}}, kept)["value"] > 0
    assert measure.measure(shapes, {"kind": "mass", "a": {"ref": "assembly:housing"}}, kept)["value"] > 0


def test_describe_says_a_part_is_a_reference(built):
    _, shapes, kept, _ = built
    got = queries.describe(shapes, "assembly:608", kept)
    assert got["role"] == "reference" and got["descriptor"].startswith("reference part (bought), ")
    assert "role" not in queries.describe(shapes, "assembly:housing", kept)


def test_a_mesh_file_refuses_a_reference_and_a_step_may_hold_it(built):
    _, shapes, kept, _ = built
    asked = {"layout": "assembly", "parts": ["608"], "name": "x"}
    for format in ("stl", "3mf"):
        with pytest.raises(queries.QueryError, match="608 is a reference"):
            export.export(shapes, {"format": format, **asked}, kept)
    made = export.export(shapes, {"format": "step", **asked}, kept)
    assert made.result["parts"][0]["name"] == "608"


def test_the_models_checks_name_a_reference(tmp_path):
    write(
        tmp_path,
        declarations='[{"name": "bearing fits", "kind": "clearance", "a": "housing", "b": "608", "min": 0.05, "max": 0.3}]',
    )
    layouts, _, groups, declared = load_model(tmp_path, "m.py")
    kept: dict = {}
    _, _, shapes = build_scene(layouts, "m.py", kept)
    [result] = modelchecks.run(declared, shapes, groups, kept)
    assert result["status"] == "pass" and result["layout"] == "assembly"
    assert result["value"] == pytest.approx(0.1, abs=1e-6)


def test_a_print_check_on_a_reference_is_refused_when_the_model_loads(tmp_path):
    write(tmp_path, declarations='[{"name": "x", "kind": "thin", "a": "608", "min": 1}]')
    with pytest.raises(LoadError, match=re.escape("thin is of a part to make and '608' is a reference")):
        load_model(tmp_path, "m.py")


@pytest.mark.parametrize(
    ("references", "said"),
    [
        ("[1]", "references() must return a dict of name to shape, got list"),
        ('{"housing": _bearing()}', "housing is also the name of a part"),
        ('{"a/b": _bearing()}', "a reference name has no /"),
        ('{"M3": _bearing()}', "form of a mark's id"),
        ('{"nothing": 3}', "nothing is not a shape with a solid in it"),
    ],
)
def test_bad_references_fail_the_build(tmp_path, references, said):
    write(tmp_path, references)
    with pytest.raises(LoadError, match=re.escape(said)) as e:
        load_model(tmp_path, "m.py")
    assert e.value.kind == "exception"


def test_references_need_a_layout_that_is_not_the_print_one(tmp_path):
    only_print = MODEL.replace("def assembly(p):", "def _assembly(p):")
    write(tmp_path, source=only_print)
    with pytest.raises(LoadError, match="references\\(\\) need an assembly"):
        load_model(tmp_path, "m.py")


def test_a_vendor_step_the_model_reads_is_a_reference_like_any(tmp_path):
    from build123d import Box, export_step

    export_step(Box(10, 10, 10), str(tmp_path / "vendor.step"))
    source = MODEL.replace(
        "def _bearing():",
        'def _bearing():\n    from build123d import import_step\n    from pathlib import Path\n'
        '    return import_step(Path(__file__).parent / "vendor.step")\n\ndef _unused():',
    )
    write(tmp_path, source=source)
    layouts, *_ = load_model(tmp_path, "m.py")
    _, _, shapes = build_scene(layouts, "m.py", {})
    assert "assembly:608" in shapes


TAGGED = MODEL + '''
from build123d import Axis

def tags(p, parts):
    named = {"housing": {"top": parts["housing"].faces().sort_by(Axis.Z)[-1]}}
    # A reference is in the assembly only: the print layout has no "608" to take a face of.
    if "608" in parts:
        named["608"] = {"outer": parts["608"].faces().sort_by(Axis.Z)[-1]}
    return named
'''


def test_references_and_tags_work_together(tmp_path):
    """One ``Layouts`` carries both: the reference is marked, a part and a reference are tagged, the print layout lacks the reference."""
    from torno_kernel import worker

    write(tmp_path, source=TAGGED)
    layouts, _, _, _ = load_model(tmp_path, "m.py")
    assert layouts.references == {"608"}
    assert set(layouts.tags) == {("assembly", "housing"), ("assembly", "608"), ("print", "housing")}
    scene, _, shapes = build_scene(layouts, "m.py", {})
    assert part(scene, "assembly", "608")["role"] == "reference"
    kept: dict = {}
    worker._tag_parts(scene, layouts.tags, kept)
    assert list(part(scene, "assembly", "608")["tags"]) == ["outer"]
    assert list(part(scene, "assembly", "housing")["tags"]) == ["top"]
    assert "tags" not in part(scene, "assembly", "cap")
    top = part(scene, "assembly", "housing")["tags"]["top"]["faces"][0]
    assert queries.describe(shapes, "assembly:housing/@top", kept)["ref"] == f"assembly:housing/F{top}"
    assert queries.describe(shapes, "assembly:608/@outer", kept)["tag"] == "outer"


READING = MODEL.replace("    bore: float = 22.2\n", "    bore: float = 22.2\n    depth: float = 7\n    other: float = 1\n").replace(
    "def references(p):\n    return REFERENCES\n", "def references(p):\n    _ = p.depth\n    return REFERENCES\n"
)


def test_the_params_a_reference_reads_are_told_on_it(tmp_path):
    write(tmp_path, source=READING)
    layouts, _, _, _ = load_model(tmp_path, "m.py")
    assert layouts.references_read == ("depth",)
    scene, _, _ = build_scene(layouts, "m.py", {})
    assert part(scene, "assembly", "608")["reads"] == ["depth"]
    assert "reads" not in part(scene, "assembly", "housing")


def test_a_reference_that_reads_no_param_says_so(built):
    scene, _, _, layouts = built
    assert layouts.references_read == ()
    assert part(scene, "assembly", "608")["reads"] == []
