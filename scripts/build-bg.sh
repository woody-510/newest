#!/usr/bin/env bash
# Blender で書き出した PNG 連番を、サイトの背景用 WebP 連番に変換する。
#
#   media/bg/render/wide/0001.png …  横長（1920×1080 で書き出し）
#   media/bg/render/tall/0001.png …  縦長・スマホ用（1080×1920 で書き出し。無くてもよい）
#
# 出力: public/bg/wide/0001.webp …、public/bg/tall/…、public/bg/frames.json
# 使い方: npm run bg
set -euo pipefail
cd "$(dirname "$0")/.."

WIDE_W=${WIDE_W:-1600}
TALL_W=${TALL_W:-720}

convert_set() { # $1=wide|tall  $2=横幅  $3=品質   → 変換したコマ数を出力
  local src="media/bg/render/$1" dst="public/bg/$1"
  rm -rf "$dst"
  if [ ! -d "$src" ]; then echo 0; return; fi
  local first
  first="$(find "$src" -maxdepth 1 -iname '*.png' -printf '%f\n' | sort | head -1)"
  if [ -z "$first" ]; then echo 0; return; fi
  # 連番の接頭辞・桁数・開始番号を自動で読み取る（0001.png / frame_0001.png など）
  local stem="${first%.*}" ext="${first##*.}"
  local digits; digits="$(echo "$stem" | grep -oE '[0-9]+$')"
  local prefix="${stem%"$digits"}"
  mkdir -p "$dst"
  ffmpeg -hide_banner -loglevel error -y -framerate 24 -start_number "$((10#$digits))" \
    -i "$src/${prefix}%0${#digits}d.$ext" -vf "scale=$2:-2:flags=lanczos" \
    -c:v libwebp -quality "$3" -compression_level 6 -start_number 1 "$dst/%04d.webp"
  find "$dst" -name '*.webp' | wc -l | tr -d ' '
}

wide="$(convert_set wide "$WIDE_W" 72)"
tall="$(convert_set tall "$TALL_W" 68)"

if [ "$wide" = "0" ]; then
  echo "✗ media/bg/render/wide/ に PNG 連番がありません"; exit 1
fi
tall_json=null
if [ "$tall" != "0" ]; then
  if [ "$tall" != "$wide" ]; then
    echo "✗ 横長（$wide コマ）と縦長（$tall コマ）のコマ数が違います。同じ道筋・同じコマ数で書き出してください"; exit 1
  fi
  tall_json='"/bg/tall/"'
fi

cat > public/bg/frames.json <<JSON
{
  "count": $wide,
  "ext": "webp",
  "wide": "/bg/wide/",
  "tall": $tall_json
}
JSON
du -sh public/bg/* | grep -v frames.json || true
echo "✓ 背景 $wide コマを書き出しました（public/bg/frames.json）"
