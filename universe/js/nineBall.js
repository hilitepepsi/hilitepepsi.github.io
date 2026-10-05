import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createBackButton, createReplayButton } from './iconButton.js';

// ── ビリヤード台オーバーレイ(Nine Ball Break Cosmos) ─────────────────────
// ユーザー提供の参考実装(nine_ball_break_cosmos.html)をほぼそのまま移植したもの。
// 「つなぐことに特化」の方針により、変更は最小限に留めている:
// - メインシーンとはWebGLコンテキストを分離した、独立canvas+独立rAFループの
//   フルスクリーンHTMLオーバーレイとして実装(最も手数が少ない繋ぎ方)
// - カメラの初期位置だけ変更: 元は卓の奥行き(Z)方向から見る構図だったが、
//   world +X側から卓を横から見る構図にした(仰角の数値13.5/15.5はそのまま流用)。
//   ラックは-Z、キューボールは+Zに配置されており、+X側から見れば
//   ラックが画面右、キューボールが画面左に来る(指定により左右反転済み)。
// - 閉じるボタン(← 戻る)を追加し、YZパネル経由でのみ出入りできるようにした
// - hint/replayのDOM idはメイン側の#hintと衝突するため、オーバーレイ内で
//   動的に要素を生成する形に変更した(ロジックは元のまま)
//
// [改修メモ]
// - 盤上を公転していた太陽系(太陽+6つの発光ガラス玉の惑星)は削除した。
// - それらが持っていた引用セリフは、盤上のボール(1〜9番)をクリックすると
//   浮かぶ形に付け替えた。「Pool. I'll have to...」「We shot pool...」の
//   2つはキューボールに割り当てている。
// - ボールのテクスチャ(数字ラベルの黒文字・白帯)は削除し、既存の
//   BALL_COLORS の色だけを使ったシンプルな単色ガラス球にした(9番のみ
//   伝統的な黄+白帯)。
// - ポケットは黒い穴を持たず、白い光だけで表現している。全ポケット同じ
//   見た目(特定の1つだけ強調する演出は廃止)。

