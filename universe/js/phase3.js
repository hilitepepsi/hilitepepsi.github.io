import * as THREE from 'three';
import { computeScreenFrame } from './screenFrame.js';
import { showWearItAWhilePhrase } from './captions.js';
import {
  SYMBOL_ASSETS,
  EQUATION_SCALE,
  CROP_TO_MASTER_SCALE,
  MASTER_BBOX,
  BASELINE_MASTER_Y,
  contentCenterPx,
} from './symbolAssets.js';

// ════════════════════════════════════════════════════════════════
// ── Phase 3: iħ項の②③④ 差し替え(schrodinger-sequence-timeline.md 参照) ──
// ════════════════════════════════════════════════════════════════
//
// ①(iħ、Phase1で完成済み) → ②i(h/2π) → ③i(h/Carousel) → ④(iがhに乗ったもの)/Carousel
//
// ①の「i」はどの段階でも位置が変わらない…わけではなく、②③④と進むにつれて実際は左へ
// 移動していく(実測して判明)。①の「ħ」(=assembly.sprites.hbar)も同様に、まず左へ
// 移動してから上昇してhへ変化する。
//
// 配置はすべて「=」記号を共通の原点とした絶対座標(マスター画像換算px)で管理する。
// 3枚の完成equation画像(2pi-equation.png/carousel.png/final.png)はそれぞれ縮尺が違う
// (PHASE3_IMAGE_SCALE参照)ので、各画像内の「=」の実測位置を基準に、
// (raw - その画像のequals中心)/その画像のscale + マスターのequals中心
// という変換で、全ステージを同じ「マスター座標」に正規化している。
// こうすることで、Phase1のi・ħの静止位置(MASTER_BBOX.i/hbarから直接計算できる)と、
// ②③④での位置を同じ物差しで比較・補間できる。

// PHASE3_ASSETS: 5アセット構成(合成グリフではなく、i・hを個別スプライトのまま
// 重ねて表示する方式。詳細はtransitionToStage4のコメント参照)。
// ── 2026-08-16 再計測: 元画像(2pi.png/carousel_equation.png/final.png)から
// 白文字・透過背景で切り抜き直したため、canvas(切り抜きPNGのピクセルサイズ)を
// 実測値に更新した。以前の値は元画像が失われる前の暫定値。
export const PHASE3_ASSETS = {
  h2:        { url: new URL('./data/eq/h_v2.png', import.meta.url).href,          canvas: [813, 1089] },
  twoPi:     { url: new URL('./data/eq/twopi.png', import.meta.url).href,          canvas: [1552, 1053] },
  barTwoPi:  { url: new URL('./data/eq/bar_2pi.png', import.meta.url).href,        canvas: [1712, 182] },
  carousel:  { url: new URL('./data/eq/carousel_word.png', import.meta.url).href,  canvas: [2658, 579] },
  barWide:   { url: new URL('./data/eq/bar_carousel.png', import.meta.url).href,   canvas: [2905, 172] },
};

// 元画像1pxをワールド空間で何ユニットにするか(Phase1のEQUATION_SCALEをそのまま流用)。
export const PHASE3_SCALE = EQUATION_SCALE;

// ── 実測スケール補正(重要) ──────────────────────────
// 今回渡された3枚の完成equation画像(2pi-equation.png/carousel.png/final.png)は、
// いずれも8000px幅だが、実際にはそれぞれ独自の縮小率でレイアウトされていることが
// 実測でわかった(carousel.pngは「Carousel」という長い単語が入る分、equation全体が
// 縮小されている、など)。
//
// これを補正するため、全ステージ・Phase1と共通で「絵柄も位置も変化しない」要素である
// ∂ψ/∂t(derivative)のバウンディングボックスを各画像で実測し、Phase1のMASTER_BBOX.derivative
// (=1855×3094px、マスター画像上での実測値)と比較して、画像ごとのスケール係数を求めた。
//
//   stage2 (2pi.png):              ∂ψ/∂t実測 1622×2710px → 1855×3094比で 0.8751倍
//   stage3 (carousel_equation.png): ∂ψ/∂t実測 1355×2266px → 同 0.7314倍
//   stage4 (final.png):            ∂ψ/∂t実測 1440×2406px → 同 0.7770倍
// (2026-08-16: 元画像から再計測した値に更新。連結成分検出による自動計測で、
//  幅比・高比の誤差はいずれも0.2%未満で一致している)
const PHASE3_IMAGE_SCALE = {
  stage2: 0.8751,
  stage3: 0.7314,
  stage4: 0.7770,
};

// PHASE3_ASSETSの各キーが、どのステージ画像から切り出されたか
// (=どのPHASE3_IMAGE_SCALEで補正すべきか)のマップ。
// carousel/barWideはstage4(final.png)でも再利用するが、切り出し元はstage3(carousel.png)。
const PHASE3_ASSET_SOURCE_STAGE = {
  h2: 'stage2',
  twoPi: 'stage2',
  barTwoPi: 'stage2',
  carousel: 'stage3',
  barWide: 'stage3',
};

// 元画像固有のpx値を、「マスター画像(S_equation-1.png)換算のpx値」に変換する。
function toMasterPx(px, stageKey) {
  return px / PHASE3_IMAGE_SCALE[stageKey];
}

export function phase3SymbolWorldSize(key) {
  const asset = PHASE3_ASSETS[key];
  const stageKey = PHASE3_ASSET_SOURCE_STAGE[key];
  return {
    width: toMasterPx(asset.canvas[0], stageKey) * PHASE3_SCALE,
    height: toMasterPx(asset.canvas[1], stageKey) * PHASE3_SCALE,
  };
}

