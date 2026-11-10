import * as THREE from 'three';
import {
  ARCHER_POS, AXIS_X_FAR, TUNE,
  AXIS_WORLD_DIR, AXIS_LENGTH, AXIS_STATION,
  HOME_CAMERA_POS, HOME_CAMERA_TARGET, AUDITORIUM_CAMERA_DISTANCE,
} from './config.js';
import { createSceneSetup } from './sceneSetup.js';
import { attachScrollDrivenRain } from './waveSurfacePass.js';
import { createStars } from './stars.js';
import { createSagittarius } from './sagittarius.js';
import { createArcherArt } from './archerArt.js';
import { createArrow } from './introActors.js';
import { createBanana } from './banana.js';
import { createAxes } from './axes.js';
import { createZAxisWave } from './zAxisWave.js';
import { createAxisLabels } from './axisLabels.js';
import { createYZPanel } from './yzPanel.js';
import { createNineBall } from './nineBall.js';
import { createBananafish } from './bananafish.js';
import { createEarth } from './earth.js';
import { createHotspots } from './hotspots.js';
import { createDialogue } from './dialogue.js';
import { createCaptionBox, makeCaptionController, getSourceCaption } from './captions.js';
import { isSavingWorkActive } from './galaxyGrowth.js';
import { createIntroSequence } from './introSequence.js';
import { getAxisStationView, flyToAxisStation, AUDITORIUM_CAMERA_POS, AUDITORIUM_CAMERA_TARGET, AUDITORIUM_CAMERA_DIR, CAMERA_HARD_LIMIT, CAMERA_GRAVITY_START, CAMERA_GRAVITY_MAX_SPEED } from './config.js';
import { createAxisStationOverlay } from './axisStationOverlay.js';
import { createAxisConstellationOverlay } from './axisConstellationOverlay.js';
import { AXIS_CONTENT } from './data/axisContent.js';
import { createTrigger, runTrigger, handleIconClick } from './trigger.js';
import { createEquationAssembly, startPhase1, zoomToEquation, startPhase2 } from './equationAssembly.js';
import { playOriginBurst, takeBurstAxisRedraw } from './originBurst.js';
import { createAuditorium, enterAuditorium, toggleAuditoriumEquation, updateAuditorium, RECORD_ANCHOR, revealTripodRing, liftTripod, startTripodRoofPulse, createAuditoriumProjectionMixer, auditoriumSignedMixFromDistance, unlockIh, setTripodAngularSpeed, setCarouselScale, setIhFade } from './auditorium.js';
import { createGalaxy, updateGalaxy, revealGalaxy, GALAXY_RADIUS, configureGalaxyWater, setGalaxyWater, getGalaxyWaterTrail, setGalaxyArmEmphasis, setGalaxyDifferentialRotation, setGalaxyRotationHeld, ANGULAR_SPEED as GALAXY_ANGULAR_SPEED } from './galaxy.js';
import { createFairyTale, updateFairyTale } from './fairyTale.js'; // 巨大バナナ+冠を投げる二体問題の遊び(物理はtwoBody.js)。

// 銀河の中心・carouselの縮小の基準点(旧solarSystem.jsのORBIT_CENTER。auditorium.jsのRECORD_ANCHORと同じ点)。
const GALAXY_CENTER = RECORD_ANCHOR;
import { createTiltShift } from './tiltShift.js';
import { createAStar } from './aStar.js';
import {
  createRecordDisplay, startRecordDisplay, tryRecordClick, updateRecordDisplay,
  applyScroll, SCROLL_MAX, bindClickStar, revealBulgeAfterCrowning, growGalaxyToOverviewScale, openGalaxyHole,
} from './record.js';

// YZパネルクリック時、メインカメラをビリヤード専用ページと同じ構図にする。
const BILLIARD_CAMERA_POS = new THREE.Vector3(AXIS_LENGTH / 2, -AXIS_LENGTH / 2, AXIS_LENGTH / 2);
const BILLIARD_CAMERA_TARGET = new THREE.Vector3(AXIS_LENGTH / 2, AXIS_LENGTH / 2, 0); // パネル中央(=9,9,0)
const BILLIARD_TRANSITION_DURATION = 1.3; // yzPanel.js のRIPPLE_SPEEDと揃えている(パネル対角線を走り抜ける時間)

const SAGITTARIUS_MESSAGE = { text: '*Shirley you said you were sagitarius\nbut your only taurus bring your skates\nwhen you come over to my house*', work: 'The Catcher in the Rye'}

// オーディトリアムのtripod(auditorium.axesGroup)先端のX/Y/Zラベルをクリックしたときに表示するメッセージ。
const AXIS_TIP_MESSAGES = {
  X: { text: 'Gimme the pieces.', work: 'The Catcher in the Rye' },
  Y: { text: 'Life is a gift horse in my opinion.', work: 'Teddy' },
  Z: { text: 'When the horse arrived, it turned out indeed to be a superlative animal.', work: 'Raise High the Roof Beam, Carpenters' },
};

// 隠しボタン「i」(虚数単位)をクリックしたときに表示するメッセージ。
const IMAGINARY_BUTTON_MESSAGE = 'A ZEN KOAN';

// 2点間を線形補間するシンプルなカメラフライト(flyToAxisStationの球面補間とは別物)。
// ホーム⇄軸ステーションの往復ではなく、パネル→ビリヤード専用ページの「覗き込む」動きに使う。
// camera.upは直前の軸ステーション用カスタムupを引き継いでおり、world上向きとは限らない。
// WORLD_UPへ明示的に補間しないとlookAt()の基準が崩れ、カメラが逆さまになる。
const WORLD_UP = new THREE.Vector3(0, 1, 0);

function flyCameraLinear(camera, controls, targetPos, targetLookAt, duration, onComplete) {
  if (controls) controls.enabled = false;
  const startPos = camera.position.clone();
  const startTarget = controls ? controls.target.clone() : new THREE.Vector3();
  const startUp = camera.up.clone();
  const progress = { t: 0 };
  const lookAt = new THREE.Vector3();

  return gsap.to(progress, {
    t: 1,
    duration,
    ease: 'power2.inOut',
    onUpdate: () => {
      camera.position.lerpVectors(startPos, targetPos, progress.t);
      lookAt.lerpVectors(startTarget, targetLookAt, progress.t);
      camera.up.copy(startUp).lerp(WORLD_UP, progress.t).normalize();
      camera.lookAt(lookAt);
    },
    onComplete: () => {
      camera.position.copy(targetPos);
      camera.up.copy(WORLD_UP);
      camera.lookAt(targetLookAt);
      if (controls) {
        controls.target.copy(targetLookAt);
        controls.enabled = true;
        controls.update();
      }
      if (onComplete) onComplete();
    }
  });
}

// ── シーン一式のセットアップ ─────────────────────
const { scene, camera, renderer, controls, composer, lookTarget, excludeFromBloom, render, setProjectionMix, wavePass } = createSceneSetup();
// 波面(雨紋+屈折)をスクロール操作に連動させる。実装の差し替えはwaveSurfacePass.js側だけで完結する。
const waveScrollController = attachScrollDrivenRain({ field: wavePass });
// ティルトシフト(tiltShift.js): 最後の俯瞰スクロールで、カメラが最も低い間だけcarouselの範囲にピントを合わせ、その上下をぼかす。
// composerの後段にパスを差し込むだけで、strength=0の間はパス自体が無効になり他の場面に影響しない。
const tiltShift = composer ? createTiltShift(composer) : null;
// OrbitControlsの右ボタン機能(既定=パン)を無効化する。右ボタンはauditorium.isActive中の「左右ボタン同時ドラッグ」
// (疑似正射影⇄透視図の切り替え・fovズーム)専用で、auditorium以前は右ボタンで何も起きない。
if (controls) controls.mouseButtons.RIGHT = null;
// オーディトリアムの右ドラッグ切り替え専用(AUDITORIUM_CAMERA_POSの角度を維持したまま距離・fovだけ変える)。
// setProjectionMix(ホーム画面用)とは別物なので混同しないこと。
const setAuditoriumProjectionMix = createAuditoriumProjectionMixer(camera);

const starField = createStars(scene, 3000);
// 星の発光はstars.jsのシェーダー(点スプライトに描くMoffat分布)で表現するため、どのBloomにも入れない。
//  ・UnrealBloomPass(bloomComposer): 小さい点だと低解像度ミップのせいで光暈が四角くなる。
//  ・丸いBloom(includeInRoundBloom): Moffatと二重に発光してしまう。
excludeFromBloom(starField.mesh);

const clock = new THREE.Clock();

const hotspotMeshes = createHotspots(scene);
// hotspotの発光はhotspots.jsのシェーダーで自前に描く(通常のhotspot=stars.jsと同じMoffat点スプライト、starburst=光芒+先端の星の板)。
// そのため全hotspotをBloom対象から外す(子の発光板・点・判定球もexcludeFromBloom(m)でまとめて除外される)。
hotspotMeshes.forEach((m) => excludeFromBloom(m));

// 銀河俯瞰(overviewActive)中だけ、starburstの星を縮小carouselの代わりに表示する(下記STARBURST_*参照)。
const starburstMeshes = hotspotMeshes.filter((m) => m.userData.isStarburst);
// starburstは「carouselを拡大したときのつなぎ」専用。縮小したcarouselと同じ位置(GALAXY_CENTER)に置き、carouselの代わりに見せる。
//  ・クリック判定は持たない(銀河を育てるクリックはAスター: record.js bindClickStar)。
//  ・ズームが進むほど、実寸の1倍から STARBURST_SWAP_SCALE 倍へ(対数補間で)膨らむ。
//    すり替え閾値(CAROUSEL_SWAP_ZOOM_SHOW)に達した瞬間にcarouselへ置き換わる。
//  ・starburst/Aスターは見える芯がバウンディングボックスより小さく、1倍だとcarouselより小さく見える。倍率で見かけを揃える。
//  ・window.starburstRatio / window.aStarRatio をコンソールで設定すると、STARBURST_SWAP_SCALE / A_STAR_VISUAL_RATIO をその場で上書きできる
//    (見ながら決め、決まった値を下の定数へ書き戻す)。
const STARBURST_SWAP_SCALE = 4.0;    // 仮値。すり替え直前のstarburstの倍率(実寸比)
// ── 最後の俯瞰での「carousel一式」(carousel・starburst・Aスター)の大きさと位置 ──
//   大きさ: 下のCAROUSEL_PHYSICAL_SIZE(carouselの実寸)・STARBURST_PHYSICAL_SIZE(starburst/Aスターの実寸)。
//   位置: 数式(tripodの頂点の上の方程式)が銀河の中心(GALAXY_CENTER)に来る。そこからの移動量がOVERVIEW_ITEMS_OFFSET_Y(+で上)。
//   window.carouselScaleMul / window.starburstScaleMul / window.carouselOffsetY をコンソールで設定すると、その場で倍率・移動量を試せる(決まった値を下の定数へ書き戻す)。
const OVERVIEW_ITEMS_OFFSET_Y = 0;   // 仮値。一式を上へずらす量(ワールド単位)。0=銀河の中心ぴったり。未定のため0
const _overviewItemsCenter = new THREE.Vector3();
function overviewItemsCenter() { // 一式の置き場所(銀河の中心+移動量)
  return _overviewItemsCenter.copy(GALAXY_CENTER).setY(GALAXY_CENTER.y + (window.carouselOffsetY ?? OVERVIEW_ITEMS_OFFSET_Y));
}
const A_STAR_VISUAL_RATIO = 1.0;     // 仮値。Aスターの見かけの大きさの補正倍率
const STAR_MIN_PIXELS = 3; // 仮値。Aスター/starburstの最小の見かけの大きさ(px)。実寸が小さくなる遠景でも「見つけられる点」としてこの大きさは保つ。

const trigger = createTrigger(scene);
let triggerActive = false; // TRIGGER開始後はcameraBusy/controlsとは別に、全インタラクションを止める
// iアイコンはtravelToOrigin途中(p.t>0.85)でフェードイン・クリック判定ONになるが、その時点でカメラはまだtravelToDest途中のことがある。
// startPhase1はcomputeScreenFrame(camera)でその瞬間のカメラ姿勢を基準に記号・星を配置するため、静止前にクリックされると配置がズレる。
// そこでtravelToDest完了(onDone)までiクリックの処理を保留するためのフラグ。
let triggerCameraSettled = false;

// ── Phase2(数式クリックでのズーム・②③④展開)関連の状態 ──
let equationComplete = false; // ①(iħ∂ψ/∂t=Ĥψ)が完成した瞬間にtrueへ
let equationZoomed = false;   // 数式へズームイン済みか
let equationVertexWorld = null; // ズーム・Phase2配置計算に使う頂点(=緑iだった場所)のワールド座標
let equationFrame = null;       // computeScreenFrame(camera)のスナップショット(ズーム時のカメラ姿勢基準)

const { state: bananaState, triggerShatter } = createBanana(scene);

const archer = createSagittarius(scene, ARCHER_POS);
archer.visible = false;
// 射手座の発光はsagittarius.js側(色ずれハロー)で描くため、Bloom対象から外す。
excludeFromBloom(archer);

// オープニング演出でのみ浮かび上がる射手座アートワーク(3D空間に固定されたSprite)。
// ARCHER_POSからのオフセットで配置。ズレを直したい場合はこのVector3を調整する。
const archerArtPos = new THREE.Vector3(
  ARCHER_POS.x + 54,
  ARCHER_POS.y - 40,
  ARCHER_POS.z
);
const archerArt = createArcherArt(scene, archerArtPos, { width: 288, height: 192, blurPX: 3 });

const arrowGroup = createArrow(scene);

const equationAssembly = createEquationAssembly(scene, camera);
// 数式シンボルのBloom(発光・にじみ)強度。
const EQUATION_BLOOM_INTENSITY = 0.7;
Object.values(equationAssembly.sprites).forEach((sprite) => excludeFromBloom(sprite, EQUATION_BLOOM_INTENSITY));
// 軸(createAxes)もBloom対象から外す。axes.jsの中身に依存しないよう、createAxes()がsceneへ追加した直下の子を差分で拾って除外する。
const _childrenBeforeAxes = new Set(scene.children);
const axes = createAxes(scene);
scene.children.filter((c) => !_childrenBeforeAxes.has(c)).forEach((c) => excludeFromBloom(c));
const auditorium = createAuditorium(scene); // Phase2以降に画面クリックで遷移する「オーディトリアム」(星なし・回転する三軸+方程式画像)
// オーディトリアムのtripod軸(auditorium.axesGroup)もBloom対象から外す。
// 数式のグローはauditorium.js側でテクスチャに焼き込む(EQUATION_GLOW)ため、二重がけ防止でBloomは除外のまま。
if (auditorium.axesGroup) excludeFromBloom(auditorium.axesGroup);
// レコード(auditorium.goldenRing)は、銀河俯瞰で画面上小さく見えるとき(望遠鏡モードの既定fov)に白飛びする。
// UnrealBloomPassはミップベースで、対象が小さいほど相対的に強くブルームするため(starField/equationAssembly/バルジと同じ原因)、Bloom強度を弱める。
// goldenRingはオーディトリアムの他場面(carousel表示時など、画面上で十分大きい)でも同一インスタンスを使うので、0にはせず中間値にしている。
// 仮値: 近くでの見映え優先なら上げる、俯瞰時の白飛び抑制を優先なら下げる。
const GOLDEN_RING_BLOOM_INTENSITY = 0.35;
excludeFromBloom(auditorium.goldenRing, GOLDEN_RING_BLOOM_INTENSITY);
// オーディトリアム内では、tripod(auditorium.js: 金のリング→円錐状の粒子→ih.png)に加えて、
// 銀河(galaxy.js)・レコードプレーヤー操作パネル(record.js)も共存する。
// 銀河の中心はGALAXY_CENTER(auditorium.jsのRECORD_ANCHOR)に合わせる。
const galaxy = createGalaxy(scene, GALAXY_CENTER);
// galaxy.opaquePoints(トーンアームの透過用に追加した不透明な核レイヤー)は輝きレイヤー(galaxy.points)に隠れる小さな点だが、
// UnrealBloomPassは小さく硬い点に弱く、Bloom対象に入ると全体が余分に明るく・ぼやけて見える。starFieldと同じ理由で除外する。
excludeFromBloom(galaxy.opaquePoints);
// tripod/carouselの自転速度も、銀河の公転速度(GALAXY_ANGULAR_SPEED。config.jsのGALAXY_ROTATION_PERIODから導出済み)に合わせる。
setTripodAngularSpeed(GALAXY_ANGULAR_SPEED);
// レコードプレーヤー(操作パネル): カメラ背後の鏡三脚+バナナ→銀河出現→銀河クリックで針、という一連の流れを管理する(詳細はrecord.js冒頭)。
// 銀河は新規作成せず、上で作った既存のgalaxyを使う。
const record = createRecordDisplay(scene, renderer, { camera, galaxy, auditorium, excludeFromBloom });
// 銀河をクリックで育てる星はAスター(aStar.js)。登場はトーンアーム設置後(record.js revealClickStar)。
// 生成直後は非表示にしておき、bindClickStarがバルジ中心へ付ける(バルジの表示/非表示に連動)。
// 尾(スターダスト)はワールド座標なので、静止中も漂うよう idleRate を与える。
// 大きさはanimateで毎フレーム(carouselの実寸に合わせて)決める。A_STAR_SCALEは初期値(仮値)。
const A_STAR_SCALE = 1;
const aStar = createAStar(scene, { maxParticles: 300, idleRate: 25, life: 2.0, size: A_STAR_SCALE, spread: 0.3 });
aStar.scale.setScalar(A_STAR_SCALE);
aStar.visible = false;
bindClickStar(record, aStar);
// starburstはクリック判定を持たないためrecordへは渡さない(animateのcarouselすり替えだけで使う)。
// 「巨大バナナ+冠を投げる二体問題」(fairyTale.js)を置く。
//   戴冠(位置の重なり)に成功 → onCrownCoronation(元の戴冠シーンの画角へ)。失敗(戴冠せずスクロール) → そのカメラ状態から俯瞰モード。
const fairyTale = createFairyTale(scene, camera, renderer, {
  center: GALAXY_CENTER, galaxyRadius: GALAXY_RADIUS, excludeFromBloom,
  onCoronation: (mode) => onCrownCoronation(mode),
  onSunk: () => onCrownSunk(),
});

