"""``section``, in-process: the exact outline a plane cuts of each part."""

import math
from pathlib import Path

import pytest

from torno_kernel import queries
from torno_kernel.loader import load_scene
from torno_kernel.tess import build_scene

WS = Path(__file__).parent / "fixtures" / "ws"
SOLID = "cross-section of the solid"
SURFACE = "outline of the surface: the part is not a solid"
MIXED = "cross-section of its solids; its loose faces are not cut"
X, Y, Z = [1, 0, 0], [0, 1, 0], [0, 0, 1]


@pytest.fixture(scope="module")
def bracket():
    _, _, shapes = build_scene(load_scene(WS / "bracket", "bracket.py"), "bracket.py")
    return shapes


def section(shapes, origin, normal, layout="assembly", **more) -> dict:
    plane = {"origin": origin, "normal": normal}
    return queries.run(shapes, "section", {"layout": layout, "plane": plane, **more}, {})


def refused(shapes, args) -> tuple[str, str]:
    with pytest.raises(queries.QueryError) as e:
        queries.run(shapes, "section", args, {})
    return e.value.kind, e.value.message


def shoelace(points) -> float:
    """The signed area of a polygon: positive when it runs counter-clockwise."""
    pairs = zip(points, points[1:] + points[:1], strict=True)
    return sum(a[0] * b[1] - b[0] * a[1] for a, b in pairs) / 2


def by_name(result) -> dict:
    return {part["part"]: part for part in result["parts"]}


def test_a_cut_through_the_post_is_one_closed_circle_and_the_base_is_missed(bracket):
    result = section(bracket, [0, 0, 12.5], [0, 0, 1])
    assert [part["part"] for part in result["parts"]] == ["base", "post"]
    parts = by_name(result)
    assert parts["base"] == {"part": "base", "loops": [], "area": 0, "areaExact": True, "open": 0, "how": SOLID}
    post = parts["post"]
    [loop] = post["loops"]
    assert (loop["closed"], loop["areaExact"], post["areaExact"], post["how"]) == (True, True, True, SOLID)
    # The area is of the circle itself, not of the polygon drawn of it.
    assert loop["area"] == pytest.approx(math.pi * 16, rel=1e-9)
    assert (post["area"], post["open"]) == (pytest.approx(math.pi * 16), 0)
    # Every point is on the circle, and no chord strays more than 0.05 mm from it.
    assert all(math.hypot(u, v) == pytest.approx(4) for u, v in loop["points"])
    assert 0 < math.pi * 16 - shoelace(loop["points"]) < 0.05 * 2 * math.pi * 4
    assert len(loop["points"]) <= 2000
    assert loop["points"][0] != loop["points"][-1]
    assert result["bounds"] == {"min": pytest.approx([-4, -4]), "max": pytest.approx([4, 4])}


def test_a_cut_through_the_base_is_its_rectangle(bracket):
    result = section(bracket, [0, 0, 0], [0, 0, 1])
    parts = by_name(result)
    assert parts["post"]["loops"] == []
    [loop] = parts["base"]["loops"]
    assert (loop["closed"], loop["area"]) == (True, pytest.approx(1200))
    assert parts["base"]["area"] == pytest.approx(1200)
    assert sorted(map(tuple, loop["points"])) == [
        pytest.approx((-20, -15)),
        pytest.approx((-20, 15)),
        pytest.approx((20, -15)),
        pytest.approx((20, 15)),
    ]
    # An outer loop runs counter-clockwise.
    assert shoelace(loop["points"]) == pytest.approx(1200)


def test_the_plane_says_its_axes_and_points_are_along_them(bracket):
    # Looking along +X: of Y and Z, equally square to the normal, Y is the first.
    result = section(bracket, [3, 1, 0.5], [2, 0, 0])
    assert result["plane"] == {
        "origin": [3, 1, 0.5],
        "normal": [1, 0, 0],
        "x": [0, 1, 0],
        "y": [0, 0, 1],
    }
    [loop] = by_name(result)["base"]["loops"]
    # The base is 30 along Y and 5 along Z; the origin of the plane is at (1, 0.5) of them.
    assert sorted(map(tuple, loop["points"])) == [
        pytest.approx((-16, -3)),
        pytest.approx((-16, 2)),
        pytest.approx((14, -3)),
        pytest.approx((14, 2)),
    ]
    assert result["bounds"] == {"min": pytest.approx([-16, -3]), "max": pytest.approx([14, 22])}
    # Back in the object: origin + u·x + v·y, which is on the plane.
    assert loop["area"] == pytest.approx(150)


