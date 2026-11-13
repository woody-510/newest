// Cloudflare Access が発行するログイン証明（JWT）を検証する。
// Access を通ったリクエストには Cf-Access-Jwt-Assertion ヘッダー（と CF_Authorization クッキー）が付く。
// ヘッダーは誰でも偽造できるので、署名・有効期限・発行元・宛先(AUD)を必ず確かめる。

const certCache = new Map(); // teamDomain -> { keys: Map<kid, CryptoKey>, at: number }
const CERT_TTL = 60 * 60 * 1000;
const CERT_RETRY = 60 * 1000;

const b64urlToBytes = (s) => {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};
const b64urlToJson = (s) => JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));

async function getKey(teamDomain, kid, fetchImpl) {
  let entry = certCache.get(teamDomain);
  const age = entry ? Date.now() - entry.at : Infinity;
  if (!entry || age > CERT_TTL || (!entry.keys.has(kid) && age > CERT_RETRY)) {
    const res = await fetchImpl(`https://${teamDomain}/cdn-cgi/access/certs`);
    if (!res.ok) throw new Error(`Access の公開鍵を取得できませんでした (${res.status})`);
    const { keys = [] } = await res.json();
    const map = new Map();
    for (const jwk of keys) {
      if (jwk.kty !== 'RSA') continue;
      map.set(jwk.kid, await crypto.subtle.importKey(
        'jwk', { kty: jwk.kty, n: jwk.n, e: jwk.e, alg: 'RS256', ext: true },
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify'],
      ));
    }
    entry = { keys: map, at: Date.now() };
    certCache.set(teamDomain, entry);
  }
  return entry.keys.get(kid) ?? null;
}

/** リクエストから Access のトークンを取り出す */
export function tokenFromRequest(request) {
  const header = request.headers.get('Cf-Access-Jwt-Assertion');
  if (header) return header;
  const cookie = request.headers.get('Cookie') || '';
  const m = /(?:^|;\s*)CF_Authorization=([^;]+)/.exec(cookie);
  return m ? m[1] : null;
}

/**
 * トークンが正しければ中身（payload）を返し、正しくなければ null を返す。
 * @param {string|null} token
 * @param {{teamDomain: string, aud: string, now?: number, fetchImpl?: typeof fetch}} opts
 */
export async function verifyAccessJwt(token, { teamDomain, aud, now = Date.now() / 1000, fetchImpl = fetch }) {
  if (!token || !teamDomain || !aud) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;

  let header, payload, signature;
  try {
    header = b64urlToJson(parts[0]);
    payload = b64urlToJson(parts[1]);
    signature = b64urlToBytes(parts[2]);
  } catch {
    return null;
  }
  if (header.alg !== 'RS256' || !header.kid) return null;

  const key = await getKey(teamDomain, header.kid, fetchImpl);
  if (!key) return null;

  const valid = await crypto.subtle.verify(
    'RSASSA-PKCS1-v1_5', key, signature, new TextEncoder().encode(`${parts[0]}.${parts[1]}`),
  );
  if (!valid) return null;

  if (typeof payload.exp !== 'number' || payload.exp <= now) return null;
  if (typeof payload.nbf === 'number' && payload.nbf > now + 60) return null;
  if (payload.iss !== `https://${teamDomain}`) return null;
  const auds = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!auds.includes(aud)) return null;

  return payload;
}

/** テスト用：鍵のキャッシュを消す */
export function _clearCertCache() {
  certCache.clear();
}
