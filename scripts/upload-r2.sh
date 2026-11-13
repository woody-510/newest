#!/usr/bin/env bash
# media/ の公開用ファイル（作品一覧・サムネ・HLS）を Cloudflare R2 に同期する。
# 事前に rclone をインストールし、R2 用のリモートを設定しておく（README を参照）。
#
# 使い方: npm run upload               （実行）
#         npm run upload -- --dry-run  （何が送られるか確認だけ）
set -euo pipefail
cd "$(dirname "$0")/.."

REMOTE="${R2_REMOTE:-r2}"
BUCKET="${R2_BUCKET:-film-archive-media}"

command -v rclone >/dev/null || { echo "✗ rclone が見つかりません。README の手順でインストールしてください"; exit 1; }
[ -f media/works.json ] || { echo "✗ media/works.json がありません。先に npm run manifest を実行してください"; exit 1; }

# sync は「R2 側にあって手元に無いファイル」を R2 から削除する（消した作品を R2 からも消すため）
rclone sync media/ "$REMOTE:$BUCKET" --filter-from media/.rclone-filter \
  --transfers 8 --checkers 16 --progress "$@"
echo "✓ アップロード完了"
