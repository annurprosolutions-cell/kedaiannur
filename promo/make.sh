#!/usr/bin/env bash
# Pasang frame JPEG dan runut bunyi menjadi MP4 TikTok (1080x1920, 30 fps, H.264 + AAC, kuat bunyi lebih kurang -14 LUFS).
# Guna: ./make.sh <folder-frame> <muzik.wav> <output.mp4> [suara.wav]
# Jika suara diberi: dilajukan ikut "vo.tempo" dalam timeline.json, dan muzik direndahkan (sidechain) semasa suara bercakap.
set -euo pipefail
FRAMES="$1"; MUSIC="$2"; OUT="$3"; VO="${4:-}"
if [ -z "$VO" ]; then
  ffmpeg -y -loglevel error -framerate 30 -i "$FRAMES/f%05d.jpg" -i "$MUSIC" \
    -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -level 4.2 \
    -af "loudnorm=I=-14:TP=-1.5:LRA=9" -c:a aac -b:a 192k -ar 44100 -t 60 -movflags +faststart "$OUT"
else
  TEMPO=$(python3 -c "import json,sys;print(json.load(open('$(dirname "$0")/timeline.json'))['vo']['tempo'])")
  ffmpeg -y -loglevel error -framerate 30 -i "$FRAMES/f%05d.jpg" -i "$MUSIC" -i "$VO" \
    -filter_complex "[2:a]atempo=${TEMPO},aformat=sample_fmts=fltp:sample_rates=44100:channel_layouts=stereo,apad=whole_dur=60,asplit=2[vo][sc];[1:a]volume=0.7[bg];[bg][sc]sidechaincompress=threshold=0.02:ratio=9:attack=10:release=350[duck];[duck][vo]amix=inputs=2:duration=longest:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=9[a]" \
    -map 0:v -map "[a]" -c:v libx264 -preset slow -crf 17 -pix_fmt yuv420p -profile:v high -level 4.2 \
    -c:a aac -b:a 192k -ar 44100 -t 60 -movflags +faststart "$OUT"
fi
