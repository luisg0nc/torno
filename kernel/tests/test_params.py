"""The model's ``Params``, read by the worker that loads it: names, types, defaults, notes."""

import textwrap

from torno_kernel.loader import load_model


def told(name, type, default, literal, doc, editable=None, choices=None, metadata=None, value="same", unit=None):
    """A field as ``read_params`` tells it."""
    return {
        "name": name,
        "type": type,
        "default": default,
        "value": default if value == "same" else value,
        "literal": literal,
        "editable": editable,
        "choices": choices,
        "metadata": metadata or {},
        "unit": unit,
        "doc": doc,
    }


def write(tmp_path, source: str):
    folder = tmp_path / "thing"
    folder.mkdir()
    (folder / "thing.py").write_text(textwrap.dedent(source))
    return folder


def test_the_bracket_says_its_params(ws):
    _, params, _, _ = load_model(ws / "bracket", "bracket.py")
    assert params == [told("width", "float", 40, True, None, editable="float")]


def test_float_int_and_bool_fields_with_their_notes_and_one_default_that_is_no_literal(tmp_path):
    folder = write(
        tmp_path,
        '''
        from dataclasses import dataclass, field

        from build123d import Box

        BASE = 2.0


        @dataclass(frozen=True)
        class Params:
            wall: float = 2.5  # thickness of every wall, mm
            # how many ribs across the floor
            ribs: int = 3
            lid: bool = True
            depth: float = BASE * 4
            holes: list = field(default_factory=lambda: [3, 4])
            """the holes' diameters"""
            name: str = "tray"


        def assembly(p):
            return {"tray": Box(10, 10, p.wall)}
        ''',
    )
    _, params, _, _ = load_model(folder, "thing.py")
    assert params == [
        told("wall", "float", 2.5, True, "thickness of every wall, mm", editable="float"),
        told("ribs", "int", 3, True, "how many ribs across the floor", editable="int"),
        told("lid", "bool", True, True, None, editable="bool"),
        told("depth", "float", 8.0, False, None),
        told("holes", "list", [3, 4], False, "the holes' diameters"),
        told("name", "str", "tray", True, None),
    ]


def test_types_as_written_and_a_default_that_is_no_plain_value_is_null(tmp_path):
    folder = write(
        tmp_path,
        """
        from __future__ import annotations
        from dataclasses import dataclass, field
        from build123d import Box, Vector

        @dataclass
        class Params:
            at: Vector = field(default_factory=lambda: Vector(1, 2, 3))
            size: float | None = None
            count: int = -2

        def assembly(p):
            return {"box": Box(1, 1, 1)}
        """,
    )
    _, params, _, _ = load_model(folder, "thing.py")
    assert params == [
        told("at", "Vector", None, False, None),
        told("size", "float | None", None, True, None),
        told("count", "int", -2, True, None, editable="int"),
    ]


def test_a_model_of_top_level_shapes_has_no_params(ws):
    _, params, _, _ = load_model(ws / "plain", "plain.py")
    assert params == []


OFFERED = """
    from dataclasses import dataclass, field
    from typing import Literal

    from build123d import Box

    BASE = 2.0


    @dataclass(frozen=True)
    class Params:
        wall: float = field(default=2.0, metadata={"min": 1, "max": 5, "step": 0.2})  # the wall
        ribs: int = 3
        lid: bool = True
        depth: float = BASE * 4
        shape: Literal["round", "square"] = "round"
        name: str = "tray"
        hole: float | None = None


    def assembly(p):
        return {"tray": Box(10 + p.ribs, 10, p.wall * (2 if p.lid else 1) + (5 if p.shape == "square" else 0))}


    def printables(p):
        return assembly(p)


    def checks(p):
        return [{"name": "wall", "kind": "volume", "a": "tray", "min": p.wall}]


    def groups(p):
        return {"all": ["tray"]} if p.lid else {"all": ["tray"]}
"""


def box_of(folder, **overrides):
    report = {}
    layouts, params, _, declared = load_model(folder, "thing.py", overrides, report)
    return layouts, params, declared, report


def test_only_literal_numbers_bools_and_literals_are_offered(tmp_path):
    folder = write(tmp_path, OFFERED)
    _, params, _, _ = box_of(folder)
    by = {p["name"]: p for p in params}
    assert {n: p["editable"] for n, p in by.items()} == {
        "wall": "float",
        "ribs": "int",
        "lid": "bool",
        "depth": None,
        "shape": "choice",
        "name": None,
        "hole": None,
    }
    assert by["shape"]["choices"] == ["round", "square"]
    assert by["wall"]["metadata"] == {"min": 1, "max": 5, "step": 0.2}
    assert by["ribs"]["metadata"] == {} and by["ribs"]["choices"] is None


