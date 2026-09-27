import * as THREE from 'three';
import { TRIPOD_RADIUS, RECORD_ANCHOR } from './universe.js';

// ══════════════════════════════════════════════════════════════
// ── 宇宙ページ最終装飾: tripod直下を公転する太陽系(将来カルーセルの一部) ──
// ══════════════════════════════════════════════════════════════
//
// ★ 方針変更: バナナ惑星はgalaxy.js側へ移動した(銀河の中心に置く演出のため)。
//   このファイルはもうバナナを持たない。太陽の公転軌道(sunGroupが辿るorbitCurve)は
//   tripod(universe.js)の頂点からさらに上、以前は方程式画像が浮かんでいた場所
//   (universe.jsのRECORD_ANCHOR)を中心にした円として配置する(★2024年改訂: 以前は
//   tripod足元より下に置いていたが、「三軸=レコードプレーヤー、リング(→主軌道)は
//   その上に乗る」という構成に変更したため、上下が入れ替わっている)。
// ★ ORBIT_CENTER(=RECORD_ANCHOR)はexportしてある。galaxy.js側が「銀河とその中心の
//   バナナ」を同じ点に置くのに使う想定。
//
// 全体サイズはSOLAR_SYSTEM_SCALEで半分に縮小(太陽・惑星本体と、惑星ごとの太陽からの
// 距離)。ただし主軌道半径(ORBIT_RADIUS_BASE)だけはtripodの回転軌道より一回り大きくする方針のため、
// スケールの対象外でTRIPOD_RADIUSを倍率(1.6倍、仮値)して採用している。
//
// 階層構造(入れ子の公転):
//   group (このシステム全体)
//     ├─ sunGroup   (軌道(tripod直下・ORBIT_RADIUS_BASE半径の正円)上を移動)
//     │     ├─ sunMesh (クリックしても現在は何も起きない。8惑星の軌跡は最初から表示済みのため)
//     │     └─ planetPivot[i] (ローカルY軸回りに回転) → planetMesh[i] (太陽からの距離=軌道半径)
//     ├─ trailLines[i] (8惑星それぞれの黄色い軌跡。作成時点(=宇宙ページ到達と同時)から実際に
//     │                 通った位置を随時追記していく。バナナクリックで非表示になる)
//     └─ sunTrail.line (太陽自身の軌道。バナナクリックまでは記録開始前で何も描かれず、
//                       クリック後はtrailLinesと同じ仕組みで太陽の実際の移動から線が伸びていく)
//
// ── 公転面を直交させる仕組み ────────────────────────────
// 太陽グループ(sunGroup)を「軌道上の現在位置」に置くだけでなく、
// 「ローカルY軸がその地点での進行方向(接線=tangent)と一致する」ように毎フレーム向きも合わせる。
// すると、惑星の公転面(ローカルXZ平面。pivot.rotation.yで回る面)は常に進行方向と直交した状態を
// 保ったまま、太陽と一緒に軌道に沿って運ばれることになる。これにより、惑星が実際にたどる
// 世界座標上の軌跡は、軌道の周りに巻きつく「らせん」になる ── というのが今回の見た目の仕組み。
// 軌道自体が正円の間はまっすぐな円筒らせん、将来バナナ型へ変形すればバナナ状のらせんになる。

// ── クリックで飛ぶ個人ページ。まだURLが無いのでプレースホルダー ──
// ★ 元々バナナ惑星クリックで遷移していたが、リンクは今後作成する「月」オブジェクト側へ
//   移す方針になったため、この定数はここに残しておき、月モジュール実装時にそちらから
//   importして使ってもらう想定(このファイル自体はもう参照していない)。
export const PERSONAL_PAGE_URL = 'https://example.com/moon-base'; // ← 実際のURLが決まったら差し替え

// ── 太陽系全体を半分サイズにする ────────────────────────────
// 太陽・惑星本体の大きさ、および各惑星の太陽からの距離(orbit)に適用する。
// 主軌道半径(ORBIT_RADIUS_BASE)は対象外 ── 詳細はORBIT_RADIUS_BASEの定義を参照。
const SOLAR_SYSTEM_SCALE = 0.5;

