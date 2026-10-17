"""The kernel's long-running process: routes requests and owns the workers.

It forks one worker per build and keeps, for each object folder, the last one
that succeeded alive to answer queries about that object: at most MAX_LIVE of
them, the least recently built or queried making room for another, and fewer
when memory is short for the next build (``_make_room``). It imports
the geometry modules so that workers inherit them, but it never calls them: one
OCC operation here would start OCC's thread pool, and every worker forked
afterwards would deadlock.

It never blocks on a write. Frames for the client and for the live workers go
into outboxes that are drained as the other end makes room, so the loop keeps
reading from all of them even when one pipelines faster than it reads.
"""

import io
import json
import math
import os
import select
import signal
import socket
import struct
import sys
import tempfile
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any, BinaryIO

from . import machmem
from . import worker as worker_module
from .frames import write_frame

DEFAULT_TIMEOUT = 600.0
MAX_TIMEOUT = 86400.0  # a day; a longer wait is also more than the event loop can sleep
MAX_LIVE = 4  # object folders whose last good build is kept for queries
QUERY_TIMEOUT = 30.0  # seconds a live worker has to answer a query
# Memory a build is taken to need, in bytes: what the folder's live worker holds, ROOM_LEAST
# when that is less or there is none, and ROOM_SPARE on top.
ROOM_LEAST = 2 << 30
ROOM_SPARE = 2 << 30
_PROC = "/proc"
OUTPUT_LINES = 200
_OUTPUT_TAIL_BYTES = 1 << 20
_TERM_GRACE = 0.5  # seconds a replaced worker gets to exit on SIGTERM
_EXIT_GRACE = 2.0  # seconds a worker that closed its socket gets to finish dying
_DRAIN_GRACE = 1.0  # seconds the client gets to read the last replies at exit
_WRITE_CHUNK = 1 << 18
_PREFIX = struct.Struct(">II")


def build_timeout(value: Any) -> float | None:
    """The seconds a build may take, given a request's ``timeout``. None if it is no good.

    The default when the request names none; at most MAX_TIMEOUT. A timeout
    that is not a positive, finite number is refused.
    """
    if value is None:
        return DEFAULT_TIMEOUT
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    if not math.isfinite(value) or value <= 0:
        return None
    return min(float(value), MAX_TIMEOUT)


def _is_result(header: Any) -> bool:
    """Whether a worker's frame is a build result: ``ok`` with a scene, or not with an error.

    And one that can be passed on: a worker's own code writes nothing else.
    """
    if not isinstance(header, dict):
        return False
    if not isinstance(header.get("scene" if header.get("ok") else "error"), dict):
        return False
    return _unwritable(header) is None


def _unwritable(value: Any) -> str | None:
    """Why what was read of a frame cannot be written in one, or None when it can.

    Python reads JSON that it will not write: ``NaN`` and the infinities, and
    half a character (a lone surrogate, which a JavaScript encoder writes as
    an escape). What is nested deeper than Python follows is refused too.
    """
    try:
        _encoded(value)
    except UnicodeError:
        return "holds text that is not Unicode: a lone surrogate, \\ud800 to \\udfff"
    except ValueError:
        return "holds a number that is not finite: NaN and the infinities are not JSON"
    except RecursionError:
        return "is nested too deeply"
    return None


def _written(header: Any, blob: bytes) -> bytes | None:
    """A frame as bytes, or None for what cannot be written in one (``_unwritable``)."""
    try:
        return _encoded(header, blob)
    except (ValueError, RecursionError):
        return None


def _encoded(header: Any, blob: bytes = b"") -> bytes:
    """A frame as bytes. Raises as ``write_frame`` does for what is not JSON."""
    frame = io.BytesIO()
    write_frame(frame, header, blob)
    return frame.getvalue()


# What a frame is read as when it is JSON nested deeper than Python follows.
_TOO_DEEP = object()