@pytest.mark.parametrize(
    ("normal", "x", "y"),
    [
        ([0, 0, 1], [1, 0, 0], [0, 1, 0]),
        ([0, 0, -1], [1, 0, 0], [0, -1, 0]),
        ([0, 1, 0], [1, 0, 0], [0, 0, -1]),
        ([1, 0, 0], [0, 1, 0], [0, 0, 1]),
        ([1, 0, 1], [0, 1, 0], [-math.sqrt(0.5), 0, math.sqrt(0.5)]),
        ([1, 2, 3], [math.sqrt(13 / 14), -2 / math.sqrt(182), -3 / math.sqrt(182)], None),
    ],
)
def test_axes_are_a_right_handed_pair_from_the_world_axis_least_along_the_normal(bracket, normal, x, y):
    plane = section(bracket, [0, 0, 0], normal)["plane"]
    length = math.sqrt(sum(c * c for c in normal))
    assert plane["normal"] == pytest.approx([c / length for c in normal])
    assert plane["x"] == pytest.approx(x)
    if y is not None:
        assert plane["y"] == pytest.approx(y)
    n, u, v = plane["normal"], plane["x"], plane["y"]
    cross = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]]
    assert cross == pytest.approx(n)


def test_a_hollow_part_has_an_outer_loop_and_a_hole():
    from build123d import Box

    shapes = {"assembly:shell": Box(20, 20, 20) - Box(16, 16, 16)}
    [part] = section(shapes, [0, 0, 0], [0, 0, 1])["parts"]
    outer, hole = part["loops"]
    assert (outer["closed"], outer["area"]) == (True, pytest.approx(400))
    assert (hole["closed"], hole["area"]) == (True, pytest.approx(-256))
    assert (part["area"], part["open"]) == (pytest.approx(144), 0)
    # The outer loop runs counter-clockwise and the hole clockwise.
    assert shoelace(outer["points"]) == pytest.approx(400)
    assert shoelace(hole["points"]) == pytest.approx(-256)


def test_an_island_in_a_hole_is_counted_again():
    from build123d import Box, Cylinder

    shapes = {"assembly:nested": Box(20, 20, 20) - Box(16, 16, 16) + Cylinder(3, 16)}
    [part] = section(shapes, [0, 0, 0], [0, 0, 1])["parts"]
    assert [loop["area"] for loop in part["loops"]] == [
        pytest.approx(400),
        pytest.approx(-256),
        pytest.approx(math.pi * 9),
    ]
    assert part["area"] == pytest.approx(144 + math.pi * 9)


def test_a_plane_that_misses_lists_every_part_with_no_loops(bracket):
    result = section(bracket, [0, 0, 100], [0, 0, 1])
    assert result["parts"] == [
        {"part": "base", "loops": [], "area": 0, "areaExact": True, "open": 0, "how": SOLID},
        {"part": "post", "loops": [], "area": 0, "areaExact": True, "open": 0, "how": SOLID},
    ]
    assert result["bounds"] is None


def test_only_the_parts_asked_for_are_cut_and_in_the_layout_named(bracket):
    result = section(bracket, [0, 0, 0], [0, 0, 1], parts=["post"])
    assert [part["part"] for part in result["parts"]] == ["post"]
    # In the print layout the post lies on its side, 60 mm along X.
    lying = section(bracket, [60, 0, 4], [0, 1, 0], layout="print", parts=["post"])
    [loop] = lying["parts"][0]["loops"]
    assert loop["area"] == pytest.approx(math.pi * 16)