function makeHitAreaMesh(radius) {
  // このプロジェクトの他の隠しボタンと同じ方式: visible=trueのままほぼ完全に透明にする。
  // visible=falseの当たり判定はraycastが拾わない環境があるため避ける。
  return new THREE.Mesh(
    new THREE.SphereGeometry(radius, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
  );
}

// ── 太陽が辿る軌道 ────────────────────────────────
// 現状は正円(ORBIT_BEND=0, ORBIT_HEIGHT_WOBBLE=0)。
// 将来「黄色いリング(=このモジュールで生成する軌跡)をクリックしたら、正円→バナナ型へ
// 変形させて巨大バナナの絵を描く」という構想があるため、バナナ側の目標パラメータ
// (BANANA_TARGET_BEND / BANANA_TARGET_HEIGHT_WOBBLE)は変形先の参考値として残してある。
// 今回はこの2つをまだ使っていない(実装は正円のみ)。
// r(θ) = radius + ORBIT_BEND * sin(θ)^2 という式を使っており、ORBIT_BENDを0以外に
// すると片側だけが外側に張り出したバナナ/三日月状の非対称カーブになる(将来の変形先の式)。
// 基準半径: 以前はtripod(universe.js)の回転軌道(終端3点が描く円)とぴったり揃えていたが、
// 「太陽系の軌道も大きくしてほしい」とのご指示で、tripodより一回り大きくしてある(仮値・倍率)。
// もうtripodの直径と一致させる制約は外れたので、SOLAR_SYSTEM_SCALEの対象外という位置づけだけ
// (太陽本体・惑星本体・惑星軌道半径には掛からない)は変わらず維持している。
// ★ 2026-09-19 修正(ご指摘反映):「太陽の銀河の公転半径を1.5倍ほど大きくして」への対応。
export const ORBIT_RADIUS_BASE = TRIPOD_RADIUS * 2.4 * 3;      // createSolarSystem時点の初期主軌道半径(仮値。以前の1.5倍)
// ↑ recordAssembly.js側の針が銀河に触れた瞬間、setOrbitRadius()でこれよりもっと大きい値
//   (針が触れた位置=銀河上の接触点の半径)に即座に置き換えられる。あくまで生成直後の初期値。
// ── 「規定軌道」: バナナクリック後、軌道が最終的に縮み切る先の固定半径 ───────────
// ご指示により「tripodの半径より少し小さくした値」を採用(以前は「現在の半径×比率」で
// 相対的に決めていたが、針(recordAssembly.js)が触れた位置次第で開始半径が変わるようになった
// ため、縮小先は絶対値の固定半径にした)。
export const FINAL_ORBIT_RADIUS = TRIPOD_RADIUS * 0.9; // 仮値。「少し小さく」の度合いは見ながら調整
const ORBIT_BEND = 0;                  // 0=正円。バナナへ変形するときはここをBANANA_TARGET_BENDへ近づけていく想定
const ORBIT_HEIGHT_WOBBLE = 0;         // 0=完全に平面的な正円。バナナ変形時はBANANA_TARGET_HEIGHT_WOBBLEへ
const ORBIT_CURVE_POINTS = 64;         // 曲線を近似する制御点の数
// ↓ galaxy.js側が「銀河の自転速度を太陽系の公転速度と揃える」「太陽系が軌道を一周したら
//   銀河を縮小する」の両方の基準時間として参照するためexportした。
// ★ 2026-09-19 修正(ご指摘反映):「太陽系の銀河の公転速度は遅くてよい」への対応。
//   以前の40から60へ(仮値。遅くする分にはいくらでも調整して構わないとのことなので、
//   見た目を見ながらさらに大きくしてもよい)。
export const SUN_ORBIT_PERIOD = 60;    // 太陽が軌道を1周するのにかかる秒数(仮値)

// radius: 呼び出し時点の主軌道半径。バナナクリック後の縮小アニメーション中は、
// この関数を毎フレーム呼び直して軌道形状を再計算する(rebuildOrbitCurve参照)。
function makeOrbitCurve(center, radius) {
  const pts = [];
  for (let i = 0; i < ORBIT_CURVE_POINTS; i++) {
    const theta = (i / ORBIT_CURVE_POINTS) * Math.PI * 2;
    const r = radius + ORBIT_BEND * Math.sin(theta) * Math.sin(theta);
    const x = center.x + r * Math.cos(theta);
    const z = center.z + r * Math.sin(theta);
    const y = center.y + ORBIT_HEIGHT_WOBBLE * Math.sin(theta * 2);
    pts.push(new THREE.Vector3(x, y, z));
  }
  // closed=trueで滑らかな閉曲線にする(始点と終点が自然につながる)
  return new THREE.CatmullRomCurve3(pts, true, 'catmullrom', 0.5);
}

// ── 太陽本体 ────────────────────────────────────
const SUN_RADIUS = 0.9 * SOLAR_SYSTEM_SCALE;
const SUN_COLOR = 0xffcc55;
const SUN_HIT_RADIUS = 1.8 * SOLAR_SYSTEM_SCALE; // クリックしやすいよう見た目より広めの当たり判定(比率は維持)

function makeSunMesh() {
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 24, 24),
    new THREE.MeshBasicMaterial({ color: SUN_COLOR })
  );
  mesh.add(makeHitAreaMesh(SUN_HIT_RADIUS));
  mesh.userData.isSun = true;
  return mesh;
}

