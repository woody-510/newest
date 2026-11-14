// スクロールに連動する背景。
//
// 1) public/bg/frames.json があれば、Blender で書き出した連番画像をスクロール位置に合わせて表示する。
// 2) 無ければ、スクロールで奥へ進んでいく光の回廊をプログラムで描く（Blenderの背景ができるまでの仮の背景）。
//
// どちらも「スクロールしたぶんだけ進み、止めると少し遅れて止まる」動きをする。

import { clamp, lerp, damp, smoothstep, fetchJson, mqReducedMotion } from './util.js';

const MAX_DPR = 1.5;
const INERTIA = 0.085; // 小さいほど、ゆっくり追いかける

const hash = (n) => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
};
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;

export class ScrollBackground {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{framesUrl: string, onLoadProgress?: (ratio: number) => void}} opts
   */
  constructor(canvas, { framesUrl, onLoadProgress } = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false });
    this.framesUrl = framesUrl;
    this.onLoadProgress = onLoadProgress || (() => {});

    this.mode = 'procedural';
    this.sy = 0; // なめらかに追従するスクロール量(px)
    this.max = 1;
    this.mx = 0;
    this.my = 0;
    this.dirty = true;

    this.meta = null;
    this.base = null;
    this.frames = [];
    this.count = 0;
    this.generation = 0;

    this.sprites = new Map();
    this.dust = null;
  }

  async init() {
    this.resize();
    const { data } = await fetchJson(this.framesUrl);
    if (data && Number.isInteger(data.count) && data.count > 0 && typeof data.wide === 'string') {
      this.meta = data;
      await this.loadSet();
    }
    if (this.mode === 'procedural') this.onLoadProgress(1);
    this.dirty = true;
  }

  /** 画面の向きに合う連番（横長 / 縦長）を選ぶ */
  pickBase() {
    const tall = this.meta.tall && window.innerHeight > window.innerWidth * 1.15;
    return tall ? this.meta.tall : this.meta.wide;
  }

  async loadSet() {
    const base = this.pickBase();
    if (base === this.base) return;
    this.base = base;
    const gen = ++this.generation;
    const count = this.meta.count;
    const ext = this.meta.ext || 'webp';
    const frames = new Array(count);
    let loaded = 0;

    const load = (i) =>
      new Promise((resolve) => {
        const img = new Image();
        img.decoding = 'async';
        img.onload = () => {
          if (gen === this.generation) {
            frames[i] = img;
            loaded += 1;
            this.onLoadProgress(loaded / count);
            this.dirty = true;
          }
          resolve();
        };
        img.onerror = () => resolve();
        img.src = `${base}${String(i + 1).padStart(4, '0')}.${ext}`;
      });

    // まず1コマ目だけ読む（これが出れば、ページを表示できる）
    await load(0);
    if (gen !== this.generation) return;
    if (!frames[0]) {
      // 連番が読めないときは、仮の背景のままにする
      this.base = null;
      return;
    }
    this.frames = frames;
    this.count = count;
    this.mode = 'frames';
    this.dirty = true;

    // 残りは裏で読む。8コマおき → 4 → 2 → 全部 の順（早い段階からスクロールに反応できる）
    const order = [];
    const seen = new Uint8Array(count);
    seen[0] = 1;
    for (const stride of [8, 4, 2, 1]) {
      for (let i = 0; i < count; i += stride) {
        if (!seen[i]) {
          seen[i] = 1;
          order.push(i);
        }
      }
    }
    let next = 0;
    const worker = async () => {
      while (next < order.length && gen === this.generation) await load(order[next++]);
    };
    Promise.all(Array.from({ length: 6 }, worker)).then(() => {
      if (gen === this.generation) this.onLoadProgress(1);
    });
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.dirty = true;
      this.lastFrameKey = '';
    }
    this.w = w;
    this.h = h;
    this.dpr = dpr;
    if (this.meta) this.loadSet();
  }

  /** なめらかな追従を飛ばして、今のスクロール位置に合わせる（最初の表示用） */
  jump(scrollY, maxScroll) {
    this.sy = mqReducedMotion.matches ? 0 : scrollY;
    this.max = Math.max(1, maxScroll);
    this.dirty = true;
  }

  /**
   * 毎フレーム呼ぶ。動きがあったときだけ描き直す。
   * @param {{scrollY:number, maxScroll:number, mouseX:number, mouseY:number, dt:number}} s
   */
  update({ scrollY, maxScroll, mouseX, mouseY, dt }) {
    const reduce = mqReducedMotion.matches;
    const target = reduce ? 0 : scrollY;
    const prevSy = this.sy;
    const prevMx = this.mx;
    const prevMy = this.my;

    this.max = Math.max(1, maxScroll);
    this.sy = Math.abs(target - this.sy) < 0.08 ? target : lerp(this.sy, target, damp(INERTIA, dt));

    const tx = reduce ? 0 : mouseX;
    const ty = reduce ? 0 : mouseY;
    const km = damp(0.045, dt);
    this.mx = Math.abs(tx - this.mx) < 0.0008 ? tx : lerp(this.mx, tx, km);
    this.my = Math.abs(ty - this.my) < 0.0008 ? ty : lerp(this.my, ty, km);

    if (this.dirty || this.sy !== prevSy || this.mx !== prevMx || this.my !== prevMy) {
      this.dirty = false;
      this.render();
    }
  }

  get progress() {
    return clamp(this.sy / this.max, 0, 1);
  }

  render() {
    if (this.mode === 'frames') this.renderFrames();
    else this.renderProcedural();
  }

  // ───────── Blender の連番 ─────────

  nearestLoaded(i) {
    const f = this.frames;
    if (f[i]) return i;
    for (let d = 1; d < this.count; d++) {
      if (i - d >= 0 && f[i - d]) return i - d;
      if (i + d < this.count && f[i + d]) return i + d;
    }
    return -1;
  }

  /** これから描きそうなコマを先に展開しておく（描く瞬間に展開すると、そこで引っかかる） */
  warm(idx) {
    if (idx === this.warmedAt) return;
    const dir = idx >= (this.warmedAt ?? idx) ? 1 : -1;
    this.warmedAt = idx;
    for (let k = 1; k <= 4; k++) {
      this.frames[idx + dir * k]?.decode?.().catch(() => {});
    }
  }

  renderFrames() {
    // コマとコマの間は、隣り合う2コマを重ねてつなぐ（1コマずつ切り替えると、ゆっくり動くときにカクつく）
    const pos = this.progress * (this.count - 1);
    const base = Math.min(Math.floor(pos), this.count - 1);
    let idx = base;
    let next = -1;
    let mix = 0;
    if (this.frames[base] && this.frames[base + 1]) {
      mix = Math.round((pos - base) * 32) / 32;
      if (mix >= 1) idx = base + 1;
      else if (mix > 0) next = base + 1;
    } else {
      // まだ読み込み中のコマは、いちばん近い読み込み済みのコマで代用する
      idx = this.nearestLoaded(Math.round(pos));
    }
    if (idx < 0) return;
    const img = this.frames[idx];
    const { ctx, w, h } = this;
    this.warm(idx);

    // 画面を覆うように拡大（少し大きめにして、マウスに合わせてわずかに動かす）
    const scale = Math.max(w / img.naturalWidth, h / img.naturalHeight) * 1.035;
    const dw = img.naturalWidth * scale;
    const dh = img.naturalHeight * scale;
    const px = clamp(-this.mx * w * 0.012, -(dw - w) / 2, (dw - w) / 2);
    const py = clamp(-this.my * h * 0.012, -(dh - h) / 2, (dh - h) / 2);
    // 同じコマ・同じ位置なら描き直さない
    const key = `${idx}|${next}|${mix}|${px.toFixed(1)}|${py.toFixed(1)}|${w}|${h}`;
    if (key === this.lastFrameKey) return;
    this.lastFrameKey = key;
    ctx.imageSmoothingQuality = 'high';
    ctx.globalAlpha = 1;
    ctx.drawImage(img, (w - dw) / 2 + px, (h - dh) / 2 + py, dw, dh);
    if (next >= 0) {
      ctx.globalAlpha = mix;
      ctx.drawImage(this.frames[next], (w - dw) / 2 + px, (h - dh) / 2 + py, dw, dh);
      ctx.globalAlpha = 1;
    }
  }

  // ───────── 仮の背景（光の回廊） ─────────

  /** 光の柱・反射・塵の画像を作っておく（色ごとに使い回す） */
  sprite(kind, color) {
    const key = `${kind}:${color[0] | 0},${color[1] | 0},${color[2] | 0}`;
    let c = this.sprites.get(key);
    if (c) return c;
    if (this.sprites.size > 120) this.sprites.clear();

    c = document.createElement('canvas');
    const g = c.getContext('2d');
    if (kind === 'dust') {
      c.width = c.height = 32;
      const r = g.createRadialGradient(16, 16, 0, 16, 16, 16);
      r.addColorStop(0, rgb(color, 1));
      r.addColorStop(0.25, rgb(color, 0.5));
      r.addColorStop(1, rgb(color, 0));
      g.fillStyle = r;
      g.fillRect(0, 0, 32, 32);
    } else {
      // 横方向：中心が明るく外へ向かって消える。縦方向：柱は上端、反射は下端に向かって消える
      c.width = 64;
      c.height = 128;
      const hg = g.createLinearGradient(0, 0, 64, 0);
      hg.addColorStop(0, rgb(color, 0));
      hg.addColorStop(0.3, rgb(color, 0.05));
      hg.addColorStop(0.44, rgb(color, 0.3));
      hg.addColorStop(0.5, rgb(color, 1));
      hg.addColorStop(0.56, rgb(color, 0.3));
      hg.addColorStop(0.7, rgb(color, 0.05));
      hg.addColorStop(1, rgb(color, 0));
      g.fillStyle = hg;
      g.fillRect(0, 0, 64, 128);
      g.globalCompositeOperation = 'destination-in';
      const vg = g.createLinearGradient(0, 0, 0, 128);
      if (kind === 'pillar') {
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(0.22, 'rgba(0,0,0,1)');
        vg.addColorStop(1, 'rgba(0,0,0,1)');
      } else {
        vg.addColorStop(0, 'rgba(0,0,0,1)');
        vg.addColorStop(1, 'rgba(0,0,0,0)');
      }
      g.fillStyle = vg;
      g.fillRect(0, 0, 64, 128);
    }
    this.sprites.set(key, c);
    return c;
  }

  renderProcedural() {
    const { ctx, w, h } = this;
    const p = this.progress;

    // 空間の寸法（単位は適当な「メートル」）
    const SPACING = 3.6; // 柱の間隔
    const HALF = 3.4; // 通路の半分の幅
    const HEIGHT = 7.6; // 柱の高さ
    const camZ = this.sy * 0.0105; // スクロール量に比例して前へ進む
    const camX = this.mx * 0.5;
    const camY = 1.55 - this.my * 0.14;
    const focal = h * 0.92;
    const cx = w / 2 - this.mx * w * 0.012;
    const cy = h * 0.5 + this.my * h * 0.01;

    // 進むにつれて、青白い夜の色から、あたたかい金色へ
    const warm = smoothstep(0.1, 1, p);
    const q = Math.round(warm * 24) / 24;
    const light = mix3([172, 194, 236], [244, 224, 184], q);
    const skyTop = mix3([4, 5, 9], [9, 7, 9], warm);
    const skyLow = mix3([12, 18, 32], [38, 27, 17], warm);
    const floorNear = [3, 3, 5];

    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;

    // 空
    let g = ctx.createLinearGradient(0, 0, 0, cy);
    g.addColorStop(0, rgb(skyTop));
    g.addColorStop(1, rgb(skyLow));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, Math.ceil(cy));
    // 床
    g = ctx.createLinearGradient(0, cy, 0, h);
    g.addColorStop(0, rgb(skyLow));
    g.addColorStop(0.08, rgb(mix3(skyLow, floorNear, 0.35)));
    g.addColorStop(0.5, rgb(mix3(skyLow, floorNear, 0.82)));
    g.addColorStop(1, rgb(floorNear));
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.floor(cy), w, h - Math.floor(cy));

    // 奥の光（進むほど大きく、強くなる）
    const glowR = h * (0.4 + 0.55 * p);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1.7, 1);
    g = ctx.createRadialGradient(0, 0, 0, 0, 0, glowR);
    g.addColorStop(0, rgb(light, 0.2 + 0.36 * p));
    g.addColorStop(0.35, rgb(light, 0.07 + 0.12 * p));
    g.addColorStop(1, rgb(light, 0));
    ctx.fillStyle = g;
    ctx.fillRect(-glowR, -glowR, glowR * 2, glowR * 2);
    ctx.restore();

    // ここから光を足していく
    ctx.globalCompositeOperation = 'lighter';
    const pillar = this.sprite('pillar', light);
    const reflect = this.sprite('reflect', light);
    const dustSprite = this.sprite('dust', light);

    const k0 = Math.floor(camZ / SPACING);
    const COUNT = 24;
    ctx.lineCap = 'round';

    for (let k = k0 + COUNT; k >= k0; k--) {
      const dz = k * SPACING - camZ;
      if (dz < 0.25) continue;
      const fog = Math.exp(-dz * 0.052) * smoothstep(0.25, 2.6, dz);
      if (fog < 0.004) continue;
      const scale = focal / dz;
      const yFloor = cy + camY * scale;

      // 床を横切る細い線（進んでいる感じを出す）
      const xl = cx + (-HALF - camX) * scale;
      const xr = cx + (HALF - camX) * scale;
      ctx.globalAlpha = fog * 0.1;
      ctx.strokeStyle = rgb(light);
      ctx.lineWidth = Math.max(1, 0.012 * scale);
      ctx.beginPath();
      ctx.moveTo(xl, yFloor);
      ctx.lineTo(xr, yFloor);
      ctx.stroke();

      // 天井の灯り（中央に点々と続く）
      const dz2 = dz + SPACING * 0.42;
      const s2 = focal / dz2;
      const yc1 = cy - (HEIGHT + 0.5 - camY) * scale;
      const yc2 = cy - (HEIGHT + 0.5 - camY) * s2;
      ctx.globalAlpha = fog * 0.42;
      ctx.lineWidth = Math.max(1, 0.05 * scale);
      ctx.beginPath();
      ctx.moveTo(cx - camX * scale, yc1);
      ctx.lineTo(cx - camX * s2, yc2);
      ctx.stroke();

      // 左右の光の柱（内側の列と、外側のうすい列）
      for (let side = -1; side <= 1; side += 2) {
        for (let row = 1; row <= 2; row++) {
          const seed = k * 4 + (side > 0 ? 1 : 0) + row * 2;
          if (hash(seed) < (row === 1 ? 0.08 : 0.3)) continue; // ところどころ消えている
          const x = side * HALF * (row === 1 ? 1 : 2.35);
          const top = HEIGHT * (row === 1 ? 0.82 + 0.18 * hash(seed + 0.5) : 1.25);
          const sx = cx + (x - camX) * scale;
          const sw = Math.max(3, 0.62 * scale);
          if (sx < -sw || sx > w + sw) continue;
          const yTop = cy - (top - camY) * scale;
          const a = fog * (row === 1 ? 0.62 + 0.38 * hash(seed + 0.9) : 0.3);

          ctx.globalAlpha = a;
          ctx.drawImage(pillar, sx - sw / 2, yTop, sw, yFloor - yTop);
          // 床への映り込み
          ctx.globalAlpha = a * 0.34;
          ctx.drawImage(reflect, sx - sw * 0.7, yFloor, sw * 1.4, (yFloor - yTop) * 0.62);
        }
      }
    }

    // 漂う塵
    if (!this.dust) {
      const N = 240;
      this.dust = new Float32Array(N * 4);
      for (let i = 0; i < N; i++) {
        this.dust[i * 4] = (hash(i * 3.1 + 1) - 0.5) * 22;
        this.dust[i * 4 + 1] = 0.2 + hash(i * 5.7 + 2) * 7.4;
        this.dust[i * 4 + 2] = hash(i * 7.3 + 3) * 48;
        this.dust[i * 4 + 3] = 0.25 + hash(i * 9.9 + 4) * 0.75;
      }
    }
    const d = this.dust;
    const DEPTH = 48;
    for (let i = 0; i < d.length; i += 4) {
      const dz = (((d[i + 2] - camZ) % DEPTH) + DEPTH) % DEPTH;
      if (dz < 0.4) continue;
      const scale = focal / dz;
      const sx = cx + (d[i] - camX) * scale;
      const sy = cy - (d[i + 1] - camY) * scale;
      if (sx < -20 || sx > w + 20 || sy < -20 || sy > h + 20) continue;
      const size = clamp(0.045 * scale, 1.4 * this.dpr, 10 * this.dpr);
      ctx.globalAlpha = Math.exp(-dz * 0.06) * smoothstep(0.4, 3, dz) * smoothstep(DEPTH, DEPTH - 8, dz) * d[i + 3] * 0.8;
      ctx.drawImage(dustSprite, sx - size, sy - size, size * 2, size * 2);
    }

    // 手前の床と天井を暗く落として、奥行きを強める
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
    g = ctx.createLinearGradient(0, cy, 0, h);
    g.addColorStop(0, rgb(floorNear, 0));
    g.addColorStop(1, rgb(floorNear, 0.86));
    ctx.fillStyle = g;
    ctx.fillRect(0, Math.floor(cy), w, h - Math.floor(cy));
    g = ctx.createLinearGradient(0, 0, 0, cy * 0.7);
    g.addColorStop(0, rgb(skyTop, 0.8));
    g.addColorStop(1, rgb(skyTop, 0));
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, Math.ceil(cy * 0.7));
  }
}
