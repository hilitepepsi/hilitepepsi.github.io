// ── キャプション/引用文まわり ──────────────────────────
// 数式組み立て演出(phase1.js)・フィナーレ(finale.js)に同期して画面に表示する
// セリフ・ワンフレーズ・公案のDOM生成とフェード制御。THREEのシーンには一切触れない、UI専用の層
// (ただしupdateKoanScreenPositionだけは、3D空間上の固定点をスクリーンpxへ投影する都合上cameraを受け取る)。

// ── 星の収束(ψが形作られていく間)に同期して表示するセリフ(画面右) ────────
const CONVERGENCE_QUOTES = ['Out of this quietness, and entirely in key with it, Seymour called to me.','It came as a pleasant shock that there was a third person in the universe,','and to this feeling was added the justness of its being too.',
'With the canopy lights behind him, his face was shadowed, dimmed out.',{text: 'From the way he was balanced on the curb edge, from the position of his hands, from — well,', duration: 8},{ text:'the quantity x itself,', duration: 5 },{ text:'I knew as well then as I know now that he was immensely conscious himself of the magic hour of the day.', duration: 13,},' '
];
const CONVERGENCE_QUOTE_INTERVAL = 6.0; // デフォルトの表示間隔(秒)。個別に変えたい場合は下記参照。

// ── Ĥが軸を歩いている間(⑴〜⑷)に同期して表示するセリフ(画面左、psi側と対称) ──
// 仮のプレースホルダー。実際に出したいセリフに差し替えてください。
const HAMILTONIAN_QUOTES = ['What I’m mainly trying to do here, though, is to find the firmest way of suggesting that', 'this curious footlight-and-three-ring heritage has been an almost ubiquitous','and entirely significant reality in the lives of all seven children in our family.',
];
const HAMILTONIAN_QUOTE_INTERVAL = 7;

// ── 数式の「上」に一時的に出すワンフレーズ用の共通位置 ──────────────────
// 「方程式の上で重ならないところ」に固定する: leftPercent=50で画面を左右50%ずつに
// 分けた中央(数式自体も画面中央に来るので、水平方向はそれと軸を揃える)、
// topPercentは画面上寄り(数式より上)にして重なりを避ける。仮値、実際の見た目を見て調整してください。
const TOP_PHRASE_POSITION = { leftPercent: 50, topPercent: 15 };

function showTopPhrase(caption, text, durationSeconds, source) {
  if (!text) return;
  caption.setPosition(TOP_PHRASE_POSITION.leftPercent, TOP_PHRASE_POSITION.topPercent);
  caption.setText(text);
  const sourceCaption = source ? getSourceCaption() : null;
  if (sourceCaption) sourceCaption.setText(source);
  setTimeout(() => {
    caption.hide();
    if (sourceCaption) sourceCaption.hide();
  }, durationSeconds * 1000);
}

// ── ①(iħ∂ψ/∂t=Ĥψ)完成と同時に、数式の上へ10秒だけ表示するワンフレーズ ──
// 仮のプレースホルダー。実際に出したいフレーズに差し替えてください。
const EQUATION_COMPLETE_PHRASE = 'It’s “If a body meet a body coming through the rye”!';
const EQUATION_COMPLETE_PHRASE_DURATION = 10;

// ── Phase3: ②へ向かう途中、hbarが上昇し始める(h/2πへ姿を変え始める)前に
// 3秒だけ表示するワンフレーズ ──
const WEAR_IT_AWHILE_PHRASE = 'You can wear it a while.';
const WEAR_IT_AWHILE_DURATION = 3;

// ── 出典表示(画面右下、#axisHint〈左上〉と対になる位置) ──────────────
// セリフ本体(caption)と同期して「著者名 — 作品名」を右下に薄く表示する。
// 見た目は#axisHint(index.htmlの「What is the sound of the universe?」)と
// 揃えたPlayfair Displayのイタリック体。アプリ内で唯一のインスタンスを
// 使い回す想定(convergence/hamiltonian/finaleいずれも同じ右下の位置に出すだけなので、
// 呼び出し側ごとに別要素を持つ必要がない)。
export function createSourceBox() {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.right = '20px';
  el.style.bottom = '18px';
  el.style.maxWidth = '360px';
  el.style.padding = '0';
  el.style.background = 'none';
  el.style.border = 'none';
  el.style.boxShadow = 'none';
  el.style.color = '#cfeeff';
  el.style.fontFamily = "'Playfair Display', 'Times New Roman', serif";
  el.style.fontStyle = 'italic';
  el.style.fontWeight = '500';
  el.style.fontSize = '14px';
  el.style.lineHeight = '1.5';
  el.style.textAlign = 'right';
  el.style.letterSpacing = '0.03em';
  el.style.textShadow = '0 0 10px rgba(140, 195, 255, 0.5), 0 1px 3px rgba(0, 0, 0, 0.85)';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  el.style.transition = 'opacity 0.7s ease';
  el.style.whiteSpace = 'nowrap';
  el.style.userSelect = 'none';
  el.style.zIndex = '1000';
  document.body.appendChild(el);
  return el;
}

