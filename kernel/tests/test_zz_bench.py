import socket
import sys
import threading
import time


def move(size, buf):
    a, b = socket.socketpair()
    if buf:
        for s in (a, b):
            s.setsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF, buf)
            s.setsockopt(socket.SOL_SOCKET, socket.SO_RCVBUF, buf)
    data = bytes(size)
    t = threading.Thread(target=lambda: a.sendall(data))
    start = time.perf_counter()
    t.start()
    got = 0
    while got < size:
        got += len(b.recv(1 << 20))
    t.join()
    return time.perf_counter() - start, a.getsockopt(socket.SOL_SOCKET, socket.SO_SNDBUF)


def test_bench():
    out = []
    for size in (4 << 20, 64 << 20):
        for buf in (0, 1 << 20):
            best = min(move(size, buf)[0] for _ in range(3))
            out.append(f"{size >> 20} MiB buf={buf} sndbuf={move(1024, buf)[1]}: {best * 1000:.0f} ms")
    assert False, sys.platform + " | " + " | ".join(out)
