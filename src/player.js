// 独自デザインの動画プレイヤー。
// HLS（画質の自動切り替え）と通常の動画ファイルの両方を再生できる。

import { clamp, el, formatTime } from './util.js';
import { icons } from './icons.js';
import { store } from './storage.js';

const SPEEDS = [0.75, 1, 1.25, 1.5, 2];
const IDLE_MS = 2500;
const HLS_MIME = 'application/vnd.apple.mpegurl';

const speedLabel = (r) => `${r}×`;

const TEMPLATE = `
<div class="player is-paused" tabindex="-1">
  <video class="player-video" playsinline preload="metadata"></video>
  <div class="player-poster"></div>
  <button class="player-surface" type="button" tabindex="-1" aria-label="再生・一時停止"></button>
  <div class="player-spinner" aria-hidden="true"></div>
  <div class="player-toast" role="status" aria-live="polite"></div>
  <button class="player-center" type="button" aria-label="再生">
    <span class="i-play">${icons.play}</span><span class="i-pause">${icons.pause}</span>
  </button>

  <div class="player-prompt player-resume" hidden>
    <p class="prompt-label">前回の続きがあります</p>
    <div class="prompt-actions">
      <button class="btn btn-primary" type="button" data-act="resume">${icons.play}<span></span></button>
      <button class="btn" type="button" data-act="restart">${icons.replay}<span>最初から</span></button>
    </div>
  </div>

  <div class="player-prompt player-end" hidden>
    <p class="prompt-label"></p>
    <p class="prompt-title"></p>
    <div class="prompt-actions">
      <button class="btn btn-primary" type="button" data-act="next">${icons.play}<span>次の作品を見る</span></button>
      <button class="btn" type="button" data-act="again">${icons.replay}<span>もう一度見る</span></button>
      <button class="btn" type="button" data-act="back">${icons.arrowLeft}<span>一覧に戻る</span></button>
    </div>
  </div>

  <div class="player-prompt player-error" hidden>
    <span class="prompt-icon">${icons.alert}</span>
    <p class="prompt-title">再生できませんでした</p>
    <p class="prompt-label">通信の状態を確認して、もう一度お試しください</p>
    <div class="prompt-actions">
      <button class="btn btn-primary" type="button" data-act="retry">${icons.replay}<span>もう一度試す</span></button>
    </div>
  </div>

  <div class="player-controls">
    <div class="seek" role="slider" tabindex="0" aria-label="再生位置" aria-valuemin="0" aria-valuemax="0" aria-valuenow="0">
      <div class="seek-track"><i class="seek-buffer"></i><i class="seek-played"></i></div>
      <span class="seek-thumb"></span>
      <span class="seek-tip">0:00</span>
    </div>
    <div class="controls-row">
      <button class="ctl ctl-play ctl-edge-l" type="button" data-tip="再生 (Space)" aria-label="再生">
        <span class="i-play">${icons.play}</span><span class="i-pause">${icons.pause}</span>
      </button>
      <button class="ctl ctl-back" type="button" data-tip="10秒戻る (J)" aria-label="10秒戻る">${icons.back10}</button>
      <button class="ctl ctl-fwd" type="button" data-tip="10秒進む (L)" aria-label="10秒進む">${icons.fwd10}</button>
      <div class="volume">
        <button class="ctl ctl-mute" type="button" data-tip="ミュート (M)" aria-label="ミュート"></button>
        <input class="volume-slider" type="range" min="0" max="1" step="0.01" aria-label="音量">
      </div>
      <span class="time"><b class="time-now">0:00</b><i>/</i><span class="time-total">0:00</span></span>
      <span class="controls-spacer"></span>
      <div class="menu-wrap">
        <button class="ctl ctl-text ctl-speed" type="button" data-tip="再生速度" aria-label="再生速度" aria-haspopup="menu" aria-expanded="false">1×</button>
        <div class="menu menu-speed" role="menu" hidden></div>
      </div>
      <div class="menu-wrap quality-wrap" hidden>
        <button class="ctl ctl-text ctl-quality" type="button" data-tip="画質" aria-label="画質" aria-haspopup="menu" aria-expanded="false">自動</button>
        <div class="menu menu-quality" role="menu" hidden></div>
      </div>
      <button class="ctl ctl-pip" type="button" data-tip="小窓で再生 (P)" aria-label="小窓で再生" hidden>${icons.pip}</button>
      <button class="ctl ctl-fs ctl-edge-r" type="button" data-tip="全画面 (F)" aria-label="全画面">
        <span class="i-enter">${icons.fullscreen}</span><span class="i-exit">${icons.exitFullscreen}</span>
      </button>
    </div>
  </div>
</div>`;

