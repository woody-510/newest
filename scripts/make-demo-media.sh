#!/usr/bin/env bash
# 動作確認用のダミー作品を media/ に作る（本物の作品を置く前のお試し用）。
# 使い方: npm run demo
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p media/videos media/thumbs

# 名前|色1|色2|色3|秒数
DEMOS=(
  "夜の港|0x0b1a2e|0x1f4e79|0xd9b878|48"
  "冬の記録|0xdfe6ee|0x6d7f94|0x1b2430|40"
  "film.v2_final|0x2a0f12|0x8c2f39|0xf2c57c|36"
  "光の回廊|0x120d1f|0x5b3f8c|0xf3e3bd|44"
  "水底の街|0x02161a|0x0f5f5c|0x7fd1c1|52"
)

for row in "${DEMOS[@]}"; do
  IFS='|' read -r name c1 c2 c3 secs <<<"$row"
  v="media/videos/$name.mp4"
  t="media/thumbs/$name.jpg"
  if [ ! -f "$v" ]; then
    echo "▶ $name"
    ffmpeg -hide_banner -loglevel error -y \
      -f lavfi -i "gradients=s=480x270:r=24:c0=${c1}:c1=${c2}:c2=${c3}:n=3:speed=0.012:d=${secs}" \
      -f lavfi -i "sine=f=110:sample_rate=48000:d=${secs}" \
      -vf "scale=1280:720:flags=bicubic,vignette=PI/4,format=yuv420p" -af "volume=0.05" \
      -c:v libx264 -preset ultrafast -crf 28 -g 48 -c:a aac -b:a 96k -shortest -movflags +faststart "$v"
  fi
  if [ ! -f "$t" ]; then
    ffmpeg -hide_banner -loglevel error -y -ss 3 -i "$v" -frames:v 1 -q:v 3 "$t"
  fi
done
echo "✓ デモ素材を作成しました（media/）"
