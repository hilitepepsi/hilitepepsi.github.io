import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { TUNE, HOME_CAMERA_POS, HOME_CAMERA_TARGET } from './config.js';
import { RippleRefractionPass } from './waveSurfacePass.js';

// ── 最終合成シェーダー: 通常レンダリング結果(baseTexture)に
//    Bloom専用パスの結果(bloomTexture)を加算するだけのシンプルなシェーダー ──
const mixShader = {
  uniforms: {
    baseTexture: { value: null },
    bloomTexture: { value: null },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D baseTexture;
    uniform sampler2D bloomTexture;
    varying vec2 vUv;
    void main() {
      gl_FragColor = texture2D(baseTexture, vUv) + texture2D(bloomTexture, vUv);
    }
  `,
};

// ── ★ 追加: 丸いBloom(円形ガウシアン方式)専用のシェーダー ────────────
// UnrealBloomPassは低解像度のミップピラミッドを使うため、数pxしかない星のような
// 小さく明るい点だと、光暈の外側が四角く/ブロック状になってしまう(実際に確認済み)。
// stars.jsの星のように「常に丸いまま、かつ実際の明るさに動的に反応する発光」が
// 欲しいオブジェクトは、UnrealBloomPass(bloomComposer)からは除外しつつ、
// こちらの専用パイプライン(閾値抽出→十分な解像度の分離ガウシアン→強度で加算)に
// 含める(includeInRoundBloom参照)。ガウシアンを複数スケール・複数回重ねることで、
// 解像度を落としすぎることによる等高線化を避けながら、広く・薄く発光を伸ばしている。
const ROUND_QUAD_VERTEX = `varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`;
const ROUND_BRIGHT_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform float uThreshold;
  uniform float uSmoothWidth;
  varying vec2 vUv;
  void main() {
    vec4 c = texture2D(tDiffuse, vUv);
    float luma = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
    float factor = smoothstep(uThreshold - uSmoothWidth, uThreshold + uSmoothWidth, luma);
    gl_FragColor = vec4(c.rgb * factor, 1.0);
  }
`;
const ROUND_GAUSSIAN_FRAGMENT = (dx, dy) => `
  uniform sampler2D tDiffuse;
  uniform vec2 uTexel;
  varying vec2 vUv;
  void main() {
    vec2 dir = vec2(${dx}, ${dy});
    float w[5];
    w[0]=0.227027; w[1]=0.1945946; w[2]=0.1216216; w[3]=0.054054; w[4]=0.016216;
    vec3 result = texture2D(tDiffuse, vUv).rgb * w[0];
    for (int i = 1; i < 5; i++) {
      vec2 o = dir * uTexel * float(i) * 1.6;
      result += texture2D(tDiffuse, vUv + o).rgb * w[i];
      result += texture2D(tDiffuse, vUv - o).rgb * w[i];
    }
    gl_FragColor = vec4(result, 1.0);
  }
`;
const ROUND_SCALE_WEIGHT_FRAGMENT = `
  uniform sampler2D tDiffuse;
  uniform float uWeight;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tDiffuse, vUv) * uWeight; }
`;
const ROUND_ADD_WEIGHTED_FRAGMENT = `
  uniform sampler2D tBase;
  uniform sampler2D tAdd;
  uniform float uWeight;
  varying vec2 vUv;
  void main() { gl_FragColor = texture2D(tBase, vUv) + texture2D(tAdd, vUv) * uWeight; }
`;
const ROUND_FINAL_ADD_FRAGMENT = `
  uniform sampler2D baseTexture;
  uniform sampler2D roundBloomTexture;
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    gl_FragColor = texture2D(baseTexture, vUv) + texture2D(roundBloomTexture, vUv) * uStrength;
  }
`;
// 画面解像度に対する各スケールの比率と、合成時の重み・ぼかし反復回数(仮値。
// hotspotsでの検証プレビューで決めた値をそのまま使っている)。
// [0]=やや締まった近い光暈、[1]=解像度を下げすぎない範囲で複数回ぼかして広く薄く伸ばす光暈。
const ROUND_BLOOM_SCALES = [0.3, 0.14];
const ROUND_BLOOM_WEIGHTS = [1.0, 0.4];
const ROUND_BLOOM_ITERATIONS = [1, 3];
const ROUND_BLOOM_STRENGTH = 1.0; // 仮値。config.js未対応のためここに直接置いている。強すぎ/弱すぎれば調整してください。
const ROUND_BLOOM_LAYER = 1; // カメラのlayersでこの層だけを見る/見ないを切り替えて、対象オブジェクトだけを撮影する

// ── 疑似的な正射影(pseudo-orthographic) ────────────────────
// ご指示「宇宙ページではあらかじめ正射影にしておき、右ドラッグで透視図モードに切り替える」の
// 反映。ただし three.js の単一カメラは PerspectiveCamera ⇔ OrthographicCamera を
// 直接切り替えられない(別カメラを2台用意してレンダリングを丸ごと差し替える必要がある)ため、
// 今回は「極端に狭いFOV + 十分に遠い距離」で見た目上ほぼ平行投影に近づける近似(=よくある
// dolly zoomの応用)で代用している。厳密な正射影(完全な平行投影)ではない点に注意。
// もし見た目の違いが気になる場合は、OrthographicCameraを別途用意し、
// composer/bloomComposer両方のRenderPass.cameraを丸ごと差し替える実装に変更してください。
//
// ★ 「以前(universeページより前の段階)はカメラをひっくり返した状態で正射影だった」との
//   ご説明があったが、その向き(camera.upの反転など)を今回そのまま踏襲すべきか不明なため、
//   ここではcamera.upは変更していない(通常のWORLD_UP=(0,1,0)のまま)。もし反転が必要な
//   場合は、setProjectionMix呼び出し側(main.js)でcamera.up.set(0,-1,0)等を
//   mix===0の間だけ適用する形で対応してください。
const PSEUDO_ORTHO_FOV = 2;   // 仮値。0に近づけるほど平行投影に近づくが、精度問題が出やすくなるため程々の値に
const HOME_FOV = 50;          // 通常時(透視図)のFOV。下のPerspectiveCamera初期化値と合わせてある

// mix=0: 疑似正射影(HOME_CAMERA_TARGETから見て極端に遠い位置+極小FOV)
// mix=1: 通常の透視図(HOME_CAMERA_POS+HOME_FOV、従来通りの見た目)
// 「被写体(HOME_CAMERA_TARGET付近)の画面上の大きさがなるべく変わらないように」、
// FOVと距離を同時に変化させるdolly zoomの要領で補間する。
function makeProjectionMixer(camera) {
  const viewDir = HOME_CAMERA_POS.clone().sub(HOME_CAMERA_TARGET).normalize();
  const homeDistance = HOME_CAMERA_POS.distanceTo(HOME_CAMERA_TARGET);
  const orthoDistance =
    (homeDistance * Math.tan(THREE.MathUtils.degToRad(HOME_FOV / 2))) /
    Math.tan(THREE.MathUtils.degToRad(PSEUDO_ORTHO_FOV / 2));
  const orthoPos = HOME_CAMERA_TARGET.clone().addScaledVector(viewDir, orthoDistance);

  // ★ 修正: 疑似正射影(mix=0)ではカメラをorthoDistanceぶん(HOME_CAMERA_POSよりずっと)
  //   遠くまで下げる。camera.farが元の値(500)のままだと、カメラがfar平面より遠くへ
  //   下がってしまったり、シーン全体がカメラからfar距離より遠くに位置することになり、
  //   何も描画されず画面が真っ暗になっていた(実際に発生した不具合)。
  //   orthoDistance(+シーンの奥行き分の余裕)までcamera.farを引き上げておく。
  camera.far = Math.max(camera.far, orthoDistance + homeDistance + 100);
  camera.updateProjectionMatrix();

  // mix: 0〜1。呼び出し側(main.js)が右ドラッグの量に応じて毎フレーム/毎イベント呼ぶ想定。
  return function setProjectionMix(mix) {
    const m = THREE.MathUtils.clamp(mix, 0, 1);
    camera.fov = THREE.MathUtils.lerp(PSEUDO_ORTHO_FOV, HOME_FOV, m);
    camera.position.lerpVectors(orthoPos, HOME_CAMERA_POS, m);
    camera.updateProjectionMatrix();
    return m;
  };
}

// ── 基本セットアップ ───────────────────────────
export function createSceneSetup() {
  const scene = new THREE.Scene();
  // ★ 修正(ご指示反映): 「カメラのスケール範囲も10倍にしたい」への対応。このcameraは
  //   home/universe/overviewすべてで共有されており、以前のfar=500では全く足りない。
  //   実際に必要な距離を計算すると: カメラ距離(config.js UNIVERSE_CAMERA_DISTANCE=10000)
  //   + 戴冠後の銀河半径(galaxy.js GALAXY_RADIUS≈1176 × record.js GALAXY_OVERVIEW_SCALE=2
  //   ≈2352)で、カメラから銀河の最も遠い端まで約12,350。これより小さいfarだと
  //   銀河の奥側がクリップされて消える。余裕を見て far=20000 にした(単純な「10倍」=5000
  //   では全く足りないので注意。10倍にしたのは距離の方で、必要なfarは距離+銀河半径の
  //   合計なのでそれより大きく増やす必要がある)。
  //   near=0.1は維持(near/farの比が広がりすぎると深度精度が落ちてz-fightingが出ることが
  //   あるので、もし近距離の物体でちらつきが出るようならnearを少し上げて調整してください)。
  const camera = new THREE.PerspectiveCamera(HOME_FOV, innerWidth / innerHeight, 0.1, 20000);
  camera.position.copy(HOME_CAMERA_POS); // 演出開始時からホームポジションに据え置く(以前はStep6で別途移動していた)
  scene.add(camera); // ← 追加: camera.add(sprite)した子を描画するのに必要
  const lookTarget = new THREE.Vector3(0, 0, 0);

  // ★ ご指示反映: 宇宙ページ(record.js側のtripod/mirror演出)ではあらかじめ疑似正射影
  //   (mix=0)にしておく。それより前のページ(carousel等)は従来通りHOME_CAMERA_POS基準の
  //   通常の透視図のままにしたいので、main.js側で「carouselから切り替わるタイミング」に
  //   なったらsetProjectionMix(0)を呼んで疑似正射影へ切り替え、右ドラッグでsetProjectionMix(t)を
  //   1へ近づけていく想定(このファイル単体では切り替えタイミングを判断しないため、
  //   ここではまだ呼ばない=通常の透視図のまま初期化する)。
  const setProjectionMix = makeProjectionMixer(camera);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(innerWidth, innerHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  document.body.appendChild(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enabled = false; // 演出中は無効

  // ── Bloom(発光・にじみ)を掛けたくないオブジェクトの管理 ────────────
  // 数式シンボル(i, hbar, hamiltonian, derivative等)のように「くっきり見せたい」
  // ものはexcludeFromBloom(object)で登録する。Bloom専用パスをレンダリングする
  // 直前だけ一時的にvisible=falseにして除外し、直後に元へ戻す
  // (three.js公式のSelective Bloom例と同じ考え方。星やガラスなど他の発光は
  //  そのまま残る)。
  // 数式シンボル(i, hbar, hamiltonian, derivative等)のように「Bloomを弱めに
  // したい」ものはexcludeFromBloom(object, intensity)で登録する。intensityは
  // 0(完全に発光なし)〜1(通常通りフルに発光)の倍率。Bloom専用パスを
  // レンダリングする直前だけ一時的にopacityをintensity倍に下げて弱め、
  // 直後に元のopacityへ戻す(three.js公式のSelective Bloom例の応用。
  // 星やガラスなど登録していないものはそのままフルに発光する)。
  const noBloomObjects = new Map(); // object → intensity(0〜1)
  function excludeFromBloom(object, intensity = 0) {
    noBloomObjects.set(object, intensity);
  }
  function dimNoBloomObjects() {
    noBloomObjects.forEach((intensity, obj) => {
      if (intensity <= 0) {
        // 完全除外: visibleを直接トグルする。opacityを弄る方式だと、stars.jsのような
        // 独自ShaderMaterial(シェーダー内でopacityを一切参照していないもの)には
        // 効かないため、intensity=0のときは確実に効く方式に倒す。
        obj.userData.__prevVisible = obj.visible;
        obj.visible = false;
      } else {
        obj.userData.__prevOpacity = obj.material.opacity;
        obj.material.opacity = obj.material.opacity * intensity;
      }
    });
  }
  function restoreNoBloomObjects() {
    noBloomObjects.forEach((intensity, obj) => {
      if (intensity <= 0) {
        obj.visible = obj.userData.__prevVisible;
      } else {
        obj.material.opacity = obj.userData.__prevOpacity;
      }
    });
  }

  // ── ① Bloom専用コンポーザー: 除外オブジェクトを隠した状態のシーンをレンダリングし、
  //    UnrealBloomPassをかける。renderToScreen=falseなので画面には出さず、
  //    結果は bloomComposer.renderTarget2 に溜まる(②の合成で使う)。
  const bloomComposer = new EffectComposer(renderer);
  bloomComposer.renderToScreen = false;
  bloomComposer.addPass(new RenderPass(scene, camera));
  const bloomPass = new UnrealBloomPass(
    new THREE.Vector2(innerWidth, innerHeight),
    TUNE.bloomStrength, TUNE.bloomRadius, TUNE.bloomThreshold
  );
  // UnrealBloomPassは内部でまず閾値以下を切り捨てる(LuminosityHighPassShader)。
  // これがほぼハードエッジ(既定のsmoothWidthが極小)なので、星のように数ピクセル
  // しかない丸いグラデーションだと、閾値を超えた一部のピクセルだけが荒い格子状に
  // 生き残り、それがそのままブラーの"種"になって四角っぽく見える。
  // smoothWidthを上げてカットオフ自体をなだらかにし、種の丸みを保つ。
  bloomPass.highPassUniforms.smoothWidth.value = 0.1;
  bloomComposer.addPass(bloomPass);

  // ── ② 最終コンポーザー: 通常のシーン(除外オブジェクトも含め全部見える状態)を
  //    レンダリングし、そこに①のbloomTextureを加算合成する。
  //    数式シンボルは①に映っていないので、ここでは自分自身の見た目のまま
  //    (にじみなし)で重なる。
  const mixPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: mixShader.vertexShader,
    fragmentShader: mixShader.fragmentShader,
  }), 'baseTexture');
  mixPass.needsSwap = true;

  // ── ★ 追加: 丸いBloom(円形ガウシアン方式)パイプライン ─────────────
  // includeInRoundBloom(object)で登録したオブジェクトだけを、camera.layersを使って
  // 選択的に撮影する(three.js公式のSelective Bloom例と同じ考え方。ただし
  // visibleのトグルではなくlayersを使うので、シーン全体を毎フレーム走査する必要がない)。
  function includeInRoundBloom(object) {
    object.layers.enable(ROUND_BLOOM_LAYER);
  }

  const roundQuadScene = new THREE.Scene();
  const roundQuadCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const roundQuadMesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.MeshBasicMaterial());
  roundQuadScene.add(roundQuadMesh);
  function runRoundQuadPass(material, target) {
    roundQuadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(roundQuadScene, roundQuadCamera);
  }
  function makeRoundQuadMaterial(fragment, uniforms) {
    return new THREE.ShaderMaterial({ vertexShader: ROUND_QUAD_VERTEX, fragmentShader: fragment, uniforms, depthTest: false, depthWrite: false });
  }
  const roundBrightMaterial = makeRoundQuadMaterial(ROUND_BRIGHT_FRAGMENT, { tDiffuse: { value: null }, uThreshold: { value: TUNE.bloomThreshold }, uSmoothWidth: { value: 0.1 } });
  const roundGaussianHMaterial = makeRoundQuadMaterial(ROUND_GAUSSIAN_FRAGMENT('1.0', '0.0'), { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const roundGaussianVMaterial = makeRoundQuadMaterial(ROUND_GAUSSIAN_FRAGMENT('0.0', '1.0'), { tDiffuse: { value: null }, uTexel: { value: new THREE.Vector2() } });
  const roundScaleWeightMaterial = makeRoundQuadMaterial(ROUND_SCALE_WEIGHT_FRAGMENT, { tDiffuse: { value: null }, uWeight: { value: 1 } });
  const roundAddWeightedMaterial = makeRoundQuadMaterial(ROUND_ADD_WEIGHTED_FRAGMENT, { tBase: { value: null }, tAdd: { value: null }, uWeight: { value: 1 } });

  let roundSceneRT, roundCombineRT, roundCombineRT2;
  let roundScaleRTs = [], roundScaleScratch = [];
  function rebuildRoundBloomTargets() {
    const w = innerWidth, h = innerHeight;
    [roundSceneRT, roundCombineRT, roundCombineRT2, ...roundScaleRTs, ...roundScaleScratch].forEach((rt) => rt && rt.dispose());
    roundSceneRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    roundCombineRT = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    roundCombineRT2 = new THREE.WebGLRenderTarget(w, h, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    roundScaleRTs = []; roundScaleScratch = [];
    ROUND_BLOOM_SCALES.forEach((scale) => {
      const rw = Math.max(24, Math.round(w * scale)), rh = Math.max(24, Math.round(h * scale));
      roundScaleRTs.push(new THREE.WebGLRenderTarget(rw, rh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
      roundScaleScratch.push(new THREE.WebGLRenderTarget(rw, rh, { minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter }));
    });
  }
  rebuildRoundBloomTargets();

  function renderRoundBloom() {
    // camera.layersをROUND_BLOOM_LAYERだけに絞って撮影(includeInRoundBloomしていない
    // オブジェクトは、layer0にしか居ないため映らない)。撮り終えたら必ず元(layer0)へ戻す。
    camera.layers.set(ROUND_BLOOM_LAYER);
    renderer.setRenderTarget(roundSceneRT);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    renderer.render(scene, camera);
    camera.layers.set(0);

    roundScaleRTs.forEach((rt, i) => {
      roundBrightMaterial.uniforms.tDiffuse.value = roundSceneRT.texture;
      roundBrightMaterial.uniforms.uThreshold.value = bloomPass.threshold;
      roundBrightMaterial.uniforms.uSmoothWidth.value = bloomPass.highPassUniforms.smoothWidth.value;
      runRoundQuadPass(roundBrightMaterial, rt);

      const iterations = ROUND_BLOOM_ITERATIONS[i] || 1;
      for (let pass = 0; pass < iterations; pass++) {
        roundGaussianHMaterial.uniforms.tDiffuse.value = rt.texture;
        roundGaussianHMaterial.uniforms.uTexel.value.set(1 / rt.width, 1 / rt.height);
        runRoundQuadPass(roundGaussianHMaterial, roundScaleScratch[i]);
        roundGaussianVMaterial.uniforms.tDiffuse.value = roundScaleScratch[i].texture;
        roundGaussianVMaterial.uniforms.uTexel.value.set(1 / rt.width, 1 / rt.height);
        runRoundQuadPass(roundGaussianVMaterial, rt);
      }
    });

    roundScaleWeightMaterial.uniforms.tDiffuse.value = roundScaleRTs[0].texture;
    roundScaleWeightMaterial.uniforms.uWeight.value = ROUND_BLOOM_WEIGHTS[0];
    runRoundQuadPass(roundScaleWeightMaterial, roundCombineRT);
    roundAddWeightedMaterial.uniforms.tBase.value = roundCombineRT.texture;
    roundAddWeightedMaterial.uniforms.tAdd.value = roundScaleRTs[1].texture;
    roundAddWeightedMaterial.uniforms.uWeight.value = ROUND_BLOOM_WEIGHTS[1];
    runRoundQuadPass(roundAddWeightedMaterial, roundCombineRT2);

    return roundCombineRT2.texture;
  }

  // mixPass(UnrealBloomPass分の合成)の後段で、丸いBloomの結果をさらに加算するパス。
  const roundBloomAddPass = new ShaderPass(new THREE.ShaderMaterial({
    uniforms: { baseTexture: { value: null }, roundBloomTexture: { value: null }, uStrength: { value: ROUND_BLOOM_STRENGTH } },
    vertexShader: mixShader.vertexShader,
    fragmentShader: ROUND_FINAL_ADD_FRAGMENT,
  }), 'baseTexture');
  roundBloomAddPass.needsSwap = true;

  // ── 波面加工(雨紋+屈折のみ)。mixPass(Bloom合成済み画像)を受け取って
  //    さらに歪めるだけなので、Bloomの仕組み・phase3.js側には一切影響しない。
  //    OutputPass(トーンマッピング・色空間変換)の直前に置くことで、
  //    「歪めた結果」に対して最後に正しく色空間変換がかかるようにしている。
  const wavePass = new RippleRefractionPass();
  wavePass.enabled = false;
  // ★ ご指示反映: 波面加工はphase3(②③④展開)の間だけ適用する。既定は無効にしておき、
  //   main.js側でPhase3開始/終了のタイミングでenabled切り替え+reset()を行う。

  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(mixPass);
  composer.addPass(roundBloomAddPass); // ← 追加: 丸いBloom(stars.js等)をここで加算
  composer.addPass(wavePass);
  composer.addPass(new OutputPass());

  // ★ 修正: UnrealBloomPassはコンストラクタに渡したVector2の解像度で内部の
  // ミップ用レンダーターゲットを作成するが、これはdevicePixelRatioを考慮
  // していない(CSSピクセルのinnerWidth/innerHeightのまま)。EffectComposer側は
  // setSize()が呼ばれて初めて各パスにpixelRatio込みの解像度を伝えるため、
  // ユーザーが一度もウィンドウをリサイズしないとbloomPassはCSSピクセル解像度
  // (devicePixelRatioが2の環境では実質1/4のピクセル数)のまま動き続けてしまう。
  // 数pxしかない星の点スプライトにとってこの解像度不足は致命的で、
  // bloomThresholdやbloomRadiusをどう調整しても粗いドット状にしかならない
  // 原因になっていた。ここで明示的に一度setSize()を呼び、初期化直後から
  // 正しい解像度でBloom用バッファを作り直させる。
  bloomComposer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);

  // main.js の animate() 内、これまでの composer.render() の代わりに呼ぶ関数。
  // ①除外オブジェクトを隠す→②Bloom専用パスを描く→③元に戻す→④丸いBloomを撮る→⑤通常合成、の順。
  function render() {
    dimNoBloomObjects();
    bloomComposer.render();
    restoreNoBloomObjects();

    const roundBloomTexture = renderRoundBloom();
    roundBloomAddPass.material.uniforms.roundBloomTexture.value = roundBloomTexture;
    roundBloomAddPass.material.uniforms.uStrength.value = ROUND_BLOOM_STRENGTH;

    composer.render();
  }

  // トーンマッピング: 星やガラスの明るさが1.0を超えても自然に発光して見えるようにする
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  // ガラスの透過(Transmission)表現に必要な簡易環境マップ
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

  scene.add(new THREE.AmbientLight(0x8899ff, 0.6));
  const keyLight = new THREE.PointLight(0xffffff, 40, 100);
  keyLight.position.set(5, 8, 10);
  scene.add(keyLight);

  window.addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
    composer.setSize(innerWidth, innerHeight);
    bloomComposer.setSize(innerWidth, innerHeight); // ← Bloom専用コンポーザーも一緒にリサイズする
    rebuildRoundBloomTargets(); // ← 丸いBloom用のレンダーターゲットも解像度に合わせて作り直す
  });

  return { scene, camera, renderer, controls, composer, lookTarget, excludeFromBloom, includeInRoundBloom, render, setProjectionMix, wavePass };
}