// 全体のまとめ役：読み込み → 一覧の表示 → スクロールに合わせた更新 → 視聴画面の開閉。

import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource-variable/inter';
import '@fontsource-variable/noto-sans-jp';
import './styles/tokens.css';
import './styles/base.css';
import './styles/gallery.css';
import './styles/player.css';

import { config } from './config.js';
import { clamp, smoothstep, el, pad2, fetchJson, mqReducedMotion } from './util.js';
import { icons } from './icons.js';
import { ScrollBackground } from './scroll-background.js';
import { Gallery } from './gallery.js';
import { WatchView } from './watch.js';

const root = document.documentElement;
const $ = (s) => document.querySelector(s);

const page = $('#page');
const header = $('.site-header');
const hero = $('.hero');
const heroInner = $('.hero-inner');
const worksSection = $('.works');
const listEl = $('.works-list');
const outro = $('.outro');
const rail = $('.rail');
const shade = $('.bg-shade');
const loadBar = $('.bg-load');

const state = {
  scrollY: window.scrollY,
  vh: window.innerHeight,
  maxScroll: 1,
  mouseX: 0,
  mouseY: 0,
  outroTop: Infinity,
};

let works = [];
let byId = new Map();
let bg = null;
let gallery = null;
let watch = null;
let railEls = null;
let pendingSource = null; // クリックされたカード（広がる切り替えの出発点）
let pushedHistory = false; // 一覧から視聴画面へ進んだか（戻るボタンで一覧に帰れるか）
const cache = {};

// ───────── 文言 ─────────

function setupText() {
  document.title = config.pageTitle;
  $('.loader-name').textContent = config.siteName;
  $('.brand').textContent = config.siteName;
  const tagline = $('.hero-tagline');
  tagline.textContent = config.tagline;
  tagline.hidden = !config.tagline;
  if (config.tagline && config.taglineBelow) {
    // 小さな一行を、サイト名の下に置く
    $('.hero-title').after(tagline);
    heroInner.classList.add('has-tagline-below');
  }

  // サイト名を1文字ずつに分けて、順番に現れるようにする
  const title = $('.hero-title');
  const chars = Array.from(config.siteName);
  title.setAttribute('aria-label', config.siteName);
  title.replaceChildren(
    ...chars.map((ch, i) => {
      const span = document.createElement('span');
      span.textContent = ch === ' ' ? ' ' : ch;
      span.style.setProperty('--i', i);
      span.setAttribute('aria-hidden', 'true');
      return span;
    }),
  );
  // 文字数に合わせて1行に収まる大きさにする（全角文字は幅が広い）
  const wide = chars.some((ch) => ch.charCodeAt(0) > 0x2e7f);
  if (wide) import('@fontsource/noto-serif-jp/500.css'); // 日本語のサイト名のときだけ明朝体を読み込む
  title.style.setProperty('--chars', Math.max(chars.length, 4));
  title.style.setProperty('--char-w', wide ? 1.2 : 0.88);

  const logout = $('.logout');
  if (config.showLogout && config.logoutUrl) {
    logout.href = config.logoutUrl;
    logout.insertAdjacentHTML('afterbegin', icons.logout);
    logout.hidden = false;
  }
  $('.to-top').insertAdjacentHTML('afterbegin', icons.arrowUp);
}

// ───────── 作品一覧 ─────────

