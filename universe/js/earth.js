import { createBackButton } from './iconButton.js';
import { createSourceBox, makeCaptionController } from './captions.js';

// ── 「Hapworth」ページ(earth_vortex.html を main.js から開けるオーバーレイ化したもの) ──
// axisStationOverlayのZ軸終端の点(Hapworth)をクリックすると main.js が show() を呼び、
// bananafish.js / nineBall.js と同じ「独立した全画面オーバーレイ」として開く。
// 左上の「←」(iconButton.jsのcreateBackButton)で閉じ、onClose が呼ばれる。
//
// earth_vortex.html からの主な変更点:
//   ・全てを #earth-root の中に閉じ込めた(CSSは全セレクタを #earth-root 配下にスコープ済み)。
//     元の html/body 用の指定は #earth-root に置き換えている。
//   ・show() のたびに最初から(タイプライターのイントロから)作り直し、閉じるときに
//     rAF・setTimeout・windowリスナー・WebGPUデバイス・Three.jsのレンダラーを全て破棄する
//     (runEarth内の raf / later / listen / onDispose がその管理役)。
//   ・WebGL2フォールバックは削除(ひとまずフォールバックしない方針)。WebGPUが使えない環境
//     (navigator.gpuが無い / adapterが取れない / 初期化に失敗)では、英語で
//     「ブラウザを更新してください」と表示する。
//   ・戻るボタン上のクリックでは、地球のドラッグ回転・渦タップが反応しないようにした。
//   ・スクリプト本体(runEarth)は元のコードを字下げせずそのまま移しているため、
//     元ファイルと見比べやすい。

const ROOT_ID = 'earth-root';
const STYLE_ID = 'earth-styles';
const FONT_LINK_ID = 'earth-fonts';
const FONT_HREF = 'https://fonts.googleapis.com/css2?family=Special+Elite&family=Quicksand:wght@300;500;700&family=Cormorant+Garamond:ital,wght@1,500;1,600&display=swap';

// ページを開いている間、右下に出しっぱなしにする作品名。
const WORK_TITLE = 'Hapworth 16, 1924';

const UNSUPPORTED_LINES = [
  "Your browser doesn't support WebGPU, which this page requires.",
  'Please update your browser to the latest version.',
];

const EARTH_CSS = `

  #earth-root {
    position: fixed; inset: 0; z-index: 9000;
    margin: 0; padding: 0; overflow: hidden;
    background: #01040a;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Hiragino Sans", sans-serif;
    user-select: none;
  }
  #earth-root canvas { display: block; width: 100vw; height: 100vh; cursor: grab; }
  #earth-root canvas:active { cursor: grabbing; }

  /* ---- ライト演出(卓上ライト風) ----
     起動直後は#dark-veilが画面全体を完全な暗闇として覆い隠す。
     準備が整った瞬間に「スイッチを入れる」ようにopacityを一気に落とし、
     暗闇からタイプライターが浮かび上がって見えるようにする。
     #lamp-glowは光源そのものを画面に見せるための物ではなく、あくまで
     「キーボード(文字盤)だけが卓上ライトに照らされている」状態を作る
     ための加算光(mix-blend-mode:screen)。位置とサイズはJS側
     (positionLampGlow)でキーボード(#keyboard-rows)の実測範囲を基準に
     配置しており、紙ではなくキーボードそのものを狙って照らしている。
     さらにキー自体(.key)の素の配色もほぼ真っ黒に落としてあるため、
     キーボードは実質この光だけで浮かび上がる形になり、光が届かない
     部分は影に沈んで見えなくて構わない。
     波紋(#ripple-canvas)は、水そのものを新たに描画するのではなく、
     この#lamp-glowの光(の分布)をシェーダ内で同じ数式で再現し、波の
     法線ぶんだけサンプリング位置をずらして評価することで「既存の光が
     歪んで見える」ことだけで波紋を表現する。詳細はJS側initTypewriter内
     のコメント参照。水自体に色や不透明度を持たせないため、光が届かない
     場所(#lamp-glowの範囲外)では自動的に何も見えなくなる。 */
  #earth-root #dark-veil {
    position: fixed; inset: 0; z-index: 65;
    background: #000;
    opacity: 1;
    pointer-events: none;
    transition: opacity 0.22s cubic-bezier(.2,.9,.3,1);
  }
  #earth-root #dark-veil.lit { opacity: 0; }
  #earth-root #lamp-glow {
    position: fixed; z-index: 55;
    left: 50%; top: 50%; /* JS(positionLampGlow)がキーボードの実測範囲に合わせて上書きする */
    width: 10px; height: 10px;
    transform: translate(-50%, -50%);
    border-radius: 50%;
    /* 見た目の光そのもの(靄)はここでは描かない。実際に見える光は
       #keyboard-canvas側でLIGHT_LOCAL(実在の3D点光源)から物理的に計算
       して描画している(initTypewriter内、initKeyboardThreeのThree.js
       シーンを参照)。
       この要素自体は位置・点灯状態(.onクラス)のデータとしてのみ残し、
       波紋(#ripple-canvas)がその位置・強さを読み取るのに使っている。 */
    background: none;
    opacity: 0;
    pointer-events: none;
    transition: opacity 0.32s ease-out;
  }
  #earth-root #lamp-glow.on { opacity: 1; }

  /* ---- タイプライター・イントロ (紙なし、動きだけで質感を出す) ---- */
  /* 背景を不透明にすると、奥のcanvas(タイプ中に画面中央で育っていく湖)が
     完全に隠れてしまうため、あえて背景を敷かない(bodyの暗色と地続きに
     見えるため見た目上の違和感は出ない)。 */
  #earth-root #intro-overlay {
    position: fixed; inset: 0; z-index: 50;
    display: flex; align-items: center; justify-content: center;
    overflow: hidden;
  }
  #earth-root #intro-overlay.hidden { opacity: 0; pointer-events: none; transition: opacity 0.6s ease; }

  /* 打刻位置(=次の文字が必ず現れる一点)を、箱自身の動的な幅に依存しない
     固定のビューポート座標(画面中央やや上)に定める。横方向はJSが
     currentLineWidth分だけtranslateXで、縦方向は改行のたびに1行分
     translateYで、それぞれ紙(このボックス)を動かして実現する。
     ※以前は left:50% + translateX(-50%) で中央寄せしていたが、これは
     ボックス自身の実測幅(コンテンツ量で変動する)に対する割合だったため、
     文字数が少ない打ち始めほど基準点がぶれてしまっていた。 */
  /* 打刻位置(=次の文字が必ず現れる一点)を、箱自身の動的な幅に依存しない
     固定のビューポート座標(画面中央やや上)に定める。
     横方向(1文字ごと)と縦方向(改行ごと)で動きの質が違う
     (前者は素早く、後者はキャリッジがゆっくり時間をかけて動く)ため、
     2階層に分けてそれぞれ別のtransition速度を持たせる:
       #typewriter-lines … 縦方向(改行)のみ、ゆっくり
       .paper-h           … 横方向(1文字)のみ、素早く
     ※以前は left:50% + translateX(-50%) で中央寄せしていたが、これは
     ボックス自身の実測幅(コンテンツ量で変動する)に対する割合だったため、
     文字数が少ない打ち始めほど基準点がぶれてしまっていた。 */
  #earth-root #typewriter-lines {
    color: #eef3fb;
    font-family: 'Special Elite', 'Courier New', monospace;
    font-size: clamp(11px, 1.7vw, 17px);
    line-height: 1.6;
    letter-spacing: 1px;
    text-align: left;
    max-width: min(760px, 88vw);
    text-shadow: 0 0 22px rgba(125, 211, 248, 0.16);
    transition: opacity 0.9s ease, transform 1.1s cubic-bezier(.3, .65, .25, 1);
    position: absolute;
    top: 20%;
    left: 50vw;
    transform: translateY(0px);
  }
  #earth-root .paper-h {
    display: block;
    transition: transform 1.38s cubic-bezier(.22, .7, .28, 1);
    transform: translateX(0px);
  }

  /* ---- 復帰レバー(キャリッジ・リターン・レバー) ----
     奥(付け根)から手前へ伸びる一本の棒。上下方向へは一切動かず、
     文章が進むにつれて紙とは別スケールで左右にだけ移動する。
     デフォルト位置はQキーよりも少し左、高さは打刻位置より少し下で固定。
     静止時のベクトル(x=右+, y=下+, z=手前+)は (-2, -1, 5) で、
     具体的な回転角と長さはJS側(#lever要素の高さ・transform)で計算する。 */
  #earth-root #lever-mount {
    position: absolute;
    top: calc(20% + 46px);
    left: calc(50vw - 300px);
    width: 10px; height: 10px;
    perspective: 420px;
    transition: transform 1.38s cubic-bezier(.22, .7, .28, 1);
    transform: translateX(0px);
    pointer-events: none;
    z-index: 4;
  }
  #earth-root #lever {
    position: absolute;
    top: 0; left: 0;
    width: 3px;
    transform-style: preserve-3d;
    transform-origin: top center; /* 付け根(奥側の先端)を回転軸にする */
    transition: transform 1.1s cubic-bezier(.3, .66, .24, 1.3);
    background: transparent; /* 見た目はThree.js(#lever-canvas)側で描く。ここは位置・回転計算の基準としてのみ残す */
    border-radius: 2px;
  }
  #earth-root #lever::before {
    content: none; /* 見た目はThree.js側に置き換えたため非表示 */
  }

  /* 1文字ずつ「打鍵」で叩き込まれる動き。ハンマーが上から落ちて僅かに弾む */
  #earth-root #typewriter-lines .ch {
    display: inline-block;
    white-space: pre; /* スペース単体がinline-block内で行頭/行末扱いされ消えるのを防ぐ */
    opacity: 0;
    animation: keyStrike 0.17s cubic-bezier(.2, .85, .25, 1.4) forwards;
  }
  @keyframes keyStrike {
    0%   { opacity: 0; transform: translateY(-11px) scaleY(1.35); }
    55%  { opacity: 1; transform: translateY(1.5px) scaleY(0.92); }
    100% { opacity: var(--ch-op, 1); transform: translateY(0) scaleY(1); }
  }

  /* 前置きの一文からHapworthLakeまで、全て同じ「紙」(.paper-inner を
     内包する #typewriter-lines)の上で1本の行として打たれていく。
     1文字打つたびに、その文字が常に同じ位置(タイプ位置)に現れるよう
     紙全体(#typewriter-lines)を左へ送り出す。結果として前置きの文字も
     含め、すでに現れている文字は全て左へ流れていく。 */
  #earth-root .paper-inner { display: block; }
  #earth-root .paper-text {
    min-height: 1.2em;
    white-space: nowrap;
    opacity: 0.92;
  }

  #earth-root .paper-inner.jolt {
    animation: carriageJolt 0.16s ease-out;
  }
  @keyframes carriageJolt {
    0%   { transform: translateY(0); }
    35%  { transform: translateY(2px); }
    65%  { transform: translateY(-1px); }
    100% { transform: translateY(0); }
  }

  /* ---- 文字盤: 執筆者目線(見下ろす角度)の遠近 ----
     キーの見た目(キャップのドーム・銀色のベゼル)は#keyboard-canvasで
     WebGLにより物理的に(実際の点光源に対する陰影として)描画する。
     ここに残すDOM(.key)は、レイアウト位置決め・クリック当たり判定・
     文字ラベルの表示のためだけに使う。文字の色はJS側で毎フレーム、
     そのキーが実際にどれだけ光を受けているかに応じて更新する。 */
  #earth-root .keyboard-viewport {
    position: absolute; left: 0; right: 0; bottom: 6vh;
    display: flex; justify-content: center;
    perspective: 780px;
    transition: opacity 0.6s ease;
    z-index: 21; /* #keyboard-canvas(20)より手前。#lamp-glow(55)/波紋(60)よりは奥 */
  }
  #earth-root .keyboard-rows {
    display: flex; flex-direction: column; gap: 36px; /* タイプライターらしく広めの間隔 */
    position: relative; /* 子キーのoffsetLeft/Topをこの要素基準で取れるようにする(WebGL側のジオメトリ取得用) */
    transform: rotateX(46deg);
    transform-style: preserve-3d;
  }
  #earth-root .keyboard-row {
    display: flex; gap: 20px; /* 左右方向の間隔を0.6倍ほどに詰めた(元は34px) */
  }
  #earth-root .keyboard-row[data-row="1"] { margin-left: 30px; } /* キー幅+間隔(pitch=70px)の3/7 */
  #earth-root .keyboard-row[data-row="2"] { margin-left: 60px; } /* pitchの6/7 */
  #earth-root .keyboard-row:has(.spacebar) { justify-content: center; }
  #earth-root .key {
    position: relative;
    z-index: 1;
    width: 50px; height: 50px;
    border-radius: 50%;
    background: transparent; /* キャップ本体は#keyboard-canvas側で描画 */
    display: flex; align-items: center; justify-content: center;
    color: transparent; /* 文字は#keyboard-canvas側(WebGL)で描画するため常に非表示 */
    font-family: 'Special Elite', 'Courier New', monospace;
    font-size: 24px;
    cursor: pointer;
    user-select: none;
    /* キャップの盛り上がり分、文字が浮いて見えないよう少し下にずらして
       キー表面に馴染ませる。.pressedの値はこの分を含めて設定すること。 */
    transform: translateY(8px);
    transition: transform 0.12s cubic-bezier(.3,.8,.4,1), opacity 0.3s ease;
  }
  #earth-root .key.inactive {
    cursor: default;
    opacity: 0.55;
  }
  #earth-root .key.pressed {
    transform: translateY(18px) scale(0.9);
  }
  #earth-root .key.spacebar {
    height: 40px; /* 奥行きを少し細く(元は56px) */
    border-radius: 20px;
  }

  /* キーの見た目(Three.js): 各キーは本物の3Dメッシュ(押し出しの縁+
     文字面ポケット、またはスペースバー用の押し出しスタジアム形状)と
     して構築し、傾いた文字盤平面の少し上に置いた実在の点光源に対して
     Three.jsのMeshStandardMaterialで陰影計算する。詳細はJS側
     (initTypewriter内、initKeyboardThree近辺)を参照。波紋と同じ
     「傾いた平面座標変換」を共有しているため、キーの傾き・遠近感は
     文字盤・水面と完全に一致する。 */
  #earth-root #keyboard-canvas {
    position: fixed; inset: 0; width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 20; /* 背景より手前、#lamp-glow(55)/波紋(60)よりは奥 */
    transition: opacity 0.5s ease;
  }

  /* レバー(Three.js版): #lever-mount/#leverはジオメトリ・アニメーション
     タイミングの「基準」としてだけ残し(位置・回転はそのままJSで計算)、
     見た目自体はこのcanvasにThree.jsで描く。#leverのopacityを0にして
     元の見た目(CSSだけの細い棒)は非表示にしている。詳細はJS側
     (initTypewriter内、initLeverThree近辺)を参照。 */
  #earth-root #lever-canvas {
    position: fixed; inset: 0; width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 21;
  }

  /* 波紋(WebGL, ランプの光を歪ませる版): 水そのものに色や不透明度を
     持たせず、画面全体を覆う透明なcanvasを1枚敷くだけにする。中身は
     「#lamp-glowと同じ光の分布」をシェーダ内で数式的に再現し、波の
     法線ぶんだけサンプリング位置をずらして評価する。ずらす前と後で
     明るさが変わった分だけを、その場に薄い白(明るくなった分)または
     薄い黒(暗くなった分)として重ねて描く。これは新しい色を足すのでは
     なく、あくまで既存の光の「見え方のズレ」だけを可視化する仕組みな
     ので、通常のalpha合成(mix-blend-modeなし)で構わない。#lamp-glowの
     光が届かない範囲は明るさの差分もゼロになるため、境界(box)を用意
     しなくても自動的に「光が届く範囲でしか波紋が見えない」状態になる。
     詳細はJS側(initTypewriter内)のシェーダソースを参照。 */
  #earth-root #ripple-canvas {
    position: fixed; inset: 0; width: 100vw; height: 100vh;
    pointer-events: none;
    z-index: 60; /* #lamp-glow(55)より手前に重ねて描く */
    transition: opacity 0.5s ease;
  }


  /* ---- earth.js 追加分: 戻るボタン(iconButton.jsのcreateBackButton)の位置 ---- */
  #earth-root .earth-back {
    position: absolute; top: 22px; left: 26px; z-index: 100;
  }
  /* ---- WebGPU非対応時のメッセージ ---- */
  #earth-root .earth-unsupported {
    position: absolute; inset: 0;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 6px; padding: 0 28px; text-align: center;
    color: #eef0ff;
    font-family: 'Quicksand', -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: clamp(15px, 2.1vw, 22px); line-height: 1.7; letter-spacing: 0.04em;
    text-shadow: 0 0 14px rgba(150, 175, 255, 0.45);
  }
  #earth-root .earth-unsupported p { margin: 0; }
`;

const EARTH_HTML = `
<canvas id="gpuCanvas"></canvas>
<canvas id="keyboard-canvas"></canvas>
<canvas id="lever-canvas"></canvas>
<div id="intro-overlay">
  <div id="lever-mount"><div id="lever"></div></div>
  <div id="typewriter-lines">
    <div id="paper-h" class="paper-h">
      <div id="paper-inner" class="paper-inner">
        <div id="paper-text" class="paper-text"></div>
      </div>
    </div>
  </div>
  <div class="keyboard-viewport"><div class="keyboard-rows" id="keyboard-rows"></div></div>
</div>
<div id="lamp-glow"></div>
<canvas id="ripple-canvas"></canvas>
<div id="dark-veil"></div>
`;

// ── 1回のshow()〜閉じるまでの「寿命」を管理する ──
// runEarth内の全てのタイマー・リスナー・描画ループはここを通すので、dispose()一発で全部止まる。
function createSession(root) {
  const cleanups = [];
  const timers = new Set();
  let disposed = false;
  const session = {
    root,
    isDisposed: () => disposed,
    onDispose(fn) {
      if (disposed) { try { fn(); } catch (e) {} } else cleanups.push(fn);
    },
    raf(cb) {
      if (disposed) return 0;
      return requestAnimationFrame((t) => { if (!disposed) cb(t); });
    },
    later(fn, ms) {
      if (disposed) return 0;
      const id = setTimeout(() => { timers.delete(id); if (!disposed) fn(); }, ms);
      timers.add(id);
      return id;
    },
    listen(target, type, fn, opts) {
      target.addEventListener(type, fn, opts);
      session.onDispose(() => target.removeEventListener(type, fn, opts));
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      timers.forEach((id) => clearTimeout(id));
      timers.clear();
      for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch (e) {} }
    },
  };
  return session;
}

async function hasWebGPU() {
  if (!navigator.gpu) return false;
  try { return !!(await navigator.gpu.requestAdapter()); } catch (e) { return false; }
}

function injectOnce() {
  if (!document.getElementById(STYLE_ID)) {
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = EARTH_CSS;
    document.head.appendChild(style);
  }
  if (!document.getElementById(FONT_LINK_ID)) {
    const link = document.createElement('link');
    link.id = FONT_LINK_ID;
    link.rel = 'stylesheet';
    link.href = FONT_HREF;
    document.head.appendChild(link);
  }
}

/**
 * Hapworthページ(オーバーレイ)を作る。
 * @param {Object} opts
 * @param {() => void} [opts.onClose] - 「←」で閉じた直後に呼ばれる(main.js側でZステーション表示に戻す)
 */
export function createEarth({ onClose } = {}) {
  let root = null;
  let backBtn = null;
  let workEl = null;
  let session = null;

  function teardown() {
    session?.dispose();
    session = null;
    root?.remove();
    root = null;
    backBtn = null;
    workEl = null;
  }

  function close() {
    if (!root) return;
    teardown();
    if (onClose) onClose();
  }

  // 描画を全て止め、戻るボタン以外を消して、英語の案内だけを出す
  function showUnsupported() {
    if (!root) return;
    session?.dispose();
    [...root.children].forEach((el) => { if (el !== backBtn && el !== workEl) el.remove(); });
    const box = document.createElement('div');
    box.className = 'earth-unsupported';
    UNSUPPORTED_LINES.forEach((line) => {
      const p = document.createElement('p');
      p.textContent = line;
      box.appendChild(p);
    });
    root.appendChild(box);
  }

  function show() {
    if (root) return;
    injectOnce();
    root = document.createElement('div');
    root.id = ROOT_ID;
    backBtn = createBackButton({ className: 'earth-back', onClick: close });
    root.appendChild(backBtn);
    // 作品名: 他ページの出典と全く同じ見た目・位置(右下)にするため、captions.jsの出典ボックスを使う。
    // 共有インスタンスは#earth-root(z-index:9000)の裏に隠れてしまうので、専用のものを作って
    // root内へ移す(rootごと破棄されるので後始末は不要)。
    workEl = createSourceBox();
    root.appendChild(workEl);
    makeCaptionController(workEl).setText(WORK_TITLE);
    document.body.appendChild(root);

    const s = createSession(root);
    session = s;
    hasWebGPU().then((ok) => {
      if (s.isDisposed()) return; // 確認中に閉じられた
      if (!ok) { showUnsupported(); return; }
      root.insertAdjacentHTML('afterbegin', EARTH_HTML);
      runEarth(s, showUnsupported);
    });
  }

  return { show, hide: teardown, isOpen: () => root !== null };
}

// ============================================================
// ここから下が earth_vortex.html のスクリプト本体(元コードのまま。上記の加工のみ)
// ============================================================
function runEarth(session, fail) {
const { root, raf, later, listen, onDispose, isDisposed } = session;
const $ = (id) => root.querySelector('#' + id);

// ── イントロ(タイプライター)専用の描画物の停止管理 ──
// キーボード(Three.js)・レバー(Three.js)・波紋(WebGL)は、地球が出現してフェードアウトした後は
// 見えないのに毎フレーム回り続けていたため、出現後に描画ループを止めてコンテキストも解放する。
let introRenderingStopped = false;
const introStopFns = [];
function onIntroDispose(fn) {
  let done = false;
  const run = () => { if (done) return; done = true; fn(); };
  introStopFns.push(run);
  onDispose(run); // 地球出現前に閉じた場合も、ここで確実に解放される(二重実行はdoneで防ぐ)
}
function stopIntroRendering() {
  if (introRenderingStopped) return;
  introRenderingStopped = true;
  introStopFns.splice(0).forEach((f) => { try { f(); } catch (e) {} });
  ['intro-overlay', 'keyboard-canvas', 'lever-canvas', 'ripple-canvas', 'lamp-glow'].forEach((id) => {
    const el = $(id);
    if (el) el.style.display = 'none';
  });
}
const canvas = $('gpuCanvas');

// ============================================================
// 粒子球の生成: シミュレーション向け・境界線のない球面格子
// ------------------------------------------------------------
// golden-angle スパイラル(フィボナッチ格子)は平面をUV展開して3D化した
// ものではなく、緯度経度グリッドのような明示的な縫い目や極特異点も
// 持たない。ただし無補正のまま使うと極(y=±1)に近いほど点が詰まり、
// 螺旋の"筋"が視認できてしまう、という点群可視化ではよく知られた
// アーティファクトがあった。
//
// ここでは Swinbank & Purser (2006) / González (2010) が示す
// epsilon補正付きフィボナッチ格子を採用し、極付近の密集・スパイラルの
// 目立ちを緩和する。ただしepsilon補正は「極そのものの一点」は格子点に
// 含めないため、最も外側(北極側 i=0 / 南極側 i=n-1)の点より内側に、
// 半径 acos(y0) 程度の"空洞"が残る。
//
// この空洞は、格子のインデックス i を負の範囲・n以上の範囲にまで
// 拡張し、同じ式 y(i) = 1 - 2(i+eps)/(n-1+2eps), theta(i) = 黄金角*i を
// そのまま使い続けることで埋める。i=-eps でちょうど y=1(北極)、
// i=n-1+eps でちょうど y=-1(南極)になるため、境界(既存格子の外周点)
// と同じ螺旋の続きとして密度が完全に連続し、縫い目のない一枚の
// 球面分布になる。
// ============================================================
function fibonacciEpsilon(n) {
  if (n >= 600000) return 214;
  if (n >= 400000) return 75;
  if (n >= 11000) return 27;
  if (n >= 890)   return 10;
  if (n >= 177)   return 3.33;
  if (n >= 24)    return 1.33;
  return 0.33;
}
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5)); // 約 2.3999632 rad

// latticeN: 密度の基準となる格子点数。実際に生成される点の総数は
// 両極の穴埋め分(poleFill×2)を加えた latticeN + poleFill*2 になる。
function buildFilledFibonacciSphere(latticeN) {
  const eps = fibonacciEpsilon(latticeN);
  const poleFill = Math.ceil(eps); // 片側の極を埋めるのに必要な点数 ≈ eps
  const total = latticeN + poleFill * 2;
  const points = new Array(total);
  for (let k = 0; k < total; k++) {
    const j = k - poleFill; // j は -poleFill 〜 (latticeN-1+poleFill) まで拡張したインデックス
    let y = 1 - (2 * (j + eps)) / (latticeN - 1 + 2 * eps);
    y = Math.max(-1, Math.min(1, y));
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const theta = GOLDEN_ANGLE * j;
    points[k] = [Math.cos(theta) * r, y, Math.sin(theta) * r];
  }
  return { points, total, poleFill, eps };
}

// ----------------------------------------------------
// 粒子初期化 (基準65,536点 + 両極の穴埋め分・単一プール)
// 鼓動用の残像粒子プールは今回廃止(動き再実装時に別途検討)。
// ----------------------------------------------------
// ---- 鼓動の残像粒子(元バージョンの再現): 拍がピークに達した瞬間だけ、
// 球の最大外形に極小の光粒子がまばらに浮かび上がり、静かに消えていく。
// このファイルはcompute passを持たず状態を保持できないため、「粒子ごとの
// seed」と「拍のサイクル番号」をハッシュして、そのサイクルで発火するか
// どうかを毎フレーム再計算する(状態を持たない疑似ランダム)。
// ※ここはTOTAL_PARTICLESの算出より前に定義する必要があるため、
//   LAKE_HEARTBEAT_DISP(このあと定義される)には依存させず、同じ値(0.05)を
//   直接埋め込んでいる。値を変える場合はLAKE_HEARTBEAT_DISPとここの両方を揃えること。
const AFTERIMAGE_SPAWN_RATE  = 0.28;  // 1拍あたり、弾き飛ばされる水しぶき粒子の割合
const SPLASH_DURATION        = 0.85;  // 弾かれてから落下し消えるまでの飛行時間(秒)
const SPLASH_MAX_HEIGHT      = 0.065; // 表面からの最大上昇量(控えめのまま、以前のAFTERIMAGE_PEAK_RADIUS相当)
const SPLASH_LATERAL_MAX     = 0.05;  // 膨張の勢いで横方向へ飛ばされる量(接線方向オフセット)
const SPLASH_COLOR_R = 1.0, SPLASH_COLOR_G = 1.0, SPLASH_COLOR_B = 1.0; // 水しぶきの色(白。以前は濃い青だった)
const WEBGPU_AFTERIMAGE_COUNT = 2048; // WebGPU側の水しぶき粒子プールの数
const WEBGL_AFTERIMAGE_COUNT  = 512;  // WebGLフォールバック側の水しぶき粒子プールの数

// 砕波(泡)による水しぶき。既存の水しぶきプール(mode=1)をそのまま流用し、
// 「鼓動のピーク」に加えて「局所の泡Fが閾値を超えている間、一定間隔で発生」
// というもう一つの発火源を頂点シェーダに追加する(WebGPU専用)。
const BREAK_SPLASH_FOAM_THR = 0.35;  // これを超えるFの場所だけ発生対象になる
const BREAK_SPLASH_WINDOW   = 0.35;  // 発生判定を行う時間の区切り(秒)
const BREAK_SPLASH_RATE     = 0.10;  // 1区切りごとに、条件を満たす粒子が実際に発火する確率

// ---- 泳ぐ文章(mode=2) ----
// 【今回の変更点】以前はsin波1本で位置を揺らしていたが、「不自然」「文字が
// 離れすぎ」「鎖として文字同士に向きの関係がない」という指摘を受け、位置の
// 決め方を丸ごと作り直した。今は単語ごとに「鎖」として扱う:
//   - 先頭の文字(リーダー)だけが、自分の現在位置での実際の海流(u,v。
//     CPU側の浅水シミュレーションが解いているもの)を一定距離進むごとに
//     測り直し、その向きへ直進する。
//   - 後続の文字は各自で何かを計算するのではなく、リーダーが実際に通った
//     軌跡(履歴)を、文字間隔ぶんだけ遅れてそのままトレースする。
// これにより、隊列は常に一定間隔・一直線につながり(=鎖)、進む向きも
// 幾何的な合成波ではなく実際の水の流れそのものになる。上下方向(海面からの
// 高さ・表示/非表示)は指示どおり簡略に扱い、その文字の"今いる場所"の波の
// 高さと比べて低ければ表示・高ければ不可視にする。
// この「鎖」の状態そのもの(各単語のリーダー位置・軌跡履歴)はCPU(JS)側で
// 毎フレーム計算し、結果の位置・向きだけをparticleBufferへ書き込む
// (updateSwimChains()。基本設計や他の演出はWGSL側でGPU計算しているのと対照的)。
// フォントはCormorant Garamondのイタリック(セリフ体)。
// ここに好きな一文を2つ入れる。著作権のある文章(書籍からの引用など)を
// 書き込む場合は引用の範囲・扱いに注意すること。
const SWIM_QUOTES = [
  "a placeholder line waiting to be replaced with words of your choosing",
  "the sea keeps its own memory, folding every voice back into the tide",
];
const SWIM_FONT_FAMILY = "'Cormorant Garamond', 'Times New Roman', serif";
// 各引用文の単語群を、赤道をまたいで互いに重ならないよう緯度をずらして
// 初期配置する(その後は海流に乗って自由に動いていく)。
const SWIM_QUOTE_LATS = [0.16, -0.16];
// バッファ上の確保数 = 空白を除いた全文字数(+少し余裕)。1文字=1粒子。
const TEXT_PARTICLE_CAP = SWIM_QUOTES.reduce((s, q) => s + q.split('').filter((c) => c !== ' ').length, 0) + 8;
const SWIM_CHAR_SIZE = 0.075; // 1文字ビルボードの基準サイズ(pSize相当)
// 【前回「文字の浮き沈みがない」と指摘された原因】
// このしきい値を波高の実際のレンジ(sampleOceanHeight()はeta×0.0084で、
// etaは通常±5のクランプよりずっと小さい値で釣り合うため、実測ではおおよそ
// ±0.01〜0.03程度しかない)とかけ離れた場所(-0.35〜-0.15)に置いてしまって
// いた。実際の値は常にこの範囲よりずっと大きい(0に近い)ため、smoothstepが
// 常に1.0に張り付いて「表示/非表示の切り替え」も「高さの変化」も実質ゼロに
// なっていた。値のレンジを実測に合わせて引き直す。
const SWIM_TEXT_LOW  = -0.01;
const SWIM_TEXT_HIGH =  0.01;
// 上記のとおり実際の波高はごく小さい(海面全体としてはそれで正しい)ため、
// そのままだと文字の上下移動そのものも画面上ではほぼ見えない。可視性の
// 判定(peek)には実測値をそのまま使いつつ、表示位置の半径方向オフセットに
// だけこの倍率をかけて、浮き沈みが目で見て分かる大きさにする。
const SWIM_HEIGHT_AMP = 6.0;
// ---- 鎖(チェイン)の物理 ----
// リーダーが進む速さ(rad/秒)。フレームレートに依存しないよう、実際の
// 移動量は毎フレーム CHAIN_SPEED×dt で計算する(下のCHAIN_STEP_ARCは
// 履歴バッファの容量見積もりにだけ使う仮の1ステップぶんの目安値)。
const CHAIN_SPEED = 0.045;
const CHAIN_STEP_ARC = CHAIN_SPEED / 60;
// これだけ進んだら現在地の海流方向を測り直す(rad)。「一定距離進んだら
// 再計測」という指示どおり、この間は目標の向きを固定して直進する。
const CHAIN_REMEASURE_DIST = 0.12;
// 新しい向きへ急に折れ曲がらないよう、向きを毎フレーム少しずつ目標へ
// 寄せる(1/秒。大きいほど速く新しい向きへ切り替わる)。
const CHAIN_TURN_RATE = 2.5;
// リーダーの軌跡を記録しておくリングバッファの容量(1つの引用文あたり)。
const CHAIN_HISTORY_CAP = 4000;
// フォントの実測幅(px)を鎖の弧長(rad)に変換する係数は、固定値ではなく
// 「引用文全体の自然な幅がちょうどSWIM_FONT_SCALE×2π(=円周の何割か)を
// 占めるように」引用文ごとに逆算する(setupSwimChains内)。単語ごとの鎖
// だった頃に使っていた固定スケールのままだと、1文全体(数十文字)に適用した
// 際に円周の半分近くまで広がってしまい、逆に間延びして見えるため。
const SWIM_FONT_SCALE = 0.24;
// グリフアトラス(文字ごとのグリフを敷き詰めた1枚のテクスチャ)のレイアウト。
const SWIM_ATLAS_COLS = 12;
const SWIM_ATLAS_CELL = 128; // px(正方形セル)

// ---- 月(粒子で表現した簡易的な球。影・光の面を太陽方向との内積で表現する) ----
// 「規模は簡易的でよい」「自転・公転・太陽位置の計算精度は体感的にそれっぽければ
// 十分」という方針のもとでの割り切り:
//   - 見た目は地球と同じ仕組み(Fibonacci格子で球状に敷き詰めた白い点)を、
//     数を減らして再利用するだけ。専用のジオメトリやテクスチャは作らない。
//   - 公転: 既存のmoonDirAt()(tide計算用に元々あった、原点まわりの単純な円軌道)
//     をそのまま位置に流用する。
//   - 自転: 実装しない。テクスチャや模様のない点群の球は、自転していてもいなくても
//     見た目が区別できない(=計算しても体感が変わらない)ため。
//   - 太陽の位置: 実際の天文学的な位置は計算せず、固定方向(SUN_DIR)で近似する。
//     月は自転させない代わりに、各粒子の「向き(=球の中心からその粒子への
//     方向)」は常に世界座標で固定(移動でも変わらない)なので、この固定太陽
//     方向との内積だけで、月がどこにあっても正しい半球が光って見える。しかも
//     月自身は公転で動くのに対しカメラ(=地球側)はほぼ固定なので、見かけの
//     満ち欠け(三日月〜満月)は特別な計算をしなくても自然に生まれる。
const MOON_ORBIT_DISTANCE = 2.6; // 原点からの距離(地球の半径1に対して)
const MOON_RADIUS = 0.27; // 地球に対する月の大きさ(現実の比率。厳密さより雰囲気重視)
const MOON_DOT_SIZE = 0.016; // 月を構成する1粒子の大きさ(pSize相当)
const MOON_LATTICE_N = 1400; // 月の粒子密度の目安(実際の総数は極の穴埋め分だけ少し増える)
const moonBuild = buildFilledFibonacciSphere(MOON_LATTICE_N);
const MOON_PARTICLE_COUNT = moonBuild.total;
// 太陽の方向(SUN_DIR)は、月の公転軌道の定義(moonDirAt、下の方)が先に
// 必要なため、このすぐ後で定義している(このファイルの少し先を参照)。
const MOON_TERMINATOR_SOFT = 0.12; // 昼夜境界のぼかし幅(内積換算)
const MOON_SHADOW_COLOR = 0.06;    // 夜側の明るさ(0で真っ黒。球のシルエットは見えるよう少しだけ残す)

