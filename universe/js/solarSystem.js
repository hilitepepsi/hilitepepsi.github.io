import * as THREE from 'three';
import { TRIPOD_RADIUS, RECORD_ANCHOR } from './universe.js';

// ══════════════════════════════════════════════════════════════
// ── 太陽系: 太陽が水平な正円軌道を周回し、8惑星がその周りを公転する ──
// ══════════════════════════════════════════════════════════════
//
// 階層:
//   group
//     ├─ sunGroup ── 軌道上を移動。向きは「公転面が軌道面に対してPLANET_PLANE_TILT傾く」ように回す
//     │     ├─ sunMesh
//     │     └─ planetPivot[i](ローカルY軸回りに回転)→ 惑星メッシュ(軌道半径ぶん離れている)
//     └─ trail ── 太陽の軌道線。太陽が通った所から1周目だけ伸びていき、以後は固定表示
//
// 惑星の公転面の法線が太陽の進行方向に追従して回るため、惑星の世界座標上の軌跡は
// 主軌道に巻きつく「らせん」になる(惑星の軌跡線は描かない)。
//
// 使い方:
//   createSolarSystem(scene)           ... 1回だけ。まだ非表示
//   startSolarSystem(solarSystem, c)   ... 召喚の瞬間に1回。表示開始+軌道線の描画開始
//   updateSolarSystem(solarSystem, t)  ... 毎フレーム(tは経過秒)

// クリックで遷移する個人ページ(今後作る「月」オブジェクト側からimportする想定)
export const PERSONAL_PAGE_URL = 'https://example.com/moon-base'; // ← 実際のURLが決まったら差し替え

// 主軌道の既定の中心(universe.jsのRECORD_ANCHOR)。startSolarSystemに中心を渡さなかった場合に使う。
export const ORBIT_CENTER = RECORD_ANCHOR.clone();

// 主軌道の半径(仮値)。record.js側が拡大リングやバルジのサイズの基準にも使っている。
export const ORBIT_RADIUS_BASE = TRIPOD_RADIUS * 72;

// 太陽が主軌道を1周する秒数(仮値)。軌道線を描き切る時間でもあり、
// main.js側がtripodの自転速度を揃えるのにも使う。
export const SUN_ORBIT_PERIOD = 120;

// 惑星の公転面が主軌道面に対して傾く角度(実際の黄道面と天の川銀河の円盤面の角度)
const PLANET_PLANE_TILT = THREE.MathUtils.degToRad(60);
const TILT_COS = Math.cos(PLANET_PLANE_TILT);
const TILT_SIN = Math.sin(PLANET_PLANE_TILT);

// 太陽・惑星本体の大きさと、惑星の太陽からの距離にかかる倍率(主軌道には掛けない)
const SOLAR_SYSTEM_SCALE = 0.5;

const SUN_RADIUS = 0.9 * SOLAR_SYSTEM_SCALE;
const SUN_COLOR = 0xffcc55;

// 軌道線: 色・透明度・1周を何分割して描くか。
// (WebGLのLineは太さ1px固定なので、細く見せるために半透明にしている)
const ORBIT_LINE_COLOR = 0xffee66;
const ORBIT_LINE_OPACITY = 0.45;
const ORBIT_LINE_SEGMENTS = 360;

// 惑星の角速度の倍率。大きいほど主軌道1周あたりのらせんの巻き数が増える。
// (主軌道の周期SUN_ORBIT_PERIODとは独立)
const ANGULAR_SPEED_SCALE = 6;

// radius/orbitにSOLAR_SYSTEM_SCALEを掛けて使う。speedは相対的な角速度。
const PLANETS = [
  { radius: 0.12, orbit: 1.4, speed: 4.1,  color: 0xb1b1b1 }, // Mercury
  { radius: 0.18, orbit: 1.9, speed: 3.0,  color: 0xe0c16c }, // Venus
  { radius: 0.19, orbit: 2.5, speed: 2.4,  color: 0x5b9bd5 }, // Earth
  { radius: 0.15, orbit: 3.1, speed: 1.9,  color: 0xc1440e }, // Mars
  { radius: 0.42, orbit: 4.1, speed: 1.1,  color: 0xd9a066 }, // Jupiter
  { radius: 0.36, orbit: 5.0, speed: 0.85, color: 0xe3c98f }, // Saturn
  { radius: 0.28, orbit: 5.8, speed: 0.6,  color: 0x9fe0e0 }, // Uranus
  { radius: 0.27, orbit: 6.5, speed: 0.47, color: 0x5b6ee1 }, // Neptune
];

// ── 軌道上の位置・向き ────────────────────────────────
// 軌道は水平な正円。t(0〜1)は1周の進み具合で、tに比例して等速に進む。
const _UP = new THREE.Vector3(0, 1, 0);
const _normal = new THREE.Vector3();

function orbitPoint(center, t, out) {
  const a = t * Math.PI * 2;
  return out.set(
    center.x + ORBIT_RADIUS_BASE * Math.cos(a),
    center.y,
    center.z + ORBIT_RADIUS_BASE * Math.sin(a)
  );
}

