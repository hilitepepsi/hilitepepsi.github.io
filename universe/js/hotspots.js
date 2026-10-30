import * as THREE from 'three';

// ── 星に紐づくセリフ(位置と台詞のペア) ───────────
const HOTSPOTS = [
   //X
  { pos: [-200, -280, 10],  special: 'starburst',
                            text:  [{ text: 'It\’s rainning.\nIt\’s starting to rain.', work: 'The Catcher in the Rye'},
                                   { text: 'Aren\’t you gonna ride too?', work: 'The Catcher in the Rye'},
                                   ] },
  { pos: [-80, -130, 100],  text: [{ text: 'This is a people shooting hat.', work: 'The Catcher in the Rye'},
                                   { text: 'Mine came from Mark Cross.', work: 'The Catcher in the Rye'},
                                   { text: 'The fish is different. I\’m talking about the ducks,', work: 'The Catcher in the Rye'},
                                   ] },
  { pos: [-450, -330, 50],  text: [{ text: 'Go home and get your bike and meet me in front of Bobby\’s house. Hurry up.', work: 'The Catcher in the Rye'},
                                   { text: 'But twice ─ twice ─ we were there it started to rain.', work: 'The Catcher in the Rye'},
                                   { text: 'He never got sore about anything', work: 'The Catcher in the Rye'},
                                   ] },
  //Y
  { pos: [120, -200, -150], text: [{ text:'That was a secret bugle only Admirals to hear.\n— Boo Boo Glass', work: 'Down at the Dinghy'},
                                   ] },
  { pos: [200, -100, -260], text: [{ text: 'What did one wall say to the other wall?\n— Charles', work: 'For Esmé—with Love and Squalor'},
                                   { text: 'The door banged open without having been wrapped on. X raised his head, turned it, and corporal Z standing in the door.', work: 'For Esmé—with Love and Squalor'},
                                   ] },
  { pos: [-50, -30, -100],  text: [{ text: 'Did the tigers run all around that tree?\n─ Sybil Carpenter', work: 'A Perfect Day for Bananafish'},
                                    { text: 'Here comes a wave.\n─ Sybil Carpenter', work: 'A Perfect Day for Bananafish'},
                                   ] },
  { pos: [-30, -100, -60],  text: [{ text:'gift horse', work: 'Teddy',},
                                   { text:'triumvirate', work: 'Teddy'},
                                   ] },
  //Z
  { pos: [-200,10, -150],   text: [{ text: 'I want to talk to Seymour.\n─Franny Glass', work: 'Zooey'},
                                   { text: 'The only kind of chicken soup Bessie ever brings to anybody around this madhouse.\n─ Zooey Glass', work: 'Zooey'},
                                   ] },
  { pos: [-70, 30, -190],   text: [{ text: 'I was Mercury himself.\n─ Buddy Glass', work: 'Seymour: an Introduction'},
                                   { text: 'This which, I suggest, though possibly not to everyone’s taste, is highly literate vaudeville.\n─ Buddy Glass', work: 'Seymour: an Introduction'},
                                   ] },
  { pos: [-100, 150, -140], text: [{ text: 'Keep me up till five only because all your stars are out, and for other reason.\n─ Seymour Glass', work: 'Seymour: an Introduction'},
                                   { text: 'All we do our whole lives is go from one little piece of Holy Ground to the next.\n─ Seymour Glass', work: 'Seymour: an Introduction'},
                                    ]},

];

// ← 見た目のサイズはそのまま(0.35)。星は原点から100〜380くらい離れた位置に置かれていて、
//   画面上でこの小ささをピクセル単位でクリックするのはほぼ不可能に近いため、
//   axisStationOverlay.jsのmakeDotと同じパターンで「判定専用の大きな透明球」を子として追加する。
const HOTSPOT_HIT_RADIUS = 16; // ← 星までの距離が大きいので、他の点(DOT_HIT_RADIUS=1.1)よりだいぶ広めにしてある