// ── 8惑星(装飾。実在の縮尺・色にはこだわらず仮の見た目) ─────────────
// 各惑星は「pivot(太陽グループの原点を軸に回転)→その子として軌道半径分だけ離れた惑星メッシュ」
// という、three.jsで定番の入れ子公転パターン。
// speedは「1秒あたりの角速度(rad/秒)」に変換して使う(ANGULAR_SPEED_SCALEで調整)。
// フレームごとの加算(旧実装)ではなく経過時間から直接角度を計算する方式にしたことで、
// フレームレートに依存せず動く。
// ★ 2026-09-19 修正(ご指摘反映): 「らせん回転の比率を上げたい」の本来の調整箇所は
//   ここ。以前は0.6だったが、銀河を一周する時間(SUN_ORBIT_PERIOD)はそのままに、
//   1周あたりの惑星の自転(=らせんの巻き数)だけを10倍にしたいとのご指示のため、
//   ここを10倍(0.6→6)にした(主軌道側のtへ誤って加えていた/10は上のupdateSolarSystem
//   側で削除済み)。
const ANGULAR_SPEED_SCALE = 6; // 旧実装(1フレームあたりspeed*0.01, 60fps想定)と近い見た目速度になるよう変換したうえで、らせんの巻き数を10倍にする係数
const PLANETS = [
  { name: 'Mercury', radius: 0.12, orbit: 1.4, speed: 4.1, color: 0xb1b1b1 },
  { name: 'Venus',   radius: 0.18, orbit: 1.9, speed: 3.0, color: 0xe0c16c },
  { name: 'Earth',   radius: 0.19, orbit: 2.5, speed: 2.4, color: 0x5b9bd5 },
  { name: 'Mars',    radius: 0.15, orbit: 3.1, speed: 1.9, color: 0xc1440e },
  { name: 'Jupiter', radius: 0.42, orbit: 4.1, speed: 1.1, color: 0xd9a066 },
  { name: 'Saturn',  radius: 0.36, orbit: 5.0, speed: 0.85, color: 0xe3c98f },
  { name: 'Uranus',  radius: 0.28, orbit: 5.8, speed: 0.6, color: 0x9fe0e0 },
  { name: 'Neptune', radius: 0.27, orbit: 6.5, speed: 0.47, color: 0x5b6ee1 },
// ↑ radius(惑星本体の大きさ)・orbit(太陽からの距離)は、下でSOLAR_SYSTEM_SCALEを掛けて半分にする(speed/colorはそのまま)。
].map((p) => ({ ...p, radius: p.radius * SOLAR_SYSTEM_SCALE, orbit: p.orbit * SOLAR_SYSTEM_SCALE }));

