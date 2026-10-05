import * as THREE from 'three';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';

// ══════════════════════════════════════════════════════════════
// ── ティルトシフト+円形ボケ(帯状の被写界深度)ポストプロセス ────
// ══════════════════════════════════════════════════════════════
//
// 画面の水平な帯(=ピントの合う範囲)だけをシャープに残し、その上下を「カメラのレンズの
// ような丸いボケ」でぼかす。3パス構成:
//   ① prefilter(水平)  ② prefilter(垂直)  ③ 円形ボケ(ディスク・ギャザー)
//   - ③がボケの本体。円盤状にVogel螺旋で64点をサンプリングし、明るい点ほど重みを大きく
//     して、星やバルジの光が「丸い玉」として残るようにする(縁を少し明るくして
//     レンズの実写っぽい輪郭も出せる)。
//   - ただしサンプル数が有限なので、そのままだと星1個が「64個の点の輪」になってしまう。
//     それを避けるため、③の前に小さなガウスぼかし(①②)で光を少し広げておき、
//     サンプル点の隙間を埋めて滑らかな円盤に見せている。
//   - ③では「サンプル元の画素が自分のボケ半径の範囲内までしか光を広げられない」という
//     重み付けをしている。これにより、ピントの合っているcarouselの輪郭が、ぼけた背景へ
//     にじみ出して二重輪郭・ハロになるのを防いでいる。
//
// ★ なぜ深度ベース(BokehPass)ではなく画面空間の帯か:
//   - このシーンの銀河・バルジ・星はPoints+独自ShaderMaterialで、BokehPassが内部で行う
//     overrideMaterial(MeshDepthMaterial)による深度描画では、点サイズが壊れて
//     正しい深度が取れない。
//   - 俯瞰カメラから円盤状の銀河を見ているため、ピント面は画面上ではほぼ水平な帯になり、
//     ティルトシフトの見た目とよく一致する。
//
// ★ 挿入位置:
//   - composerにOutputPass(トーンマップ+色空間変換)がある場合はその直前に挿入する
//     (リニア空間でぼかすので、明るい星が自然なボケ玉になる)。
//   - OutputPassが無い場合は末尾に追加し、最後のパスが画面へ出力するときに必要な
//     トーンマップ/色空間変換を自分で行う(二重変換にならないよう自動判定)。

const DEFAULTS = {
  // ── 「ピーキーさ」を決める主なつまみ ──
  maxBlurFraction: 0.54,  // 最大ボケ半径(画面の高さに対する比率。1080pで約43px)。大きいほど強烈
  falloff: 3,          // ピント帯の縁→最大ボケに達するまでの幅(画面高さ比)。小さいほど「リングのすぐ外からボケる」近い見た目になる
  curve: 1,             // ボケの立ち上がりカーブ。1未満で縁のすぐ外から急にボケる(1で滑らか)
  padding: 0,              // carousel範囲の上下に足す余白(帯の半幅に対する比率)。0でcarouselの範囲ぴったり
  // ★ ご指摘への補足: minHalf/maxHalfは、投影で求めた実際の半幅をクランプする「ガードレール」に
  //   過ぎず、実際の半幅がこの範囲内であれば何も変えない。「変えても見た目が変わらない」ときは
  //   実際の半幅がこの範囲の内側にいる=このガードレールが効いていない、という意味。
  //   リングとボケを近づけたい場合はここではなくfalloff(上)を小さくする。
  minHalf: 0.015,          // 帯の半幅の下限(画面高さ比)。carousel縮小後に帯が潰れすぎないための保険
  maxHalf: 0.42,          // 帯の半幅の上限(画面高さ比)
  // ── 円形ボケの質感 ──
  highlightBoost: 2.0,    // 明るい点をボケ玉として強調する度合い(0で通常の円形ぼかし)
  rim: 0.6,               // 円盤の縁を明るくする度合い(0で均一な円盤、大きいほどコインのような輪郭)
  prefilterScale: 0.25,   // サンプル隙間を埋める前段ぼかしの強さ(ボケ半径に対する比率)
};

