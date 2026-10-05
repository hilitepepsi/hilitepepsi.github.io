import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HOME_CAMERA_POS, HOME_CAMERA_TARGET, AXIS_LENGTH, UNIVERSE_CAMERA_POS, UNIVERSE_CAMERA_TARGET } from './config.js';
import { TRIPOD_ANGULAR_SPEED } from './universe.js';
import { ORBIT_RADIUS_BASE, setOrbitRadius, setOrbitCenter, growOrbitToFull } from './solarSystem.js';
import { GALAXY_RADIUS, setGalaxyHole, createStarPointsMaterial, setGalaxySpinBoost, setGalaxyDifferentialRotation } from './galaxy.js';
import { createCaptionBox, makeCaptionController } from './captions.js';
import { createAStar } from './aStar.js';
import { createTrumpetToMetaphony } from './trumpet.js';

// ══════════════════════════════════════════════════════════════
// ── 「レコードプレーヤー(操作パネル)」演出 ───────────────────
// ══════════════════════════════════════════════════════════════
//
// 仕様(ご指示より):
//   1) カメラの背後に、鏡素材の三角錐(頂点の高さ・底面の外接円半径は既存tripod=universe.jsの
//      ものと同じ式を流用。底面は正三角形)を置く。頂点にバナナを乗せる。カメラの位置は常に
//      固定(pan/zoom無効。回転=見回すことだけできる)。
//   2) スクロールでtripod/リング/鏡tripodの入れ替え演出を進める(下スクロール=鏡側へ、
//      上スクロール=元に戻る)。
//      ★ 2026-09-11時点の実装: カメラのposition・向き(OrbitControlsのtarget)は、この演出
//      が続く間ずっと一切動かさない(UNIVERSE_CAMERA_TARGET/POSに固定したまま)。以前は
//      controls.targetをスクロール量に応じてUNIVERSE_CAMERA_TARGET⇔鏡(mirrorLookTarget)
//      の間で補間していたが、それが原因で入れ替え完了後もカメラが動き続け、背景の銀河まで
//      一緒に動いてしまうバグがあった。見た目の変化は、カメラ側ではなくtripodRingSwap.js側で
//      tripod・リング・鏡tripod自体の位置を動かすことだけで表現する。
//   3) 鏡三角錐は、carousel側のtripod(universe.js)と「回転周期・位置を共有」する。
//   4) 鏡クリック → 別ページ(prism.html)へ遷移。
//
// ★ 2026-09-11時点の設計変更(ご指示より):
//   銀河は「先に巨大に表示させておき、右ドラッグで俯瞰後、スクロールで縮小させる」という
//   新しい流れに変わったため、以前あった
//     5) バナナクリックで銀河出現をスクロールで操作できるようにする(galaxy-scrub)
//     6) 銀河クリックで針が出現し、中心へ向かう
//     7) 針が規定位置に到達したら太陽系(solarSystem)を召喚する
//   の3つはこのファイルの責務ではなくなった。5)は「それ以外の銀河の動き」として削除。
//   6)7)については、その後いったん(針+太陽軌道・太陽系軌道の召喚として)実装したが、
//   針(トーンアーム)の形・位置・動きがすべて不自然だったため2026-09-17に針自体を
//   全削除した。7)の「太陽系召喚」部分だけはrevealSolarSystem()として残してあり、
//   今後新しく作り直すトーンアームが盤面に接触したタイミングで呼び出す想定。
//   右ドラッグ→俯瞰→スクロールでの銀河縮小そのものは別途(main.js側などで)実装される想定。
//
// TRIPOD_*まわりの数値(角度・長さ)はuniverse.jsのものをそのままコピーしている
// (「コピーでよい」とのご指示のため。値を変える場合は両方直す必要がある点に注意)。

// ── 鏡の三角錐(頂点位置の式のみ、コピー元: universe.js) ──────────
const TRIPOD_ANGLE_FROM_VERTICAL_DEG = 54.7356;
const TRIPOD_ANGLE_FROM_VERTICAL = THREE.MathUtils.degToRad(TRIPOD_ANGLE_FROM_VERTICAL_DEG);
const MIRROR_TRIPOD_RADIUS = AXIS_LENGTH * Math.sin(TRIPOD_ANGLE_FROM_VERTICAL); // 底面(正三角形)の外接円半径(=既存tripodの終端3点と同じ式)
export const MIRROR_APEX_HEIGHT = AXIS_LENGTH * Math.cos(TRIPOD_ANGLE_FROM_VERTICAL); // 頂点の高さ(=既存tripodと同じ式。tripodRingSwap.js側がring Bの高さ計算に使うためexport)
const MIRROR_ENV_RESOLUTION = 256;                     // キューブカメラの解像度(仮値。重ければ下げる)
// cubeCameraをmirrorVisualAnchor.positionからどれだけ上にオフセットして置くか(=ピラミッドの
// だいたい中間の高さに撮影点を置くため。仮値)。createRecordDisplay内での初期配置と、
// updateRecordDisplay内での毎フレーム追従の両方で同じ値を使う。
const CUBE_CAMERA_Y_OFFSET = MIRROR_APEX_HEIGHT * 0.5;
const _cubeCameraOffset = new THREE.Vector3(0, CUBE_CAMERA_Y_OFFSET, 0); // 毎フレームのnew Vector3()を避けるための使い回し用
// ★ 追加: 鏡が消えてgoldenRing(+その上のih)段階に入った後は、リングそのものの高さより
//   少し上(=ihがいる高さ付近)を撮影点にする(仮値。見ながら調整してください)。
const GOLDEN_RING_CUBE_CAMERA_Y_OFFSET = AXIS_LENGTH * 0.35;
const _goldenRingCubeCameraOffset = new THREE.Vector3(0, GOLDEN_RING_CUBE_CAMERA_Y_OFFSET, 0);
const MIRROR_TARGET_PAGE = 'prism2.html';               // 鏡クリックで遷移する先
const WORLD_UP = new THREE.Vector3(0, 1, 0);

// ── 頂点のバナナ(コピー元: galaxy.js のmakeBananaMesh) ────────────
const BANANA_RADIUS = 1.5;
const BANANA_HIT_RADIUS = 10.6;
export const BANANA_HEIGHT_ABOVE_APEX = AXIS_LENGTH * 0.4; // 頂点よりさらに少し上に乗せる(仮値)

// ══════════════════════════════════════════════════════════════
// ▼▼▼ バナナクリック演出: ①戴冠 → ②バルジ出現 → ③太陽系(8惑星)出現 ▼▼▼
//     (トーンアーム自体は撤去済み。今後新しく作り直し、盤面接触タイミングで
//      revealSolarSystem()を呼ぶ形に差し替える想定)
// ══════════════════════════════════════════════════════════════

// ── GLBローダー(banana.glb / crown.glb は record.js と同じ階層のdata/配下に置く想定) ──
// ★ import.meta.urlを基準にすることで、index.html(ページ)がどの階層にあっても
//   record.js自身から見た相対位置(js/data/...)で正しく解決されるようにしてある。
//   単なる文字列('./data/banana.glb'など)をそのままGLTFLoader.load()に渡すと、
//   fetch系のURL解決はスクリプトの場所ではなく「ページ(index.html)の場所」基準に
//   なってしまうため、index.htmlと同じ階層に置いたファイルしか見つからない、という
//   問題が起きる(実際に報告があった不具合の原因)。
const BANANA_GLB_PATH = new URL('./data/banana.glb', import.meta.url).href;
const CROWN_GLB_PATH = new URL('./data/crown.glb', import.meta.url).href;
const gltfLoader = new GLTFLoader();

function loadGLTFScene(path) {
  return new Promise((resolve, reject) => {
    gltfLoader.load(path, (gltf) => resolve(gltf.scene), undefined, reject);
  });
}

// ── ①戴冠(5秒): crown.glbがバナナの上空からtweenで落下し、着地する ─────
const CORONATION_TEXT = 'I wanted to speak between any two points by way of a foolish circle!';
const CORONATION_DURATION = 10.0;             // ①戴冠にかける秒数
// ★ 2026-09-19 追加(ご指示反映):「銀河を二倍にする」への対応。carousel側を縮める
//   方式(main.js側で廃止済み)ではなく、銀河自体をこの倍率まで拡大する方針にした。
//   戴冠演出のリング拡大(growCrossfadeRing)と同時にtweenする(下記参照)。
const GALAXY_OVERVIEW_SCALE = 2;
// ★ 2026-09-29 変更(ご指示反映): 「今より10倍ぐらい高く、画面外の上から登場」への対応。
//   以前は AXIS_LENGTH * 0.6 だったが、その10倍の AXIS_LENGTH * 6 に変更(仮値)。
const CROWN_DROP_START_HEIGHT = AXIS_LENGTH * 3;
// ★ 2026-09-29 追加(ご指示反映): 「着地位置も5くらい上げて」への対応。
//   着地y = バナナの上に軽く乗る高さ(BANANA_RADIUS * 0.6)+ この分だけ底上げする。
const CROWN_LANDING_HEIGHT_BOOST = -0.5;
const CROWN_SCALE = 0.2; // 仮値。実際のcrown.glbのサイズを見て調整してください
let coronationCaption = null; // 遅延生成(#axisHint等とは別の、画面下75%専用の要素)

function getCoronationCaption() {
  if (!coronationCaption) {
    // captions.jsのcreateCaptionBoxを流用。画面下75%・水平中央に固定。改行されずに
    // 必ず1行で表示されるようnoWrap指定(引用文+出典の "― Metaphony" もまとめて1行になる)。
    coronationCaption = makeCaptionController(createCaptionBox({ leftPercent: 50, topPercent: 75, noWrap: true }));
  }
  return coronationCaption;
}

// ── ②バルジ(棒状バー+コア)。galaxy.jsの本体バルジ(撤去済み)・
//    bar_bulge_preview.html由来の形状をそのまま流用する。
//    ★ 2026-09-16 設計変更(ご指示反映): 以前は「戴冠演出中だけ一瞬現れる、バナナの
//    位置に乗る豆粒サイズのecho」で、演出終了後は(mirrorVisualAnchorごと)消える
//    仕様だった。今回、「太陽系軌道の半分ほどのサイズで、出現させたまま(=銀河本体の
//    一部として永続表示)。位置は銀河中心。見た目はプレビューと同じでよい」との
//    ご指示を受け、galaxy.starsGroup(銀河本体の自転グループ)の子として銀河中心
//    (ローカル原点)に配置し直し、戴冠演出中に一度フェードインしたらそのまま
//    ずっと表示され続ける(mirrorVisualAnchorの可視状態に一切連動しない)ように
//    変更した。バー/コアの各比率(HALF_WIDTH/HEIGHT比・CONCENTRATION_POWER等)は
//    プレビューと同じ値をそのまま踏襲している。 ──
const BULGE_REVEAL_FADE_DURATION = 3.0;   // ②バナナ消滅+バルジ出現にかける秒数(ご指示通り3秒)
// ★ 2026-09-17 変更(ご指示反映): 「バルジの登場は、バナナの縮小と合わせて、拡大させながら
//   登場にして」への対応。以前はBANANA_TO_BULGE_GAPだけ待ってから、opacityだけを
//   0→1にフェードしていたが、(a)バナナの縮小開始と同時にバルジも出現を始める
//   (間を置かない)、(b)opacityだけでなくscaleもBULGE_REVEAL_START_SCALE→1へ
//   一緒にtweenして「拡大しながら」見えるようにした(下記startBulgeReveal参照)。
const BULGE_REVEAL_START_SCALE = 0; // 仮値。0=完全に無から拡大してくる見え方
// ★ 2026-09-16 変更(ご指示反映): 「バナナの消滅は回転とスケーリングで小さくして
//   ほしい」への対応。bananaMesh.visible=falseで瞬時に消していたのを、自転しながら
//   縮小して消える演出に変更した。
const BANANA_VANISH_DURATION = 0.6; // 仮値(秒)。回転・縮小にかける時間
const BANANA_VANISH_SPINS = 2;      // 仮値。消えるまでに何回転させるか
const BANANA_VANISH_EASE = 'power1.in'; // 仮値。だんだん加速しながら消える感じ
const BULGE_BAR_HALF_LENGTH = ORBIT_RADIUS_BASE / 2; // ご指定「太陽系軌道の半分ほど」の直接反映
const BULGE_BAR_HALF_WIDTH  = BULGE_BAR_HALF_LENGTH * 0.32;
const BULGE_BAR_HALF_HEIGHT = BULGE_BAR_HALF_LENGTH * 0.22;
const BULGE_BAR_TILT = THREE.MathUtils.degToRad(25); // 仮値(galaxy.js側のBAR_TILT_DEGと同じ角度)
// ★ ご指示により、galaxy.js側にあった「元の」バー+コア分布の式(1.8で一様寄りに)へ戻した。
//   以前ここは境界ぼかし(BULGE_EDGE_BLUR)とセットで2.3まで強めていたが、その調整は撤去。
const BULGE_BAR_CONCENTRATION_POWER = 1.8;  // 1.0で一様分布、大きいほど中心へ偏る(galaxy.js側の元の値)
const BULGE_BAR_COLOR = 0xf4e04d;           // バナナと同じ色
const BULGE_CORE_FRACTION = 0.18;           // BULGE_PARTICLE_COUNTのうちコアに割り当てる割合(仮値)
const BULGE_CORE_RADIUS_RATIO = 0.22;       // コア半径 = BULGE_BAR_HALF_LENGTH × この比率(仮値)
const BULGE_CORE_CONCENTRATION_POWER = 2.6; // コアはバーより強めに中心へ偏らせる(仮値。galaxy.js側と同じ値)
const BULGE_CORE_COLOR = 0xfff6c9;          // バー本体よりやや明るい白味がかった黄色(仮値)
// ★ 2026-09-17 大幅見直し(ご指摘反映): 「近くで見るとパーティクルが銀河のそれと違って
//   巨大なドットにしか見える」問題への対応。原因は、バルジがテクスチャなしの素の
//   PointsMaterialで、sizeがワールド単位・粒子数900という低密度だったこと
//   (テクスチャなしのPointsは円ではなくベタ塗りの正方形として描かれ、カメラが
//   近づくとその正方形が画面いっぱいに見える)。対応として:
//   (a) galaxy.js側と同じシェーダー(円形ソフトフォールオフ+縁のフェード)を
//       createStarPointsMaterialで共有し、質感を銀河本体と揃える。
//   (b) 粒を大幅に小さくしつつ粒子数を増やし、「大きい粒が少し」ではなく
//       「小さい粒がたくさん」で光の塊を表現する(密度で見せる)。
//   (c) カメラが極端に近づいたときのための画面上サイズの上限(uMaxPixelSize)と、
//       さらに近づいたら透明にフェードするnearFadeを追加。太陽系がバルジ付近を
//       周回する際に画面いっぱいの色面になる事故を構造的に防ぐ。
//   ★ この見直しにより、直前(2026-09-17 1回目)の「Bloomのにじみが強すぎる」対応
//     (BULGE_BLOOM_INTENSITYを0.15→0.06に弱めた件)は、粒自体が縮小されたことで
//     にじみの絶対量も下がっているはずだが、値は前回のまま残してある。見ながら
//     必要なら調整してください。
const BULGE_BLOOM_INTENSITY = 0.06;         // 0〜1。Bloomの強さを弱める(0=完全オフ、1=通常と同じ強さ。仮値)
const BULGE_PARTICLE_COUNT = 6000;          // 900→6000(仮値。粒を小さくした分、密度で光の塊に見せる)
const BULGE_BAR_POINT_SIZE = BULGE_BAR_HALF_LENGTH * 0.022;  // 以前の0.12から大幅に縮小(仮値)
const BULGE_CORE_POINT_SIZE = BULGE_BAR_HALF_LENGTH * 0.016; // 以前の0.09から大幅に縮小(仮値)
// 画面上の最大サイズ(px)。sizeAttenuationはシェーダー側で常に効くが、極端接近時の
// 保険としてクランプする(仮値。frontend次第でuPixelRatio込みなのでpx基準)。
const BULGE_MAX_PIXEL_SIZE = 48;
// この距離(ワールド単位)より近づくと、粒のアルファがフェードして消え始める。
// ORBIT_RADIUS_BASE(太陽系軌道の基準半径)基準にしておくと、太陽系が周回で
// 接近する距離感と自然に対応する(仮値)。
const BULGE_NEAR_FADE_START = ORBIT_RADIUS_BASE * 0.15;
const BULGE_NEAR_FADE_RANGE = ORBIT_RADIUS_BASE * 0.35;
// バー/コアそれぞれの外縁を、galaxy.js側と同じ考え方でソフトにフェードさせる比率
// (中心からの相対半径[0,1]のうち、このぶんの幅を1→0へかける。仮値)。
const BULGE_EDGE_FADE = 0.35;
// ★ 2026-09-16 追加(ご指示反映): 「出現の際に銀河に穴をあけて、バルジから腕が
//   生えてるように見せたい」への対応。bar_bulge_preview.html側のGALAXY_INNER_RADIUS_RATIO
//   と同じ考え方(バーの半長に対する比率)で、銀河円盤側にあける穴の半径を決める。
// ★ 2026-09-28 修正(ご指摘反映): 「バルジ周辺の星が少ない」の原因の一つがここだった。
//   穴の半径は銀河ローカル座標(galaxy.starsGroupの子としての座標)で渡されるが、
//   starsGroupは戴冠演出でGALAXY_OVERVIEW_SCALE(=2)倍に拡大済みなので、以前の値
//   (バーの半長×0.9をそのまま渡す)だと、実際の見た目の穴は 0.9×2=1.8倍のサイズ
//   (=バーの先端よりずっと外側)になっていた。しかもふちのぼかしがその外にさらに広がるため、
//   バルジと腕の間に大きな空白のリングができていた。ワールドでの見た目がバーの半長×比率に
//   なるよう、GALAXY_OVERVIEW_SCALEで割った値を使う。
const GALAXY_HOLE_RADIUS_RATIO = 0.9; // 仮値。バーの先端(=1.0)のすぐ内側から腕が生えて見える大きさ
const GALAXY_HOLE_RADIUS = BULGE_BAR_HALF_LENGTH * GALAXY_HOLE_RADIUS_RATIO / GALAXY_OVERVIEW_SCALE;
// ★ 2026-09-28 追加(ご指示反映): 「バナナのように回転させて登場。ただしバナナと逆の加速度で」。
//   バナナの消滅は BANANA_VANISH_EASE='power1.in'(だんだん加速)で回りながら縮むので、
//   バルジは逆に、最初が最速で、だんだん減速して止まる('power1.out')回転で現れる。
//   回転は最後に0(=元の向き)へ戻るよう、整数回転ぶん手前から始める。
const BULGE_REVEAL_SPINS = 2;   // 登場までに何回転するか(バナナと同じ2回転。仮値)
const BULGE_REVEAL_EASE = 'power1.out'; // バナナの'power1.in'と逆の加速度(減速しながら止まる)
const BULGE_REVEAL_SPIN_DIR = 1; // バナナと同じ回転方向=1 / 逆方向=-1

