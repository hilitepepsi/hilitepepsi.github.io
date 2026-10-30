import * as THREE from 'three';
import { AXIS_LENGTH } from './config.js';
import { setGlowEnds } from './axes.js';

// ── 原点でのバースト演出(クリック直後、Ĥが登場する前に一度だけ再生) ──────
//
// 2段構成:
//   1) 流れ星(1本)。画面右上の奥から原点へ向かって走る。光る粒とスターダストの
//      尾を持つ(aStar.js と同じ作り)。原点に着弾した瞬間が、次の段(リング)の開始合図になる。
//   2) 「(AXIS_LENGTH,0,0)(0,AXIS_LENGTH,0)(0,0,AXIS_LENGTH)の3点を通る円
//      (=正三角形の外接円)」のサイズ・向き・重心を基準に、
//      a) 軸上(ラッパのイメージ): 対称位相(π差)の呼吸リング(sin波で
//         膨張・収縮する2本の線)が、原点→重心を素早く小刻みに振動しながら
//         伝っていく。振幅は現れた直後は小さく、次第に大きく育っていく。
//         対の片方は軸方向に少しオフセットして、奥行きを持たせている。
//      b) 重心に到達したら、そこでバトンタッチして、三軸それぞれの終点
//         (GROUND_VERTEX_A/B/C)を波源に、正弦波の波紋(=一定間隔で並ぶ
//         複数の同心円)が、半径0からじわっと広がっていく。3つの波源の
//         波が重なるところは加算合成でより明るくなり、干渉して見える。
//      これを1組だけ再生する。
//
// リングの色は、色相(hue)は固定(標準的な青)、明度(lightness)や
// 不透明度だけで明るさ・残像を表現する。
//
// 終わったらシーンから自分で片付ける(=呼び出し側は onComplete を待って
// 次の演出に進むだけでよい)。

const ORIGIN = new THREE.Vector3(0, 0, 0);

// ── 色(共通): 標準的な青のhue固定、明度だけenvelopeで動かす ──────────
const BEAM_HUE = 0.61;        // 標準的な青
const BEAM_SATURATION = 1.0;
const BEAM_LIGHTNESS_MIN = 0.12; // 暗い側
const BEAM_LIGHTNESS_MAX = 0.48; // 明るい側(白飛びを抑えて青みを残す)

// ── 1) 流れ星(1本。画面右上の奥 → 原点) ────────────────────────────
// aStar.js と同じ作り: 光る粒(ハロ)1つ + 動いた距離に比例して出る「スターダスト」の尾。
// スタート位置は毎フレーム、その時点のカメラの right / up / forward から組み立てる
// (カメラが動いても、常に「画面の右上」から来る)。
const STAR_START_DISTANCE = AXIS_LENGTH * 4.0; // 原点から画面上でどれだけ離れた位置から始めるか(仮)
const STAR_START_ANGLE_DEG = 30;               // 画面右上の方向: 0=真右, 90=真上(仮)
const STAR_DEPTH_OFFSET = AXIS_LENGTH * 1.5;   // 原点より奥(カメラから遠い側)へどれだけずらすか(仮)
const STAR_TRAVEL_DURATION = 1.0;              // スタート → 原点に着くまでの時間(秒)
const STAR_OVERSHOOT = 0.02;                   // 原点を通り過ぎてさらに進む距離(スタート距離に対する割合)。着弾して見せるため
const STAR_FADE_IN_RATIO = 0.15;               // 移動時間のうち、フェードインに使う割合
const STAR_HALO_SIZE = AXIS_LENGTH * 0.09;     // 光る粒の大きさ(ワールド単位、仮)

// 尾(aStar.js の opts と同じ項目)
const STAR_DUST_MAX = 400;     // 粒の最大数
const STAR_DUST_DENSITY = 3;   // 移動距離(ワールド単位)あたりの粒数
const STAR_DUST_LIFE = 0.5;    // 粒の寿命(秒)。長いほど尾が長く残る
const STAR_DUST_SIZE = 1.0;    // 粒の基準サイズ
const STAR_DUST_SPREAD = 0.15; // 出現位置のばらつき(ワールド単位)

// 色: 白〜青白(aStar.js のオレンジにしたいときは、下の2か所を差し替える)
const STAR_HALO_CORE = 'rgba(235,245,255,1)';
const STAR_HALO_MID = 'rgba(120,170,255,0.55)';
const STAR_HALO_EDGE = 'rgba(40,100,255,0)';
const STAR_DUST_COLOR_NEW = 'vec3(0.88, 0.94, 1.0)';  // 生まれたての粒
const STAR_DUST_COLOR_OLD = 'vec3(0.30, 0.55, 1.0)';  // 消える間際の粒

function makeStarHaloTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.0, STAR_HALO_CORE);
  grad.addColorStop(0.25, STAR_HALO_MID);
  grad.addColorStop(1.0, STAR_HALO_EDGE);
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(c);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const STAR_DUST_VERT = `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mv.z);
    gl_Position = projectionMatrix * mv;
  }
`;
const STAR_DUST_FRAG = `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float soft = pow(1.0 - d, 2.0);
    vec3 col = mix(${STAR_DUST_COLOR_NEW}, ${STAR_DUST_COLOR_OLD}, 1.0 - vAlpha);
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

function createShootingStar(camera) {
  // スタート位置は「ワールド座標」ではなく「カメラ基準(右・上・奥)」で持つ。
  const a = THREE.MathUtils.degToRad(STAR_START_ANGLE_DEG);
  const offsetRight = Math.cos(a) * STAR_START_DISTANCE;
  const offsetUp = Math.sin(a) * STAR_START_DISTANCE;
  const offsetForward = STAR_DEPTH_OFFSET;

  const right = new THREE.Vector3(1, 0, 0);
  const up = new THREE.Vector3(0, 1, 0);
  const forward = new THREE.Vector3(0, 0, -1);
  function readCameraBasis() {
    if (!camera) return;
    camera.updateMatrixWorld(true);
    right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    forward.setFromMatrixColumn(camera.matrixWorld, 2).negate().normalize();
  }

  // t: 0→1 でスタート→原点。t>1 は原点を通り過ぎた先(直線を延長して計算)
  function headAt(t, out) {
    const k = 1 - t;
    return out.copy(ORIGIN)
      .addScaledVector(right, offsetRight * k)
      .addScaledVector(up, offsetUp * k)
      .addScaledVector(forward, offsetForward * k);
  }

  // group は原点・単位スケールのまま動かさない(尾の粒はワールド座標でそのまま持つ)
  const group = new THREE.Group();

  // ── 本体(光る粒) ──
  const haloMaterial = new THREE.SpriteMaterial({
    map: makeStarHaloTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    opacity: 0,
  });
  const halo = new THREE.Sprite(haloMaterial);
  halo.scale.setScalar(STAR_HALO_SIZE);
  halo.renderOrder = 999;
  group.add(halo);

  // ── 尾(スターダスト。ワールド座標のプール。aStar.js と同じ仕組み) ──
  const pos = new Float32Array(STAR_DUST_MAX * 3);
  const vel = new Float32Array(STAR_DUST_MAX * 3);
  const age = new Float32Array(STAR_DUST_MAX).fill(STAR_DUST_LIFE); // 寿命超え = 空き
  const alpha = new Float32Array(STAR_DUST_MAX);
  const psize = new Float32Array(STAR_DUST_MAX);
  const baseSize = new Float32Array(STAR_DUST_MAX);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(psize, 1));
  const dust = new THREE.Points(geo, new THREE.ShaderMaterial({
    vertexShader: STAR_DUST_VERT,
    fragmentShader: STAR_DUST_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest: false,
    blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false;
  dust.renderOrder = 998;
  group.add(dust);

  let cursor = 0;
  const prev = new THREE.Vector3();
  const cur = new THREE.Vector3();
  let hasPrev = false;
  let carry = 0; // 端数の粒を次フレームへ持ち越す

  function spawn(x, y, z) {
    const i = cursor;
    cursor = (cursor + 1) % STAR_DUST_MAX;
    pos[i * 3]     = x + (Math.random() - 0.5) * STAR_DUST_SPREAD;
    pos[i * 3 + 1] = y + (Math.random() - 0.5) * STAR_DUST_SPREAD;
    pos[i * 3 + 2] = z + (Math.random() - 0.5) * STAR_DUST_SPREAD;
    vel[i * 3]     = (Math.random() - 0.5) * 0.25; // ゆっくりランダムにふわっと漂う
    vel[i * 3 + 1] = (Math.random() - 0.5) * 0.25;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25;
    age[i] = 0;
    baseSize[i] = STAR_DUST_SIZE * (0.5 + Math.random() * 0.8);
  }

  // 毎フレーム(gsap.ticker)呼ぶ。本体が動いた距離に比例して尾の粒を出し、粒は漂いながら縮んで消える。
  function updateDust(dt) {
    cur.copy(halo.position);
    if (halo.visible) {
      let n = 0;
      if (hasPrev) n += cur.distanceTo(prev) * STAR_DUST_DENSITY;
      carry += n;
      while (carry >= 1) {
        carry -= 1;
        const t = hasPrev ? Math.random() : 1; // 前フレーム位置〜現在位置の間にばらまくと線状の尾になる
        spawn(
          prev.x + (cur.x - prev.x) * t,
          prev.y + (cur.y - prev.y) * t,
          prev.z + (cur.z - prev.z) * t
        );
      }
      prev.copy(cur);
      hasPrev = true;
    } else {
      hasPrev = false; // 消えたあと(着弾後)は新しい粒を出さない。残った粒だけが消えていく
      carry = 0;
    }

    for (let i = 0; i < STAR_DUST_MAX; i++) {
      if (age[i] >= STAR_DUST_LIFE) { alpha[i] = 0; continue; }
      age[i] += dt;
      const k = Math.min(age[i] / STAR_DUST_LIFE, 1);
      pos[i * 3]     += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      alpha[i] = (1 - k) * (1 - k);
      psize[i] = baseSize[i] * (1 - 0.6 * k);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  }

  const tick = (time, deltaTimeMs) => updateDust(Math.min(deltaTimeMs / 1000, 0.05));
  // ★ gsap.ticker.add(tick) は、ティッカーがスリープ中(動いているアニメーションが2秒ほど無い状態)だと、
  //   その場で即座に1回 tick を呼ぶ(wake時の同期実行)。ここで登録してしまうと、本体の位置を決める
  //   update(0) より前に tick が走り、本体がまだ原点にいる(Spriteの初期位置)状態を「前フレーム位置」として
  //   覚えてしまう。次のフレームで、原点→スタート位置(約77単位)の全区間に尾の粒が一度にばらまかれ、
  //   「数秒放置したあとのクリックで、即着弾する星がもう1本出る」不具合になっていた。
  //   → 登録は、必ず update(0) のあと(本体がスタート位置に置かれてから)にする。

  const tEnd = 1 + STAR_OVERSHOOT;

  function update(t) {
    readCameraBasis();
    headAt(t, halo.position);
    // 原点を通り過ぎきるまで、大きさも明るさも落とさずに見せる(=着弾してから消える)
    halo.visible = t < tEnd - 1e-6;
    haloMaterial.opacity = THREE.MathUtils.smoothstep(t, 0, STAR_FADE_IN_RATIO);
  }
  update(0); // 最初の1フレーム目から正しい位置に置いておく
  gsap.ticker.add(tick); // ← 必ず update(0) のあと(上の★参照)

  return {
    sprite: group,
    update,
    dispose() {
      gsap.ticker.remove(tick);
      haloMaterial.map.dispose();
      haloMaterial.dispose();
      geo.dispose();
      dust.material.dispose();
    },
  };
}

// ── 幾何の基準値: (AXIS_LENGTH,0,0)(0,AXIS_LENGTH,0)(0,0,AXIS_LENGTH)の
//    正三角形から、重心・外接円半径・向き(法線)を一度だけ計算しておく ────
const GROUND_VERTEX_A = new THREE.Vector3(AXIS_LENGTH, 0, 0);
const GROUND_VERTEX_B = new THREE.Vector3(0, AXIS_LENGTH, 0);
const GROUND_VERTEX_C = new THREE.Vector3(0, 0, AXIS_LENGTH);
const GROUND_CENTROID = GROUND_VERTEX_A.clone().add(GROUND_VERTEX_B).add(GROUND_VERTEX_C).multiplyScalar(1 / 3);
const GROUND_NORMAL = new THREE.Vector3(1, 1, 1).normalize();
const RING_FINAL_RADIUS = GROUND_VERTEX_A.distanceTo(GROUND_CENTROID); // 外接円半径
const AXIS_TRAVEL_LENGTH = ORIGIN.distanceTo(GROUND_CENTROID);        // 原点→重心の距離

// ── 2a) 軸上(ラッパのイメージ): 対称位相の呼吸リング ──────────────────
// 半径1の単位円(線)を1つだけ作り、毎フレーム scale で半径を表現する(軽量)。
// 位相をπずらした2本を重ねることで「片方が膨らむ時、もう片方が縮む」対称位相にする。
// ラッパの振動のように、素早い振動数で小刻みに揺れながら原点→重心を伝う。
// 現れた直後は振幅を小さく始めて、次第にフルの振幅まで育っていく。
// 対の片方は軸方向に少しオフセットして、最大/最小の瞬間に完全に重ならないようにする。
const RING_LINE_SEGMENTS = 96;
const BREATHE_FREQUENCY = 9.0;        // rad/sec。ラッパの振動を意識してかなり速めに
const BREATHE_AMPLITUDE_RATIO = 0.18; // 基準半径に対する振幅の割合(フル状態)
const BREATHE_AMPLITUDE_RAMP_START = 0.08; // 現れた直後の振幅倍率(フルに対する割合。小さく始める)
const BREATHE_HUE_SWING = 0.045;      // 呼吸にあわせてhueを±この範囲で揺らす(青の範囲に収まる程度)
const BREATHE_LINE_OPACITY = 0.85;
const BREATHE_RING_AXIAL_OFFSET = 0.4; // 対の片方だけ、軸方向にこのぶんずらす(ワールド単位、仮)

function createBreathingRing(phaseOffset, axialOffset = 0) {
  const points = [];
  for (let i = 0; i <= RING_LINE_SEGMENTS; i++) {
    const angle = (i / RING_LINE_SEGMENTS) * Math.PI * 2;
    points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
  }
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = new THREE.LineBasicMaterial({
    color: new THREE.Color().setHSL(BEAM_HUE, BEAM_SATURATION, BEAM_LIGHTNESS_MAX),
    transparent: true,
    opacity: 0, // タイムラインでフェードインさせる
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: false,
  });
  const line = new THREE.LineLoop(geometry, material);
  line.renderOrder = 999;
  line.userData.phaseOffset = phaseOffset;
  line.userData.axialOffset = axialOffset;
  return line;
}

// progress: 0→1で原点→重心。呼吸リングは軸上だけの担当(重心到達後は
// 平面波源にバトンタッチしてフェードアウトする)。
function updateBreathingRing(line, elapsedSeconds, progress) {
  const phase = line.userData.phaseOffset;
  const axialOffset = line.userData.axialOffset;
  const axisT = THREE.MathUtils.clamp(progress, 0, 1);

  const baseRadius = axisT * RING_FINAL_RADIUS;

  // 振幅は現れた直後、じわじわ小さい状態から立ち上げる(いきなりフルで脈打たない)。
  const ampT = THREE.MathUtils.smoothstep(axisT, 0, 1);
  const ampScale = THREE.MathUtils.lerp(BREATHE_AMPLITUDE_RAMP_START, 1, ampT);

  const breathe = Math.sin(elapsedSeconds * BREATHE_FREQUENCY + phase) * baseRadius * BREATHE_AMPLITUDE_RATIO * ampScale;
  const radius = Math.max(baseRadius + breathe, 0.001);
  line.scale.setScalar(radius);

  // 対の片方(axialOffset != 0)だけ、軸方向に少しずらして位置させる。
  // 原点付近で急に後ろへ飛び出さないよう、axisTに応じてオフセットも
  // 0から徐々にかかるようにしている。
  const travel = axisT * AXIS_TRAVEL_LENGTH + axialOffset * axisT;
  line.position.copy(GROUND_NORMAL).multiplyScalar(travel);

  const hue = BEAM_HUE + Math.sin(elapsedSeconds * BREATHE_FREQUENCY + phase) * BREATHE_HUE_SWING;
  line.material.color.setHSL(hue, BEAM_SATURATION, BEAM_LIGHTNESS_MAX);
}

// 対称位相(π差)の2本を1組として作る。片方だけ軸方向にオフセットして、
// 最大/最小それぞれの瞬間に2本が同じ位置で完全に重ならないようにする。
function createBreathingRingPair() {
  const defaultNormal = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, GROUND_NORMAL);

  const ringA = createBreathingRing(0, 0);
  const ringB = createBreathingRing(Math.PI, -BREATHE_RING_AXIAL_OFFSET);
  ringA.quaternion.copy(quat);
  ringB.quaternion.copy(quat);

  return {
    ringA,
    ringB,
    update(elapsedSeconds, progress) {
      updateBreathingRing(ringA, elapsedSeconds, progress);
      updateBreathingRing(ringB, elapsedSeconds, progress);
    },
  };
}

// ── 2b) 平面上: 三軸の終点(GROUND_VERTEX_A/B/C)をそれぞれ波源として、
//    正弦波の波紋(=一定間隔で並ぶ複数の同心円=波の山)を、半径0から外側へ
//    広げていく。3つの波源から出た波が重なるところは加算合成
//    (AdditiveBlending)でより明るくなり、干渉しているように見える。
//    すべて青のLineLoop(線のリング)で表現する。
//    波紋はメッシュではなく「先頭の波面+後ろに続く残像リング数本」という
//    離散的な同心円の集まりとして表現し、後ろのリングほど暗く残像として残す。
const PLANE_WAVE_SOURCES_LOCAL = [GROUND_VERTEX_A, GROUND_VERTEX_B, GROUND_VERTEX_C];
const PLANE_WAVE_MAX_RADIUS = RING_FINAL_RADIUS * 2.2; // 波源からどこまで広がるか(仮。対辺・対頂点まで届く程度)
const PLANE_WAVE_WAVELENGTH = 0.85;  // 波の山と山の間隔(ワールド単位、仮。正弦波の周期に相当)
const PLANE_WAVE_RING_COUNT = 4;     // 先頭の波面+残像何本を同時に描くか
const PLANE_WAVE_RING_DECAY = 0.55;  // 先頭から残像リングへ向けての減衰(大きいほど残像は短い)
const PLANE_WAVE_MAX_OPACITY = 0.6;
const PLANE_WAVE_LINE_SEGMENTS = 96;

function createPlaneWaveRingSet() {
  // 単位円をPLANE_WAVE_RING_COUNT本あらかじめ作っておき、半径はscaleで表現する
  // (=メッシュのように頂点を再計算する必要がなく軽い)。
  return Array.from({ length: PLANE_WAVE_RING_COUNT }, () => {
    const points = [];
    for (let i = 0; i <= PLANE_WAVE_LINE_SEGMENTS; i++) {
      const angle = (i / PLANE_WAVE_LINE_SEGMENTS) * Math.PI * 2;
      points.push(new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({
      color: new THREE.Color().setHSL(BEAM_HUE, BEAM_SATURATION, BEAM_LIGHTNESS_MAX),
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      depthTest: false,
    });
    const line = new THREE.LineLoop(geometry, material);
    line.renderOrder = 999;
    return line;
  });
}

// frontRadius: 波の先端が波源からどこまで届いたか(0〜PLANE_WAVE_MAX_RADIUS)
// opacityEnvelope: フェードイン/アウト用の全体倍率(0〜1)
function updatePlaneWaveRingSet(rings, frontRadius, opacityEnvelope) {
  rings.forEach((line, k) => {
    // k=0が波の先頭(最前面)、kが増えるほど後ろに続く残像(=前の波の山)
    const radius = frontRadius - k * PLANE_WAVE_WAVELENGTH;
    if (radius <= 0.001) {
      line.material.opacity = 0;
      return;
    }
    line.scale.setScalar(radius);
    const ringEnvelope = Math.exp(-k * PLANE_WAVE_RING_DECAY);
    line.material.opacity = PLANE_WAVE_MAX_OPACITY * ringEnvelope * opacityEnvelope;
    const lightness = THREE.MathUtils.lerp(BEAM_LIGHTNESS_MIN, BEAM_LIGHTNESS_MAX, ringEnvelope);
    line.material.color.setHSL(BEAM_HUE, BEAM_SATURATION, lightness);
  });
}

// 3つの波源(GROUND_VERTEX_A/B/C)それぞれに、リングの束を1つずつ配置する
function createPlaneWaveSources() {
  const defaultNormal = new THREE.Vector3(0, 0, 1);
  const quat = new THREE.Quaternion().setFromUnitVectors(defaultNormal, GROUND_NORMAL);

  return PLANE_WAVE_SOURCES_LOCAL.map((sourcePosition) => {
    const rings = createPlaneWaveRingSet();
    rings.forEach((line) => {
      line.quaternion.copy(quat);
      line.position.copy(sourcePosition);
    });
    return { rings, sourcePosition };
  });
}

// ── 3) 軸(概念X軸・Z軸)をリングの通過に合わせて消す/あとで戻す ────────
// リングは「原点→重心」を進みながら半径が進行度に比例して広がる(=円錐)。この円錐は
// 3軸の終点を通るので、進行度 p のとき、リングは各軸の「原点から p×AXIS_LENGTH」の地点を通る。
// そこで、軸の原点側の端を p×AXIS_LENGTH まで押し出して、通過済みの区間を消していく。
//   xAxis(axes.js): 頂点0=遠方(固定)、頂点1=原点側 → 頂点1を遠方へ押し出す(world +Z方向の軸)
//   zAxis(axes.js): 頂点0=原点側、頂点1=先端(local Y = world +Y) → 頂点0を先端へ押し出す
// yAxis(world +X)は消さない。
// ★ 軸は光芒の「帯(4頂点のクアッド)」: 頂点0,1=A端 / 頂点2,3=B端(axes.jsのsetGlowEnds)。
//   以前の2頂点Line前提(頂点0/1を直接動かす)から変更した。端を動かすときは setGlowEnds で帯ごと作り直す。
//   さらに、軸の明るさ・太さは「進行度(0=原点側→1=先端側)」で先細りするので、動かした端の進行度
//   (uProgA/uProgB)も実際の軸上の位置に合わせて更新する。こうすると、消えていく/描かれていく途中でも
//   見えている部分は「完成した軸のその区間」と同じ見た目になる(明るい原点側から消え、先端側は細く暗いまま残る)。
//   xAxis: A=遠方(固定,進行度1) / B=原点側(進行度0) → Bを遠方へ押し出す
//   zAxis: A=原点側(進行度0) / B=先端(進行度1)       → Aを先端へ押し出す
// yAxis(world +X)は消さない。
function makeXAxisEraser(line) {
  const pos = line.geometry.attributes.position;
  const u = line.material.uniforms;
  const far = pos.getZ(0);   // 固定端(遠方)
  const near0 = pos.getZ(2); // 元の原点側の端
  const progB0 = u.uProgB.value;
  const vFar = new THREE.Vector3(0, 0, far);
  const vNear = new THREE.Vector3();
  line.updateWorldMatrix(true, false);
  return {
    kind: 'x',
    line,
    tip: line.localToWorld(new THREE.Vector3(0, 0, far)), // 軸の先端(ワールド座標)
    full: far, // 完全に消える距離(ワールド単位)
    apply(d) {
      const z = Math.min(Math.max(d, near0), far);
      setGlowEnds(line.geometry, vFar, vNear.set(0, 0, z));
      u.uProgB.value = far > 0 ? z / far : 1; // 原点側の端の、軸上での進行度
    },
    reset() {
      setGlowEnds(line.geometry, vFar, vNear.set(0, 0, near0));
      u.uProgB.value = progB0;
    },
  };
}

function makeZAxisEraser(line) {
  const pos = line.geometry.attributes.position;
  const u = line.material.uniforms;
  const y0 = pos.getY(0); // 元の原点側の端(ローカル)
  const y1 = pos.getY(2); // 先端(ローカル)
  const sy = () => line.scale.y || 1; // 軸が伸びる演出中でも、ワールド距離に直して扱う
  const scale0 = line.scale.y;        // 通常時(完全に伸びきった状態)のscale.y
  const progA0 = u.uProgA.value, progB0 = u.uProgB.value;
  const vA = new THREE.Vector3(), vB = new THREE.Vector3();
  line.updateWorldMatrix(true, false);
  return {
    kind: 'z',
    line,
    scale0,
    tip: line.localToWorld(new THREE.Vector3(0, y1, 0)), // 軸の先端(ワールド座標)
    full: y1 * sy(),
    // 消去: 原点側の端を先端へ押し出す
    apply(d) {
      const y = Math.min(Math.max(d / sy(), y0), y1);
      setGlowEnds(line.geometry, vA.set(0, y, 0), vB.set(0, y1, 0));
      u.uProgA.value = y1 > y0 ? (y - y0) / (y1 - y0) : 0;
    },
    // 描き直し: 原点側を固定したまま、先端側の端を原点→先端へ伸ばす(f: 0〜1)
    drawTo(f) {
      const k = THREE.MathUtils.clamp(f, 0, 1);
      setGlowEnds(line.geometry, vA.set(0, y0, 0), vB.set(0, y0 + (y1 - y0) * k, 0));
      u.uProgA.value = progA0;
      u.uProgB.value = progA0 + (progB0 - progA0) * k; // 先端側の端の、軸上での進行度
    },
    reset() {
      setGlowEnds(line.geometry, vA.set(0, y0, 0), vB.set(0, y1, 0));
      u.uProgA.value = progA0;
      u.uProgB.value = progB0;
    },
  };
}

// いま見えている軸だけを対象にする(すでに消えている軸は触らない)
function createAxisErasers(axes) {
  const list = [];
  if (!axes) return list;
  if (axes.xAxis && axes.xAxis.visible) list.push(makeXAxisEraser(axes.xAxis));
  if (axes.zAxis && axes.zAxis.visible && axes.zAxis.scale.y > 0) list.push(makeZAxisEraser(axes.zAxis));
  return list;
}

// 直近の playOriginBurst で消した軸。restoreBurstAxes() が使う。
let burstErasers = [];

// 消した軸を戻す(「その後の演出」から呼ぶ)。軸は先端側から原点に向かって伸び戻る
// (X軸の「光が原点へ流れる」向きと同じ)。duration: 戻りきるまでの秒数。
export function restoreBurstAxes({ duration = 1.2, onComplete } = {}) {
  const erasers = burstErasers;
  burstErasers = [];
  if (erasers.length === 0) {
    if (onComplete) onComplete();
    return null;
  }
  erasers.forEach((e) => { e.line.visible = true; });
  const state = { k: 1 };
  return gsap.to(state, {
    k: 0,
    duration,
    ease: 'power2.out',
    onUpdate: () => erasers.forEach((e) => e.apply(e.full * state.k)),
    onComplete: () => {
      erasers.forEach((e) => e.reset());
      if (onComplete) onComplete();
    },
  });
}

// ── 消した軸を「Ĥ・ħの移動」で描き直す(phase1.js の startPhase1 に渡す) ──────
// バースト後に呼ぶと、消してある軸の描き直し用コントローラを返す(1回きり)。
//   z: Z軸(xAxis/zAxisのうち world +Y 側=zAxis)。原点→先端へ伸びる。 set(0→1)
//   x: X軸(xAxis)。先端→原点へ刻まれていく。                           set(0→1)
//   origin: 原点のワールド座標 / z.tip, x.tip: 各軸の先端のワールド座標
// set(1) で、バースト前と完全に同じ見た目・頂点・進行度に戻る(光芒の帯ジオメトリ対応済み)。
// バーストで消さなかった軸は null(その場合 phase1 側は従来の画面固定経路にフォールバックする)。
export function takeBurstAxisRedraw() {
  const erasers = burstErasers;
  burstErasers = [];
  const result = { origin: ORIGIN.clone(), x: null, z: null };

  const ze = erasers.find((e) => e.kind === 'z');
  if (ze) {
    ze.line.scale.y = ze.scale0; // 伸ばす演出はscale.yではなく帯の先端側の端(drawTo)で行う(進行度も軸上の位置に合わせるため)
    ze.drawTo(0);                // 長さ0から始める(ゼロ長は自動的に描かれない)
    ze.line.visible = true;
    result.z = {
      tip: ze.tip.clone(),
      set(f) { if (f >= 1) ze.reset(); else ze.drawTo(f); }, // f=1でバースト前と完全に同じ頂点・進行度に戻る
    };
  }

  const xe = erasers.find((e) => e.kind === 'x');
  if (xe) {
    xe.line.visible = true;
    result.x = {
      tip: xe.tip.clone(),
      set(f) {
        const k = THREE.MathUtils.clamp(f, 0, 1);
        if (k >= 1) xe.reset(); else xe.apply((1 - k) * xe.full); // 原点側の端が先端から原点へ近づく
      },
    };
  }
  return result;
}

// ── 演出タイミング(すべて仮値。見ながら調整してください) ──────────────
const RING_START_DELAY = STAR_TRAVEL_DURATION; // 流れ星が原点に着いた瞬間にリングが伸び始める
const RING_TRAVEL_DURATION = 4.0; // リングが原点→重心(軸上)まで伝う時間(=ゆっくり)
const RING_FADE_IN_DURATION = 0.2;
const RING_FADE_OUT_DURATION = 0.35; // リングが平面波源にバトンタッチする際のフェードアウト時間

const PLANE_WAVE_FADE_IN_DURATION = 0.25;
const PLANE_WAVE_EXPAND_DURATION = 2.4;   // 波源から半径0→PLANE_WAVE_MAX_RADIUSまで広がる時間
const PLANE_WAVE_FADE_OUT_DURATION = 1.2; // 広がりきった波紋がフェードアウトする時間

// scene: 追加/削除に使う。camera: 流れ星の「画面右上」を決めるために使う(必ず渡すこと)。
// axes: createAxes() の戻り値。渡すと、リングの通過に合わせて xAxis / zAxis を消す
//       (戻すのは restoreBurstAxes())。省略すると軸には触らない。
// onComplete: 演出が完全に終わった(=シーンから片付いた)タイミングで呼ばれる。
export function playOriginBurst({ scene, camera, axes, onComplete }) {
  // ── 1) 流れ星 ──
  const star = createShootingStar(camera);
  scene.add(star.sprite);

  // リングが通過した区間の軸を消すための準備
  const erasers = createAxisErasers(axes);
  burstErasers = erasers;

  // ── 2) 呼吸リング(軸上)+平面波源(三軸の干渉)を1組 ──
  const ringPair = createBreathingRingPair();
  const planeWaveSources = createPlaneWaveSources();
  scene.add(ringPair.ringA);
  scene.add(ringPair.ringB);
  planeWaveSources.forEach(({ rings: waveRings }) => {
    waveRings.forEach((line) => scene.add(line));
  });

  // 呼吸(sin波の脈動)は経過時間ベースで動かすので、演出開始時刻を記録しておく
  const clockStart = performance.now();

  const tl = gsap.timeline({
    onComplete: () => {
      // 使い捨て演出なので、自分で後片付けまでする(シーン・GPUリソースを残さない)。
      scene.remove(star.sprite);
      star.dispose();

      scene.remove(ringPair.ringA);
      scene.remove(ringPair.ringB);
      ringPair.ringA.geometry.dispose();
      ringPair.ringA.material.dispose();
      ringPair.ringB.geometry.dispose();
      ringPair.ringB.material.dispose();

      planeWaveSources.forEach(({ rings: waveRings }) => {
        waveRings.forEach((line) => {
          scene.remove(line);
          line.geometry.dispose();
          line.material.dispose();
        });
      });

      if (onComplete) onComplete();
    },
  });

  // ── 流れ星: だんだん加速しながら原点へ着弾 ──
  const starState = { t: 0 };
  tl.to(starState, {
    t: 1 + STAR_OVERSHOOT, // 原点(t=1)を少し通り過ぎるまで進める
    // イージングは二次(power1.in)。t=1(原点)にちょうど STAR_TRAVEL_DURATION 秒で着くよう、全体の長さを逆算している
    duration: STAR_TRAVEL_DURATION * Math.sqrt(1 + STAR_OVERSHOOT),
    ease: 'power1.in',
    onUpdate: () => star.update(starState.t),
  }, 0);

  // ── 呼吸リング(軸上)→平面波源(三軸の干渉) ──
  const start = RING_START_DELAY;

  tl.to(ringPair.ringA.material, {
    opacity: BREATHE_LINE_OPACITY,
    duration: RING_FADE_IN_DURATION,
    ease: 'power1.out',
  }, start);
  tl.to(ringPair.ringB.material, {
    opacity: BREATHE_LINE_OPACITY,
    duration: RING_FADE_IN_DURATION,
    ease: 'power1.out',
  }, start);

  // 軸上(原点→重心)を等速で伝う。振幅の立ち上がりはupdateBreathingRing内で
  // 別途担っているので、ここでは進み方だけを単純な線形にしている。
  const ringProgress = { value: 0 };
  tl.to(ringProgress, {
    value: 1,
    duration: RING_TRAVEL_DURATION,
    ease: 'none',
    onUpdate: () => {
      ringPair.update((performance.now() - clockStart) / 1000, ringProgress.value);
      erasers.forEach((e) => e.apply(ringProgress.value * AXIS_LENGTH)); // リングが通った区間まで消す
    },
  }, start);

  // 軸終端(=重心)に到着したタイミングで、呼吸リング→平面波源へバトンタッチ。
  const arrival = start + RING_TRAVEL_DURATION;
  tl.call(() => erasers.forEach((e) => e.apply(Infinity)), null, arrival); // 取りこぼしなく完全に消す

  tl.to(ringPair.ringA.material, {
    opacity: 0,
    duration: RING_FADE_OUT_DURATION,
    ease: 'power1.in',
  }, arrival);
  tl.to(ringPair.ringB.material, {
    opacity: 0,
    duration: RING_FADE_OUT_DURATION,
    ease: 'power1.in',
  }, arrival);

  // 平面波源: 三軸それぞれの終点から、半径0で生まれた正弦波リング
  // (先頭+残像数本)が広がっていく。
  const planeWaveState = { frontRadius: 0, opacity: 0 };
  const refreshPlaneWave = () => {
    planeWaveSources.forEach(({ rings: waveRings }) => {
      updatePlaneWaveRingSet(waveRings, planeWaveState.frontRadius, planeWaveState.opacity);
    });
  };
  tl.to(planeWaveState, {
    opacity: 1,
    duration: PLANE_WAVE_FADE_IN_DURATION,
    ease: 'power1.out',
    onUpdate: refreshPlaneWave,
  }, arrival);
  tl.to(planeWaveState, {
    frontRadius: PLANE_WAVE_MAX_RADIUS,
    duration: PLANE_WAVE_EXPAND_DURATION,
    ease: 'power1.out',
    onUpdate: refreshPlaneWave,
  }, arrival);
  tl.to(planeWaveState, {
    opacity: 0,
    duration: PLANE_WAVE_FADE_OUT_DURATION,
    ease: 'power1.in',
    onUpdate: refreshPlaneWave,
  }, arrival + PLANE_WAVE_EXPAND_DURATION - PLANE_WAVE_FADE_OUT_DURATION);

  return tl;
}
