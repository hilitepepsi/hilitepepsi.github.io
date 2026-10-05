import * as THREE from 'three';
import {
  ARCHER_POS, AXIS_X_FAR, TUNE,
  AXIS_WORLD_DIR, AXIS_LENGTH, AXIS_STATION,
  HOME_CAMERA_POS, HOME_CAMERA_TARGET,
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
import { createHotspots } from './hotspots.js';
import { createDialogue } from './dialogue.js';
import { createCaptionBox, makeCaptionController, getSourceCaption } from './captions.js';
import { createIntroSequence } from './introSequence.js';
import { getAxisStationView, flyToAxisStation, UNIVERSE_CAMERA_POS, UNIVERSE_CAMERA_TARGET } from './config.js';
import { createAxisStationOverlay } from './axisStationOverlay.js';
import { createAxisConstellationOverlay } from './axisConstellationOverlay.js';
import { AXIS_CONTENT } from './data/axisContent.js';
import { createFinale, runFinale, handleIconClick } from './finale.js';
import { createEquationAssembly, startPhase1, zoomToEquation, startPhase3 } from './equationAssembly.js';
import { playOriginBurst } from './originBurst.js';
import { createUniverse, enterUniverse, toggleUniverseEquation, updateUniverse, updateEquationHoverByPointer, revealTripodRing, liftTripod, startTripodRoofPulse, createUniverseProjectionMixer, unlockIh, setTripodAngularSpeed } from './universe.js';
import { createSolarSystem, updateSolarSystem, generatePlanetTrails, ORBIT_CENTER } from './solarSystem.js';
import { createGalaxy, updateGalaxy, revealGalaxy, setGalaxyArmEmphasis, setGalaxyDifferentialRotation, ANGULAR_SPEED as GALAXY_ANGULAR_SPEED, ROTATION_DIRECTION as GALAXY_ROTATION_DIRECTION } from './galaxy.js';
import { createTripodRingSwap, updateTripodRingSwap, finishTripodRingSwap } from './tripodRingSwap.js';
import { createTiltShift } from './tiltShift.js';
import {
  createRecordDisplay, startRecordDisplay, tryRecordClick, updateRecordDisplay,
  applyScroll, SCROLL_MAX,
} from './record.js';

// YZパネルクリック時、メインカメラをビリヤード専用ページと同じ構図にする。
const BILLIARD_CAMERA_POS = new THREE.Vector3(AXIS_LENGTH / 2, -AXIS_LENGTH / 2, AXIS_LENGTH / 2);
const BILLIARD_CAMERA_TARGET = new THREE.Vector3(AXIS_LENGTH / 2, AXIS_LENGTH / 2, 0); // パネル中央(=9,9,0)
const BILLIARD_TRANSITION_DURATION = 1.3; // yzPanel.js のRIPPLE_SPEEDと揃えている(パネル対角線を走り抜ける時間)

const SAGITTARIUS_MESSAGE = { text: 'Shirley you said you were sagitarius\nbut your only taurus bring your skates\nwhen you come over to my house', work: 'The Catcher in the Rye'}

// ★ 追加: 宇宙ページのtripod(universe.axesGroup)先端に付いているX/Y/Zラベルをクリックした
//   ときに表示するメッセージ。text/workともに後で実際の文言に差し替える(今は空のプレースホルダー)。
const AXIS_TIP_MESSAGES = {
  X: { text: 'Gimme the pieces.', work: 'The Catcher in the Rye' },
  Y: { text: 'Life is a gift horse in my opinion', work: 'Teddy' },
  Z: { text: 'When the horse arrived, it turned out indeed to be a superlative animal.', work: 'Raise High the Roof Beam, Carpenters' },
};

// 隠しボタン「i」(虚数単位)をクリックしたときに表示するメッセージ。
// 今は仮のプレースホルダーなので、実際の演出(別ページ遷移・特別なダイアログ等)に合わせて差し替えてください。
const IMAGINARY_BUTTON_MESSAGE = 'A ZEN KOAN';

// 2点間をなめらかに補間するだけのシンプルなカメラフライト(flyToAxisStationの球面補間とは別物。
// ホーム⇄軸ステーションの往復ではなく、パネル→ビリヤード専用ページの「覗き込む」動きに使う)
//
// camera.up は直前の軸ステーション用のカスタムup(world上向きとは限らない)を引き継いだままなので、
// ここで明示的にworld上向き(0,1,0)へ補間しないと、lookAt()の基準が崩れてカメラが逆さまになる。
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
const { scene, camera, renderer, controls, composer, lookTarget, excludeFromBloom, includeInRoundBloom, render, setProjectionMix, wavePass } = createSceneSetup();
// 波面(雨紋+屈折)をスクロール操作に連動させる。
// ※ この対応付け(一定速度で丁寧に操作するほど水面が落ち着く)は現時点の案であり、
//   「スクロールで雨が降り出し静止で止む」等に変える場合はattachScrollDrivenRainの
//   中身(waveSurfacePass.js側)だけを差し替えればよい。
const waveScrollController = attachScrollDrivenRain({ field: wavePass });
// ★ 追加: 最後の俯瞰スクロールで、カメラが最も低い間だけcarouselの範囲にピントを合わせ、
//   その上下をぼかす「ティルトシフト」(tiltShift.js)。composerの後段にパスを差し込むだけで、
//   strength=0の間はパス自体が無効化されるので、他の場面には一切影響しない。
const tiltShift = composer ? createTiltShift(composer) : null;
if (!tiltShift) console.warn('composerが取得できないため、ティルトシフトは無効です。');
// ★ 2026-09-12 追加: OrbitControlsは既定で「右ボタンドラッグ=パン」を持っているが、
//   右ボタンは全面的にこちらの独自の右ドラッグ処理(疑似正射影⇄透視図の切り替え。
//   universe.isActive中のみ有効)専用にしたいので、OrbitControls側の右ボタン機能は
//   完全に無効化する(=universe以前は右ボタンに一切何も起きなくなる)。
if (controls) controls.mouseButtons.RIGHT = null;
// 宇宙ページの右ドラッグ切り替え専用(UNIVERSE_CAMERA_POSの角度を維持したまま距離・fovだけ変える)。
// setProjectionMix(ホーム画面用)とは別物なので混同しないこと。
const setUniverseProjectionMix = createUniverseProjectionMixer(camera);

const starField = createStars(scene, 3000);
// ★ 変更: 以前はstars.js側で焼き込みテクスチャに光暈まで含めて作り、Bloomから完全除外する
//   ことで「常に丸い」ことだけを担保していたが、実際の明るさに反応しない静的な発光では
//   物足りないとのご指摘を受け、方針を変更した。
//   → 本物のUnrealBloomPass(bloomComposer)からは引き続き除外する(小さい点だと
//   低解像度ミップのせいで必ず光暈が四角くなるため)一方、新設した「丸いBloom」
//   パイプライン(sceneSetup.js。閾値抽出+十分な解像度の分離ガウシアン)には含める。
//   これで、実際の明るさ・強度パラメータに動的に反応しつつ、常に丸いままの発光になる。
excludeFromBloom(starField.mesh);
includeInRoundBloom(starField.mesh);

const clock = new THREE.Clock();

const hotspotMeshes = createHotspots(scene);
// ★ 追加(ご質問反映): starburst(Phoebeの星)は、他の通常hotspotと違って既に
//   canvasに焼き込んだ十字スパイクのスプライト(AdditiveBlending)を重ねてあり、
//   それ単体で十分に「眩しい星」に見える作りになっている。この星の核メッシュに
//   Bloomをかけると、核自体の小さな球がUnrealBloomPassの低解像度ミップのせいで
//   四角い光暈を作ってしまう(hotspots.js側の修正=spikeを縁に接しないよう縮める+
//   ミップマップ無効化、と合わせて、ここではBloom自体を完全に切ることで対応する)。
//   核・スプライトどちらもm(核メッシュ)の子として一体なので、excludeFromBloom(m)一発で
//   両方ともBloom専用パスから除外される→発光は完全にテクスチャだけに委ねられる。
hotspotMeshes.filter((m) => m.userData.isStarburst).forEach((m) => excludeFromBloom(m));

// ★ 2026-09-29 追加(ご指示反映): 銀河俯瞰(overviewActive)中だけ、starburstの星を
//   「銀河の中心(ORBIT_CENTER)の少し上」へ配置して表示する。
//   ・STARBURST_OVERVIEW_OFFSET は銀河中心からの相対オフセット(仮値 (0,30,0))。
//     ワールド絶対座標(0,30,0)にしたい場合は、animate内の .copy(ORBIT_CENTER).add(...) を
//     .copy(STARBURST_OVERVIEW_OFFSET) に変えること。
//   ・STARBURST_OVERVIEW_SCALE は俯瞰スケール(銀河が大きいため見えにくければ上げる)。
const starburstMeshes = hotspotMeshes.filter((m) => m.userData.isStarburst);
const STARBURST_OVERVIEW_OFFSET = new THREE.Vector3(0, 20, 0);
const STARBURST_OVERVIEW_SCALE = 0.5; // 通常の1/2サイズ(仮値。見ながら調整)

const finale = createFinale(scene);
let finaleActive = false; // フィナーレ開始後はcameraBusy/controlsとは別に、全インタラクションを止める
// ⚠ iアイコンはtravelToOrigin途中(p.t>0.85)でフェードイン・クリック判定ONになるが、
// その時点ではまだカメラはtravelToDestの途中(FINALE_DESTへ移動中)のことがある。
// startPhase1はcomputeScreenFrame(camera)でその瞬間のカメラ姿勢を確定させてしまうため、
// カメラが完全に静止する前にクリックされると、以後の記号・星の配置が全部
// 「中途半端な姿勢」を基準にしてズレる。これを防ぐため、travelToDest完了(onDone)まで
// iクリックの処理自体を保留するフラグ。
let finaleCameraSettled = false;

// ── Phase3(数式クリックでのズーム・②③④展開)関連の状態 ──
let equationComplete = false; // ①(iħ∂ψ/∂t=Ĥψ)が完成した瞬間にtrueへ
let equationZoomed = false;   // 数式へズームイン済みか
let equationVertexWorld = null; // ズーム・Phase3配置計算に使う頂点(=緑iだった場所)のワールド座標
let equationFrame = null;       // computeScreenFrame(camera)のスナップショット(ズーム時のカメラ姿勢基準)

const { state: bananaState, triggerShatter } = createBanana(scene);

const archer = createSagittarius(scene, ARCHER_POS);
archer.visible = false;

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
// 数式シンボルのBloom(発光・にじみ)強度。0=完全になし、1=通常の他の発光と同じ強さ。
// 見た目を見ながらこの値だけ調整すればOK。
const EQUATION_BLOOM_INTENSITY = 0.8;
Object.values(equationAssembly.sprites).forEach((sprite) => excludeFromBloom(sprite, EQUATION_BLOOM_INTENSITY));
const axes = createAxes(scene);
const universe = createUniverse(scene); // ← Phase3以降、画面クリックで遷移する「宇宙ページ」(星なし・回転する三軸+方程式画像)
// ★ 2026-09-17 追加(ご指摘反映): 「銀河俯瞰時、レコード(=universe.goldenRing)が
//   画面上で小さく見えるとき(望遠鏡モードの既定fov・ドラッグでズームしていない状態)
//   に白飛びする」への対応。starField/equationAssembly/バルジと同じ原因
//   (UnrealBloomPassはミップベースの実装のため、対象が画面上で小さいほど、その
//   小ささに対して相対的に強くブルーム=白飛びしやすい弱点がある)なので、同じ対策
//   (excludeFromBloomでBloom強度を弱める)を適用する。
//   ★ ただしgoldenRing自体は宇宙ページの他の場面(carousel表示時など、画面上で
//     十分大きく見える距離)でも使われる同一インスタンスなので、値を0にして完全に
//     Bloomを切るのではなく、近くで見たときの輝きもある程度残るよう中間値にしてある
//     (仮値。見ながら調整してください。近くでの見映えを優先するなら上げる、
//     俯瞰時の白飛びをより確実に抑えたいなら下げる)。
const GOLDEN_RING_BLOOM_INTENSITY = 0.35;
excludeFromBloom(universe.goldenRing, GOLDEN_RING_BLOOM_INTENSITY);
// tripodクリックで「金のリング→円錐状の粒子→ih.png」が出現する演出(universe.js側で完結)に加えて、
// 太陽系(solarSystem.js)・銀河(galaxy.js)・レコードプレーヤー操作パネル(record.js)も
// 同じ宇宙ページ内に共存させる。
// tripod直下を公転する太陽系(8惑星入れ子)。宇宙ページ限定の装飾。
const solarSystem = createSolarSystem(scene);
// ★ 2026-09-19 修正(ご指摘反映): 「太陽系の公転面が銀河と一致しているか確認して。
//   高くも低くも見える」への対応。原因はここだった。solarSystem.js側の主軌道
//   (sunGroupが辿るorbitCurve)はORBIT_CENTER(=universe.jsのRECORD_ANCHOR)を中心にした
//   平面上にあるのに対し、銀河はそれと無関係にここでハードコードした(0, 13, 0)を
//   中心にしていたため、2つの円盤面の高さがわずかにズレていた(すぐ下のコメントも
//   「ワールド原点(0,0,0)に固定配置する」と書かれたまま実際の値は(0,13,0)になっており、
//   このズレ自体が過去の調整の残骸だったことを示している)。solarSystem.js側が元々
//   「galaxy.js側が銀河の中心をORBIT_CENTERに合わせる想定」とコメントしていた通りに、
//   ORBIT_CENTERをそのまま銀河の中心として渡すよう修正した。
const galaxy = createGalaxy(scene, ORBIT_CENTER);
// ★ 2026-09-19 追加(ご指摘反映): 「星が明るく、ぼやけてしまった」への対応その3。
//   galaxy.js側でトーンアームの透過(transmission)用に追加した不透明な「核」レイヤー
//   (galaxy.opaquePoints)は、見た目上は輝きレイヤー(galaxy.points)の中に完全に隠れる
//   想定のごく小さな点だが、UnrealBloomPassは小さく硬い(不透明な)点に弱く、ここが
//   Bloomの対象に入っていると輝きレイヤーとは別に自分自身もBloomしてしまい、結果的に
//   全体が余分に明るく・ぼやけて見える一因になっていた。starField(冒頭のexcludeFromBloom
//   参照)と同じ理由でここも完全にBloom対象から除外する。
excludeFromBloom(galaxy.opaquePoints);
// ★ 2026-09-19 追加(ご指摘反映): 「carousel回転も、太陽系の銀河公転速度に合わせて」
//   への対応。GALAXY_ANGULAR_SPEED(galaxy.jsのANGULAR_SPEED。既にSUN_ORBIT_PERIODから
//   導出済み=太陽系の公転と同じ速度)を、そのままtripod/carousel自体の自転速度としても
//   使うようにした。
setTripodAngularSpeed(GALAXY_ANGULAR_SPEED);
// 「レコードプレーヤー(操作パネル)」: カメラ背後の鏡三脚+バナナ→銀河出現→銀河クリックで
// 針+太陽系召喚、という一連の流れを管理する(詳細はrecord.js冒頭のコメント参照)。
// 銀河・太陽系はここで新規作成せず、上で作った既存のgalaxy/solarSystemをそのまま使う。
const record = createRecordDisplay(scene, renderer, { camera, galaxy, solarSystem, universe, excludeFromBloom });
// 「二つのtripod・二つの円環」の対応関係クロスフェード+移動演出(tripodRingSwap.js)。
// universe/recordの両方が揃った後でないと作れないので、ここで呼ぶ。
const tripodRingSwap = createTripodRingSwap(scene, universe, record);

// ★ 2026-09-15 追加(ご指示反映): バナナクリック後の演出(戴冠→リング拡大→リング消滅)が
//   完了した瞬間、record.js側(playNeedleSequence内のonRingContact)からこのフックが
//   呼ばれる。以後tripod⇔鏡tripodの切り替え(tripodRingSwap)はもう使わない片道切符
//   なので、carousel側へ強制的に戻して固定する(finishTripodRingSwap)。
//   recordSequenceDoneは、以後の「スクロール/左右ドラッグの用途を銀河俯瞰に切り替える」
//   判定にmain.js側で使う(下記ホイールハンドラ・レンダーループ参照)。
let recordSequenceDone = false;
record.onSequenceComplete = () => {
  finishTripodRingSwap(tripodRingSwap);
  recordSequenceDone = true;
};

// ── スクロールによる画面切り替え(下=鏡、上=carousel)・銀河のscrub ──────────
// 累積スクロール量を0〜SCROLL_MAXにクランプして保持し、そのままrecord.js側に渡す
// (画面の向き・銀河の出現度合いの計算はrecord.js側で完結させている)。
let recordScrollY = 0;
renderer.domElement.addEventListener('wheel', (e) => {
  if (!universe.isActive) return; // 宇宙ページ内でのみ有効
  e.preventDefault();
  // ★ 2026-09-17 追加(ご指示反映): 「バナナクリック後は、スクロールとクリックを
  //   一時的に不可にして」への対応。戴冠演出(record.coronationStarted)が始まって
  //   から、一連の演出が完了する(recordSequenceDone)までの間は、スクロールを
  //   一切受け付けない。
  if (record.coronationStarted && !recordSequenceDone) return;
  // ★ 2026-09-15 追加(ご指示反映): バナナクリック後の演出が完了した(recordSequenceDone)
  //   以降は、スクロールの用途をcarousel⇔鏡の切り替えから「銀河俯瞰カメラの高さ調整」へ
  //   切り替える。以後applyScroll(record, ...)は二度と呼ばない(呼んでも
  //   tripodRingSwap.updateTripodRingSwapはswap.done===trueで無視するだけだが、
  //   record.viewMixTarget自体が無駄に動くのを避けるため、ここで完全に分岐しておく)。
  if (recordSequenceDone) {
    applyGalaxyOverviewScroll(e.deltaY);
    return;
  }
  recordScrollY = THREE.MathUtils.clamp(recordScrollY + e.deltaY, 0, SCROLL_MAX);
  applyScroll(record, recordScrollY);
}, { passive: false });

// ── 2026-09-15 追加(2回目の修正): レコード完成後(recordSequenceDone)のカメラ ──────
// ご指摘反映: 「銀河へ寄っていく俯瞰」ではなく望遠鏡のようなUXにしたい
// (=近づく移動は一切しない。高さを変えるか、fov(光学ズーム)を変えるだけ)。
// そのため、以前のenterGalaxyOverview(新しい俯瞰位置へカメラを飛ばす)は撤回し、
// 基準位置を「universe開始位置そのもの」= config.jsのUNIVERSE_CAMERA_POSに固定した。
//   - スクロール: UNIVERSE_CAMERA_TARGETを中心にした仰角(elevation)だけを変える。
//     targetからの距離は常に一定(=近づく/離れるという移動が起きない)。
//   - 左右同時ドラッグ: fovだけを変える光学ズーム(位置は不変)。ドラッグしている間だけ
//     拡大でき、指を離す(ボタンを離す)と既定fovへ戻る(=ドラッグ中でしか拡大できない)。
// ★ 2026-09-16 3回目の修正(ご指摘反映):
//   - 「スクロールでの高さは0から50度ぐらいまででよい」→ 世界座標のYを直接動かす方式
//     (前回の実装)をやめ、UNIVERSE_CAMERA_TARGETを中心とした球面座標で「仰角」を
//     0°(=現状のuniverse開始時の見下ろし角そのもの)〜OVERVIEW_ELEVATION_MAX_DEG(=50°)
//     の範囲で動かす方式に変更した。距離(target〜カメラ)は球面座標の半径として常に
//     一定に保たれるので、望遠鏡のように「首を振るだけで近づかない」動きになる。
//   - 「デフォルト銀河はまだ全然小さいので、もう少しzoomできない?」→ 望遠鏡UX
//     (位置は動かさずfovだけで寄る)の制約の中でできる対応として、最大ズーム時のfovを
//     さらに狭めた(6→2)。
const OVERVIEW_ELEVATION_MAX_DEG = 50;    // ご指定値。仰角を0°〜この角度まで動かす
const OVERVIEW_HEIGHT_SMOOTHING = 3.0;    // 仮値。スクロールでの仰角変化をなめらかにする係数(record.jsのVIEW_MIX_SMOOTHINGと同じ流儀)
// ★ 追加(ご指示反映): 「銀河俯瞰モードに入るとき・左右ドラッグを解除したときのカメラの速度を
//   5%まで大幅に減速」。下の2つの所要時間(フライト・fov復帰)を、この比率で割って引き伸ばす
//   (0.05なら20倍の時間=ゆっくり)。1にすると元の速さ。
const OVERVIEW_CAMERA_SPEED_RATIO = 0.05;
const OVERVIEW_TRANSITION_DURATION = 1.2 / OVERVIEW_CAMERA_SPEED_RATIO; // 銀河俯瞰(=telescopeの基準姿勢)へ最初に戻すフライトの秒数(元1.2秒→24秒)
const OVERVIEW_SCROLL_RANGE = 1200;       // 仮値。この累積スクロール量で仰角が0°⇔MAXまで振れる
// ★ 2026-09-16 7回目の修正(ご指摘反映): 「デフォルトのfovが大きすぎるし、拡大限度も
//   小さい」への対応。前回のtanベースの倍率計算は、結局「基準fovが広すぎる」問題を
//   引きずったまま拡大量を決めていたため不十分だった。ここでは基準fov・最大ズームを
//   それぞれ直接の角度指定に戻し、基準を大きく狭め、最大ズームもより強くした。
//   (前々回、fov=2という極端な値を「バグの原因では」と疑ったが、実際の原因は
//   ドラッグ判定側にあったと判明したため、狭いfov自体は問題ない)
const OVERVIEW_FOV_BASE = 70;             // 銀河俯瞰時の既定(ドラッグしていない)fov。
// ★ 追加(ご指摘反映): 「視点が遠い(=ドラッグしていない基準fov)と明るすぎる」への対応。
//   左右ドラッグでfovを望遠側へズームする操作に、カメラの絞り(露出)の変化を連動させる。
//   ドラッグしていない基準状態(=fov広角・視点が遠い)ほど絞って暗く、目一杯ドラッグして
//   ズームした状態(望遠)ほど絞りを開けて通常の明るさに戻す。fovと同じタイミング
//   (俯瞰突入のフライト・ドラッグ中・ドラッグ解除で戻る動き)すべてに連動させることで、
//   「遷移的な絞り変化」にしている。
const OVERVIEW_EXPOSURE_FAR_MULT = 0.15;  // 仮値。基準fov(遠景)側の露出倍率。1より下げて絞る
const OVERVIEW_EXPOSURE_ZOOM_MULT = 1.0;  // 目一杯ズームした側の露出倍率(通常の明るさ)
const OVERVIEW_FOV_ZOOMED = 0.8;            // 仮値。目一杯ドラッグしたときの最大ズーム。以前より強めた
const OVERVIEW_FOV_DRAG_DISTANCE = 400;   // 仮値。このぶん(px)左右ドラッグしたらズームが振り切る
const OVERVIEW_FOV_RESET_DURATION = 0.6 / OVERVIEW_CAMERA_SPEED_RATIO; // ドラッグを離したときにbase fovへ戻る秒数(元0.6秒→12秒)
// ★ 2026-09-16 追加(ご指示反映): 最後の俯瞰画面で、レコード(=universe.goldenRing。
//   carousel側へ戻された「下側のリング」)の右側に針(record.needle)を配置する演出を
//   試していたが、位置が定まらず不自然だったため、2026-09-17に撤去した(下記の
//   enterGalaxyOverview内も参照。関連コードは削除済み)。

// ★ 2026-09-16 追加(ご指示反映)・2026-09-17 単純化(ご指摘反映):
//   「0〜8度で太陽系軌道の消滅。8〜50度でcarousel(tripod一式)の消滅」という単純な
//   1本の境界線でよかったので、閾値を2つ持つのをやめてOVERVIEW_HIDE_SPLIT_DEG
//   1つに統一した(仰角がこれ未満なら軌道を隠し、これ以上ならcarouselを隠す)。
const OVERVIEW_HIDE_SPLIT_DEG = 8; // 仮値。見た目を見ながら調整してください

// ── ティルトシフト(被写界深度風)の設定 ─────────────────────────
// 「カメラが一番低い(仰角0°)間はcarouselにだけピントが合い、上下がぼける。スクロールで
//   カメラが上がるにつれてぼけが解け、carouselが消える境界(OVERVIEW_HIDE_SPLIT_DEG)で
//   ちょうどぼかし0になる」という対応にしてある(carousel消滅の瞬間にボケが残らない)。
// 帯の位置・幅はcarouselの実寸から毎フレーム画面座標へ投影して求めるので、fov(ズーム)や
// 画面サイズが変わっても「carouselの範囲」に追従する。
// ★ ご指示反映: 「ティルトシフトの遷移は、カメラの高さ(仰角)と関係づける。一番高いところ
//   (=OVERVIEW_ELEVATION_MAX_DEG、望遠鏡としての一番引いた視点)は常にクリアな『マクロ』の
//   見え方、カメラが下がる(仰角が下がる)ほど銀河が『ミクロ化』したように強くボケる」という演出。
//   ★ 修正: 「8°まではボケなしのまま→そこから急に変化」という段差(プラトー)をやめ、
//   仰角0°(一番低い=ミクロ全開)〜OVERVIEW_ELEVATION_MAX_DEG(一番高い=マクロ全開)の
//   全区間を、途中で一定区間止まることなく連続的にボケが変化するようにした。
//   以前は`universe.goldenRing.visible`(carousel自体が表示されているか)にも依存していたが、
//   これをやめて仰角だけの純粋な関数にした(carouselの表示/非表示という実装都合ではなく、
//   カメラの高さという体験に紐づけるため)。carouselが非表示になった後も、投影計算自体は
//   (Box3.setFromObjectがvisible=falseでも効くので)引き続き有効な値を返すため、実害はない。
const TILT_SHIFT_CURVE = 1.6; // 1で仰角に対して線形。大きいほど下の方(ミクロ側)でボケが急に強まる
const TILT_SHIFT_FLIGHT_EASE = (t) => t * t * (3 - 2 * t); // 立ち上がりのイージング(smoothstep)
// ★ 修正(ご指摘反映): 以前はここにoverviewFlightT(基準姿勢へ戻るカメラフライトの進行度)を
//   掛けていたため、「銀河俯瞰モードのカメラ速度を5%に落とす」変更でフライトが24秒かかるように
//   なった影響を受け、ボケがスクロールに追従せず「フライトが終わるまで最大24秒待たされる」
//   ものになっていた(=スクロールで遷移的に動いているように見えない原因)。
//   ティルトシフトの強さは、カメラのフライト時間とは無関係に、常にスクロール量(仰角)だけで
//   決まるようにし、俯瞰モードに入った瞬間の見た目の唐突さだけを、この短い固定時間の
//   イントロで吸収する(スクロール速度やカメラ速度が何であっても常に一定の速さ)。
const TILT_SHIFT_INTRO_DURATION = 0.6; // 俯瞰モードに入った瞬間だけのフェードイン秒数(固定。カメラ速度の影響を受けない)
let tiltShiftIntroStart = null;        // 俯瞰モードに入った時刻(clock.getElapsedTime())。null=未計測

// ★ 2026-09-19 削除(ご指示反映): 「最後の俯瞰モードでcarousel一式を縮小・銀河中心へ
//   移動する」演出(captureCarouselRig/updateCarouselScale)は、ihの回転停止・挙動異常
//   バグの温床になり続けたため丸ごと廃止した。代わりに銀河そのものを拡大する方針に変更
//   (galaxy.js側のgrowGalaxyScale/record.jsのplayCoronationSequence呼び出し箇所を参照)。
//   これによりcarousel側のオブジェクトは一切いじらなくなり、universe.js側の自転・公転の
//   実装がどうであっても干渉しない(=このクラスの不具合が構造的に起きなくなる)。





const _tsBoxA = new THREE.Box3();
const _tsBoxB = new THREE.Box3();
const _tsRingPos = new THREE.Vector3();
const _tsCylinder = { center: new THREE.Vector3(), radius: 1, yMin: 0, yMax: 1 };

// carousel(tripod一式+リング)を囲む円柱を求める。
//   - 軸(x,z)と半径: リング(goldenRing)。tripodの底面外接円と同じ半径・同じ軸まわりで自転するので、
//     回転してもブレない。
//   - 高さ: tripodAnchor+goldenRingのワールドBox3のyの範囲(Y軸まわりの回転ではyの範囲は変わらない)。
function computeCarouselCylinder() {
  const ring = universe.goldenRing;
  ring.getWorldPosition(_tsRingPos);
  _tsBoxA.setFromObject(universe.tripodAnchor);
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
    const elevationDeg = (overviewScrollCurrent / OVERVIEW_SCROLL_RANGE) * OVERVIEW_ELEVATION_MAX_DEG;
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
    if (window.__tsDebug) {
      // ★ デバッグ用(通常は何もしない): コンソールで window.__tsDebug = true とすると、
      //   「投影で求めた実際の半幅」と「minHalf/maxHalfでクランプされた後の半幅」を出す。
      //   この2つが同じ値ならminHalf/maxHalfは効いておらず、falloff/paddingを触るべき、
      //   という判断に使える。
      console.log('[tiltShift] cylinder=', cyl, 'passes uFocusHalf(clamped)=', tiltShift.passes[0].uniforms.uFocusHalf.value);
    }
  }
}