// concentrationPower: 1.0で一様分布、大きいほど中心(r=0)寄りに偏る。tiltはバーの
// 長軸をY軸まわりにどれだけ傾けるか(コアは呼び出し側でtilt=0を渡して球形にする)。
// ★ galaxy.js側の元の式そのまま(境界ぼかしの裾は付けず、r∈[0,1]でそのまま打ち切る)。
function sampleBulgeEllipsoidPosition(halfLength, halfWidth, halfHeight, concentrationPower, tilt) {
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.pow(Math.random(), (1 / 3) * concentrationPower);

  const x0 = r * Math.sin(phi) * Math.cos(theta) * halfLength;
  const y0 = r * Math.cos(phi) * halfHeight;
  const z0 = r * Math.sin(phi) * Math.sin(theta) * halfWidth;

  const cosT = Math.cos(tilt);
  const sinT = Math.sin(tilt);
  const x = x0 * cosT - z0 * sinT;
  const z = x0 * sinT + z0 * cosT;

  return { x, y: y0, z };
}

function sampleBulgeBarPosition() {
  return sampleBulgeEllipsoidPosition(
    BULGE_BAR_HALF_LENGTH, BULGE_BAR_HALF_WIDTH, BULGE_BAR_HALF_HEIGHT,
    BULGE_BAR_CONCENTRATION_POWER, BULGE_BAR_TILT
  );
}

function sampleBulgeCorePosition() {
  const coreRadius = BULGE_BAR_HALF_LENGTH * BULGE_CORE_RADIUS_RATIO;
  // コアはほぼ球形(バーほど扁平にしない)。傾き付与は不要なので直接生成する。
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const r = Math.pow(Math.random(), (1 / 3) * BULGE_CORE_CONCENTRATION_POWER) * coreRadius;
  return {
    x: r * Math.sin(phi) * Math.cos(theta),
    y: r * Math.cos(phi) * 0.85, // ほんの少しだけ扁平(仮値)
    z: r * Math.sin(phi) * Math.sin(theta),
  };
}

// galaxy.js側のsmoothstep相当(0除算を避けるための下限つき)。バー/コアそれぞれの
// 外縁を、中心からの相対半径(0〜1)ベースでソフトにフェードさせるために使う。
function edgeSmoothstep(edge0, edge1, x) {
  const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
  return t * t * (3 - 2 * t);
}

function makeBulgePlaceholder() {
  // バー本体とコアを別のPointsにして、色・粒の大きさを分けて重ねる
  // (galaxy.js本体のバルジと同じ考え方)。フェード演出(startBulgeReveal)
  // が両方まとめて透明度を操作できるよう、group.userData.materialsに
  // 両方のShaderMaterialをまとめておく。
  //
  // ★ 2026-09-17 見直し(ご指摘反映): 以前はテクスチャなしの素のPointsMaterialで
  //   粒が大きく粒子数も少なかったため、近づくと「巨大な正方形のドット」に見えていた。
  //   galaxy.js側と同じcreateStarPointsMaterial(円形ソフトフォールオフ・縁のフェード・
  //   近接時のサイズ上限とアルファフェード)を使い、粒を小さく・数を増やして密度で
  //   見せるようにした。
  const coreCount = Math.floor(BULGE_PARTICLE_COUNT * BULGE_CORE_FRACTION);
  const barCount = BULGE_PARTICLE_COUNT - coreCount;

  const barPositions = new Float32Array(barCount * 3);
  const barColors = new Float32Array(barCount * 3);
  const barScales = new Float32Array(barCount);
  const barAlphas = new Float32Array(barCount);
  const barColor = new THREE.Color(BULGE_BAR_COLOR);
  for (let i = 0; i < barCount; i++) {
    const p = sampleBulgeBarPosition();
    barPositions[i * 3] = p.x;
    barPositions[i * 3 + 1] = p.y;
    barPositions[i * 3 + 2] = p.z;
    barColors[i * 3] = barColor.r;
    barColors[i * 3 + 1] = barColor.g;
    barColors[i * 3 + 2] = barColor.b;
    // 中心からの相対半径(長軸基準の概算)で外縁をソフトにフェード。
    const relRadius = Math.min(Math.hypot(p.x, p.y, p.z) / BULGE_BAR_HALF_LENGTH, 1);
    const edge = 1 - edgeSmoothstep(1 - BULGE_EDGE_FADE, 1, relRadius);
    barAlphas[i] = edge;
    const sizeJitter = Math.random() * 0.7 + 0.3;
    barScales[i] = sizeJitter * (1 - 0.5 * (1 - edge));
  }
  const barGeo = new THREE.BufferGeometry();
  barGeo.setAttribute('position', new THREE.BufferAttribute(barPositions, 3));
  barGeo.setAttribute('aColor', new THREE.BufferAttribute(barColors, 3));
  barGeo.setAttribute('aScale', new THREE.BufferAttribute(barScales, 1));
  barGeo.setAttribute('aAlpha', new THREE.BufferAttribute(barAlphas, 1));
  // galaxy.js側の共有シェーダーがaArmWeightを参照するが、バルジには「腕」の概念が
  // ないので全て0(=常にuArmThickenStrength/uArmBrightenStrengthの影響を受けない)。
  barGeo.setAttribute('aArmWeight', new THREE.BufferAttribute(new Float32Array(barCount), 1));
  const barMat = createStarPointsMaterial({
    size: BULGE_BAR_POINT_SIZE,
    nearFadeStart: BULGE_NEAR_FADE_START,
    nearFadeRange: BULGE_NEAR_FADE_RANGE,
    maxPixelSize: BULGE_MAX_PIXEL_SIZE,
  });
  barMat.uniforms.uAlpha.value = 0; // フェードイン前は非表示(startBulgeRevealが0→1にtween)
  const barPoints = new THREE.Points(barGeo, barMat);
  barPoints.raycast = () => {}; // クリック対象ではないので無効化(galaxy.js側と同じ扱い)

  const corePositions = new Float32Array(coreCount * 3);
  const coreColors = new Float32Array(coreCount * 3);
  const coreScales = new Float32Array(coreCount);
  const coreAlphas = new Float32Array(coreCount);
  const coreColor = new THREE.Color(BULGE_CORE_COLOR);
  const coreRadius = BULGE_BAR_HALF_LENGTH * BULGE_CORE_RADIUS_RATIO;
  for (let i = 0; i < coreCount; i++) {
    const p = sampleBulgeCorePosition();
    corePositions[i * 3] = p.x;
    corePositions[i * 3 + 1] = p.y;
    corePositions[i * 3 + 2] = p.z;
    coreColors[i * 3] = coreColor.r;
    coreColors[i * 3 + 1] = coreColor.g;
    coreColors[i * 3 + 2] = coreColor.b;
    const relRadius = Math.min(Math.hypot(p.x, p.y, p.z) / coreRadius, 1);
    const edge = 1 - edgeSmoothstep(1 - BULGE_EDGE_FADE, 1, relRadius);
    coreAlphas[i] = edge;
    const sizeJitter = Math.random() * 0.7 + 0.3;
    coreScales[i] = sizeJitter * (1 - 0.5 * (1 - edge));
  }
  const coreGeo = new THREE.BufferGeometry();
  coreGeo.setAttribute('position', new THREE.BufferAttribute(corePositions, 3));
  coreGeo.setAttribute('aColor', new THREE.BufferAttribute(coreColors, 3));
  coreGeo.setAttribute('aScale', new THREE.BufferAttribute(coreScales, 1));
  coreGeo.setAttribute('aAlpha', new THREE.BufferAttribute(coreAlphas, 1));
  coreGeo.setAttribute('aArmWeight', new THREE.BufferAttribute(new Float32Array(coreCount), 1));
  const coreMat = createStarPointsMaterial({
    size: BULGE_CORE_POINT_SIZE, // バーより粒は小さく、密集させて「光の塊」に見せる
    nearFadeStart: BULGE_NEAR_FADE_START,
    nearFadeRange: BULGE_NEAR_FADE_RANGE,
    maxPixelSize: BULGE_MAX_PIXEL_SIZE,
  });
  coreMat.uniforms.uAlpha.value = 0;
  const corePoints = new THREE.Points(coreGeo, coreMat);
  corePoints.raycast = () => {};

  const group = new THREE.Group();
  group.add(barPoints, corePoints);
  group.visible = false;
  // ★ createStarPointsMaterialはShaderMaterialなので、フェード演出は
  //   m.opacity(素のPointsMaterial時代の名残)ではなくm.uniforms.uAlpha.valueを
  //   操作する必要がある。呼び出し側(startBulgeReveal)を書き換えずに済むよう、
  //   ここではuserData.materialsに「ShaderMaterialそのもの」を渡し、呼び出し側の
  //   `.opacity = x` 代入は使わず `.uniforms.uAlpha.value = x` に統一している
  //   (該当箇所は本ファイル内のstartBulgeRevealを参照)。
  group.userData.materials = [barMat, coreMat];
  return group;
}

// ══════════════════════════════════════════════════════════════
// ▼▼▼ ①戴冠 → ②バルジ出現 → ③太陽系(8惑星)出現 ▼▼▼
// ══════════════════════════════════════════════════════════════
// ★ 2026-09-17 撤去(ご指示反映): 針(トーンアーム)のメッシュ・付け根位置・回転による
//   追従計算(旧NEEDLE_*一式・makeNeedleMesh/computeNeedlePivot/mountNeedleAtPivot/
//   setNeedleRadius)と、その軌跡を描いていた「溝」(旧GROOVE_*一式・makeGrooveLine/
//   resetGroove/appendGroovePoint)は、形・位置・動きが実物のトーンアームとして
//   何もかも不自然だったため全削除した。オブジェクト自体もcreateRecordDisplay側から
//   削除済み(needle/groove変数・returnの両方)。
//   トーンアーム自体は今後、別途新しく作り直す予定。新しい実装が完成したら、
//   トーンアームが盤面(金のリング)に触れたタイミングで下のrevealSolarSystem(record)
//   を呼ぶ形に差し替えてください(内容は「リング接触時に太陽系を召喚する」処理その
//   ものなので、トーンアームの見た目に関係なく再利用できるはずです)。
//   ★ 暫定措置: 新しいトーンアームができるまでの間、バルジのフェードインが終わった
//     直後にrevealSolarSystem(record)を直接呼び、太陽系が即座に召喚されるように
//     してある(startBulgeReveal内を参照)。
const RING_CONTACT_RADIUS = ORBIT_RADIUS_BASE; // 太陽系の主軌道半径として召喚する半径(仮値。ゴールドリングの実寸に合わせて調整)
const SOLAR_SYSTEM_GROW_DURATION = 3.2; // ③太陽系がリング半径から本来の大きさへ広がる秒数(仮値)

