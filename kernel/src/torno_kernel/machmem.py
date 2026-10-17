"""Memory on macOS, with ctypes alone: what the supervisor asks of Mach and of libproc.

Plain C, no OCC: loading these starts no thread pool. The structs are those of
``<mach/vm_statistics.h>`` and ``<sys/proc_info.h>``, declared whole so that their sizes can be
held to the headers' on any platform (the functions only work on macOS).
"""

import ctypes
import ctypes.util
import threading
from typing import Any

HOST_VM_INFO64 = 4
PROC_PIDTASKINFO = 4


class VmStatistics64(ctypes.Structure):
    """``vm_statistics64_data_t``: ``#pragma pack(4)`` in the header."""

    _pack_ = 4
    _fields_ = [
        ("free_count", ctypes.c_uint32),
        ("active_count", ctypes.c_uint32),
        ("inactive_count", ctypes.c_uint32),
        ("wire_count", ctypes.c_uint32),
        ("zero_fill_count", ctypes.c_uint64),
        ("reactivations", ctypes.c_uint64),
        ("pageins", ctypes.c_uint64),
        ("pageouts", ctypes.c_uint64),
        ("faults", ctypes.c_uint64),
        ("cow_faults", ctypes.c_uint64),
        ("lookups", ctypes.c_uint64),
        ("hits", ctypes.c_uint64),
        ("purges", ctypes.c_uint64),
        ("purgeable_count", ctypes.c_uint32),
        ("speculative_count", ctypes.c_uint32),
        ("decompressions", ctypes.c_uint64),
        ("compressions", ctypes.c_uint64),
        ("swapins", ctypes.c_uint64),
        ("swapouts", ctypes.c_uint64),
        ("compressor_page_count", ctypes.c_uint32),
        ("throttled_count", ctypes.c_uint32),
        ("external_page_count", ctypes.c_uint32),
        ("internal_page_count", ctypes.c_uint32),
        ("total_uncompressed_pages_in_compressor", ctypes.c_uint64),
    ]


# In integers (natural_t), as host_statistics64 wants it: 38.
HOST_VM_INFO64_COUNT = ctypes.sizeof(VmStatistics64) // ctypes.sizeof(ctypes.c_uint32)


class ProcTaskInfo(ctypes.Structure):
    """``struct proc_taskinfo``, 96 bytes."""

    _fields_ = [
        ("pti_virtual_size", ctypes.c_uint64),
        ("pti_resident_size", ctypes.c_uint64),
        ("pti_total_user", ctypes.c_uint64),
        ("pti_total_system", ctypes.c_uint64),
        ("pti_threads_user", ctypes.c_uint64),
        ("pti_threads_system", ctypes.c_uint64),
        ("pti_policy", ctypes.c_int32),
        ("pti_faults", ctypes.c_int32),
        ("pti_pageins", ctypes.c_int32),
        ("pti_cow_faults", ctypes.c_int32),
        ("pti_messages_sent", ctypes.c_int32),
        ("pti_messages_received", ctypes.c_int32),
        ("pti_syscalls_mach", ctypes.c_int32),
        ("pti_syscalls_unix", ctypes.c_int32),
        ("pti_csw", ctypes.c_int32),
        ("pti_threadnum", ctypes.c_int32),
        ("pti_numrunning", ctypes.c_int32),
        ("pti_priority", ctypes.c_int32),
    ]


_lock = threading.Lock()
_libs: tuple[Any, Any, int] | None = None


def _load() -> tuple[Any, Any, int]:
    """The two libraries, set up once, and the host port. Raises when they cannot be had."""
    global _libs
    with _lock:
        if _libs is None:
            system = ctypes.CDLL(None)
            system.mach_host_self.restype = ctypes.c_uint32
            system.mach_host_self.argtypes = []
            system.host_statistics64.restype = ctypes.c_int
            system.host_statistics64.argtypes = [
                ctypes.c_uint32,
                ctypes.c_int,
                ctypes.POINTER(VmStatistics64),
                ctypes.POINTER(ctypes.c_uint32),
            ]
            system.host_page_size.restype = ctypes.c_int
            system.host_page_size.argtypes = [ctypes.c_uint32, ctypes.POINTER(ctypes.c_size_t)]
            proc = ctypes.CDLL(ctypes.util.find_library("proc") or "/usr/lib/libproc.dylib")
            proc.proc_pidinfo.restype = ctypes.c_int
            proc.proc_pidinfo.argtypes = [
                ctypes.c_int,
                ctypes.c_int,
                ctypes.c_uint64,
                ctypes.c_void_p,
                ctypes.c_int,
            ]
            # One port for the life of the process: each mach_host_self() takes a reference.
            _libs = (system, proc, system.mach_host_self())
        return _libs


def available() -> int | None:
    """Free and inactive pages, in bytes (what psutil calls ``available``). None on any failure."""
    try:
        system, _, host = _load()
        info = VmStatistics64()
        count = ctypes.c_uint32(HOST_VM_INFO64_COUNT)
        size = ctypes.c_size_t()
        if system.host_statistics64(host, HOST_VM_INFO64, ctypes.byref(info), ctypes.byref(count)) != 0:
            return None
        if system.host_page_size(host, ctypes.byref(size)) != 0 or size.value <= 0:
            return None
        return (info.free_count + info.inactive_count) * size.value
    except (OSError, AttributeError):
        return None


def rss(pid: int) -> int | None:
    """The resident size of a process, in bytes. None if it cannot be read (gone, or not ours to ask)."""
    try:
        _, proc, _ = _load()
        info = ProcTaskInfo()
        got = proc.proc_pidinfo(pid, PROC_PIDTASKINFO, 0, ctypes.byref(info), ctypes.sizeof(info))
        if got < ctypes.sizeof(info):
            return None
        return int(info.pti_resident_size)
    except (OSError, AttributeError, ctypes.ArgumentError):
        return None
