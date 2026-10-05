import * as THREE from 'three';

// ════════════════════════════════════════════════════════════════
// ── 波面加工エフェクト: 雨粒の波紋 + 屈折のみの合成 ──────────────
// ════════════════════════════════════════════════════════════════
//
// 目的:
//   黒背景+ブラーのかかった数式pngのシーンに、「雨が水面に降って波紋が
//   広がる」ような屈折歪みだけをかける(水面のマテリアル感=ハイライト・
//   色味・泡などは一切足さない。あくまで「向こう側の絵をどれだけ歪めて
//   見せるか」だけ)。
//
// インタラクション設計:
//   ・雨(波紋の発生源)は常時ごく弱く降り続ける(ambient)。
//   ・スクロール操作の"速度のブレ"を常時計測し、ブレが小さい
//     (=一定速度でスクロールできている)ほど「水面が落ち着く」
//     (雨の発生頻度が下がり、屈折の強さも弱まり、波の減衰も強くなる)。
//     急に止まる/急加速する/向きを変える、といった雑な操作をすると
//     即座に水面が乱れ、数式が読みにくくなる。
//     → 「丁寧に一定速度で操作し続けないと数式が見えてこない」という
//       繊細さを意図的に要求する。
//   ・スクロールの速さそのもの(絶対値)は、GSAPアニメーションの再生速度
//     (gsap.globalTimeline.timeScale)に反映する。速くスクロールする
//     ほど①→②→③→④の遷移が速く進み、止まればほぼ止まる。
//
// 実装方式:
//   ・数式シーン(THREE.Scene)は一度オフスクリーンのcontentTargetへ描画する。
//   ・波面は「高さ場(height field)」を低解像度のping-pong
//     RenderTargetでシミュレーションする(離散波動方程式)。
//     雨粒は高さ場へのガウシアン状インパルス加算(加算ブレンドの
//     フルスクリーンstampパス)として実装する。
//   ・最終合成パスでは、高さ場の勾配(中心差分)をUVオフセットとして
//     contentTargetをサンプルし直すだけ(=純粋な屈折。反射・specular・
//     色付けなし)。
//
// 使い方(概略。実際のrenderer/scene/cameraは既存コードのものを渡す):
//
//   import { RippleRefractionField, attachScrollDrivenRain } from './waveSurface.js';
//
//   const wave = new RippleRefractionField({ renderer, scene, camera });
//   attachScrollDrivenRain({ field: wave });
//
//   function animate(nowMs) {
//     const dt = clock.getDelta();
//     wave.update(dt);   // 波面シミュレーション+雨粒生成
//     wave.render();     // scene→content→屈折合成→画面 の一連を実行
//     requestAnimationFrame(animate);
//   }
//
//   ※ 既存コード側で毎フレーム呼んでいた `renderer.render(scene, camera)` は
//     wave.render() に置き換える(内部で同等のことをしたうえで屈折をかける)。
//   ※ window resize時は wave.setSize(innerWidth, innerHeight) を呼ぶ。

const SIM_RESOLUTION = 256; // 波面シミュレーションの解像度(正方形・軽量優先)。

const PASSTHROUGH_VERT = `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

// 高さ場の伝搬(離散波動方程式)。tPrevのr=高さ, g=速度。
const PROPAGATE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tPrev;
uniform vec2 texel;
uniform float waveSpeed;
uniform float damping;

void main() {
  vec2 c = texture2D(tPrev, vUv).rg;
  float h = c.r;
  float v = c.g;

  float hL = texture2D(tPrev, vUv - vec2(texel.x, 0.0)).r;
  float hR = texture2D(tPrev, vUv + vec2(texel.x, 0.0)).r;
  float hU = texture2D(tPrev, vUv - vec2(0.0, texel.y)).r;
  float hD = texture2D(tPrev, vUv + vec2(0.0, texel.y)).r;

  float lap = (hL + hR + hU + hD) - 4.0 * h;
  v += lap * waveSpeed;
  v *= damping;
  h += v;

  gl_FragColor = vec4(h, v, 0.0, 1.0);
}
`;