// ══════════════════════════════════════════════════════════════
// 発光の作り方(★ 2026-10-29 変更: Bloomに頼らず、星自身に発光を描く)
//   全hotspotはmain.jsでexcludeFromBloomされている。見た目の発光は次の2通りで自前で描く。
//   ・通常のhotspot  : stars.jsと同じ「点スプライトに描くMoffat分布」(色は従来の0xfff3c4のまま)
//   ・starburst      : 「三軸の表現ラボ」の「光芒+先端の星」と同じ作り(Moffat核+十字スパイク)
//   どちらも、見た目のメッシュは廃止し、クリック判定用の透明メッシュ(m本体とhitArea)だけを残している。
// ══════════════════════════════════════════════════════════════

// ── 通常のhotspot: stars.jsと同じMoffat点スプライト ──────────────
//   v = (1 + (r/a)²)^-β。芯が鋭く裾が長い。常に真円になるので、Bloomの四角い光暈が出ない。
const HOTSPOT_COLOR = 0xfff3c4;   // 色は従来のまま
const HOTSPOT_HALO = 8;           // スプライト直径 = 芯の直径 × この値(stars.jsのuHaloと同じ)
const HOTSPOT_MAX_POINT = 160;    // gl_PointSizeの上限(px)
const HOTSPOT_CORE_SCALE = 1.6;   // 芯の大きさの倍率。1にすると背景の星と完全に同じ大きさ。
                                  // 「セリフの星」を見つけやすくするため、少しだけ大きくしてある(仮値)
const HOTSPOT_GAIN = 1.4;         // 明るさの倍率。1にするとstars.jsの通常の星と同じ

const HOTSPOT_GLOW_VERTEX = `
  attribute float phase;
  uniform float uTime;
  uniform float uHalo;
  uniform float uMaxPoint;
  uniform float uCoreScale;
  varying float vTwinkle;
  varying float vCore;
  void main() {
    vTwinkle = 0.5 + 0.5 * sin(uTime * 1.5 + phase * 6.2831);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 芯の直径(px)。stars.jsの通常の星と同じ計算(瞬きで1.2〜4.5が0.9倍されて、距離で縮む。下限3px)。
    float rawSize = (1.2 + vTwinkle * 3.3) * 0.9 * (300.0 / -mv.z);
    float core = max(rawSize, 3.0) * uCoreScale;
    // スプライトは芯より大きく取り、裾を描く余白にする。上限で切られても比率は保つ。
    float sprite = min(core * uHalo, uMaxPoint);
    vCore = min(core / sprite, 0.5);
    gl_PointSize = sprite;
    gl_Position = projectionMatrix * mv;
  }
`;

const HOTSPOT_GLOW_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uGain;
  varying float vTwinkle;
  varying float vCore;
  void main() {
    float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (r >= 1.0) discard;
    float rr = r / vCore;
    float profile = pow(1.0 + rr * rr, -1.25);
    // スプライトの縁で裾がぷつっと切れないよう、外側で滑らかに0へ落とす。
    profile *= 1.0 - smoothstep(0.3, 1.0, r);
    float brightness = (1.1 + vTwinkle * 0.8) * uGain;
    if (profile <= 0.0002) discard;
    gl_FragColor = vec4(uColor * brightness, profile);
  }
