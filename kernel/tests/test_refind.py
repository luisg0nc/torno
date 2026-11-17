"""``selectors`` (the forms of several faces of one part) and ``refind`` (a stored face or edge found again)."""

import math

import pytest
from build123d import Box, Cylinder, Face, GeomType, Pos, Rectangle, extrude

from torno_kernel import queries, refind, selectors, topo
from torno_kernel.tess import build_scene

LAYOUT = "main"


def shapes_of(part, name="plate"):
    _, _, shapes = build_scene({LAYOUT: {name: part}}, f"{name}.py")
    return shapes


def holed(base):
    return base - Pos(10, 0, 0) * Cylinder(4, 5) - Pos(-10, 0, 0) * Cylinder(2, 5)


@pytest.fixture(scope="module")
def plate():
    return holed(Box(40, 30, 5))


@pytest.fixture(scope="module")
def built(plate):
    return shapes_of(plate)


@pytest.fixture(scope="module")
def renumbered():
    """The same plate, made by an extrusion: its faces come in another order, and the top is F4 where it was F2."""
    return shapes_of(holed(Pos(0, 0, -2.5) * extrude(Rectangle(40, 30), 5)))


def selectors_of(shapes, refs, **args):
    return queries.run(shapes, "selectors", {"layout": LAYOUT, "refs": refs, **args})["selectors"]


def refind_of(shapes, members, layout=LAYOUT):
    return queries.run(shapes, "refind", {"layout": layout, "members": members})["members"]


def faces_of(shapes):
    return [f"plate/F{i}" for i in range(len(topo.faces(shapes["main:plate"])))]


def edges_of(shapes):
    return [f"plate/E{i}" for i in range(len(topo.edges(shapes["main:plate"])))]


def face_member(entry, **over):
    """What main stores of a face from the answer of ``selectors``: its form, point and normal."""
    selector = entry["selector"]
    member = {
        "part": "plate",
        "kind": "face" if "/F" in entry["ref"] else "edge",
        "type": entry["type"],
        "point": entry["center"],
        "within": 0.5,
    }
    if selector is not None and "form" in selector:
        member["form"] = selector["form"]
    if "normal" in entry:
        member["normal"] = entry["normal"]
    member.update(over)
    return member


def top_of(shapes):
    key = "main:plate"
    return next(
        f"plate/F{i}"
        for i, f in enumerate(topo.faces(shapes[key]))
        if Face(f).geom_type == GeomType.PLANE and Face(f).normal_at().Z > 0.99
    )


# selectors: the forms of several faces in one pass


def test_selectors_answers_one_entry_per_ref_in_order(built):
    refs = ["plate/F2", "plate/F6", "plate/E16"]
    told = selectors_of(built, refs)
    assert [t["ref"] for t in told] == refs
    top, hole, edge = told
    assert top["type"] == "PLANE" and top["selector"]["robust"] == "by geometry" and "form" in top["selector"]
    assert top["normal"] == pytest.approx([0, 0, 1], abs=1e-9) and top["center"][2] == pytest.approx(2.5, abs=1e-9)
    assert hole["type"] == "CYLINDER"
    assert edge["type"] == "LINE" and "normal" not in edge
    assert selectors.expression_of(top["selector"]["form"]) == top["selector"]["expression"]


def test_the_centre_told_is_on_the_face_so_that_the_point_finds_it_again(built):
    # A hole's centre of mass is on its axis, in no material: the point told is the face's own nearest to it.
    hole = selectors_of(built, ["plate/F6"])[0]
    near = queries.run(built, "nearest", {"layout": LAYOUT, "anchors": [{"part": "plate", "point": hole["center"]}]})
    assert near["anchors"][0]["distance"] == pytest.approx(0, abs=1e-6)
    assert near["anchors"][0]["ref"] == "plate/F6"
    circle = selectors_of(built, ["plate/E9"])[0]
    on = queries.run(built, "nearest", {"layout": LAYOUT, "anchors": [{"part": "plate", "point": circle["center"]}]})
    assert on["anchors"][0]["distance"] == pytest.approx(0, abs=1e-6)


def test_selectors_of_three_refs_gives_three_entries_and_none_out_of_time_at_a_budget_of_zero(built, monkeypatch):
    refs = ["plate/F0", "plate/F1", "plate/F2"]
    assert len(selectors_of(built, refs)) == 3
    monkeypatch.setattr(selectors, "SELECTORS_BUDGET", 0.0)
    told = selectors_of(built, refs)
    assert len(told) == 3
    for entry in told:
        assert entry["selector"] is None and entry["selectorWhy"] == "out of time"
        # what is not the selector is still told
        assert entry["type"] == "PLANE" and len(entry["center"]) == 3 and "normal" in entry