let sharedSourceCaption = null;
// アプリ全体で1個だけ生成して使い回す(初回呼び出し時に遅延生成)。
export function getSourceCaption() {
  if (!sharedSourceCaption) {
    sharedSourceCaption = makeCaptionController(createSourceBox());
  }
  return sharedSourceCaption;
}

// leftPercent/topPercent: 画面に対する%位置(CSSのleft/topにそのまま使う)。
// psi用は右(75%)、ham用は左(25%)というように、呼び出し側で対称に配置する。
// noWrap: trueにすると、maxWidthによる折り返しを起こさず常に1行で表示する
// (長い引用文でも意図せず改行されてしまう場合に使う)。
export function createCaptionBox({ leftPercent = 75, topPercent = 50, noWrap = false } = {}) {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.left = `${leftPercent}%`;
  el.style.top = `${topPercent}%`;
  el.style.transform = 'translate(-50%, -50%)';
  el.style.maxWidth = noWrap ? 'none' : '520px';
  el.style.padding = '0';
  el.style.background = 'none';
  el.style.border = 'none';
  el.style.boxShadow = 'none';
  el.style.color = '#eef7ff';
  el.style.fontFamily = "'Cormorant Garamond', 'Times New Roman', serif";
  el.style.fontStyle = 'italic';
  el.style.fontWeight = '500';
  el.style.fontSize = '23px';
  el.style.lineHeight = '1.7';
  el.style.textAlign = 'center';
  el.style.letterSpacing = '0.01em';
  el.style.textShadow = '0 0 14px rgba(140, 195, 255, 0.65), 0 1px 3px rgba(0, 0, 0, 0.85)';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  el.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
  el.style.whiteSpace = noWrap ? 'nowrap' : 'pre-line'; // noWrap時は明示的な\nも含めて折り返さず1行にする
  el.style.userSelect = 'none';
  el.style.zIndex = '1000';
  document.body.appendChild(el);
  return el;
}

export function makeCaptionController(el) {
  const FADE_DURATION_MS = 700;
  let currentText = '';
  let pendingTimer = null;

  function applyNewText(text) {
    currentText = text;
    el.textContent = text;
    if (text.length > 0) {
      requestAnimationFrame(() => { el.style.opacity = '1'; });
    }
  }

  function setText(text) {
    if (text === currentText) return;
    if (pendingTimer) {
      clearTimeout(pendingTimer);
      pendingTimer = null;
    }
    const hadContent = currentText.length > 0;
    if (hadContent) {
      el.style.opacity = '0';
      pendingTimer = setTimeout(() => {
        pendingTimer = null;
        applyNewText(text);
      }, FADE_DURATION_MS);
    } else {
      applyNewText(text);
    }
  }

  function hide() { setText(''); }

  // 動的に配置し直したいキャプション(=完成フレーズ用)のためのポジション変更。
  // テキストの表示状態には触れない(位置だけ動かす)。
  function setPosition(leftPercent, topPercent) {
    el.style.left = `${leftPercent}%`;
    el.style.top = `${topPercent}%`;
  }

  return { setText, hide, setPosition };
}

// ── フィナーレの公案(KOAN_TEXT)専用のDOM要素(finale.jsから移植) ──────
// createCaptionBoxとの違い: 3D空間上の固定点(finale.jsのkoanAnchor)への投影位置に
// 追従させるため、left/topは%ではなく呼び出し側(updateKoanScreenPosition)がpxで
// 毎フレーム書き換える前提。フォントは引用の2倍サイズ・white-space: preで
// (\n以外では絶対に折り返さない。pre-lineだと幅次第で余計な位置で折り返るため)。
export function createKoanBox() {
  const el = document.createElement('div');
  el.style.position = 'fixed';
  el.style.left = '0px';
  el.style.top = '0px';
  el.style.transform = 'translate(-50%, -100%) translateY(-8px)'; // アンカー点の少し上に文字を配置
  el.style.maxWidth = 'none'; // pre指定と合わせて、幅による自動折り返しを起こさせない
  el.style.padding = '0';
  el.style.background = 'none';
  el.style.border = 'none';
  el.style.boxShadow = 'none';
  el.style.color = '#eef7ff';
  el.style.fontFamily = "'Cormorant Garamond', 'Times New Roman', serif";
  el.style.fontStyle = 'italic';
  el.style.fontWeight = '500';
  el.style.fontSize = '30px'; // createCaptionBox(23px)よりひと回り大きく
  el.style.lineHeight = '1.6';
  el.style.textAlign = 'center';
  el.style.letterSpacing = '0.01em';
  el.style.textShadow = '0 0 14px rgba(140, 195, 255, 0.65), 0 1px 3px rgba(0, 0, 0, 0.85)';
  el.style.opacity = '0';
  el.style.pointerEvents = 'none';
  el.style.transition = 'opacity 0.7s ease, transform 0.7s ease';
  el.style.whiteSpace = 'pre'; // \n以外では絶対に折り返さない(pre-lineだと幅次第で余計な位置で折り返るため)
  el.style.userSelect = 'none';
  el.style.zIndex = '1000';
  document.body.appendChild(el);
  return el;
}

