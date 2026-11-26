"""The parts shelf: ``shelf.read`` in a worker (the op ``shelf``) and ``scene.shelf`` of a build."""

import shutil
import sys
from pathlib import Path

import pytest
from kclient import Kernel

from torno_kernel import shelf

WS = Path(__file__).parent / "fixtures" / "ws"


def read(root: Path, timeout: float = 60, **fields) -> dict:
    k = Kernel()
    try:
        id = k.send("shelf", root=str(root), **fields)
        reply, blob = k.recv(timeout)
        assert reply["id"] == id and blob == b"", reply
        return reply
    finally:
        k.close()


@pytest.fixture
def shelved(tmp_path) -> Path:
    """A workspace of its own with the fixture's parts, a part that does not build, and folders that are no parts."""
    parts = tmp_path / "common" / "parts"
    shutil.copytree(WS / "common", tmp_path / "common")
    (parts / "bad_part").mkdir()
    (parts / "bad_part" / "part.py").write_text(
        '"""Bad part\nA part whose body fails."""\nfrom dataclasses import dataclass\n\n'
        "@dataclass\nclass Params:\n    w: float = 3.0  # assumed: a width\n\n"
        "def body(p):\n    raise ValueError('the body is no good')\n"
    )
    for name in ("not-an-id", "Upper", "class", "1st", "no_file"):
        (parts / name).mkdir()
        (parts / name / "part.py").write_text("def body(p): ...\n")
    (parts / "no_file" / "part.py").unlink()
    (parts / "a_link").symlink_to(parts / "ec11", target_is_directory=True)
    (parts / "notes.txt").write_text("not a folder")
    return tmp_path


def test_the_shelf_lists_the_parts_sorted_and_skips_what_is_no_part(shelved):
    reply = read(shelved)
    assert reply["ok"], reply
    assert [p["id"] for p in reply["shelf"]["parts"]] == ["bad_part", "ec11"]


def test_a_part_says_its_name_what_it_is_its_params_with_their_sources_and_its_files(shelved):
    (shelved / "common" / "parts" / "ec11" / "datasheet.pdf").write_bytes(b"%PDF")
    (shelved / "common" / "parts" / "ec11" / ".hidden").write_text("x")
    (shelved / "common" / "parts" / "ec11" / ".torno").mkdir()
    ec11 = next(p for p in read(shelved)["shelf"]["parts"] if p["id"] == "ec11")
    assert ec11["name"] == "EC11 rotary encoder"
    assert ec11["what"].startswith("Alps-style rotary encoder")
    assert ec11["files"] == ["datasheet.pdf"]
    assert "error" not in ec11
    docs = {p["name"]: p["doc"] for p in ec11["params"]}
    assert docs["shaft_d"] == "datasheet EC11: the shaft's diameter"
    assert docs["body_w"].startswith("measured:") and docs["body_h"].startswith("assumed:") and docs["hole_d"].startswith("derived:")
    assert next(p for p in ec11["params"] if p["name"] == "hole_d")["default"] == 7.2


def test_a_part_is_drawn_in_millimetres_from_its_defaults(shelved):
    ec11 = next(p for p in read(shelved)["shelf"]["parts"] if p["id"] == "ec11")
    assert ec11["body"]["bbox"] == {"min": [-6, -6, -6.5], "max": [6, 6, 15]}
    side = ec11["body"]["side"]
    assert len(side) == 1 and "hole" not in side[0]
    us, vs = [p[0] for p in side[0]["points"]], [p[1] for p in side[0]["points"]]
    # x is X across and y is Z up: the shaft above the panel, the body below it.
    assert (min(us), max(us), min(vs), max(vs)) == (-6, 6, -6.5, 15)
    cutout = ec11["cutout"]
    assert cutout["size"] == {"d": pytest.approx(7.2)}
    assert len(cutout["plan"]) == 1 and len(cutout["plan"][0]["points"]) >= 12
    radii = {round((u * u + v * v) ** 0.5, 6) for u, v in cutout["plan"][0]["points"]}
    assert all(abs(r - 3.6) < 1e-6 for r in radii)
    zs = [v for _, v in cutout["side"][0]["points"]]
    assert (min(zs), max(zs)) == (-3, 1)
    keepout = ec11["keepout"]
    assert keepout["bbox"] == {"min": [-8, -8, -10], "max": [8, 8, 0]}
    assert {tuple(p) for p in keepout["plan"][0]["points"]} == {(8, 8), (-8, 8), (-8, -8), (8, -8)}


