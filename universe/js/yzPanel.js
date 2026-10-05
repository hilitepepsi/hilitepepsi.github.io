import * as THREE from 'three';
import { AXIS_LENGTH } from './config.js';

// ── YZ平面パネル(概念Y × 概念Z) ─────────────────────────────
// 概念Y(→world +X)は原点〜先端(全長)、概念Z(→world +Y)も原点〜終端(全長)。
// PlaneGeometryはデフォルトでlocal XY平面(法線+Z)に生成されるため、
// 概念Y×概念Z平面(=world X-Y平面, z=0)とそのまま一致する(回転不要)。
//
// 普段は完全に不可視(存在の気配すら残さない)で、Yステーションにいる間だけ
// マウスを乗せると反射・透明な青いガラスパネルとしてはっきり浮かび上がる。
// クリックすると、原点側の角(world (0,0,0))から波紋が扇状に広がり、
// それに合わせてメインカメラがビリヤード専用ページと同じ位置へ移動、
// 波紋が広がりきったところで画面がビリヤード台へ切り替わる(main.js側で制御)。

const WIDTH  = AXIS_LENGTH;       // 概念Y: 原点 → 先端(全長)
const HEIGHT = AXIS_LENGTH;       // 概念Z: 原点 → 終端(全長)

const BASE_OPACITY  = 0;    // 通常時: 完全に不可視(ホバー時のみHOVER_OPACITYで浮かび上がる)
const HOVER_OPACITY = 0.42; // ホバー時: はっきり見える反射ガラス

// 波紋の速さ(パネル対角線 √(WIDTH²+HEIGHT²) をおよそ1.3秒で走り抜ける速さ)
const RIPPLE_SPEED = Math.sqrt(WIDTH * WIDTH + HEIGHT * HEIGHT) / 1.3;

// クリック/ホバー判定専用の当たり判定エリア。
// パネルの下端(local y=0)は概念Y軸(world X軸)、左端(local x=0)は概念Z軸(world Y軸)と
// 全長にわたって重なっているため、この2辺沿いの帯を判定から除外し、軸から離れた
// 奥側(遠い角=(WIDTH,HEIGHT)側)にだけ正方形の判定エリアを置く。
// AXIS_MARGIN_RATIOを大きくするほど軸際を広く除外する(0〜1の比率)。
const AXIS_MARGIN_RATIO = 0.15;
const HIT_MARGIN_X = WIDTH  * AXIS_MARGIN_RATIO; // 左端(Z軸)からの除外幅
const HIT_MARGIN_Y = HEIGHT * AXIS_MARGIN_RATIO; // 下端(Y軸)からの除外幅
const HIT_WIDTH  = WIDTH  - HIT_MARGIN_X;
const HIT_HEIGHT = HEIGHT - HIT_MARGIN_Y;

