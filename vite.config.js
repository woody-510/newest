import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// 開発時・プレビュー時は ./media を /media/ として配信する。
// 本番では同じURLを Pages Functions（functions/media）が R2 から返す。
const MEDIA_DIR = path.resolve('media');
const TYPES = {
  '.mp4': 'video/mp4', '.m4v': 'video/mp4', '.mov': 'video/quicktime', '.webm': 'video/webm',
  '.m3u8': 'application/vnd.apple.mpegurl', '.ts': 'video/mp2t', '.m4s': 'video/iso.segment',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp',
  '.json': 'application/json', '.vtt': 'text/vtt',
};

function mediaMiddleware(req, res, next) {
  if (!req.url.startsWith('/media/')) return next();
  let rel;
  try {
    rel = decodeURIComponent(req.url.slice('/media/'.length).split('?')[0]);
  } catch {
    res.statusCode = 400;
    return res.end();
  }
  const file = path.resolve(MEDIA_DIR, rel);
  if (!file.startsWith(MEDIA_DIR + path.sep) || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  const size = fs.statSync(file).size;
  res.setHeader('Content-Type', TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream');
  res.setHeader('Accept-Ranges', 'bytes');
  res.setHeader('Cache-Control', 'no-cache');
  const m = /bytes=(\d*)-(\d*)/.exec(req.headers.range || '');
  if (m && (m[1] || m[2])) {
    const start = m[1] ? Number(m[1]) : Math.max(0, size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1;
    if (start > end || start >= size) {
      res.statusCode = 416;
      res.setHeader('Content-Range', `bytes */${size}`);
      return res.end();
    }
    res.statusCode = 206;
    res.setHeader('Content-Range', `bytes ${start}-${end}/${size}`);
    res.setHeader('Content-Length', end - start + 1);
    fs.createReadStream(file, { start, end }).pipe(res);
  } else {
    res.setHeader('Content-Length', size);
    fs.createReadStream(file).pipe(res);
  }
}

export default defineConfig({
  plugins: [{
    name: 'serve-media',
    configureServer(server) { server.middlewares.use(mediaMiddleware); },
    configurePreviewServer(server) { server.middlewares.use(mediaMiddleware); },
  }],
  // media/ は変更を監視しない（大きなファイルが多く、Windows では監視中のフォルダを
  // 改名できなくなり、npm run encode の最後の仕上げが「アクセス拒否」で失敗するため）
  server: { watch: { ignored: [`${MEDIA_DIR.replace(/\\/g, '/')}/**`] } },
  build: { target: 'es2022' },
});
