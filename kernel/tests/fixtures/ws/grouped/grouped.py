"""Four parts, three of them in two groups: the fixture for groups(p)."""

from dataclasses import dataclass

from build123d import Box, Pos


@dataclass(frozen=True)
class Params:
    size: float = 10


def assembly(p):
    return {
        "flat-a": Box(p.size, p.size, 2),
        "flat-b": Pos(20, 0, 0) * Box(p.size, p.size, 2),
        "tall-a": Pos(0, -20, 0) * Box(p.size, p.size, 8),
        "key": Pos(0, 30, 0) * Box(4, 4, 4),
    }


def printables(p):
    return {name: Pos(40 * i, 0, 0) * shape for i, (name, shape) in enumerate(assembly(p).items())}


def groups(p):
    return {"flat": ["flat-a", "flat-b"], "tall": ["tall-a"]}