class _Decoder:
    """Reassembles frames from whatever chunks a pipe or socket delivers."""

    def __init__(self) -> None:
        self._data = bytearray()

    def feed(self, chunk: bytes) -> Iterator[tuple[Any, bytes]]:
        """Add a chunk and yield every frame it completes.

        A header that is not JSON is None, and one too deep to read _TOO_DEEP:
        neither is an object, which is all a frame may be.
        """
        self._data += chunk
        while len(self._data) >= _PREFIX.size:
            header_len, blob_len = _PREFIX.unpack_from(self._data)
            end = _PREFIX.size + header_len + blob_len
            if len(self._data) < end:
                return
            header = bytes(self._data[_PREFIX.size : _PREFIX.size + header_len])
            blob = bytes(self._data[_PREFIX.size + header_len : end])
            del self._data[:end]
            try:
                decoded = json.loads(header.decode("utf-8"))
            except ValueError:
                # Not JSON; the framing is intact, so carry on.
                decoded = None
            except RecursionError:
                decoded = _TOO_DEEP
            yield decoded, blob


class _Outbox:
    """Frames waiting to be written to a non-blocking pipe or socket."""

    def __init__(self, write: Callable[[bytes], int]) -> None:
        self._write = write
        self._data = bytearray()

    def __bool__(self) -> bool:
        return bool(self._data)

    def push(self, header: dict[str, Any], blob: bytes = b"") -> None:
        """Queue a frame and write as much as the other end has room for."""
        self.write(_encoded(header, blob))

    def write(self, frame: bytes) -> None:
        """Queue a frame already in bytes, likewise."""
        self._data += frame
        self.flush()

    def flush(self) -> None:
        """Write until the queue is empty or the other end is full. May raise OSError."""
        while self._data:
            try:
                written = self._write(bytes(self._data[:_WRITE_CHUNK]))
            except BlockingIOError:
                return
            del self._data[:written]


@dataclass
class _Worker:
    pid: int
    dir: str  # the object folder it built
    sock: socket.socket
    request_id: Any  # the build request it is, or was, working on
    started: float
    deadline: float
    timeout: float
    capture: BinaryIO | None  # the model's stdout and stderr, until the build ends
    outbox: _Outbox  # queries on their way to it
    decoder: _Decoder = field(default_factory=_Decoder)
    # Queries sent and not yet answered, oldest first: (id, when to give up on it).
    queries: list[tuple[Any, float]] = field(default_factory=list)
    # Queries to it that timed out and that it has not answered yet: it answers one at a
    # time, so it is still busy with them, and with nothing else until it has sent as many frames.
    abandoned: int = 0

    @property
    def stalled(self) -> bool:
        return self.abandoned > 0

    def answered(self, id: Any) -> bool:
        """Take the query ``id`` off the list. False if it was not waiting for an answer."""
        for index, (waiting, _) in enumerate(self.queries):
            if waiting == id:
                del self.queries[index]
                return True
        return False