export class Player {
  /**
   * @param {{onBack: () => void, onNext: (work: object) => void, onProgress: (id: string) => void}} handlers
   */
  constructor({ onBack, onNext, onProgress }) {
    this.onBack = onBack;
    this.onNext = onNext;
    this.onProgress = onProgress;

    this.root = el(TEMPLATE);
    const $ = (s) => this.root.querySelector(s);
    this.video = $('.player-video');
    this.poster = $('.player-poster');
    this.surface = $('.player-surface');
    this.toastEl = $('.player-toast');
    this.centerBtn = $('.player-center');
    this.resumeEl = $('.player-resume');
    this.endEl = $('.player-end');
    this.errorEl = $('.player-error');
    this.seek = $('.seek');
    this.seekTip = $('.seek-tip');
    this.playBtn = $('.ctl-play');
    this.muteBtn = $('.ctl-mute');
    this.volumeSlider = $('.volume-slider');
    this.timeNow = $('.time-now');
    this.timeTotal = $('.time-total');
    this.speedBtn = $('.ctl-speed');
    this.speedMenu = $('.menu-speed');
    this.qualityWrap = $('.quality-wrap');
    this.qualityBtn = $('.ctl-quality');
    this.qualityMenu = $('.menu-quality');
    this.pipBtn = $('.ctl-pip');
    this.fsBtn = $('.ctl-fs');

    this.work = null;
    this.next = null;
    this.hls = null;
    this.token = 0;
    this.started = false;
    this.pendingStart = null;
    this.scrubbing = false;
    this.scrubRatio = 0;
    this.lastSave = 0;
    this.idleTimer = 0;
    this.toastTimer = 0;
    this.rate = 1;
    this.recovered = { network: 0, media: 0 };

    this.video.volume = clamp(Number(store.getPref('volume', 1)) || 0, 0, 1);
    this.video.muted = !!store.getPref('muted', false);

    this.bind();
    this.buildSpeedMenu();
    this.syncVolume();
  }

  // ───────── 読み込み ─────────

  /**
   * @param {object} work 作品
   * @param {{autoplay?: boolean, next?: object|null}} opts
   */
  async load(work, { autoplay = true, next = null } = {}) {
    this.unload();
    const token = ++this.token;
    this.work = work;
    this.next = next;

    const { video, root } = this;
    this.poster.style.backgroundImage = work.thumb ? `url("${work.thumb}")` : '';
    this.timeTotal.textContent = formatTime(work.duration || 0);
    this.setMediaSession();

    // 前回の続きがあれば、どこから見るかを先に選んでもらう
    const saved = store.getProgress(work.id);
    const canResume = saved && !saved.done && saved.t > 15;
    if (canResume) {
      this.resumeEl.querySelector('[data-act="resume"] span').textContent = `${formatTime(saved.t)} から再開`;
      this.showPrompt(this.resumeEl);
      this.resumeAt = Math.max(0, saved.t - 3); // 少しだけ手前から
    }
    this.wantPlay = autoplay && !canResume;

    if (work.type === 'hls' || /\.m3u8(\?|$)/.test(work.src)) {
      const native = video.canPlayType(HLS_MIME);
      const isApple = /Apple/.test(navigator.vendor || '');
      if (native && isApple) {
        video.src = work.src; // Safari は標準機能で再生（省電力・AirPlay対応）
      } else {
        root.classList.add('is-waiting');
        let Hls;
        try {
          ({ default: Hls } = await import('hls.js/light'));
        } catch {
          if (token === this.token) this.showError();
          return;
        }
        if (token !== this.token) return;
        if (Hls.isSupported()) this.attachHls(Hls, work.src);
        else if (native) video.src = work.src;
        else return this.showError();
      }
    } else {
      video.src = work.src;
    }

    video.playbackRate = this.rate;
    if (this.wantPlay) this.play();
  }