// BAR_WIDTH_PX(元画像pxでの"インク"だけの幅)を、そのバーの見た目の全長が
// 正しくその幅になるようワールド幅に変換する。
//
// ★2026-08-16 修正: 切り出したPNG(barTwoPi/barWide)は、インクの周囲に
// 余白(パディング)を持たせてクロップしている。THREE.Spriteのscale.xは
// キャンバス全体(余白込み)の幅に対応するため、単純に
// toMasterPx(widthPx)*PHASE3_SCALE をscale.xへ入れると、
// 「インク部分の見た目の幅」が意図した長さより
// (widthPx / canvas幅)倍だけ短くなってしまっていた
// (carousel用バーで実測: 2505/2905 ≈ 86%の長さしかなかった)。
// キャンバス幅とインク幅の比率で逆補正し、インク部分が正しい長さになるようにする。
function fractionBarWorldWidth(widthPx, stageKey, assetKey) {
  const canvasPx = PHASE3_ASSETS[assetKey].canvas[0];
  const targetInkWorldWidth = toMasterPx(widthPx, stageKey) * PHASE3_SCALE;
  return targetInkWorldWidth * (canvasPx / widthPx);
}

// バーの実測幅(元画像px、各ステージ画像内で直接計測)。
const BAR_WIDTH_PX = {
  stage2: 1412, // 2pi.png実測(2026-08-16再計測)
  stage3: 2505, // carousel_equation.png実測(2026-08-16再計測)
  stage4: 2661, // final.png実測(2026-08-16再計測)
};

// ── バー高さの微調整(手動) ──────────────────────────
// (2026-08-16: 「=」基準点の補正後も、carousel側(stage3/4)のバーがderivativeより
//  わずかに高く見える、とのフィードバック。計測上は誤差1px未満で原因を特定できず、
//  EQUATION_SCALE/CROP_TO_MASTER_SCALEが「仮」の近似値であることに起因する残差と思われる。
//  マイナス値でバーを下げる。ワールド単位。見た目を見ながら微調整してください。)
const STAGE_BAR_Y_NUDGE = {
  stage2: 0,
  stage3: 0, // 仮。まだ高く見えるなら -0.005 刻みくらいで試してください
  stage4: 0,
};

// ── 「=」を共通原点とした絶対座標系 ──────────────────────
// マスター画像上での「=」中心(=Phase1のBASELINE_MASTER_Y・baselineMasterXそのもの)。
const EQUALS_MASTER = {
  x: contentCenterPx(MASTER_BBOX.equals.bbox).x, // 4619.5
  y: BASELINE_MASTER_Y,                          // 1770.5
};

// 各equation画像内で実測した「=」の中心(px、その画像自身の座標系)。
const STAGE_EQUALS_RAW = {
  stage2: { x: 4932.5, y: 1672.0 }, // 2pi.png実測(2026-08-16再計測)
  stage3: { x: 5497.5, y: 1448.0 }, // carousel_equation.png実測(2026-08-16再計測)
  stage4: { x: 5339.5, y: 1538.0 }, // final.png実測(2026-08-16再計測)
};

// 各ステージ画像内で実測した各パーツの中心(px、その画像自身の座標系、Y下向き)。
// (2026-08-16: 元画像から再計測した値に更新。連結成分検出による自動計測)
const STAGE_RAW_CENTERS = {
  stage2: { // i (h/2π) ← 2pi.png実測
    i:     { x: 285.5,  y: 1575.5 },
    h:     { x: 1374.5, y: 680.5 },
    bar:   { x: 1358.0, y: 1672.0 },
    denom: { x: 1372.0, y: 2457.5 }, // 2π
  },
  stage3: { // i (h/Carousel) ← carousel_equation.png実測
    i:     { x: 288.5,  y: 1367.0 },
    h:     { x: 1861.0, y: 619.0 },
    bar:   { x: 1847.5, y: 1448.0 },
    denom: { x: 1851.0, y: 1923.5 }, // Carousel
  },
  stage4: { // (iがhに乗ったもの)/Carousel ← final.png実測
    // 2026-08-16 再々測(重要な修正): 以前は「iとhの合成」を1個のバウンディング
    // ボックスとして1点だけ実測した値を使っていた。これをiとhの共通の
    // 着地点として使うと、hの着地位置とiの着地位置の違い(=iが実際にどれだけ
    // 移動してhに飛び乗るか)が完全に無視されてしまい、iの飛び乗り位置が
    // おかしく見える原因になっていた。
    // final.pngを2値化してconnected componentを抽出すると、iのループ(ドット無し、
    // 上部の渦巻き)とhの本体(アセンダー+ボウル)は実際にはインクが繋がっておらず
    // 別々の連結成分として分離できる(2026-08-16 実測で確認)。そこでstage3と同じ
    // 「bbox中心」方式で、hとiそれぞれの実測値を個別に持つようにした。
    //   h実測bbox: x[1307,1868] y[575,1381] → 中心(1587.5, 978.0)
    //   i実測bbox: x[1608,1909] y[310,831]  → 中心(1758.5, 570.5)
    h: { x: 1587.5, y: 978.0 },
    i: { x: 1758.5, y: 570.5 },
    bar:    { x: 1462.5, y: 1537.5 },
    denom:  { x: 1466.5, y: 2044.0 }, // Carousel
  },
};

// stageKey内のraw px中心を、マスター座標(px)へ変換する。
// (raw - そのステージのequals中心) / そのステージのscale + マスターのequals中心
function stageCenterToMasterPx(stageKey, partKey) {
  const raw = STAGE_RAW_CENTERS[stageKey][partKey];
  const eq = STAGE_EQUALS_RAW[stageKey];
  const scale = PHASE3_IMAGE_SCALE[stageKey];
  return {
    x: (raw.x - eq.x) / scale + EQUALS_MASTER.x,
    y: (raw.y - eq.y) / scale + EQUALS_MASTER.y,
  };
}

// マスター座標(px、Y下向き)を、frame基準のワールド座標へ変換する。
// (symbolWorldX/Yと同じ変換規則: 「=」原点からの相対距離 × EQUATION_SCALE、Yは符号反転)
function masterPxToWorld(masterPt, vertexWorld, frame) {
  const dx = (masterPt.x - EQUALS_MASTER.x) * EQUATION_SCALE;
  const dy = -(masterPt.y - EQUALS_MASTER.y) * EQUATION_SCALE;
  return vertexWorld.clone().addScaledVector(frame.right, dx).addScaledVector(frame.up, dy);
}

