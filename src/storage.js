// 視聴位置・音量などを、見ている人のブラウザに保存する（サーバーには送らない）。
const KEY = 'film-archive:v1';

function read() {
  try {
    return JSON.parse(localStorage.getItem(KEY)) || {};
  } catch {
    return {};
  }
}
function write(data) {
  try {
    localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* 保存できない環境（プライベートブラウズなど）では何もしない */
  }
}

let state = read();
state.progress ||= {};
state.prefs ||= {};

export const store = {
  /** @returns {{t:number, d:number, done?:boolean, at:number}|null} */
  getProgress(id) {
    return state.progress[id] || null;
  },
  setProgress(id, t, d) {
    if (!Number.isFinite(t) || !Number.isFinite(d) || d <= 0) return;
    // 終わりの近くまで見たら「見終わった」扱いにして、次は最初から
    const done = t >= d - Math.min(20, d * 0.05);
    state.progress[id] = { t: done ? 0 : Math.floor(t), d: Math.floor(d), done: done || undefined, at: Date.now() };
    write(state);
  },
  clearProgress(id) {
    delete state.progress[id];
    write(state);
  },
  getPref(key, fallback) {
    return key in state.prefs ? state.prefs[key] : fallback;
  },
  setPref(key, value) {
    state.prefs[key] = value;
    write(state);
  },
};
