// Cloudflare Pages Functions：/media/* へのリクエストを R2 バケットから返す。
//
// サイトと同じドメインで配信するので、Cloudflare Access のログイン1回で
// 作品一覧（works.json）・サムネ・動画までまとめて守られる。
// ※ R2 の公開URL（r2.dev）は必ず無効にしておくこと。

import { tokenFromRequest, verifyAccessJwt } from '../../server/access.js';

const TYPES = {
  mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm',
  m3u8: 'application/vnd.apple.mpegurl', ts: 'video/mp2t', m4s: 'video/iso.segment',
  jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp',
  json: 'application/json; charset=utf-8', vtt: 'text/vtt; charset=utf-8',
};

export async function onRequest({ request, env }) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return new Response('Method Not Allowed', { status: 405, headers: { Allow: 'GET, HEAD' } });
  }

  // ログイン済みかの確認（ACCESS_TEAM_DOMAIN と ACCESS_AUD を設定したときだけ有効）
  if (env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) {
    let payload = null;
    try {
      payload = await verifyAccessJwt(tokenFromRequest(request), {
        teamDomain: env.ACCESS_TEAM_DOMAIN,
        aud: env.ACCESS_AUD,
      });
    } catch {
      return new Response('ログインの確認に失敗しました。時間をおいて再度お試しください。', { status: 503 });
    }
    if (!payload) return new Response('Forbidden', { status: 403 });
  }

  let key;
  try {
    key = decodeURIComponent(new URL(request.url).pathname.replace(/^\/media\//, ''));
  } catch {
    return new Response('Bad Request', { status: 400 });
  }
  if (!key || key.split('/').includes('..')) return new Response('Not Found', { status: 404 });

  const object = await env.MEDIA.get(key, { range: request.headers, onlyIf: request.headers });
  if (object === null) return new Response('Not Found', { status: 404 });

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  headers.set('accept-ranges', 'bytes');
  const ext = key.split('.').pop().toLowerCase();
  if (TYPES[ext]) headers.set('content-type', TYPES[ext]);
  // 一覧とプレイリストは更新がすぐ反映されるように。動画の断片やサムネはブラウザ内で長めにキャッシュ。
  headers.set('cache-control', ext === 'json' || ext === 'm3u8' ? 'private, no-cache' : 'private, max-age=86400');

  // 条件付きリクエストで「変更なし」
  if (!('body' in object) || !object.body) return new Response(null, { status: 304, headers });

  let status = 200;
  if (object.range && request.headers.has('range')) {
    const r = object.range;
    let offset, length;
    if ('suffix' in r) {
      length = Math.min(r.suffix, object.size);
      offset = object.size - length;
    } else {
      offset = r.offset ?? 0;
      length = r.length ?? object.size - offset;
    }
    status = 206;
    headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${object.size}`);
    headers.set('content-length', String(length));
  } else {
    headers.set('content-length', String(object.size));
  }

  return new Response(request.method === 'HEAD' ? null : object.body, { status, headers });
}