def test_each_wire_of_a_part_that_is_no_solid_is_drawn_once(monkeypatch):
    from build123d import Axis, Box, Shell

    from torno_kernel import section as module

    drawn = []
    polyline = module._polyline
    monkeypatch.setattr(module, "_polyline", lambda wire, deflection: drawn.append(deflection) or polyline(wire, deflection))
    tub = {"assembly:tub": Shell(Box(10, 10, 10).faces().sort_by(Axis.Z)[:-1])}
    # Cut level: one closed wire. Cut upright: one open one.
    [level] = section(tub, [0, 0, 0], [0, 0, 1])["parts"]
    assert (level["loops"][0]["closed"], level["area"]) == (True, pytest.approx(100))
    assert drawn == [0.05]
    [upright] = section(tub, [0, 0, 0], [0, 1, 0])["parts"]
    assert upright["open"] == 1
    assert drawn == [0.05, 0.05]


def test_a_part_that_is_not_closed_gives_open_loops_and_says_how_many():
    from build123d import Axis, Box, Shell

    faces = Box(10, 10, 10).faces().sort_by(Axis.Z)
    shapes = {"assembly:tub": Shell(faces[:-1])}  # without its top
    [part] = section(shapes, [0, 0, 0], [0, 1, 0])["parts"]
    [loop] = part["loops"]
    # Of an outline that is not closed no area is told, nor of the part it leaves open.
    assert (loop["closed"], loop["area"], part["area"], part["open"]) == (False, None, None, 1)
    assert part["how"] == SURFACE
    # Up one side is not there: down, across the bottom and up again.
    assert len(loop["points"]) == 4
    ends = sorted([tuple(loop["points"][0]), tuple(loop["points"][-1])])
    # Looking along +Y the axes are X and -Z.
    assert ends == [pytest.approx((-5, -5)), pytest.approx((5, -5))]
    # Cut level, it is closed all the same.
    [level] = section(shapes, [0, 0, 0], [0, 0, 1])["parts"]
    assert (level["loops"][0]["closed"], level["area"], level["open"]) == (True, pytest.approx(100), 0)
    assert (level["how"], level["areaExact"]) == (SURFACE, True)


def test_a_loop_of_more_points_than_the_limit_is_drawn_coarser_and_its_area_is_still_exact():
    from build123d import RegularPolygon, extrude

    sides = 2200
    shapes = {"assembly:gear": extrude(RegularPolygon(50, sides), 2)}
    [part] = section(shapes, [0, 0, 1], [0, 0, 1])["parts"]
    [loop] = part["loops"]
    assert 20 < len(loop["points"]) <= 2000
    assert loop["deflection"] > 0.05
    assert loop["area"] == pytest.approx(sides / 2 * 2500 * math.sin(2 * math.pi / sides), rel=1e-9)
    assert all(math.hypot(u, v) == pytest.approx(50) for u, v in loop["points"])
    # One that needs no more than the limit is drawn at 0.05 mm.
    few = {"assembly:gear": extrude(RegularPolygon(50, 12), 2)}
    [loop] = section(few, [0, 0, 1], [0, 0, 1])["parts"][0]["loops"]
    assert (len(loop["points"]), loop["deflection"]) == (12, 0.05)


def test_an_outline_is_drawn_as_finely_as_asked_down_to_five_microns(bracket):
    def circle(**more) -> dict:
        [loop] = by_name(section(bracket, [0, 0, 12.5], [0, 0, 1], **more))["post"]["loops"]
        assert all(math.hypot(u, v) == pytest.approx(4) for u, v in loop["points"])
        return loop

    def sag(loop) -> float:
        """How far the longest chord of the circle's polygon is from the circle."""
        points = loop["points"]
        chord = max(math.dist(a, b) for a, b in zip(points, points[1:] + points[:1], strict=True))
        return 4 - math.sqrt(16 - chord * chord / 4)

    coarse = circle()
    assert (coarse["deflection"], circle(deflection=0.05), circle(deflection=None)) == (0.05, coarse, coarse)
    assert 0.005 < sag(coarse) <= 0.05
    fine = circle(deflection=0.005)
    assert fine["deflection"] == 0.005
    assert sag(fine) <= 0.005
    assert len(fine["points"]) > 2 * len(coarse["points"])
    # The area is the circle's at either.
    assert fine["area"] == coarse["area"] == pytest.approx(math.pi * 16, rel=1e-9)
    # Finer than the finest is the finest, coarser than the default the default: each says which.
    assert circle(deflection=0.0001) == fine
    assert circle(deflection=3) == coarse
    assert circle(deflection=0.02)["deflection"] == 0.02


