#!/usr/bin/env python3
"""Makes the README's pictures from the captures of `e2e/readme.spec.ts`.

    TORNO_README_SHOTS=docs/images/raw pnpm -C app exec playwright test e2e/readme.spec.ts
    python3 app/scripts/readme-images.py docs/images/raw docs/images

Each capture is the whole window at 1600 × 1000 with a `.json` beside it holding the boxes of the window's regions.
The README's crops are made here (docs/images/README.md says which), every PNG is quantized to keep it small, and
the social preview (1280 × 640: the logo, the name, the line and a crop of the hero) is composed from the hero.
"""

import json
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

raw, out = Path(sys.argv[1]), Path(sys.argv[2])
out.mkdir(parents=True, exist_ok=True)
repo = Path(__file__).resolve().parents[2]


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
# With the session pane hidden the view fills the window: the crops keep the list and the part, for the row of three.
save(Image.open(raw / "marks.png").crop((0, 0, 1520, 1000)), "marks.png")
save(Image.open(raw / "chat.png").crop(box_of("chat", "session")), "chat.png")
save(Image.open(raw / "section.png").crop((430, 40, 1430, 1000)), "section.png")
save(Image.open(raw / "objects.png"), "objects.png")
save(Image.open(raw / "export.png"), "export.png")
# The first screen is small in the middle of the window: the crop keeps the air around it.
first = Image.open(raw / "first-screen.png")
save(first.crop((400, 250, 1200, 760)), "first-screen.png")

# The social preview: a light ground, the logo and the name at the left, the hero's view at the right.
W, H = 1280, 640
social = Image.new("RGB", (W, H), (242, 240, 236))
logo_png = raw / "logo-256.png"
subprocess.run(["resvg", "-w", "256", "-h", "256", str(repo / "scripts/torno.svg"), str(logo_png)], check=True)
logo = Image.open(logo_png).convert("RGBA")
social.paste(logo, (72, 96), logo)
draw = ImageDraw.Draw(social)


def font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    for name in (["InstrumentSans-SemiBold.ttf", "DejaVuSans-Bold.ttf"] if bold else ["InstrumentSans-Regular.ttf", "DejaVuSans.ttf"]):
        for folder in ("/usr/share/fonts", str(Path.home() / ".local/share/fonts"), str(repo / "app/src/renderer/fonts")):
            found = list(Path(folder).rglob(name)) if Path(folder).exists() else []
            if found:
                return ImageFont.truetype(str(found[0]), size)
    return ImageFont.load_default(size)


draw.text((72, 380), "torno", fill=(28, 28, 32), font=font(72, bold=True))
for n, line in enumerate(["CAD parts with an AI coding agent.", "You point at the part. Claude Code", "writes the model. torno builds it."]):
    draw.text((72, 470 + n * 40), line, fill=(84, 84, 92), font=font(28))
# The hero's view, the chat beside it, scaled to the right half and let bleed off the bottom and the right.
view = hero.crop((250, 0, 1600, 1000))
scale = 560 / view.height * 1.25
view = view.resize((round(view.width * scale), round(view.height * scale)), Image.LANCZOS)
social.paste(view, (W - view.width + 260, 64))
draw.rectangle((0, 0, W - 1, H - 1), outline=(214, 212, 206))
save(social, "social-preview.png")