// UNIVERSE_CAMERA_TARGETを中心とした球面座標(半径・仰角・方位角)。仰角0°=このまま
// (=UNIVERSE_CAMERA_POSそのもの)、仰角を上げるほどtargetの真上寄りへ弧を描いて
// 移動する(半径=targetからの距離は不変)。
const OVERVIEW_BASE_OFFSET = new THREE.Vector3().subVectors(UNIVERSE_CAMERA_POS, UNIVERSE_CAMERA_TARGET);
const OVERVIEW_BASE_SPHERICAL = new THREE.Spherical().setFromVector3(OVERVIEW_BASE_OFFSET);

let overviewActive = false;      // telescopeモードへの移行が完了(または移行中)かどうか
// ★ 2026-09-17 追加(ご指示反映): 「固定3本の腕を太くする」演出のtween進行度(0〜1)。
//   galaxy.js側のsetGalaxyArmEmphasisへそのまま渡す。growGalaxyArms/calmGalaxyArms
//   参照。
// ★ 2026-09-16 修正(ご指摘反映): 「スクロールでの高さ移動量をもっとなめらかに」への対応。
//   以前はホイールイベントのたびに高さを即座に反映していたが、record.js(viewMixCurrent)
//   と同じ「target(即時更新) → current(毎フレーム指数スムージングで追従)」の2段構えにした。
let overviewScrollTarget = 0;  // 0〜OVERVIEW_SCROLL_RANGE。0=仰角0°(基準姿勢)から開始
let overviewScrollCurrent = 0; // 毎フレームtargetへなめらかに近づく実際の値(仰角の計算に使う)
let overviewFovDragActive = false;
let overviewFovDragStartX = 0;
let overviewFovResetTween = null;      // ドラッグ解除時のbaseへ戻すtween(次のドラッグ開始時にkillする)
let overviewExposureResetTween = null; // ↑と同じタイミングで、露出を絞り側へ戻すtween
let overviewBaseExposure = 1;          // enterGalaxyOverview完了時に確定する「基準露出」。以後の絞り計算の元になる
let overviewFlightInProgress = false; // enterGalaxyOverviewの基準姿勢フライト中かどうか
let overviewFlightT = 0;              // 基準姿勢フライトの進行度(0〜1)。ティルトシフトの立ち上がりに使う
const galaxyArmEmphasis = { t: 0 }; // 0=通常、1=固定3本の腕が太く・明るく強調された状態

