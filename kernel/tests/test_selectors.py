"""A build123d selector that picks a face or an edge now (``describe`` with ``selector``)."""

import json
import re

import pytest
from build123d import Axis, Box, Compound, Cylinder, GeomType, Pos, Rot, fillet

from torno_kernel import queries, selectors, topo
from torno_kernel.tess import build_scene


def shapes_of(part, name="plate"):
    _, _, shapes = build_scene({"main": {name: part}}, f"{name}.py")
    return shapes


def described(shapes, ref, name="plate"):
    return queries.run(shapes, "describe", {"ref": f"main:{name}/{ref}", "selector": True})


def evaluated(expression, part):
    """What the expression gives on the part, evaluated as an agent's model would: the real names of build123d."""
    import build123d

    return eval(expression, {**vars(build123d), "part": part})  # noqa: S307 - the tests' own expressions


@pytest.fixture(scope="module")
def plate():
    """A 40 × 30 × 5 plate with a 4 mm hole and a 2 mm hole through it."""
    return Box(40, 30, 5) - Pos(10, 0, 0) * Cylinder(4, 5) - Pos(-10, 0, 0) * Cylinder(2, 5)


@pytest.fixture(scope="module")
def built(plate):
    return shapes_of(plate)


def every_ref(shapes, key="main:plate"):
    name = key.split(":")[1]
    part = shapes[key]
    return [f"F{i}" for i in range(len(topo.faces(part)))] + [f"E{i}" for i in range(len(topo.edges(part)))]


# Each selector, evaluated, gives the one shape


def test_every_selector_given_picks_exactly_that_face_or_edge(built, plate):
    told = 0
    for ref in every_ref(built):
        reply = described(built, ref)
        selector = reply["selector"]
        if selector is None:
            continue
        told += 1
        topods = topo.faces(plate)[int(ref[1:])] if ref[0] == "F" else topo.edges(plate)[int(ref[1:])]
        picked = evaluated(selector["expression"], plate)
        assert picked.wrapped.IsSame(topods), (ref, selector)
        assert selector["robust"] in ("by geometry", "by order") and selector["checked"] == "this build only"
    # Every face and every edge of this plate can be told apart: none was left without one.
    assert told == len(every_ref(built))


def test_the_top_of_a_plate_is_the_extreme_of_its_planar_faces_across_z(built):
    top = next(f"F{i}" for i, f in enumerate(topo.faces(built["main:plate"])) if _is_top(f))
    reply = described(built, top)
    assert reply["selector"] == {
        "expression": "part.faces().filter_by(Axis.Z).sort_by(Axis.Z)[-1]",
        "robust": "by geometry",
        "checked": "this build only",
        "form": {"of": "faces", "prefix": {"by": "axis", "axis": 2}, "terminal": {"end": 2, "at": -1}},
    }
    assert "descriptor" in reply and reply["kind"] == "face"


def _is_top(face):
    from build123d import Face

    face = Face(face)
    return face.geom_type == GeomType.PLANE and face.normal_at().Z > 0.99


def test_a_side_face_is_picked_by_its_direction_and_an_extreme(built):
    sides = {}
    for i, f in enumerate(topo.faces(built["main:plate"])):
        from build123d import Face

        face = Face(f)
        if face.geom_type == GeomType.PLANE and abs(face.normal_at().X) > 0.99:
            sides[face.center().X > 0] = f"F{i}"
    right = described(built, sides[True])["selector"]
    assert right["expression"] == "part.faces().filter_by(Axis.X).sort_by(Axis.X)[-1]"
    assert described(built, sides[False])["selector"]["expression"] == "part.faces().filter_by(Axis.X).sort_by(Axis.X)[0]"


def test_a_hole_is_picked_by_its_radius(built, plate):
    radii = {}
    for i, f in enumerate(topo.faces(plate)):
        from build123d import Face

        face = Face(f)
        if face.geom_type == GeomType.CYLINDER:
            radii[round(face.radius)] = f"F{i}"
    big = described(built, radii[4])["selector"]
    assert big["robust"] == "by geometry"
    assert "abs(f.radius - 4)" in big["expression"] or "sort_by" in big["expression"]