def test_selectors_shares_one_budget_and_it_is_20_seconds():
    assert selectors.SELECTORS_BUDGET == 20.0


def test_selectors_refuses_refs_of_two_parts_and_things_that_are_not_faces_or_edges(built):
    for refs in (["plate/F0", "lid/F0"], ["plate"], ["plate/@top"], [1], "plate/F0"):
        with pytest.raises(queries.QueryError) as caught:
            selectors_of(built, refs)
        assert caught.value.kind == "bad_request"
    with pytest.raises(queries.QueryError) as caught:
        queries.run(built, "selectors", {"refs": ["plate/F0"]})
    assert caught.value.kind == "bad_request"


def test_a_stale_ref_gives_its_entry_a_selector_why_and_the_batch_goes_on(built):
    told = selectors_of(built, ["plate/F2", "plate/F99", "plate/E99", "plate/F0"])
    assert [t["ref"] for t in told] == ["plate/F2", "plate/F99", "plate/E99", "plate/F0"]
    assert told[0]["selector"] is not None and told[3]["selector"] is not None
    for stale in told[1:3]:
        assert stale["selector"] is None and "has no" in stale["selectorWhy"] and "type" not in stale


def test_selectors_names_a_part_the_layout_does_not_have(built):
    with pytest.raises(queries.QueryError) as caught:
        selectors_of(built, ["slab/F0"])
    assert caught.value.kind == "bad_ref"


def test_each_ref_has_at_most_the_search_budget_of_what_is_left(built, monkeypatch):
    seen = []
    original = selectors.selector_for

    def spy(part, target, kind, budget=selectors.BUDGET, clock=None):
        seen.append(budget)
        return original(part, target, kind, budget)

    monkeypatch.setattr(selectors, "selector_for", spy)
    monkeypatch.setattr(selectors, "SELECTORS_BUDGET", 1000.0)
    selectors_of(built, ["plate/F0", "plate/F1"])
    assert seen and all(b <= selectors.BUDGET for b in seen)


def test_the_unknown_query_message_names_the_new_queries(built):
    with pytest.raises(queries.QueryError) as caught:
        queries.run(built, "nope", {})
    assert "selectors" in caught.value.message and "refind" in caught.value.message


# refind: the same build


def test_refind_finds_every_member_by_its_selector_with_the_same_ref(built):
    refs = faces_of(built) + edges_of(built)
    told = selectors_of(built, refs)
    members = [face_member(t) for t in told]
    found = refind_of(built, members)
    assert len(found) == len(refs)
    for ref, one in zip(refs, found):
        assert one["found"] == "selector" and one["ref"] == ref, (ref, one)
        assert one["point"] and one["type"]
    # a face is told with its normal, an edge without
    assert all("normal" in f for f, r in zip(found, refs) if "/F" in r)
    assert all("normal" not in f for f, r in zip(found, refs) if "/E" in r)


