import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { AUDITORIUM_CAMERA_DIR, AUDITORIUM_CAMERA_DISTANCE } from './config.js';
import { makeSpikeAxisMesh } from './axes.js'; // tripodの3軸と同じ描き方(元の矢印の見た目)
import { createField, integrate, launchVelocity } from './twoBody.js';

// ══════════════════════════════════════════════════════════════
// ── fairyTale.js: 巨大バナナ+冠(星)を投げる遊び(three.js側) ───────────
// ══════════════════════════════════════════════════════════════
//   物理(二体問題)は twoBody.js が担当し、ここは「見た目・操作・状態遷移」だけを持つ。
//
//   ・水面=銀河(galaxy.js)の面。場(重力が及ぶ範囲)の半径=銀河半径R。巨大バナナは水面と同じ高さに半分浸かって、上下に揺れる。
//   ・場の座標: x=カメラの右、y=カメラから遠ざかる向き(水平)。原点=バナナ。
//   ・冠は開始位置に出る。開始位置は「開始カメラで画面下寄り(startScreenY)の水面」から逆算する(手前側)。
//     冠をドラッグして離すと、引いた向きと逆へ投擲される(slingshot=trueのキュー式。falseにするとダイレクト式)。
//     引っ張り中は、冠の後ろ(引いた側)にキュースティック(短い棒)を出す。見た目は元の矢印(tripodの3軸と同じmakeSpikeAxisMesh)で、先端が冠を向く。
//   ・二体の位置が重なったら(または画面下端に触れたら)戴冠成功 → onCoronation(mode)。mode='banana'|'edge'。
//     呼び出し側(main.js)がカメラ演出を行い、終わったら finish() を呼ぶ。
//   ・戴冠に成功する前にスクロールしたら「失敗」: abort() でバナナ・冠を消し、main.jsが俯瞰モードへ入る。
//   ・バナナの見え方:
//       - ドラッグ量(signedMix。0=開始位置)が -0.15 より左(遠景の望遠側)へ行くほど沈んで薄れ、CAROUSELが現れる。
//       - カメラがバナナの内側へ入る(右ドラッグの端)と沈む。
//       - 戴冠成功(冠が重なる)後は、冠をバナナの上に座らせ、バナナごとゆっくり沈めて消す(MERGE_HOLD_SEC+SINK_SEC)。沈みきったらonSunk→main.jsがバルジへ切り替える。
//       - 戴冠に失敗(重ならずに通り過ぎる)してもバナナはそのまま。冠は軌道を回り続け、ほぼ無限遠(ESCAPE_RESET_RATIO×R)まで行ったときだけ開始位置へ戻す。
//   ・バナナ(goldbanana.glb)・冠(crown.glb)はrecord.jsと同じパスで読み込む。読み込めるまで(失敗時はそのまま)単色の球で代用。
//     サイズは「バウンディング球の半径」を目標半径に合わせるだけの仮の合わせ方(向き・大きさは後で調整)。
//
//   state: 'idle'(非表示) → 'aim' → 'fly' → ('capture' →) 'crowning' → 'done'
//   外から見る: state / busy(capture・crowning中=スクロール・ドラッグを受け付けない)
// ══════════════════════════════════════════════════════════════