const LATTICE_N = 65536;
const sphereBuild = buildFilledFibonacciSphere(LATTICE_N);
const MAIN_PARTICLE_COUNT = sphereBuild.total;
const TOTAL_PARTICLES = MAIN_PARTICLE_COUNT + WEBGPU_AFTERIMAGE_COUNT + TEXT_PARTICLE_CAP + MOON_PARTICLE_COUNT;
const particleData = new Float32Array(TOTAL_PARTICLES * 16);

// ----------------------------------------------------
// 「湖」の形成(タイプライターとの接続点)
// 0) "Hapworth"を1文字打つごとに、パッチがLAKE_RADIUSまで少しずつ育つ
//    (lakeGrowTarget/lakeGrowDisplayで管理)。intro-overlayは背景を
//    敷いていないため、タイプ中でも画面中央でこの成長がそのまま見える。
// 1) "Hapworth"を打ち終えた後、続く" Lake"の間はLAKE_RADIUSのまま静止
// 2) 最後の"e"を打った瞬間(TARGET_WORD完了=isLast)にrevealEarthAndHandOff
//    経由でtriggerEarthReveal()が発火し、そのまま(待ち時間なしで)
//    パッチの縁(前線)が反対側へ向けて角距離ベースで拡張していく。
//    "e"の打鍵と同時に開始点(角距離0)を波源とした波紋も始まり、往路
//    (中心→裏側=角距離π、LAKE_EXPAND_DUR秒)の間に振幅が育っていって
//    「球の完成時」にちょうど最大になり、続く復路(裏側→開始点、
//    LAKE_RETURN_DUR秒)の間に振幅が下がっていき、波が開始点まで
//    帰ってくる頃にはちょうど0になって静止する。
// パッチの中心は北極(0,1,0)ではなく、カメラ正面(0,0,1)=画面中央に
// 一致する点に置く(球の出現角度を90度ずらす)。
// カメラは動かさない。表示のON/OFFならびに起伏はシェーダ側で計算する。
// ----------------------------------------------------
const LAKE_RADIUS      = 0.10;  // 初期パッチの角半径(rad, 画面中央からの角距離)。小さくてよい
const LAKE_FADE_IN     = 0.35;  // 初期パッチのフェードイン秒数
const LAKE_HOLD        = 0.0;   // 拡張・波紋を始めるまでの静止秒数。"e"の打鍵とラグなく一致させるため0
const LAKE_EXPAND_DUR  = 6.4;   // 前線が画面中央→その裏側(角距離 π)まで広がりきる秒数(球の完成速度を半減=時間を倍に)
const LAKE_EDGE_BAND   = 0.07;  // 全球化の前線のぼかし幅(rad)
const LAKE_EDGE_BAND_LAKE = 0.018; // 打鍵で育つ「完成する湖」側の縁のぼかし幅。前線よりくっきりした輪郭にする
// ---- eの波紋(往路で振幅が育ち、球の完成時に最大、復路でまた0に戻る) ----
// 波源(開始点=角距離0)は止めない。まず往路(中心→裏側=角距離π、
// LAKE_EXPAND_DURと同じ速さ=球の完成と同期)で振幅がLAKE_VIB_AMP_BASEから
// LAKE_VIB_AMP_PEAKまで育ち、球が完成した瞬間にちょうど最大になる。
// 続く復路(裏側→開始点、LAKE_VIB_RETURN_DUR秒)では振幅がLAKE_VIB_AMP_PEAK
// から0まで下がっていき、波が開始点まで帰ってくる頃にはちょうど0になって
// 静まる。だが波源はそこで止まらず、静まった直後から一定間隔で新しい
// 波(鼓動)を送り出し続ける。一周(往路+復路)の波紋自体はここで完全に
// 運動を終了し(以降は起伏0)、鼓動は別レイヤーとして球全体を一斉に
// 呼吸させる(局所的に伝わるリングではなく、全体が同時に膨らみ縮む)。
const LAKE_VIB_FREQ       = 150.0; // 同心円の細かさ(波の数)
const LAKE_VIB_RETURN_DUR = 7.2;   // 復路(裏側→開始点)にかかる秒数。波の進行速度を半減=時間を倍に
const LAKE_VIB_AMP_BASE   = 0.015; // 波紋開始時点の振幅
const LAKE_VIB_AMP_PEAK   = 0.16;  // 球の完成時(往路完了時)に達する最大振幅
// ---- 鼓動(一周の波紋が静まった後、球全体を一斉に呼吸させる拍動) ----
const LAKE_HEARTBEAT_PERIOD = 3.4;  // 鼓動の間隔(1拍にかかる秒数)
const LAKE_HEARTBEAT_DISP   = 0.05; // 鼓動による球全体の膨縮量(半径方向)
let earthRevealStartElapsed = -1;
function triggerEarthReveal() {
  if (earthRevealStartElapsed >= 0) return; // 二重発火を防ぐ
  earthRevealStartElapsed = currentElapsed;
}

// 鼓動の強さ(0〜1)を、一周(往路+復路)の波紋が完全に静まった後の経過秒数
// から計算する。本物の心臓の「lub-dub」(強い一拍目→すぐ後にやや弱い
// 二拍目→長い静止)に寄せるため、1周期の中に2つのガウス型パルスを
// 重ねる。一周(前段の波紋)が終わるまでは常に0。
const BEAT_LUB_CENTER = 0.05,  BEAT_LUB_WIDTH = 0.035, BEAT_LUB_AMP = 1.0;  // 一拍目(強い・短い)
const BEAT_DUB_CENTER = 0.19,  BEAT_DUB_WIDTH = 0.030, BEAT_DUB_AMP = 0.6;  // 二拍目(lubの少し後、やや弱い)
function computeBeatVal(lakeElapsed) {
  if (lakeElapsed < 0) return 0;
  const vibElapsed = Math.max(0, lakeElapsed - LAKE_HOLD);
  const mainLapDur = LAKE_EXPAND_DUR + LAKE_VIB_RETURN_DUR;
  if (vibElapsed <= mainLapDur) return 0;
  const beatElapsed = vibElapsed - mainLapDur;
  const cyclePos = (beatElapsed % LAKE_HEARTBEAT_PERIOD) / LAKE_HEARTBEAT_PERIOD; // 0..1
  const lub = BEAT_LUB_AMP * Math.exp(-((cyclePos - BEAT_LUB_CENTER) ** 2) / (2 * BEAT_LUB_WIDTH * BEAT_LUB_WIDTH));
  const dub = BEAT_DUB_AMP * Math.exp(-((cyclePos - BEAT_DUB_CENTER) ** 2) / (2 * BEAT_DUB_WIDTH * BEAT_DUB_WIDTH));
  return Math.min(1, lub + dub);
}

// "Hapworth"を1文字打つごとに0→1へ少しずつ近づく成長度。
// lakeGrowTargetがtryInput側から更新され、lakeGrowDisplayが毎フレーム
// 滑らかに追従することで、1文字ごとに湖がじわっと広がって見える。
let lakeGrowTarget = 0;
let lakeGrowDisplay = 0;

// ---- "Lake"の"L","a","k"(eの直前まで)を打つたびに湖面に起こす波紋 ----
// 3スロット固定。各スロットには打鍵時刻(currentElapsed)を記録するだけで、
// 実際の減衰付きリング波の計算はシェーダ/JSフォールバック側で行う。
// -1は「まだ発火していない」を表す。
const LAKE_STRIKE_SLOTS   = 3;
const LAKE_STRIKE_FREQ    = 210.0; // 波紋の同心円の細かさ(湖のパッチが小さいため高め。波の数をさらに増加)
const LAKE_STRIKE_SPEED   = 0.09;  // リングが外側へ広がる速さ(rad/秒)
const LAKE_STRIKE_AMP     = 0.012; // 起伏量
const LAKE_STRIKE_SIGMA   = 0.045; // リングの太さ(rad)
const LAKE_STRIKE_DUR     = 1.3;   // 1発の波紋が続く秒数(この後は完全に0へ)
const LAKE_STRIKE_DECAY   = 2.2;   // 時間減衰の速さ
let lakeImpulseTimes = new Array(LAKE_STRIKE_SLOTS).fill(-1);

// ============================================================
// 海洋(対流・潮汐)シミュレーション
// ------------------------------------------------------------
// 緯度経度グリッド上で線形浅水方程式(コリオリ力・減衰・潮汐/風の
// 強制項つき)を明示的に時間積分する。状態(η・u・v)はCPU(JS)側だけで
// 保持し、毎フレーム計算した高さ場ηをGPUへアップロードして頂点
// シェーダ側は双一次補間で読むだけにする。こうすることで、WebGPU・
// WebGLどちらの経路でも「同じJS配列を直接参照する」だけで済み、
// シミュレーション本体を二重実装せずに済む(サンプリングの式だけ
// WGSL側にも複製する)。
// ============================================================
const OCEAN_LON = 128, OCEAN_LAT = 64; // グリッド解像度(軽め)
const OCEAN_CELLS = OCEAN_LON * OCEAN_LAT;
const OCEAN_G = 0.111;         // 重力(演出用の無次元値)。波の伝播速度∝√(g·H)を
                                // 従来の1/3にするため、gを1/9にしている
const OCEAN_H = 1.0;           // 平均"水深"
const OCEAN_DAMPING = 0.16;    // 減衰係数(前回の0.07だと、線形な系では散逸が
                                // 弱すぎ、少数の共振モードが減衰しないまま
                                // 目立ち続けて「幾何学的」に見える一因になって
                                // いた。非線形移流項の追加と合わせて強めた。
const OCEAN_F0_PEAK = 0.4;    // コリオリ係数のピーク強さ(緯度に応じて流れを曲げる)。
                                // 「強めると全く見えないか異常終了するかの二択になる」の原因は
                                // コリオリ自体の強さではなく、高緯度の数値不安定だった(上の
                                // oceanPoleMask・cosLatクランプのコメント参照)。その2点を直した
                                // 上で、0.4はNode.js上での実測(複数の乱数シードで60〜70秒以上
                                // 安定)で確認済みの値。実際に効く強さはこのピーク値に、海流の周期
                                // (CURRENT_CYCLE_PERIOD)で0〜1を往復するcoriolisCycleEnvelope()(下で定義)を掛けたもの。
                                // 「厳密さより作品として面白いほうを優先する」方針による演出で、対流が
                                // 強い時間帯・ほぼ止まる時間帯が周期的に訪れる。
const OCEAN_SUBSTEPS = 2;      // 1フレームあたりの積分回数。forward-backward法(stepOcean参照)は
                                // CFL(c·dt/dx≈0.11)に対して十分安定なので、旧6回から減らした
const OCEAN_VISC = 0.001;      // 格子スケールの振動を抑える弱い粘性(η,u,vのラプラシアン係数)

// ---- クリックの渦(見た目専用。シミュレーション本体には力を加えない) ----
const VORTEX_FORCE_MAX = 6;   // 同時に効かせる渦の最大数(古いものから捨てる。spectral_ocean.js側のVORTEX_MAXと一致させること)
const VORTEX_RADIUS   = 0.16; // 渦の広がり(rad)。「大きくしなくてよい、むしろ小さい方がいい」との指示で縮小(0.30→0.42と広げていたのを、それより小さい0.16へ)
// 【クリック時の見た目(VORTEX_SPIN_MAX)について。これまでの経緯】
// 最初は「ηの式(浅水方程式のシミュレーション状態そのもの)に直接インパルスを
// 加えて盛り上がりを作る」→ 非線形項(移流)がうまく吸収しきれず、収まらない
// 変な波が居座る、という問題が起きた。次に「見た目だけの盛り上がり(ドーム状)」
// に変えたが、今度はユーザーから「求めているのは回転の渦であってドームでは
// ない」と訂正が入った。そこで「シミュレーション状態には一切触れず、頂点
// シェーダだけで粒子の表示位置をRodriguesの回転公式で巻き込む」方式(spinDir)
// に変更した。ところが、これとは別に、浅水シミュレーション本体(u,v)の方にも
// 実際の力として同じ渦の回転(VORTEX_STRENGTH)を加える処理がずっと残って
// おり、その力が他の力(風など)より一桁以上強かったため、非線形な移流項を
// 含むこのシミュレーションを不安定化させ、クリックのたびに「波の動き全体が
// 二度と元に戻らなくなる」不具合を起こしていた。見た目の回転は上のspinDirで
// 完全にまかなえており、このu,vへの力は不要かつ危険なだけだったため、
// stepOcean()側から完全に削除した(=クリックはoceanU/oceanV/oceanEtaと
// いった永続状態には一切触れない)。
const VORTEX_SPIN_MAX = 9.0; // rad(2π超=中心付近では1回転以上)。前回3.4でもまだ「回転量が全然足りない」との
// 指摘を受け、大幅に引き上げた。見た目専用の回転(シミュレーション状態には触れない)なので、
// 大きさは範囲(VORTEX_RADIUS)ではなく専らこの角度で調整する。
const VORTEX_CORE_RADIUS = 0.04; // rad。この半径に近いほど角速度が強くなる「芯」の大きさ(中心そのものは幾何的に不動)。VORTEX_RADIUSを縮小したのに合わせて芯も小さく
// 「回転後に元へ戻る動き(巻き戻し)が一番の不満」というフィードバックを受け、
// 見た目の回転は「速く巻き始め、非常にゆっくり静まる」タイムラインにしてある。
// RELEASEを長く取ることで、はっきり見えるような不自然な巻き戻しではなく、
// 実際の水がゆっくり落ち着いていくような印象に近づける。
// (本当の意味で「元に戻らない」永続的な変形にするには、E/F泡状態と同様の
// 拡散・減衰する永続フィールドを新設する必要があり、これはより大きな変更になる)
const VORTEX_VIS_RAMP    = 0.3;  // s, 見た目の回転の立ち上がり
const VORTEX_VIS_HOLD    = 0.6;  // s, 見た目の回転を維持する時間
const VORTEX_VIS_RELEASE = 7.0;  // s, 見た目の回転がゆっくり静まる時間(長めにして「巻き戻し」感を消す)
// ---- 大域循環の"感触"を足す、見た目専用の緯度バイアス ----
// コリオリ(OCEAN_F0_PEAK)自体は浅水シミュレーションの中で物理的に効いているが、
// その効果(高さ・流れへの影響)は実測で±0.01〜0.03程度とごく小さく、画面
// 全体で「回っている」と感じられるほどの強さを安全な範囲で出すのは難しい。
// 理論的な厳密さは不要とのことなので、別のアプローチとして、表示位置にだけ
// ごく緩やかな経度方向のドリフトを足す。sin(緯度)cos(緯度)の形(符号は北半球と
// 南半球で逆、強さは赤道と極でゼロ・中緯度で最大)にすることで、実際の
// コリオリ係数と同じ緯度依存の"感触"を再現しつつ、シミュレーション状態には
// 一切触れない(=安定性のリスクがない)。既存の波(waveH等、振幅ははるかに
// 大きい)の上に乗るだけなので、単純な円運動そのものには見えず、「全体が
// ゆっくり反対向きに回っている」感触だけが重なって見えるはず。
// 【「瞬間の強さ」を積分して回転角にしていたのをやめた理由】
// 以前は毎フレーム「今の強さ×dt」を足し込み続ける方式(gyreAccumAngle)だった。
// これだと強さが周期の中で一瞬0になっても、それは「その場で回転が止まる」
// だけで、「回転していなかった頃の配置に戻る」わけではない(足し込んだ量は
// 減らない・リセットされない)。「嵐(強い時間帯)」と「凪(弱い時間帯)」を
// 見た目ではっきり対比させたいなら、凪のときは本当に"無回転の基準状態"に
// 戻っている必要がある。
// そこで方針を変更: GYRE_ANGLE_PEAKは「角速度(rad/秒)」ではなく「回転角
// そのもの(rad)」とし、今の回転角を毎フレーム
// 「GYRE_ANGLE_PEAK × coriolisCycleEnvelope(今の時刻)」として直接(積分せず)
// 求める。coriolisCycleEnvelope自体が0→1→0をきれいに往復する関数なので、
// 強さが0の瞬間は回転角も必ずちょうど0になり(=本当に無回転の基準配置に戻る)、
// 強さがピークに近づくほど、ねじれが最大まではっきり戻ってくる。CPU側で
// 積算・保持する状態が不要になった(毎フレーム独立に計算し直せる)ので、
// frameLoop側のgyreAccumAngleやそれを運ぶuniform(vortexMeta.x)も撤去し、
// 頂点シェーダ側でcoriolisCycleEnvelopeと全く同じ式を直接計算する。
const GYRE_ANGLE_PEAK = 15.0; // rad(中緯度・周期のピーク時の最大回転角)。
// 「積算式→直接式への変更で回転感がかなり減った、MAX時あと5倍ぐらい循環して
// ほしい」との指摘を受け、3.0→15.0(5倍)に引き上げた。旧「積算」方式は
// リセットなしに伸び続ける量だったため(ピーク速度3.0rad/秒を350秒周期の
// うち強い時間帯ぶん積分すると、実際には1周期で数十回転ぶんにまで達して
// いた)、同じ見映えを「上限のある角度」方式で出すには、この値自体を
// 大きくする必要がある。中緯度(sin·cos最大0.5)・周期ピーク時で
// 0.5×15.0=7.5rad(1周強)まで振れる。見た目専用の回転なので、ここを
// 大きくしても安定性への影響はない。
const activeVortices = []; // {x,y,z (中心方向, 単位ベクトル), t0 (発生時刻), sign (+1/-1)}
function spawnVortex(dir, t0) {
  const sign = activeVortices.length % 2 === 0 ? 1 : -1; // 交互に回転方向を変える(単調さを避ける)
  activeVortices.push({ x: dir.x, y: dir.y, z: dir.z, t0, sign });
  if (activeVortices.length > VORTEX_FORCE_MAX) activeVortices.shift();
}
function pruneVortices(simTime) {
  // 見た目の回転(VORTEX_VIS_*)の寿命が尽きるまでは配列に残しておく
  // (早く消すと、回転が終わる前にGPUへ渡すデータが消えてしまう)。
  const visLife = VORTEX_VIS_RAMP + VORTEX_VIS_HOLD + VORTEX_VIS_RELEASE;
  const life = visLife + 1.0;
  while (activeVortices.length > 0 && simTime - activeVortices[0].t0 > life) activeVortices.shift();
}
const OCEAN_FADE_IN_DUR = 4.0; // 鼓動開始からの強制フェードイン秒数
const OCEAN_TIDE_AMP = 0;    // 潮汐強制の強さ。「潮汐は一旦除外」の指示により無効化(元は0.3)。月マーカー(mode=4)自体は表示したままなので影響しない
const OCEAN_WIND_AMP = 0.167;  // 風応力強制の強さ(従来の1/3)
const OCEAN_HEIGHT_SCALE = 0.0084; // 粒子の半径方向変位への最終スケール(従来の1/3 → さらに半分)
const OCEAN_TIME_SCALE = 1 / 3;    // 強制項(風)が時間変化する速さ(従来の1/3)

// ---- 月(潮汐の力源) ----
// 月は画面左側に固定(周回させない)。将来的に光源としての月の位置と
// 合わせる場合は、この向きベクトルをその光源の方向に差し替える。
// x=-1が「左」になっているかはカメラ設定次第なので、実際に見て
// 逆であれば符号や軸を入れ替える。
// 月はY軸まわりにゆっくり公転させる(周期MOON_ORBIT_PERIOD秒)。これにより
// 潮汐のふくらみが経度方向にゆっくり掃引し、「動く潮汐」として見える。
const MOON_ORBIT_PERIOD = 350; // 秒(見た目のための時間スケールで、実際の月の周期とは無関係)。
// 海流(コリオリ/GYRE_ANGLE_PEAK)の1サイクルは月の公転の 1/MOON_CALM_COUNT。
// つまり月が1周する間に、海流の凪(強さがちょうど0になる瞬間)がちょうどMOON_CALM_COUNT回来て、
// 月が1周し終わるたびに海流も同じ状態に戻る(位相はページ読み込みごとにランダムだが、この関係は崩れない)。
// 波の振幅の周期(WAVE_AMP_PERIOD)は逆に月の公転と同じ長さ(月が1周するあいだに振幅の凪が1回)。
const MOON_CALM_COUNT = 10;
const CURRENT_CYCLE_PERIOD = MOON_ORBIT_PERIOD / MOON_CALM_COUNT; // 35秒
// 公転面の傾き(sin(傾き角)相当)。「地球に対して軌道が高く見える」という
// 指摘のとおり、以前はyに定数0.18を足しているだけで、公転面を傾けている
// つもりが実際には常に赤道面より北側に浮いたまま一周する(半径1の円としても
// 単位ベクトルとしても不正確)という不具合になっていた。単位円をx軸まわりに
// 傾けた、正しく南北へ均等に振れる軌道に直す。
const MOON_ORBIT_TILT = 0.18; // sin(傾き)相当(以前の定数オフセットと近い見た目になる値)
function moonDirAt(t) {
  const a = (t / MOON_ORBIT_PERIOD) * 2 * Math.PI;
  const sinI = MOON_ORBIT_TILT;
  const cosI = Math.sqrt(Math.max(0, 1 - sinI * sinI));
  return { x: Math.cos(a), y: sinI * Math.sin(a), z: cosI * Math.sin(a) };
}

// ---- コリオリ(と、見た目だけの大域循環ドリフトGYRE_ANGLE_PEAK)の強さを、
// 海流の周期(CURRENT_CYCLE_PERIOD=月の公転の1/MOON_CALM_COUNT)で0〜1でなめらかに往復させる ----
// 「厳密さはないが、対流が強い/ほぼ止まる時間帯が周期的に訪れる方が作品として
// 面白い」という方針による演出。初期位相はページ読み込みごとにランダムにして
// いるので、起動直後(湖から惑星が形成される導入部)に対流がどれくらいの
// 強さで起きているかは毎回変わる。
// 【月の1周と凪の回数がそろうことについて】 moonDirAt()の角度は「経過秒数 ÷ MOON_ORBIT_PERIOD」、
// この関数のθは「経過秒数 ÷ CURRENT_CYCLE_PERIOD」で、後者は前者のちょうど 1/MOON_CALM_COUNT
// (整数分の1)。(位相CORIOLIS_CYCLE_PHASEはθの中身を前後にずらすだけで、周期そのものは変えない)
// ので、ランダムな初期位相があっても、月が1周するあいだに凪はちょうどMOON_CALM_COUNT回来て、
// 1周し終わるたびに月も海流も同時に元の状態へ戻る。
// 単純な(1-cosθ)/2の往復ではなく2乗していることについて: 「0〜0.1あたりは
// ゆっくり、1.0〜3.0あたりは比較的速く」という指示を受けたもの。当初3乗に
// していたところ、0付近があまりに平らになりすぎて「ずっと一定のまま」に
// 見えてしまったため、2乗に緩めた(それでも0付近で長めに留まり、1に近い
// ところで相対的に速く動く非対称さは保たれる)。あわせて周期自体も5倍に
// 延ばしたことで、1サイクルあたりの積算の変化量(角速度の時間積分)も比例して
// 5倍に増えるため、低い側での動きも以前よりずっと体感しやすくなっているはず。
const CORIOLIS_CYCLE_PHASE = Math.random() * CURRENT_CYCLE_PERIOD;
function coriolisCycleEnvelope(t) {
  const raw = (1 - Math.cos((2 * Math.PI * (t + CORIOLIS_CYCLE_PHASE)) / CURRENT_CYCLE_PERIOD)) / 2; // 0..1、対称な単純往復
  return raw * raw; // 0付近でやや長く留まり、1に近いところで相対的に速く動くよう歪める(以前の3乗は平らすぎた)
}

// 太陽の方向(固定・簡易近似)。
// 【新月にならない、という指摘について】以前はSUN_DIRを(1, 0.35, -0.6)方向
// 付近の適当な値にしていたが、そのyの値(0.35を正規化した約0.287)が、月の
// 軌道が取り得るyの範囲(|y|<=sin(MOON_ORBIT_TILT)≈0.179)を超えていた。
// つまり月がどれだけ公転しても、軌道面(=moonDirAtが描く円)がSUN_DIRの
// 方向を幾何的に一切通過できず、新月(月が太陽と同じ方向に来て、地球から
// 見える面が完全に影になる状態)には原理的に絶対ならない、という不具合
// だった。SUN_DIRを、moonDirAtと全く同じ軌道面の式を使って(=同じ楕円の
// 上にある1点として)定義し直すことで、月が公転で必ずその方向を通過できる
// (=新月・満月が実際に起こる)ようにする。
const MOON_SUN_ANGLE = 0.9; // rad。軌道上のどの角度を「新月の瞬間」にするかは任意
const SUN_DIR = (() => {
  const sinI = MOON_ORBIT_TILT;
  const cosI = Math.sqrt(Math.max(0, 1 - sinI * sinI));
  const a = MOON_SUN_ANGLE;
  return { x: Math.cos(a), y: sinI * Math.sin(a), z: cosI * Math.sin(a) };
})();

const oceanEta = new Float32Array(OCEAN_CELLS);
const oceanU = new Float32Array(OCEAN_CELLS);
const oceanV = new Float32Array(OCEAN_CELLS);
const oceanEtaNext = new Float32Array(OCEAN_CELLS);
const oceanUNext = new Float32Array(OCEAN_CELLS);
const oceanVNext = new Float32Array(OCEAN_CELLS);
// GPUへアップロードする最終バッファ(高さ場η×スケール)。
// WebGLフォールバックのサンプリングもこの配列を直接読む。
const oceanHeightGPU = new Float32Array(OCEAN_CELLS);
// 流れ場(u,vインターリーブ)。SH海面のcompute passが、砕波の跡(泡・エネルギー欠損)を
// この流れに乗せて運ぶために読む(単位: rad/秒の弧長速度。uは東向き、vは北向き)。
const oceanUVGPU = new Float32Array(OCEAN_CELLS * 2);

function oceanIdx(i, j) { return j * OCEAN_LON + i; }

// 極付近: 「コリオリを強めると、見える時と全く見えない/異常終了するときの
// 二択になる」という報告を受け、このファイルの浅水シミュレーションを単体で
// 切り出して(Node.js上でheadlessに)数十パターン実測したところ、原因が
// 判明した。緯度75〜83度あたりで、cosLatクランプ(下の0.5)が実際の
// cosLat(例えば80度ではcos80°≒0.17)よりずっと大きい値を使ってしまうため、
// CFL条件の計算上は安定に見えても実際の格子間隔はその通りには広くなく、
// (強めたコリオリ+特定の風ノイズ乱数の組み合わせで)弱い不安定が育って
// 60秒前後で急激に発散する、という現象だった(発散するかどうかは起動時に
// ランダムに決まる風のパラメータ次第で変わるため、まさに「二択」に見えていた)。
// 実測で確認した対策: (1) この極マスクの範囲を85〜89度から65〜85度へ広げる、
// (2) cosLatクランプの下限を0.5→0.7へ上げる。両方を組み合わせることで、
// コリオリ係数0.4・0.8のどちらでも、複数の乱数シードにわたって発散しなく
// なることを確認済み(詳細はgraphics-learnings参照)。
function oceanPoleMask(latRad) {
  const latDeg = Math.abs(latRad) * 180 / Math.PI;
  return 1.0 - smoothstepJS(65, 85, latDeg);
}

// ---- 風応力(広帯域の擬似ノイズ) ----
// 波数・速度・位相をランダムに振った正弦波を多数(WIND_NOISE_TERMS個)
// 重ねる「ランダムフーリエ和」。項が2〜3個だと、どうしても「重なった
// 正弦波」に見えてしまう(=幾何学的)。項数を増やし、波数の範囲も
// 大〜小まで広く散らすことで、Tessendorf型の海洋スペクトルに近い、
// きめの細かい broadband なノイズに近づける。パラメータは起動時に
// 1回だけ生成し(毎フレーム再生成すると場が安定しない)、以後は
// 時間発展のみで動かす。
const WIND_NOISE_TERMS = 14;
const windNoiseParams = [];
for (let k = 0; k < WIND_NOISE_TERMS; k++) {
  const sign = () => (Math.random() < 0.5 ? -1 : 1);
  windNoiseParams.push({
    kLon: sign() * (0.5 + Math.random() * 9), // 経度方向の波数(大きいほど細かい縞)
    kLat: sign() * (0.5 + Math.random() * 6),
    speed: sign() * (0.15 + Math.random() * 0.5),
    phase: Math.random() * Math.PI * 2,
    ampX: sign() * (0.4 + Math.random() * 0.6),
    ampY: sign() * (0.4 + Math.random() * 0.6),
  });
}
// updateOcean()内で1フレームに1回だけ埋め、stepOcean()は各サブステップ
// でこれを読むだけにする(強制項の再計算をサブステップ回数ぶん
// 繰り返さないための最適化)。
const windForceX = new Float32Array(OCEAN_CELLS);
const windForceY = new Float32Array(OCEAN_CELLS);

// ---- 東西の風帯(貿易風・偏西風のような、緯度帯ごとに向きが反転する
// "持続的な"風)。コリオリが循環(渦を巻く海流)を組織化するには、瞬間瞬間で
// 向きがバラバラなノイズだけでは種になる大きな構造がなく、いくら
// コリオリを強めても「局所的にバラバラの向きを曲げるだけ」=完全ランダムにしか
// 見えなかった。実際の海洋大循環(還流)も、まさにこの「緯度帯ごとに向きが
// 決まった持続的な風」+コリオリで生まれる。上のWIND_NOISE_TERMS(細かい
// テクスチャとしての波のランダム性)はそのまま残しつつ、これとは別に大域的な
// 帯を足すことで、両立させる。帯の向きの反転位置(位相)と強さを経度・時間で
// ごくわずかに揺らし、完全に静止した縞模様(=幾何学的)に見えないようにする。
const WIND_BELT_BANDS = 3;    // 南北にいくつの帯を作るか(帯ごとに東西の向きが反転)
const WIND_BELT_AMP   = 0.8;  // 帯状の風の強さ(既存のノイズ成分と同程度〜やや強め)
const WIND_BELT_WOBBLE_LON  = 0.35; // 経度方向のゆらぎの大きさ(帯の境界を完全な緯度線にしない)
const WIND_BELT_WOBBLE_TIME = 0.03; // ゆらぎがゆっくり時間変化する速さ

function computeWindForce(st) {
  const dLon = (2 * Math.PI) / OCEAN_LON;
  const dLat = Math.PI / OCEAN_LAT;
  for (let j = 0; j < OCEAN_LAT; j++) {
    const lat = -Math.PI / 2 + (j + 0.5) * dLat;
    for (let i = 0; i < OCEAN_LON; i++) {
      const lon = i * dLon;
      let wx = 0, wy = 0;
      for (let k = 0; k < WIND_NOISE_TERMS; k++) {
        const p = windNoiseParams[k];
        const phase = p.kLon * lon + p.kLat * lat - st * p.speed + p.phase;
        const s = Math.sin(phase);
        wx += s * p.ampX;
        wy += Math.cos(phase) * p.ampY; // sin/cosで少しずらし、x/yが完全に同期しないようにする
      }
      // 持続的な東西の風帯: 緯度でWIND_BELT_BANDS本に分かれ、隣同士は逆向き。
      // 境界線・強さを経度と時間でわずかに揺らし、定規で引いたような
      // 縞に見えないようにする(帯そのものは向き・大まかな位置を保つ)。
      // ※ノイズ成分(wx)とは違うスケールの量なので、/WIND_NOISE_TERMSの
      // 対象には含めない(先に平均化してから帯を足す)。
      const wobble = Math.sin(lon * 1.4 + st * WIND_BELT_WOBBLE_TIME) * WIND_BELT_WOBBLE_LON;
      const beltAmt = Math.sin(lat * WIND_BELT_BANDS * 2 + wobble);
      const idx = oceanIdx(i, j);
      windForceX[idx] = wx / WIND_NOISE_TERMS + beltAmt * WIND_BELT_AMP;
      windForceY[idx] = wy / WIND_NOISE_TERMS;
    }
  }
}