const VERTEX_SHADER = /* glsl */`
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

// 3パス共通: 画面の縦位置(uv.y)→ボケ半径(px)。
const COC_GLSL = /* glsl */`
  uniform vec2 uResolution;   // 描画バッファのピクセル数
  uniform float uFocusCenter; // ピント帯の中心(uv.y)
  uniform float uFocusHalf;   // ピント帯の半幅(uv単位)
  uniform float uFalloff;     // 帯の縁→最大ボケまでの幅(uv単位)
  uniform float uCurve;       // 立ち上がりカーブ(<1で急)
  uniform float uMaxBlurPx;   // 最大ボケ半径(px)
  uniform float uStrength;    // 0〜1: 全体の効き具合
  float cocPx(float y) {
    float t = smoothstep(uFocusHalf, uFocusHalf + uFalloff, abs(y - uFocusCenter));
    return pow(t, uCurve) * uMaxBlurPx * uStrength;
  }
`;

// ①② 前段: 小さな分離ガウス(ボケ半径に比例)。円形ボケのサンプル隙間を埋める。
const PREFILTER_FRAGMENT = /* glsl */`
  #define TAPS 8
  uniform sampler2D tDiffuse;
  uniform vec2 uDirection;    // (1,0)=水平 / (0,1)=垂直
  uniform float uRadiusScale; // ボケ半径に掛ける比率
  varying vec2 vUv;
  ${COC_GLSL}

  void main() {
    float radius = cocPx(vUv.y) * uRadiusScale;
    vec4 color;
    if (radius < 0.5) {
      color = texture2D(tDiffuse, vUv);
    } else {
      vec2 stepUv = uDirection / uResolution * (radius / float(TAPS));
      float sigma = float(TAPS) * 0.5;
      vec4 sum = vec4(0.0);
      float wsum = 0.0;
      for (int i = -TAPS; i <= TAPS; i++) {
        float x = float(i);
        float w = exp(-(x * x) / (2.0 * sigma * sigma));
        sum += texture2D(tDiffuse, vUv + stepUv * x) * w;
        wsum += w;
      }
      color = sum / wsum;
    }
    gl_FragColor = color;
  }
`;

// ③ 本体: 円形ボケ(Vogel螺旋のディスク・ギャザー)。
const BOKEH_FRAGMENT = /* glsl */`
  #define SAMPLES 64
  uniform sampler2D tDiffuse;
  uniform float uHighlight;   // 明るい点の強調
  uniform float uRim;         // 円盤の縁の強調
  varying vec2 vUv;
  ${COC_GLSL}

  // 画素ごとに螺旋を回すノイズ(サンプル位置の規則的な模様を、細かい粒状感に変えて目立たなくする)
  float ign(vec2 p) {
    return fract(52.9829189 * fract(dot(p, vec2(0.06711056, 0.00583715))));
  }

  void main() {
    float radius = cocPx(vUv.y);
    vec4 color;
    if (radius < 0.5) {
      color = texture2D(tDiffuse, vUv);
    } else {
      float rot = 6.2831853 * ign(gl_FragCoord.xy);
      vec4 sum = vec4(0.0);
      float wsum = 0.0;
      for (int i = 0; i < SAMPLES; i++) {
        float fi = float(i);
        float rn = sqrt((fi + 0.5) / float(SAMPLES)); // 円盤内で面積が一様になる半径(0〜1)
        float a = fi * 2.39996323 + rot;              // 黄金角
        vec2 offPx = vec2(cos(a), sin(a)) * (rn * radius);
        vec2 uv = vUv + offPx / uResolution;
        vec4 s = texture2D(tDiffuse, uv);

        // サンプル元が「自分のボケ半径の範囲内」までしか光を広げられない、という重み。
        // ピントの合ったcarouselが、ぼけた背景へにじみ出すのを防ぐ。
        float d = rn * radius;
        float k = max(clamp(cocPx(uv.y) / max(d, 1.0), 0.0, 1.0), 0.03);

        float lum = min(dot(s.rgb, vec3(0.299, 0.587, 0.114)), 4.0);
        float w = k * (1.0 + lum * lum * uHighlight) * (1.0 + uRim * rn * rn);
        sum += s * w;
        wsum += w;
      }
      color = sum / wsum;
    }
    gl_FragColor = color;
    #ifdef TS_CONVERT_OUTPUT
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    #endif
  }