// 金のリング(crossfadeRing。バナナと同じ高さで拡大する戴冠演出用リング)の「半径」との
// 接触判定用。crossfadeRingはXZ中心が原点なので、
// ここでは「対象(太陽/将来のトーンアーム接触点)の現在半径(=galaxyCenterからの
// XZ距離)」がRING_CONTACT_RADIUS以下になったかどうかだけを見ればよい
// (真上から見た接触判定)。トーンアーム自体の見た目が変わっても、この関数自体は
// そのまま使える汎用の判定なので残してある。
function hasTouchedGoldenRing(currentRadius) {
  return currentRadius <= RING_CONTACT_RADIUS;
}

// ③本編: リングに接触した(=今は暫定的に、バルジ出現直後に即時呼ばれる)ら太陽系を召喚する。
// トーンアーム実装後は、トーンアームが盤面に接触したタイミングでこの関数を呼ぶだけでよい。
function revealSolarSystem(record) {
  const { solarSystem, galaxyCenter } = record;
  // ▼ 太陽系(8惑星)の召喚: リング接触とみなす半径(RING_CONTACT_RADIUS)からスタートし、
  //   本来の大きさまで広がる。
  setOrbitCenter(solarSystem, galaxyCenter);
  setOrbitRadius(solarSystem, RING_CONTACT_RADIUS);
  solarSystem.group.visible = true;
  solarSystem.sunTrailRecording = true; // 太陽自身の軌跡もこの瞬間から記録開始
  solarSystem.sunTrailLastRecorded = -Infinity;
  growOrbitToFull(solarSystem, { duration: SOLAR_SYSTEM_GROW_DURATION });
  // ▲ ここまで
  // ★ 2026-09-17 再訂正(ご指摘反映): 「太陽が到達して消える金のリング」は、
  //   もともと上(バナナと同じ高さ)にあるcrossfadeRing自身(=拡大したリングその
  //   もの)。新設した別リングではない。crossfadeRingはcarousel本来のリング
  //   (universe.goldenRing)とは無関係なので、消してもcarousel側は一切影響を
  //   受けない。
  //   hideCrossfadeRingのフェードが実際に完了した後(onComplete)でrecord.onSequenceComplete
  //   を呼ぶ(tripod⇔鏡tripodの表示をcarousel側へ確定させる後始末はfinishTripodRingSwapが行う)。
  hideCrossfadeRing(record.crossfadeRing, {
    onComplete: () => {
      // ★ 2026-09-15 追加(ご指示反映): 「リングが消滅すると同時にcarousel一式(数式・ih・
      //   下側のリング)に交換してほしい。以後、リング・鏡tripod・バナナは二度と登場させない」
      //   への対応。tripod⇔鏡tripodの切り替え(tripodRingSwap.js)は、以後もう
      //   scroll駆動では使わない片道切符の演出だったので、ここで「終了」を通知して
      //   carousel側へ強制的に戻してもらう。実体(finishTripodRingSwap呼び出し)は
      //   main.js側でこのフックに差し込まれている(createRecordDisplay時点ではまだ
      //   tripodRingSwapのインスタンスが存在しないため)。
      if (record.onSequenceComplete) record.onSequenceComplete();
    },
  }); // ★ 太陽がリングに到達したので、拡大しておいた金のリング(crossfadeRing)を消す
  record.phase = 'done';
}

// ①②③本編: バナナクリックで最初に呼ぶ。戴冠(5秒)→バナナ消滅+バルジ出現(3秒)→revealSolarSystem。
function playCoronationSequence(record) {
  if (record.coronationStarted) return; // 二重発火防止
  record.coronationStarted = true;
  // ★ バグ修正: 演出中はmirrorVisualAnchor(バナナ・王冠・バルジの親)がスクロールで
  //   非表示に戻されないよう、tripodRingSwap.js側に強制表示を依頼する。
  record.coronationLockVisible = true;

  const { bananaMesh, crownGroup, bulge, galaxy, tonearm, galaxyCenter } = record;
  const caption = getCoronationCaption();

  // ① 戴冠(5秒): crown.glbをバナナの上空からtweenで落下させる(mirrorVisualAnchor内のローカル座標)。
  crownGroup.position.copy(bananaMesh.position).add(new THREE.Vector3(0, CROWN_DROP_START_HEIGHT, 0));
  crownGroup.visible = true;
  caption.setText(CORONATION_TEXT);
  // ★ ご指摘反映: テキスト表示と同時に、バナナと同じ高さにある既存のリング
  //   (crossfadeRing)自身を「太陽系のらせん軌道(=ORBIT_RADIUS_BASE。
  //   revealSolarSystem側が太陽系召喚に使うRING_CONTACT_RADIUSと同じ値)」の
  //   サイズまで拡大しておく。新しいリングを追加で発生させるのではなく、この
  //   もとからあるリング自身を拡大する。太陽系が実際に召喚された時点
  //   (revealSolarSystem内)で、この拡大したリングを消す。
  growCrossfadeRing(record.crossfadeRing, { targetRadius: ORBIT_RADIUS_BASE, duration: CORONATION_DURATION });
  // ★ 2026-09-19 追加(ご指示反映): 「BLOOMリング(=crossfadeRing)が大きくなるときに、
  //   一緒に銀河も拡大。トーンアームも位置とスケールを変えてほしい」への対応。
  //   上のgrowCrossfadeRingと全く同じ秒数・イージングで、1本のtweenが持つ倍率k(1→
  //   GALAXY_OVERVIEW_SCALE)を使い、銀河本体(galaxy.starsGroup.scale)とトーンアーム
  //   (record.tonearm)の両方を同時に更新する。1本のtweenにまとめているので、両者の
  //   拡大が完全にズレなく同期する。
  //   トーンアームは「pivot(=アームの支点。makeTonearmが一度だけ計算した固定値)を
  //   galaxyCenterからの相対位置ごとk倍に引き離しつつ(=盤の外周が広がるのに追従)、
  //   アーム自体の見た目もgroup.scaleでk倍にする(支点そのものは動かさず、その場で
  //   大きくなる)」という、carousel縮小のときと同じ考え方の「中心からの相対位置をk倍」
  //   スケーリングを適用する。
  const tonearmPivotOffset = tonearm ? tonearm.position.clone().sub(galaxyCenter) : null;
  if (record.overviewScaleTween) record.overviewScaleTween.kill();
  const overviewScaleState = { k: 1 };
  record.overviewScaleTween = gsap.to(overviewScaleState, {
    k: GALAXY_OVERVIEW_SCALE,
    duration: CORONATION_DURATION,
    ease: 'power2.inOut',
    onUpdate: () => {
      const k = overviewScaleState.k;
      galaxy.starsGroup.scale.setScalar(k);
      if (tonearm) {
        tonearm.position.copy(galaxyCenter).addScaledVector(tonearmPivotOffset, k);
        tonearm.scale.setScalar(k);
      }
    },
  });

  gsap.to(crownGroup.position, {
    // ★ 2026-09-29 変更(ご指示反映): 着地位置を5ほど上げる。
    y: bananaMesh.position.y + BANANA_RADIUS * 0.6 + CROWN_LANDING_HEIGHT_BOOST,
    duration: CORONATION_DURATION,
    // ★ 2026-09-29 変更(ご指示反映): 「バウンドしないように」への対応。
    //   bounce.out(着地時に跳ねる)から、跳ねずに減速して止まるpower2.outへ変更。
    ease: 'power2.out',
  });

  setTimeout(() => {
    caption.hide();
    startBulgeReveal();
  }, CORONATION_DURATION * 1000);

  // ② バルジ出現(3秒でフェードイン)。バナナは消滅。
  //   ★ 2026-09-17 変更(ご指示反映): 「バルジの登場は、バナナの縮小と合わせて、
  //     拡大させながら登場にして」への対応。以前は「消滅→(間)→出現」という
  //     順番待ちだったが、バナナの縮小開始と同時にバルジも出現を始め、opacityと
  //     scaleを一緒にtweenして「拡大しながら」現れるようにした。
  //   ★ 2026-09-17 撤去: 以前はここで針(トーンアーム)も一緒に出現・移動させていた
  //     (関数名もstartBulgeAndNeedleだった)が、針の実装ごと撤去したためバルジのみに
  //     なった(関数名もstartBulgeRevealに変更)。
  function startBulgeReveal() {
    // ★ 修正(ご指摘反映): 「冠は、バナナの回転とフェードインと揃えてほしい」への対応。
    //   以前はここでcrownGroup.visible=falseにして瞬間消去していたため、バナナが
    //   BANANA_VANISH_DURATION秒かけて回転しながら縮んで消えるのに対し、クラウンだけ
    //   その場でパッと消えて見えてしまっていた。クラウンにも全く同じ回転・縮小
    //   (このコードベースでの「消え方」はopacityフェードではなくscale→0)を、
    //   バナナと同じ定数・同じタイミングで適用し、2つが揃って消えるようにする。
    gsap.to(crownGroup.rotation, {
      y: crownGroup.rotation.y + Math.PI * 2 * BANANA_VANISH_SPINS,
      duration: BANANA_VANISH_DURATION,
      ease: BANANA_VANISH_EASE,
    });
    gsap.to(crownGroup.scale, {
      x: 0, y: 0, z: 0,
      duration: BANANA_VANISH_DURATION,
      ease: BANANA_VANISH_EASE,
      onComplete: () => {
        crownGroup.visible = false;
        // 次にまた表示することがあれば元の見た目に戻るよう、回転・スケールを戻しておく。
        crownGroup.rotation.set(0, 0, 0);
        crownGroup.scale.set(1, 1, 1);
      },
    });
    gsap.to(bananaMesh.rotation, {
      y: bananaMesh.rotation.y + Math.PI * 2 * BANANA_VANISH_SPINS,
      duration: BANANA_VANISH_DURATION,
      ease: BANANA_VANISH_EASE,
    });
    gsap.to(bananaMesh.scale, {
      x: 0, y: 0, z: 0,
      duration: BANANA_VANISH_DURATION,
      ease: BANANA_VANISH_EASE,
      onComplete: () => {
        bananaMesh.visible = false;
        // 次にまた表示することがあれば元の見た目に戻るよう、回転・スケールを戻しておく。
        bananaMesh.rotation.set(0, 0, 0);
        bananaMesh.scale.set(1, 1, 1);
      },
    });

    // バナナの縮小と同時にバルジも出現を開始する(間を置かない)。
    bulge.visible = true;
    bulge.scale.setScalar(BULGE_REVEAL_START_SCALE);
    bulge.userData.materials.forEach((m) => { m.uniforms.uAlpha.value = 0; });
    // ★ 2026-09-28 変更(ご指示反映): 以前はここで銀河の中心に「瞬時に」穴をあけていたが、
    //   バルジの拡大と一緒に穴もなめらかに広がるように変更した。穴の半径は下のtween(バルジの
    //   拡大と同じ進行度t)のonUpdateで0→GALAXY_HOLE_RADIUSへ動かす(setGalaxyHole)。
    //   ジオメトリの作り直しは不要(シェーダーのuniform更新のみ)なので毎フレーム呼んでよい。
    //   同時に、バルジ周辺の星を増やす「内側ブースト粒」も同じ進行度でフェードインする。
    setGalaxyHole(galaxy, 0, 0);
    // bulgeは今はバー+コアの2つのPointsを子に持つGroup。両方のopacityを
    // 同じ進行度から一斉に動かすため、単一のtween変数を経由させる
    // (バラバラのタイミングでフェードすると、コアだけ先に見えてしまう等
    // 不自然になるのを避けるため)。scaleも同じtに合わせて拡大させる。
    const bulgeReveal = { t: 0 };
    // ★ バグ修正(ご指摘反映): 「太陽軌道を二倍にしたら、バルジがその直径サイズまで
    //   大きくなってしまった」への対応。原因はここではなく、bulgeがgalaxy.starsGroupの
    //   子であること(1152〜1162行目参照)。playCoronationSequence側でgrowCrossfadeRing
    //   と同時にgalaxy.starsGroup.scaleを1→GALAXY_OVERVIEW_SCALE(=2)へtweenしているため、
    //   bulge自身のローカルscaleを1にしても、実際の見た目のサイズは
    //   1(ローカル) × 2(親のstarsGroup) = 2倍になってしまっていた
    //   (=太陽軌道の半径ぴったりに見えるはずが、直径サイズまで膨らんで見えていた)。
    //   bulgeのローカルscaleの目標値を1/GALAXY_OVERVIEW_SCALEにしておくことで、
    //   親の2倍と打ち消し合い、実際の見た目のサイズを元通り(太陽軌道の半径サイズ)に戻す。
    const bulgeTargetScale = 1 / GALAXY_OVERVIEW_SCALE;
    gsap.to(bulgeReveal, {
      t: 1,
      duration: BULGE_REVEAL_FADE_DURATION,
      onUpdate: () => {
        const t = bulgeReveal.t;
        bulge.userData.materials.forEach((m) => { m.uniforms.uAlpha.value = t; });
        bulge.scale.setScalar(THREE.MathUtils.lerp(BULGE_REVEAL_START_SCALE, bulgeTargetScale, t));
        // バルジの見た目のサイズ(=t)に比例して穴が広がる。
        setGalaxyHole(galaxy, GALAXY_HOLE_RADIUS * t, t);
      },
    });
    // 回転しながら登場: 整数回転ぶん手前の向きから、0(=元の向き)へ、減速しながら回して止める。
    // (バナナは加速しながら回って消えるので、その逆の加速度)
    bulge.rotation.y = -Math.PI * 2 * BULGE_REVEAL_SPINS * BULGE_REVEAL_SPIN_DIR;
    gsap.to(bulge.rotation, {
      y: 0,
      duration: BULGE_REVEAL_FADE_DURATION,
      ease: BULGE_REVEAL_EASE,
    });

    // ★ 2026-09-17 追加(暫定措置): 針(トーンアーム)を撤去したことで、以前は
    //   「針が銀河中心へゆっくり近づき、金のリングに触れたら太陽系召喚」という
    //   時間のかかる演出だったが、その置き換えとなるトーンアームはまだ未実装。
    //   新しいトーンアームが完成するまでの間、バルジのフェードインが終わったら
    //   直接revealSolarSystem(record)を呼び、太陽系がすぐに召喚されるようにして
    //   ある。トーンアーム実装時は、このsetTimeout呼び出しを、トーンアームが
    //   盤面に接触した瞬間のコールバックに置き換えてください。
    setTimeout(() => {
      revealSolarSystem(record); // ③
    }, BULGE_REVEAL_FADE_DURATION * 1000);
  }
}
// ══════════════════════════════════════════════════════════════
// ▲▲▲ バナナクリック演出 ここまで ▲▲▲
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// ▼▼▼ トーンアーム(ガラス製) ▼▼▼
// ══════════════════════════════════════════════════════════════
// ★ 2026-09-17 追加(ご指示反映): universe-glass-preview.html(トーンアーム
//   configuratorで作り込んだ最終形)の形状生成コード・ガラスマテリアルをそのまま
//   移植した。
//   ★ 2026-09-18 追加(ご指示反映): 「回転軸側(pivot)を固定して、針側が回転する
//     ようにする。クリックで円盤の外側に針側を配置する」への対応。アーム自体の
//     形(内部のS字カーブ)は固定のまま、アーム全体をpivot(付け根)を軸に
//     ワールドYまわりで剛体回転させることで、針先を銀河の中心からの距離
//     (=レコードの半径)を変えて追従させる。仕組みは以前あった針(needle)の
//     setNeedleRadius(円と円の交点を求める古典的な幾何計算)と同じ考え方だが、
//     今回は「直線の棒」ではなく「あらかじめ曲がったガラスのアーム」がまるごと
//     回転する点が異なるため、計算をベクトルで一般化してある(下記
//     computeTonearmPhiForRadius参照)。
//   ★ 配置の向き(「右」「奥」)は、プレビュー側では固定のワールドX/Z軸を使っていたが、
//     このプロジェクトの宇宙ページのカメラは(config.jsの)UNIVERSE_CAMERA_POS→
//     UNIVERSE_CAMERA_TARGETという特定方向を向いているため、ワールド軸そのままでは
//     「カメラから見て銀河の右側」になるとは限らない。そこで、カメラの視線方向から
//     「カメラの右」「カメラの奥」を計算し、pivotの位置の基準にしている
//     (=常にカメラから見て銀河の右奥の角に取り付いているように見える)。

