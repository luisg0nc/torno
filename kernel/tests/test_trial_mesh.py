"""A trial with ``mesh`` answers with the scene and the mesh blob of a build, then is thrown away.

It is how an older kept build is drawn again: its copy is built in a worker of its own and nothing live is touched.
"""

import subprocess
import sys

import pytest
from kclient import Kernel


def children(pid: int) -> list[int]:
    out = subprocess.run(["pgrep", "-P", str(pid)], capture_output=True, text=True).stdout
    return [int(p) for p in out.split()]


@pytest.fixture
def fresh():
    k = Kernel()
    yield k
    k.close()


def trial(k: Kernel, dir, model: str, timeout: float = 30, **fields) -> tuple[dict, bytes]:
    id = k.send("trial", dir=str(dir), model=model, overrides={}, queries=[], **fields)
    started, _ = k.recv(5)
    if started.get("event") != "trial.started":
        assert started["id"] == id
        return started, b""
    reply, blob = k.recv(timeout)
    assert reply["id"] == id, reply
    return reply, blob


def test_a_trial_with_mesh_carries_the_scene_and_the_blob_of_a_build(fresh, ws):
    reply, blob = trial(fresh, ws / "hollow", "hollow.py", mesh=True)
    assert reply["ok"], reply
    assert {p["name"] for p in reply["scene"]["parts"]} == {"tub", "lid"}
    assert len(blob) > 0
    # The same bytes a build of the model gives.
    built, built_blob = fresh.build(ws / "hollow", "hollow.py")
    assert built["ok"], built
    assert blob == built_blob
    for part, same in zip(reply["scene"]["parts"], built["scene"]["parts"]):
        assert part["mesh"] == same["mesh"]
    # Nothing is left of it but the build above.
    assert len(children(fresh.proc.pid)) == 1


def test_a_trial_without_mesh_has_no_blob(fresh, ws):
    reply, blob = trial(fresh, ws / "hollow", "hollow.py")
    assert reply["ok"], reply
    assert blob == b""


def test_a_trial_with_mesh_that_is_not_a_bool_is_a_bad_request(fresh, ws):
    reply, _ = trial(fresh, ws / "hollow", "hollow.py", mesh="yes")
    assert reply["error"]["kind"] == "bad_request"


def test_a_trial_with_mesh_that_fails_says_why_with_no_blob(fresh, ws):
    reply, blob = trial(fresh, ws / "broken", "broken.py", mesh=True)
    assert reply["ok"] is False and reply["error"]["message"] and blob == b""


def test_a_trial_with_mesh_imports_from_the_workspace_it_lies_in_not_the_one_the_kernel_runs_in(tmp_path):
    """The kernel runs in one workspace (its cwd is on ``sys.path``); a copy lies in another and takes its own
    ``common`` first, however the model reaches it."""
    live, copy = tmp_path / "live", tmp_path / "copy"
    for root, size in ((live, 30), (copy, 10)):
        (root / "common").mkdir(parents=True)
        (root / "common" / "size.py").write_text(f"SIZE = {size}\n")
        (root / "block").mkdir()
        # Without a sys.path line of its own: it reaches common/ through the folder the kernel is run in.
        (root / "block" / "block.py").write_text(
            "from build123d import Box\nfrom common.size import SIZE\n\nb = Box(SIZE, SIZE, SIZE)\n"
        )
    proc = subprocess.Popen([sys.executable, "-m", "torno_kernel"], cwd=live, stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=0)
    k = Kernel.__new__(Kernel)
    k.proc, k._next_id = proc, 0
    k.ready, _ = k.recv(60)
    try:
        reply, _ = trial(k, copy / "block", "block.py", mesh=True)
        assert reply["ok"], reply
        box = reply["scene"]["parts"][0]["bbox"]
        assert box["max"][0] - box["min"][0] == pytest.approx(10)
    finally:
        k.close()