function normalize(data) {
  if (!Array.isArray(data)) return [];
  const seen = new Set();
  const out = [];
  for (const w of data) {
    if (!w || typeof w.id !== 'string' || typeof w.title !== 'string' || typeof w.src !== 'string') continue;
    if (seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({
      id: w.id,
      title: w.title,
      src: w.src,
      type: w.type === 'hls' ? 'hls' : 'file',
      thumb: typeof w.thumb === 'string' ? w.thumb : null,
      duration: Number(w.duration) > 0 ? Number(w.duration) : 0,
      addedAt: typeof w.addedAt === 'string' ? w.addedAt : '',
    });
  }
  return out;
}

function showMessage(kind) {
  const box = el('<div class="works-message"><h2></h2><p></p></div>');
  const h = box.querySelector('h2');
  const p = box.querySelector('p');
  if (kind === 'empty') {
    h.textContent = 'まだ作品がありません';
    p.innerHTML = '<code>media/videos</code> に動画を置いて <code>npm run manifest</code> を実行すると、ここに並びます。';
  } else {
    h.textContent = '作品一覧を読み込めませんでした';
    p.textContent = '通信の状態を確認して、もう一度お試しください。';
    const b = el('<button type="button">再読み込み</button>');
    b.addEventListener('click', () => location.reload());
    box.append(b);
  }
  worksSection.append(box);
}

function buildRail() {
  const n = works.length;
  if (n < 2) return;
  const cur = el('<span class="rail-num is-current">01</span>');
  const track = el('<div class="rail-track"><i class="rail-fill"></i></div>');
  const total = el('<span class="rail-num"></span>');
  total.textContent = pad2(n);
  const dots = works.map((work, i) => {
    const b = el('<button class="rail-dot" type="button"><span class="rail-label"></span></button>');
    b.style.setProperty('--at', i / (n - 1));
    b.querySelector('.rail-label').textContent = `${pad2(i + 1)}　${work.title}`;
    b.setAttribute('aria-label', `${i + 1}番目「${work.title}」へ移動`);
    b.addEventListener('click', () => scrollToWork(i));
    track.append(b);
    return b;
  });
  rail.replaceChildren(cur, track, total);
  railEls = { cur, dots };
}

function scrollToY(y) {
  window.scrollTo({ top: Math.max(0, y), behavior: mqReducedMotion.matches ? 'auto' : 'smooth' });
}
function scrollToWork(i) {
  const it = gallery?.items[i];
  if (it) scrollToY(it.center - state.vh / 2);
}

// ───────── 位置の計測 ─────────

/** 作品が少なくてページが短いと景色が一気に進むので、最低でも画面5つ分の長さにする */
function applyMinHeight() {
  const n = works.length;
  listEl.style.removeProperty('--work-gap');
  if (n < 2) return;
  const need = state.vh * 5;
  const docH = root.scrollHeight;
  if (docH >= need) return;
  const cur = parseFloat(getComputedStyle(listEl).rowGap) || 0;
  listEl.style.setProperty('--work-gap', `${Math.min(cur + (need - docH) / (n - 1), state.vh * 0.9).toFixed(1)}px`);
}

function measure() {
  state.vh = window.innerHeight;
  state.scrollY = window.scrollY;
  applyMinHeight();
  gallery?.measure();
  state.maxScroll = Math.max(1, root.scrollHeight - window.innerHeight);
  state.outroTop = outro.hidden ? Infinity : outro.getBoundingClientRect().top + window.scrollY;
}

// ───────── 毎フレームの更新 ─────────

const setVar = (elm, name, value, key) => {
  if (cache[key] === value) return;
  cache[key] = value;
  elm.style.setProperty(name, value);
};
const setClass = (elm, name, on, key) => {
  if (cache[key] === on) return;
  cache[key] = on;
  elm.classList.toggle(name, on);
};

function updateChrome() {
  const { scrollY, vh, outroTop } = state;

  setClass(header, 'is-scrolled', scrollY > vh * 0.4, 'hdr');
  setClass(hero, 'is-passed', scrollY > 48, 'cue');
  setVar(heroInner, '--hero-p', clamp(scrollY / (vh * 0.8), 0, 1).toFixed(3), 'hero');

  // 作品の列の後ろを暗くする（最初と最後の画面では弱める）
  const s = smoothstep(vh * 0.2, vh * 0.9, scrollY) * (1 - 0.75 * smoothstep(outroTop - vh * 0.9, outroTop - vh * 0.15, scrollY));
  setVar(shade, '--shade', s.toFixed(3), 'shade');

  if (railEls && gallery) {
    const span = gallery.span;
    const center = scrollY + vh / 2;
    const visible = scrollY > vh * 0.45 && scrollY < outroTop - vh * 0.45;
    setClass(rail, 'is-visible', visible, 'rail');
    const fill = span.last > span.first ? clamp((center - span.first) / (span.last - span.first), 0, 1) : 0;
    setVar(rail, '--rail', fill.toFixed(4), 'railFill');
    const active = gallery.active;
    if (cache.railActive !== active) {
      cache.railActive = active;
      railEls.cur.textContent = pad2(active + 1);
      railEls.dots.forEach((d, i) => {
        d.classList.toggle('is-active', i === active);
        d.classList.toggle('is-passed', i < active);
        if (i === active) d.setAttribute('aria-current', 'true');
        else d.removeAttribute('aria-current');
      });
    }
  }
}

let lastTime = performance.now();
function tick(dt) {
  bg?.update({ scrollY: state.scrollY, maxScroll: state.maxScroll, mouseX: state.mouseX, mouseY: state.mouseY, dt });
  gallery?.update({ scrollY: state.scrollY, vh: state.vh, dt });
  updateChrome();
}
function frame(now) {
  const dt = Math.min(64, now - lastTime);
  lastTime = now;
  // 視聴中は背景を止める（その時点の景色のまま、動画の再生に処理を回す）
  if (!watch?.isOpen) tick(dt);
  requestAnimationFrame(frame);
}

// ───────── 視聴画面の開閉 ─────────

const watchHash = (work) => `#/watch/${encodeURIComponent(work.id)}`;

function currentWatchId() {
  const m = /^#\/watch\/(.+)$/.exec(location.hash);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return '';
  }
}

