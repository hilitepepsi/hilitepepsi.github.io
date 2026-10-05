import * as THREE from 'three';
import { computeScreenFrame, planePoint } from './screenFrame.js';
import {
  SYMBOL_ASSETS,
  symbolWorldSize,
  symbolWorldPosition,
  computeGlyphWorldPoints,
} from './symbolAssets.js';
import {
  createCaptionBox,
  makeCaptionController,
  startConvergenceCaption,
  startHamiltonianCaption,
  showEquationCompletePhrase,
} from './captions.js';
import { createPhase3Assets } from './phase3.js';

// ── 星の収束オーケストレーション ──────────────────────
export const STAR_CONVERGENCE = {
  psiFinal: { count: 'all', duration: 1 },
};

// starFieldの未割当プールから星を取り出し、symbolKeyの形へ収束させる。
function convergeStarsToSymbol(symbolKey, { starField, frame, basePointWorld, onComplete }) {
  const cfg = STAR_CONVERGENCE[symbolKey];
  const count = cfg.count === 'all' ? starField.remainingCount() : cfg.count;
  const duration = cfg.duration;
  const indices = starField.pickUnassigned(count);
  if (indices.length === 0) {
    console.warn(`convergeStarsToSymbol(${symbolKey}): 未割当の星が残っていません`);
    if (onComplete) onComplete([]);
    return;
  }
  computeGlyphWorldPoints(symbolKey, { frame, basePointWorld, count: indices.length }).then((worldPoints) => {
    if (worldPoints.length === 0) {
      console.warn(`convergeStarsToSymbol(${symbolKey}): グリフ点群が空でした(画像読み込み失敗?)`);
      if (onComplete) onComplete([]);
      return;
    }
    starField.morphStarsToPoints(indices, worldPoints, {
      duration,
      onComplete: () => { if (onComplete) onComplete(indices); },
    });
  });
}

// ψを構成する星の集合を、本物のpsi.pngスプライトへクロスフェードする。
// ★変更: 直列(星が消え切ってからpsi.pngを出す)だと、その境目に「どちらも
// 見えていない/薄い瞬間」ができてしまうため、星のフェードアウトとpsi.pngの
// フェードインを同時に走らせる本来のクロスフェードにした。
// 収束時のψ形状は基準点(basePointWorld)を中心にした点群のばらつきであり、
// psi.pngもまったく同じ基準点(symbolWorldPosition('psiFinal', ...))から
// 配置されるため、重なって見える一瞬があっても位置のズレとしては視認され
// にくいはず(検証済み: 星の位置は基準点から1〜4ユニット程度の、
// 文字の形として正常な範囲に収まっている)。
const STAR_FADE_OUT_DURATION = 1.5;
const PSI_PNG_FADE_IN_DURATION = 1.5;

function fadeStarsThenShowPsiPng({ assembly, starField, psiIndices, vertexWorld, frame, onComplete }) {
  if (!psiIndices || psiIndices.length === 0) {
    if (onComplete) onComplete();
    return;
  }
  starField.markAsGlyph(psiIndices);

  const psiSprite = assembly.sprites.psiFinal;
  psiSprite.position.copy(symbolWorldPosition('psiFinal', vertexWorld, frame));
  psiSprite.visible = true;
  psiSprite.material.opacity = 0;

  // 両方のアニメーションが完了してから初めてonCompleteを呼ぶ(片方が先に
  // 終わってももう片方を待つ。durationを別々に変えても壊れないようにするため)。
  let pending = 2;
  const settle = () => { if (--pending === 0 && onComplete) onComplete(); };

  starField.fadeGlyph(STAR_FADE_OUT_DURATION, settle);
  gsap.to(psiSprite.material, {
    opacity: 1,
    duration: PSI_PNG_FADE_IN_DURATION,
    ease: 'power1.inOut',
    onComplete: settle,
  });
}

// ── アンカー方式について ──────────────────────────
// (A) 中心アンカー(デフォルト) … i / derivative / 最終位置に収まったĤ・ħ 向け。
// (B) 上端アンカー … Ĥ/ħ が「軸を歩いている」間だけ使う。文字の上端が
//     経路のラインに接するように見せたいときに使う。
export function topAnchorCenter(symbolKey) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const canvasH = asset.canvas[1];
  const contentTopPx = asset.alphaBbox[1];
  return new THREE.Vector2(0.5, 1 - contentTopPx / canvasH);
}