  attachHls(Hls, src) {
    const hls = new Hls({
      capLevelToPlayerSize: true, // プレイヤーの大きさを超える画質は読まない
      abrEwmaDefaultEstimate: 4_000_000, // 回線の速さが分かるまでは中くらいの画質から始める
      maxBufferLength: 30,
      backBufferLength: 60,
    });
    this.hls = hls;
    this.recovered = { network: 0, media: 0 };

    hls.on(Hls.Events.MANIFEST_PARSED, () => this.buildQualityMenu());
    hls.on(Hls.Events.LEVEL_SWITCHED, () => this.syncQuality());
    hls.on(Hls.Events.ERROR, (_e, data) => {
      if (!data.fatal) return;
      // 一時的な失敗は、種類ごとに2回まで自動でやり直す
      if (data.type === Hls.ErrorTypes.NETWORK_ERROR && this.recovered.network++ < 2) hls.startLoad();
      else if (data.type === Hls.ErrorTypes.MEDIA_ERROR && this.recovered.media++ < 2) hls.recoverMediaError();
      else this.showError();
    });
    hls.loadSource(src);
    hls.attachMedia(this.video);
  }

  /** 再生を止めて、次の作品を読める状態に戻す */
  unload() {
    this.token++;
    this.saveProgress(true);
    const { video, root } = this;
    video.pause();
    if (document.pictureInPictureElement === video) document.exitPictureInPicture().catch(() => {});
    if (this.hls) {
      this.hls.destroy();
      this.hls = null;
    }
    if (video.hasAttribute('src')) {
      video.removeAttribute('src');
      video.load();
    }
    this.work = null;
    this.next = null;
    this.started = false;
    this.pendingStart = null;
    this.resumeAt = null;
    this.wantPlay = false;
    this.scrubbing = false;
    clearTimeout(this.idleTimer);
    this.closeMenus();
    this.hidePrompts();
    root.classList.remove('has-started', 'is-playing', 'is-waiting', 'is-idle', 'is-seeking');
    root.classList.add('is-paused');
    root.style.setProperty('--played', 0);
    root.style.setProperty('--buffered', 0);
    this.timeNow.textContent = '0:00';
    this.qualityWrap.hidden = true;
    this.qualityMenu.replaceChildren();
    if ('mediaSession' in navigator) navigator.mediaSession.metadata = null;
  }

  // ───────── 基本操作 ─────────

  get duration() {
    const d = this.video.duration;
    return Number.isFinite(d) && d > 0 ? d : this.work?.duration || 0;
  }

  play() {
    const p = this.video.play();
    if (p) {
      p.catch((err) => {
        // 自動再生がブラウザに止められた場合は、再生ボタンを押してもらう
        if (err?.name === 'NotAllowedError') this.root.classList.remove('is-waiting');
      });
    }
  }

  toggle() {
    if (this.root.classList.contains('has-prompt')) return;
    if (this.video.paused || this.video.ended) this.play();
    else this.video.pause();
  }

  seekTo(time) {
    const d = this.duration;
    if (!d) return;
    const t = clamp(time, 0, Math.max(0, d - 0.25));
    if (this.video.readyState === 0) this.pendingStart = t;
    else this.video.currentTime = t;
    this.hidePrompt(this.endEl);
    this.updateTime(t);
  }

  seekBy(delta) {
    if (!this.duration) return;
    this.seekTo(this.video.currentTime + delta);
    this.toast(`${delta > 0 ? '+' : '−'}${Math.abs(delta)}秒`);
  }

  setVolume(v) {
    this.video.volume = clamp(v, 0, 1);
    this.video.muted = this.video.volume === 0;
  }

  toggleMute() {
    if (!this.video.muted && this.video.volume === 0) this.video.volume = 0.5;
    else this.video.muted = !this.video.muted;
    this.toast(this.video.muted ? 'ミュート' : `音量 ${Math.round(this.video.volume * 100)}%`);
  }