function makePlanets(sunGroup) {
  const pivots = [];
  PLANETS.forEach((p) => {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(p.radius, 14, 14),
      new THREE.MeshBasicMaterial({ color: p.color })
    );
    mesh.position.set(p.orbit, 0, 0);
    pivot.add(mesh);
    pivot.userData.mesh = mesh; // 軌跡記録時に実際のワールド座標を取るための参照
    pivot.userData.orbitRadius = p.orbit;
    pivot.userData.angularSpeed = p.speed * ANGULAR_SPEED_SCALE; // rad/秒
    // 惑星ごとに初期角度をばらけさせる(全部が一直線に並んで見えるのを避ける、仮値)
    pivot.userData.initialAngle = Math.random() * Math.PI * 2;
    sunGroup.add(pivot);
    pivots.push(pivot);
  });
  return pivots;
}

// solarSystem.orbitCurveを、solarSystem.orbitRadius・solarSystem.orbitCenterの現在値に合わせて
// 再計算する。shrinkOrbitOnBananaClickのtween中、毎フレーム呼ばれる想定。太陽の軌道の見た目
// (sunTrail、後述)はこのカーブ上の実際の移動から動的に生成されるので、ここでは
// カーブそのものの再計算だけでよい(静的なラインジオメトリの描き直しは不要)。
function rebuildOrbitCurve(solarSystem) {
  solarSystem.orbitCurve = makeOrbitCurve(solarSystem.orbitCenter, solarSystem.orbitRadius);
}

// 主軌道の中心そのものを動かす(record.js側で「銀河=バナナの位置」に太陽系を合わせるために使う)。
// 既定値はORBIT_CENTER(createSolarSystem参照)。
export function setOrbitCenter(solarSystem, center) {
  solarSystem.orbitCenter.copy(center);
  rebuildOrbitCurve(solarSystem);
}

// ── 黄色い軌跡(trail) ────────────────────────────────
// 「実際にその瞬間その瞬間で惑星がどこにいたか」を毎フレーム(一定間隔)記録して線を伸ばす方式。
// 事前に1周分をまとめて計算する旧方式だと、惑星の周期と太陽の公転周期が揃っていないため
// クリック時点の実際の位相と軌跡の始点(位相ゼロ)がズレて、2周目以降に見た目が噛み合わなく
// なる問題があった。実際の位置をそのまま記録する今の方式ならズレようがない。
// リングバッファで直近TRAIL_MAX_POINTS点だけ保持し続け、それより古い点は自然に消えていく
// (=太陽の直近1周分の軌跡が常に表示される)。
const TRAIL_COLOR = 0xffee66;    // 黄色、細い(LineBasicMaterialは基本1px程度の細線になる)
const TRAIL_MAX_POINTS = 720;    // 保持する点の数(仮値。多いほど滑らかで長く残るが重くなる)
const TRAIL_RECORD_INTERVAL = SUN_ORBIT_PERIOD / TRAIL_MAX_POINTS; // 何秒おきに1点記録するか

const _UP = new THREE.Vector3(0, 1, 0);
const _curvePoint = new THREE.Vector3();
const _tangent = new THREE.Vector3();
const _sunQuat = new THREE.Quaternion();
const _planetWorld = new THREE.Vector3();

// 太陽グループの「向き」を、軌道曲線上のtパラメータでの接線方向に合わせるための共通処理。
function computeSunPose(orbitCurve, t, outPos, outQuat) {
  orbitCurve.getPointAt(t, outPos);
  orbitCurve.getTangentAt(t, _tangent);
  outQuat.setFromUnitVectors(_UP, _tangent);
}

// 惑星(または太陽)1本ぶんのリングバッファ状態を作る。
// buffer: リングバッファ本体(書き込み順)。ordered: 描画用に時系列順へ並べ替えたもの
// (Three.jsのLineは頂点配列の並び順そのまま線を引くので、リングのラップ地点で
//  最新点→最古点へ一直線に飛ぶ線が出ないよう、描画前に必ず時系列順へ整列させる)。
function makeTrailState() {
  return {
    buffer: new Float32Array(TRAIL_MAX_POINTS * 3),
    ordered: new Float32Array(TRAIL_MAX_POINTS * 3),
    writeIndex: 0, // 次に書き込む位置
    count: 0,      // 埋まっている点数(TRAIL_MAX_POINTSで頭打ち)
  };
}