// stageKey内のpartKeyのワールド座標を直接返す(上2つの合成、一番よく使う)。
function stagePartWorld(stageKey, partKey, vertexWorld, frame) {
  const pos = masterPxToWorld(stageCenterToMasterPx(stageKey, partKey), vertexWorld, frame);
  // バーのみ、見た目の微調整用にY方向へ追加オフセットをかけられるようにする。
  if (partKey === 'bar') {
    const nudge = STAGE_BAR_Y_NUDGE[stageKey] || 0;
    if (nudge) pos.addScaledVector(frame.up, nudge);
  }
  return pos;
}

// ワールド座標 ⇔ frame基準ローカルオフセット(rx, ry)の相互変換。
// 「xだけ動かして、yは今の値のまま」のような軸別アニメーションに使う。
function worldToLocalOffset(pos, vertexWorld, frame) {
  const rel = pos.clone().sub(vertexWorld);
  return { rx: rel.dot(frame.right), ry: rel.dot(frame.up) };
}
function localOffsetToWorld(rx, ry, vertexWorld, frame) {
  return vertexWorld.clone().addScaledVector(frame.right, rx).addScaledVector(frame.up, ry);
}

// Ĥ・ħ・iなど他の記号と同じ白トーンに揃える(phase1.js側のSYMBOL_COLOR_OVERRIDES.hbarと同値)。
const PHASE3_COLOR = 0xffffff;

// HBARの上線(バー)が外れて分数の横線として現れる瞬間だけ使う、一時的な赤フラッシュ色。
// ★重要: 通常のsRGB色(0〜1に収まる値)はUnrealBloomPassの輝度しきい値(TUNE.bloomThreshold)
// を超えないため、いくら赤くしても「色は変わるが発光(Bloom)はしない」状態になる
// (このシーンのBloomは、しきい値を超えた明るいピクセルだけを抽出して滲ませる方式のため)。
// 確実にBloomへ乗せるには、白熱電球のように輝度を1.0より大きくした「HDR色」にする必要がある。
// r成分を大きく超過させ、g/bはわずかに残して「白飛びした赤」ではなく「赤い発光」に見えるようにする。
// ★調整: 当初(3.2, 0.15, 0.15)にしていたが、白っぽく/ピンクっぽく見えるとの指摘。
//   原因は2つ考えられる: ①g/bをわずかに残すと、その分だけ確実に赤の純度(彩度)が下がる
//   (発光してもしなくても常に赤味が薄まる方向)。②HDRの超過量(r=3.2)が大きすぎると、
//   ACESFilmicToneMapping(sceneSetup.js側で設定)は明るい領域ほど彩度を落として
//   白へ寄せる特性があるため、明るくするほど逆に赤が薄まり白く見えてしまう。
//   → g/bを0にして純度を最大化しつつ、rの超過量も抑えて(Bloomの閾値さえ超えれば
//   光るはずなので)トーンマッピングの白飛び域に入らないようにした。
//   まだ白っぽい場合は、このrをさらに下げる方向で試してほしい(下げても発光自体は
//   閾値さえ超えていれば消えない。上げるほど逆に白く/ピンクに寄っていく)。
const BAR_DETACH_FLASH_COLOR = new THREE.Color(5.4, 0, 0);
// 通常時の白(0xffffff = r,g,b各1.0)。バー本体が普段まとっている明るさに戻すための着地点。
const PHASE3_COLOR_NORMALIZED = new THREE.Color(PHASE3_COLOR);

// hbar.png内の「横棒(マクロン)」部分の実測ピクセル座標(画像原寸そのもの、y=0が画像上端)。
// アルファ値を閾値10で二値化し、行ごとの横幅プロファイルから「周囲の縦棒(幅約124px)より
// 局所的に幅広い(576〜594px)帯」として検出・目視確認済み(赤枠オーバーレイで確認)。
const HBAR_BAR_PIXEL_BOX = { x0: 107, x1: 701, y0: 238, y1: 296 };

// hbarSpriteの子として、横棒だけを切り出して重ねる「発光専用オーバーレイ」を作る。
// ★ 方式変更: 以前は「切り出した矩形をhbarSpriteのローカル単位空間(-0.5〜0.5)上の
//   どこに置くか」を自前で計算していたが、hbarSpriteのsprite.centerが場面によって
//   (0.5,0.5)以外になる区間があったり等、前提が崩れるとズレる壊れやすい方式だった。
//   今回は、hbar.png(既にブラウザに読み込み済みのImage)からcanvasでバー部分だけを
//   切り抜いた「元画像と同じキャンバスサイズ・同じ位置」の透過テクスチャを作り、
//   hbarSprite自身と全く同じcenterを持つ子として、position=(0,0,*)・scale=(1,1,1)の
//   まま(=一切座標計算せず)重ねる。キャンバスサイズが同じなので、hbarSpriteの
//   scale/position/centerがどんな値であっても、子は常にhbarSprite本体とピクセル単位で
//   完全に重なる(新しい画像アセットの追加も不要)。
function ensureHbarBarGlowOverlay(hbarSprite) {
  if (hbarSprite.userData.barGlowOverlay) return hbarSprite.userData.barGlowOverlay;

  const map = hbarSprite.material.map;
  const img = map.image;
  if (!img || !img.complete || !img.naturalWidth) {
    console.warn('ensureHbarBarGlowOverlay: hbar.pngがまだ読み込み中です。Phase3開始時点では読み込み済みのはずなので、呼び出しタイミングを確認してください。');
  }
  const imgW = img.naturalWidth;
  const imgH = img.naturalHeight;
  const { x0, x1, y0, y1 } = HBAR_BAR_PIXEL_BOX;

  // 元画像と同じサイズの透過canvasを作り、バーの矩形部分「だけ」同じ位置に描き写す。
  const canvas = document.createElement('canvas');
  canvas.width = imgW;
  canvas.height = imgH;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(img, x0, y0, x1 - x0, y1 - y0, x0, y0, x1 - x0, y1 - y0);

  const barTexture = new THREE.CanvasTexture(canvas);
  barTexture.colorSpace = THREE.SRGBColorSpace;
  barTexture.generateMipmaps = false;
  barTexture.minFilter = THREE.LinearFilter;
  barTexture.magFilter = THREE.LinearFilter;

  const overlay = new THREE.Sprite(new THREE.SpriteMaterial({
    map: barTexture,
    transparent: true,
    opacity: 0,
    depthTest: false,
    depthWrite: false,
    color: new THREE.Color(0xffffff),
  }));
  overlay.renderOrder = 9999; // 透明オブジェクトの描画順に埋もれないよう、確実に最前面にする固定値
  overlay.visible = false;
  overlay.center.copy(hbarSprite.center); // hbarSprite本体と同じ基準点を使う(念のための保険)
  overlay.position.set(0, 0, 0.01); // hbarSpriteのローカル原点と同じ(zだけz-fighting回避にわずかに手前)
  overlay.scale.set(1, 1, 1); // hbarSpriteのscaleをそのまま継承させる(独自スケールは持たせない)

  hbarSprite.add(overlay);
  hbarSprite.userData.barGlowOverlay = overlay;
  return overlay;
}