function stepOcean(dt, simTime, forceAmp) {
  const dLon = (2 * Math.PI) / OCEAN_LON;
  const dLat = Math.PI / OCEAN_LAT;
  const moon = moonDirAt(simTime);

  // 【安定化の修正】旧実装は、ηとu,vを同じ旧値から同時に前進オイラーで進めて
  // いた。これは重力波に対して(中心差分+前進オイラー)の組み合わせになり、
  // 増幅率が√(1+(ωdt)²)>1 の「弱い不安定」になる。減衰(u,vのみ)より増幅が
  // 大きい高緯度(dxが小さい)の高波数から育ち、鼓動開始から10〜20秒で
  // 格子スケールのノイズがクランプ上限(±5)まで飽和していた(実測)。
  //   1段目: 連続の式でηを更新(u,vは旧値)
  //   2段目: 運動方程式を「更新後のη」の勾配で進める(forward-backward法)
  // にすると、重力波・コリオリ項はCFL条件(c·dt/dx<1)の範囲で安定になる。
  // さらに移流の中心差分が生む格子スケールの振動を抑えるため、弱い粘性
  // (OCEAN_VISC)を全変数に足している。
  for (let j = 0; j < OCEAN_LAT; j++) {
    const lat = -Math.PI / 2 + (j + 0.5) * dLat;
    const cosLat = Math.max(Math.cos(lat), 0.7); // CFL安定性のため緯度60度相当を下限にクランプ(0.5だと緯度75〜83度で実際のdxを過大評価し、コリオリを強めた際に発散した。実測を踏まえ0.7へ)
    const sinLat = Math.sin(lat);
    const dx = cosLat * dLon;
    const mask = oceanPoleMask(lat);
    const jm = Math.max(j - 1, 0), jp = Math.min(j + 1, OCEAN_LAT - 1);
    for (let i = 0; i < OCEAN_LON; i++) {
      const ip = (i + 1) % OCEAN_LON, im = (i - 1 + OCEAN_LON) % OCEAN_LON;
      const idx = oceanIdx(i, j);
      const lonRaw = i * dLon - Math.PI; // sampleOceanHeightJSの逆変換(lon = atan2(z,x)+π)に合わせる

      const duDx = (oceanU[oceanIdx(ip, j)] - oceanU[oceanIdx(im, j)]) / (2 * dx);
      const dvDy = (oceanV[oceanIdx(i, jp)] - oceanV[oceanIdx(i, jm)]) / (2 * dLat);
      const eta0 = oceanEta[idx];
      const lapEta = (oceanEta[oceanIdx(ip, j)] + oceanEta[oceanIdx(im, j)] - 2 * eta0) / (dx * dx)
                   + (oceanEta[oceanIdx(i, jp)] + oceanEta[oceanIdx(i, jm)] - 2 * eta0) / (dLat * dLat);

      // 潮汐: 月の方向ベクトルとの成す角θから、現実の平衡潮汐と同じ形
      // (3cos²θ-1: 月に近い面とその真裏の両方が盛り上がる)を作る。
      const cx = cosLat * Math.cos(lonRaw), cy = sinLat, cz = cosLat * Math.sin(lonRaw);
      const cosTheta = cx * moon.x + cy * moon.y + cz * moon.z;
      const tide = (3 * cosTheta * cosTheta - 1) * 0.5;

      let etaNext = eta0 + dt * (-OCEAN_H * (duDx + dvDy) + tide * OCEAN_TIDE_AMP * forceAmp + OCEAN_VISC * lapEta);
      if (!Number.isFinite(etaNext)) etaNext = 0;
      etaNext = Math.max(-5, Math.min(5, etaNext));
      oceanEtaNext[idx] = etaNext * mask;
    }
  }

  const oceanF0Now = OCEAN_F0_PEAK * coriolisCycleEnvelope(simTime); // 海流の周期で0〜ピークを往復する、今この瞬間のコリオリ係数
  for (let j = 0; j < OCEAN_LAT; j++) {
    const lat = -Math.PI / 2 + (j + 0.5) * dLat;
    const cosLat = Math.max(Math.cos(lat), 0.7); // 上の積分と同じ理由で0.5→0.7
    const dx = cosLat * dLon;
    const f = oceanF0Now * Math.sin(lat); // コリオリパラメータ(緯度依存)
    const sinLat = Math.sin(lat); // クリックの渦(東西・南北成分への射影)で使う
    const mask = oceanPoleMask(lat);
    const jm = Math.max(j - 1, 0), jp = Math.min(j + 1, OCEAN_LAT - 1);
    for (let i = 0; i < OCEAN_LON; i++) {
      const ip = (i + 1) % OCEAN_LON, im = (i - 1 + OCEAN_LON) % OCEAN_LON;
      const idx = oceanIdx(i, j);

      // 圧力項は更新後のη(oceanEtaNext)の勾配
      const detaDx = (oceanEtaNext[oceanIdx(ip, j)] - oceanEtaNext[oceanIdx(im, j)]) / (2 * dx);
      const detaDy = (oceanEtaNext[oceanIdx(i, jp)] - oceanEtaNext[oceanIdx(i, jm)]) / (2 * dLat);
      // 非線形移流項(u・∇u, u・∇v): 速度場が自分自身を引きずって新しい
      // 周波数・スケールを生む(エネルギーカスケード)。旧実装のコメント参照。
      const duDx = (oceanU[oceanIdx(ip, j)] - oceanU[oceanIdx(im, j)]) / (2 * dx);
      const dvDy = (oceanV[oceanIdx(i, jp)] - oceanV[oceanIdx(i, jm)]) / (2 * dLat);
      const duDy = (oceanU[oceanIdx(i, jp)] - oceanU[oceanIdx(i, jm)]) / (2 * dLat);
      const dvDx = (oceanV[oceanIdx(ip, j)] - oceanV[oceanIdx(im, j)]) / (2 * dx);

      // 風応力: updateOcean()側で1フレームに1回だけ計算済みの広帯域
      // ノイズ場を読むだけ(力として方程式に加わり、質量のある系が
      // 分散・伝播させた結果が波になる)。
      const windX = windForceX[idx];
      const windY = windForceY[idx];

      // 【クリックの渦をこのシミュレーション本体(u,v)から完全に外した理由】
      // 以前はここで「軸mまわりの剛体回転」速度場を実際の力としてu,vへ加えて
      // いたが、VORTEX_STRENGTHが風(windX*OCEAN_WIND_AMP)などの他の力に比べて
      // 一桁以上大きく、この非線形な移流項(advU/advV)を含む浅水シミュレーションに
      // 強い局所的なキックを繰り返し打ち込む形になっていた。その結果、クリックの
      // たびに全体の波が異常な状態のまま戻らなくなる(=波の動きが永久に壊れる)
      // 不具合が発生した。見た目の「回転する渦」自体は、この力とは完全に独立な
      // 頂点シェーダ側だけの一時的な回転(Rodriguesの回転公式。VORTEX_SPIN_MAX
      // など)で既にまかなえているため、シミュレーション本体を壊すリスクだけが
      // 残るこの力はここで完全に取り除いた(=クリックはoceanU/oceanV/oceanEtaと
      // いった永続状態には一切触れない)。
      const vortexU = 0, vortexV = 0;

      const u0 = oceanU[idx], v0 = oceanV[idx];
      const advU = u0 * duDx + v0 * duDy; // 移流項(u・∇u)
      const advV = u0 * dvDx + v0 * dvDy; // 移流項(u・∇v)
      const lapU = (oceanU[oceanIdx(ip, j)] + oceanU[oceanIdx(im, j)] - 2 * u0) / (dx * dx)
                 + (oceanU[oceanIdx(i, jp)] + oceanU[oceanIdx(i, jm)] - 2 * u0) / (dLat * dLat);
      const lapV = (oceanV[oceanIdx(ip, j)] + oceanV[oceanIdx(im, j)] - 2 * v0) / (dx * dx)
                 + (oceanV[oceanIdx(i, jp)] + oceanV[oceanIdx(i, jm)] - 2 * v0) / (dLat * dLat);
      let uNext = u0 + dt * (-advU - OCEAN_G * detaDx + f * v0 - OCEAN_DAMPING * u0 + OCEAN_VISC * lapU + windX * OCEAN_WIND_AMP * forceAmp + vortexU);
      let vNext = v0 + dt * (-advV - OCEAN_G * detaDy - f * u0 - OCEAN_DAMPING * v0 + OCEAN_VISC * lapV + windY * OCEAN_WIND_AMP * forceAmp + vortexV);
      // 数値的な発散に対する保険(万一CFL条件が破れても、粒子が吹き飛ぶ
      // ような極端な値・NaNが後段(GPUアップロード)に伝播しないようにする)。
      if (!Number.isFinite(uNext)) uNext = 0;
      if (!Number.isFinite(vNext)) vNext = 0;
      uNext = Math.max(-5, Math.min(5, uNext));
      vNext = Math.max(-5, Math.min(5, vNext));
      oceanUNext[idx] = uNext * mask;
      oceanVNext[idx] = vNext * mask;
    }
  }
  oceanEta.set(oceanEtaNext);
  oceanU.set(oceanUNext);
  oceanV.set(oceanVNext);
}

// 毎フレーム1回だけ呼ぶ(粒子ごとではない)。鼓動開始(一周の波紋が
// 静まった後)より前は強制項ゼロのまま据え置き、開始後は
// OCEAN_FADE_IN_DUR秒かけて滑らかに立ち上げる。
function updateOcean(dt, simTime, lakeElapsed) {
  const vibElapsed = lakeElapsed < 0 ? -1 : Math.max(0, lakeElapsed - LAKE_HOLD);
  const mainLapDur = LAKE_EXPAND_DUR + LAKE_VIB_RETURN_DUR;
  let forceAmp = 0;
  if (vibElapsed > mainLapDur) {
    forceAmp = smoothstepJS(0, OCEAN_FADE_IN_DUR, vibElapsed - mainLapDur);
  }
  pruneVortices(simTime);
  const st = simTime * OCEAN_TIME_SCALE; // 強制項の時間経過を1/3に減速
  computeWindForce(st); // 1フレームに1回だけ(サブステップ間で使い回す)
  // dtが大きすぎる(タブがバックグラウンドから復帰した直後など)場合、
  // サブステップ数を増やしてCFL条件を保つ(通常フレームでは1回のみ)。
  const baseSubDt = (1 / 60) / OCEAN_SUBSTEPS;
  const steps = Math.min(64, Math.max(OCEAN_SUBSTEPS, Math.ceil(dt / baseSubDt - 1e-6)));
  const subDt = dt / steps;
  for (let s = 0; s < steps; s++) {
    stepOcean(subDt, simTime, forceAmp);
  }
  for (let k = 0; k < OCEAN_CELLS; k++) {
    const h = oceanEta[k] * OCEAN_HEIGHT_SCALE;
    oceanHeightGPU[k] = Number.isFinite(h) ? h : 0;
    oceanUVGPU[2 * k] = Number.isFinite(oceanU[k]) ? oceanU[k] : 0;
    oceanUVGPU[2 * k + 1] = Number.isFinite(oceanV[k]) ? oceanV[k] : 0;
  }
  return forceAmp; // チョップ層(sampleChop)のフェードインにも同じ値を使う
}

// ============================================================
// チョップ層(分散性のあるランダムな波)
// ------------------------------------------------------------
// 浅水シミュレーションは「浅水波(速度が波長によらず一定)」の近似
// なので、これ単体だと本物の海面のような"波長ごとに速さが違う"
// 分散性が出ない(=時間が経っても模様がそのまま平行移動して見え、
// 幾何学的に見える一因になっていた)。ここでは、実際の深水波の分散
// 関係 ω=√(g·k) を持つ平面波を多数(球面上では基準軸からの角度で
// 定義した同心円状の波)重ね合わせる、Gerstner波の簡易版を追加する。
// 波長(角波数n)が大きい(=波長が短い)ものほどωは大きい(振動は速い)が
// 位相速度ω/nは遅い、という現実の「うねりは速く追い越していき、
// さざ波はその場でチリチリ震える」関係になる。
// 浅水シミュレーション(状態を持つPDE)とは違い、こちらは時刻tの
// 純粋な関数(状態を積分しない)なので、CFL等の安定性の心配がない。
// ============================================================
const SWELL_TERMS = 3;      // ベースとなる「うねり」の項数(少数・大波長・高振幅)
const CHOP_FINE_TERMS = 21; // 細かいチョップの項数
const CHOP_TERMS = SWELL_TERMS + CHOP_FINE_TERMS;
const CHOP_G = 0.35;        // この層専用の重力(分散関係ω=√(CHOP_G・n)用)
const CHOP_AMP_SCALE = 0.01; // 旧チョップ層の高さスケール(WebGLフォールバック専用。WebGPUはSH海面に置換済み。従来の半分)
const CHOP_N_MIN = 5, CHOP_N_MAX = 30; // 細かいチョップの角波数(うねり側と被らないよう5から)

const chopWaves = [];
// ---- ベースとなる「うねり」----
// 「波が局所で動いているだけで流れがない」という問題への対処。
// 球面上での"流れる波"は、平面波の球面版として自然に作れる: 軸ベクトル
// を1本決め、そこからの角距離θを使ってsin(n·θ - ω·t)とすると、
// 位相が一定の面(=波の山)がθ方向に等速で移動する、正真正銘の進行波
// になる(軸を中心に輪が広がっていくように見える)。これは平面波の
// 概念をそのまま球面に持ち込んだもので、球体だから使えない、という
// ことはない。細かいチョップ(下)は項が21個もあり、方向もバラバラな
// ため個々の"流れ"が互いに打ち消し合って見えにくくなっていた。ここでは
// 少数(3個)・大波長(n小さめ)・高振幅の項を別枠として用意し、この
// 「ベースの流れ」がまず目に見える主役になるようにする。
for (let i = 0; i < SWELL_TERMS; i++) {
  const u = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  const n = 1.2 + i * 0.9 + Math.random() * 0.4; // 1.2〜3.5程度。球を1〜3周ぶんの大きなうねり
  chopWaves.push({
    ax: s * Math.cos(phi), ay: u, az: s * Math.sin(phi),
    n,
    omega: Math.sqrt(CHOP_G * n) * 1.6, // 流れが目で見て分かる速さになるよう少し強調
    amp: 2.2,                          // 細かいチョップよりずっと高い振幅
    phase0: Math.random() * Math.PI * 2,
  });
}
// ---- 細かいチョップ(従来通り) ----
for (let i = 0; i < CHOP_FINE_TERMS; i++) {
  // 球面上のランダムな向き(基準軸)。一様分布になるようuを一様乱数にする。
  const u = Math.random() * 2 - 1;
  const phi = Math.random() * Math.PI * 2;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  const n = CHOP_N_MIN + Math.random() * (CHOP_N_MAX - CHOP_N_MIN);
  chopWaves.push({
    ax: s * Math.cos(phi), ay: u, az: s * Math.sin(phi),
    n,
    omega: Math.sqrt(CHOP_G * n),
    amp: 1 / Math.pow(n, 0.8), // 波長が長い(nが小さい)ほど高振幅寄り。前回(指数1.1)は
                                // 高波数(細かいさざ波)が潰れすぎていたため緩めた。
    phase0: Math.random() * Math.PI * 2,
  });
}

// 単位球面座標(x,y,z)と時刻tから、分散性のあるチョップ層の高さを
// サンプリングする(WebGL/JSフォールバック用。WGSL版のsampleChop()と
// 同じ式にすること)。
function sampleChopJS(x, y, z, t) {
  let h = 0;
  for (let i = 0; i < CHOP_TERMS; i++) {
    const w = chopWaves[i];
    const d = Math.max(-1, Math.min(1, x * w.ax + y * w.ay + z * w.az));
    const theta = Math.acos(d);
    h += w.amp * Math.sin(w.n * theta - w.omega * t + w.phase0);
  }
  return h * CHOP_AMP_SCALE;
}

// WGSL側に埋め込む定数配列と関数を、JS側と全く同じ乱数パラメータ
// (chopWaves)から生成する(数値を二重管理しないため)。
function wgslF(x) { return x.toFixed(6); }
const CHOP_WGSL_ARRAY = chopWaves.map(w =>
  `${wgslF(w.ax)}, ${wgslF(w.ay)}, ${wgslF(w.az)}, ${wgslF(w.n)}, ${wgslF(w.omega)}, ${wgslF(w.amp)}, ${wgslF(w.phase0)}`
).join(',\n  ');
const CHOP_WGSL_FN = `
const CHOP_TERMS_U: u32 = ${CHOP_TERMS}u;
const chopWaves = array<f32, ${CHOP_TERMS * 7}>(
  ${CHOP_WGSL_ARRAY}
);
fn sampleChop(basePosV: vec3<f32>, t: f32) -> f32 {
  var h: f32 = 0.0;
  for (var i: u32 = 0u; i < CHOP_TERMS_U; i = i + 1u) {
    let base = i * 7u;
    let ax = chopWaves[base];
    let ay = chopWaves[base + 1u];
    let az = chopWaves[base + 2u];
    let n  = chopWaves[base + 3u];
    let omega = chopWaves[base + 4u];
    let amp = chopWaves[base + 5u];
    let phase0 = chopWaves[base + 6u];
    let d = clamp(basePosV.x * ax + basePosV.y * ay + basePosV.z * az, -1.0, 1.0);
    let theta = acos(d);
    h = h + amp * sin(n * theta - omega * t + phase0);
  }
  return h * ${wgslF(CHOP_AMP_SCALE)};
}
`;

// 単位球面のローカル座標(x,y,z)から、oceanHeightGPUを双一次補間で
// サンプリングする(WebGL/JSフォールバック用。WGSL版のsampleOceanHeight()
// と同じ式にすること)。
function sampleOceanHeightJS(x, y, z) {
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  const lon = Math.atan2(z, x) + Math.PI; // 0..2π
  const dLon = (2 * Math.PI) / OCEAN_LON;
  const dLat = Math.PI / OCEAN_LAT;
  const fi = (lon / dLon) - 0.5;
  const fj = ((lat + Math.PI / 2) / dLat) - 0.5;
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const ti = fi - i0, tj = fj - j0;
  const i0w = ((i0 % OCEAN_LON) + OCEAN_LON) % OCEAN_LON;
  const i1w = (i0w + 1) % OCEAN_LON;
  const j0c = Math.max(0, Math.min(OCEAN_LAT - 1, j0));
  const j1c = Math.max(0, Math.min(OCEAN_LAT - 1, j0 + 1));
  const h00 = oceanHeightGPU[oceanIdx(i0w, j0c)];
  const h10 = oceanHeightGPU[oceanIdx(i1w, j0c)];
  const h01 = oceanHeightGPU[oceanIdx(i0w, j1c)];
  const h11 = oceanHeightGPU[oceanIdx(i1w, j1c)];
  const h0 = h00 + (h10 - h00) * ti;
  const h1 = h01 + (h11 - h01) * ti;
  return h0 + (h1 - h0) * tj;
}
// sampleOceanHeightJSと全く同じ格子・添字規則で、u,v(東向き・北向きの流速)を
// 双一次補間して読む。「泳ぐ文章」の鎖のリーダーが、実際の海流の向きを
// 測るために使う(updateSwimChains)。
function sampleOceanUVJS(x, y, z) {
  const lat = Math.asin(Math.max(-1, Math.min(1, y)));
  const lon = Math.atan2(z, x) + Math.PI;
  const dLon = (2 * Math.PI) / OCEAN_LON;
  const dLat = Math.PI / OCEAN_LAT;
  const fi = (lon / dLon) - 0.5;
  const fj = ((lat + Math.PI / 2) / dLat) - 0.5;
  const i0 = Math.floor(fi), j0 = Math.floor(fj);
  const ti = fi - i0, tj = fj - j0;
  const i0w = ((i0 % OCEAN_LON) + OCEAN_LON) % OCEAN_LON;
  const i1w = (i0w + 1) % OCEAN_LON;
  const j0c = Math.max(0, Math.min(OCEAN_LAT - 1, j0));
  const j1c = Math.max(0, Math.min(OCEAN_LAT - 1, j0 + 1));
  const u00 = oceanU[oceanIdx(i0w, j0c)], v00 = oceanV[oceanIdx(i0w, j0c)];
  const u10 = oceanU[oceanIdx(i1w, j0c)], v10 = oceanV[oceanIdx(i1w, j0c)];
  const u01 = oceanU[oceanIdx(i0w, j1c)], v01 = oceanV[oceanIdx(i0w, j1c)];
  const u11 = oceanU[oceanIdx(i1w, j1c)], v11 = oceanV[oceanIdx(i1w, j1c)];
  const u0 = u00 + (u10 - u00) * ti, u1 = u01 + (u11 - u01) * ti;
  const v0 = v00 + (v10 - v00) * ti, v1 = v01 + (v11 - v01) * ti;
  return { u: u0 + (u1 - u0) * tj, v: v0 + (v1 - v0) * tj };
}



for (let i = 0; i < MAIN_PARTICLE_COUNT; i++) {
  const [x, y, z] = sphereBuild.points[i];
  const idx = i * 16;

  // basePosSeed (xyz, w=seed) — 静止した球面上の位置。将来シミュレーションの
  // 「変位ゼロ地点」として使う想定。
  particleData[idx + 0] = x;
  particleData[idx + 1] = y;
  particleData[idx + 2] = z;
  particleData[idx + 3] = Math.random(); // seed

  // posWaveH (xyz=水平変位後の単位方向, w=スペクトル波の高さ) — 初期は basePos と同一。
  // 鼓動開始後は compute pass が毎フレーム書き換える。
  particleData[idx + 4] = x;
  particleData[idx + 5] = y;
  particleData[idx + 6] = z;
  particleData[idx + 7] = 0.0;

  // velAlpha (x=E:局所の波エネルギー(初期1=満タン), y=F:泡(初期0), z=未使用, w=alpha)
  // E,Fは compute pass(createSpectralOcean)が毎フレーム更新する粒子の状態。
  particleData[idx + 8]  = 1.0;
  particleData[idx + 9]  = 0.0;
  particleData[idx + 10] = 0.0;
  particleData[idx + 11] = 0.75; // alpha(湖形成トリガー前は各シェーダ側で0に上書き)

  // attr (size, mode, pad, pad) — mode=0: 通常の球面粒子
  particleData[idx + 12] = 0.020; // size
  particleData[idx + 13] = 0.0;   // mode = 0 (通常)
  particleData[idx + 14] = 0.0;
  particleData[idx + 15] = 0.0;
}

// ---- 鼓動の残像粒子プール(mode=1) ----
// 球面上の完全にランダムな点に、通常粒子より小さいサイズで配置する。
// どのサイクルで・どの粒子が発火するかは頂点シェーダ側でseedとサイクル
// 番号からハッシュして毎フレーム決定するため、ここでは位置とseedのみ
// 割り当てればよい(状態を持たない)。
for (let i = 0; i < WEBGPU_AFTERIMAGE_COUNT; i++) {
  const yv = 1 - 2 * Math.random();
  const rv = Math.sqrt(Math.max(0, 1 - yv * yv));
  const theta = 2 * Math.PI * Math.random();
  const x = Math.cos(theta) * rv, y = yv, z = Math.sin(theta) * rv;
  const idx = (MAIN_PARTICLE_COUNT + i) * 16;

  particleData[idx + 0] = x;
  particleData[idx + 1] = y;
  particleData[idx + 2] = z;
  particleData[idx + 3] = Math.random(); // seed(発火サイクルの決定に使う)

  particleData[idx + 4] = x;
  particleData[idx + 5] = y;
  particleData[idx + 6] = z;
  particleData[idx + 7] = 0.0;

  particleData[idx + 8]  = 0.0;
  particleData[idx + 9]  = 0.0;
  particleData[idx + 10] = 0.0;
  particleData[idx + 11] = 1.0;

  particleData[idx + 12] = 0.011; // size(通常粒子より極小)
  particleData[idx + 13] = 1.0;   // mode = 1 (鼓動の残像)
  particleData[idx + 14] = 0.0;
  particleData[idx + 15] = 0.0;
}

// ---- 泳ぐ文章プール(mode=2) ----
// 実際の文字位置・アトラス上のインデックスはフォント読み込み後(buildGlyphAtlas→
// buildSwimmingTextChars、tryInitWebGPU内でawaitして同期的に反映)に書き込む。
// ここでは仮の場所(北極点)に、alpha=0で確保だけしておく(何らかの理由で
// 文字データの構築に失敗しても、画面が壊れず単に文字が出ないだけで済む)。
for (let i = 0; i < TEXT_PARTICLE_CAP; i++) {
  const idx = (MAIN_PARTICLE_COUNT + WEBGPU_AFTERIMAGE_COUNT + i) * 16;
  particleData[idx + 0] = 0; particleData[idx + 1] = 1; particleData[idx + 2] = 0;
  particleData[idx + 3] = Math.random(); // seed(泳ぐ動きのランダム化に使う)
  particleData[idx + 4] = 0; particleData[idx + 5] = 1; particleData[idx + 6] = 0;
  particleData[idx + 7] = 0.0;
  particleData[idx + 8]  = 0.0; particleData[idx + 9] = 0.0; particleData[idx + 10] = 0.0;
  particleData[idx + 11] = -1.0; // アトラス上のグリフ index(-1=無効。実データ読み込み後に上書き)
  particleData[idx + 12] = SWIM_CHAR_SIZE;
  particleData[idx + 13] = 2.0;  // mode = 2 (泳ぐ文章)
  particleData[idx + 14] = 1.0;  // (未使用。旧inkカバレッジ枠。互換のため1のまま残す)
  particleData[idx + 15] = 1.0;  // このグリフの縦横比(幅/セル幅)。実データ読み込み後に上書き
}

// ---- 月(mode=4) ----
// basePosSeed.xyz = 月の中心から見たこの粒子の方向(単位ベクトル、球の
// Fibonacci格子上の1点)。月は自転させないので、この値は初期化時のまま
// 一切変更しない(=太陽との内積による陰影計算にも、位置計算にもそのまま
// 使い続けられる)。月全体の位置(公転)は頂点シェーダがuniformのmoonDirから
// 毎フレーム計算する。
{
  const moonBase = MAIN_PARTICLE_COUNT + WEBGPU_AFTERIMAGE_COUNT + TEXT_PARTICLE_CAP;
  for (let i = 0; i < MOON_PARTICLE_COUNT; i++) {
    const [x, y, z] = moonBuild.points[i];
    const idx = (moonBase + i) * 16;
    particleData[idx + 0] = x; particleData[idx + 1] = y; particleData[idx + 2] = z; particleData[idx + 3] = 0;
    particleData[idx + 4] = x; particleData[idx + 5] = y; particleData[idx + 6] = z; particleData[idx + 7] = 0;
    particleData[idx + 8] = 0; particleData[idx + 9] = 0; particleData[idx + 10] = 0; particleData[idx + 11] = 0;
    particleData[idx + 12] = MOON_DOT_SIZE;
    particleData[idx + 13] = 4.0; // mode = 4 (月)
    particleData[idx + 14] = 0; particleData[idx + 15] = 0;
  }
}

// フォントを読み込み、SWIM_QUOTESに登場する文字だけを1枚のCanvasテクスチャ
// (グリフアトラス)へ敷き詰める。各文字はSWIM_ATLAS_COLS×SWIM_ATLAS_CELLpxの
// グリッドに1つずつ描かれ、後で頂点シェーダがindexからUV矩形を逆算して
// サンプリングする。WebGPU初期化側でawaitしてから使うので、この関数が返す
// 時点でテクスチャ化の準備(canvas)が整っている。
async function buildGlyphAtlas() {
  try {
    await document.fonts.load(`italic 500 100px ${SWIM_FONT_FAMILY}`);
    await document.fonts.ready;
  } catch (e) { /* 読み込めなければローカルのフォールバック書体で続行 */ }

  const charsSet = new Set();
  for (const q of SWIM_QUOTES) for (const ch of q) { if (ch !== ' ') charsSet.add(ch); }
  const chars = Array.from(charsSet);
  const cols = SWIM_ATLAS_COLS;
  const rows = Math.max(1, Math.ceil(chars.length / cols));
  const cell = SWIM_ATLAS_CELL;

  const canvas = document.createElement('canvas');
  canvas.width = cols * cell;
  canvas.height = rows * cell;
  const ctx = canvas.getContext('2d', { willReadFrequently: false });
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const fontPx = Math.round(cell * 0.72);
  ctx.font = `italic 500 ${fontPx}px ${SWIM_FONT_FAMILY}`;

  const indexOf = new Map();  // 文字 → アトラスindex
  const aspectOf = new Map(); // 文字 → 幅/セル幅(横長・縦長の見た目補正用)
  chars.forEach((ch, i) => {
    indexOf.set(ch, i);
    const col = i % cols, row = Math.floor(i / cols);
    const cx = col * cell + cell / 2, cy = row * cell + cell / 2;
    ctx.fillText(ch, cx, cy + cell * 0.02);
    const w = ctx.measureText(ch).width;
    aspectOf.set(ch, Math.max(0.22, Math.min(1.15, w / (cell * 0.72))));
  });

  return { canvas, cols, rows, cell, indexOf, aspectOf };
}

// 「泳ぐ文章」の鎖(引用文=1文ごとに1本)のランタイム状態。setupSwimChains()で
// 作られ、毎フレームupdateSwimChains()が更新する。
// 【単語ごとに分けていたのをやめた経緯】最初は単語ごとに独立した鎖にしていたが、
// 「単語同士がバラバラで、文章1文で泳いでいるのが理想」と指摘を受け、引用文
// 1つ=鎖1本にまとめた。空白は粒子を作らないが、間隔(弧長)には寄与させる
// ことで、単語の区切りの空きはそのまま保たれる。
const swimChains = [];

// ---- 「泳ぐ文章」の初期の鎖を、あらかじめ曲げておく ----
// 【背景】海流(oceanU/V)は、地球出現後しばらく(forceAmp=0の間)ほぼ0のため、リーダーは
// 初期の東向きのまま直進し、文章は「まっすぐな一行」として現れて簡単に読めてしまっていた。
// そこで、鎖の軌跡(履歴)を出現前にあらかじめ蛇行した経路で埋めておく。
// 文章は最初から「うねった帯」の形で現れ、各文字の向きも経路に沿って回転するので読みにくい。
// また、鎖の進行自体も文章が現れる直前まで止めておく(frameLoop側)ので、
// 出現の瞬間にこのうねりがそのまま見える。
const SWIM_BEND_SCALE = 1.0; // うねりの強さ。0で従来(まっすぐ)、大きいほど読みにくい
const SWIM_BEND_A = [1.0, 0.5, 0.25]; // 進行方向の振れ幅(rad)。3つの周期を重ねる
const SWIM_BEND_K = [2 * Math.PI / 0.8, 2 * Math.PI / 0.45, 2 * Math.PI / 0.22]; // 弧長(rad)あたりの周波数
const SWIM_LIVE_BEND = 1.0;  // 出現後もリーダーが蛇行し続ける強さ(0で、出現後は海流まかせ)
// 2つの引用文の中心経度。対極(地球の正反対)に置くので、片方を読んでいる間もう片方は裏側にある。
const SWIM_QUOTE_LONS = [0, Math.PI];

function swimBendAngle(s, phases) {
  let th = 0;
  for (let i = 0; i < 3; i++) th += SWIM_BEND_A[i] * Math.sin(SWIM_BEND_K[i] * s + phases[i]);
  return th * SWIM_BEND_SCALE;
}
// 単位ベクトル axis まわりに v を a(rad) 回転(ロドリゲスの回転公式)
function rotateAbout(v, axis, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const d = v.x * axis.x + v.y * axis.y + v.z * axis.z;
  const cx = axis.y * v.z - axis.z * v.y;
  const cy = axis.z * v.x - axis.x * v.z;
  const cz = axis.x * v.y - axis.y * v.x;
  return {
    x: v.x * c + cx * s + axis.x * d * (1 - c),
    y: v.y * c + cy * s + axis.y * d * (1 - c),
    z: v.z * c + cz * s + axis.z * d * (1 - c),
  };
}
function rotateLon(v, d) { // Y軸まわり(=経度をdだけずらす)
  const c = Math.cos(d), s = Math.sin(d);
  return { x: v.x * c - v.z * s, y: v.y, z: v.x * s + v.z * c };
}

// 蛇行した経路を先に走らせ、その軌跡(履歴リングバッファ)・先頭位置・向きを返す。
// 文章の中心がtargetLon付近に来るよう、最後に経度方向へ回転して位置合わせする。
function buildBentChain(lat, targetLon, spanArc, histCap) {
  const phases = [Math.random() * Math.PI * 2, Math.random() * Math.PI * 2, Math.random() * Math.PI * 2];
  const total = spanArc + 0.12; // 末尾の文字より少し先まで履歴を持たせる
  const steps = Math.max(2, Math.ceil(total / CHAIN_STEP_ARC));
  const cl = Math.cos(lat);
  let p = { x: cl, y: Math.sin(lat), z: 0 };
  let t = { x: 0, y: 0, z: 1 }; // 東向き
  // 進行方向が「東向き ± うねり」になるよう、最初に θ(0) だけ回しておく(これをしないと全体が北/南へ流れてしまう)
  t = rotateAbout(t, p, swimBendAngle(0, phases));
  const dirs = new Array(steps);
  for (let i = 0; i < steps; i++) {
    const dTheta = swimBendAngle((i + 1) * CHAIN_STEP_ARC, phases) - swimBendAngle(i * CHAIN_STEP_ARC, phases);
    t = rotateAbout(t, p, dTheta);
    let nx = p.x + t.x * CHAIN_STEP_ARC, ny = p.y + t.y * CHAIN_STEP_ARC, nz = p.z + t.z * CHAIN_STEP_ARC;
    const nl = Math.hypot(nx, ny, nz) || 1;
    p = { x: nx / nl, y: ny / nl, z: nz / nl };
    const td = t.x * p.x + t.y * p.y + t.z * p.z;
    let tx = t.x - p.x * td, ty = t.y - p.y * td, tz = t.z - p.z * td;
    const tl = Math.hypot(tx, ty, tz) || 1;
    t = { x: tx / tl, y: ty / tl, z: tz / tl };
    dirs[i] = p;
  }
  // 文章(先頭〜spanArc後方)の中央が targetLon に来るよう、全体を経度方向に回す
  const midIdx = Math.max(0, Math.min(steps - 1, Math.round((total - spanArc / 2) / CHAIN_STEP_ARC) - 1));
  const lonMid = Math.atan2(dirs[midIdx].z, dirs[midIdx].x);
  const dLon = targetLon - lonMid;
  for (let i = 0; i < steps; i++) dirs[i] = rotateLon(dirs[i], dLon);
  const head = dirs[steps - 1];
  const heading = rotateLon(t, dLon);

  // 直近 histCap 件をリングバッファへ(updateSwimChainsと同じ並び: index 0 が最古)
  const n = Math.min(steps, histCap);
  const historyArc = new Float32Array(histCap);
  const historyDir = new Float32Array(histCap * 3);
  for (let k = 0; k < n; k++) {
    const i = steps - n + k;
    historyArc[k] = (i + 1) * CHAIN_STEP_ARC;
    historyDir[k * 3 + 0] = dirs[i].x; historyDir[k * 3 + 1] = dirs[i].y; historyDir[k * 3 + 2] = dirs[i].z;
  }
  return {
    headDir: head, heading, phases,
    historyArc, historyDir, historyWrite: n % histCap, historyCount: n,
    cumulativeArc: steps * CHAIN_STEP_ARC,
  };
}

// buildGlyphAtlas()の結果(文字→indexの対応)を使い、SWIM_QUOTESの引用文
// 1つを1本の「鎖」として初期化する。先頭の文字がリーダーとなり、そのリーダーが
// 実際に通った軌跡を後続の文字がトレースする(詳しくはupdateSwimChains)。
// ここでは初期位置(先頭をどこに置くか)と、各文字のリーダーからの遅れ距離
// (実測フォント幅から換算、空白の幅も遅れ距離には反映される)だけを決め、
// particleDataへ初期値を書く。
function setupSwimChains(atlas) {
  const measCtx = document.createElement('canvas').getContext('2d');
  measCtx.font = `italic 500 100px ${SWIM_FONT_FAMILY}`;
  const textBase = MAIN_PARTICLE_COUNT + WEBGPU_AFTERIMAGE_COUNT;
  let written = 0;

  for (let qi = 0; qi < SWIM_QUOTES.length; qi++) {
    const text = SWIM_QUOTES[qi];
    const lat = SWIM_QUOTE_LATS[qi];
    const charW = Array.from(text, (ch) => measCtx.measureText(ch).width);
    const naturalWidthPx = charW.reduce((s, w) => s + w, 0) || 1;
    // この引用文全体の自然な幅がちょうどSWIM_FONT_SCALE×2πを占めるように、
    // px→rad の変換係数をこの文だけのものとして逆算する。
    const angleScale = (2 * Math.PI * SWIM_FONT_SCALE) / naturalWidthPx;
    const naturalWidthRad = naturalWidthPx * angleScale;
    // (旧: 経度0を中心に東向きへまっすぐ並べていた → buildBentChain で蛇行した初期軌跡を作る)

    // 各文字(空白を除く)の「リーダーから何rad遅れてトレースするか」を、
    // 実測フォント幅の積み上げから求める。空白は粒子は作らないが、幅ぶんの
    // 間隔はそのままcharOffsetsに反映されるので、単語の区切りは保たれる。
    const charOffsets = [];
    const glyphChars = [];
    let acc = 0;
    for (let ci = 0; ci < text.length; ci++) {
      if (ci > 0) acc += ((charW[ci - 1] + charW[ci]) * 0.5) * angleScale;
      if (text[ci] === ' ') continue;
      charOffsets.push(acc);
      glyphChars.push(text[ci]);
    }
    const charCount = glyphChars.length;
    if (written + charCount > TEXT_PARTICLE_CAP) continue; // 収まらない場合はこの文をスキップ(想定外の長文対策)
    const wordSpanArc = acc; // リーダー〜末尾までの弧長。履歴バッファがこれを覆える必要がある。

    const histCap = Math.max(64, Math.min(CHAIN_HISTORY_CAP, Math.ceil((wordSpanArc / CHAIN_STEP_ARC) * 3) + 32));
    const bent = buildBentChain(lat, SWIM_QUOTE_LONS[qi], wordSpanArc, histCap);
    const headDir = bent.headDir;
    const particleBase = textBase + written;
    for (let ci = 0; ci < charCount; ci++) {
      const ch = glyphChars[ci];
      const glyphIdx = atlas.indexOf.get(ch);
      const o = (particleBase + ci) * 16;
      particleData[o + 0] = headDir.x; particleData[o + 1] = headDir.y; particleData[o + 2] = headDir.z;
      particleData[o + 3] = 0;
      particleData[o + 4] = headDir.x; particleData[o + 5] = headDir.y; particleData[o + 6] = headDir.z;
      particleData[o + 7] = 0;
      particleData[o + 8] = 0; particleData[o + 9] = 0; particleData[o + 10] = 0;
      particleData[o + 11] = glyphIdx === undefined ? -1 : glyphIdx;
      particleData[o + 12] = SWIM_CHAR_SIZE;
      particleData[o + 13] = 2.0;
      particleData[o + 14] = 0; // 向き(rad)。updateSwimChainsが毎フレーム書く
      particleData[o + 15] = atlas.aspectOf.get(ch) || 1.0;
    }

    swimChains.push({
      headDir, heading: bent.heading, targetHeading: bent.heading,
      distSinceRemeasure: 0, cumulativeArc: bent.cumulativeArc,
      historyArc: bent.historyArc,
      historyDir: bent.historyDir,
      historyWrite: bent.historyWrite, historyCount: bent.historyCount, historyCap: histCap,
      bendPhases: bent.phases,
      particleBase, charCount, charOffsets: Float32Array.from(charOffsets),
      lastDir: new Float32Array(charCount * 3), // 今フレームで求めた各文字の位置(次文字の向き計算に使う)
    });
    written += charCount;
  }
  // 進行(dt=0)なしで一度だけ各文字の位置・向きを書き込む(現れる最初のフレームから正しい形にするため)
  updateSwimChains(0);
}