export function createYZPanel(scene) {
  const geo = new THREE.PlaneGeometry(WIDTH, HEIGHT);
  geo.translate(WIDTH / 2, HEIGHT / 2, 0); // 原点を角にして、+X(概念Y)・+Y(概念Z)方向へ広がるようにする
  // ↑この translate により、頂点のローカル座標はそのまま world (0,0,0)〜(WIDTH,HEIGHT,0) になる。
  //   つまり「原点側の角」= ローカル座標(0,0) がそのまま波紋の発生源として使える。

  const material = new THREE.MeshPhysicalMaterial({
    color: 0x1d16f5,
    transmission: 0.75,   // ガラス風の透過
    roughness: 0.06,
    thickness: 0.4,
    ior: 1.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.2,
    transparent: true,
    opacity: BASE_OPACITY,
    side: THREE.DoubleSide,
    depthWrite: false,    // 半透明パネル越しに軸や星が自然に透けて見えるように
  });

  const mesh = new THREE.Mesh(geo, material);
  mesh.visible = false; // Yステーションに到達している間だけ表示する(見た目用・raycast対象ではない)
  mesh.renderOrder = 1;
  scene.add(mesh);

  // ── 当たり判定専用メッシュ: Y軸・Z軸が乗る2辺の帯を除いた、パネル奥側の範囲だけをraycast対象にする ──
  // 完全に透明(opacity 0)で見た目には一切影響しない。
  const hitGeo = new THREE.PlaneGeometry(HIT_WIDTH, HIT_HEIGHT);
  // 左端・下端からHIT_MARGIN_X/Yぶん離した位置を起点にして、遠い角(WIDTH,HEIGHT)まで広げる。
  hitGeo.translate(HIT_MARGIN_X + HIT_WIDTH / 2, HIT_MARGIN_Y + HIT_HEIGHT / 2, 0);
  const hitMaterial = new THREE.MeshBasicMaterial({
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
  });
  const hitMesh = new THREE.Mesh(hitGeo, hitMaterial);
  hitMesh.visible = false; // Yステーションに到達している間だけ表示・raycast対象にする
  hitMesh.renderOrder = 1;
  hitMesh.userData.isYZPanel = true; // main.js側のraycast対象はこちらに向ける
  scene.add(hitMesh);

  // ── 波紋レイヤー: 原点側の角(ローカル(0,0))から同心円状に広がる光の輪 ──
  // ベースの反射ガラス(mesh)とは別の薄いオーバーレイとして、加算合成で重ねる。
  const rippleMaterial = new THREE.ShaderMaterial({
    uniforms: {
      uTime:        { value: 0 },
      uRippleStart: { value: -999 }, // 発生時刻(この値未満=波紋なし)
      uSpeed:       { value: RIPPLE_SPEED },
    },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.AdditiveBlending,
    vertexShader: `
      varying vec2 vPos;
      void main() {
        vPos = position.xy; // translate済みなので、そのまま原点角からの距離計算に使える
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform float uTime;
      uniform float uRippleStart;
      uniform float uSpeed;
      varying vec2 vPos;

      void main() {
        float age = uTime - uRippleStart;
        if (uRippleStart < -500.0 || age < 0.0) { discard; }

        float d = length(vPos); // 原点側の角からの距離
        float front = uSpeed * age;
        // 広がっていく波面の帯(前後になだらかにフェード)
        float band = smoothstep(front - 1.6, front, d) * (1.0 - smoothstep(front, front + 1.6, d));
        float ring = sin(d * 1.3 - age * uSpeed * 1.3) * 0.5 + 0.5;
        float decay = exp(-1.0 * age); // 時間とともに全体が弱まる

        float alpha = band * (0.4 + ring * 0.6) * decay;
        if (alpha < 0.01) { discard; }

        vec3 col = mix(vec3(0.35, 0.75, 1.0), vec3(0.92, 0.97, 1.0), ring);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
  const rippleMesh = new THREE.Mesh(geo, rippleMaterial);
  rippleMesh.position.z = 0.02; // ベースパネルよりわずかに手前(zファイティング回避)
  rippleMesh.visible = false;
  rippleMesh.renderOrder = 2;
  scene.add(rippleMesh);

  let active = false;  // 現在Yステーションを見ているか(main.js側から切り替える)
  let hovered = false;
  let opacityTween = null;

  function tweenOpacity(target, duration = 0.5) {
    if (opacityTween) opacityTween.kill();
    opacityTween = gsap.to(material, { opacity: target, duration, ease: 'power2.out' });
  }

  // setActive(true): Yステーションに到達 → パネルを表示・判定対象にする(見た目はBASE_OPACITYから)
  // setActive(false): 他の軸へ移動/離脱 → 判定を外し、状態をリセットして隠す
  function setActive(isActive) {
    if (active === isActive) return;
    active = isActive;
    hovered = false;
    if (opacityTween) opacityTween.kill();
    rippleMaterial.uniforms.uRippleStart.value = -999; // 波紋もリセット
    if (active) {
      material.opacity = BASE_OPACITY;
      mesh.visible = true;
      hitMesh.visible = true;
      rippleMesh.visible = true;
    } else {
      material.opacity = BASE_OPACITY;
      mesh.visible = false;
      hitMesh.visible = false;
      rippleMesh.visible = false;
    }
  }

  function setHovered(isHovered) {
    if (!active || isHovered === hovered) return;
    hovered = isHovered;
    tweenOpacity(hovered ? HOVER_OPACITY : BASE_OPACITY);
  }

  // クリック時に呼ぶ: 原点側の角から波紋を発生させる(elapsedTimeはmain.jsのclockと同じ基準の秒数)
  function ripple(elapsedTime) {
    if (!active) return;
    rippleMaterial.uniforms.uRippleStart.value = elapsedTime;
  }

  // 毎フレーム呼ぶ: 波紋シェーダーの時間を進める
  function update(elapsedTime) {
    rippleMaterial.uniforms.uTime.value = elapsedTime;
  }

  return {
    mesh,
    hitMesh,
    setActive,
    setHovered,
    ripple,
    update,
    isActive: () => active,
    isHovered: () => hovered,
  };
}