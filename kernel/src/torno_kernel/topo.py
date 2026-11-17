"""The kernel's canonical order of a shape's faces and edges.

Index ``i`` here is index ``i`` in the tessellation's per-face and per-edge
arrays. Faces come out in the same order as build123d's ``shape.faces()``.
Edges do not match ``shape.edges()``, which drops degenerate edges such as a
sphere's pole; they are kept here so the indices stay aligned with the mesh.
"""

from typing import Any

from .ocp import (
    TopAbs_EDGE,
    TopAbs_FACE,
    TopAbs_SHELL,
    TopAbs_SOLID,
    TopAbs_VERTEX,
    TopAbs_WIRE,
    TopExp,
    TopTools_IndexedMapOfShape,
    downcast,
)


def faces(shape: Any) -> list[Any]:
    """The shape's distinct faces as ``TopoDS_Face``, in canonical order."""
    return _subshapes(shape, TopAbs_FACE)


def edges(shape: Any) -> list[Any]:
    """The shape's distinct edges as ``TopoDS_Edge``, in canonical order."""
    return _subshapes(shape, TopAbs_EDGE)


def vertices(shape: Any) -> list[Any]:
    """The shape's distinct vertices as ``TopoDS_Vertex``, in canonical order: ``V<i>`` is index ``i``.

    The order of build123d's ``shape.vertices()``. A circle's seam has its vertex, which a rim is closed on.
    """
    return _subshapes(shape, TopAbs_VERTEX)


def solids(shape: Any) -> list[Any]:
    """The shape's distinct solids as ``TopoDS_Solid``: none of a shell or a lone face."""
    return _subshapes(shape, TopAbs_SOLID)


def shells(shape: Any) -> list[Any]:
    """The shape's distinct shells as ``TopoDS_Shell``: of a solid with a void in it, two."""
    return _subshapes(shape, TopAbs_SHELL)


def wires(shape: Any) -> list[Any]:
    """The shape's distinct wires as ``TopoDS_Wire``: of a face, its outer one and its holes."""
    return _subshapes(shape, TopAbs_WIRE)


def loose_faces(shape: Any) -> int:
    """How many of the shape's faces are of none of its solids."""
    of_solids = TopTools_IndexedMapOfShape()
    for solid in solids(shape):
        TopExp.MapShapes_s(solid, TopAbs_FACE, of_solids)
    return len(faces(shape)) - of_solids.Extent()


def open_shells(shape: Any) -> int:
    """How many of the shape's shells have a free edge: one that only one of their faces has.

    A seam is had twice by its face, and a degenerate edge (a sphere's pole) bounds nothing: neither is free.
    """
    from OCP.BRep import BRep_Tool
    from OCP.TopExp import TopExp_Explorer

    told = 0
    for shell in _subshapes(shape, TopAbs_SHELL):
        seen = TopTools_IndexedMapOfShape()
        uses: list[int] = []
        # Each edge once for each face that has it: a seam twice for its one face.
        explorer = TopExp_Explorer(shell, TopAbs_EDGE)
        while explorer.More():
            edge = downcast(explorer.Current())
            if not BRep_Tool.Degenerated_s(edge):
                i = seen.Add(edge)
                if i > len(uses):
                    uses.append(0)
                uses[i - 1] += 1
            explorer.Next()
        told += any(count == 1 for count in uses)
    return told


def what(shape: Any) -> str:
    """What kind of shape this is, with its article: ``a shell``, ``a face``, ``a compound``."""
    wrapped = getattr(shape, "wrapped", shape)
    # TopAbs_SHELL, by whichever name the enum goes in this OCP.
    kind = str(wrapped.ShapeType()).rsplit("_", 1)[-1].lower()
    return f"{'an' if kind[:1] in 'aeiou' else 'a'} {kind}"


def _subshapes(shape: Any, kind: Any) -> list[Any]:
    wrapped = getattr(shape, "wrapped", shape)
    found = TopTools_IndexedMapOfShape()
    TopExp.MapShapes_s(wrapped, kind, found)
    return [downcast(found.FindKey(i)) for i in range(1, found.Extent() + 1)]