// 「泳ぐ文章」の鎖を1フレームぶん進める。CPU側だけで完結する物理:
//   1) リーダーは一定距離(CHAIN_REMEASURE_DIST)進むごとに、今いる場所の
//      実際の海流(u,v)を測り直し、その向きを新しい目標にする。
//   2) 向きは目標へ毎フレーム少しずつ(CHAIN_TURN_RATE)寄っていく(急な
//      折れ曲がりを避けるためだけの平滑化で、「一定距離進んだら再計測」
//      という測定そのものの頻度は変えていない)。
//   3) リーダーの通った軌跡を弧長つきでリングバッファに記録し、後続の
//      文字はそこから自分の遅れ距離ぶんだけ過去の位置を読み取ってトレース
//      する(=鎖)。
//   4) 各文字の向き(attr.z、rad)は、自分より鎖の先端側にある文字への
//      方向から求める(リーダーは進行方向そのもの)。これで文字同士に
//      「鎖らしい」向きのつながりが生まれる。
// 結果(位置+向き)はparticleDataへ直接書き込み、フレームループ側が
// まとめてGPUへアップロードする。
function updateSwimChains(dt) {
  const moveDist = CHAIN_SPEED * dt;
  const turnAmt = 1 - Math.exp(-CHAIN_TURN_RATE * dt);

  for (const chain of swimChains) {
    // ---- 1) 一定距離ごとに現在地の海流方向を測り直す ----
    chain.distSinceRemeasure += moveDist;
    if (chain.distSinceRemeasure >= CHAIN_REMEASURE_DIST) {
      chain.distSinceRemeasure -= CHAIN_REMEASURE_DIST;
      const { u, v } = sampleOceanUVJS(chain.headDir.x, chain.headDir.y, chain.headDir.z);
      const lon0 = Math.atan2(chain.headDir.z, chain.headDir.x);
      const east0 = { x: -Math.sin(lon0), y: 0, z: Math.cos(lon0) };
      const north0 = {
        x: east0.y * chain.headDir.z - east0.z * chain.headDir.y,
        y: east0.z * chain.headDir.x - east0.x * chain.headDir.z,
        z: east0.x * chain.headDir.y - east0.y * chain.headDir.x,
      };
      const tx = east0.x * u + north0.x * v;
      const ty = east0.y * u + north0.y * v;
      const tz = east0.z * u + north0.z * v;
      const tlen = Math.hypot(tx, ty, tz);
      if (tlen > 1e-6) {
        chain.targetHeading = { x: tx / tlen, y: ty / tlen, z: tz / tlen };
      } // 流れがほぼ無い場所では目標を変えず、今の向きのまま直進を続ける
    }

    // ---- 2) 向きを目標へ滑らかに寄せる ----
    let hx = chain.heading.x + (chain.targetHeading.x - chain.heading.x) * turnAmt;
    let hy = chain.heading.y + (chain.targetHeading.y - chain.heading.y) * turnAmt;
    let hz = chain.heading.z + (chain.targetHeading.z - chain.heading.z) * turnAmt;
    let hlen = Math.hypot(hx, hy, hz) || 1;
    chain.heading = { x: hx / hlen, y: hy / hlen, z: hz / hlen };

    // ---- 2.5) あらかじめ曲げた蛇行の続き(出現後もうねりを保つ) ----
    if (SWIM_LIVE_BEND > 0 && chain.bendPhases) {
      const dTheta = SWIM_LIVE_BEND * (swimBendAngle(chain.cumulativeArc + moveDist, chain.bendPhases) - swimBendAngle(chain.cumulativeArc, chain.bendPhases));
      chain.heading = rotateAbout(chain.heading, chain.headDir, dTheta);
      chain.targetHeading = rotateAbout(chain.targetHeading, chain.headDir, dTheta);
    }

    // ---- 3) 頭を進め、向きを新しい接平面へ再投影する ----
    let nx = chain.headDir.x + chain.heading.x * moveDist;
    let ny = chain.headDir.y + chain.heading.y * moveDist;
    let nz = chain.headDir.z + chain.heading.z * moveDist;
    let nlen = Math.hypot(nx, ny, nz) || 1;
    chain.headDir = { x: nx / nlen, y: ny / nlen, z: nz / nlen };

    const hdot = chain.heading.x * chain.headDir.x + chain.heading.y * chain.headDir.y + chain.heading.z * chain.headDir.z;
    let px = chain.heading.x - chain.headDir.x * hdot;
    let py = chain.heading.y - chain.headDir.y * hdot;
    let pz = chain.heading.z - chain.headDir.z * hdot;
    let plen = Math.hypot(px, py, pz) || 1;
    chain.heading = { x: px / plen, y: py / plen, z: pz / plen };

    chain.cumulativeArc += moveDist;

    // ---- 軌跡履歴に記録(リングバッファ) ----
    const cap = chain.historyCap;
    const w = chain.historyWrite;
    chain.historyArc[w] = chain.cumulativeArc;
    chain.historyDir[w * 3 + 0] = chain.headDir.x;
    chain.historyDir[w * 3 + 1] = chain.headDir.y;
    chain.historyDir[w * 3 + 2] = chain.headDir.z;
    chain.historyWrite = (w + 1) % cap;
    chain.historyCount = Math.min(chain.historyCount + 1, cap);
    const n = chain.historyCount;
    const latestIdx = (chain.historyWrite - 1 + cap) % cap;
    const oldestIdx = (latestIdx - (n - 1) + cap) % cap;

    // ---- 各文字の位置を履歴からトレースして求める ----
    for (let ci = 0; ci < chain.charCount; ci++) {
      const targetArc = chain.cumulativeArc - chain.charOffsets[ci];
      let dx, dy, dz;
      if (ci === 0 || n < 2 || targetArc <= chain.historyArc[oldestIdx]) {
        // リーダー自身、または(単語が動き出した直後で)まだ十分な履歴がない場合は
        // 手に入る一番古い記録(なければリーダーの現在地)で代用する。
        if (ci === 0 || n < 2) {
          dx = chain.headDir.x; dy = chain.headDir.y; dz = chain.headDir.z;
        } else {
          dx = chain.historyDir[oldestIdx * 3 + 0];
          dy = chain.historyDir[oldestIdx * 3 + 1];
          dz = chain.historyDir[oldestIdx * 3 + 2];
        }
      } else {
        let lo = oldestIdx, hi = latestIdx, prevIdx = latestIdx;
        for (let k = 1; k < n; k++) {
          const idxA = (latestIdx - k + cap) % cap;
          if (chain.historyArc[idxA] <= targetArc) { lo = idxA; hi = prevIdx; break; }
          prevIdx = idxA;
        }
        const arcLo = chain.historyArc[lo], arcHi = chain.historyArc[hi];
        const t = arcHi > arcLo ? (targetArc - arcLo) / (arcHi - arcLo) : 0;
        dx = chain.historyDir[lo * 3 + 0] + (chain.historyDir[hi * 3 + 0] - chain.historyDir[lo * 3 + 0]) * t;
        dy = chain.historyDir[lo * 3 + 1] + (chain.historyDir[hi * 3 + 1] - chain.historyDir[lo * 3 + 1]) * t;
        dz = chain.historyDir[lo * 3 + 2] + (chain.historyDir[hi * 3 + 2] - chain.historyDir[lo * 3 + 2]) * t;
        const dlen = Math.hypot(dx, dy, dz) || 1;
        dx /= dlen; dy /= dlen; dz /= dlen;
      }
      chain.lastDir[ci * 3 + 0] = dx; chain.lastDir[ci * 3 + 1] = dy; chain.lastDir[ci * 3 + 2] = dz;
    }

    // ---- 各文字の向き(attr.z, rad)と位置をparticleDataへ書き込む ----
    for (let ci = 0; ci < chain.charCount; ci++) {
      const dx = chain.lastDir[ci * 3 + 0], dy = chain.lastDir[ci * 3 + 1], dz = chain.lastDir[ci * 3 + 2];
      const lon = Math.atan2(dz, dx);
      const east = { x: -Math.sin(lon), y: 0, z: Math.cos(lon) };
      const north = {
        x: east.y * dz - east.z * dy,
        y: east.z * dx - east.x * dz,
        z: east.x * dy - east.y * dx,
      };
      let hvx, hvy, hvz;
      if (ci === 0) {
        hvx = chain.heading.x; hvy = chain.heading.y; hvz = chain.heading.z;
      } else {
        hvx = chain.lastDir[(ci - 1) * 3 + 0] - dx;
        hvy = chain.lastDir[(ci - 1) * 3 + 1] - dy;
        hvz = chain.lastDir[(ci - 1) * 3 + 2] - dz;
      }
      const angle = Math.atan2(
        hvx * north.x + hvy * north.y + hvz * north.z,
        hvx * east.x + hvy * east.y + hvz * east.z,
      );
      const o = (chain.particleBase + ci) * 16;
      particleData[o + 0] = dx; particleData[o + 1] = dy; particleData[o + 2] = dz;
      particleData[o + 14] = angle;
    }
  }
}

// ----------------------------------------------------
// 行列ユーティリティ
// ----------------------------------------------------
function mat4Identity() {
  const m = new Float32Array(16);
  m[0] = 1; m[5] = 1; m[10] = 1; m[15] = 1;
  return m;
}
function mat4PerspectiveWebGPU(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = far / (near - far); m[11] = -1;
  m[14] = (far * near) / (near - far);
  return m;
}
function mat4PerspectiveWebGL(fovy, aspect, near, far) {
  const f = 1.0 / Math.tan(fovy / 2);
  const m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f;
  m[10] = (far + near) / (near - far); m[11] = -1;
  m[14] = (2 * far * near) / (near - far);
  return m;
}
function mat4Translate(x, y, z) {
  const m = mat4Identity();
  m[12] = x; m[13] = y; m[14] = z;
  return m;
}
function mat4RotX(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const m = mat4Identity();
  m[5] = c; m[6] = s; m[9] = -s; m[10] = c;
  return m;
}
function mat4RotY(angle) {
  const c = Math.cos(angle), s = Math.sin(angle);
  const m = mat4Identity();
  m[0] = c; m[2] = -s; m[8] = s; m[10] = c;
  return m;
}
function mat4Mul(a, b) {
  const out = new Float32Array(16);
  for (let col = 0; col < 4; col++) {
    for (let row = 0; row < 4; row++) {
      let sum = 0;
      for (let k = 0; k < 4; k++) sum += a[k * 4 + row] * b[col * 4 + k];
      out[col * 4 + row] = sum;
    }
  }
  return out;
}

