#!/usr/bin/env bash
# Makes docs/images/demo.gif and demo.mp4 from the frames in this folder.
# The frames are made by app/e2e/demo.spec.ts (one launch of the hidden app each, the stand-in agent), from app/:
#   TORNO_DEMO="$PWD/../docs/images/demo-frames" playwright test e2e/demo.spec.ts
# with the TORNO_README_OBJECTS, TORNO_README_PROJECTS and TORNO_README_SCANS of docs/images/README.md (the airbox
# project), and the PATH and display of .claude/rules/e2e-hidden-window.md; then run this script. Needs ffmpeg.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
images="$(dirname "$here")"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

# How long each frame is held, in seconds: the open part, the pin and its note, the pin kept and the dimension that
# fails, the prompt, the agent looking, its edit and the build, its last word, the dimension that passes.
holds=(2 2.5 2.5 2.5 2.5 3 2.5 3.5)
fade=0.4
fps=12

# Each frame a still of its hold and the fade, crossfaded into the next.
inputs=()
graph=""
offset=0
for n in "${!holds[@]}"; do
  inputs+=(-loop 1 -framerate "$fps" -t "$(echo "${holds[$n]} + $fade" | bc)" -i "$(printf '%s/frame-%02d.png' "$here" $((n + 1)))")
  graph+="[$n:v]scale=800:-2:flags=lanczos,setsar=1,format=rgb24[f$n];"
done
last="f0"
for ((n = 1; n < ${#holds[@]}; n++)); do
  offset="$(echo "$offset + ${holds[$((n - 1))]}" | bc)"
  graph+="[$last][f$n]xfade=transition=fade:duration=$fade:offset=$offset[x$n];"
  last="x$n"
done
graph="${graph%;}"
ffmpeg -v error -y "${inputs[@]}" -filter_complex "$graph" -map "[$last]" -r "$fps" -c:v ffv1 "$work/demo.mkv"

ffmpeg -v error -y -i "$work/demo.mkv" -vf "palettegen=max_colors=256:stats_mode=full" -frames:v 1 -update 1 "$work/palette.png"
ffmpeg -v error -y -i "$work/demo.mkv" -i "$work/palette.png" -lavfi "[0:v][1:v]paletteuse=dither=sierra2_4a:diff_mode=rectangle" -loop 0 "$images/demo.gif"
ffmpeg -v error -y -i "$work/demo.mkv" -vf "format=yuv420p" -c:v libx264 -preset veryslow -crf 24 -tune stillimage -movflags +faststart -an "$images/demo.mp4"
ls -l "$images/demo.gif" "$images/demo.mp4"