// ── ガラスの形状パラメータ ─────────────────────────────
// プレビューはRECORD_RADIUS(=銀河の半径として仮定した値)=100を基準に全ての長さを
// 決めていたので、実際のGALAXY_RADIUSとの比率(TONEARM_SCALE)で全長さをスケールし、
// 同じ見た目の比率を保つ。
const TONEARM_SCALE = GALAXY_RADIUS / 100;
const TONEARM_PIVOT_GAP = 40 * TONEARM_SCALE;   // pivotを銀河の外周からどれだけ「右」に離すか(仮値)
const TONEARM_MOUNT_HEIGHT = 15 * TONEARM_SCALE; // pivot(≒盤面)の高さ(仮値)
const TONEARM_PARAMS = {
  length: 200 * TONEARM_SCALE,
  bendDeg: 30,          // 曲がる角度(度)。プレビューの最終値のまま
  ratio: 0.70,          // アーム全長のうち、曲がり始める位置の比率。プレビューの最終値のまま
  soft: 0.45,           // 曲がり始め〜曲がり終わりの範囲(比率)。プレビューの最終値のまま
  width: 22.5 * TONEARM_SCALE,
  height: 15 * TONEARM_SCALE,
  cornerRadius: 4.5 * TONEARM_SCALE,
  segments: 60,         // メッシュの分割数(見た目の滑らかさ。長さに依存しないのでスケールしない)
};
const TONEARM_COLOR = new THREE.Color(0xbfd4ff); // ガラスの減衰色(仮値。プレビューのattenuationColorと同じ)
// アームの形を組み立てるときだけ使う、固定のローカル基準軸(「ローカル右」「ローカル奥」)。
// 実際のワールド向き(カメラの右・奥)へは、あとでbaseQuaternion一つで丸ごと回転させる
// (=局所+X軸を世界のrightDirへ合わせる回転。両方とも水平ベクトルなので、この回転は
// ワールドYまわりの単純な向き変えになる)。
const TONEARM_LOCAL_RIGHT = new THREE.Vector3(1, 0, 0);
const TONEARM_LOCAL_BACK = new THREE.Vector3(0, 0, -1);
// ── 針先(rest/placed)の半径(=銀河中心からの距離) ─────────────
const TONEARM_REST_RADIUS = GALAXY_RADIUS * 1.15;  // 休符位置。「レコードの外側」の少し外(仮値)
// ★ 2026-09-18 修正(ご指摘反映): 「アームの回転角度をもう少し上げて、より盤面側へ
//   持っていってほしい」への対応。以前はGALAXY_RADIUS(=円盤の外周ぎりぎり)だったが、
//   もう少し内側(盤面の上)へ針が乗るよう半径を小さくした。半径を小さくするほど
//   pivotから見た振れ角(phi)は大きくなる(=より深く振り込む)ので、結果として
//   「回転角度が上がる」という見え方になる。
//   ★ ここが調整箇所です: この係数(1.0が外周)を小さくするほど、針はより盤面の
//   内側(中心寄り)に置かれます。
const TONEARM_PLACE_RADIUS = GALAXY_RADIUS * 0.85;  // クリックで置く位置。円盤の外周よりすこし内側(盤面側)
const TONEARM_PLACE_DURATION = 1.6; // 休符位置→外周まで、pivotを軸に振り下ろす秒数(仮値)
const TONEARM_SPIN_BOOST = 1.5; // 「置いたら銀河の回転を少し上げる」の反映(仮値。倍率)
// ★ 2026-09-19 追加(ご指摘反映): 「アームの軸回転は、実際の挙動のように少し上に持ち
//   上げて、針を上げながら回転、最後に下す動きにしてほしい。上げるのはわずかでよい」
//   への対応。pivotグループ(group)自体のYを、この量だけ一時的に持ち上げる。
//   ★ ここが調整箇所です: 大きくするほど高く持ち上がります。
const TONEARM_LIFT_HEIGHT = 3.5 * TONEARM_SCALE; // 持ち上げ量(仮値。「わずか」を意図した小さめの値)
const TONEARM_LIFT_RISE_FRACTION = 0.22; // 全体の動作時間のうち、上げ/下げにかける割合(仮値)

// 断面(profile)を作る。width×heightの角丸長方形(底面2隅は角丸なしの鋭角、
// それ以外はcornerRadiusで丸める)。プレビューのbuildProfileそのまま。
function buildTonearmProfile(width, height, radius, arcSeg) {
  const hw = width / 2, hh = height / 2;
  const r = Math.max(0, Math.min(radius, Math.min(hw, hh) - 0.001));
  const pts = [];
  pts.push([-hw, -hh]); pts.push([hw, -hh]);
  const cRx = hw - r, cRy = hh - r;
  for (let i = 0; i <= arcSeg; i++) { const a = (Math.PI / 2) * (i / arcSeg); pts.push([cRx + r * Math.cos(a), cRy + r * Math.sin(a)]); }
  const cLx = -hw + r, cLy = hh - r;
  for (let j = 0; j <= arcSeg; j++) { const b = (Math.PI / 2) + (Math.PI / 2) * (j / arcSeg); pts.push([cLx + r * Math.cos(b), cLy + r * Math.sin(b)]); }
  return pts;
}
function tonearmSmoothstep01(x) { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); }
// ★ 2026-09-19 追加(ご指摘反映): 「アームの動きを実際のプレーヤーのように、少し持ち
//   上げながら回転し、最後に下ろす」への対応。t(0〜1、動作全体の進行度)を渡すと、
//   0→risePortionで0→1へ立ち上がり、risePortion〜(1-risePortion)の間は1のまま
//   (=持ち上げたまま横に振る)、(1-risePortion)→1で1→0へ下ろす、という台形カーブを返す。
function tonearmLiftHumpAt(t, risePortion) {
  const rise = Math.max(0.0001, Math.min(0.49, risePortion));
  if (t <= rise) return tonearmSmoothstep01(t / rise);
  if (t >= 1 - rise) return tonearmSmoothstep01((1 - t) / rise);
  return 1;
}
// t(0〜1、アーム基端〜先端の進行度)に対する曲げ角度。ratio付近(幅soft)でゆっくり
// bendRadまで曲がり、それ以降は真っ直ぐ(曲げ角度一定)。プレビューのangleAtそのまま。
function tonearmAngleAt(t, ratio, soft, bendRad) {
  const half = soft / 2, lo = ratio - half, hi = ratio + half;
  if (t <= lo) return 0;
  if (t >= hi) return bendRad;
  return bendRad * tonearmSmoothstep01((t - lo) / (hi - lo));
}
// 角度aに対する接線方向(単位ベクトル)。rightDir/backDirは直交する水平単位ベクトル
// (組み立て時はローカル軸、実際の設置後は回転で丸ごとワールドへ移される)。a=0では
// -backDir(pivotから手前側へ向かう)、aが増えるほど-rightDir側(=中心側)へ曲がる。
function tonearmTangentAt(a, rightDir, backDir) {
  return rightDir.clone().multiplyScalar(-Math.sin(a)).add(backDir.clone().multiplyScalar(-Math.cos(a)));
}
// アームの中心線(centerline)を、pivot(origin)から接線方向へ小刻みに積分して作る。
// プレビューのbuildCenterlineと同じロジック。
function buildTonearmCenterline(length, ratio, soft, bendDeg, segments, origin, rightDir, backDir) {
  const bendRad = THREE.MathUtils.degToRad(bendDeg);
  const ds = length / segments;
  const points = [origin.clone()];
  let pos = origin.clone();
  for (let i = 1; i <= segments; i++) {
    const tMid = (i - 0.5) / segments;
    const a = tonearmAngleAt(tMid, ratio, soft, bendRad);
    pos = pos.clone().addScaledVector(tonearmTangentAt(a, rightDir, backDir), ds);
    points.push(pos.clone());
  }
  const tangents = [];
  for (let k = 0; k <= segments; k++) {
    const tk = k / segments;
    tangents.push(tonearmTangentAt(tonearmAngleAt(tk, ratio, soft, bendRad), rightDir, backDir));
  }
  return { points, tangents };
}
// 断面(profile)の各点(底面2隅を除く)を、局所中心へ向けてinsetAmtぶん寄せる
// (先端・pivot端の面取り用)。プレビューのinsetProfileそのまま。
function insetTonearmProfile(baseProfile, insetAmt) {
  return baseProfile.map((pt, idx) => {
    if (idx === 0 || idx === 1) return pt;
    const z = pt[0], y = pt[1];
    const len = Math.hypot(z, y) || 1;
    const newLen = Math.max(0, len - insetAmt);
    return [z / len * newLen, y / len * newLen];
  });
}
// 中心線に沿って断面をスイープし、先端・pivot端に面取りを追加してBufferGeometryを作る。
// プレビューのbuildArmGeometryそのまま。
function buildTonearmGeometry(p, origin, rightDir, backDir) {
  const profile = buildTonearmProfile(p.width, p.height, p.cornerRadius, 8);
  const line = buildTonearmCenterline(p.length, p.ratio, p.soft, p.bendDeg, p.segments, origin, rightDir, backDir);
  const pts = line.points, tans = line.tangents;

  // 先端(針側)の面取り: 上面・側面を軽く面取りし、底面は鋭角のまま残す(プレビューと同じ)。
  const bevelSteps = 4;
  const bevelDepth = Math.min(p.height, p.width) * 0.45;
  const bevelInset = Math.min(p.width, p.height) * 0.22;
  const lastPt = pts[pts.length - 1], lastTan = tans[tans.length - 1].clone();
  const ringProfiles = pts.map(() => profile);
  for (let bi = 1; bi <= bevelSteps; bi++) {
    const frac = bi / bevelSteps;
    pts.push(lastPt.clone().addScaledVector(lastTan, bevelDepth * frac));
    tans.push(lastTan.clone());
    ringProfiles.push(insetTonearmProfile(profile, bevelInset * frac));
  }
  // pivot側の面取り(側面と上下面の継ぎ目の角を落とす。プレビューと同じ)。
  const firstTan = tans[0].clone();
  const prependPts = [], prependTans = [], prependProfiles = [];
  for (let bi = bevelSteps; bi >= 1; bi--) {
    const frac = bi / bevelSteps;
    prependPts.push(origin.clone().addScaledVector(firstTan, -bevelDepth * frac));
    prependTans.push(firstTan.clone());
    prependProfiles.push(insetTonearmProfile(profile, bevelInset * frac));
  }
  pts.unshift(...prependPts);
  tans.unshift(...prependTans);
  ringProfiles.unshift(...prependProfiles);

  const worldUp = new THREE.Vector3(0, 1, 0);
  const ringCount = pts.length, profCount = profile.length;
  const positions = [], rings = [];
  for (let i = 0; i < ringCount; i++) {
    const T = tans[i];
    const R = new THREE.Vector3().crossVectors(worldUp, T).normalize();
    const U = new THREE.Vector3().crossVectors(T, R).normalize();
    const C = pts[i], ring = [], prof = ringProfiles[i];
    for (let j = 0; j < profCount; j++) {
      const z = prof[j][0], y = prof[j][1];
      ring.push(new THREE.Vector3().copy(C).addScaledVector(R, z).addScaledVector(U, y));
    }
    rings.push(ring);
  }
  const indices = [];
  function pushVert(v) { positions.push(v.x, v.y, v.z); }
  for (let ri = 0; ri < ringCount; ri++) for (let pj = 0; pj < profCount; pj++) pushVert(rings[ri][pj]);
  for (let ri2 = 0; ri2 < ringCount - 1; ri2++) {
    for (let pj2 = 0; pj2 < profCount; pj2++) {
      const a0 = ri2 * profCount + pj2, a1 = ri2 * profCount + ((pj2 + 1) % profCount);
      const b0 = (ri2 + 1) * profCount + pj2, b1 = (ri2 + 1) * profCount + ((pj2 + 1) % profCount);
      indices.push(a0, a1, b0); indices.push(a1, b1, b0);
    }
  }
  let vertOffset = ringCount * profCount;
  const startCenterIdx = vertOffset; pushVert(pts[0]); vertOffset++;
  const startBase = vertOffset;
  for (let s = 0; s < profCount; s++) pushVert(rings[0][s]);
  for (let s2 = 0; s2 < profCount; s2++) { const n0 = startBase + s2, n1 = startBase + ((s2 + 1) % profCount); indices.push(startCenterIdx, n1, n0); }
  vertOffset += profCount;
  const endCenterIdx = vertOffset; pushVert(pts[ringCount - 1]); vertOffset++;
  const endBase = vertOffset;
  const lastRing = rings[ringCount - 1];
  for (let s3 = 0; s3 < profCount; s3++) pushVert(lastRing[s3]);
  for (let s4 = 0; s4 < profCount; s4++) { const m0 = endBase + s4, m1 = endBase + ((s4 + 1) % profCount); indices.push(endCenterIdx, m0, m1); }
  const geo = new THREE.BufferGeometry();
  geo.setIndex(indices);
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.computeVertexNormals();
  return geo;
}

// カメラ(UNIVERSE_CAMERA_POS→UNIVERSE_CAMERA_TARGET)から見た「右」「奥」の水平単位
// ベクトルを求める。cameraの実際のquaternionではなく、宇宙ページの基準視点(config.js
// の定数)から計算するため、宇宙ページに入る前でも(=makeTonearm呼び出し時点でも)
// 正しい値が求まる。
function computeTonearmCameraAxes() {
  const forward = new THREE.Vector3().subVectors(UNIVERSE_CAMERA_TARGET, UNIVERSE_CAMERA_POS);
  forward.y = 0; // 水平成分だけを使う(仰角があっても、アームは常に銀河の円盤と同じ水平面に置く)
  forward.normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const rightDir = new THREE.Vector3().crossVectors(forward, worldUp).normalize(); // カメラの右
  const backDir = forward; // カメラから見て奥(=画面の奥、遠ざかる方向)
  return { rightDir, backDir };
}

