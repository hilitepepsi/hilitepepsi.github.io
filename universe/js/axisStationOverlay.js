import * as THREE from 'three';
import { AXIS_LENGTH, AXIS_WORLD_DIR } from './config.js';
import { getAxisStationView } from './config.js';
import { makeTextSprite } from './axisLabels.js';
import { AXIS_CONTENT } from './data/axisContent.js';

// ── 軸ステーション限定の追加表示(X軸・Y軸) ────────
// 軸クリックでその軸のステーションへカメラが到達している間だけ、
//   1) 軸ラベルの文字を消す(main.js側でaxisLabels.sprites[name]を操作)
//   2) 点(クリックできるもの/持続表示のタイトル付きのもの)を出す
// をまとめて main.js から showX()/showY() で切り替える。
// カメラが動いたら(main.js側でcontrolsの'change'を監視して)hideX()/hideY()を呼び、元の状態に戻す。
//
// Y軸: 終端にクリック可能な点(クリックで"Teddy"を表示) + 軸中央の下に持続タイトル"Nine Stories"
// X軸: 終端に持続タイトル"The Catcher in the Rye"(点の上に表示) + 原点付近にクリック可能な点(クリックで"Central Park"を表示)

const DOT_RADIUS = 0.35;          // hotspots.jsの星と同じスケール感
const DOT_HIT_RADIUS = 1.1;       // ← クリック判定専用の当たり判定半径(見た目のDOT_RADIUSより広い)。
                                   //   小さな点(半径0.35)を画面上で正確にクリックするのは元々シビアで、
                                   //   特にZ軸は波動関数(zAxisWave)の描画が点の位置に重なる瞬間があり
                                   //   狙いづらいため、見た目はそのままにクリックできる範囲だけ広げる。
export const DOT_COLOR = 0x4fd6ff; // ← bloomThreshold(0.35)を超える明るい青。軸(0xbfe9ff)より彩度を上げて発光が映えるようにした
                                   //   export: 星座風画像(axisConstellationOverlay.js)でTeddyの点と同じ発色を使うため
const TITLE_OFFSET = 2.6;         // 軸中央/終端点から、タイトルをどれだけ離すか

// 「点」はhotspots.jsの星と同じく、明るい色のシンプルな球にする。
// bloomパス(bloomThreshold=0.35)が明るい色をそのまま光らせてくれるので、
// 特別なシェーダーを使わずMeshBasicMaterialの色だけで「発光する点」に見える。
//
// raiseAboveOthers: trueにすると、他の透明/半透明オブジェクト(Z軸の波動関数など)より
// 必ず手前に描画されるようにする(depthTest無効化+renderOrderを上げる)。
// 波動関数が視覚的に点を覆い隠して見失わせる問題への対処で、今のところZ軸の点だけに使う。
function makeDot({ raiseAboveOthers = false } = {}) {
  const material = new THREE.MeshBasicMaterial({ color: DOT_COLOR });
  if (raiseAboveOthers) material.depthTest = false;
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(DOT_RADIUS, 16, 16), material);
  if (raiseAboveOthers) mesh.renderOrder = 10;

  // 見た目のサイズ(DOT_RADIUS)はそのまま、クリック判定だけ広げるための当たり判定球を子として追加する。
  // ※ material.visible=false での「見えないヒット判定用メッシュ」は、iHitのコメントにある通り
  //   環境によってraycastが拾わないことがあるため使わない。ここもyzPanel/iHitと同じ実績のある方式
  //   (visible=trueのまま、ほぼ完全に透明=opacity限りなく0)にする。
  // main.js側は raycaster.intersectObject(dot, true) で再帰的に判定し、この子ごとヒット扱いにする。
  const hitArea = new THREE.Mesh(
    new THREE.SphereGeometry(DOT_HIT_RADIUS, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
  );
  mesh.add(hitArea);

  return mesh;
}

