"""The forked build process: load, tessellate, reply once, then answer queries.

Everything here runs in a child of the supervisor and leaves through
``os._exit``, so the supervisor's own cleanup never runs twice.
"""

import ctypes
import os
import signal
import socket
import sys
import traceback
from pathlib import Path
from typing import Any, NoReturn

from . import loader, queries, tess
from .frames import read_frame, write_frame

_PR_SET_PDEATHSIG = 1
_PR_SET_DUMPABLE = 4


def run(sock: socket.socket, capture_fd: int, dir: str, model: str) -> NoReturn:
    """Build ``dir/model`` and serve queries on ``sock``. Never returns.

    The caller has already closed the supervisor's other descriptors.
    ``capture_fd`` receives everything the model writes to stdout and stderr.
    """
    try:
        _isolate(capture_fd)
        channel = sock.makefile("rwb")
        built = _build(channel, dir, model)
        if built is not None:
            _serve(channel, *built)
    except BaseException:
        # Nothing may propagate into the supervisor's stack, which this
        # process inherited. A broken socket means the supervisor is gone.
        pass
    finally:
        os._exit(0)


def _isolate(capture_fd: int) -> None:
    libc = ctypes.CDLL(None)
    # No core dump: with systemd-coredump a crashed worker takes seconds to reap.
    libc.prctl(_PR_SET_DUMPABLE, 0)
    # Die with the supervisor even if it is killed before it can clean up.
    libc.prctl(_PR_SET_PDEATHSIG, int(signal.SIGKILL))
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)  # a model that reads stdin must not eat protocol frames
    os.close(devnull)
    os.dup2(capture_fd, 1)
    os.dup2(capture_fd, 2)
    # Line buffered, so the output survives a crash or a kill.
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)


def _build(channel: Any, dir: str, model: str) -> tuple[dict[str, Any], dict[Any, Any]] | None:
    """Send the build's one result frame.

    Returns the shapes and what the build worked out of each part that its
    queries would otherwise work out again, or None on failure.
    """
    try:
        layouts, params, groups = loader.load_model(Path(dir), model)
        kept: dict[Any, Any] = {}
        scene, blob, shapes = tess.build_scene(layouts, model, kept)
        # Read here, by the worker that loaded the model: the supervisor never does.
        scene["params"] = params
        scene["groups"] = groups
        # Each part names its group, so that whoever has the part has it (an explode moves a group as one).
        group_of = {name: group["name"] for group in groups for name in group["parts"]}
        for part in scene.get("parts", []):
            if part.get("name") in group_of:
                part["group"] = group_of[part["name"]]
        _flush_output()
        # Inside the try: a scene that cannot be written as JSON (a NaN volume)
        # is refused before a byte of it is sent, and is a failure like any other.
        write_frame(channel, {"ok": True, "scene": scene}, blob)
        return shapes, kept
    except loader.LoadError as e:
        error = {"kind": e.kind, "message": e.message, "traceback": e.traceback}
    except SystemExit as e:
        error = _exception(f"{model} exited instead of defining a scene: sys.exit({e.code!r})")
    except BaseException as e:
        error = _exception(str(e) or type(e).__name__)
    _flush_output()
    write_frame(channel, {"ok": False, "error": error})
    return None


def _serve(channel: Any, shapes: dict[str, Any], kept: dict[Any, Any] | None = None) -> None:
    """Answer query frames until the supervisor closes the socket.

    ``kept`` is what the build worked out of the parts, to begin with.
    """
    # What a query works out of a part (its faces taken apart and boxed, its
    # area, its box) is the same for every later one: these shapes are the
    # worker's for its life.
    kept = {} if kept is None else kept
    while True:
        try:
            frame = read_frame(channel)
        except (ValueError, RecursionError) as e:
            # The frame was whole and its header was not JSON Python reads (an
            # integer of thousands of digits, brackets nested by the hundred
            # thousand): the next frame starts where it should. Whose request it
            # was cannot be said: the supervisor takes it for the oldest it waits on.
            _refuse_unread(channel, f"a request could not be read: {e}")
            continue
        if frame is None:
            break
        request, _ = frame
        if not isinstance(request, dict):
            _refuse_unread(channel, "a request must be a JSON object")
            continue
        try:
            result = queries.run(shapes, request.get("name"), request.get("args"), kept)
        except queries.QueryError as e:
            reply = {"ok": False, "error": {"kind": e.kind, "message": e.message}}
        except Exception as e:
            reply = {"ok": False, "error": _exception(str(e) or type(e).__name__)}
        else:
            reply = {"ok": True, "result": result}
        try:
            write_frame(channel, {"id": request.get("id"), **reply})
        except (ValueError, TypeError, RecursionError) as e:
            # A reply that is not JSON (an infinity, a NaN, a number of numpy's,
            # half a character) is refused before a byte of it is sent: the query
            # failed, the worker did not.
            why = f"the reply to {request.get('name')} could not be written"
            try:
                failed = _exception(f"{why}: {e}")
                write_frame(channel, {"id": request.get("id"), "ok": False, "error": failed})
            except (ValueError, TypeError, RecursionError):
                # Nor can what went wrong be: every query has its one reply all the same.
                failed = {"kind": "exception", "message": why.encode("ascii", "backslashreplace").decode()}
                write_frame(channel, {"id": _plain(request.get("id")), "ok": False, "error": failed})


def _refuse_unread(channel: Any, message: str) -> None:
    write_frame(channel, {"id": None, "ok": False, "error": {"kind": "bad_request", "message": message}})


def _plain(id: Any) -> Any:
    """The id of a request, or None for one that cannot be written back."""
    try:
        return id if isinstance(id, (int, str)) and str(id).isascii() else None
    except ValueError:
        # An integer of more digits than Python writes.
        return None


def _exception(message: str) -> dict[str, str]:
    return {"kind": "exception", "message": message, "traceback": traceback.format_exc()}


def _flush_output() -> None:
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.flush()
        except Exception:
            pass