@pytest.mark.parametrize("deflection", [0, -0.01, "0.01", True, [0.01], float("nan"), float("inf"), 10**400])
def test_a_deflection_that_is_not_a_positive_number_is_refused(bracket, deflection):
    plane = {"origin": [0, 0, 12.5], "normal": [0, 0, 1]}
    assert refused(bracket, {"layout": "assembly", "plane": plane, "deflection": deflection}) == (
        "bad_request",
        "args.deflection of section, if given, is a positive number of mm, how far the outline "
        "drawn may stray from the true one: 0.05 when none is given, 0.005 at least",
    )


def test_a_loop_asked_finer_than_the_limit_allows_is_drawn_as_finely_as_it_does():
    from build123d import Cylinder

    # A circle of 20 m at 5 microns is 3,100 points: it is drawn at the finest that is
    # under the limit, and says so.
    shapes = {"assembly:drum": Cylinder(10000, 2)}
    [loop] = section(shapes, [0, 0, 0], [0, 0, 1], deflection=0.005)["parts"][0]["loops"]
    assert 1000 < len(loop["points"]) <= 2000
    assert loop["deflection"] == 0.02
    assert loop["area"] == pytest.approx(math.pi * 1e8, rel=1e-9)
    assert all(math.hypot(u, v) == pytest.approx(10000) for u, v in loop["points"])


@pytest.mark.parametrize(
    "args",
    [
        {},
        {"layout": "assembly"},
        {"layout": 3, "plane": {"origin": [0, 0, 0], "normal": [0, 0, 1]}},
        {"layout": "assembly", "plane": [0, 0, 1]},
        {"layout": "assembly", "plane": {"origin": [0, 0], "normal": [0, 0, 1]}},
        {"layout": "assembly", "plane": {"origin": [0, 0, 0], "normal": [0, 0, float("nan")]}},
        {"layout": "assembly", "plane": {"origin": [0, 0, 0]}},
    ],
)
def test_a_section_that_names_no_plane_is_refused(bracket, args):
    assert refused(bracket, args) == (
        "bad_request",
        "section needs args.layout, a string, and args.plane with origin and normal, each "
        "three finite numbers",
    )


def test_a_normal_of_no_length_and_parts_that_are_not_names_are_refused(bracket):
    plane = {"origin": [0, 0, 0], "normal": [0, 0, 0]}
    assert refused(bracket, {"layout": "assembly", "plane": plane}) == (
        "bad_request",
        "the normal of the section plane has no length",
    )
    plane = {"origin": [0, 0, 0], "normal": [0, 0, 1]}
    for parts in ("post", [3], []):
        assert refused(bracket, {"layout": "assembly", "plane": plane, "parts": parts}) == (
            "bad_request",
            "args.parts of section, if given, is a list of part names, at least one",
        )


def test_a_layout_or_a_part_that_is_not_there_is_a_bad_ref_naming_those_that_are(bracket):
    plane = {"origin": [0, 0, 0], "normal": [0, 0, 1]}
    assert refused(bracket, {"layout": "exploded", "plane": plane}) == (
        "bad_ref",
        "no layout 'exploded'; the layouts are assembly, print",
    )
    assert refused(bracket, {"layout": "assembly", "plane": plane, "parts": ["post", "lid"]}) == (
        "bad_ref",
        "no part 'lid' in assembly; its parts are base, post",
    )


# Planes that touch: the cross-section of a solid is what of the plane is in it


@pytest.fixture(scope="module")
def plate():
    _, _, shapes = build_scene(load_scene(WS / "measures", "measures.py"), "measures.py")
    return shapes


def whole(shapes, origin, normal) -> dict:
    """The one part cut, after checking that what it says of itself adds up."""
    [part] = section(shapes, origin, normal)["parts"]
    assert part["area"] == pytest.approx(sum(loop["area"] for loop in part["loops"]))
    assert all(loop["closed"] and loop["areaExact"] for loop in part["loops"])
    assert (part["open"], part["areaExact"], part["how"]) == (0, True, SOLID)
    return part


@pytest.mark.parametrize("x", [14, 6])
def test_a_plane_tangent_to_a_hole_still_cuts_the_whole_plate(plate, x):
    # The hole of radius 4 at x = 10 only touches the plane: nothing of the 30 × 6 is missing.
    assert whole(plate, [x, 0, 0], X)["area"] == pytest.approx(180)