// center(アンカー)を上端→中心に切り替える。見た目のジャンプが出ないよう、
// ズレた分だけposition側(frame.up方向)に同時補正する。
function switchToCenterAnchor(sprite, symbolKey, frame) {
  const oldCenterY = sprite.center.y;
  const height = symbolWorldSize(symbolKey).height;
  sprite.center.set(0.5, 0.5);
  sprite.position.addScaledVector(frame.up, (0.5 - oldCenterY) * height);
}

// ── シンボルスプライトの生成 ──────────────────────
export const SYMBOL_COLOR = 0xbfe9ff; // 仮。config.js の AXIS_COLOR と同じ値

// Ĥ・ħ・iは薄い水色のままだと半透明フェード中に見えにくかったため白で染める。
// 他のシンボルもトーンを揃えるため同じく白。
const SYMBOL_COLOR_OVERRIDES = {
  hamiltonian: 0xffffff,
  hbar: 0xffffff,
  i: 0xffffff,
  derivative: 0xffffff,
  psiFinal: 0xffffff,
  equals: 0xffffff,
};

const textureLoader = new THREE.TextureLoader();

function makeSymbolSprite(symbolKey, { anchor = 'center' } = {}) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const texture = textureLoader.load(asset.url);
  texture.colorSpace = THREE.SRGBColorSpace;
  // 元画像の解像度が表示サイズに対してかなり大きく、デフォルトのミップマップ
  // (トライリニア)補間だと必要以上に輪郭がにじんで見えていたため、
  // ミップマップを切ってリニア補間のみにする。
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    color: SYMBOL_COLOR_OVERRIDES[symbolKey] ?? SYMBOL_COLOR,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  });
  const sprite = new THREE.Sprite(material);
  const { width, height } = symbolWorldSize(symbolKey);
  sprite.scale.set(width, height, 1);
  if (anchor === 'top') sprite.center.copy(topAnchorCenter(symbolKey));
  sprite.visible = false;
  sprite.userData.symbolKey = symbolKey;
  sprite.userData.anchor = anchor;
  return sprite;
}

const AXIS_WALKING_SYMBOLS = new Set(['hamiltonian', 'hbar']); // ← 軸線上を歩く記号は上端アンカー

// scene: 記号はここに直接scene.add()する(ワールド空間に固定。カメラの子にはしない)。
// camera: 初期プレビュー配置のためにcomputeScreenFrame()するのに使う。
export function createEquationAssembly(scene, camera) {
  const sprites = {};
  for (const key of Object.keys(SYMBOL_ASSETS)) {
    const anchor = AXIS_WALKING_SYMBOLS.has(key) ? 'top' : 'center';
    const sprite = makeSymbolSprite(key, { anchor });
    scene.add(sprite); // ← ワールド空間に直接置く
    sprites[key] = sprite;
  }

  // 動作確認用: カメラの現在位置の少し前方を頂点の仮位置として、
  // 「もし今すぐ最終形に並べたら」を見た目確認用に配置しておく。
  const frame = computeScreenFrame(camera);
  const previewVertex = frame.cameraPos.clone().addScaledVector(frame.forward, 10);
  for (const key of Object.keys(sprites)) {
    sprites[key].position.copy(symbolWorldPosition(key, previewVertex, frame));
  }

  const captionEl = createCaptionBox({ leftPercent: 75, topPercent: 50 }); // ψ用(画面右)
  const caption = makeCaptionController(captionEl);

  const hamCaptionEl = createCaptionBox({ leftPercent: 25, topPercent: 50 }); // Ĥ用(画面左、psiと対称)
  const hamCaption = makeCaptionController(hamCaptionEl);

  const completePhraseEl = createCaptionBox({ leftPercent: 50, topPercent: 50 }); // ①完成フレーズ用(位置は表示時に動的に上書きする)
  const completePhraseCaption = makeCaptionController(completePhraseEl);

  const phase3 = createPhase3Assets(scene); // ②③④用の6スプライト(最初は全部非表示)

  return { sprites, caption, hamCaption, completePhraseCaption, phase3 };
}

// ── 軸を歩く経路(hbar/hamiltonian専用) ──────────────────────
// ご要望通り「奥行き(カメラからの距離)は固定、画面の右/上方向にだけ動く」経路にしてある。
// depth: カメラから頂点までの距離をそのまま使う(=歩いている間も、最終的に収まる
//   場所と近い奥行きになるので、サイズ感が唐突に変わらない)。
// screenX/screenY: 画面の右・上方向へのオフセット(仮値。見ながら調整してください)。
//   ハミルトニアン: start=(0,7) → end=(-11,-3) (⑴で start→end、⑷で end→start)
//   ħ:          start=(11,-3) → end=(0,7)
function buildWalkPaths(frame, depth) {
  return {
    hamiltonian: {
      start: planePoint(frame, depth, 0, 7),
      end: planePoint(frame, depth, -11, -3),
    },
    hbar: {
      start: planePoint(frame, depth, 11, -3),
      end: planePoint(frame, depth, 0, 7),
    },
  };
}