// 仰角(度)からカメラのワールド座標を計算する(半径・方位角は基準のまま固定=近づかない)。
function overviewPositionForElevationDeg(elevationDeg) {
  const elevationRad = THREE.MathUtils.degToRad(elevationDeg);
  const spherical = OVERVIEW_BASE_SPHERICAL.clone();
  // phiはY軸(上)からの角度。仰角(見下ろす角度)を増やすほどtargetの真上に近づく=phiを減らす。
  spherical.phi = THREE.MathUtils.clamp(OVERVIEW_BASE_SPHERICAL.phi - elevationRad, 0.001, Math.PI - 0.001);
  spherical.makeSafe();
  return new THREE.Vector3().setFromSpherical(spherical).add(UNIVERSE_CAMERA_TARGET);
}

// 現在のoverviewScrollCurrentから仰角を計算し、カメラへ反映する(距離は常に一定=
// 近づく移動は発生しない)。
function applyOverviewCameraHeight() {
  const t = overviewScrollCurrent / OVERVIEW_SCROLL_RANGE; // 0〜1
  const elevationDeg = t * OVERVIEW_ELEVATION_MAX_DEG;
  camera.position.copy(overviewPositionForElevationDeg(elevationDeg));
  camera.lookAt(UNIVERSE_CAMERA_TARGET);
}

// 毎フレーム呼ぶ(animate内、overviewActive中のみ意味を持つ)。overviewScrollCurrentを
// overviewScrollTargetへ指数スムージングで近づけ、その結果をカメラへ反映する。
// ★ 突入直後の基準姿勢へ戻すフライト(enterGalaxyOverview)の最中は、position自体を
//   flight側が管理しているのでここでは何もしない(でないと毎フレーム上書きし合って
//   フライトのlerpが機能しなくなる)。
// ★ 修正(ご指摘反映): 以前はenterGalaxyOverviewのフライト中(overviewFlightInProgress)は
//   ここを完全にスキップしていたため、overviewScrollCurrent自体が更新されず、フライトが
//   終わるまでスクロールした量が一切反映されなかった。フライトはOVERVIEW_TRANSITION_DURATION
//   (カメラ速度5%化により24秒)かけて進むイージング(power2.inOut)なので、終盤は見た目上
//   ほぼ動きが止まって「もう着いた」ように見えるが、実際にはonComplete(t=1)までスクロールが
//   一切効かず、そこで初めてこの関数が動き出す。→ 見た目は止まっているのにスクロールしても
//   何も起きない「長い待たされ感」の原因だった。
//   対応: overviewScrollCurrentの更新自体はフライト中も常に行う(=スクロールした量は
//   リアルタイムに反映され続ける)。フライト中だけ、その値をcamera.positionへ適用する
//   (=見た目を動かす)処理をenterGalaxyOverview側のonUpdateに譲る(下記参照)。
//   onUpdate側はstartPos(フライト開始位置)から「今のoverviewScrollCurrentに対応する位置」
//   へflight.tで滑らかにブレンドするため、フライトが終わった瞬間(t=1)には既に
//   「その時点でのスクロール量」と完全に一致した位置にいる。以後は別段の追いつき待ちが
//   発生しない(=フライト終了=即・自由にスクロール操作できる状態、という設計にした)。
function updateOverviewCameraHeight(deltaSeconds) {
  if (!overviewActive) return;
  const smoothing = 1 - Math.exp(-OVERVIEW_HEIGHT_SMOOTHING * deltaSeconds);
  overviewScrollCurrent = THREE.MathUtils.lerp(overviewScrollCurrent, overviewScrollTarget, smoothing);
  if (overviewFlightInProgress) return; // 位置の反映はフライトのonUpdateに任せる(下記)
  applyOverviewCameraHeight();
}

