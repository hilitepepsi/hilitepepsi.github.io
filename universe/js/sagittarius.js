import * as THREE from 'three';

// ── 射手座(「ティーポット」型のアステリズムを星+線で表現) ──
// 中心(ARCHER_POS)からのオフセットで各星を配置。500スケールの奥行きでも
// くっきり読み取れるよう、頂点間の間隔を大きめ(数十単位)に取っている。
//
// セリフは星ごとではなく、この星座全体に1つだけ(main.js側でdialogue.showする固定文言)。
// どの星をクリックしても、射手座全体(星+線)を消してそのセリフを表示する。
//
// ★ 2026-10-28 変更: 星の発光は「星の発光表現ラボ」の「6 色ずれハロー」に変更した。
//   Bloomには頼らず(main.js側でexcludeFromBloom済み)、点スプライト自身に描く。
//   RGBで裾の広さを変える(R<G<B)ので、芯は白く、外側ほどR→Gの順に消えて青く色づく。
//     v_c = (1 + (r/w_c)²)^-β   (c = R,G,B。w_c が各色の広がり)
//   ・見た目の星(丸いメッシュ)は廃止し、Points 1つにまとめた。
//   ・クリック判定は従来どおり、各星に付けた透明な当たり判定球(hitArea)で行う。
const SAGITTARIUS_SHAPE = [
  [  0,  20,   0 ], // 0 蓋
  [-12,  0,   4 ], // 1 右肩
  [-28,  -1,   0 ], // 2 右のティーポットの口（Alnasl)
  [-11, -24,  -3 ], // 3 右(底)
  [ 30, -13,   3 ], // 4 左下(底)
  [ 40,  -5,   0 ], // 5 左端下
  [ 28,   8,  -4 ], // 6 左端上
  [18,   7,   5 ], // 左肩
  [-19,   52,   5 ],  //弓の上
  [-19,   -37,   5 ], //弓の下
];
const SAGITTARIUS_EDGES = [
  [0,1], [1,2], [2,3], [3,4], [4,5], [5,6], [6,7], [7,0], [4,7], // 本体の輪郭+注ぎ口
  [1,7], [1,3],                                     // 持ち手
];

// hotspots.jsのHOTSPOT_HIT_RADIUSと同じ考え方: 見た目のサイズ(1.1)のままだと
// 画面上でクリックするのがほぼ不可能なので、判定専用の大きな透明球を子として追加する。
// 星同士の間隔(数十単位)より狭くして、隣の星の判定と重ならないようにしてある。
const SAGITTARIUS_HIT_RADIUS = 6;

// ── 色ずれハローのパラメータ(ラボの「6 色ずれハロー」と同じ値) ──
const HALO_WIDTH_RGB = [0.16, 0.24, 0.38]; // R,G,Bの裾の広がり(Gを基準に比だけ使う)
const HALO_BETA = 1.3;                     // 裾の重さ(小さいほど裾が長い)
const HALO_GAIN = 1.3;                     // 芯の強さ
const HALO_TINT = [0.7525, 0.8515, 1.0];   // ラボの既定色(色相0.6)を混ぜた色
const HALO_SIZE = 10;       // 芯の直径(px) = この値 × 300 / 奥行き(stars.jsと同じ距離換算)
const HALO_SPRITE_RATIO = 8; // スプライト直径 = 芯の直径 × この値(大きいほど裾が遠くまで伸びる)
const HALO_MAX_POINT = 128;  // gl_PointSizeの上限(px)

const HALO_VERTEX = `
  uniform float uSize;
  uniform float uHalo;
  uniform float uMaxPoint;
  varying float vCore;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    // 芯の直径(px)。stars.jsと同じく 300/奥行き で距離に応じて縮め、下限は3px。
    float core = max(uSize * 300.0 / -mv.z, 3.0);
    // スプライトは芯より大きく取り、裾を描く余白にする。上限で切られても比率は保つ。
    float sprite = min(core * uHalo, uMaxPoint);
    vCore = min(core / sprite, 0.5);
    gl_PointSize = sprite;
    gl_Position = projectionMatrix * mv;
  }
`;