const UP = new THREE.Vector3(0, 1, 0);
const BANANA_BOB_RATIO = 0.04;        // 揺れの振幅(バナナ半径比)
const SINK_DEPTH_RATIO = 0.8;         // 沈みきったときの深さ(バナナ半径比)。以前は1.6(半分にした)
const FADE_END_RATIO = 0.55;          // 戴冠後の沈みの進行度(0〜1)がこの値に達した時点で、バナナ・冠は完全に透明になる(以前は1.0=沈みきるまで薄れた)
const FAILED_BANANA_SCALE = 2.0;      // 戴冠に失敗して残ったバナナの大きさ倍率(穴が2倍になるのに合わせる)
const CROWN_MERGE_SCALE = 2.0;        // 戴冠(合体)したときの冠の大きさ倍率。投げている間は1倍(邪魔にならない)。1にすると従来どおり
const SIM_SPEED = 3;                  // 物理時間の倍速(実時間1秒=物理3秒。元の演出と同じ)
const CAPTURE_GLIDE_SEC = 0.5;        // 重なり許容内の残りを中心へ寄せる演出(物理ではない)
const MERGE_GROW_SEC = 2.0;           // 合体後、冠がバナナの上の座(CROWN_SEAT_RATIO)へ上がる時間
const MERGE_HOLD_SEC = 1.5;           // 冠が座に着いてから、沈み始めるまでの間
const SINK_SEC = 8;                   // 戴冠成功後、バナナと冠がゆっくり沈みきるまでの時間(以前は約1秒)
const EDGE_GLIDE_SEC = 2.0;           // 冠が画面下端に触れて戴冠になったとき、バナナへ寄っていく時間
const CROWN_SEAT_RATIO = 0.6;         // 戴冠位置(未決定・仮値): 冠の中心の高さ = バナナ中心から バナナ半径×この値 上
const ESCAPE_RESET_RATIO = 30;        // 冠が場の中心からR×この値より遠く(=ほぼ無限遠)へ行ったら開始位置へ戻す。それまでは軌道を回り続ける
// record.jsと同じ置き場所・同じ解決方法(import.meta.url基準)
const BANANA_GLB_PATH = new URL('../assets/obj/goldbanana.glb', import.meta.url).href;
const CROWN_GLB_PATH = new URL('../assets/obj/crown.glb', import.meta.url).href; // goldbanana.glbと同じ置き場所・同じ解決方法
const BANANA_TILT = [0.3, 0.5, 0];    // record.jsのmakeBananaMeshと同じ傾き
const CUE_LENGTH_RC = 9;              // キューの長さ(冠の半径比)。引っ張っても長さは変わらず、後ろへずれる
const CUE_GAP_RC = 1.4;               // 冠の中心からキューの先端までの最小の隙間(冠の半径比)
const TRAIL_TTL = 6;                  // 軌跡のきらめきが消えるまでの秒数
const WATER_TRAIL_SAMPLES = 48;       // galaxy.jsの水面シェーダーが受け取る軌跡の点数(GALAXY_WATER_TRAIL_COUNTと同じ)

const gltfLoader = new GLTFLoader();

// wrap(半径1に正規化した入れ物)にGLBを入れる。wrap.scale=見かけの半径、になるよう、モデルを中心合わせ+バウンディング球半径=1に正規化する。
function attachModel(wrap, placeholder, path, { tilt, onReady } = {}) {
  gltfLoader.load(path, (gltf) => {
    const model = gltf.scene;
    const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(new THREE.Sphere());
    model.position.sub(sphere.center);
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.frustumCulled = false;
      o.material = Array.isArray(o.material) ? o.material.map((m) => m.clone()) : o.material.clone(); // 不透明度を個別に動かすため
      // GLB側の材質が半透明・透過(transmission)・深度書き込みなしになっていると、星(加算合成)が透けて見える。
      //   実体として描く(深度を書く・透過しない・アルファ無効)ように揃える。フェード中の透明化はsetOpacityが担当する。
      (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
        m.transparent = false; m.depthWrite = true; m.depthTest = true; m.alphaTest = 0;
        if ('transmission' in m) m.transmission = 0;
      });
      o.renderOrder = 10; // 星(加算合成)より後に描く: 深度で隠れない分も、物体が上に乗る
    });
    const holder = new THREE.Group();
    holder.add(model);
    holder.scale.setScalar(1 / Math.max(sphere.radius, 1e-6));
    if (tilt) holder.rotation.set(tilt[0], tilt[1], tilt[2]);
    wrap.add(holder);
    placeholder.visible = false;
    if (onReady) onReady(holder);
  }, undefined, (err) => console.error(`${path} の読み込みに失敗しました(単色の球で代用します)。`, err));
}