// バナナクリック後の演出(戴冠→リング拡大→リング消滅)が完了した瞬間に、record.js(playNeedleSequence内のonRingContact)から呼ばれるフック。
// recordSequenceDoneは、スクロール/左右ドラッグの用途を銀河俯瞰へ切り替える判定に使う(wheelハンドラ・レンダーループ)。
let recordSequenceDone = false;
record.onSequenceComplete = () => {
  recordSequenceDone = true;
};

// 戴冠に成功したとき(fairyTale.jsから呼ばれる)。カメラを「元の戴冠シーン」の画角へ寄せる:
//   距離は遠景(AUDITORIUM_CAMERA_DISTANCE)のまま、場(水面の円=銀河の半径)が画面の横幅にちょうど収まるfovまで絞る(疑似正射影に近い)。
//   完了したらrecordSequenceDone=trueにして、以後のスクロールは銀河俯瞰モード(enterGalaxyOverview)へつながる。
//   ★ 戴冠後の「既存銀河(レコード)を穴のサイズに合わせて形成」はこのフック(完了時)に足す予定(第2段階)。
const CROWN_SCENE_DURATION = 8.0;     // 仮値。カメラが引く時間(以前は3秒。進行が速すぎたので遅くした)
const CROWN_WATER_RELEASE_SEC = 6.0;  // 戴冠した瞬間から、水面モードを解いて全ての星を見せるまでの時間
const CROWN_BULGE_SEC = 5.0;          // 沈みきったあと、バルジが現れる時間(record.jsのBULGE_REVEAL_FADE_DURATIONは3秒)
let carouselAppeared = false;         // 戴冠イベント(成功・失敗とも)の後にcarousel一式を出現させたか
// 戴冠イベント後にcarousel一式(リング・浮上したtripod・粒子の軌跡)を出現させる。成功=演出完了時 / 失敗=俯瞰へ入った時。
//   リング(goldenRing)は生成時にopacity 0・非表示で、出現させる処理(旧tripodRingSwap)が廃止されているため、ここで出す。
function appearCarousel() {
  if (carouselAppeared) return;
  carouselAppeared = true;
  revealTripodRing(auditorium);
  liftTripod(auditorium);
  startTripodRoofPulse(auditorium);
  // ihもcarousel一式に含める。出現条件(ihUnlocked=左右同時ドラッグ)はドラッグシステム保留のため、ここで解除してフェードインさせる。
  //   以後の表示/非表示は俯瞰中のcarousel条件(carouselVisible)が決める。
  unlockIh(auditorium);
  const ihFade = { v: 0 };
  gsap.to(ihFade, { v: 1, duration: 2.0, ease: 'power2.out', onUpdate: () => setIhFade(auditorium, ihFade.v) });
  const ring = auditorium.goldenRing;
  ring.visible = true;
  gsap.to(ring.material, { opacity: 1, duration: 2.0, ease: 'power2.out' });
}
// ihを見せてよいか: 戴冠イベントの後(carouselAppeared)で、カメラの実際の仰角(水平からの角度)が負のとき。
const _ihCamOffset = new THREE.Vector3();
function ihAllowed() {
  if (!carouselAppeared) return false;
  _ihCamOffset.copy(camera.position).sub(AUDITORIUM_CAMERA_TARGET);
  return _ihCamOffset.y < 0;
}
let bulgeRevealed = false;            // バルジへの交換は戴冠成功時だけ。失敗時はfalseのまま(俯瞰でもバルジ・Aスターは出さない)
let crownScenePending = 0;            // カメラの演出とバルジの演出の両方が終わったら、recordSequenceDone=trueにする
function crownSceneDone() {
  if (--crownScenePending > 0) return;
  recordSequenceDone = true;
  appearCarousel(); // 成功: 戴冠イベントが終わったらcarousel一式を出す
  fairyTale.finish();
}
function onCrownCoronation(mode) {
  setGalaxyRotationHeld(galaxy, false); // 戴冠した瞬間から銀河を回し始める
  releaseGalaxyWater(CROWN_WATER_RELEASE_SEC); // 水面モードは戴冠前だけ。戴冠したらゆっくり全ての星を見せる
  crownScenePending = 2;
  diveTarget = 0; diveCurrent = 0; diveApplied = false; // 入水中に戴冠した場合は、入水はここで終了(カメラは下のtweenが元の画角へ戻す)
  growGalaxyToOverviewScale(record, { duration: CROWN_SCENE_DURATION }); // 成功時も銀河を2倍化(バルジ登場(沈みきり後)までに完了する)
  if (projectionReturnTween) { projectionReturnTween.kill(); projectionReturnTween = null; }
  const startPos = camera.position.clone();
  const startFov = camera.fov;
  const endPos = AUDITORIUM_CAMERA_TARGET.clone().addScaledVector(AUDITORIUM_CAMERA_DIR, AUDITORIUM_CAMERA_DISTANCE);
  const halfWidthFov = 2 * Math.atan(GALAXY_RADIUS / (AUDITORIUM_CAMERA_DISTANCE * camera.aspect));
  const endFov = THREE.MathUtils.radToDeg(halfWidthFov);
  const p = { t: 0 };
  gsap.to(p, {
    t: 1, duration: CROWN_SCENE_DURATION, ease: 'power2.inOut',
    onUpdate: () => {
      // 位置・fovとも対数補間にすると距離感の変化が均等になる(fovは桁が変わるため)。
      camera.position.lerpVectors(startPos, endPos, p.t);
      camera.fov = startFov * Math.pow(endFov / startFov, p.t);
      camera.updateProjectionMatrix();
      camera.lookAt(AUDITORIUM_CAMERA_TARGET);
    },
    onComplete: crownSceneDone,
  });
}
// バナナと冠が沈みきったとき(fairyTale.jsから呼ばれる): バルジへ切り替える。
function onCrownSunk() {
  bulgeRevealed = true;
  revealBulgeAfterCrowning(record, { duration: CROWN_BULGE_SEC, onComplete: crownSceneDone });
}

// ── スクロールによる画面切り替え(下=鏡、上=carousel)・銀河のscrub ──
// 累積スクロール量を0〜SCROLL_MAXにクランプしてrecord.jsへ渡す(画面の向き・銀河の出現度合いの計算はrecord.js側)。
//
// ── 「左右ボタン同時ドラッグ」の代替入力(トラックパッド対応) ──
// macのトラックパッドは左右ボタンを同時に押せないため、次のどれも同じ操作として扱う。
//  ・左右ボタン同時押しのままドラッグ
//  ・左ボタン(トラックパッドのクリック)+Shiftを押したままドラッグ
//  ・2本指の横スワイプ(wheelのdeltaX。applyProjectionWheel / applyOverviewFovWheel)
// Altは使わない(OrbitControlsの通常の回転と衝突するため)。ShiftはenablePan=falseの間は無害。
const ZOOM_GESTURE_WHEEL_IDLE_MS = 250; // 横スワイプがこの時間(ms)途切れたら「ボタンを離した」扱い(慣性分は待つ)
function isDragGestureDown(e) {
  return e.buttons === 3 || (e.buttons === 1 && e.shiftKey);
}
let recordScrollY = 0;
// ── 入水(戴冠前のスクロール) ──
const DIVE_SCROLL_RANGE = 600;   // 仮値。この累積スクロール量で、開始位置→入水の限度まで沈む
const DIVE_SMOOTHING = 3.0;      // 仮値。入水の追従のなめらかさ(俯瞰のOVERVIEW_HEIGHT_SMOOTHINGと同じ流儀)
let diveTarget = 0;              // 0=開始位置 / 1=入水の限度(OVERVIEW_ELEVATION_MIN_DEG)
let diveCurrent = 0;             // 毎フレームdiveTargetへ近づく実際の値
let diveApplied = false;         // 仰角を上書きした状態か(0へ戻りきったときに1回だけ元へ戻すため)
const _diveOffset = new THREE.Vector3();
const _diveSpherical = new THREE.Spherical();
// 毎フレーム: 戴冠前(未俯瞰・演出中でない)のあいだ、ドラッグ(ズーム)が決めた距離・fovはそのままに、仰角だけを入水の量で上書きする。
function updateDive(deltaSeconds) {
  if (overviewActive || recordSequenceDone || fairyTale.busy) return;
  diveCurrent = THREE.MathUtils.lerp(diveCurrent, diveTarget, 1 - Math.exp(-DIVE_SMOOTHING * deltaSeconds));
  if (Math.abs(diveCurrent - diveTarget) < 1e-3) diveCurrent = diveTarget;
  if (diveCurrent === 0 && !diveApplied) return;
  const elevationDeg = THREE.MathUtils.lerp(AUDITORIUM_BASE_ELEVATION_DEG, OVERVIEW_ELEVATION_MIN_DEG, diveCurrent);
  _diveOffset.copy(camera.position).sub(AUDITORIUM_CAMERA_TARGET);
  _diveSpherical.setFromVector3(_diveOffset);
  _diveSpherical.phi = THREE.MathUtils.clamp(Math.PI / 2 - THREE.MathUtils.degToRad(elevationDeg), 0.001, Math.PI - 0.001);
  camera.position.setFromSpherical(_diveSpherical).add(AUDITORIUM_CAMERA_TARGET);
  camera.lookAt(AUDITORIUM_CAMERA_TARGET);
  diveApplied = diveCurrent > 0;
}
// 戴冠失敗の確定。そのカメラ状態から俯瞰モード(enterGalaxyOverview)へ入る。★ 失敗を確定させる条件が未定のため、今はどこからも呼んでいない(スクロールでは呼ばない)。
function commitFailureToOverview() {
  fairyTale.abort(); // 失敗: バナナ・冠は消さずに残す(バルジへの交換もしない)
  openGalaxyHole(record); // 失敗時も穴は成功時と同じ大きさにあける(バルジの代わりにバナナが入る)
  growGalaxyToOverviewScale(record, { duration: CROWN_SCENE_DURATION }); // 失敗時も銀河を2倍化
  appearCarousel(); // 失敗: 俯瞰のcarousel側(仰角0°未満)で出る
  if (projectionReturnTween) { projectionReturnTween.kill(); projectionReturnTween = null; } // 開始位置へ戻す途中のtweenが俯瞰フライトと衝突しないように止める
  recordSequenceDone = true;
  overviewScrollTarget = overviewScrollCurrent = 0; // 俯瞰の最下端(=入水の限度の角度)から始める
  applyGalaxyOverviewScroll(0);
}
renderer.domElement.addEventListener('wheel', (e) => {
  if (!auditorium.isActive) return; // オーディトリアム内でのみ有効
  e.preventDefault();
  // バナナクリック後は、戴冠演出(record.coronationStarted)の開始から一連の演出完了(recordSequenceDone)までスクロールを受け付けない。
  if (record.coronationStarted && !recordSequenceDone) return;
  if (fairyTale.busy) return; // 戴冠演出中(カメラ移動中)はスクロール・ドラッグを受け付けない
  // トラックパッドの2本指「横」スワイプ(deltaX優勢)は縦スクロールではなく「左右ボタン同時ドラッグ」の代替として扱う(e.ctrlKey=ピンチは何もしない)。
  if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    if (recordSequenceDone) applyOverviewFovWheel(e.deltaX);
    else applyProjectionWheel(e.deltaX);
    return;
  }
  // 演出完了(recordSequenceDone)後は、スクロールの用途をcarousel⇔鏡の切り替えから「銀河俯瞰カメラの高さ調整」へ切り替え、applyScroll(record, ...)は呼ばない(record.viewMixTargetが無駄に動くのを避けるため)。
  if (recordSequenceDone) {
    applyGalaxyOverviewScroll(e.deltaY);
    return;
  }
  // 戴冠前の縦スクロール = 入水。カメラの仰角が、開始位置(≈+2.03°)から入水の限度(≈-2.03°)まで、スクロールに合わせて連続的に下がる(上スクロール=沈む / 下スクロール=戻る)。
  //   限度(入水の下限)で止まり、スクロールし続けても俯瞰モードにはならない。俯瞰に入れるのは戴冠イベント(recordSequenceDone)の後だけ。
  diveTarget = THREE.MathUtils.clamp(diveTarget - e.deltaY / DIVE_SCROLL_RANGE, 0, 1);
}, { passive: false });