const phase3TextureLoader = new THREE.TextureLoader();

function makePhase3Sprite(key) {
  const asset = PHASE3_ASSETS[key];
  const texture = phase3TextureLoader.load(asset.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: PHASE3_COLOR,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  const { width, height } = phase3SymbolWorldSize(key);
  sprite.scale.set(width, height, 1);
  sprite.visible = false;
  sprite.userData.symbolKey = key;
  return sprite;
}

// createEquationAssembly()から一度だけ呼ぶ。Phase3用の6スプライトを作ってsceneに追加する。
// 戻り値はassembly.phase3としてぶら下げる想定。
export function createPhase3Assets(scene) {
  const sprites = {};
  for (const key of Object.keys(PHASE3_ASSETS)) {
    const sprite = makePhase3Sprite(key);
    scene.add(sprite);
    sprites[key] = sprite;
  }
  return {
    sprites,
    stage: 'hbar', // 'hbar' | 'stage2' | 'stage3' | 'stage4' ← 現在の表示形態
    busy: false,   // 遷移アニメーション中の多重クリック防止
  };
}

// ── 各ステージ遷移の尺(秒)。仮値、見ながら調整してください ──
const STAGE_TRANSITION = {
  toStage2: {
    moveLeft: 4.4,   // ⑴ i・hbarが左へ移動(見た目はまだ変化しない) ※元の速度の1/4
    riseMorph: 4.0,  // ⑵ hbarが上昇しながらhへクロスフェード ※元の速度の1/4
    barGrow: 3.2,    // ⑵ バーがscale.xで0→実寸に伸びる ※元の速度の1/4
    denomFade: 4.0,  // ⑵ 2πがフェードインする ※元の速度の1/4
  },
  toStage3: { moveDuration: 1.2, spinDuration: 4.8 }, // ⑴bar伸長+2π→分母中心+h→分子中心 → ⑵分母が回転してCarouselへ(順番に発生。回転は1/4速度に減速)
  // 2026-09-26: iが飛び乗る前の静止(gapBeforeHop)が長いとのご指摘により2秒→1秒に半減。
  toStage4: { hMove: 0.7, gapBeforeHop: 1, hop: 0.8, merge: 0.6 },  // ⑴hが先に歩いて着地 → (1秒静止) → ⑵iがジャンプして乗る → ⑶最終微調整
};

// ── ①→②(2段階) ──────────────────────────────
// ⑴ i・hbar(ħ)を「左へ」移動させる(この時点ではまだ見た目は変わらない。yは触らない)。
// ⑵ hbarが上昇しながらhへクロスフェードし、同時にバーが伸び、2πがフェードインする。
function transitionToStage2({ assembly, frame, onComplete }) {
  const p3 = assembly.phase3;
  const vertexWorld = assembly.__phase3VertexWorld; // startPhase3側で保存
  const hbarSprite = assembly.sprites.hbar;
  const iSprite = assembly.sprites.i;

  const hSprite = p3.sprites.h2;
  const barSprite = p3.sprites.barTwoPi;
  const denomSprite = p3.sprites.twoPi;

  // ── 目標位置(マスター座標から計算した絶対ワールド座標) ──
  const iTarget = stagePartWorld('stage2', 'i', vertexWorld, frame);
  const hTarget = stagePartWorld('stage2', 'h', vertexWorld, frame);
  const barTarget = stagePartWorld('stage2', 'bar', vertexWorld, frame);
  const denomTarget = stagePartWorld('stage2', 'denom', vertexWorld, frame);

  // ⑴の「左移動だけ」の中間目標: hTargetのx(rx)だけを使い、yはhbarの今のy(ry)のまま。
  const hbarStartOffset = worldToLocalOffset(hbarSprite.position, vertexWorld, frame);
  const hTargetOffset = worldToLocalOffset(hTarget, vertexWorld, frame);
  const hbarLeftWorld = localOffsetToWorld(hTargetOffset.rx, hbarStartOffset.ry, vertexWorld, frame);

  const { moveLeft, riseMorph, barGrow, denomFade } = STAGE_TRANSITION.toStage2;
  const barTargetWidth = fractionBarWorldWidth(BAR_WIDTH_PX.stage2, 'stage2', 'barTwoPi');

  // ★ 変更: 全体を一時停止(paused:true)で組み立てておき、ユーザーの最初のスクロール操作を
  //   トリガーに「①フレーズ表示+バー発光(hbarはまだ静止したまま)」→「②本編(moveLeft以降の
  //   移動)を再生開始」という順序にする。
  //   従来はキャプション表示もバー発光もtl内の固定時刻(0、およびmoveLeft)に自動で始めていたため、
  //   発光がちょうどhbarSpriteが動いている最中に重なってしまい、見た目のタイミングが噛み合って
  //   いなかった(ずれて見える一因)。発光をhbarSpriteが完全に静止している「スクロール待ちの間」に
  //   行うことで、この噛み合わせのズレを解消する。
  const tl = gsap.timeline({ onComplete, paused: true });

  // ⑴ i・hbarが左へ移動(テクスチャはまだ変化しない)
  tl.to(iSprite.position, { x: iTarget.x, y: iTarget.y, z: iTarget.z, duration: moveLeft, ease: 'power2.inOut' }, 0);
  tl.to(hbarSprite.position, { x: hbarLeftWorld.x, y: hbarLeftWorld.y, z: hbarLeftWorld.z, duration: moveLeft, ease: 'power2.inOut' }, 0);

  // ⑵ hbarとhが「同じ軌道」を一緒に上昇しながらクロスフェードする。
  // ★従来はhbarSpriteがhbarLeftWorldに留まったままopacityだけ下げていたため、
  //   「静止したħが薄れる隣で、hだけが単独で浮き上がる」ように見えてしまっていた。
  //   ここでは両スプライトの位置を毎フレーム同じ値(riseProgressで補間した1点)に
  //   揃えることで、1本の記号がその場で姿を変えながら上昇するように見せる。
  hSprite.position.copy(hbarLeftWorld); // 左移動が終わった場所(=hのx、hbarの元y)から出発
  hSprite.visible = true;
  hSprite.material.opacity = 0;

  const riseProgress = { t: 0 };
  tl.to(riseProgress, {
    t: 1,
    duration: riseMorph,
    ease: 'power2.out',
    onUpdate: () => {
      const pos = hbarLeftWorld.clone().lerp(hTarget, riseProgress.t);
      hbarSprite.position.copy(pos);
      hSprite.position.copy(pos);
    },
  }, moveLeft);
  tl.to(hbarSprite.material, { opacity: 0, duration: riseMorph, ease: 'power1.inOut' }, moveLeft);
  tl.to(hSprite.material, { opacity: 1, duration: riseMorph, ease: 'power1.inOut' }, moveLeft);
  tl.call(() => { hbarSprite.visible = false; }, null, moveLeft + riseMorph);

  // ⑵ バーが0→実寸に伸びる
  barSprite.position.copy(barTarget);
  barSprite.scale.x = 0;
  barSprite.visible = true;
  barSprite.material.opacity = 0;
  tl.to(barSprite.material, { opacity: 1, duration: barGrow, ease: 'power1.out' }, moveLeft + riseMorph * 0.5);
  tl.to(barSprite.scale, { x: barTargetWidth, duration: barGrow, ease: 'power2.out' }, moveLeft + riseMorph * 0.5);

  // ⑵ 2πがフェードイン
  denomSprite.position.copy(denomTarget);
  denomSprite.visible = true;
  denomSprite.material.opacity = 0;
  const denomFadeStart = moveLeft + riseMorph * 0.5 + barGrow * 0.5;
  tl.to(denomSprite.material, { opacity: 1, duration: denomFade, ease: 'power1.out' }, denomFadeStart);

  // ★ ご指示反映: 「You can wear it a while」を、2π(分母)のフェードインが完了した
  //   タイミングで消す。showWearItAWhilePhrase自体の内部タイマーに任せず、
  //   completePhraseCaption.hide()を直接呼んで強制的に閉じる。
  //   (captions.js側にhide()相当のメソッドが無い場合はここが効かないので、
  //   captions.jsを見せてもらえれば確実な形に直す)
  tl.call(() => {
    const cap = assembly.completePhraseCaption;
    if (cap && typeof cap.hide === 'function') {
      cap.hide();
    } else {
      console.warn('completePhraseCaption.hide()が見つからないため、2π完了時のキャプション消去をスキップしました。captions.jsのAPIを確認してください。');
    }
  }, null, denomFadeStart + denomFade);

  // ── ①バー発光(hbarが動き出す"前"、静止中に1回だけ)→発光が終わったら
  //   「You can wear it a while」表示 → ②上で組み立てた本編タイムライン(tl)を再生開始、
  //   という順序をスクロールで駆動する。
  const barGlowOverlay = ensureHbarBarGlowOverlay(hbarSprite);
  function flashBarGlowOnce(onDone) {
    barGlowOverlay.visible = true;
    barGlowOverlay.material.opacity = 0;
    barGlowOverlay.material.color.copy(BAR_DETACH_FLASH_COLOR);
    gsap.timeline()
      .to(barGlowOverlay.material, { opacity: 1, duration: 0.35, ease: 'power1.out' })
      .to(barGlowOverlay.material.color, {
        r: PHASE3_COLOR_NORMALIZED.r,
        g: PHASE3_COLOR_NORMALIZED.g,
        b: PHASE3_COLOR_NORMALIZED.b,
        duration: 0.45,
        ease: 'power1.in',
      }, '<') // 発光開始と同時に赤→白の冷却を始める(光ってから消えるまでの間ずっと白へ近づいていく)
      .to(barGlowOverlay.material, { opacity: 0, duration: 0.4, ease: 'power1.in' })
      .call(() => {
        barGlowOverlay.visible = false;
        if (onDone) onDone();
      });
  }

  function beginMainTimeline() {
    flashBarGlowOnce(() => {
      showWearItAWhilePhrase(assembly.completePhraseCaption);
      tl.play();
    });
  }

  // wheel/touchmoveのどちらが先に来ても、もう片方のリスナーも一緒に外して二重発火を防ぐ。
  function onScrollTrigger() {
    window.removeEventListener('wheel', onScrollTrigger);
    window.removeEventListener('touchmove', onScrollTrigger);
    beginMainTimeline();
  }
  window.addEventListener('wheel', onScrollTrigger, { passive: true });
  window.addEventListener('touchmove', onScrollTrigger, { passive: true });
}

// ── ②→③(2段階。ご指摘により分離): ────────────────────────
// ⑴ バーが伸長し、2π(まだ2πのまま)が新しい分母中心へ、hが新しい分子中心へ移動する。
//    この段階ではまだ回転もCarouselも出てこない。
// ⑵ ⑴で収まった位置のまま、分母がその場で回転してCarouselへ入れ替わる。
// ── Spriteの鏡映(左右反転)ヘルパー ──────────────────────
// ★重要: THREE.Spriteは object.scale.x に負の値を入れても見た目は反転しない。
// Sprite用の内蔵シェーダー(three.js の ShaderLib.sprite)は、スケールを
// `length(modelMatrix[0].xyz)` というベクトルの「長さ」から再計算しており、
// これは符号を持たない(常に非負)。つまりscale.xの符号情報はシェーダーの
// 時点で失われてしまうため、「negative scale.x = 鏡映」という一般的な
// Mesh/PlaneGeometryでの手法はSpriteには通用しない
// (以前 Math.abs(Math.cos(angle)) を外しただけでは反転して見えなかったのはこのため)。
//
// 代わりに、テクスチャのrepeat/offsetを操作してUV自体を反転させる
// (repeat.x = -1, offset.x = 1 で「サンプリング座標を左右逆にする」)。
// こちらはシェーダー側のスケール正規化の影響を受けないので、Spriteでも
// 確実に鏡映表示になる。
function setSpriteMirrored(sprite, mirrored) {
  const texture = sprite.material.map;
  if (!texture) return;
  const targetRepeatX = mirrored ? -1 : 1;
  if (texture.repeat.x === targetRepeatX) return; // 毎フレーム無駄にneedsUpdateを立てない
  texture.repeat.x = targetRepeatX;
  texture.offset.x = mirrored ? 1 : 0;
  texture.needsUpdate = true;
}

function transitionToStage3({ assembly, frame, onComplete }) {
  const p3 = assembly.phase3;
  const vertexWorld = assembly.__phase3VertexWorld;
  const iSprite = assembly.sprites.i;

  const hSprite = p3.sprites.h2;
  const twoPiSprite = p3.sprites.twoPi;
  const carouselSprite = p3.sprites.carousel;
  const barFrom = p3.sprites.barTwoPi;
  const barTo = p3.sprites.barWide;

  const iTarget = stagePartWorld('stage3', 'i', vertexWorld, frame);
  const hTarget = stagePartWorld('stage3', 'h', vertexWorld, frame);
  const barTarget = stagePartWorld('stage3', 'bar', vertexWorld, frame);
  const toDenomPos = stagePartWorld('stage3', 'denom', vertexWorld, frame);
  // twoPiSpriteはtransitionToStage2の時点でstage2の分母位置(fromDenomPos)に
  // 置かれたままここへ来る。ここではその位置からtoDenomPosへ移動させる。

  const { moveDuration, spinDuration } = STAGE_TRANSITION.toStage3;
  const barToTargetWidth = fractionBarWorldWidth(BAR_WIDTH_PX.stage3, 'stage3', 'barWide');

  const tl = gsap.timeline({ onComplete });

  // ── ⑴ バーの伸長 + 2πが分母中心へ + hが分子中心へ(まだ回転しない) ──
  tl.to(iSprite.position, { x: iTarget.x, y: iTarget.y, z: iTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);
  tl.to(hSprite.position, { x: hTarget.x, y: hTarget.y, z: hTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);
  // ★2026-08-16 再修正: 前回 position.x を直接tweenしたが、frame.right/frame.upは
  //   必ずしもワールドの生のX/Y軸と平行とは限らないため、position.xだけを動かしても
  //   「左右方向だけの移動」にはならない(実際にはまだ縦方向にもズレていた)。
  //   worldToLocalOffset/localOffsetToWorldでframe基準のオフセットに変換し、
  //   rx(左右)だけをtoDenomPosに合わせ、ry(上下)は現在値のまま保持する。
  const twoPiStartOffset = worldToLocalOffset(twoPiSprite.position, vertexWorld, frame);
  const toDenomOffset = worldToLocalOffset(toDenomPos, vertexWorld, frame);
  const twoPiXOnlyTarget = localOffsetToWorld(toDenomOffset.rx, twoPiStartOffset.ry, vertexWorld, frame);
  tl.to(twoPiSprite.position, { x: twoPiXOnlyTarget.x, y: twoPiXOnlyTarget.y, z: twoPiXOnlyTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);

  barTo.position.copy(barFrom.position);
  barTo.scale.x = barFrom.scale.x;
  barTo.visible = true;
  barTo.material.opacity = 0;
  tl.to(barFrom.material, { opacity: 0, duration: moveDuration, ease: 'power1.inOut' }, 0);
  tl.to(barTo.material, { opacity: 1, duration: moveDuration, ease: 'power1.inOut' }, 0);
  // ★2026-08-16 修正: barの伸長(position・scale.x)がiの移動(power2.inOut)と
  //   違うイージング(power2.out)だったため、時間は同じでも速度カーブが噛み合わず
  //   「iにbarが突き刺さりながら進む」ように見えていた。iと同じイージングに揃える。
  tl.to(barTo.position, { x: barTarget.x, y: barTarget.y, z: barTarget.z, duration: moveDuration, ease: 'power2.inOut' }, 0);
  tl.to(barTo.scale, { x: barToTargetWidth, duration: moveDuration, ease: 'power2.inOut' }, 0);
  tl.call(() => { barFrom.visible = false; }, null, moveDuration);

  // ── ⑵ ⑴完了後、分母がその場(toDenomPos)で回転してCarouselへ ──
  // (コインが裏返る演出: 前半は2πを回して隠す、後半でCarouselを回しながら見せる)
  carouselSprite.position.copy(toDenomPos);
  carouselSprite.rotation.z = Math.PI; // 裏面から始める
  carouselSprite.visible = true;
  carouselSprite.material.opacity = 0;

  const spinState = { t: 0 };
  tl.to(spinState, {
    t: 1,
    duration: spinDuration,
    ease: 'power1.inOut',
    onUpdate: () => {
      const angle = spinState.t * Math.PI * 2; // 0→360°
      twoPiSprite.rotation.z = angle;
      carouselSprite.rotation.z = Math.PI + angle;
      // scale.xをcos的に潰すと「回転して薄く見える」疑似3D感が出る(大きさは常にabsでOK。
      // Spriteはscale.xの符号を無視するため、反転自体はsetSpriteMirrored()で別途行う)。
      const cosAngle = Math.cos(angle);
      const twoPiSquash = Math.abs(cosAngle);
      twoPiSprite.scale.x = phase3SymbolWorldSize('twoPi').width * twoPiSquash;
      // 90°〜270°(cos(angle)が負の区間)は鏡映画像として見せる=「2πが裏返る」演出。
      setSpriteMirrored(twoPiSprite, cosAngle < 0);

      // carouselは270°〜360°の区間(cos(angle)は0→1で常に非負)にしか見せないため反転不要。
      const carouselSquash = Math.abs(cosAngle);
      carouselSprite.scale.x = phase3SymbolWorldSize('carousel').width * carouselSquash;
      // 切り替えタイミングを180°(t=0.5)→270°(t=0.75)に変更:
      // 2πを270°まで見せ(90°〜270°は反転した状態で見える)、残り90°でCarouselに差し替える。
      if (spinState.t < 0.75) {
        twoPiSprite.material.opacity = 1;
        carouselSprite.material.opacity = 0;
      } else {
        twoPiSprite.material.opacity = 0;
        carouselSprite.material.opacity = 1;
      }
    },
    onComplete: () => {
      twoPiSprite.visible = false;
      twoPiSprite.rotation.z = 0;
      twoPiSprite.scale.x = phase3SymbolWorldSize('twoPi').width;
      setSpriteMirrored(twoPiSprite, false); // 次回(Phase4循環時)のために鏡映状態を必ずリセット
      carouselSprite.rotation.z = 0;
      carouselSprite.scale.x = phase3SymbolWorldSize('carousel').width;
      carouselSprite.material.opacity = 1;
    },
  }, moveDuration); // ← ⑴の終了時刻から開始(=完全に順番。同時発生させない)
}

// ── ③→④: 「h」が先に歩いて着地し、そのあと「i」がジャンプしてhの上に飛び乗る。
// ★2026-08-16 全面書き直し(重要な修正): 従来は「iとhを同じ着地点(mergedとして
//   1点だけ実測した値)へ向けて同時に歩み寄らせる」実装だったが、これだとhの本当の
//   目的地とiの本当の目的地の違い=iが実際にどれだけ移動してhに飛び乗るか、が
//   完全に無視されてしまい、iの飛び乗り位置がおかしく見えていた。final.pngを
//   2値化してconnected component解析したところ、iのループ(ドット無し、hの
//   アセンダー右上にある渦巻き)とhの本体(アセンダー+ボウル)はインクが繋がって
//   おらず別々の連結成分に分離できたため、それぞれのbbox中心を個別に実測し直した
//   (STAGE_RAW_CENTERS.stage4.h / .i、詳細はそちらのコメント参照)。今回はその
//   実測値を使い、要望通り
//     ⑴ hが先に(直線的に)歩いて自分の着地点(stage4実測のh位置)へ到着
//     ⑵ 少し遅れてiが放物線を描いてジャンプし、hのアセンダー上の着地点
//       (stage4実測のi位置)へ飛び乗る
//   の順で動かす。着地後は合成グリフへの差し替えは行わず、iSprite・hSpriteを
//   そのまま個別スプライトとして重ねて表示する(合成アセットは実測値同士の
//   わずかな誤差で着地の瞬間だけ絵柄がすり替わって見えてしまうため不採用)。──
function transitionToStage4({ assembly, frame, onComplete }) {
  const p3 = assembly.phase3;
  const vertexWorld = assembly.__phase3VertexWorld;
  const iSprite = assembly.sprites.i; // ここまでstage3の位置にいる「i」
  const hSprite = p3.sprites.h2;
  const carouselSprite = p3.sprites.carousel;
  const barSprite = p3.sprites.barWide;

  // 実測ジャンプ元: stage3(carousel_equation.png)実測のi・h位置
  const hopStart = stagePartWorld('stage3', 'i', vertexWorld, frame);

  // 実測着地先: stage4(final.png)実測のh・i個別位置(★同じ点ではない)
  const hTarget = stagePartWorld('stage4', 'h', vertexWorld, frame);
  const iTarget = stagePartWorld('stage4', 'i', vertexWorld, frame);
  const barTarget = stagePartWorld('stage4', 'bar', vertexWorld, frame);
  const toDenomPos = stagePartWorld('stage4', 'denom', vertexWorld, frame);

  const { hMove, gapBeforeHop, hop, merge } = STAGE_TRANSITION.toStage4;

  const tl = gsap.timeline({ onComplete });

  // ⑴ hが先に、直線的に歩いて自分の着地点(hTarget)へ到着する。
  tl.to(hSprite.position, { x: hTarget.x, y: hTarget.y, z: hTarget.z, duration: hMove, ease: 'power2.inOut' }, 0);

  // ⑵ hが完全に止まってから2秒待ち、そのあとiが放物線を描いてジャンプし、
  //   hのアセンダー上の着地点(iTarget)へ飛び乗る。
  // ★2026-08-16 修正: 以前は「hの到着間際にiの助走を重ねる」演出(動く馬に飛び乗る
  //   イメージ)だったが、ご要望により「hが完全に止まる→2秒間→iが動き出す」という
  //   明確に区切られた順番に変更。
  const hopStartTime = hMove + gapBeforeHop;
  const hopPeak = { t: 0 };
  const arcHeight = phase3SymbolWorldSize('h2').height * 0.5;
  tl.to(hopPeak, {
    t: 1,
    duration: hop,
    ease: 'power1.inOut',
    onUpdate: () => {
      const t = hopPeak.t;
      const arc = Math.sin(t * Math.PI) * arcHeight;
      iSprite.position.lerpVectors(hopStart, iTarget, t).addScaledVector(frame.up, arc);
    },
  }, hopStartTime);

  // 両者が着地する時刻。合成グリフへの差し替え(クロスフェード)は行わない
  // (iSprite・hSpriteはそのまま不透明で残り、着地位置で重なって見える)。
  const landTime = hopStartTime + hop;

  // Carousel・バーはstage3とほぼ同じ位置なので、わずかな最終微調整だけ
  tl.to(carouselSprite.position, { x: toDenomPos.x, y: toDenomPos.y, z: toDenomPos.z, duration: merge, ease: 'power2.out' }, landTime);
  tl.to(barSprite.position, { x: barTarget.x, y: barTarget.y, z: barTarget.z, duration: merge, ease: 'power2.out' }, landTime);
}

// ステージ間の「静止時間」(秒)。ご要望により、2π出現後に2秒設けていたが、
// 2026-09-26: 動きの尺(toStage2)はそのままに、この「出現し終えた後の純粋な待機」だけを
// 半分の1秒に短縮。
const STAGE_TRANSITION_HOLD = {
  afterStage2: 1, // 2πが出現した直後の静止
};

function holdThen(seconds, fn) {
  if (!seconds) { fn(); return; }
  gsap.delayedCall(seconds, fn);
}

// ── Phase3オーケストレーション本体 ──────────────────────
// 数式(完成した①iħ∂ψ/∂t=Ĥψ)をクリックした瞬間にmain.jsから一度だけ呼ぶ。
// ②→③→④を自動で連続再生する(ドキュメントの「クリックで自動変化開始」)。
// onStageChange(stageName)は各ステージに切り替わった瞬間に呼ばれる(効果音やログ用、任意)。
export function startPhase3({ assembly, camera, onStageChange, onComplete }) {
  const p3 = assembly.phase3;
  if (!p3 || p3.busy || p3.stage !== 'hbar') return;
  p3.busy = true;

  const frame = computeScreenFrame(camera);
  // 全ステージの位置計算(stagePartWorld)が基準にする頂点。
  //
  // ★2026-08-16 修正: 以前は assembly.sprites.equals.position をそのままvertexWorldに
  // 使っていたが、これは「=」記号の"インク中心"(視覚的な基準線)ではなく、
  // "キャンバス中心"(スプライトの位置そのもの)だった。makeSymbolSprite配置時、
  // equals.pngはキャンバス内でインクが下寄り(非対称な余白)なため、symbolWorldYが
  // paddingCorrection分だけキャンバスをずらして配置している
  // (= 結果としてスプライト位置はインク中心から上にズレている)。
  //
  // Phase3側の全計算(stagePartWorld・EQUALS_MASTER・STAGE_EQUALS_RAW)は
  // 「=」のインク中心そのものを基準線(オフセット0)とみなして設計されているため、
  // このズレがPhase3のi・h・バー・分母すべてに一律に伝播し、
  // derivativeのバーと高さが合わない/iが移動中に浮き上がって見える原因になっていた。
  //
  // ここでequals自身のpaddingCorrectionを逆算して差し引き、真のインク中心
  // (=Phase1がderivative等の基準にしている点、と同じ点)をvertexWorldとして使う。
  const equalsAsset = SYMBOL_ASSETS.equals;
  const equalsScale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  const equalsCanvasCenter = { x: equalsAsset.canvas[0] / 2, y: equalsAsset.canvas[1] / 2 };
  const equalsContentCenter = contentCenterPx(equalsAsset.alphaBbox);
  const equalsPaddingCorrection = {
    x: (equalsContentCenter.x - equalsCanvasCenter.x) * equalsScale,
    y: (equalsContentCenter.y - equalsCanvasCenter.y) * equalsScale,
  };
  const vertexWorld = assembly.sprites.equals.position.clone()
    .addScaledVector(frame.right, -equalsPaddingCorrection.x)
    .addScaledVector(frame.up, -equalsPaddingCorrection.y);
  assembly.__phase3VertexWorld = vertexWorld;

  transitionToStage2({
    assembly, frame,
    onComplete: () => {
      p3.stage = 'stage2';
      if (onStageChange) onStageChange('stage2');
      holdThen(STAGE_TRANSITION_HOLD.afterStage2, () => {
        transitionToStage3({
          assembly, frame,
          onComplete: () => {
            p3.stage = 'stage3';
            if (onStageChange) onStageChange('stage3');
            transitionToStage4({
              assembly, frame,
              onComplete: () => {
                p3.stage = 'stage4';
                p3.busy = false;
                if (onStageChange) onStageChange('stage4');
                if (onComplete) onComplete();
              },
            });
          },
        });
      });
    },
  });
}

// TODO(Phase3):
//   - STAGE_RAW_CENTERS/STAGE_EQUALS_RAWは3枚の完成画像から実測した値。「=」を共通原点に
//     PHASE3_IMAGE_SCALEで画像ごとの縮小率を補正しているので、Ĥ・ψ・derivativeとの
//     サイズ・位置の整合性は取れているはず。ズレが残る場合はPHASE3_IMAGE_SCALEまたは
//     STAGE_RAW_CENTERS/STAGE_EQUALS_RAWの実測値を見直してください。
//   - ⑶(②→③)で「i, h/2π」がさらに左へ動く量・タイミングは実測ベースだが、
//     見た目のスピード感(moveDuration/spinDurationとの前後関係)はまだ仮。
//   - transitionToStage3の「回転して裏返る」演出はscale.x(cos疑似3D)+テクスチャUV反転
//     (setSpriteMirrored)によるフェイクで、実際に3D回転(rotation.y等)させたい場合は
//     Spriteではなく PlaneGeometry への変更が必要
//     (SpriteはmodelMatrixの列ベクトルの長さでスケールを再計算するため、negative scale.x
//     では鏡映できない点に注意。setSpriteMirrored()のコメント参照)。