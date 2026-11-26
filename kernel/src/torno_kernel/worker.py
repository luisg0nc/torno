"""The forked build process: load, tessellate, reply once, then answer queries.

Everything here runs in a child of the supervisor and leaves through
``os._exit``, so the supervisor's own cleanup never runs twice.
"""

import ctypes
import json
import os
import resource
import select
import signal
import socket
import sys
import threading
import time
import traceback
from collections.abc import Callable
from pathlib import Path
from typing import Any, NoReturn

from . import loader, queries, tess
from .frames import read_frame, write_frame

_PR_SET_PDEATHSIG = 1
_PR_SET_DUMPABLE = 4


def run(
    sock: socket.socket,
    capture_fd: int,
    dir: str,
    model: str,
    parent: int | None = None,
    deadline: float | None = None,
    overrides: dict[str, Any] | None = None,
    trial: list[dict[str, Any]] | None = None,
    mesh: bool = False,
    shelf: bool = False,
) -> NoReturn:
    """Build ``dir/model`` and serve queries on ``sock``. Never returns.

    The caller has already closed the supervisor's other descriptors.
    ``capture_fd`` receives everything the model writes to stdout and stderr.
    ``parent`` is the supervisor's pid, read before the fork. ``deadline``
    (``time.monotonic``) is when the build's timeout runs out.
    ``overrides`` are values for fields of the model's ``Params`` (``loader.apply_overrides``).
    ``trial``, a list of queries (``name`` and ``args``), makes this a trial: the model is built, the queries are
    answered in this process, one frame says it all and the worker leaves; it never serves. With ``mesh`` that
    frame carries the mesh blob a build's does, and the folder above ``dir`` is first on ``sys.path`` (a copy of
    a build lies in a workspace of its own: the one the kernel runs in is not the one its imports are of).
    ``shelf`` makes it a read of the parts shelf of the workspace ``dir`` (``shelf.read``): one frame, no build, and it leaves.
    """
    try:
        _isolate(capture_fd, os.getppid() if parent is None else parent)
        channel = sock.makefile("rwb")
        if shelf:
            _shelf(channel, dir, deadline)
            return
        built = _build(channel, dir, model, deadline, overrides, trial, mesh)
        if built is not None:
            _serve(channel, *built)
    except BaseException:
        # Nothing may propagate into the supervisor's stack, which this
        # process inherited. A broken socket means the supervisor is gone.
        pass
    finally:
        os._exit(0)


def _isolate(capture_fd: int, parent: int) -> None:
    if sys.platform.startswith("linux"):
        libc = ctypes.CDLL(None)
        # No core dump: with systemd-coredump a crashed worker takes seconds to reap.
        libc.prctl(_PR_SET_DUMPABLE, 0)
        # Die with the supervisor even if it is killed before it can clean up.
        libc.prctl(_PR_SET_PDEATHSIG, int(signal.SIGKILL))
    else:
        # macOS has no prctl: no core file by the limit, and a thread that sees the supervisor go.
        resource.setrlimit(resource.RLIMIT_CORE, (0, 0))
        threading.Thread(target=_watch_parent, args=(parent,), daemon=True, name="parent-watch").start()
    devnull = os.open(os.devnull, os.O_RDONLY)
    os.dup2(devnull, 0)  # a model that reads stdin must not eat protocol frames
    os.close(devnull)
    os.dup2(capture_fd, 1)
    os.dup2(capture_fd, 2)
    # Line buffered, so the output survives a crash or a kill.
    sys.stdout.reconfigure(line_buffering=True)
    sys.stderr.reconfigure(line_buffering=True)


def _watch_parent(parent: int, leave: Callable[[int], Any] = os._exit) -> None:
    """Leave, with the whole process, once the process ``parent`` is gone. Runs in a thread of its own.

    Where there is kqueue it waits for the process to exit; where there is none (or it cannot be
    asked) it looks every half second whether this process has been given to another parent.
    The thread does nothing else and holds no lock the model's code could want.
    """
    try:
        kqueue = select.kqueue()
        event = select.kevent(
            parent,
            filter=select.KQ_FILTER_PROC,
            flags=select.KQ_EV_ADD | select.KQ_EV_ONESHOT,
            fflags=select.KQ_NOTE_EXIT,
        )
        try:
            kqueue.control([event], 0, 0)  # registers; an error is raised here, not told as an event
        except ProcessLookupError:
            leave(0)  # the supervisor is already gone
            return
        kqueue.control(None, 1, None)
        leave(0)
        return
    except (AttributeError, OSError):
        pass  # no kqueue, or it will not watch this process
    while os.getppid() == parent:
        time.sleep(0.5)
    leave(0)