// ワールドYまわりの回転で水平ベクトルvを角度theta(ラジアン)だけ回したときの角度を
// 足し込める「角度」の物差し。atan2(-z,x)という定義にしておくと、
// v.applyAxisAngle(worldUp, theta)されたベクトルの角度は、常に元の角度+thetaになる
// (three.jsのapplyAxisAngleの回転方向と整合するように符号を選んでいる)。
function tonearmWorldAngle(v) { return Math.atan2(-v.z, v.x); }

// 針先を「銀河中心からの距離targetRadius」に置くために必要な、pivot軸まわりの
// 追加回転角phiを求める。
//   P = pivotのワールド座標 - galaxyCenter(固定ベクトル。長さd)
//   T0 = 追加回転なし(phi=0)のときの、針先のpivotからの相対ワールド位置(長さL)
//   針先の絶対位置 = pivot + Rot_Y(phi)(T0)  なので、
//   |P + Rot_Y(phi)(T0)|² = d² + L² + 2dL・cos(ang(P) - ang(T0) - phi) = targetRadius²
//   という関係から逆算する(円と円の交点を求める古典的な式を、直線の棒ではなく
//   「あらかじめ曲がった剛体」に一般化したもの)。解は2つ出るので、pivotから見た
//   針先の「元の角度」からの回転量が小さい方(=見た目上、動きが少なく自然な方)を選ぶ。
function computeTonearmPhiForRadius(data, targetRadius) {
  const { P, d, L, T0 } = data;
  const delta = tonearmWorldAngle(P) - tonearmWorldAngle(T0);
  const K = THREE.MathUtils.clamp((targetRadius * targetRadius - d * d - L * L) / (2 * d * L), -1, 1);
  const acosK = Math.acos(K);
  const phiA = delta - acosK;
  const phiB = delta + acosK;
  return Math.abs(phiA) <= Math.abs(phiB) ? phiA : phiB;
}

// tonearmGroup(pivotに置かれたGroup)の向きを、baseQuaternion(固定)にphiだけ
// 追加回転させた状態にする。setNeedleRadius(旧針実装)と同じ「baseQuaternionへ戻して
// からrotateY」パターン。
function applyTonearmPhi(tonearmGroup, phi) {
  tonearmGroup.quaternion.copy(tonearmGroup.userData.baseQuaternion);
  tonearmGroup.rotateY(phi);
  tonearmGroup.userData.currentPhi = phi;
}

// scene/renderer: main.jsと同じもの。galaxyCenter: 銀河の中心(record.galaxyCenterと同じもの)。
// pivot(付け根。回転軸)は「銀河の中心から見て、カメラの右+奥」の固定オフセットに
// 置き、以後ここは絶対に動かさない(位置もbaseQuaternionも固定)。アーム本体
// (glassMesh)はこのGroupの子として、追加のY回転(phi)だけで振り角を変える。
function makeTonearm(scene, renderer, galaxyCenter) {
  const { rightDir, backDir } = computeTonearmCameraAxes();
  const pivot = galaxyCenter.clone()
    .addScaledVector(rightDir, GALAXY_RADIUS + TONEARM_PIVOT_GAP)
    .addScaledVector(backDir, GALAXY_RADIUS);
  pivot.y = galaxyCenter.y + TONEARM_MOUNT_HEIGHT;
  // 局所+X軸(TONEARM_LOCAL_RIGHT)をワールドのrightDirへ合わせる回転。両方とも水平
  // ベクトルなので、これは必ずワールドYまわりの単純な向き変えになる
  // (=pivotのY軸そのものは常に真上を向いたまま。「回転軸を固定」を満たす)。
  const baseQuaternion = new THREE.Quaternion().setFromUnitVectors(TONEARM_LOCAL_RIGHT, rightDir);

  // アーム本体はローカル軸(TONEARM_LOCAL_RIGHT/BACK, 原点(0,0,0))で組み立てる。
  // 実際のワールド向き・位置は、この関数が返すGroup(position=pivot, quaternion=
  // baseQuaternion)側で丸ごと表現する。
  const geometry = buildTonearmGeometry(TONEARM_PARAMS, new THREE.Vector3(0, 0, 0), TONEARM_LOCAL_RIGHT, TONEARM_LOCAL_BACK);
  // ★ 2026-09-18 修正(ご指摘反映): 「ガラスに環境マップは不要、代わりに星が透過するように
  //   してほしい」への対応。以前はtransmissionの鏡面・屈折の映り込み元として簡易的な
  //   環境(RoomEnvironment)をPMREMで生成し、scene.environmentへ設定していた。しかし
  //   RoomEnvironmentは「窓から光が差し込む簡易的な部屋」を模したテクスチャなので、
  //   これがそのままIBL(image-based lighting)としてガラスに映り込み、「不自然な方向
  //   からの光が当たっている」ように見える原因になっていた(このシーン自体にはTHREE.Light
  //   は一つも置いていない。唯一の光源相当がこのRoomEnvironmentだった)。
  //   scene.environmentの設定自体をやめることで、その不自然な映り込みを止める。
  //   transmission(透過)自体はscene.environmentの有無に関係なく、レンダラーが
  //   「このメッシュの背後に実際に描かれているもの」を毎フレーム別テクスチャに描画して
  //   参照する仕組みなので、環境マップをやめても背後の星(銀河の粒子)はそのまま透けて見える。
  const material = new THREE.MeshPhysicalMaterial({
    color: 0xffffff,
    metalness: 0,
    roughness: 0.06,
    transmission: 1.0,
    thickness: 6 * TONEARM_SCALE,
    ior: 1.5,
    clearcoat: 0.4,
    clearcoatRoughness: 0.15,
    attenuationColor: TONEARM_COLOR,
    attenuationDistance: 60 * TONEARM_SCALE,
  });
  const mesh = new THREE.Mesh(geometry, material);

  const group = new THREE.Group();
  group.position.copy(pivot);
  group.add(mesh);
  group.visible = false; // main.js側がrevealGalaxy(galaxy)と同時にtrueにする
  scene.add(group);

  // 針先(=アーム先端。面取り前の中心線の終点)の、pivotから見た「回転なし(phi=0)」
  // 時点でのローカル相対位置を求めておく(L=その長さ=pivot〜針先の実効的な腕の長さ)。
  const localLine = buildTonearmCenterline(
    TONEARM_PARAMS.length, TONEARM_PARAMS.ratio, TONEARM_PARAMS.soft, TONEARM_PARAMS.bendDeg,
    TONEARM_PARAMS.segments, new THREE.Vector3(0, 0, 0), TONEARM_LOCAL_RIGHT, TONEARM_LOCAL_BACK,
  );
  const tipLocal = localLine.points[localLine.points.length - 1].clone();
  const T0 = tipLocal.clone().applyQuaternion(baseQuaternion); // ワールド向きに直した、phi=0時点の針先相対位置
  const P = pivot.clone().sub(galaxyCenter); P.y = 0;           // pivot→galaxyCenterの水平ベクトル
  const d = P.length();
  const L = T0.length();

  group.userData = {
    baseQuaternion, P, d, L, T0,
    currentPhi: 0,
    basePivotY: pivot.y, // ← 針を上げ下げする際の基準高さ(placeTonearmOnRecordが使う)
    placed: false, // クリックで一度だけ「置く」演出。二重発火防止
  };
  applyTonearmPhi(group, computeTonearmPhiForRadius(group.userData, TONEARM_REST_RADIUS)); // 初期姿勢=休符位置

  return group;
}

// クリック時に呼ぶ: pivotを固定したまま、針先を休符位置から円盤の外周
// (TONEARM_PLACE_RADIUS)まで振り下ろし、置き終わったら銀河の回転を少し上げる。
// 「太陽系での動き」「その後のクリックでの動き」は今回は実装しない(ご指示より)。
// ★ 2026-09-19 修正(ご指摘反映): 水平方向の振り(phi)だけでなく、動作の前半で
//   わずかに持ち上げ、後半で下ろす縦方向の動きを追加した(tonearmLiftHumpAt参照)。
function placeTonearmOnRecord(record) {
  const tonearmGroup = record.tonearm;
  if (!tonearmGroup || tonearmGroup.userData.placed) return; // 二重発火防止
  tonearmGroup.userData.placed = true;
  const startPhi = tonearmGroup.userData.currentPhi;
  const targetPhi = computeTonearmPhiForRadius(tonearmGroup.userData, TONEARM_PLACE_RADIUS);
  const basePivotY = tonearmGroup.userData.basePivotY;
  const state = { t: 0 };
  gsap.to(state, {
    t: 1,
    duration: TONEARM_PLACE_DURATION,
    ease: 'power2.inOut',
    onUpdate: () => {
      applyTonearmPhi(tonearmGroup, THREE.MathUtils.lerp(startPhi, targetPhi, state.t));
      tonearmGroup.position.y = basePivotY + TONEARM_LIFT_HEIGHT * tonearmLiftHumpAt(state.t, TONEARM_LIFT_RISE_FRACTION);
    },
    onComplete: () => {
      tonearmGroup.position.y = basePivotY; // 誤差の蓄積を防ぐため、最後に基準高さへ厳密に戻す
      // 「置いたら銀河の回転を少し上げる」の反映。太陽系・carouselはここでは触らない。
      setGalaxySpinBoost(record.galaxy, TONEARM_SPIN_BOOST);
      // ★ 追加: 銀河俯瞰中は「中心に近いほど角速度が速い」差動回転にしていたが、
      //   アームを置いたのでここで通常の剛体回転(現状の仕様)へ戻す。
      setGalaxyDifferentialRotation(record.galaxy, false);
      // ★ 追加: アームが置き終わってから2秒後に、ラッパ(Metaphonyホーン)を発動する。
      gsap.delayedCall(TRUMPET_DELAY_SECONDS, () => triggerTrumpet(record));
    },
  });
}

// トーンアーム設置の TRUMPET_DELAY_SECONDS 秒後に呼ばれる。
// 位置・サイズ・向きを決めてvisibleをtrueにし、reveal(0→1)のアニメーションを開始する。
// ★ 実験段階のご指示反映: 文字面(Metaphonyの文字が乗っている平面)を、
//   カメラの画面(view plane)と平行になるように向ける。
const TRUMPET_DELAY_SECONDS = 2;
const TRUMPET_DRAW_SECONDS = 3; // groupA(ラッパ→文字)を描き切るのにかける時間(仮値)
const TRUMPET_SIZE_RATIO = 2; // 銀河の最終サイズに対する倍率(2=銀河の2倍の大きさ)
// 銀河はこの演出の最後にGALAXY_OVERVIEW_SCALE倍まで拡大される(playCoronationSequence参照)ので、
// GALAXY_RADIUS(拡大前の基準値)ではなく、拡大後の最終サイズを基準にホーンのサイズを合わせる。
const TRUMPET_TARGET_RADIUS = GALAXY_RADIUS * GALAXY_OVERVIEW_SCALE * TRUMPET_SIZE_RATIO; // ホーンの目標バウンディング半径
const TRUMPET_BACK_DISTANCE_RATIO = 0.3; // 奥行き(forward)方向のオフセット比率。以前は奥+左を合成して0.8倍していたが、
// それだと奥に置きすぎてホーンの奥側がカメラの画角から外れていたため、奥行き成分だけ独立に小さくした(仮値。
// まだ画角外に出るようなら、この値をさらに小さくしてカメラに近づけてください)。
const TRUMPET_LEFT_DISTANCE_RATIO = 0.3; // 左(-camRight)方向のオフセット比率(仮値)
const TRUMPET_HEIGHT_ABOVE_RECORD = GALAXY_RADIUS * 1.7; // 開始点の高さ=銀河半径と同程度
// ★ 上下反転について: 以前はローカルの上下軸(U)の符号を反転させることで実現しようと
//   していたが、これは文字面の生成ロジック(letterUp/letterForwardBentの向き)と絡み合い、
//   狙った上下反転ではなく別の見た目の反転(左右ミラーのような結果)を招いてしまっていた。
//   代わりに、カメラ向きの基準姿勢(下のrotMatrix)を一度正しく組んでから、その後に
//   ワールド空間の「水平な横軸(Rw=カメラから見て左右方向の軸)」まわりに180度、
//   純粋な回転(ミラーではない)を追加で掛けることで上下を反転させる。この軸まわりの
//   180度回転は、上下(Uw)と前後(Nw、口の向き)を連動して反転させるが、それは
//   鏡映ではなく正しい回転操作なので、形状が歪んだり反転して見えたりすることはない。
const TRUMPET_FLIP_VERTICAL_180 = true; // true=水平軸まわりに180度回転して上下反転/false=反転なし
// 関数全体の「進行方向」(trumpetApi.localAxes.forward。ラッパ→sin波→文字が伸びていく向き)は、
// 上のrotMatrixにより現状ちょうどRw(カメラから見て真水平・左右方向の軸)に一致している。
// これをNw(カメラ方向)軸まわりに回転させると、文字面がカメラを向いたまま
// (=画面内での回転になるので歪まない)、進行方向だけを画面内で上下に振れる。
// 角度は「進行方向からUwに向かう向き」を正としているので、正の値で上向きに傾く。
const TRUMPET_TILT_UP_DEGREES = 30; // 進行方向を水平から何度上に傾けるか
function triggerTrumpet(record) {
  const { trumpetGroup, trumpetApi, galaxyCenter } = record;
  if (!trumpetGroup || !trumpetApi || trumpetGroup.userData.triggered) return; // 二重発火防止
  trumpetGroup.userData.triggered = true;

  // サイズ: 「銀河の2倍ぐらいの大きさ」。生成時(スケール1)に測っておいた
  // バウンディング半径(trumpetApi.baseRadius)を基準に、TRUMPET_TARGET_RADIUSへ一様スケールする。
  const scale = TRUMPET_TARGET_RADIUS / trumpetApi.baseRadius;
  trumpetGroup.scale.setScalar(scale);

  // 位置: カメラ(UNIVERSE_CAMERA_POS→UNIVERSE_CAMERA_TARGET)から見て、
  // レコード(銀河)の左奥。高さは銀河半径と同程度(TRUMPET_HEIGHT_ABOVE_RECORD)。
  // 奥行き(forward)と左(-camRight)を別々の比率でオフセットできるようにしてある
  // (奥に置きすぎるとホーンの奥側がカメラの画角から外れてしまうため)。
  const forward = UNIVERSE_CAMERA_TARGET.clone().sub(UNIVERSE_CAMERA_POS).normalize();
  const worldUp = new THREE.Vector3(0, 1, 0);
  const camRight = new THREE.Vector3().crossVectors(forward, worldUp).normalize();
  trumpetGroup.position.copy(galaxyCenter)
    .addScaledVector(forward, TRUMPET_TARGET_RADIUS * TRUMPET_BACK_DISTANCE_RATIO)
    .addScaledVector(camRight, -TRUMPET_TARGET_RADIUS * TRUMPET_LEFT_DISTANCE_RATIO)
    .add(new THREE.Vector3(0, TRUMPET_HEIGHT_ABOVE_RECORD, 0));

  // 向き(実験): Metaphonyの文字面(trumpetApi.localAxes.normalが法線)を、
  // カメラの画面と平行に(=カメラの方を向くように)する。ここでは疑似ミラーの符号操作は
  // 一切行わず、生成時のローカル軸(forward/up/normal)をそのままカメラ向きの基準姿勢に
  // 対応させるだけ。上下反転が必要な場合は、この基準姿勢を組んだ後に別途、水平軸まわりの
  // 180度回転(下記)を掛ける。
  const N = trumpetApi.localAxes.normal.clone();
  const U = trumpetApi.localAxes.up.clone();
  const R = new THREE.Vector3().crossVectors(U, N).normalize(); // ローカル右方向(口の向きに相当)

  const Nw = forward.clone().negate(); // カメラの方を向く(=カメラ面と平行)
  const worldUpRef = new THREE.Vector3(0, 1, 0);
  let Uw = worldUpRef.clone().addScaledVector(Nw, -worldUpRef.dot(Nw)); // Nwに直交する成分だけ残す
  if (Uw.lengthSq() < 1e-6) Uw = new THREE.Vector3(0, 0, 1); // Nwがworld upとほぼ平行なときの保険
  Uw.normalize();
  const Rw = new THREE.Vector3().crossVectors(Uw, Nw).normalize();

  const localBasis = new THREE.Matrix4().makeBasis(R, U, N);
  const worldBasis = new THREE.Matrix4().makeBasis(Rw, Uw, Nw);
  // localBasisは正規直交なので、逆行列=転置行列でよい
  const rotMatrix = worldBasis.multiply(localBasis.transpose());
  trumpetGroup.quaternion.setFromRotationMatrix(rotMatrix);

  // 上下反転(必要な場合): 上で組んだ基準姿勢に対して、ワールド空間の水平軸(Rw)まわりに
  // 180度回転を追加で掛ける。premultiplyなのでワールド空間での回転として作用し、
  // Uw(上下)とNw(前後・口の向き)がその場で入れ替わる、正真正銘の回転。
  if (TRUMPET_FLIP_VERTICAL_180) {
    const flipQuat = new THREE.Quaternion().setFromAxisAngle(Rw, Math.PI);
    trumpetGroup.quaternion.premultiply(flipQuat);
  }

  // 進行方向を水平(Rw)から上向きに傾ける: Nw(カメラ方向)軸まわりの回転なら、
  // 文字面がカメラを向いたまま(=画面と平行なまま)、進行方向だけを画面内で回せる。
  if (TRUMPET_TILT_UP_DEGREES) {
    const tiltQuat = new THREE.Quaternion().setFromAxisAngle(Nw, THREE.MathUtils.degToRad(TRUMPET_TILT_UP_DEGREES));
    trumpetGroup.quaternion.premultiply(tiltQuat);
  }

  trumpetGroup.visible = true;

  // 「一括表示」ではなく、groupA(ラッパ→sin波→文字本体)をgsapで0→1へ伸ばして描く。
  // groupB(t/hの横線)・完成後のホールド・フェードアウトはtrumpetApi.update(elapsed)側が
  // 自動でやってくれる(updateRecordDisplay内で毎フレーム呼んでいる)ので、ここではgroupAの
  // reveal(t)だけを進めればよい。
  const drawProgress = { t: 0 };
  gsap.to(drawProgress, {
    t: 1,
    duration: TRUMPET_DRAW_SECONDS,
    ease: 'power1.out',
    onUpdate: () => trumpetApi.reveal(drawProgress.t),
  });
}
// ══════════════════════════════════════════════════════════════
// ▲▲▲ トーンアーム(ガラス製) ここまで ▲▲▲
// ══════════════════════════════════════════════════════════════