// 公転面の法線 = 「真上」を進行方向(水平な接線)へPLANET_PLANE_TILTだけ倒した向き。
// その法線へ、太陽グループのローカルY軸が向くように回す。
function orbitQuaternion(t, out) {
  const a = t * Math.PI * 2;
  _normal.set(-Math.sin(a) * TILT_SIN, TILT_COS, Math.cos(a) * TILT_SIN);
  return out.setFromUnitVectors(_UP, _normal);
}

// ── 構築 ────────────────────────────────────────
function makeSun() {
  return new THREE.Mesh(
    new THREE.SphereGeometry(SUN_RADIUS, 24, 24),
    new THREE.MeshBasicMaterial({ color: SUN_COLOR })
  );
}

function makePlanetPivots(sunGroup) {
  return PLANETS.map((p) => {
    const pivot = new THREE.Group();
    const mesh = new THREE.Mesh(
      new THREE.SphereGeometry(p.radius * SOLAR_SYSTEM_SCALE, 14, 14),
      new THREE.MeshBasicMaterial({ color: p.color })
    );
    mesh.position.set(p.orbit * SOLAR_SYSTEM_SCALE, 0, 0);
    pivot.add(mesh);
    pivot.userData.angularSpeed = p.speed * ANGULAR_SPEED_SCALE; // rad/秒
    pivot.userData.initialAngle = Math.random() * Math.PI * 2;   // 全惑星が一直線に並ばないようにばらす
    sunGroup.add(pivot);
    return pivot;
  });
}

function makeOrbitLine() {
  const positions = new Float32Array((ORBIT_LINE_SEGMENTS + 1) * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setDrawRange(0, 0); // 描画開始までは何も描かない
  const material = new THREE.LineBasicMaterial({
    color: ORBIT_LINE_COLOR, transparent: true, opacity: ORBIT_LINE_OPACITY,
  });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false; // 頂点は描画開始時に書き込むので、初期状態の境界球で判定させない
  return { line, geometry, positions, drawnPoints: 0 };
}

export function createSolarSystem(scene) {
  const group = new THREE.Group();
  group.visible = false; // startSolarSystemで表示する
  scene.add(group);

  const sunGroup = new THREE.Group();
  const sunMesh = makeSun();
  sunGroup.add(sunMesh);
  group.add(sunGroup);
  const planetPivots = makePlanetPivots(sunGroup);

  const orbitLine = makeOrbitLine();
  group.add(orbitLine.line);

  return {
    group, sunGroup, sunMesh, planetPivots, orbitLine,
    center: ORBIT_CENTER.clone(),
    started: false,
    startTime: null, // 最初のupdateで確定する(軌道線の描画開始時刻)
  };
}

// 太陽系を召喚する(1回だけ有効)。centerは主軌道の中心。
export function startSolarSystem(solarSystem, center = ORBIT_CENTER) {
  if (solarSystem.started) return;
  solarSystem.started = true;
  solarSystem.center.copy(center);
  solarSystem.group.visible = true;
}

// 軌道線の頂点を「今の太陽の位置」から1周ぶん書き込む。
// 以後は軌道が変わらないので、この1回だけでよい(描画範囲を伸ばすだけで線が描かれていく)。
function fillOrbitLine(solarSystem, elapsedSeconds) {
  const { positions, geometry } = solarSystem.orbitLine;
  const t0 = (elapsedSeconds / SUN_ORBIT_PERIOD) % 1;
  const p = new THREE.Vector3();
  for (let i = 0; i <= ORBIT_LINE_SEGMENTS; i++) {
    orbitPoint(solarSystem.center, (t0 + i / ORBIT_LINE_SEGMENTS) % 1, p);
    p.toArray(positions, i * 3);
  }
  geometry.attributes.position.needsUpdate = true;
}

// ── 毎フレーム ──────────────────────────────────
const _pos = new THREE.Vector3();
const _quat = new THREE.Quaternion();

export function updateSolarSystem(solarSystem, elapsedSeconds) {
  if (!solarSystem.started) return;

  if (solarSystem.startTime === null) {
    solarSystem.startTime = elapsedSeconds;
    fillOrbitLine(solarSystem, elapsedSeconds);
  }

  // 太陽: 軌道上の位置と、らせんを作る向き
  const t = (elapsedSeconds / SUN_ORBIT_PERIOD) % 1;
  solarSystem.sunGroup.position.copy(orbitPoint(solarSystem.center, t, _pos));
  solarSystem.sunGroup.quaternion.copy(orbitQuaternion(t, _quat));

  // 惑星: 経過時間から直接角度を決める(フレームレート非依存)
  solarSystem.planetPivots.forEach((pivot) => {
    pivot.rotation.y = pivot.userData.initialAngle + pivot.userData.angularSpeed * elapsedSeconds;
  });

  // 軌道線: 太陽が1周するまで、通った分だけ描画範囲を伸ばす。1周後は全周が固定表示。
  const progress = Math.min((elapsedSeconds - solarSystem.startTime) / SUN_ORBIT_PERIOD, 1);
  const points = Math.floor(progress * ORBIT_LINE_SEGMENTS) + 1;
  const orbitLine = solarSystem.orbitLine;
  if (points !== orbitLine.drawnPoints) {
    orbitLine.geometry.setDrawRange(0, points);
    orbitLine.drawnPoints = points;
  }
}
