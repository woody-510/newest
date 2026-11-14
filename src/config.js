// サイト全体の設定。名前や文言はここを書き換える。
export const config = {
  /** サイト名（最初の画面とヘッダーに大きく表示） */
  siteName: '回廊シネマ',
  /** サイト名に添える小さな一行（空にすると出さない） */
  tagline: 'Archive',
  /** 小さな一行を、サイト名の下に置く（false なら上） */
  taglineBelow: true,
  /** ブラウザのタブに出る名前 */
  pageTitle: '回廊シネマ',

  /** 作品一覧（npm run manifest で作られる） */
  manifestUrl: '/media/works.json',
  /** Blender背景の連番（npm run bg で作られる。無ければ、プログラムで描く仮の背景になる） */
  framesUrl: '/bg/frames.json',

  /** ログアウトのリンク（Cloudflare Access）。ログイン制限なしで公開するので、出さない */
  showLogout: false,
  logoutUrl: '/cdn-cgi/access/logout',
};
