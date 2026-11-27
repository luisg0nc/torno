#!/usr/bin/env python3
"""Makes the README's pictures from the captures of `e2e/readme.spec.ts`.

    TORNO_README_SHOTS=docs/images/raw pnpm -C app exec playwright test e2e/readme.spec.ts
    python3 app/scripts/readme-images.py docs/images/raw docs/images

Each capture is the whole window at 1600 × 1000 with a `.json` beside it holding the boxes of the window's regions.
The README's crops are made here (docs/images/README.md says which), and every PNG is quantized to keep it small.
The social preview is drawn, not composed from a capture: `app/scripts/social-preview.mjs`.
"""

import json
import sys
from pathlib import Path

from PIL import Image

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)


def box_of(name: str, *regions: str) -> tuple[int, int, int, int]:
    boxes = json.loads((raw / f"{name}.json").read_text())
    xs = [boxes[r]["x"] for r in regions] + [boxes[r]["x"] + boxes[r]["width"] for r in regions]
    ys = [boxes[r]["y"] for r in regions] + [boxes[r]["y"] + boxes[r]["height"] for r in regions]
    return round(min(xs)), round(min(ys)), round(max(xs)), round(max(ys))


def save(image: Image.Image, name: str, width: int | None = None) -> None:
    if width and image.width > width:
        image = image.resize((width, round(image.height * width / image.width)), Image.LANCZOS)
    image.convert("RGB").quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.FLOYDSTEINBERG).save(out / name, optimize=True)
    print(f"{name}: {image.width} × {image.height}, {(out / name).stat().st_size // 1024} KB")


hero = Image.open(raw / "hero.png")
save(hero, "hero.png")
save(Image.open(raw / "hero-dark.png"), "hero-dark.png")
# With the session dock hidden the view fills the window: marks.png is the whole window (the card's Checks and Marks, and the part).
save(Image.open(raw / "marks.png"), "marks.png")
# The chat is the dock alone, the section the view alone (its tag, its rule and the plane are drawn over the part).
save(Image.open(raw / "chat.png").crop(box_of("chat", "session")), "chat.png")
save(Image.open(raw / "section.png").crop(box_of("section", "viewport")), "section.png")
# A sketch, a review and a tracing show the card's head (the sketch's panel, the round's) beside the view, with the dock hidden: the card and the view.
for shot in ("sketch", "review", "tracing"):
    save(Image.open(raw / f"{shot}.png").crop(box_of(shot, "left", "viewport")), f"{shot}.png")
save(Image.open(raw / "objects.png"), "objects.png")
save(Image.open(raw / "export.png"), "export.png")
# The first screen fills the window: the whole of it.
save(Image.open(raw / "first-screen.png"), "first-screen.png")
