// 作品一覧（works.json）の作成のテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { stemOf, mediaUrl, escapeFilter } from '../scripts/build-manifest.mjs';

test('タイトルは「最後のドットより前」をそのまま使う', () => {
  assert.equal(stemOf('夜の港.mp4'), '夜の港');
  assert.equal(stemOf('film.v2_final.mov'), 'film.v2_final');
  assert.equal(stemOf('  空白 入り .mp4'), '  空白 入り ');
  assert.equal(stemOf('.hidden'), '.hidden');
  assert.equal(stemOf('noext'), 'noext');
});

test('URLと rclone 用のパターンで、特殊な文字を安全にする', () => {
  assert.equal(mediaUrl('videos', 'a b#c?.mp4'), '/media/videos/a%20b%23c%3F.mp4');
  assert.equal(escapeFilter('take[1]*{a}.mp4'), 'take\\[1\\]\\*\\{a\\}.mp4');
});

test('フォルダから一覧を作る（並び順・サムネの対応・HLSの優先）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'manifest-'));
  const put = (rel, mtime) => {
    const f = path.join(dir, rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, 'x');
    if (mtime) fs.utimesSync(f, mtime, mtime);
    return f;
  };
  put('videos/古い作品.mp4', new Date('2026-01-01T00:00:00Z'));
  put('videos/新しい作品.mov', new Date('2026-06-01T00:00:00Z'));
  put('videos/a.b.c.mp4', new Date('2026-03-01T00:00:00Z'));
  put('videos/メモ.txt');
  put('thumbs/古い作品.JPG');
  put('thumbs/新しい作品.webp');
  put('hls/新しい作品/index.m3u8');
  put('order.txt');
  fs.writeFileSync(path.join(dir, 'order.txt'), 'a.b.c\n');

  const script = path.resolve(import.meta.dirname, '../scripts/build-manifest.mjs');
  execFileSync('node', [script], { env: { ...process.env, MEDIA_DIR: dir }, stdio: 'pipe' });

  const works = JSON.parse(fs.readFileSync(path.join(dir, 'works.json'), 'utf8'));
  assert.deepEqual(works.map((w) => w.title), ['a.b.c', '新しい作品', '古い作品']);

  const [abc, fresh, old] = works;
  assert.equal(abc.thumb, null);
  assert.equal(abc.type, 'file');
  assert.equal(abc.src, '/media/videos/a.b.c.mp4');
  assert.equal(fresh.type, 'hls');
  assert.equal(fresh.src, `/media/hls/${encodeURIComponent('新しい作品')}/index.m3u8`);
  assert.equal(fresh.thumb, `/media/thumbs/${encodeURIComponent('新しい作品.webp')}`);
  assert.equal(old.thumb, `/media/thumbs/${encodeURIComponent('古い作品.JPG')}`);

  // HLS変換済みの作品は、元の動画をアップロード対象に入れない
  const filter = fs.readFileSync(path.join(dir, '.rclone-filter'), 'utf8');
  assert.match(filter, /\+ \/videos\/古い作品\.mp4/);
  assert.doesNotMatch(filter, /新しい作品\.mov/);
  assert.ok(filter.trimEnd().endsWith('- **'));

  fs.rmSync(dir, { recursive: true, force: true });
});