// makeTrailState()の状態に、実際に描画するThree.jsのLine一式(geometry/material/line)を
// 足したものを作る。record開始前は点数0(setDrawRange(0,0))なので、何も描かれない
// 状態からスタートする ── 「実際の移動によって線が生成されていく」見た目はこれで実現している。
function makeTrailLine(color) {
  const state = makeTrailState();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(state.ordered, 3));
  geometry.setDrawRange(0, 0);
  // ご指示「星の軌道はかなり細くして」の反映: WebGLではLineBasicMaterialのlinewidthは
  // ほとんどの環境で1px固定(値を上げても無視される)ため、これ以上「太さ」を直接変える
  // 手段がない。代わりに半透明にすることで視覚的に細く・淡く見えるようにしている(仮値)。
  const material = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.45 });
  const line = new THREE.Line(geometry, material);
  return { ...state, geometry, line };
}

// worldPosを1点、リングバッファに追記して、描画用ジオメトリを更新する。
function recordTrailPoint(trail, worldPos) {
  const idx = trail.writeIndex * 3;
  trail.buffer[idx] = worldPos.x;
  trail.buffer[idx + 1] = worldPos.y;
  trail.buffer[idx + 2] = worldPos.z;
  trail.writeIndex = (trail.writeIndex + 1) % TRAIL_MAX_POINTS;
  trail.count = Math.min(trail.count + 1, TRAIL_MAX_POINTS);

  // バッファが満杯になるまではwriteIndexがそのまま「末尾+1」なので先頭(0)から古い順。
  // 満杯後はwriteIndexの位置が最古の点になる(次に上書きされる場所のため)。
  const start = trail.count < TRAIL_MAX_POINTS ? 0 : trail.writeIndex;
  for (let i = 0; i < trail.count; i++) {
    const srcIdx = ((start + i) % TRAIL_MAX_POINTS) * 3;
    const dstIdx = i * 3;
    trail.ordered[dstIdx] = trail.buffer[srcIdx];
    trail.ordered[dstIdx + 1] = trail.buffer[srcIdx + 1];
    trail.ordered[dstIdx + 2] = trail.buffer[srcIdx + 2];
  }
  trail.geometry.attributes.position.needsUpdate = true;
  trail.geometry.setDrawRange(0, trail.count);
}

// ── 公転軌道の中心(=カルーセルのステージ/「レコード」の乗る場所) ──────────
// ★ 構成変更: 以前はtripod(universe.js)の回転軸(world Y)上、tripod足元よりさらに
//   下(STAGE_HEIGHT_BELOW_TRIPOD)に置いていたが、「三軸は前半ではレコードプレーヤーであり、
//   リング(→太陽系の主軌道)はその上に乗る」という新しい構成に伴い、以前は方程式画像を
//   掲げていた場所(universe.jsのRECORD_ANCHOR、tripod頂点からさらに高さ軸方向)と
//   同じ点に変更した。galaxy.js側が「銀河とその中心のバナナ」を置く場所としても
//   このORBIT_CENTERをそのまま再利用する(export)。
export const ORBIT_CENTER = RECORD_ANCHOR.clone();