// ── レコード完成後(recordSequenceDone)の俯瞰カメラ: 望遠鏡のUX ──
// 近づく移動は一切しない。変えるのは高さ(仰角)とfov(光学ズーム)だけ。
// 基準位置はauditorium開始位置そのもの(config.jsのAUDITORIUM_CAMERA_POS)。
//  - スクロール: AUDITORIUM_CAMERA_TARGETを中心とした球面座標の仰角だけを、0°(auditorium開始時の見下ろし角)〜
//    OVERVIEW_ELEVATION_MAX_DEGの範囲で変える。targetからの距離(半径)は常に一定。
//  - 左右同時ドラッグ: fovだけを変える光学ズーム(位置は不変)。ドラッグ中のみ拡大でき、離すと既定fovへ戻る。
// 仰角はすべて「水平(0°)基準の実際の角度」。開始位置(基準姿勢=望遠で銀河を見ていた角度)は約+2.03°(AUDITORIUM_CAMERA_DIRから算出)。
// 入水の限度はその対称の負の角度(-基準姿勢)。以前は「基準姿勢からの相対角」だったため、-2は実際には+0.03°(ほぼ水平)でしかなかった。
const OVERVIEW_ELEVATION_MAX_DEG = 50;    // 仰角の上限(度)
const OVERVIEW_HEIGHT_SMOOTHING = 3.0;    // 仮値。スクロールでの仰角変化をなめらかにする係数(record.jsのVIEW_MIX_SMOOTHINGと同じ流儀)
// 銀河俯瞰モードに入るとき・左右ドラッグを解除したときのカメラ速度の比率。下の2つの所要時間(フライト・fov復帰)をこの値で割って引き伸ばす(0.05なら20倍の時間。1で元の速さ)。
const OVERVIEW_CAMERA_SPEED_RATIO = 0.05;
const OVERVIEW_TRANSITION_DURATION = 1.2 / OVERVIEW_CAMERA_SPEED_RATIO; // 銀河俯瞰(=telescopeの基準姿勢)へ最初に戻すフライトの秒数(元1.2秒→24秒)
// スクロール量(0〜OVERVIEW_SCROLL_RANGE)→仰角(度)。MIN(=-基準姿勢の角度)〜MAXを線形に振る。
function overviewElevationDegForScroll(scroll) {
  return OVERVIEW_ELEVATION_MIN_DEG + (scroll / OVERVIEW_SCROLL_RANGE) * (OVERVIEW_ELEVATION_MAX_DEG - OVERVIEW_ELEVATION_MIN_DEG);
}
const OVERVIEW_SCROLL_RANGE = 1200;       // 仮値。この累積スクロール量で仰角が0°⇔MAXまで振れる
// fovは基準・最大ズームとも直接の角度で指定する。
const OVERVIEW_FOV_BASE = 70;             // 銀河俯瞰時の既定(ドラッグしていない)fov。
// 露出: 左右ドラッグのfovズーム(望遠側)に絞り(露出)を連動させる。基準状態(広角・視点が遠い)ほど絞って暗く、目一杯ズームした状態ほど絞りを開けて通常の明るさに戻す。俯瞰突入フライト・ドラッグ中・ドラッグ解除で戻る動きのすべてで、fovと同じタイミングで動く。
const OVERVIEW_EXPOSURE_FAR_MULT = 0.005;  // 仮値。基準fov(遠景)側の露出倍率。1より下げて絞る
const OVERVIEW_EXPOSURE_ZOOM_MULT = 1.0;  // 目一杯ズームした側の露出倍率(通常の明るさ)
// zoomT(ズーム進行度)はOVERVIEW_FOV_ZOOMEDとOVERVIEW_FOV_BASEの比で決まり、starburstの膨らみ・すり替え・露出・注視点の寄せがzoomTに連動する。したがってOVERVIEW_FOV_*を変えると、それらの曲線も一緒に動く。
// carouselは実寸(ワールド単位)で一定とし、ズームはカメラのfovだけで行う。
//  ・CAROUSEL_PHYSICAL_SIZE: carouselの最大の広がり。銀河の星1個は約0.7単位なので、6はその約8倍。
//  ・最大ズームでcarouselが画面の高さの CAROUSEL_MAX_ZOOM_SCREEN_FRACTION を占めるよう、OVERVIEW_FOV_ZOOMEDを実寸から逆算する
//    (視野の高さ=実寸÷占有率、fov=2·atan(視野の高さ÷2÷距離))。
//  ・fovが極端に狭いと注視点のズレや描画精度の問題が出やすいため、OVERVIEW_FOV_MINで下限を置く。下限に当たると占有率には届かない。
const CAROUSEL_PHYSICAL_SIZE = 0.6;                 // 仮値。carouselの実寸(ワールド単位)。以前は6(1/10にした=量子サイズ)
const STARBURST_PHYSICAL_SIZE = 1.2;                // 仮値。starburst・Aスターの実寸(ワールド単位)。以前は6(1/5にした)
const CAROUSEL_MAX_ZOOM_SCREEN_FRACTION = 0.24;     // 仮値。最大ズームで画面の高さに占める割合
const OVERVIEW_FOV_MIN = 0.005;                     // 仮値。fovの下限(度)。carouselを1/10にしたので、最大ズームのfovも約1/10(≈0.024°)になる。以前は0.05
const OVERVIEW_FOV_ZOOMED_WANTED = THREE.MathUtils.radToDeg(
  2 * Math.atan(CAROUSEL_PHYSICAL_SIZE / CAROUSEL_MAX_ZOOM_SCREEN_FRACTION / 2 / AUDITORIUM_CAMERA_DISTANCE));
const OVERVIEW_FOV_ZOOMED = Math.max(OVERVIEW_FOV_MIN, OVERVIEW_FOV_ZOOMED_WANTED); // 目一杯ドラッグしたときの最大ズーム
// 星(銀河・バルジ・Aスターの尾)の点の大きさをズームに合わせて大きくする係数(zoomFactor)。星はシェーダーが「ピクセル数」で描くため、そのままだとfovを狭めてもcarouselだけが拡大されて見える。係数=tan(基準fov/2)÷tan(現在fov/2)を掛けて実寸のまま拡大する。
// 露出は明るさに掛け算で効くため、線形補間だと 1→0.005 の途中の変化がフライト終盤に集中し、遠景に着く前後で急に暗く見える。
// そこで露出は常に対数(等比)補間で動かし、fov(ズーム)の進み具合から計算する(overviewExposureForFov)。
// フライト・ドラッグ・解除で戻る動きのどれでも、同じズーム量なら同じ明るさになる。
// OVERVIEW_EXPOSURE_DIM_CURVE: 1.0=純粋な等比。1より小さいと遠景へ向かう早い段階から暗くし始める(トーンマップで白飛びが残り、最後に急に暗くなる場合に下げる)。
const OVERVIEW_EXPOSURE_DIM_CURVE = 1.0;
// carouselの縮小とstarburstとのすり替え: carouselが小さい間はstarburstで代替し、拡大(fovズーム)が閾値を越えたらcarouselへすり替える。
//  ・carouselの倍率はfovズームでは変えない。俯瞰突入フライト(前半)で 1→carouselScaleFinal(=CAROUSEL_PHYSICAL_SIZE÷実寸。animate内)へ対数補間で縮み、以後は一定。拡大はfovだけが担う。
//  ・zoomTはfovから対数で求める(overviewZoomProgress)。fovも対数補間で動かしているので、ドラッグ量に対して均等に進む。
//  ・すり替えはzoomTだけで判定(SHOW以上でcarousel、HIDE未満でstarburst。ちらつき防止のヒステリシス)。
//  ・すり替え判定は縮小フライト終了後(!overviewFlightInProgress)に行う。突入直後はzoomT=0でstarburst側に倒れ、縮小中のcarouselが見えなくなるため。
//  ・starburstはトーンアーム設置などの条件なしに、常に「つなぎ」役。
// 見かけの大きさは「倍率 ÷ (カメラ距離 × tan(fov/2))」で決まる。俯瞰フライトではカメラが距離約41→10000へ約250倍遠ざかるため、
// 倍率の縮小(0.05)はその陰に隠れて見えない。そこでフライトを2段に分ける:
//  ①前半(CAROUSEL_SHRINK_PHASE。全体に対する時間の割合): カメラは動かさず、carouselだけがその場で縮む。
//  ②後半: カメラが遠景へ退く(位置・fov・露出)。
const CAROUSEL_SHRINK_PHASE = 0.2;           // 仮値。24秒×0.2=約5秒かけて、その場で縮ませる
// carouselの最終倍率は、実寸(CAROUSEL_PHYSICAL_SIZE)を、測った実際の広がり(carouselNativeSize)で割って決める。
// 最大ズームでの見かけの大きさは「倍率÷(距離×tan(fov/2))」で決まるので、OVERVIEW_FOV_ZOOMEDを実寸から逆算しておけば(上記)、
// 最大ズームでcarouselが画面の高さの CAROUSEL_MAX_ZOOM_SCREEN_FRACTION を占める。
let carouselNativeSize = 30;                        // carouselの実寸(最大の広がり)。俯瞰突入時に実測して上書きする(下のmeasureCarouselNativeSize)。実測できなければこの概算値
// 実寸は決め打ちにせず、tripod・数式スプライト・リングを含む実際の広がり(Box3)を、倍率1のうち(俯瞰突入の直前)に測る。
function measureCarouselNativeSize() {
  if (!auditorium.carouselRoot) return;
  auditorium.carouselRoot.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(auditorium.tripodAnchor);
  box.expandByObject(auditorium.goldenRing);
  const size = box.getSize(new THREE.Vector3());
  const ws = auditorium.tripodAnchor.getWorldScale(new THREE.Vector3()).x || 1;
  const n = Math.max(size.x, size.y, size.z) / ws;
  if (isFinite(n) && n > 1) carouselNativeSize = n;
}
// すり替え閾値。starburstが小さいまま大きなcarouselへ切り替わると不自然なので、切り替えをズームが進んだ所に置き、starburstを切り替え地点へ向けて膨らませる(STARBURST_SWAP_SCALE参照)。
const CAROUSEL_SWAP_ZOOM_SHOW = 0.92;       // 仮値。zoomTがこれ以上でcarouselへすり替え(fovで約0.24°)
const CAROUSEL_SWAP_ZOOM_HIDE = 0.85;       // 仮値。これを下回ったらstarburstへ戻す
let carouselShownAsCarousel = true;         // すり替え状態(trueでcarousel、falseでstarburst)
let starburstBaseSize = null;                // starburstメッシュのscale=1での広がり(初回に実測)
const _tmpScale = new THREE.Vector3();
let starZoomMaterials = [];                 // uZoomを持つ星のマテリアル(銀河・バルジ・Aスターの尾)
let starZoomRefreshTimer = 0;
const OVERVIEW_FOV_DRAG_DISTANCE = 400;   // 仮値。このぶん(px)左右ドラッグしたらズームが振り切る
const OVERVIEW_FOV_RESET_DURATION = 0.6 / OVERVIEW_CAMERA_SPEED_RATIO; // ドラッグを離したときにbase fovへ戻る秒数(元0.6秒→12秒)

// 仰角がOVERVIEW_HIDE_SPLIT_DEG未満ならバルジ側(バルジ・Aスター・失敗時のバナナと冠)を隠し、以上ならcarousel(tripod一式)を隠す(境界は1本)。
const OVERVIEW_HIDE_SPLIT_DEG = 0; // 境界(度)。以前は8。0°=水面の高さ: 水面より下(-2°〜0°)がcarousel側、0°以上がバルジ(失敗時はバナナ)側

// ── ティルトシフト(被写界深度風)の設定 ─────────────────────────
// 仰角0°(一番低い=ミクロ全開)ではcarouselにだけピントが合い、上下がぼける。仰角が上がるにつれてぼけが解け、
// OVERVIEW_ELEVATION_MAX_DEG(一番高い=マクロ)で完全にクリアになる。全区間で途切れなく連続的に変化する。
// 強さは仰角だけの純粋な関数で、carouselの表示/非表示には依存しない(非表示後も投影計算は有効な値を返す)。
// 帯の位置・幅はcarouselの実寸から毎フレーム画面座標へ投影して求めるので、fovや画面サイズが変わっても追従する。
const TILT_SHIFT_CURVE = 1.6; // 1で仰角に対して線形。大きいほど下の方(ミクロ側)でボケが急に強まる
const TILT_SHIFT_FLIGHT_EASE = (t) => t * t * (3 - 2 * t); // 立ち上がりのイージング(smoothstep)
// ティルトシフトの強さは、カメラのフライト時間とは無関係にスクロール量(仰角)だけで決まる(フライト進行度を掛けると、24秒のフライト中ぼけがスクロールに追従しなくなる)。俯瞰モードに入った瞬間の唐突さだけを、下の短い固定時間のイントロで吸収する。
const TILT_SHIFT_INTRO_DURATION = 0.6; // 俯瞰モードに入った瞬間だけのフェードイン秒数(固定。カメラ速度の影響を受けない)
let tiltShiftIntroStart = null;        // 俯瞰モードに入った時刻(clock.getElapsedTime())。null=未計測


const _tsBoxA = new THREE.Box3();
const _tsBoxB = new THREE.Box3();
const _tsRingPos = new THREE.Vector3();
const _tsCylinder = { center: new THREE.Vector3(), radius: 1, yMin: 0, yMax: 1 };

// carousel(tripod一式+リング)を囲む円柱を求める。
//   - 軸(x,z)と半径: リング(goldenRing)。tripodの底面外接円と同じ半径・同じ軸まわりで自転するので、
//     回転してもブレない。
//   - 高さ: tripodAnchor+goldenRingのワールドBox3のyの範囲(Y軸まわりの回転ではyの範囲は変わらない)。
function computeCarouselCylinder() {
  const ring = auditorium.goldenRing;
  ring.getWorldPosition(_tsRingPos);
  _tsBoxA.setFromObject(auditorium.tripodAnchor);
  _tsBoxB.setFromObject(ring);
  _tsBoxA.union(_tsBoxB);

  const ringParams = ring.geometry && ring.geometry.parameters;
  const ringRadius = ringParams && ringParams.radius
    ? ringParams.radius * ring.getWorldScale(new THREE.Vector3()).x
    : AXIS_LENGTH * Math.sin(THREE.MathUtils.degToRad(54.7356)); // record.jsのMIRROR_TRIPOD_RADIUSと同じ式

  _tsCylinder.center.copy(_tsRingPos);
  _tsCylinder.radius = ringRadius;
  _tsCylinder.yMin = _tsBoxA.min.y;
  _tsCylinder.yMax = _tsBoxA.max.y;
  return _tsCylinder;
}

// 毎フレーム(カメラ更新の後・render()の前)に呼ぶ。
function updateTiltShiftEffect() {
  if (!tiltShift) return;

  let strength = 0;
  if (overviewActive) {
    // ① スクロール(仰角=カメラの高さ)だけで決まる、ピント帯の強さ。カメラの速度・フライト時間・
    //    carouselの表示/非表示には一切依存しない。仰角0(一番低い)〜MAX(一番高い)の全区間で
    //    途切れなく連続的に変化し、0(マクロ)側で完全にボケが消え、MAXでは足踏みしない。
    const elevationDeg = overviewElevationDegForScroll(overviewScrollCurrent);
    const elevationT = THREE.MathUtils.clamp(elevationDeg / OVERVIEW_ELEVATION_MAX_DEG, 0, 1); // 0=最低(ミクロ)〜1=最高(マクロ)
    const scrollStrength = Math.pow(1 - elevationT, TILT_SHIFT_CURVE);
    // ② 俯瞰モードに入った瞬間だけの短い(0.6秒固定)フェードイン。急に出現するのを避けるためだけのもので、
    //    ①のようにスクロールで戻ってきても再生されない(tiltShiftIntroStartは俯瞰に入った時にしか更新しない)。
    const introT = tiltShiftIntroStart === null
      ? 1
      : THREE.MathUtils.clamp((clock.getElapsedTime() - tiltShiftIntroStart) / TILT_SHIFT_INTRO_DURATION, 0, 1);
    strength = scrollStrength * TILT_SHIFT_FLIGHT_EASE(introT);
  }

  tiltShift.setStrength(strength);
  if (strength > 0.001) {
    const cyl = computeCarouselCylinder();
    tiltShift.setFocusFromCylinder(camera, cyl);
  }
}

// AUDITORIUM_CAMERA_TARGETを中心とした球面座標(半径・仰角・方位角)。仰角0°=このまま
// (=AUDITORIUM_CAMERA_POSそのもの)、仰角を上げるほどtargetの真上寄りへ弧を描いて
// 移動する(半径=targetからの距離は不変)。
const OVERVIEW_BASE_OFFSET = new THREE.Vector3().subVectors(AUDITORIUM_CAMERA_POS, AUDITORIUM_CAMERA_TARGET);
const OVERVIEW_BASE_SPHERICAL = new THREE.Spherical().setFromVector3(OVERVIEW_BASE_OFFSET);
const AUDITORIUM_BASE_ELEVATION_DEG = 90 - THREE.MathUtils.radToDeg(OVERVIEW_BASE_SPHERICAL.phi); // 開始位置の仰角(≈+2.03°)
const OVERVIEW_ELEVATION_MIN_DEG = -AUDITORIUM_BASE_ELEVATION_DEG; // 仰角の下限=入水の限度。望遠で銀河を見ていた角度と対称の負の角度(≈-2.03°)