// 雨粒1滴 = ガウシアン状インパルスを高さ場へ加算(加算ブレンドで呼び出す)。
const DROP_FRAG = `
precision highp float;
varying vec2 vUv;
uniform vec2 uDropPos;
uniform float uDropRadius;
uniform float uDropStrength;

void main() {
  float d = distance(vUv, uDropPos);
  float falloff = exp(-(d * d) / (2.0 * uDropRadius * uDropRadius));
  gl_FragColor = vec4(uDropStrength * falloff, 0.0, 0.0, 0.0);
}
`;

// 最終合成: 高さ場の勾配でcontentTextureのUVをずらしてサンプルするだけ。
// (=屈折のみ。反射・ハイライト・色味は一切加えない)
const COMPOSITE_FRAG = `
precision highp float;
varying vec2 vUv;
uniform sampler2D tContent;
uniform sampler2D tHeight;
uniform vec2 texel;
uniform float refractionStrength;

void main() {
  float hL = texture2D(tHeight, vUv - vec2(texel.x, 0.0)).r;
  float hR = texture2D(tHeight, vUv + vec2(texel.x, 0.0)).r;
  float hU = texture2D(tHeight, vUv - vec2(0.0, texel.y)).r;
  float hD = texture2D(tHeight, vUv + vec2(0.0, texel.y)).r;

  vec2 gradient = vec2(hR - hL, hD - hU);
  vec2 offsetUv = clamp(vUv + gradient * refractionStrength, 0.0, 1.0);

  gl_FragColor = texture2D(tContent, offsetUv);
}
`;

function makeRenderTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class RippleRefractionField {
  constructor({ renderer, scene, camera, width, height, params = {} }) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;

    // ── 調整パラメータ(すべてscrollのsteadinessで動的に変化させる) ──
    this.params = Object.assign({
      waveSpeed: 0.18,          // 波の伝搬速度
      damping: 0.992,           // 減衰(1に近いほど波が長く残る)
      baseRainRate: 2.2,        // 常時降り続ける雨(滴/秒)。ambient分。
      dropRadius: 0.02,         // 1滴の広がり(UV空間)
      dropStrength: 0.9,        // 1滴の強さ
      refractionStrength: 0.06, // 屈折の強さ(UVオフセット係数)
    }, params);

    // steadiness(0=乱雑, 1=一定速度で丁寧に操作できている)で
    // どこまで水面を落ち着かせられるか、の上限倍率。
    this.calmFactor = {
      rain: 0.92,        // 雨量を最大92%まで減らせる
      refraction: 0.85,  // 屈折強度を最大85%まで減らせる
      damping: 0.006,    // dampingを最大+0.006(=1に近づく=波が残りにくくなる)
      waveSpeed: 0.5,    // waveSpeedを最大50%まで落とせる(波が穏やかになる)
    };

    this.steadiness = 0; // 外部(attachScrollDrivenRain)から更新される 0..1
    this._dropAccumulator = 0;

    const w = width || renderer.domElement.width;
    const h = height || renderer.domElement.height;

    this.contentTarget = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });

    this.stateA = makeRenderTarget(SIM_RESOLUTION);
    this.stateB = makeRenderTarget(SIM_RESOLUTION);
    const texel = new THREE.Vector2(1 / SIM_RESOLUTION, 1 / SIM_RESOLUTION);

    // フルスクリーンパス共通のシーン/カメラ/メッシュ(マテリアルだけ差し替える)。
    this._fsCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this._fsScene = new THREE.Scene();
    this._fsMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
    this._fsScene.add(this._fsMesh);

    this._propagateMat = new THREE.ShaderMaterial({
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: PROPAGATE_FRAG,
      uniforms: {
        tPrev: { value: null },
        texel: { value: texel },
        waveSpeed: { value: this.params.waveSpeed },
        damping: { value: this.params.damping },
      },
      depthTest: false,
      depthWrite: false,
    });

    this._dropMat = new THREE.ShaderMaterial({
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: DROP_FRAG,
      uniforms: {
        uDropPos: { value: new THREE.Vector2(0.5, 0.5) },
        uDropRadius: { value: this.params.dropRadius },
        uDropStrength: { value: this.params.dropStrength },
      },
      transparent: true,
      depthTest: false,
      depthWrite: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneFactor,
    });

    this._compositeMat = new THREE.ShaderMaterial({
      vertexShader: PASSTHROUGH_VERT,
      fragmentShader: COMPOSITE_FRAG,
      uniforms: {
        tContent: { value: this.contentTarget.texture },
        tHeight: { value: this.stateA.texture },
        texel: { value: texel },
        refractionStrength: { value: this.params.refractionStrength },
      },
      depthTest: false,
      depthWrite: false,
    });
  }

  setSize(width, height) {
    this.contentTarget.setSize(width, height);
  }

  // steadiness: 0(乱雑な操作)〜1(一定速度で丁寧に操作できている)。
  // attachScrollDrivenRainから毎フレーム呼ばれる想定。
  setSteadiness(steadiness) {
    this.steadiness = THREE.MathUtils.clamp(steadiness, 0, 1);
  }

  update(dt) {
    const s = this.steadiness;
    const p = this.params;
    const c = this.calmFactor;

    const rainRate = p.baseRainRate * (1 - s * c.rain);
    const waveSpeed = p.waveSpeed * (1 - s * c.waveSpeed);
    const damping = Math.min(0.999, p.damping + s * c.damping);
    const refractionStrength = p.refractionStrength * (1 - s * c.refraction);

    this._propagateMat.uniforms.waveSpeed.value = waveSpeed;
    this._propagateMat.uniforms.damping.value = damping;
    this._compositeMat.uniforms.refractionStrength.value = refractionStrength;

    // ── 雨粒スポーン(ポアソン過程を単純な蓄積カウンタで近似) ──
    this._dropAccumulator += rainRate * dt;
    const drops = [];
    while (this._dropAccumulator >= 1) {
      this._dropAccumulator -= 1;
      drops.push({
        x: Math.random(),
        y: Math.random(),
        // 波紋なので基本は「凹み」(負)。まれに大粒(強め)を混ぜて単調さを消す。
        strength: -p.dropStrength * (0.5 + Math.random() * (Math.random() < 0.12 ? 1.6 : 0.6)),
        radius: p.dropRadius * (0.7 + Math.random() * 0.6),
      });
    }

    // ── 1) 伝搬パス: stateA → stateB ──
    const renderer = this.renderer;
    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;

    this._propagateMat.uniforms.tPrev.value = this.stateA.texture;
    this._fsMesh.material = this._propagateMat;
    renderer.setRenderTarget(this.stateB);
    renderer.autoClear = true;
    renderer.render(this._fsScene, this._fsCamera);

    // ── 2) 雨粒スタンプ(加算ブレンドでstateBへ追加) ──
    if (drops.length) {
      renderer.autoClear = false;
      this._fsMesh.material = this._dropMat;
      for (const d of drops) {
        this._dropMat.uniforms.uDropPos.value.set(d.x, d.y);
        this._dropMat.uniforms.uDropRadius.value = d.radius;
        this._dropMat.uniforms.uDropStrength.value = d.strength;
        renderer.render(this._fsScene, this._fsCamera);
      }
    }

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);

    // swap
    const tmp = this.stateA;
    this.stateA = this.stateB;
    this.stateB = tmp;
    this._compositeMat.uniforms.tHeight.value = this.stateA.texture;
  }

  // シーン描画 → 屈折合成 → 画面、をまとめて行う。
  // 既存コードの `renderer.render(scene, camera)` の代わりに毎フレーム呼ぶ。
  render() {
    const renderer = this.renderer;

    renderer.setRenderTarget(this.contentTarget);
    renderer.clear();
    renderer.render(this.scene, this.camera);

    this._fsMesh.material = this._compositeMat;
    renderer.setRenderTarget(null);
    renderer.clear();
    renderer.render(this._fsScene, this._fsCamera);
  }
}

