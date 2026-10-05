import * as THREE from 'three';
import { AXIS_LENGTH, AXIS_WORLD_DIR } from './config.js';

// ── Z軸: 時間発展するガウス波束を複素平面上のらせんとして描く ──────────────
//
// 移植元: ユーザー提供の "Wave Packet Helix" (Three.js r128版, スタンドアロンHTML)
//   Ψ(x,t) = exp(-(x - v_g t)^2 / 2σ^2) · exp(i k0 (x - v_p t))
//   ω0 = ħ k0^2 / (2m),  v_p = ω0/k0 (位相速度),  v_g = ħ k0/m (群速度)
// envelope(包絡線)は群速度v_gで並進し、carrier(位相)は位相速度v_pで並進する。
// 自由粒子の分散関係(ω=ħk²/2m)では v_g = 2 v_p になるため、
// 波束の中を位相(らせんの巻き)がすり抜けていくように見える ── これが元HTMLの動きの本体。
// パラメータは固定(調整UIは無し): k0=3, σ=3, m=1, speed=1, ħ=1。
// projections(Re/Im平面への投影線)は表示しない。複素螺旋(フルヘリックス)のみ描画する。
//
// 実部・虚部は軸に直交する2方向に展開する(real=world+X, imag=world+Z)。
// xは軸方向(world+Y、このシーンでの「Z軸」)にとり、原点(x=0)から先端(x=AXIS_LENGTH)までを
// そのままワールド座標として使う(元HTMLのx軸と1:1)。

const HBAR = 1;
const K0 = 8;
const SIGMA = 3;
const M = 1;
const SPEED = 0.2;
const SEGMENTS = 500;
const AMP = 6; // 振幅(表示半径)のスケール。元HTMLのAMP=4.0を、このシーンの軸の太さに合わせて調整

const OMEGA0 = (HBAR * K0 * K0) / (2 * M);
const VP = OMEGA0 / K0;      // 位相速度
const VG = (HBAR * K0) / M;  // 群速度(自由粒子なのでVP*2に一致する)

// 波束が軸の外(原点の手前 / 先端の先)で発生・消滅するように、見えない範囲までマージンを取って
// ループさせる(境界での「ジャンプ」を、振幅がほぼ0になる領域に隠す)
const MARGIN = 3 * SIGMA;
const SWEEP = AXIS_LENGTH + 2 * MARGIN;   // 並進する範囲: -MARGIN 〜 AXIS_LENGTH+MARGIN
const PERIOD = SWEEP / VG;                  // 1周にかかる時間(秒)

const _tmpColor = new THREE.Color();
function phaseColor(phase, envelope, out) {
  const hue = (((phase / (Math.PI * 2)) % 1) + 1) % 1;
  const lightness = THREE.MathUtils.lerp(0.12, 0.62, THREE.MathUtils.clamp(envelope, 0, 1));
  out.setHSL(hue, 0.85, lightness);
  return out;
}

export function createZAxisWave(scene) {
  const growDir = AXIS_WORLD_DIR.Z.clone().normalize(); // 伝播方向(world +Y = 概念Z軸)
  // 軸に直交する2方向。Zステーションのカメラ演出(axisCamera.js)のup/sideDirと揃えて、
  // 画面上で「奥行き=実部・縦=虚部」の螺旋として自然に見えるようにする。
  const realDir = new THREE.Vector3(1, 0, 0);
  const imagDir = new THREE.Vector3(0, 0, 1);

  const sArr = new Float32Array(SEGMENTS); // 軸上のワールド座標=物理x(1:1対応)
  for (let i = 0; i < SEGMENTS; i++) {
    sArr[i] = (i / (SEGMENTS - 1)) * AXIS_LENGTH;
  }

  const positions = new Float32Array(SEGMENTS * 3);
  const colors = new Float32Array(SEGMENTS * 3);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3).setUsage(THREE.DynamicDrawUsage));

  const material = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0,
  });

  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false; // 毎フレーム全頂点を書き換えるため、bounding sphere陳腐化によるカリング落ちを防ぐ
  line.visible = false;
  scene.add(line);

  let targetOpacity = 0;
  let playStart = null; // このらせんの「t=0」に対応するupdate()側のelapsed値(表示開始時に確定)
  const p = new THREE.Vector3();

  // update(elapsed): 表示開始からの経過時間で波束を時間発展させ、毎フレーム頂点を再計算する
  function update(elapsed) {
    if (!line.visible) return;
    if (playStart === null) playStart = elapsed; // 表示され始めたタイミングをt=0として波束を最初から再生

    const tRaw = (elapsed - playStart) * SPEED;
    const tLoop = tRaw % PERIOD;
    const tEff = tLoop - MARGIN / VG; // -MARGIN/VG 〜 (AXIS_LENGTH+MARGIN)/VG まで滑らかに変化

    const posAttr = geometry.attributes.position;
    const colAttr = geometry.attributes.color;

    for (let i = 0; i < SEGMENTS; i++) {
      const x = sArr[i];
      const envelope = Math.exp(-((x - VG * tEff) ** 2) / (2 * SIGMA * SIGMA));
      const phase = K0 * (x - VP * tEff);
      const re = AMP * envelope * Math.cos(phase);
      const im = AMP * envelope * Math.sin(phase);

      p.copy(growDir).multiplyScalar(x)
        .addScaledVector(realDir, re)
        .addScaledVector(imagDir, im);
      posAttr.setXYZ(i, p.x, p.y, p.z);

      phaseColor(phase, envelope, _tmpColor);
      colAttr.setXYZ(i, _tmpColor.r, _tmpColor.g, _tmpColor.b);
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;

    material.opacity = 0.95 * targetOpacity;
  }

  // reveal(t): t=0→1でフェードイン。表示開始と同時に波束の時間発展を最初(原点の手前)から再生し直す
  function reveal(t) {
    line.visible = true;
    targetOpacity = THREE.MathUtils.clamp(t, 0, 1);
  }

  function reset() {
    targetOpacity = 0;
    playStart = null; // 次にreveal()されたとき、また最初から流れるようにする
    line.visible = false;
    material.opacity = 0;
  }

  return { line, reveal, reset, update };
}