let overviewActive = false;      // telescopeモードへの移行が完了(または移行中)かどうか
// overviewScrollTarget/Current: ホイールのたびに高さを即反映せず、record.js(viewMixCurrent)と同じ「target(即時更新)→current(毎フレーム指数スムージングで追従)」の2段構えにしてなめらかにする。
let overviewScrollTarget = 0;  // 0〜OVERVIEW_SCROLL_RANGE。0=仰角0°(基準姿勢)から開始
let overviewScrollCurrent = 0; // 毎フレームtargetへなめらかに近づく実際の値(仰角の計算に使う)
let overviewFovDragActive = false;
let overviewFovDragStartX = 0;
let overviewFovResetTween = null;      // ドラッグ解除時のbaseへ戻すtween(次のドラッグ開始時にkillする)
let overviewExposureResetTween = null; // ↑と同じタイミングで、露出を絞り側へ戻すtween
let overviewBaseExposure = 1;          // enterGalaxyOverview完了時に確定する「基準露出」。以後の絞り計算の元になる
let overviewFlightInProgress = false; // enterGalaxyOverviewの基準姿勢フライト中かどうか
let overviewFlightT = 0;              // 基準姿勢フライトの進行度(0〜1)。ティルトシフトの立ち上がりに使う
// 固定3本の腕を太くする演出のtween進行度。galaxy.jsのsetGalaxyArmEmphasisへそのまま渡す(growGalaxyArms/calmGalaxyArms参照)。
const galaxyArmEmphasis = { t: 0 }; // 0=通常、1=固定3本の腕が太く・明るく強調された状態

// 仰角(度)からカメラのワールド座標を計算する(半径・方位角は基準のまま固定=近づかない)。
function overviewPositionForElevationDeg(elevationDeg) {
  const elevationRad = THREE.MathUtils.degToRad(elevationDeg);
  const spherical = OVERVIEW_BASE_SPHERICAL.clone();
  // phiはY軸(上)からの角度。水平=90°。仰角(水平からの見下ろす角度)を増やすほどtargetの真上に近づく=phiを減らす。
  spherical.phi = THREE.MathUtils.clamp(Math.PI / 2 - elevationRad, 0.001, Math.PI - 0.001);
  spherical.makeSafe();
  return new THREE.Vector3().setFromSpherical(spherical).add(AUDITORIUM_CAMERA_TARGET);
}

// 現在のoverviewScrollCurrentから仰角を計算し、カメラへ反映する(距離は常に一定=
// 近づく移動は発生しない)。
const _overviewLookTarget = new THREE.Vector3();
const _carouselPivot = new THREE.Vector3();
const _carouselTarget = new THREE.Vector3();
function applyOverviewCameraHeight() {
  const elevationDeg = overviewElevationDegForScroll(overviewScrollCurrent);
  camera.position.copy(overviewPositionForElevationDeg(elevationDeg));
  // ズームが進むほど注視点を銀河中心(GALAXY_CENTER=縮小したcarouselとstarburstの位置)へ寄せる(狭いfovでは注視点のわずかなずれが画面外へのずれになるため)。zoomT=0ではAUDITORIUM_CAMERA_TARGETのまま。
  _overviewLookTarget.lerpVectors(AUDITORIUM_CAMERA_TARGET, overviewItemsCenter(), overviewZoomProgress());
  camera.lookAt(_overviewLookTarget);
}

// 毎フレーム呼ぶ(animate内、overviewActive中のみ有効)。overviewScrollCurrentをoverviewScrollTargetへ指数スムージングで近づけ、カメラへ反映する。
// 基準姿勢へ戻すフライト(enterGalaxyOverview)中もoverviewScrollCurrentの更新は常に行い、スクロール量をリアルタイムに反映し続ける。
// フライト中はcamera.positionへの適用だけをenterGalaxyOverviewのonUpdateに任せる(毎フレーム上書きし合うとlerpが効かなくなるため)。
// onUpdate側はフライト開始位置から「今のoverviewScrollCurrentに対応する位置」へflight.tでブレンドするので、
// フライト終了(t=1)の時点で既にスクロール量と一致しており、以後すぐ自由にスクロールできる。
function updateOverviewCameraHeight(deltaSeconds) {
  if (!overviewActive) return;
  const smoothing = 1 - Math.exp(-OVERVIEW_HEIGHT_SMOOTHING * deltaSeconds);
  overviewScrollCurrent = THREE.MathUtils.lerp(overviewScrollCurrent, overviewScrollTarget, smoothing);
  if (overviewFlightInProgress) return; // 位置の反映はフライトのonUpdateに任せる(下記)
  applyOverviewCameraHeight();
}

// ── 銀河の固定3本の腕(galaxy.jsのGALAXY_ARM_EMPHASIS_BRANCHES=[0,3,6]、120°間隔)を太く・明るく強調する演出 ──
//  - growGalaxyArms(): 俯瞰視点(telescopeモード突入=enterGalaxyOverview)で呼ぶ。0→1へアニメーションし、3本だけが浮き上がって見える。
//  - calmGalaxyArms(): 1→0へ戻す。現時点で呼び出し元はない(トーンアーム設置の完了ハンドラから呼ぶ想定で用意してある)。
const GALAXY_ARM_GROW_DURATION = 1.8; // 仮値。腕が太くなっていく速さ(秒)
const GALAXY_ARM_CALM_DURATION = 1.2; // 仮値。calmGalaxyArms()で元に戻す速さ(秒)

function growGalaxyArms() {
  gsap.to(galaxyArmEmphasis, {
    t: 1,
    duration: GALAXY_ARM_GROW_DURATION,
    ease: 'power2.out',
    onUpdate: () => setGalaxyArmEmphasis(galaxy, galaxyArmEmphasis.t),
  });
}

// eslint-disable-next-line no-unused-vars -- 将来のtonearm設置ギミックからの呼び出し用に用意
function calmGalaxyArms() {
  gsap.to(galaxyArmEmphasis, {
    t: 0,
    duration: GALAXY_ARM_CALM_DURATION,
    ease: 'power2.inOut',
    onUpdate: () => setGalaxyArmEmphasis(galaxy, galaxyArmEmphasis.t),
  });
}

// 最初のスクロールで一度だけ呼ぶ: 右ドラッグ等でズレていたカメラ位置/fovを、telescopeの基準姿勢
// (AUDITORIUM_CAMERA_POS=仰角0°・base fov)へ滑らかに戻す。今の位置から基準位置へ寄せるだけで、銀河へ近づく移動はしない。
const galaxyWater = { v: 0 }; // 水面モードの度合い(0〜1)。tween用
// 俯瞰モード突入で水面モードを解除し、全ての星を見せる。
function releaseGalaxyWater(duration = 1.5) {
  gsap.killTweensOf(galaxyWater);
  gsap.to(galaxyWater, { v: 0, duration, ease: 'power2.inOut' }); // setGalaxyWaterはanimateで毎フレーム(カメラの実位置も掛けて)呼ぶ
}

function enterGalaxyOverview() {
  if (overviewActive) return;
  overviewActive = true;
  setGalaxyRotationHeld(galaxy, false); // 戴冠せずに俯瞰へ入った場合も、銀河は回す
  releaseGalaxyWater();
  measureCarouselNativeSize(); // 倍率1のうちに実寸を測る
  tiltShiftIntroStart = clock.getElapsedTime(); // ここからTILT_SHIFT_INTRO_DURATION秒だけティルトシフトをフェードイン
  if (controls) controls.enabled = false; // telescopeモード中は専用のスクロール/ドラッグでのみ制御する

  // 俯瞰視点に入ったこのタイミングで、固定3本の腕の強調を始める。
  growGalaxyArms();

  // トーンアーム(ガラス製。位置決めはrecord.js側)は、銀河俯瞰に入るこの時点まで表示を遅らせる。
  if (record.tonearm) record.tonearm.visible = true;

  // 銀河俯瞰時は、実際の銀河のように中心に近いほど角速度を速くする(差動回転)。
  // アームを置く(placeTonearmOnRecord)側でfalseに戻し、剛体回転へ戻す。
  setGalaxyDifferentialRotation(galaxy, true);

  const startPos = camera.position.clone();
  const startFov = camera.fov;
  carouselShownAsCarousel = true; // 突入時はcarouselから始める(すり替えはフライト終了後、fovが決める)
  const startExposure = renderer.toneMappingExposure; // 突入前の露出(=以後の基準値)
  const targetExposure = startExposure * OVERVIEW_EXPOSURE_FAR_MULT;
  const flight = { t: 0 };
  const easeInOut = gsap.parseEase('power2.inOut');
  overviewFlightInProgress = true;
  gsap.to(flight, {
    t: 1,
    duration: OVERVIEW_TRANSITION_DURATION,
    ease: 'none', // 時間の進みは線形のまま受け取り、下で縮小用/カメラ用にそれぞれeaseをかける
    onUpdate: () => {
      // ①前半: carouselの縮小だけ(shrinkT 0→1)。②後半: カメラの退き(moveT 0→1)。
      const shrinkT = easeInOut(Math.min(flight.t / CAROUSEL_SHRINK_PHASE, 1));
      const moveT = easeInOut(Math.max((flight.t - CAROUSEL_SHRINK_PHASE) / (1 - CAROUSEL_SHRINK_PHASE), 0));
      // ブレンド先は固定の目的地ではなく、「今スクロールが指している仰角」の位置を毎フレーム計算する。
      // updateOverviewCameraHeight()がフライト中もoverviewScrollCurrentを更新し続けるので、フライト中のスクロールも
      // moveTの重みで少しずつ反映され、終わる頃にはスクロール操作と完全に一致する。
      const elevationDeg = overviewElevationDegForScroll(overviewScrollCurrent);
      const basePos = overviewPositionForElevationDeg(elevationDeg);
      camera.position.lerpVectors(startPos, basePos, moveT);
      camera.fov = THREE.MathUtils.lerp(startFov, OVERVIEW_FOV_BASE, moveT);
      // 露出はfovと同じ進み方の等比補間(OVERVIEW_EXPOSURE_*のコメント参照)。
      renderer.toneMappingExposure = startExposure
        * Math.pow(OVERVIEW_EXPOSURE_FAR_MULT, Math.pow(moveT, OVERVIEW_EXPOSURE_DIM_CURVE));
      camera.updateProjectionMatrix();
      camera.lookAt(AUDITORIUM_CAMERA_TARGET);
      overviewFlightT = shrinkT; // carousel縮小の進行度(カメラの進行度ではない)
    },
    onComplete: () => {
      overviewFlightInProgress = false;
      overviewFlightT = 1;
      renderer.toneMappingExposure = targetExposure; // 誤差の丸め込み
      overviewBaseExposure = startExposure; // 以後のドラッグ絞り計算の基準
    },
  });
}

// ホイールハンドラから呼ぶ: 未突入ならtelescopeの基準姿勢へ戻すトリガーとしてだけ使い、
// 突入済みならtargetを更新するだけにする(実際の反映はupdateOverviewCameraHeightが
// 毎フレームなめらかに追従させる)。
function applyGalaxyOverviewScroll(deltaY) {
  if (!overviewActive) {
    enterGalaxyOverview();
    return;
  }
  overviewScrollTarget = THREE.MathUtils.clamp(overviewScrollTarget + deltaY, 0, OVERVIEW_SCROLL_RANGE);
}

// 左右ボタン同時押しドラッグ(または左ボタン+Shift)でfov(光学ズーム)だけを調整する。位置は変えない。telescopeモード中(overviewActive)のみ有効。
// ドラッグしている間だけ拡大でき、離すとbase fovへ戻る。
// enterGalaxyOverview()のフライト中(overviewFlightInProgress)は、そのonUpdateが毎フレームcamera.fov/toneMappingExposureを上書きするため、
// このハンドラを無効にする(有効だと、ドラッグで変えたfovが次フレームでフライト側に書き戻される)。
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!overviewActive || overviewFlightInProgress) return;
  if (overviewFovInputMode === 'wheel') return; // 2本指スワイプ中はポインタ移動で中断しない
  const bothDown = isDragGestureDown(e); // 左右同時押し、または左ボタン+Shift

  if (!overviewFovDragActive) {
    if (!bothDown) return;
    beginOverviewFovDrag('pointer');
    overviewFovDragStartX = e.clientX;
    return;
  }

  if (!bothDown) {
    endOverviewFovDrag();
    return;
  }

  // 左右どちらへドラッグしてもズーム量として扱う(距離が大きいほど狭fov=望遠寄り)。
  applyOverviewFovZoom(Math.abs(e.clientX - overviewFovDragStartX));
});
window.addEventListener('pointerup', () => {
  if (overviewFovDragActive && overviewFovInputMode === 'pointer') endOverviewFovDrag();
});

// トラックパッド用に、2本指の横スワイプ(wheelのdeltaX)でも同じfovズームを操作できる。スワイプがZOOM_GESTURE_WHEEL_IDLE_MS途切れると、ボタンを離したのと同じ扱いでbase fovへ戻る。
let overviewFovInputMode = null;   // null | 'pointer' | 'wheel'
let overviewFovWheelAccum = 0;
let overviewFovWheelTimer = null;

function beginOverviewFovDrag(mode) {
  overviewFovDragActive = true;
  overviewFovInputMode = mode;
  if (overviewFovResetTween) overviewFovResetTween.kill(); // 戻り途中に再ドラッグしたら即座に手動制御へ戻す
  if (overviewExposureResetTween) overviewExposureResetTween.kill(); // 絞りも同様
}

// ズーム進行度(0=基準fov、1=最大ズーム)。fovを等比補間で動かしているため、対数で求める。
function overviewZoomProgress(fov = camera.fov) {
  return THREE.MathUtils.clamp(
    Math.log(OVERVIEW_FOV_BASE / Math.max(fov, 1e-6)) / Math.log(OVERVIEW_FOV_BASE / OVERVIEW_FOV_ZOOMED), 0, 1);
}

// 現在のfovから対応する露出を等比補間で返す(基準fov=遠景で絞る/最大ズームで通常の明るさ)。
// ドラッグ中・ドラッグ解除で戻る動きの両方で使い、露出が常にズームに追従するようにする。
function overviewExposureForFov(fov) {
  const zoomT = overviewZoomProgress(fov);
  const dim = Math.pow(1 - zoomT, OVERVIEW_EXPOSURE_DIM_CURVE); // 1=遠景側、0=最大ズーム側
  return overviewBaseExposure
    * Math.pow(OVERVIEW_EXPOSURE_FAR_MULT, dim)
    * Math.pow(OVERVIEW_EXPOSURE_ZOOM_MULT, 1 - dim);
}

function applyOverviewFovZoom(draggedPx) {
  const zoomT = THREE.MathUtils.clamp(draggedPx / OVERVIEW_FOV_DRAG_DISTANCE, 0, 1);
  camera.fov = OVERVIEW_FOV_BASE * Math.pow(OVERVIEW_FOV_ZOOMED / OVERVIEW_FOV_BASE, zoomT); // 等比(対数)補間
  // 絞りはfovに追従させる(遠景=絞る/望遠=開ける。等比補間)。
  renderer.toneMappingExposure = overviewExposureForFov(camera.fov);
  camera.updateProjectionMatrix();
}

function applyOverviewFovWheel(deltaX) {
  if (!overviewActive || overviewFlightInProgress) return; // フライト中は無効(pointermoveハンドラのコメント参照)
  if (overviewFovInputMode === 'pointer') return;
  if (!overviewFovDragActive) {
    beginOverviewFovDrag('wheel');
    overviewFovWheelAccum = 0;
  }
  overviewFovWheelAccum += deltaX;
  applyOverviewFovZoom(Math.abs(overviewFovWheelAccum));
  if (overviewFovWheelTimer) clearTimeout(overviewFovWheelTimer);
  overviewFovWheelTimer = setTimeout(endOverviewFovDrag, ZOOM_GESTURE_WHEEL_IDLE_MS);
}

// ドラッグ解除時にbase fovへ、早すぎず遅すぎずの速度(OVERVIEW_FOV_RESET_DURATION秒)で
// 戻す。
function endOverviewFovDrag() {
  overviewFovDragActive = false;
  overviewFovInputMode = null; // pointer/wheelどちらのセッションもここで終了
  overviewFovWheelAccum = 0;
  if (overviewFovWheelTimer) { clearTimeout(overviewFovWheelTimer); overviewFovWheelTimer = null; }
  overviewFovResetTween = gsap.to(camera, {
    fov: OVERVIEW_FOV_BASE,
    duration: OVERVIEW_FOV_RESET_DURATION,
    ease: 'power2.out',
    onUpdate: () => {
      camera.updateProjectionMatrix();
      // 戻っていくfovから毎フレーム露出を計算する(露出がズームと同期し、遠景側へ戻るときも急に暗くならない)。
      renderer.toneMappingExposure = overviewExposureForFov(camera.fov);
    },
  });
  if (overviewExposureResetTween) overviewExposureResetTween.kill(); // 旧tweenが残っていれば止める
}

