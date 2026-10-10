import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

// ════════════════════════════════════════════════════════════════
// ── 波面加工パス: 雨粒の波紋 + 屈折のみの合成(EffectComposer用Pass) ──
// ════════════════════════════════════════════════════════════════
//
// sceneSetup.jsの既存パイプライン(RenderPass → mixPass(Bloom合成) → ★ここ★ →
// OutputPass)に差し込む前提。readBuffer(=直前のパスまでの完成画像。Bloom合成済み)
// をそのまま「向こう側の絵」として使い、波面の高さ場勾配でUVをずらしてサンプルし
// 直すだけ(反射・ハイライト・色味は一切加えない。屈折のみ)。
//
// これにより:
//   ・phase3.js(数式の配置・アニメ)は一切関知しない/変更不要。
//   ・Bloom(selective bloom)の仕組みにも触れない。単にBloom後の絵をさらに歪めるだけ。
//
// 雨粒(波紋の発生源)は常時ごく弱く降り続け、スクロール操作の蓄積量(disturbance,
// 0〜1)を外から setDisturbance() で渡すと、それに応じて雨量・屈折強度・波の
// 減衰を連続的に変化させる。disturbanceをどう作るかは
// 完全に外部(attachScrollDrivenRain、または今後別の実装)に切り出してあるので、
// 「スクロールで雨が降り出し静止で止む」「アニメ進行中は強制的に見えなくする」
// といった案への変更は、この後ろにあるattachScrollDrivenRain(または呼び出し側)
// だけを差し替えれば済み、パス本体(シミュレーション部分)には触れずに済む設計。

const MAX_DROPS_PER_FRAME = 24; // 1フレームに打つ雨粒の上限(描画コール数の天井)
const SIM_RESOLUTION = 320; // 波面シミュレーションの解像度(正方形)。雨量を増やした分、解像度も少し上げて粒立ちを保つ。

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
  // 雨は凹み(負)しか足さないのでhが際限なく沈む → 少しリークさせる。clampは発散の保険。
  h = clamp((h + v) * 0.98, -8.0, 8.0);
  v = clamp(v, -2.0, 2.0);

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