def _build(
    channel: Any,
    dir: str,
    model: str,
    deadline: float | None = None,
    overrides: dict[str, Any] | None = None,
    trial: list[dict[str, Any]] | None = None,
    mesh: bool = False,
) -> tuple[dict[str, Any], dict[Any, Any]] | None:
    """Send the build's one result frame.

    Returns the shapes and what the build worked out of each part that its
    queries would otherwise work out again, or None on failure. A failure
    inside a fillet, a chamfer or a boolean of build123d carries why it failed
    (``diagnose``), found here, before the frame is written, within what the
    build's ``deadline`` leaves.
    """
    try:
        report: dict[str, Any] = {}
        if trial is not None and mesh:
            sys.path.insert(0, str(Path(dir).resolve().parent))
        layouts, params, groups, declared = loader.load_model(Path(dir), model, overrides, report)
        kept: dict[Any, Any] = {}
        scene, blob, shapes = tess.build_scene(layouts, model, kept)
        # Read here, by the worker that loaded the model: the supervisor never does.
        scene["params"] = params
        # Which overrides the build took, and which it dropped (with why): told, never silently lost.
        scene["overrides"] = {"applied": report.get("applied", {}), "dropped": report.get("dropped", [])}
        scene["groups"] = groups
        scene["uses"] = loader.used_files(Path(dir), model)
        # The parts of the shelf (common/parts/<id>/part.py) it used and how many times its code called each: null where
        # that could not be counted (no sys.monitoring before Python 3.12, a part imported inside a maker).
        shelf = loader.shelf_uses((Path(dir) / model).resolve().parent.parent, scene["uses"])
        if shelf:
            calls = report.get("shelf_calls", {})
            scene["shelf"] = {id: calls.get(id) for id in shelf}
        # Each part names its group, so that whoever has the part has it (an explode moves a group as one).
        group_of = {name: group["name"] for group in groups for name in group["parts"]}
        for part in scene.get("parts", []):
            if part.get("name") in group_of:
                part["group"] = group_of[part["name"]]
        _tag_parts(scene, getattr(layouts, "tags", {}), kept)
        # Which files the build is of, for a rename the person asks for (``names.query``): read again then, never written.
        kept["source",] = {"dir": dir, "model": model, "uses": scene["uses"]}
        scene["checks"] = _model_checks(declared, shapes, groups, kept)
        _flush_output()
        # Inside the try: a scene that cannot be written as JSON (a NaN volume)
        # is refused before a byte of it is sent, and is a failure like any other.
        if trial is not None:
            answers = _answers(trial, shapes, kept)
            _flush_output()
            write_frame(channel, {"ok": True, "scene": scene, "answers": answers}, blob if mesh else b"")
            return None
        write_frame(channel, {"ok": True, "scene": scene}, blob)
        return shapes, kept
    except loader.LoadError as e:
        error = {"kind": e.kind, "message": e.message, "traceback": e.traceback}
        failed: BaseException = e
    except SystemExit as e:
        error = _exception(f"{model} exited instead of defining a scene: sys.exit({e.code!r})")
        failed = e
    except BaseException as e:
        error = _exception(str(e) or type(e).__name__)
        failed = e
    _flush_output()
    diagnosis = _diagnose(failed, error, deadline)
    if diagnosis is not None:
        error["diagnosis"] = diagnosis
    write_frame(channel, {"ok": False, "error": error})
    return None


def _shelf(channel: Any, root: str, deadline: float | None) -> None:
    """Send the one frame of a shelf read: ``{"ok": true, "shelf": {"parts": [...]}}``, or the error that stopped it."""
    from . import shelf

    try:
        write_frame(channel, {"ok": True, "shelf": shelf.read(Path(root), deadline)})
    except BaseException as e:
        write_frame(channel, {"ok": False, "error": _exception(str(e) or type(e).__name__)})


def _tag_parts(scene: dict[str, Any], tags: dict[tuple[str, str], Any], kept: dict[Any, Any]) -> None:
    """Each part names the tags the model gave it (``Part.tags``: tag → faces and edges by index), and the worker
    keeps them for ``queries.resolve``. Indices were matched before the print layout was spread, and spreading
    keeps the order of faces and edges."""
    for part in scene.get("parts", []):
        named = tags.get((part.get("layout"), part.get("name")))
        if named:
            part["tags"] = named
            kept["tags", part["key"]] = named