// ── 疑似正射影 ⇄ 透視図の切り替え(左右ボタン同時ドラッグ。左ボタン+Shift・2本指横スワイプでも可) ──
// record.phase!=='inactive'(startRecordDisplay後=carouselから切り替えた後)になって初めて有効にする。
// 一定量ドラッグしたら透視図側へ「確定」させ、record.perspectiveActiveをtrueにする(これでihがunlockIhで出現できるようになる)。
// record.perspectiveActiveは「ドラッグ確定済みか」を示すだけのフラグ。
// 確定前にドラッグを止めた(ボタンを離した)場合は、疑似正射影側へ戻す(仮の挙動)。
let projectionDragActive = false;
let projectionDragStartX = 0;
let projectionMixValue = 0;
const PROJECTION_DRAG_DISTANCE = 400; // このぶん(px)ドラッグしたら透視図へ完全移行する(仮値)

// pointerdownが左右同時押しの瞬間(buttons===3)に発火することには依存せず、pointermoveでe.buttonsを毎回直接見る(pointerdownはブラウザ・OSによって安定しないため。同時押しの後にカーソルが少し動けば確実に拾える)。
renderer.domElement.addEventListener('pointermove', (e) => {
  if (projectionInputMode === 'wheel') return; // 2本指スワイプ中はポインタ移動で中断しない
  const bothDown = isDragGestureDown(e);

  if (!projectionDragActive) {
    if (!bothDown) return;
    // 判定はoverviewActiveではなくrecordSequenceDone(演出完了後は恒久的にtrue)で行う(canStartProjectionDrag)。
    // overviewActiveは最初のスクロール後にしかtrueにならず、演出完了直後・未スクロールの左右ドラッグが旧来の「距離を変えるズーム」(setAuditoriumProjectionMix)を起動してしまうため。
    if (!canStartProjectionDrag()) return; // auditorium開始前・切り替え済み・演出完了後は無視
    projectionDragActive = true;
    projectionInputMode = 'pointer';
    projectionDragStartX = e.clientX;
    return; // 開始位置を記録するだけ。動かすのは次のmoveから
  }

  if (!bothDown || !auditorium.isActive) {
    // 途中でどちらかのボタンを離した(またはauditorium.isActiveでなくなった)→中断して疑似正射影側へ戻す。
    cancelProjectionDrag();
    return;
  }

  updateProjectionDrag(e.clientX - projectionDragStartX); // 右方向ドラッグで透視図へ進める(仮の向き)
});

// ── 投影切り替えの共通処理(ポインタ操作とトラックパッドの2本指スワイプで共用) ──
// 次の入力を同じ処理に流し込む: ①左右ボタン同時押しドラッグ、②左ボタン+Shiftドラッグ(isDragGestureDown)、
// ③2本指の横スワイプ(wheelのdeltaX。applyProjectionWheel参照)。
let projectionInputMode = null;       // null | 'pointer' | 'wheel'(どの入力でセッション中か)
let projectionWheelAccum = 0;         // wheel入力でのdeltaX累積(符号付き)
let projectionWheelTimer = null;      // wheel入力が途切れたら中断するためのタイマー

function canStartProjectionDrag() {
  // ★ 2026-11-09 変更: 確定(perspectiveActive)の概念は廃止。開始位置から左右どちらへも何度でもドラッグでき、離すと開始位置へ戻る。
  return auditorium.isActive && !recordSequenceDone && !fairyTale.busy;
}

// 符号付き: 右ドラッグ(+)=銀河の内側へ(距離39・fov84°)、左ドラッグ(-)=遠景の望遠へ(距離10000・fov0.21°)。0=開始位置(fov74°)。
let projectionReturnTween = null; // 離したときに開始位置(0)へ戻すtween(次のドラッグ開始でkill)
function updateProjectionDrag(draggedPx) {
  if (projectionReturnTween) { projectionReturnTween.kill(); projectionReturnTween = null; }
  projectionMixValue = THREE.MathUtils.clamp(draggedPx / PROJECTION_DRAG_DISTANCE, -1, 1);
  setAuditoriumProjectionMix(projectionMixValue); // AUDITORIUM_CAMERA_DIRの角度を維持したまま距離・fovだけ変える専用ミキサー
}

function cancelProjectionDrag() {
  projectionDragActive = false;
  projectionInputMode = null;
  projectionWheelAccum = 0;
  if (projectionWheelTimer) { clearTimeout(projectionWheelTimer); projectionWheelTimer = null; }
  // 離したら開始位置(0)へなめらかに戻す。
  if (projectionReturnTween) projectionReturnTween.kill();
  const m = { v: projectionMixValue };
  projectionReturnTween = gsap.to(m, {
    v: 0, duration: 1.0, ease: 'power2.out',
    onUpdate: () => { projectionMixValue = m.v; setAuditoriumProjectionMix(m.v); },
    onComplete: () => { projectionReturnTween = null; },
  });
}

// wheelハンドラ(横スワイプ優勢のとき)から呼ぶ。
// deltaXは「ナチュラルスクロール」の設定で符号が反転するため、累積の絶対値で進行量を決める
// (どちら向きにスワイプしても進む。逆向きに戻せば戻る)。
function applyProjectionWheel(deltaX) {
  if (projectionInputMode === 'pointer') return; // ポインタ操作中は無視
  if (!projectionDragActive) {
    if (!canStartProjectionDrag()) return;
    projectionDragActive = true;
    projectionInputMode = 'wheel';
    projectionWheelAccum = 0;
  }
  projectionWheelAccum += deltaX;
  updateProjectionDrag(projectionWheelAccum); // 符号付き(スワイプの向きで内側/遠景が決まる)
  if (projectionWheelTimer) clearTimeout(projectionWheelTimer);
  // 慣性スクロールが終わって一定時間入力が無ければ、ボタンを離したのと同じ扱い(開始位置へ戻す)
  projectionWheelTimer = setTimeout(cancelProjectionDrag, ZOOM_GESTURE_WHEEL_IDLE_MS);
}

renderer.domElement.addEventListener('contextmenu', (e) => {
  // auditorium.isActiveの間だけ右クリックメニューを抑止する(左右同時ドラッグのため)。auditorium開始前は右ボタンに機能を持たせず、ブラウザ既定のメニューも抑止しない。
  if (auditorium.isActive) e.preventDefault();
});

// pointermove側で継続判定しているので、pointerupは「マウスを動かさずにボタンだけ離した」場合の保険として残す。
// wheel(2本指スワイプ)で開始したセッションはpointerupでは終了せず、慣性スクロールを待つ無入力タイマー側で終了する。
window.addEventListener('pointerup', () => {
  if (!projectionDragActive || projectionInputMode !== 'pointer') return;
  // 確定(1)に達しないまま離した場合は、疑似正射影側へ戻す(仮の挙動。一定量ドラッグし切らないと切り替わらない、中断可能な操作感)。
  cancelProjectionDrag();
});

// Z軸の波(zWave)もBloom対象から外す(axesと同じ方法)。
const _childrenBeforeZWave = new Set(scene.children);
const zWave = createZAxisWave(scene); // Z軸:ガウス波束のらせん(軸到達後にreveal、その後ゆっくり位相回転)
scene.children.filter((c) => !_childrenBeforeZWave.has(c)).forEach((c) => excludeFromBloom(c));
const axisLabels = createAxisLabels(scene); // 三軸(X/Y/Z)のラベル(home状態になったら表示)
// 軸ラベル(X/Y/Z)もBloom対象から外す。
Object.values(axisLabels.sprites).forEach((sprite) => excludeFromBloom(sprite));
const axisStationOverlay = createAxisStationOverlay(scene); // X/Y軸ステーション限定の追加表示(終端・原点の点+タイトル)
// オーバーレイ(終端の点+極小スパイクの星+タイトル)もBloom対象から外す。UnrealBloomPassが小さく硬い点を丸い塊に膨らませ、終端のスパイクを埋もれさせるため。
// ただし隠しiボタンの見た目(iSprite)だけはBloomを「かけ直す」ので、group丸ごとではなく、iSprite以外の子(点・星)を個別に除外する。
axisStationOverlay.group.children
  .filter((c) => c !== axisStationOverlay.iSprite)
  .forEach((c) => excludeFromBloom(c));
const axisConstellationOverlay = createAxisConstellationOverlay(scene); // Teddy/Catcherクリック時の星座風画像(現時点ではTeddyのみ画像あり)
const yzPanel = createYZPanel(scene); // Y軸ステーション時、YZ平面(概念Y全長×概念Z全長)に浮かぶ反射・透明パネル
const nineBall = createNineBall({
  // ビリヤード台を閉じたら、Y軸ステーションの視点へカメラを戻す(軸クリック時と同じ飛び方)
  onClose: () => {
    cameraBusy = true;
    const view = getAxisStationView(AXIS_WORLD_DIR.Y, AXIS_LENGTH);
    flyToAxisStation(camera, controls, view, {
      duration: AXIS_STATION.duration,
      onComplete: () => {
        cameraBusy = false;
        currentAxisView = 'Y';
        yzPanel.setActive(true);
        showYOverlay(); // ビリヤード台から戻ってきたら、Y軸ステーションの追加表示も出し直す
      }
    });
  }
});

// Y軸原点の点をクリックしたときに開く「A Perfect Day for Bananafish」専用ページ。
// nineBallと全く同じ仕組み(独立オーバーレイ+onCloseでYステーションへ戻す)。
const bananafish = createBananafish({
  onClose: () => {
    cameraBusy = true;
    const view = getAxisStationView(AXIS_WORLD_DIR.Y, AXIS_LENGTH);
    flyToAxisStation(camera, controls, view, {
      duration: AXIS_STATION.duration,
      onComplete: () => {
        cameraBusy = false;
        currentAxisView = 'Y';
        yzPanel.setActive(true);
        showYOverlay(); // バナナフィッシュのページから戻ってきたら、Y軸ステーションの追加表示も出し直す
      }
    });
  }
});

// Z軸終端の点(Hapworth)をクリックしたときに開く専用ページ(earth_vortex.htmlをオーバーレイ化したもの)。
// bananafishと同じ仕組み(独立オーバーレイ+onCloseでZステーションへ戻す)。
// ※ ページを開いている間もカメラはZステーションから動かしていないので、戻るときはカメラを飛ばさず、
//   cameraBusyを解除してZステーションの追加表示(点・タイトル)を出し直すだけでよい。
const earth = createEarth({
  onClose: () => {
    cameraBusy = false;
    currentAxisView = 'Z';
    showZOverlay();
  }
});

const dialogue = createDialogue(camera);

const intro = createIntroSequence({
  camera, controls, lookTarget, archer, arrowGroup,
  bananaState, triggerShatter, axes,
  TUNE, ARCHER_POS, AXIS_X_FAR,
  HOME_CAMERA_POS, HOME_CAMERA_TARGET,
  archerArt,
});

// ── クリック処理 ───────────────────────────────
const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
// 緑の星(trigger.star)の上だけキャッチャーミット(leftglove.cur)カーソルにする。.curはホットスポットを内包しているので、url()の後ろに座標は書かない。画像が読めないときは 'pointer' にフォールバックする。
const TRIGGER_STAR_CURSOR = "url('.//assets/cur/leftglove.cur'), pointer";
let cameraBusy = false; // 軸間を移動中は多重クリックを無視する
let panelTransitioning = false;
let currentAxisView = null; // 現在到達しているステーションの軸名('X'/'Y'/'Z'/null=まだどこにも到達していない)

// ── Y軸ステーション限定の追加表示(終端の点+「Nine Stories」)のオン/オフ ──
// 表示中はY軸ラベルの「Y」の文字を消し、代わりに終端の点とタイトルを出す。
// カメラが動いた(=controlsの'change')ら元の状態(Yの文字だけの通常表示)に戻す。
let yOverlayActive = false;

function showYOverlay() {
  axisLabels.sprites.Y.visible = false;
  axisStationOverlay.showY();
  yOverlayActive = true;
}

function hideYOverlay() {
  if (!yOverlayActive) return;
  axisLabels.sprites.Y.visible = true;
  axisStationOverlay.hideY();
  axisConstellationOverlay.hideTeddyImage(); // Teddyクリックで出した星座風画像もここで消す
  dialogue.hide(); // 終端の点のセリフを表示中だった場合、10秒タイマーでの誤復帰を防ぐため即閉じる
  yOverlayActive = false;
}

// ── X軸ステーション限定の追加表示のオン/オフ(Yと同じ考え方) ──
let xOverlayActive = false;

function showXOverlay() {
  axisLabels.sprites.X.visible = false;
  axisStationOverlay.showX();
  axes.setXFlowActive(true); // The Catcher in the Rye表示と同じ条件でX軸の流れ演出をオンにする
  xOverlayActive = true;
}

function hideXOverlay() {
  if (!xOverlayActive) return;
  axisLabels.sprites.X.visible = true;
  axisStationOverlay.hideX();
  axes.setXFlowActive(false); // 同上、オフに戻す
  axisConstellationOverlay.hideCatcherImage(); // Catcherの星座風画像もここで消す
  dialogue.hide(); // 原点付近の点のセリフを表示中だった場合、10秒タイマーでの誤復帰を防ぐため即閉じる
  xOverlayActive = false;
}

// ── Z軸ステーション限定の追加表示のオン/オフ(X/Yと同じ考え方) ──
let zOverlayActive = false;

function showZOverlay() {
  axisLabels.sprites.Z.visible = false;
  axisStationOverlay.showZ();
  zOverlayActive = true;
}

function hideZOverlay() {
  if (!zOverlayActive) return;
  axisLabels.sprites.Z.visible = true;
  axisStationOverlay.hideZ();
  dialogue.hide(); // 原点/終端の点のセリフを表示中だった場合、10秒タイマーでの誤復帰を防ぐため即閉じる
  // ここでzWave.reset()は呼ばない。hideZOverlay()は「空白クリックで点/タイトル表示だけ戻す」場合にも呼ばれ、カメラがZステーションに留まっていてもらせんまで消えてしまうため。
  // らせんを消すのは「別の軸へ実際に移動するとき」(下のaxisHit処理)とPhase2突入時のみ。
  zOverlayActive = false;
}

// Z軸原点クリックで、ガウス波束のらせんを原点(画面左)→先端(画面右)へ伸ばして発生させる。
// 既に発生中/発生済みの状態で再度クリックされた場合も、最初からやり直す(reset→reveal)。
let zWaveRevealTween = null;
function triggerZWave() {
  zWaveRevealTween?.kill();
  zWave.reset();
  const waveProgress = { t: 0 };
  zWaveRevealTween = gsap.to(waveProgress, {
    t: 1,
    duration: 2.2,
    ease: 'power2.out',
    onUpdate: () => zWave.reveal(waveProgress.t),
  });
}

// ── Phase2: 数式ズーム時、軸まわりの表示を消す ──
// axisLabels/axisStationOverlayはSpriteのopacityをフェードさせる。axes(軸ライン本体)はfadeOut()があれば呼ぶ(typeof判定)。
function fadeOutAxisVisuals(duration = 1.2) {
  hideXOverlay();
  hideYOverlay();
  hideZOverlay();

  [axisLabels.sprites.X, axisLabels.sprites.Y, axisLabels.sprites.Z].forEach((sprite) => {
    if (!sprite || !sprite.visible) return;
    gsap.to(sprite.material, {
      opacity: 0,
      duration,
      ease: 'power1.out',
      onComplete: () => { sprite.visible = false; },
    });
  });

  yzPanel.setActive(false);

  if (typeof axes.fadeOut === 'function') axes.fadeOut(duration);
  // zWaveにfadeOut()はないため、reset()で強制停止する(フェードなし・即座に非表示)。
  zWave.reset();
}