def test_a_unit_in_the_metadata_is_told_as_written_and_what_is_no_text_is_left_out(tmp_path):
    folder = write(
        tmp_path,
        """
        from dataclasses import dataclass, field

        from build123d import Box


        @dataclass(frozen=True)
        class Params:
            tilt: float = field(default=15.0, metadata={"min": 0, "max": 45, "unit": "deg"})
            buttons: int = field(default=9, metadata={"unit": "count"})
            ratio: float = field(default=2.0, metadata={"unit": ""})
            load: float = field(default=3.0, metadata={"unit": " N·m "})
            odd: float = field(default=1.0, metadata={"unit": 5})
            wall: float = 2.0


        def assembly(p):
            return {"tray": Box(10, 10, p.wall)}
        """,
    )
    _, params, _, _ = load_model(folder, "thing.py")
    by = {p["name"]: p for p in params}
    assert [by[n]["unit"] for n in ("tilt", "buttons", "ratio", "load", "odd", "wall")] == ["deg", "count", "", "N·m", None, None]
    assert by["tilt"]["metadata"] == {"min": 0, "max": 45}


def test_an_override_reaches_every_call_of_params_the_loader_makes(tmp_path):
    folder = write(tmp_path, OFFERED)
    layouts, params, declared, report = box_of(folder, wall=3.0, ribs=5, lid=False, shape="square")
    assert report == {"applied": {"wall": 3.0, "ribs": 5, "lid": False, "shape": "square"}, "dropped": []}
    # assembly and printables are made with them, so is checks(p); groups(p) ran with them too
    for layout in ("assembly", "print"):
        box = layouts[layout]["tray"]
        assert (round(box.bounding_box().size.X), round(box.bounding_box().size.Z)) == (15, 8)
    assert declared[0]["min"] == 3.0
    by = {p["name"]: p for p in params}
    assert by["wall"]["default"] == 2.0 and by["wall"]["value"] == 3.0
    assert by["ribs"]["default"] == 3 and by["ribs"]["value"] == 5
    assert by["depth"]["value"] == 8.0


def test_the_make_functions_are_called_with_the_overrides_too(tmp_path):
    folder = write(
        tmp_path,
        """
        from dataclasses import dataclass
        from build123d import Box

        @dataclass(frozen=True)
        class Params:
            height: float = 4

        def make_block(p):
            return Box(10, 10, p.height)
        """,
    )
    layouts, _, _, _ = box_of(folder, height=7)
    assert round(layouts["main"]["block"].bounding_box().size.Z) == 7


def test_an_override_that_is_no_good_is_dropped_and_said_naming_the_type(tmp_path):
    folder = write(tmp_path, OFFERED)
    _, params, _, report = box_of(
        folder, wall="thick", ribs=2.5, lid="yes", shape="hexagon", depth=1.0, name="x", hole=1.0, gone=1, extra=True
    )
    assert report["applied"] == {}
    reasons = {d["name"]: d["reason"] for d in report["dropped"]}
    assert set(reasons) == {"wall", "ribs", "lid", "shape", "depth", "name", "hole", "gone", "extra"}
    assert "is a float" in reasons["wall"]
    assert "is an int" in reasons["ribs"]
    assert "is a bool" in reasons["lid"]
    assert "one of ['round', 'square']" in reasons["shape"]
    assert "not offered" in reasons["depth"]
    assert "no such field" in reasons["gone"]
    assert all(p["value"] == p["default"] for p in params)


def test_a_bool_is_no_number_and_a_whole_float_is_an_int(tmp_path):
    folder = write(tmp_path, OFFERED)
    _, _, _, report = box_of(folder, wall=True, ribs=4.0, lid=1)
    assert report["applied"] == {"ribs": 4}
    assert {d["name"] for d in report["dropped"]} == {"wall", "lid"}


def test_a_whole_number_for_a_float_is_made_a_float(tmp_path):
    folder = write(tmp_path, OFFERED)
    _, _, _, report = box_of(folder, wall=3)
    assert report["applied"] == {"wall": 3.0} and isinstance(report["applied"]["wall"], float)


def test_a_build_with_no_overrides_is_as_before(tmp_path):
    folder = write(tmp_path, OFFERED)
    _, params, _, report = box_of(folder)
    assert report == {"applied": {}, "dropped": []}
    assert all(p["value"] == p["default"] for p in params)


def test_references_are_made_with_the_overrides_too(tmp_path):
    folder = write(
        tmp_path,
        """
        from dataclasses import dataclass
        from build123d import Box

        @dataclass(frozen=True)
        class Params:
            bolt: float = 4

        def assembly(p):
            return {"plate": Box(20, 20, 3)}

        def references(p):
            return {"bolt": Box(p.bolt, p.bolt, p.bolt)}
        """,
    )
    layouts, _, _, _ = load_model(folder, "thing.py", {"bolt": 6})
    assert round(layouts["assembly"]["bolt"].bounding_box().size.X) == 6
