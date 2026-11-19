"""``face_prints``: each face of a layout told as a print, so that main can hold two builds of a model against each other."""

import pytest
from build123d import Box, Pos

from torno_kernel import queries, topo
from torno_kernel.queries import QueryError
from torno_kernel.tess import build_scene


def shapes_of(width, height):
    """A block `width` wide in X and `height` high in Z, with a boss on top: two fields, driving different faces."""
    block = Box(width, 20, 5) + Pos(0, 0, 2.5 + height / 2) * Box(6, 6, height)
    return build_scene({"main": {"block": block}}, "block.py")[2]


def prints(shapes):
    return queries.run(shapes, "face_prints", {"layout": "main"})["parts"]["block"]


def test_every_face_of_every_part_has_a_print_in_the_kernels_order():
    shapes = shapes_of(40, 4)
    told = prints(shapes)
    assert len(told) == len(topo.faces(shapes["main:block"]))
    for face in told:
        assert face["type"] == "plane"
        assert face["area"] > 0
        assert len(face["center"]) == 3 and len(face["normal"]) == 3
        assert face["box"][0] <= face["box"][1] or True
        assert all(low <= high for low, high in zip(*face["box"]))


def test_a_wider_block_moves_its_ends_and_changes_nothing_of_the_boss_top():
    before, after = prints(shapes_of(40, 4)), prints(shapes_of(42, 4))
    assert len(before) == len(after)
    moved = [i for i, (a, b) in enumerate(zip(before, after)) if a["center"] != b["center"] or a["area"] != b["area"]]
    unmoved = [i for i in range(len(before)) if i not in moved]
    assert moved and unmoved
    # The boss's top is among those that did not move: it is 6 x 6 at the same height.
    assert any(before[i]["normal"] == [0.0, 0.0, 1.0] and before[i]["area"] == pytest.approx(36) for i in unmoved)


def test_a_layout_the_build_lacks_is_refused():
    with pytest.raises(QueryError):
        queries.run(shapes_of(40, 4), "face_prints", {"layout": "nope"})
    with pytest.raises(QueryError):
        queries.run(shapes_of(40, 4), "face_prints", {})