// koanAnchor(THREE.Object3Dなど、.positionを持つもの)のワールド座標を、毎フレーム
// 画面px位置へ投影してkoanElのleft/topに反映する。カメラの後ろに回り込んだら
// display:noneで隠す。呼び出し側(finale.js)のレンダーループ相当のタイミングで
// 毎フレーム呼ぶ想定(camera.matrixWorldは呼び出し側で最新化されている前提)。
export function updateKoanScreenPosition(koanEl, koanAnchor, camera) {
  const ndc = koanAnchor.position.clone().project(camera);
  const behindCamera = ndc.z > 1; // カメラの後ろに回り込んだら消す
  koanEl.style.display = behindCamera ? 'none' : 'block';
  const x = (ndc.x * 0.5 + 0.5) * window.innerWidth;
  const y = (-ndc.y * 0.5 + 0.5) * window.innerHeight;
  koanEl.style.left = `${x}px`;
  koanEl.style.top = `${y}px`;
}

// ── 汎用: セリフを順番に表示していくコントローラー ──────────────────
// quotes: 文字列の配列、または {text, duration} オブジェクトの配列。
//   文字列だけならdefaultDuration(秒)で一定間隔表示(従来通りの挙動)。
//   {text, duration}にすれば、セリフごとに表示時間を個別に変えられる
//   (例: [{ text: '短いセリフ', duration: 3 }, { text: '長めのセリフ...', duration: 9 }])。
// source: 指定すると、セリフの表示に同期して右下の出典ボックス(getSourceCaption())にも
// 「著者名 — 作品名」を出す(セリフが空文字/最後まで表示し終わったら一緒に消す)。
function startQuoteSequence(caption, quotes, { defaultDuration = 7.0, source } = {}) {
  if (!quotes || quotes.length === 0) return { stop: () => {} };

  const normalized = quotes.map((q) =>
    typeof q === 'string'
      ? { text: q, duration: defaultDuration }
      : { text: q.text, duration: q.duration ?? defaultDuration }
  );

  const sourceCaption = source ? getSourceCaption() : null;

  let idx = 0;
  let timer = null;
  let stopped = false;

  function showNext() {
    if (stopped || idx >= normalized.length) return;
    const { text, duration } = normalized[idx];
    caption.setText(text);
    if (sourceCaption) {
      if (text) sourceCaption.setText(source);
      else sourceCaption.hide();
    }
    idx++;
    if (idx < normalized.length) {
      timer = setTimeout(showNext, duration * 1000);
    }
  }
  showNext();

  function stop() {
    stopped = true;
    if (timer) { clearTimeout(timer); timer = null; }
    caption.hide();
    if (sourceCaption) sourceCaption.hide();
  }
  return { stop };
}

// ── 出典(著者はすべてJ.D. Salingerで固定。作品名だけが変わる) ──────────
const SALINGER_SEYMOUR = 'J.D. Salinger — Seymour: an Introduction';

export function startConvergenceCaption(caption) {
  return startQuoteSequence(caption, CONVERGENCE_QUOTES, {
    defaultDuration: CONVERGENCE_QUOTE_INTERVAL,
    source: SALINGER_SEYMOUR,
  });
}

export function startHamiltonianCaption(caption) {
  return startQuoteSequence(caption, HAMILTONIAN_QUOTES, {
    defaultDuration: HAMILTONIAN_QUOTE_INTERVAL,
    source: SALINGER_SEYMOUR,
  });
}

// ①完成の瞬間、数式の上にワンフレーズを表示し、10秒後に消す。
// ★2026-08-16 修正: 以前はanchorWorld(数式付近のワールド座標)をworldToScreenPercentで
// 画面%へ投影して配置していたが、その投影先は数式の位置に依存するため必ずしも
// 画面中央にはならず、「セリフが中央でない」というフィードバックがあった。
// ここでは単純に画面上の固定位置(TOP_PHRASE_POSITION)へ置く(anchorWorld/cameraは使わない)。
// ★2026-08-16 再修正: 位置を画面中央(50,50)から、数式と重ならない上部
// (TOP_PHRASE_POSITION)へ変更。以降に追加したWEAR_IT_AWHILE_PHRASEと同じ仕様に揃えた。
// 出典: この2つのワンフレーズはどちらもThe Catcher in the Rye
const SALINGER_CATCHER = 'J.D. Salinger — The Catcher in the Rye';

export function showEquationCompletePhrase(caption) {
  showTopPhrase(caption, EQUATION_COMPLETE_PHRASE, EQUATION_COMPLETE_PHRASE_DURATION, SALINGER_CATCHER);
}

// Phase3の②(i(h/2π))へ向かう途中、hbarが上昇を始める前に3秒だけ表示するワンフレーズ。
// showEquationCompletePhraseと同じ「数式の上・重ならない位置」に出す。
export function showWearItAWhilePhrase(caption) {
  showTopPhrase(caption, WEAR_IT_AWHILE_PHRASE, WEAR_IT_AWHILE_DURATION, SALINGER_CATCHER);
}