function clearHash() {
  history.replaceState(null, '', location.pathname + location.search);
}

function route() {
  if (!watch) return;
  const id = currentWatchId();
  const work = id != null ? byId.get(id) : null;
  if (work) {
    openWatch(work);
  } else {
    if (id != null) clearHash(); // 存在しない作品のURL
    closeWatch();
  }
}

function requestOpen(work, mediaEl) {
  pendingSource = mediaEl;
  pushedHistory = true;
  location.hash = watchHash(work);
}

function requestClose() {
  if (pushedHistory) {
    history.back();
  } else {
    clearHash();
    route();
  }
}

/** 視聴画面の中で別の作品へ（履歴は増やさない。戻るボタンは一覧へ） */
function navigate(work) {
  history.replaceState(null, '', watchHash(work));
  route();
}

const canTransition = () => typeof document.startViewTransition === 'function' && !mqReducedMotion.matches;

function openWatch(work) {
  const source = pendingSource;
  pendingSource = null;
  if (watch.isOpen && watch.current === work) return;
  const morph = !watch.isOpen && source && canTransition();

  const apply = () => {
    watch.open(work, { autoplay: true, animate: !morph });
    root.classList.add('is-watching');
    page.inert = true;
    document.title = `${work.title} — ${config.pageTitle}`;
  };

  if (!morph) return apply();
  // クリックしたカードが、そのままプレイヤーへ広がる
  source.style.viewTransitionName = 'work-media';
  const vt = document.startViewTransition(() => {
    source.style.viewTransitionName = '';
    apply();
    watch.playerEl.style.viewTransitionName = 'work-media';
  });
  // 切り替えが途中で打ち切られても（画面サイズの変更など）、表示そのものは完了している
  vt.ready.catch(() => {});
  vt.finished.catch(() => {}).finally(() => {
    watch.playerEl.style.viewTransitionName = '';
  });
}

