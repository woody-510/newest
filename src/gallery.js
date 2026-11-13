// 作品の一覧。大きなサムネを縦に1列に並べ、
// スクロール位置に合わせてカードを奥へ傾け、マウスを乗せると傾きと光沢で応える。

import { clamp, lerp, damp, el, formatTime, formatDate, pad2, mqReducedMotion, mqFinePointer } from './util.js';
import { icons } from './icons.js';
import { store } from './storage.js';

const CARD_HTML = `
<li class="work">
  <span class="work-index" aria-hidden="true"></span>
  <div class="work-inner">
    <a class="work-card">
      <div class="work-media">
        <div class="work-thumb"></div>
        <div class="work-dim"></div>
        <div class="work-glare"></div>
        <span class="work-play">${icons.play}</span>
        <span class="work-duration"></span>
        <div class="work-progress" hidden><i></i></div>
      </div>
    </a>
    <div class="work-info">
      <span class="work-num"></span>
      <h2 class="work-title"></h2>
      <p class="work-meta"><time></time><span class="work-resume" hidden></span></p>
    </div>
  </div>
</li>`;

export class Gallery {
  /**
   * @param {HTMLElement} listEl
   * @param {Array} works
   * @param {{onOpen: (work: object, mediaEl: HTMLElement) => void}} opts
   */
  constructor(listEl, works, { onOpen }) {
    this.listEl = listEl;
    this.works = works;
    this.onOpen = onOpen;
    this.items = [];
    this.active = -1;
    this.build();
  }