// ── スクロールによる画面切り替え(carousel⇄鏡) ─────────────
const SCROLL_SWITCH = 600;         // ここまでスクロールすると鏡側を向き切る(仮値。「切り替え方は適当でよい」ため単純な線形)
// 「最後になったら、下スクロールでカメラを引いてレコード全体が見えるように」の反映:
// phase==='done'到達後、さらにこのぶんスクロールするとカメラが引き切る(仮値)。
// phase==='done'は、バナナクリック演出の最後(revealSolarSystem呼び出し時)に到達する。
const SCROLL_PULLBACK_RANGE = 900;
export const SCROLL_MAX = SCROLL_SWITCH + SCROLL_PULLBACK_RANGE; // main.js側でスクロール量をこの範囲にクランプする
const VIEW_MIX_SMOOTHING = 4.0;    // カメラの向き変更(controls.target)を軽くスムージングする係数(仮値)

// ★ 銀河の「掴んでいた」演出パラメータ(GALAXY_READY_T等)は、銀河の動きそのものを
//   このファイルから削除したため不要になり撤去した。

const RECORD_PULLBACK_DISTANCE = 1; // 「レコード全体が見えるように」引く距離(仮値。カメラFOV次第で要調整。GALAXY_RADIUS依存の計算は撤去したため単純な定数に変更)
const PULLBACK_SMOOTHING = 3.0;    // カメラの引きをスムージングする係数(仮値)

// ── レコード(鏡三角錐)の自転速度 ─────────────────────────
const MIRROR_SPIN_SMOOTHING = 1.5;        // 倍率切り替えをスムージングする係数(仮値。カクツキ防止)
// ★ 以前は演出フェーズごとに速度を切り替える案があったが、今は常に等倍にしている。

// carouselのtripod(HOME_CAMERA_TARGET付近)とカメラの距離をそのまま流用し、カメラを挟んで
// 反対側に鏡三角錐を置く(ご指示「位置を共有させる」の反映: カメラからの距離を共有する)。
function computeMirrorGroupPosition() {
  const camToTripod = new THREE.Vector3().subVectors(HOME_CAMERA_TARGET, HOME_CAMERA_POS);
  const base = HOME_CAMERA_POS.clone().sub(camToTripod);
  base.y -= MIRROR_APEX_HEIGHT * 0.5; // 頂点がだいたいカメラの目の高さに来るよう少し下げる(仮値)
  return base;
}

// 「頂点だけ反映した三角錐、底面は正三角形」── ConeGeometryはradialSegments=3にすると
// そのまま正三角形を底面とする三角錐になる(底面の外接円半径=MIRROR_TRIPOD_RADIUS、
// 頂点の高さ=MIRROR_APEX_HEIGHTは、既存tripodの頂点位置と同じ式を流用している)。
function makeMirrorPyramid(material) {
  const geo = new THREE.ConeGeometry(MIRROR_TRIPOD_RADIUS, MIRROR_APEX_HEIGHT, 3);
  const mesh = new THREE.Mesh(geo, material);
  mesh.position.y = MIRROR_APEX_HEIGHT / 2;
  return mesh;
}

// 「本格的な鏡」: WebGLCubeRenderTarget + CubeCameraで周囲を毎フレーム撮影し、
// それをenvMapとして使う実際の鏡面反射(metalness=1, roughness最小)。
function createMirrorMaterial() {
  const renderTarget = new THREE.WebGLCubeRenderTarget(MIRROR_ENV_RESOLUTION, {
    generateMipmaps: true,
    minFilter: THREE.LinearMipmapLinearFilter,
  });
  // ★ 修正(ご指示反映): 「カメラのスケール範囲も10倍」への対応。far=2000は、戴冠後の
  //   銀河半径(GALAXY_RADIUS≈1176 × GALAXY_OVERVIEW_SCALE=2 ≈2352)より小さくなって
  //   しまったため、銀河の遠い部分が反射(envMap)にクリップされて映らなくなる。
  //   余裕を見てfar=20000にした(main.js側のPerspectiveCameraと揃えてある)。
  const cubeCamera = new THREE.CubeCamera(0.1, 20000, renderTarget);
  // ★ 2026-09-19 修正(ご指摘反映):「roughnessを上げたら球もtripodも逆に見えなくなった」
  //   への対応。銀河は「ほとんど真っ黒な背景に、まばらで小さい輝点(星)が散らばる」
  //   絵柄なので、roughnessを上げてぼかすと、その小さく明るい点が周囲の広い黒に薄まって
  //   埋もれてしまい、逆に見えなくなる(roughnessを上げる方向は完全に誤りだった)。
  //   低いまま(=鋭い鏡面)に戻す。
  const MIRROR_ROUGHNESS = 0.05; // 元の値に戻した
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    metalness: 1,
    roughness: MIRROR_ROUGHNESS,
    envMap: renderTarget.texture,
    transparent: true, // tripod/ringスワップ演出(tripodRingSwap.js)でopacityをクロスフェードするため
  });
  return { material, cubeCamera };
}

// ══════════════════════════════════════════════════════════════
// ★ 2026-09-17 訂正(ご指摘反映): 前回、戴冠演出の「拡大→消滅」の役割を、バナナと
//   同じ高さのリング(crossfadeRing)から切り離し、下側に新設した別リング
//   (orbitRing)へ移していたが、これはご指示の意図と逆だった。正しくは:
//     - 拡大→消滅するのは、もともと上(バナナと同じ高さ)にあるリング=crossfadeRing
//       自身。新しいリングを追加で下に発生させて拡大するのではない。
//     - 拡大したcrossfadeRingは、太陽がリングに到達したら「消滅」する
//       (=拡大したリングそのものが消える。従来通りの見た目のまま)。
//     - 消滅後、carousel側と同じ「下側」に新たに現れるのはuniverse.goldenRing
//       (carousel本来のリング)。こちらは拡大させず通常サイズのまま、鏡tripodと
//       同じ鏡面のリアルな金の質感にする(universe.js側でマテリアルを用意し、
//       ここでenvMapだけ渡す。新たにCubeCameraを増やすと重くなるため、鏡と
//       同じ1つを使い回している)。
//   orbitRing(専用の別メッシュ)は不要になったため削除した。
// ══════════════════════════════════════════════════════════════
const CROSSFADE_RING_TUBE_RADIUS = AXIS_LENGTH * 0.018; // universe.js側のRING_TUBE_RADIUSと同じ値(仮値)
const CROSSFADE_RING_COLOR = 0xffcc33; // universe.js側のRING_COLORと同じ値(仮値)。非金属な単色に戻した

// RING_DOWN_Y⇔バナナの高さを上下する「引き継ぎ」用のリング(従来通りの見た目)。
// 戴冠演出中はこのリング自身が拡大→消滅する(下記growCrossfadeRing/hideCrossfadeRing)。
function makeCrossfadeRing() {
  const geometry = new THREE.TorusGeometry(MIRROR_TRIPOD_RADIUS, CROSSFADE_RING_TUBE_RADIUS, 16, 128);
  const material = new THREE.MeshBasicMaterial({ color: CROSSFADE_RING_COLOR, transparent: true, opacity: 0 });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = Math.PI / 2; // universe.js側のgoldenRingと同じく水平(XZ平面)へ寝かせる
  // ★ 2026-09-17 追加(バグ修正): revealCrossfadeRingDrawing()がring.rotation.yで
  //   「描き始めの向き」をカメラ方向へ振り向かせているが、既定のEuler順序'XYZ'では
  //   X回転(この行の90°の寝かせ)が先に適用されるため、その後のY回転は「もう縦軸
  //   ではなくなったローカルY軸」を中心に回ることになり、リングが傾いて見える不具合
  //   があった。順序を'YXZ'(先にYで世界の縦軸まわりに振り向かせ、その後にXで
  //   寝かせる)にすることで、常に水平を保ったまま向きだけを変えられるようにした。
  mesh.rotation.order = 'YXZ';
  mesh.visible = false; // tripodRingSwap.js側がtripodRingRevealed成立時に初めて可視化する
  mesh.userData.radius = MIRROR_TRIPOD_RADIUS; // 現在の「径」(太さは常にCROSSFADE_RING_TUBE_RADIUSのまま)
  return mesh;
}

// ★ 2026-09-17 修正(ご指摘反映): 「リングの拡大が膨張して謎の物体になっている。
//   太さは変えず、径だけ変えてほしい」への対応。以前はmesh.scaleを均一倍率で
//   tweenしていたが、TorusGeometryを丸ごと均一スケールすると、径(main radius)だけ
//   でなく太さ(tube radius)まで一緒に太ってしまい、大きくなるほど「膨張した謎の
//   物体」に見えていた。scaleでは径と太さを別々に扱えないため、径が変わるたびに
//   ジオメトリ自体を(太さ=CROSSFADE_RING_TUBE_RADIUS固定のまま)作り直す方式にした。
function setCrossfadeRingRadius(ring, radius) {
  const old = ring.geometry;
  ring.geometry = new THREE.TorusGeometry(radius, CROSSFADE_RING_TUBE_RADIUS, 16, 128);
  old.dispose();
  ring.userData.radius = radius;
}

// ★ 2026-09-17 追加(ご指示反映): 「tripodクリック時のリング出現を、一周描きながら
//   出現するようにしてほしい。開始点は円でカメラに一番近い点、回転方向はcarouselと
//   同じ、スピードは速くてよい」への対応。
//   TorusGeometryのarc引数(掃引角。マイナス値も三角関数的に正しく解釈されるため、
//   逆回転の指定に使える)を0→2πへtweenし、ring.rotation.yで「描き始め(u=0)」の
//   向きをカメラ方向に固定した上で、径と同じくジオメトリを毎フレーム作り直すことで
//   「輪が一周描かれながら現れる」演出にした。
const RING_REVEAL_DURATION = 0.5; // 仮値。「スピードは速くてよい」の反映
// carousel(universe.js側のtripod自転。rotateOnWorldAxisにrotationDelta=-ANGULAR_SPEEDを
// 渡している=world Y軸まわりの負方向)と同じ向きに掃引するための符号(仮。逆に見えたら反転)。
const RING_REVEAL_SWEEP_SIGN = -1;

function setCrossfadeRingArc(ring, arcFraction) {
  const old = ring.geometry;
  const safeFraction = Math.max(arcFraction, 0.001); // arc=0だと退化するので下限を設ける
  const arc = RING_REVEAL_SWEEP_SIGN * safeFraction * Math.PI * 2;
  ring.geometry = new THREE.TorusGeometry(ring.userData.radius, CROSSFADE_RING_TUBE_RADIUS, 16, 128, arc);
  old.dispose();
}

