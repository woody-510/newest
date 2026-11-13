export const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const smoothstep = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
/** フレームレートに左右されない追従係数（60fpsで1コマあたり base の割合だけ近づく） */
export const damp = (base, dt) => 1 - Math.pow(1 - base, dt / 16.667);

export const pad2 = (n) => String(n).padStart(2, '0');

/** 秒 → "12:34" / "1:02:03" */
export function formatTime(sec) {
  if (!Number.isFinite(sec) || sec < 0) return '--:--';
  const s = Math.floor(sec);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h > 0 ? `${h}:${pad2(m)}:${pad2(s % 60)}` : `${m}:${pad2(s % 60)}`;
}

/** ISO日時 → "2026.11.01" */
export function formatDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${d.getFullYear()}.${pad2(d.getMonth() + 1)}.${pad2(d.getDate())}`;
}

/** HTML文字列から要素を1つ作る（外から来た文字列は入れないこと。textContent を使う） */
export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

export const mqReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
export const mqFinePointer = window.matchMedia('(hover: hover) and (pointer: fine)');

export async function fetchJson(url) {
  try {
    const res = await fetch(url, { cache: 'no-cache', credentials: 'same-origin' });
    if (!res.ok) return { ok: false, status: res.status, data: null };
    // 存在しないパスに index.html を返すホスティングもあるので、JSONとして読めるかで判定する
    return { ok: true, status: res.status, data: JSON.parse(await res.text()) };
  } catch {
    return { ok: false, status: 0, data: null };
  }
}