def test_a_cutout_that_is_not_round_is_sized_by_the_box_of_its_plan(shelved):
    source = shelved / "common" / "parts" / "ec11" / "part.py"
    source.write_text(
        source.read_text().replace("Pos(0, 0, -1) * Cylinder(p.hole_d / 2, 4)", "Pos(0, 0, -1) * Box(33.4, 18.4, 4)")
    )
    ec11 = next(p for p in read(shelved)["shelf"]["parts"] if p["id"] == "ec11")
    assert ec11["cutout"]["size"] == {"w": pytest.approx(33.4), "h": pytest.approx(18.4)}


def test_a_part_that_fails_is_that_parts_error_and_the_rest_is_still_read(shelved):
    bad = next(p for p in read(shelved)["shelf"]["parts"] if p["id"] == "bad_part")
    assert bad["name"] == "Bad part" and bad["what"] == "A part whose body fails."
    assert "ValueError: the body is no good" in bad["error"]
    assert "body" not in bad
    # The traceback starts in the part's own file, as a build's does.
    assert "Traceback" in bad["error"] and "kernel/src" not in bad["error"].replace("\\", "/")
    assert [p["name"] for p in bad["params"]] == ["w"]


def test_a_part_that_cannot_be_imported_says_why(shelved):
    (shelved / "common" / "parts" / "bad_part" / "part.py").write_text("import nothing_like_this\n")
    bad = next(p for p in read(shelved)["shelf"]["parts"] if p["id"] == "bad_part")
    assert "nothing_like_this" in bad["error"] and bad["params"] == []


def test_a_part_with_no_body_or_a_cutout_that_misses_the_panel_is_an_error(shelved):
    source = shelved / "common" / "parts" / "ec11" / "part.py"
    source.write_text(source.read_text().replace("Pos(0, 0, -1) * Cylinder", "Pos(0, 0, 20) * Cylinder"))
    ec11 = next(p for p in read(shelved)["shelf"]["parts"] if p["id"] == "ec11")
    assert "cutout" not in ec11 and "nothing at z = -0.5" in ec11["error"]
    assert "body" in ec11 and "keepout" in ec11


def test_a_part_that_takes_too_long_is_stopped_alone(shelved, monkeypatch):
    (shelved / "common" / "parts" / "bad_part" / "part.py").write_text("import time\ntime.sleep(30)\n")
    assert "error" not in shelf.read(shelved)["parts"][1]  # warm: the first drawing of a process is slow
    monkeypatch.setattr(shelf, "PART_SECONDS", 1.0)
    parts = shelf.read(shelved)["parts"]
    assert "more than 1 s" in parts[0]["error"] and parts[1]["id"] == "ec11" and "error" not in parts[1]


def test_no_more_than_sixty_parts_and_a_workspace_with_no_shelf_is_empty(tmp_path):
    assert read(tmp_path)["shelf"] == {"parts": []}
    for n in range(70):
        (tmp_path / "common" / "parts" / f"p{n:02d}").mkdir(parents=True)
        (tmp_path / "common" / "parts" / f"p{n:02d}" / "part.py").write_text("")
    assert len(shelf.part_ids(tmp_path)) == 60


def test_an_outline_has_at_most_four_hundred_points(shelved):
    source = shelved / "common" / "parts" / "ec11" / "part.py"
    source.write_text(
        source.read_text().replace("Pos(0, 0, -1) * Cylinder(p.hole_d / 2, 4)", "Pos(0, 0, -1) * Cylinder(3000, 4)")
    )
    ec11 = next(p for p in read(shelved)["shelf"]["parts"] if p["id"] == "ec11")
    assert 100 < len(ec11["cutout"]["plan"][0]["points"]) <= 400


def test_thinning_keeps_the_shape_of_a_ring_within_the_cap():
    import math

    ring = [[100 * math.cos(t * 2 * math.pi / 1500), 100 * math.sin(t * 2 * math.pi / 1500)] for t in range(1500)]
    thin = shelf._thin(ring)
    assert 50 < len(thin) <= 400 and len(shelf._thin(ring[:300])) == 300
    assert all(abs(math.hypot(u, v) - 100) < 1e-9 for u, v in thin)