def test_refind_tells_the_point_and_normal_where_the_face_is_now(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    found = refind_of(built, [face_member(entry, point=[3.0, 4.0, 2.4])])[0]
    assert found["point"] == pytest.approx([3.0, 4.0, 2.5], abs=1e-6)
    assert found["normal"] == pytest.approx([0, 0, 1], abs=1e-9) and found["type"] == "PLANE"


# refind: the faces renumbered (Review Focus 1)


def test_a_face_renumbered_by_an_edit_is_found_by_its_selector_with_its_new_ref(built, renumbered):
    old, new = top_of(built), top_of(renumbered)
    assert old != new
    entry = selectors_of(built, [old])[0]
    found = refind_of(renumbered, [face_member(entry)])[0]
    assert found["found"] == "selector" and found["ref"] == new


def test_every_face_and_edge_of_the_plate_is_found_again_after_the_renumbering(built, renumbered):
    refs = faces_of(built)
    told = selectors_of(built, refs)
    found = refind_of(renumbered, [face_member(t) for t in told])
    # the same faces, by where they are: the new ref is the one at the old point
    for old, one in zip(told, found):
        assert one["found"] == "selector", (old["ref"], one)
        near = queries.run(
            renumbered, "nearest", {"layout": LAYOUT, "anchors": [{"part": "plate", "point": old["center"]}]}
        )["anchors"][0]
        assert near["distance"] == pytest.approx(0, abs=1e-6)
        assert one["ref"] == near["ref"]


# refind: a selector's face is not taken on trust (Review Focus 2)


def test_a_selector_whose_face_has_another_type_is_not_accepted(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    found = refind_of(built, [face_member(entry, type="CYLINDER")])[0]
    # the form still gives the top, but it is not a cylinder: the point and normal find a face there all the same
    assert found["found"] == "nearest" and found["ref"] == "plate/F2"


def test_a_selector_whose_face_has_a_normal_15_degrees_off_is_not_accepted(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    turned = [0.0, math.sin(math.radians(15)), math.cos(math.radians(15))]
    found = refind_of(built, [face_member(entry, normal=turned)])[0]
    assert found["found"] == "lost" and "why" in found and "ref" not in found


def test_a_normal_9_degrees_off_is_still_the_face(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    turned = [0.0, math.sin(math.radians(9)), math.cos(math.radians(9))]
    found = refind_of(built, [face_member(entry, normal=turned)])[0]
    assert found["found"] == "selector" and found["ref"] == "plate/F2"
    assert refind.NORMAL_DEGREES == 10.0


def test_a_face_the_selector_does_not_give_is_found_by_point_and_normal(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    form = {"of": "faces", "prefix": {"by": "type", "type": "CYLINDER"}, "terminal": {"end": 0, "at": 0}}
    found = refind_of(built, [face_member(entry, form=form)])[0]
    assert found["found"] == "nearest" and found["ref"] == "plate/F2"


def test_an_only_prefix_must_give_exactly_one_face(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    many = {"of": "faces", "prefix": {"by": "type", "type": "PLANE"}, "terminal": {"only": True}}
    found = refind_of(built, [face_member(entry, form=many)])[0]
    assert found["found"] == "nearest"


def test_a_form_that_holds_text_or_an_order_terminal_is_no_form(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    for form in (
        {"of": "faces", "prefix": {"by": "type", "type": "PLANE) or True or (1"}, "terminal": {"only": True}},
        {"of": "faces", "prefix": {"by": "axis", "axis": 2}, "terminal": {"order": 2, "index": 0}},
        "part.faces()[0]",
        7,
    ):
        found = refind_of(built, [face_member(entry, form=form)])[0]
        assert found["found"] == "nearest" and found["ref"] == "plate/F2", form


def test_a_member_with_no_form_is_found_nearest(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    member = face_member(entry)
    del member["form"]
    found = refind_of(built, [member])[0]
    assert found["found"] == "nearest" and found["ref"] == "plate/F2" and found["type"] == "PLANE"


def test_a_member_with_no_form_picks_the_face_whose_normal_agrees_at_an_edge(built):
    # On the rim of the top and the +X side, the normal says which of the two is meant.
    point = [20.0, 0.0, 2.5]
    top = refind_of(built, [{"part": "plate", "kind": "face", "point": point, "normal": [0, 0, 1], "within": 0.5}])[0]
    side = refind_of(built, [{"part": "plate", "kind": "face", "point": point, "normal": [1, 0, 0], "within": 0.5}])[0]
    assert top["ref"] == "plate/F2" and side["ref"] == "plate/F5"
    assert top["found"] == side["found"] == "nearest"


def test_a_face_farther_than_within_is_lost_and_nearer_is_found(built):
    near = {"part": "plate", "kind": "face", "point": [0, 0, 2.9], "normal": [0, 0, 1], "within": 0.5}
    far = {**near, "point": [0, 0, 3.1]}
    assert refind_of(built, [near, far])[0]["found"] == "nearest"
    assert refind_of(built, [near, far])[1]["found"] == "lost"


def test_a_face_member_with_no_normal_is_found_by_its_point_alone(built):
    found = refind_of(built, [{"part": "plate", "kind": "face", "point": [0, 0, 2.5], "within": 0.5}])[0]
    assert found["found"] == "nearest" and found["ref"] == "plate/F2"


# refind: edges


def edge_member(offset):
    """The vertical edge at the corner (20, 15), a point ``offset`` mm out from it in X."""
    return {"part": "plate", "kind": "edge", "point": [20.0 + offset, 15.0, 0.0], "within": 0.5}


def test_an_edge_within_half_a_millimetre_is_found_and_at_0_6_it_is_lost(built):
    found = refind_of(built, [edge_member(0.4), edge_member(0.6), edge_member(0.0)])
    assert found[0]["found"] == "nearest" and found[0]["ref"] == found[2]["ref"]
    assert found[0]["point"] == pytest.approx([20.0, 15.0, 0.0], abs=1e-6) and found[0]["type"] == "LINE"
    assert "normal" not in found[0]
    assert found[1]["found"] == "lost" and "why" in found[1]


def test_an_edge_selector_of_another_type_is_not_accepted(built):
    entry = selectors_of(built, ["plate/E16"])[0]
    member = face_member(entry, type="CIRCLE")
    found = refind_of(built, [member])[0]
    # the point is on the line E16 all the same: the nearest edge to it is found
    assert found["found"] == "nearest" and found["ref"] == "plate/E16"


# refind: what cannot be found


def test_a_part_the_layout_lacks_is_lost_and_says_so(built):
    member = {"part": "block", "kind": "face", "point": [0, 0, 0], "normal": [0, 0, 1], "within": 0.5}
    found = refind_of(built, [member, {**member, "part": "plate", "point": [0, 0, 2.5]}], layout="assembly")
    assert found[0] == {"found": "lost", "why": "no part block in layout assembly"}
    found = refind_of(built, [member, {**member, "part": "plate", "point": [0, 0, 2.5]}])
    assert found[0] == {"found": "lost", "why": f"no part block in layout {LAYOUT}"}
    assert found[1]["found"] == "nearest"


def test_one_bad_member_is_a_bad_request_naming_its_index(built):
    good = {"part": "plate", "kind": "face", "point": [0, 0, 2.5], "normal": [0, 0, 1], "within": 0.5}
    bad_ones = [
        {**good, "point": [0, 0]},
        {**good, "point": [0, 0, float("nan")]},
        {**good, "point": ["0", 0, 0]},
        {**good, "kind": "vertex"},
        {**good, "part": 3},
        {**good, "within": 0},
        {**good, "within": -1},
        {**good, "within": "0.5"},
        {**good, "within": float("inf")},
        {**good, "normal": [0, 0, 0]},
        {**good, "normal": [0, 1]},
        {**good, "type": 7},
        "plate/F2",
    ]
    for bad in bad_ones:
        with pytest.raises(queries.QueryError) as caught:
            refind_of(built, [good, bad])
        assert caught.value.kind == "bad_request" and "member 1" in caught.value.message, bad
    for args in ({"members": []}, {"layout": LAYOUT}, {"layout": LAYOUT, "members": "x"}):
        with pytest.raises(queries.QueryError) as caught:
            queries.run(built, "refind", args)
        assert caught.value.kind == "bad_request"
    assert queries.run(built, "refind", {"layout": LAYOUT, "members": []}) == {"members": []}


def test_refind_does_not_evaluate_a_form_that_is_not_in_the_grammar(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    form = {
        "of": "faces",
        "prefix": {"by": "type", "type": "PLANE) or __import__('os').system('touch /nonexistent/x') or (1"},
        "terminal": {"only": True},
    }
    found = refind_of(built, [face_member(entry, form=form)])[0]
    assert found["found"] == "nearest"


def test_refind_past_its_time_answers_the_rest_as_not_checked(built, monkeypatch):
    entry = selectors_of(built, ["plate/F2"])[0]
    monkeypatch.setattr(refind, "REFIND_BUDGET", 0.0)
    found = refind_of(built, [face_member(entry), face_member(entry)])
    for one in found:
        assert one["found"] == "lost" and one["unchecked"] is True and "not checked" in one["why"]


def test_refind_stops_between_members_when_its_time_runs_out(built):
    entry = selectors_of(built, ["plate/F2"])[0]
    ticks = iter(range(0, 1000, 8))
    found = refind.refind(
        built,
        {"layout": LAYOUT, "members": [face_member(entry) for _ in range(6)]},
        None,
        clock=lambda: float(next(ticks)),
    )["members"]
    assert len(found) == 6
    assert found[0]["found"] != "lost"
    assert found[-1].get("unchecked") is True
    # once one is not checked none after it is
    flags = [f.get("unchecked") is True for f in found]
    assert flags == sorted(flags)


# A selector is not taken where it is arbitrary, and the place wins over the selector


def slotted():
    """The plate with a 4 mm slot across its top, which splits the top in two halves at the same height."""
    return shapes_of(holed(Box(40, 30, 5)) - Pos(0, 0, 3) * Box(4, 40, 6))


def boss_on_top():
    """The plate with a boss on its top, away from the middle: the extreme along Z is now the boss's top."""
    return shapes_of(holed(Box(40, 30, 5)) + Pos(-15, 10, 5) * Box(6, 6, 5))


def test_a_selector_that_splits_in_two_is_no_pick(built):
    from torno_kernel import selectors as sel

    form = selectors_of(built, [top_of(built)])[0]["selector"]["form"]
    assert sel.Evaluator(built["main:plate"]).pick(form) is not None
    cut = slotted()
    assert sel.Evaluator(cut["main:plate"]).pick(form) is None


def test_a_slot_across_the_top_leaves_the_member_on_the_half_at_its_point(built):
    entry = selectors_of(built, [top_of(built)])[0]
    cut = slotted()
    on_right = face_member(entry, point=[15.0, 8.0, 2.5])
    on_left = face_member(entry, point=[-15.0, 8.0, 2.5])
    in_slot = face_member(entry, point=[0.0, 8.0, 2.5])
    found = refind_of(cut, [on_right, on_left, in_slot])
    right, left, slot = found
    assert right["found"] == "nearest" and left["found"] == "nearest" and right["ref"] != left["ref"]
    assert right["point"] == pytest.approx([15.0, 8.0, 2.5], abs=1e-6)
    assert left["point"] == pytest.approx([-15.0, 8.0, 2.5], abs=1e-6)
    # a point in the slot has no face of the top under it, and the selector is no pick: lost, not an arbitrary half
    assert slot["found"] == "lost"


def test_a_boss_on_top_leaves_the_member_on_the_original_top(built):
    entry = selectors_of(built, [top_of(built)])[0]
    grown = boss_on_top()
    # the point is on the original top, clear of the boss: the selector now names the boss's top, the place wins
    member = face_member(entry, point=[5.0, -5.0, 2.5])
    found = refind_of(grown, [member])[0]
    assert found["found"] == "nearest"
    assert found["point"] == pytest.approx([5.0, -5.0, 2.5], abs=1e-6)
    from torno_kernel import selectors as sel

    boss = sel.Evaluator(grown["main:plate"]).pick(member["form"])
    assert boss is not None  # the selector still picks something: the boss
    index = int(found["ref"].split("/F")[1])
    assert not topo.faces(grown["main:plate"])[index].IsSame(boss.wrapped)


def test_the_selector_is_used_when_nothing_of_the_type_is_left_at_the_place(built):
    # The top moved 3 mm up: no face is at the stored point, and the selector, which still gives it, finds it.
    taller = shapes_of(holed(Box(40, 30, 11)))
    entry = selectors_of(built, [top_of(built)])[0]
    found = refind_of(taller, [face_member(entry)])[0]
    assert found["found"] == "selector" and found["ref"] == top_of(taller)
    assert found["point"][2] == pytest.approx(5.5, abs=1e-6)


def test_an_edge_still_at_its_place_wins_over_its_selector(built):
    # The selector of E16 is where an edge is; an edge of its type at the stored point is kept.
    entry = selectors_of(built, ["plate/E16"])[0]
    found = refind_of(built, [face_member(entry)])[0]
    assert found["ref"] == "plate/E16" and found["found"] in ("selector", "nearest")


# Through the kernel


def test_the_kernel_answers_selectors_and_refind(tmp_path):
    from kclient import Kernel

    folder = tmp_path / "plate"
    folder.mkdir()
    (folder / "plate.py").write_text("from build123d import *\nplate = Box(40, 30, 5) - Cylinder(4, 5)\n")
    kernel = Kernel()
    try:
        reply, _ = kernel.build(folder, "plate.py", timeout=30)
        assert reply["ok"] is True
        told = kernel.query(folder, "selectors", {"layout": "main", "refs": ["plate/F2"]})
        assert told["ok"] is True
        entry = told["result"]["selectors"][0]
        member = face_member({**entry, "ref": "plate/F2"})
        found = kernel.query(folder, "refind", {"layout": "main", "members": [member]})
        bad = kernel.query(folder, "refind", {"layout": "main", "members": [{"part": "plate"}]})
    finally:
        kernel.close()
    assert found["ok"] is True and found["result"]["members"][0]["found"] == "selector"
    assert bad["ok"] is False and bad["error"]["kind"] == "bad_request"
