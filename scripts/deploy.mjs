#!/usr/bin/env node
// サイト本体をビルドして、Cloudflare Pages に公開する（事前に `npx wrangler login` でログインしておく）。
//
//   npm run deploy
//
// ビルドの出力先は、毎回あたらしい一時フォルダにする。
// Windows で、プロジェクト内の dist/ が残っている状態だとビルドが異常終了したため（Vite 8.3.8 で確認）。

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PROJECT = process.env.PAGES_PROJECT || 'film-archive';
const bin = (...p) => path.join(ROOT, 'node_modules', ...p);

/** 実行して出力を表示する。done に一致する行が出ていれば、終了コードが 0 でなくても成功とみなす */
const run = (label, args, done) => {
  console.log(`▶ ${label}`);
  const res = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'] });
  const text = `${res.stdout || ''}${res.stderr || ''}`;
  process.stdout.write(text);
  if (res.status === 0) return;
  if (done && done.test(text)) {
    // Windows で、処理が終わったあとの後片付けで異常終了することがある（結果には影響しない）
    console.warn(`⚠ ${label} は完了しましたが、終了時にエラーが出ました（終了コード ${res.status}）`);
    return;
  }
  console.error(`✗ ${label} に失敗しました（終了コード ${res.status}）`);
  process.exit(1);
};

const out = fs.mkdtempSync(path.join(os.tmpdir(), 'film-archive-dist-'));
try {
  run('ビルド', [bin('vite', 'bin', 'vite.js'), 'build', '--outDir', out, '--emptyOutDir']);
  if (!fs.existsSync(path.join(out, 'index.html'))) {
    console.error('✗ ビルドの出力に index.html がありません');
    process.exit(1);
  }
  run('公開', [bin('wrangler', 'bin', 'wrangler.js'), 'pages', 'deploy', out,
    '--project-name', PROJECT, '--branch', 'main', '--commit-dirty=true'], /Deployment complete/);
  console.log('✓ 公開しました');
} finally {
  fs.rmSync(out, { recursive: true, force: true });
}