def test_the_shelf_writes_nothing_and_the_part_keeps_no_bytecode(shelved):
    before = sorted(str(p.relative_to(shelved)) for p in shelved.rglob("*"))
    read(shelved)
    assert sorted(str(p.relative_to(shelved)) for p in shelved.rglob("*")) == before


@pytest.mark.parametrize("fields", [{"root": 3}, {"root": "x", "timeout": -1}, {"root": "x", "timeout": "soon"}])
def test_a_malformed_shelf_request_is_a_bad_request(fields):
    k = Kernel()
    try:
        fields = {"root": "x", **fields}
        id = k.send("shelf", **fields)
        reply, _ = k.recv(5)
        assert reply["id"] == id and reply["error"]["kind"] == "bad_request"
    finally:
        k.close()


def test_a_second_read_while_one_runs_is_busy_and_a_slow_one_times_out(shelved):
    (shelved / "common" / "parts" / "bad_part" / "part.py").write_text("import time\ntime.sleep(30)\n")
    k = Kernel()
    try:
        first = k.send("shelf", root=str(shelved), timeout=2)
        second = k.send("shelf", root=str(shelved))
        busy, _ = k.recv(5)
        assert busy["id"] == second and busy["error"]["kind"] == "busy"
        done, _ = k.recv(20)
        # The part itself is stopped at the op's time (30 s each is more than the 2 s the op has).
        assert done["id"] == first and done["ok"] is False and done["error"]["kind"] == "timeout"
        # The kernel serves on.
        assert read(shelved)["ok"]
    finally:
        k.close()


# scene.shelf: which parts of the shelf a project used, and how many times it called each.

PANEL = """
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from dataclasses import dataclass
from build123d import Box, Pos
from common.parts.ec11.part import Params as EC11, cutout as ec11_cutout

@dataclass
class Params:
    w: float = 40.0

def assembly(p):
    panel = Box(p.w, 30, 3)
    panel = panel - Pos(-10, 0, 0) * ec11_cutout(EC11())
    panel = panel - Pos(10, 0, 0) * ec11_cutout(EC11())
    return {"panel": panel}
"""


def build(root: Path, name: str, source: str) -> dict:
    (root / name).mkdir()
    (root / name / f"{name}.py").write_text(source)
    k = Kernel()
    try:
        reply, _ = k.build(root / name, f"{name}.py")
        assert reply["ok"], reply
        return reply["scene"]
    finally:
        k.close()


def test_a_project_that_calls_a_parts_cutout_twice_has_the_part_counted_twice(shelved):
    scene = build(shelved, "panel", PANEL)
    assert "common/parts/ec11/part.py" in scene["uses"]
    if sys.version_info >= (3, 12):
        assert scene["shelf"] == {"ec11": 2}
    else:
        assert scene["shelf"] == {"ec11": None}


def test_a_part_with_no_cutout_is_counted_by_its_body(shelved):
    source = shelved / "common" / "parts" / "ec11" / "part.py"
    source.write_text(source.read_text().split("def cutout")[0])
    scene = build(shelved, "panel", PANEL.replace("cutout as ec11_cutout", "body as ec11_cutout").replace("panel - Pos", "panel + Pos"))
    if sys.version_info >= (3, 12):
        assert scene["shelf"] == {"ec11": 2}


def test_a_project_that_uses_no_part_has_no_shelf_and_the_part_is_not_watched(shelved):
    scene = build(shelved, "plain", "from build123d import Box\nb = Box(1, 2, 3)\n")
    assert "shelf" not in scene
    if hasattr(sys, "monitoring"):
        assert all(sys.monitoring.get_tool(t) is None for t in (3, 4))


def test_the_monitoring_is_given_back_after_a_build(shelved):
    if not hasattr(sys, "monitoring"):
        pytest.skip("no sys.monitoring before Python 3.12")
    from torno_kernel.loader import load_model

    (shelved / "panel").mkdir()
    (shelved / "panel" / "panel.py").write_text(PANEL)
    report: dict = {}
    load_model(shelved / "panel", "panel.py", None, report)
    assert report["shelf_calls"] == {"ec11": 2}
    assert all(sys.monitoring.get_tool(t) is None for t in (3, 4))