function smoothstepJS(edge0, edge1, x) {
  const t = Math.max(0, Math.min(1, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

// ハッシュ(鼓動の残像粒子の発火判定に使用。対流・渦は削除済み)
function hashN(x, y, z) {
  const v = Math.sin(x * 12.9898 + y * 78.233 + z * 45.164) * 43758.5453123;
  return v - Math.floor(v);
}

// ----------------------------------------------------
// インタラクション (視点ドラッグのみ。渦クリックは動き再実装時に復元予定)
// ----------------------------------------------------
let rotAngleX = 0.2;
let rotAngleY = 0;

// Z軸(奥行き)方向でカメラに最も正面から向き合う点(=画面中心、北極/南極で言えば
// 赤道上の点)を、オブジェクト空間のベクトルとして求めておく。
// 単純に(0,0,1)を使うと、初期カメラ角度 RotX(rotAngleX) の傾き分だけ
// 画面中心からズレて下寄りに出てしまうため、逆回転 RotX(-rotAngleX) を
// (0,0,1) に適用した点を「湖の起点(=極として扱う点)」の基準にする。
const POLE_DIR_Y = Math.sin(rotAngleX);
const POLE_DIR_Z = Math.cos(rotAngleX);
let isDragging = false;
let startPointerX = 0, startPointerY = 0;

const eyeDist = 3.2;
const fov = Math.PI / 4;
let currentElapsed = 0;

// クリック(≒動かさずに素早く押して離す)で渦を発生させる。ドラッグ(視点回転)
// との判別は、押してから離すまでの移動距離と経過時間のしきい値で行う。
let pointerDownTime = 0, pointerDownX = 0, pointerDownY = 0, pointerMoved = 0;
const TAP_MAX_MOVE_PX = 24, TAP_MAX_MS = 600; // 実機での小さな手ブレを許容する(以前の8px/450msは厳しすぎてタップが渦として認識されにくかった)

// クリック位置(画面座標)を、球(半径1、波の変位前)との交点から、モデル回転
// (rotAngleX, rotAngleY)を打ち消した「基準座標系」の単位方向へ変換する。
// この基準座標系は、粒子のbasePosSeed.xyzや浅水シミュレーションのlat/lonと
// 同じ空間なので、変換した方向をそのまま渦の中心として使える。
function pickBaseDirFromScreen(clientX, clientY) {
  const ndcX = (clientX / window.innerWidth) * 2 - 1;
  const ndcY = 1 - (clientY / window.innerHeight) * 2;
  const f = 1 / Math.tan(fov / 2);
  // レイ: 原点=カメラ(0,0,eyeDist)、方向=(ndcX/f, ndcY/f, -1)(正規化前)。
  const dx = ndcX / f, dy = ndcY / f, dz = -1;
  const ex = 0, ey = 0, ez = eyeDist;
  // |E + t*D|^2 = 1 を t について解く(単位球との交点。波の変位は無視できるほど小さい)。
  const a = dx * dx + dy * dy + dz * dz;
  const b = 2 * (ex * dx + ey * dy + ez * dz);
  const c = ex * ex + ey * ey + ez * ez - 1;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null; // 球の外side(視界の外周)をクリックした
  const t = (-b - Math.sqrt(disc)) / (2 * a); // 手前側の交点
  if (t <= 0) return null;
  const wx = ex + t * dx, wy = ey + t * dy, wz = ez + t * dz;
  // モデル回転(model = RotX(rotAngleX) * RotY(rotAngleY))の逆変換: 先にRotXの逆、次にRotYの逆。
  const cX = Math.cos(rotAngleX), sX = Math.sin(rotAngleX);
  const y1 = cX * wy + sX * wz, z1 = -sX * wy + cX * wz, x1 = wx;
  const cY = Math.cos(rotAngleY), sY = Math.sin(rotAngleY);
  const x0 = cY * x1 - sY * z1, z0 = sY * x1 + cY * z1, y0 = y1;
  const len = Math.hypot(x0, y0, z0) || 1;
  return { x: x0 / len, y: y0 / len, z: z0 / len };
}

listen(window, 'pointerdown', (e) => {
  if (e.target.closest('#intro-overlay, .icon-btn')) return;
  isDragging = true;
  startPointerX = e.clientX;
  startPointerY = e.clientY;
  pointerDownX = e.clientX; pointerDownY = e.clientY;
  pointerDownTime = performance.now(); pointerMoved = 0;
});
listen(window, 'pointermove', (e) => {
  if (!isDragging) return;
  const dx = e.clientX - startPointerX;
  const dy = e.clientY - startPointerY;
  pointerMoved += Math.hypot(dx, dy);
  rotAngleY += dx * 0.006;
  rotAngleX = Math.max(-1.4, Math.min(1.4, rotAngleX + dy * 0.006));
  startPointerX = e.clientX;
  startPointerY = e.clientY;
});
listen(window, 'pointerup', (e) => {
  isDragging = false;
  if (e.target.closest('#intro-overlay, .icon-btn')) return;
  const heldMs = performance.now() - pointerDownTime;
  if (pointerMoved <= TAP_MAX_MOVE_PX && heldMs <= TAP_MAX_MS && earthRevealStartElapsed >= 0) {
    const dir = pickBaseDirFromScreen(e.clientX, e.clientY);
    if (dir) { spawnVortex(dir, currentElapsed); console.log('[vortex] spawned at', dir, 't=', currentElapsed.toFixed(2)); }
    else console.log('[vortex] tap missed the sphere');
  } else if (pointerMoved > TAP_MAX_MOVE_PX) {
    // ドラッグと判定(デバッグ用ログ。渦は発生させない)
  } else if (earthRevealStartElapsed < 0) {
    console.log('[vortex] ignored: globe not revealed yet');
  }
});

// ============================================================
// 球面調和関数(SH)スペクトル海面 + 状態を持つ砕波層 (WebGPU専用)
// ------------------------------------------------------------
// 【なぜ作り直したか】
// 旧チョップ層は「軸からの同心円 sin(nθ-ωt)」を24本足しただけの解析関数で、
//  ・惑星全体で位相が揃った同心円の干渉縞になる(=幾何学的)
//  ・変位が半径方向のみで、粒子は高さマップの目印でしかない
//  ・状態がないので、波同士は互いを知らない(何本足しても素通しの加算)
// という構造だった。ここではこれを次の3層に置き換える。
//
// (1) ベースの波 = 球面上の"FFT"(球面調和関数変換)
//     平面のFFTは周期領域が前提で球に載らない。球面での等価物が球面
//     調和関数(SH)で、Y_lm = P_lm(cosθ)·e^{imφ} が「球の平面波」に当たる。
//     ランダム位相のSH係数を、深水波の分散関係 ω=√(g·k) (k=√(l(l+1)))
//     で時間発展させ、逆変換(合成)で海面を得る。
//       1. 各(緯度j, 次数m)で l について総和   (Legendre合成)
//       2. 各(経度i, 緯度j)で m について総和    (フーリエ合成)
//     の2段(compute pass A/B)。解析(順変換)は不要: 係数は乱数で作る。
//     合成する場は4つ: 高さh、水平変位d=∇g(g=Σĥ/k)、圧縮率c=Σkĥ。
//       ∇·d = -c (ラプラス・ベルトラミの固有値から厳密に成立)
//     h と d を粒子へ与えると、Gerstner/Tessendorf の choppy 波になる
//     (粒子は山に集まり谷で疎になる。J=1-λc<0 で水平変位が自己交差=砕波)。
//
// (2) 状態を持つ層(compute pass D, 合成グリッドのセルごと)
//     ここが「加算でなくなる」部分。海面が履歴(状態)を持つ:
//       E : 局所の波エネルギー(0..1)。砕波で散逸し、風で回復する。
//           出力の波は E の平方根倍に減衰する(=急峻な波頭ほど"抵抗"を受け、
//           強い波群が交差した場所だけ頭打ちになる。線形な一様減衰とは別物)
//       F : 泡。砕波の強さで生成され、指数的に消える(波が通り過ぎた跡に残る)
//     砕波判定は「変調後の」圧縮率 λ·c·√E で行うため、E が下がると砕波が
//     止まり、E が回復するとまた砕ける、という間欠的なカオスになる。
//     E,F は浅水シミュレーション(コリオリ・潮汐・風・移流を含む)の流れ場 U に
//     半ラグランジュ法で運ばれ、弱く拡散する。つまり砕波の跡(泡・エネルギー
//     欠損)は海流に乗って流れ、隣のセルへ広がる。ここが波と営力の接点。
// (3) 粒子(compute pass C)は、グリッドから h, d, E, F を補間して読み、
//     水平変位後の方向と波の高さを書き出すだけ。
// ============================================================
// ============================================================
const SW_L    = 56;   // SHの最大次数(最短波長 2π/56 ≒ 0.11rad)。細かすぎないよう控えめ
const SW_NLON = 384;  // 合成グリッド(経度)。最短波長あたり約7セル
const SW_NLAT = 192;  // 合成グリッド(緯度)
const SW_NLM  = (SW_L * (SW_L + 1)) / 2; // m=1..L, l=m..L の係数の総数

// ---- 波のスペクトル(見た目のつまみ) ----
const WAVE_H_RMS    = 0.025; // 高さのRMS。旧チョップ層(うねり込みでRMS≒0.055)の約半分
// 波のサイズ = スペクトルのピーク次数(大きいほど波が細かい)。固定値ではなく
// WAVE_PEAK_L_MIN(大きな波)〜WAVE_PEAK_L_MAX(細かい波)を時間で往復する(下の「波の呼吸」参照)。
// 基準だった旧固定値は8(ピーク波長 ≒ 2π/(1.14·次数) ≒ 0.69rad)。
const WAVE_PEAK_L_MIN = 4.5; // 一番大きな波のとき(ピーク波長 ≒ 1.2rad)
const WAVE_PEAK_L_MAX = 13;  // 一番細かい波のとき(ピーク波長 ≒ 0.42rad)
const WAVE_L_MIN    = 4;     // これ未満の次数は使わない(惑星スケールのうねりを排除)
const WAVE_SLOPE_P  = 3.0;   // 高次側のべき(Phillips: l^-3)。大きいほどさざ波が弱い
const WAVE_G        = 0.35;  // 分散関係 ω=√(G·k) 用の重力(旧CHOP_Gと同値)
const WAVE_STEEP_TARGET = 0.30; // 圧縮率λ·cのRMSの目標値(1.0で完全な砕波)

// ---- 砕波・エネルギー・泡(状態を持つ層) ----
const WAVE_BREAK_THR   = 0.55; // λ·c·√E がこれを超えると砕け始める
const WAVE_BREAK_RANGE = 0.35; // 砕波強度が0→1になるまでの幅
const WAVE_E_BREAK     = 5.0;  // 砕波によるエネルギー散逸レート (1/秒)
const WAVE_E_RECOVER   = 0.20; // 風によるエネルギー回復レート (1/秒)
const WAVE_E_MIN       = 0.30; // Eの下限(完全には死なせない)
const WAVE_FOAM_GAIN   = 12.0; // 泡の生成レート (1/秒)
const WAVE_FOAM_DECAY  = 0.9;  // 泡の減衰レート (1/秒) → 寿命およそ1秒強
const WAVE_CURRENT_GAIN = 3.0; // 浅水シミュレーションの流れ(rad/s)でE,Fを運ぶ強さ。対流を目に見えるようにするための演出上の倍率(実際の海流の速さ自体は変えない)
const WAVE_TIDE_HEIGHT = 0;  // 平衡潮汐のふくらみの高さ。「潮汐は一旦除外」の指示により無効化(元は0.05)。0で無効。月マーカー自体の表示には影響しない
const WAVE_E_DIFF      = 0.0006; // Eの拡散係数 (rad²/秒)
const WAVE_F_DIFF      = 0.0003; // 泡の拡散係数 (rad²/秒)

// ---- クリックの渦(泡の見た目のバースト。実際の渦度は浅水シミュレーション側=JSが担当) ----
const VORTEX_MAX         = 6;    // 同時に効かせる渦の最大数(古いものから捨てる)
const VORTEX_FOAM_RADIUS = 0.22; // 渦中心からの角距離スケール(rad)
const VORTEX_FOAM_BURST  = 3.0;  // 泡の生成レート(バースト中の追加分, 1/秒)
const VORTEX_FOAM_DUR    = 1.4;  // バーストが続く時間(秒)。sin包絡線で0→山→0。

// ---- 流れ・風との結合(CPU側の浅水シミュレーションが作る u,v,∇·u,風 を読む) ----
// 粒子は流れに乗って動く(弾性つきラグランジュ・ドリフト)。E・Fは粒子が持つ状態なので、
// ドリフトすればそのまま流れに運ばれる(=グリッドを使わずに移流を実現している)。
const WAVE_FLOW_GAIN   = 0.6;  // 流れ(rad/秒)に対する粒子ドリフト速度の倍率(演出用)
const WAVE_FLOW_TAU    = 3.0;  // ドリフト量が基準位置へ戻る時定数(秒)。定常ずれ ≒ GAIN·TAU·U
const WAVE_FLOW_OFFMAX = 0.30; // ドリフト量の上限(rad)。粒子が団子になりすぎないための保険
const WAVE_CONV_GAIN   = 1.2;  // 流れの収束(-∇·u, 1/秒)が砕波の圧縮率に上乗せされる倍率
const WAVE_E_LOW       = 0.55; // 風が弱い所でEが回復していく先(風が強い所は1.0)
const WAVE_WIND_REF    = 0.30; // 風応力の大きさがこの値以上なら「強風」扱い

// ---- 波の呼吸: 振幅・泡・波のサイズを、それぞれ独立した周期でゆっくり往復させる ----
// 3つとも 0..1 の滑らかな往復(0.5-0.5cos)を作り、周期もスタート位置も互いに無関係。
// 振幅は月の公転と、海流は月の公転の1/MOON_CALM_COUNTと整数比でそろえてあり、泡・サイズの周期は互いに割り切れない値(素数)。
// 時刻は経過時間(秒)そのもの。波が見え始める前から進んでいるので、PHASEは
// 「ページ読み込み直後の位置」を決めるだけ(0.25=中間で増加中, 0.75=中間で減少中)。
const WAVE_AMP_PERIOD  = MOON_ORBIT_PERIOD; // 振幅(波の高さ)の周期(秒)。月の公転と同じ長さ=月が1周するあいだに凪(最小)が1回
const WAVE_AMP_PHASE   = 0.75;
const WAVE_AMP_MOD_MIN = 0.3;  // 一番穏やかなとき: 従来の高さの0.3倍
const WAVE_AMP_MOD_MAX = 1.8;  // 一番荒れたとき: 従来の高さの1.8倍
const WAVE_AMP_DISP_CAP = 1.2; // 水平変位(尖り具合)は振幅に連動するが、この倍率で頭打ち(山での自己交差を避ける)

const WAVE_FOAM_PERIOD = 23;   // 泡の量の周期(秒)
const WAVE_FOAM_PHASE  = 0.25;
// 泡が立つ圧縮率のしきい値(低いほど泡が広く立つ)。つまみ0→1で NONE→MAX へ直線的に動く。
// NONE=0.9 では圧縮率がほぼ届かず泡はほとんど消える。MAX=0.25 では海面の3割弱に泡が立つ。
// 中間(0.5)は約0.575で、従来(BREAK_THR=0.55)とほぼ同じ泡の量。
const WAVE_FOAM_THR_NONE = 0.9;
const WAVE_FOAM_THR_MAX  = 0.25;

const WAVE_SIZE_PERIOD = 59;   // 波のサイズの周期(秒)
const WAVE_SIZE_PHASE  = 0.25;

function wave01(t, period, phase) {
  return 0.5 - 0.5 * Math.cos(2 * Math.PI * (t / period + phase));
}
let _waveModT = NaN, _waveModV = null;
function waveModAt(t) {
  if (t === _waveModT) return _waveModV; // 同じフレームでの重複呼び出し(WebGLフォールバックの粒子ごと)を安くする
  const sSize = wave01(t, WAVE_SIZE_PERIOD, WAVE_SIZE_PHASE);
  const sAmp  = wave01(t, WAVE_AMP_PERIOD,  WAVE_AMP_PHASE);
  const sFoam = wave01(t, WAVE_FOAM_PERIOD, WAVE_FOAM_PHASE);
  _waveModT = t;
  _waveModV = {
    // サイズは「倍率」で感じるものなので対数で補間(MIN→MAXが4.5→13でも体感が偏らない)
    peakL: WAVE_PEAK_L_MIN * Math.pow(WAVE_PEAK_L_MAX / WAVE_PEAK_L_MIN, sSize),
    ampMod: WAVE_AMP_MOD_MIN + (WAVE_AMP_MOD_MAX - WAVE_AMP_MOD_MIN) * sAmp,
    foamS: sFoam, // 0..1。シェーダ側でしきい値の移動量に変換する
  };
  return _waveModV;
}

// (m, l) → 係数配列内の位置。m=1..L について l=m..L を連続して並べる。
function swOff(m) { return (m - 1) * (SW_L + 1) - ((m - 1) * m) / 2; }

function swGauss() {
  let u = 0, v = 0;
  while (u === 0) u = Math.random();
  v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// 完全正規化した陪ルジャンドル関数 P̄_l^m(cosθ) とその θ 微分を、
// 合成グリッドの各緯度行について前計算する(Condon-Shortley位相は落としている。
// 係数がランダム位相なので統計に影響せず、P と dP で同じ規約を使えば一貫する)。
function swBuildLegendre() {
  const L = SW_L, NLM = SW_NLM;
  const P = new Float32Array(SW_NLAT * NLM);
  const DP = new Float32Array(SW_NLAT * NLM);
  const tab = new Float64Array((L + 1) * (L + 1)); // [m*(L+1)+l]
  for (let j = 0; j < SW_NLAT; j++) {
    const th = (j + 0.5) * Math.PI / SW_NLAT;
    const x = Math.cos(th), s = Math.sin(th);
    tab.fill(0);
    let pmm = Math.sqrt(1 / (4 * Math.PI));
    for (let m = 0; m <= L; m++) {
      if (m > 0) pmm *= Math.sqrt((2 * m + 1) / (2 * m)) * s;
      tab[m * (L + 1) + m] = pmm;
      if (m + 1 <= L) tab[m * (L + 1) + m + 1] = Math.sqrt(2 * m + 3) * x * pmm;
      for (let l = m + 2; l <= L; l++) {
        const a = Math.sqrt((4 * l * l - 1) / (l * l - m * m));
        const b = Math.sqrt(((l - 1) * (l - 1) - m * m) / (4 * (l - 1) * (l - 1) - 1));
        tab[m * (L + 1) + l] = a * (x * tab[m * (L + 1) + l - 1] - b * tab[m * (L + 1) + l - 2]);
      }
    }
    for (let m = 1; m <= L; m++) {
      const off = swOff(m);
      for (let l = m; l <= L; l++) {
        const p = tab[m * (L + 1) + l];
        const pl1 = l > m ? tab[m * (L + 1) + l - 1] : 0;
        const e = Math.sqrt(((2 * l + 1) / (2 * l - 1)) * (l * l - m * m));
        const dp = (l * x * p - e * pl1) / s; // dP̄/dθ
        P[j * NLM + off + (l - m)] = p;
        DP[j * NLM + off + (l - m)] = dp;
      }
    }
  }
  return { P, DP };
}

// e^{imφ_i} の表。φ_i = atan2(z,x) と同じ規約(セル中心, -π..π)。
function swBuildCosSin() {
  const M = SW_L;
  const t = new Float32Array(SW_NLON * M * 2);
  for (let i = 0; i < SW_NLON; i++) {
    const phi = (i + 0.5) * 2 * Math.PI / SW_NLON - Math.PI;
    for (let m = 1; m <= M; m++) {
      t[(i * M + (m - 1)) * 2] = Math.cos(m * phi);
      t[(i * M + (m - 1)) * 2 + 1] = Math.sin(m * phi);
    }
  }
  return t;
}

// ランダム位相・ランダム振幅(ガウス)のSH係数を作る(標準正規分布のまま保持)。
// ĉ_lm(t) = g_l·(A·e^{-iωt} + B·e^{+iωt}): A は経度方向に+向き、B は-向きに進む波。
// 次数ごとの重み g_l は swGainsAt() が毎フレーム作る。Pierson-Moskowitz型
// l^-p·exp(-1.25(lp/l)^4) に比例した分散で、合計が WAVE_H_RMS² になるよう正規化する。
// ピーク次数 lp を時間で動かしても、乱数そのものは変えないので波は不連続に切り替わらず、
// 「大きな波がせり上がって細かい波に移っていく」ように連続的に変形する。
function swBuildSpectrum() {
  const L = SW_L, NLM = SW_NLM;
  const A = new Float64Array(NLM * 2), B = new Float64Array(NLM * 2);
  const omega = new Float64Array(NLM);
  const lOf = new Uint8Array(NLM);
  for (let l = WAVE_L_MIN; l <= L; l++) {
    const k = Math.sqrt(l * (l + 1));
    const w = Math.sqrt(WAVE_G * k);
    // m=0 は使わないので、次数lの分散は m=1..l の 2l 個(±mの対で2倍)で担う。
    for (let m = 1; m <= l; m++) {
      const idx = swOff(m) + (l - m);
      A[2 * idx] = swGauss(); A[2 * idx + 1] = swGauss();
      B[2 * idx] = swGauss(); B[2 * idx + 1] = swGauss();
      omega[idx] = w;
      lOf[idx] = l;
    }
  }
  return { A, B, omega, lOf };
}

// ピーク次数 peakL のときの、次数ごとの係数の重み gains[l] と、圧縮率の指標を返す。
//   choppy   : 水平変位の倍率(圧縮率のRMS σc·choppy が WAVE_STEEP_TARGET に揃うように決める。
//              波が細かいほどσcが大きいので、choppyは自動で小さくなり、細かい波でも尖りすぎない)
//   foamNorm : 泡の判定用の補正。choppyが下限/上限に当たって圧縮率のRMSが目標からずれた分を戻し、
//              波のサイズが変わっても泡の出やすさが変わらないようにする(泡の量は泡のつまみだけで決まる)
const _swS = new Float64Array(SW_L + 1);
function swGainsAt(peakL, gains) {
  const L = SW_L;
  let sum = 0;
  for (let l = WAVE_L_MIN; l <= L; l++) {
    _swS[l] = Math.pow(l, -WAVE_SLOPE_P) * Math.exp(-1.25 * Math.pow(peakL / l, 4));
    sum += _swS[l];
  }
  let sigC2 = 0;
  for (let l = WAVE_L_MIN; l <= L; l++) {
    const V = (WAVE_H_RMS * WAVE_H_RMS) * _swS[l] / sum;
    sigC2 += V * l * (l + 1);
    gains[l] = Math.sqrt(Math.PI * V / (2 * l)); // 旧: sd = √(q/4), q = 4πV/(2l)
  }
  const sigmaC = Math.sqrt(sigC2);
  const choppy = Math.min(1.0, Math.max(0.35, WAVE_STEEP_TARGET / sigmaC));
  return { sigmaC, choppy, foamNorm: WAVE_STEEP_TARGET / (choppy * sigmaC) };
}

// 時刻 t の係数(複素)を out[2*idx], out[2*idx+1] に書く。CPU側でdoubleのまま計算する
// (1600個程度なので軽く、GPU側でωtの精度を心配しなくてよい)。
function swCoefAt(spec, t, out, gains) {
  const { A, B, omega, lOf } = spec;
  for (let idx = 0; idx < SW_NLM; idx++) {
    const w = omega[idx];
    if (w === 0) { out[2 * idx] = 0; out[2 * idx + 1] = 0; continue; }
    const g = gains[lOf[idx]];
    const c = Math.cos(w * t), s = Math.sin(w * t);
    const Ar = A[2 * idx], Ai = A[2 * idx + 1], Br = B[2 * idx], Bi = B[2 * idx + 1];
    out[2 * idx]     = g * ((Ar * c + Ai * s) + (Br * c - Bi * s));
    out[2 * idx + 1] = g * ((Ai * c - Ar * s) + (Bi * c + Br * s));
  }
}

function swF(x) { return Number(x).toFixed(6); }

// WGSL: pass A (緯度j × 次数m ごとに、l について総和)
function swShaderA() {
  return `
const L: u32 = ${SW_L}u;
const M: u32 = ${SW_L}u;
const NLAT: u32 = ${SW_NLAT}u;
const NLM: u32 = ${SW_NLM}u;
const PI: f32 = 3.14159265359;

@group(0) @binding(0) var<storage, read> coefT: array<vec2<f32>>;
@group(0) @binding(1) var<storage, read> legP: array<f32>;
@group(0) @binding(2) var<storage, read> legDP: array<f32>;
@group(0) @binding(3) var<storage, read_write> fm: array<vec4<f32>>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let tid = gid.x;
  if (tid >= NLAT * M) { return; }
  let j = tid / M;
  let m = (tid % M) + 1u;
  let off = (m - 1u) * (L + 1u) - ((m - 1u) * m) / 2u;
  let sinT = sin((f32(j) + 0.5) * PI / f32(NLAT));

  var H = vec2<f32>(0.0);
  var C = vec2<f32>(0.0);
  var Gth = vec2<f32>(0.0);
  var S2 = vec2<f32>(0.0);
  for (var l: u32 = m; l <= L; l = l + 1u) {
    let idx = off + (l - m);
    let c = coefT[idx];
    let p = legP[j * NLM + idx];
    let dp = legDP[j * NLM + idx];
    let k = sqrt(f32(l * (l + 1u)));
    H = H + c * p;
    C = C + c * (p * k);
    Gth = Gth + c * (dp / k);
    S2 = S2 + c * (p / k);
  }
  // (1/sinθ)·∂φ に相当する i·m/sinθ を掛ける
  let mf = f32(m) / sinT;
  let Gph = vec2<f32>(-mf * S2.y, mf * S2.x);
  let o = (j * M + (m - 1u)) * 2u;
  fm[o] = vec4<f32>(H.x, H.y, C.x, C.y);
  fm[o + 1u] = vec4<f32>(Gth.x, Gth.y, Gph.x, Gph.y);
}
`;
}

// WGSL: pass B (経度i × 緯度j ごとに、m について総和 → デカルトの接線変位へ変換)
function swShaderB() {
  return `
const M: u32 = ${SW_L}u;
const NLON: u32 = ${SW_NLON}u;
const NLAT: u32 = ${SW_NLAT}u;
const PI: f32 = 3.14159265359;

@group(0) @binding(0) var<storage, read> fm: array<vec4<f32>>;
@group(0) @binding(1) var<storage, read> cosSin: array<vec2<f32>>;
@group(0) @binding(2) var<storage, read_write> waveA: array<vec4<f32>>; // xyz = 接線変位d, w = 高さh
@group(0) @binding(3) var<storage, read_write> waveC: array<f32>;      // 圧縮率c (∇·d = -c)

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x;
  if (cell >= NLON * NLAT) { return; }
  let i = cell % NLON;
  let j = cell / NLON;
  var h = 0.0;
  var c = 0.0;
  var gth = 0.0;
  var gph = 0.0;
  for (var m: u32 = 1u; m <= M; m = m + 1u) {
    let cs = cosSin[i * M + (m - 1u)];
    let o = (j * M + (m - 1u)) * 2u;
    let a = fm[o];
    let b = fm[o + 1u];
    h = h + (a.x * cs.x - a.y * cs.y);
    c = c + (a.z * cs.x - a.w * cs.y);
    gth = gth + (b.x * cs.x - b.y * cs.y);
    gph = gph + (b.z * cs.x - b.w * cs.y);
  }
  h = h * 2.0; c = c * 2.0; gth = gth * 2.0; gph = gph * 2.0;

  let theta = (f32(j) + 0.5) * PI / f32(NLAT);
  let phi = (f32(i) + 0.5) * 2.0 * PI / f32(NLON) - PI;
  let st = sin(theta); let ct = cos(theta);
  let sp = sin(phi);   let cp = cos(phi);
  let eth = vec3<f32>(ct * cp, -st, ct * sp);
  let eph = vec3<f32>(-sp, 0.0, cp);
  let d = eth * gth + eph * gph;
  waveA[cell] = vec4<f32>(d, h);
  waveC[cell] = c;
}
`;
}

// WGSL: pass D (グリッドのセルごとの状態更新: 移流→砕波→エネルギー散逸→泡)
function swShaderD(oceanLon, oceanLat) {
  return `
struct WaveParams { time: f32, dt: f32, fade: f32, tide: f32, moon: vec4<f32>, extra: vec4<f32>, }; // extra = (choppy, 振幅倍率, 泡つまみ0..1, 泡の判定補正)
@group(0) @binding(0) var<uniform> wp: WaveParams;
@group(0) @binding(1) var<storage, read> waveC: array<f32>;
@group(0) @binding(2) var<storage, read> stIn: array<vec2<f32>>;
@group(0) @binding(3) var<storage, read_write> stOut: array<vec2<f32>>;
@group(0) @binding(4) var<storage, read> cur: array<vec2<f32>>; // 浅水シミュレーションの流れ (x=東向きu, y=北向きv) [rad/s]
@group(0) @binding(5) var<storage, read> vortices: array<vec4<f32>>; // xyz=中心方向, w=発生時刻(t0)

const PI: f32 = 3.14159265359;
const VORTEX_MAX: u32 = ${VORTEX_MAX}u;
const VORTEX_FOAM_RADIUS: f32 = ${swF(VORTEX_FOAM_RADIUS)};
const VORTEX_FOAM_BURST: f32 = ${swF(VORTEX_FOAM_BURST)};
const VORTEX_FOAM_DUR: f32 = ${swF(VORTEX_FOAM_DUR)};
const NLON: u32 = ${SW_NLON}u;
const NLAT: u32 = ${SW_NLAT}u;
const NLON_I: i32 = ${SW_NLON};
const NLAT_I: i32 = ${SW_NLAT};
const DPHI: f32 = ${swF(2 * Math.PI / SW_NLON)};
const DTHETA: f32 = ${swF(Math.PI / SW_NLAT)};
const OLON_I: i32 = ${oceanLon};
const OLAT_I: i32 = ${oceanLat};
const ODLON: f32 = ${swF(2 * Math.PI / oceanLon)};
const ODLAT: f32 = ${swF(Math.PI / oceanLat)};
const FOAM_THR_NONE: f32 = ${swF(WAVE_FOAM_THR_NONE)};
const FOAM_THR_MAX: f32 = ${swF(WAVE_FOAM_THR_MAX)};
const CUR_GAIN: f32 = ${swF(WAVE_CURRENT_GAIN)};
const BREAK_THR: f32 = ${swF(WAVE_BREAK_THR)};
const BREAK_RANGE: f32 = ${swF(WAVE_BREAK_RANGE)};
const E_BREAK: f32 = ${swF(WAVE_E_BREAK)};
const E_RECOVER: f32 = ${swF(WAVE_E_RECOVER)};
const E_MIN: f32 = ${swF(WAVE_E_MIN)};
const FOAM_GAIN: f32 = ${swF(WAVE_FOAM_GAIN)};
const FOAM_DECAY: f32 = ${swF(WAVE_FOAM_DECAY)};
const E_DIFF: f32 = ${swF(WAVE_E_DIFF)};
const F_DIFF: f32 = ${swF(WAVE_F_DIFF)};

fn stAt(i: i32, j: i32) -> vec2<f32> {
  let ii = ((i % NLON_I) + NLON_I) % NLON_I;
  let jj = clamp(j, 0, NLAT_I - 1);
  return stIn[u32(jj * NLON_I + ii)];
}

fn stSample(theta: f32, phi: f32) -> vec2<f32> {
  let fi = (phi + PI) / DPHI - 0.5;
  let fj = theta / DTHETA - 0.5;
  let i0 = i32(floor(fi));
  let j0 = i32(floor(fj));
  let ti = fi - floor(fi);
  let tj = fj - floor(fj);
  return mix(mix(stAt(i0, j0), stAt(i0 + 1, j0), ti),
             mix(stAt(i0, j0 + 1), stAt(i0 + 1, j0 + 1), ti), tj);
}

fn curAt(i: i32, j: i32) -> vec2<f32> {
  let ii = ((i % OLON_I) + OLON_I) % OLON_I;
  let jj = clamp(j, 0, OLAT_I - 1);
  return cur[u32(jj * OLON_I + ii)];
}

// 浅水シミュレーション側の格子(lon=φ+π, lat=π/2-θ)を双一次補間
fn curSample(theta: f32, phi: f32) -> vec2<f32> {
  let fi = (phi + PI) / ODLON - 0.5;
  let fj = (PI - theta) / ODLAT - 0.5;
  let i0 = i32(floor(fi));
  let j0 = i32(floor(fj));
  let ti = fi - floor(fi);
  let tj = fj - floor(fj);
  return mix(mix(curAt(i0, j0), curAt(i0 + 1, j0), ti),
             mix(curAt(i0, j0 + 1), curAt(i0 + 1, j0 + 1), ti), tj);
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let cell = gid.x;
  if (cell >= NLON * NLAT) { return; }
  let i = i32(cell % NLON);
  let j = i32(cell / NLON);
  let theta = (f32(j) + 0.5) * DTHETA;
  let phi = (f32(i) + 0.5) * DPHI - PI;
  let dtp = wp.dt;

  // ---- 移流: 流れに沿って一歩さかのぼった位置の状態を読む(半ラグランジュ法) ----
  // u は東向き(+φ), v は北向き(θが減る向き)。極付近は sinθ を下限で止める。
  let uv = curSample(theta, phi) * CUR_GAIN;
  let sinT = max(sin(theta), 0.3);
  let adv = stSample(theta + uv.y * dtp, phi - uv.x * dtp / sinT);

  // ---- 拡散: 隣のセルへの弱い広がり(経度方向は極付近でsinθを下限で止める) ----
  let c0 = stAt(i, j);
  let sl = max(sin(theta), 0.5);
  let lap = (stAt(i + 1, j) + stAt(i - 1, j) - 2.0 * c0) / (sl * sl * DPHI * DPHI)
          + (stAt(i, j + 1) + stAt(i, j - 1) - 2.0 * c0) / (DTHETA * DTHETA);

  var E = adv.x + dtp * E_DIFF * lap.x;
  var F = adv.y + dtp * F_DIFF * lap.y;

  // ---- 砕波: エネルギーで変調した後の圧縮率(J = 1 - comp が0に近づくほど砕ける) ----
  // 振幅のつまみは粒子への書き出し(pass C)だけに掛かり、ここには影響しない。
  // 波のサイズが変わると圧縮率が変わるが、choppy(wp.extra.x)がそれを打ち消す。
  let comp = wp.extra.x * waveC[cell] * wp.fade * sqrt(clamp(E, 0.0, 1.0));
  let br = clamp((comp - BREAK_THR) / BREAK_RANGE, 0.0, 1.0);
  E = E + dtp * (E_RECOVER * (1.0 - E) - E_BREAK * br * E);
  // 泡だけは別のしきい値で判定する: 泡のつまみ(wp.extra.z, 0..1)でしきい値が
  // FOAM_THR_NONE(泡なし)〜FOAM_THR_MAX(泡だらけ)の間を動く。波のエネルギーの散逸(上のbr)は
  // 泡のつまみと無関係に保つ。
  let compF = comp * wp.extra.w;
  let thrF = mix(FOAM_THR_NONE, FOAM_THR_MAX, wp.extra.z);
  let brF = clamp((compF - thrF) / BREAK_RANGE, 0.0, 1.0);
  F = F + dtp * (FOAM_GAIN * brF * (1.0 - F) - FOAM_DECAY * F);

  // ---- クリックの渦: 中心からの角距離に応じたガウス減衰で、短時間だけ泡を追加生成する。
  // 実際の渦の回転運動そのものは浅水シミュレーション(u,v)側が力として受け取って発達させ、
  // その結果生じた海流がこの泡を運ぶ(移流は本関数冒頭のstSampleが既に担っている)。
  // ここではあくまで「クリックした場所に何かが起きた」ことを示す初速の泡を足すだけ。
  let cellDir = vec3<f32>(sin(theta) * cos(phi), cos(theta), sin(theta) * sin(phi));
  var burst = 0.0;
  for (var vi: u32 = 0u; vi < VORTEX_MAX; vi = vi + 1u) {
    let vd = vortices[vi];
    let age = wp.time - vd.w;
    if (age < 0.0 || age > VORTEX_FOAM_DUR) { continue; }
    let envv = sin(clamp(age / VORTEX_FOAM_DUR, 0.0, 1.0) * PI);
    let dd = acos(clamp(dot(cellDir, vd.xyz), -1.0, 1.0));
    burst = burst + envv * exp(-(dd * dd) / (VORTEX_FOAM_RADIUS * VORTEX_FOAM_RADIUS));
  }
  F = F + dtp * VORTEX_FOAM_BURST * burst * (1.0 - F);

  stOut[cell] = vec2<f32>(clamp(E, E_MIN, 1.0), clamp(F, 0.0, 1.0));
}
`;
}

// WGSL: pass C (粒子ごと: グリッドから h, d, E, F を補間して変位を書き出す)
function swShaderC() {
  return `
struct Particle {
  basePosSeed: vec4<f32>,
  posWaveH: vec4<f32>,   // xyz = 変位後の単位方向, w = スペクトル波の高さ
  velAlpha: vec4<f32>,   // x = E(波エネルギー), y = F(泡) [毎フレームグリッドから補間], z = 潮汐のふくらみ, w = alpha(触らない)
  attr: vec4<f32>,
};
struct WaveParams { time: f32, dt: f32, fade: f32, tide: f32, moon: vec4<f32>, extra: vec4<f32>, }; // extra = (choppy, 振幅倍率, 泡つまみ0..1, 泡の判定補正)

@group(0) @binding(0) var<uniform> wp: WaveParams;
@group(0) @binding(1) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> waveA: array<vec4<f32>>;
@group(0) @binding(3) var<storage, read> stateG: array<vec2<f32>>; // 今フレームの更新後の (E, F)

const PI: f32 = 3.14159265359;
const NLON_I: i32 = ${SW_NLON};
const NLAT_I: i32 = ${SW_NLAT};
const DPHI: f32 = ${swF(2 * Math.PI / SW_NLON)};
const DTHETA: f32 = ${swF(Math.PI / SW_NLAT)};
const DISP_AMP_CAP: f32 = ${swF(WAVE_AMP_DISP_CAP)};

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let idx = gid.x;
  if (idx >= arrayLength(&particles)) { return; }
  // 全モード(海面=0, 水しぶき=1, 泳ぐ文章=2)を対象にする。水しぶきは基準位置での
  // 局所E,F(=砕波トリガー用)だけを使い、posWaveHの表示上の変位自体は使わない。
  // 泳ぐ文章はposWaveH(変位方向+波高)をそのまま「水面に浮かぶ位置」として使う。
  let base = particles[idx].basePosSeed.xyz;

  // ---- 合成グリッドを双一次補間 ----
  let theta = acos(clamp(base.y, -1.0, 1.0));
  let phi = atan2(base.z, base.x);
  let fi = (phi + PI) / DPHI - 0.5;
  let fj = theta / DTHETA - 0.5;
  let fi0 = floor(fi);
  let fj0 = floor(fj);
  let ti = fi - fi0;
  let tj = fj - fj0;
  let i0 = ((i32(fi0) % NLON_I) + NLON_I) % NLON_I;
  let i1 = (i0 + 1) % NLON_I;
  let j0 = clamp(i32(fj0), 0, NLAT_I - 1);
  let j1 = clamp(i32(fj0) + 1, 0, NLAT_I - 1);
  let k00 = u32(j0 * NLON_I + i0);
  let k10 = u32(j0 * NLON_I + i1);
  let k01 = u32(j1 * NLON_I + i0);
  let k11 = u32(j1 * NLON_I + i1);
  let a = mix(mix(waveA[k00], waveA[k10], ti), mix(waveA[k01], waveA[k11], ti), tj);
  let st = mix(mix(stateG[k00], stateG[k10], ti), mix(stateG[k01], stateG[k11], ti), tj);

  // ---- 出力: 水平変位(choppy) + 高さ。エネルギーEが低い所ほど波は弱い ----
  // wp.extra.y = 振幅の時間変化(高さにそのまま掛ける)。水平変位も連動させるが、尖りすぎて
  // 山で自己交差しないよう DISP_AMP_CAP で頭打ちにする。
  let amp = wp.fade * sqrt(clamp(st.x, 0.0, 1.0));
  var dd = a.xyz * (wp.extra.x * amp * min(wp.extra.y, DISP_AMP_CAP));
  dd = dd - base * dot(dd, base);       // 接平面へ射影
  let dir = normalize(base + dd);
  particles[idx].posWaveH = vec4<f32>(dir, a.w * amp * wp.extra.y);
  // 平衡潮汐: 月方向(moon)との成す角の (3cos²θ-1)/2。高さとは別に velAlpha.z へ書き、
  // 頂点シェーダで半径方向にだけ足す(波の白いハイライト判定には混ぜない)。
  let ct = dot(base, wp.moon.xyz);
  let tideH = wp.tide * wp.fade * (3.0 * ct * ct - 1.0) * 0.5;
  particles[idx].velAlpha = vec4<f32>(st.x, st.y, tideH, particles[idx].velAlpha.w);
}
`;
}

// device と、粒子バッファ(read_write でバインドする)を受け取り、
// 毎フレーム encode() を呼ぶだけで「SH合成A→B→状態更新D→粒子更新C」を積む。
// oceanLon/oceanLat: 浅水シミュレーション(流れ場)の格子サイズ。
async function createSpectralOcean(device, particleBuffer, particleCount, oceanLon, oceanLat) {
  const spec = swBuildSpectrum();
  const leg = swBuildLegendre();
  const cosSin = swBuildCosSin();

  const mkBuf = (arr, usage) => {
    const b = device.createBuffer({ size: arr.byteLength, usage: usage | GPUBufferUsage.COPY_DST });
    device.queue.writeBuffer(b, 0, arr);
    return b;
  };
  const S = GPUBufferUsage.STORAGE;
  const coefT = new Float32Array(SW_NLM * 2);
  const coefBuf = device.createBuffer({ size: coefT.byteLength, usage: S | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC });
  const legPBuf = mkBuf(leg.P, S);
  const legDPBuf = mkBuf(leg.DP, S);
  const cosSinBuf = mkBuf(cosSin, S);
  const fmBuf = device.createBuffer({ size: SW_NLAT * SW_L * 2 * 16, usage: S });
  const nCells = SW_NLON * SW_NLAT;
  const waveABuf = device.createBuffer({ size: nCells * 16, usage: S | GPUBufferUsage.COPY_SRC });
  const waveCBuf = device.createBuffer({ size: nCells * 4, usage: S | GPUBufferUsage.COPY_SRC });
  // 状態(E,F)は2枚をピンポンで使う。初期値は E=1(満タン), F=0。
  const stInit = new Float32Array(nCells * 2);
  for (let k = 0; k < nCells; k++) stInit[2 * k] = 1.0;
  const stBuf = [mkBuf(stInit, S | GPUBufferUsage.COPY_SRC), mkBuf(stInit, S | GPUBufferUsage.COPY_SRC)];
  const curBuf = device.createBuffer({ size: oceanLon * oceanLat * 8, usage: S | GPUBufferUsage.COPY_DST });
  const vortexBuf = device.createBuffer({ size: VORTEX_MAX * 16, usage: S | GPUBufferUsage.COPY_DST });
  const vortexArr = new Float32Array(VORTEX_MAX * 4);
  const paramsBuf = device.createBuffer({ size: 48, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
  const params = new Float32Array(12);
  const gains = new Float64Array(SW_L + 1); // 次数ごとの係数の重み(波のサイズの時間変化で毎フレーム作り直す)

  const mkPipe = async (name, code) => {
    // シェーダのコンパイルエラーはエラースコープで拾い、コンソールに出す
    device.pushErrorScope('validation');
    const module = device.createShaderModule({ code });
    const pipe = device.createComputePipeline({ layout: 'auto', compute: { module, entryPoint: 'main' } });
    const err = await device.popErrorScope();
    if (err) console.error(`[spectral ocean:${name}] ${err.message}`);
    return pipe;
  };
  const pipeA = await mkPipe('A', swShaderA());
  const pipeB = await mkPipe('B', swShaderB());
  const pipeD = await mkPipe('D', swShaderD(oceanLon, oceanLat));
  const pipeC = await mkPipe('C', swShaderC());

  const bg = (pipe, bufs) => device.createBindGroup({
    layout: pipe.getBindGroupLayout(0),
    entries: bufs.map((buffer, binding) => ({ binding, resource: { buffer } })),
  });
  const bgA = bg(pipeA, [coefBuf, legPBuf, legDPBuf, fmBuf]);
  const bgB = bg(pipeB, [fmBuf, cosSinBuf, waveABuf, waveCBuf]);
  // parity p: D は stBuf[p] を読んで stBuf[1-p] に書き、C は stBuf[1-p] を読む
  const bgD = [0, 1].map(p => bg(pipeD, [paramsBuf, waveCBuf, stBuf[p], stBuf[1 - p], curBuf, vortexBuf]));
  const bgC = [0, 1].map(p => bg(pipeC, [paramsBuf, particleBuffer, waveABuf, stBuf[1 - p]]));
  let parity = 0;

  return {
    spec,
    buffers: { coefBuf, waveABuf, waveCBuf, fmBuf, stBuf, curBuf, vortexBuf },
    get parity() { return parity; },
    // time: 波の時刻(秒)。fade: 0..1(鼓動開始後に立ち上がる全体の強さ)。
    // oceanUV: 浅水シミュレーションの流れ(u,vインターリーブ, oceanLon*oceanLat*2)
    // moon: 月の方向ベクトル {x,y,z}(単位ベクトル。潮汐のふくらみの向き)
    // vortices: [{x,y,z,t0}, ...] クリックで発生した渦(新しい順でなくてよい)。VORTEX_MAX件まで。
    encode(encoder, time, dt, fade, oceanUV, moon, vortices) {
      // 波の呼吸(振幅・泡・サイズ): 毎フレーム、時刻から3つのつまみの値を決める
      const wm = waveModAt(time);
      const sg = swGainsAt(wm.peakL, gains);
      swCoefAt(spec, time, coefT, gains);
      device.queue.writeBuffer(coefBuf, 0, coefT);
      if (oceanUV) device.queue.writeBuffer(curBuf, 0, oceanUV);
      vortexArr.fill(0);
      for (let i = 0; i < VORTEX_MAX; i++) {
        const v = vortices && vortices[i];
        vortexArr[4 * i + 3] = -1e9; // 既定値: 十分昔(常にage>DURなので無効)
        if (v) { vortexArr[4*i]=v.x; vortexArr[4*i+1]=v.y; vortexArr[4*i+2]=v.z; vortexArr[4*i+3]=v.t0; }
      }
      device.queue.writeBuffer(vortexBuf, 0, vortexArr);
      params[0] = time; params[1] = dt; params[2] = fade; params[3] = WAVE_TIDE_HEIGHT;
      params[4] = moon ? moon.x : -1; params[5] = moon ? moon.y : 0; params[6] = moon ? moon.z : 0; params[7] = 0;
      params[8] = sg.choppy; params[9] = wm.ampMod; params[10] = wm.foamS; params[11] = sg.foamNorm;
      device.queue.writeBuffer(paramsBuf, 0, params);
      const pass = encoder.beginComputePass();
      pass.setPipeline(pipeA); pass.setBindGroup(0, bgA);
      pass.dispatchWorkgroups(Math.ceil(SW_NLAT * SW_L / 64));
      pass.setPipeline(pipeB); pass.setBindGroup(0, bgB);
      pass.dispatchWorkgroups(Math.ceil(nCells / 64));
      pass.setPipeline(pipeD); pass.setBindGroup(0, bgD[parity]);
      pass.dispatchWorkgroups(Math.ceil(nCells / 64));
      pass.setPipeline(pipeC); pass.setBindGroup(0, bgC[parity]);
      pass.dispatchWorkgroups(Math.ceil(particleCount / 64));
      pass.end();
      parity = 1 - parity;
    },
  };
}

// ====================================================
// 1. WebGPU バックエンド (粒子球 + 出現スイープ + SH海面のcompute pass)
// ----------------------------------------------------
// 鼓動開始以降の波は、createSpectralOcean() の compute pass
// (SH合成A→B→グリッドの砕波/泡/エネルギー更新D→粒子への書き出しC)が
// particleBuffer の posWaveH(変位後の方向+波の高さ)と velAlpha(E,F,潮汐)を
// 毎フレーム書き、頂点シェーダはそれを読むだけ。
// 対流・コリオリ・風はCPU側の浅水シミュレーション(updateOcean)が解き、その
// 流れ場 u,v を oceanUVGPU としてD passへ渡して、砕波の跡を運ばせている。
// 潮汐は平衡潮汐のふくらみとして C pass が直接足している(WAVE_TIDE_HEIGHT)。
// ====================================================
async function tryInitWebGPU() {
  if (!navigator.gpu) return false;
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) return false;
  const device = await adapter.requestDevice();
  onDispose(() => { try { device.destroy(); } catch (e) {} });
  const context = canvas.getContext('webgpu');
  if (!context) return false;
  onDispose(() => { try { context.unconfigure(); } catch (e) {} });
  const format = navigator.gpu.getPreferredCanvasFormat();

  // 泳ぐ文章: フォント読み込み待ちがあるため非同期。グリフアトラス(1文字ずつの
  // グリフを敷き詰めたcanvas)を先に作り、そのindexを使って各単語を「鎖」として
  // 初期化する(setupSwimChains、位置はparticleDataへ直接書く。テクスチャ用
  // canvasもこのあとすぐGPUへアップロードするので、ここでawaitして完成を待つ)。
  let glyphAtlas = null;
  try {
    glyphAtlas = await buildGlyphAtlas();
    setupSwimChains(glyphAtlas);
  } catch (e) { console.warn('[swim text] failed to build:', e); }

  const particleBuffer = device.createBuffer({
    size: particleData.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(particleBuffer, 0, particleData);

  // グリフアトラスのcanvasをそのままGPUテクスチャへアップロードする
  // (失敗時・未対応時は1×1の透明テクスチャで代用し、文字が単に出ないだけにする)。
  const glyphAtlasCols = glyphAtlas ? glyphAtlas.cols : 1;
  const glyphAtlasRows = glyphAtlas ? glyphAtlas.rows : 1;
  const glyphTexture = device.createTexture({
    size: [glyphAtlas ? glyphAtlas.canvas.width : 1, glyphAtlas ? glyphAtlas.canvas.height : 1],
    format: 'rgba8unorm',
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | GPUTextureUsage.RENDER_ATTACHMENT,
  });
  if (glyphAtlas) {
    device.queue.copyExternalImageToTexture(
      { source: glyphAtlas.canvas },
      { texture: glyphTexture },
      [glyphAtlas.canvas.width, glyphAtlas.canvas.height],
    );
  }
  const glyphSampler = device.createSampler({
    magFilter: 'linear', minFilter: 'linear',
    addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge',
  });

  // 海洋(対流・潮汐)の高さ場。CPU側(updateOcean)が毎フレーム計算した
  // oceanHeightGPUをそのままアップロードし、頂点シェーダ側は
  // sampleOceanHeight()で双一次補間して読むだけにする。
  const oceanGridBuffer = device.createBuffer({
    size: oceanHeightGPU.byteLength,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
  });
  device.queue.writeBuffer(oceanGridBuffer, 0, oceanHeightGPU);

  // Render Uniform: mvp(64B) + misc(16B) + strike(16B)
  //                 + vortexMeta(16B: 予備) + vortexData(6×16B: xyz=中心方向, w=発生時刻<0で無効)
  //                 + vortexSign(6×16B: x=回転方向+1/-1) + moonDir(16B)
  //                 クリックの渦(回転)・月マーカーをレンダリング側だけで計算するための入力。
  const renderParamsBuffer = device.createBuffer({
    size: 320, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
  });

  const particleRenderShaderCode = `
struct RenderParams {
  mvp: mat4x4<f32>,
  misc: vec4<f32>, // x = 湖形成トリガーからの経過秒数 (<0: 未トリガー), y = Hapworth入力による事前成長度(0..1), z = 鼓動の強さ(0..1、CPU側computeBeatValで計算), w = 生の経過秒数
  strike: vec4<f32>, // x/y/z = "Lake"の"L"/"a"/"k"打鍵からの経過秒数 (<0: 未発火)
  vortexMeta: vec4<f32>, // 予備(現状未使用。各要素はvortexData[i].wの符号で有効/無効を判定する)
  vortexData: array<vec4<f32>, 6>, // クリックの渦: xyz=中心方向(単位ベクトル), w=発生時刻(生の経過秒数、<0なら無効スロット)
  vortexSign: array<vec4<f32>, 6>, // クリックの渦の回転方向: x=+1/-1(yzwは未使用)。vortexDataと同じインデックスで対応
  moonDir: vec4<f32>, // xyz = 月マーカー/潮汐計算と同じ方向(正規化前でもよい)。wは未使用
};

struct Particle {
  basePosSeed: vec4<f32>,
  posWaveH: vec4<f32>,
  velAlpha: vec4<f32>,
  attr: vec4<f32>,
};

@group(0) @binding(0) var<uniform> u: RenderParams;
@group(0) @binding(1) var<storage, read> particles: array<Particle>;
@group(0) @binding(2) var<storage, read> oceanGrid: array<f32>;
// 泳ぐ文章(mode=2)用のグリフアトラス。1文字=アトラス上の1セルで、
// velAlpha.wに書かれたindexからセルのUV矩形を逆算してサンプリングする。
@group(0) @binding(3) var glyphSamp: sampler;
@group(0) @binding(4) var glyphTex: texture_2d<f32>;
const GLYPH_ATLAS_COLS: f32 = ${SWIM_ATLAS_COLS}.0;
const GLYPH_ATLAS_ROWS: f32 = ${glyphAtlasRows}.0;
// 月の陰影計算用、固定の太陽方向(簡易近似。実際の天文学的位置は計算しない)。
const SUN_DIR_WGSL: vec3<f32> = vec3<f32>(${SUN_DIR.x}, ${SUN_DIR.y}, ${SUN_DIR.z});

struct VOut {
  @builtin(position) clipPos: vec4<f32>,
  @location(0) color: vec4<f32>,
  @location(1) uv: vec2<f32>,
  @location(2) glyphMode: f32, // >0.5なら泳ぐ文章(テクスチャ付きビルボード)。それ以外は丸い光点。
};

// ハッシュ(鼓動の残像粒子の発火判定に使用。対流・渦は削除済み)
fn hashN(p: vec3<f32>) -> f32 {
  return fract(sin(dot(p, vec3<f32>(12.9898, 78.233, 45.164))) * 43758.5453123);
}

// ---- 海洋(対流・潮汐)の高さ場サンプリング ----
// CPU(JS)側で緯度経度グリッド上の浅水方程式を毎フレーム積分し、
// 結果の高さ場をoceanGridへアップロードしている(このシェーダ側では
// 積分は行わず、双一次補間で読むだけ)。JS側のsampleOceanHeightJS()と
// 同じ式にすること。
fn sampleOceanHeight(basePosV: vec3<f32>) -> f32 {
  let lat = asin(clamp(basePosV.y, -1.0, 1.0));
  let lon = atan2(basePosV.z, basePosV.x) + 3.14159265;
  let dLon = 6.28318530718 / ${OCEAN_LON}.0;
  let dLat = 3.14159265 / ${OCEAN_LAT}.0;
  let fi = (lon / dLon) - 0.5;
  let fj = ((lat + 1.57079632679) / dLat) - 0.5;
  let i0 = i32(floor(fi));
  let j0 = i32(floor(fj));
  let ti = fi - floor(fi);
  let tj = fj - floor(fj);
  let lonN = i32(${OCEAN_LON});
  let latN = i32(${OCEAN_LAT});
  let i0w = ((i0 % lonN) + lonN) % lonN;
  let i1w = (i0w + 1) % lonN;
  let j0c = clamp(j0, 0, latN - 1);
  let j1c = clamp(j0 + 1, 0, latN - 1);
  let h00 = oceanGrid[j0c * lonN + i0w];
  let h10 = oceanGrid[j0c * lonN + i1w];
  let h01 = oceanGrid[j1c * lonN + i0w];
  let h11 = oceanGrid[j1c * lonN + i1w];
  let h0 = mix(h00, h10, ti);
  let h1 = mix(h01, h11, ti);
  return mix(h0, h1, tj);
}
@vertex
fn vs_main(
  @builtin(vertex_index) vIdx: u32,
  @builtin(instance_index) iIdx: u32
) -> VOut {
  let p = particles[iIdx];
  var out: VOut;

  let basePos = p.basePosSeed.xyz;
  let seed = p.basePosSeed.w;

  // ---- mode=2: 泳ぐ文章 ----
  // 【今回の変更点】位置・向きはもうこのシェーダの中では計算しない。CPU
  // (JS側のupdateSwimChains)が、単語ごとの「鎖」の物理(リーダーが実際の
  // 海流を一定距離ごとに測り直して進み、後続の文字がその軌跡をトレースする)
  // を毎フレーム計算し、結果の位置(basePosSeed.xyz)と向き(attr.z)を直接
  // 書き込んでいる。ここではそれをそのまま使ってビルボードを組み立てる
  // だけ。可視性だけは指示どおり簡略に: その"今いる場所"の波の高さと比べて
  // 低ければ表示・高ければ不可視にする。
  if (p.attr.y > 1.5 && p.attr.y < 2.5) {
    let glyphIdx = p.velAlpha.w;
    if (glyphIdx < 0.0) {
      out.clipPos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
      out.color = vec4<f32>(0.0);
      return out;
    }

    let dirNow = normalize(basePos); // CPUが鎖の物理から書き込んだ現在位置

    // ---- 可視性: 今いる場所での波の高さで、この文字を丸ごと表示/非表示 ----
    let waveHTxt = sampleOceanHeight(dirNow) + p.posWaveH.w;
    let peek = smoothstep(${SWIM_TEXT_LOW}, ${SWIM_TEXT_HIGH}, waveHTxt);

    let lakeElapsedTxt = u.misc.x;
    var textEnvelope = 0.0;
    if (lakeElapsedTxt >= 0.0) {
      let mainLapDurTxt = ${LAKE_EXPAND_DUR} + ${LAKE_VIB_RETURN_DUR};
      // 全球が完成し、一周の波紋が収まって鼓動フェーズへ移ってから現れる
      textEnvelope = smoothstep(mainLapDurTxt - 1.0, mainLapDurTxt + 1.0, lakeElapsedTxt);
    }
    let alphaTxt = peek * textEnvelope;

    if (alphaTxt <= 0.01) {
      out.clipPos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
      out.color = vec4<f32>(0.0);
      return out;
    }

    let tideTxt = p.velAlpha.z;
    let beatValTxt = u.misc.z;
    // 可視性の判定(peek)には実測のwaveHTxtをそのまま使ったが、表示位置の
    // 半径方向オフセットにはSWIM_HEIGHT_AMPを掛けて、浮き沈みが目で見て
    // 分かる大きさになるよう誇張する(実際の海面全体の高さは変えない)。
    var finalPosTxt = dirNow * (1.0 + waveHTxt * ${SWIM_HEIGHT_AMP} + tideTxt);
    finalPosTxt = finalPosTxt * (1.0 + beatValTxt * ${LAKE_HEARTBEAT_DISP});
    let centerClipTxt = u.mvp * vec4<f32>(finalPosTxt, 1.0);

    // ---- 鎖の向き(CPU側で計算済み。「自分より鎖の先端側の文字への方向」) ----
    let rotAmt = p.attr.z;
    let rc = cos(rotAmt); let rs = sin(rotAmt);

    var localOffset = vec2<f32>(0.0, 0.0);
    var atlasUV = vec2<f32>(0.0, 0.0);
    // atlasUV.y: canvas(画像)は上が0・下が1で、WebGPUのクリップ空間は上が+1・
    // 下が-1(逆向き)。これを合わせないと文字が上下反転して描かれるため、
    // 画面の上側(localOffset.y=+1)にはグリフ画像の上側(atlasUV.y=0)を、
    // 画面の下側(localOffset.y=-1)には画像の下側(atlasUV.y=1)を対応させる。
    if (vIdx == 0u) { localOffset = vec2<f32>(-1.0, -1.0); atlasUV = vec2<f32>(0.0, 1.0); }
    else if (vIdx == 1u) { localOffset = vec2<f32>(1.0, -1.0); atlasUV = vec2<f32>(1.0, 1.0); }
    else if (vIdx == 2u) { localOffset = vec2<f32>(-1.0, 1.0); atlasUV = vec2<f32>(0.0, 0.0); }
    else if (vIdx == 3u) { localOffset = vec2<f32>(-1.0, 1.0); atlasUV = vec2<f32>(0.0, 0.0); }
    else if (vIdx == 4u) { localOffset = vec2<f32>(1.0, -1.0); atlasUV = vec2<f32>(1.0, 1.0); }
    else if (vIdx == 5u) { localOffset = vec2<f32>(1.0, 1.0); atlasUV = vec2<f32>(1.0, 0.0); }

    let rotOffset = vec2<f32>(localOffset.x * rc - localOffset.y * rs, localOffset.x * rs + localOffset.y * rc);
    let aspect = p.attr.w;
    let pSizeTxt = p.attr.x;
    let offsetNdc = vec2<f32>(rotOffset.x * pSizeTxt * aspect, rotOffset.y * pSizeTxt);
    out.clipPos = centerClipTxt + vec4<f32>(offsetNdc, 0.0, 0.0);

    // ---- アトラス上のこの文字のセルへUVを写像(セル端をわずかに内側へ
    // 詰めて、線形フィルタで隣のグリフの色が滲むのを防ぐ) ----
    let glyphI = i32(glyphIdx + 0.5);
    let col = f32(glyphI % i32(GLYPH_ATLAS_COLS));
    let row = f32(glyphI / i32(GLYPH_ATLAS_COLS));
    let pad = 0.006;
    let u0 = (col + pad) / GLYPH_ATLAS_COLS;
    let u1 = (col + 1.0 - pad) / GLYPH_ATLAS_COLS;
    let v0 = (row + pad) / GLYPH_ATLAS_ROWS;
    let v1 = (row + 1.0 - pad) / GLYPH_ATLAS_ROWS;
    out.uv = vec2<f32>(mix(u0, u1, atlasUV.x), mix(v0, v1, atlasUV.y));
    out.glyphMode = 1.0;

    let inkColor = vec3<f32>(0.96, 0.90, 0.78);
    out.color = vec4<f32>(inkColor, alphaTxt);
    return out;
  }

  // ---- mode=4: 月(白い粒子の球。太陽方向との内積で陰影をつける) ----
  // 自転は実装しない(模様のない点群の球なので、自転の有無は見た目に出ない)。
  // 各粒子の向き(basePos)は月の中心から見て常に一定(=世界座標で固定)なので、
  // 固定の太陽方向との内積だけで正しい半球が光る。月自身は公転で位置が
  // 変わるので、見かけの満ち欠けは特別な計算なしに自然に生まれる。
  if (p.attr.y > 3.5) {
    let lakeElapsedMoon = u.misc.x;
    if (lakeElapsedMoon < 0.0) {
      out.clipPos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
      out.color = vec4<f32>(0.0);
      return out;
    }
    let moonDirN = normalize(u.moonDir.xyz);
    let moonCenter = moonDirN * ${MOON_ORBIT_DISTANCE};
    let moonPos = moonCenter + basePos * ${MOON_RADIUS};
    let centerClipMoon = u.mvp * vec4<f32>(moonPos, 1.0);

    var localOffsetMoon = vec2<f32>(0.0, 0.0);
    if (vIdx == 0u) { localOffsetMoon = vec2<f32>(-1.0, -1.0); }
    else if (vIdx == 1u) { localOffsetMoon = vec2<f32>(1.0, -1.0); }
    else if (vIdx == 2u) { localOffsetMoon = vec2<f32>(-1.0, 1.0); }
    else if (vIdx == 3u) { localOffsetMoon = vec2<f32>(-1.0, 1.0); }
    else if (vIdx == 4u) { localOffsetMoon = vec2<f32>(1.0, -1.0); }
    else if (vIdx == 5u) { localOffsetMoon = vec2<f32>(1.0, 1.0); }
    let sizeMoon = p.attr.x;
    out.clipPos = centerClipMoon + vec4<f32>(localOffsetMoon * sizeMoon, 0.0, 0.0);
    out.uv = localOffsetMoon * 0.5 + vec2<f32>(0.5, 0.5);

    let sunDot = dot(basePos, SUN_DIR_WGSL);
    let lit = smoothstep(-${MOON_TERMINATOR_SOFT}, ${MOON_TERMINATOR_SOFT}, sunDot);
    let moonColor = mix(vec3<f32>(${MOON_SHADOW_COLOR}, ${MOON_SHADOW_COLOR}, ${MOON_SHADOW_COLOR}), vec3<f32>(1.0, 1.0, 1.0), lit);
    out.color = vec4<f32>(moonColor, 1.0);
    return out;
  }

  // ---- mode=1: 鼓動の残像粒子(元バージョンの再現) ----
  // 拍がピークに達した瞬間だけ、球の最大外形付近に極小の光点が浮かび
  // 上がり、静かに消えていく。compute passを持たないため、「粒子ごとの
  // seed」と「拍のサイクル番号」をハッシュし、そのサイクルで発火するか
  // どうかを毎フレーム再計算する(状態を持たない疑似ランダム)。
  if (p.attr.y > 0.5) {
    // ---- 鼓動の水しぶき粒子 ----
    // 鼓動のピークで弾き飛ばされ、放物線を描いて落下し、消える。
    // 発生はランダム(ハッシュ判定、既存のAFTERIMAGE_SPAWN_RATEを流用)。
    var tau = -1.0; // 0..1: 飛行の進行度。負値なら非表示(未発生)
    var cycleIndexAI = 0.0;
    let lakeElapsedAI = u.misc.x;
    if (lakeElapsedAI >= 0.0) {
      let mainLapDurAI = ${LAKE_EXPAND_DUR} + ${LAKE_VIB_RETURN_DUR};
      let vibElapsedAI = max(0.0, lakeElapsedAI - ${LAKE_HOLD});
      if (vibElapsedAI > mainLapDurAI) {
        let beatElapsedAI = vibElapsedAI - mainLapDurAI;
        cycleIndexAI = floor(beatElapsedAI / ${LAKE_HEARTBEAT_PERIOD});
        let cyclePhaseAI = fract(beatElapsedAI / ${LAKE_HEARTBEAT_PERIOD});
        let activationHash = hashN(vec3<f32>(seed * 137.0, cycleIndexAI, 71.0));
        if (activationHash < ${AFTERIMAGE_SPAWN_RATE}) {
          // 鼓動の一拍目(lub、球が最も膨張する瞬間)に合わせて弾き飛ばす。
          // 実際の因果関係の厳密さよりも、球の動きと水しぶきが連動して
          // 見えることを優先している。
          let sincePeakSec = (cyclePhaseAI - ${BEAT_LUB_CENTER}) * ${LAKE_HEARTBEAT_PERIOD};
          if (sincePeakSec >= 0.0 && sincePeakSec <= ${SPLASH_DURATION}) {
            tau = sincePeakSec / ${SPLASH_DURATION};
          }
        }
      }
    }

    // ---- 砕波(泡)による水しぶき ----
    // 鼓動と独立に、局所の泡F(compute passがこの粒子のbasePosに対して
    // 計算した値)が閾値を超えている間、一定時間の区切りごとに一定確率で
    // 発火させる。区切り番号ごとにハッシュを引き直すことで、同じ場所が
    // 毎回同じ粒子だけで光り続けるのを防ぐ(区切りが変わるたびに発火する
    // 粒子の顔ぶれが変わる)。
    if (tau < 0.0) {
      let foamF = p.velAlpha.y;
      if (foamF > ${BREAK_SPLASH_FOAM_THR}) {
        let rawElapsed = u.misc.w;
        let windowIdx = floor(rawElapsed / ${BREAK_SPLASH_WINDOW});
        let sinceWin = rawElapsed - windowIdx * ${BREAK_SPLASH_WINDOW};
        let gate = hashN(vec3<f32>(seed * 311.0, windowIdx, 47.0));
        if (gate < ${BREAK_SPLASH_RATE} && sinceWin <= ${SPLASH_DURATION}) {
          tau = sinceWin / ${SPLASH_DURATION};
          cycleIndexAI = windowIdx; // 以降のdriftAngle計算にそのまま使う
        }
      }
    }

    if (tau < 0.0) {
      out.clipPos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
      out.color = vec4<f32>(0.0);
      return out;
    }

    // 放物線: 0(発生=表面)→中間で最高点→1(落下=表面)で消える
    let arc = 4.0 * tau * (1.0 - tau);
    let heightAI = ${SPLASH_MAX_HEIGHT} * arc; // 表面からの上昇量は控えめのまま

    // 膨張の勢いで横方向にも弾かれる(接線方向へのランダムな飛散)
    var refAxis = vec3<f32>(0.0, 1.0, 0.0);
    if (abs(basePos.y) > 0.98) { refAxis = vec3<f32>(1.0, 0.0, 0.0); }
    let tangent1 = normalize(cross(refAxis, basePos));
    let tangent2 = cross(basePos, tangent1);
    let driftAngle = hashN(vec3<f32>(seed * 251.0, cycleIndexAI, 13.0)) * 6.28318530718;
    let driftDir = tangent1 * cos(driftAngle) + tangent2 * sin(driftAngle);
    let lateralAI = ${SPLASH_LATERAL_MAX} * tau;

    let finalPosAI = basePos * (1.0 + heightAI) + driftDir * lateralAI;
    let centerClipAI = u.mvp * vec4<f32>(finalPosAI, 1.0);

    var quadOffsetAI = vec2<f32>(0.0, 0.0);
    if (vIdx == 0u) { quadOffsetAI = vec2<f32>(-1.0, -1.0); out.uv = vec2<f32>(0.0, 0.0); }
    else if (vIdx == 1u) { quadOffsetAI = vec2<f32>(1.0, -1.0); out.uv = vec2<f32>(1.0, 0.0); }
    else if (vIdx == 2u) { quadOffsetAI = vec2<f32>(-1.0, 1.0); out.uv = vec2<f32>(0.0, 1.0); }
    else if (vIdx == 3u) { quadOffsetAI = vec2<f32>(-1.0, 1.0); out.uv = vec2<f32>(0.0, 1.0); }
    else if (vIdx == 4u) { quadOffsetAI = vec2<f32>(1.0, -1.0); out.uv = vec2<f32>(1.0, 0.0); }
    else if (vIdx == 5u) { quadOffsetAI = vec2<f32>(1.0, 1.0); out.uv = vec2<f32>(1.0, 1.0); }

    let pSizeAI = p.attr.x * (0.6 + arc * 0.8);
    out.clipPos = centerClipAI + vec4<f32>(quadOffsetAI * pSizeAI, 0.0, 0.0);
    out.color = vec4<f32>(${SPLASH_COLOR_R}, ${SPLASH_COLOR_G}, ${SPLASH_COLOR_B}, arc * 0.95);
    return out;
  }

  // カメラ正面(画面中央=赤道上の点)からの角距離。「湖」の中心はここに固定。
  // (POLE_DIR_Y/POLE_DIR_Zは初期カメラ傾きRotX(rotAngleX)を打ち消した向き)
  let angDist = acos(clamp(basePos.y * ${POLE_DIR_Y} + basePos.z * ${POLE_DIR_Z}, -1.0, 1.0));

  let lakeElapsed = u.misc.x;
  let growLevel = u.misc.y;
  var revealFactor = 0.0;
  var waveH = 0.0;

  if (lakeElapsed >= 0.0) {
    // フェードイン(小さなパッチが浮かび上がる)
    let fadeIn = smoothstep(0.0, ${LAKE_FADE_IN}, lakeElapsed);

    // 見た目上の"露出"(球の完成度)は拡張のみで決まり、後退させない。
    // "e"の打鍵(lakeElapsed=0)と同時にラグなく拡張を始める(LAKE_HOLD=0)。
    let revealRawProgress = (lakeElapsed - ${LAKE_HOLD}) / ${LAKE_EXPAND_DUR};
    let revealProgress = clamp(revealRawProgress, 0.0, 1.0);
    let revealFrontAngle = mix(${LAKE_RADIUS}, 3.14159265, revealProgress);

    revealFactor = fadeIn * (1.0 - smoothstep(revealFrontAngle - ${LAKE_EDGE_BAND}, revealFrontAngle + ${LAKE_EDGE_BAND}, angDist));

    // eの波紋(一周=往路+復路)は往路で振幅が育ち、球の完成時に最大、
    // 復路でまた0に戻る。開始点(角距離0)を波源として、往路(中心→裏側=
    // 角距離π、LAKE_EXPAND_DURと同じ速さ)で振幅がBASE→PEAKへ育ち、球の
    // 完成(往路完了)瞬間にちょうど最大になる。続く復路(裏側→開始点、
    // LAKE_VIB_RETURN_DUR秒)では振幅がPEAK→0へ下がっていき、波が開始点
    // まで帰ってくる頃にはちょうど0になり、この波の運動は完全に終了する
    // (以降waveHはこの項では常に0のまま)。
    let mainLapDur = ${LAKE_EXPAND_DUR} + ${LAKE_VIB_RETURN_DUR};
    let vibElapsed = max(0.0, lakeElapsed - ${LAKE_HOLD});
    if (vibElapsed <= mainLapDur) {
      var vibFrontAngle = 0.0;
      var vibAmp = 0.0;
      if (vibElapsed <= ${LAKE_EXPAND_DUR}) {
        let outP = vibElapsed / ${LAKE_EXPAND_DUR};
        vibFrontAngle = mix(${LAKE_RADIUS}, 3.14159265, outP);
        vibAmp = mix(${LAKE_VIB_AMP_BASE}, ${LAKE_VIB_AMP_PEAK}, outP);
      } else {
        let retP = (vibElapsed - ${LAKE_EXPAND_DUR}) / ${LAKE_VIB_RETURN_DUR};
        vibFrontAngle = mix(3.14159265, 0.0, retP);
        vibAmp = mix(${LAKE_VIB_AMP_PEAK}, 0.0, retP);
      }
      let fadeInFactor = smoothstep(0.0, 0.15, vibElapsed);
      // 波源(湖点)からのシンプルな円の波: 包絡線を持たず角距離全体に
      // 広がる正弦波そのもの。vibFrontAngleが進むにつれて波紋が外側へ
      // 移動しているように見える(=波源から広がる同心円)。
      let distFromFront = vibFrontAngle - angDist;
      waveH = sin(distFromFront * ${LAKE_VIB_FREQ}) * vibAmp * fadeInFactor;
    }
  } else if (growLevel > 0.0) {
    // "Hapworth"打鍵に連動する事前成長段階: まだ全球化のタイマーは動かず、
    // パッチの角半径がLAKE_RADIUSまでgrowLevelに比例して育つだけ。
    // 完成する湖の輪郭がくっきり見えるよう、ぼかし幅は前線より狭くする。
    let growRadius = ${LAKE_RADIUS} * growLevel;
    let growFade = smoothstep(0.0, 0.05, growLevel);
    revealFactor = growFade * (1.0 - smoothstep(growRadius - ${LAKE_EDGE_BAND_LAKE}, growRadius + ${LAKE_EDGE_BAND_LAKE}, angDist));

    // "Lake"の"L"/"a"/"k"を打つたびに、湖面へ1発ずつ減衰リング波を発生させる
    for (var s = 0; s < ${LAKE_STRIKE_SLOTS}; s = s + 1) {
      let dt = u.strike[s];
      if (dt >= 0.0 && dt < ${LAKE_STRIKE_DUR}) {
        let ringRadius = dt * ${LAKE_STRIKE_SPEED};
        let distFromRing = angDist - ringRadius;
        let ringEnvelope = exp(-(distFromRing * distFromRing) / (2.0 * ${LAKE_STRIKE_SIGMA} * ${LAKE_STRIKE_SIGMA}));
        let timeDecay = exp(-dt * ${LAKE_STRIKE_DECAY}) * smoothstep(0.0, 0.05, dt);
        waveH = waveH + sin(distFromRing * ${LAKE_STRIKE_FREQ}) * ringEnvelope * ${LAKE_STRIKE_AMP} * timeDecay;
      }
    }
  }

  let alpha = p.velAlpha.w * revealFactor;

  if (alpha <= 0.01) {
    out.clipPos = vec4<f32>(0.0, 0.0, 2.0, 1.0);
    out.color = vec4<f32>(0.0);
    return out;
  }

  var quadOffset = vec2<f32>(0.0, 0.0);
  if (vIdx == 0u) { quadOffset = vec2<f32>(-1.0, -1.0); out.uv = vec2<f32>(0.0, 0.0); }
  else if (vIdx == 1u) { quadOffset = vec2<f32>(1.0, -1.0); out.uv = vec2<f32>(1.0, 0.0); }
  else if (vIdx == 2u) { quadOffset = vec2<f32>(-1.0, 1.0); out.uv = vec2<f32>(0.0, 1.0); }
  else if (vIdx == 3u) { quadOffset = vec2<f32>(-1.0, 1.0); out.uv = vec2<f32>(0.0, 1.0); }
  else if (vIdx == 4u) { quadOffset = vec2<f32>(1.0, -1.0); out.uv = vec2<f32>(1.0, 0.0); }
  else if (vIdx == 5u) { quadOffset = vec2<f32>(1.0, 1.0); out.uv = vec2<f32>(1.0, 1.0); }

  // 海洋(対流・潮汐): CPU側で積分した高さ場を双一次補間でサンプリングし、
  // 既存のリング波(waveH)に加算する(装飾として共存させる)。
  waveH = waveH + sampleOceanHeight(basePos);

  // スペクトル海面(SH合成 + 状態を持つ砕波層)。compute pass が粒子ごとに書いた
  // 「水平変位後の方向」と「波の高さ」を読むだけ。鼓動開始からのフェードイン
  // (updateOceanのforceAmp)は compute 側で掛けてあるので、ここでは何もしない。
  waveH = waveH + p.posWaveH.w;

  // クリックの渦(見た目専用・一時的・回転): シミュレーションの状態(oceanGrid)
  // には一切書き込まず、「経過時間・角距離だけ」から毎フレーム計算し直す回転
  // (=渦の軸まわりのRodriguesの回転公式による位置の巻き込み)を粒子の表示位置
  // に直接かける。軸そのもの(クリックした点)は幾何的に不動。芯(VORTEX_CORE_
  // RADIUS)に近いほど角速度が強く、そこから離れるにつれ弱まっていく(実際の
  // 渦のように、中心付近が最も速く回る)。VORTEX_VIS_RELEASEを長く取っている
  // ため、寿命の終盤は「巻き戻る」のではなく実際の水のようにゆっくり静まって
  // いく。寿命を過ぎればenvが数式的にちょうど0になるため、回転が残り続ける
  // ことは原理的に起こらない。
  var spinDir = p.posWaveH.xyz;
  for (var vi = 0u; vi < 6u; vi = vi + 1u) {
    let vd = u.vortexData[vi];
    if (vd.w < 0.0) { continue; }
    let vAge = u.misc.w - vd.w;
    if (vAge < 0.0 || vAge > ${VORTEX_VIS_RAMP + VORTEX_VIS_HOLD + VORTEX_VIS_RELEASE}) { continue; }
    var vEnv = 0.0;
    if (vAge < ${VORTEX_VIS_RAMP}) { vEnv = vAge / ${VORTEX_VIS_RAMP}; }
    else if (vAge < ${VORTEX_VIS_RAMP + VORTEX_VIS_HOLD}) { vEnv = 1.0; }
    else { vEnv = 1.0 - (vAge - ${VORTEX_VIS_RAMP + VORTEX_VIS_HOLD}) / ${VORTEX_VIS_RELEASE}; }
    let axis = vd.xyz;
    let vDist = acos(clamp(dot(spinDir, axis), -1.0, 1.0));
    let ratio = vDist / ${VORTEX_RADIUS};
    // 芯に近いほど1に近づく(=角速度が強い)。中心そのものは幾何的に動かない
    // ため発散はしない(spinDirがaxisに近づくほどcross(axis,spinDir)→0)。
    let coreFall = ${VORTEX_CORE_RADIUS} / (${VORTEX_CORE_RADIUS} + vDist);
    let outerFall = exp(-(ratio * ratio)); // 外側は従来通りガウスで打ち切る
    let swirl = coreFall * outerFall;
    let sign = u.vortexSign[vi].x;
    let theta = sign * ${VORTEX_SPIN_MAX} * vEnv * swirl;
    let ct = cos(theta); let st = sin(theta);
    // Rodriguesの回転公式: spinDirをaxisのまわりにtheta回転させる
    spinDir = spinDir * ct + cross(axis, spinDir) * st + axis * dot(axis, spinDir) * (1.0 - ct);
  }

  // 大域循環の"感触"(見た目専用。GYRE_ANGLE_PEAKの説明を参照)。Y軸(=極軸)
  // まわりの回転なので緯度は変えず、経度だけをドリフトさせる。回転角は
  // 「速さを積分した積算値」ではなく、coriolisCycleEnvelope(JS側と全く同じ式。
  // 変更時は両方そろえて直すこと)を直接 GYRE_ANGLE_PEAK に掛けた値を毎フレーム
  // 計算し直すだけ(状態を持たない)。これにより、強さがちょうど0になる瞬間
  // (=凪)には回転角も必ずちょうど0に戻り、無回転の基準配置になる。
  let gyreTheta = (6.28318530718 * (u.misc.w + ${CORIOLIS_CYCLE_PHASE})) / ${wgslF(CURRENT_CYCLE_PERIOD)};
  let gyreRaw = (1.0 - cos(gyreTheta)) * 0.5;
  let gyreEnv = gyreRaw * gyreRaw;
  let gyreLat = asin(clamp(spinDir.y, -1.0, 1.0));
  let gyreAngle = sin(gyreLat) * cos(gyreLat) * ${GYRE_ANGLE_PEAK} * gyreEnv;
  let gc = cos(gyreAngle); let gs = sin(gyreAngle);
  spinDir = vec3<f32>(spinDir.x * gc + spinDir.z * gs, spinDir.y, -spinDir.x * gs + spinDir.z * gc);

  // 位置 = 水平変位(choppy: 粒子が山に集まり谷で疎になる)+クリックの渦の回転
  // を適用した方向 × (1 + 高さ)。
  // ※波の高さは半径方向、リング波・浅水の高さも同じ waveH に加算される。
  // velAlpha.z = 平衡潮汐のふくらみ(computeが書く)。波のハイライト判定には混ぜず半径にだけ足す。
  var finalPos = spinDir * (1.0 + waveH + p.velAlpha.z);

  // 鼓動(一周の波紋が静まった後、球全体を一斉に呼吸させる): CPU側で
  // 計算されたbeatVal(0..1、拍動の強さ)を使い、位置は全体が均等に
  // 膨縮し、明るさ・粒サイズはbeatValに粒子ごとの乱数を少し混ぜて
  // 呼吸に生命感を与える。
  let beatVal = u.misc.z;
  let beatDisp = beatVal * ${LAKE_HEARTBEAT_DISP};
  finalPos = finalPos * (1.0 + beatDisp);
  let beatPulse = beatVal * (1.0 + seed * 0.5);

  let centerClip = u.mvp * vec4<f32>(finalPos, 1.0);
  // crestGlowは波(waveH)のみに反応させる。totalWaveH(=waveH+beatDisp)を使うと
  // beatDispが全粒子に一様にかかるせいで、鼓動のたびに球全体が同時にcrestWhite
  // へ張り付いて真っ白になってしまっていた。
  // 泡(compute passが砕波の強さから立てたF)は、高さに依らず白く光らせる。
  let foam = p.velAlpha.y;
  let crestGlow = clamp(smoothstep(-0.02, 0.04, waveH) + foam, 0.0, 1.0);
  let pSize = p.attr.x + crestGlow * 0.010 + beatPulse * 0.006;
  out.clipPos = centerClip + vec4<f32>(quadOffset * pSize, 0.0, 0.0);

  // 静的な緯度グラデーション(疑似陰影)に、波紋の起伏部分だけ白いハイライトを重ねる
  let deepBlue = vec3<f32>(0.02, 0.08, 0.35);
  let cyanBlue = vec3<f32>(0.03, 0.22, 0.55);
  let crestWhite = vec3<f32>(0.75, 0.96, 1.0);
  let t = clamp(basePos.y * 0.5 + 0.5 + (seed - 0.5) * 0.08, 0.0, 1.0);
  var col = mix(deepBlue, cyanBlue, t);
  col = mix(col, crestWhite, crestGlow);
  // 加算ブレンドを弱める: 基準アルファ・鼓動時の増加量を抑え、上限も下げて
  // 大量の粒子が重なっても白飛びしにくくする。
  let dynamicAlpha = clamp(0.28 + crestGlow * 0.30 + beatPulse * 0.10, 0.15, 0.72);
  out.color = vec4<f32>(col, dynamicAlpha * revealFactor);

  return out;
}

@fragment
fn fs_main(in: VOut) -> @location(0) vec4<f32> {
  // textureSampleは分岐(非uniformなcontrol flow)の中から呼べないため、
  // モード判定より前に無条件でサンプリングしておき、結果の使い方だけを分ける。
  let g = textureSample(glyphTex, glyphSamp, in.uv);
  if (in.glyphMode > 0.5) {
    // 泳ぐ文章: グリフアトラスから文字の形(アルファ)そのものをサンプリングする
    if (g.a < 0.02) { discard; }
    return vec4<f32>(in.color.rgb, in.color.a * g.a);
  }
  let dist = length(in.uv - vec2<f32>(0.5, 0.5)) * 2.0;
  if (dist > 1.0) { discard; }
  let glow = pow(max(0.0, 1.0 - dist), 1.8);
  return vec4<f32>(in.color.rgb, in.color.a * glow);
}
`;

  const renderModule = device.createShaderModule({ code: particleRenderShaderCode });
  const renderPipeline = await device.createRenderPipelineAsync({
    layout: 'auto',
    vertex: { module: renderModule, entryPoint: 'vs_main' },
    fragment: {
      module: renderModule, entryPoint: 'fs_main',
      targets: [{
        format,
        blend: {
          color: { srcFactor: 'src-alpha', dstFactor: 'one', operation: 'add' },
          alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' },
        },
      }],
    },
    primitive: { topology: 'triangle-list', cullMode: 'none' },
    depthStencil: { format: 'depth24plus', depthWriteEnabled: false, depthCompare: 'less' },
  });

  const renderBindGroup = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [
      { binding: 0, resource: { buffer: renderParamsBuffer } },
      { binding: 1, resource: { buffer: particleBuffer } },
      { binding: 2, resource: { buffer: oceanGridBuffer } },
      { binding: 3, resource: glyphSampler },
      { binding: 4, resource: glyphTexture.createView() },
    ],
  });

  // 鼓動開始以降の海面(SH合成 + 砕波/泡/エネルギー)。particleBufferを
  // compute passでread_writeするため、renderBindGroupと同じバッファを共有する。
  const spectral = await createSpectralOcean(device, particleBuffer, TOTAL_PARTICLES, OCEAN_LON, OCEAN_LAT);

  let depthTexture = null;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    canvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    context.configure({ device, format, alphaMode: 'opaque' });
    if (depthTexture) depthTexture.destroy();
    depthTexture = device.createTexture({
      size: [canvas.width, canvas.height],
      format: 'depth24plus',
      usage: GPUTextureUsage.RENDER_ATTACHMENT,
    });
  }
  listen(window, 'resize', resize);
  if (window.visualViewport) listen(window.visualViewport, 'resize', resize);
  resize();

  let lastTime = performance.now();
  const rData = new ArrayBuffer(320);
  const rFloat = new Float32Array(rData);

  function frameLoop(now) {
    const dt = Math.min((now - lastTime) / 1000, 1 / 30);
    lastTime = now;
    currentElapsed += dt;
    lakeGrowDisplay += (lakeGrowTarget - lakeGrowDisplay) * Math.min(1, dt * 8);

    const aspect = canvas.width / canvas.height;
    const proj = mat4PerspectiveWebGPU(fov, aspect, 0.1, 20);
    const view = mat4Translate(0, 0, -eyeDist);
    const model = mat4Mul(mat4RotX(rotAngleX), mat4RotY(rotAngleY));
    const mvp = mat4Mul(proj, mat4Mul(view, model));

    rFloat.set(mvp, 0);
    const lakeElapsedNow = earthRevealStartElapsed < 0 ? -1 : (currentElapsed - earthRevealStartElapsed);
    rFloat[16] = lakeElapsedNow;
    rFloat[17] = lakeGrowDisplay;
    rFloat[18] = computeBeatVal(lakeElapsedNow);
    rFloat[19] = currentElapsed; // misc.w: 生の経過秒数(砕波による水しぶきの発生周期の判定に使う)
    rFloat[20] = lakeImpulseTimes[0] < 0 ? -1 : (currentElapsed - lakeImpulseTimes[0]);
    rFloat[21] = lakeImpulseTimes[1] < 0 ? -1 : (currentElapsed - lakeImpulseTimes[1]);
    rFloat[22] = lakeImpulseTimes[2] < 0 ? -1 : (currentElapsed - lakeImpulseTimes[2]);
    // クリックの渦(見た目専用・回転): シミュレーション状態には触れず、発生方向・
    // 発生時刻・回転方向だけを毎フレーム渡す。頂点シェーダ側が「経過時間・角距離
    // だけの式」で一時的な回転(Rodriguesの回転公式)を計算し直すので、渦の寿命を
    // 過ぎれば必ず回転量がちょうど0に戻る。
    for (let vi = 0; vi < 6; vi++) {
      const o = 28 + vi * 4;
      const so = 52 + vi * 4;
      const vt = activeVortices[vi];
      if (vt) {
        rFloat[o + 0] = vt.x; rFloat[o + 1] = vt.y; rFloat[o + 2] = vt.z; rFloat[o + 3] = vt.t0;
        rFloat[so] = vt.sign;
      } else {
        rFloat[o + 3] = -1; // 無効スロット
      }
    }
    // 月マーカー(潮汐計算と同じmoonDirAt())の方向。頂点シェーダ側で
    // 正規化して使うので、ここでは正規化前のままでよい。
    const moonNow = moonDirAt(currentElapsed);
    rFloat[76] = moonNow.x; rFloat[77] = moonNow.y; rFloat[78] = moonNow.z; rFloat[79] = 0;
    device.queue.writeBuffer(renderParamsBuffer, 0, rData);

    // 海洋(対流・潮汐)を1フレームに1回だけ積分し、高さ場をアップロード
    const waveFade = updateOcean(dt, currentElapsed, lakeElapsedNow);
    device.queue.writeBuffer(oceanGridBuffer, 0, oceanHeightGPU);

    // 泳ぐ文章の鎖を1フレームぶん進める(直前に更新したoceanU/oceanVを使う)。
    // 結果(位置+向き)はparticleData内のテキスト粒子の範囲だけをまとめて
    // 送り直す(小さいので毎フレームでも軽い)。
    // 出現前に進めてしまうと、あらかじめ作った蛇行の軌跡が使い果たされて、まっすぐ読める状態になる。
    // 文章が現れる(WGSL側のtextEnvelopeが立ち上がる=mainLapDur-1秒)少し前まで鎖は止めておく。
    if (lakeElapsedNow >= LAKE_EXPAND_DUR + LAKE_VIB_RETURN_DUR - 1.5) updateSwimChains(dt);
    device.queue.writeBuffer(
      particleBuffer,
      (MAIN_PARTICLE_COUNT + WEBGPU_AFTERIMAGE_COUNT) * 16 * 4,
      particleData,
      (MAIN_PARTICLE_COUNT + WEBGPU_AFTERIMAGE_COUNT) * 16,
      TEXT_PARTICLE_CAP * 16,
    );

    const encoder = device.createCommandEncoder();
    // SH海面の合成 → 砕波・泡・エネルギーの更新(流れで移流) → 粒子への書き出し(描画より前に積む)
    spectral.encode(encoder, currentElapsed, dt, waveFade, oceanUVGPU, moonDirAt(currentElapsed), activeVortices);
    const renderPass = encoder.beginRenderPass({
      colorAttachments: [{
        view: context.getCurrentTexture().createView(),
        clearValue: { r: 0.003, g: 0.008, b: 0.022, a: 1 },
        loadOp: 'clear', storeOp: 'store',
      }],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthClearValue: 1.0, depthLoadOp: 'clear', depthStoreOp: 'store',
      },
    });

    renderPass.setPipeline(renderPipeline);
    renderPass.setBindGroup(0, renderBindGroup);
    renderPass.draw(6, TOTAL_PARTICLES, 0, 0);
    renderPass.end();

    device.queue.submit([encoder.finish()]);
    raf(frameLoop);
  }

  raf(frameLoop);
  return true;
}

// ====================================================
// (旧: WebGL2フォールバックはここにあったが、「ひとまずフォールバックはしない」
//  方針により earth.js では削除した。WebGPU非対応時は earth.js 側で英語の案内を出す)
// ====================================================

// ----------------------------------------------------
// タイプライター・イントロ (紙なし、黒い丸キーの文字盤を実際に打たせる)
// PREFACE_TEXT: 自動で1文字ずつ打たれる前置きの一文
// TARGET_WORD: そのあと文字盤をクリック/キー入力して打ち込む語(プレースホルダー)
// ----------------------------------------------------
const PREFACE_TEXT = "I mean to type up an exact copy of the letter,\nword for word, comma for comma. Beginning here.\n\n";
const TARGET_WORD = "Hapworth Lake";
// "Hapworth"の文字数。この文字数ぶんキーを打つ間、湖を少しずつ育てていく
const LAKE_GROW_WORD_LEN = TARGET_WORD.split(' ')[0].length;
// "Lake"の"L"のインデックス(=空白の次)。ここから3文字("L","a","k")が
// 湖面の打鍵波紋トリガーの対象で、続く"e"はtriggerEarthReveal側が担当する。
const LAKE_WORD_START_IDX = TARGET_WORD.indexOf(' ') + 1;

// QWERTY配列（フル文字盤。最下段には実機同様コンマ・ピリオドも含める）
const KEY_ROWS = [
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M',',','.']
];

function initTypewriter() {
  const overlay = $('intro-overlay');
  const linesEl = $('typewriter-lines');
  const paperHEl = $('paper-h');
  const paperInnerEl = $('paper-inner');
  const paperTextEl = $('paper-text');
  const keyboardRows = $('keyboard-rows');
  const keyboardViewport = root.querySelector('.keyboard-viewport');
  const leverMountEl = $('lever-mount');
  const leverEl = $('lever');

  let typedIndex = 0;
  let interactiveEnabled = false;
  const keyEls = {};
  const neededLetters = new Set(TARGET_WORD.toLowerCase().split(''));

  KEY_ROWS.forEach((row, rowIndex) => {
    const rowEl = document.createElement('div');
    rowEl.className = 'keyboard-row';
    rowEl.dataset.row = String(rowIndex);
    row.forEach((letter) => {
      const lower = letter.toLowerCase();
      const key = document.createElement('div');
      key.className = 'key';
      key.textContent = letter;
      if (neededLetters.has(lower)) {
        key.addEventListener('click', () => tryInput(lower));
      } else {
        key.classList.add('inactive');
      }
      // keyElsは前置きの自動タイプ演出(flashKey)からも参照するため、
      // interactiveEnabled(=neededLetters)に関わらず全キーぶん登録する。
      if (!keyEls[lower]) keyEls[lower] = key;
      rowEl.appendChild(key);
    });
    keyboardRows.appendChild(rowEl);
  });

  // スペースキーを追加。前置きの文にはスペースが含まれるため、実際に
  // 「打鍵」として使う。文字盤の横幅いっぱいの長さにし、文字は入れない
  // (実物のスペースキーに寄せる)。改行キーは実物準拠のため設けない
  // (後でキャリッジ側の機構として実装予定)。
  const keyboardWidthPx = keyboardRows.getBoundingClientRect().width;
  const bottomRowEl = document.createElement('div');
  bottomRowEl.className = 'keyboard-row';
  bottomRowEl.dataset.row = String(KEY_ROWS.length);
  const spaceKey = document.createElement('div');
  spaceKey.className = 'key spacebar';
  spaceKey.style.width = (keyboardWidthPx * 0.94) + 'px'; // 文字盤の横幅とほぼ同じ長さに
  if (neededLetters.has(' ')) {
    spaceKey.addEventListener('click', () => tryInput(' '));
  } else {
    spaceKey.classList.add('inactive');
  }
  keyEls[' '] = spaceKey;
  bottomRowEl.appendChild(spaceKey);
  keyboardRows.appendChild(bottomRowEl);

  // ---- 傾いた文字盤平面の共通座標変換 ----
  // .keyboard-rows(rotateX(46deg)) / .keyboard-viewport(perspective(780px))
  // と全く同じ角度・奥行きの「傾いた平面」を、キーの陰影計算(この直後)と
  // 波紋(この後方のセクション)の両方で共有する。CSS側の角度・
  // perspectiveを変更した場合はここも合わせて変更すること。
  const TILT_ANGLE_DEG = 46;
  const TILT_COS = Math.cos(TILT_ANGLE_DEG * Math.PI / 180);
  const TILT_SIN = Math.sin(TILT_ANGLE_DEG * Math.PI / 180);
  const PERSPECTIVE_D = 780;

  // 画面座標(平面原点からの相対座標)を、傾いた平面上のローカル座標に
  // 逆変換する。CSSの perspective(d) + rotateX(θ) が
  //   screenY = y*cosθ / (1 - y*sinθ/d)
  //   screenX = x       / (1 - y*sinθ/d)
  // と変換するのに対する逆関数。GLSL側(unprojectToPlane)と同じ式。
  function unprojectToPlaneJS(relX, relY) {
    const denomY = Math.max(TILT_COS + (relY * TILT_SIN) / PERSPECTIVE_D, 0.12);
    const y = relY / denomY;
    const denomX = 1 - (y * TILT_SIN) / PERSPECTIVE_D;
    return [relX * denomX, y];
  }

  // 平面の原点。#keyboard-rowsの画面上の中心をそのまま使うことで、
  // キーの陰影・波紋の伝播平面が文字盤の面と完全に一致する。
  let planeOriginX = 0, planeOriginY = 0;
  function updatePlaneOrigin() {
    const r = keyboardRows.getBoundingClientRect();
    planeOriginX = r.left + r.width / 2;
    planeOriginY = r.top + r.height / 2;
  }
  updatePlaneOrigin();

  // ---- キーの立体化(Three.js): 本物の3Dメッシュでキャップを作る ----
  // 以前はcanvas1枚にフラグメントシェーダで「陰影だけ」を描いて立体に
  // 見せていたが、平面ベースの手法では「側面として陰影計算される帯」が
  // 高さと無関係な固定幅になってしまう等、構造的な限界があった。
  // ここからは各キーを実際のジオメトリ(押し出しを含む)で構築し、
  // Three.jsで本物の3Dシーンとして描画する。DOM側の.keyは相変わらず
  // レイアウト位置決め・クリック当たり判定のためだけに残し、見た目は
  // 全てこのThree.jsシーン(#keyboard-canvasに直接レンダリング)で描く。
  const KEY_MAX = 32;
  const keyboardCanvas = $('keyboard-canvas');

  // 各キーの幾何情報(ローカル平面座標。原点は#keyboard-rowsの中心)。
  let keyGeoList = []; // { el, ax, ay, bx, by, radius, isSpacebar, letter }
  let keyPress = new Float32Array(KEY_MAX); // 各フレームで計算する現在の押し込み量(0..1)
  let keyPressStart = new Float64Array(KEY_MAX).fill(-1e9); // 発火時刻(performance.now()基準)
  const keyIndexByEl = new Map();

  function rebuildKeyGeometry() {
    const halfW = keyboardRows.offsetWidth / 2;
    const halfH = keyboardRows.offsetHeight / 2;
    const keyElsAll = Array.from(keyboardRows.querySelectorAll('.key'));
    keyGeoList = keyElsAll.slice(0, KEY_MAX).map((el) => {
      const isSpacebar = el.classList.contains('spacebar');
      const w = el.offsetWidth, h = el.offsetHeight;
      // #keyboard-rowsの中心を原点(0,0)とするローカル座標に変換する
      // (波紋側のu_planeOriginと定義を合わせるため)
      const cx = (el.offsetLeft + w / 2) - halfW;
      const cy = (el.offsetTop + h / 2) - halfH;
      // どの段(0=最上段Q〜、1=中段A〜、2=最下段Z〜)かを、実物のタイプ
      // ライターのように「段ごとに少しだけ高さが違う階段状」にするために
      // 保持しておく(スペースバーの段はnullのまま=対象外)。
      const rowAttr = el.closest('.keyboard-row')?.dataset.row;
      const rowIndex = isSpacebar ? null : Number(rowAttr);
      if (isSpacebar) {
        const radius = h / 2;
        const half = Math.max(w / 2 - radius, 0);
        return { el, ax: cx - half, ay: cy, bx: cx + half, by: cy, radius, isSpacebar: true, letter: null, rowIndex };
      }
      const radius = w / 2;
      const letter = (el.textContent || '').toUpperCase();
      return { el, ax: cx, ay: cy, bx: cx, by: cy, radius, isSpacebar: false, letter, rowIndex };
    });
    keyIndexByEl.clear();
    keyGeoList.forEach((g, i) => keyIndexByEl.set(g.el, i));
  }
  rebuildKeyGeometry();

  // 打鍵時に該当キーの沈み込み量(0→1)をセットする。以後renderKeyboardThree内
  // で時間経過とともに0へ減衰させる(DOM側.pressedの文字ラベルのアニメ
  // とおよそ同じ220ms程度で元に戻る)。
  function triggerKeyPress(keyEl) {
    const idx = keyIndexByEl.get(keyEl);
    if (idx !== undefined) keyPressStart[idx] = performance.now();
  }

  // DOM側 .key の transition(transform 0.12s cubic-bezier) と
  // .pressedクラスの保持時間(220ms = setTimeoutで解除)に、フレームの
  // タイミングを正確に合わせるためのエンベロープ。
  //   0〜120ms  : 0→1 (ease-out、CSSのtransition-durationと一致)
  //   120〜220ms: 1のまま保持(.pressedクラスがついている間)
  //   220〜340ms: 1→0 (ease-out、クラスが外れた後のtransitionと一致)
  function pressEnvelope(elapsedMs) {
    const IN = 120, HOLD = 100, OUT = 120;
    if (elapsedMs < 0) return 0;
    if (elapsedMs < IN) {
      const t = elapsedMs / IN;
      return 1 - Math.pow(1 - t, 3);
    }
    if (elapsedMs < IN + HOLD) return 1;
    if (elapsedMs < IN + HOLD + OUT) {
      const t = (elapsedMs - IN - HOLD) / OUT;
      return Math.pow(1 - t, 3);
    }
    return 0;
  }

  // 卓上ライトの3D位置(#keyboard-rows中心を原点とするローカル平面座標
  // x, y + 平面からの高さh)。以前と全く同じ値を、キーと同じ
  // (x, yLocal, h)→ワールド変換(localToWorld)を通して使う。
  const LIGHT_LOCAL = { x: 0, y: 230, h: 265 };
  const LIGHT_COLOR = 0xfff2da;

  function resizeKeyboardCanvas() {
    updatePlaneOrigin();
    rebuildKeyGeometry();
  }

  (async function initKeyboardThree() {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
    if (isDisposed() || introRenderingStopped) return;

    const renderer = new THREE.WebGLRenderer({ canvas: keyboardCanvas, antialias: true, alpha: true });
    onIntroDispose(() => { renderer.dispose(); renderer.forceContextLoss(); });
    renderer.setClearColor(0x000000, 0);
    // ACESFilmicトーンマッピング。ハイライトが白飽和せず、金属の階調が
    // 自然に出る(既定のLinearトーンマッピングだとハイライトが硬く、
    // 全体が単調なグレーに見えやすい)。
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();

    // ---- 環境マップ(IBL) ----
    // 前回はパネルを数枚浮かべただけの環境だったため、反射方向に
    // たまたまパネルが入らないと真っ暗、逆に強く発光させると入った
    // 瞬間に真っ白、という「入るか入らないかの二択」になり不安定だった。
    // 本物のプロダクト撮影のように、連続的なグラデーション(上:明るい
    // 暖色 → 下:ほぼ黒)を球全体に敷くと、曲面(リング側面)の向きが
    // 変わるにつれて反射が滑らかに明→暗と移り変わる「金属らしい階調」
    // が常に出るようになる。
    function buildEnvScene() {
      const envScene = new THREE.Scene();

      const gradCanvas = document.createElement('canvas');
      gradCanvas.width = 8;
      gradCanvas.height = 256;
      const gctx = gradCanvas.getContext('2d');
      const grad = gctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.00, '#fff3dd'); // 上: 明るい暖色(部屋の照明を想定)
      grad.addColorStop(0.30, '#aab0bd'); // 中間: 中程度のグレー
      grad.addColorStop(0.62, '#33363f'); // やや下: 暗め
      grad.addColorStop(1.00, '#050506'); // 下: ほぼ黒
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, 8, 256);
      const gradTex = new THREE.CanvasTexture(gradCanvas);
      gradTex.colorSpace = THREE.SRGBColorSpace;

      envScene.add(new THREE.Mesh(
        new THREE.SphereGeometry(60, 32, 32),
        new THREE.MeshBasicMaterial({ map: gradTex, side: THREE.BackSide })
      ));

      // 正面やや上に小さく明るいハイライト板を1枚だけ足し、リング天面に
      // はっきりした反射の筋を1本作る(グラデーションだけだと反射が
      // 均一に滑らかすぎて、金属というより艶消し樹脂に見えるため)。
      const highlight = new THREE.Mesh(
        new THREE.PlaneGeometry(24, 8),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(3.2) })
      );
      highlight.position.set(0, 30, -20);
      highlight.lookAt(0, 0, 0);
      envScene.add(highlight);

      return envScene;
    }
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(buildEnvScene(), 0.03).texture;
    pmremGenerator.dispose();

    // ---- カメラ: CSSの perspective(780px) + rotateX(46deg) と
    // 数式的に完全一致させる ----
    // 変換の原理(ローカル平面座標 x, yLocal + 平面からの高さhを
    // ワールド座標へ):
    //   world.x =  x
    //   world.y = -(yLocal*cosθ - h*sinθ)   (Three.jsのY-upに合わせて反転)
    //   world.z =   yLocal*sinθ + h*cosθ
    // カメラは(0,0,PERSPECTIVE_D)に置き、原点方向(-Z)を見る(この配置
    // では追加の回転は不要=カメラのローカル軸=ワールド軸)。
    // 主点(画面上でカメラの光軸が刺さる位置)は#keyboard-rowsの中心
    // (planeOriginX/Y, ページ座標)に一致させる必要があるため、対称な
    // FOVではなく非対称(オフアクシス)な射影行列を毎フレーム
    // (リサイズ時)組み直す。
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, PERSPECTIVE_D);
    camera.lookAt(0, 0, 0);

    function localToWorld(x, yLocal, h) {
      return new THREE.Vector3(
        x,
        -(yLocal * TILT_COS - h * TILT_SIN),
        yLocal * TILT_SIN + h * TILT_COS
      );
    }

    function updateOffAxisProjection() {
      const W = window.innerWidth, H = window.innerHeight;
      const n = 1, far = 10000;
      const focal = PERSPECTIVE_D;
      const Aw = n * W / focal, Bw = Aw * (1 - 2 * planeOriginX / W);
      const right = (Aw + Bw) / 2, left = (Bw - Aw) / 2;
      const Ah = n * H / focal, Bh = -Ah * (1 - 2 * planeOriginY / H);
      const top = (Ah + Bh) / 2, bottom = (Bh - Ah) / 2;
      camera.near = n; camera.far = far;
      camera.projectionMatrix.makePerspective(left, right, top, bottom, n, far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    // ---- ライト ----
    // 環境マップ側にグラデーションで階調を持たせたので、点光源はもう
    // 「輝きの全責任」を負わなくてよい。強度を下げて、環境マップの
    // グラデーション反射+ハイライト板の反射(IBL)を主役に、点光源は
    // 通常のLambert陰影(キーの立体感)を作る役割に戻す。
    // (前回55まで上げていたのが、白飛びの直接原因)
    const light = new THREE.PointLight(LIGHT_COLOR, 22, 0, 0); // distance=0,decay=0: 距離減衰なし
    light.position.copy(localToWorld(LIGHT_LOCAL.x, LIGHT_LOCAL.y, LIGHT_LOCAL.h));
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404850, 0.25));

    // ---- 文字テクスチャ(Quicksand。読み込みを待ってから生成する) ----
    const FONT_FAMILY = 'Quicksand';
    async function ensureFontLoaded() {
      try {
        await Promise.all([
          document.fonts.load(`300 200px "${FONT_FAMILY}"`),
          document.fonts.load(`700 200px "${FONT_FAMILY}"`),
        ]);
        await document.fonts.ready;
      } catch (e) { /* 読み込み失敗時はフォールバック書体のまま続行 */ }
    }
    // 実物のタイプライターでは、1個のキーに大小2つの文字が彫られている
    // ことがある。今回はコンマキーとピリオドキーを、同じ文字を上下に
    // 2つ並べる見た目にする(コンマは全角の「，」を使う)。
    // コンマの「，」は字形の重心が左に寄って見えるため、キー中央に対して
    // 少し右へオフセットして描く(ピリオドは中央のまま)。
    const DOUBLE_CHAR_MAP = { ',': '，', '.': '.' };
    const DOUBLE_CHAR_OFFSET_X = { ',': 18 };

    function makeGlyphTexture(ch, doubleChar) {
      const c = document.createElement('canvas');
      c.width = c.height = 256;
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#0a0a0c';
      ctx.fillRect(0, 0, 256, 256);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      if (doubleChar) {
        // 上下とも同じ文字・同じサイズで並べる
        const cx = 128 + (DOUBLE_CHAR_OFFSET_X[ch] || 0);
        ctx.font = `500 108px "${FONT_FAMILY}", sans-serif`;
        ctx.fillText(doubleChar, cx, 76);
        ctx.fillText(doubleChar, cx, 180);
      } else {
        ctx.font = `300 200px "${FONT_FAMILY}", sans-serif`;
        ctx.fillText(ch, 128, 128 + 15); // 視覚的な中央合わせの微調整
      }
      const tex = new THREE.CanvasTexture(c);
      tex.colorSpace = THREE.SRGBColorSpace;
      return tex;
    }

    // ---- キーキャップの形状 ----
    // 直径1・全高0.24・ポケット(文字面)深さ0.05・ポケット半径0.85を
    // 基準比率とし、実際のキーの直径にスケールして使う。
    const SILVER = { color: 0xb8bcc4, metalness: 0.95, roughness: 0.18, envMapIntensity: 1.25 };
    const HEIGHT_RATIO = 0.24;   // 全高 / 直径
    const RECESS_RATIO = 0.05;   // ポケットの深さ / 直径
    const POCKET_R_RATIO = 0.85; // ポケット半径 / 外径

    // 円柱の側面から天面のリングへ、角を丸めた「ベベル(面取り)」で
    // つなぐ回転体プロファイルを作る。フラットな円柱+フラットなリングを
    // 90°の鋭い角で継ぐより、実際の金属キーキャップのように光の当たる
    // 細い帯(ハイライト)ができ、シルバーらしい質感になる。
    // innerR: 天面リングの内側端の半径。innerBevel/pocketDepthを渡すと、
    // そこからさらに内側の角も丸めてポケット内壁の途中まで滑らかに
    // つなぐ(文字ポケットの縁)。innerBevel=0なら中心(または平らな内壁)
    // までまっすぐ、という単純なプロファイルになる。
    function buildBevelProfile(R, innerR, TOTAL_H, bevelR, segments, innerBevel, pocketDepth) {
      const pts = [];
      pts.push(new THREE.Vector2(R, 0)); // 底の外周
      pts.push(new THREE.Vector2(R, TOTAL_H - bevelR)); // まっすぐな側面の上端(外側ベベル開始)
      const cx = R - bevelR, cy = TOTAL_H - bevelR;
      for (let i = 1; i <= segments; i++) {
        const theta = (i / segments) * (Math.PI / 2);
        pts.push(new THREE.Vector2(cx + bevelR * Math.cos(theta), cy + bevelR * Math.sin(theta)));
      }
      if (innerBevel > 0) {
        // 天面(外向き)からポケット内壁(下向き)へ移る「内側の角」も
        // 丸める。凹んだ角なので、円弧の中心はプロファイルの外側
        // (半径が大きくなる側)に置く。
        pts.push(new THREE.Vector2(innerR + innerBevel, TOTAL_H)); // 天面の平らな部分の終端
        const icx = innerR + innerBevel, icy = TOTAL_H - innerBevel;
        for (let i = 1; i <= segments; i++) {
          const theta = Math.PI / 2 + (i / segments) * (Math.PI / 2);
          pts.push(new THREE.Vector2(icx + innerBevel * Math.cos(theta), icy + innerBevel * Math.sin(theta)));
        }
        pts.push(new THREE.Vector2(innerR, TOTAL_H - pocketDepth)); // ポケット内壁の下端(文字面の高さ)
      } else {
        pts.push(new THREE.Vector2(innerR, TOTAL_H)); // 天面(リング)の内側端、またはキャップ中心
      }
      return pts;
    }

    function buildKeycap(radius, letter) {
      const R = radius;
      const TOTAL_H = R * 2 * HEIGHT_RATIO;
      const RECESS = R * 2 * RECESS_RATIO;
      const R_INNER = R * POCKET_R_RATIO;
      const BEVEL_R = TOTAL_H * 0.18;
      const INNER_BEVEL_R = RECESS * 0.4;
      // 個体差: 全く同じ角度で揃っていると、全キーが判で押したように
      // 均一に光ってしまい不自然(=「どのキーも同じだけ光っている」)。
      // 実物のキーボードのように、組み付けのわずかな傾きで反射の当たり方が
      // キーごとに変わる様子を、ごく小さなランダム傾斜とラフネスのばらつき
      // で再現する。傾きは見た目上ほぼ気づかない範囲(最大でも約2度)。
      const tiltX = (Math.random() - 0.5) * THREE.MathUtils.degToRad(4);
      const tiltZ = (Math.random() - 0.5) * THREE.MathUtils.degToRad(4);
      const roughnessJitter = (Math.random() - 0.5) * 0.14;

      const group = new THREE.Group();
      const silverMat = new THREE.MeshStandardMaterial({
        ...SILVER,
        roughness: THREE.MathUtils.clamp(SILVER.roughness + roughnessJitter, 0.06, 0.4),
        side: THREE.DoubleSide,
      });

      // 底面
      const bottomGeo = new THREE.CircleGeometry(R, 48);
      bottomGeo.rotateX(Math.PI / 2);
      group.add(new THREE.Mesh(bottomGeo, silverMat));

      if (letter) {
        // 側面〜天面リング〜ポケット内壁までを1本の回転体として作り、
        // 外側・内側どちらの角にもベベル(丸み)をかける
        const outerProfile = buildBevelProfile(R, R_INNER, TOTAL_H, BEVEL_R, 6, INNER_BEVEL_R, RECESS);
        const outerGeo = new THREE.LatheGeometry(outerProfile, 48);
        group.add(new THREE.Mesh(outerGeo, silverMat));

        // ポケットの底(文字面。ここだけ黒背景+文字のテクスチャ)
        const glyphGeo = new THREE.CircleGeometry(R_INNER, 48);
        glyphGeo.rotateX(-Math.PI / 2);
        const glyphMat = new THREE.MeshStandardMaterial({ map: makeGlyphTexture(letter, DOUBLE_CHAR_MAP[letter]), metalness: 0.1, roughness: 0.35 });
        const glyphFace = new THREE.Mesh(glyphGeo, glyphMat);
        glyphFace.position.y = TOTAL_H - RECESS;
        group.add(glyphFace);
      } else {
        // 文字なし: 側面〜天面(全面シルバーの円板)を1本の回転体にし、
        // 同じく上端の角にベベルをかける(中心まで滑らかにつながる)
        const outerProfile = buildBevelProfile(R, 0, TOTAL_H, BEVEL_R, 6, 0, 0);
        const outerGeo = new THREE.LatheGeometry(outerProfile, 48);
        group.add(new THREE.Mesh(outerGeo, silverMat));
      }

      group.userData.totalHeight = TOTAL_H;
      group.rotation.x = tiltX;
      group.rotation.z = tiltZ;
      return group;
    }

    // ---- スペースバー ----
    // 実物のキーボード同様、文字ポケットは不要(ユーザー要望通り新しい
    // キャップ構造の対象外)。スタジアム(角丸長方形)の2D形状を
    // ExtrudeGeometryで押し出しただけの、単純な黒いプラスチックの1個。
    function buildSpacebar(ax, bx, radius) {
      const half = Math.abs(bx - ax) / 2;
      const R = radius;
      const TOTAL_H = R * 2 * HEIGHT_RATIO;

      const shape = new THREE.Shape();
      shape.absarc(-half, 0, R, Math.PI / 2, Math.PI * 1.5, false);
      shape.absarc(half, 0, R, -Math.PI / 2, Math.PI / 2, false);
      shape.closePath();

      // bevelEnabled: 天面・底面と側面の境界に丸み(面取り)をつける。
      // 実物のスペースキーのような、角の取れたエッジになる。
      const bevel = TOTAL_H * 0.32;
      const geo = new THREE.ExtrudeGeometry(shape, {
        depth: TOTAL_H - bevel * 2,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 8,
        curveSegments: 32,
      });
      geo.translate(0, 0, bevel); // ベベル分ずれる押し出し範囲を[0, TOTAL_H]に戻す
      geo.rotateX(-Math.PI / 2); // 押し出し方向(Z)をY(上)に揃える
      const mat = new THREE.MeshStandardMaterial({ color: 0x111114, metalness: 0.15, roughness: 0.3, side: THREE.DoubleSide });
      const group = new THREE.Group();
      group.add(new THREE.Mesh(geo, mat));
      group.userData.totalHeight = TOTAL_H;
      return group;
    }

    // ---- 各キーの向き ----
    // キャップは既定でThree.jsのY-up(高さ=ローカルY)で作られている。
    // 文字盤自体がrotateX(46deg)相当で傾いているので、キーの向きも
    // 同じ角度だけX軸まわりに回転させて文字盤に対して垂直に立たせる。
    const KEY_TILT_RAD = TILT_ANGLE_DEG * Math.PI / 180;

    await ensureFontLoaded();

    // ---- 各キーの3Dグループを構築してシーンに追加 ----
    const keyGroups = keyGeoList.map((g) => {
      const grp = g.isSpacebar
        ? buildSpacebar(g.ax, g.bx, g.radius)
        : buildKeycap(g.radius, g.letter);
      grp.rotation.x = KEY_TILT_RAD;
      scene.add(grp);
      return grp;
    });

    const PRESS_SINK_H_RATIO = 1.55; // 押し込み時、キー全高に対してどれだけ沈めるか
    const PRESS_SHRINK = 0.06;
    // アルファベット3段(0=Q段, 1=A段, 2=Z段)を、実物のタイプライターの
    // ように少しだけ高さの違う階段状にする。手前(Z段)に向かうほど低く
    // なる向き(ROW_STEP_H=-7)。基準点は最後の段(Z段, rowIndex=2)に
    // 置き、そこをスペースバーと同じ高さ(0)に揃える。基準を先頭の段に
    // 置いたままマイナスの段差をつけると、Z段がスペースバーより低く
    // 沈んでしまうため。
    const ROW_STEP_H = -7;
    const ROW_BASE_INDEX = KEY_ROWS.length - 1;
    function layoutKeyGroups() {
      for (let i = 0; i < keyGeoList.length; i++) {
        const g = keyGeoList[i];
        const grp = keyGroups[i];
        if (!grp) continue;
        const press = keyPress[i];
        const cx = (g.ax + g.bx) / 2, cy = (g.ay + g.by) / 2;
        const rowH = g.rowIndex != null ? (g.rowIndex - ROW_BASE_INDEX) * ROW_STEP_H : 0;
        const sinkH = rowH - press * grp.userData.totalHeight * PRESS_SINK_H_RATIO;
        grp.position.copy(localToWorld(cx, cy, sinkH));
        // 半径(footprint)まで縮めると、実物にはない「潰れて見える」疑似的な
        // 動きになってしまうため、縮小は高さ方向(ローカルY)だけに限定する。
        // 平面への押し込み(位置側)は cx, cy を一切変えず sinkH だけを
        // 変化させているので、キーは常に文字盤の法線方向(傾いた面に
        // 対して垂直)へ真っすぐ沈む。
        grp.scale.set(1, 1 - press * PRESS_SHRINK, 1);
      }
    }

    function resizeThree() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(window.innerWidth, window.innerHeight, true);
      updateOffAxisProjection();
    }
    resizeThree();
    function handleKeyboardResize() { if (isDisposed() || introRenderingStopped) return; resizeKeyboardCanvas(); resizeThree(); }
    listen(window, 'resize', handleKeyboardResize);
    // 【Macで配置が崩れる/スマホChromeで文字盤が拡大して見える、について】
    // この文字盤(#keyboard-rows)はWebGPUとは無関係の別システム(Three.js /
    // WebGL)で、その位置に3Dシーンをオフアクシス投影で正確に重ね合わせて
    // いる。この重ね合わせはwindow.innerWidth/innerHeightと#keyboard-rowsの
    // getBoundingClientRect()を突き合わせているため、次のようなケースで
    // ズレる(=拡大・位置ズレして見える)可能性がある: (1) モバイルでアドレス
    // バーの表示/非表示によってvisualViewportは変化するが、'resize'イベントが
    // 必ずしも発火しない、(2) キー用フォント(Quicksand)の読み込み完了で
    // レイアウトがわずかに変わっても、それをきっかけに再計算する処理が
    // なかった、(3) ページの初期表示直後、Mac側のレンダリング/フォント確定の
    // タイミングが微妙にずれ、初回計測が実際の最終レイアウトより早すぎる。
    // どれも「一度だけ測って以後は明示的なresizeイベントだけを待つ」という
    // 設計の弱さが原因なので、(a) visualViewportのresizeも併せて聞く、
    // (b) フォント確定後にも取り直す、(c) 初期表示直後に少し遅らせてもう一度
    // 取り直す、という3つの安全策を足す。
    if (window.visualViewport) {
      listen(window.visualViewport, 'resize', handleKeyboardResize);
    }
    ensureFontLoaded().then(handleKeyboardResize).catch(() => {});
    later(handleKeyboardResize, 300);
    later(handleKeyboardResize, 1200);

    function renderKeyboardThree() {
      if (introRenderingStopped) return;
      const now = performance.now();
      for (let i = 0; i < keyPress.length; i++) {
        keyPress[i] = pressEnvelope(now - keyPressStart[i]);
      }
      layoutKeyGroups();
      renderer.render(scene, camera);
      raf(renderKeyboardThree);
    }
    raf(renderKeyboardThree);
  })();

  // ---- 波紋(打鍵時, ランプの光を歪ませるだけの版) ----
  // 水そのものには色も不透明度も持たせない。#lamp-glowの光の分布を
  // このシェーダ内で同じ数式(radial-gradientの4段階ストップ)で再現し、
  // 波の勾配ぶんだけサンプリング位置をずらして評価する。ずらす前後で
  // 明るさが変わった差分だけを、その場に薄い白(明るくなった分)または
  // 薄い黒(暗くなった分)として重ねて描く。新しい色を足すのではなく、
  // あくまで「既存の光の見え方のズレ」だけを可視化する仕組みなので、
  // 通常のalpha合成で構わない(mix-blend-modeは使わない)。#lamp-glowの
  // 光が届かない場所では明るさの差分もゼロになるため、境界(box)を
  // 用意しなくても自動的に「光が届く範囲でしか波紋が見えない」状態に
  // なり、逆に光が届く範囲内であれば波は画面の端まで際限なく伝播できる。
  //
  // 波の伝播自体は、画面に対して平行な平面ではなく、.keyboard-rowsの
  // rotateX(46deg)・.keyboard-viewportのperspective(780px)と全く同じ
  // 角度・奥行きで傾いた「水面」上で計算する。画面座標をそのまま使うと
  // 波が正円に広がってしまい文字盤の傾きと合わないため、各ピクセルの
  // 画面座標を「傾いた水面上のローカル座標」に逆変換してから波の高さ場
  // を評価する(unprojectToPlane)。これにより、奥ほど波が圧縮されて見える
  // 遠近感も自然に再現される。
  const rippleCanvas = $('ripple-canvas');
  const rippleGl = rippleCanvas.getContext('webgl2')
                 || rippleCanvas.getContext('webgl')
                 || rippleCanvas.getContext('experimental-webgl');

  const RIPPLE_MAX = 24;        // 同時に画面上に存在できる波源の最大数
  const RIPPLE_LIFETIME = 3.6;  // 秒。かなり大きく広がる波にしたので、その分長めに生かしておく
  let rippleImpulses = [];      // { x, y, start }(x, y: 水面のローカル平面座標, startは秒)
  let rippleUniforms = null;

  function initRippleGL(gl) {
    const vsSrc = `
      attribute vec2 a_pos;
      void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
    `;
    const fsSrc = `
      precision highp float;
      uniform vec2  u_resolution;              // canvas実ピクセルサイズ(device px)
      uniform float u_dpr;
      uniform vec2  u_lampCenter;               // #lamp-glowの中心(画面CSS px)
      uniform vec2  u_lampSize;                 // #lamp-glowの幅・高さ(画面CSS px)
      uniform float u_lampOn;                   // 0=消灯 / 1=点灯(#lamp-glow.onの状態)
      uniform vec2  u_planeOrigin;               // 水面(傾いた平面)の原点(画面CSS px)
      uniform int   u_count;
      uniform vec2  u_origin[${RIPPLE_MAX}];    // 波源位置(水面のローカル平面座標。変換済み)
      uniform float u_age[${RIPPLE_MAX}];       // 波源発生からの経過秒数

      // JS側のTILT_COS/TILT_SIN/PERSPECTIVE_Dと必ず一致させること
      const float TILT_COS = 0.694658;
      const float TILT_SIN = 0.719340;
      const float PERSP_D  = 780.0;

      // 画面座標(平面原点からの相対座標)→傾いた水面上のローカル座標。
      // JS側unprojectToPlaneJSと同じ式(CSSのperspective+rotateXの逆変換)。
      // ホライズン付近の特異点で発散しないよう分母を軽くクランプしている
      // (その領域はどのみち#lamp-glowの光が届かないため、多少の歪みは
      // 視覚上問題にならない)。
      vec2 unprojectToPlane(vec2 rel) {
        float denomY = max(TILT_COS + rel.y * TILT_SIN / PERSP_D, 0.12);
        float y = rel.y / denomY;
        float denomX = 1.0 - y * TILT_SIN / PERSP_D;
        return vec2(rel.x * denomX, y);
      }

      // ---- #lamp-glowと同じ光の分布(CSSのradial-gradientを再現) ----
      // radial-gradient(ellipse 50% 50% at 50% 50%,
      //   rgba(255,255,255,0.60) 0%, rgba(255,250,240,0.38) 20%,
      //   rgba(214,232,255,0.14) 38%, rgba(150,190,255,0.0) 55%)
      // "ellipse 50% 50%" は要素の半幅・半高にぴったり一致するサイズ
      // なので、中心からの正規化楕円距離dが、そのままグラデーションの
      // 0%〜100%に対応する。4つのストップ間を線形補間する。
      vec4 lampStop(float t) {
        if (t < 0.20) return mix(vec4(1.00,1.00,1.00,0.72), vec4(1.00,0.98,0.94,0.46), t / 0.20);
        if (t < 0.38) return mix(vec4(1.00,0.98,0.94,0.46), vec4(0.84,0.91,1.00,0.18), (t - 0.20) / 0.18);
        if (t < 0.55) return mix(vec4(0.84,0.91,1.00,0.18), vec4(0.59,0.75,1.00,0.00), (t - 0.38) / 0.17);
        return vec4(0.59, 0.75, 1.00, 0.0);
      }
      // 戻り値: rgbは premultiplied(色*alpha)の明るさ、aはその強さ
      vec4 lampLight(vec2 p) {
        vec2 d = (p - u_lampCenter) / (u_lampSize * 0.5);
        float t = length(d);
        vec4 s = lampStop(t) * u_lampOn;
        return vec4(s.rgb * s.a, s.a);
      }

      // ---- 波紋の高さ場(表面張力による分散を近似) ----
      // 1個の波源につき、波長の異なる3本の波(w1: 短波長=毛管波っぽい
      // 速い波、w3: 長波長=重力波っぽい遅い波)を、それぞれ違う速度で
      // 重ね合わせる。実際の水面では波長が短いほど速く伝わる分散関係
      // があるため、「先端に細かい波が先行し、その後ろにゆったりした
      // うねりが続く」という本物の波紋らしい表情になる。carrierは
      // sign/powで少し尖らせ、粘性のある水面の鋭さを出している。
      float wavePacket(vec2 lp, vec2 origin, float t) {
        if (t < 0.0) return 0.0;
        float r = length(lp - origin);
        float sigma = 22.0 + t * 85.0;
        float env = exp(-t / 1.3);
        float spread = 1.0 / sqrt(1.0 + r * 0.004);

        float f1 = 900.0 * t;
        float c1 = cos((r - f1) * 0.28);
        c1 = sign(c1) * pow(abs(c1), 0.72);
        float w1 = exp(-pow(r - f1, 2.0) / (2.0 * sigma * sigma)) * c1 * 0.4;

        float f2 = 680.0 * t;
        float c2 = cos((r - f2) * 0.15);
        c2 = sign(c2) * pow(abs(c2), 0.72);
        float w2 = exp(-pow(r - f2, 2.0) / (2.0 * sigma * sigma)) * c2 * 0.6;

        float f3 = 500.0 * t;
        float c3 = cos((r - f3) * 0.075);
        c3 = sign(c3) * pow(abs(c3), 0.72);
        float w3 = exp(-pow(r - f3, 2.0) / (2.0 * sigma * sigma)) * c3 * 1.2;

        return (w1 + w2 + w3) * env * spread;
      }

      float heightField(vec2 lp) {
        float h = 0.0;
        for (int i = 0; i < ${RIPPLE_MAX}; i++) {
          if (i >= u_count) break;
          h += wavePacket(lp, u_origin[i], u_age[i]);
        }
        return h;
      }

      void main() {
        vec2 p = vec2(gl_FragCoord.x, u_resolution.y - gl_FragCoord.y) / u_dpr;
        vec2 rel = p - u_planeOrigin;

        // 有限差分は「画面px」の刻みで取ることで、傾いた平面の遠近圧縮
        // (奥ほど同じ画面pxの移動が小さいローカル距離に対応する)が勾配に
        // 自然に反映される。波長を大きくしたぶん、刻み幅も少し広げている。
        float e = 2.4;
        vec2 lpXp = unprojectToPlane(rel + vec2(e, 0.0));
        vec2 lpXn = unprojectToPlane(rel - vec2(e, 0.0));
        vec2 lpYp = unprojectToPlane(rel + vec2(0.0, e));
        vec2 lpYn = unprojectToPlane(rel - vec2(0.0, e));

        float hx = clamp(heightField(lpXp) - heightField(lpXn), -24.0, 24.0);
        float hy = clamp(heightField(lpYp) - heightField(lpYn), -24.0, 24.0);
        float slope2 = hx * hx + hy * hy;

        // ---- 通常の屈折(波なりの緩やかな歪み) ----
        float refractStrength = 70.0;
        vec2 offsetMain = vec2(hx, hy) * refractStrength;

        // ---- 強い光沢(急な波面だけを大きく強調するハイライト) ----
        // 傾きが急な場所(波の縁・立ち上がり)だけを非線形に強調することで、
        // サンプルのような強いスペキュラ光沢を表現する。緩やかな場所では
        // ほぼ効かない。
        float glossBoost = clamp(slope2 * 60.0, 0.0, 5.0);
        vec2 offsetGloss = vec2(hx, hy) * refractStrength * 2.4 * glossBoost;

        vec4 trueLight  = lampLight(p);
        vec4 mainLight  = lampLight(p + offsetMain);
        vec4 glossLight = lampLight(p + offsetGloss);

        float trueLum  = dot(trueLight.rgb,  vec3(0.299, 0.587, 0.114));
        float mainLum  = dot(mainLight.rgb,  vec3(0.299, 0.587, 0.114));
        float glossLum = dot(glossLight.rgb, vec3(0.299, 0.587, 0.114));

        float deltaMain  = mainLum - trueLum;
        // 光沢は明るくなる方向だけ強め合成する(暗い光沢というのは
        // 現実的でないため)
        float deltaGloss = max(glossLum - trueLum, 0.0) * 1.8;
        float delta = deltaMain + deltaGloss;

        vec3 overlayColor;
        float overlayAlpha;
        if (delta > 0.0) {
          // 明るくなった分: その位置の光自体の色(暖色〜寒色)で明るさを足す
          vec3 srcColor = (glossLum > mainLum) ? glossLight.rgb / max(glossLum, 1e-4)
                                                : mainLight.rgb / max(mainLum, 1e-4);
          overlayColor = srcColor;
          overlayAlpha = clamp(delta * 2.6, 0.0, 1.0);
        } else {
          // 暗くなった分: 黒で明るさを差し引く
          overlayColor = vec3(0.0);
          overlayAlpha = clamp(-delta * 2.6, 0.0, 1.0);
        }

        gl_FragColor = vec4(overlayColor * overlayAlpha, overlayAlpha); // premultiplied alpha
      }
    `;

    function compile(type, src) {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
        console.warn('ripple shader compile error:', gl.getShaderInfoLog(sh));
        return null;
      }
      return sh;
    }
    const vs = compile(gl.VERTEX_SHADER, vsSrc);
    const fs = compile(gl.FRAGMENT_SHADER, fsSrc);
    if (!vs || !fs) return null;

    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('ripple program link error:', gl.getProgramInfoLog(prog));
      return null;
    }
    gl.useProgram(prog);

    const quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const posLoc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(posLoc);
    gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // premultiplied alphaでの通常合成(screenブレンドは使わない)

    return {
      u_resolution: gl.getUniformLocation(prog, 'u_resolution'),
      u_dpr: gl.getUniformLocation(prog, 'u_dpr'),
      u_lampCenter: gl.getUniformLocation(prog, 'u_lampCenter'),
      u_lampSize: gl.getUniformLocation(prog, 'u_lampSize'),
      u_lampOn: gl.getUniformLocation(prog, 'u_lampOn'),
      u_planeOrigin: gl.getUniformLocation(prog, 'u_planeOrigin'),
      u_count: gl.getUniformLocation(prog, 'u_count'),
      u_origin: gl.getUniformLocation(prog, 'u_origin'),
      u_age: gl.getUniformLocation(prog, 'u_age'),
    };
  }

  if (rippleGl) rippleUniforms = initRippleGL(rippleGl);
  onIntroDispose(() => { try { rippleGl && rippleGl.getExtension('WEBGL_lose_context')?.loseContext(); } catch (e) {} });

  function resizeRippleCanvas() {
    if (!rippleGl || introRenderingStopped) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    rippleCanvas.width = Math.max(1, Math.floor(window.innerWidth * dpr));
    rippleCanvas.height = Math.max(1, Math.floor(window.innerHeight * dpr));
    rippleGl.viewport(0, 0, rippleCanvas.width, rippleCanvas.height);
    updatePlaneOrigin();
  }

  // #lamp-glowの現在位置・サイズ・点灯状態を毎フレーム読み取る。
  // positionLampGlow()がstyle.left/top/width/heightをpx文字列で書き込んで
  // いるので、それをそのままパースするだけでよく、レイアウト変更にも
  // 自動的に追従する。
  function readLampGlowState() {
    const style = lampGlow.style;
    return {
      cx: parseFloat(style.left) || 0,
      cy: parseFloat(style.top) || 0,
      w: parseFloat(style.width) || 1,
      h: parseFloat(style.height) || 1,
      on: lampGlow.classList.contains('on') ? 1 : 0,
    };
  }

  function renderRipples() {
    if (introRenderingStopped) return;
    const gl = rippleGl, u = rippleUniforms;
    const now = performance.now() / 1000;
    rippleImpulses = rippleImpulses.filter((r) => now - r.start < RIPPLE_LIFETIME);

    const n = Math.min(rippleImpulses.length, RIPPLE_MAX);
    const originArr = new Float32Array(RIPPLE_MAX * 2);
    const ageArr = new Float32Array(RIPPLE_MAX);
    for (let i = 0; i < n; i++) {
      const r = rippleImpulses[i];
      originArr[i * 2] = r.x;
      originArr[i * 2 + 1] = r.y;
      ageArr[i] = now - r.start;
    }

    const lamp = readLampGlowState();

    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u.u_resolution, rippleCanvas.width, rippleCanvas.height);
    gl.uniform1f(u.u_dpr, Math.min(window.devicePixelRatio || 1, 2));
    gl.uniform2f(u.u_lampCenter, lamp.cx, lamp.cy);
    gl.uniform2f(u.u_lampSize, lamp.w, lamp.h);
    gl.uniform1f(u.u_lampOn, lamp.on);
    gl.uniform2f(u.u_planeOrigin, planeOriginX, planeOriginY);
    gl.uniform1i(u.u_count, n);
    gl.uniform2fv(u.u_origin, originArr);
    gl.uniform1fv(u.u_age, ageArr);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    raf(renderRipples);
  }

  if (rippleGl && rippleUniforms) {
    updatePlaneOrigin();
    resizeRippleCanvas();
    listen(window, 'resize', resizeRippleCanvas);
    raf(renderRipples);
  }

  // 画面座標(CSS px)を受け取り、水面(傾いた平面)のローカル座標に変換
  // してから波源として1個追加する。常時レンダリングループは既に回って
  // いるため、ここではキュー(配列)に追加するだけでよい。
  function spawnRipple(x, y) {
    if (!rippleGl || !rippleUniforms) return; // WebGL非対応環境では波紋なし
    const [lx, ly] = unprojectToPlaneJS(x - planeOriginX, y - planeOriginY);
    rippleImpulses.push({ x: lx, y: ly, start: performance.now() / 1000 });
    if (rippleImpulses.length > RIPPLE_MAX) rippleImpulses.shift();
  }

  function spawnRippleBurst(x, y) {
    const RING_COUNT = 4;
    for (let i = 0; i < RING_COUNT; i++) {
      later(() => spawnRipple(x, y), i * 90);
    }
  }

  // キーを実際に沈み込ませる視覚効果のみ(波紋なし)。前置きの自動タイプ演出
  // (flashKey)と、実際の打鍵演出(pressKey)の両方から共通して使う。
  function flashKey(keyEl) {
    if (!keyEl) return;
    keyEl.classList.add('pressed');
    triggerKeyPress(keyEl);
    later(() => keyEl.classList.remove('pressed'), 220);
  }

  // ユーザーが実際に打ち込む"Hapworth Lake"用: キーの沈み込みに加えて波紋も出す。
  // 前置きの自動タイプ中は波紋なしにしたいため、そちらはflashKeyのみを使う。
  // (現状はtryInput内で同等の処理を直接行っているため未使用)
  function pressKey(keyEl) {
    flashKey(keyEl);
    const rect = keyEl.getBoundingClientRect();
    spawnRippleBurst(rect.left + rect.width / 2, rect.top + rect.height / 2);
  }

  // 前置きの一文もHapworthLakeも同じ「紙」の上の1本の行として打たれる。
  // 1文字打つたびに、その文字が常に同じ位置(タイプ位置)に現れるよう
  // 紙全体(linesEl)を左へ送り出す。結果としてすでに現れている文字は
  // 前置きの文も含め、全て左へ流れていく。改行時は1行分だけ上へ
  // 繰り上げる。横方向・縦方向どちらも、打刻位置(画面上の固定の一点)
  // 自体は絶対に動かさない。
  let currentLineWidth = 0;
  let linesPassed = 0;
  const LEVER_MOVE_SCALE = 0.7; // レバーの左右移動量
  const lineHeightPx = parseFloat(getComputedStyle(paperTextEl).lineHeight) || 40;

  // ---- レバーの向き(ベクトル)計算 ----
  // 座標系: x=右がプラス、y=下がプラス、z=画面手前(視聴者側)がプラス。
  // 静止状態のベクトルを (-2, -1, 5) として、これを実現する回転角を
  // 逆算する。#lever は「rotateY(方位角) rotateX(仰角)」の順で合成する
  // (CSSは右側の関数から先に適用されるため、rotateX で奥行きへ倒し、
  // その結果をさらに rotateY で左右に振る、という構造にする必要がある)。
  const LEVER_VEC_REST = { x: -2, y: -1, z: 5 };
  const leverRestMag = Math.hypot(LEVER_VEC_REST.x, LEVER_VEC_REST.y, LEVER_VEC_REST.z);
  const leverRestNorm = {
    x: LEVER_VEC_REST.x / leverRestMag,
    y: LEVER_VEC_REST.y / leverRestMag,
    z: LEVER_VEC_REST.z / leverRestMag,
  };
  const LEVER_THETA_DEG = Math.acos(leverRestNorm.y) * 180 / Math.PI; // 仰角(奥行きへの倒し量)
  const LEVER_REST_PHI_DEG = Math.atan2(leverRestNorm.x, leverRestNorm.z) * 180 / Math.PI; // 静止時の方位角
  const LEVER_ACTIVE_PHI_DEG = 0; // 回転操作後、xが0になる姿勢

  // レバーの左右の見た目の移動量(回転操作でxが0になるまでの振れ幅)を
  // 文章の1行分の移動量(lineHeightPx)とそろえるため、レバーの長さを
  // 逆算する。
  const sinTheta = Math.sin(LEVER_THETA_DEG * Math.PI / 180);
  const phiSwingFactor = Math.abs(Math.sin(LEVER_REST_PHI_DEG * Math.PI / 180) - Math.sin(LEVER_ACTIVE_PHI_DEG * Math.PI / 180));
  const leverLengthPx = lineHeightPx / (sinTheta * phiSwingFactor);
  leverEl.style.height = leverLengthPx + 'px';
  leverEl.style.transitionDuration = '0s'; // 初期姿勢の設定時はアニメーションさせない
  leverEl.style.transform = 'rotateY(' + LEVER_REST_PHI_DEG + 'deg) rotateX(' + LEVER_THETA_DEG + 'deg)';
  raf(() => { leverEl.style.transitionDuration = ''; });

  // ---- レバー本体(Three.js) ----
  // #lever/#lever-mountは位置・回転・タイミングを計算するための「基準」
  // としてそのまま使い続け(CSSのtransition/easingも含めて一切変更しない)、
  // 見た目だけをThree.jsの立体メッシュに置き換える。キーの陰影と同じ
  // PBR+環境マップ方式。
  //   ・付け根側: 暗い色の丸棒(ヒンジ寄り)
  //   ・丸い曲がり角
  //   ・先端側: 外角60度で持ち上げた、シルバーで平たいパドル
  //     (左から親指で押す面が平ら、角は丸め)
  // #keyboard-canvasの off-axis カメラと同じ考え方だが、こちらは
  // #lever-mount自体がtranslateXで動くため、原点(=#lever-mountの
  // 画面上の位置)を毎フレーム再計算する。
  (async function initLeverThree() {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js');
    const canvas = $('lever-canvas');
    if (!canvas) return;

    // サブディビジョンサーフェス(Loop方式)。three.js本体からは
    // r125で削除されているため、別パッケージ(three-subdivide)から
    // 読み込む。ここが失敗しても(CDN不達など)レバー自体は表示できる
    // ように、読み込み失敗時はundefinedのまま素通りさせる
    // (以前の「RoomEnvironment読み込み失敗でキーが全消失」と同じ事故を
    // 避けるための措置)。
    let subdivideLoop;
    try {
      const mod = await import('https://cdn.jsdelivr.net/npm/three-subdivide@1.1.5/build/index.module.js');
      subdivideLoop = (geo, iterations, params) => mod.LoopSubdivision.modify(geo, iterations, params);
    } catch (e) {
      console.warn('three-subdivide の読み込みに失敗したため、サブディビジョンなしで描画します', e);
    }

    if (isDisposed() || introRenderingStopped) return;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    onIntroDispose(() => { renderer.dispose(); renderer.forceContextLoss(); });
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();

    // ---- 環境マップ(キーと同じグラデーション球方式) ----
    function buildEnvScene() {
      const envScene = new THREE.Scene();
      const gradCanvas = document.createElement('canvas');
      gradCanvas.width = 8; gradCanvas.height = 256;
      const gctx = gradCanvas.getContext('2d');
      const grad = gctx.createLinearGradient(0, 0, 0, 256);
      grad.addColorStop(0.00, '#fff3dd');
      grad.addColorStop(0.30, '#aab0bd');
      grad.addColorStop(0.62, '#33363f');
      grad.addColorStop(1.00, '#050506');
      gctx.fillStyle = grad;
      gctx.fillRect(0, 0, 8, 256);
      const gradTex = new THREE.CanvasTexture(gradCanvas);
      gradTex.colorSpace = THREE.SRGBColorSpace;
      envScene.add(new THREE.Mesh(
        new THREE.SphereGeometry(200, 32, 32),
        new THREE.MeshBasicMaterial({ map: gradTex, side: THREE.BackSide })
      ));
      const highlight = new THREE.Mesh(
        new THREE.PlaneGeometry(80, 30),
        new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffffff).multiplyScalar(2.4) })
      );
      highlight.position.set(-60, 80, -60);
      highlight.lookAt(0, 0, 0);
      envScene.add(highlight);
      return envScene;
    }
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(buildEnvScene(), 0.03).texture;
    pmremGenerator.dispose();

    const light = new THREE.PointLight(0xfff2da, 24, 0, 0);
    light.position.set(-60, 80, 120);
    scene.add(light);
    scene.add(new THREE.AmbientLight(0x404850, 0.3));

    // ---- カメラ ----
    // #lever-mountの perspective:420px と同じ焦点距離。原点(=画面上の
    // どこにレバーの付け根が来るか)は#lever-mountがtranslateXで動く
    // ため、毎フレーム再計算する(キーボードのようにリサイズ時だけの
    // 更新では追従できない)。
    const LEVER_PERSPECTIVE_D = 420;
    const camera = new THREE.PerspectiveCamera();
    camera.position.set(0, 0, LEVER_PERSPECTIVE_D);
    camera.lookAt(0, 0, 0);
    function updateLeverProjection() {
      const rect = leverMountEl.getBoundingClientRect();
      const anchorX = rect.left + rect.width / 2;
      const anchorY = rect.top + rect.height / 2;
      const W = window.innerWidth, H = window.innerHeight;
      const n = 1, far = 10000, focal = LEVER_PERSPECTIVE_D;
      const Aw = n * W / focal, Bw = Aw * (1 - 2 * anchorX / W);
      const right = (Aw + Bw) / 2, left = (Bw - Aw) / 2;
      const Ah = n * H / focal, Bh = -Ah * (1 - 2 * anchorY / H);
      const top = (Ah + Bh) / 2, bottom = (Bh - Ah) / 2;
      camera.near = n; camera.far = far;
      camera.projectionMatrix.makePerspective(left, right, top, bottom, n, far);
      camera.projectionMatrixInverse.copy(camera.projectionMatrix).invert();
    }

    function resizeLeverCanvas() {
      if (introRenderingStopped) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      renderer.setPixelRatio(dpr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    resizeLeverCanvas();
    listen(window, 'resize', resizeLeverCanvas);

    // ---- レバー本体のジオメトリ ----
    const SILVER_LEVER = { color: 0xb8bcc4, metalness: 0.95, roughness: 0.12, envMapIntensity: 1.3 };
    const BEND_EXTERIOR_DEG = 60; // 「^」「へ」の折れ角。外角60度=内角120度
    // #leverの高さ(leverLengthPx)は「改行時の振れ幅が1行ぶんの高さと
    // 一致する」ための、姿勢計算専用の値(=非表示のDOM側でだけ意味を持つ)
    // なので、見た目のサイズはそれと切り離し、キーとサイズ感が合うように
    // 別途大きめの値を直接指定する。
    const LEVER_VISUAL_LEN = 190;
    const LEVER_LINE_HALF_WIDTH = 14; // 線の太さ(半幅)
    const LEVER_THICKNESS = 15; // 立体化する際の厚み
    // カメラに近すぎて浮いて見えたため、奥(カメラの反対方向=-Z)へ
    // 大きく下げる。off-axisカメラは原点(0,0,*)がどのZでも同じ画面位置
    // に投影される仕組みなので、Zをずらしても画面上の位置は変わらず、
    // 距離が離れる分だけ奥まって・小さく見えるようになる。
    const LEVER_DEPTH_OFFSET = -220;

    // ---- シンプルな作り方 ----
    // 「^」やひらがな「へ」のような、2本の直線が120度(内角)で
    // 折れ曲がった1本の折れ線を描き、それに太さを持たせて1枚の平面
    // (2Dシェイプ)にし、最後にExtrudeGeometryで厚みを付けて立体化、
    // bevelEnabledで角を丸める。付け根とパドルを別々のメッシュとして
    // 組み立てて回転で継ぐ、というこれまでのやり方(継ぎ目のねじれや
    // 結合の失敗が起きやすかった)より単純で、そもそも継ぎ目が存在しない。
    function buildLeverMesh() {
      const L1 = LEVER_VISUAL_LEN * 0.55; // 付け根側の腕の長さ
      const L2 = LEVER_VISUAL_LEN * 0.45; // 先端側の腕の長さ
      const w = LEVER_LINE_HALF_WIDTH;

      // 付け根の腕は真上(ローカル+Y)に伸びる。これは#leverのCSS計算
      // (transform-origin: top center)と対応させるための基準方向。
      const baseAngle = Math.PI / 2;
      const tipAngle = baseAngle - THREE.MathUtils.degToRad(BEND_EXTERIOR_DEG); // 外角ぶん振る
      const baseDir = new THREE.Vector2(Math.cos(baseAngle), Math.sin(baseAngle));
      const tipDir = new THREE.Vector2(Math.cos(tipAngle), Math.sin(tipAngle));
      const basePerp = new THREE.Vector2(-baseDir.y, baseDir.x).multiplyScalar(w);
      const tipPerp = new THREE.Vector2(-tipDir.y, tipDir.x).multiplyScalar(w);

      const A = new THREE.Vector2(0, 0); // 付け根(ヒンジ)
      const B = A.clone().addScaledVector(baseDir, L1); // 折れ角
      const C = B.clone().addScaledVector(tipDir, L2); // 先端

      // 太さを持たせた「へ」形の輪郭を、内側は継ぎ目、外側も継ぎ目の
      // 8点でそのまま結ぶ(単純な形なので、ミター処理をしなくても
      // ベベル/サブディビジョンで十分なめらかになる)。
      const shape = new THREE.Shape();
      const pts = [
        A.clone().sub(basePerp),
        B.clone().sub(basePerp),
        B.clone().sub(tipPerp),
        C.clone().sub(tipPerp),
        C.clone().add(tipPerp),
        B.clone().add(tipPerp),
        B.clone().add(basePerp),
        A.clone().add(basePerp),
      ];
      shape.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) shape.lineTo(pts[i].x, pts[i].y);
      shape.closePath();

      const bevel = LEVER_THICKNESS * 0.3;
      let geo = new THREE.ExtrudeGeometry(shape, {
        depth: LEVER_THICKNESS - bevel * 2,
        bevelEnabled: true,
        bevelThickness: bevel,
        bevelSize: bevel,
        bevelSegments: 6,
        curveSegments: 8,
      });
      geo.translate(0, 0, bevel - LEVER_THICKNESS / 2); // 厚み方向をZ=0中心に揃える
      // 見た目の向き合わせのため、ここまでで形状自体をrotateZ→rotateYと
      // 90度ずつ回している。これは付け根の伸びる向き(元はローカル+Y)を
      // 実際には (0,1,0)→(-1,0,0)→(0,0,1) と動かしてしまっていた
      // (=syncLeverTransformが前提とする「付け根はローカル+Yを向く」
      // という条件が崩れていた)。横軸(X軸)まわりにさらに-90度回転
      // させることで、付け根の向きを元のLEVER_VEC_REST用の基準
      // ((0,1,0))へちょうど戻す。
      geo.rotateZ(Math.PI / 2);
      geo.rotateY(Math.PI / 2);
      geo.rotateX(-Math.PI / 2);

      if (subdivideLoop) {
        geo = subdivideLoop(geo, 1, { split: true, uvSmooth: false, preserveEdges: true, flatOnly: false });
      }

      const mat = new THREE.MeshStandardMaterial({ ...SILVER_LEVER, side: THREE.DoubleSide });
      return new THREE.Mesh(geo, mat);
    }

    let leverGroup = buildLeverMesh();
    leverGroup.position.z = LEVER_DEPTH_OFFSET;
    scene.add(leverGroup);

    // ---- 姿勢の同期(既存CSS計算をそのまま読み取る) ----
    // #leverの生の計算済みtransform(matrix3d)を毎フレーム読み取り、
    // そこからCSSのphi(rotateYの角度)・theta(rotateXの角度)を逆算する。
    // 単純に「Y軸を反転して行列を読み替える(共役変換)」だけでは、
    // CSSの(x=右+, y=下+, z=手前+)とThree.jsの(y=上+)が左手系/右手系
    // 逆転の関係にあるため正しく変換できず、実際に試すとバー全体の
    // 前後(z)が丸ごと反転する結果になった。φ(Y軸まわりの振り角)は
    // そのままで良いが、θ(X軸まわりの傾き。Y軸を含む)は「180°−θ」に
    // 置き換える必要がある(静止ベクトル(-2,-1,5)を代入して逆算し、
    // この変換で正しい向きになることを確認済み)。
    const m = new THREE.Matrix4();
    const quat = new THREE.Quaternion();
    function syncLeverTransform() {
      const str = getComputedStyle(leverEl).transform;
      if (!str || !str.startsWith('matrix3d')) return; // rotateX/Yを含む限り常にmatrix3d
      const a = str.slice(9, -1).split(',').map(Number);
      // M = RotateY(phi)*RotateX(theta) の成分から逆算(aは列優先)
      const thetaCss = Math.atan2(-a[9], a[5]);
      const phiCss = Math.atan2(-a[2], a[0]);
      const thetaThree = Math.PI - thetaCss;
      const phiThree = phiCss;
      const cf = Math.cos(phiThree), sf = Math.sin(phiThree);
      const ct = Math.cos(thetaThree), st = Math.sin(thetaThree);
      m.set(
        cf, sf * st, sf * ct, 0,
        0, ct, -st, 0,
        -sf, cf * st, cf * ct, 0,
        0, 0, 0, 1
      );
      quat.setFromRotationMatrix(m);
      leverGroup.quaternion.copy(quat);
    }

    function renderLever() {
      if (introRenderingStopped) return;
      updateLeverProjection();
      syncLeverTransform();
      renderer.render(scene, camera);
      raf(renderLever);
    }
    raf(renderLever);
  })();

  function applyHorizontalShift() {
    paperHEl.style.transform = 'translateX(' + (-currentLineWidth) + 'px)';
    // レバーは上下には動かず、紙とは別スケール(半分)で左右にだけ追従する
    leverMountEl.style.transform = 'translateX(' + (-currentLineWidth * LEVER_MOVE_SCALE) + 'px)';
  }
  function applyVerticalShift() {
    linesEl.style.transform = 'translateY(' + (-linesPassed * lineHeightPx) + 'px)';
  }

  function strikeChar(ch) {
    const span = document.createElement('span');
    span.className = 'ch';
    span.textContent = ch;
    span.style.setProperty('--ch-op', (0.9 + Math.random() * 0.1).toFixed(2));
    paperTextEl.appendChild(span);

    currentLineWidth += span.offsetWidth;
    applyHorizontalShift();

    paperInnerEl.classList.remove('jolt');
    void paperInnerEl.offsetWidth; // reflow でアニメーションを再起動
    paperInnerEl.classList.add('jolt');
  }

  // 改行の手順:
  // 0) 0.5秒のあいだ完全に静止(手をレバーへかけ替える「間」)
  // 1) 回転操作(レバーのベクトルのx成分が0になるまで回転。同時に文章が
  //    1行分上へ上がる)と、紙・レバーが横方向のデフォルト(右)位置へ
  //    戻る移動を同時に開始する。回転操作の方が早く終わって構わない。
  // 2) 両方が完了した後、レバーのベクトルが (-2, -1, 5) の静止姿勢へ戻る。
  const LINE_BREAK_HOLD_MS = 400;
  const ROTATE_RAISE_MS = 400;      // 回転操作 + 文章の線送り(#typewriter-lines の transition と同じ)
  const HORIZONTAL_RETURN_MS = 1380; // 横方向のデフォルト位置への移動(.paper-h / #lever-mount の transition と同じ)
  const ROTATE_RETURN_MS = 600;      // レバーが静止ベクトルへ戻る
  function lineBreak(onComplete) {
    later(() => {
      // 1) 回転操作 + 文章を上へ、と同時に横方向のデフォルト位置へ移動
      paperTextEl.appendChild(document.createElement('br'));
      linesPassed++;
      applyVerticalShift();
      leverEl.style.transitionDuration = ROTATE_RAISE_MS + 'ms';
      leverEl.style.transform = 'rotateY(' + LEVER_ACTIVE_PHI_DEG + 'deg) rotateX(' + LEVER_THETA_DEG + 'deg)';

      currentLineWidth = 0;
      applyHorizontalShift();

      // 両方のうち遅い方(横移動)が終わるのを待つ
      later(() => {
        // 2) レバーのベクトルが (-2, -1, 5) に戻る
        leverEl.style.transitionDuration = ROTATE_RETURN_MS + 'ms';
        leverEl.style.transform = 'rotateY(' + LEVER_REST_PHI_DEG + 'deg) rotateX(' + LEVER_THETA_DEG + 'deg)';

        later(() => { if (onComplete) onComplete(); }, ROTATE_RETURN_MS);
      }, Math.max(ROTATE_RAISE_MS, HORIZONTAL_RETURN_MS));
    }, LINE_BREAK_HOLD_MS);
  }

  function autoTypePreface(onDone) {
    let i = 0;
    function step() {
      if (i >= PREFACE_TEXT.length) {
        onDone();
        return;
      }
      const ch = PREFACE_TEXT[i];
      if (ch === '\n') {
        i++;
        lineBreak(() => {
          const delay = 64 + Math.random() * 92;
          later(step, delay);
        });
        return;
      }
      strikeChar(ch);
      // 前置きの自動タイプ中は、実際に打っている文字に対応するキーを
      // 沈み込ませるだけ(波紋なし)。以前はスペース以外何も反応せず、
      // スペースの度に波紋バーストだけが連発して見えていた不具合の修正。
      flashKey(keyEls[ch.toLowerCase()]);
      i++;
      const delay = 64 + Math.random() * 92;
      later(step, delay);
    }
    later(step, 260);
  }

  function revealEarthAndHandOff() {
    triggerEarthReveal();
    linesEl.style.transition = 'opacity 0.5s ease';
    linesEl.style.opacity = '0';
    keyboardViewport.style.opacity = '0';
    // ライトと文字盤(WebGLで描いているキー・波紋)も地球形成と同時に
    // 見えなくする。keyboardViewport.opacity=0はDOM(クリック判定・
    // 透明な文字)だけを消すため、見た目を実際に描いている
    // #keyboard-canvas/#ripple-canvasは別途フェードさせる必要がある。
    lampGlow.classList.remove('on'); // 既存のCSS transitionでフェードアウト
    keyboardCanvas.style.opacity = '0';
    rippleCanvas.style.opacity = '0';
    const leverCanvasEl = $('lever-canvas');
    if (leverCanvasEl) leverCanvasEl.style.transition = 'opacity 0.5s ease';
    if (leverCanvasEl) leverCanvasEl.style.opacity = '0';
    overlay.classList.add('hidden');
    // フェード(0.5s)が終わったら、見えなくなったイントロ用の描画ループとWebGLコンテキストを止めて解放する
    later(stopIntroRendering, 800);
  }

  function tryInput(rawLetter) {
    if (!interactiveEnabled) return;
    if (typedIndex >= TARGET_WORD.length) return;
    const letter = rawLetter.toLowerCase();
    const expected = TARGET_WORD[typedIndex].toLowerCase();
    if (letter !== expected) return;

    const keyEl = keyEls[letter];
    const rect = keyEl.getBoundingClientRect();
    const cx = rect.left + rect.width / 2, cy = rect.top + rect.height / 2;

    flashKey(keyEl);

    strikeChar(TARGET_WORD[typedIndex]);

    const isLast = typedIndex === TARGET_WORD.length - 1;
    if (letter !== ' ') {
      spawnRippleBurst(cx, cy);
    }
    typedIndex++;

    // "Hapworth"を1文字打つごとに、湖を少しずつ広げていく(LAKE_RADIUSまで)。
    // ここではまだ全球化のタイマーは開始しない。続く" Lake"の間はこの
    // 大きさのまま静止し、最後の"e"を打った瞬間(isLast)にrevealEarthAndHandOff
    // 経由でtriggerEarthReveal()が発火し、そこから波紋を伴う全球化が始まる。
    if (typedIndex <= LAKE_GROW_WORD_LEN) {
      lakeGrowTarget = typedIndex / LAKE_GROW_WORD_LEN;
    }

    // "Lake"の"L","a","k"(=eの直前までの3段階)を打つたびに、湖面に
    // その場でリング状の波紋を1発ずつ発生させる(lakeImpulseTimesの
    // 対応スロットに発火時刻を記録するだけ。減衰込みの実描画は
    // シェーダ/JSフォールバック側でlakeImpulseTimesを参照して行う)。
    const slotInLakeWord = (typedIndex - 1) - LAKE_WORD_START_IDX;
    if (slotInLakeWord >= 0 && slotInLakeWord < LAKE_STRIKE_SLOTS) {
      lakeImpulseTimes[slotInLakeWord] = currentElapsed;
    }

    // eの波紋(全球化の波紋)は#intro-overlayよりも前面(z-index)に描画
    // されるため、フェードアウトの完了を待たずに直ちに次へ進めてよい。
    if (isLast) {
      revealEarthAndHandOff();
    }
  }

  listen(window, 'keydown', (e) => {
    if (e.key.length === 1) tryInput(e.key);
  });

  // ---- ライト点灯: 暗闇から一気に文字盤が浮かび上がる ----
  // 卓上ライトが上から照らしているように見せるため、#lamp-glowの位置と
  // サイズは紙ではなくキーボード(#keyboard-rows)の実測範囲を基準にする。
  // キーの側もCSS側でほぼ真っ黒(光がなければ見えない)にしてあるため、
  // キーボードは実質この光だけで浮かび上がる形になる。ウィンドウリサイズ
  // でレイアウトが変わった場合も追従する。
  const darkVeil = $('dark-veil');
  const lampGlow = $('lamp-glow');
  function positionLampGlow() {
    const k = keyboardRows.getBoundingClientRect();
    const cx = k.left + k.width / 2;
    const cy = k.top + k.height / 2;
    // 卓上ライトの光だまりらしく、キーボード本体よりも一回り大きい
    // 楕円にする(端はふわっと消え、キーボードの外周は影に沈む)
    const w = Math.max(60, k.width * 1.55);
    const h = Math.max(60, k.height * 1.65);
    lampGlow.style.left = cx + 'px';
    lampGlow.style.top = cy + 'px';
    lampGlow.style.width = w + 'px';
    lampGlow.style.height = h + 'px';
  }
  positionLampGlow();
  listen(window, 'resize', positionLampGlow);
  later(() => {
    positionLampGlow();
    lampGlow.classList.add('on');
    darkVeil.classList.add('lit');
  }, 200);

  autoTypePreface(() => { interactiveEnabled = true; });
}

// ----------------------------------------------------
// 起動
// ----------------------------------------------------
(async function start() {
  try {
    const ok = await tryInitWebGPU();
    if (!ok && !isDisposed()) fail();
  } catch (err) {
    if (isDisposed()) return; // 戻るボタンで閉じた後のエラーは無視
    console.warn('WebGPU init failed:', err);
    fail();
  }
})();
initTypewriter();
}