def test_an_edge_is_picked_too(built, plate):
    circles = [i for i, e in enumerate(topo.edges(plate)) if _kind(e) == "CIRCLE"]
    assert len(circles) == 4
    for i in circles:
        reply = described(built, f"E{i}")
        assert reply["kind"] == "edge" and reply["selector"] is not None
        assert evaluated(reply["selector"]["expression"], plate).wrapped.IsSame(topo.edges(plate)[i])
    vertical = [i for i, e in enumerate(topo.edges(plate)) if _kind(e) == "LINE" and abs(_along_z(e)) > 0.99]
    assert vertical
    assert "Axis.Z" in described(built, f"E{vertical[0]}")["selector"]["expression"] or "GeomType.LINE" in described(built, f"E{vertical[0]}")["selector"]["expression"]


def test_vertical_edges_that_tie_on_one_axis_are_told_by_two_extremes(built, plate):
    from build123d import Edge

    corners = {}
    for i, e in enumerate(topo.edges(plate)):
        edge = Edge(e)
        if edge.geom_type == GeomType.LINE and abs(edge.tangent_at(0.5).Z) > 0.99 and abs(edge.center().X) > 19:
            corners[(edge.center().X > 0, edge.center().Y > 0)] = i
    assert len(corners) == 4
    expressions = {key: described(built, f"E{i}")["selector"]["expression"] for key, i in corners.items()}
    assert expressions[(False, False)] == "part.edges().filter_by(Axis.Z).group_by(Axis.X)[0].sort_by(Axis.Y)[0]"
    assert expressions[(True, True)] == "part.edges().filter_by(Axis.Z).group_by(Axis.X)[-1].sort_by(Axis.Y)[-1]"
    for key, i in corners.items():
        assert evaluated(expressions[key], plate).wrapped.IsSame(topo.edges(plate)[i])


def _kind(edge):
    from build123d import Edge

    return Edge(edge).geom_type.name


def _along_z(edge):
    from build123d import Edge

    return Edge(edge).tangent_at(0.5).Z


# A filleted plate: four equal fillets cannot be told by one extreme, and are by two


def test_equal_fillets_are_told_by_two_extremes():
    from build123d import Face

    base = Box(40, 30, 5)
    rounded = fillet(base.edges().filter_by(Axis.Z), 3)
    shapes = shapes_of(rounded)
    fillets = [i for i, f in enumerate(topo.faces(rounded)) if Face(f).geom_type == GeomType.CYLINDER]
    assert len(fillets) == 4
    for i in fillets:
        selector = described(shapes, f"F{i}")["selector"]
        assert selector["robust"] == "by geometry" and ".group_by(" in selector["expression"]
        assert evaluated(selector["expression"], rounded).wrapped.IsSame(topo.faces(rounded)[i])


# What cannot be told


def test_a_face_that_is_the_same_as_another_gets_none_and_the_reply_says_so():
    twice = Compound([Box(10, 10, 10), Box(10, 10, 10)])
    shapes = shapes_of(twice, "twin")
    reply = described(shapes, "F0", "twin")
    assert reply["selector"] is None
    assert "no selector picks only this face" in reply["selectorWhy"]
    assert reply["descriptor"].startswith("plane")


def test_a_place_in_a_sort_is_told_by_order(monkeypatch, built, plate):
    # Where nothing else can tell it, only an index into a sort can, and it says the next edit may break it.
    original = selectors._Search._candidates

    def only_by_order(self, facts):
        return (c for c in original(self, facts) if c[0] == "by order")

    monkeypatch.setattr(selectors._Search, "_candidates", only_by_order)
    reply = described(built, "F0")
    selector = reply["selector"]
    if selector is not None:
        assert selector["robust"] == "by order" and re.search(r"\.sort_by\(Axis\.[XYZ]\)\[-?\d+\]$", selector["expression"])
        assert evaluated(selector["expression"], plate).wrapped.IsSame(topo.faces(plate)[0])


def test_no_selector_is_told_of_a_part(built):
    reply = queries.run(built, "describe", {"ref": "main:plate", "selector": True})
    assert "selector" not in reply


def test_describe_asks_for_a_selector_only_when_it_is_asked_for(built):
    assert "selector" not in queries.run(built, "describe", {"ref": "main:plate/F0"})
    assert "selector" not in queries.run(built, "describe", {"ref": "main:plate/F0", "selector": "yes"})