// カメラ操作(controlsの'change')でY/Xステーションの追加表示を戻すことはしない(カメラ操作に対してシビアすぎるため)。
// 代わりに、下のクリックハンドラの末尾で「何もない場所をクリックした」ことを条件に元へ戻す。

// YZ平面パネルのクリック処理:
// 1) 原点側の角から波紋を発生させる
// 2) それに合わせてメインカメラをビリヤード専用ページと同じ位置・向きへ運ぶ
// 3) 到着したら画面をビリヤード台へ切り替える(オーバーレイをshow)
function onYZPanelClick() {
  if (cameraBusy) return;
  cameraBusy = true;
  panelTransitioning = true; 
  hideYOverlay(); // ビリヤード台へ移動するので、Y軸ステーションの追加表示は元に戻しておく
  hideXOverlay(); // 念のためX側も(通常はYステーションでしか起きない操作だが、状態を必ず揃えておく)

  yzPanel.ripple(clock.getElapsedTime());

  flyCameraLinear(camera, controls, BILLIARD_CAMERA_POS, BILLIARD_CAMERA_TARGET, BILLIARD_TRANSITION_DURATION, () => {
    panelTransitioning = false; 
    yzPanel.setActive(false); // パネル自体は非表示に戻す(戻ってきたときにonCloseで再度有効化する)
    nineBall.show();
    // cameraBusyはtrueのまま維持(オーバーレイが画面全体を覆っている間、下のシーンはクリックできない)。
    // nineBall側の「← 戻る」でonCloseが呼ばれ、そこでYステーションへ戻す。
  });
}

// ── シーン切り替え時の「継ぎ目隠し」用オーバーレイ ──
// 数式Phase2→オーディトリアムの遷移ではカメラが瞬時にジャンプするが、旧スプライトのフェードアウト(1.2秒)が続くと、新カメラのフレームに旧数式の残骸が映り込む。
// 全部のタイミングを揃える代わりに、DOMの黒オーバーレイで「見えない一瞬」を作り、その裏で瞬時に切り替える(fadeIn→onMid→fadeOut)。
const transitionOverlay = document.createElement('div');
Object.assign(transitionOverlay.style, {
  position: 'fixed',
  inset: '0',
  background: '#000',
  opacity: '0',
  pointerEvents: 'none',
  zIndex: '9999',
  transition: 'opacity 0.3s ease',
});
document.body.appendChild(transitionOverlay);

// オーディトリアムのtripod先端のX/Y/Zラベルをクリックしたときに出す、画面固定位置(50%, 70%)のテキスト表示。
// dialogue.js(dialogue.show)は3Dオブジェクトに追従する吹き出しで、固定配置に向かない。
// そこでcaptions.jsのキャプションボックス(数式上のワンフレーズ等と同じ仕組み)を流用し、見た目・フェードを他のセリフ表示と揃える。
// work(出典)も、captions.jsの共有出典ボックス(getSourceCaption)に表示する。
const axisTipCaption = makeCaptionController(createCaptionBox({ leftPercent: 50, topPercent: 70, noWrap: true }));
const AXIS_TIP_TEXT_DURATION = 10; // 表示してから自動で消えるまでの秒数
let axisTipHideTimer = null;

function showAxisTipText(message) {
  if (!message || !message.text) return;
  if (axisTipHideTimer) { clearTimeout(axisTipHideTimer); axisTipHideTimer = null; }
  axisTipCaption.setText(message.text);
  // 「I'm saving them.」の出典(右下)は永久表示。共有の出典ボックスは1つしかないため、その間は軸ラベル側のworkで書き換えも消去もしない(軸ラベルのworkは表示されない)。
  if (!isSavingWorkActive()) {
    const sourceCaption = getSourceCaption();
    if (message.work) sourceCaption.setText(message.work);
    else sourceCaption.hide();
  }
  axisTipHideTimer = setTimeout(() => {
    axisTipHideTimer = null;
    hideAxisTipText();
  }, AXIS_TIP_TEXT_DURATION * 1000);
}
function hideAxisTipText() {
  if (axisTipHideTimer) { clearTimeout(axisTipHideTimer); axisTipHideTimer = null; }
  axisTipCaption.hide();
  // 「I'm saving them.」の出典は永久表示なので、出している間は消さない。
  if (!isSavingWorkActive()) getSourceCaption().hide();
}


function fadeTransition({ fadeInDuration = 0.3, hold = 0.15, fadeOutDuration = 0.3, onMid, onDone } = {}) {
  transitionOverlay.style.transition = `opacity ${fadeInDuration}s ease`;
  transitionOverlay.style.opacity = '1';
  setTimeout(() => {
    if (onMid) onMid(); // 画面が完全に黒い間に、旧要素の消灯・カメラジャンプを済ませる
    setTimeout(() => {
      transitionOverlay.style.transition = `opacity ${fadeOutDuration}s ease`;
      transitionOverlay.style.opacity = '0';
      if (onDone) setTimeout(onDone, fadeOutDuration * 1000);
    }, hold * 1000);
  }, fadeInDuration * 1000);
}

// ── クリックの振り分け ─────────────────────────
// 上から順に判定し、最初に処理した段階でreturnする。
//  1. intro未開始(idle): イントロを開始する
//  2. 戴冠演出中: 何も受け付けない
//  3. trigger中: カメラ静止後に、iアイコン(→Phase1)・数式(→ズーム→Phase2→オーディトリアム遷移)・オーディトリアム内の操作を処理する
//  4. trigger未開始: 緑の星をクリックしたらtriggerを開始する
//  5. ホーム画面(introが'home'かつカメラ停止中): YZパネル → 星のセリフ → 射手座 → 各軸ステーションの点 → 軸(ステーションへ移動) → 空白クリック
function onCanvasClick(e) {
  if (intro.getState() === 'idle') { intro.startSequence(); return; }

  // バナナクリック後は、戴冠演出(record.coronationStarted)の開始から一連の演出完了(recordSequenceDone)までクリックを受け付けない(record.js側の二重発火防止フラグを流用)。
  if (record.coronationStarted && !recordSequenceDone) return;

  if (triggerActive) {
    handleTriggerPhaseClick(e);
    return;
  }

  // 緑の星の判定では、このクリックでraycasterを更新せず、直前のpointermove(ホバー処理)で設定された状態をそのまま使う。
  if (tryStartTrigger()) return;

  if (intro.getState() !== 'home' || cameraBusy) return;
  setRaycasterFromEvent(e);
  handleHomeClick();
}
renderer.domElement.addEventListener('click', onCanvasClick);

function setRaycasterFromEvent(e) {
  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
}

// ── trigger未開始: 緑の星のクリックでtriggerを開始する ──────────
// 開始したらtrue。
function tryStartTrigger() {
  const triggerHit = raycaster.intersectObject(trigger.star)[0];
  if (!triggerHit) return false;

  triggerActive = true;
  cameraBusy = true; // 念のため既存の排他制御にも乗せておく
  realignCameraToHomePose(() => {
    runTrigger({
      camera, controls, dialogue, trigger,
      onOrigin: () => { /* 必要ならここで公案の見た目切り替え等 */ },
      onDone: () => {
        triggerCameraSettled = true; // カメラがTRIGGER_DESTに完全静止。ここで初めてiクリックを受け付ける
      },
    });
  });
  return true;
}

// Shift+左ドラッグ(OrbitControlsのパン)でcamera.positionとcontrols.targetが同じ量だけ平行移動した状態でtriggerに入ると、
// 開始姿勢が毎回ズレてphase1→phase2のカメラ移動量がずれる(trigger以降の演出はホームの標準姿勢=target:HOME_CAMERA_TARGETから始まる前提)。
// そこで突入の直前に、パン分(controls.target - HOME_CAMERA_TARGET)だけcamera/targetを短いtweenで戻して標準姿勢に揃えてから、onDoneを呼ぶ。
function realignCameraToHomePose(onDone) {
  const panOffset = controls ? controls.target.clone().sub(HOME_CAMERA_TARGET) : null;
  if (controls) controls.enablePan = false; // 突入後にパンが再発しないように(trigger中はcontrols.updateも止まっているが念のため)
  if (!(panOffset && panOffset.lengthSq() > 1e-6)) {
    onDone();
    return;
  }

  controls.enabled = false;
  const camStart = camera.position.clone();
  const tgtStart = controls.target.clone();
  const p = { t: 0 };
  gsap.to(p, {
    t: 1, duration: 0.5, ease: 'power2.inOut',
    onUpdate: () => {
      camera.position.copy(camStart).addScaledVector(panOffset, -p.t);
      controls.target.copy(tgtStart).addScaledVector(panOffset, -p.t);
      camera.lookAt(controls.target);
    },
    onComplete: () => {
      camera.position.copy(camStart).sub(panOffset);
      controls.target.copy(HOME_CAMERA_TARGET);
      camera.lookAt(controls.target);
      onDone();
    },
  });
}

// ── trigger中のクリック ─────────────────────────
// 「i」アイコン・数式・オーディトリアム内の操作だけを受け付ける。カメラがTRIGGER_DESTに完全に静止してから(triggerCameraSettledの定義部参照)。
function handleTriggerPhaseClick(e) {
  if (!triggerCameraSettled) return; // カメラがまだ動いている間はiクリックを一切処理しない
  setRaycasterFromEvent(e);

  const triggerIconHit = trigger.iHitArea.visible
    ? raycaster.intersectObject(trigger.iHitArea)[0]
    : null;

  // ①完成後は、数式のクリック(ズーム→Phase2→オーディトリアム)と、オーディトリアム内のクリックを受け付ける。
  if (equationComplete) {
    if (auditorium.isActive) {
      handleAuditoriumClick();
      return;
    }
    if (handleEquationClick()) return;
  }

  if (triggerIconHit) onTriggerIconClick();
}

// 「i」アイコンのクリック: 緑の星を消し、Phase1(数式の組み立て)を始める。
function onTriggerIconClick() {
  trigger.star.visible = false; // 緑の星を消す(以後trigger側で再表示されないため、この1回でよい)
  // オーディトリアム用のセリフへ差し替える(index.htmlの#axisHintは固定表示なので、textContentを書き換えて切り替える)。
  const axisHint = document.getElementById('axisHint');
  if (axisHint) axisHint.textContent = 'What is the sound of two hands clapping?';
  handleIconClick({ trigger, onNextPhase: playOriginBurstThenStartPhase1 });
}

// まず原点で「黄色い輝点(十字フレア)+青い同心円」を一度だけ再生し、それが完全に終わってからĤ(=startPhase1本体)を登場させる。
function playOriginBurstThenStartPhase1() {
  playOriginBurst({
    scene,
    camera, // 流れ星を「画面右上」から出すために必須
    axes,   // リング通過でxAxis/zAxisを消す。描き直しは下のstartPhase1(axisRedraw)がĤ・ħの移動で行う
    onComplete: () => {
      const result = startPhase1({
        axisRedraw: takeBurstAxisRedraw(), // バーストで消したZ軸・X軸を、Ĥ・ħの移動で描き直す
        assembly: equationAssembly,
        existingISprite: trigger.iSprite,
        camera,
        starField, // 星→ψ→=の収束(schrodinger-sequence-timeline.md ⑸〜⑺)に使う
        onHbarArrived: () => {},
        onEquationComplete: () => {
          equationComplete = true; // ここから数式クリックでのズームを受け付ける
        },
      });
      equationVertexWorld = result.vertexWorld;
      equationFrame = result.frame;
    },
  });
}

// ── 数式のクリック(①完成後) ──────────────────────
// 表示中の数式シンボルに当たったらtrue。1クリック目でズーム、ズーム後はPhase2(④)到達済みならオーディトリアムへ遷移する。
function handleEquationClick() {
  const p3 = equationAssembly.phase2;
  const visibleSymbols = [
    ...Object.values(equationAssembly.sprites),
    ...(p3 ? Object.values(p3.sprites) : []),
  ].filter((s) => s && s.visible);
  const eqHit = raycaster.intersectObjects(visibleSymbols)[0];
  if (!eqHit) return false;

  if (!equationZoomed) {
    zoomIntoEquation();
  } else if (p3 && p3.stage === 'stage4' && !p3.busy) {
    // Phase2(④)到達後の追加クリックで「オーディトリアム」へ遷移する(1回目のみ。以降はauditorium.isActiveの分岐)。
    // 旧シーンのフェードアウトとカメラのジャンプ(enterAuditorium内で瞬時に発生)のタイミングがズレて残像が見えるため、
    // 黒オーバーレイで隠している間に旧要素を即座に消灯し、カメラも切り替える。
    fadeTransition({ onMid: () => switchToAuditorium(p3) });
  }
  return true;
}

// 1クリック目: 軸まわりをフェードアウトしつつ数式へズームする。
function zoomIntoEquation() {
  equationZoomed = true;
  fadeOutAxisVisuals(1.2);
  zoomToEquation({
    camera, controls,
    vertexWorld: equationVertexWorld,
    frame: equationFrame,
    duration: 1.6,
    onComplete: () => {
      // ズーム完了後の最初のクリックで②③④の自動展開を開始する。
      // 波面加工(雨紋+屈折)はphase2の間だけ適用する。無効化中に凍結していた古い波が急に見えないよう、有効化の瞬間にreset()してからenabled=trueにする。
      wavePass.reset(renderer);
      wavePass.enabled = true;
      waveScrollController.reset(); // 前回分のemaSpeed/scrollEnergyを持ち越さないよう念のため
      startPhase2({ assembly: equationAssembly, camera, onComplete: () => {} });
    },
  });
}

// 黒オーバーレイが画面を覆っている間(fadeTransitionのonMid)に、旧シーンを消灯してオーディトリアムへ切り替える。
function switchToAuditorium(p3) {
  // enterAuditorium自身と同じ「auditorium.isActiveなら何もしない」ガードをここにも置く。
  // p3.busyが立つ前の連打で、この分岐を2回通ってonMidが2回発火することがある。2回目はsetProjectionMix(0)が無条件に走って
  // camera.positionをorthoPos(≈524,524,524)へ戻すのに、enterAuditorium()は多重発火防止で何もしないため、カメラ位置が戻らない。
  // 結果、animate()の銀河同期回転がorthoPosをAUDITORIUM_CAMERA_TARGETまわりに回し続け、Y≈524.4に固定される症状になる。
  if (auditorium.isActive) return;

  axes.fadeOut(0.1); // オーバーレイが晴れる前に消え切るよう、ごく短時間に
  axisLabels.hide();
  const oldSprites = [
    ...Object.values(equationAssembly.sprites),
    ...Object.values(p3.sprites),
  ].filter((s) => s && s.visible);
  oldSprites.forEach((s) => {
    s.material.opacity = 0;
    s.visible = false;
  });
  // ホーム側のセリフ用hotspotも、同じシーンを共有するオーディトリアムから見えてしまうので、他の旧要素と同様に非表示にする。
  hotspotMeshes.forEach((m) => { m.visible = false; });
  archer.visible = false;
  // 波面加工はphase2専用なので、オーディトリアムへ移る瞬間に無効化する。
  wavePass.enabled = false;
  // スクロール連動でgsap.globalTimeline.timeScale()を動かしているため、ここで明示的に1へ戻す。
  // 戻さないと、phase2終了時に無操作が続いていた場合timeScaleがidleTimeScale(0.05)近くに残り、オーディトリアム以降のアニメーション全体が異常に遅くなる。
  waveScrollController.reset();
  // Phase2(zoomToEquation/startPhase2)がcamera.position/quaternionを動かすGSAP tweenを、オーディトリアム遷移時に明示的に止める。
  // 残っていると毎フレームcameraを上書きし、enterAuditoriumで設定した視点へ引き戻されるため。該当tweenが無ければ何も起きない。
  gsap.killTweensOf(camera.position);
  gsap.killTweensOf(camera.rotation);
  gsap.killTweensOf(camera.quaternion);
  gsap.killTweensOf(camera);
  // setProjectionMix(0)は、まだ黒オーバーレイの下に隠れているこのonMidで、カメラのジャンプと同時に呼ぶ。
  // 遅らせる(enterAuditoriumのonComplete)と、透視図から疑似正射影へ切り替わる瞬間の視野角の急変が見えてしまうため。
  setProjectionMix(0);
  projectionMixValue = 0;
  record.perspectiveActive = false;
  enterAuditorium(auditorium, {
    camera, controls,
    duration: 1.0, // オーバーレイが晴れた後の新シーンのフェードイン
    onComplete: onAuditoriumEntered,
  });
}