@pytest.mark.parametrize("normal", [X, [-1, 0, 0]])
def test_a_plane_on_a_face_of_the_solid_has_that_face_in_the_cross_section(plate, normal):
    # x = -5 is a side wall of the pocket, 6 × 4: the solid ends there and has it,
    # whichever way the plane looks.
    part = whole(plate, [-5, 0, 0], normal)
    assert part["area"] == pytest.approx(180)
    assert sorted(loop["area"] for loop in part["loops"]) == [pytest.approx(24), pytest.approx(156)]


def test_a_plane_on_an_outer_face_is_that_face(plate):
    top = whole(plate, [0, 0, 3], Z)
    assert top["area"] == pytest.approx(38 * 30 - 2 * math.pi * 16 - 60)
    assert [loop["area"] > 0 for loop in top["loops"]] == [True, False, False, False]
    from build123d import Box

    box = {"assembly:box": Box(10, 10, 10)}
    assert whole(box, [0, 0, 5], Z)["area"] == pytest.approx(100)
    assert whole(box, [0, 0, -5], Z)["area"] == pytest.approx(100)
    assert whole(box, [0, 0, 5.001], Z)["loops"] == []


def test_touching_solids_of_one_part_are_each_cut():
    from build123d import Box, Compound, Pos

    two = {"assembly:two": Compound([Box(10, 10, 10), Pos(10, 0, 0) * Box(10, 10, 10)])}
    part = whole(two, [0, 0, 0], Z)
    assert part["area"] == pytest.approx(200)
    assert [loop["area"] for loop in part["loops"]] == [pytest.approx(100), pytest.approx(100)]


def test_overlapping_solids_of_one_part_are_each_cut_and_both_counted():
    from build123d import Box, Compound, Pos

    two = {"assembly:two": Compound([Box(10, 10, 10), Pos(5, 0, 0) * Box(10, 10, 10)])}
    part = whole(two, [0, 0, 0], Z)
    assert [loop["area"] for loop in part["loops"]] == [pytest.approx(100), pytest.approx(100)]
    assert part["area"] == pytest.approx(200)


def test_a_plane_that_only_touches_a_solid_cuts_nothing_of_it():
    from build123d import Box, Cylinder, Torus

    touched = [
        (Torus(20, 3), [0, 0, 3], Z),  # along the circle on top of the ring
        (Box(10, 10, 10), [5, 5, 0], [1, 1, 0]),  # along one edge
        (Cylinder(4, 20), [4, 0, 0], X),  # along a line of its side
    ]
    for shape, origin, normal in touched:
        part = whole({"assembly:it": shape}, origin, normal)
        assert (part["loops"], part["area"]) == ([], 0)
    # Through the ring it is cut as a ring.
    ring = whole({"assembly:it": Torus(20, 3)}, [0, 0, 0], Z)
    assert [loop["area"] for loop in ring["loops"]] == [
        pytest.approx(math.pi * 23**2),
        pytest.approx(-math.pi * 17**2),
    ]


def test_a_loop_no_face_can_be_made_of_says_its_area_is_not_exact(monkeypatch):
    from build123d import Axis, Box, Shell

    from torno_kernel import section as module

    monkeypatch.setattr(module, "_face_area", lambda face: None)
    tub = {"assembly:tub": Shell(Box(10, 10, 10).faces().sort_by(Axis.Z)[:-1])}
    [part] = section(tub, [0, 0, 0], Z)["parts"]
    [loop] = part["loops"]
    # The polygon's area, said to be that.
    assert (loop["area"], loop["areaExact"], part["areaExact"]) == (pytest.approx(100), False, False)


def test_coordinates_beyond_a_million_kilometres_are_refused(bracket):
    plane = {"origin": [0, 0, 1e308], "normal": [0, 0, 1]}
    assert refused(bracket, {"layout": "assembly", "plane": plane})[0] == "bad_request"


# Areas of outlines that are not lines and circles: exact to 1e-6 of themselves