# The expression is the worker's own

PREFIX = re.compile(r"part\.(faces|edges)\(\)")
FIXED = re.compile(
    r"\.filter_by\((?:Axis\.[XYZ]|GeomType\.[A-Z_]+)\)"
    r"|\.sort_by\(Axis\.[XYZ]\)"
    r"|\.group_by\(Axis\.[XYZ]\)\[-?\d+\]"
)
LAMBDA = re.compile(r"\.filter_by\(lambda [fe]: ")
INDEX = re.compile(r"\[-?\d+\]")


def well_formed(expr):
    """Whether ``expr`` is a part's faces or edges, a fixed run of filters, sorts and groups, and an index.

    A lambda's body is anything but ';' up to a ')', so it may hold ').filter_by(lambda e: ' itself, and a regex
    that lets the body run on backtracks exponentially over that. Here the text from each position is decided
    once, from the end: ok[j] says the text from j is a run of items and then the final index; a lambda's body
    ends at the first ')' from it on after which the rest is ok (nxt[j]), with no ';' between.
    """
    if expr.endswith("\n"):  # the pattern's '$' also matched before a final newline
        expr = expr[:-1]
    head = PREFIX.match(expr)
    if head is None:
        return False
    start, n = head.end(), len(expr)
    ok = [False] * (n + 1)
    nxt = [n + 1] * (n + 1)  # first ')' at or after j that ends a lambda's body and leaves an ok rest; n + 1 if none
    semi = [n] * (n + 1)  # first ';' at or after j, or n
    for j in range(n, start - 1, -1):
        index = INDEX.match(expr, j)
        if index is not None and index.end() == n:
            ok[j] = True
        item = FIXED.match(expr, j)
        if item is not None and ok[item.end()]:
            ok[j] = True
        lam = LAMBDA.match(expr, j)
        if lam is not None and nxt[lam.end()] < semi[lam.end()]:
            ok[j] = True
        if j < n:
            nxt[j] = j if expr[j] == ")" and ok[j + 1] else nxt[j + 1]
            semi[j] = j if expr[j] == ";" else semi[j + 1]
    return ok[start]


def test_the_expression_is_made_of_a_fixed_set_of_names_and_numbers(built):
    for ref in every_ref(built):
        selector = described(built, ref)["selector"]
        assert selector is not None and well_formed(selector["expression"]), selector


def test_the_evaluation_has_no_builtins_but_abs(plate):
    search = selectors._Search(plate, topo.faces(plate)[0], "face", float("inf"), lambda: 0.0)
    assert search.globals["__builtins__"] == {"abs": abs}
    with pytest.raises(NameError):
        eval("__import__('os')", search.globals)  # noqa: S307
    with pytest.raises(NameError):
        eval("open('/etc/passwd')", search.globals)  # noqa: S307


def test_a_ref_is_never_in_the_expression(built):
    reply = described(built, "F1")
    assert "plate" not in reply["selector"]["expression"].replace("part.", "")


# The part as it stands in the layout


def test_the_selector_is_of_the_part_where_it_stands_in_the_layout():
    # Turned on its side in the layout, the top of the plate as built is an extreme along X there.
    built = Box(40, 30, 5)
    turned = Rot(0, 90, 0) * built
    shapes = shapes_of(turned)
    top = next(i for i, f in enumerate(topo.faces(turned)) if _is_top(f) is False and abs(_normal(f).X) > 0.99 and _normal(f).X > 0)
    reply = described(shapes, f"F{top}")
    assert reply["selector"]["expression"] == "part.faces().filter_by(Axis.X).sort_by(Axis.X)[-1]"
    assert evaluated(reply["selector"]["expression"], turned).wrapped.IsSame(topo.faces(turned)[top])


def _normal(face):
    from build123d import Face

    return Face(face).normal_at()


# The time it takes


def test_a_search_past_its_time_says_so(plate):
    reply = selectors.selector_for(plate, topo.faces(plate)[0], "face", budget=0)
    assert reply == {"selector": None, "selectorWhy": "the search for one ran out of time"}