// 持続タイトル(Nine Stories / The Catcher in the Rye)用のテキスト設定。
// ※以前はここでtextColor/shadowColor/shadowBlurFactorを指定していたが、
//   makeTextSprite側にそれらを実際に使うコードが無く「指定しても無視される」バグがあった。
//   結果として実際に描画されていたのはmakeTextSpriteの既定値(明るめの色・shadowBlurFactor=0.08)。
//   そちらの見た目(ブラー強め)の方を採用したいとのことなので、あえて上書きせず既定値のままにする。
const TITLE_TEXT_OPTS = {};

// ── 隠しボタン「i」(虚数単位)。Y軸ステーション限定 ──────
// Teddyの点(yEndDot)と同じ「発光する点」の仕組みを流用しつつ、
//   ・常時は完全非表示(当たり判定のメッシュだけがシーンに存在する)
//   ・ホバーしている間だけ緑色の "i" がフェードイン/アウトする
//   ・見た目は指定のPNG(i-icon.png: 白背景を透過にし、#39ff8cに着色済み)を使う
// という「隠しボタン」の見た目にする。ホバー判定・クリック判定はmain.js側(pointermove/click)で行い、
// このモジュールはヒット用メッシュ(iHit)・見た目(iSprite)・フェード制御(setIHovered)だけを提供する。
//
// グロー(発光)は手動でぼかしを焼き込まず、hotspots.jsの星やTeddyの点と同じ考え方に乗せる:
// bloomパス(bloomThreshold=0.35)が明るい色をそのまま光らせてくれるので、
// PNG側は素の緑色のままにして、エンジンのbloomにグローを任せている。
const I_BUTTON_OFFSET = 1.6;   // 原点からの距離(Y軸の逆方向 = 画面上で原点の「左隣」)
const I_HIT_RADIUS = 0.70;     // ← 面積を半分にした(元は2.0。半径は√0.5倍 ≈ 0.707倍)
const I_ICON_URL = new URL('./data/i-icon.png', import.meta.url).href; // ← 白背景を透過処理済み・#39ff8cに着色済みのPNG
const I_WORLD_WIDTH = 0.45;    // アイコンの表示サイズ(ワールド単位)。元画像が縦長(300×762)なので高さは比率で決める
const I_WORLD_HEIGHT = I_WORLD_WIDTH * (762 / 300);

const textureLoader = new THREE.TextureLoader();

function makeIconSprite(url, worldWidth, worldHeight) {
  const texture = textureLoader.load(url);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldHeight, 1);
  return sprite;
}

