#!/usr/bin/env bash
# media/videos/ の動画を HLS（1080p / 720p / 480p、回線に合わせて画質が自動で切り替わる形式）に変換し、
# media/hls/<名前>/ に出力する。変換済みのものは飛ばす。
#
# 使い方: npm run encode            （全部）
#         npm run encode -- "media/videos/夜の港.mp4"   （指定したものだけ）
set -euo pipefail
cd "$(dirname "$0")/.."

shopt -s nullglob
files=("$@")
if [ ${#files[@]} -eq 0 ]; then files=(media/videos/*); fi

for src in "${files[@]}"; do
  [ -f "$src" ] || continue
  base="$(basename "$src")"
  name="${base%.*}"
  out="media/hls/$name"
  if [ -f "$out/index.m3u8" ]; then echo "→ 変換済み: $name"; continue; fi
  echo "▶ 変換中: $name"
  tmp="$out.tmp"
  rm -rf "$tmp"
  mkdir -p "$tmp"

  # 音声がある場合だけ音声を付ける
  if ffprobe -v error -select_streams a -show_entries stream=index -of csv=p=0 "$src" | grep -q .; then
    amap=(-map 0:a:0 -map 0:a:0 -map 0:a:0)
    vsm="v:0,a:0 v:1,a:1 v:2,a:2"
  else
    amap=()
    vsm="v:0 v:1 v:2"
  fi

  ffmpeg -hide_banner -loglevel warning -stats -y -i "$src" \
    -filter_complex "[0:v]split=3[a][b][c];[a]scale=-2:1080[v0];[b]scale=-2:720[v1];[c]scale=-2:480[v2]" \
    -map "[v0]" -map "[v1]" -map "[v2]" "${amap[@]}" \
    -c:v libx264 -preset "${PRESET:-slow}" -crf 21 -pix_fmt yuv420p -g 48 -keyint_min 48 -sc_threshold 0 \
    -maxrate:v:0 8000k -bufsize:v:0 16000k \
    -maxrate:v:1 4500k -bufsize:v:1 9000k \
    -maxrate:v:2 2000k -bufsize:v:2 4000k \
    -c:a aac -b:a 160k -ac 2 \
    -f hls -hls_time 6 -hls_playlist_type vod -hls_flags independent_segments \
    -hls_segment_filename "$tmp/%v/seg_%05d.ts" \
    -master_pl_name index.m3u8 \
    -var_stream_map "$vsm" \
    "$tmp/%v/playlist.m3u8"

  rm -rf "$out"
  mv "$tmp" "$out"
done
echo "✓ 完了。続けて npm run manifest を実行してください"