def test_a_selector_is_found_quickly_on_a_part_of_many_faces():
    import time

    many = Box(200, 200, 10)
    for i in range(10):
        for j in range(10):
            many = many - Pos(-60 + i * 13, -60 + j * 13, 0) * Cylinder(2, 10)
    shapes = shapes_of(many)
    faces = topo.faces(many)
    assert len(faces) > 100
    started = time.monotonic()
    reply = described(shapes, f"F{len(faces) // 2}")
    assert reply["selector"] is not None
    assert time.monotonic() - started < 3.0


# Through the kernel


def test_the_kernel_answers_describe_with_a_selector_when_asked(tmp_path):
    from kclient import Kernel

    folder = tmp_path / "plate"
    folder.mkdir()
    (folder / "plate.py").write_text("from build123d import *\nplate = Box(40, 30, 5) - Cylinder(4, 5)\n")
    kernel = Kernel()
    try:
        reply, _ = kernel.build(folder, "plate.py", timeout=30)
        assert reply["ok"] is True
        asked = kernel.query(folder, "describe", {"ref": "main:plate/F2", "selector": True})
        plain = kernel.query(folder, "describe", {"ref": "main:plate/F2"})
    finally:
        kernel.close()
    assert asked["ok"] is True and asked["result"]["selector"]["robust"] == "by geometry"
    assert asked["result"]["selector"]["expression"].startswith("part.faces()")
    assert plain["ok"] is True and "selector" not in plain["result"]


# The forms: each selector by geometry is made of a structured form, and the text is written from that form alone

# What each ref of the plate said before forms existed: the text must not change by a byte.
PLATE_EXPRESSIONS = {
    "F0": "part.faces().filter_by(Axis.X).sort_by(Axis.X)[0]",
    "F1": "part.faces().filter_by(Axis.Y).sort_by(Axis.Y)[0]",
    "F2": "part.faces().filter_by(Axis.Z).sort_by(Axis.Z)[-1]",
    "F3": "part.faces().filter_by(Axis.Y).sort_by(Axis.Y)[-1]",
    "F4": "part.faces().filter_by(Axis.Z).sort_by(Axis.Z)[0]",
    "F5": "part.faces().filter_by(Axis.X).sort_by(Axis.X)[-1]",
    "F6": "part.faces().filter_by(GeomType.CYLINDER).sort_by(Axis.X)[0]",
    "F7": "part.faces().filter_by(GeomType.CYLINDER).sort_by(Axis.X)[-1]",
    "E0": "part.edges().filter_by(Axis.Z).group_by(Axis.X)[0].sort_by(Axis.Y)[0]",
    "E1": "part.edges().filter_by(Axis.Y).group_by(Axis.Z)[-1].sort_by(Axis.X)[0]",
    "E2": "part.edges().filter_by(Axis.Z).group_by(Axis.X)[0].sort_by(Axis.Y)[-1]",
    "E3": "part.edges().filter_by(Axis.Y).group_by(Axis.Z)[0].sort_by(Axis.X)[0]",
    "E4": "part.edges().filter_by(Axis.X).group_by(Axis.Z)[0].sort_by(Axis.Y)[0]",
    "E5": "part.edges().filter_by(Axis.Z).group_by(Axis.X)[-1].sort_by(Axis.Y)[0]",
    "E6": "part.edges().filter_by(Axis.X).group_by(Axis.Z)[-1].sort_by(Axis.Y)[0]",
    "E7": "part.edges().filter_by(Axis.X).group_by(Axis.Z)[-1].sort_by(Axis.Y)[-1]",
    "E8": "part.edges().filter_by(Axis.Y).group_by(Axis.Z)[-1].sort_by(Axis.X)[-1]",
    "E9": "part.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[-1].sort_by(Axis.X)[0]",
    "E10": "part.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[-1].sort_by(Axis.X)[-1]",
    "E11": "part.edges().filter_by(Axis.X).group_by(Axis.Z)[0].sort_by(Axis.Y)[-1]",
    "E12": "part.edges().filter_by(Axis.Z).group_by(Axis.X)[-1].sort_by(Axis.Y)[-1]",
    "E13": "part.edges().filter_by(Axis.Y).group_by(Axis.Z)[0].sort_by(Axis.X)[-1]",
    "E14": "part.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[0].sort_by(Axis.X)[0]",
    "E15": "part.edges().filter_by(GeomType.CIRCLE).group_by(Axis.Z)[0].sort_by(Axis.X)[-1]",
    "E16": "part.edges().filter_by(GeomType.LINE).filter_by(lambda e: (e.center() - Vector(-8, 0, 0)).length < 0.001)[0]",
    "E17": "part.edges().filter_by(GeomType.LINE).filter_by(lambda e: (e.center() - Vector(14, 0, 0)).length < 0.001)[0]",
}