// ── 2026-09-17 追加(ご指示反映): 銀河の固定3本の腕(galaxy.js側の
//    GALAXY_ARM_EMPHASIS_BRANCHES=[0,3,6]、120°間隔)を太く・明るく強調する演出。
//   - growGalaxyArms(): 最後の俯瞰視点(telescopeモード突入=enterGalaxyOverview)の
//     タイミングで呼ぶ。0→1へアニメーションし、3本だけが太く浮き上がって見える。
//   - calmGalaxyArms(): 1→0へ戻す(=今の常時の静かな見た目に戻す)。
//     ★ 現時点ではまだ呼び出し元がない。「レコードのアーム(tonearm)を円盤に置く」
//       ギミックを今後追加する予定とのことなので、その完了ハンドラからこの関数を
//       呼ぶ想定で用意しておく(=アームが置かれたら銀河も静かなレコードモードに戻る、
//       という対応関係)。
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

// 最初のスクロールで一度だけ呼ぶ: 右ドラッグ等でズレていたカメラ位置/fovを、
// telescopeの基準姿勢(UNIVERSE_CAMERA_POS=仰角0°・base fov)へ滑らかに戻す。
// ★ ここでも「今の位置から基準位置へ寄せる」だけで、銀河へ近づく移動先には飛ばさない。
function enterGalaxyOverview() {
  if (overviewActive) return;
  overviewActive = true;
  tiltShiftIntroStart = clock.getElapsedTime(); // ★ 追加: ここからTILT_SHIFT_INTRO_DURATION秒だけフェードイン
  if (controls) controls.enabled = false; // telescopeモード中は専用のスクロール/ドラッグでのみ制御する

  // ★ 2026-09-17 追加(ご指示反映): 「最後の俯瞰視点になったときに変化」の反映。
  //   telescopeモードに入った(=最後の俯瞰画面に到達した)このタイミングで、
  //   銀河の固定3本の腕を太く・明るく強調し始める。
  growGalaxyArms();

  // ★ トーンアーム(ガラス製。record.js側で位置決めまで実装済み)は、以前は銀河出現と
  //   同時に早々と表示していたが、「最後の銀河俯瞰時に出現していれば十分」とのご指示で
  //   ここ(telescopeモード突入時)まで表示を遅らせるように変更した。
  if (record.tonearm) record.tonearm.visible = true;

  // ★ 追加(ご指示反映): 「銀河俯瞰時は、実際の銀河のように中心に近いほど角速度を
  //   速くしたい。アームを置いたら現状の仕様(剛体回転)へ戻す」への対応。
  //   アームを置く(placeTonearmOnRecord)側でfalseに戻す。
  setGalaxyDifferentialRotation(galaxy, true);

  const startPos = camera.position.clone();
  const startFov = camera.fov;
  const startExposure = renderer.toneMappingExposure; // ★ 追加: 突入前の露出(=以後の基準値)
  const targetExposure = startExposure * OVERVIEW_EXPOSURE_FAR_MULT;
  const flight = { t: 0 };
  overviewFlightInProgress = true;
  gsap.to(flight, {
    t: 1,
    duration: OVERVIEW_TRANSITION_DURATION,
    ease: 'power2.inOut',
    onUpdate: () => {
      // ★ 修正: 固定の目的地(旧targetPos=仰角0°)ではなく、「今スクロールが指している仰角」の
      //   位置を毎フレーム計算してブレンド先にする。updateOverviewCameraHeight()がフライト中も
      //   overviewScrollCurrentを更新し続けているので、フライトの最中にスクロールしても、
      //   その効き目がflight.tの重み(最初は小さく、終わりに向けて1に近づく)で少しずつ
      //   反映され、フライトが終わる頃には完全にスクロール操作と一致した状態になる。
      const elevationDeg = (overviewScrollCurrent / OVERVIEW_SCROLL_RANGE) * OVERVIEW_ELEVATION_MAX_DEG;
      const basePos = overviewPositionForElevationDeg(elevationDeg);
      camera.position.lerpVectors(startPos, basePos, flight.t);
      camera.fov = THREE.MathUtils.lerp(startFov, OVERVIEW_FOV_BASE, flight.t);
      renderer.toneMappingExposure = THREE.MathUtils.lerp(startExposure, targetExposure, flight.t); // ★ 追加: fovと同時に絞りも遷移
      camera.updateProjectionMatrix();
      camera.lookAt(UNIVERSE_CAMERA_TARGET);
      overviewFlightT = flight.t;
    },
    onComplete: () => {
      overviewFlightInProgress = false;
      overviewFlightT = 1;
      renderer.toneMappingExposure = targetExposure; // 誤差の丸め込み
      overviewBaseExposure = startExposure; // ★ 追加: 以後のドラッグ絞り計算はこの値を基準にする
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

// 左右ボタン同時押しのままドラッグ(このプロジェクトの他の箇所と同じジェスチャー)で
// fov(光学ズーム)だけを調整する。位置は変えない。telescopeモード中(overviewActive)のみ有効。
// ★ ドラッグしている間だけ拡大でき、ボタンを離すとbase fovへ戻る(=ドラッグ中でしか
//   拡大できない仕様)。
// ★ バグ修正: enterGalaxyOverview()の基準姿勢フライト(overviewFlightInProgress。
//   OVERVIEW_TRANSITION_DURATION=約24秒)中は、そのonUpdateが毎フレーム無条件に
//   camera.fov/renderer.toneMappingExposureを「フライトの進行度に応じた基準姿勢寄りの値」
//   で上書きし続けている。このガードが無いと、フライト中にドラッグしてfovを変えても、
//   次のフレームでフライト側にすぐ書き戻されてしまい、「ドラッグでズームしたと思ったら
//   勝手に俯瞰へ戻される」という挙動になる(フライトが終わるとこの上書きが止まるので、
//   あたかも「はじめの間だけの一時的なバグ」に見えていた)。フライト中はこのハンドラを
//   まるごと無効化し、フライト完了後にだけドラッグズームを受け付けるようにする。
renderer.domElement.addEventListener('pointermove', (e) => {
  if (!overviewActive || overviewFlightInProgress) return;
  const bothDown = e.buttons === 3; // 左(1)+右(2)の同時押し

  if (!overviewFovDragActive) {
    if (!bothDown) return;
    overviewFovDragActive = true;
    overviewFovDragStartX = e.clientX;
    if (overviewFovResetTween) overviewFovResetTween.kill(); // 戻り途中に再ドラッグしたら即座に手動制御へ戻す
    if (overviewExposureResetTween) overviewExposureResetTween.kill(); // 絞りも同様
    return;
  }

  if (!bothDown) {
    endOverviewFovDrag();
    return;
  }

  // 左右どちらへドラッグしてもズーム量として扱う(距離が大きいほど狭fov=望遠寄り)。
  const dragged = Math.abs(e.clientX - overviewFovDragStartX);
  const zoomT = THREE.MathUtils.clamp(dragged / OVERVIEW_FOV_DRAG_DISTANCE, 0, 1);
  camera.fov = THREE.MathUtils.lerp(OVERVIEW_FOV_BASE, OVERVIEW_FOV_ZOOMED, zoomT);
  // ★ 追加: fovのズームと同じ量(zoomT)で絞りも一緒に開けていく(遠景=絞る/望遠=開ける)。
  renderer.toneMappingExposure = overviewBaseExposure
    * THREE.MathUtils.lerp(OVERVIEW_EXPOSURE_FAR_MULT, OVERVIEW_EXPOSURE_ZOOM_MULT, zoomT);
  camera.updateProjectionMatrix();
});
window.addEventListener('pointerup', () => {
  if (overviewFovDragActive) endOverviewFovDrag();
});

// ドラッグ解除時にbase fovへ、早すぎず遅すぎずの速度(OVERVIEW_FOV_RESET_DURATION秒)で
// 戻す。
function endOverviewFovDrag() {
  overviewFovDragActive = false;
  overviewFovResetTween = gsap.to(camera, {
    fov: OVERVIEW_FOV_BASE,
    duration: OVERVIEW_FOV_RESET_DURATION,
    ease: 'power2.out',
    onUpdate: () => camera.updateProjectionMatrix(),
  });
  // ★ 追加: fovが基準へ戻るのと同じ速さで、絞りも遠景側(暗い方)へ戻す。
  if (overviewExposureResetTween) overviewExposureResetTween.kill();
  const exposureProxy = { v: renderer.toneMappingExposure };
  overviewExposureResetTween = gsap.to(exposureProxy, {
    v: overviewBaseExposure * OVERVIEW_EXPOSURE_FAR_MULT,
    duration: OVERVIEW_FOV_RESET_DURATION,
    ease: 'power2.out',
    onUpdate: () => { renderer.toneMappingExposure = exposureProxy.v; },
  });
}

// ── 疑似正射影 ⇄ 透視図の右ドラッグ切り替え ─────────────────────
// ご指示「carouselから切り替え、右ドラッグで透視図モードに切り替える」の反映。
// record.phase!=='inactive'(=startRecordDisplay後。「carouselから切り替え」た後)になって
// 初めて有効にする。一定量ドラッグしたら透視図側へ「確定」させ、以後record.perspectiveActiveを
// trueにする(この結果、ihがunlockIhで出現できるようになる)。
// ★ 以前はこの確定後にスクロールで銀河を縮小させる仕組みと連動していたが、銀河自体の
//   拡大・縮小は廃止されたため、現在record.perspectiveActiveは「右ドラッグ確定済みか」を
//   示すだけのフラグになっている。
// 確定する前にドラッグを止めた(ボタンを離した)場合は、疑似正射影側へ戻す(仮の挙動)。
let projectionDragActive = false;
let projectionDragStartX = 0;
let projectionMixValue = 0;
const PROJECTION_DRAG_DISTANCE = 400; // このぶん(px)ドラッグしたら透視図へ完全移行する(仮値)

// ★ 2026-09-12 再修正: 「pointerdownがちょうど左右同時押しの瞬間(buttons===3)に発火する」
//   ことに依存していたが、これがブラウザ・OSによっては安定して発火しないことがあった
//   (両クリックしても反応しない、との報告)。pointermove側でe.buttonsを毎回直接見る形に
//   まとめ、pointerdownには依存しないようにする(マウスが動いた瞬間に判定するので、
//   同時押しした後に少しでもカーソルが動けば確実に拾える)。
renderer.domElement.addEventListener('pointermove', (e) => {
  const bothDown = e.buttons === 3; // 左(1)+右(2)の同時押し

  if (!projectionDragActive) {
    if (!bothDown) return;
    // ★ 2026-09-16 6回目の修正(ご指摘反映): 「ドラッグでのzoom距離に反映されてる」バグの
    //   本当の原因はここだった。overviewActiveは「最初のスクロールをした後」にしか
    //   trueにならないため、recordSequenceDone(バナナ演出完了)直後、まだ一度も
    //   スクロールしていないタイミングで左右ドラッグすると、この判定をすり抜けて
    //   旧来の「距離を変えるズーム」(setUniverseProjectionMix)が起動してしまっていた。
    //   overviewActiveではなくrecordSequenceDone(演出完了後は恒久的にtrue)で判定する
    //   ことで、スクロールの有無に関わらず演出完了後はこの旧ハンドラを確実に無効化する。
    if (!universe.isActive || record.perspectiveActive || recordSequenceDone) return; // universe開始前 or 切り替え済み or バナナ演出完了後なら無視
    projectionDragActive = true;
    projectionDragStartX = e.clientX;
    return; // 開始位置を記録するだけ。動かすのは次のmoveから
  }

  if (!bothDown || !universe.isActive) {
    // 途中でどちらかのボタンを離した(またはuniverse.isActiveでなくなった)→中断して疑似正射影側へ戻す。
    projectionDragActive = false;
    if (!record.perspectiveActive) {
      projectionMixValue = 0;
      setUniverseProjectionMix(0);
    }
    return;
  }

  const dragged = e.clientX - projectionDragStartX; // 右方向ドラッグで透視図へ進める(仮の向き)
  projectionMixValue = THREE.MathUtils.clamp(dragged / PROJECTION_DRAG_DISTANCE, 0, 1);
  setUniverseProjectionMix(projectionMixValue); // ★ UNIVERSE_CAMERA_POSの角度を維持したまま距離・fovだけ変える専用ミキサー
  if (projectionMixValue >= 1 && !record.perspectiveActive) {
    record.perspectiveActive = true; // ★ 右ドラッグでの透視図切り替えが確定した
    unlockIh(universe); // ★ 左右同時ドラッグ完了後にだけihが出現できるようにする
  }
});

renderer.domElement.addEventListener('contextmenu', (e) => {
  // ★ 2026-09-12 再修正: record.phaseとの連動が不安定だったため条件から外し、
  //   universe.isActiveだけで判定するようにした(universe開始前は右ボタンに
  //   一切機能を持たせない。ブラウザ既定の右クリックメニューも抑止しない)。
  if (universe.isActive) e.preventDefault();
});

// pointermove側で継続判定しているので、pointerupは「マウスを動かさずにボタンだけ離した」
// 場合の保険として残す(通常はpointermove側で先に中断処理される)。
window.addEventListener('pointerup', () => {
  if (!projectionDragActive) return;
  projectionDragActive = false;
  if (!record.perspectiveActive) {
    // 確定(1)に達しないまま離した場合は、疑似正射影側へ戻す(仮の挙動。
    // 「一定量ドラッグし切らないと切り替わらない」という中断可能な操作感にしている)。
    projectionMixValue = 0;
    setUniverseProjectionMix(0);
  }
});

const zWave = createZAxisWave(scene); // Z軸:ガウス波束のらせん(軸到達後にreveal、その後ゆっくり位相回転)
const axisLabels = createAxisLabels(scene); // 三軸(X/Y/Z)のラベル(home状態になったら表示)
const axisStationOverlay = createAxisStationOverlay(scene); // X/Y軸ステーション限定の追加表示(終端・原点の点+タイトル)
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
  axisConstellationOverlay.hideTeddyImage(); // ← Teddyクリックで出した星座風画像もここで消す
  dialogue.hide(); // 終端の点のセリフを表示中だった場合、10秒タイマーでの誤復帰を防ぐため即閉じる
  yOverlayActive = false;
}

// ── X軸ステーション限定の追加表示のオン/オフ(Yと同じ考え方) ──
let xOverlayActive = false;

function showXOverlay() {
  axisLabels.sprites.X.visible = false;
  axisStationOverlay.showX();
  axes.setXFlowActive(true); // ← The Catcher in the Rye表示と同じ条件でX軸の流れ演出をオンにする
  xOverlayActive = true;
}

function hideXOverlay() {
  if (!xOverlayActive) return;
  axisLabels.sprites.X.visible = true;
  axisStationOverlay.hideX();
  axes.setXFlowActive(false); // ← 同上、オフに戻す
  axisConstellationOverlay.hideCatcherImage(); // ← Catcherの星座風画像もここで消す
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
  // ※ ここでzWave.reset()は呼ばない。hideZOverlay()は「空白クリックで点/タイトル表示だけ戻す」ケースでも
  //   呼ばれるため、カメラがZステーションに留まったままでも、らせんまで消えてしまっていた(意図しない挙動)。
  //   らせんを消すのは「別の軸へ実際に移動するとき」(下のaxisHit処理)とPhase3突入時のみにする。
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

// ── Phase3: 数式ズーム時、軸まわりの表示を消す ──
// axisLabels/axisStationOverlayはSpriteのopacityを掴めるので滑らかにフェードできるが、
// axes(軸ライン本体)・zWave(らせん)は現状fadeOut()のようなメソッドを持たないため、
// 「あれば呼ぶ」という保険付きの実装にしてある(typeof判定)。
// axes.js/zAxisWave.js側に fadeOut(duration) を生やしてもらえれば、自動的に滑らかになる。
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
  // zWaveにfadeOut()は実装されていない(常にこのtypeofチェックがfalseになり無視されていた)。
  // Phase3以降で万一まだ再生中でも確実に消えるよう、reset()で強制停止する(フェードなし・即座に非表示)。
  zWave.reset();
}

// 以前はここで controls の 'change'(カメラが少しでも動いた瞬間)を監視して
// Y/Xステーションの追加表示を即座に元へ戻していたが、カメラ操作に対してシビアすぎたため撤廃。
// 代わりに、下のクリックハンドラの末尾で「何もない場所をクリックした」ことを条件に元へ戻すようにしている。

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
// ── シーン切り替え時の「継ぎ目隠し」用オーバーレイ ──────────────
// 数式Phase3→宇宙ページの遷移で、カメラが瞬時にジャンプする一方
// 旧スプライトのフェードアウトが1.2秒かけて続いていたため、新カメラのフレームの中に
// 旧数式の残骸が一瞬映り込んでいた(カメラのカットとフェードのタイミングがズレていたのが原因)。
// three.js側で全部のタイミングを丁寧に揃える代わりに、DOM側の単純な黒オーバーレイで
// 「見えない一瞬」を作り、その裏で瞬時に切り替えてしまう(fadeIn→onMid→fadeOut)。
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

// ★ 追加: 宇宙ページのtripod先端のX/Y/Zラベルをクリックしたときに出す、画面固定位置の
//   テキスト表示。dialogue.js(dialogue.show)は3Dオブジェクトに追従する吹き出しなので、
//   「画面中央・上から70%」という完全固定の配置には向かない。captions.js側のキャプション
//   ボックス(数式上のワンフレーズ等と同じ仕組み)を流用し、画面固定位置(50%,70%)に配置
//   して使う(見た目・フェードの挙動を他のセリフ表示と揃えるため)。
// work(出典)は、caption本体と同じくcaptions.js側の共有出典ボックス(getSourceCaption)
// に表示する。
const axisTipCaption = makeCaptionController(createCaptionBox({ leftPercent: 50, topPercent: 70, noWrap: true }));
const AXIS_TIP_TEXT_DURATION = 10; // 表示してから自動で消えるまでの秒数
let axisTipHideTimer = null;

function showAxisTipText(message) {
  if (!message || !message.text) return;
  if (axisTipHideTimer) { clearTimeout(axisTipHideTimer); axisTipHideTimer = null; }
  axisTipCaption.setText(message.text);
  const sourceCaption = getSourceCaption();
  if (message.work) sourceCaption.setText(message.work);
  else sourceCaption.hide();
  axisTipHideTimer = setTimeout(() => {
    axisTipHideTimer = null;
    hideAxisTipText();
  }, AXIS_TIP_TEXT_DURATION * 1000);
}
function hideAxisTipText() {
  if (axisTipHideTimer) { clearTimeout(axisTipHideTimer); axisTipHideTimer = null; }
  axisTipCaption.hide();
  getSourceCaption().hide();
}


function fadeTransition({ fadeInDuration = 0.3, hold = 0.15, fadeOutDuration = 0.3, onMid, onDone } = {}) {
  transitionOverlay.style.transition = `opacity ${fadeInDuration}s ease`;
  transitionOverlay.style.opacity = '1';
  setTimeout(() => {
    if (onMid) onMid(); // ← 画面が完全に黒い間に、旧要素の消灯・カメラジャンプを済ませる
    setTimeout(() => {
      transitionOverlay.style.transition = `opacity ${fadeOutDuration}s ease`;
      transitionOverlay.style.opacity = '0';
      if (onDone) setTimeout(onDone, fadeOutDuration * 1000);
    }, hold * 1000);
  }, fadeInDuration * 1000);
}

renderer.domElement.addEventListener('click', (e) => {
  if (intro.getState() === 'idle') { intro.startSequence(); return; }

  // ★ 2026-09-17 追加(ご指示反映): 「バナナクリック後は、スクロールとクリックを
  //   一時的に不可にして」への対応。戴冠演出(record.coronationStarted)が始まって
  //   から、一連の演出が完了する(recordSequenceDone)までの間は、クリックを
  //   一切受け付けない(record.js側の二重発火防止フラグをそのまま流用している)。
  if (record.coronationStarted && !recordSequenceDone) return;

  // フィナーレ中でも「i」アイコンだけは特別にクリックを許可する
  // (ただし、カメラがFINALE_DESTに完全に静止してから。理由は finaleCameraSettled の定義部を参照)
  if (finaleActive) {
    if (!finaleCameraSettled) return; // カメラがまだ動いている間はiクリックを一切処理しない

    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    const finaleIconHit = finale.iHitArea.visible
      ? raycaster.intersectObject(finale.iHitArea)[0]
      : null;
    // ①完成後、数式そのもの(表示中のシンボルスプライト)をクリックしたらズーム→Phase3。
    if (equationComplete) {
      const p3 = equationAssembly.phase3;

      if (universe.isActive) {
        // ── 宇宙ページ内のクリック判定 ──────────────────
        // ★以前のバグ: ここが無く、下のvisibleSymbols(equationAssembly/p3のスプライトのみ)を
        //   判定していたため、宇宙ページ突入後は対象スプライトが全部visible=falseになっており
        //   eqHitが絶対にヒットしない(=toggleUniverseEquationに永遠に到達できない)状態だった。
        const activeEqSprite = universe.sprites[universe.equationIndex];
        const uEqHit = (activeEqSprite && activeEqSprite.visible)
          ? raycaster.intersectObject(activeEqSprite)[0]
          : null;
        if (uEqHit) {
          toggleUniverseEquation(universe);
          return;
        }

        // ★ 追加: tripod先端のX/Y/Zラベル(universe.axisLabels)クリック→固定位置にテキスト表示。
        //   tripodHitMesh(当たり判定用の大きな球)より先に判定しないと、ラベルへのクリックが
        //   そちらに食われてしまうため、この位置(tripodHit判定より前)に置く。
        const axisTipHit = raycaster.intersectObjects(universe.axisLabels)[0];
        if (axisTipHit) {
          const axisName = axisTipHit.object.userData.axisName;
          showAxisTipText(AXIS_TIP_MESSAGES[axisName]);
          return;
        }

        // tripodクリック → 金のリングが地面に形成され、tripod自体が浮上し、
        // tripodが回転しながら粒子の軌跡(円錐)を永久に残し始める。
        // ★ 2026-09-12 変更(ご指示反映): ih.pngの出現/消滅は、ここでのクリック+タイマーでは
        //   なく、tripodRingSwap.js側が毎フレーム「ゴールドリングが下限にいるかどうか」を
        //   見て自動的に呼び分けるように変更した(詳細はtripodRingSwap.js参照)。そのため
        //   ここではrevealTripodRing/liftTripod/startTripodRoofPulseのみ呼ぶ。
        // ★ 2026-09-11 修正: three.jsのRaycasterはvisible=falseでも判定してしまうため、
        //   鏡側表示中(=tripodHitMesh.visible=false)でも当たり判定だけ残ってしまい、
        //   鏡tripodをクリックしたつもりのクリックがここで先に食われて(revealTripodRing/
        //   liftTripodは既発火済みで実質no-opのため「何も起きない」ように見えつつ)
        //   tryRecordClickまで到達できていなかった。tripodRingSwap.jsのTODOコメントで
        //   指摘されていた不具合そのもの。明示的にvisibleを見て判定自体をスキップする。
        // ★ 2026-09-18 修正(ご指摘反映): 「銀河俯瞰時、tripodクリックでtripodが上に
        //   移動するバグ」への対応。tripodHitMesh(当たり判定用の大きな球)はtripodAnchorの
        //   子ではなくscene直下にあるため、hideCarousel(俯瞰中のcarousel非表示)で
        //   tripodAnchor.visible=falseにしても、この当たり判定自体は生き残ったままだった。
        //   さらにこの判定はshowRecordSide(=recordSequenceDone後は常にfalse)経由で
        //   tripodHitMesh.visible=trueに固定され続けるため、俯瞰中でも過去の場所への
        //   クリックがここに飛び込んでしまっていた。revealTripodRing/liftTripod自体は
        //   二重発火防止フラグがあるので同じ高さへ「跳ね直る」ことはなかったはずだが、
        //   本来この判定一式は「戴冠演出が終わるまで」の片道切符(tripodRingSwap.js側の
        //   doneフラグと同じ設計思想)であり、完了後(recordSequenceDone)に生かしておく
        //   理由がない古いコードだったため、ここで明示的に無効化した。
        const tripodHit = (!recordSequenceDone && universe.tripodHitMesh.visible)
          ? raycaster.intersectObject(universe.tripodHitMesh, true)[0]
          : null;
        if (tripodHit) {
          revealTripodRing(universe);
          liftTripod(universe);
          startTripodRoofPulse(universe);
          return;
        }

        // 「レコードプレーヤー(操作パネル)」: 鏡(→別ページ)/バナナ(→銀河出現)/銀河(→針+太陽系召喚)
        // のいずれかへのクリックをまとめて判定する(詳細はrecord.js参照)。
        if (tryRecordClick(record, raycaster)) {
          return;
        }

        // 太陽クリック → 8惑星ぶんの黄色い軌跡を一括生成(一度生成したら永続。二度目以降は何もしない)
        if (solarSystem.group.visible) {
          const sunHit = raycaster.intersectObject(solarSystem.sunMesh, true)[0];
          if (sunHit) {
            generatePlanetTrails(solarSystem);
            return;
          }
        }
        hideAxisTipText(); // ラベル以外をクリックしたら固定表示のテキストは閉じる
        return; // 宇宙ページ内では、ここまでの判定以外は無視
      }

      const visibleSymbols = [
        ...Object.values(equationAssembly.sprites),
        ...(p3 ? Object.values(p3.sprites) : []),
      ].filter((s) => s && s.visible);
      const eqHit = raycaster.intersectObjects(visibleSymbols)[0];
      if (eqHit) {
        if (!equationZoomed) {
          // 1クリック目: 軸まわりをフェードアウトしつつ数式へズーム
          equationZoomed = true;
          fadeOutAxisVisuals(1.2);
          zoomToEquation({
            camera, controls,
            vertexWorld: equationVertexWorld,
            frame: equationFrame,
            duration: 1.6,
            onComplete: () => {
              // ズーム完了後の最初のクリックで②③④の自動展開を開始する
              // ★ ご指示反映: 波面加工(雨紋+屈折)はphase3の間だけ適用する。
              //   無効化していた間に凍結していた古い波が急に見えないよう、
              //   有効化する瞬間にreset()してからenabled=trueにする。
              wavePass.reset(renderer);
              wavePass.enabled = true;
              waveScrollController.reset(); // 前回分のemaSpeed/scrollEnergyを持ち越さないよう念のため
              startPhase3({ assembly: equationAssembly, camera, onComplete: () => {
                console.log('Phase3(②③④)展開完了');
              } });
            },
          });
        } else if (p3 && p3.stage === 'stage4' && !p3.busy) {
          // Phase3(④)到達後の追加クリックで「宇宙ページ」へ遷移する(1回目のみ。以降はuniverse.isActiveの分岐へ)
          // 旧シーンのフェードアウトとカメラのジャンプ(enterUniverse内で瞬時に発生)の
          // タイミングがズレて残像が見えていたため、黒オーバーレイで一瞬隠している間に
          // 旧要素を即座に消灯し、カメラも切り替える。
          fadeTransition({
            onMid: () => {
              // ★ 2026-09-18 追加(バグ修正): 「たまにuniverse開始時にカメラ位置が
              //   おかしくなる(Yが524.4x付近などに固定される)」の根本原因。
              //   p3.busyが立つ前に連打などで一瞬だけこの分岐を2回通ってしまうと、
              //   fadeTransition(≒このonMid)が2回発火することがある。1回目は
              //   setProjectionMix(0)(camera.positionをorthoPos、fovを2へ)の直後に
              //   enterUniverse()が呼ばれ、まだuniverse.isActiveがfalseなので
              //   camera.positionが正しくUNIVERSE_CAMERA_POSへ上書きされる。ところが
              //   2回目は、setProjectionMix(0)は無条件でまた実行されてcamera.position
              //   をorthoPos(≈524,524,524)へ戻してしまうのに、enterUniverse()側は
              //   「if (universe.isActive) return;」という(正しい)多重発火防止が
              //   既にあるため何もせず、camera.positionを正しい値へ戻す機会が
              //   失われる。結果、animate()側の銀河同期回転がこのorthoPosを
              //   UNIVERSE_CAMERA_TARGETまわりに回し続け、Y(=world Y軸回転で
              //   変化しない成分)がorthoPosのY成分(≈524.4)に固定されたまま、という
              //   ご報告の症状になっていた。
              //   enterUniverse自身と同じ「universe.isActiveなら何もしない」という
              //   ガードをここにも揃えることで、2回目以降の発火そのものを無害化する。
              if (universe.isActive) return;
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
              // ★ 修正: 以前はここでhotspotMeshes(ホーム側のセリフ用hotspot)を隠していなかったため、
              //   同じシーンを共有している宇宙ページ側からも見えてしまっていた。他の旧要素と同様、
              //   ここで非表示にする。
              hotspotMeshes.forEach((m) => { m.visible = false; });
              archer.visible = false;
              // ★ ご指示反映: 波面加工はphase3専用なので、宇宙ページへ移る瞬間に無効化する。
              wavePass.enabled = false;
              // ★重要: スクロール連動でgsap.globalTimeline.timeScale()を動かしていたため、
              //   ここで明示的に1へ戻す。戻さないと、phase3終了時点でたまたま無操作が
              //   続いていた場合にtimeScaleがidleTimeScale(0.05=5%速度)近くまで
              //   落ちたまま残ってしまい、宇宙ページ以降のアニメーション全体が
              //   異常にゆっくりになってしまう(実際に発生していた不具合)。
              waveScrollController.reset();
              // ★ 2026-09-11 追加(バグ調査): 「カメラの設定を変えても最終的な視点が変わらない」
              //   という報告への対応。Phase3(zoomToEquation/startPhase3)がcamera.position/
              //   quaternionをGSAPのtweenで動かしているが、universeページへ遷移する際にその
              //   tweenを明示的に止めていなかった。もしこのtweenが(ループ演出などで)動き
              //   続けたままだと、毎フレームcamera.position/向きを強制的に上書きし続け、
              //   enterUniverse側で何を設定してもそちらへ引き戻されてしまう。
              //   該当tweenが無ければ何も起きない安全な処置なので、防御的にここで確実に止める。
              gsap.killTweensOf(camera.position);
              gsap.killTweensOf(camera.rotation);
              gsap.killTweensOf(camera.quaternion);
              gsap.killTweensOf(camera);
              dumpCamera('onMid, before enterUniverse'); // ← デバッグ: killTweensOf直後の状態を記録
              // ★ 2026-09-11 バグ修正: 以前はsetProjectionMix(0)をenterUniverseのonComplete
              //   (約1秒後、黒オーバーレイが晴れてコンテンツが見え始めた後)で呼んでいたため、
              //   Phase3までの通常の透視図から疑似正射影へ切り替わる瞬間の見た目の変化(視野角の
              //   急な変化)がユーザーに丸見えになってしまっていた。このブロック(onMid。まだ
              //   画面が黒オーバーレイの下に隠れている)でカメラのジャンプと同時に呼ぶことで、
              //   他の要素(旧シーンの消灯・カメラのジャンプ)と同様、切り替わりの瞬間自体を
              //   オーバーレイの下に隠す。
              setProjectionMix(0);
              projectionMixValue = 0;
              record.perspectiveActive = false;
              enterUniverse(universe, {
                camera, controls,
                duration: 1.0, // オーバーレイが晴れた後の新シーンのフェードイン
                onComplete: () => {
                  // ご指示「カメラは位置のみ固定」「ホイールはuniverse専用」の反映:
                  // 宇宙ページに入った瞬間だけpan/zoomを無効化する(それ以外のページでは
                  // 従来通りホイール=ズームとして使えるよう、ここでのみ切り替える)。
                  if (controls) {
                    controls.enablePan = false;
                    controls.enableZoom = false;
                  }
                  // 太陽系はまだ出さない。代わりに「レコードプレーヤー(操作パネル)」
                  // ── カメラ背後の鏡三脚+バナナ ── を表示する(record.js参照)。
                  startRecordDisplay(record);
                  // ★ ご指示反映(方針転換):「銀河は先に実寸大で表示しておく」── フェードや
                  //   拡大の演出なしに、いきなりフルサイズで空間に配置する(galaxy.js側に
                  //   ちょうどこの用途のrevealGalaxyが用意されていたのでそれを使う)。
                  //   銀河本体には(内部バナナも含め)クリック対象は無く、以後この銀河
                  //   自体を拡大・縮小する操作はない(常にこのフルサイズのまま)。
                  revealGalaxy(galaxy);
                  // ★ トーンアーム(ガラス製)は、最後の銀河俯瞰(telescopeモード。
                  //   enterGalaxyOverview)に到達したタイミングでのみ表示するように変更した
                  //   (以前は銀河出現と同時に早々と表示していた)。
                  // universe開始時点のセリフ差し替え。
                  const axisHint2 = document.getElementById('axisHint');
                  if (axisHint2) axisHint2.textContent = 'What is the sound of two hands clapping?';
                  dumpCamera('enterUniverse onComplete'); // ← デバッグ: この時点の実際のカメラ状態を記録
                  console.log('宇宙ページへ遷移完了');
                },
              });
            },
          });
        }
        return;
      }
    }

    if (finaleIconHit) {
      finale.star.visible = false; // ★ 緑の星を消す(以後finale側で再表示されないため、この1回でよい)
      // 宇宙ページ用のセリフへ差し替える(index.html側の#axisHintは
      // "What is the sound of the universe?"のまま固定表示されているだけなので、
      // ここでtextContentを書き換えて切り替える)。
      const axisHint = document.getElementById('axisHint');
      if (axisHint) axisHint.textContent = 'Beauty says nothing at all.';
      handleIconClick({
        finale,
        onNextPhase: () => {
          // まず原点で「黄色い輝点(十字フレア)+青い同心円」を一度だけ再生し、
          // それが完全に終わってからĤ(=startPhase1本体)を登場させる。
          playOriginBurst({
            scene,
            onComplete: () => {
              const result = startPhase1({
                assembly: equationAssembly,
                existingISprite: finale.iSprite,
                camera,
                starField, // ← 星→ψ→=の収束(schrodinger-sequence-timeline.md ⑸〜⑺)に使う
                onHbarArrived: () => { console.log('ħがiに到着'); },
                onEquationComplete: () => {
                  console.log('①(iħ∂ψ/∂t=Ĥψ)完成');
                  equationComplete = true; // ← ここから数式クリックでのズームを受け付ける
                },
              });
              equationVertexWorld = result.vertexWorld;
              equationFrame = result.frame;
            },
          });
        },
      });
    }
    return; // i 以外は引き続き無視
  }

  // ★ここが消えていた本来のトリガー。フィナーレ未開始時に星を押すとここで開始する
  const finaleHit = raycaster.intersectObject(finale.star)[0];
  if (finaleHit) {
    finaleActive = true;
    cameraBusy = true; // 念のため既存の排他制御にも乗せておく
    runFinale({
      camera, controls, dialogue, finale,
      onOrigin: () => { /* 必要ならここで公案の見た目切り替え等 */ },
      onDone: () => {
        finaleCameraSettled = true; // ← カメラがFINALE_DESTに完全静止。ここで初めてiクリックを受け付ける
      },
    });
    return;
  }

  if (intro.getState() !== 'home' || cameraBusy) return;

  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);

  const starHit = raycaster.intersectObjects(hotspotMeshes)[0];

  if (intro.getState() !== 'home' || cameraBusy) return;

  pointer.x = (e.clientX / innerWidth) * 2 - 1;
  pointer.y = -(e.clientY / innerHeight) * 2 + 1;
  raycaster.setFromCamera(pointer, camera);
const panelHit = yzPanel.isActive() ? raycaster.intersectObject(yzPanel.hitMesh)[0] : null;
if (panelHit) {
  onYZPanelClick();
  return;
}

if (starHit) {
  // hitAreaがヒットした場合、親(実際の星メッシュ)まで遡ってuserDataを取る
  const starMesh = starHit.object.userData.texts ? starHit.object : starHit.object.parent;
  const texts = starMesh.userData.texts;
  const text = texts[Math.floor(Math.random() * texts.length)];

  dialogue.show(text, starMesh);
  return;
}

// 射手座(sagittarius.js)はどれかの星をクリックしたら、星座全体(星+線)を消して
// 固定セリフ(SAGITTARIUS_MESSAGE)を1つだけ表示する。
if (archer.visible) {
  const archerHit = raycaster.intersectObjects(archer.userData.stars, true)[0];
  if (archerHit) {
    archer.visible = false; // 星も線も子要素なので、これで射手座全体が消える
    dialogue.show(SAGITTARIUS_MESSAGE, archer);
    return;
  }
}


  if (axisStationOverlay.yEndDot.visible) {
    const endHit = raycaster.intersectObject(axisStationOverlay.yEndDot, true)[0];
    if (endHit) {
      const title = AXIS_CONTENT.Y.end?.title;
      if (title) dialogue.show(title, axisStationOverlay.yEndDot);
      axisConstellationOverlay.showTeddyImage(); // ← Teddyの星座風画像(Cat.png)をフェードイン
      return;
    }
  }

  if (axisStationOverlay.yOriginDot.visible) {
    const yOriginHit = raycaster.intersectObject(axisStationOverlay.yOriginDot, true)[0];
    if (yOriginHit) {
      // セリフの代わりに、専用ページ(bananafish.js)をオーバーレイで開く
      // (YZパネル→ビリヤード台と同じ「フルスクリーンオーバーレイへ切り替える」導線)。
      // onCloseが呼ばれるまでcameraBusyをtrueのまま維持する(nineBall呼び出し時と同じ)。
      cameraBusy = true;
      hideYOverlay();
      bananafish.show();
      return;
    }
  }

  // 隠しボタン「i」(Yステーション限定)。他の点(yEndDot等)と同じく、iHit.visibleで判定する。
  // クリック時の挙動はここが仮実装(ダイアログ表示)なので、必要な演出に差し替えてください。
  if (axisStationOverlay.iHit.visible) {
    const iHitResult = raycaster.intersectObject(axisStationOverlay.iHit)[0];
    if (iHitResult) {
      dialogue.show(IMAGINARY_BUTTON_MESSAGE, axisStationOverlay.iHit);
      return;
    }
  }

  if (axisStationOverlay.xEndDot.visible) {
    const xEndHit = raycaster.intersectObject(axisStationOverlay.xEndDot, true)[0];
    if (xEndHit) {
      const title = AXIS_CONTENT.X.end?.title;
      if (title) dialogue.show(title, axisStationOverlay.xEndDot);
      axisConstellationOverlay.showCatcherImage(); // ← Catcherの星座風画像(Catcher1.png)をフェードイン
      return;
    }
  }

  if (axisStationOverlay.xOriginDot.visible) {
    const originHit = raycaster.intersectObject(axisStationOverlay.xOriginDot, true)[0];
    if (originHit) {
      const title = AXIS_CONTENT.X.origin?.title;
      if (title) dialogue.show(title, axisStationOverlay.xOriginDot);
      return;
    }
  }

  if (axisStationOverlay.zOriginDot.visible) {
    const zOriginHit = raycaster.intersectObject(axisStationOverlay.zOriginDot, true)[0];
    if (zOriginHit) {
      const title = AXIS_CONTENT.Z.origin?.title;
      if (title) dialogue.show(title, axisStationOverlay.zOriginDot);
      triggerZWave(); // ← 原点クリックをトリガーに、らせんを発生させる
      return;
    }
  }

  if (axisStationOverlay.zEndDot.visible) {
    const zEndHit = raycaster.intersectObject(axisStationOverlay.zEndDot, true)[0];
    if (zEndHit) {
      const title = AXIS_CONTENT.Z.end?.title;
      if (title) dialogue.show(title, axisStationOverlay.zEndDot);
      return;
    }
  }

  const axisHit = raycaster.intersectObjects(axes.axisHitAreas)[0];
  if (axisHit) {
    const name = axisHit.object.userData.axisName;
    // TODO: 到達後にAXIS_CONTENT[name]を参照して、原点の点や軸ラベルを実際に表示する(次のステップ。X/Yは実装済み)
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
        if (name === 'Z') {
          showZOverlay(); // Z軸ステーション到達時だけ、原点/終端の点+「Glass Saga」タイトルを表示する
          // らせんの発生は原点クリック時(triggerZWave)に変更したため、到達時には何もしない
        }
      }
    });
    return;
  }

  // ここまでのどれにもヒットしなかった = 何もない場所をクリックした。
  // Y/Xステーションの追加表示(Teddyの点・タイトル・隠しiボタン等)が出ている場合は、ここで元に戻す。
  // (以前はカメラをちょっと動かしただけで戻ってしまっていたが、操作としてシビアすぎたため、
  //  「空白クリック」を明示的な条件にした)
  if (yOverlayActive) hideYOverlay();
  if (xOverlayActive) hideXOverlay();
  if (zOverlayActive) hideZOverlay();
});

