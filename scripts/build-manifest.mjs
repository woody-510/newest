#!/usr/bin/env node
// media/ を走査して、作品一覧 media/works.json を作る。
//
//   media/videos/<名前>.<拡張子>        … 元の動画。タイトル = 拡張子を除いたファイル名（加工しない）
//   media/thumbs/<名前>.<jpg|png|webp>  … サムネイル（動画と同じ名前で対応付け）
//   media/hls/<名前>/index.m3u8         … HLSに変換済みなら、こちらを再生に使う
//   media/order.txt                     … （任意）1行に1タイトル。書いた順に上から並ぶ
//
// 使い方: npm run manifest

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = process.env.MEDIA_DIR ? path.resolve(process.env.MEDIA_DIR) : path.join(ROOT, 'media');
const VIDEO_DIR = path.join(MEDIA, 'videos');
const THUMB_DIR = path.join(MEDIA, 'thumbs');
const HLS_DIR = path.join(MEDIA, 'hls');
const OUT = path.join(MEDIA, 'works.json');

const VIDEO_EXT = new Set(['.mp4', '.m4v', '.mov', '.webm']);
const THUMB_EXT = ['.webp', '.jpg', '.jpeg', '.png'];

/** タイトル = 最後のドットより前（加工しない） */
export const stemOf = (file) => {
  const i = file.lastIndexOf('.');
  return i > 0 ? file.slice(0, i) : file;
};

/** /media/ 以下のURL（日本語や記号を含むファイル名も安全にする） */
export const mediaUrl = (...parts) => '/media/' + parts.map(encodeURIComponent).join('/');

/** rclone のフィルター用に、パターンとして解釈される文字を無効化する */
export const escapeFilter = (s) => s.replace(/[\\*?[\]{}]/g, '\\$&');

function probeDuration(file) {
  try {
    const out = execFileSync('ffprobe', [
      '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=nw=1:nk=1', file,
    ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    const d = parseFloat(out);
    return Number.isFinite(d) ? Math.round(d) : null;
  } catch {
    return null;
  }
}

function findThumb(stem) {
  if (!fs.existsSync(THUMB_DIR)) return null;
  const names = new Map(fs.readdirSync(THUMB_DIR).map((f) => [f.toLowerCase(), f]));
  for (const ext of THUMB_EXT) {
    const hit = names.get((stem + ext).toLowerCase());
    if (hit) return mediaUrl('thumbs', hit);
  }
  return null;
}

function main() {
  if (!fs.existsSync(VIDEO_DIR)) {
    console.error(`✗ ${path.relative(ROOT, VIDEO_DIR)}/ がありません。動画を置いてからもう一度実行してください。`);
    process.exit(1);
  }

  const files = fs.readdirSync(VIDEO_DIR)
    .filter((f) => !f.startsWith('.') && VIDEO_EXT.has(path.extname(f).toLowerCase()));

  const seen = new Map();
  const uploadVideos = [];
  const works = [];

  for (const file of files) {
    const full = path.join(VIDEO_DIR, file);
    const title = stemOf(file);
    if (seen.has(title)) {
      console.warn(`⚠ 同じタイトルの動画が2つあります（${seen.get(title)} と ${file}）。後者を飛ばします。`);
      continue;
    }
    seen.set(title, file);

    const hls = path.join(HLS_DIR, title, 'index.m3u8');
    const hasHls = fs.existsSync(hls);
    const thumb = findThumb(title);
    if (!thumb) console.warn(`⚠ サムネイルがありません: ${title}`);
    if (!hasHls) {
      console.warn(`⚠ HLS未変換のため元ファイルをそのまま再生します: ${title}（npm run encode で変換できます）`);
      uploadVideos.push(file);
    }

    works.push({
      id: title,
      title,
      thumb,
      src: hasHls ? mediaUrl('hls', title, 'index.m3u8') : mediaUrl('videos', file),
      type: hasHls ? 'hls' : 'file',
      duration: probeDuration(full),
      addedAt: fs.statSync(full).mtime.toISOString(),
    });
  }

  // 並び順：order.txt にあるものを先に（書いた順）、残りは新しい順
  const orderFile = path.join(MEDIA, 'order.txt');
  const order = fs.existsSync(orderFile)
    ? fs.readFileSync(orderFile, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
    : [];
  const rank = (w) => {
    const i = order.indexOf(w.title);
    return i === -1 ? Infinity : i;
  };
  works.sort((a, b) => (rank(a) - rank(b)) || b.addedAt.localeCompare(a.addedAt) || a.title.localeCompare(b.title, 'ja'));
  for (const t of order) if (!seen.has(t)) console.warn(`⚠ order.txt にあるが動画が見つかりません: ${t}`);

  fs.writeFileSync(OUT, JSON.stringify(works, null, 2) + '\n');

  // アップロード対象（HLS変換済みの作品は、元の動画をアップロードしない）
  const filter = [
    '+ /works.json',
    '+ /thumbs/**',
    '+ /hls/**',
    ...uploadVideos.map((f) => `+ /videos/${escapeFilter(f)}`),
    '- **',
  ];
  fs.writeFileSync(path.join(MEDIA, '.rclone-filter'), filter.join('\n') + '\n');

  console.log(`✓ ${works.length} 作品を ${path.relative(ROOT, OUT)} に書き出しました`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