  build() {
    const total = this.works.length;
    const frag = document.createDocumentFragment();

    this.works.forEach((work, i) => {
      const li = el(CARD_HTML);
      const card = li.querySelector('.work-card');
      const media = li.querySelector('.work-media');
      const thumb = li.querySelector('.work-thumb');
      const num = pad2(i + 1);

      li.dataset.id = work.id;
      li.querySelector('.work-index').textContent = num;
      li.querySelector('.work-num').textContent = `${num} / ${pad2(total)}`;
      li.querySelector('.work-title').textContent = work.title;
      card.href = `#/watch/${encodeURIComponent(work.id)}`;
      card.setAttribute('aria-label', `「${work.title}」を再生`);

      const dur = li.querySelector('.work-duration');
      if (work.duration) dur.textContent = formatTime(work.duration);
      else dur.hidden = true;

      const time = li.querySelector('time');
      const date = formatDate(work.addedAt);
      if (date) {
        time.textContent = date;
        time.dateTime = work.addedAt;
      } else {
        time.hidden = true;
      }

      if (work.thumb) {
        const img = new Image();
        img.alt = '';
        img.decoding = 'async';
        img.loading = i < 2 ? 'eager' : 'lazy';
        if (i === 0) img.fetchPriority = 'high';
        img.addEventListener('load', () => thumb.classList.add('is-loaded'));
        img.addEventListener('error', () => this.markMissing(thumb, work, img));
        thumb.append(img);
        img.src = work.thumb;
        if (img.complete && img.naturalWidth) thumb.classList.add('is-loaded');
      } else {
        this.markMissing(thumb, work);
      }

      const item = {
        work, li, card, media,
        inner: li.querySelector('.work-inner'),
        index: li.querySelector('.work-index'),
        center: 0, height: 0,
        // マウスによる傾き（目標値と現在値）
        thx: 0, thy: 0, tl: 0, hx: 0, hy: 0, lift: 0, gx: 50, gy: 50,
        last: '',
      };
      this.items.push(item);

      const open = (e) => {
        // 新しいタブで開く操作などは、ブラウザに任せる
        if (e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        e.preventDefault();
        this.onOpen(work, media);
      };
      card.addEventListener('click', open);
      li.querySelector('.work-info').addEventListener('click', open);

      card.addEventListener('pointermove', (e) => {
        if (e.pointerType !== 'mouse' || !mqFinePointer.matches || mqReducedMotion.matches) return;
        const r = media.getBoundingClientRect();
        const nx = clamp((e.clientX - r.left) / r.width, 0, 1);
        const ny = clamp((e.clientY - r.top) / r.height, 0, 1);
        item.thx = (nx - 0.5) * 2 * 4; // 左右に最大 ±4°
        item.thy = (0.5 - ny) * 2 * 4; // 上下に最大 ±4°
        item.tl = 1;
        item.gx = nx * 100;
        item.gy = ny * 100;
      });
      card.addEventListener('pointerleave', () => {
        item.thx = 0;
        item.thy = 0;
        item.tl = 0;
      });

      frag.append(li);
      this.renderProgress(item);
    });

    this.listEl.append(frag);
  }

  markMissing(thumb, work, img) {
    img?.remove();
    thumb.classList.add('is-missing');
    thumb.dataset.initial = [...work.title][0] || '';
  }

  /** 視聴の進み具合（サムネ下のバーと「続きから」）を表示に反映する */
  renderProgress(item) {
    const saved = store.getProgress(item.work.id);
    const bar = item.li.querySelector('.work-progress');
    const resume = item.li.querySelector('.work-resume');
    const d = saved?.d || item.work.duration || 0;
    if (saved && d > 0 && (saved.done || saved.t > 5)) {
      bar.hidden = false;
      bar.style.setProperty('--watched', saved.done ? 1 : clamp(saved.t / d, 0, 1));
      resume.hidden = false;
      resume.textContent = saved.done ? '視聴済み' : `続きから ${formatTime(saved.t)}`;
    } else {
      bar.hidden = true;
      resume.hidden = true;
    }
  }

  refreshProgress(id) {
    for (const item of this.items) if (!id || item.work.id === id) this.renderProgress(item);
  }

  itemFor(id) {
    return this.items.find((it) => it.work.id === id) || null;
  }

  /** カードの位置を測り直す（画面の大きさが変わったときなど） */
  measure() {
    const sy = window.scrollY;
    for (const it of this.items) {
      const r = it.li.getBoundingClientRect();
      const mediaH = (r.width * 9) / 16;
      it.top = r.top + sy;
      it.height = mediaH;
      it.center = it.top + mediaH / 2;
    }
  }

  /** いちばん上と下のカードの中心（道のり表示に使う） */
  get span() {
    if (!this.items.length) return null;
    return { first: this.items[0].center, last: this.items[this.items.length - 1].center };
  }

  /**
   * 毎フレーム呼ぶ。
   * @param {{scrollY:number, vh:number, dt:number}} s
   */
  update({ scrollY, vh, dt }) {
    const center = scrollY + vh / 2;
    const reduce = mqReducedMotion.matches;
    const kh = damp(0.14, dt);
    let best = -1;
    let bestDist = Infinity;

    for (let i = 0; i < this.items.length; i++) {
      const it = this.items[i];
      const dist = it.center - center;
      const ad = Math.abs(dist);
      if (ad < bestDist) {
        bestDist = ad;
        best = i;
      }
      // 画面から遠いカードは計算しない
      if (ad > vh * 0.5 + it.height * 0.5 + 320) continue;

      let rx = 0;
      let s = 1;
      let dim = 0;
      let ny = 0;
      if (!reduce) {
        // 画面中央で正面。上下に離れるほど奥へ傾き、少し小さく暗くなる
        const d = clamp(dist / (vh * 0.85), -1, 1);
        const a = Math.abs(d);
        const e = a * a * (3 - 2 * a);
        rx = -Math.sign(d) * e * 13;
        s = 1 - e * 0.09;
        dim = e * 0.55;
        ny = d * -40;
      }

      it.hx = Math.abs(it.thx - it.hx) < 0.005 ? it.thx : lerp(it.hx, it.thx, kh);
      it.hy = Math.abs(it.thy - it.hy) < 0.005 ? it.thy : lerp(it.hy, it.thy, kh);
      it.lift = Math.abs(it.tl - it.lift) < 0.003 ? it.tl : lerp(it.lift, it.tl, kh);

      const key = `${rx.toFixed(2)}|${s.toFixed(4)}|${dim.toFixed(3)}|${it.hx.toFixed(2)}|${it.hy.toFixed(2)}|${it.lift.toFixed(3)}|${it.gx | 0}|${it.gy | 0}`;
      if (key === it.last) continue;
      it.last = key;

      const st = it.inner.style;
      st.setProperty('--rx', rx.toFixed(2));
      st.setProperty('--s', s.toFixed(4));
      st.setProperty('--dim', dim.toFixed(3));
      st.setProperty('--hx', it.hx.toFixed(2));
      st.setProperty('--hy', it.hy.toFixed(2));
      st.setProperty('--lift', it.lift.toFixed(3));
      st.setProperty('--gx', it.gx.toFixed(1));
      st.setProperty('--gy', it.gy.toFixed(1));
      // サムネの中身はマウスと逆向きにわずかに動かす（奥行き）
      st.setProperty('--px', (-it.hx * 0.3).toFixed(2));
      st.setProperty('--py', (it.hy * 0.3).toFixed(2));
      it.index.style.setProperty('--ny', ny.toFixed(1));
    }

    if (best !== this.active) {
      this.items[this.active]?.li.classList.remove('is-active');
      this.items[best]?.li.classList.add('is-active');
      this.active = best;
    }
  }
}