def test_the_area_of_a_spline_outline_is_that_of_the_spline(spline_prism):
    prism, true_area, _ = spline_prism
    [part] = section({"assembly:prism": prism}, [0, 0, 2], Z)["parts"]
    [loop] = part["loops"]
    assert (loop["areaExact"], part["areaExact"]) == (True, True)
    assert loop["area"] == pytest.approx(true_area, rel=1e-6)
    assert part["area"] == pytest.approx(true_area, rel=1e-6)
    # The polygon it is drawn as is not what was measured: that is short by more.
    assert abs(shoelace(loop["points"]) - true_area) > 1e-4 * true_area


def test_the_area_of_an_ellipse_outline_is_that_of_the_ellipse():
    from build123d import Ellipse, extrude

    [part] = section({"assembly:it": extrude(Ellipse(10, 5), 2)}, [0, 0, 1], Z)["parts"]
    assert part["area"] == pytest.approx(math.pi * 10 * 5, rel=1e-6)
    assert part["loops"][0]["area"] == pytest.approx(math.pi * 10 * 5, rel=1e-6)


def test_a_part_of_a_solid_and_a_loose_face_says_the_face_is_not_cut():
    from build123d import Box, Compound, Pos

    loose = (Pos(50, 0, 0) * Box(10, 10, 10)).faces()[0]
    [part] = section({"assembly:mixed": Compound([Box(10, 10, 10), loose])}, [0, 0, 0], Z)["parts"]
    assert (part["how"], part["area"], part["open"]) == (MIXED, pytest.approx(100), 0)
    assert len(part["loops"]) == 1


# Axes of the caller's and the points to snap to


def block():
    from build123d import Box

    return {"assembly:block": Box(40, 20, 10)}


def corners_of(result) -> list[list[float]]:
    [part] = result["parts"]
    [loop] = part["loops"]
    return loop["corners"]


def test_a_box_cut_across_z_gives_its_four_corners_exactly():
    result = section(block(), [0, 0, 0], Z, snaps=True, axes={"x": X, "y": Y})
    assert result["plane"]["x"] == X and result["plane"]["y"] == Y
    corners = corners_of(result)
    assert sorted(map(tuple, corners)) == [
        pytest.approx((-20, -10), abs=1e-9),
        pytest.approx((-20, 10), abs=1e-9),
        pytest.approx((20, -10), abs=1e-9),
        pytest.approx((20, 10), abs=1e-9),
    ]
    assert result["parts"][0]["loops"][0]["circles"] == []


def test_the_corners_are_in_the_callers_frame():
    result = section(block(), [0, 0, 0], Z, snaps=True, axes={"x": Y, "y": [-1, 0, 0]})
    assert result["plane"]["x"] == Y and result["plane"]["y"] == [-1, 0, 0]
    assert sorted(map(tuple, corners_of(result))) == [
        pytest.approx((-10, -20), abs=1e-9),
        pytest.approx((-10, 20), abs=1e-9),
        pytest.approx((10, -20), abs=1e-9),
        pytest.approx((10, 20), abs=1e-9),
    ]
    # The outline is in that frame too: the points are those of the corners, turned.
    [loop] = result["parts"][0]["loops"]
    assert sorted(map(tuple, loop["points"])) == sorted(map(tuple, corners_of(result)))
    assert result["bounds"] == {"min": pytest.approx([-10, -20]), "max": pytest.approx([10, 20])}


def test_axes_alone_change_the_frame_and_add_no_snaps():
    result = section(block(), [0, 0, 0], Z, axes={"x": Y, "y": [-1, 0, 0]})
    [loop] = result["parts"][0]["loops"]
    assert "corners" not in loop and "circles" not in loop
    assert result["bounds"] == {"min": pytest.approx([-10, -20]), "max": pytest.approx([10, 20])}


def drilled():
    from build123d import Box, Cylinder, Pos

    return {"assembly:plate": Box(60, 40, 10) - Pos(5, 3, 0) * Cylinder(8, 10)}


def test_a_hole_is_a_circle_with_its_centre_and_radius_exactly():
    result = section(drilled(), [0, 0, 0], Z, snaps=True, axes={"x": X, "y": Y})
    outer, hole = result["parts"][0]["loops"]
    assert outer["circles"] == []
    [circle] = hole["circles"]
    assert circle["centre"] == pytest.approx([5, 3], abs=1e-9)
    assert circle["radius"] == pytest.approx(8, abs=1e-9)
    # The plane cuts the bore across, which is no edge of the model.
    assert "edge" not in circle
    # A full circle has no end to be a corner of: only the plate's own are.
    assert len(outer["corners"]) == 4 and hole["corners"] == []