`;

// ── starburst(Phoebeの星): 「光芒+先端の星」と同じ作り ──────────────
//   Moffat核 + 十字スパイク(+ごく弱い斜めスパイク)を、カメラ向きの板1枚に1ピクセルずつ式で描く。
//   (以前のcanvasテクスチャは廃止。ミップマップ由来の角ばりも原理的に出ない。)
//   板の大きさはワールド単位なので、main.jsのm.scaleによる拡大(carouselとのつなぎ)にもそのまま追従する。
const STARBURST_SPRITE_SIZE = 30; // ワールド単位。十字の腕はこの板の端までしか伸びられないので、長くしたいときはここを大きくする。
                                  // ※main.jsはBox3で外形を測ってスケールを決める。判定球の直径(HOTSPOT_HIT_RADIUS×2=32)を超えると
                                  //   外形が変わって拡大率がずれるので、32以下にしておくこと。
const STARBURST_COLOR = 0xffffff; // 白
const STARBURST_CORE = 0.014;     // 芯とスパイクの基準の太さ(板の半幅=1に対する比)。
                                  // 板の大きさ(SPRITE_SIZE)を変えたら、芯の絶対的な大きさが変わらないよう 0.21 ÷ (SPRITE_SIZE/2) に合わせる
const STARBURST_CORE_GAIN = 0.5;  // コアの明るさ(プレビューの「コア明るさ」)
const STARBURST_SHARP = 4;        // コアの鋭さ。Moffatの指数で、大きいほど芯から急峻に落ちる
const STARBURST_LEN = 0.87;       // 十字の長さ(板の半幅=1に対する比。針は先端でちょうど0に収束する)
const STARBURST_ROOT = 2.85;      // 針の根本の太さ(STARBURST_COREに対する倍率)
const STARBURST_TAPER = 0;        // 針の収束(0で根本の太さのまま先端まで。大きいほど先が細くなる)
const STARBURST_DIAG = 0.41;      // 斜めスパイクの強さ(十字を1としたときの比。長さは十字の半分)
const STARBURST_GAIN = 2.6;       // 全体の明るさ
// ── スペクトル(先端の虹色のちらつき)は「カメラが動いた時」だけ強くなる ──
const STARBURST_SPEC_REST = 0;    // 静止時のスペクトル量(0で無し)
const STARBURST_SPEC_MOVE = 1;    // カメラが十分速く動いた時のスペクトル量
const MOTION_FULL = 1.5;          // この角速度(rad/秒)で動きを最大(1)とみなす(仮値)
const MOTION_ATTACK = 12;         // 動き出しへの追従の速さ(大きいほどすぐ虹色が出る)
const MOTION_DECAY = 2.5;         // 止まった後の余韻の速さ(小さいほど長く残る。2.5で約0.4秒)
const MOTION_POS_WEIGHT = 0.002;  // カメラの平行移動(1単位あたり)を回転(rad)に換算する重み
const MOTION_ZOOM_FULL = 1.0;     // この速さ(ln倍率/秒。2倍ズームを約0.7秒)でズームを最大(1)とみなす(仮値)
const STARBURST_DISPERSION = 0.035; // 色ずれの最大量(板の半幅=1に対する比)。赤と青が動きの向きに±この量ずれる

// ── カメラの動き量: 全starburstで共有。main.jsの変更なしで、onBeforeRenderで受け取るcameraから測る ──
//   ・vx,vy : 画面上で星が流れる向きと速さ(回転+平行移動。長さは0〜1)。色ずれの向きになる。
//   ・zoom  : ズームの速さ(0〜1)。カメラのzoom / fov / 前後移動(ドリー)のどれでも反応する。色ずれは画面中心から放射状。
const _q = new THREE.Quaternion(), _qPrev = new THREE.Quaternion(), _qInv = new THREE.Quaternion(), _dq = new THREE.Quaternion();
const _p = new THREE.Vector3(), _pPrev = new THREE.Vector3(), _dp = new THREE.Vector3(), _sp = new THREE.Vector3();
const motion = { vx: 0, vy: 0, zoom: 0, t: 0, lz: 0, lf: 0, init: false };
function updateMotion(camera, now) {
  camera.getWorldQuaternion(_q);
  camera.getWorldPosition(_p);
  const lz = Math.log(Math.max(camera.zoom || 1, 1e-4));
  const lf = camera.isPerspectiveCamera ? Math.log(Math.tan(THREE.MathUtils.degToRad(camera.fov) * 0.5)) : 0;
  if (!motion.init) {
    _qPrev.copy(_q); _pPrev.copy(_p); motion.t = now; motion.lz = lz; motion.lf = lf; motion.init = true; return;
  }
  const dt = now - motion.t;
  if (dt < 0.003) return; // 同じフレームの複数回呼び出しは1回に絞る
  // 前フレームのカメラ座標系での回転量と移動量
  _qInv.copy(_qPrev).invert();
  _dq.copy(_qInv).multiply(_q);
  const sg = _dq.w < 0 ? -1 : 1;
  const rx = 2 * sg * _dq.x, ry = 2 * sg * _dq.y; // 小さい回転なので、軸まわりの角度 ≒ 2×クォータニオン成分
  _dp.copy(_p).sub(_pPrev).applyQuaternion(_qInv);
  // 画面上で星が流れる向き: カメラが右を向けば星は右へ流れ(ry>0)、上を向けば下へ流れる(rx>0)。平行移動は逆向き。
  const k = 1 / (dt * MOTION_FULL);
  let tx = (ry - _dp.x * MOTION_POS_WEIGHT) * k;
  let ty = (-rx - _dp.y * MOTION_POS_WEIGHT) * k;
  const len = Math.hypot(tx, ty);
  if (len > 1) { tx /= len; ty /= len; }
  // ズーム: zoom倍率・fov・前後移動(原点までの距離に対する割合)の変化を足す
  const zr = (Math.abs(lz - motion.lz) + Math.abs(lf - motion.lf) + Math.abs(_dp.z) / Math.max(_p.length(), 1)) / dt;
  const tz = Math.min(zr / MOTION_ZOOM_FULL, 1);
  const f = (target, cur) => 1 - Math.exp(-Math.min(dt, 0.1) * (target > cur ? MOTION_ATTACK : MOTION_DECAY));
  const fv = f(Math.hypot(tx, ty), Math.hypot(motion.vx, motion.vy));
  motion.vx += (tx - motion.vx) * fv;
  motion.vy += (ty - motion.vy) * fv;
  motion.zoom += (tz - motion.zoom) * f(tz, motion.zoom);
  _qPrev.copy(_q); _pPrev.copy(_p); motion.t = now; motion.lz = lz; motion.lf = lf;
}

const STARBURST_VERTEX = `
  varying vec2 vP;
  void main() {
    vP = uv * 2.0 - 1.0; // 板の座標(-1〜1)
    // 原点をカメラ空間へ送り、板をカメラ側へ向けて広げる(billboard)。大きさはモデル行列のスケール(=m.scale込み)。
    vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
    vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz));
    mv.xy += position.xy * sc;
    gl_Position = projectionMatrix * mv;
  }