def _answers(asked: list[dict[str, Any]], shapes: dict[str, Any], kept: dict[Any, Any]) -> list[dict[str, Any]]:
    """The reply to each query of a trial, in order: ``{"ok": true, "result": …}`` or ``{"ok": false, "error": …}``.
    A query that fails, or whose answer cannot be written, fails alone."""
    answers: list[dict[str, Any]] = []
    for request in asked:
        try:
            result = queries.run(shapes, request.get("name"), request.get("args"), kept)
            if isinstance(result, queries.WithBlob):
                result = result.result
            reply: dict[str, Any] = {"ok": True, "result": result}
            json.dumps(reply, allow_nan=False)
        except queries.QueryError as e:
            reply = {"ok": False, "error": {"kind": e.kind, "message": e.message}}
        except Exception as e:
            reply = {"ok": False, "error": _exception(str(e) or type(e).__name__)}
        answers.append(reply)
    return answers


def _model_checks(
    declared: list[dict[str, Any]], shapes: dict[str, Any], groups: list[dict[str, Any]], kept: dict[Any, Any]
) -> list[dict[str, Any]]:
    """The results of the checks the model declares (``modelchecks.run``): none of them fails the build."""
    if not declared:
        return []
    from . import modelchecks

    return modelchecks.run(declared, shapes, groups, kept)


def _diagnose(error: BaseException, told: dict[str, Any], deadline: float | None) -> dict[str, Any] | None:
    """Why a fillet, a chamfer or a boolean of build123d failed, if one raised ``error``; None otherwise.

    It runs in this worker, which is about to exit: no fork, no other process. What OCC
    might print meanwhile is not the model's output, and is not captured with it. It runs
    fillets the model never ran, and one of them may crash the worker or run past the
    build's timeout: so the error as it stands (``told``) is written to the captured output
    first, where a crash or a timeout still reports it, and taken out again once the
    diagnosis is over.
    """
    from . import diagnose

    # Whatever goes wrong here, the build's own error is still written: a diagnosis that fails is none.
    try:
        if diagnose.find(error) is None:
            return None
        noted = _note(told)
        saved = [os.dup(1), os.dup(2)]
        devnull = os.open(os.devnull, os.O_WRONLY)
    except Exception:
        return None
    try:
        os.dup2(devnull, 1)
        os.dup2(devnull, 2)
        return diagnose.from_exception(error, diagnose.budget_left(deadline))
    except Exception:
        return None
    finally:
        _flush_output()
        os.dup2(saved[0], 1)
        os.dup2(saved[1], 2)
        for fd in (*saved, devnull):
            os.close(fd)
        if noted is not None:
            _unnote(noted)


def _note(told: dict[str, Any]) -> int | None:
    """Write the build's error at the end of the captured output, saying a diagnosis follows; where it began,
    or None when the capture cannot be cut back to that (it is then not written)."""
    try:
        at = os.lseek(1, 0, os.SEEK_END)
    except OSError:
        return None
    last = [line for line in str(told.get("traceback") or "").splitlines() if line.strip()][-1:]
    text = (
        f"[torno] The build failed: {told.get('message', '')}\n"
        + "".join(f"[torno] {line.strip()}\n" for line in last)
        + "[torno] It was being tried again in parts to say why; if the build ends here, that stopped it.\n"
    )
    try:
        os.write(1, text.encode("utf-8", "replace"))
    except OSError:
        return None
    return at


def _unnote(at: int) -> None:
    """Cut the captured output back to where the note began: the diagnosis ended, and the error says it all."""
    try:
        os.ftruncate(1, at)
        os.lseek(1, at, os.SEEK_SET)
    except OSError:
        pass


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
        # A file made of the build (``export``) goes as the reply's blob, beside its result.
        blob = b""
        try:
            result = queries.run(shapes, request.get("name"), request.get("args"), kept)
        except queries.QueryError as e:
            reply = {"ok": False, "error": {"kind": e.kind, "message": e.message}}
        except Exception as e:
            reply = {"ok": False, "error": _exception(str(e) or type(e).__name__)}
        else:
            if isinstance(result, queries.WithBlob):
                result, blob = result.result, result.blob
            reply = {"ok": True, "result": result}
        try:
            write_frame(channel, {"id": request.get("id"), **reply}, blob)
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
