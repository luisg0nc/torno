"""Drives ``python -m torno_kernel`` as a subprocess through the frame codec."""

import io
import json
import math
import os
import platform
import threading
import time
from pathlib import Path

import pytest
from kclient import Kernel

from torno_kernel.frames import write_frame

WS = Path(__file__).parent / "fixtures" / "ws"
BRACKET = WS / "bracket"


@pytest.fixture(scope="module")
def kernel():
    """One kernel shared by the tests that only need it to be running."""
    k = Kernel()
    yield k
    k.close()


@pytest.fixture(scope="module")
def bracket_kernel():
    """A kernel whose live worker holds the bracket. Tests must not build on it."""
    k = Kernel()
    reply, _ = k.build(WS / "bracket", "bracket.py")
    assert reply["ok"], reply
    yield k
    k.close()


@pytest.fixture
def fresh():
    k = Kernel()
    yield k
    k.close()


def build_bracket(k: Kernel, ws) -> dict:
    reply, _ = k.build(ws / "bracket", "bracket.py")
    assert reply["ok"], reply
    return reply


def gone(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return True
    return False


def test_ready_reports_versions(kernel):
    import build123d

    assert kernel.ready == {
        "event": "ready",
        "versions": {"build123d": build123d.__version__, "python": platform.python_version()},
    }


def test_build_bracket_replies_started_then_scene_and_blob(kernel, ws):
    reply, blob = kernel.build(ws / "bracket", "bracket.py")
    assert reply["ok"] is True
    scene = reply["scene"]
    assert scene["model"] == "bracket.py"
    assert scene["layouts"] == ["assembly", "print"]
    assert [p["key"] for p in scene["parts"]] == [
        "assembly:base",
        "assembly:post",
        "print:base",
        "print:post",
    ]
    assert scene["seconds"] > 0
    assert scene["output"] == ""
    # The model's Params, read by the worker that built it.
    assert scene["params"] == [{"name": "width", "type": "float", "default": 40, "literal": True, "doc": None}]
    assert scene["groups"] == []
    bufs = [buf for p in scene["parts"] for buf in p["mesh"].values()]
    assert len(bufs) == 4 * 8
    assert all(buf["offset"] % 4 == 0 for buf in bufs)
    assert max(buf["offset"] + buf["length"] for buf in bufs) == len(blob)


def test_model_output_is_captured_and_does_not_corrupt_the_stream(kernel, ws):
    reply, _ = kernel.build(ws / "chatty", "chatty.py")
    assert reply["ok"] is True
    assert reply["scene"]["output"] == "report line\nreport line\n"
    # The next frames still parse: nothing the model printed reached the protocol stream.
    assert build_bracket(kernel, ws)["scene"]["output"] == ""


def test_model_exception_fails_the_build_and_the_kernel_survives(kernel, ws):
    reply, blob = kernel.build(ws / "broken", "broken.py")
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "exception"
    assert "wall too thin" in reply["error"]["message"]
    assert "broken.py" in reply["error"]["traceback"]
    assert blob == b""
    build_bracket(kernel, ws)


def test_model_that_exits_fails_the_build(kernel, ws):
    reply, _ = kernel.build(ws / "exits", "exits.py")
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "exception"
    assert "missing input file" in reply["error"]["message"]
    assert "exits.py" in reply["error"]["traceback"]
    build_bracket(kernel, ws)


def test_missing_model_fails_with_the_loader_kind(kernel, ws):
    reply, _ = kernel.build(ws / "noscene", "noscene.py")
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "no_scene"


def test_segfault_is_reported_as_crash_and_the_kernel_survives(kernel, ws):
    start = time.monotonic()
    reply, _ = kernel.build(ws / "crash", "crash.py", timeout=5)
    assert time.monotonic() - start < 5
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "crash"
    assert "SIGSEGV" in reply["error"]["message"]
    build_bracket(kernel, ws)


def test_hang_is_killed_at_the_deadline_and_the_kernel_survives(kernel, ws):
    id = kernel.send("build", dir=str(ws / "slow"), model="slow.py", timeout=2)
    start = time.monotonic()
    assert kernel.recv(5)[0]["event"] == "build.started"
    reply, _ = kernel.recv(4)
    assert 1.5 < time.monotonic() - start < 4
    assert reply["id"] == id
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "timeout"
    assert reply["error"]["message"] == (
        "the build did not finish within 2 s and was stopped; "
        "set TORNO_BUILD_TIMEOUT to a number of seconds to allow more"
    )
    assert "starting slow work" in reply["error"]["output"]
    build_bracket(kernel, ws)


def test_default_timeout_is_ten_minutes():
    from torno_kernel import supervisor

    assert supervisor.DEFAULT_TIMEOUT == 600
    assert supervisor.MAX_TIMEOUT == 86400


@pytest.mark.parametrize("timeout", ["NaN", "Infinity", "-Infinity", "-1", "0", "true", '"60"'])
def test_timeout_that_is_not_a_positive_finite_number_is_a_bad_request(kernel, ws, timeout):
    # Written by hand: NaN and Infinity are what a careless client's JSON holds.
    dir = str(ws / "bracket")
    kernel.send_raw(f'{{"id":"t","op":"build","dir":"{dir}","model":"bracket.py","timeout":{timeout}}}')
    reply, _ = kernel.recv(5)
    assert reply == {
        "id": "t",
        "ok": False,
        "error": {
            "kind": "bad_request",
            "message": "build timeout must be a positive, finite number of seconds",
        },
    }


def test_enormous_timeout_is_capped_and_the_build_runs(kernel, ws):
    # 1e300 s from now is no time the event loop can wait until.
    id = kernel.send("build", dir=str(ws / "bracket"), model="bracket.py", timeout=1e300)
    assert kernel.recv(5)[0]["event"] == "build.started"
    reply, _ = kernel.recv(20)
    assert reply["id"] == id and reply["ok"], reply


def test_capped_timeout_is_a_day():
    from torno_kernel.supervisor import build_timeout

    assert build_timeout(None) == 600
    assert build_timeout(1e300) == 86400
    assert build_timeout(86401) == 86400
    assert build_timeout(90) == 90.0
    for bad in (float("nan"), float("inf"), -1, 0, True, "60"):
        assert build_timeout(bad) is None


GARBAGE_MODEL = """
import os, socket, stat, struct

# Stand in for a worker gone wrong: write a frame that is not JSON, or not a
# result, on the socket the worker answers the supervisor on.
PAYLOAD = {payload!r}
for fd in range(3, 64):
    try:
        if stat.S_ISSOCK(os.fstat(fd).st_mode):
            os.write(fd, struct.pack(">II", len(PAYLOAD), 0) + PAYLOAD)
    except OSError:
        pass
import time
time.sleep(30)
"""


@pytest.mark.parametrize(
    "payload",
    [
        b"not json",
        b"null",
        b"[1]",
        b'{"ok":true}',
        b'{"ok":false}',
        # Results by their shape, which Python reads and no frame can carry on to the client.
        b'{"ok":true,"scene":{"parts":[{"volume":NaN}]}}',
        b'{"ok":true,"scene":{"model":"\\ud800"}}',
        b'{"ok":false,"error":{"message":"\\udfff"}}',
    ],
)
def test_worker_frame_that_is_no_result_is_a_crash_of_that_build_only(fresh, ws, tmp_path, payload):
    (tmp_path / "garbage.py").write_text(GARBAGE_MODEL.format(payload=payload))
    id = fresh.send("build", dir=str(tmp_path), model="garbage.py")
    started, _ = fresh.recv(5)
    assert started["event"] == "build.started"
    reply, _ = fresh.recv(5)
    assert reply["id"] == id
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "crash"
    assert reply["error"]["message"] == "the build process sent a result that could not be read"
    assert gone(started["pid"])
    # The supervisor is still there.
    assert fresh.proc.poll() is None
    build_bracket(fresh, ws)


def test_new_build_cancels_the_running_one(kernel, ws):
    slow = kernel.send("build", dir=str(ws / "slow"), model="slow.py")
    slow_started, _ = kernel.recv(5)
    time.sleep(0.5)
    quick = kernel.send("build", dir=str(ws / "bracket"), model="bracket.py")
    frames = [kernel.recv(20)[0] for _ in range(3)]
    finals = [f for f in frames if "ok" in f]
    assert [(f["id"], f["ok"]) for f in finals] == [(slow, False), (quick, True)]
    assert finals[0]["error"]["kind"] == "cancelled"
    assert [f for f in frames if "event" in f] == [
        {"id": quick, "event": "build.started", "pid": frames[1]["pid"], "retired": []}
    ]
    assert gone(slow_started["pid"])
    # Nothing else follows: exactly two final replies.
    with pytest.raises(TimeoutError):
        kernel.recv(0.5)


def test_cancel_kills_the_running_build(kernel, ws):
    slow = kernel.send("build", dir=str(ws / "slow"), model="slow.py")
    started, _ = kernel.recv(5)
    kernel.send("cancel")
    reply, _ = kernel.recv(5)
    assert reply["id"] == slow
    assert reply["error"]["kind"] == "cancelled"
    assert gone(started["pid"])
    with pytest.raises(TimeoutError):
        kernel.recv(0.3)


def test_describe_part(bracket_kernel):
    reply = bracket_kernel.describe(BRACKET, "assembly:base")
    assert reply["ok"] is True
    result = reply["result"]
    assert result["kind"] == "part"
    assert result["key"] == "assembly:base"
    assert result["volume"] == pytest.approx(6000)
    assert result["area"] == pytest.approx(2 * (40 * 30 + 40 * 5 + 30 * 5))
    assert result["bbox"]["min"] == pytest.approx([-20, -15, -2.5])
    assert result["bbox"]["max"] == pytest.approx([20, 15, 2.5])
    assert (result["faceCount"], result["edgeCount"], result["valid"]) == (6, 12, True)


def test_describe_planar_face(bracket_kernel):
    result = bracket_kernel.describe(BRACKET, "assembly:base/F0")["result"]
    assert result["kind"] == "face"
    assert result["ref"] == "assembly:base/F0"
    assert result["type"] == "plane"
    assert result["area"] == pytest.approx(150)
    assert math.hypot(*result["normal"]) == pytest.approx(1)
    assert result["center"] == pytest.approx([-20, 0, 0])
    assert result["normal"] == pytest.approx([-1, 0, 0])
    assert result["radius"] is None


def test_describe_cylindrical_face_gives_its_radius_in_the_object_frame(bracket_kernel):
    count = bracket_kernel.describe(BRACKET, "assembly:post")["result"]["faceCount"]
    faces = [bracket_kernel.describe(BRACKET, f"assembly:post/F{i}")["result"] for i in range(count)]
    cylinders = [f for f in faces if f["type"] == "cylinder"]
    assert len(cylinders) == 1
    assert cylinders[0]["radius"] == pytest.approx(4)
    # The post stands 12.5 mm up in the assembly: positions are not part-local.
    assert cylinders[0]["center"][2] == pytest.approx(12.5)


def test_describe_edge(bracket_kernel):
    result = bracket_kernel.describe(BRACKET, "assembly:base/E1")["result"]
    assert result == {
        "kind": "edge",
        "ref": "assembly:base/E1",
        "type": "line",
        "length": pytest.approx(30),
        "center": pytest.approx([-20, 0, 2.5]),
        "descriptor": "line, 30 mm",
    }


def test_describe_replies_carry_a_descriptor(bracket_kernel):
    assert bracket_kernel.describe(BRACKET, "assembly:base")["result"]["descriptor"] == (
        "part, 40 × 30 × 5 mm, 6000 mm³, 6 faces"
    )
    assert bracket_kernel.describe(BRACKET, "assembly:base/F0")["result"]["descriptor"] == (
        "plane, normal -X, x = -20, 150 mm²"
    )


def test_nearest_over_the_protocol(bracket_kernel):
    anchors = [
        {"part": "base", "point": [5, 3, 5.5]},
        {"part": "gone", "point": [0, 0, 0]},
        {"part": "post", "point": [7, 0, 12]},
    ]
    reply = bracket_kernel.nearest(BRACKET, "assembly", anchors)
    assert reply["ok"] is True, reply
    above, gone_part, beside = reply["result"]["anchors"]
    assert above == {
        "part": "base",
        "found": True,
        "point": pytest.approx([5, 3, 2.5]),
        "normal": pytest.approx([0, 0, 1]),
        "ref": above["ref"],
        "distance": pytest.approx(3),
        "descriptor": "plane, normal +Z, z = 2.5, 1200 mm²",
        "support": "face",
    }
    # The ref is one describe takes once the layout is put in front of it.
    assert above["ref"].startswith("base/F")
    described = bracket_kernel.describe(BRACKET, f"assembly:{above['ref']}")["result"]
    assert described["descriptor"] == above["descriptor"]
    assert gone_part == {"part": "gone", "found": False}
    assert beside["descriptor"] == "cylinder, radius 4, axis Z, 502.7 mm²"
    assert beside["distance"] == pytest.approx(3)


def test_measure_over_the_protocol_for_the_object_asked(fresh, ws):
    plate, bracket = ws / "measures", ws / "bracket"
    reply, _ = fresh.build(plate, "measures.py")
    assert reply["ok"], reply
    build_bracket(fresh, ws)
    # The bracket built last; the plate is still asked of its own worker.
    mass = fresh.query(plate, "measure", {"kind": "mass", "a": {"ref": "assembly:plate"}})
    assert mass["ok"] is True, mass
    assert mass["result"] == {
        "kind": "mass",
        "value": pytest.approx(mass["result"]["volume"] / 1000 * 1.24),
        "unit": "g",
        "how": "PLA 1.24 g/cm³ (default)",
        "density": 1.24,
        "volume": pytest.approx(7200 - 60 - 192 * math.pi - 240),
        "exact": True,
    }
    wall = {"ref": "assembly:plate/F1", "point": [0, -15, 1]}
    thickness = fresh.query(plate, "measure", {"kind": "thickness", "a": wall})["result"]
    assert (thickness["value"], thickness["how"]) == (pytest.approx(2), "wall, along the normal")
    assert thickness["points"] == [pytest.approx([0, -15, 1]), pytest.approx([0, -13, 1])]
    apart = {"kind": "distance", "a": {"ref": "assembly:post"}, "b": {"ref": "assembly:base/F0"}}
    assert fresh.query(bracket, "measure", apart)["result"]["value"] == pytest.approx(16)
    # Neither has the other's parts, and what cannot be measured is said, not raised.
    assert fresh.query(plate, "measure", apart)["error"]["kind"] == "bad_ref"
    refused = fresh.query(bracket, "measure", {"kind": "radius", "a": {"ref": "assembly:base/F0"}})
    assert refused == {
        "id": refused["id"],
        "ok": False,
        "error": {
            "kind": "bad_request",
            "message": "radius is measured of a cylindrical, spherical or toroidal face or a "
            "circular edge; assembly:base/F0 is a plane face",
        },
    }


def test_scan_clash_over_the_protocol_for_the_object_asked(fresh, ws, tmp_path):
    import scanfix

    from torno_kernel import scanfile

    vertices, triangles = scanfix.grid(20)
    scanfile.write_bin(tmp_path / "S1.bin", vertices + [0, 0, 1], triangles)
    scan = {"id": "S1", "path": str(tmp_path / "S1.bin"), "transform": {"t": [0, 0, 0], "q": [0, 0, 0, 1], "s": 1}}
    reply, _ = fresh.build(ws / "hollow", "hollow.py")
    assert reply["ok"], reply
    build_bracket(fresh, ws)
    # The sheet lies in the tub's floor, 2 mm thick from z = 0: each of its 400 vertices is 1 mm deep.
    floor = fresh.query(ws / "hollow", "scan_clash", {"layout": "assembly", "part": "tub", "scan": scan})
    assert floor["ok"] is True, floor
    assert floor["result"]["inside"]["count"] == 400 and floor["result"]["exact"] is False
    assert floor["result"]["deepest"]["depth"] == pytest.approx(1, abs=1e-9)
    # The bracket built last; each object is asked of its own worker.
    base = fresh.query(ws / "bracket", "scan_clash", {"layout": "assembly", "part": "base", "scan": scan})
    assert base["result"]["part"] == "base" and base["result"]["inside"]["count"] == 400
    # A scan that cannot be read is that query's failure: the worker goes on answering.
    gone = fresh.query(ws / "hollow", "scan_clash", {"layout": "assembly", "part": "tub", "scan": {**scan, "path": str(tmp_path / "gone.bin")}})
    assert gone["ok"] is False and gone["error"]["kind"] == "bad_request"
    assert fresh.query(ws / "hollow", "describe", {"ref": "assembly:tub"})["ok"] is True


def test_scan_deviation_and_scan_section_over_the_protocol(fresh, ws, tmp_path):
    import scanfix

    from torno_kernel import scanfile

    vertices, triangles = scanfix.grid(20)
    scanfile.write_bin(tmp_path / "S1.bin", vertices, triangles)
    scan = {"id": "S1", "path": str(tmp_path / "S1.bin"), "transform": {"t": [0, 0, 1], "q": [0, 0, 0, 1], "s": 1}}
    reply, _ = fresh.build(ws / "hollow", "hollow.py")
    assert reply["ok"], reply
    # The sheet lies in the tub's floor, 2 mm thick from z = 0: a millimetre from its top and from its bottom.
    for source in ("scan", "part"):
        said = fresh.query(ws / "hollow", "scan_deviation", {"layout": "assembly", "part": "tub", "from": source, "scan": scan})
        assert said["ok"] is True, said
        result = said["result"]
        assert (result["part"], result["scan"], result["from"], result["exact"]) == ("tub", "S1", source, False)
        assert result["compared"] > 0 and result["sampling"]["retakesFailed"] == 0 and result["sampling"]["partial"] is False
        if source == "scan":
            assert result["samples"] == result["compared"] == 400 and result["signed"]["inside"] == 400
            assert result["distance"]["max"] == pytest.approx(1) and result["distance"]["mean"] == pytest.approx(1)
            assert result["worst"]["distance"] == pytest.approx(1, abs=1e-9) and result["worst"]["at"][2] == 1
        else:
            # Every point of the tub has the sheet within 50 mm, the nearest of them a millimetre from it; and the sheet is inside the tub.
            assert result["beyond"] == 0 and result["distance"]["min"] == pytest.approx(1) and result["sampling"]["scanSurface"] == 1
            assert result["signed"]["inside"] == result["compared"] and result["signed"]["max"] == pytest.approx(-1)
    # A hair under that millimetre, nothing of the scan is in reach of any point of the tub: said, with no number.
    none = fresh.query(ws / "hollow", "scan_deviation", {"layout": "assembly", "part": "tub", "within": 0.999, "scan": scan})["result"]
    assert none["compared"] == 0 and none["beyond"] == none["samples"] and none["distance"] is None and none["worst"] is None
    cut = fresh.query(ws / "hollow", "scan_section", {"layout": "assembly", "plane": {"origin": [0.25, 0, 0], "normal": [5, 0, 0]}, "scan": scan})
    assert cut["ok"] is True, cut
    assert cut["result"]["plane"] == {"origin": [0.25, 0, 0], "normal": [1, 0, 0], "x": [0, 1, 0], "y": [0, 0, 1]}
    [line] = cut["result"]["polylines"]
    assert line["closed"] is False and len(line["points"]) == 39 and {v for _, v in line["points"]} == {1}
    assert (cut["result"]["segments"], cut["result"]["pointsFound"], cut["result"]["pointsTold"], cut["result"]["thinned"], cut["result"]["exact"]) == (38, 39, 39, False, False)
    # What is refused is that query's failure, said as a request that was wrong: the worker goes on answering.
    for args in ({"layout": "nope", "plane": {"origin": [0, 0, 0], "normal": [1, 0, 0]}, "scan": scan}, {"layout": "assembly", "plane": {"origin": [0, 0, 0], "normal": [1e-200, 0, 0]}, "scan": {**scan, "transform": {"t": [0, 0, 0], "q": [1e-200, 0, 0, 0], "s": 1}}}):
        refused = fresh.query(ws / "hollow", "scan_section", args)
        assert refused["ok"] is False and refused["error"]["kind"] in ("bad_ref", "bad_request"), refused
    assert fresh.query(ws / "hollow", "describe", {"ref": "assembly:tub"})["ok"] is True


def test_section_over_the_protocol_for_the_object_asked(fresh, ws):
    plate, bracket = ws / "measures", ws / "bracket"
    reply, _ = fresh.build(plate, "measures.py")
    assert reply["ok"], reply
    build_bracket(fresh, ws)
    level = {"origin": [0, 0, 12.5], "normal": [0, 0, 1]}
    cut = fresh.query(bracket, "section", {"layout": "assembly", "plane": level})
    assert cut["ok"] is True, cut
    result = cut["result"]
    assert result["plane"] == {**level, "x": [1, 0, 0], "y": [0, 1, 0]}
    base, post = result["parts"]
    assert base == {
        "part": "base",
        "loops": [],
        "area": 0,
        "areaExact": True,
        "open": 0,
        "how": "cross-section of the solid",
    }
    [circle] = post["loops"]
    assert (circle["closed"], circle["area"]) == (True, pytest.approx(math.pi * 16))
    assert all(math.hypot(u, v) == pytest.approx(4) for u, v in circle["points"])
    assert result["bounds"] == {"min": pytest.approx([-4, -4]), "max": pytest.approx([4, 4])}
    # The plate is cut by its own worker: across its two holes and its pocket.
    across = {"layout": "assembly", "plane": {"origin": [0, 0, 0], "normal": [0, 0, 1]}}
    [part] = fresh.query(plate, "section", {**across, "parts": ["plate"]})["result"]["parts"]
    assert [loop["area"] for loop in part["loops"]] == [
        pytest.approx(1200),
        pytest.approx(-60),
        pytest.approx(-math.pi * 16),
        pytest.approx(-math.pi * 16),
    ]
    assert (part["area"], part["open"]) == (pytest.approx(1140 - 32 * math.pi), 0)
    missing = fresh.query(plate, "section", {**across, "parts": ["post"]})
    assert missing["error"] == {
        "kind": "bad_ref",
        "message": "no part 'post' in assembly; its parts are plate",
    }


def test_check_over_the_protocol_for_the_object_asked(fresh, ws):
    plate, bracket = ws / "measures", ws / "bracket"
    reply, _ = fresh.build(plate, "measures.py")
    assert reply["ok"], reply
    build_bracket(fresh, ws)

    def check(folder, kind: str, **args) -> dict:
        return fresh.query(folder, "check", {"kind": kind, "layout": "assembly", **args})

    standing = check(bracket, "clearance", a="post", b="base")
    assert standing["ok"] is True, standing
    assert (standing["result"]["distance"], standing["result"]["overlapping"]) == (0, False)
    assert standing["result"]["points"][0][2] == pytest.approx(2.5)
    assert check(bracket, "overlap", a="post", b="base")["result"] == {
        "volume": 0,
        "volumeExact": True,
        "how": "of what the two share",
        "bbox": None,
        "bboxExact": None,
    }
    mesh = check(plate, "mesh", a="plate")["result"]
    assert mesh == {"watertight": True, "openEdges": 0, "where": [], "triangles": mesh["triangles"]}
    # As many triangles as the build said the part is drawn with: it is the same mesh.
    [drawn] = reply["scene"]["parts"]
    assert mesh["triangles"] == drawn["triangleCount"]
    assert check(plate, "overlap", a="post", b="base")["error"] == {
        "kind": "bad_ref",
        "message": "no part 'post' in assembly; its parts are plate",
    }
    assert check(bracket, "mesh")["error"]["kind"] == "bad_request"


def test_nearest_in_an_unknown_layout_is_bad_ref_naming_the_layouts(bracket_kernel):
    reply = bracket_kernel.nearest(BRACKET, "exploded", [])
    assert reply["ok"] is False
    assert reply["error"] == {
        "kind": "bad_ref",
        "message": "no layout 'exploded'; the layouts are assembly, print",
    }


def test_describe_unknown_part_lists_the_valid_keys(bracket_kernel):
    reply = bracket_kernel.describe(BRACKET, "assembly:nope")
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "bad_ref"
    for key in ("assembly:base", "assembly:post", "print:base", "print:post"):
        assert key in reply["error"]["message"]


def test_describe_face_index_out_of_range_is_bad_ref(bracket_kernel):
    reply = bracket_kernel.describe(BRACKET, "assembly:base/F6")
    assert reply["error"]["kind"] == "bad_ref"
    assert "6 faces" in reply["error"]["message"]


def test_unknown_query_and_unknown_op_are_bad_requests(bracket_kernel):
    id = bracket_kernel.send("query", dir=str(BRACKET), name="nope", args={})
    reply, _ = bracket_kernel.recv(5)
    assert (reply["id"], reply["error"]["kind"]) == (id, "bad_request")
    id = bracket_kernel.send("nope")
    reply, _ = bracket_kernel.recv(5)
    assert (reply["id"], reply["error"]["kind"]) == (id, "bad_request")


def test_request_that_is_not_json_is_a_bad_request_and_the_stream_recovers(bracket_kernel):
    stdin = bracket_kernel.proc.stdin
    stdin.write(b"\x00\x00\x00\x05\x00\x00\x00\x00{oops")
    reply, _ = bracket_kernel.recv(5)
    assert (reply["id"], reply["error"]["kind"]) == (None, "bad_request")
    write_frame(stdin, [1, 2])
    reply, _ = bracket_kernel.recv(5)
    assert (reply["id"], reply["error"]["kind"]) == (None, "bad_request")
    assert bracket_kernel.describe(BRACKET, "assembly:base")["ok"] is True


def test_a_thousand_pipelined_queries_are_all_answered_in_order(bracket_kernel):
    stdin = bracket_kernel.proc.stdin
    pipelined = io.BytesIO()
    for i in range(1000):
        write_frame(
            pipelined,
            {
                "id": f"p{i}",
                "op": "query",
                "dir": str(BRACKET),
                "name": "describe",
                "args": {"ref": "assembly:base"},
            },
        )
    stdin.write(pipelined.getvalue())
    replies = [bracket_kernel.recv(10)[0] for _ in range(1000)]
    assert [r["id"] for r in replies] == [f"p{i}" for i in range(1000)]
    assert all(r["ok"] for r in replies)


def test_client_that_writes_many_requests_before_reading_any_reply_is_not_blocked(kernel):
    # Requests and replies both exceed what the pipes hold, so a supervisor that
    # blocked on writing replies would never read the rest of the requests.
    pipelined = io.BytesIO()
    for i in range(20000):
        write_frame(pipelined, {"id": i, "op": "nope"})
    done = threading.Event()

    def write():
        kernel.proc.stdin.write(pipelined.getvalue())
        done.set()

    threading.Thread(target=write, daemon=True).start()
    assert done.wait(10), "the kernel stopped reading requests"
    replies = [kernel.recv(10)[0] for _ in range(20000)]
    assert [r["id"] for r in replies] == list(range(20000))
    assert {r["error"]["kind"] for r in replies} == {"bad_request"}


def test_query_before_any_build_is_no_build_and_shutdown_exits(fresh):
    reply = fresh.describe(BRACKET, "assembly:base")
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "no_build"
    fresh.send("shutdown")
    assert fresh.proc.wait(15) == 0


def test_query_without_a_folder_is_a_bad_request(bracket_kernel):
    id = bracket_kernel.send("query", name="describe", args={"ref": "assembly:base"})
    reply, _ = bracket_kernel.recv(5)
    assert reply == {
        "id": id,
        "ok": False,
        "error": {"kind": "bad_request", "message": "query needs dir, the object's folder, a string"},
    }


def test_each_object_is_answered_by_its_own_build_whichever_built_last(fresh, ws):
    bracket, plain = ws / "bracket", ws / "plain"
    build_bracket(fresh, ws)
    reply, _ = fresh.build(plain, "plain.py")
    assert reply["ok"], reply
    [plate] = [p["key"] for p in reply["scene"]["parts"]]
    # The plain plate built last; the bracket is still the bracket.
    assert fresh.describe(bracket, "assembly:base")["result"]["volume"] == pytest.approx(6000)
    assert fresh.describe(plain, plate)["result"]["volume"] == pytest.approx(800)
    # Neither knows the other's parts.
    assert fresh.describe(plain, "assembly:base")["error"]["kind"] == "bad_ref"
    assert fresh.describe(bracket, plate)["error"]["kind"] == "bad_ref"
    layout = plate.split(":")[0]
    near_plate = fresh.nearest(plain, layout, [{"part": "plate", "point": [0, 0, 4]}])
    assert near_plate["result"]["anchors"][0]["distance"] == pytest.approx(3)
    near_base = fresh.nearest(bracket, "assembly", [{"part": "plate", "point": [0, 0, 4]}])
    assert near_base["result"]["anchors"] == [{"part": "plate", "found": False}]
    # A folder that was never built has nothing to ask.
    never = fresh.describe(ws / "chatty", "assembly:plate")
    assert never["error"]["kind"] == "no_build"
    assert str(ws / "chatty") in never["error"]["message"]


def test_failed_build_of_one_object_leaves_every_live_worker(fresh, ws):
    build_bracket(fresh, ws)
    assert fresh.build(ws / "plain", "plain.py")[0]["ok"]
    assert fresh.build(ws / "broken", "broken.py")[0]["ok"] is False
    assert fresh.describe(ws / "bracket", "assembly:base")["ok"] is True
    assert fresh.describe(ws / "plain", "main:plate")["ok"] is True
    assert fresh.describe(ws / "broken", "assembly:base")["error"]["kind"] == "no_build"


def copies(ws, tmp_path, count: int) -> list[Path]:
    """Object folders that each hold the bracket."""
    folders = []
    for i in range(count):
        folder = tmp_path / f"object{i}"
        folder.mkdir()
        (folder / "bracket.py").write_text((ws / "bracket" / "bracket.py").read_text())
        folders.append(folder)
    return folders


def started_build(k: Kernel, folder) -> int:
    """Build the bracket in ``folder``; returns the worker's pid."""
    id = k.send("build", dir=str(folder), model="bracket.py")
    started, _ = k.recv(5)
    reply, _ = k.recv(20)
    assert (started["id"], reply["id"], reply["ok"]) == (id, id, True), reply
    return started["pid"]


def test_a_fifth_object_retires_the_least_recently_used(fresh, ws, tmp_path):
    folders = copies(ws, tmp_path, 5)
    pids = [started_build(fresh, folder) for folder in folders]
    first = fresh.describe(folders[0], "assembly:base")
    assert first["error"]["kind"] == "no_build"
    assert gone(pids[0])
    for folder, pid in zip(folders[1:], pids[1:], strict=True):
        assert not gone(pid)
        assert fresh.describe(folder, "assembly:base")["result"]["volume"] == pytest.approx(6000)


def test_a_query_counts_as_use_when_choosing_which_to_retire(fresh, ws, tmp_path):
    folders = copies(ws, tmp_path, 5)
    pids = [started_build(fresh, folder) for folder in folders[:4]]
    # The first was built longest ago, but it is the one just asked.
    assert fresh.describe(folders[0], "assembly:base")["ok"] is True
    pids.append(started_build(fresh, folders[4]))
    assert fresh.describe(folders[1], "assembly:base")["error"]["kind"] == "no_build"
    assert gone(pids[1])
    for index in (0, 2, 3, 4):
        assert fresh.describe(folders[index], "assembly:base")["ok"] is True
    # Building one of the four again does not retire any of them.
    pids.append(started_build(fresh, folders[2]))
    assert gone(pids[2])
    for index in (0, 2, 3, 4):
        assert fresh.describe(folders[index], "assembly:base")["ok"] is True


def test_cancelling_a_build_leaves_the_live_workers(fresh, ws):
    build_bracket(fresh, ws)
    assert fresh.build(ws / "plain", "plain.py")[0]["ok"]
    fresh.send("build", dir=str(ws / "bracket"), model="bracket.py")  # cancelled at once
    fresh.send("build", dir=str(ws / "slow"), model="slow.py")
    frames = [fresh.recv(5)[0] for _ in range(3)]
    assert sorted(f.get("event") or f["error"]["kind"] for f in frames) == [
        "build.started",
        "build.started",
        "cancelled",
    ]
    fresh.send("cancel")
    assert fresh.recv(5)[0]["error"]["kind"] == "cancelled"
    assert fresh.describe(ws / "bracket", "assembly:base")["ok"] is True
    assert fresh.describe(ws / "plain", "main:plate")["ok"] is True


def test_closing_stdin_leaves_no_live_worker_of_any_object(fresh, ws, tmp_path):
    pids = [started_build(fresh, folder) for folder in copies(ws, tmp_path, 3)]
    assert not any(gone(pid) for pid in pids)
    fresh.proc.stdin.close()
    assert fresh.proc.wait(15) == 0
    assert all(gone(pid) for pid in pids)


def test_failed_build_keeps_the_previous_worker_for_queries(kernel, ws):
    build_bracket(kernel, ws)
    reply, _ = kernel.build(ws / "broken", "broken.py")
    assert reply["ok"] is False
    assert kernel.describe(ws / "bracket", "assembly:base")["result"]["volume"] == pytest.approx(6000)


def test_queries_are_answered_while_another_build_runs(kernel, ws):
    build_bracket(kernel, ws)
    kernel.send("build", dir=str(ws / "slow"), model="slow.py")
    assert kernel.recv(5)[0]["event"] == "build.started"
    assert kernel.describe(ws / "bracket", "assembly:base")["result"]["volume"] == pytest.approx(6000)
    kernel.send("cancel")
    assert kernel.recv(5)[0]["error"]["kind"] == "cancelled"


def test_successful_build_replaces_and_stops_the_previous_worker(kernel, ws):
    id = kernel.send("build", dir=str(ws / "bracket"), model="bracket.py")
    first, _ = kernel.recv(5)
    assert kernel.recv(20)[0]["ok"] is True
    assert first["id"] == id
    # Another object's build leaves it alone.
    reply, _ = kernel.build(ws / "chatty", "chatty.py")
    assert reply["ok"] is True
    assert not gone(first["pid"])
    # The next build of the same object replaces it.
    build_bracket(kernel, ws)
    assert gone(first["pid"])
    assert kernel.describe(ws / "bracket", "assembly:base")["ok"] is True
    assert kernel.describe(ws / "chatty", "assembly:plate")["ok"] is True


def test_ten_builds_in_a_row_each_finish_quickly(kernel, ws):
    for _ in range(10):
        start = time.monotonic()
        build_bracket(kernel, ws)
        assert time.monotonic() - start < 5


def test_closing_stdin_exits_and_leaves_no_children(fresh, ws):
    id = fresh.send("build", dir=str(ws / "bracket"), model="bracket.py")
    live, _ = fresh.recv(5)
    assert fresh.recv(20)[0]["ok"] is True
    fresh.send("build", dir=str(ws / "slow"), model="slow.py")
    building, _ = fresh.recv(5)
    assert live["id"] == id and not gone(live["pid"]) and not gone(building["pid"])
    fresh.proc.stdin.close()
    assert fresh.proc.wait(15) == 0
    assert gone(live["pid"])
    assert gone(building["pid"])


def test_a_models_groups_come_with_its_scene(kernel, ws):
    """Read by the worker that loaded the model, passed on by the supervisor as they came."""
    reply, _ = kernel.build(ws / "grouped", "grouped.py")
    assert reply["ok"] is True
    assert reply["scene"]["groups"] == [
        {"name": "flat", "parts": ["flat-a", "flat-b"]},
        {"name": "tall", "parts": ["tall-a"]},
    ]


def test_scene_that_cannot_be_serialised_is_an_exception_reply(monkeypatch):
    """The worker's one result frame: a NaN in the scene must not end it without one."""
    from torno_kernel import loader, tess, worker
    from torno_kernel.frames import read_frame

    monkeypatch.setattr(loader, "load_model", lambda dir, model: ({"main": {}}, [], []))
    scene = {"model": "nan.py", "layouts": ["main"], "parts": [{"volume": float("nan")}]}
    monkeypatch.setattr(tess, "build_scene", lambda layouts, model, kept: (scene, b"blob", {"k": 1}))
    channel = io.BytesIO()
    assert worker._build(channel, "/nowhere", "nan.py") is None
    channel.seek(0)
    reply, blob = read_frame(channel)
    assert blob == b""
    assert reply["ok"] is False
    assert reply["error"]["kind"] == "exception"
    assert "Out of range float values are not JSON compliant" in reply["error"]["message"]
    assert read_frame(channel) is None  # one frame, and nothing half written before it


def test_a_worker_answers_from_what_its_build_worked_out_of_each_part(monkeypatch):
    """The volume of each part is in the scene: the queries of that build do not measure it again."""
    from torno_kernel import extent, worker
    from torno_kernel.frames import read_frame

    built = io.BytesIO()
    shapes, kept = worker._build(built, str(BRACKET), "bracket.py")
    built.seek(0)
    scene = read_frame(built)[0]["scene"]
    volumes = {part["key"]: part["volume"] for part in scene["parts"]}
    assert {key: kept["volume", key] for key in shapes} == {
        key: extent.Volume(volume, True) for key, volume in volumes.items()
    }
    assert all(kept["deflection", key] > 0 and kept["valid", key] is True for key in shapes)

    monkeypatch.setattr(extent, "volume_and_centre", lambda *args, **more: pytest.fail("measured again"))
    asked = io.BytesIO()
    write_frame(asked, {"id": 1, "name": "describe", "args": {"ref": "assembly:base"}})
    write_frame(asked, {"id": 2, "name": "measure", "args": {"kind": "volume", "a": {"ref": "assembly:post"}}})
    asked.seek(0)

    class Channel:
        def __init__(self) -> None:
            self.written = io.BytesIO()
            self.read, self.write, self.flush = asked.read, self.written.write, lambda: None

    channel = Channel()
    worker._serve(channel, shapes, kept)
    channel.written.seek(0)
    described, _ = read_frame(channel.written)
    assert described["result"]["volume"] == volumes["assembly:base"]
    measured, _ = read_frame(channel.written)
    assert measured["result"]["value"] == volumes["assembly:post"]
    # What the first query worked out is there for the next.
    assert ("area", "assembly:base") in kept and ("box", "assembly:base") in kept


def test_query_reply_that_cannot_be_serialised_is_an_exception_reply_and_the_next_is_answered(
    monkeypatch,
):
    """A worker answers for as long as it lives: an infinity in one reply must not end it."""
    from torno_kernel import queries, worker
    from torno_kernel.frames import read_frame

    import numpy as np

    # An infinity is not JSON; nor is a number numpy made, to the encoder.
    answers = iter([{"value": float("inf")}, {"value": np.float32(1.5)}, {"value": 2.0}])
    monkeypatch.setattr(queries, "run", lambda shapes, name, args, kept: next(answers))
    asked = io.BytesIO()
    for id in (1, 2, 3):
        write_frame(asked, {"id": id, "name": "measure", "args": {}})
    asked.seek(0)

    class Channel:
        """Reads the requests and collects the replies, as the worker's socket file does."""

        def __init__(self) -> None:
            self.written = io.BytesIO()
            self.read, self.write, self.flush = asked.read, self.written.write, lambda: None

    channel = Channel()
    worker._serve(channel, {})
    channel.written.seek(0)
    first, _ = read_frame(channel.written)
    assert (first["id"], first["ok"], first["error"]["kind"]) == (1, False, "exception")
    assert "the reply to measure could not be written" in first["error"]["message"]
    second, _ = read_frame(channel.written)
    assert (second["id"], second["ok"], second["error"]["kind"]) == (2, False, "exception")
    assert "the reply to measure could not be written" in second["error"]["message"]
    assert read_frame(channel.written)[0] == {"id": 3, "ok": True, "result": {"value": 2.0}}
    assert read_frame(channel.written) is None  # nothing half written


def test_a_request_the_worker_cannot_read_is_a_bad_request_and_the_next_is_answered(monkeypatch):
    """An integer of more digits than Python reads: the frame is whole, its JSON is refused."""
    from torno_kernel import queries, worker
    from torno_kernel.frames import read_frame

    monkeypatch.setattr(queries, "run", lambda shapes, name, args, kept: {"value": 2.0})
    header = ('{"id":1,"name":"measure","args":{"density":' + "9" * 5000 + "}}").encode()
    asked = io.BytesIO()
    asked.write(len(header).to_bytes(4, "big") + (0).to_bytes(4, "big") + header)
    write_frame(asked, {"id": 2, "name": "measure", "args": {}})
    asked.seek(0)

    class Channel:
        def __init__(self) -> None:
            self.written = io.BytesIO()
            self.read, self.write, self.flush = asked.read, self.written.write, lambda: None

    channel = Channel()
    worker._serve(channel, {})
    channel.written.seek(0)
    first, _ = read_frame(channel.written)
    assert (first["id"], first["ok"], first["error"]["kind"]) == (None, False, "bad_request")
    assert read_frame(channel.written)[0] == {"id": 2, "ok": True, "result": {"value": 2.0}}


def test_a_number_of_thousands_of_digits_is_a_bad_request_over_the_wire(bracket_kernel):
    dir = str(BRACKET)
    digits = "9" * 5000
    bracket_kernel.send_raw(
        f'{{"id":"big","op":"query","dir":"{dir}","name":"measure",'
        f'"args":{{"kind":"mass","a":{{"ref":"assembly:base"}},"density":{digits}}}}}'
    )
    reply, _ = bracket_kernel.recv(5)
    assert (reply["ok"], reply["error"]["kind"]) == (False, "bad_request")
    huge = {"kind": "mass", "a": {"ref": "assembly:base"}, "density": 10**400}
    assert bracket_kernel.query(BRACKET, "measure", huge)["error"]["kind"] == "bad_request"
    assert bracket_kernel.describe(BRACKET, "assembly:base")["ok"] is True


def raw_query(dir, id: str, name: str, args: str) -> str:
    """A query frame's header written by hand, for what no encoder here would write."""
    return f'{{"id":{id},"op":"query","dir":{json.dumps(str(dir))},"name":"{name}","args":{args}}}'


@pytest.mark.parametrize("number", ["NaN", "Infinity", "-Infinity"])
def test_a_query_holding_a_number_that_is_not_finite_is_a_bad_request_and_the_kernel_serves_on(
    bracket_kernel, number
):
    args = f'{{"kind":"mass","a":{{"ref":"assembly:base"}},"density":{number}}}'
    bracket_kernel.send_raw(raw_query(BRACKET, '"q"', "measure", args))
    reply, _ = bracket_kernel.recv(5)
    assert reply == {
        "id": "q",
        "ok": False,
        "error": {
            "kind": "bad_request",
            "message": "the request holds a number that is not finite: NaN and the infinities are not JSON",
        },
    }
    # As its id, the request cannot be named in the answer.
    bracket_kernel.send_raw(raw_query(BRACKET, number, "describe", '{"ref":"assembly:base"}'))
    reply, _ = bracket_kernel.recv(5)
    assert (reply["id"], reply["ok"], reply["error"]["kind"]) == (None, False, "bad_request")
    assert bracket_kernel.proc.poll() is None
    assert bracket_kernel.describe(BRACKET, "assembly:base")["ok"] is True


def test_a_request_holding_half_a_character_is_a_bad_request_and_the_kernel_serves_on(bracket_kernel, ws):
    """JSON.stringify writes a lone surrogate as an escape: Python reads it, and cannot write it."""
    message = "the request holds text that is not Unicode: a lone surrogate, \\ud800 to \\udfff"
    lone = '"\\ud800"'
    raw = [
        raw_query(BRACKET, '"q"', "describe", f'{{"ref":{lone}}}'),
        raw_query(BRACKET, '"q"', "describe", f'{{{lone}:1}}'),
        raw_query(BRACKET, '"q"', "describe\\udfff", "{}"),
        f'{{"id":"q","op":"query","dir":{lone},"name":"describe","args":{{}}}}',
        f'{{"id":"q","op":"build","dir":{lone},"model":"bracket.py"}}',
        f'{{"id":"q","op":"build","dir":{json.dumps(str(ws / "bracket"))},"model":{lone}}}',
    ]
    for header in raw:
        bracket_kernel.send_raw(header)
        reply, _ = bracket_kernel.recv(5)
        assert reply == {"id": "q", "ok": False, "error": {"kind": "bad_request", "message": message}}, header
    for header in (raw_query(BRACKET, lone, "describe", "{}"), f'{{"id":7,"op":{lone}}}'):
        bracket_kernel.send_raw(header)
        reply, _ = bracket_kernel.recv(5)
        assert (reply["ok"], reply["error"]["kind"]) == (False, "bad_request"), header
    assert bracket_kernel.proc.poll() is None
    assert bracket_kernel.describe(BRACKET, "assembly:base")["ok"] is True


@pytest.mark.parametrize("depth", [200_000, 20_000, 3_000, 900])
def test_a_request_nested_however_deeply_is_answered_and_the_kernel_serves_on(bracket_kernel, depth):
    nested = "[" * depth + "]" * depth
    bracket_kernel.send_raw(raw_query(BRACKET, '"deep"', "describe", f'{{"ref":{nested}}}'))
    reply, _ = bracket_kernel.recv(10)
    # Too deep to read at all, its id is not known; read, it is refused by whoever cannot
    # pass it on, or by describe, which wants a string.
    assert reply["id"] in (None, "deep")
    assert (reply["ok"], reply["error"]["kind"]) == (False, "bad_request")
    if depth == 200_000:
        assert reply["id"] is None
    assert bracket_kernel.proc.poll() is None
    # The same worker answers: it was not lost over it.
    assert bracket_kernel.describe(BRACKET, "assembly:base")["ok"] is True


def test_a_frame_nested_too_deeply_to_read_is_told_so_and_one_that_is_no_object_otherwise(bracket_kernel):
    depth = 20_000
    bracket_kernel.send_raw(raw_query(BRACKET, '"deep"', "describe", "[" * depth + "]" * depth))
    reply, _ = bracket_kernel.recv(10)
    assert reply == {
        "id": None,
        "ok": False,
        "error": {"kind": "bad_request", "message": "the request is nested too deeply"},
    }
    for header in ("[1, 2]", "{not json"):
        bracket_kernel.send_raw(header)
        reply, _ = bracket_kernel.recv(5)
        assert reply["error"] == {"kind": "bad_request", "message": "a request must be a JSON object"}
    assert bracket_kernel.describe(BRACKET, "assembly:base")["ok"] is True


def test_a_request_the_worker_cannot_read_or_is_no_object_is_a_bad_request_and_the_next_is_answered(
    monkeypatch,
):
    from torno_kernel import queries, worker
    from torno_kernel.frames import read_frame

    monkeypatch.setattr(queries, "run", lambda shapes, name, args, kept: {"value": 2.0})
    asked = io.BytesIO()
    for header in (b"[" * 200_000 + b"]" * 200_000, b"[1, 2]", b'"describe"', b"null"):
        asked.write(len(header).to_bytes(4, "big") + (0).to_bytes(4, "big") + header)
    write_frame(asked, {"id": 5, "name": "measure", "args": {}})
    asked.seek(0)

    class Channel:
        def __init__(self) -> None:
            self.written = io.BytesIO()
            self.read, self.write, self.flush = asked.read, self.written.write, lambda: None

    channel = Channel()
    worker._serve(channel, {})
    channel.written.seek(0)
    for _ in range(4):
        reply, _ = read_frame(channel.written)
        assert (reply["id"], reply["ok"], reply["error"]["kind"]) == (None, False, "bad_request")
    assert read_frame(channel.written)[0] == {"id": 5, "ok": True, "result": {"value": 2.0}}
    assert read_frame(channel.written) is None


def test_a_reply_the_worker_cannot_write_at_all_is_still_one_reply(monkeypatch):
    """Half a character in a reply, and in the name the failure would be told with."""
    from torno_kernel import queries, worker
    from torno_kernel.frames import read_frame

    answers = iter([{"value": "\ud800"}, {"value": 2.0}])
    monkeypatch.setattr(queries, "run", lambda shapes, name, args, kept: next(answers))
    asked = io.BytesIO()
    # Written as the escape, which is how such a name would arrive.
    header = b'{"id":1,"name":"\\udfff","args":{}}'
    asked.write(len(header).to_bytes(4, "big") + (0).to_bytes(4, "big") + header)
    write_frame(asked, {"id": 2, "name": "measure", "args": {}})
    asked.seek(0)

    class Channel:
        def __init__(self) -> None:
            self.written = io.BytesIO()
            self.read, self.write, self.flush = asked.read, self.written.write, lambda: None

    channel = Channel()
    worker._serve(channel, {})
    channel.written.seek(0)
    first, _ = read_frame(channel.written)
    assert (first["id"], first["ok"], first["error"]["kind"]) == (1, False, "exception")
    assert read_frame(channel.written)[0] == {"id": 2, "ok": True, "result": {"value": 2.0}}
    assert read_frame(channel.written) is None


def test_coordinates_no_number_can_be_made_of_are_refused_and_the_worker_lives(bracket_kernel):
    far = {"layout": "assembly", "point": [0, 0, 1e308]}
    there = {"layout": "assembly", "point": [0, 1e308, 0]}
    reply = bracket_kernel.query(BRACKET, "measure", {"kind": "distance", "a": far, "b": there})
    assert (reply["ok"], reply["error"]["kind"]) == (False, "bad_request")
    plane = {"origin": [1e308, 0, 0], "normal": [0, 0, 1]}
    cut = bracket_kernel.query(BRACKET, "section", {"layout": "assembly", "plane": plane})
    assert cut["error"]["kind"] == "bad_request"
    near = bracket_kernel.nearest(BRACKET, "assembly", [{"part": "base", "point": [0, 0, 1e308]}])
    assert near["error"]["kind"] == "bad_request"
    # The same worker still answers.
    assert bracket_kernel.describe(BRACKET, "assembly:base")["ok"] is True


class Routed:
    """A supervisor in this process, with stand-ins for its workers.

    For what cannot be arranged from outside: which of two frames it reads in
    one round, and a worker that takes too long over a query. Each stand-in is
    a real child, so that it can be signalled and reaped, and a socket whose
    other end the test holds.
    """

    def __init__(self) -> None:
        import socket
        import subprocess

        from torno_kernel import supervisor

        self._socket, self._subprocess, self._module = socket, subprocess, supervisor
        stdin, self.requests = os.pipe()
        self.replies, out = os.pipe()
        self._fds = [stdin, self.requests, self.replies]
        self._out = os.fdopen(out, "wb", buffering=0)
        self.supervisor = supervisor.Supervisor(stdin, self._out)
        self._decoder = supervisor._Decoder()
        self._children = []
        self._ends = []

    def worker(self, dir: str, request_id=None):
        """A stand-in worker and the test's end of its socket."""
        ours, theirs = self._socket.socketpair()
        ours.setblocking(False)
        child = self._subprocess.Popen(["sleep", "60"])
        self._children.append(child)
        self._ends += [ours, theirs]
        now = time.monotonic()
        outbox = self._module._Outbox(ours.send)
        worker = self._module._Worker(child.pid, dir, ours, request_id, now, now + 60, 60, None, outbox)
        return worker, theirs

    def request(self, **fields) -> None:
        frame = io.BytesIO()
        write_frame(frame, fields)
        os.write(self.requests, frame.getvalue())

    def sent(self) -> list[dict]:
        """The frames the supervisor has written to its client so far."""
        os.set_blocking(self.replies, False)
        frames = []
        try:
            while chunk := os.read(self.replies, 1 << 16):
                frames += [header for header, _ in self._decoder.feed(chunk)]
        except BlockingIOError:
            pass
        return frames

    def close(self) -> None:
        for child in self._children:
            child.kill()
            try:
                os.waitpid(child.pid, 0)
            except ChildProcessError:
                pass  # the supervisor reaped it
            child.returncode = -9
        for end in self._ends:
            end.close()
        self._out.close()
        for fd in self._fds:
            os.close(fd)


@pytest.fixture
def routed():
    r = Routed()
    yield r
    r.close()


def frame(header: dict) -> bytes:
    data = io.BytesIO()
    write_frame(data, header)
    return data.getvalue()


def test_reply_already_received_is_passed_on_when_a_build_replaces_its_worker(routed):
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    building, building_end = routed.worker("/object", request_id="build")
    sup._live["/object"] = live
    sup._building = building
    live.queries += [("answered", time.monotonic() + 30), ("unanswered", time.monotonic() + 30)]
    # Both are there to read in the same round: the answer, and the result that retires its worker.
    live_end.sendall(frame({"id": "answered", "ok": True, "result": {"volume": 1}}))
    building_end.sendall(frame({"ok": True, "scene": {"model": "m.py", "layouts": [], "parts": []}}))
    sup._step()
    sent = routed.sent()
    assert [(f["id"], f["ok"]) for f in sent] == [("answered", True), ("unanswered", False), ("build", True)]
    assert sent[0]["result"] == {"volume": 1}
    assert sent[1]["error"]["kind"] == "cancelled"
    assert sup._live == {"/object": building}
    assert gone(live.pid)


def test_query_not_answered_in_time_is_a_timeout_and_the_worker_is_left_alone(routed, monkeypatch):
    from torno_kernel import supervisor

    assert supervisor.QUERY_TIMEOUT == 30
    monkeypatch.setattr(supervisor, "QUERY_TIMEOUT", 0.3)
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    sup._live["/object"] = live
    routed.request(id="slow", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    start = time.monotonic()
    sup._step()  # reads the request and sends the query on
    assert routed.sent() == []
    sup._step()  # wakes at the query's deadline, with nothing to read
    assert 0.25 < time.monotonic() - start < 2
    assert routed.sent() == [
        {
            "id": "slow",
            "ok": False,
            "error": {
                "kind": "timeout",
                "message": "the query was not answered within 0.3 s; "
                "the build it was sent to is still there",
            },
        }
    ]
    assert sup._live == {"/object": live}
    assert not gone(live.pid)

    # The answer, when it does come, is nobody's: it is dropped, and the next query is answered.
    live_end.sendall(frame({"id": "slow", "ok": True, "result": {}}))
    sup._step()
    assert routed.sent() == []
    routed.request(id="next", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    sup._step()
    live_end.sendall(frame({"id": "next", "ok": True, "result": {"n": 1}}))
    sup._step()
    assert routed.sent() == [{"id": "next", "ok": True, "result": {"n": 1}}]
    assert sup._live == {"/object": live}


def test_after_a_timeout_later_queries_are_timeouts_at_once_until_the_worker_answers(routed, monkeypatch):
    from torno_kernel import supervisor

    monkeypatch.setattr(supervisor, "QUERY_TIMEOUT", 0.3)
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    other, other_end = routed.worker("/other")
    sup._live["/object"] = live
    sup._live["/other"] = other
    routed.request(id="slow", op="query", dir="/object", name="nearest", args={})
    sup._step()
    sup._step()  # the deadline passes
    assert [f["error"]["kind"] for f in routed.sent()] == ["timeout"]

    # The worker is still busy with that one: the next is not made to wait for it.
    routed.request(id="second", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    routed.request(id="elsewhere", op="query", dir="/other", name="describe", args={"ref": "a:b"})
    start = time.monotonic()
    sup._step()
    assert time.monotonic() - start < 0.2
    assert routed.sent() == [
        {
            "id": "second",
            "ok": False,
            "error": {
                "kind": "timeout",
                "message": "the build of /object is still busy with a query it did not answer "
                "within 0.3 s; ask again when it has",
            },
        }
    ]
    # It was not sent on, so nothing waits for an answer; another object's worker is asked as ever.
    assert live.queries == []
    assert [id for id, _ in other.queries] == ["elsewhere"]
    other_end.sendall(frame({"id": "elsewhere", "ok": True, "result": {"n": 2}}))
    sup._step()
    assert routed.sent() == [{"id": "elsewhere", "ok": True, "result": {"n": 2}}]

    # Its late answer is dropped, and says it is free again.
    live_end.sendall(frame({"id": "slow", "ok": True, "result": {}}))
    sup._step()
    assert routed.sent() == []
    routed.request(id="third", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    sup._step()
    assert [id for id, _ in live.queries] == ["third"]
    live_end.sendall(frame({"id": "third", "ok": True, "result": {"n": 3}}))
    sup._step()
    assert routed.sent() == [{"id": "third", "ok": True, "result": {"n": 3}}]
    assert sup._live == {"/other": other, "/object": live}
    assert not gone(live.pid)


def test_the_wait_ends_at_the_earlier_of_the_build_and_query_deadlines(routed, monkeypatch):
    from torno_kernel import supervisor

    monkeypatch.setattr(supervisor, "QUERY_TIMEOUT", 0.2)
    sup = routed.supervisor
    live, _ = routed.worker("/object")
    building, _ = routed.worker("/other", request_id="build")  # its deadline is a minute away
    sup._live["/object"] = live
    sup._building = building
    routed.request(id="q", op="query", dir="/object", name="describe", args={})
    sup._step()
    start = time.monotonic()
    sup._step()
    assert time.monotonic() - start < 2
    assert [f["error"]["kind"] for f in routed.sent()] == ["timeout"]
    assert sup._building is building and not gone(building.pid)


def test_a_worker_is_busy_until_it_has_answered_every_query_that_was_given_up_on(routed, monkeypatch):
    from torno_kernel import supervisor

    monkeypatch.setattr(supervisor, "QUERY_TIMEOUT", 0.3)
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    sup._live["/object"] = live
    # Two sent one behind the other: it answers one at a time, and both run out of time.
    routed.request(id="first", op="query", dir="/object", name="nearest", args={})
    routed.request(id="second", op="query", dir="/object", name="nearest", args={})
    sup._step()
    sup._step()  # the deadline of both passes
    timed_out = routed.sent()
    if len(timed_out) < 2:
        sup._step()
        timed_out += routed.sent()
    assert [f["error"]["kind"] for f in timed_out] == ["timeout", "timeout"]

    # It answers the first, late, and is now on the second: still busy.
    live_end.sendall(frame({"id": "first", "ok": True, "result": {}}))
    sup._step()
    routed.request(id="third", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    sup._step()
    [refused] = routed.sent()
    assert refused["id"] == "third"
    assert refused["error"]["kind"] == "timeout"
    assert "still busy" in refused["error"]["message"]
    assert live.queries == []

    # The second answered too: it is free again.
    live_end.sendall(frame({"id": "second", "ok": True, "result": {}}))
    sup._step()
    assert routed.sent() == []
    routed.request(id="fourth", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    sup._step()
    assert [id for id, _ in live.queries] == ["fourth"]
    live_end.sendall(frame({"id": "fourth", "ok": True, "result": {"n": 4}}))
    sup._step()
    assert routed.sent() == [{"id": "fourth", "ok": True, "result": {"n": 4}}]


def test_a_reply_with_no_id_answers_the_query_the_worker_has_had_longest(routed):
    """A worker that could not read a request cannot say which it was: it answers in order."""
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    sup._live["/object"] = live
    routed.request(id="first", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    routed.request(id="second", op="query", dir="/object", name="describe", args={"ref": "a:b"})
    sup._step()
    unread = {"kind": "bad_request", "message": "a request could not be read"}
    live_end.sendall(frame({"id": None, "ok": False, "error": unread}))
    sup._step()
    assert routed.sent() == [{"id": "first", "ok": False, "error": unread}]
    assert [id for id, _ in live.queries] == ["second"]
    live_end.sendall(frame({"id": "second", "ok": True, "result": {"n": 2}}))
    sup._step()
    assert routed.sent() == [{"id": "second", "ok": True, "result": {"n": 2}}]
    # With nothing waiting, it is nobody's.
    live_end.sendall(frame({"ok": False, "error": unread}))
    sup._step()
    assert routed.sent() == [] and sup._live == {"/object": live}


def test_a_reply_of_a_live_worker_is_written_once_to_check_it_and_to_pass_it_on(routed, monkeypatch):
    from torno_kernel import supervisor

    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    sup._live["/object"] = live
    routed.request(id="q", op="query", dir="/object", name="describe", args={})
    sup._step()
    written = []
    encoded = supervisor._encoded
    monkeypatch.setattr(supervisor, "_encoded", lambda *args: written.append(args[0]) or encoded(*args))
    reply = {"id": "q", "ok": True, "result": {"kind": "part", "name": "é"}}
    live_end.sendall(frame(reply))
    sup._step()
    assert routed.sent() == [reply]
    assert written == [reply]


def test_a_reply_with_no_id_to_a_query_given_up_on_frees_the_worker(routed, monkeypatch):
    from torno_kernel import supervisor

    monkeypatch.setattr(supervisor, "QUERY_TIMEOUT", 0.3)
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    sup._live["/object"] = live
    routed.request(id="slow", op="query", dir="/object", name="describe", args={})
    sup._step()
    sup._step()  # the deadline passes
    assert [f["error"]["kind"] for f in routed.sent()] == ["timeout"]
    assert live.stalled
    live_end.sendall(frame({"id": None, "ok": False, "error": {"kind": "bad_request", "message": "unread"}}))
    sup._step()
    assert routed.sent() == [] and not live.stalled
    routed.request(id="next", op="query", dir="/object", name="describe", args={})
    sup._step()
    assert [id for id, _ in live.queries] == ["next"]


@pytest.mark.parametrize("header", [b'{"id":"q","ok":true,"result":{"value":NaN}}', b'{"id":"q","ok":true,"result":"\\ud800"}'])
def test_a_reply_of_a_live_worker_that_cannot_be_passed_on_ends_that_worker_only(routed, header):
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    sup._live["/object"] = live
    routed.request(id="q", op="query", dir="/object", name="describe", args={})
    sup._step()
    live_end.sendall(len(header).to_bytes(4, "big") + (0).to_bytes(4, "big") + header)
    sup._step()
    [reply] = routed.sent()
    assert (reply["id"], reply["ok"], reply["error"]["kind"]) == ("q", False, "crash")
    assert sup._live == {} and gone(live.pid)


# Room for a build: memory


GIB = 1 << 30


def memory(routed, monkeypatch, available, rss):
    """Stand-ins for what the supervisor reads of memory, and for the worker it forks.

    ``available`` is given the pids still running and answers in bytes, or
    None for a /proc that cannot be read; ``rss`` is by pid. Returns the list
    of (worker, the test's end of its socket) that were forked.
    """
    from torno_kernel import supervisor

    # The suite keeps builds whatever memory there is (conftest): these tests are of the policy itself.
    monkeypatch.delenv("TORNO_KEEP_BUILDS", raising=False)
    sup = routed.supervisor
    alive = lambda: [w.pid for w in sup._live.values()]  # noqa: E731
    monkeypatch.setattr(supervisor, "_available", lambda: available(alive()))
    monkeypatch.setattr(supervisor, "_rss", lambda pid: rss.get(pid))
    forked = []

    def fork(id, dir, model, timeout):
        forked.append(routed.worker(dir, request_id=id))
        return forked[-1][0]

    monkeypatch.setattr(sup, "_fork", fork)
    return forked


SCENE = {"ok": True, "scene": {"model": "m.py", "layouts": [], "parts": []}}


def test_a_build_with_memory_short_lets_the_folders_own_build_go_and_says_so(routed, monkeypatch):
    sup = routed.supervisor
    live, _ = routed.worker("/object")
    sup._live["/object"] = live
    # 11 GiB held by the live worker, 5 GiB free: 13 are wanted, and 16 are free without it.
    forked = memory(routed, monkeypatch, lambda pids: (5 if live.pid in pids else 16) * GIB, {live.pid: 11 * GIB})
    live.queries.append(("waiting", time.monotonic() + 30))
    routed.request(id="build", op="build", dir="/object", model="m.py")
    sup._step()
    [(building, building_end)] = forked
    waiting, started = routed.sent()
    assert waiting["id"] == "waiting" and waiting["error"]["kind"] == "no_build"
    assert started == {"id": "build", "event": "build.started", "pid": building.pid, "retired": ["/object"]}
    assert gone(live.pid) and sup._live == {}

    # Asked while the build runs: there is none, and why is said.
    routed.request(id="during", op="query", dir="/object", name="describe", args={})
    sup._step()
    [during] = routed.sent()
    assert during["error"] == {
        "kind": "no_build",
        "reason": "memory",
        "message": "the build of /object was let go to make room for the next one (memory); "
        "it can be queried again when a build of it has succeeded",
    }
    assert waiting["error"] == during["error"]

    # And once it lands it is answered, with no word of the old one.
    building_end.sendall(frame(SCENE))
    sup._step()
    assert [(f["id"], f["ok"]) for f in routed.sent()] == [("build", True)]
    routed.request(id="after", op="query", dir="/object", name="describe", args={})
    sup._step()
    assert routed.sent() == [] and [id for id, _ in building.queries] == ["after"]


def test_no_build_is_let_go_for_memory_when_torno_keep_builds_is_set(routed, monkeypatch):
    # The switch of the test suites: a machine short of memory must not change what they see. Never set in use.
    sup = routed.supervisor
    live, _ = routed.worker("/object")
    other, _ = routed.worker("/other")
    sup._live["/other"] = other
    sup._live["/object"] = live
    forked = memory(routed, monkeypatch, lambda pids: 1 * GIB, {live.pid: 11 * GIB, other.pid: 11 * GIB})
    monkeypatch.setenv("TORNO_KEEP_BUILDS", "1")
    routed.request(id="build", op="build", dir="/object", model="m.py")
    sup._step()
    [(building, _)] = forked
    assert routed.sent() == [{"id": "build", "event": "build.started", "pid": building.pid, "retired": []}]
    assert not gone(live.pid) and not gone(other.pid)
    assert list(sup._live) == ["/other", "/object"] and sup._let_go == set()


def test_a_build_with_memory_short_lets_other_folders_go_first_the_least_recently_used_first(routed, monkeypatch):
    sup = routed.supervisor
    workers = {dir: routed.worker(dir)[0] for dir in ("/a", "/b", "/c")}
    sup._live.update(workers)
    rss = {w.pid: 3 * GIB for w in workers.values()}
    # 1 GiB free and 3 with each worker gone: the 5 wanted for /c are there with two gone.
    forked = memory(routed, monkeypatch, lambda pids: (10 - 3 * len(pids)) * GIB, rss)
    # /a is asked, so /b is now the least recently used of the others.
    routed.request(id="q", op="query", dir="/a", name="describe", args={})
    sup._step()
    assert list(sup._live) == ["/b", "/c", "/a"]
    routed.request(id="build", op="build", dir="/c", model="m.py")
    sup._step()
    q, started = routed.sent()
    assert (q["id"], q["error"]["kind"], q["error"]["reason"]) == ("q", "no_build", "memory")
    assert started["retired"] == ["/b", "/a"]
    assert sup._live == {"/c": workers["/c"]} and not gone(workers["/c"].pid)
    assert gone(workers["/a"].pid) and gone(workers["/b"].pid)

    # A failed build of /c leaves its old one answering; /b says why it has none until it is built.
    forked[0][1].sendall(frame({"ok": False, "error": {"kind": "exception", "message": "no"}}))
    sup._step()
    routed.request(id="b", op="query", dir="/b", name="describe", args={})
    routed.request(id="c", op="query", dir="/c", name="describe", args={})
    sup._step()
    failed, b = routed.sent()
    assert (failed["id"], failed["ok"]) == ("build", False)
    assert b["error"]["reason"] == "memory" and "/b" in b["error"]["message"]
    assert [id for id, _ in workers["/c"].queries] == ["c"]


def test_a_build_with_memory_to_spare_leaves_every_build_answering(routed, monkeypatch):
    sup = routed.supervisor
    live, live_end = routed.worker("/object")
    other, _ = routed.worker("/other")
    sup._live.update({"/other": other, "/object": live})
    # Just enough: the 11 GiB it holds and 2 more.
    forked = memory(routed, monkeypatch, lambda pids: 13 * GIB, {live.pid: 11 * GIB, other.pid: GIB})
    routed.request(id="build", op="build", dir="/object", model="m.py")
    sup._step()
    [started] = routed.sent()
    assert started == {"id": "build", "event": "build.started", "pid": forked[0][0].pid, "retired": []}
    assert sup._live == {"/other": other, "/object": live}
    # The old one answers while the new one builds.
    routed.request(id="during", op="query", dir="/object", name="describe", args={})
    sup._step()
    live_end.sendall(frame({"id": "during", "ok": True, "result": {"n": 1}}))
    sup._step()
    assert routed.sent() == [{"id": "during", "ok": True, "result": {"n": 1}}]


def test_a_small_build_is_taken_to_need_four_gib(routed, monkeypatch):
    sup = routed.supervisor
    other, _ = routed.worker("/other")
    sup._live["/other"] = other
    free = {True: 4 * GIB - 1, False: 6 * GIB}
    memory(routed, monkeypatch, lambda pids: free[other.pid in pids], {other.pid: GIB})
    routed.request(id="build", op="build", dir="/new", model="m.py")
    sup._step()
    assert routed.sent()[0]["retired"] == ["/other"]


@pytest.mark.parametrize("unreadable", ["available", "rss"])
def test_a_build_lets_nothing_go_when_memory_cannot_be_read(routed, monkeypatch, unreadable):
    sup = routed.supervisor
    live, _ = routed.worker("/object")
    other, _ = routed.worker("/other")
    sup._live.update({"/other": other, "/object": live})
    available = (lambda pids: None) if unreadable == "available" else (lambda pids: GIB)
    rss = {} if unreadable == "rss" else {live.pid: 11 * GIB, other.pid: GIB}
    memory(routed, monkeypatch, available, rss)
    routed.request(id="build", op="build", dir="/object", model="m.py")
    sup._step()
    [started] = routed.sent()
    assert started["retired"] == []
    assert sup._live == {"/other": other, "/object": live}
    assert not gone(live.pid) and not gone(other.pid)


def test_memory_is_read_from_proc_and_of_a_worker_that_cannot_be_dumped(fresh, ws):
    from torno_kernel import supervisor

    available = supervisor._available()
    assert isinstance(available, int) and available > 0
    assert supervisor._rss(os.getpid()) > 10 << 20
    id = fresh.send("build", dir=str(ws / "bracket"), model="bracket.py")
    started, _ = fresh.recv(5)
    assert fresh.recv(20)[0]["ok"] is True
    # The worker set PR_SET_DUMPABLE 0: its status is still anyone's to read.
    assert 50 << 20 < supervisor._rss(started["pid"]) < 4 * GIB
    assert started == {"id": id, "event": "build.started", "pid": started["pid"], "retired": []}
    fresh.close()
    assert supervisor._rss(started["pid"]) is None


def test_memory_that_proc_does_not_say_is_none(monkeypatch, tmp_path):
    from torno_kernel import supervisor

    (tmp_path / "meminfo").write_text("MemTotal:       32000000 kB\nMemAvailable:   1234 kB\n")
    (tmp_path / "7").mkdir()
    (tmp_path / "7" / "status").write_text("Name:\tpython\nVmRSS:\t    2048 kB\nRssAnon:\t 1 kB\n")
    (tmp_path / "8").mkdir()
    (tmp_path / "8" / "status").write_text("Name:\tkthread\n")
    monkeypatch.setattr(supervisor, "_PROC", str(tmp_path))
    assert supervisor._available() == 1234 * 1024
    assert (supervisor._rss(7), supervisor._rss(8), supervisor._rss(9)) == (2048 * 1024, None, None)
    (tmp_path / "meminfo").write_text("MemTotal:       32000000 kB\nMemAvailable: many\n")
    assert supervisor._available() is None
    (tmp_path / "meminfo").unlink()
    assert supervisor._available() is None