function onAuditoriumEntered() {
  // オーディトリアムに入った瞬間だけpan/zoomを無効化する(カメラは位置のみ固定、ホイールはauditorium専用)。それ以外のページではホイール=ズームとして使えるよう、ここでのみ切り替える。
  if (controls) {
    controls.enablePan = false;
    controls.enableZoom = false;
  }
  // レコードプレーヤー(操作パネル: カメラ背後の鏡三脚+バナナ)を表示する(record.js参照)。
  startRecordDisplay(record);
  // 銀河は演出なしに、実寸大でいきなり空間に配置する(galaxy.jsのrevealGalaxy)。銀河本体(内部バナナ含む)にクリック対象はなく、以後この銀河を拡大・縮小する操作もない。
  revealGalaxy(galaxy);
  setGalaxyRotationHeld(galaxy, true); // 戴冠するまで銀河は止めておく
  fairyTale.start(); // 巨大バナナ+冠(開始位置のカメラから見える)
  // 水面モード(galaxy.js): 銀河の星を「月の光の道のきらめき」として見せる。俯瞰モード突入(releaseGalaxyWater)まで続く。
  //   ★ 2026-11-09: 水面モードは「戴冠前」かつ「カメラの実位置が開始位置〜内側」のときだけ。carousel側(遠景の望遠)へ寄るほど全ての星が点灯し、
  //   望遠の端(carousel最接近)では全点灯。戴冠したらゆっくり解除(onCrownCoronation)。
  const waterBasis = fairyTale.getBasis();
  configureGalaxyWater(galaxy, { center: waterBasis.center, right: waterBasis.right, fwd: waterBasis.fwd, trailRadius: fairyTale.trailRadius });
  gsap.killTweensOf(galaxyWater);
  gsap.to(galaxyWater, { v: 1, duration: 1.5, ease: 'power2.out' }); // setGalaxyWaterはanimateで毎フレーム呼ぶ
  // auditorium開始時点のセリフ差し替え。
  const axisHint = document.getElementById('axisHint');
  if (axisHint) axisHint.textContent = 'Beauty says nothing at all.';
}

// ── オーディトリアム内のクリック ──────────────────────
// 上から順に判定する(順序が重要)。
function handleAuditoriumClick() {
  // auditorium.sprites(オーディトリアムの数式スプライト)を判定対象にする。equationAssembly/p3のスプライトはオーディトリアム突入後すべてvisible=falseで、ヒットしないため。
  const activeEqSprite = auditorium.sprites[auditorium.equationIndex];
  const uEqHit = (activeEqSprite && activeEqSprite.visible)
    ? raycaster.intersectObject(activeEqSprite)[0]
    : null;
  if (uEqHit) {
    toggleAuditoriumEquation(auditorium);
    return;
  }

  // tripod先端のX/Y/Zラベル(auditorium.axisLabels)をクリックすると、固定位置にテキストを表示する。
  // tripodHitMesh(当たり判定用の大きな球)より先に判定しないと、ラベルへのクリックがそちらに吸われるため、tripodHit判定より前に置く。
  const axisTipHit = raycaster.intersectObjects(auditorium.axisLabels)[0];
  if (axisTipHit) {
    const axisName = axisTipHit.object.userData.axisName;
    showAxisTipText(AXIS_TIP_MESSAGES[axisName]);
    return;
  }

  // tripodクリック → 金のリングが地面に形成され、tripod自体が浮上し、回転しながら粒子の軌跡(円錐)を永久に残し始める。
  // ih.pngの出現/消滅はここでは扱わない(appearCarousel / 俯瞰中のcarousel条件が担当)。
  // ここではrevealTripodRing/liftTripod/startTripodRoofPulseのみ呼ぶ。
  // 判定は明示的にvisibleを見る。Raycasterはvisibleがfalseでもヒットするため、鏡側表示中(tripodHitMesh.visible=false)でも
  // 当たり判定が残り、鏡tripodへのクリックがここに吸われてtryRecordClickに届かなくなる。
  // さらに、この判定一式は戴冠演出が終わるまでの片道切符なので、recordSequenceDone後は無効にする。
  // tripodHitMeshはtripodAnchorの子ではなくscene直下にあり、俯瞰中にcarouselを隠しても当たり判定だけ残って、過去の位置へのクリックがここに飛び込むため。
  const tripodHit = (!recordSequenceDone && auditorium.tripodHitMesh.visible)
    ? raycaster.intersectObject(auditorium.tripodHitMesh, true)[0]
    : null;
  if (tripodHit) {
    revealTripodRing(auditorium);
    liftTripod(auditorium);
    startTripodRoofPulse(auditorium);
    return;
  }

  // 「レコードプレーヤー(操作パネル)」: 鏡(→別ページ)/バナナ(→銀河出現)/銀河(→針)
  // のいずれかへのクリックをまとめて判定する(詳細はrecord.js参照)。
  if (tryRecordClick(record, raycaster)) return;

  // オーディトリアム内では、ここまでの判定以外は無視する。ラベル以外をクリックしたら固定表示のテキストは閉じる。
  hideAxisTipText();
}

// ── ホーム画面のクリック ────────────────────────
// 優先順位: YZパネル → 星のセリフ → 射手座 → 各軸ステーションの点 → 軸(ステーションへ移動) → 空白クリック。
function handleHomeClick() {
  const starHit = raycaster.intersectObjects(hotspotMeshes)[0];
  const panelHit = yzPanel.isActive() ? raycaster.intersectObject(yzPanel.hitMesh)[0] : null;

  if (panelHit) {
    onYZPanelClick();
    return;
  }
  if (starHit) {
    showStarDialogue(starHit);
    return;
  }
  if (handleArcherClick()) return;
  if (handleStationDotClick()) return;
  if (handleAxisClick()) return;

  // ここまでのどれにもヒットしなかった = 何もない場所をクリックした。
  // X/Y/Zステーションの追加表示(Teddyの点・タイトル・隠しiボタン等)が出ている場合は、ここで元に戻す(各hide関数は表示中でなければ何もしない)。
  // (カメラを少し動かしただけで戻るとシビアすぎるため、条件はカメラ操作ではなく「空白クリック」にしている)
  hideYOverlay();
  hideXOverlay();
  hideZOverlay();
}

function showStarDialogue(starHit) {
  // hitAreaがヒットした場合、親(実際の星メッシュ)まで遡ってuserDataを取る
  const starMesh = starHit.object.userData.texts ? starHit.object : starHit.object.parent;
  const texts = starMesh.userData.texts;
  const text = texts[Math.floor(Math.random() * texts.length)];
  dialogue.show(text, starMesh);
}

// 射手座(sagittarius.js)は、どれかの星をクリックすると星座全体(星+線)を消して、固定セリフ(SAGITTARIUS_MESSAGE)を1つだけ表示する。
function handleArcherClick() {
  if (!archer.visible) return false;
  const archerHit = raycaster.intersectObjects(archer.userData.stars, true)[0];
  if (!archerHit) return false;
  archer.visible = false; // 星も線も子要素なので、これで射手座全体が消える
  dialogue.show(SAGITTARIUS_MESSAGE, archer);
  return true;
}

// 表示中(visible)のオブジェクトにだけ当たり判定を行う。Raycasterはvisible=falseを見ないので、ここで明示的に除外する。
function hitIfVisible(object, recursive = true) {
  if (!object.visible) return null;
  return raycaster.intersectObject(object, recursive)[0] ?? null;
}

function showPointTitle(point, anchor) {
  const title = point?.title;
  if (title) dialogue.show(title, anchor);
}

// 各軸ステーションに出る点(終端・原点・隠しiボタン)のクリック。処理したらtrue。
// 配列の順がそのまま判定の優先順位。
function handleStationDotClick() {
  const dots = [
    [axisStationOverlay.yEndDot, true, () => {
      showPointTitle(AXIS_CONTENT.Y.end, axisStationOverlay.yEndDot);
      axisConstellationOverlay.showTeddyImage(); // Teddyの星座風画像(Cat.png)をフェードイン
    }],
    [axisStationOverlay.yOriginDot, true, () => {
      // セリフの代わりに、専用ページ(bananafish.js)をオーバーレイで開く(YZパネル→ビリヤード台と同じ導線)。
      // onCloseが呼ばれるまでcameraBusyをtrueのまま維持する(nineBall呼び出し時と同じ)。
      cameraBusy = true;
      hideYOverlay();
      bananafish.show();
    }],
    // 隠しボタン「i」(Yステーション限定)。
    [axisStationOverlay.iHit, false, () => {
      dialogue.show(IMAGINARY_BUTTON_MESSAGE, axisStationOverlay.iHit);
    }],
    [axisStationOverlay.xEndDot, true, () => {
      showPointTitle(AXIS_CONTENT.X.end, axisStationOverlay.xEndDot);
      axisConstellationOverlay.showCatcherImage(); // Catcherの星座風画像(Catcher1.png)をフェードイン
    }],
    [axisStationOverlay.xOriginDot, true, () => {
      showPointTitle(AXIS_CONTENT.X.origin, axisStationOverlay.xOriginDot);
    }],
    [axisStationOverlay.zOriginDot, true, () => {
      showPointTitle(AXIS_CONTENT.Z.origin, axisStationOverlay.zOriginDot);
      triggerZWave(); // 原点クリックをトリガーに、らせんを発生させる
    }],
    [axisStationOverlay.zEndDot, true, () => {
      // セリフの代わりに、専用ページ(earth.js)をオーバーレイで開く(Y原点→bananafishと同じ導線)。
      // onCloseが呼ばれるまでcameraBusyをtrueのまま維持する。
      cameraBusy = true;
      hideZOverlay();
      earth.show();
    }],
  ];

  for (const [object, recursive, onHit] of dots) {
    if (hitIfVisible(object, recursive)) {
      onHit();
      return true;
    }
  }
  return false;
}

// 軸(本体のシリンダー・X/Y/Zラベル)のクリック: その軸のステーションへカメラを飛ばす。処理したらtrue。
function handleAxisClick() {
  // 軸本体のシリンダーに加えて、X/Y/Zラベル(スプライト)も軸クリックの対象にする。Raycasterはvisible=falseを見ないので、明示的に除外する:
  //  ・ステーション滞在中は該当軸のラベルがvisible=falseになる(showX/Y/ZOverlay)ので、消えている文字には反応させない
  //  ・軸がフェードアウト中(isAxesVisible()=false)はラベルも対象外にする
  //  (ラベル非表示時のレイヤー退避はaxisLabels.hide()側で済んでいる)
  const axisHitTargets = [
    ...axes.axisHitAreas,
    ...(axes.isAxesVisible() ? axisLabels.labelHitAreas.filter((s) => s.visible) : []),
  ];
  const axisHit = raycaster.intersectObjects(axisHitTargets)[0];
  if (!axisHit) return false;

  flyToAxis(axisHit.object.userData.axisName);
  return true;
}

function flyToAxis(name) {
  const view = getAxisStationView(AXIS_WORLD_DIR[name], AXIS_LENGTH);
  cameraBusy = true;
  hideYOverlay(); // 別の軸(または再度Y軸)へ移動するので、いったん通常表示に戻す
  hideXOverlay(); // 同上(X軸)
  hideZOverlay(); // 同上(Z軸)
  yzPanel.setActive(false); // 移動中はいったん隠す(到達後、Y軸であれば再度表示する)
  // 別の軸(Z以外)へ実際に移動するときだけ、らせんを消す(同じZへの再訪問なら消さない)
  if (name !== 'Z') {
    zWaveRevealTween?.kill();
    zWave.reset();
  }

  flyToAxisStation(camera, controls, view, {
    duration: AXIS_STATION.duration,
    onComplete: () => {
      cameraBusy = false;
      currentAxisView = name;
      yzPanel.setActive(name === 'Y'); // Y軸ステーションに到達したときだけYZパネルを有効化する
      if (name === 'Y') showYOverlay(); // Y軸ステーション到達時だけ、終端の点+「Nine Stories」を表示する
      if (name === 'X') showXOverlay(); // X軸ステーション到達時だけ、終端の点+タイトル+原点付近の点を表示する
      if (name === 'Z') showZOverlay(); // Z軸ステーション到達時だけ、原点/終端の点+「Glass Saga」タイトルを表示する(らせんの発生は原点クリック時のtriggerZWave)
    },
  });
}

// ── YZパネル/隠しiボタン/緑の星のホバー処理 ──
// YZパネル: マウスを乗せると反射ガラスとして浮かび上がる / iボタン: Yステーション限定、ホバーで浮かび上がる / 緑の星: trigger突入前だけキャッチャーミットカーソル
renderer.domElement.addEventListener('pointermove', (e) => {

  // 緑の星のホバー(trigger突入前のみ。突入後はtriggerActiveで無効)。星がvisibleの間だけ判定する(隠れている星の位置がカーソルでバレないように)。
  // ここでcursorを決めてreturnするので、下の'pointer'/'default'の上書きと衝突しない。
  if (!triggerActive && intro.getState() === 'home') {
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
    if (trigger.star.visible && raycaster.intersectObject(trigger.star)[0]) {
      if (renderer.domElement.style.cursor !== TRIGGER_STAR_CURSOR) renderer.domElement.style.cursor = TRIGGER_STAR_CURSOR;
      return;
    }
  }

  const inputEnabled = !cameraBusy && intro.getState() === 'home';

  if (!inputEnabled) {
    if (yzPanel.isHovered() && !panelTransitioning) yzPanel.setHovered(false); 
    if (axisStationOverlay.isIHovered()) axisStationOverlay.setIHovered(false);
    if (renderer.domElement.style.cursor !== 'default') renderer.domElement.style.cursor = 'default';
    return;
  }

  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const panelHit = yzPanel.isActive() ? raycaster.intersectObject(yzPanel.hitMesh)[0] : null;
  if (yzPanel.isActive()) yzPanel.setHovered(!!panelHit);

  // 隠しiボタン(Yステーション限定)。iHit.visible(=showY/hideYで切り替え)のときだけ判定する。
  const iHitActive = axisStationOverlay.iHit.visible;
  const iHit = iHitActive ? raycaster.intersectObject(axisStationOverlay.iHit)[0] : null;
  if (iHitActive) axisStationOverlay.setIHovered(!!iHit);
  else if (axisStationOverlay.isIHovered()) axisStationOverlay.setIHovered(false);

  renderer.domElement.style.cursor = (panelHit || iHit) ? 'pointer' : 'default';
});

// ── trigger以前: カメラが星の外側へ出ないようにする「見えない壁+重力」 ──
// 原点からの距離がCAMERA_GRAVITY_START以内なら何もしない。それより外では、外へ行くほど強くなる原点方向の引力(二次カーブ)で引き戻し、CAMERA_HARD_LIMITでは完全に止める。
//  ・controls.update()の直後に呼ぶこと(OrbitControlsはupdate内でcamera.positionから毎回オフセットを読み直すので、ここで位置を書き換えても内部状態と食い違わない)。
//  ・ユーザー操作中(controls.enabled)だけ補正する。GSAPの自動移動中(flyTo系はcontrolsを無効化する)に効かせると、演出のtweenと喧嘩するため。
//  ・trigger開始後・オーディトリアム中は呼ばれない(animateの条件参照)ので、そこでは自由に動ける。
function applyStarBoundary(deltaSeconds) {
  const r = camera.position.length();
  if (r <= CAMERA_GRAVITY_START) return;

  const span = Math.max(CAMERA_HARD_LIMIT - CAMERA_GRAVITY_START, 1e-6);
  const t = THREE.MathUtils.clamp((r - CAMERA_GRAVITY_START) / span, 0, 1);
  const pull = CAMERA_GRAVITY_MAX_SPEED * t * t * deltaSeconds; // このフレームで原点方向へ戻す距離

  // 引き戻しで重力圏の内側まで行き過ぎないようにし、完全停止ラインも超えさせない
  let newR = Math.max(r - pull, CAMERA_GRAVITY_START);
  newR = Math.min(newR, CAMERA_HARD_LIMIT);
  camera.position.multiplyScalar(newR / r);
}