// ── Phase 1 開始: iクリック(finale.js側でキャプションを消した直後)に呼ぶ ──────
//
// existingISprite: finale.js が返す iSprite(頂点に既にいる緑いi、ワールド座標)。
// camera: startPhase1の間ずっと静止している前提のカメラ(FINALE_DESTで静止済み)。
//   computeScreenFrame()に一度使うだけ(毎フレーム呼ぶ必要はない)。
// starField: main.js の createStars() が返すオブジェクト。
// onEquationComplete: ①(iħ∂ψ/∂t=Ĥψ)が完全に出来上がった瞬間に呼ばれる。
export function startPhase1({ assembly, existingISprite, camera, starField, onHbarArrived, onEquationComplete }) {
  const frame = computeScreenFrame(camera);
  const vertexWorld = existingISprite.getWorldPosition(new THREE.Vector3());
  const depth = vertexWorld.clone().sub(frame.cameraPos).dot(frame.forward); // カメラ→頂点の投影距離

  const walk = buildWalkPaths(frame, depth);
  const hamStart = walk.hamiltonian.start;
  const hamEnd = walk.hamiltonian.end;
  const hbarStart = walk.hbar.start;
  const hbarEnd = walk.hbar.end;

  // ── ∂ψ/∂t: 最終位置で静止したまま15秒フェードイン ──
  const derivativeSprite = assembly.sprites.derivative;
  derivativeSprite.position.copy(symbolWorldPosition('derivative', vertexWorld, frame));
  derivativeSprite.visible = true;
  derivativeSprite.material.opacity = 0;
  gsap.to(derivativeSprite.material, {
    opacity: 1,
    duration: 15,
    delay: 1,
    ease: 'power2.in',
  });

  // ── Ĥ: hamStart → hamEnd → hamStart → 数式内の最終位置(ドキュメント⑴・⑶・⑷・⑸) ──
  const hamiltonianSprite = assembly.sprites.hamiltonian;
  hamiltonianSprite.position.copy(hamStart);
  hamiltonianSprite.visible = true;
  hamiltonianSprite.material.opacity = 0;
  gsap.to(hamiltonianSprite.material, { opacity: 1, duration: 0.6, ease: 'power1.out' });

  // Ĥが軸を歩いている間(⑴〜⑷)だけ、画面左にセリフを流す(psi側と対称)。
  const hamCaptionSeq = startHamiltonianCaption(assembly.hamCaption);

  const outbound = { t: 0 };
  gsap.to(outbound, {
    t: 1,
    duration: 15, // ∂ψ/∂tのフェードイン(15秒)と同時に到着させる(ドキュメント⑶)
    ease: 'power1.inOut',
    onUpdate: () => {
      hamiltonianSprite.position.lerpVectors(hamStart, hamEnd, outbound.t);
    },
    onComplete: () => {
      const inbound = { t: 0 };
      gsap.to(inbound, {
        t: 1,
        duration: 4, // ドキュメント⑷
        ease: 'power2.inOut',
        onUpdate: () => {
          hamiltonianSprite.position.lerpVectors(hamEnd, hamStart, inbound.t);
        },
        onComplete: () => {
          hamCaptionSeq.stop(); // 軸歩き終了。ここでĤ用セリフも締める
          // ⑸: 原点に帰還 → 数式内の最終位置へ。
          const hamTarget = symbolWorldPosition('hamiltonian', vertexWorld, frame);
          switchToCenterAnchor(hamiltonianSprite, 'hamiltonian', frame);
          gsap.to(hamiltonianSprite.position, {
            x: hamTarget.x,
            y: hamTarget.y,
            z: hamTarget.z,
            duration: 0.8,
            ease: 'power2.out',
            onComplete: () => {
              // Ĥの帰還完了をトリガーに、星の収束を開始する(ドキュメント⑸・⑹)。
              if (!starField) return;
              starField.setRotationEnabled(false);
              const convergenceCaption = startConvergenceCaption(assembly.caption);

              // 直前の頂点のワールド座標を改めて取得(既存の緑iが動いていないか一応再確認)。
              const freshVertexWorld = existingISprite.getWorldPosition(new THREE.Vector3());
              const psiBase = symbolWorldPosition('psiFinal', freshVertexWorld, frame);

              convergeStarsToSymbol('psiFinal', {
                starField, frame, basePointWorld: psiBase,
                onComplete: (psiIndices) => {
                  convergenceCaption.stop();
                  fadeStarsThenShowPsiPng({
                    assembly, starField, psiIndices, vertexWorld: freshVertexWorld, frame,
                    onComplete: () => {
                      // ⑺: 「=」をフェードインで出現させる(①完成、Phase 2完了→Phase 3へ)。
                      const equalsSprite = assembly.sprites.equals;
                      equalsSprite.position.copy(symbolWorldPosition('equals', freshVertexWorld, frame));
                      equalsSprite.visible = true;
                      equalsSprite.material.opacity = 0;
                      gsap.to(equalsSprite.material, {
                        opacity: 1,
                        duration: 2,
                        delay: 2,
                        ease: 'power1.out',
                        onComplete: () => { 
                          // ①(iħ∂ψ/∂t=Ĥψ)完成と同時に、画面中央へワンフレーズを10秒表示する。
                          showEquationCompletePhrase(assembly.completePhraseCaption);
                          if (onEquationComplete) onEquationComplete();
                        },
                      });
                    },
                  });
                },
              });
            },
          });
        },
      });
    },
  });

  // ── ħ: hbarStart → hbarEnd、7秒 ──
  const hbarSprite = assembly.sprites.hbar;
  hbarSprite.position.copy(hbarStart);
  hbarSprite.visible = true;
  hbarSprite.material.opacity = 0;
  gsap.to(hbarSprite.material, { opacity: 1, duration: 0.6, ease: 'power1.out' });

  const travel = { t: 0 };
  gsap.to(travel, {
    t: 1,
    duration: 7,
    ease: 'power2.inOut',
    onUpdate: () => {
      hbarSprite.position.lerpVectors(hbarStart, hbarEnd, travel.t);
    },
    onComplete: () => {
      // ここでħが頂点(=既存の緑i)に重なる。
      if (onHbarArrived) onHbarArrived({ hbarSprite, existingISprite, vertexWorld });
      settleIAndHbar({ assembly, existingISprite, hbarSprite, vertexWorld, frame });
    },
  });

  return { vertexWorld, frame };
}