function closeWatch() {
  if (!watch.isOpen) return;
  const work = watch.current;
  const item = gallery.itemFor(work.id);
  pushedHistory = false;

  const apply = () => {
    watch.close();
    root.classList.remove('is-watching');
    page.inert = false;
    document.title = config.pageTitle;
    gallery.refreshProgress();
    if (item) {
      // 見ていた作品が画面の中央に来るように戻す
      const y = item.center - window.innerHeight / 2;
      if (Math.abs(window.scrollY - y) > window.innerHeight * 0.35) window.scrollTo(0, Math.max(0, y));
      item.card.focus({ preventScroll: true });
    }
    state.scrollY = window.scrollY;
    tick(16);
  };

  if (!item || !canTransition()) return apply();
  watch.playerEl.style.viewTransitionName = 'work-media';
  const vt = document.startViewTransition(() => {
    watch.playerEl.style.viewTransitionName = '';
    apply();
    item.media.style.viewTransitionName = 'work-media';
  });
  vt.ready.catch(() => {});
  vt.finished.catch(() => {}).finally(() => {
    item.media.style.viewTransitionName = '';
  });
}

// ───────── 起動 ─────────

async function boot() {
  setupText();

  bg = new ScrollBackground($('#bg'), {
    framesUrl: config.framesUrl,
    onLoadProgress: (ratio) => {
      loadBar.style.setProperty('--load', ratio.toFixed(3));
      loadBar.classList.toggle('is-active', ratio < 1);
    },
  });

  const timeout = (ms) => new Promise((r) => setTimeout(r, ms));
  const [manifest] = await Promise.all([
    fetchJson(config.manifestUrl),
    bg.init().catch(() => {}),
    Promise.race([document.fonts?.ready ?? Promise.resolve(), timeout(1800)]),
  ]);

  works = normalize(manifest.data);
  byId = new Map(works.map((w) => [w.id, w]));
  const n = works.length;

  if (n > 0) {
    gallery = new Gallery(listEl, works, { onOpen: requestOpen });
    $('.works-head').hidden = false;
    $('.works-total').textContent = `${pad2(n)} 作品`;
    $('.hero-sub').textContent = `${n} 作品　・　スクロールして進む`;
    const count = $('.header-count');
    count.replaceChildren(Object.assign(document.createElement('b'), { textContent: pad2(n) }), ' WORKS');
    count.hidden = false;
    outro.hidden = false;
    buildRail();
  } else {
    showMessage(manifest.ok && Array.isArray(manifest.data) ? 'empty' : 'error');
  }

  watch = new WatchView(works, {
    onRequestClose: requestClose,
    onNavigate: navigate,
    onProgress: () => {},
  });

  // 入力
  window.addEventListener('scroll', () => { state.scrollY = window.scrollY; }, { passive: true });
  window.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    state.mouseX = (e.clientX / window.innerWidth - 0.5) * 2;
    state.mouseY = (e.clientY / window.innerHeight - 0.5) * 2;
  }, { passive: true });
  window.addEventListener('hashchange', route);

  let resizeQueued = false;
  const onResize = () => {
    if (resizeQueued) return;
    resizeQueued = true;
    requestAnimationFrame(() => {
      resizeQueued = false;
      bg.resize();
      measure();
    });
  };
  window.addEventListener('resize', onResize);
  new ResizeObserver(onResize).observe($('main'));

  $('.brand').addEventListener('click', (e) => {
    e.preventDefault();
    scrollToY(0);
  });
  $('.to-top').addEventListener('click', () => scrollToY(0));
  $('.scroll-cue').addEventListener('click', () => {
    if (gallery?.items.length) scrollToWork(0);
    else scrollToY(worksSection.getBoundingClientRect().top + window.scrollY - 80);
  });

  measure();
  bg.jump(state.scrollY, state.maxScroll);
  tick(16);
  requestAnimationFrame(frame);

  root.classList.add('is-ready');
  route(); // URLが作品を指していれば、そのまま視聴画面を開く
}

boot().catch((err) => {
  console.error(err);
  root.classList.add('is-ready');
  if (!document.querySelector('.works-message')) showMessage('error');
});