// ════════════════════════════════════════════════════════════════
// ── スクロール操作 → 「一定速度ならsteadiness↑」「速さ→再生速度」 ──
// ════════════════════════════════════════════════════════════════
//
// steadinessの考え方:
//   ・EMA(指数移動平均)で「今の速さ」を追いかける(emaSpeed)。
//   ・「今の速さ」と「その一つ前のemaSpeed」の差(=速度の変化量=ブレ)も
//     EMAで追いかける(emaJitter)。
//   ・steadiness = 1 / (1 + emaJitter / (emaSpeed + eps))
//     → 速さが一定(emaJitterが小さい)ほど1に近づく。
//     → スクロールを止める/急変させるとemaJitterが跳ね上がりsteadiness↓。
//   ・スクロールしていない間はsteadinessを0へ減衰させる
//     (「操作をやめれば静かになる」ではなく、「操作し続けて初めて
//     落ち着かせられる」という、要望どおりの繊細さにするため)。
//
// 再生速度の考え方:
//   ・emaSpeedを正規化してgsap.globalTimeline.timeScale()に渡す。
//   ・スクロールしていない間は既定の低速(ほぼ停止)に戻す。
export function attachScrollDrivenRain({
  field,
  target = window,
  minTimeScale = 0.05,
  maxTimeScale = 2.5,
  idleTimeScale = 0.05,
  speedNormalizer = 60, // この量のdeltaYで正規化速度=1相当とみなす(要実測調整)
} = {}) {
  let emaSpeed = 0;
  let emaJitter = 0;
  let lastEventTime = performance.now();

  const SPEED_ALPHA = 0.25;
  const JITTER_ALPHA = 0.2;
  const IDLE_DECAY_PER_MS = 0.0025; // 無操作時、steadiness/speedをこの速さで0へ減衰

  function onWheel(e) {
    const now = performance.now();
    lastEventTime = now;

    const rawSpeed = Math.min(4, Math.abs(e.deltaY) / speedNormalizer);
    const prevEma = emaSpeed;
    emaSpeed += (rawSpeed - emaSpeed) * SPEED_ALPHA;

    const change = Math.abs(emaSpeed - prevEma);
    emaJitter += (change - emaJitter) * JITTER_ALPHA;

    const steadiness = 1 / (1 + emaJitter / (emaSpeed + 0.01));
    field.setSteadiness(steadiness);

    const norm = THREE.MathUtils.clamp(emaSpeed, 0, 1);
    const timeScale = THREE.MathUtils.lerp(minTimeScale, maxTimeScale, norm);
    if (typeof gsap !== 'undefined') {
      gsap.globalTimeline.timeScale(timeScale);
    }
  }

  // 無操作が続く間は、speed/steadinessをゆっくりidle値へ戻す。
  // (呼び出し側のrAFループから毎フレーム呼んでもよいし、setIntervalでも可)
  function tickIdleDecay() {
    const idleMs = performance.now() - lastEventTime;
    if (idleMs > 80) {
      const decay = Math.min(1, IDLE_DECAY_PER_MS * (idleMs - 80));
      emaSpeed *= (1 - decay * 0.1);
      emaJitter *= (1 - decay * 0.1);
      field.setSteadiness(field.steadiness * (1 - decay * 0.2));
      if (typeof gsap !== 'undefined') {
        const current = gsap.globalTimeline.timeScale();
        gsap.globalTimeline.timeScale(THREE.MathUtils.lerp(current, idleTimeScale, decay * 0.05));
      }
    }
  }

  target.addEventListener('wheel', onWheel, { passive: true });

  // タッチ操作の簡易対応(touchmoveの縦方向差分をdeltaY相当として扱う)。
  let lastTouchY = null;
  function onTouchStart(e) { lastTouchY = e.touches[0]?.clientY ?? null; }
  function onTouchMove(e) {
    if (lastTouchY == null) return;
    const y = e.touches[0]?.clientY ?? lastTouchY;
    const deltaY = (lastTouchY - y) * 1.5; // 感度調整
    lastTouchY = y;
    onWheel({ deltaY });
  }
  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: true });

  return {
    tickIdleDecay,
    dispose() {
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchmove', onTouchMove);
    },
  };
}