def test_a_hole_cut_on_its_rim_names_its_edge():
    from torno_kernel import topo

    shapes = drilled()
    result = section(shapes, [0, 0, 5], Z, snaps=True, axes={"x": Y, "y": [-1, 0, 0]})
    hole = next(loop for loop in result["parts"][0]["loops"] if loop["circles"])
    [circle] = hole["circles"]
    assert circle["centre"] == pytest.approx([3, -5], abs=1e-9)
    assert circle["radius"] == pytest.approx(8, abs=1e-9)
    index = int(circle["edge"][1:])
    assert circle["edge"] == f"E{index}"
    rim = topo.edges(shapes["assembly:plate"])[index]
    from OCP.BRepAdaptor import BRepAdaptor_Curve
    from OCP.GeomAbs import GeomAbs_CurveType

    curve = BRepAdaptor_Curve(rim)
    assert curve.GetType() == GeomAbs_CurveType.GeomAbs_Circle
    centre = curve.Circle().Location()
    assert (centre.X(), centre.Y(), centre.Z()) == pytest.approx((5, 3, 5), abs=1e-9)
    assert curve.Circle().Radius() == pytest.approx(8)


def test_a_part_without_a_solid_gives_its_snaps_too():
    from build123d import Plane, Rectangle

    shapes = {"assembly:sheet": Plane.XY * Rectangle(10, 6)}
    result = section(shapes, [0, 0, 0], Z, snaps=True, axes={"x": X, "y": Y})
    [loop] = result["parts"][0]["loops"]
    assert sorted(map(tuple, loop["corners"])) == [
        pytest.approx((-5, -3)),
        pytest.approx((-5, 3)),
        pytest.approx((5, -3)),
        pytest.approx((5, 3)),
    ]


@pytest.mark.parametrize(
    "axes",
    [
        {"x": X, "y": [1, 1, 0]},  # not at right angles, y not a unit
        {"x": X, "y": [0.6, 0.8, 0]},  # unit both, not at right angles
        {"x": [2, 0, 0], "y": Y},  # not a unit
        {"x": X, "y": [0, -1, 0]},  # right-handed against the normal
        {"x": X, "y": X},
        {"x": X, "y": [0, 1, 1e-4]},  # off by more than 1e-6
        {"x": X, "y": [0, 1]},
        {"x": X},
        {"x": X, "y": Y, "z": Z},
        {"x": X, "y": [0, 1, "a"]},
        [X, Y],
        "xy",
    ],
)
def test_axes_that_are_not_a_right_handed_orthonormal_pair_along_the_normal_are_refused(axes):
    kind, _ = refused(
        block(), {"layout": "assembly", "plane": {"origin": [0, 0, 0], "normal": Z}, "axes": axes}
    )
    assert kind == "bad_request"


def test_axes_are_judged_against_the_normal_of_the_plane():
    # x = +X, y = +Y is right for a normal along +Z, not for one along -Z or +X.
    for normal in ([0, 0, -1], X):
        kind, _ = refused(
            block(),
            {"layout": "assembly", "plane": {"origin": [0, 0, 0], "normal": normal}, "axes": {"x": X, "y": Y}},
        )
        assert kind == "bad_request"
    # A normal that is not a unit is still along the pair's cross product.
    section(block(), [0, 0, 0], [0, 0, 7], axes={"x": X, "y": Y})


def test_snaps_that_are_not_true_or_false_are_refused():
    kind, _ = refused(
        block(), {"layout": "assembly", "plane": {"origin": [0, 0, 0], "normal": Z}, "snaps": "yes"}
    )
    assert kind == "bad_request"


def test_without_snaps_or_axes_the_reply_is_what_it_was():
    import json

    plain = section(block(), [0, 0, 0], Z)
    assert json.dumps(plain) == json.dumps(section(block(), [0, 0, 0], Z, snaps=False))
    assert all("corners" not in loop and "circles" not in loop for loop in plain["parts"][0]["loops"])
    assert plain["plane"]["x"] == X and plain["plane"]["y"] == Y
