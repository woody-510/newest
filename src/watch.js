// 視聴画面。一覧の上に重ねて表示し、プレイヤー・作品名・ほかの作品を並べる。

import { el, formatTime, formatDate, pad2 } from './util.js';
import { icons } from './icons.js';
import { Player } from './player.js';

const SHORTCUTS = [
  [['Space', 'K'], '再生・一時停止'],
  [['←', '→'], '5秒戻る・進む'],
  [['J', 'L'], '10秒戻る・進む'],
  [['0', '–', '9'], '全体の 0%〜90% の位置へ'],
  [['↑', '↓'], '音量を上げる・下げる'],
  [['M'], 'ミュート'],
  [['<', '>'], '再生速度を下げる・上げる'],
  [['F'], '全画面'],
  [['P'], '小窓で再生'],
  [['Esc'], '一覧に戻る'],
];

const TEMPLATE = `
<div class="watch" role="dialog" aria-modal="true" hidden>
  <div class="watch-backdrop"><img class="watch-ambient" alt="" aria-hidden="true"></div>
  <div class="watch-scroll">
    <div class="watch-top">
      <button class="watch-back" type="button">${icons.arrowLeft}<span>一覧に戻る</span></button>
      <span class="watch-count"></span>
    </div>
    <div class="watch-stage">
      <div class="watch-player"></div>
      <div class="watch-info">
        <div>
          <h1 class="watch-title"></h1>
          <p class="watch-meta"></p>
        </div>
        <button class="help-button" type="button" aria-haspopup="dialog">${icons.keyboard}<span>キー操作</span></button>
      </div>
    </div>
    <section class="watch-next" hidden>
      <h2>ほかの作品</h2>
      <div class="next-list"></div>
    </section>
  </div>
  <div class="help" role="dialog" aria-modal="true" aria-label="キーボードでの操作" hidden>
    <div class="help-panel">
      <div class="help-head">
        <h2>キーボードでの操作</h2>
        <button class="help-close" type="button" aria-label="閉じる">${icons.close}</button>
      </div>
      <dl class="help-list"></dl>
    </div>
  </div>
</div>`;

export class WatchView {
  /**
   * @param {Array} works
   * @param {{onRequestClose: () => void, onNavigate: (work: object) => void, onProgress: (id: string) => void}} handlers
   */
  constructor(works, { onRequestClose, onNavigate, onProgress }) {
    this.works = works;
    this.onRequestClose = onRequestClose;
    this.onNavigate = onNavigate;
    this.current = null;

    this.root = el(TEMPLATE);
    const $ = (s) => this.root.querySelector(s);
    this.ambient = $('.watch-ambient');
    this.scroller = $('.watch-scroll');
    this.countEl = $('.watch-count');
    this.titleEl = $('.watch-title');
    this.metaEl = $('.watch-meta');
    this.nextSection = $('.watch-next');
    this.nextList = $('.next-list');
    this.help = $('.help');

    this.player = new Player({
      onBack: () => this.onRequestClose(),
      onNext: (work) => this.onNavigate(work),
      onProgress,
    });
    $('.watch-player').append(this.player.root);

    // キー操作の一覧
    const list = $('.help-list');
    for (const [keys, text] of SHORTCUTS) {
      const dt = document.createElement('dt');
      for (const k of keys) {
        if (k === '–') dt.append('–');
        else dt.append(Object.assign(document.createElement('kbd'), { textContent: k }));
      }
      list.append(dt, Object.assign(document.createElement('dd'), { textContent: text }));
    }

    $('.watch-back').addEventListener('click', () => this.onRequestClose());
    $('.help-button').addEventListener('click', () => this.toggleHelp());
    $('.help-close').addEventListener('click', () => this.toggleHelp(false));
    this.help.addEventListener('click', (e) => {
      if (e.target === this.help) this.toggleHelp(false);
    });

    this.onKey = this.onKey.bind(this);
    document.body.append(this.root);
  }

  get isOpen() {
    return !this.root.hidden;
  }

  /** プレイヤーの枠（カードから広がる切り替えの行き先） */
  get playerEl() {
    return this.player.root;
  }

  /**
   * @param {object} work
   * @param {{autoplay?: boolean, animate?: boolean}} opts
   */
  open(work, { autoplay = true, animate = false } = {}) {
    const wasOpen = this.isOpen;
    const index = this.works.indexOf(work);
    const next = this.works.length > 1 ? this.works[(index + 1) % this.works.length] : null;
    this.current = work;

    this.root.hidden = false;
    this.root.setAttribute('aria-label', work.title);
    this.root.classList.toggle('is-entering', animate && !wasOpen);
    this.scroller.scrollTop = 0;
    this.toggleHelp(false);

    if (work.thumb) this.ambient.src = work.thumb;
    else this.ambient.removeAttribute('src');

    this.countEl.replaceChildren(
      Object.assign(document.createElement('b'), { textContent: pad2(index + 1) }),
      ` / ${pad2(this.works.length)}`,
    );
    this.titleEl.textContent = work.title;
    this.metaEl.textContent = [work.duration ? formatTime(work.duration) : '', formatDate(work.addedAt)]
      .filter(Boolean)
      .join('　・　');

    this.renderNext(work);
    // 次の作品は「最後の作品の次」には出さない（一巡して最初に戻らないように）
    this.player.load(work, { autoplay, next: index < this.works.length - 1 ? next : null });

    if (!wasOpen) document.addEventListener('keydown', this.onKey);
    this.player.root.focus({ preventScroll: true });
  }

  close() {
    if (!this.isOpen) return;
    this.player.unload();
    this.toggleHelp(false);
    this.root.hidden = true;
    this.root.classList.remove('is-entering');
    this.ambient.removeAttribute('src');
    this.current = null;
    document.removeEventListener('keydown', this.onKey);
  }

  renderNext(current) {
    const others = this.works.filter((w) => w !== current);
    this.nextSection.hidden = others.length === 0;
    this.nextList.replaceChildren(
      ...others.map((work) => {
        const a = el(`<a class="next-item"><div class="next-thumb"></div><p class="next-title"></p></a>`);
        a.href = `#/watch/${encodeURIComponent(work.id)}`;
        const thumb = a.querySelector('.next-thumb');
        if (work.thumb) {
          thumb.append(Object.assign(new Image(), { src: work.thumb, alt: '', loading: 'lazy', decoding: 'async' }));
        }
        if (work.duration) thumb.append(Object.assign(document.createElement('span'), { textContent: formatTime(work.duration) }));
        a.querySelector('.next-title').textContent = work.title;
        a.addEventListener('click', (e) => {
          if (e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
          e.preventDefault();
          this.onNavigate(work);
        });
        return a;
      }),
    );
  }

  toggleHelp(force) {
    const show = force ?? this.help.hidden;
    if (show === !this.help.hidden) return;
    this.help.hidden = !show;
    if (show) this.help.querySelector('.help-close').focus({ preventScroll: true });
    else if (this.isOpen) this.player.root.focus({ preventScroll: true });
  }

  onKey(e) {
    if (e.defaultPrevented) return;
    if (!this.help.hidden) {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        this.toggleHelp(false);
      }
      return;
    }
    if (e.key === '?') {
      e.preventDefault();
      this.toggleHelp(true);
      return;
    }
    if (this.player.handleKey(e)) {
      e.preventDefault();
      return;
    }
    // 全画面中の Esc はブラウザが全画面を終了する。それ以外は一覧に戻る
    if (e.key === 'Escape' && !document.fullscreenElement) {
      e.preventDefault();
      this.onRequestClose();
    }
  }
}