// tripodクリック時、1回だけ呼ぶ。tripodRingSwap.js側から呼ばれる想定でexportしてある。
export function revealCrossfadeRingDrawing(ring, camera, { duration = RING_REVEAL_DURATION, onComplete } = {}) {
  // 「開始点は円でカメラに一番近い点」: 中心(リング自身のXZ座標)からカメラへ向かう
  // 方向がそのまま「円上の最近点」の方向になる。この角度をTorusのu=0(=描き始め)に
  // 向くようring.rotation.yへ設定する。
  const dx = camera.position.x - ring.position.x;
  const dz = camera.position.z - ring.position.z;
  ring.rotation.y = Math.atan2(dz, dx);

  ring.visible = true;
  ring.material.opacity = 1;

  const state = { t: 0 };
  gsap.to(state, {
    t: 1,
    duration,
    ease: 'power1.out',
    onUpdate: () => setCrossfadeRingArc(ring, state.t),
    onComplete: () => {
      setCrossfadeRingRadius(ring, ring.userData.radius); // 仕上げに厳密な全周ジオメトリへ確定させる
      if (onComplete) onComplete();
    },
  });
}

// ── 戴冠演出専用: crossfadeRingを「太陽系のらせん軌道」サイズまで拡大する ──────
// 径(ring.userData.radius)そのものをtweenし、更新のたびにsetCrossfadeRingRadiusで
// ジオメトリを作り直す(太さは常にCROSSFADE_RING_TUBE_RADIUSのまま変えない)。
function growCrossfadeRing(ring, { targetRadius, duration, ease = 'power2.inOut', onComplete } = {}) {
  const state = { radius: ring.userData.radius };
  if (ring.userData.radiusTween) ring.userData.radiusTween.kill();
  ring.userData.radiusTween = gsap.to(state, {
    radius: targetRadius,
    duration,
    ease,
    onUpdate: () => setCrossfadeRingRadius(ring, state.radius),
    onComplete: () => { if (onComplete) onComplete(); },
  });
}

// ── 戴冠演出専用: 太陽がリングに到達したら、拡大しておいたcrossfadeRingを消す ──
function hideCrossfadeRing(ring, { duration = 0.8, onComplete } = {}) {
  if (ring.userData.radiusTween) ring.userData.radiusTween.kill();
  gsap.to(ring.material, {
    opacity: 0,
    duration,
    ease: 'power1.in',
    onComplete: () => {
      ring.visible = false;
      if (onComplete) onComplete();
    },
  });
}

function makeHitAreaMesh(radius) {
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
  );
}

// ★ 2026-09-12 変更: banana.glb(./data/banana.glb)を読み込んで見た目に使う。
//   GLBの読み込みは非同期なので、当たり判定(hitエリア)と親グループは即座に作って返し、
//   見た目(GLBの中身)は読み込み完了後に子として追加する(=クリック判定は最初から効くが、
//   見た目は一瞬遅れて出てくる。プリロードしておきたい場合は呼び出し側で対応してください)。
// ★ 2026-09-14: GLB読み込みが安定して動くことを確認できたため、読み込み失敗時の
//   procedural(TorusGeometry)フォールバックは撤去した。読み込みに失敗した場合は
//   何も表示されず、コンソールにエラーが出力されるだけになる。
function makeBananaMesh() {
  const group = new THREE.Group();
  group.rotation.set(0.3, 0.5, 0);
  group.add(makeHitAreaMesh(BANANA_HIT_RADIUS));

  loadGLTFScene(BANANA_GLB_PATH).then((glbScene) => {
    group.add(glbScene);
  }).catch((err) => {
    console.error('banana.glbの読み込みに失敗しました。', err);
  });

  return group;
}

// scene/renderer: main.jsと同じもの。
// deps: { camera, galaxy, solarSystem } ── いずれもmain.js側で既に作成済みの「既存インスタンス」を渡す。
// solarSystemはrevealSolarSystem()内で太陽系(8惑星)を召喚する際に使う。
export function createRecordDisplay(scene, renderer, { camera, galaxy, solarSystem, universe, excludeFromBloom }) {
  const { material: mirrorMaterial, cubeCamera } = createMirrorMaterial();

  // universe.goldenRing(carouselの飾りリング)とは別の、この演出専用のリング。
  // 位置(ringDownY↔バナナの高さの上下)はtripodRingSwap.js側が毎フレーム動かす。
  const crossfadeRing = makeCrossfadeRing();
  scene.add(crossfadeRing);


  // ★ ご指摘反映: 「リアルな金のリング」はcarousel本来のリング(universe.goldenRing)
  //   自身のこと(=下側に新しい専用リングを追加するのではない)。universe.js側で
  //   マテリアルの種類(MeshStandardMaterial・metalness・roughness)は用意済みなので、
  //   ここでは鏡と同じCubeCamera環境マップ(mirrorMaterial.envMap)を渡すだけでよい
  //   (新たにCubeCameraを増やすと重くなるため、既存の1つを使い回している)。
  universe.goldenRing.material.envMap = mirrorMaterial.envMap;

  const apex = new THREE.Vector3(0, MIRROR_APEX_HEIGHT, 0);

  // ★ ご指示「二つのtripod・二つの円環を対応させ、スクロールで位置を移動させながら
  //   クロスフェードする」の反映のため、鏡のピラミッド(pyramidMesh)はmirrorGroupの
  //   子ではなく、別の独立したグループ(mirrorVisualAnchor)に入れてある。
  const mirrorGroup = new THREE.Group();

  const mirrorVisualAnchor = new THREE.Group();
  const pyramidMesh = makeMirrorPyramid(mirrorMaterial);
  mirrorVisualAnchor.add(pyramidMesh);

  const bananaMesh = makeBananaMesh();
  bananaMesh.position.copy(apex).add(new THREE.Vector3(0, BANANA_HEIGHT_ABOVE_APEX, 0));
  mirrorVisualAnchor.add(bananaMesh);

  // ① 戴冠用の王冠(crown.glb)。バナナと同じ場所に降ってくるので、mirrorVisualAnchorの子にする。
  const crownGroup = new THREE.Group();
  crownGroup.visible = false;
  mirrorVisualAnchor.add(crownGroup);
  loadGLTFScene(CROWN_GLB_PATH).then((glbScene) => {
    glbScene.scale.setScalar(CROWN_SCALE);
    crownGroup.add(glbScene);
  }).catch((err) => {
    console.error('crown.glbの読み込みに失敗しました。', err);
  });

  // ② バルジ(プレースホルダー)。ご指示反映: 銀河本体(galaxy.starsGroup)の子として
  //   銀河中心(ローカル原点)に配置する。以前はmirrorVisualAnchor(バナナの位置)の
  //   子だったため、戴冠演出後にmirrorVisualAnchorごと恒久的に非表示になっていたが、
  //   今後は「銀河本体の一部としてずっと表示され続ける」ものにするため、独立した
  //   親(galaxy.starsGroup)に変更した。galaxy.starsGroupは銀河の自転そのものの
  //   グループなので、バルジも銀河と一緒に回転し、「バルジから腕が生えている」
  //   見た目に自然に馴染む。
  const bulge = makeBulgePlaceholder();
  // 位置は銀河中心(galaxy.starsGroupのローカル原点)でよい、とのご指示のため0のまま。
  // ★ ご指摘の「コアのある複雑な形に見えない」件の原因はこれ。バー・コアの粒はどちらも
  //   AdditiveBlendingで、除外しない限りmain.js側のBloomがそのままフルの強さで乗ってしまう
  //   ため、粒同士の光がにじんで混ざり合い、バー+コアという構造が潰れて見えていた。
  //   ここでBloomを完全にオフにはせず、BULGE_BLOOM_INTENSITYまで弱める(0にすると
  //   Bloom完全オフ=最もくっきり見えるが、光っている感じは失われる。仮値、要調整)。
  if (excludeFromBloom) {
    bulge.children.forEach((child) => excludeFromBloom(child, BULGE_BLOOM_INTENSITY));
  }
  galaxy.starsGroup.add(bulge);

  // ★ Aスター(射手座の矢と同じ星)をバルジ中心に置く。矢が伏線で、こちらが正体。
  //   ・galaxy.starsGroupの子(=銀河と一緒に回る。中心なので位置は動かない)。
  //   ・starsGroupが俯瞰でGALAXY_OVERVIEW_SCALE倍になるので、ローカルscaleは割っておく
  //     (見た目のサイズがBULGE_BAR_HALF_LENGTH基準になる)。
  //   ・登場は非表示から。main.js側が、starburstの星が出るのと同じタイミング
  //     (銀河俯瞰=overviewActive)でvisible=trueにする。
  //   ・idleRate>0なので、止まっていても中心から粒が漂って消え続ける。
  const bulgeStar = createAStar(scene, { idleRate: 12, life: 2.2, size: 0.35 });
  galaxy.starsGroup.add(bulgeStar);
  bulgeStar.position.set(0, 0, 0);
  // 大きさ: 「周りのバルジ粒子(BULGE_BAR_POINT_SIZE=HALF_LENGTH×0.022)より少し大きく、オレンジが見える程度」。
  //   暈の直径 = 1.6 × (この比率 × BULGE_BAR_HALF_LENGTH)。0.03なら暈の直径は約0.05(粒子の2倍強)で、
  //   見えるオレンジの核はそのおよそ半分。大きさを変えたいときはこの比率だけ触る(仮値)。
  const BULGE_STAR_SIZE_RATIO = 0.03;
  bulgeStar.scale.setScalar(BULGE_BAR_HALF_LENGTH * BULGE_STAR_SIZE_RATIO / GALAXY_OVERVIEW_SCALE);
  bulgeStar.visible = false;

  mirrorVisualAnchor.position.copy(computeMirrorGroupPosition());
  mirrorVisualAnchor.visible = false; // 表示はtripodRingSwap.js側が一元管理する(swapT>=1で表示に切り替わる)
  scene.add(mirrorVisualAnchor);

  // mirrorGroup自体はpyramidMesh・bananaMeshどちらも子に持たなくなり、現在は見た目を
  // 持たない「物理的な鏡の位置」(=cubeCamera・mirrorLookTargetの基準点)としてのみ使う。
  mirrorGroup.position.copy(computeMirrorGroupPosition());
  mirrorGroup.visible = false; // startRecordDisplayまで隠しておく
  scene.add(mirrorGroup);

  // カメラが鏡側を向くときの注視点(=鏡tripod=mirrorVisualAnchorの頂点のワールド座標)。
  // ここでの値はあくまで初期値で、updateRecordDisplay側で毎フレーム
  // mirrorVisualAnchor.positionに追従するよう更新し直す(下記参照)。
  const mirrorLookTarget = new THREE.Vector3(0, mirrorVisualAnchor.position.y + MIRROR_APEX_HEIGHT, 0);

  // 最終段階('done')でカメラを引く方向(=鏡/レコード側から見て、カメラが下がっていく向き)。
  const pullbackDir = HOME_CAMERA_POS.clone().sub(mirrorLookTarget).normalize();

  // ★ バグ修正: 以前はここでmirrorGroup.positionを基準に一度だけcubeCameraの位置を決めて
  //   そのまま放置していた。しかしmirrorGroup自体は「物理的な鏡の位置」の記録用に生成時の
  //   位置(computeMirrorGroupPosition())のまま動かない一方、実際に見えているピラミッド
  //   (mirrorVisualAnchor)はtripodRingSwap.js側で毎フレーム位置(特にy)を動かされる
  //   (tripodの降下に合わせてgroundYまで下りてくる)ため、両者の位置がどんどんズレていき、
  //   「本来ピラミッドがある場所とは全く違う高さ・位置から撮影した環境」がenvMapとして
  //   反射に使われてしまっていた。これが「反射面が裏返って見える/おかしい」ように見えていた
  //   実体だった可能性が高い。以後はupdateRecordDisplay側で毎フレーム
  //   mirrorVisualAnchor.positionに追従させ直す(ここでの初期値はその1フレーム目用)。
  cubeCamera.position.copy(mirrorVisualAnchor.position).add(new THREE.Vector3(0, CUBE_CAMERA_Y_OFFSET, 0));
  scene.add(cubeCamera);

  // ★ 2026-09-17 追加(ご指示反映): トーンアーム(ガラス製)。銀河の中心
  // (galaxy.starsGroup.position。下のgalaxyCenterと同じ点)を基準に、カメラから見て
  // 右奥の角に固定位置で配置する(位置のみ。太陽系での動き・クリックでの動きは未実装)。
  const tonearm = makeTonearm(scene, renderer, galaxy.starsGroup.position);

  // ★ 追加: トーンアーム設置の2秒後に発動する「ラッパ(Metaphonyロゴ→蓄音機のホーン)」。
  //   位置・サイズ・回転はtriggerTrumpet()が計算して当てはめるので、ここでは
  //   スケール1・回転なしの状態で生成し、その時点でのバウンディング半径だけを測っておく
  //   (triggerTrumpet側で「銀河と同じぐらいの大きさ」に一様スケールする基準に使う)。
  const trumpetGroup = new THREE.Group();
  trumpetGroup.visible = false;
  scene.add(trumpetGroup);
  const trumpetApi = createTrumpetToMetaphony(trumpetGroup);
  // ★ Box3.setFromObject/computeBoundingBoxはgeometryのposition属性全体を見るため、
  //   drawRange(reveal未実行=何も描かれていない状態)には影響されない。なのでここでは
  //   まだ何も描画させず(=登場時のアニメーションをそのまま使えるようにしたまま)、
  //   素の(スケール1の)バウンディング半径だけを測っておく。
  const trumpetBaseSphere = new THREE.Box3().setFromObject(trumpetGroup).getBoundingSphere(new THREE.Sphere());
  trumpetApi.baseRadius = trumpetBaseSphere.radius;

  return {
    scene, renderer, camera, galaxy, solarSystem, universe,
    mirrorGroup, mirrorVisualAnchor, mirrorVisualHome: mirrorVisualAnchor.position.clone(),
    crossfadeRing,
    pyramidMesh, bananaMesh, crownGroup, bulge, bulgeStar, tonearm, trumpetGroup, trumpetApi,
    galaxyCenter: galaxy.starsGroup.position.clone(), // ← 太陽系召喚時の中心(銀河の中心。生成時点で固定)
    coronationStarted: false, // ← バナナクリック演出の二重発火防止
    // ★ 2026-09-16 追加(バグ修正): 「バルジが出現していない」への対応。戴冠演出中、
    //   スクロールが(何らかの理由で)後方向に動くと、tripodRingSwap.js側の
    //   updateTripodRingSwapがrecord.viewMixCurrentを見てmirrorVisualAnchor.visibleを
    //   falseに戻してしまい、その子であるbulge/バナナ/王冠ごと非表示になってしまう
    //   可能性があった。演出中(coronationStarted〜finishTripodRingSwapまで)は
    //   このフラグをtrueにして、tripodRingSwap.js側にmirrorVisualAnchorを強制的に
    //   表示させ続けてもらう。
    coronationLockVisible: false,
    cubeCamera, mirrorLookTarget,
    viewMixTarget: 0,  // 0=carousel側を向く / 1=鏡側を向く。applyScrollが更新する
    viewMixCurrent: 0, // 実際にcontrols.targetへ適用する、軽くスムージングした値
    mirrorSpinMultiplier: 1, // 鏡(レコード)の自転速度倍率。updateRecordDisplayが目標値へ滑らかに近づける
    pullbackDir,        // ← 最終段階でカメラを引く方向(固定ベクトル)
    pullbackTarget: 0,  // 0〜1。applyScrollが'done'到達後のスクロール量から算出する
    pullbackCurrent: 0, // 実際にカメラへ適用する、軽くスムージングした値
    pullbackApplied: 0, // 直前フレームでcamera.positionへ実際に足した量(次フレームで打ち消すために保持)
    // 'inactive' → 'mirror' → 'done'(revealSolarSystemが呼ばれた時点)
    phase: 'inactive',
    // ★ 2026-09-15 追加: バナナクリック後の演出(戴冠→リング拡大→リング消滅)が完了した
    //   瞬間(onRingContact)に呼ばれるフック。createRecordDisplay時点ではまだ
    //   tripodRingSwap.jsのインスタンスが存在しない(main.js側の生成順序がrecord→
    //   tripodRingSwapのため)ので、ここではnullのまま返し、main.js側で
    //   record.onSequenceComplete = () => finishTripodRingSwap(tripodRingSwap) のように
    //   後から差し込んでもらう想定。未設定なら何もしない(呼び出し側はnullチェック不要)。
    onSequenceComplete: null,
  };
}