def test_every_selector_of_the_plate_is_the_text_it_was_before_forms(built):
    assert set(every_ref(built)) == set(PLATE_EXPRESSIONS)
    for ref, expected in PLATE_EXPRESSIONS.items():
        assert described(built, ref)["selector"]["expression"] == expected, ref


def test_each_selector_by_geometry_has_a_form_that_writes_its_expression(built):
    for ref in every_ref(built):
        selector = described(built, ref)["selector"]
        assert selector["robust"] == "by geometry"
        form = selector["form"]
        assert selectors.parse_form(form, "face" if ref[0] == "F" else "edge") == form, ref
        assert selectors.expression_of(form) == selector["expression"], ref
        # plain JSON: it goes through a file and back as it is
        assert json.loads(json.dumps(form)) == form


def test_a_form_is_the_prefix_and_terminal_the_search_made(built):
    top = described(built, "F2")["selector"]["form"]
    assert top == {"of": "faces", "prefix": {"by": "axis", "axis": 2}, "terminal": {"end": 2, "at": -1}}
    corner = described(built, "E0")["selector"]["form"]
    assert corner["terminal"] == {"group": 0, "at": 0, "then": 1, "thenAt": 0}
    where = described(built, "E16")["selector"]["form"]
    assert where["prefix"]["by"] == "at" and where["prefix"]["type"] == "LINE"
    assert where["prefix"]["center"] == pytest.approx([-8.0, 0.0, 0.0], abs=1e-9)
    assert where["terminal"] == {"only": True}


def test_a_selector_by_order_has_no_form(monkeypatch, built):
    original = selectors._Search._candidates

    def only_by_order(self, facts):
        return (c for c in original(self, facts) if c[0] == "by order")

    monkeypatch.setattr(selectors._Search, "_candidates", only_by_order)
    reply = described(built, "F0")
    assert reply["selector"] is not None and reply["selector"]["robust"] == "by order"
    assert "form" not in reply["selector"]


def test_the_forms_by_radius_and_by_size_write_the_text_they_always_did():
    radius = {"of": "faces", "prefix": {"by": "radius", "type": "CYLINDER", "radius": 4.0}, "terminal": {"only": True}}
    assert (
        selectors.expression_of(radius)
        == "part.faces().filter_by(GeomType.CYLINDER).filter_by(lambda f: abs(f.radius - 4) < 0.001)[0]"
    )
    size = {
        "of": "edges",
        "prefix": {"by": "size", "type": "LINE", "size": 30.0, "within": 0.003},
        "terminal": {"end": 0, "at": -1},
    }
    assert (
        selectors.expression_of(size)
        == "part.edges().filter_by(GeomType.LINE).filter_by(lambda e: abs(e.length - 30) < 0.003).sort_by(Axis.X)[-1]"
    )
    area = {
        "of": "faces",
        "prefix": {"by": "size", "type": "PLANE", "size": 1180.5, "within": 0.11805},
        "terminal": {"group": 2, "at": -1, "then": 0, "thenAt": 0},
    }
    assert (
        selectors.expression_of(area)
        == "part.faces().filter_by(GeomType.PLANE).filter_by(lambda f: abs(f.area - 1180.5) < 0.1181)"
        ".group_by(Axis.Z)[-1].sort_by(Axis.X)[0]"
    )


def test_the_search_still_finds_by_radius_and_by_size_with_the_same_text(monkeypatch, built):
    # Where only a value tells the face, the form is by radius or by size and its text is what the search wrote.
    original = selectors._Search._candidates

    def only_values(self, facts):
        return (c for c in original(self, facts) if c[0] == "by geometry" and c[1]["prefix"]["by"] in ("radius", "size"))

    monkeypatch.setattr(selectors._Search, "_candidates", only_values)
    reply = described(built, "F6")
    selector = reply["selector"]
    assert selector is not None and selector["form"]["prefix"]["by"] in ("radius", "size")
    assert selectors.expression_of(selector["form"]) == selector["expression"]