// scene: universe.js と同じシーンに追加する想定。
// (バナナ惑星はgalaxy.js側へ移動したため、ここでは太陽系本体だけを作る)
export function createSolarSystem(scene) {
  const group = new THREE.Group();
  group.visible = false; // enterUniverse等のフェードインに合わせて、呼び出し側でtrueにする想定
  scene.add(group);

  const orbitRadius = ORBIT_RADIUS_BASE;
  const orbitCurve = makeOrbitCurve(ORBIT_CENTER, orbitRadius); // ← tripod直下・tripodより一回り大きい軌道

  const sunGroup = new THREE.Group();
  const sunMesh = makeSunMesh();
  sunGroup.add(sunMesh);
  group.add(sunGroup);

  const planetPivots = makePlanets(sunGroup);

  // 太陽自身の軌道(sunTrail): 8惑星のtrailとまったく同じ仕組みで、太陽の実際の移動位置を
  // 記録して線を伸ばしていく。バナナクリックまでは記録を開始しない(=count0本のまま何も
  // 描かれない)ので、バナナクリックした瞬間から「太陽の移動によって」線が生成され始める。
  // 色は8惑星のtrailと同じTRAIL_COLORでよいとのことなので共通の色を使う。
  const sunTrail = makeTrailLine(TRAIL_COLOR);
  group.add(sunTrail.line);

  const solarSystem = {
    group, sunGroup, sunMesh, orbitCurve, orbitRadius, planetPivots,
    orbitCenter: ORBIT_CENTER.clone(), // ← 主軌道の中心(既定値ORBIT_CENTER。setOrbitCenterで動かせる)
    sunTrail,                 // ← 太陽自身の軌道(初期は記録なし)。バナナクリックで記録開始
    sunTrailRecording: false, // ← バナナクリックまでfalse
    sunTrailLastRecorded: -Infinity,
    orbitShrunk: false,       // ← 二重発火防止
    trailLines: [],          // ← { geometry, line, buffer, ordered, writeIndex, count } を8個ぶん保持
    trailsGenerated: false,  // ← 二重生成防止
    trailLastRecorded: -Infinity, // ← 直近に記録したelapsedSeconds
  };

  // 「クリックで出現」ではなく、最初(宇宙ページ到達と同時)から8惑星のらせん軌道を
  // 記録・表示しておく(既存のgeneratePlanetTrailsの仕組みをそのまま使い、呼ぶタイミングだけ
  // 「太陽クリック時」から「作成時」に変更した)。
  generatePlanetTrails(solarSystem);

  return solarSystem;
}

// ── 毎フレーム呼ぶ ──────────────────────────────────
export function updateSolarSystem(solarSystem, elapsedSeconds) {
  if (!solarSystem.group.visible) return;

  // ★ 2026-09-19 修正(ご指摘反映): 「らせん回転の比率を上げようとして係数に10を追加したが、
  //   軌道の線が銀河を一周しなくなった」への対応。原因はここだった。ここのtはSUN_ORBIT_PERIODで
  //   主軌道(銀河の周り)を1周する太陽自身の位置パラメータであり、「らせんの巻き数(惑星が
  //   太陽の周りを何回自転するか)」の比率とは無関係。ここに/10を足してしまったせいで
  //   主軌道の1周にかかる時間が10倍に伸び、軌道の線がもう銀河を一周しきれなくなっていた。
  //   「らせんの巻き数を上げる」の本来の調整箇所は、下のPLANETS.forEach内で使っている
  //   ANGULAR_SPEED_SCALE(惑星の自転速度側の係数)。そちらを10倍にすることで、主軌道の
  //   周期(=銀河を一周する時間)は元に戻したまま、1周あたりの惑星の公転(自転)回数だけを
  //   10倍に保っている。
  const t = (elapsedSeconds / SUN_ORBIT_PERIOD) % 1;
  computeSunPose(solarSystem.orbitCurve, t, _curvePoint, _sunQuat);
  solarSystem.sunGroup.position.copy(_curvePoint);
  solarSystem.sunGroup.quaternion.copy(_sunQuat); // ← 公転面を進行方向と直交させる(らせんの仕組み)

  solarSystem.planetPivots.forEach((pivot) => {
    pivot.rotation.y = pivot.userData.initialAngle + pivot.userData.angularSpeed * elapsedSeconds;
  });

  // 太陽クリック後は、一定間隔ごとに「今実際にいる位置」をそのまま軌跡へ記録していく。
  if (
    solarSystem.trailsGenerated &&
    elapsedSeconds - solarSystem.trailLastRecorded >= TRAIL_RECORD_INTERVAL
  ) {
    solarSystem.trailLastRecorded = elapsedSeconds;
    solarSystem.planetPivots.forEach((pivot, i) => {
      pivot.userData.mesh.getWorldPosition(_planetWorld);
      recordTrailPoint(solarSystem.trailLines[i], _planetWorld);
    });
  }

  // 太陽自身の軌道(sunTrail): バナナクリック後(sunTrailRecording===true)のみ、
  // 8惑星のtrailと同じ間隔で「太陽の今の実際の位置」(=_curvePoint)を記録していく。
  // 主軌道半径が縮小中でもcomputeSunPoseが毎フレーム現在のorbitCurveを参照するため、
  // 記録される軌跡は自然に「大きい円→小さい円」への移り変わりを描く。
  if (
    solarSystem.sunTrailRecording &&
    elapsedSeconds - solarSystem.sunTrailLastRecorded >= TRAIL_RECORD_INTERVAL
  ) {
    solarSystem.sunTrailLastRecorded = elapsedSeconds;
    recordTrailPoint(solarSystem.sunTrail, _curvePoint);
  }
}