`;

const STARBURST_FRAGMENT = `
  uniform vec3 uColor;
  uniform float uTime, uA, uGain, uCoreGain, uSharp, uLen, uRoot, uTaper, uDiag, uSpec, uDisperse;
  uniform vec2 uDir; // 動き(ズームなら放射)の向きと強さ。色ずれの方向
  varying vec2 vP;

  // 横向きの針1本。根本は太く、先へ行くほど細く、先端でちょうど0に収束する。
  float arm(vec2 p, float L, float a) {
    float ax = abs(p.x), ay = abs(p.y);
    float t = clamp(ax / L, 0.0, 1.0);
    float w = a * uRoot * (1.0 - uTaper * t) + 1e-5;
    return pow(1.0 - t, 1.5) / (1.0 + ax / (a * 3.0)) * exp(-ay / w);
  }
  float crossArms(vec2 p, float L, float a) { return arm(p, L, a) + arm(p.yx, L, a); }
  float spikes(vec2 p, float L, float a) {
    vec2 d = vec2(p.x + p.y, p.y - p.x) * 0.70710678;
    return crossArms(p, L, a) + uDiag * crossArms(d, L * 0.5, a);
  }

  void main() {
    vec2 p = vP;
    float a = uA;
    float win = 1.0 - smoothstep(0.85, 1.0, max(abs(p.x), abs(p.y)));

    // 急峻なコア: 高い指数のMoffat + 白く飛ぶ極小の芯
    // 色ずれ(分散): 動きの向きに沿って、赤と青の像を逆向きにずらす。止まっていればuDir=0でずれない。
    vec2 sh = uDir * uDisperse;
    vec2 pr = p - sh, pb = p + sh;

    // 急峻なコア: 高い指数のMoffat + 白く飛ぶ極小の芯(チャンネルごとに位置をずらして評価)
    vec3 rr = vec3(length(pr), length(p), length(pb)) / a;
    vec3 core = uCoreGain * pow(1.0 + (rr / 2.5) * (rr / 2.5), vec3(-uSharp)) + 2.0 * uCoreGain * exp(-rr * rr * 0.12);

    // 分光: 波長ごとに針の長さもずらす(赤は長く、青は短く)。uSpecが0なら全チャンネル同じ=白。
    vec3 s = vec3(spikes(pr, uLen * (1.0 + 0.12 * uSpec), a),
                  spikes(p,  uLen,                        a),
                  spikes(pb, uLen * (1.0 - 0.12 * uSpec), a));

    // 先端のちらつく虹色(針の先ほど強く、針ごと・時間ごとに明滅)
    float u = max(abs(p.x), abs(p.y)) / uLen;
    float id = dot(step(0.0, p), vec2(1.0, 2.0)) + step(abs(p.x), abs(p.y)) * 4.0;
    float fl = (0.55 + 0.45 * sin(uTime * (9.0 + id * 1.7) + u * 30.0 + id * 2.1)) * (0.7 + 0.3 * sin(uTime * 23.0 + id * 5.0));
    float tf = smoothstep(0.2, 0.9, u) * uSpec;
    vec3 rb = 0.5 + 0.5 * cos(6.2831 * (u * 2.5 + uTime * 0.6 + vec3(0.0, 0.33, 0.67)));
    vec3 sc = s * mix(vec3(1.0), rb * 2.2, clamp(tf * fl * 1.3, 0.0, 1.0));

    vec3 c = (core + sc * 0.9) * uColor * win * uGain;
    c = 1.0 - exp(-c); // ソフトクリップ
    if (max(c.r, max(c.g, c.b)) <= 0.0005) discard;
    gl_FragColor = vec4(c, 1.0); // 加算ブレンドで足される
  }
