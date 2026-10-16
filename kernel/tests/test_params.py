"""The model's ``Params``, read by the worker that loads it: names, types, defaults, notes."""

import textwrap

from torno_kernel.loader import load_model


def write(tmp_path, source: str):
    folder = tmp_path / "thing"
    folder.mkdir()
    (folder / "thing.py").write_text(textwrap.dedent(source))
    return folder


def test_the_bracket_says_its_params(ws):
    _, params, _ = load_model(ws / "bracket", "bracket.py")
    assert params == [{"name": "width", "type": "float", "default": 40, "literal": True, "doc": None}]


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
    _, params, _ = load_model(folder, "thing.py")
    assert params == [
        {"name": "wall", "type": "float", "default": 2.5, "literal": True, "doc": "thickness of every wall, mm"},
        {"name": "ribs", "type": "int", "default": 3, "literal": True, "doc": "how many ribs across the floor"},
        {"name": "lid", "type": "bool", "default": True, "literal": True, "doc": None},
        {"name": "depth", "type": "float", "default": 8.0, "literal": False, "doc": None},
        {"name": "holes", "type": "list", "default": [3, 4], "literal": False, "doc": "the holes' diameters"},
        {"name": "name", "type": "str", "default": "tray", "literal": True, "doc": None},
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
    _, params, _ = load_model(folder, "thing.py")
    assert params == [
        {"name": "at", "type": "Vector", "default": None, "literal": False, "doc": None},
        {"name": "size", "type": "float | None", "default": None, "literal": True, "doc": None},
        {"name": "count", "type": "int", "default": -2, "literal": True, "doc": None},
    ]


def test_a_model_of_top_level_shapes_has_no_params(ws):
    _, params, _ = load_model(ws / "plain", "plain.py")
    assert params == []