// ── 呼ぶと8惑星ぶんの軌跡の「記録」を開始する ──────────────
// 一括計算はせず、以後updateSolarSystem側で実際の位置を随時記録していく方式。
// createSolarSystem内で作成時に自動的に呼ばれるので、宇宙ページ到達と同時に
// 記録・表示が始まる(以前は太陽クリックが必要だったが、そちらは撤廃した)。
export function generatePlanetTrails(solarSystem) {
  if (solarSystem.trailsGenerated) return;
  solarSystem.trailsGenerated = true;
  solarSystem.trailLastRecorded = -Infinity;

  solarSystem.trailLines = solarSystem.planetPivots.map(() => {
    const trail = makeTrailLine(TRAIL_COLOR);
    solarSystem.group.add(trail.line);
    return trail;
  });
}

// ── バナナクリックで呼ぶ: 8惑星の軌道(trailLines)を消し、太陽自身の軌道(sunTrail)の
//    記録を開始し、主軌道半径を少し小さく変化させる ─────────────────
// 太陽の軌道はもう静的な線ではなく、8惑星のtrailとまったく同じ「実際の移動を記録して
// 線を伸ばす」方式(sunTrail)。ここで記録を開始するだけで、以後updateSolarSystem側が
// 毎フレーム勝手に線を伸ばしていく(=太陽の移動によって生成される)。
// onUpdate(radius): 毎フレーム、縮小中の現在の軌道半径を呼び出し側へ知らせるための追加コールバック。
// recordAssembly.jsの針を軌道の縮小に追従させる(updateNeedleToRadius)のに使う想定。
export function shrinkOrbitOnBananaClick(solarSystem, { duration = ORBIT_SHRINK_DURATION, onUpdate, onComplete } = {}) {
  if (solarSystem.orbitShrunk) return;
  solarSystem.orbitShrunk = true;

  solarSystem.trailLines.forEach((t) => { t.line.visible = false; });
  solarSystem.sunTrailRecording = true;
  solarSystem.sunTrailLastRecorded = -Infinity;

  const tweenState = { radius: solarSystem.orbitRadius };
  gsap.to(tweenState, {
    radius: FINAL_ORBIT_RADIUS, // 「規定軌道」= tripodの半径より少し小さめの固定値まで縮める
    duration,
    ease: 'power2.inOut',
    onUpdate: () => {
      solarSystem.orbitRadius = tweenState.radius;
      rebuildOrbitCurve(solarSystem);
      if (onUpdate) onUpdate(solarSystem.orbitRadius);
    },
    onComplete: () => { if (onComplete) onComplete(); },
  });
}

// ── レコード演出(recordAssembly.js)専用: 主軌道半径を即座に書き換える ──────────
// ドッキング直後、「リングと同じ小さな半径」から膨張を始めるための初期値セットに使う。
export function setOrbitRadius(solarSystem, radius) {
  solarSystem.orbitRadius = radius;
  rebuildOrbitCurve(solarSystem);
}

// ── レコード演出専用: 主軌道半径を(小さい状態から)ORBIT_RADIUS_BASEまで膨張させる ──
// shrinkOrbitOnBananaClickの「縮小版」の逆再生にあたる処理。呼び出し前にsetOrbitRadiusで
// 小さい初期半径(=リングの初期サイズ)にしておき、solarSystem.group.visible=trueにしてから
// 呼ぶ想定(視認開始と同時にらせん軌道が記録され始める)。
export function growOrbitToFull(solarSystem, { duration = 3.2, ease = 'power2.out', onComplete } = {}) {
  const tweenState = { radius: solarSystem.orbitRadius };
  return gsap.to(tweenState, {
    radius: ORBIT_RADIUS_BASE,
    duration,
    ease,
    onUpdate: () => {
      solarSystem.orbitRadius = tweenState.radius;
      rebuildOrbitCurve(solarSystem);
    },
    onComplete: () => { if (onComplete) onComplete(); },
  });
}