  setRate(rate) {
    this.rate = rate;
    this.video.playbackRate = rate;
  }

  stepRate(dir) {
    const i = clamp(SPEEDS.indexOf(this.rate) + dir, 0, SPEEDS.length - 1);
    this.setRate(SPEEDS[i]);
    this.toast(`速度 ${speedLabel(SPEEDS[i])}`);
  }

  toggleFullscreen() {
    const { root, video } = this;
    const fsEl = document.fullscreenElement || document.webkitFullscreenElement;
    if (fsEl) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (root.requestFullscreen) {
      root.requestFullscreen().then(() => screen.orientation?.lock?.('landscape').catch(() => {})).catch(() => {});
    } else if (root.webkitRequestFullscreen) {
      root.webkitRequestFullscreen();
    } else if (video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen(); // iPhone は動画だけを全画面にする
    }
  }

  togglePip() {
    if (!document.pictureInPictureEnabled) return;
    if (document.pictureInPictureElement) document.exitPictureInPicture().catch(() => {});
    else this.video.requestPictureInPicture().catch(() => {});
  }

  // ───────── 表示の更新 ─────────

  updateTime(t = this.video.currentTime) {
    const d = this.duration;
    const ratio = this.scrubbing ? this.scrubRatio : d ? clamp(t / d, 0, 1) : 0;
    const shown = this.scrubbing ? this.scrubRatio * d : t;
    this.root.style.setProperty('--played', ratio.toFixed(5));
    this.timeNow.textContent = formatTime(shown);
    this.seek.setAttribute('aria-valuenow', String(Math.floor(shown)));
    this.seek.setAttribute('aria-valuetext', `${formatTime(shown)} / ${formatTime(d)}`);
  }

  updateBuffered() {
    const { video } = this;
    const d = this.duration;
    let end = 0;
    for (let i = 0; i < video.buffered.length; i++) {
      if (video.buffered.start(i) <= video.currentTime + 0.5 && video.buffered.end(i) > end) end = video.buffered.end(i);
    }
    this.root.style.setProperty('--buffered', d ? clamp(end / d, 0, 1).toFixed(4) : 0);
  }

  syncVolume() {
    const { video } = this;
    const v = video.muted ? 0 : video.volume;
    this.volumeSlider.value = String(v);
    this.volumeSlider.style.setProperty('--v', v);
    this.muteBtn.innerHTML = v === 0 ? icons.mute : v < 0.5 ? icons.volumeLow : icons.volume;
    const label = v === 0 ? 'ミュート解除' : 'ミュート';
    this.muteBtn.setAttribute('aria-label', label);
    this.muteBtn.dataset.tip = `${label} (M)`;
  }