// enterUniverse完了時に呼ぶ: 鏡三角錐(+バナナ)を表示する。
export function startRecordDisplay(record) {
  if (!record || record.phase !== 'inactive') return;
  record.mirrorGroup.visible = true;
  record.phase = 'mirror';
}

// ホイールイベントのたびに呼ぶ: scrollYは0〜SCROLL_MAXにクランプ済みの累積スクロール量
// (呼び出し側=main.jsが管理する)。画面の向き(viewMixTarget)を更新する。
// ★ 以前ここにあった「銀河のscrub量(galaxyRevealT)をスクロール量から計算し、
//   setGalaxyRevealAmountで銀河を出し入れする」処理は削除した。銀河は既にmain.js側の
//   revealGalaxy()でフルサイズ表示済みであり、ここで手を加えるとその状態を壊してしまう
//   (=今回報告のあった「右ドラッグ後に銀河が消える/発生し直す」不具合の原因だった)。
export function applyScroll(record, scrollY) {
  if (!record || record.phase === 'inactive') return;
  record.viewMixTarget = THREE.MathUtils.clamp(scrollY / SCROLL_SWITCH, 0, 1);
  // 「最後になったら」の下スクロールぶん(=SCROLL_SWITCHを使い切った後の残り)を0〜1に正規化。
  // 実際にカメラへ反映するかどうかはupdateRecordDisplay側でphase==='done'を見て判定する。
  const pullbackRangeStart = SCROLL_SWITCH;
  record.pullbackTarget = THREE.MathUtils.clamp((scrollY - pullbackRangeStart) / SCROLL_PULLBACK_RANGE, 0, 1);
}

// クリック時に呼ぶ: 鏡にヒットしていれば処理してtrueを返す。
// raycasterは呼び出し側で既にsetFromCamera済みのものを渡す。
// onNavigate(url): 省略時はrecord.js側でwindow.location.hrefを直接書き換える。
// ★ 以前あった「バナナクリック→galaxy-scrub開始」「銀河クリック→針の演出開始」の
//   2つの分岐は、銀河の動き・針の演出をこのファイルから外したのに合わせて削除した。
export function tryRecordClick(record, raycaster, { onNavigate } = {}) {
  if (!record || record.phase === 'inactive') return false;

  // トーンアーム: mirrorVisualAnchor(鏡側)の子ではなく常にsceneに直接置いているため、
  // 下のmirrorVisualAnchor.visibleガードより前に判定する(carousel側に戻っていても
  // クリックできるようにするため)。表示中(revealGalaxy済み)かつまだ「置く前」の
  // ときだけ有効。
  if (record.tonearm && record.tonearm.visible && !record.tonearm.userData.placed) {
    const tonearmHit = raycaster.intersectObject(record.tonearm, true)[0];
    if (tonearmHit) {
      placeTonearmOnRecord(record);
      return true;
    }
  }

  // 鏡: three.jsのRaycasterはvisible=falseでも判定してしまう(明示的にチェックしないと
  // 素通りする)ため、mirrorVisualAnchor.visible(=tripodRingSwap.js側で鏡tripodが実際に
  // 表示に切り替わっているか)を明示的に見て、「出現しているときだけクリック可能」にする。
  if (!record.mirrorVisualAnchor.visible) return false;

  const mirrorHit = raycaster.intersectObject(record.pyramidMesh, true)[0];
  if (mirrorHit) {
    if (onNavigate) onNavigate(MIRROR_TARGET_PAGE);
    else window.location.href = MIRROR_TARGET_PAGE;
    return true;
  }

  // バナナ: ①戴冠 → ②バルジ出現 → ③太陽系召喚、の一連の演出を開始する。
  // 一度きりの演出なので、coronationStartedで二重発火を防いでいる(演出中の再クリックは無視)。
  if (!record.coronationStarted) {
    const bananaHit = raycaster.intersectObject(record.bananaMesh, true)[0];
    if (bananaHit) {
      playCoronationSequence(record);
      return true;
    }
  }

  return false;
}

// レンダーループから、メインのrenderer.render(...)より前に毎フレーム呼ぶ想定。
// controls: main.js側のOrbitControls(渡すと、スクロールに応じて向きを補間する)。
// trumpetApi.update(elapsed)用の経過秒数。main.js側のclockには依存せず、
// updateRecordDisplayが呼ばれるたびにdeltaSecondsを足し込むだけの、record.js内で
// 閉じた積算値(内部のディレイ計算は差分ベースなので、基準点がいつでも問題ない)。
let trumpetElapsedAccumulator = 0;

export function updateRecordDisplay(record, deltaSeconds, controls) {
  if (!record) return;

  // Aスター(バルジ中心)のスターダスト更新。非表示中も、残った粒が消えるまで更新が必要。
  if (record.bulgeStar) record.bulgeStar.userData.update(deltaSeconds, record.camera);

  if (record.trumpetApi) {
    trumpetElapsedAccumulator += deltaSeconds;
    record.trumpetApi.update(trumpetElapsedAccumulator);
  }

  // 鏡三角錐(レコード)の自転速度: 現状は常に等倍。
  const spinMultiplierTarget = 1;
  const spinSmoothing = 1 - Math.exp(-MIRROR_SPIN_SMOOTHING * deltaSeconds);
  record.mirrorSpinMultiplier = THREE.MathUtils.lerp(record.mirrorSpinMultiplier, spinMultiplierTarget, spinSmoothing);

  if (record.mirrorVisualAnchor.visible) {
    record.mirrorVisualAnchor.rotateOnWorldAxis(WORLD_UP, -TRIPOD_ANGULAR_SPEED * record.mirrorSpinMultiplier * deltaSeconds);
  }

  // ★ 2026-09-11 修正(ご指示反映): 「カメラは常に固定(controls.target/positionを一切
  //   動かさない)」方針に変更した。以前はここでcontrols.targetをUNIVERSE_CAMERA_TARGET⇔
  //   mirrorLookTargetの間で補間していたが、それが「入れ替え完了後もカメラが動き続ける
  //   (=画面奥の銀河まで一緒に動いてしまう)」バグの原因だった。
  //   tripod/リングの入れ替え演出(見え方の変化)は、カメラ側ではなくtripodRingSwap.js側で
  //   tripod・リング・鏡tripod自体の位置を動かすことで表現する(このファイルではcontrols.target
  //   にはもう触れない)。mirrorLookTargetは現在カメラ制御には使っていないが、pullback(休眠中。
  //   phase==='done'到達時のみ有効)の向き計算に使う初期値としてこのまま残してある。
  // ★ controls.update()自体は、record.phase!=='inactive'の間もユーザーのドラッグ操作
  //   (OrbitControlsの自由回転)を反映させるために毎フレーム呼び続ける必要があるため、
  //   このifブロックごと削除はしないこと(削除すると宇宙ページでカメラが一切回せなくなる)。
  if (controls && record.phase !== 'inactive') {
    // mirrorVisualAnchorはtripodRingSwap.js側で位置(y)が決まるため、mirrorLookTargetも
    // 毎フレーム追従させ直す(現状はpullbackDirの初期値計算にしか使っていない休眠中の値)。
    record.mirrorLookTarget.set(0, record.mirrorVisualAnchor.position.y + MIRROR_APEX_HEIGHT, 0);

    const smoothing = 1 - Math.exp(-VIEW_MIX_SMOOTHING * deltaSeconds);
    record.viewMixCurrent = THREE.MathUtils.lerp(record.viewMixCurrent, record.viewMixTarget, smoothing);

    // 直前フレームで足した「カメラを引く」ぶんをいったん取り消してから、controls.update()に
    // 通常のOrbitControls計算(ユーザーのドラッグ回転などの反映。targetは動かしていないので
    // 実質的にはノーオペレーション)をさせる。
    record.camera.position.addScaledVector(record.pullbackDir, -record.pullbackApplied);
    controls.update();

    // 「最後になったら、下スクロールでカメラを引いてレコード全体が見えるように」の反映。
    // phase==='done'は、バナナクリック演出の最後(revealSolarSystem)で到達する。
    const pullbackTargetNow = record.phase === 'done' ? record.pullbackTarget : 0;
    const pullbackSmoothing = 1 - Math.exp(-PULLBACK_SMOOTHING * deltaSeconds);
    record.pullbackCurrent = THREE.MathUtils.lerp(record.pullbackCurrent, pullbackTargetNow, pullbackSmoothing);
    record.pullbackApplied = record.pullbackCurrent * RECORD_PULLBACK_DISTANCE;
    record.camera.position.addScaledVector(record.pullbackDir, record.pullbackApplied);
  }

  // 鏡に映るシーンを毎フレーム撮影する(自分自身が映り込まないよう撮影中だけ非表示にする)。
  // ★ バグ修正(ご指摘反映): 「鏡tripodが消えた後に登場する金のリング(universe.goldenRing)
  //   の上に、その後ずっとihがいる。ihは映っているか」への対応。
  //   以前はここが`if (!record.mirrorVisualAnchor.visible) return;`だけだったため、
  //   finishTripodRingSwap()がmirrorVisualAnchor.visible=falseにした瞬間(=まさに
  //   goldenRing・ihが恒久的に現れる瞬間)から、このcubeCamera.update()自体が
  //   二度と呼ばれなくなっていた。つまりgoldenRing.material.envMapが参照している
  //   renderTarget.textureは、鏡が消える直前(=goldenRing・ihがまだ現れる前)の
  //   状態で完全に凍結されており、以後どれだけihがそこに居続けても、その反射には
  //   一切反映されないままだった(除外されていたのではなく、撮影自体が止まっていた)。
  //   鏡・金のリングのどちらか一方でも見えている間は撮影を続けるようにし、golden
  //   ring段階ではリング(=ihのすぐ下)側へcubeCameraを追従させる。
  const mirrorVisible = record.mirrorVisualAnchor.visible;
  const goldenRing = record.universe ? record.universe.goldenRing : null;
  const goldenRingVisible = !!(goldenRing && goldenRing.visible);
  if (!mirrorVisible && !goldenRingVisible) return;
  // ★ バグ修正: 撮影(=cubeCamera.update)の直前に、実際に見えている方
  //   (鏡=mirrorVisualAnchor、または金のリング=goldenRing。どちらもtripodRingSwap.js側が
  //   毎フレーム/切り替え時に位置を書き換えている)へcubeCameraの位置を追従させ直す。
  //   これを怠ると、撮影位置が実際の見た目の位置から乖離したままになり、反射が
  //   実際の見た目と食い違って見えてしまう(詳細はcreateRecordDisplay側のコメント参照)。
  if (mirrorVisible) {
    record.cubeCamera.position.copy(record.mirrorVisualAnchor.position).add(_cubeCameraOffset);
  } else {
    // ★ ihはgoldenRingのすぐ上(universe.js側のIH_ABOVE_RING_MARGIN+バウンス)にいるので、
    //   リング自身の高さそのものより少し上を撮影点にする(仮値。見ながら調整してください)。
    record.cubeCamera.position.copy(goldenRing.position).add(_goldenRingCubeCameraOffset);
  }
  record.mirrorGroup.visible = false;
  const wasVisualVisible = record.mirrorVisualAnchor.visible;
  record.mirrorVisualAnchor.visible = false;
  // ★ goldenRing自身も、鏡と同じ理由(自分自身が映り込むのを防ぐ)で撮影中だけ隠す。
  const wasGoldenRingVisible = goldenRingVisible;
  if (goldenRing) goldenRing.visible = false;
  // ★ バグ修正: record.tonearm(MeshPhysicalMaterial({transmission:1.0})のガラス製アーム)が
  //   撮影対象のシーンに写ったままだと、three.js側がtransmissionオブジェクト描画のたびに
  //   挟む「背景を一時レンダーターゲットへ撮り直す」処理が、CubeCameraの現在の面
  //   (activeCubeFace)を正しく復元しないため、6面の撮影がズレて envMap がほぼ黒に
  //   壊れてしまう。撮影の間だけ非表示にして、この干渉を避ける。
  const wasTonearmVisible = record.tonearm ? record.tonearm.visible : false;
  if (record.tonearm) record.tonearm.visible = false;
  record.cubeCamera.update(record.renderer, record.scene);
  if (record.tonearm) record.tonearm.visible = wasTonearmVisible;
  record.mirrorGroup.visible = true;
  record.mirrorVisualAnchor.visible = wasVisualVisible;
  if (goldenRing) goldenRing.visible = wasGoldenRingVisible;
}

// TODO:
//   - SCROLL_SWITCH / SCROLL_PULLBACK_RANGE / VIEW_MIX_SMOOTHING / MIRROR_ENV_RESOLUTION /
//     BANANA_HEIGHT_ABOVE_APEX / RECORD_PULLBACK_DISTANCE / PULLBACK_SMOOTHING は仮値です。
//   - MIRROR_TARGET_PAGE('prism2.html'): 実際の配置パスに合わせて調整してください。
//   - トーンアーム(旧・針)は2026-09-17に全削除し、今後新しく作り直す予定です。
//     再実装する際は、盤面に接触したタイミングでrevealSolarSystem(record)を呼ぶ形に
//     すればよいはずです(戴冠演出側のsetTimeoutでの即時呼び出しを、その呼び出しに
//     差し替えてください)。
//   - 銀河を「右ドラッグで俯瞰後、スクロールで縮小させる」新しい演出は、このファイルの
//     責務から外れたため未実装のままです(別途main.js側などでの実装を想定)。
//   - RECORD_PULLBACK_DISTANCEは、以前GALAXY_RADIUS基準で計算していたが銀河への依存を
//     切り離したため単純な定数(仮値1)に変更した。実際の見た目に合わせて調整してください。
//   - 鏡は本格的なリアルタイム反射(CubeCamera)なので、解像度(MIRROR_ENV_RESOLUTION)や
//     毎フレームの再撮影が負荷になる場合、フレーム間引き(数フレームに1回だけ更新)などの
//     最適化が今後必要になるかもしれません。