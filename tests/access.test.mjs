// Cloudflare Access のログイン証明（JWT）の検証と、/media/* の配信のテスト。
import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyAccessJwt, tokenFromRequest, _clearCertCache } from '../server/access.js';
import { onRequest } from '../functions/media/[[path]].js';

const TEAM = 'example-team.cloudflareaccess.com';
const AUD = 'aud-tag-123';
const NOW = 1_800_000_000;

const b64url = (data) => Buffer.from(data).toString('base64url');

async function makeKey(kid) {
  const pair = await crypto.subtle.generateKey(
    { name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' },
    true, ['sign', 'verify'],
  );
  const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { kid, privateKey: pair.privateKey, jwk: { ...jwk, kid, alg: 'RS256', use: 'sig' } };
}

async function sign(key, payload, header = {}) {
  const h = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: key.kid, ...header }));
  const p = b64url(JSON.stringify(payload));
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key.privateKey, new TextEncoder().encode(`${h}.${p}`));
  return `${h}.${p}.${b64url(new Uint8Array(sig))}`;
}

const certsFetch = (...keys) => async (url) => {
  assert.equal(url, `https://${TEAM}/cdn-cgi/access/certs`);
  return new Response(JSON.stringify({ keys: keys.map((k) => k.jwk) }), { status: 200 });
};

const good = { iss: `https://${TEAM}`, aud: [AUD], exp: NOW + 600, iat: NOW - 10, email: 'viewer@example.com' };

test('正しいトークンは通る', async () => {
  _clearCertCache();
  const key = await makeKey('k1');
  const token = await sign(key, good);
  const payload = await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: certsFetch(key) });
  assert.equal(payload.email, 'viewer@example.com');
});

test('期限切れ・宛先違い・発行元違いは通さない', async () => {
  _clearCertCache();
  const key = await makeKey('k1');
  const opts = { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: certsFetch(key) };
  assert.equal(await verifyAccessJwt(await sign(key, { ...good, exp: NOW - 1 }), opts), null);
  assert.equal(await verifyAccessJwt(await sign(key, { ...good, aud: ['other'] }), opts), null);
  assert.equal(await verifyAccessJwt(await sign(key, { ...good, iss: 'https://evil.example.com' }), opts), null);
});

test('別の鍵で署名したもの・改ざんしたもの・形式がおかしいものは通さない', async () => {
  _clearCertCache();
  const key = await makeKey('k1');
  const attacker = await makeKey('k1'); // 同じ kid を名乗る別の鍵
  const opts = { teamDomain: TEAM, aud: AUD, now: NOW, fetchImpl: certsFetch(key) };

  assert.equal(await verifyAccessJwt(await sign(attacker, good), opts), null);

  const token = await sign(key, good);
  const [h, , s] = token.split('.');
  const forged = `${h}.${b64url(JSON.stringify({ ...good, email: 'attacker@example.com' }))}.${s}`;
  assert.equal(await verifyAccessJwt(forged, opts), null);

  const none = `${b64url(JSON.stringify({ alg: 'none', kid: 'k1' }))}.${b64url(JSON.stringify(good))}.`;
  assert.equal(await verifyAccessJwt(none, opts), null);
  assert.equal(await verifyAccessJwt('not-a-token', opts), null);
  assert.equal(await verifyAccessJwt(null, opts), null);
});

test('トークンはヘッダーからもクッキーからも取り出せる', () => {
  const a = new Request('https://x.example/', { headers: { 'Cf-Access-Jwt-Assertion': 'AAA' } });
  const b = new Request('https://x.example/', { headers: { Cookie: 'foo=1; CF_Authorization=BBB; bar=2' } });
  const c = new Request('https://x.example/');
  assert.equal(tokenFromRequest(a), 'AAA');
  assert.equal(tokenFromRequest(b), 'BBB');
  assert.equal(tokenFromRequest(c), null);
});

// ───────── /media/* の配信 ─────────

/** R2 バケットのごく簡単な代役 */
function fakeBucket(files) {
  return {
    async get(key, { range } = {}) {
      if (!(key in files)) return null;
      const all = Buffer.from(files[key]);
      let body = all;
      let r;
      const m = /bytes=(\d*)-(\d*)/.exec(range?.get?.('range') || '');
      if (m && (m[1] || m[2])) {
        if (m[1]) {
          const offset = Number(m[1]);
          const end = m[2] ? Math.min(Number(m[2]), all.length - 1) : all.length - 1;
          r = { offset, length: end - offset + 1 };
          body = all.subarray(offset, end + 1);
        } else {
          r = { suffix: Number(m[2]) };
          body = all.subarray(all.length - Number(m[2]));
        }
      }
      return {
        size: all.length,
        httpEtag: '"etag"',
        range: r,
        body: new Blob([body]).stream(),
        writeHttpMetadata() {},
      };
    },
  };
}

const env = { MEDIA: fakeBucket({ 'works.json': '[]', 'videos/夜の港.mp4': '0123456789' }) };
const call = (path, init) => onRequest({ request: new Request(`https://site.example${path}`, init), env });

test('ファイルを返す（日本語のファイル名・種類・キャッシュ設定）', async () => {
  const res = await call(`/media/videos/${encodeURIComponent('夜の港')}.mp4`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'video/mp4');
  assert.equal(res.headers.get('content-length'), '10');
  assert.equal(await res.text(), '0123456789');

  const list = await call('/media/works.json');
  assert.equal(list.headers.get('cache-control'), 'private, no-cache');
});

test('途中からの読み込み（Range）に対応する', async () => {
  const res = await call(`/media/videos/${encodeURIComponent('夜の港')}.mp4`, { headers: { Range: 'bytes=2-5' } });
  assert.equal(res.status, 206);
  assert.equal(res.headers.get('content-range'), 'bytes 2-5/10');
  assert.equal(await res.text(), '2345');

  const tail = await call(`/media/videos/${encodeURIComponent('夜の港')}.mp4`, { headers: { Range: 'bytes=-3' } });
  assert.equal(tail.headers.get('content-range'), 'bytes 7-9/10');
  assert.equal(await tail.text(), '789');
});

test('無いファイルは 404、GET 以外は 405', async () => {
  assert.equal((await call('/media/nothing.mp4')).status, 404);
  assert.equal((await call('/media/..%2Fsecret')).status, 404);
  assert.equal((await call('/media/works.json', { method: 'POST' })).status, 405);
});

test('ログイン確認を有効にすると、証明の無いリクエストは 403', async () => {
  _clearCertCache();
  const key = await makeKey('k9');
  const realFetch = globalThis.fetch;
  globalThis.fetch = certsFetch(key);
  try {
    const guarded = { ...env, ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD };
    const req = (headers) => onRequest({ request: new Request('https://site.example/media/works.json', { headers }), env: guarded });

    assert.equal((await req({})).status, 403);
    assert.equal((await req({ 'Cf-Access-Jwt-Assertion': 'forged.token.value' })).status, 403);

    const token = await sign(key, { ...good, exp: Math.floor(Date.now() / 1000) + 600 });
    assert.equal((await req({ 'Cf-Access-Jwt-Assertion': token })).status, 200);
    assert.equal((await req({ Cookie: `CF_Authorization=${token}` })).status, 200);
  } finally {
    globalThis.fetch = realFetch;
  }
});
