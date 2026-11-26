"""EC11 rotary encoder
Alps-style rotary encoder with a push switch, 6 mm shaft, threaded bush, 12 mm body.
"""

from dataclasses import dataclass

from build123d import Align, Box, Cylinder, Pos

MIN, MAX, CENTER = Align.MIN, Align.MAX, Align.CENTER


@dataclass
class Params:
    shaft_d: float = 6.0  # datasheet EC11: the shaft's diameter
    shaft_h: float = 15.0  # datasheet EC11: the shaft above the panel
    bush_d: float = 7.0  # datasheet EC11: the thread of the bush, M7
    body_w: float = 12.0  # measured: the body's width and depth
    body_h: float = 6.5  # assumed: the body below the panel
    hole_d: float = 7.2  # derived: the bush with 0.2 mm of play
    behind: float = 10.0  # assumed: the room kept clear behind the panel


def body(p: Params):
    """The part as bought: shaft above z = 0, bush and body below it."""
    shaft = Cylinder(p.shaft_d / 2, p.shaft_h, align=(CENTER, CENTER, MIN))
    case = Pos(0, 0, 0) * Box(p.body_w, p.body_w, p.body_h, align=(CENTER, CENTER, MAX))
    return shaft + case


def cutout(p: Params):
    """The hole it needs in a panel, through z from -3 to 1."""
    return Pos(0, 0, -1) * Cylinder(p.hole_d / 2, 4)


def keepout(p: Params):
    """The room behind the panel that stays free."""
    return Box(p.body_w + 4, p.body_w + 4, p.behind, align=(CENTER, CENTER, MAX))