  syncPlayState() {
    const playing = !this.video.paused && !this.video.ended;
    this.root.classList.toggle('is-playing', playing);
    this.root.classList.toggle('is-paused', !playing);
    const label = playing ? '一時停止' : '再生';
    this.playBtn.setAttribute('aria-label', label);
    this.playBtn.dataset.tip = `${label} (Space)`;
    this.centerBtn.setAttribute('aria-label', label);
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = playing ? 'playing' : 'paused';
    this.wake();
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('is-shown');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('is-shown'), 900);
  }

  /** 操作バーを表示し、しばらく操作が無ければ隠す */
  wake() {
    this.root.classList.remove('is-idle');
    clearTimeout(this.idleTimer);
    this.idleTimer = setTimeout(() => this.sleep(), IDLE_MS);
  }

  sleep() {
    clearTimeout(this.idleTimer);
    const busy = this.video.paused || this.scrubbing || this.menuOpen() || this.root.classList.contains('has-prompt');
    if (!busy) this.root.classList.add('is-idle');
  }

  // ───────── 案内（続きから・終了・エラー） ─────────

  showPrompt(elm) {
    this.hidePrompts();
    elm.hidden = false;
    this.root.classList.add('has-prompt');
    this.root.classList.remove('is-waiting', 'is-idle');
    requestAnimationFrame(() => elm.querySelector('button:not([hidden])')?.focus({ preventScroll: true }));
  }

  hidePrompt(elm) {
    if (elm.hidden) return;
    elm.hidden = true;
    this.root.classList.remove('has-prompt');
  }

  hidePrompts() {
    for (const p of [this.resumeEl, this.endEl, this.errorEl]) p.hidden = true;
    this.root.classList.remove('has-prompt');
  }

  showError() {
    this.errorAt = this.video.currentTime || 0;
    this.showPrompt(this.errorEl);
  }

  showEnd() {
    const label = this.endEl.querySelector('.prompt-label');
    const title = this.endEl.querySelector('.prompt-title');
    const nextBtn = this.endEl.querySelector('[data-act="next"]');
    if (this.next) {
      label.textContent = '次の作品';
      title.textContent = this.next.title;
      title.hidden = false;
      nextBtn.hidden = false;
    } else {
      label.textContent = 'ご覧いただきありがとうございました';
      title.hidden = true;
      nextBtn.hidden = true;
    }
    this.showPrompt(this.endEl);
  }

  // ───────── メニュー（速度・画質） ─────────

  menuItem(label, checked, onPick) {
    const b = el(`<button class="menu-item" type="button" role="menuitemradio"><span></span>${icons.check}</button>`);
    b.querySelector('span').textContent = label;
    b.setAttribute('aria-checked', String(checked));
    b.addEventListener('click', () => {
      onPick();
      this.closeMenus(true);
    });
    return b;
  }

  buildSpeedMenu() {
    const title = el('<p class="menu-title">再生速度</p>');
    this.speedMenu.replaceChildren(
      title,
      ...SPEEDS.map((r) => this.menuItem(r === 1 ? '1×（標準）' : speedLabel(r), r === this.rate, () => this.setRate(r))),
    );
    this.speedBtn.textContent = speedLabel(this.rate);
    this.speedBtn.classList.toggle('is-on', this.rate !== 1);
  }

  buildQualityMenu() {
    const hls = this.hls;
    if (!hls || hls.levels.length < 2) {
      this.qualityWrap.hidden = true;
      return;
    }
    const levels = hls.levels
      .map((l, index) => ({ index, height: l.height || 0, bitrate: l.bitrate || 0 }))
      .sort((a, b) => b.height - a.height || b.bitrate - a.bitrate);
    const auto = hls.autoLevelEnabled;
    const title = el('<p class="menu-title">画質</p>');
    this.qualityMenu.replaceChildren(
      title,
      this.menuItem('自動', auto, () => {
        hls.currentLevel = -1;
        this.syncQuality();
      }),
      ...levels.map((l) =>
        this.menuItem(l.height ? `${l.height}p` : `${Math.round(l.bitrate / 1000)}kbps`, !auto && hls.currentLevel === l.index, () => {
          hls.currentLevel = l.index;
          this.syncQuality();
        }),
      ),
    );
    this.qualityWrap.hidden = false;
    this.syncQuality(false);
  }

  syncQuality(rebuild = true) {
    const hls = this.hls;
    if (!hls) return;
    const cur = hls.levels[hls.currentLevel];
    const h = cur?.height ? `${cur.height}p` : '';
    this.qualityBtn.textContent = hls.autoLevelEnabled ? (h ? `自動 ${h}` : '自動') : h || '画質';
    if (rebuild && !this.qualityMenu.hidden) return; // 開いている間は作り直さない
    if (rebuild) this.buildQualityMenu();
  }

  menuOpen() {
    return !this.speedMenu.hidden || !this.qualityMenu.hidden;
  }

  toggleMenu(btn, menu) {
    const open = menu.hidden;
    this.closeMenus();
    if (!open) return;
    if (menu === this.speedMenu) this.buildSpeedMenu();
    else this.buildQualityMenu();
    menu.hidden = false;
    btn.setAttribute('aria-expanded', 'true');
    (menu.querySelector('[aria-checked="true"]') || menu.querySelector('.menu-item'))?.focus({ preventScroll: true });
    this.wake();
  }

  /** @returns {boolean} 閉じたメニューがあったか */
  closeMenus(refocus = false) {
    let closed = false;
    for (const [btn, menu] of [[this.speedBtn, this.speedMenu], [this.qualityBtn, this.qualityMenu]]) {
      if (!menu.hidden) {
        closed = true;
        const hadFocus = menu.contains(document.activeElement);
        menu.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        if (refocus || hadFocus) btn.focus({ preventScroll: true });
      }
    }
    if (closed) {
      this.buildSpeedMenu();
      this.wake();
    }
    return closed;
  }

  // ───────── 視聴位置の保存 ─────────

  saveProgress(force = false) {
    if (!this.work || !this.started) return;
    const now = Date.now();
    if (!force && now - this.lastSave < 5000) return;
    this.lastSave = now;
    const d = this.duration;
    if (!d) return;
    store.setProgress(this.work.id, this.video.ended ? d : this.video.currentTime, d);
    this.onProgress(this.work.id);
  }

  setMediaSession() {
    if (!('mediaSession' in navigator) || !window.MediaMetadata) return;
    const { work } = this;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: work.title,
      artwork: work.thumb ? [{ src: new URL(work.thumb, location.href).href }] : [],
    });
    const set = (action, fn) => {
      try {
        navigator.mediaSession.setActionHandler(action, fn);
      } catch {
        /* 対応していない操作は無視 */
      }
    };
    set('play', () => this.play());
    set('pause', () => this.video.pause());
    set('seekbackward', () => this.seekBy(-10));
    set('seekforward', () => this.seekBy(10));
    set('nexttrack', this.next ? () => this.onNext(this.next) : null);
  }

  // ───────── イベント ─────────

  bind() {
    const { video, root, seek } = this;

    // 動画の状態
    video.addEventListener('loadedmetadata', () => {
      this.timeTotal.textContent = formatTime(this.duration);
      seek.setAttribute('aria-valuemax', String(Math.floor(this.duration)));
      if (this.pendingStart != null) {
        video.currentTime = Math.min(this.pendingStart, Math.max(0, this.duration - 1));
        this.pendingStart = null;
      }
      this.updateTime();
    });
    video.addEventListener('durationchange', () => {
      this.timeTotal.textContent = formatTime(this.duration);
    });
    video.addEventListener('timeupdate', () => {
      if (!this.scrubbing) this.updateTime();
      this.updateBuffered();
      if (!video.paused) this.saveProgress();
    });
    video.addEventListener('progress', () => this.updateBuffered());
    video.addEventListener('play', () => {
      this.hidePrompt(this.endEl);
      this.syncPlayState();
    });
    video.addEventListener('pause', () => {
      this.syncPlayState();
      this.saveProgress(true);
    });
    video.addEventListener('playing', () => {
      this.started = true;
      root.classList.add('has-started');
      root.classList.remove('is-waiting');
    });
    video.addEventListener('waiting', () => {
      if (!root.classList.contains('has-prompt')) root.classList.add('is-waiting');
    });
    for (const type of ['canplay', 'seeked', 'loadeddata']) {
      video.addEventListener(type, () => root.classList.remove('is-waiting'));
    }
    video.addEventListener('ended', () => {
      this.syncPlayState();
      this.saveProgress(true);
      if (document.fullscreenElement === root && !this.next) document.exitFullscreen().catch(() => {});
      this.showEnd();
    });
    video.addEventListener('volumechange', () => {
      this.syncVolume();
      store.setPref('volume', video.volume);
      store.setPref('muted', video.muted);
    });
    video.addEventListener('ratechange', () => {
      // ブラウザが速度を戻すことがあるので、こちらの設定に合わせ直す
      if (video.playbackRate !== this.rate && this.work) video.playbackRate = this.rate;
      this.buildSpeedMenu();
    });
    video.addEventListener('error', () => {
      if (!this.hls && this.work && video.error) this.showError();
    });
    video.addEventListener('enterpictureinpicture', () => this.pipBtn.classList.add('is-on'));
    video.addEventListener('leavepictureinpicture', () => this.pipBtn.classList.remove('is-on'));

    // 画面のクリック・タップ
    this.surface.addEventListener('click', (e) => {
      if (this.closeMenus()) return;
      if (this.lastPointer === 'touch') {
        // タッチ：1回目は操作バーを出す、出ているときは隠す（再生・停止は中央のボタンで）
        if (root.classList.contains('is-idle') || video.paused) this.wake();
        else this.sleep();
        return;
      }
      if (e.detail > 1) return; // ダブルクリックは全画面に使う
      this.toggle();
    });
    this.surface.addEventListener('dblclick', () => {
      if (this.lastPointer !== 'touch') this.toggleFullscreen();
    });
    this.centerBtn.addEventListener('click', () => this.toggle());

    root.addEventListener('pointerdown', (e) => {
      this.lastPointer = e.pointerType;
      root.classList.toggle('is-touch', e.pointerType === 'touch');
    }, true);
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'touch') this.wake();
    });
    root.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse' && !video.paused) {
        clearTimeout(this.idleTimer);
        this.idleTimer = setTimeout(() => this.sleep(), 600);
      }
    });
    root.addEventListener('focusin', () => this.wake());

    // 操作バーのボタン
    this.playBtn.addEventListener('click', () => this.toggle());
    root.querySelector('.ctl-back').addEventListener('click', () => this.seekBy(-10));
    root.querySelector('.ctl-fwd').addEventListener('click', () => this.seekBy(10));
    this.muteBtn.addEventListener('click', () => this.toggleMute());
    this.volumeSlider.addEventListener('input', () => this.setVolume(Number(this.volumeSlider.value)));
    this.speedBtn.addEventListener('click', () => this.toggleMenu(this.speedBtn, this.speedMenu));
    this.qualityBtn.addEventListener('click', () => this.toggleMenu(this.qualityBtn, this.qualityMenu));
    this.fsBtn.addEventListener('click', () => this.toggleFullscreen());
    this.pipBtn.addEventListener('click', () => this.togglePip());
    this.pipBtn.hidden = !(document.pictureInPictureEnabled && typeof video.requestPictureInPicture === 'function');

    // メニューの外を押したら閉じる
    document.addEventListener('pointerdown', (e) => {
      if (this.menuOpen() && !e.target.closest('.menu-wrap')) this.closeMenus();
    });

    // 案内のボタン
    root.addEventListener('click', (e) => {
      const act = e.target.closest('[data-act]')?.dataset.act;
      if (!act) return;
      if (act === 'resume' || act === 'restart') {
        const at = act === 'resume' ? this.resumeAt : 0;
        if (act === 'restart') store.clearProgress(this.work.id);
        this.hidePrompt(this.resumeEl);
        if (at) this.seekTo(at);
        this.play();
        root.focus({ preventScroll: true });
      } else if (act === 'again') {
        this.hidePrompt(this.endEl);
        this.seekTo(0);
        this.play();
        root.focus({ preventScroll: true });
      } else if (act === 'next') {
        if (this.next) this.onNext(this.next);
      } else if (act === 'back') {
        this.onBack();
      } else if (act === 'retry') {
        const work = this.work;
        const next = this.next;
        const at = this.errorAt;
        this.load(work, { autoplay: true, next }).then(() => {
          if (at > 5) this.seekTo(at);
        });
      }
    });

    // シークバー
    const ratioAt = (e) => {
      const r = seek.getBoundingClientRect();
      return clamp((e.clientX - r.left) / r.width, 0, 1);
    };
    const showTip = (ratio) => {
      seek.style.setProperty('--tip', ratio.toFixed(4));
      this.seekTip.textContent = formatTime(ratio * this.duration);
    };
    seek.addEventListener('pointerdown', (e) => {
      if (!this.duration || (e.pointerType === 'mouse' && e.button !== 0)) return;
      seek.setPointerCapture(e.pointerId);
      this.scrubbing = true;
      this.scrubRatio = ratioAt(e);
      root.classList.add('is-seeking');
      showTip(this.scrubRatio);
      this.updateTime();
      this.wake();
    });
    seek.addEventListener('pointermove', (e) => {
      const ratio = ratioAt(e);
      showTip(ratio);
      if (e.pointerType === 'mouse') seek.classList.add('is-hover');
      if (this.scrubbing) {
        this.scrubRatio = ratio;
        this.updateTime();
        this.wake();
      }
    });
    const endScrub = (e, commit) => {
      if (!this.scrubbing) return;
      this.scrubbing = false;
      root.classList.remove('is-seeking');
      if (seek.hasPointerCapture(e.pointerId)) seek.releasePointerCapture(e.pointerId);
      if (commit) this.seekTo(this.scrubRatio * this.duration);
      else this.updateTime();
    };
    seek.addEventListener('pointerup', (e) => endScrub(e, true));
    seek.addEventListener('pointercancel', (e) => endScrub(e, false));
    seek.addEventListener('pointerleave', () => seek.classList.remove('is-hover'));

    // 全画面の切り替わり
    const onFs = () => {
      const fs = (document.fullscreenElement || document.webkitFullscreenElement) === root;
      root.classList.toggle('is-fullscreen', fs);
      const label = fs ? '全画面を終了' : '全画面';
      this.fsBtn.setAttribute('aria-label', label);
      this.fsBtn.dataset.tip = `${label} (F)`;
      if (!fs) screen.orientation?.unlock?.();
    };
    document.addEventListener('fullscreenchange', onFs);
    document.addEventListener('webkitfullscreenchange', onFs);

    // ページを離れる・隠れるときに視聴位置を保存
    window.addEventListener('pagehide', () => this.saveProgress(true));
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.saveProgress(true);
    });
  }

  /**
   * キーボード操作。処理したら true を返す。
   * @param {KeyboardEvent} e
   */
  handleKey(e) {
    if (!this.work || e.metaKey || e.ctrlKey || e.altKey) return false;
    const target = e.target;
    const tag = target?.tagName;
    const onControl = tag === 'BUTTON' || tag === 'A';
    const inSlider = tag === 'INPUT';
    const inMenu = !!target?.closest?.('.menu');

    // メニューの中では、上下キーで項目を移動する
    if (inMenu && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      const items = [...target.closest('.menu').querySelectorAll('.menu-item')];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length]?.focus();
      return true;
    }
    if (e.key === 'Escape') return this.closeMenus(true);

    // 「続きから」などの案内が出ている間は、ほかの操作を受け付けない
    if (this.root.classList.contains('has-prompt')) return false;

    switch (e.key) {
      case ' ':
      case 'Enter':
        if (onControl || inSlider) return false; // ボタン自身の動作に任せる
        if (e.key === 'Enter') return false;
        this.toggle();
        break;
      case 'k':
      case 'K':
        this.toggle();
        break;
      case 'ArrowLeft':
        if (inSlider) return false;
        this.seekBy(-5);
        break;
      case 'ArrowRight':
        if (inSlider) return false;
        this.seekBy(5);
        break;
      case 'j':
      case 'J':
        this.seekBy(-10);
        break;
      case 'l':
      case 'L':
        this.seekBy(10);
        break;
      case 'ArrowUp':
        this.setVolume((this.video.muted ? 0 : this.video.volume) + 0.1);
        this.toast(`音量 ${Math.round(this.video.volume * 100)}%`);
        break;
      case 'ArrowDown':
        this.setVolume((this.video.muted ? 0 : this.video.volume) - 0.1);
        this.toast(this.video.volume === 0 ? 'ミュート' : `音量 ${Math.round(this.video.volume * 100)}%`);
        break;
      case 'm':
      case 'M':
        this.toggleMute();
        break;
      case 'f':
      case 'F':
        this.toggleFullscreen();
        break;
      case 'p':
      case 'P':
        this.togglePip();
        break;
      case '<':
      case ',':
        this.stepRate(-1);
        break;
      case '>':
      case '.':
        this.stepRate(1);
        break;
      case 'Home':
        this.seekTo(0);
        break;
      default:
        // 数字キー：0〜9 で全体の 0%〜90% の位置へ
        if (/^[0-9]$/.test(e.key) && !inSlider && this.duration) {
          this.seekTo((Number(e.key) / 10) * this.duration);
          this.toast(`${Number(e.key) * 10}%`);
          break;
        }
        return false;
    }
    this.wake();
    return true;
  }
}