// ── main.js側の統合ポイント(想定) ──────────────────────
//   1) createUniverse(scene)の近くで1回:
//        const solarSystem = createSolarSystem(scene);
//   2) enterUniverse()完了時など、宇宙ページに入ったタイミングで:
//        solarSystem.group.visible = true;
//   3) レンダーループ内(animate)で毎フレーム:
//        updateSolarSystem(solarSystem, clock.getElapsedTime());
//   4) クリック処理内(宇宙ページがアクティブな時のみ判定すればOK):
//        - 太陽: raycaster.intersectObject(solarSystem.sunMesh, true)[0] → generatePlanetTrails(solarSystem)
//        - バナナ(record.js側のオブジェクト)のクリック判定・以降の召喚シーケンスはrecord.js
//          (playNeedleSequence/onRingContact)を参照。銀河自体の拡大・縮小は廃止済みなので、
//          ここでshrinkOrbitOnBananaClickを呼ぶ想定は現在は使っていない
//          (8惑星軌道=trailLinesが消え、太陽自身の軌道=sunTrailの記録が始まり、主軌道が広がるのは
//          growOrbitToFullが担っている)。
//
// TODO:
//   - PERSONAL_PAGE_URL: 個人ページのURLが決まり次第差し替え(現在はgalaxy.jsも未使用。
//     今後作成予定の「月」オブジェクト側からimportして使う想定)。
//   - ORBIT_RADIUS_BASE: createSolarSystem時点の初期主軌道半径(仮値。recordAssembly.jsの針が
//     触れた瞬間にsetOrbitRadius()でもっと大きい値に置き換わるので、実際に見える大きさは
//     このORBIT_RADIUS_BASEではなく針の接触位置で決まる)。FINAL_ORBIT_RADIUS(バナナクリック後の
//     縮小先の固定半径、tripodの半径より少し小さめ)・ORBIT_SHRINK_DURATIONも仮値。
//     ORBIT_BEND/ORBIT_HEIGHT_WOBBLEは現状0(正円)。将来「クリックで正円→バナナ型へ変形」
//     させたい場合、この2つをBANANA_TARGET_BEND/BANANA_TARGET_HEIGHT_WOBBLEへ向けて
//     gsapなどで補間し、毎フレームrebuildOrbitCurve()する実装が必要になります
//     (仕組み自体はshrinkOrbitOnBananaClickで既に用意済みなので流用できます)。
//   - SOLAR_SYSTEM_SCALE: 太陽・惑星本体の大きさと、惑星ごとの太陽からの距離をまとめて
//     半分にしている倍率。ORBIT_RADIUS_BASE(主軌道)には掛かっていない点に注意。
//   - SUN_ORBIT_PERIOD: 太陽が軌道を1周する速さ。TRAIL_RECORD_INTERVALにも影響する。
//   - TRAIL_MAX_POINTS / TRAIL_COLOR: 軌跡の保持点数(=見える長さ)・色。8惑星のtrailLinesと
//     太陽自身のsunTrailの両方がこの色・点数を共有している。
//   - PLANETS: 各惑星の色・速度は仮値(速度が速いほど、軌跡のらせんの巻き数が増える)。
//   - バナナ本体の見た目(既存banana.jsの資産を流用するかどうか)は、今はgalaxy.js側の
//     makeBananaMesh()を参照してください。
//   - (見送り) 惑星自身の公転軌道の形を太陽のorbitCurve(将来のバナナ変形含む)に合わせる件:
//     現状はpivotの単純な円運動なので、各惑星ごとにカーブを持たせて補間する実装に
//     組み替える必要があり複雑になるため未着手。必要になったら別途相談してください。