// 最終合成: 高さ場の勾配でreadBuffer(=直前のパスまでの完成画像)のUVをずらして
// サンプルするだけ。(=屈折のみ。反射・ハイライト・色味は一切加えない)
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
  vec2 offset = gradient * refractionStrength;
  offset *= min(1.0, 0.1 / max(length(offset), 1e-5)); // 最大でも画面の10%までしかずらさない
  vec2 offsetUv = clamp(vUv + offset, 0.0, 1.0);

  gl_FragColor = texture2D(tContent, offsetUv);
}
`;

function makeStateTarget(size) {
  return new THREE.WebGLRenderTarget(size, size, {
    type: THREE.HalfFloatType,
    format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter,
    magFilter: THREE.LinearFilter,
    depthBuffer: false,
    stencilBuffer: false,
  });
}

export class RippleRefractionPass extends Pass {
  constructor(params = {}) {
    super();
    this.needsSwap = true; // 結果をwriteBufferへ書き、次のパス(OutputPass)が読む

    // ── 調整パラメータ(すべてdisturbanceで動的に変化させる) ──
    this.params = Object.assign({
      waveSpeed: 0.42,          // 波の伝搬速度
      damping: 0.9,            // 減衰(1に近いほど波が長く残る)。
      baseRainRate: 16,         // 常時降り続ける雨(滴/秒)。★大幅増量。画面をしっかり乱す。
      dropRadius: 0.016,        // 1滴の広がり(UV空間)。雨量を増やした分、粒が潰れないよう少し小さめに。
      dropStrength: 3.1,        // 1滴の強さ
      refractionStrength: 0.16, // 屈折の強さ(UVオフセット係数)。★大幅増量。
    }, params);

    // disturbance(0=デフォルト/スクロールしていない状態, 1=スクロールを蓄積して最大まで
    // 荒れた状態)で、baseRainRate等の"上"にどれだけ上乗せするかの倍率。
    // ★ 以前は「一定速度で丁寧に操作するほど落ち着く(calmFactor, 減算方向)」だったが、
    //   今回の変更で「スクロールを蓄積するほど荒れる(boostFactor, 加算方向)」に反転した。
    //   disturbance=0のとき(=スクロールしていないデフォルト状態)は、これまで通りの
    //   baseRainRate等がそのまま使われ、見た目は変化しない。
    // ★ waveSpeedは上げない: 離散波動方程式の安定条件 waveSpeed ≦ (1+d)/(4d) ≒ 0.53 (d=damping)
    //   を超えると発散→HalfFloatがInf/NaNになり画面が壊れる。これが「バグる」原因だった。
    this.boostFactor = {
      rain: 24,         // 最大でbaseRainRateの25倍(16→400滴/秒 = 土砂降り)
      refraction: 1.1,  // 最大でrefractionStrengthの+110%(=2.1倍)
    };

    this.disturbance = 0; // 外部(attachScrollDrivenRain)から setDisturbance() で更新。0=デフォルト。
    this._dropAccumulator = 0;
    this._lastTime = null;

    this.stateA = makeStateTarget(SIM_RESOLUTION);
    this.stateB = makeStateTarget(SIM_RESOLUTION);
    const texel = new THREE.Vector2(1 / SIM_RESOLUTION, 1 / SIM_RESOLUTION);

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
        tContent: { value: null }, // render()毎にreadBuffer.textureを渡す
        tHeight: { value: this.stateA.texture },
        texel: { value: texel },
        refractionStrength: { value: this.params.refractionStrength },
      },
      depthTest: false,
      depthWrite: false,
    });

    this._quad = new FullScreenQuad(this._propagateMat);
  }

  // disturbance: 0(スクロールしていないデフォルト状態)〜1(スクロールを蓄積して最大に荒れた状態)。
  setDisturbance(disturbance) {
    this.disturbance = THREE.MathUtils.clamp(disturbance, 0, 1);
  }

  // 高さ場を完全にゼロへ戻す。このパスはphase3の間だけenabled=trueにする運用なので、
  // 再度有効化するたびに呼び、「無効化していた間に凍結していた古い波」が
  // 急に見えてしまうのを防ぐ。
  reset(renderer) {
    const prevTarget = renderer.getRenderTarget();
    const prevClearColor = new THREE.Color();
    renderer.getClearColor(prevClearColor);
    const prevClearAlpha = renderer.getClearAlpha();

    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.stateA);
    renderer.clear();
    renderer.setRenderTarget(this.stateB);
    renderer.clear();

    renderer.setClearColor(prevClearColor, prevClearAlpha);
    renderer.setRenderTarget(prevTarget);
    this._dropAccumulator = 0;
    this._lastTime = null;
  }

  dispose() {
    this.stateA.dispose();
    this.stateB.dispose();
    this._propagateMat.dispose();
    this._dropMat.dispose();
    this._compositeMat.dispose();
    this._quad.dispose();
  }

  _stepSimulation(renderer, dt) {
    const s = this.disturbance;
    const p = this.params;
    const b = this.boostFactor;

    const rainRate = p.baseRainRate * (1 + s * b.rain);
    const waveSpeed = p.waveSpeed;
    const damping = p.damping;
    // 雨が増えるほど1滴は弱く(全部が全力だと画面が砂嵐になる)。
    const strengthScale = Math.pow(rainRate / p.baseRainRate, -0.25);
    const refractionStrength = p.refractionStrength * (1 + s * b.refraction);

    this._propagateMat.uniforms.waveSpeed.value = waveSpeed;
    this._propagateMat.uniforms.damping.value = damping;
    this._compositeMat.uniforms.refractionStrength.value = refractionStrength;

    // ── 雨粒スポーン(ポアソン過程を単純な蓄積カウンタで近似) ──
    this._dropAccumulator = Math.min(this._dropAccumulator + rainRate * dt, MAX_DROPS_PER_FRAME);
    const drops = [];
    while (this._dropAccumulator >= 1) {
      this._dropAccumulator -= 1;
      drops.push({
        x: Math.random(),
        y: Math.random(),
        strength: -p.dropStrength * strengthScale * (0.5 + Math.random() * (Math.random() < 0.12 ? 1.6 : 0.6)),
        radius: p.dropRadius * (0.7 + Math.random() * 0.6),
      });
    }

    const prevTarget = renderer.getRenderTarget();
    const prevAutoClear = renderer.autoClear;

    // ── 1) 伝搬パス: stateA → stateB ──
    this._propagateMat.uniforms.tPrev.value = this.stateA.texture;
    this._quad.material = this._propagateMat;
    renderer.setRenderTarget(this.stateB);
    renderer.autoClear = true;
    this._quad.render(renderer);

    // ── 2) 雨粒スタンプ(加算ブレンドでstateBへ追加) ──
    if (drops.length) {
      renderer.autoClear = false;
      this._quad.material = this._dropMat;
      for (const d of drops) {
        this._dropMat.uniforms.uDropPos.value.set(d.x, d.y);
        this._dropMat.uniforms.uDropRadius.value = d.radius;
        this._dropMat.uniforms.uDropStrength.value = d.strength;
        this._quad.render(renderer);
      }
    }

    renderer.autoClear = prevAutoClear;
    renderer.setRenderTarget(prevTarget);

    // swap
    const tmp = this.stateA;
    this.stateA = this.stateB;
    this.stateB = tmp;
  }

  // EffectComposerから毎フレーム呼ばれる。deltaTimeは使わず自前計測する
  // (composer.render()の呼ばれ方に依らず安定させるため)。
  render(renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */) {
    const now = performance.now();
    const dt = this._lastTime != null ? Math.min(0.1, (now - this._lastTime) / 1000) : 1 / 60;
    this._lastTime = now;

    this._stepSimulation(renderer, dt);

    this._compositeMat.uniforms.tContent.value = readBuffer.texture;
    this._compositeMat.uniforms.tHeight.value = this.stateA.texture;
    this._quad.material = this._compositeMat;

    if (this.renderToScreen) {
      renderer.setRenderTarget(null);
    } else {
      renderer.setRenderTarget(writeBuffer);
      if (this.clear) renderer.clear();
    }
    this._quad.render(renderer);
  }
}

// ════════════════════════════════════════════════════════════════
// ── スクロール操作 → 「蓄積するほど雨が増える」「速さ→再生速度」 ──
// ════════════════════════════════════════════════════════════════
// ★ この関数は「今の案」の実装であり、pass本体(RippleRefractionPass)からは
//   独立している。別案に変える場合、この関数の中身(またはこの関数を呼んでいる側)
//   だけを差し替えればよい(pass.setDisturbance(0〜1)というインターフェースだけ
//   守れば、中身のロジックは何を渡しても構わない)。
//
// ★ 変更点(旧: steadiness方式 → 新: scrollEnergy蓄積方式):
//   旧方式は「一定速度で丁寧に操作するほど落ち着く」だったが、今回
//   「スクロールしていないデフォルトの状態はそのまま。スクロールしている間、
//   蓄積量が増えるほど雨が増える(荒れる)」に変更した。
//   ・scrollEnergy(0〜1)は、スクロールするたびに増え、時間経過で指数的に減衰する
//     (=常時、蓄積(accumulateGain)と減衰(decayPerSecond)がせめぎ合っている)。
//     連続してスクロールし続ければ正味で蓄積量が積み上がり、止めれば減衰だけが
//     残ってデフォルト(disturbance=0=通常のbaseRainRate等)へ戻る。
//   ・「スクロール中でない(デフォルト)状態の雨量」はpass側のbaseRainRate等が
//     そのまま使われるので、この関数側では一切変更していない。
//
// 再生速度(gsap.globalTimeline.timeScale)の考え方は従来通り: 今の速さ(EMA)を
// 正規化してマッピングし、無操作が続けば既定の低速へ戻す。
export function attachScrollDrivenRain({
  field,
  target = window,
  minTimeScale = 0.05,
  maxTimeScale = 2.5,
  idleTimeScale = 0.05,
  // ★ 大幅増量(60→220)。「結構シビアすぎる」との指摘に対応し、同じ効果を得るのに
  //   必要な実際のスクロール量を増やして感度を下げた。値を大きくするほど鈍感になる。
  speedNormalizer = 220,
  // 1回のホイールイベントで、rawSpeed(0〜1に正規化済み)に対してscrollEnergyへ
  // 足し込む量。大きいほど「少ないスクロールで雨が増えやすく」なる。
  accumulateGain = 0.35,
  // scrollEnergyの指数減衰速度(1秒あたり)。大きいほど、スクロールをやめた時に
  // 早くデフォルトの雨量へ戻る。
  decayPerSecond = 0.6,
} = {}) {
  let emaSpeed = 0;       // 再生速度(timeScale)用: 今のスクロールの速さ
  let scrollEnergy = 0;   // 雨量(disturbance)用: 蓄積量。0(デフォルト)〜1(最大に荒れた状態)。
  let lastEventTime = performance.now();
  let lastTickTime = performance.now();

  const SPEED_ALPHA = 0.25;

  function onWheel(e) {
    // ★ wavePass(=phase3の間だけenabled=true)が無効な間は、雨量制御はもちろん、
    //   gsap.globalTimeline.timeScale()もいじらない(home画面等、他ページの
    //   アニメーション速度まで巻き込んでしまうのを防ぐ)。
    if (!field.enabled) return;

    const now = performance.now();
    lastEventTime = now;

    const rawSpeed = Math.min(1, Math.abs(e.deltaY) / speedNormalizer);

    // ── 再生速度(timeScale): 今の速さをなめらかに追従させる ──
    emaSpeed += (rawSpeed - emaSpeed) * SPEED_ALPHA;
    const timeScale = THREE.MathUtils.lerp(minTimeScale, maxTimeScale, THREE.MathUtils.clamp(emaSpeed, 0, 1));
    if (typeof gsap !== 'undefined') {
      gsap.globalTimeline.timeScale(timeScale);
    }

    // ── 雨量(disturbance): スクロールするたびに蓄積量を足し込む ──
    scrollEnergy = THREE.MathUtils.clamp(scrollEnergy + rawSpeed * accumulateGain, 0, 1);
    field.setDisturbance(scrollEnergy);
  }

  // main.jsのanimate()ループから毎フレーム呼ぶ想定。
  // ・scrollEnergyは常に指数減衰させる(スクロールが続いている間は蓄積が減衰を上回り
  //   正味で積み上がっていき、止めれば減衰だけが残ってデフォルトへ戻っていく)。
  // ・再生速度(timeScale)は、無操作が続いた場合だけidle値へゆっくり戻す。
  function tickIdleDecay() {
    const now = performance.now();
    const dt = Math.min(0.25, (now - lastTickTime) / 1000);
    lastTickTime = now;

    if (!field.enabled) return; // phase3以外では何もしない(timeScaleにも触れない)

    scrollEnergy *= Math.exp(-decayPerSecond * dt);
    field.setDisturbance(scrollEnergy);

    const idleMs = now - lastEventTime;
    if (idleMs > 80) {
      const decay = Math.min(1, 0.0025 * (idleMs - 80));
      emaSpeed *= (1 - decay * 0.1);
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
    const deltaY = (lastTouchY - y) * 1.5;
    lastTouchY = y;
    onWheel({ deltaY });
  }
  target.addEventListener('touchstart', onTouchStart, { passive: true });
  target.addEventListener('touchmove', onTouchMove, { passive: true });

  return {
    tickIdleDecay,
    // ★追加: phase3終了時にmain.js側から呼ぶ。スクロールに連動させていた
    //   gsap.globalTimeline.timeScale()を明示的に1へ戻し、内部の蓄積値
    //   (emaSpeed/scrollEnergy)もリセットする。
    //   これを呼ばないと、phase3終了時点でたまたま無操作が続いていた場合、
    //   timeScaleがidleTimeScale(0.05=5%速度)近くまで落ちたまま放置され、
    //   phase3以降(宇宙ページ等)のアニメーション全体が異常に遅くなってしまう。
    reset() {
      emaSpeed = 0;
      scrollEnergy = 0;
      lastEventTime = performance.now();
      lastTickTime = performance.now();
      field.setDisturbance(0);
      if (typeof gsap !== 'undefined') {
        gsap.globalTimeline.timeScale(1);
      }
    },
    dispose() {
      target.removeEventListener('wheel', onWheel);
      target.removeEventListener('touchstart', onTouchStart);
      target.removeEventListener('touchmove', onTouchMove);
    },
  };
}