GOOD = {"of": "faces", "prefix": {"by": "type", "type": "PLANE"}, "terminal": {"only": True}}


def with_(prefix=None, terminal=None, of="faces", **more):
    form = {"of": of, "prefix": prefix if prefix is not None else {"by": "type", "type": "PLANE"}, "terminal": terminal if terminal is not None else {"only": True}}
    form.update(more)
    return form


REFUSED = {
    "an order terminal": with_(terminal={"order": 2, "index": 1}),
    "axis 3": with_(prefix={"by": "axis", "axis": 3}, terminal={"end": 2, "at": -1}),
    "axis -1": with_(prefix={"by": "axis", "axis": -1}),
    "an axis that is a float": with_(prefix={"by": "axis", "axis": 2.0}),
    "an axis that is a bool": with_(prefix={"by": "axis", "axis": True}),
    "a type that is text": with_(prefix={"by": "type", "type": "PLANE) or True or (1"}),
    "a type that is no GeomType": with_(prefix={"by": "type", "type": "BLOB"}),
    "a lowercase type": with_(prefix={"by": "type", "type": "plane"}),
    "a NaN centre": with_(prefix={"by": "at", "type": "PLANE", "center": [float("nan"), 0, 0]}),
    "an infinite centre": with_(prefix={"by": "at", "type": "PLANE", "center": [float("inf"), 0, 0]}),
    "a centre of two": with_(prefix={"by": "at", "type": "PLANE", "center": [0, 0]}),
    "an unknown key in a prefix": with_(prefix={"by": "type", "type": "PLANE", "extra": 1}),
    "an unknown prefix": with_(prefix={"by": "everything"}),
    "a string where a number is": with_(prefix={"by": "radius", "type": "CYLINDER", "radius": "4"}),
    "a bool where a number is": with_(prefix={"by": "radius", "type": "CYLINDER", "radius": True}),
    "a within of zero": with_(prefix={"by": "size", "type": "PLANE", "size": 10, "within": 0}),
    "a huge number": with_(prefix={"by": "radius", "type": "CYLINDER", "radius": 1e300}),
    "an end of 1": with_(terminal={"end": 2, "at": 1}),
    "an end that is text": with_(terminal={"end": "2", "at": 0}),
    "a terminal with two kinds": with_(terminal={"only": True, "end": 2, "at": 0}),
    "an unknown key in a terminal": with_(terminal={"end": 2, "at": 0, "x": 1}),
    "an only that is not true": with_(terminal={"only": False}),
    "a group on one axis": with_(terminal={"group": 1, "at": 0, "then": 1, "thenAt": 0}),
    "a group with a bad end": with_(terminal={"group": 0, "at": 0, "then": 1, "thenAt": 2}),
    "an unknown key in the form": with_(extra="x"),
    "a form that is text": "part.faces()[0]",
    "a form that is a list": [GOOD],
    "no form": None,
    "edges for a face": with_(of="edges"),
    "an unknown of": with_(of="shells"),
}


@pytest.mark.parametrize("name", list(REFUSED))
def test_parse_form_refuses_what_it_did_not_make_and_never_raises(name):
    assert selectors.parse_form(REFUSED[name], "face") is None


def test_parse_form_takes_the_forms_the_search_makes_and_checks_the_kind():
    assert selectors.parse_form(GOOD, "face") == GOOD
    assert selectors.parse_form(GOOD, "edge") is None  # a form of faces is no form of an edge
    assert selectors.parse_form(with_(of="edges"), "edge") == with_(of="edges")
    assert selectors.parse_form(GOOD, "wire") is None
    # whole numbers are numbers, and the answer does not share the caller's lists
    raw = with_(prefix={"by": "at", "type": "PLANE", "center": [1, 2, 3]})
    parsed = selectors.parse_form(raw, "face")
    assert parsed == raw and parsed["prefix"]["center"] is not raw["prefix"]["center"]


def test_the_kernel_never_evaluates_a_text_it_did_not_make(built):
    hostile = with_(prefix={"by": "type", "type": "PLANE) or __import__('os').system('true') or (1"})
    assert selectors.parse_form(hostile, "face") is None
    assert selectors.expression_of(GOOD) == "part.faces().filter_by(GeomType.PLANE)[0]"
