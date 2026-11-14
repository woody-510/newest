#!/usr/bin/env node
// media/ の公開用ファイル（作品一覧・サムネ・HLS）を、wrangler を使って Cloudflare R2 に送る。
// rclone や API トークンの設定は不要（事前に `npx wrangler login` でログインしておく）。
//
//   npm run upload:wrangler               … 全部（送信済みで変更のないファイルは飛ばす）
//   npm run upload:wrangler -- hls thumbs … 指定したフォルダだけ
//
// 送信済みの記録は media/.r2-uploaded.json に残る。
// ※ R2 側のファイルを消す機能はない（作品を消したときは、ダッシュボードで消す）。

import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MEDIA = path.join(ROOT, 'media');
const BUCKET = process.env.R2_BUCKET || 'film-archive-media';
const CONCURRENCY = Number(process.env.UPLOAD_CONCURRENCY || 6);
const WRANGLER = path.join(ROOT, 'node_modules', 'wrangler', 'bin', 'wrangler.js');
const STATE_FILE = path.join(MEDIA, '.r2-uploaded.json');
const only = process.argv.slice(2);

const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
};

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name.endsWith('.tmp')) continue; // 変換途中のフォルダ
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function collect() {
  const want = (name) => only.length === 0 || only.includes(name);
  const files = [];
  if (want('thumbs')) files.push(...walk(path.join(MEDIA, 'thumbs')));
  if (want('hls')) files.push(...walk(path.join(MEDIA, 'hls')));
  if (want('videos')) {
    // HLS に変換していない作品だけ、元の動画を送る
    const dir = path.join(MEDIA, 'videos');
    for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      const title = f.slice(0, f.lastIndexOf('.'));
      if (!fs.existsSync(path.join(MEDIA, 'hls', title, 'index.m3u8'))) files.push(path.join(dir, f));
    }
  }
  // 作品一覧は最後に送る（先に送ると、まだ無いファイルを指してしまう）
  if (want('works.json') && fs.existsSync(path.join(MEDIA, 'works.json'))) files.push(path.join(MEDIA, 'works.json'));
  return files;
}

function put(file, key) {
  return new Promise((resolve) => {
    const args = [WRANGLER, 'r2', 'object', 'put', `${BUCKET}/${key}`, '--file', file, '--remote'];
    const type = TYPES[path.extname(file).toLowerCase()];
    if (type) args.push('--content-type', type);
    const child = spawn(process.execPath, args, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', (d) => { log += d; });
    child.stderr.on('data', (d) => { log += d; });
    child.on('close', (code) => resolve({ ok: code === 0, log }));
    child.on('error', (err) => resolve({ ok: false, log: String(err) }));
  });
}

async function main() {
  if (!fs.existsSync(WRANGLER)) {
    console.error('✗ wrangler が見つかりません。npm install を実行してください');
    process.exit(1);
  }
  const state = fs.existsSync(STATE_FILE) ? JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) : {};
  const jobs = [];
  let bytes = 0;
  for (const file of collect()) {
    const st = fs.statSync(file);
    const key = path.relative(MEDIA, file).split(path.sep).join('/');
    const stamp = `${st.size}:${Math.round(st.mtimeMs)}`;
    if (state[key] === stamp) continue;
    jobs.push({ file, key, stamp, size: st.size });
    bytes += st.size;
  }
  console.log(`▶ ${jobs.length} ファイル（${(bytes / 1048576).toFixed(0)} MB）を ${BUCKET} に送ります`);

  let done = 0;
  let failed = 0;
  let sent = 0;
  let next = 0;
  let lastSave = Date.now();
  const save = () => fs.writeFileSync(STATE_FILE, JSON.stringify(state));
  const worker = async () => {
    while (next < jobs.length) {
      const job = jobs[next++];
      let res = await put(job.file, job.key);
      if (!res.ok) res = await put(job.file, job.key); // 通信の失敗に備えて、1回だけやり直す
      if (res.ok) {
        state[job.key] = job.stamp;
        sent += job.size;
      } else {
        failed += 1;
        console.error(`✗ 失敗: ${job.key}\n${res.log.trim().split('\n').slice(-4).join('\n')}`);
      }
      done += 1;
      if (done % 100 === 0 || done === jobs.length) {
        console.log(`  ${done}/${jobs.length}（${(sent / 1048576).toFixed(0)} MB）`);
      }
      if (Date.now() - lastSave > 15000) {
        save();
        lastSave = Date.now();
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, worker));
  save();
  if (failed) {
    console.error(`✗ ${failed} ファイルを送れませんでした。もう一度実行すると、残りだけ送ります`);
    process.exit(1);
  }
  console.log('✓ アップロード完了');
}

main();
