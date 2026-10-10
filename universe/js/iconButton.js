// ── アイコンボタン共通コンポーネント ─────────────────────────────
// 枠なし・背景なしで、大きな矢印記号だけが浮かぶボタン。
// マウスホバー時は text-shadow を重ねるだけの軽量な発光(グロー)演出。
// 他の画面(オーバーレイ)からも import して使い回せるように独立ファイル化。

let stylesInjected = false;

function injectStylesOnce() {
  if (stylesInjected) return;
  stylesInjected = true;
  const style = document.createElement('style');
  style.textContent = `
.icon-btn {
  border: none;
  background: none;
  padding: 0;
  margin: 0;
  cursor: pointer;
  font-size: 2.2rem;
  line-height: 1;
  color: #eef0ff;
  opacity: 0.82;
  text-shadow: 0 0 6px rgba(180, 190, 255, 0.35);
  transition: opacity 0.2s ease, text-shadow 0.25s ease, transform 0.2s ease;
  user-select: none;
  -webkit-tap-highlight-color: transparent;
}

/* マウス発光: box-shadow ではなく text-shadow を多重に重ねるだけの軽量実装。
   本物のライティング計算は不要で、CSS transition だけで滑らかに効く。 */
.icon-btn:hover,
.icon-btn:focus-visible {
  opacity: 1;
  text-shadow:
    0 0 8px  rgba(190, 205, 255, 0.95),
    0 0 18px rgba(150, 175, 255, 0.75),
    0 0 34px rgba(110, 150, 255, 0.55);
  transform: scale(1.08);
  outline: none;
}

.icon-btn:active {
  transform: scale(0.94);
}
`;
  document.head.appendChild(style);
}

/**
 * 枠なし・記号のみのアイコンボタンを生成する汎用関数
 * @param {Object} opts
 * @param {string} opts.symbol     - 表示する記号(例: '←', '↻')
 * @param {string} [opts.className]  - 位置調整などに使う追加クラス(呼び出し側のCSSで top/left 等を指定)
 * @param {string} [opts.ariaLabel]  - スクリーンリーダー用ラベル
 * @param {() => void} [opts.onClick]
 * @returns {HTMLButtonElement}
 */
export function createIconButton({ symbol, className = '', ariaLabel = '', onClick } = {}) {
  injectStylesOnce();
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = `icon-btn ${className}`.trim();
  btn.textContent = symbol;
  if (ariaLabel) btn.setAttribute('aria-label', ariaLabel);
  if (onClick) btn.addEventListener('click', onClick);
  return btn;
}

/**
 * 戻るボタン(←)。どの画面からも同じ見た目・挙動で使い回せる。
 * 位置(絶対配置の top/left など)は className 経由で呼び出し側から指定する。
 */
export function createBackButton({ className = '', onClick, ariaLabel = '戻る' } = {}) {
  return createIconButton({ symbol: '←', className: `icon-btn--back ${className}`.trim(), ariaLabel, onClick });
}

/** リプレイボタン(↻)。 */
export function createReplayButton({ className = '', onClick, ariaLabel = 'リプレイ' } = {}) {
  return createIconButton({ symbol: '↻', className: `icon-btn--replay ${className}`.trim(), ariaLabel, onClick });
}