// ── YZパネル/隠しiボタンのホバー処理 ──
// (YZパネル:マウスを乗せると反射ガラスとして浮かび上がる / iボタン:Yステーション限定、ホバーで浮かび上がる)
renderer.domElement.addEventListener('pointermove', (e) => {
  // 宇宙ページ内: マウスが方程式画像に近づくほど色がじわっと変化する遊び。
  // isActiveでない間はuniverse.js側で即returnするので、呼びっぱなしで無害。
  updateEquationHoverByPointer(universe, camera, e.clientX, e.clientY);

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

// ── デバッグ用: 現在のカメラ状態をコンソールに出力する ────────────────
// config.js側のUNIVERSE_CAMERA_POS/TARGETなど、カメラ関連の定数をその場の見た目から
// 数値としてキャプチャしたいとき用(以前ここにあった「dumpCamera()デバッグ関数」の
// 再設置。config.js内のUNIVERSE_CAMERA_POSのコメント参照)。
// ★ 2026-09-11 修正: 「Dキーを押しても反応しない」との報告への対応。原因はおそらく
//   DevToolsのコンソールにフォーカスがある状態(直前にコンソールへ何か入力した直後など)
//   だと、キー入力がページ(window)ではなくコンソール側に飛んでしまうこと(コード側の
//   バグではなくブラウザの一般的な挙動)。キー入力に依存しなくて済むよう、コンソールから
//   直接呼べる window.dumpCamera() をグローバルに公開した(「D」キーの方も残してあるので、
//   ページ側にフォーカスがあればそちらでも動く)。本番に残しても実害はないが、あくまで
//   デバッグ用の使い捨てなので、不要になったらこのブロックごと削除してよい。
function dumpCamera(label = '') {
  const p = camera.position;
  const t = controls ? controls.target : null;
  console.log(`── dumpCamera${label ? ' (' + label + ')' : ''} ──`);
  console.log(`camera.position = new THREE.Vector3(${p.x.toFixed(2)}, ${p.y.toFixed(2)}, ${p.z.toFixed(2)});`);
  if (t) console.log(`controls.target = new THREE.Vector3(${t.x.toFixed(2)}, ${t.y.toFixed(2)}, ${t.z.toFixed(2)});`);
  console.log('camera.fov =', camera.fov, '/ camera.zoom =', camera.zoom);
  console.log('projectionMixValue =', projectionMixValue, '/ record.perspectiveActive =', record.perspectiveActive);
  console.log('intro.getState() =', intro.getState(), '/ universe.isActive =', universe.isActive, '/ record.phase =', record.phase);
  console.log('GSAP tweens targeting camera:', gsap.getTweensOf(camera).length, '/ camera.position:', gsap.getTweensOf(camera.position).length);
}
window.dumpCamera = dumpCamera; // ← コンソールに直接 dumpCamera() と打てば呼べる(キー操作に依存しない)
window.addEventListener('keydown', (e) => {
  if (e.key !== 'd' && e.key !== 'D') return;
  dumpCamera('keydown');
});

// ── レンダーループ ─────────────────────────────
let labelsShown = false;
let debugDumpElapsed = 0; // ← デバッグ用: universe.isActive中、一定間隔で自動的にdumpCameraする
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta(); // ← 宇宙ページの回転(updateUniverse)用。フレームの最初に1回だけ呼ぶこと
  const state = intro.getState();
  // ★ 2026-09-11 バグ修正: intro.getState()はuniverseページに入っても'home'には
  //   ならないため、この行はuniverse突入後もそのまま動き続けていた。その結果、
  //   enterUniverse完了直後の一瞬(record.phase==='inactive'でcontrols.update()が
  //   まだ一度も呼ばれていない間)だけ、Phase3時代のlookTarget(数式ズームの注視点)へ
  //   カメラの向きが引っ張られ、「一瞬だけ小さく・水平っぽい視点が見えてから、
  //   極端に視点が切り替わる」ように見えていた。universe.isActiveの間はこの行を
  //   完全にスキップし、向きの制御をOrbitControls(controls.target)に一元化する。
  if (state !== 'home' && !universe.isActive) camera.lookAt(lookTarget);
  // ★ 2026-09-17 追加調査(ご指摘の「たまにuniverse開始時にカメラ位置がおかしくなる」
  //   バグへの対応): 直上の2026-09-11修正では、camera.lookAt(lookTarget)の誤発火
  //   だけをuniverse.isActiveで二重に防いだが、まったく同じ「intro.getState()が一瞬
  //   (またはなんらかの理由で)'home'のまま/'home'に戻ってしまう」状況で、直後の
  //   controls.update()も同様に誤発火しうることに気づいていなかった。
  //   OrbitControls.update()は、自身が最後に記憶している内部の球面座標(target
  //   からの距離・方位角・仰角)を元にcamera.positionを直接書き換える。universe中は
  //   カメラをcode側(updateUniverse・setUniverseProjectionMix等)が直接動かしており、
  //   OrbitControls側の内部状態は更新されず「最後にhome画面にいたときのまま」古い
  //   値を持ち続けている。そのため、何らかの理由でintro.getState()==='home'が
  //   一瞬でも真になった状態でcontrols.update()が呼ばれると、カメラが突然その
  //   「古いhome画面の球面座標」から計算された、universe中のカメラ位置とは無関係な
  //   座標へジャンプしてしまう。ご報告いただいたcamera.positionの不可解な値
  //   (GSAPのtweenは0件=誰も明示的にアニメーションしていない)は、この
  //   controls.update()による上書きと辻褄が合う。
  //   line 1136と同じ考え方でuniverse.isActiveを追加のガードにし、universe中は
  //   intro.getState()が何を返そうとcontrols.update()自体を一切呼ばせないようにした
  //   (labelsShownの表示も、意味的にhome画面専用の演出なので同様に揃えてある)。
  //   ★ ただし、これは「camera.positionが壊れる」という症状そのものへの対症療法
  //   (=OrbitControls側の古い内部状態で上書きされるのを防ぐ)であり、そもそも
  //   なぜintro.getState()が universe.isActive===true の状況で 'home' を返すことが
  //   あるのか、という根本原因はintro側(このファイルには無い、intro状態機械の
  //   実装)にある可能性が高い。intro側で「universe突入後は二度と'home'を返さない」
  //   ことを保証できるなら、そちらで直すのがより根本的な修正になる。
  if (state === 'home' && !universe.isActive && !cameraBusy && !finaleActive) controls.update();
  if (state === 'home' && !universe.isActive && !labelsShown) { labelsShown = true; axisLabels.show(); }
  dialogue.updatePosition();
  // Aスター化した矢のスターダスト更新。矢が非表示の間も、飛んだ後に残った粒が消えるまで毎フレーム呼ぶ。
  try { arrowGroup.userData.update(delta, camera); } catch (err) { console.error('arrow update failed:', err); }
  starField.update(clock.getElapsedTime());
  // らせんの位相回転更新でここが万一例外を投げても、レンダーループ全体(=軸クリックの見た目上の反応)が
  // 止まってしまわないようtry/catchで隔離しておく
  try { zWave.update(clock.getElapsedTime()); } catch (err) { console.error('zWave.update failed:', err); }
  try { axes.update(clock.getElapsedTime()); } catch (err) { console.error('axes.update failed:', err); } // 軸ラインの「原点方向へ流れる光」アニメーション
  try { waveScrollController.tickIdleDecay(); } catch (err) { console.error('waveScrollController.tickIdleDecay failed:', err); } // 波面: scrollEnergy(雨量)の減衰と再生速度をゆっくり戻す
  updateUniverse(universe, delta, camera); // 宇宙ページの三軸回転(固定軸まわりのカルーセル回転。isActiveがfalseの間は内部で即returnするので無害)
  updateSolarSystem(solarSystem, clock.getElapsedTime()); // 太陽系(group.visible=falseの間は内部で即returnするので無害)
  updateGalaxy(galaxy, delta); // tripod直下の巨大な銀河の自転(state==='hidden'の間は内部で即returnするので無害)
  // ★ 2026-09-12 追加: 「カメラも銀河と同じ速度で回転させたい」とのご指示の反映。
  //   galaxy.js側のupdateGalaxy()は、通常状態(record.js側のneedleSpinActive以外)では
  //   direction(=GALAXY_ROTATION_DIRECTION) × GALAXY_ANGULAR_SPEED × deltaSecondsぶん
  //   starsGroupをworld Y軸まわりに毎フレーム回している。ここではまったく同じ角度・
  //   同じ軸・同じ向きで、cameraをUNIVERSE_CAMERA_TARGETまわりに回す
  //   (=カメラと銀河が同じ速さ・同じ向きで一緒に回るので、両者の相対角度は変わらない
  //   ==銀河から見るとカメラは静止して見える形になる)。
  //   universe.isActiveの間だけ動かす(それ以外のページのカメラには影響させない)。
  //   OrbitControls.update()はuniverse.isActive中は呼ばれていない(state!=='home'のため)
  //   ので、ここでcamera.positionを直接動かしてもcontrols側と競合しない。
  //   ★ 2026-09-12 追加: 右ドラッグ中(projectionDragActive)・右ドラッグ確定後
  //   (record.perspectiveActive)は、この自動回転を止める。ドラッグ中はカメラ位置を
  //   setUniverseProjectionMix側が直接制御しているため競合するし、確定後(通常の
  //   透視図に切り替わった状態)は「銀河を背景として固定する」演出自体が終わっている
  //   フェーズなので、回転を続ける意味がない。
  //   ★ 2026-09-18 訂正: 一度は「record.phase==='inactive'の間だけ」というガードを
  //   試したが、record.phaseはenterUniverse完了とほぼ同時(startRecordDisplay)に
  //   'mirror'になり、ユーザーが実際にcarouselを眺めている間ずっと'mirror'のまま
  //   なので、このガードだと自動回転が最初から一切動かなくなってしまっていた
  //   (「カメラが固定され、銀河だけが回っているように見える」というご指摘の症状)。
  //   record/鏡tripodの表示(HOME_CAMERA_POS基準の小さいスケール)とuniverseの銀河・
  //   tripod表示(UNIVERSE_CAMERA_POS基準の大きいスケール)は別々のカメラ位置を
  //   同じ`camera`オブジェクトに対して指定するが、両者は同時に成立するものであり、
  //   record.phaseの値では「今どちらの視点にすべきか」を判定できないと判明した
  //   ため、このガードは撤去した。
  //   本当の原因はcamera.position自体が(setProjectionMix(0)の多重発火により)
  //   壊れていたことだったので、そちらをonMid側で修正済み(上記2026-09-18の
  //   コメント参照)。
  try {
    if (universe.isActive && !projectionDragActive && !record.perspectiveActive && !overviewActive) {
      const relative = camera.position.clone().sub(UNIVERSE_CAMERA_TARGET);
      relative.applyAxisAngle(
        new THREE.Vector3(0, 1, 0),
        GALAXY_ROTATION_DIRECTION * GALAXY_ANGULAR_SPEED * delta
      );
      camera.position.copy(UNIVERSE_CAMERA_TARGET).add(relative);
      camera.lookAt(UNIVERSE_CAMERA_TARGET);
    }
  } catch (err) {
    console.error('universe camera auto-rotate failed:', err);
  }
  // ★ バグ修正: 以前はupdateRecordDisplay→updateTripodRingSwapの順で呼んでいたが、
  //   record.mirrorVisualAnchorの position/visible/quaternion を「今フレーム分」確定させる
  //   のはupdateTripodRingSwap側であり、updateRecordDisplay側(鏡の可視判定・cubeCameraの
  //   位置合わせ・撮影)はそれを読むだけの下流の処理。順序が逆だったため、
  //   updateRecordDisplayは常に「1フレーム前の(まだupdateTripodRingSwapが更新する前の)」
  //   古いvisible/positionを見て動いてしまっていた
  //   (可視になった直後の1フレームは、visible=falseのまま判定されて撮影自体がスキップされる、
  //   など)。依存関係の順番通りに呼ぶよう入れ替える。
  updateTripodRingSwap(tripodRingSwap, camera); // 「二つのtripod・二つの円環」のクロスフェード+移動(record.viewMixCurrentに連動)
  updateRecordDisplay(record, delta, controls); // 鏡の反射撮影+スクロールに応じた画面切り替え+三角錐の自転(メインのrender()より前)
  updateOverviewCameraHeight(delta); // ★ 2026-09-16追加: 銀河俯瞰(telescope)中、スクロール高さをなめらかに追従させる
  // ご指示「carouselとrecordは可視、不可視の関係」の反映: 画面がどちら向きかに応じて、
  // 互いの見た目(carousel側の粒子/ih、record側のbanana搭載mirrorGroup)を排他的に切り替える。
  // ★ tripod本体(axesGroup)・金のリング(goldenRing)は、以前はここで0.5をしきい値に
  //   visible/invisibleを瞬時に切り替えていたが、tripodRingSwap.js側でrecord.viewMixCurrentに
  //   連動した連続的なopacityクロスフェード+移動を行うようになったため、ここでの強制トグルは
  //   外してある(残すと、そちらの演出が瞬時に隠れてしまい台無しになるため)。
  // 銀河・太陽系は元々「鏡側を向いてから」しか出現しない作りなので、ここでは強制していない。
  if (universe.isActive) {
    // ★ 2026-09-15 修正(ご指示反映): recordSequenceDone(バナナ演出完了・carousel側へ
    //   固定済み)以降は、record.viewMixCurrentの値に関わらずshowRecordSideを強制的に
    //   falseにする。以前はここが常にrecord.viewMixCurrent(鏡側へ向いたまま止まっている
    //   累積スクロール値)だけを見ていたため、演出完了後もshowRecordSideがtrueのまま
    //   固定されてしまい、carousel側の粒子(roofParticles)・tripodHitMesh・ihが
    //   ずっと非表示のままになる不具合があった(ご指摘の「リングが消えたまま」も
    //   この一種。リング自体はfinishTripodRingSwap側で個別に直している)。
    const showRecordSide = recordSequenceDone ? false : record.viewMixCurrent >= 0.5;
    universe.roofParticles.visible = !showRecordSide;
    universe.tripodHitMesh.visible = !showRecordSide;
    universe.ihSprite.visible = !showRecordSide && universe.ihRevealed;
    if (record.phase !== 'inactive' && !recordSequenceDone) record.mirrorGroup.visible = showRecordSide;
  }

  // ★ 2026-09-16 追加(ご指示反映)・2026-09-17 単純化(ご指摘反映): 「0〜8度で太陽系軌道、
  //   8〜50度でcarousel(tripod一式。roofParticlesも含む)」という単純な1本の境界線
  //   (OVERVIEW_HIDE_SPLIT_DEG)で切り替える。上のshowRecordSideブロックより後に
  //   実行することで、ihSpriteなどの値をこちらが最後に上書きする。
  //   ★ 閾値は仮値です。見た目を見ながら調整してください。
  if (overviewActive) {
    const elevationDeg = (overviewScrollCurrent / OVERVIEW_SCROLL_RANGE) * OVERVIEW_ELEVATION_MAX_DEG;
    const hideSolarSystem = elevationDeg < OVERVIEW_HIDE_SPLIT_DEG;
    const hideCarousel = elevationDeg >= OVERVIEW_HIDE_SPLIT_DEG;

    universe.tripodAnchor.visible = !hideCarousel;   // TRIPOD(軸・数式はこの子なので一緒に隠れる)
    universe.goldenRing.visible = !hideCarousel;     // リング
    universe.roofParticles.visible = !hideCarousel;  // tripodが残す粒子の軌跡(carousel側の一部)
    if (universe.ihRevealed) universe.ihSprite.visible = !hideCarousel; // ih

    solarSystem.group.visible = !hideSolarSystem; // 太陽系軌道
    // ★ 2026-09-29 追加(ご指示反映): バルジ(record.bulge。galaxy.starsGroupの子)も
    //   太陽系軌道と同じ可視条件(!hideSolarSystem)に揃える。
    if (record.bulge) record.bulge.visible = !hideSolarSystem;

    // ★ 2026-09-29 追加: starburstの星を銀河中心の少し上へ配置して表示する
    //   (宇宙ページ突入時にhotspotMeshesは一括で非表示にされているので、ここで個別に再表示する)。
    starburstMeshes.forEach((m) => {
      m.position.copy(ORBIT_CENTER).add(STARBURST_OVERVIEW_OFFSET);
      m.scale.setScalar(STARBURST_OVERVIEW_SCALE);
      m.visible = true;
    });
    // ★ バルジ中心のAスターも、太陽系軌道・バルジと同じ可視条件(8度未満は隠す)に揃える。
    if (record.bulgeStar) record.bulgeStar.visible = !hideSolarSystem;
  }
  // ★ 2026-09-11 追加(バグ調査用): 「カメラ設定を変えても最終的な視点が変わらない」の
  //   原因調査のため、universe.isActive中は1秒おきに自動でdumpCameraする(キー操作不要)。
  //   値が毎回変わり続けている場合、どこかにまだ生きているtween/毎フレーム上書きがある
  //   ということなので、切り分けの決め手になる。原因が特定できたら削除してよい。
  if (universe.isActive) {
    debugDumpElapsed += delta;
    if (debugDumpElapsed >= 1) {
      debugDumpElapsed = 0;
      dumpCamera('periodic');
    }
  }
  updateTiltShiftEffect(); // ★ 追加: 最後の俯瞰でカメラが低い間だけ、carouselにピントが合うティルトシフトをかける
  yzPanel.update(clock.getElapsedTime());
  bananaState.mesh.rotation.y += state === 'idle' ? 0.004 : 0;
  render();
}
animate();