class Supervisor:
    def __init__(self, stdin_fd: int, proto_out: BinaryIO) -> None:
        self._stdin_fd = stdin_fd
        self._out = proto_out
        # Written through its descriptor only, never through the buffered file.
        os.set_blocking(proto_out.fileno(), False)
        self._outbox = _Outbox(lambda data: os.write(proto_out.fileno(), data))
        self._requests = _Decoder()
        self._building: _Worker | None = None
        # By object folder, the least recently built or queried first.
        self._live: dict[str, _Worker] = {}
        # The folders whose build was let go for memory and that have had none since.
        self._let_go: set[str] = set()
        self._running = True

    def run(self, versions: dict[str, str]) -> int:
        """Serve requests until ``shutdown`` or the end of stdin. Returns the exit code."""
        try:
            self._send({"event": "ready", "versions": versions})
            while self._running:
                self._step()
        except BrokenPipeError:
            pass  # the client is gone
        finally:
            for worker in (self._building, *self._live.values()):
                if worker:
                    self._stop(worker, signal.SIGKILL)
        self._drain()
        return 0

    def _drain(self) -> None:
        """Give the client a moment to read the replies still queued for it."""
        give_up = time.monotonic() + _DRAIN_GRACE
        try:
            while self._outbox and (wait := give_up - time.monotonic()) > 0:
                select.select([], [self._out], [], wait)
                self._outbox.flush()
        except OSError:
            pass  # the client is gone

    def _step(self) -> None:
        # The live workers first: a build that finishes in this round replaces
        # one of them, and the replies that one has already sent are passed on
        # before its unanswered queries are called cancelled.
        workers = list(self._live.values())
        deadlines = [w.queries[0][1] for w in workers if w.queries]
        if self._building:
            workers.append(self._building)
            deadlines.append(self._building.deadline)
        wait = max(0.0, min(deadlines) - time.monotonic()) if deadlines else None
        reading = [self._stdin_fd, *(w.sock for w in workers)]
        writing = [w.sock for w in workers if w.outbox]
        if self._outbox:
            writing.append(self._out)
        readable, writable, _ = select.select(reading, writing, [], wait)
        if self._out in writable:
            self._outbox.flush()
        for worker in workers:
            if worker.sock in writable and self._is_live(worker):
                self._send_queries(worker)
            # An earlier iteration may have retired this worker.
            if worker.sock in readable and (worker is self._building or self._is_live(worker)):
                self._read_worker(worker)
        now = time.monotonic()
        for worker in list(self._live.values()):
            self._time_out_queries(worker, now)
        if self._building and now >= self._building.deadline:
            self._time_out(self._building)
        if self._stdin_fd in readable:
            chunk = os.read(self._stdin_fd, 1 << 16)
            if not chunk:
                self._running = False
                return
            for request, _ in self._requests.feed(chunk):
                self._handle(request)

    # Requests

    def _handle(self, request: Any) -> None:
        if request is _TOO_DEEP:
            self._fail(None, "bad_request", "the request is nested too deeply")
            return
        if not isinstance(request, dict):
            self._fail(None, "bad_request", "a request must be a JSON object")
            return
        # Every reply names its request: by an id that can be written, or by none.
        id = request.get("id")
        if (why := _unwritable(id)) is not None:
            self._fail(None, "bad_request", f"the id of the request {why}")
            return
        op = request.get("op")
        if op == "build":
            self._build(id, request)
        elif op == "query":
            self._query(id, request)
        elif op == "cancel":
            self._cancel_building("cancelled by request")
        elif op == "shutdown":
            self._running = False
        elif op is None or isinstance(op, str):
            # repr writes half a character as its escape.
            self._fail(id, "bad_request", f"unknown op {op!r}")
        else:
            # Not told back: it may be nested deeper than can be written.
            self._fail(id, "bad_request", "unknown op: the op of a request is a string")

    def _build(self, id: Any, request: dict[str, Any]) -> None:
        dir, model, timeout = request.get("dir"), request.get("model"), request.get("timeout")
        if not isinstance(dir, str) or not isinstance(model, str):
            self._fail(id, "bad_request", "build needs dir and model, both strings")
            return
        # They are told again in replies, for as long as the build is kept.
        if (why := _unwritable([dir, model])) is not None:
            self._fail(id, "bad_request", f"the request {why}")
            return
        timeout = build_timeout(timeout)
        if timeout is None:
            self._fail(
                id, "bad_request", "build timeout must be a positive, finite number of seconds"
            )
            return
        self._cancel_building("replaced by a newer build")
        retired = self._make_room(dir)
        self._building = self._fork(id, dir, model, timeout)
        started = {"id": id, "event": "build.started", "pid": self._building.pid}
        self._send({**started, "retired": retired})

    def _make_room(self, dir: str) -> list[str]:
        """Let live workers go until there is memory for a build of ``dir``. The folders let go.

        The build is taken to need what the folder's live worker holds
        (ROOM_LEAST at least) and ROOM_SPARE: a worker is forked from here and
        shares nothing with the one before it. The other folders' workers go
        first, the least recently used first, then the folder's own. Nothing
        goes when memory cannot be read. On Linux two files of /proc are read; on macOS Mach
        is asked for the VM statistics and libproc for the worker's resident size. Nothing else.

        Nor does anything go with ``TORNO_KEEP_BUILDS=1`` in the environment:
        the switch of torno's own test suites, whose builds must not depend on
        how much memory the machine has free. Nothing sets it in use.
        """
        if os.environ.get("TORNO_KEEP_BUILDS") == "1":
            return []
        available = _available()
        own = self._live.get(dir)
        held = _rss(own.pid) if own else 0
        if available is None or held is None:
            return []
        need = max(held, ROOM_LEAST) + ROOM_SPARE
        retired: list[str] = []
        for other in [*(d for d in self._live if d != dir), *([dir] if own else [])]:
            if available >= need:
                break
            self._let_go.add(other)
            self._retire(self._live.pop(other), "no_build", _no_room(other), reason="memory")
            retired.append(other)
            # Reaped: what it held is free.
            available = _available()
            if available is None:
                break
        return retired

    def _query(self, id: Any, request: dict[str, Any]) -> None:
        dir = request.get("dir")
        if not isinstance(dir, str):
            self._fail(id, "bad_request", "query needs dir, the object's folder, a string")
            return
        query = {"id": id, "name": request.get("name"), "args": request.get("args")}
        # Refused here, with its id, rather than by a worker that could not say whose it was.
        if (why := _unwritable([dir, query])) is not None:
            self._fail(id, "bad_request", f"the request {why}")
            return
        live = self._live.get(dir)
        if live is None and dir in self._let_go:
            self._fail(id, "no_build", _no_room(dir), reason="memory")
            return
        if live is None:
            self._fail(
                id,
                "no_build",
                f"there is no build of {dir} to query: none has succeeded yet, "
                "or it made room for more recent ones; build it again",
            )
            return
        self._live[dir] = self._live.pop(dir)  # the most recently used
        if live.stalled:
            # It answers one query at a time: this one would only wait its own 30 s behind
            # the one that was given up on. The app knows this answer by its words (isBusy in
            # app/src/main/kernel/client.ts, pinned by client.busy.test.ts): change both.
            self._fail(
                id,
                "timeout",
                f"the build of {dir} is still busy with a query it did not answer "
                f"within {QUERY_TIMEOUT:g} s; ask again when it has",
            )
            return
        live.queries.append((id, time.monotonic() + QUERY_TIMEOUT))
        try:
            live.outbox.push(query)
        except OSError:
            self._live_died(live)

    def _send_queries(self, live: _Worker) -> None:
        try:
            live.outbox.flush()
        except OSError:
            self._live_died(live)

    def _cancel_building(self, reason: str) -> None:
        worker = self._building
        if worker is None:
            return
        self._building = None
        self._stop(worker, signal.SIGKILL)
        self._fail(worker.request_id, "cancelled", reason, output=self._take_output(worker))

    # Workers

    def _fork(self, id: Any, dir: str, model: str, timeout: float) -> _Worker:
        ours, theirs = socket.socketpair()
        capture = tempfile.TemporaryFile()
        # Whatever is buffered here would otherwise be written again by the child.
        sys.stdout.flush()
        sys.stderr.flush()
        parent = os.getpid()  # read before the fork: a worker's getppid() may already be 1
        pid = os.fork()
        if pid == 0:
            try:
                ours.close()
                self._out.close()  # nothing is buffered: every frame is flushed
                for live in self._live.values():
                    live.sock.close()
            finally:
                worker_module.run(theirs, capture.fileno(), dir, model, parent)
        theirs.close()
        ours.setblocking(False)
        now = time.monotonic()
        return _Worker(pid, dir, ours, id, now, now + timeout, timeout, capture, _Outbox(ours.send))

    def _is_live(self, worker: _Worker) -> bool:
        return self._live.get(worker.dir) is worker

    def _read_worker(self, worker: _Worker) -> None:
        try:
            chunk = worker.sock.recv(1 << 20)
        except BlockingIOError:
            return
        except OSError:
            chunk = b""
        if not chunk:
            if worker is self._building:
                self._build_died(worker)
            else:
                self._live_died(worker)
            return
        for header, blob in worker.decoder.feed(chunk):
            if worker is self._building:
                if _is_result(header):
                    self._build_finished(worker, header, blob)
                else:
                    self._build_garbled(worker)
            elif not self._is_live(worker):
                return  # an earlier frame of this chunk ended it
            elif not isinstance(header, dict) or (passed_on := _written(header, blob)) is None:
                # Not a reply, or one that cannot be passed on: it is past trusting.
                self._live_died(worker)
            elif header.get("id") is None:
                # It could not read the request, so it cannot say which it answers: it
                # answers one at a time, in order, those given up on first.
                if worker.abandoned > 0:
                    worker.abandoned -= 1
                elif worker.queries:
                    id, _ = worker.queries.pop(0)
                    self._send({**header, "id": id}, blob)
            else:
                if worker.answered(header.get("id")):
                    # As it was written to see that it can be: not written again.
                    self._outbox.write(passed_on)
                elif worker.abandoned > 0:
                    # The answer to a query already given up on: it is dropped, and the
                    # worker has one less of them to get through.
                    worker.abandoned -= 1

    def _build_finished(self, worker: _Worker, result: dict[str, Any], blob: bytes) -> None:
        self._building = None
        output = self._take_output(worker)
        if not result.get("ok"):
            self._stop(worker, signal.SIGKILL)
            error = {**result["error"], "output": output}
            self._send({"id": worker.request_id, "ok": False, "error": error})
            return
        scene = {**result["scene"], "seconds": time.monotonic() - worker.started, "output": output}
        previous = self._live.pop(worker.dir, None)
        self._live[worker.dir] = worker
        self._let_go.discard(worker.dir)
        if previous:
            self._retire(
                previous, "cancelled", "a newer build replaced the one this query was sent to"
            )
        while len(self._live) > MAX_LIVE:
            least_recent = next(iter(self._live))
            self._retire(
                self._live.pop(least_recent),
                "no_build",
                f"the build of {least_recent} made room for more recent ones; build it again",
            )
        self._send({"id": worker.request_id, "ok": True, "scene": scene}, blob)

    def _build_died(self, worker: _Worker) -> None:
        """The building worker closed its socket without sending a result."""
        self._building = None
        worker.sock.close()
        status = _wait(worker.pid, _EXIT_GRACE)
        if status is None:
            # Its socket is closed but it is still running: it cannot report any more.
            _kill(worker.pid, signal.SIGKILL)
            _, status = os.waitpid(worker.pid, 0)
        if os.WIFSIGNALED(status):
            number = os.WTERMSIG(status)
            how = f"was killed by {signal.Signals(number).name} ({signal.strsignal(number)})"
        else:
            how = f"exited with status {os.WEXITSTATUS(status)}"
        self._fail(
            worker.request_id,
            "crash",
            f"the build process {how} before it finished",
            output=self._take_output(worker),
        )

    def _build_garbled(self, worker: _Worker) -> None:
        """The building worker sent something that is not a result: it is past trusting."""
        self._building = None
        self._stop(worker, signal.SIGKILL)
        self._fail(
            worker.request_id,
            "crash",
            "the build process sent a result that could not be read",
            output=self._take_output(worker),
        )

    def _time_out(self, worker: _Worker) -> None:
        self._building = None
        self._stop(worker, signal.SIGKILL)
        self._fail(
            worker.request_id,
            "timeout",
            f"the build did not finish within {worker.timeout:g} s and was stopped; "
            "set TORNO_BUILD_TIMEOUT to a number of seconds to allow more",
            output=self._take_output(worker),
        )

    def _time_out_queries(self, worker: _Worker, now: float) -> None:
        """Answer the queries a live worker has had for too long. The worker is left alone."""
        while worker.queries and worker.queries[0][1] <= now:
            id, _ = worker.queries.pop(0)
            worker.abandoned += 1
            self._fail(
                id,
                "timeout",
                f"the query was not answered within {QUERY_TIMEOUT:g} s; "
                "the build it was sent to is still there",
            )

    def _live_died(self, worker: _Worker) -> None:
        del self._live[worker.dir]
        self._stop(worker, signal.SIGKILL)
        for id, _ in worker.queries:
            self._fail(id, "crash", "the process holding the built parts died; rebuild to query")

    def _retire(self, worker: _Worker, kind: str, message: str, **extra: str) -> None:
        """Stop a worker that is no longer live, answering its waiting queries with ``kind``."""
        self._stop(worker, signal.SIGTERM)
        for id, _ in worker.queries:
            self._fail(id, kind, message, **extra)

    def _stop(self, worker: _Worker, sig: signal.Signals) -> None:
        """Signal a worker, close its socket and reap it."""
        worker.sock.close()
        _kill(worker.pid, sig)
        if sig != signal.SIGKILL and _wait(worker.pid, _TERM_GRACE) is not None:
            return
        _kill(worker.pid, signal.SIGKILL)
        os.waitpid(worker.pid, 0)

    def _take_output(self, worker: _Worker) -> str:
        """The last lines the model printed. Closes the capture file."""
        capture, worker.capture = worker.capture, None
        if capture is None:
            return ""
        with capture:
            # pread, because the worker shares this descriptor's file offset.
            size = os.fstat(capture.fileno()).st_size
            start = max(0, size - _OUTPUT_TAIL_BYTES)
            text = os.pread(capture.fileno(), size - start, start).decode("utf-8", "replace")
        return "".join(text.splitlines(keepends=True)[-OUTPUT_LINES:])

    # Output

    def _send(self, header: dict[str, Any], blob: bytes = b"") -> None:
        self._outbox.push(header, blob)

    def _fail(self, id: Any, kind: str, message: str, **extra: str) -> None:
        self._send({"id": id, "ok": False, "error": {"kind": kind, "message": message, **extra}})