// ── ⑵: ħ到着後 → iの色変化 → iħが最終位置へ移動 ──────────────────
// 既存の緑いi(i-icon.png)は画像自体が着色済みでmaterial.colorでは染め直せないため、
// 「色変化」は次の3ステップで表現する:
//   1) 白インク版のi(assembly.sprites.i)を、既存の緑iと同じ位置にクロスフェードで重ねる
//   2) 同時に既存の緑iをフェードアウト
//   3) 色が変わったあと、新しいi・ħの両方を最終位置へ移動
const I_COLOR_CHANGE_DURATION = 1;
const I_HBAR_MOVE_DURATION = 3;

function settleIAndHbar({ assembly, existingISprite, hbarSprite, vertexWorld, frame }) {
  switchToCenterAnchor(hbarSprite, 'hbar', frame); // 「軸を歩く」区間の終わり(見た目ジャンプなし)

  const newISprite = assembly.sprites.i;
  newISprite.position.copy(vertexWorld); // 既存の緑iと全く同じ場所に重ねて登場させる
  newISprite.visible = true;
  newISprite.material.opacity = 0;

  const tl = gsap.timeline();
  tl.to(newISprite.material, { opacity: 1, duration: I_COLOR_CHANGE_DURATION, ease: 'power1.inOut' }, 0);
  tl.to(existingISprite.material, { opacity: 0, duration: I_COLOR_CHANGE_DURATION, ease: 'power1.inOut' }, 0);
  tl.call(() => { existingISprite.visible = false; });

  const iTarget = symbolWorldPosition('i', vertexWorld, frame);
  const hbarTarget = symbolWorldPosition('hbar', vertexWorld, frame);
  tl.to(newISprite.position, { x: iTarget.x, y: iTarget.y, z: iTarget.z, duration: I_HBAR_MOVE_DURATION, ease: 'power2.inOut' }, I_COLOR_CHANGE_DURATION);
  tl.to(hbarSprite.position, { x: hbarTarget.x, y: hbarTarget.y, z: hbarTarget.z, duration: I_HBAR_MOVE_DURATION, ease: 'power2.inOut' }, I_COLOR_CHANGE_DURATION);
}

// TODO:
//   - buildWalkPaths()のscreenX/screenY値(0,7 / -11,-3 / 11,-3)は前バージョンからの
//     引き継ぎ値。ワールド空間方式でも見た目が近くなるはずだが、実際に見て微調整が必要。
//   - STAR_CONVERGENCE の count/duration は仮値。