function setOpacity(obj, a) {
  obj.traverse((o) => {
    if (!o.isMesh || !o.material) return;
    (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => {
      m.transparent = a < 0.999;
      m.depthWrite = true; // フェード中も深度を書き続け、後ろの星が透けて見える範囲を最小にする
      m.opacity = a;
    });
  });
}

export function createFairyTale(scene, camera, renderer, {
  center,
  galaxyRadius,
  onCoronation,
  onSunk,                // 戴冠成功後、バナナと冠が沈みきったとき(main.jsがバルジへ切り替える)
  excludeFromBloom,
  bananaRatio = 0.125,   // 巨大バナナの半径(銀河半径比)。★ 2026-11-09: 0.5→0.25→0.125(穴の半分ほど)。未決定・仮値
  crownRatio = 0.016,    // 冠の半径(銀河半径比)。バナナとのサイズ比は戴冠中も変えない。未決定・仮値
  slingshot = true,      // true=引いた向きと逆へ飛ぶ(キュー式) / false=ドラッグした向きへ飛ぶ
  startScreenY = 0.66,   // 冠の開始位置: 開始カメラで画面上から何割の高さの水面か(大きいほど画面下=手前)
  overlapRatio = 0.03,   // 「位置が重なった」とみなす距離(場の半径比。twoBody.js参照)
}) {
  const R = galaxyRadius;
  const field = createField(R, overlapRatio);
  const K = field.K;
  const RB = R * bananaRatio;   // バナナ(見た目)の半径
  const RC = R * crownRatio;    // 冠(見た目)の半径。開始位置はカメラのすぐ手前になるので、大きいと画面を覆う
  const CROWN_Z = RC * 0.4;     // 冠の中心の高さ(水面すれすれ。カメラの高さ約44に対して低く保つと、画面の下寄りに見える)
  const A = { x: 0, y: -0.9 * R }; // 冠の開始位置(start()で画面位置から計算し直す)

  // 場の座標 → ワールド。カメラ方位(AUDITORIUM_CAMERA_DIR)から右・奥の水平基底を作る。
  const fwd = new THREE.Vector3(-AUDITORIUM_CAMERA_DIR.x, 0, -AUDITORIUM_CAMERA_DIR.z).normalize();
  const right = new THREE.Vector3().crossVectors(fwd, UP).normalize();
  const toWorld = (x, y, z = 0, out = new THREE.Vector3()) =>
    out.copy(center).addScaledVector(right, x).addScaledVector(fwd, y).addScaledVector(UP, z);

  // ── オブジェクト ──
  const root = new THREE.Group();
  root.visible = false;
  scene.add(root);

  // バナナ: wrap.scale=半径。球は読み込み完了までの代用。
  const bananaWrap = new THREE.Group();
  const bananaBall = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0 }));
  bananaBall.frustumCulled = false;
  bananaWrap.add(bananaBall);
  bananaWrap.scale.setScalar(RB);
  root.add(bananaWrap);
  attachModel(bananaWrap, bananaBall, BANANA_GLB_PATH, { tilt: BANANA_TILT, onReady: (h) => { if (excludeFromBloom) excludeFromBloom(h); } });

  // 冠
  const crownWrap = new THREE.Group();
  const crownBall = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), new THREE.MeshBasicMaterial({ color: 0xbfefff, transparent: true, opacity: 0 }));
  crownBall.frustumCulled = false;
  crownWrap.add(crownBall);
  crownWrap.scale.setScalar(RC);
  root.add(crownWrap);
  attachModel(crownWrap, crownBall, CROWN_GLB_PATH, { onReady: (h) => { if (excludeFromBloom) excludeFromBloom(h); } });

  // 冠のクリック判定用(見えない大きめの球)
  const hitMesh = new THREE.Mesh(new THREE.SphereGeometry(1, 12, 8), new THREE.MeshBasicMaterial({ visible: false }));
  hitMesh.scale.setScalar(RC * 2.2);
  root.add(hitMesh);

  function makeLine(maxPoints, color, opacity, loop = false) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPoints * 3), 3));
    geo.setDrawRange(0, 0);
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false });
    const line = loop ? new THREE.LineLoop(geo, mat) : new THREE.Line(geo, mat);
    line.frustumCulled = false;
    root.add(line);
    return line;
  }
  const MAX_TRAIL = 3000;
  // キュースティック: 見た目は元の矢印(tripodの3軸と同じ makeSpikeAxisMesh)。引っ張り中だけ作り直す。
  //   位置・長さは直前の仕様のまま: 先端は冠から(隙間+引っ張り量)、長さは冠の半径の9倍で一定。先端が冠を向く。
  let arrowMesh = null;
  function clearArrow() {
    if (!arrowMesh) return;
    root.remove(arrowMesh);
    if (arrowMesh.geometry) arrowMesh.geometry.dispose();
    if (arrowMesh.material) arrowMesh.material.dispose();
    arrowMesh = null;
  }
  // from=冠の中心(ワールド)、back=冠から見て「引いた側」の単位ベクトル(ワールド)、pull=引っ張り量(ワールド)
  function setCue(from, back, pull) {
    clearArrow();
    const tipDist = CUE_GAP_RC * RC + pull;
    const tip = from.clone().addScaledVector(back, tipDist);                          // 冠側の先端
    const butt = from.clone().addScaledVector(back, tipDist + CUE_LENGTH_RC * RC);    // 手元側
    arrowMesh = makeSpikeAxisMesh(butt, tip, { refDist: AUDITORIUM_CAMERA_DISTANCE });  // 元の矢印と同じ作り方(refDistは軸と同じ)
    arrowMesh.frustumCulled = false;
    if (arrowMesh.material) arrowMesh.material.opacity = 1;
    root.add(arrowMesh);
  }

  if (excludeFromBloom) excludeFromBloom(root);

  // ── 状態 ──
  let state = 'idle';
  let weight = 0;           // バナナ世界の出方(0〜1)。ドラッグ量から決める
  let crown = null;         // {x,y,vx,vy,t}
  let trail = [];
  let drag = false;
  let mouse = { x: 0, y: 0 };
  let sink = 0;             // バナナの沈み具合(0〜1)
  let merged = false;
  let mergeT = 0;
  let glide = null;         // {x,y,u}
  let glideSec = CAPTURE_GLIDE_SEC;
  let glideMode = 'banana'; // 'banana'(重なった) | 'edge'(画面下端に触れた)
  let sunkFired = false;
  let failScale = 0;        // 失敗後にバナナが大きくなる進行度(0→1)
  let failShow = 1, failShowTarget = 1; // 失敗後のバナナ・冠の表示度合い(main.jsが俯瞰の仰角8°条件で目標を決め、なめらかに追従)
  let failed = false;       // 戴冠前にスクロールした(失敗)。バナナは消さず、冠は戴冠判定なしで軌道を回り続ける
  const failField = { ...field, tol: 0 }; // 失敗後は「位置が重なった」判定を無効にする(中心を通り抜けても戴冠にならない)
  const tmp = new THREE.Vector3();
  const raycaster = new THREE.Raycaster();

  // 開始位置: 開始カメラで「画面の下からstartScreenYの高さ」にある水面の点(画面中央の縦線上)。
  //   低仰角では手前の水面が画面下に強く圧縮されるため、場の座標の固定値ではなく画面位置から決める。
  function placeStartFromScreen() {
    camera.updateMatrixWorld(true); // 開始カメラをセットした直後(まだ描画されていない)でも、最新の位置・向き・fovで計算する
    camera.updateProjectionMatrix();
    raycaster.setFromCamera(new THREE.Vector2(0, 1 - 2 * startScreenY), camera);
    const hit = raycaster.ray.intersectPlane(new THREE.Plane(UP, -(center.y + CROWN_Z)), new THREE.Vector3());
    if (!hit) return;
    A.x = 0;
    A.y = THREE.MathUtils.clamp(hit.sub(center).dot(fwd), -0.95 * R, 0.95 * R);
  }

  // ── 入力 ──
  // 画面→場の平面座標。低仰角では奥行き方向がほとんど潰れるため、開始位置まわりで線形化し、
  // 奥行き方向の感度に下限(横の1/4)を設ける。
  function pointerToField(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    const proj = (x, y) => {
      const v = toWorld(x, y, CROWN_Z, tmp).project(camera);
      return { x: (v.x * 0.5 + 0.5) * rect.width + rect.left, y: (-v.y * 0.5 + 0.5) * rect.height + rect.top };
    };
    const o = proj(A.x, A.y), ox = proj(A.x + K, A.y), oy = proj(A.x, A.y + K);
    const sxu = Math.max(Math.abs(ox.x - o.x) / K, 1e-9);
    const syu = Math.max(Math.abs(oy.y - o.y) / K, 0.25 * sxu);
    const sg = oy.y < o.y ? 1 : -1; // +yが画面上向きなら1
    return { x: A.x + (e.clientX - o.x) / sxu, y: A.y - sg * (e.clientY - o.y) / syu };
  }

  const dom = renderer.domElement;
  dom.addEventListener('pointerdown', (e) => {
    if (failed || state !== 'aim' || weight < 0.9 || e.buttons !== 1 || e.shiftKey) return; // 左ボタン単独のみ(Shift/両ボタンはカメラドラッグ)
    const rect = dom.getBoundingClientRect();
    raycaster.setFromCamera(new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera);
    if (!raycaster.intersectObject(hitMesh)[0]) return;
    drag = true;
    mouse = pointerToField(e);
    dom.setPointerCapture(e.pointerId);
    e.stopPropagation();
  }, true);
  dom.addEventListener('pointermove', (e) => { if (drag) mouse = pointerToField(e); });
  const release = () => {
    if (!drag) return;
    drag = false;
    clearArrow();
    const v = launchVelocity(A, mouse, field, { slingshot });
    if (v.l < 0.3 * K) return; // 引っ張りが小さければ投げない
    crown = { x: A.x, y: A.y, vx: v.vx, vy: v.vy, t: 0 };
    trail = [{ x: A.x, y: A.y, born: performance.now() / 1000 }];
    state = 'fly';
  };
  dom.addEventListener('pointerup', release);
  dom.addEventListener('pointercancel', release);

  // ── 状態遷移 ──
  function pushTrail() {
    const l = trail[trail.length - 1];
    if (!l || Math.hypot(crown.x - l.x, crown.y - l.y) > 0.2 * K) {
      trail.push({ x: crown.x, y: crown.y, born: performance.now() / 1000 }); // bornはきらめきの寿命(水面シェーダー)用
      if (trail.length > MAX_TRAIL) trail.shift();
    }
  }
  function coronate(mode) {
    state = 'crowning';
    if (onCoronation) onCoronation(mode);
  }
  function resetCrown() { crown = null; trail = []; state = 'aim'; }

  // ── 毎フレーム ──
  // signedMix: main.jsのprojectionMixValue(-1=遠景の望遠 / 0=開始位置 / +1=銀河の内側)
  function update(deltaSeconds, signedMix) {
    if (state === 'idle') return;
    const dt = Math.min(deltaSeconds, 0.05);
    if (failed) weight = 1; // 失敗後は俯瞰カメラが遠くへ引いてもバナナ・冠を消さない
    else if (state !== 'done') weight = THREE.MathUtils.clamp((signedMix + 0.49) / 0.34, 0, 1);

    if (state === 'fly') {
      const overlapped = integrate(crown, dt * SIM_SPEED, failed ? failField : field, pushTrail);
      if (overlapped && !failed) { glide = { x: crown.x, y: crown.y, u: 0 }; glideSec = CAPTURE_GLIDE_SEC; glideMode = 'banana'; state = 'capture'; }
      else if (Math.hypot(crown.x, crown.y) > R * ESCAPE_RESET_RATIO) resetCrown(); // ほぼ無限遠まで離れたときだけ開始位置へ戻す(それまでは軌道を回り続ける)
      else {
        // 冠の中心が画面下端に触れたら戴冠(失敗にならず成功扱い)
        const v = toWorld(crown.x, crown.y, CROWN_Z, tmp).project(camera);
        const sy = (-v.y * 0.5 + 0.5) * dom.clientHeight;
        if (!failed && v.z < 1 && sy >= dom.clientHeight - 3) { glide = { x: crown.x, y: crown.y, u: 0 }; glideSec = EDGE_GLIDE_SEC; glideMode = 'edge'; state = 'capture'; } // 画面下端でも、冠をバナナへ寄せてから戴冠(沈む演出を共通にするため)
      }
    } else if (state === 'capture') {
      glide.u = Math.min(1, glide.u + dt / glideSec);
      const e = glide.u * glide.u * (3 - 2 * glide.u);
      crown.x = glide.x * (1 - e); crown.y = glide.y * (1 - e);
      pushTrail();
      if (glide.u >= 1) { crown.x = 0; crown.y = 0; merged = true; mergeT = 0; coronate(glideMode); }
    }
    if (merged) {
      mergeT += dt;
      if (!sunkFired && mergeT >= MERGE_HOLD_SEC + SINK_SEC) { sunkFired = true; if (onSunk) onSunk(); } // 沈みきった
    }

    draw(dt, performance.now() / 1000);
  }

  function draw(dt, t) {
    // バナナの沈み: カメラが内側へ入ったとき(ふつうの沈み)と、戴冠成功後(sinkMerge: ゆっくり沈めて消す)
    const camDist = camera.position.distanceTo(center);
    const target = THREE.MathUtils.clamp((RB * 1.5 - camDist) / (RB * 0.8), 0, 1);
    sink += (target - sink) * Math.min(1, dt * 3);
    const sm = merged ? THREE.MathUtils.clamp((mergeT - MERGE_HOLD_SEC) / SINK_SEC, 0, 1) : 0;
    const sinkMerge = sm * sm * (3 - 2 * sm);
    const sinkNow = Math.max(sink, sinkMerge);
    const fm = THREE.MathUtils.clamp(sm / FADE_END_RATIO, 0, 1);
    const fadeMerge = fm * fm * (3 - 2 * fm); // 透明化は沈みより早く終わる

    const bob = Math.sin(t * 1.7);
    if (failed) {
      failShow += (failShowTarget - failShow) * Math.min(1, dt * 4);
      failScale += (1 - failScale) * Math.min(1, dt * 1.5);
    }
    bananaWrap.scale.setScalar(RB * (1 + failScale * (FAILED_BANANA_SCALE - 1)));
    const failMul = failed ? failShow : 1;
    const bananaOpacity = failMul * weight * (merged ? 1 - fadeMerge : 1 - sink * 0.85); // 戴冠成功後は完全に消えるまで薄れる
    bananaWrap.visible = bananaOpacity > 0.01;                                  // 合体してもバナナは見えたまま(冠だけが巨大化する現象は廃止)
    if (bananaWrap.visible) setOpacity(bananaWrap, bananaOpacity);
    const bananaZ = BANANA_BOB_RATIO * RB * bob - sinkNow * RB * SINK_DEPTH_RATIO;
    toWorld(0, 0, bananaZ, bananaWrap.position);

    const c = crown || A;
    const mk = merged ? Math.min(1, mergeT / MERGE_GROW_SEC) : 0;
    const mkE = mk * mk * (3 - 2 * mk);
    // 冠の高さ: 合体後はバナナの上の座(バナナと一緒に揺れて沈む)へ上がる。大きさは変えない(RC固定=バナナとの比率を保つ)。
    const crownZ = merged
      ? THREE.MathUtils.lerp(CROWN_Z, bananaZ + CROWN_SEAT_RATIO * RB, mkE)
      : CROWN_Z + (state === 'aim' ? 0.2 * RC * Math.sin(t * 2) : 0);
    toWorld(c.x, c.y, crownZ, crownWrap.position);
    crownWrap.scale.setScalar(RC * THREE.MathUtils.lerp(1, CROWN_MERGE_SCALE, mkE)); // 戴冠で冠が大きくなる(座に上がる動きと同時)
    if (state === 'aim' || state === 'fly') crownWrap.rotation.y += dt * 1.5; // ゆっくり自転
    else if (merged) crownWrap.rotation.y += dt * 0.6;
    hitMesh.position.copy(crownWrap.position);
    const crownOpacity = failMul * Math.min(1, weight * 1.5) * (merged ? 1 - fadeMerge : 1);
    crownWrap.visible = weight > 0.02 && crownOpacity > 0.01;
    if (crownWrap.visible) setOpacity(crownWrap, crownOpacity);

    // キュースティック(引っ張り中): 冠の後ろ(投擲方向の逆側)に細い棒。引っ張り量に応じて冠から離れる。
    if (drag && state === 'aim') {
      const v = launchVelocity(A, mouse, field, { slingshot });
      const sp = Math.hypot(v.vx, v.vy) || 1;
      const ux = v.vx / sp, uy = v.vy / sp; // 投擲方向(場の座標)
      const from = toWorld(A.x, A.y, CROWN_Z, new THREE.Vector3());
      const back = toWorld(A.x - ux, A.y - uy, CROWN_Z, new THREE.Vector3()).sub(from).normalize();
      setCue(from, back, v.l);
    } else if (arrowMesh) clearArrow();
    root.visible = true;
  }

  return {
    update,
    get state() { return state; },
    get busy() { return state === 'capture' || state === 'crowning'; },
    // 水面シェーダー(galaxy.js)に渡す場の基底(中心・右・奥)。軌跡の座標はこの基底の(x,y)。
    getBasis() { return { center, right, fwd }; },
    get trailRadius() { return K * 0.6; }, // 軌跡のきらめきの幅(ワールド単位)
    // 冠の軌跡を、水面シェーダー用のVector4配列(x,y=場の座標 / z=きらめきの強さ0〜1)へ書き込む。毎フレーム呼ぶ。
    //   新しい点ほど強く、TRAIL_TTL秒かけて消える。点は距離でまびいて最大WATER_TRAIL_SAMPLES個。
    sampleTrail(out) {
      const now = performance.now() / 1000;
      let n = 0, acc = 0, last = null;
      const spacing = K * 0.4;
      for (let i = trail.length - 1; i >= 0 && n < Math.min(out.length, WATER_TRAIL_SAMPLES); i--) {
        const p = trail[i], age = now - p.born;
        if (age > TRAIL_TTL) break;
        if (last) acc += Math.hypot(p.x - last.x, p.y - last.y);
        if (!last || acc >= spacing) {
          out[n++].set(p.x, p.y, Math.pow(1 - age / TRAIL_TTL, 1.5), 0);
          acc = 0; last = p;
        }
      }
      for (; n < out.length; n++) out[n].set(0, 0, 0, 0);
    },
    start() { if (state === 'idle') { placeStartFromScreen(); state = 'aim'; root.visible = true; } },
    // 戴冠に成功する前にスクロールされた(失敗)。バナナ・冠を消す。
    //   バナナ・冠は消さない。引っ張り中ならキューだけ片付け、飛んでいる冠はそのまま回り続ける(以後は投げ直せない)。
    abort() { if (state === 'aim' || state === 'fly') { failed = true; failShowTarget = 0; drag = false; clearArrow(); } },
    // 失敗後のバナナ・冠を見せるか(main.jsが俯瞰の仰角で決める: 8°以上=バルジ側で見せる / 未満=carousel側で隠す)。失敗前は何もしない。
    setFailedVisible(v) { failShowTarget = v ? 1 : 0; },
    get failed() { return failed; },
    // 戴冠後のカメラ演出が終わった(main.jsから呼ぶ)。合体した冠(+沈んだバナナ)はそのまま残る。
    finish() { state = 'done'; },
  };
}

export function updateFairyTale(game, deltaSeconds, signedMix) {
  game.update(deltaSeconds, signedMix);
}