export function createNineBall(opts = {}) {
  const { onClose } = opts;

  const overlay = document.createElement('div');
  overlay.className = 'billiard-overlay';
  document.body.appendChild(overlay);

  const hint = document.createElement('div');
  hint.className = 'billiard-hint';
  hint.textContent = ' ';
  overlay.appendChild(hint);

  // 既存の billiard-replay / billiard-close クラスは位置(top/left等)の
  // フックとしてそのまま残し、見た目(枠なし・矢印のみ・発光hover)は
  // 共通コンポーネント(common/iconButton.js)側で担う。
  const replayBtn = createReplayButton({ className: 'billiard-replay', ariaLabel: 'REPLAY' });
  overlay.appendChild(replayBtn);

  const closeBtn = createBackButton({ className: 'billiard-close', ariaLabel: 'CLOSE' });
  overlay.appendChild(closeBtn);

  // セリフのテキスト表示用(ボールクリックで浮かぶ)
  const ballDialogueEl = document.createElement('div');
  ballDialogueEl.className = 'billiard-dialogue';
  overlay.appendChild(ballDialogueEl);

  // ポケット(作品名)のホバーツールチップ用
  const pocketTooltipEl = document.createElement('div');
  pocketTooltipEl.className = 'billiard-pocket-tooltip';
  overlay.appendChild(pocketTooltipEl);

  let rafId = null;

  /* ---------------------------------------------------------------
     BASIC SETUP
  --------------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  overlay.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x05030f, 0.018);

  const camera = new THREE.PerspectiveCamera(42, innerWidth/innerHeight, 0.1, 300);
  camera.position.set(15.5, 13.5, 0);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 0, 0.3);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 6;
  controls.maxDistance = 40;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.update();

  addEventListener("resize", () => {
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /* ---------------------------------------------------------------
     COSMIC ENVIRONMENT (background + reflection source)
  --------------------------------------------------------------- */
  function buildCosmosTexture(){
    const w = 1024, h = 512;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");

    // 元の宇宙(index.html)に合わせ、ほぼ黒一色の背景にする(カラフルな星雲ブロブは廃止)
    const g = ctx.createLinearGradient(0,0,0,h);
    g.addColorStop(0.0, "#05050a");
    g.addColorStop(0.5, "#06060f");
    g.addColorStop(1.0, "#05050a");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);

    const tex = new THREE.CanvasTexture(c);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }
  const cosmosTex = buildCosmosTexture();
  scene.background = cosmosTex;
  scene.environment = cosmosTex;

  /* ---------------------------------------------------------------
     LIGHTS — simple but fantastical
  --------------------------------------------------------------- */
  scene.add(new THREE.AmbientLight(0x6a5acd, 0.35));
  const hemi = new THREE.HemisphereLight(0x9fb8ff, 0x1a0a30, 0.5);
  scene.add(hemi);

  const keyLight = new THREE.PointLight(0xaea2ff, 18, 30, 2);
  keyLight.position.set(-4.5, 6.5, 3.5);
  scene.add(keyLight);

  const rimLight = new THREE.PointLight(0x38e8ff, 14, 28, 2);
  rimLight.position.set(5.5, 4.5, -4.5);
  scene.add(rimLight);

  const warmLight = new THREE.PointLight(0xff7fd1, 8, 22, 2);
  warmLight.position.set(0, 3, 6.5);
  scene.add(warmLight);

  /* ---------------------------------------------------------------
     TABLE GEOMETRY CONSTANTS
  --------------------------------------------------------------- */
  const HALF_X = 3.6;   // half-width (short rail direction)
  const HALF_Z = 7.2;   // half-length (long rail direction) — exact 2:1 table
  const BALL_R = 0.26;
  const POCKET_R = 0.52;
  const POCKET_CAPTURE = 0.30;
  const CORNER_INSET = 0.32;
  const SIDE_INSET = 0.18;

  const corners = [
    new THREE.Vector2( HALF_X-CORNER_INSET,  HALF_Z-CORNER_INSET),
    new THREE.Vector2(-HALF_X+CORNER_INSET,  HALF_Z-CORNER_INSET),
    new THREE.Vector2( HALF_X-CORNER_INSET, -HALF_Z+CORNER_INSET),
    new THREE.Vector2(-HALF_X+CORNER_INSET, -HALF_Z+CORNER_INSET),
  ];
  const sidePockets = [
    new THREE.Vector2( HALF_X-SIDE_INSET, 0),
    new THREE.Vector2(-HALF_X+SIDE_INSET, 0),
  ];
  const pockets = [...corners, ...sidePockets]; // all 6 pockets
  const TARGET_POCKET = corners[0].clone(); // the "wormhole" pocket the ripple is tied to

  /* ---------------------------------------------------------------
     WATER SURFACE (custom shader — translucent, ever-moving)
  --------------------------------------------------------------- */
  const waterGeo = new THREE.PlaneGeometry(HALF_X*2, HALF_Z*2, 140, 280);
  waterGeo.rotateX(-Math.PI/2);

  const waterUniforms = {
    uTime:        { value: 0 },
    uRippleOrigin:{ value: TARGET_POCKET.clone() },
    uRippleStart: { value: -999 },
    uRippleAmp:   { value: 0.34 },
    uRippleSpeed: { value: 3.4 },
    uSplashStart: { value: -999 },
    uSplashOrigin:{ value: TARGET_POCKET.clone() },
    uCamPos:      { value: camera.position.clone() },
    uColorDeep:   { value: new THREE.Color(0x0a0e3a) },
    uColorShallow:{ value: new THREE.Color(0x3a6bd6) },
    uColorGlow:   { value: new THREE.Color(0xaf7dff) },
  };

  const waterMat = new THREE.ShaderMaterial({
    uniforms: waterUniforms,
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: `
      uniform float uTime;
      uniform vec2  uRippleOrigin;
      uniform float uRippleStart;
      uniform float uRippleAmp;
      uniform float uRippleSpeed;
      uniform float uSplashStart;
      uniform vec2  uSplashOrigin;
      varying vec3 vWorldPos;
      varying vec3 vViewPos;
      varying float vElevation;

      float wave(vec2 p, float t){
        float w = 0.0;
        w += sin(p.x*0.42 + t*0.55) * 0.018;
        w += sin(p.y*0.33 - t*0.42) * 0.016;
        w += sin((p.x+p.y)*0.23 + t*0.30) * 0.014;
        w += sin((p.x-p.y)*0.55 + t*0.8) * 0.006;
        return w;
      }

      float ripple(vec2 p, vec2 origin, float startT, float amp, float speed, float freq, float decay){
        if(startT < -500.0) return 0.0;
        float age = uTime - startT;
        if(age < 0.0) return 0.0;
        float d = distance(p, origin);
        float front = speed * age;
        float band = smoothstep(front - 1.4, front, d) * (1.0 - smoothstep(front, front + 1.4, d));
        float env = exp(-decay * age);
        return sin(d*freq - age*speed*freq) * amp * env * band;
      }

      void main(){
        vec3 pos = position;
        float base = wave(pos.xz, uTime);
        float r1 = ripple(pos.xz, uRippleOrigin, uRippleStart, uRippleAmp, uRippleSpeed, 2.6, 0.35);
        float r2 = ripple(pos.xz, uSplashOrigin, uSplashStart, 0.5, 4.2, 3.4, 1.1);
        float elevation = base + r1 + r2;
        pos.y += elevation;
        vElevation = elevation;

        vec4 worldPos = modelMatrix * vec4(pos,1.0);
        vWorldPos = worldPos.xyz;
        vec4 viewPos = viewMatrix * worldPos;
        vViewPos = viewPos.xyz;
        gl_Position = projectionMatrix * viewPos;
      }
    `,
    fragmentShader: `
      uniform vec3 uColorDeep;
      uniform vec3 uColorShallow;
      uniform vec3 uColorGlow;
      uniform vec3 uCamPos;
      varying vec3 vWorldPos;
      varying vec3 vViewPos;
      varying float vElevation;

      void main(){
        vec3 fdx = dFdx(vViewPos);
        vec3 fdy = dFdy(vViewPos);
        vec3 normal = normalize(cross(fdx, fdy));
        vec3 viewDir = normalize(-vViewPos);
        float fresnel = pow(1.0 - clamp(dot(normal, viewDir),0.0,1.0), 2.6);

        vec3 base = mix(uColorDeep, uColorShallow, clamp(vElevation*4.0+0.5,0.0,1.0));
        vec3 col = mix(base, uColorGlow, fresnel*0.7);
        col += vec3(0.5,0.65,1.0) * smoothstep(0.09, 0.16, vElevation) * 0.6;

        float alpha = 0.62 + fresnel*0.3;
        gl_FragColor = vec4(col, clamp(alpha,0.0,0.92));
      }
    `
  });
  const water = new THREE.Mesh(waterGeo, waterMat);
  scene.add(water);
  // (no solid plane sits beneath the water any more — nothing to expose
  //  when the waves dip low, the cosmos simply shows through)

  /* ---------------------------------------------------------------
     POCKETS — glowing white wormholes
  --------------------------------------------------------------- */
  function buildWormholeTexture(){
    const s = 256;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const ctx = c.getContext("2d");
    const rg = ctx.createRadialGradient(s/2,s/2,0, s/2,s/2, s/2);
    // 闇との境界がくっきり出ないよう、途中の変化を緩やかにして
    // フェードの尾を長く引かせている
    rg.addColorStop(0.0,  "rgba(255,255,255,1.0)");
    rg.addColorStop(0.15, "rgba(255,255,255,0.9)");
    rg.addColorStop(0.35, "rgba(235,242,255,0.62)");
    rg.addColorStop(0.55, "rgba(210,225,255,0.36)");
    rg.addColorStop(0.75, "rgba(190,210,255,0.16)");
    rg.addColorStop(0.9,  "rgba(190,210,255,0.05)");
    rg.addColorStop(1.0,  "rgba(190,210,255,0.0)");
    ctx.fillStyle = rg;
    ctx.fillRect(0,0,s,s);
    const tex = new THREE.CanvasTexture(c);
    return tex;
  }
  const wormholeTex = buildWormholeTexture();

  // ポケットの点から真上に放たれる「光の柱」用のグラデーションテクスチャ。
  // 下端(ポケット側)が最も明るく、上に向かって透明にフェードする。
  function buildBeamTexture(){
    const w = 8, h = 256;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d");
    const g = ctx.createLinearGradient(0, h, 0, 0); // 下(明)→上(透明)
    g.addColorStop(0.0,  "rgba(255,255,255,1.0)");
    g.addColorStop(0.25, "rgba(230,240,255,0.65)");
    g.addColorStop(0.55, "rgba(205,222,255,0.28)");
    g.addColorStop(0.8,  "rgba(195,215,255,0.08)");
    g.addColorStop(1.0,  "rgba(195,215,255,0.0)");
    ctx.fillStyle = g;
    ctx.fillRect(0,0,w,h);
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = THREE.RepeatWrapping;
    return tex;
  }
  const beamTex = buildBeamTexture();

  const pocketMeshes = [];
  function buildPocket(c){
    const group = new THREE.Group();
    group.position.set(c.x, 0, c.y);
    scene.add(group);

    // ポケットは黒い穴を描かず、純粋な白い光だけで表現する。
    // (沈み込み判定は下の `pockets` 配列との距離計算で行っており、
    //  この見た目のメッシュとは独立しているので、黒い穴を消しても
    //  ポケット機能そのものは失われない)
    // 見た目はどのポケットも完全に同一にしている(特定の1つだけを
    // 強調する演出は廃止した)。

    // radiant white light pouring straight up out of the hole's center —
    // より広角に広がる、柔らかい大きめのハローと、中心の明るいコアの2層
    const glow = new THREE.Mesh(
      new THREE.CircleGeometry(POCKET_R*3.4, 32),
      new THREE.MeshBasicMaterial({
        map: wormholeTex, color: 0xffffff,
        transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
        opacity: 0.9
      })
    );
    glow.rotation.x = -Math.PI/2;
    glow.position.y = 0.02;
    group.add(glow);

    const core = new THREE.Mesh(
      new THREE.CircleGeometry(POCKET_R*0.9, 24),
      new THREE.MeshBasicMaterial({
        map: wormholeTex, color: 0xffffff,
        transparent:true, blending:THREE.AdditiveBlending, depthWrite:false,
        opacity: 0.95
      })
    );
    core.rotation.x = -Math.PI/2;
    core.position.y = 0.03;
    group.add(core);

    // 暗い画面の照明代わりに、ポケットの点から真上へ伸びる光の柱を立てる。
    // 下端(点)が細く強く、上に向かって広がりながら透明に消えていく
    // 「スポットライトが下から照らしている」ような見え方にする。
    const beamHeight = 2.4; // 高さは半分ほどに抑える(全ポケット共通)
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(POCKET_R*3.0, POCKET_R*0.3, beamHeight, 24, 1, true),
      new THREE.MeshBasicMaterial({
        map: beamTex, color: 0xffffff,
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, side: THREE.DoubleSide,
        opacity: 0.7,
      })
    );
    beam.position.y = beamHeight / 2;
    group.add(beam);

    const light = new THREE.PointLight(0xffffff, 15, 9, 2);
    light.position.y = 0.4;
    group.add(light);

    // ホバー判定用の当たり判定(見た目には出ない、少し広めの円盤)
    const hitArea = new THREE.Mesh(
      new THREE.CircleGeometry(POCKET_R * 1.6, 24),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    hitArea.rotation.x = -Math.PI / 2;
    hitArea.position.y = 0.05;
    group.add(hitArea);

    return { group, glow, core, beam, light, hitArea, pos:c };
  }

  // 各ポケットに対応する作品名(仮テキスト。あとで差し替え可)
  const POCKET_WORKS = [
    'A Perfect Day for Bananafish',
    'Hapworth 16, 1924',
    'Teddy',
    'Hapworth companion piece?',
    'Down at the Dinghy',
    '?',
  ];
  pockets.forEach((c, idx) => {
    const p = buildPocket(c);
    p.workTitle = POCKET_WORKS[idx] ?? '';
    pocketMeshes.push(p);
  });

  /* ---------------------------------------------------------------
     BALL COLORS — 指定色(1赤/2ピンク/3オレンジ/4緑/5青/6黄/7茶/8黒/9黄+白帯)
     数字ラベルは廃止。9番だけは伝統的な「黄色+白帯」を出すため、
     makeStripeTexture() で単純な帯テクスチャ(黒要素なし)を貼る。
  --------------------------------------------------------------- */
  const BALL_COLORS = {
    1: "#d1382c", // 赤
    2: "#f07fb0", // ピンク
    3: "#e2892f", // オレンジ
    4: "#3f9e52", // 緑
    5: "#3f7fe0", // 青
    6: "#f0d23e", // 黄色
    7: "#7a4a2a", // 茶
    8: "#1b1b22", // 黒
    9: "#f0d23e", // 黄色(帯と組み合わせて9番に使用)
  };

  // 9番ボール専用:白地に色帯(黒要素なしのシンプルな帯)
  function makeStripeTexture(colorHex){
    const s = 256;
    const c = document.createElement("canvas");
    c.width = s; c.height = s;
    const ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0,0,s,s);
    ctx.fillStyle = colorHex;
    const bandH = s*0.46;
    ctx.fillRect(0, s/2 - bandH/2, s, bandH);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    return tex;
  }

  /* ---------------------------------------------------------------
     BALL DIALOGUE — キューボール、および1〜9番ボールをクリックすると
     セリフが浮かぶ(旧・太陽系の惑星が持っていた引用セリフをこちらへ移設)
  --------------------------------------------------------------- */
  // キューボール専用のセリフ(プールそのものについて語る2つの引用)
  const CUE_QUOTES = [
    'Pool. I’ll have to discuss another time. It wasn’t just a game with us, it was almost a Protestant Reformation.\n—Buddy',
    'We shot pool before or after almost every important crisis of our young manhood.\n—Buddy',
  ];
  // 1〜9番ボール用の残り5セット
  const BALL_QUOTES = [
    ['The Ocean Full of Bowling Balls'],
    ['opened a heavy metal door that read:\nTO THE POOL.\n—Teddy'],
    ['But if you get on the other side, where there aren’t any hot-shots, then what’s a game about it?\n—Holden',
     'Life is a game'],
     ['I went down near the lagoon and I sort of skipped the quarters and the nickel across it,'],
    ['He would be all smiles when he heard a responsive click of glass striking glass\n—Buddy',
     'It never appeared to be clear to him whose winning click it was.\n—Buddy'],
    ['One of us will be present at the other chap’s departure for various reasons.\n—Seymour'],
    ['I guess I thought it’d take my mind off getting pneumonia and dying.'],
    ['A man walks along the beach and unfortunately gets hit in the head by a cocoanut.\n—Teddy'],
    ['I guess I thought it’d take my mind off getting pneumonia and dying. It didn’t, though.']
  ];
  // 1〜9番ボールに、上の5セットを順番に(足りない分は繰り返して)割り当てる
  function quotesForBallNumber(num){
    if(!num) return null; // ここではキューボール分は扱わない(CUE_QUOTESを別途使う)
    return BALL_QUOTES[(num - 1) % BALL_QUOTES.length];
  }

  /* ---------------------------------------------------------------
     BALLS — semi-transparent glass/mirror spheres + white cue ball
  --------------------------------------------------------------- */
  const ballGeo = new THREE.SphereGeometry(BALL_R, 48, 48);
  const balls = []; // {mesh, pos:Vector2, vel:Vector2, sunk, sinking, isCue}

  function addBall(num, isCue=false){
    let mat;
    if(isCue){
      mat = new THREE.MeshPhysicalMaterial({
        color: 0xffffff,
        roughness: 0.08,
        metalness: 0.0,
        clearcoat: 1.0,
        clearcoatRoughness: 0.05,
        transmission: 0.06,
        thickness: 0.4,
        envMapIntensity: 1.4,
      });
    } else {
      const isStripe = num === 9;
      mat = new THREE.MeshPhysicalMaterial({
        color: isStripe ? 0xffffff : new THREE.Color(BALL_COLORS[num]),
        map: isStripe ? makeStripeTexture(BALL_COLORS[num]) : null,
        roughness: 0.05,
        metalness: 0.0,
        transmission: 0.82,
        thickness: 0.9,
        ior: 1.45,
        clearcoat: 1.0,
        clearcoatRoughness: 0.06,
        envMapIntensity: 1.6,
        attenuationColor: new THREE.Color(BALL_COLORS[num]),
        attenuationDistance: 0.6,
      });
    }
    const mesh = new THREE.Mesh(ballGeo, mat);
    mesh.position.y = BALL_R;
    mesh.userData.quotes = isCue ? CUE_QUOTES : quotesForBallNumber(num);
    scene.add(mesh);

    const b = {
      mesh,
      pos: new THREE.Vector2(0,0),
      vel: new THREE.Vector2(0,0),
      // 回転が見た目に意味を持つのは模様入りの9番だけ(他は単色球なので
      // 回転してもカメラからは判別できない)。9番以外は spin を持たない
      spin: num === 9 ? new THREE.Vector3((Math.random()-0.5),(Math.random()-0.5),(Math.random()-0.5)) : null,
      sunk:false, sinking:false, sinkT:0, num, isCue
    };
    balls.push(b);
    return b;
  }

  /* nine-ball diamond rack, apex on the foot spot (accurate standard geometry:
     apex 1/4 of the table length from the foot rail), centred on x=0.
     指定により左右反転:ラックを-Z側(旧キューボール側)に配置している */
  const rackOrder = [1,2,3,4,9,5,6,7,8]; // 9 goes to the centre slot
  const rackPositions = [];
  const APEX_Z = -HALF_Z * 0.5; // foot spot (反転)
  {
    const spacing = BALL_R*2 + 0.01; // balls racked touching, small tolerance
    const rows = [1,2,3,2,1];
    rows.forEach((count,row)=>{
      const z = APEX_Z - row*spacing*0.8660254; // sqrt(3)/2 row pitch for a tight triangle
      const rowWidth = (count-1)*spacing;
      for(let i=0;i<count;i++){
        const x = -rowWidth/2 + i*spacing;
        rackPositions.push(new THREE.Vector2(x,z));
      }
    });
  }
  rackOrder.forEach((num,i)=>{
    const b = addBall(num,false);
    b.pos.copy(rackPositions[i]);
  });
  const cue = addBall(0,true);

  let activeQuoteBall = null;
  let quoteTimer = null;
  const quoteOffset = new THREE.Vector3(0, 0.55, 0);

  function showBallQuote(text, ballMesh) {
    ballDialogueEl.textContent = text;
    ballDialogueEl.classList.add('show');
    activeQuoteBall = ballMesh || null;
    updateQuotePosition();

    clearTimeout(quoteTimer);
    quoteTimer = setTimeout(() => {
      ballDialogueEl.classList.remove('show');
      activeQuoteBall = null;
    }, 10000);
  }

  function updateQuotePosition() {
    if (!activeQuoteBall) return;
    const v = activeQuoteBall.position.clone().add(quoteOffset).project(camera);
    ballDialogueEl.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    ballDialogueEl.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }

  const HEAD_Z = HALF_Z * 0.55; // head spot, behind the head string(反転:+Z側)

  /* accurate straight break: cue ball on the centre line at the head spot,
     struck dead-centre into the apex ball — a real, powerful break shot */
  function setupBreakShot(speed){
    const apex = balls[0]; // ball #1 is rack index 0 == apex
    cue.pos.set(0, HEAD_Z);
    const dir = apex.pos.clone().sub(cue.pos).normalize();
    cue.vel.copy(dir.multiplyScalar(speed));
  }

  /* ---------------------------------------------------------------
     PHYSICS SIM (runs once for the break, then settles)
  --------------------------------------------------------------- */
  let simActive = false;
  let simSettleTimer = 0;
  let firstImpactDone = false;
  const FRICTION = 0.24;      // lighter drag so balls keep rebounding off the rails
  const RESTITUTION = 0.92;   // lively rail bounces, easy to see the wall collisions at work
  const STOP_EPS = 0.02;
  const REST_EPS = 0.045;     // below this speed a ball is treated as fully at rest —
                               // stops the endless tiny impulse/overlap jitter that used
                               // to keep the settled rack "breathing" forever

  function resetBallVisualPositions(){
    balls.forEach(b=>{
      b.sunk=false; b.sinking=false; b.sinkT=0;
      b.mesh.visible = true;
      b.mesh.scale.setScalar(1);
      b.mesh.position.set(b.pos.x, BALL_R, b.pos.y);
    });
  }

  function startBreak(){
    // 沈んだボールは resolvePocket() で捕まった瞬間の速度を凍結したまま
    // 保持している(stepPhysics / 摩擦処理が sunk/sinking を丸ごとスキップ
    // するため)。ここで全ボールの速度をゼロに戻してからでないと、前回の
    // ブレイクで落ちたボールがキュー接触前から動き出してしまう
    // (初回だけ正常に見えたのはこの残留速度がまだ存在しないため)。
    balls.forEach(b=>{ b.vel.set(0,0); });

    // reset positions
    rackOrder.forEach((num,i)=>{ balls[i].pos.copy(rackPositions[i]); });
    setupBreakShot(17.5); // a real break-shot speed(↑の一括ゼロ化の後で呼ぶことで、
                           // キューの初速だけはここで正しく設定される)
    resetBallVisualPositions();

    waterUniforms.uRippleStart.value = -999; // fires on first contact, not now
    waterUniforms.uSplashStart.value = -999;
    firstImpactDone = false;

    simActive = true;
    simSettleTimer = 0;
    hint.style.opacity = "1";
  }

  function resolvePocket(b, dt){
    for(const c of pockets){
      const d = b.pos.distanceTo(c);
      if(d < POCKET_R + BALL_R*0.4 && !b.sunk && !b.sinking){
        // gentle suction as it nears the pocket
        const pull = c.clone().sub(b.pos).normalize().multiplyScalar(4.5*dt);
        b.vel.add(pull);
      }
      if(d < POCKET_CAPTURE && !b.sunk && !b.sinking){
        b.sinking = true;
        b.sinkT = 0;
        // every pocket splashes where the ball actually went in
        waterUniforms.uSplashStart.value = clock.elapsedTime;
        waterUniforms.uSplashOrigin.value.copy(c);
        return;
      }
    }
  }

  function stepPhysics(dt){
    const sub = 8; // more substeps needed at break-shot speeds to avoid tunnelling
    const sdt = dt/sub;

    for(let s=0;s<sub;s++){
      balls.forEach(b=>{
        if(b.sunk || b.sinking) return;
        b.pos.addScaledVector(b.vel, sdt);

        // wall bounce against the rectangular rails (skip near a pocket mouth)
        const nearPocket = pockets.some(c=>b.pos.distanceTo(c) < POCKET_R+BALL_R);
        if(!nearPocket){
          if(b.pos.x > HALF_X-BALL_R){ b.pos.x = HALF_X-BALL_R; b.vel.x *= -RESTITUTION; }
          if(b.pos.x < -HALF_X+BALL_R){ b.pos.x = -HALF_X+BALL_R; b.vel.x *= -RESTITUTION; }
          if(b.pos.y > HALF_Z-BALL_R){ b.pos.y = HALF_Z-BALL_R; b.vel.y *= -RESTITUTION; }
          if(b.pos.y < -HALF_Z+BALL_R){ b.pos.y = -HALF_Z+BALL_R; b.vel.y *= -RESTITUTION; }
        }
      });

      // pairwise collisions
      for(let i=0;i<balls.length;i++){
        const a = balls[i];
        if(a.sunk||a.sinking) continue;
        for(let j=i+1;j<balls.length;j++){
          const b = balls[j];
          if(b.sunk||b.sinking) continue;
          const delta = b.pos.clone().sub(a.pos);
          const dist = delta.length();
          const minDist = BALL_R*2;

          // two balls that are both essentially at rest need no correction —
          // this is what kept the racked balls "breathing" before contact
          const bothResting = a.vel.lengthSq() < REST_EPS*REST_EPS && b.vel.lengthSq() < REST_EPS*REST_EPS;

          if(!bothResting && dist>0 && dist < minDist){
            const n = delta.multiplyScalar(1/dist);
            const overlap = (minDist-dist)/2;
            a.pos.addScaledVector(n,-overlap);
            b.pos.addScaledVector(n, overlap);

            const rv = b.vel.clone().sub(a.vel);
            const velAlongNormal = rv.dot(n);
            if(velAlongNormal < 0){
              const impulse = n.clone().multiplyScalar(velAlongNormal);
              a.vel.add(impulse);
              b.vel.sub(impulse);

              // fire the pocket-portal ripple the instant the cue ball
              // actually strikes the rack — not at the moment the shot starts
              if(!firstImpactDone && (a.isCue || b.isCue)){
                firstImpactDone = true;
                waterUniforms.uRippleStart.value = clock.elapsedTime;
                waterUniforms.uRippleOrigin.value.copy(TARGET_POCKET);
              }
            }
          }
        }
      }

      // friction (light — this is a break shot, balls should keep travelling
      // and bouncing off the rails rather than settle immediately)
      const damp = Math.pow(1-FRICTION, sdt);
      balls.forEach(b=>{
        if(b.sunk || b.sinking) return;
        b.vel.multiplyScalar(damp);
        // snap tiny residual velocity to true zero so resting balls stop
        // exchanging micro-impulses and actually come to rest
        if(b.vel.lengthSq() < REST_EPS*REST_EPS*0.25) b.vel.set(0,0);
      });
    }

    balls.forEach(b=>{ if(!b.sunk && !b.sinking) resolvePocket(b, dt); });
  }

  function updateSinking(dt){
    balls.forEach(b=>{
      if(b.sinking && !b.sunk){
        b.sinkT += dt;
        const t = Math.min(b.sinkT/0.7, 1);
        b.mesh.position.y = BALL_R - t*0.9;
        b.mesh.scale.setScalar(1-t*0.9);
        const c = pockets.reduce((best,c)=> b.pos.distanceTo(c) < b.pos.distanceTo(best)?c:best, pockets[0]);
        b.pos.lerp(c, 0.06);
        if(t>=1){ b.sunk=true; b.sinking=false; b.mesh.visible=false; }
      }
    });
  }

  function syncMeshes(dt){
    balls.forEach(b=>{
      if(b.sunk) return;
      if(!b.sinking) b.mesh.position.set(b.pos.x, BALL_R, b.pos.y);
      // 9番だけ帯模様があり回転が見た目に反映されるので、9番だけ回転させる。
      // キューボールと他の単色ボールは回転させても見分けがつかないので廃止。
      if(b.num === 9){
        b.mesh.rotation.x += b.spin.x*dt*b.vel.length()*1.4;
        b.mesh.rotation.z += b.spin.z*dt*b.vel.length()*1.4;
      }
    });
  }

  /* ---------------------------------------------------------------
     MAIN LOOP
  --------------------------------------------------------------- */
  const clock = new THREE.Clock();

  replayBtn.addEventListener("click", startBreak);

  /* ---------------------------------------------------------------
     INTERACTION — 球のクリック(セリフ表示) / ポケットのホバー(作品名表示)
  --------------------------------------------------------------- */
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();

  function setPointerFromEvent(e){
    pointer.x = (e.clientX / innerWidth) * 2 - 1;
    pointer.y = -(e.clientY / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);
  }

  renderer.domElement.addEventListener('click', (e) => {
    setPointerFromEvent(e);
    const ballMeshes = balls.filter(b => !b.sunk && !b.sinking).map(b => b.mesh);
    const hit = raycaster.intersectObjects(ballMeshes)[0];
    if (hit) {
      const quotes = hit.object.userData.quotes;
      if (quotes && quotes.length) {
        const text = quotes[Math.floor(Math.random() * quotes.length)];
        showBallQuote(text, hit.object);
      }
    }
  });

  renderer.domElement.addEventListener('pointermove', (e) => {
    setPointerFromEvent(e);
    const hitAreas = pocketMeshes.map(p => p.hitArea);
    const pocketHit = raycaster.intersectObjects(hitAreas)[0];
    if (pocketHit) {
      const p = pocketMeshes.find(pm => pm.hitArea === pocketHit.object);
      const v = new THREE.Vector3(p.pos.x, 0.3, p.pos.y).project(camera);
      pocketTooltipEl.textContent = p.workTitle;
      pocketTooltipEl.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
      pocketTooltipEl.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
      pocketTooltipEl.classList.add('show');
      renderer.domElement.style.cursor = 'default';
    } else {
      pocketTooltipEl.classList.remove('show');
    }
  });

  function loop(){
    rafId = requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.033);
    const t = clock.elapsedTime;

    waterUniforms.uTime.value = t;
    waterUniforms.uCamPos.value.copy(camera.position);

    if(simActive){
      stepPhysics(dt);
      updateSinking(dt);
      syncMeshes(dt);

      const totalSpeed = balls.reduce((s,b)=> s + (b.sunk?0:b.vel.length()), 0);
      if(totalSpeed < STOP_EPS){
        simSettleTimer += dt;
        if(simSettleTimer > 1.0){
          simActive = false;
          hint.style.opacity = "0";
        }
      } else {
        simSettleTimer = 0;
      }
    }

    updateQuotePosition();

    pocketMeshes.forEach(p=>{
      const pulse = Math.sin(t*1.1 + p.pos.x) * 0.5 + 0.5;
      p.light.intensity = 15 + pulse * 3.0;
      p.glow.material.opacity = Math.min(1, 0.9 + pulse * 0.1);
      p.core.material.opacity = Math.min(1, 0.95 + pulse * 0.1);
      p.beam.material.opacity = Math.min(1, 0.7 + pulse * 0.12);
    });

    controls.update();
    renderer.render(scene, camera);
  }

  function show() {
    overlay.classList.add('show');
    startBreak();
    if (!rafId) loop();
  }

  function hide() {
    overlay.classList.remove('show');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    clearTimeout(quoteTimer);
    ballDialogueEl.classList.remove('show');
    activeQuoteBall = null;
    pocketTooltipEl.classList.remove('show');
  }

  closeBtn.addEventListener('click', () => {
    hide();
    if (onClose) onClose();
  });

  return { show, hide, isVisible: () => overlay.classList.contains('show') };
}