const HALO_FRAGMENT = `
  uniform vec3 uTint;
  uniform vec3 uWidth;
  uniform float uBeta;
  uniform float uGain;
  uniform float uOpacity;
  varying float vCore;
  void main() {
    // r: スプライト中心からの距離(0=中心, 1=内接円の縁)
    float r = length(gl_PointCoord - vec2(0.5)) * 2.0;
    if (r >= 1.0) discard;

    // R,G,Bで広がりを変えたMoffat。Gの広がりを芯の半径(vCore)に合わせ、R・Bはその比で決まる。
    vec3 w = vCore * (uWidth / uWidth.y);
    vec3 q = pow(1.0 + (r * r) / (w * w), vec3(-uBeta));
    // スプライトの縁で裾がぷつっと切れないよう、外側で滑らかに0へ落とす。
    q *= 1.0 - smoothstep(0.3, 1.0, r);

    vec3 c = q * uGain * uTint * uOpacity;
    if (max(c.r, max(c.g, c.b)) <= 0.0002) discard;
    // 加算ブレンド用に、明るさは色へ掛け込み済み(alphaは1)。
    gl_FragColor = vec4(c, 1.0);
  }
`;

export function createSagittarius(scene, center) {
  const group = new THREE.Group();
  group.position.copy(center);

  // 見た目は下のPoints(色ずれハロー)が担当するので、星のメッシュは「クリック判定の土台」としてだけ残す。
  // 判定球と同じく、visible=trueのままopacityをほぼ0にする方式
  // (material.visible=falseだと環境によってraycastが拾わないことがあるため)。
  const starMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false });
  const starGeo = new THREE.SphereGeometry(1.1, 12, 12);
  const hitGeo = new THREE.SphereGeometry(SAGITTARIUS_HIT_RADIUS, 12, 12);

  const stars = SAGITTARIUS_SHAPE.map(([x, y, z]) => {
    const s = new THREE.Mesh(starGeo, starMat);
    s.position.set(x, y, z);

    // 判定専用の当たり判定球(hotspots.jsのhitAreaと同じ方式)。
    const hitArea = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
    );
    s.add(hitArea);

    group.add(s);
    return s;
  });

  // ── 星の見た目: 色ずれハロー(点スプライト) ──
  const glowPos = new Float32Array(SAGITTARIUS_SHAPE.length * 3);
  SAGITTARIUS_SHAPE.forEach(([x, y, z], i) => {
    glowPos[i * 3] = x;
    glowPos[i * 3 + 1] = y;
    glowPos[i * 3 + 2] = z;
  });
  const glowGeo = new THREE.BufferGeometry();
  glowGeo.setAttribute('position', new THREE.BufferAttribute(glowPos, 3));

  const glowMat = new THREE.ShaderMaterial({
    uniforms: {
      uSize: { value: HALO_SIZE },
      uHalo: { value: HALO_SPRITE_RATIO },
      uMaxPoint: { value: HALO_MAX_POINT },
      uTint: { value: new THREE.Vector3(...HALO_TINT) },
      uWidth: { value: new THREE.Vector3(...HALO_WIDTH_RGB) },
      uBeta: { value: HALO_BETA },
      uGain: { value: HALO_GAIN },
      uOpacity: { value: 1 },
    },
    vertexShader: HALO_VERTEX,
    fragmentShader: HALO_FRAGMENT,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  // ShaderMaterialのopacityは何にも使われないので、外から material.opacity を動かす
  // (gsapでのフェードなど)とuOpacityに効くようにしておく。
  Object.defineProperty(glowMat, 'opacity', {
    get() { return glowMat.uniforms.uOpacity.value; },
    set(v) { glowMat.uniforms.uOpacity.value = v; },
    configurable: true,
  });

  const glow = new THREE.Points(glowGeo, glowMat);
  // 点スプライトは画面上のpxで大きさが決まり、bounding sphereに反映されない。
  // 画面端でスプライトごと消えないよう、カリングは切る。
  glow.frustumCulled = false;
  group.add(glow);

  const linePts = [];
  SAGITTARIUS_EDGES.forEach(([a, b]) => linePts.push(stars[a].position, stars[b].position));
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(linePts),
    new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.4 })
  );
  group.add(lines);

  scene.add(group);
  group.userData.stars = stars; // ← main.js側のクリック判定(raycast対象)に使う
  group.userData.glowMaterial = glowMat; // uSize / uHalo / uGain などを実行時に調整できるよう公開
  return group;
}