`;

function isOutputPass(pass) {
  return !!pass && pass.constructor && pass.constructor.name === 'OutputPass';
}

function makePass(fragmentShader, extraUniforms, convertOutput, options) {
  const pass = new ShaderPass({
    name: 'TiltShiftBokehShader',
    defines: convertOutput ? { TS_CONVERT_OUTPUT: 1 } : {},
    uniforms: {
      tDiffuse: { value: null },
      uResolution: { value: new THREE.Vector2(1, 1) },
      uFocusCenter: { value: 0.5 },
      uFocusHalf: { value: 0.2 },
      uFalloff: { value: options.falloff },
      uCurve: { value: options.curve },
      uMaxBlurPx: { value: 8 },
      uStrength: { value: 0 },
      ...extraUniforms,
    },
    vertexShader: VERTEX_SHADER,
    fragmentShader,
  });
  // EffectComposerはaddPass/insertPass/setSizeのたびにpass.setSize(実ピクセル数)を呼ぶ。
  pass.setSize = (width, height) => {
    pass.uniforms.uResolution.value.set(width, height);
    pass.uniforms.uMaxBlurPx.value = height * options.maxBlurFraction;
  };
  pass.enabled = false;
  return pass;
}

const _fwd = new THREE.Vector3();
const _p = new THREE.Vector3();

// composer: sceneSetup.jsが返すEffectComposer。options: DEFAULTSの上書き。
export function createTiltShift(composer, userOptions = {}) {
  const options = { ...DEFAULTS, ...userOptions };

  const outputIndex = composer.passes.findIndex(isOutputPass);
  const hasOutputPass = outputIndex !== -1;

  const prefilterH = makePass(PREFILTER_FRAGMENT, {
    uDirection: { value: new THREE.Vector2(1, 0) },
    uRadiusScale: { value: options.prefilterScale },
  }, false, options);
  const prefilterV = makePass(PREFILTER_FRAGMENT, {
    uDirection: { value: new THREE.Vector2(0, 1) },
    uRadiusScale: { value: options.prefilterScale },
  }, false, options);
  // 最後に画面へ出力する円形ボケのパスだけが、必要ならトーンマップ/色空間変換を担当する。
  const bokeh = makePass(BOKEH_FRAGMENT, {
    uHighlight: { value: options.highlightBoost },
    uRim: { value: options.rim },
  }, !hasOutputPass, options);

  const passes = [prefilterH, prefilterV, bokeh];
  if (hasOutputPass) {
    passes.forEach((pass, i) => composer.insertPass(pass, outputIndex + i));
  } else {
    passes.forEach((pass) => composer.addPass(pass));
  }

  function setUniform(name, value) {
    passes.forEach((pass) => { pass.uniforms[name].value = value; });
  }

  return {
    passes,

    // 0〜1。ほぼ0のときはパス自体を無効化して負荷ゼロにする。
    setStrength(strength) {
      const s = THREE.MathUtils.clamp(strength, 0, 1);
      const on = s > 0.001;
      passes.forEach((pass) => { pass.enabled = on; });
      setUniform('uStrength', s);
    },

    // ピント帯を直接指定する(uv.y基準。0=画面下端, 1=画面上端)。
    setFocusBand(center, half) {
      setUniform('uFocusCenter', center);
      setUniform('uFocusHalf', half);
    },

    // 「ワールド空間の円柱(carouselの範囲)」が画面上で占める縦方向の範囲を
    // ピント帯にする。円柱は、軸(center.x, center.z)・半径radius・高さyMin〜yMax。
    // カメラの水平前方向に±radius離れた2点 × 上下2段 = 4点を投影し、画面上の
    // 縦方向の最小〜最大をとる(軸まわりの回転に依存しないので、carouselが
    // 自転していても帯がブレない)。
    setFocusFromCylinder(camera, { center, radius, yMin, yMax }) {
      camera.updateMatrixWorld();
      camera.matrixWorldInverse.copy(camera.matrixWorld).invert();
      camera.getWorldDirection(_fwd);
      _fwd.y = 0;
      if (_fwd.lengthSq() < 1e-6) _fwd.set(0, 0, -1);
      else _fwd.normalize();

      let minV = Infinity;
      let maxV = -Infinity;
      for (const y of [yMin, yMax]) {
        for (const s of [-1, 1]) {
          _p.set(center.x + _fwd.x * radius * s, y, center.z + _fwd.z * radius * s).project(camera);
          const v = _p.y * 0.5 + 0.5;
          if (v < minV) minV = v;
          if (v > maxV) maxV = v;
        }
      }
      const mid = (minV + maxV) / 2;
      const half = THREE.MathUtils.clamp(
        ((maxV - minV) / 2) * (1 + options.padding),
        options.minHalf,
        options.maxHalf,
      );
      this.setFocusBand(mid, half);
    },
  };
}