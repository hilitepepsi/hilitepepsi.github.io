// ── 各軸クリック後のページ構成データ ─────────────
// まだ「軸クリック→カメラステーション遷移」機能自体は未実装(次のステップ)。
// 先に内容だけ確定させておき、実装時にここを参照する。
//
// node の形:
//   { title: string|null, pageUrl: string|null, usesThree?: boolean }
//   title/pageUrl が null のものは内容未定(TBD)。
//
// axis   : 軸そのもの(軸の上に表示するタイトル)。X軸は無し。
// origin : 原点側の点
// end    : 軸の先端側の点

export const AXIS_CONTENT = {
  X: {
    // 終端側の点の上に持続表示するタイトルとして使用(軸中央ではなく終端に配置)。
    axis:   { title: 'The Catcher in the Rye', pageUrl: null },
    origin: { title: 'Central Park', pageUrl: null }, // クリックで表示(Yのend/Teddyと同じ形式)
    end:    { title: ' ', pageUrl: null }, // TBD
  },
  Y: {
    axis:   { title: 'Nine Stories', pageUrl: null },
    origin: { title: 'A Perfect Day for Bananafish', pageUrl: null },// Bananafishページはthree.js使用の可能性あり
    end:    { title: 'Teddy', pageUrl: null, usesThree: true }, 
  },
  Z: {
    // Yと同じ配置(軸・原点・先端の3点)。内容は未定。
    axis:   { title: 'Glass saga', pageUrl: null },
    origin: { title: 'A Perfect Day for Bananafish', pageUrl: null }, 
    end:    { title: 'Hapworth 16, 1924', pageUrl: null },
  },
};