def _no_room(dir: str) -> str:
    """What a query is told of a folder whose build was let go for memory."""
    return (
        f"the build of {dir} was let go to make room for the next one (memory); "
        "it can be queried again when a build of it has succeeded"
    )


def _available() -> int | None:
    """The memory a new process could have, in bytes: MemAvailable (on macOS, free and inactive pages).

    None if it cannot be read.
    """
    if sys.platform == "darwin":
        return machmem.available()
    return _kilobytes(f"{_PROC}/meminfo", "MemAvailable:")


def _rss(pid: int) -> int | None:
    """The memory a process holds, in bytes: its VmRSS. None if it cannot be read.

    Of ``status``, which anyone may read of a worker that set PR_SET_DUMPABLE
    to 0 (``smaps_rollup`` may not be). On macOS, the resident size libproc tells.
    """
    if sys.platform == "darwin":
        return machmem.rss(pid)
    return _kilobytes(f"{_PROC}/{pid}/status", "VmRSS:")


def _kilobytes(path: str, field: str) -> int | None:
    try:
        with open(path, encoding="ascii", errors="replace") as file:
            for line in file:
                if line.startswith(field):
                    return int(line.split()[1]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return None


def _kill(pid: int, sig: signal.Signals) -> None:
    try:
        os.kill(pid, sig)
    except ProcessLookupError:
        pass


def _wait(pid: int, seconds: float) -> int | None:
    """Reap a child that is expected to exit. Returns its status, or None if it has not."""
    give_up = time.monotonic() + seconds
    while True:
        reaped, status = os.waitpid(pid, os.WNOHANG)
        if reaped:
            return status
        if time.monotonic() >= give_up:
            return None
        time.sleep(0.002)