`;

export function createHotspots(scene) {
  const hotspotMeshes = [];
  const hotspotGeo = new THREE.SphereGeometry(0.35, 12, 12);
  const hitGeo = new THREE.SphereGeometry(HOTSPOT_HIT_RADIUS, 12, 12);
  const starburstGeo = new THREE.PlaneGeometry(STARBURST_SPRITE_SIZE, STARBURST_SPRITE_SIZE);

  // 通常のhotspot全員で共有する発光マテリアル(瞬きの位相は頂点ごとのattributeで変える)。
  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(HOTSPOT_COLOR) }, // stars.jsのuColorと同じ渡し方
      uHalo: { value: HOTSPOT_HALO },
      uMaxPoint: { value: HOTSPOT_MAX_POINT },
      uCoreScale: { value: HOTSPOT_CORE_SCALE },
      uGain: { value: HOTSPOT_GAIN },
    },
    vertexShader: HOTSPOT_GLOW_VERTEX,
    fragmentShader: HOTSPOT_GLOW_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const noRaycast = function () {}; // 発光の見た目はクリック判定に参加させない(判定はhitAreaとm本体が担当)

  // 判定の土台になるメッシュ(m本体)は、見た目を描かない(opacityほぼ0)。
  // material.visible=falseだとraycastが環境によって拾わないことがあるため、
  // 他の箇所(yzPanel.mesh / axisStationOverlayのhitArea)と同じくvisible=trueのままopacityをほぼ0にする方式。
  const anchorMat = () => new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false });

  HOTSPOTS.forEach((h, idx) => {
    const isStarburst = h.special === 'starburst';
    const m = new THREE.Mesh(hotspotGeo, anchorMat());
    m.position.set(...h.pos);
    m.userData.texts = h.text;
    // main.js側でstarburstだけを判別するためのタグ(carouselとのつなぎで拡大縮小する対象)。
    if (isStarburst) m.userData.isStarburst = true;

    if (isStarburst) {
      const sbMat = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color(STARBURST_COLOR) },
          uTime: { value: 0 },
          uA: { value: STARBURST_CORE },
          uGain: { value: STARBURST_GAIN },
          uCoreGain: { value: STARBURST_CORE_GAIN },
          uSharp: { value: STARBURST_SHARP },
          uLen: { value: STARBURST_LEN },
          uRoot: { value: STARBURST_ROOT },
          uTaper: { value: STARBURST_TAPER },
          uDiag: { value: STARBURST_DIAG },
          uSpec: { value: STARBURST_SPEC_REST },
          uDisperse: { value: STARBURST_DISPERSION },
          uDir: { value: new THREE.Vector2() },
        },
        vertexShader: STARBURST_VERTEX,
        fragmentShader: STARBURST_FRAGMENT,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Mesh(starburstGeo, sbMat);
      glow.frustumCulled = false; // 頂点シェーダーで板を広げるので、ジオメトリの境界では判定できない
      glow.raycast = noRaycast;
      // カメラの動き量に応じてスペクトルを出す(cameraはonBeforeRenderの引数で受け取るので、main.jsの変更は不要)。
      glow.onBeforeRender = (renderer, scene_, camera) => {
        const now = performance.now() * 0.001;
        updateMotion(camera, now);
        sbMat.uniforms.uTime.value = now;
        // 色ずれの向き = 画面上の流れ + ズーム時の放射(この星の画面位置から外向き。中心の星はずれない)
        _sp.setFromMatrixPosition(m.matrixWorld).project(camera);
        let px = _sp.x, py = _sp.y;
        const pl = Math.hypot(px, py);
        if (pl > 1) { px /= pl; py /= pl; }
        sbMat.uniforms.uDir.value.set(motion.vx + motion.zoom * px, motion.vy + motion.zoom * py);
        const amt = Math.min(Math.hypot(motion.vx, motion.vy) + motion.zoom, 1);
        sbMat.uniforms.uSpec.value = STARBURST_SPEC_REST + (STARBURST_SPEC_MOVE - STARBURST_SPEC_REST) * amt;
      };
      m.add(glow); // 星本体(m)に追従して動き、m.scaleにも従うよう子として追加
      m.userData.glowMaterial = sbMat; // uA / uGain / uLen / uRoot / uSharp などを実行時に調整できるよう公開
    } else {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
      // 瞬きの位相: hotspotごとにずらす(idxを散らした決定論的な値。実行ごとに変わらない)。
      geo.setAttribute('phase', new THREE.BufferAttribute(new Float32Array([(idx * 0.6180339) % 1 * 6.2831]), 1));
      const glow = new THREE.Points(geo, glowMat);
      glow.frustumCulled = false; // 点スプライトはpxで大きさが決まり、境界球に反映されない
      glow.raycast = noRaycast;
      // 時刻はstars側のuTimeと同期させる必要はないので、描画のたびに自前で更新する(main.js側の変更を不要にする)。
      glow.onBeforeRender = () => { glowMat.uniforms.uTime.value = performance.now() * 0.001; };
      m.add(glow);
      m.userData.glowMaterial = glowMat;
    }

    // 判定専用の当たり判定球(見た目にはほぼ影響しないよう、限りなく透明)。
    const hitArea = new THREE.Mesh(hitGeo, anchorMat());
    m.add(hitArea);

    scene.add(m);
    hotspotMeshes.push(m);
  });
  return hotspotMeshes;
}
