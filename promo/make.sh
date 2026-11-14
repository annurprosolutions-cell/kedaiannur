#!/usr/bin/env bash
# Pasang frame JPEG dan runut bunyi menjadi MP4 TikTok (1080x1920, 30 fps, H.264 + AAC, kuat bunyi lebih kurang -14 LUFS).
# Guna: ./make.sh <folder-frame> <fail-wav> <output.mp4>
set -euo pipefail
FRAMES="$1"; WAV="$2"; OUT="$3"
ffmpeg -y -loglevel error -framerate 30 -i "$FRAMES/f%05d.jpg" -i "$WAV" \
  -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -level 4.2 \
  -af "loudnorm=I=-14:TP=-1.5:LRA=9" -c:a aac -b:a 192k -ar 44100 \
  -t 60 -movflags +faststart "$OUT"
