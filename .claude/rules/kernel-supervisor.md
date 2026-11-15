---
paths:
  - "kernel/**"
---

# The kernel: supervisor, workers, memory, timeouts, frames

Moved as written from the folder `CLAUDE.md` files; each heading names the folder it came from, and paths are written as they were there (see "Rules by area" in the root `CLAUDE.md`).

## About this folder (`kernel`)

The Python package `torno_kernel`: it loads build123d models and tessellates them in forked workers, answers
what is asked of the last build, and imports scans in a process of its own.

## Kernel invariants (`kernel`)

- **The supervisor only imports.** `python -m torno_kernel` imports build123d
  and ocp-tessellate so that every worker it forks has them loaded, and then
  only routes frames. It never loads a model, builds, tessellates or answers a
  query: one OCC operation in it would start OCC's thread pool, and every
  worker forked afterwards would deadlock. It reads two files of `/proc`
  before a build (`meminfo` again after each worker it lets go) and nothing
  else of the system; on macOS it asks Mach for the VM statistics and libproc for the worker's resident
  size instead, and nothing else.
- **OCP's names come from OCP.** In a workspace with a `pyproject.toml` the kernel runs in the workspace's
  environment with the kernel laid over it (`uv run --no-sync --project <ws> --with-editable <kernel>`): its OCP
  and build123d are the workspace's, and ocp-tessellate is resolved afresh within the kernel's `>=3.5,<4`
  (3.6.2 beside OCP 8.0.1.1 in the owner's), not the 3.5.3 the tests run with. 3.6 no longer hands on OCP's
  names from `ocp_utils`, so a name of OCP is imported from OCP (`torno_kernel/ocp.py` for the TopTools maps
  and the label sequence that some builds moved to `OCP.collections`, `IFSelect_RetDone`, and `downcast`), and from ocp-tessellate only its own functions:
  `tests/test_ocp_names.py` holds the list.
- **Workers never fork.** One worker is forked per build. For each object
  folder, the last one that succeeded stays alive to answer queries about that
  object, and is replaced when the next build of that folder succeeds. At most
  four stay alive: a fifth folder retires the one least recently built or
  queried, whose queries are then `no_build`. Fewer stay when memory is
  short: before a build is forked the supervisor reads `MemAvailable`
  (`/proc/meminfo`) and the `VmRSS` of the folder's live worker
  (`/proc/<pid>/status`); on macOS it asks Mach for the VM statistics (free and inactive pages) and libproc
  for the worker's resident size, by ctypes alone (`machmem.py`), and nothing else of the system. It takes the build to need that (`ROOM_LEAST`, 2 GiB,
  at least) and `ROOM_SPARE` (2 GiB) more, and while less is available
  retires the live workers of other folders, least recently used first, then
  the folder's own (`Supervisor._make_room`). `build.started` carries
  `retired`, the folders let go; a query of one is `no_build` with `reason:
  "memory"` until a build of it succeeds. When `/proc` cannot be read nothing
  is retired; nor with `TORNO_KEEP_BUILDS=1`, which torno's own test suites
  set (`kernel/tests/conftest.py`, `app/vitest.config.ts`,
  `app/playwright.config.ts`) and nothing in use ever does. A worker keeps what `nearest`
  worked out of each part it was asked about. A query names its folder (`dir`)
  and has 30 s from when the worker takes it up, not from when it was queued: it answers one at a time, in
  order, so the clock of a query starts when the one ahead of it is answered (`_Worker.start_next`), and a few
  asked at once (read tools called together) do not time each other out; an `export` or an `export_check` has
  `EXPORT_TIMEOUT` (120 s) in place of the 30 (`supervisor.query_seconds`). Past its time a query is answered
  `timeout` and the worker left alone; those queued behind it are answered `timeout` at once, as busy (they were
  sent, and the worker answers them in their turn). Until that worker has answered every query that was given up
  on, new queries to it are answered `timeout` at once the same way: it answers one at a time, and is still
  busy with those. The busy answer names the time the query it was given up on had (`_Worker.stuck`): 30 s, or
  120 s behind an export.
  A worker leaves through `os._exit`.
- **prctl.** Each worker sets `PR_SET_PDEATHSIG` to SIGKILL, so it dies with
  the supervisor even when that is killed, and `PR_SET_DUMPABLE` to 0, so a
  crashing model does not wait seconds on a core dump. macOS has no prctl: there a worker sets
  `RLIMIT_CORE` to 0 and starts a daemon thread (`worker._watch_parent`) that waits with kqueue for the
  supervisor's exit (polling `getppid()` where there is no kqueue) and then calls `os._exit(0)`. The
  supervisor's pid is read before the fork and passed to the worker, so a supervisor that dies in between is
  still seen. The thread is not a fork and holds no lock a model could want.
- **Socket buffers.** On macOS the supervisor sets `SO_SNDBUF` and `SO_RCVBUF` of both ends of each worker's
  socketpair to `SOCKET_BUFFER` (1 MiB) before the fork: macOS gives about 8 KB, and a 64 MiB mesh then took
  149 ms to pass against 10 ms. Linux's are left as they are.
- **Timeouts.** Every build has one: 600 s unless the request names another
  (the app passes `TORNO_BUILD_TIMEOUT`), a day at most; one that is not a
  positive, finite number is a `bad_request`.
  A build past it is killed and answered with `error.kind: "timeout"`. A
  worker that crashes is answered with `crash`, one that is superseded with
  `cancelled`. The supervisor never blocks on a write.
- **A worker is not trusted.** A frame from the building worker that is not a
  result (not JSON, or without its scene or error) is a `crash` of that build;
  the supervisor carries on. Frames are written with `allow_nan=False`: a scene
  that holds a NaN is an `exception` reply, never bytes that are not JSON.
- **One geometry.** A `print` layout whose parts overlap in XY is spread along
  X in the worker, before tessellation (`arrange.py`). The shape itself is
  moved, so the mesh, the bounding box and the shape kept for queries agree;
  the part carries the translation as `arranged`. The viewport never moves a
  part, with one exception that is display only: explode (below).
- **stdout is the protocol.** The kernel keeps the real stdout for frames and
  points fd 1 at stderr; a worker points fd 1 and 2 at a capture buffer and
  stdin at `/dev/null`. What a model prints comes back as `output`.
- The app starts the kernel with `PYTHONDONTWRITEBYTECODE=1`, so importing a
  model writes no `__pycache__` into the workspace.