// ── レンダーループ ─────────────────────────────
let labelsShown = false;
// 深度バッファの精度対策: 俯瞰ではカメラが距離約41→10000へ遠ざかるため、near/farが固定だと遠い物体(バナナ・冠)の面が
// z-fightingを起こしてひび割れて見える。俯瞰中だけ、カメラ距離に合わせてnear/farを寄せる(俯瞰を出たら元に戻す)。
const BASE_CAMERA_NEAR = camera.near, BASE_CAMERA_FAR = camera.far;
function updateDepthRange() {
  let near = BASE_CAMERA_NEAR, far = BASE_CAMERA_FAR;
  if (overviewActive) {
    const d = camera.position.distanceTo(controls.target);
    near = Math.max(BASE_CAMERA_NEAR, d * 0.02);
    far = Math.max(BASE_CAMERA_FAR, d * 3);
  }
  if (Math.abs(near - camera.near) > near * 0.01 || Math.abs(far - camera.far) > far * 0.01) {
    camera.near = near; camera.far = far; camera.updateProjectionMatrix();
  }
}

function animate() {
  requestAnimationFrame(animate);
  updateDepthRange();
  // Hapworthページ(earth.js)を開いている間は、メインシーンの更新・描画を止めて負荷を下げる。
  // clock.getDelta()だけは呼んでおく(戻った直後に巨大なdeltaが入って、オーディトリアムの回転などが飛ぶのを防ぐ)。
  if (earth.isOpen()) { clock.getDelta(); return; }
  const delta = clock.getDelta(); // オーディトリアムの回転(updateAuditorium)用。フレームの最初に1回だけ呼ぶこと
  const state = intro.getState();
  // auditorium.isActiveの間は、この行(camera.lookAt(lookTarget))をスキップし、向きの制御をOrbitControls(controls.target)に一元化する。
  // intro.getState()はauditoriumに入っても'home'にならないため、スキップしないとenterAuditorium完了直後の一瞬(controls.update()がまだ一度も呼ばれていない間)、
  // Phase2時代のlookTargetへ向きが引っ張られて、視点が一瞬ずれて見える。
  if (state !== 'home' && !auditorium.isActive) camera.lookAt(lookTarget);
  // auditorium中は、intro.getState()が何を返してもcontrols.update()を呼ばせない(auditorium.isActiveを追加のガードにする)。
  // OrbitControls.update()は、内部に記憶した球面座標(targetからの距離・方位角・仰角)からcamera.positionを直接書き換える。
  // auditorium中はコード側(updateAuditorium・setAuditoriumProjectionMix等)がカメラを動かしており、OrbitControlsの内部状態は「最後にhome画面にいたとき」のまま古い。
  // そのため、一瞬でもintro.getState()==='home'の状態でcontrols.update()が走ると、カメラがauditorium中の位置とは無関係な座標へジャンプする。
  // labelsShownの表示も、home画面専用の演出なので同様にガードしている。
  // 注意: これは症状(OrbitControlsの古い状態による上書き)への対症療法。auditorium.isActive===trueなのにintro.getState()が'home'を返しうる根本原因は、
  // intro側(intro状態機械)にある可能性が高い。introで「auditorium突入後は'home'を返さない」ことを保証できれば、そちらで直すのがより根本的。
  if (state === 'home' && !auditorium.isActive && !cameraBusy && !triggerActive) controls.update();
  // trigger以前・ユーザー操作中のみ、星の外側へ出ないよう壁+重力を適用(オーディトリアム/trigger中/自動移動中は対象外)
  if (state === 'home' && !auditorium.isActive && !cameraBusy && !triggerActive && controls.enabled) applyStarBoundary(delta);
  if (state === 'home' && !auditorium.isActive && !labelsShown) { labelsShown = true; axisLabels.show(); }
  dialogue.updatePosition();
  // Aスター化した矢のスターダスト更新。矢が非表示の間も、飛んだ後に残った粒が消えるまで毎フレーム呼ぶ。
  try { arrowGroup.userData.update(delta, camera); } catch (err) { /* 無視: ループ全体を止めない */ }
  starField.update(clock.getElapsedTime());
  // 以下のtry/catchは、更新で万一例外が出てもレンダーループ全体(=軸クリックの見た目上の反応)が止まらないよう隔離している。
  try { zWave.update(clock.getElapsedTime()); } catch (err) { /* 無視: ループ全体を止めない */ }
  try { axes.update(clock.getElapsedTime()); } catch (err) { /* 無視: ループ全体を止めない */ } // 軸ラインの「原点方向へ流れる光」アニメーション
  try { waveScrollController.tickIdleDecay(); } catch (err) { /* 無視: ループ全体を止めない */ } // 波面: scrollEnergy(雨量)の減衰と再生速度をゆっくり戻す
  if (aStar.userData.update) aStar.userData.update(delta); // Aスターの尾(スターダスト)
  updateAuditorium(auditorium, delta, camera); // オーディトリアムの三軸回転(固定軸まわりのカルーセル回転。isActiveがfalseの間は内部で即returnするので無害)
  // 銀河の回転は「ドラッグ完了」で始める。左右ドラッグ(またはShift+ドラッグ/2本指横スワイプ)で透視図への切り替えが確定する(record.perspectiveActive=true)までは回さず、確定した瞬間から回し始める。
  // カメラは回さない(銀河が止まっている間はカメラも止まっているので、両者の相対角度はずれない)。
  {
    // 水面モードの実効量 = 戴冠前の度合い(galaxyWater.v) × カメラの実位置による限定。
    //   カメラの実位置(距離)から逆算したsignedMixが -0.15 以上なら水面、-0.49 以下(望遠=carousel最接近側)なら全点灯。バナナの沈み・CAROUSELの出方(weight)と同じ範囲。
    const camMix = auditoriumSignedMixFromDistance(camera.position.distanceTo(AUDITORIUM_CAMERA_TARGET));
    setGalaxyWater(galaxy, galaxyWater.v * THREE.MathUtils.clamp((camMix + 0.49) / 0.34, 0, 1));
  }
  updateGalaxy(galaxy, delta); // ★ 2026-11-09: 確定待ちを廃止(開始から自転) // tripod直下の巨大な銀河の自転(state==='hidden'の間は内部で即returnするので無害)
  fairyTale.sampleTrail(getGalaxyWaterTrail()); // 冠の軌跡を水面のきらめきとして渡す(一時的。時間で消える)
  updateFairyTale(fairyTale, delta, projectionMixValue); // 巨大バナナ+冠の二体問題(projectionMixValue=ドラッグ量。バナナは左ドラッグ(遠景)で沈む)
  updateRecordDisplay(record, delta, controls); // 鏡の反射撮影+スクロールに応じた画面切り替え+三角錐の自転(メインのrender()より前)
  updateDive(delta); // 戴冠前のスクロール(入水)による仰角
  updateOverviewCameraHeight(delta); // 銀河俯瞰(telescope)中、スクロール高さをなめらかに追従させる
  // carouselとrecordの可視/不可視の排他切り替え: 画面がどちら向きかに応じて、互いの見た目(carousel側の粒子/ih、record側のbanana搭載mirrorGroup)を切り替える。
  // tripod本体(axesGroup)・金のリング(goldenRing)はここでは切り替えない(リングはappearCarouselと俯瞰中のcarousel条件が決める)。
  if (auditorium.isActive) {
    // recordSequenceDone(バナナ演出完了・carousel側へ固定済み)以降は、record.viewMixCurrentに関わらずshowRecordSideをfalseにする。
    // viewMixCurrentは「鏡側へ向いたまま止まった累積スクロール値」のままなので、それを見ると演出完了後もcarousel側の粒子(roofParticles)・tripodHitMesh・ihが非表示のままになる
    const showRecordSide = recordSequenceDone ? false : record.viewMixCurrent >= 0.5;
    auditorium.roofParticles.visible = !showRecordSide;
    auditorium.tripodHitMesh.visible = !showRecordSide;
    auditorium.ihSprite.visible = !showRecordSide && auditorium.ihRevealed && ihAllowed();
    if (record.phase !== 'inactive' && !recordSequenceDone) record.mirrorGroup.visible = showRecordSide;
  }

  // 仰角による表示切り替え(上のshowRecordSideブロックより後に実行し、ihSpriteなどの値をこちらが最後に上書きする)。
  // OVERVIEW_HIDE_SPLIT_DEG未満はcarousel(tripod一式。roofParticlesも含む)、それ以上はバルジ側(戴冠成功=バルジ/失敗=バナナと冠)。
  // 星(銀河・バルジ・Aスターの尾)の点の大きさもズームに合わせて拡大する。フライト中(カメラもfovも動いている間)と俯瞰以外は等倍(1)で、フライト後はfovを狭めた分だけ大きくなる。
  // uZoomを持つマテリアルは1秒ごとにシーンから集め直す(成長演出などで作り直されても追従するため)。
  starZoomRefreshTimer -= delta;
  if (starZoomRefreshTimer <= 0) {
    starZoomRefreshTimer = 1;
    starZoomMaterials = [];
    scene.traverse((o) => {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((mat) => { if (mat && mat.uniforms && mat.uniforms.uZoom) starZoomMaterials.push(mat); });
    });
  }
  const starZoomFactor = (overviewActive && !overviewFlightInProgress)
    ? Math.tan(THREE.MathUtils.degToRad(OVERVIEW_FOV_BASE) / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)
    : 1;
  starZoomMaterials.forEach((mat) => { mat.uniforms.uZoom.value = starZoomFactor; });
  if (!overviewActive) aStar.visible = false; // 俯瞰以外では出さない(俯瞰中はanimateの俯瞰ブロックがtrueにする)

  if (overviewActive) {
    const elevationDeg = overviewElevationDegForScroll(overviewScrollCurrent);
    const belowWater = elevationDeg < OVERVIEW_HIDE_SPLIT_DEG;
    const hideCarousel = elevationDeg >= OVERVIEW_HIDE_SPLIT_DEG;

    // carousel一式(auditorium.carouselRoot)を、最後の俯瞰視点へ移行するフライト(overviewFlightT 0→1)に合わせて縮小する(量子世界の小ささを見せるため、銀河=レコードに対して回転木馬が大きすぎないようにする)。
    // 基準点は銀河中心(GALAXY_CENTER。回転軸x=z=0の真上なので、木馬は横へ流れず銀河の中心へ寄っていく)。フライト後は縮小したまま(overviewFlightT=1)。
    // ティルトシフトの円柱・ihの周回はワールド座標/ローカル座標で追従するので、個別対応は不要。
    const zoomT = overviewZoomProgress();
    // carouselの大きさは実寸(CAROUSEL_PHYSICAL_SIZE)で一定。ズームしても倍率は変えず(拡大はfovだけが担う)、フライト前半(overviewFlightT 0→1)でその場で 1→実寸の倍率へ対数補間で縮む。以後は一定。
    const carouselScaleFinal = CAROUSEL_PHYSICAL_SIZE / carouselNativeSize;
    const carouselScale = Math.pow(carouselScaleFinal, overviewFlightT);
    // 縮む基準点は数式(tripodの頂点の上。浮上後はその分だけ高い)。数式が、縮小フライトに合わせて銀河の中心(+移動量)へ寄っていく。
    _carouselPivot.copy(RECORD_ANCHOR).add(auditorium.axesGroup.position);
    _carouselTarget.lerpVectors(_carouselPivot, overviewItemsCenter(), overviewFlightT);
    setCarouselScale(auditorium, carouselScale * (window.carouselScaleMul ?? 1), _carouselPivot, _carouselTarget);

    // すり替え判定(zoomTだけで決める)。縮小フライト中は判定しない(carouselが縮んでいくのを見せるため)。
    if (!overviewFlightInProgress) {
      if (carouselShownAsCarousel) {
        if (zoomT < CAROUSEL_SWAP_ZOOM_HIDE) carouselShownAsCarousel = false;
      } else if (zoomT >= CAROUSEL_SWAP_ZOOM_SHOW) {
        carouselShownAsCarousel = true;
      }
    }

    // starburstは「縮小したcarouselの代わり」。carouselが見えていない間だけ出し、ズームに合わせて膨らませる。
    const carouselVisible = !hideCarousel && carouselShownAsCarousel;

    auditorium.tripodAnchor.visible = carouselVisible;   // TRIPOD(軸・数式はこの子なので一緒に隠れる)
    auditorium.goldenRing.visible = carouselVisible;     // リング
    auditorium.roofParticles.visible = carouselVisible;  // tripodが残す粒子の軌跡(carousel側の一部)
    if (auditorium.ihRevealed) auditorium.ihSprite.visible = carouselVisible && ihAllowed(); // ih(戴冠イベント後かつ仰角が負のときだけ)

    // バルジ(record.bulge。galaxy.starsGroupの子)は、仰角が境界以上(!belowWater)のときだけ見せる。
    if (record.bulge) record.bulge.visible = bulgeRevealed && !belowWater; // 戴冠成功時だけ
    fairyTale.setFailedVisible(!belowWater); // 失敗後のバナナ・冠もバルジと同じ8°条件(境界以上だけ見せる。carousel側では隠す)

    // starburstは縮小carouselと同じ位置(GALAXY_CENTER)に置き、zoomTに応じて膨らませる。すり替え閾値でcarouselに置き換わる(starburstの拡大がcarouselにつながる)。
    // starburstとAスターの大きさはcarouselの実寸(CAROUSEL_PHYSICAL_SIZE)に合わせる(すり替えでも大きさが跳ばない)。ただし遠景で消えないよう、見かけの大きさがSTAR_MIN_PIXELS pxを下回る分だけ底上げする。
    const viewH = 2 * camera.position.distanceTo(controls.target) * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2);
    const starWorldSize = Math.max(STARBURST_PHYSICAL_SIZE * (window.starburstScaleMul ?? 1), STAR_MIN_PIXELS / window.innerHeight * viewH);
    // starburstだけ、ズームに応じて膨らませる(Aスターとcarouselは実寸のまま)。遠景の最小px保証は同じ。
    const starburstGrowth = Math.pow(window.starburstRatio ?? STARBURST_SWAP_SCALE,
      THREE.MathUtils.clamp(zoomT / CAROUSEL_SWAP_ZOOM_HIDE, 0, 1));
    const starburstWorldSize = Math.max(STARBURST_PHYSICAL_SIZE * (window.starburstScaleMul ?? 1) * starburstGrowth, STAR_MIN_PIXELS / window.innerHeight * viewH);
    starburstMeshes.forEach((m) => {
      if (starburstBaseSize === null) { // scale=1のときの広がり(ジオメトリ依存)を一度だけ測る
        m.scale.setScalar(1); m.updateMatrixWorld(true);
        const bs = new THREE.Box3().setFromObject(m).getSize(new THREE.Vector3());
        starburstBaseSize = Math.max(bs.x, bs.y, bs.z) || 1;
      }
      m.position.copy(overviewItemsCenter());
      m.scale.setScalar(starburstWorldSize / starburstBaseSize);
      m.visible = !carouselVisible && !hideCarousel;
    });
    // Aスターはstarburstと対(starburst=OVERVIEW_HIDE_SPLIT_DEG未満・carousel側 / Aスター=以上・バルジ側)。切り替えはバルジ(record.bulge)の子であることで維持される。俯瞰中は常に対象(トーンアーム設置後の登場待ちはしない)。
    aStar.visible = bulgeRevealed && !belowWater; // 8°以上だけ(バルジの子でもあるが、尾の粒はscene直下なので明示的にも切る)
    if (aStar.parent) { // 親(バルジ)のワールド倍率を打ち消して、見かけの直径=starWorldSizeにする(球の直径は1)
      const ps = aStar.parent.getWorldScale(_tmpScale).x || 1;
      aStar.scale.setScalar(starWorldSize * (window.aStarRatio ?? A_STAR_VISUAL_RATIO) / ps);
    }

  }

  updateTiltShiftEffect(); // 最後の俯瞰でカメラが低い間だけ、carouselにピントが合うティルトシフトをかける
  yzPanel.update(clock.getElapsedTime());
  bananaState.mesh.rotation.y += state === 'idle' ? 0.004 : 0;
  render();
}
animate();