export function createAxisStationOverlay(scene) {
  const group = new THREE.Group();
  scene.add(group);

  // ── Y軸 ──────────────────────────────────────
  const yStationView = getAxisStationView(AXIS_WORLD_DIR.Y, AXIS_LENGTH);

  const yEndDot = makeDot();
  yEndDot.position.copy(AXIS_WORLD_DIR.Y.clone().normalize().multiplyScalar(AXIS_LENGTH));
  yEndDot.userData.axisName = 'Y';
  yEndDot.userData.contentKey = 'end';
  yEndDot.visible = false;
  group.add(yEndDot);

  // 原点側の点(クリックで"A Perfect Day for Bananafish"を表示。X/Zのoriginと同じ形式)。
  // ※ 隠しiボタン(iHit, 原点から-Y方向へI_BUTTON_OFFSET=1.6の位置)とは当たり判定半径が
  //   一部重なる可能性があるが、X/Z原点の点と同じ配置ルールを優先してそのまま(0,0,0)に置く。
  //   実際にクリックしづらい/誤反応する場合はどちらかの当たり判定半径を調整する。
  const yOriginDot = makeDot();
  yOriginDot.position.set(0, 0, 0);
  yOriginDot.userData.axisName = 'Y';
  yOriginDot.userData.contentKey = 'origin';
  yOriginDot.visible = false;
  group.add(yOriginDot);

  const yTitleSprite = makeTextSprite(AXIS_CONTENT.Y.axis?.title || '', {
    canvasWidth: 1024, canvasHeight: 320, fontPx: 152, worldWidth: 12.8, worldHeight: 4.0, // ← 2倍サイズ(将来のGlass Sagaタイトルも同サイズを使う想定)
    ...TITLE_TEXT_OPTS,
  });
  const yMid = AXIS_WORLD_DIR.Y.clone().normalize().multiplyScalar(AXIS_LENGTH / 2);
  // 「下」はワールド座標の-Yではなく、Y軸ステーションのカメラup方向の逆側
  // (=このステーションから見て画面下に見える方向)を使う。
  yTitleSprite.position.copy(yMid.clone().addScaledVector(yStationView.up, -TITLE_OFFSET));
  yTitleSprite.visible = false;
  group.add(yTitleSprite);

  // 当たり判定は、yzPanel.mesh と同じ方式にする: material.visible=false で消すのではなく、
  // 「実際にvisible=trueのまま、ほぼ完全に透明(opacity限りなく0)」にして描画自体はさせる。
  // (以前はMeshBasicMaterial({visible:false})方式にしていたが、それだと環境によっては
  //  raycastが拾わないケースがあったため、実績のあるyzPanelの方式に合わせた)
  // visible自体は showY()/hideY() で切り替える(=yzPanelのsetActiveがmesh.visibleを切り替えるのと同じ考え方)。
  const iHit = new THREE.Mesh(
    new THREE.SphereGeometry(I_HIT_RADIUS, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false })
  );
  iHit.position.copy(AXIS_WORLD_DIR.Y.clone().normalize().multiplyScalar(-I_BUTTON_OFFSET));
  iHit.userData.isImaginaryButton = true;
  iHit.visible = false; // Yステーション到達時にshowY()でtrueにする
  group.add(iHit);

  const iSprite = makeIconSprite(I_ICON_URL, I_WORLD_WIDTH, I_WORLD_HEIGHT);
  iSprite.position.copy(iHit.position);
  iSprite.material.opacity = 0;
  iSprite.visible = false;
  group.add(iSprite);

  let iHovered = false;
  // main.js側のpointermoveから呼ぶ。ホバー状態が変わったときだけフェードのトゥイーンを張り直す。
  function setIHovered(hovered) {
    if (hovered === iHovered) return;
    iHovered = hovered;
    if (hovered) iSprite.visible = true;
    gsap.to(iSprite.material, {
      opacity: hovered ? 1 : 0,
      duration: hovered ? 0.35 : 0.5,
      ease: hovered ? 'power2.out' : 'power2.in',
      onComplete: () => { if (!hovered) iSprite.visible = false; },
    });
  }
  function isIHovered() { return iHovered; }

  function showY() {
    yEndDot.visible = true;
    yOriginDot.visible = true;
    yTitleSprite.visible = true;
    iHit.visible = true; // ← 隠しiボタンの当たり判定を有効化(yzPanelのsetActive(true)と同じ考え方)
  }
  function hideY() {
    yEndDot.visible = false;
    yOriginDot.visible = false;
    yTitleSprite.visible = false;
    iHit.visible = false; // ← 当たり判定ごと無効化
    // Yステーションを離れるときは、隠しiボタンも即座に(アニメ無しで)消しておく
    gsap.killTweensOf(iSprite.material);
    iSprite.visible = false;
    iSprite.material.opacity = 0;
    iHovered = false;
  }

  // ── X軸 ──────────────────────────────────────
  const xStationView = getAxisStationView(AXIS_WORLD_DIR.X, AXIS_LENGTH);

  // 終端の点(持続表示。クリック操作は無し)
  const xEndDot = makeDot();
  xEndDot.position.copy(AXIS_WORLD_DIR.X.clone().normalize().multiplyScalar(AXIS_LENGTH));
  xEndDot.userData.axisName = 'X';
  xEndDot.userData.contentKey = 'end'; // ← Yのend(Teddy)と同じ仕組みでクリック対応(main.js側)
  xEndDot.visible = false;
  group.add(xEndDot);

  // 終端点の「上」に持続タイトル("The Catcher in the Rye")
  const xTitleSprite = makeTextSprite(AXIS_CONTENT.X.axis?.title || '', {
    canvasWidth: 1280, canvasHeight: 320, fontPx: 124, worldWidth: 15.6, worldHeight: 3.8, // ← 2倍サイズ(将来のGlass Sagaタイトルも同サイズを使う想定)
    ...TITLE_TEXT_OPTS,
  });
  xTitleSprite.position.copy(xEndDot.position.clone().addScaledVector(xStationView.up, TITLE_OFFSET));
  xTitleSprite.visible = false;
  group.add(xTitleSprite);

  // 原点側の点(クリックで"Central Park"を表示。Yのend/Teddyと同じ形式)。
  // バナナ(Bananafishオブジェクト)は演出上、割れて飛び散った後は画面上で非表示になる
  // (visible=falseだとraycastも自動的にスキップされる)ため、避ける必要は無い。
  // 素直に原点(0,0,0)へ置く。
  const xOriginDot = makeDot();
  xOriginDot.position.set(0, 0, 0);
  xOriginDot.userData.axisName = 'X';
  xOriginDot.userData.contentKey = 'origin';
  xOriginDot.visible = false;
  group.add(xOriginDot);

  function showX() {
    xEndDot.visible = true;
    xTitleSprite.visible = true;
    xOriginDot.visible = true;
  }
  function hideX() {
    xEndDot.visible = false;
    xTitleSprite.visible = false;
    xOriginDot.visible = false;
  }

  // ── Z軸 ──────────────────────────────────────
  // X/Yと同じく、原点・終端それぞれにクリックで表示する点(X原点/Yend/Teddyと同じ形式)を置く。
  // さらに持続タイトル(axis: "Glass Saga")を軸全体を貫く名前として中央付近に表示する
  // (Y軸の"Nine Stories"と同じ、軸中央+ステーションup方向オフセットの置き方)。
  const zStationView = getAxisStationView(AXIS_WORLD_DIR.Z, AXIS_LENGTH);

  const zEndDot = makeDot({ raiseAboveOthers: true }); // ← 波動関数(zAxisWave)より必ず手前に描画する
  zEndDot.position.copy(AXIS_WORLD_DIR.Z.clone().normalize().multiplyScalar(AXIS_LENGTH));
  zEndDot.userData.axisName = 'Z';
  zEndDot.userData.contentKey = 'end';
  zEndDot.visible = false;
  group.add(zEndDot);

  const zOriginDot = makeDot({ raiseAboveOthers: true }); // ← 同上
  zOriginDot.position.set(0, 0, 0);
  zOriginDot.userData.axisName = 'Z';
  zOriginDot.userData.contentKey = 'origin';
  zOriginDot.visible = false;
  group.add(zOriginDot);

  const zTitleSprite = makeTextSprite(AXIS_CONTENT.Z.axis?.title || '', {
    canvasWidth: 1024, canvasHeight: 320, fontPx: 152, worldWidth: 12.8, worldHeight: 4.0, // ← X/Yの持続タイトルと同じ2倍サイズ
    ...TITLE_TEXT_OPTS,
  });
  const zMid = AXIS_WORLD_DIR.Z.clone().normalize().multiplyScalar(AXIS_LENGTH / 2);
  // Y軸と同じく「下」はワールド-Yではなく、Z軸ステーションのカメラup方向の逆側を使う
  zTitleSprite.position.copy(zMid.clone().addScaledVector(zStationView.up, -TITLE_OFFSET));
  zTitleSprite.visible = false;
  group.add(zTitleSprite);

  function showZ() {
    zEndDot.visible = true;
    zOriginDot.visible = true;
    zTitleSprite.visible = true;
  }
  function hideZ() {
    zEndDot.visible = false;
    zOriginDot.visible = false;
    zTitleSprite.visible = false;
  }

  return {
    group,
    yEndDot, yOriginDot, yTitleSprite, showY, hideY,
    iHit, iSprite, setIHovered, isIHovered, // ← 隠しiボタン(Y軸限定)
    xEndDot, xTitleSprite, xOriginDot, showX, hideX,
    zEndDot, zOriginDot, zTitleSprite, showZ, hideZ,
  };
}