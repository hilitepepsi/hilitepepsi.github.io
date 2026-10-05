import * as THREE from 'three';
import { createBackButton } from './iconButton.js';

// ── バナナフィッシュ・オーバーレイ(A Perfect Day for Bananafish) ─────────────
// 元は独立した bananafish.html(ホテルの一室:窓側=波、扉側=砂の3Dシーン)だったものを、
// billiardTable.js と同じ「メインシーンとはWebGLコンテキストを分離した、独立canvas+
// 独立rAFループのフルスクリーンHTMLオーバーレイ」の形に移植したもの。
// Y軸ステーションの原点の点をクリックするとこのページに切り替わり、
// 「← 戻る」でYステーションへ戻る(billiardTableと全く同じ導線・同じ仕組み)。
//
// 移植にあたっての変更点(ロジック自体はbananafish.htmlのまま):
//   - 独立<canvas>+<body>直付けのbackButtonをやめ、billiardTableと同じ
//     overlay div + 共通コンポーネント(iconButton.jsのcreateBackButton)にした
//   - render loopはページ読み込み時に即座に回さず、show()/hide()でrAFの開始/停止を
//     制御する(billiardTableのrafId方式と同じ)
//   - show()のたびに、カメラの向き・発砲済みフラグ・引用/テキストの表示状態などを
//     初期状態へ戻す(billiardTableがshow()のたびにstartBreak()で盤面をリセットする
//     のと同じ考え方)
//   - THREE.sRGBEncoding / renderer.outputEncoding(r128当時のAPI)は、このプロジェクトが
//     使っている現行three.jsのAPIであるcolorSpace / THREE.SRGBColorSpaceに置き換えた
export function createBananafish(opts = {}) {
  const { onClose } = opts;

  const overlay = document.createElement('div');
  overlay.className = 'bananafish-overlay';
  document.body.appendChild(overlay);

  // 見た目(z-index/transition/背景)はbilliard-overlayと同じ仕様でstyle.cssに定義済み
  // (.bananafish-overlay / .bananafish-close)。ここでの独自スタイル注入はしない。
  const closeBtn = createBackButton({ className: 'bananafish-close', ariaLabel: '戻る' });
  overlay.appendChild(closeBtn);

  let rafId = null;

  /* ---------------------------------------------------------------
     BASIC SETUP
  --------------------------------------------------------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  overlay.appendChild(renderer.domElement);
  const canvas = renderer.domElement;

  // ---------- room shell dimensions, defined early so the camera clamp (below) can use them ----------
  // The room is treated as a hotel room:
  //   floor  = the particle wave surface
  //   front wall plane (nearest the camera) carries a glass WINDOW
  //   back wall plane (the far / "opposite" side) carries a glass DOOR showing "the young man"
  // (the walls/ceiling/floor themselves are not solid meshes - only the window/door glass planes are)
  const ROOM_X_MIN = -5.4, ROOM_X_MAX = 5.4;
  const ROOM_Z_MAX = -0.8;                 // front wall plane (window side, closest to the camera)
  const ROOM_DEPTH = 11.5;
  const ROOM_Z_MIN = ROOM_Z_MAX - ROOM_DEPTH; // back wall plane (door side, opposite the window)
  const ROOM_HEIGHT = 4.4;
  const ROOM_CENTER_X = (ROOM_X_MIN + ROOM_X_MAX) / 2;
  const ROOM_CENTER_Z = (ROOM_Z_MIN + ROOM_Z_MAX) / 2;

  const scene = new THREE.Scene();
  scene.background = null;
  scene.fog = new THREE.Fog(0xffffff, 9, 30); // far distance nudged out a bit to match the widened zoom-out range

  const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 100);

  // ---------- manual camera orbit ----------
  const camTarget = new THREE.Vector3(0, 0.7, ROOM_CENTER_Z);
  const INITIAL_RADIUS = 9.6, INITIAL_AZIMUTH = Math.PI, INITIAL_POLAR = 1.34; // a bit further back than before, so the default door-side view isn't right up against the wall
  let radius = INITIAL_RADIUS, azimuth = INITIAL_AZIMUTH, polar = INITIAL_POLAR;
  const POLAR_MIN = 0.85, POLAR_MAX = 1.85;
  const ROOM_SAFE_MARGIN = 0.5; // keep the viewer standing just outside whichever wall they're nearest to
  function keepCameraOutsideRoom(){
    const p = camera.position;
    const insideX = p.x > ROOM_X_MIN && p.x < ROOM_X_MAX;
    const insideY = p.y > 0 && p.y < ROOM_HEIGHT;
    const insideZ = p.z > ROOM_Z_MIN && p.z < ROOM_Z_MAX;
    if (insideX && insideY && insideZ){
      // push out through whichever of the four side walls is closest (never through floor/ceiling)
      const dLeft = p.x - ROOM_X_MIN;
      const dRight = ROOM_X_MAX - p.x;
      const dFront = ROOM_Z_MAX - p.z;
      const dBack = p.z - ROOM_Z_MIN;
      const m = Math.min(dLeft, dRight, dFront, dBack);
      if (m === dFront) p.z = ROOM_Z_MAX + ROOM_SAFE_MARGIN;
      else if (m === dBack) p.z = ROOM_Z_MIN - ROOM_SAFE_MARGIN;
      else if (m === dLeft) p.x = ROOM_X_MIN - ROOM_SAFE_MARGIN;
      else p.x = ROOM_X_MAX + ROOM_SAFE_MARGIN;
    }
    if (p.y < 0.15) p.y = 0.15;
  }
  function updateCamera(){
    const sinP = Math.sin(polar), cosP = Math.cos(polar);
    camera.position.set(
      camTarget.x + radius * sinP * Math.sin(azimuth),
      camTarget.y + radius * cosP,
      camTarget.z + radius * sinP * Math.cos(azimuth)
    );
    keepCameraOutsideRoom();
    camera.lookAt(camTarget);
  }
  updateCamera();

  // ---------- lighting: dim ambient, key/rim lights now live inside the room ----------
  scene.add(new THREE.AmbientLight(0x334455, 0.55));
  const key = new THREE.DirectionalLight(0xffffff, 0.55);
  key.position.set(2.2, ROOM_HEIGHT - 0.4, ROOM_CENTER_Z);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x8fb0d8, 0.35);
  rim.position.set(-3, 1.6, ROOM_CENTER_Z - 2);
  scene.add(rim);

  const clock = new THREE.Clock();

  // ---------- one field of waves, ported directly from franky-adl/waves-value-noise ----------
  // same recipe as the reference demo: two layered 2D value-noise fields (the 2nd
  // rotated 45deg and drifting the other way), displacing point height in the vertex shader.
  // colored with a blue-to-turquoise gradient driven by the wave height.
  // This is the room's FLOOR: sized to exactly fill the room footprint.
  const WAVE_ROWS = 108, WAVE_COLS = 108;
  const WAVE_WIDTH = ROOM_X_MAX - ROOM_X_MIN;     // 10.8, matches room width
  const WAVE_DEPTH = ROOM_DEPTH;                  // 11.5, matches room depth
  const WAVE_BASE_Z = ROOM_CENTER_Z;              // plane centered in the room, spans ROOM_Z_MIN..ROOM_Z_MAX exactly
  const HOVER_RADIUS = 1.1;
  const hoverPoint = new THREE.Vector3(9999, 9999, 9999);

  function smoothstep(edge0, edge1, x){
    const tt = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
    return tt * tt * (3 - 2 * tt);
  }

  const waveUniforms = {
    u_time: { value: 0 },
    u_pointsize: { value: 2.0 },           // same constant point size (px) as the reference demo
    u_noise_freq_1: { value: 3.0 },        // same params as the reference demo's defaults
    u_noise_amp_1: { value: 0.2 },
    u_spd_modifier_1: { value: 1.0 },
    u_noise_freq_2: { value: 2.0 },
    u_noise_amp_2: { value: 0.3 },
    u_spd_modifier_2: { value: 0.8 },
    u_colorA: { value: new THREE.Color(0x2b6cb0) },   // blue - wave
    u_colorB: { value: new THREE.Color(0x30e0c8) },   // turquoise - wave
    u_colorSkin: { value: new THREE.Color(0xedb894) }, // sand
    // per-point "seen through the window" test, replacing the old whole-floor camera-side toggle:
    // only the patch of floor whose sightline to the camera actually threads through the window
    // opening turns into wave; everywhere else (including the rest of the floor when standing at
    // the window, and the whole floor from the door side) stays flat sand. See the vertex shader.
    u_windowZ: { value: ROOM_Z_MAX },
    u_windowCenterX: { value: 0 }, // filled in once PANEL_CENTER_X/Y/WIDTH/HEIGHT are defined, below
    u_windowCenterY: { value: 0 },
    u_windowHalfW: { value: 0 },
    u_windowHalfH: { value: 0 },
    u_fireActive: { value: 0.0 },   // 1 while the on-fire sand sweep/release effect is running
    u_fireFrontX: { value: -999 },  // current x position of the sweep front, in the wave plane's local space
    u_fireEdge: { value: 0.6 },     // softness of the sweep front
  };

  const waveGeo = new THREE.PlaneGeometry(WAVE_WIDTH, WAVE_DEPTH, WAVE_ROWS, WAVE_COLS);

  const waveMat = new THREE.ShaderMaterial({
    uniforms: waveUniforms,
    transparent: true,
    depthWrite: false,
    vertexShader: `
      #define PI 3.14159265359
      uniform float u_time;
      uniform float u_pointsize;
      uniform float u_noise_amp_1;
      uniform float u_noise_freq_1;
      uniform float u_spd_modifier_1;
      uniform float u_noise_amp_2;
      uniform float u_noise_freq_2;
      uniform float u_spd_modifier_2;
      uniform float u_windowZ;
      uniform float u_windowCenterX;
      uniform float u_windowCenterY;
      uniform float u_windowHalfW;
      uniform float u_windowHalfH;
      uniform float u_fireActive;
      uniform float u_fireFrontX;
      uniform float u_fireEdge;
      varying float vHeight;
      varying float vSandMix;

      float random(in vec2 st){
        return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
      }
      float noise(in vec2 st){
        vec2 i = floor(st);
        vec2 f = fract(st);
        float a = random(i);
        float b = random(i + vec2(1.0, 0.0));
        float c = random(i + vec2(0.0, 1.0));
        float d = random(i + vec2(1.0, 1.0));
        vec2 u = f*f*(3.0-2.0*f);
        return mix(a, b, u.x) + (c - a) * u.y * (1.0 - u.x) + (d - b) * u.x * u.y;
      }
      mat2 rotate2d(float angle){
        return mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
      }

      void main(){
        gl_PointSize = u_pointsize;

        // plane's local xy is our ground-plane x/z; we displace local z (becomes height after rotation)
        vec3 pos = position;
        float h = noise(pos.xy * u_noise_freq_1 + u_time * u_spd_modifier_1) * u_noise_amp_1;
        h += noise(rotate2d(PI / 4.0) * pos.yx * u_noise_freq_2 - u_time * u_spd_modifier_2 * 0.6) * u_noise_amp_2;

        // per-point "seen through the window" test: this patch of floor only turns into wave if the
        // sightline from the camera to it actually threads through the window opening. Height (h) is
        // a small perturbation, so using the flat (pre-displacement) position here is an accurate
        // enough approximation of this point's true world location for the test below.
        vec4 worldPos4 = modelMatrix * vec4(position, 1.0);
        vec3 worldPos = worldPos4.xyz;
        float throughWindow = 0.0;
        float dz = worldPos.z - cameraPosition.z;
        if (abs(dz) > 0.000001) {
          float tt = (u_windowZ - cameraPosition.z) / dz;
          if (tt > 0.0 && tt < 1.0) {
            float ix = cameraPosition.x + (worldPos.x - cameraPosition.x) * tt;
            float iy = cameraPosition.y + (worldPos.y - cameraPosition.y) * tt;
            float edge = 0.6; // softness of the window-shaped boundary, in world units
            float wx = smoothstep(u_windowCenterX - u_windowHalfW - edge, u_windowCenterX - u_windowHalfW + edge, ix)
                     - smoothstep(u_windowCenterX + u_windowHalfW - edge, u_windowCenterX + u_windowHalfW + edge, ix);
            float wy = smoothstep(u_windowCenterY - u_windowHalfH - edge, u_windowCenterY - u_windowHalfH + edge, iy)
                     - smoothstep(u_windowCenterY + u_windowHalfH - edge, u_windowCenterY + u_windowHalfH + edge, iy);
            throughWindow = clamp(wx * wy, 0.0, 1.0);
          }
        }

        // on fire: a fast wipe turns the wave into sand (front sweeps left to right), then releases
        // the same way but from the other end (front sweeps right to left, so the right side heals first)
        float fireFactor = 0.0;
        if (u_fireActive > 0.5) {
          float wipe = smoothstep(u_fireFrontX - u_fireEdge, u_fireFrontX + u_fireEdge, pos.x);
          fireFactor = 1.0 - wipe;
        }
        float sandMix = max(1.0 - throughWindow, fireFactor);

        h *= (1.0 - sandMix); // sand (outside the window's view, or the fire wipe): flattens out into a plane of sand
        pos.z += h;
        vHeight = h;
        vSandMix = sandMix;

        vec4 mvm = modelViewMatrix * vec4(pos, 1.0);
        gl_Position = projectionMatrix * mvm;
      }
    `,
    fragmentShader: `
      uniform vec3 u_colorA;
      uniform vec3 u_colorB;
      uniform vec3 u_colorSkin;
      varying float vHeight;
      varying float vSandMix;
      void main(){
        float t = smoothstep(0.0, 0.5, vHeight);
        vec3 waveColor = mix(u_colorA, u_colorB, t);
        vec3 color = mix(waveColor, u_colorSkin, vSandMix);
        gl_FragColor = vec4(color, 0.95);
      }
    `
  });
  const waveMesh = new THREE.Points(waveGeo, waveMat);
  waveMesh.rotation.x = -Math.PI / 2;
  waveMesh.position.set(0, 0.02, WAVE_BASE_Z);
  scene.add(waveMesh);

  // ---------- helper: canvas text ----------
  function makeTextCanvas(text, {w, h, font, color, blurPx, x, align='center'}){
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0,0,w,h);
    ctx.font = font;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    ctx.fillStyle = color;
    if (blurPx) ctx.filter = `blur(${blurPx}px)`;
    ctx.fillText(text, x===undefined ? w/2 : x, h/2);
    ctx.filter = 'none';
    return cv;
  }

  // ---------- "the young man": lives on the glass DOOR set into the back (opposite) wall ----------
  const TXT_W = 4.4, TXT_H = 1.6;
  const textCanvas = makeTextCanvas('the young man', { w:1400, h:500, font:'italic 900 96px Georgia, serif', color:'#ffffff', blurPx:0 });
  const textTex = new THREE.CanvasTexture(textCanvas);
  textTex.colorSpace = THREE.SRGBColorSpace;

  const floatingTextMat = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
    uniforms:{
      uTex:{ value:textTex },
      uGreen:{ value:new THREE.Color(0x0e9f6e) },
      uBlue:{ value:new THREE.Color(0x2051f0) },
      uReveal:{ value:0.0 },
      uWindowSeen:{ value:0.0 }, // 1 = the sightline to this text actually threads through the window opening (green); otherwise blue
    },
    vertexShader:`
      varying vec2 vUv;
      void main(){
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader:`
      uniform sampler2D uTex;
      uniform vec3 uGreen;
      uniform vec3 uBlue;
      uniform float uReveal;
      uniform float uWindowSeen;
      varying vec2 vUv;
      void main(){
        // Reading direction still follows which face we're looking at (front = normal reading,
        // back = un-mirror the UV so the text reads correctly from the door side too).
        // Color, however, no longer follows the face: green only when the camera's actual
        // sightline to this text threads through the window opening; blue in every other case
        // (including window-side views that aren't lined up with the window itself).
        vec2 uv = gl_FrontFacing ? vUv : vec2(1.0 - vUv.x, vUv.y);
        vec4 tx = texture2D(uTex, uv);
        float coverage = tx.a;
        if (coverage < 0.05 || uReveal < 0.02) discard;
        vec3 col = mix(uBlue, uGreen, uWindowSeen);
        gl_FragColor = vec4(col, coverage * uReveal);
      }
    `
  });

  // door frame dimensions (the back wall's opening) - a floor-to-near-ceiling glass door
  const DOOR_W = 2.6, DOOR_H = 3.4;
  const DOOR_CENTER_X = 0, DOOR_CENTER_Y = DOOR_H / 2; // flush with the floor

  const floatingText = new THREE.Mesh(new THREE.PlaneGeometry(TXT_W, TXT_H), floatingTextMat);
  floatingText.position.set(DOOR_CENTER_X, DOOR_CENTER_Y + 0.35, ROOM_Z_MIN + 0.03);
  // hidden until the shot reaches the door (uReveal starts at 0); then appears - green from the window side, blue from the door side
  scene.add(floatingText);

  // plain glass filling the rest of the door (the text mesh above sits on top of it)
  const doorGlassMat = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
    uniforms:{
      uGlassTint:{ value:new THREE.Color(0xf4fbfd) },
      uGlassOpacity:{ value:0.08 },
      uRimColor:{ value:new THREE.Color(0x8fd0e0) },
    },
    vertexShader:`
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      void main(){
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader:`
      uniform vec3 uGlassTint;
      uniform float uGlassOpacity;
      uniform vec3 uRimColor;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      void main(){
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormalW))), 3.0);
        float rim = fresnel * 0.55;
        vec3 color = mix(uGlassTint, uRimColor, rim);
        float alpha = clamp(uGlassOpacity + rim, 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
  const doorGlass = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), doorGlassMat);
  doorGlass.position.set(DOOR_CENTER_X, DOOR_CENTER_Y, ROOM_Z_MIN + 0.02);
  scene.add(doorGlass);
  const doorEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(doorGlass.geometry),
    new THREE.LineBasicMaterial({ color:0x7fb8c8, transparent:true, opacity:0.6 })
  );
  doorEdge.position.copy(doorGlass.position);
  scene.add(doorEdge);

  // ---------- crack overlay: the door glass shatters at the point of impact, then heals as the sand effect releases ----------
  function makeCrackCanvas(){
    const w = 1024, h = 1024;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    const cx = w/2, cy = h*0.42; // roughly where the shot lands (matches the floating text's offset)
    ctx.lineCap = 'round';
    // long radiating cracks, each a jagged random-walk line out from the impact point
    const mainCount = 10;
    for(let i=0;i<mainCount;i++){
      let a = (i/mainCount)*Math.PI*2 + (Math.random()-0.5)*0.35;
      let x = cx, y = cy, remaining = 230 + Math.random()*360;
      ctx.strokeStyle = `rgba(255,255,255,${0.75 + Math.random()*0.2})`;
      ctx.lineWidth = 2 + Math.random()*2;
      ctx.beginPath();
      ctx.moveTo(x, y);
      while (remaining > 0){
        const step = 26 + Math.random()*46;
        a += (Math.random()-0.5)*0.55;
        x += Math.cos(a)*step;
        y += Math.sin(a)*step;
        ctx.lineTo(x, y);
        remaining -= step;
      }
      ctx.stroke();
    }
    // short web of fractures right around the impact point
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 2.5;
    for(let i=0;i<16;i++){
      const a = Math.random()*Math.PI*2;
      const len = 18 + Math.random()*55;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(cx + Math.cos(a)*len, cy + Math.sin(a)*len);
      ctx.stroke();
    }
    // the impact hole itself
    ctx.fillStyle = 'rgba(255,255,255,0.92)';
    ctx.beginPath(); ctx.arc(cx, cy, 9, 0, Math.PI*2); ctx.fill();
    return cv;
  }
  const crackTex = new THREE.CanvasTexture(makeCrackCanvas());
  crackTex.colorSpace = THREE.SRGBColorSpace;
  const crackMat = new THREE.MeshBasicMaterial({ map:crackTex, transparent:true, depthWrite:false, side:THREE.DoubleSide, opacity:0 });
  const crackPlane = new THREE.Mesh(new THREE.PlaneGeometry(DOOR_W, DOOR_H), crackMat);
  crackPlane.position.set(DOOR_CENTER_X, DOOR_CENTER_Y, ROOM_Z_MIN + 0.021);
  scene.add(crackPlane);

  // ---------- room number, mounted above the door ----------
  const roomNumberCanvas = makeTextCanvas('507', { w:512, h:256, font:'600 150px Georgia, serif', color:'#2a2a28', blurPx:0 });
  const roomNumberTex = new THREE.CanvasTexture(roomNumberCanvas);
  roomNumberTex.colorSpace = THREE.SRGBColorSpace;
  const roomNumberMat = new THREE.MeshBasicMaterial({ map:roomNumberTex, transparent:true, depthWrite:false, side:THREE.BackSide });
  const roomNumberPlane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.45), roomNumberMat);
  roomNumberPlane.position.set(DOOR_CENTER_X, DOOR_H + 0.35, ROOM_Z_MIN - 0.03); // above the door, outside the room
  roomNumberPlane.scale.x = -1; // un-mirror so it reads correctly from the door (outside) side
  // side:BackSide (set above) means the mirrored front face simply isn't drawn - so this plaque
  // is only ever visible from the door side, never as a backwards "705" from the far side.
  scene.add(roomNumberPlane);

  // ---------- glass panel: the room's WINDOW, set into the front wall, carrying "Buddy" / "Seymour" ----------
  const PANEL_WIDTH = 6.4, PANEL_HEIGHT = 2.0; // height extended upward a bit (bottom edge stays put)
  const PANEL_CENTER_X = 0, PANEL_CENTER_Y = 1.65;
  // now that the window's geometry is known, tell the floor's wave shader where that opening is
  // (see the "seen through the window" test in waveMat's vertex shader, above)
  waveUniforms.u_windowCenterX.value = PANEL_CENTER_X;
  waveUniforms.u_windowCenterY.value = PANEL_CENTER_Y;
  waveUniforms.u_windowHalfW.value = PANEL_WIDTH / 2;
  waveUniforms.u_windowHalfH.value = PANEL_HEIGHT / 2;
  // "Buddy" / "Seymour" - visible only from the window side (see uTextVisible, updated each frame)
  const panelCanvas = document.createElement('canvas');
  panelCanvas.width = 2048; panelCanvas.height = 512;
  let buddyBoxUV = null;
  let seymourBoxUV = null;
  (function(){
    const ctx = panelCanvas.getContext('2d');
    ctx.font = 'italic 52px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const buddyX = 460, buddyY = 256;
    const buddyW = ctx.measureText('Buddy').width;
    ctx.fillStyle = '#d9cd29';
    ctx.fillText('Buddy', buddyX, buddyY);
    const seymourX = 1600, seymourY = 256;
    const seymourW = ctx.measureText('Seymour').width;
    ctx.fillStyle = '#2051f0';
    ctx.fillText('Seymour', seymourX, seymourY);
    // clickable boxes around "Buddy" / "Seymour", in UV space (0..1); generous padding for easy tapping
    const padX = 60, padY = 46;
    const buddyXMin = buddyX - buddyW/2 - padX, buddyXMax = buddyX + buddyW/2 + padX;
    const buddyYMin = buddyY - padY, buddyYMax = buddyY + padY;
    buddyBoxUV = {
      uMin: buddyXMin / panelCanvas.width, uMax: buddyXMax / panelCanvas.width,
      vMin: 1 - buddyYMax / panelCanvas.height, vMax: 1 - buddyYMin / panelCanvas.height,
    };
    const seymourXMin = seymourX - seymourW/2 - padX, seymourXMax = seymourX + seymourW/2 + padX;
    const seymourYMin = seymourY - padY, seymourYMax = seymourY + padY;
    seymourBoxUV = {
      uMin: seymourXMin / panelCanvas.width, uMax: seymourXMax / panelCanvas.width,
      vMin: 1 - seymourYMax / panelCanvas.height, vMax: 1 - seymourYMin / panelCanvas.height,
    };
  })();
  const panelTex = new THREE.CanvasTexture(panelCanvas);
  panelTex.colorSpace = THREE.SRGBColorSpace;

  const panelMat = new THREE.ShaderMaterial({
    transparent:true, depthWrite:false, side:THREE.DoubleSide,
    uniforms:{
      uTex:{ value:panelTex },
      uGlassTint:{ value:new THREE.Color(0xf4fbfd) },   // barely-there, almost colorless
      uGlassOpacity:{ value:0.10 },                      // very faint body tint
      uRimColor:{ value:new THREE.Color(0x8fd0e0) },     // soft cyan glint at grazing angles
      uTextVisible:{ value:1.0 },                        // 1 = window side (text shows), 0 = door side (plain glass)
    },
    vertexShader:`
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      void main(){
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vNormalW = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader:`
      uniform sampler2D uTex;
      uniform vec3 uGlassTint;
      uniform float uGlassOpacity;
      uniform vec3 uRimColor;
      uniform float uTextVisible;
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vNormalW;
      void main(){
        vec4 tx = texture2D(uTex, vUv);
        float textA = tx.a * uTextVisible;
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float fresnel = pow(1.0 - abs(dot(viewDir, normalize(vNormalW))), 3.0);
        vec3 baseColor = mix(uGlassTint, tx.rgb, textA);
        float baseAlpha = mix(uGlassOpacity, 0.85, textA);
        float rim = fresnel * 0.55;
        vec3 color = mix(baseColor, uRimColor, rim);
        float alpha = clamp(baseAlpha + rim, 0.0, 1.0);
        gl_FragColor = vec4(color, alpha);
      }
    `
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_WIDTH, PANEL_HEIGHT), panelMat);
  panel.position.set(PANEL_CENTER_X, PANEL_CENTER_Y, ROOM_Z_MAX - 0.02);
  scene.add(panel);
  const panelEdge = new THREE.LineSegments(
    new THREE.EdgesGeometry(panel.geometry),
    new THREE.LineBasicMaterial({ color:0x7fb8c8, transparent:true, opacity:0.6 })
  );
  panelEdge.position.copy(panel.position);
  scene.add(panelEdge);

  // ---------- simple twin beds: two rounded mattress-top planes, window side, at the window's sill height ----------
  // visible only when actually seen through the door opening (see bedSeenThroughDoor below)
  function roundedRectShape(w, h, r){
    const hw = w/2, hh = h/2;
    const shape = new THREE.Shape();
    shape.moveTo(-hw+r, -hh);
    shape.lineTo(hw-r, -hh);
    shape.quadraticCurveTo(hw, -hh, hw, -hh+r);
    shape.lineTo(hw, hh-r);
    shape.quadraticCurveTo(hw, hh, hw-r, hh);
    shape.lineTo(-hw+r, hh);
    shape.quadraticCurveTo(-hw, hh, -hw, hh-r);
    shape.lineTo(-hw, -hh+r);
    shape.quadraticCurveTo(-hw, -hh, -hw+r, -hh);
    return shape;
  }
  const BED_SILL_Y = PANEL_CENTER_Y - PANEL_HEIGHT/2; // matches the window's bottom frame
  const BED_EACH_W = 1.9, BED_DEPTH = 3.2, BED_GAP = 0.3, BED_CORNER = 0.22;
  const BED_Z = ROOM_Z_MAX - 2.6; // room center, toward the window side
  const bedMat = new THREE.MeshStandardMaterial({ color:0xf6efe4, roughness:0.85, metalness:0.0, side:THREE.DoubleSide, transparent:true, opacity:0 });
  const bedGeo = new THREE.ShapeGeometry(roundedRectShape(BED_EACH_W, BED_DEPTH, BED_CORNER));
  const bedLeft = new THREE.Mesh(bedGeo, bedMat);
  bedLeft.rotation.x = -Math.PI/2;
  bedLeft.position.set(-(BED_EACH_W/2 + BED_GAP/2), BED_SILL_Y, BED_Z);
  bedLeft.visible = false;
  scene.add(bedLeft);
  const bedRight = new THREE.Mesh(bedGeo, bedMat);
  bedRight.rotation.x = -Math.PI/2;
  bedRight.position.set(BED_EACH_W/2 + BED_GAP/2, BED_SILL_Y, BED_Z);
  bedRight.visible = false;
  scene.add(bedRight);

  // beds only read as visible when the viewer's actual sightline to them threads through the door
  // opening (not just from anywhere on the "door side") - project the line from the camera to the
  // beds onto the door's plane and check it lands inside the door's rectangular opening.
  const BED_CENTER = new THREE.Vector3(0, BED_SILL_Y + 0.1, BED_Z);
  function bedSeenThroughDoor(camPos){
    const dz = BED_CENTER.z - camPos.z;
    if (Math.abs(dz) < 1e-6) return 0;
    const t = (ROOM_Z_MIN - camPos.z) / dz;
    if (t <= 0 || t >= 1) return 0; // door plane isn't between the camera and the beds
    const x = camPos.x + (BED_CENTER.x - camPos.x) * t;
    const y = camPos.y + (BED_CENTER.y - camPos.y) * t;
    const inX = x > DOOR_CENTER_X - DOOR_W/2 && x < DOOR_CENTER_X + DOOR_W/2;
    const inY = y > 0 && y < DOOR_H;
    return (inX && inY) ? 1 : 0;
  }

  // "the young man" only reads green when the camera's sightline to it actually threads through
  // the window opening (same technique as bedSeenThroughDoor above, mirrored to the front wall/window).
  function textSeenThroughWindow(camPos){
    const targetPos = floatingText.position;
    const dz = targetPos.z - camPos.z;
    if (Math.abs(dz) < 1e-6) return 0;
    const t = (ROOM_Z_MAX - camPos.z) / dz;
    if (t <= 0 || t >= 1) return 0; // window plane isn't between the camera and the text
    const x = camPos.x + (targetPos.x - camPos.x) * t;
    const y = camPos.y + (targetPos.y - camPos.y) * t;
    const inX = x > PANEL_CENTER_X - PANEL_WIDTH/2 && x < PANEL_CENTER_X + PANEL_WIDTH/2;
    const inY = y > PANEL_CENTER_Y - PANEL_HEIGHT/2 && y < PANEL_CENTER_Y + PANEL_HEIGHT/2;
    return (inX && inY) ? 1 : 0;
  }

  // sandModeCurrent still gates the Buddy/Seymour window text (a simple "which side" toggle);
  // the floor's wave-vs-sand look is now computed per-point inside the shader itself (see waveMat).
  let sandModeCurrent = 0;
  let bedVisCurrent = 0;
  let windowSeenCurrent = 0;
  function updateWaveLines(t){
    waveUniforms.u_time.value = t;
    const sandTarget = (camera.position.z < ROOM_CENTER_Z) ? 1 : 0;
    sandModeCurrent += (sandTarget - sandModeCurrent) * 0.08;
    panelMat.uniforms.uTextVisible.value = 1 - sandModeCurrent; // Buddy/Seymour: window side only
    const windowSeenTarget = textSeenThroughWindow(camera.position);
    windowSeenCurrent += (windowSeenTarget - windowSeenCurrent) * 0.15; // green only when actually seen through the window
    floatingTextMat.uniforms.uWindowSeen.value = windowSeenCurrent;
    const bedTarget = bedSeenThroughDoor(camera.position);       // beds: only when the sightline actually passes through the door opening
    if (bedTarget > bedVisCurrent) {
      bedVisCurrent += (bedTarget - bedVisCurrent) * 0.12; // fade in gently once the door lines up
    } else {
      bedVisCurrent = bedTarget; // snap off immediately the moment the sightline leaves the door - no lingering/lag
    }
    bedMat.opacity = bedVisCurrent;
    bedLeft.visible = bedVisCurrent > 0.02;
    bedRight.visible = bedVisCurrent > 0.02;
  }

  // ---------- fire effect: on impact (the bullet reaching "the young man"), fast-sweep the whole wave
  // field into sand from the left; hold it; then release from the right after 5 seconds, and re-arm the gun ----------
  const FIRE_WAVE_HALF_W = WAVE_WIDTH / 2;
  const FIRE_SWEEP_MS = 500;          // fast left-to-right sweep into sand
  const FIRE_RELEASE_START_MS = 5000; // release begins 5s after impact
  const FIRE_RELEASE_MS = 500;        // release sweep speed (right to left)
  let fireEffectT0 = -Infinity;
  function startFireSandEffect(){ fireEffectT0 = performance.now(); }
  function updateFireSandEffect(now){
    const e = now - fireEffectT0;
    const edge = waveUniforms.u_fireEdge.value;
    const span = FIRE_WAVE_HALF_W * 2 + edge * 2;
    const start = -FIRE_WAVE_HALF_W - edge;
    const end = start + span;
    if (e >= FIRE_RELEASE_START_MS) hasFired = false; // re-armed once the release begins
    if (e < 0){
      waveUniforms.u_fireActive.value = 0.0;
      crackMat.opacity = 0;
    } else if (e < FIRE_SWEEP_MS){
      const u = e / FIRE_SWEEP_MS;
      waveUniforms.u_fireActive.value = 1.0;
      waveUniforms.u_fireFrontX.value = start + u * span;
      crackMat.opacity = Math.min(1, e / 150); // quick shatter flash
    } else if (e < FIRE_RELEASE_START_MS){
      waveUniforms.u_fireActive.value = 1.0;
      waveUniforms.u_fireFrontX.value = end; // fully swept: all sand
      crackMat.opacity = 1;
    } else if (e < FIRE_RELEASE_START_MS + FIRE_RELEASE_MS){
      const u = (e - FIRE_RELEASE_START_MS) / FIRE_RELEASE_MS;
      waveUniforms.u_fireActive.value = 1.0;
      waveUniforms.u_fireFrontX.value = end - u * span; // sweeps back from the right
      crackMat.opacity = 1 - u; // the glass heals as the sand releases
    } else {
      waveUniforms.u_fireActive.value = 0.0; // done - back to normal camera-driven sand mode
      crackMat.opacity = 0;
    }
  }

  // ---------- wall quotes: gray text set into planes at the room's inner left/right (as seen from the window side).
  // Hidden by default; clicking "Buddy" reveals the left quote, clicking "Seymour" the right one,
  // each for 15 seconds. Text is drawn with a matching stroke + fill in the same gray so the glyphs read
  // as solid gray shapes with no separate outline color.
  function drawGrayQuoteLines(ctx, lines, startX, startY, lineHeight, gray='#000000'){
    ctx.fillStyle = gray;
    ctx.strokeStyle = gray;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    let y = startY;
    for (const line of lines){
      ctx.strokeText(line, startX, y);
      ctx.fillText(line, startX, y);
      y += lineHeight;
    }
  }
  // Text is drawn top-down from a fixed startY, so a short quote (fewer lines) would otherwise sit
  // near the top of the canvas with a lot of empty space below it - off-center on the wall. This
  // computes a startY that centers the whole block of `numLines` vertically in the canvas instead.
  function centeredQuoteStartY(canvasHeight, numLines, lineHeight){
    return (canvasHeight - numLines * lineHeight) / 2;
  }

  const QUOTE_W = 7.2, QUOTE_H = 4.0;
  const QUOTE_SHOW_MS = 15000;

  function makeQuoteCanvas(){
    const w = 1800, h = 1000;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.font = 'italic 52px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lines = [
      '\u201cthe young man, the \u2018Seymour,\u2019 who did the',
      'walking and talking in that early story, not',
      'to mention the shooting, was not Seymour at',
      'all but, oddly, someone with a striking',
      'resemblance to \u2014 alley oop, I\u2019m afraid \u2014',
      'myself.\u201d',
      '',
      '\u2014Seymour: an Introduction',
    ];
    const lineHeight = 76;
    drawGrayQuoteLines(ctx, lines, 60, centeredQuoteStartY(h, lines.length, lineHeight), lineHeight);
    return cv;
  }
  const quoteTex = new THREE.CanvasTexture(makeQuoteCanvas());
  quoteTex.colorSpace = THREE.SRGBColorSpace;
  const quoteMat = new THREE.MeshBasicMaterial({ map:quoteTex, transparent:true, depthWrite:false, opacity:0 });
  const quotePlane = new THREE.Mesh(new THREE.PlaneGeometry(QUOTE_W, QUOTE_H), quoteMat);
  quotePlane.rotation.y = Math.PI/2;
  quotePlane.position.set(ROOM_X_MIN + 0.02, ROOM_HEIGHT / 2, ROOM_CENTER_Z);
  scene.add(quotePlane);

  let quoteRevealT0 = -Infinity;
  function revealQuote(){ quoteRevealT0 = performance.now(); }
  function updateQuoteReveal(now){
    const e = now - quoteRevealT0;
    const FADE = 300;
    let op = 0;
    if (e >= 0 && e < QUOTE_SHOW_MS){
      if (e < FADE) op = e / FADE;
      else if (e > QUOTE_SHOW_MS - FADE) op = (QUOTE_SHOW_MS - e) / FADE;
      else op = 1;
    }
    quoteMat.opacity = Math.max(0, Math.min(1, op));
  }

  function makeSeymourQuoteCanvas(){
    const w = 1800, h = 1000;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.font = 'italic 52px Georgia, serif';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    const lines = [
      '\u201cI also give you my word of honor that one',
      'of us will be present at the other chap\u2019s',
      'departure for various reasons.\u201d',
      '',
      '\u2014Hapworth 16, 1924',
    ];
    const lineHeight = 76;
    drawGrayQuoteLines(ctx, lines, 60, centeredQuoteStartY(h, lines.length, lineHeight), lineHeight);
    return cv;
  }
  const seymourQuoteTex = new THREE.CanvasTexture(makeSeymourQuoteCanvas());
  seymourQuoteTex.colorSpace = THREE.SRGBColorSpace;
  const seymourQuoteMat = new THREE.MeshBasicMaterial({ map:seymourQuoteTex, transparent:true, depthWrite:false, opacity:0 });
  const seymourQuotePlane = new THREE.Mesh(new THREE.PlaneGeometry(QUOTE_W, QUOTE_H), seymourQuoteMat);
  seymourQuotePlane.rotation.y = -Math.PI/2;
  seymourQuotePlane.position.set(ROOM_X_MAX - 0.02, ROOM_HEIGHT / 2, ROOM_CENTER_Z);
  scene.add(seymourQuotePlane);

  let seymourQuoteRevealT0 = -Infinity;
  function revealSeymourQuote(){ seymourQuoteRevealT0 = performance.now(); }
  function updateSeymourQuoteReveal(now){
    const e = now - seymourQuoteRevealT0;
    const FADE = 300;
    let op = 0;
    if (e >= 0 && e < QUOTE_SHOW_MS){
      if (e < FADE) op = e / FADE;
      else if (e > QUOTE_SHOW_MS - FADE) op = (QUOTE_SHOW_MS - e) / FADE;
      else op = 1;
    }
    seymourQuoteMat.opacity = Math.max(0, Math.min(1, op));
  }

  // ---------- door-side quote: on the room's INNER front-wall surface, above the window ----------
  const DOOR_QUOTE_W = 7.2;
  const DOOR_QUOTE_H = 0.9;
  const DOOR_QUOTE_Y = PANEL_CENTER_Y + PANEL_HEIGHT / 2 + 0.58;

  const doorQuoteCanvas = makeTextCanvas(
    'fired a bullet through his right temple.',
    {
      w: 1800, h: 260,
      font: 'italic 52px Georgia, serif',
      color: '#000000',
      blurPx: 0,
      x: 900,
      align: 'center'
    }
  );
  const doorQuoteTex = new THREE.CanvasTexture(doorQuoteCanvas);
  doorQuoteTex.colorSpace = THREE.SRGBColorSpace;
  const doorQuoteMat = new THREE.MeshBasicMaterial({
    map: doorQuoteTex,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    opacity: 0
  });
  const doorQuotePlane = new THREE.Mesh(
    new THREE.PlaneGeometry(DOOR_QUOTE_W, DOOR_QUOTE_H),
    doorQuoteMat
  );
  // Front wall is ROOM_Z_MAX. The room interior is toward -Z.
  doorQuotePlane.position.set(PANEL_CENTER_X, DOOR_QUOTE_Y, ROOM_Z_MAX - 0.035);
  doorQuotePlane.rotation.y = Math.PI;
  scene.add(doorQuotePlane);

  let doorQuoteRevealT0 = -Infinity;
  function revealDoorQuote(){ doorQuoteRevealT0 = performance.now(); }
  function updateDoorQuoteReveal(now){
    const e = now - doorQuoteRevealT0;
    const FADE = 300;
    let op = 0;
    if (e >= 0 && e < QUOTE_SHOW_MS){
      if (e < FADE) op = e / FADE;
      else if (e > QUOTE_SHOW_MS - FADE) op = (QUOTE_SHOW_MS - e) / FADE;
      else op = 1;
    }
    doorQuoteMat.opacity = Math.max(0, Math.min(1, op));
  }

  // ---------- shared 3D muzzle: a short black ring (a squat cylinder punched through with a bore
  // hole, edges lightly beveled), low roughness / high metalness for a machined-metal look. Used for
  // both the window-side (held-by-the-viewer) and door-side (seen-through-the-glass) markers below. ----------
  function makeMuzzleRingGeometry({ outerRadius = 0.22, innerRadius = 0.1, depth = 0.09, bevelSize = 0.02 } = {}){
    const shape = new THREE.Shape();
    shape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
    const hole = new THREE.Path();
    hole.absarc(0, 0, innerRadius, 0, Math.PI * 2, true);
    shape.holes.push(hole);
    const geo = new THREE.ExtrudeGeometry(shape, {
      depth,
      bevelEnabled: true,
      bevelThickness: bevelSize,
      bevelSize: bevelSize,
      bevelSegments: 3,
      curveSegments: 48,
    });
    geo.center(); // center the short cylinder on its own local origin, so group.position is its true center
    return geo;
  }
  const muzzleRingMat = new THREE.MeshStandardMaterial({ color: 0x0c0c0e, roughness: 0.28, metalness: 0.85, side: THREE.DoubleSide, fog: false });
  function makeMuzzle3D(opts = {}){
    const group = new THREE.Group();
    group.add(new THREE.Mesh(makeMuzzleRingGeometry(opts), muzzleRingMat)); // true geometric hole, no backing disc, so it reads as an actual opening (you see straight through it) rather than a plugged black circle
    return group;
  }
  function makeCaliberLabelCanvas(color){
    const w = 320, h = 160;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    ctx.font = 'italic 700 82px Georgia, serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('7.65', w / 2, h / 2);
    return cv;
  }

  // ---------- the gun: a single 3D black-ring muzzle, directly below its "7.65" caliber label.
  // Only ever seen from the door side, looking out through the window at it - both the ring and the
  // label are hidden together the moment the camera is on the window side (see updateMuzzleVisibility).
  const MUZZLE_X = DOOR_CENTER_X, MUZZLE_Y = PANEL_CENTER_Y, MUZZLE_Z = 4.6;
  const muzzleGroup = makeMuzzle3D();
  muzzleGroup.position.set(MUZZLE_X, MUZZLE_Y, MUZZLE_Z);
  scene.add(muzzleGroup);

  const muzzleLabelTex = new THREE.CanvasTexture(makeCaliberLabelCanvas('#000000'));
  muzzleLabelTex.colorSpace = THREE.SRGBColorSpace;
  const muzzleLabelMat = new THREE.MeshBasicMaterial({ map: muzzleLabelTex, transparent: true, depthWrite: false, side: THREE.DoubleSide, fog: false });
  const muzzleLabel = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 0.55), muzzleLabelMat);
  muzzleLabel.position.set(MUZZLE_X, MUZZLE_Y + 0.5, MUZZLE_Z); // directly above the ring, same x/z
  muzzleLabel.rotation.y = Math.PI; // flip so the text reads correctly (not mirrored) from the door side, which looks toward +Z
  scene.add(muzzleLabel);

  function getMuzzleWorldPos(){
    return muzzleGroup.position.clone();
  }

  // hide the ring + label together the instant the camera is on the window side; show them together
  // otherwise (same onWindowSide check as tryClickPanelWord/tryFireAtPointer below)
  function updateMuzzleVisibility(){
    const onWindowSide = camera.position.z > ROOM_CENTER_Z;
    muzzleGroup.visible = !onWindowSide;
    muzzleLabel.visible = !onWindowSide;
  }

  // ---------- gold particles ----------
  const goldMat = new THREE.MeshStandardMaterial({ color:0xd8ad2f, roughness:0.25, metalness:0.85, emissive:0x3a2a05, emissiveIntensity:0.4 });
  const particleGeo = new THREE.SphereGeometry(0.028, 8, 8);
  const activeShots = [];
  let hasFired = false;

  function fireShot(){
    if (hasFired) return;
    hasFired = true;
    const from = getMuzzleWorldPos();
    const to = floatingText.position.clone();
    const mesh = new THREE.Mesh(particleGeo, goldMat);
    mesh.position.copy(from);
    scene.add(mesh);
    activeShots.push({ mesh, from: from.clone(), to, t0: performance.now(), duration: 160 }); // fast, bullet-speed travel time (was 500ms)
  }

  function updateShots(now){
    for(let s = activeShots.length-1; s>=0; s--){
      const shot = activeShots[s];
      const elapsed = now - shot.t0;
      const u = Math.min(1, elapsed / shot.duration);
      const ease = 1 - Math.pow(1-u, 3);
      const pos = new THREE.Vector3().lerpVectors(shot.from, shot.to, ease); // straight line from -> to, no arc added
      shot.mesh.position.copy(pos);
      const scale = 1 - 0.5*u;
      shot.mesh.scale.setScalar(Math.max(0.2, scale));
      if (u >= 1){
        scene.remove(shot.mesh);
        activeShots.splice(s,1);
        revealText(); // the shot has reached the door - "the young man" appears, green, on the glass
        startFireSandEffect(); // impact: the bullet hits the glass - sand-ify the wave field, crack the glass
      }
    }
  }

  // ---------- reveal "the young man" on fire, then let it fade back ----------
  let revealT0 = -Infinity;
  const REVEAL_IN = 400;
  function revealText(){ revealT0 = performance.now(); }
  function updateReveal(now){
    const e = now - revealT0;
    const v = e < 0 ? 0 : (e < REVEAL_IN ? e / REVEAL_IN : 1); // ramps in once, then stays fully visible forever
    floatingTextMat.uniforms.uReveal.value = Math.max(0, Math.min(1, v));
  }

  // ---------- input: drag to shift view, click to fire ----------
  const raycaster = new THREE.Raycaster();
  const pointerNDC = new THREE.Vector2();
  const groundPlane = new THREE.Plane(new THREE.Vector3(0,1,0), -0.02);
  let dragging = false, downPos = {x:0,y:0}, moved = false, lastPos = {x:0,y:0};

  function updateHover(p){
    pointerNDC.x = (p.x / innerWidth) * 2 - 1;
    pointerNDC.y = -(p.y / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hit = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(groundPlane, hit)){
      hoverPoint.copy(hit);
    } else {
      hoverPoint.set(9999, 9999, 9999);
    }
  }

  function onPointerDown(e){
    dragging = true; moved = false;
    const p = getPos(e);
    downPos = p; lastPos = p;
  }
  function onPointerMove(e){
    const p = getPos(e);
    updateHover(p);
    if(!dragging) return;
    const dx = p.x - lastPos.x, dy = p.y - lastPos.y;
    if (Math.abs(p.x-downPos.x) > 4 || Math.abs(p.y-downPos.y) > 4) moved = true;
    if (moved){
      azimuth = azimuth - dx * 0.006; // unrestricted: can swing all the way around to the door side
      polar = Math.min(POLAR_MAX, Math.max(POLAR_MIN, polar - dy * 0.005));
      updateCamera();
    }
    lastPos = p;
  }
  function onPointerUp(e){
    if(!dragging) return;
    dragging = false;
    if(!moved){
      const p = getPos(e);
      if (!tryClickPanelWord(p)) tryFireAtPointer(p);
    }
  }
  function tryClickPanelWord(p){
    // Door side: clicking the blue "the young man" reveals the quote above the window.
    const onDoorSide = camera.position.z < ROOM_CENTER_Z;
    if (onDoorSide){
      pointerNDC.x = (p.x / innerWidth) * 2 - 1;
      pointerNDC.y = -(p.y / innerHeight) * 2 + 1;
      raycaster.setFromCamera(pointerNDC, camera);
      const youngManHit = raycaster.intersectObject(floatingText, true)[0];
      if (youngManHit){
        revealDoorQuote();
        return true;
      }
    }

    const onWindowSide = camera.position.z > ROOM_CENTER_Z; // "Buddy"/"Seymour" only work from the window side
    if (!onWindowSide) return false;
    pointerNDC.x = (p.x / innerWidth) * 2 - 1;
    pointerNDC.y = -(p.y / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObject(panel);
    if (hits.length === 0 || !hits[0].uv) return false;
    const uv = hits[0].uv;
    if (buddyBoxUV && uv.x >= buddyBoxUV.uMin && uv.x <= buddyBoxUV.uMax && uv.y >= buddyBoxUV.vMin && uv.y <= buddyBoxUV.vMax){
      revealQuote();
      return true;
    }
    if (seymourBoxUV && uv.x >= seymourBoxUV.uMin && uv.x <= seymourBoxUV.uMax && uv.y >= seymourBoxUV.vMin && uv.y <= seymourBoxUV.vMax){
      revealSeymourQuote();
      return true;
    }
    return false;
  }
  function tryFireAtPointer(p){
    const onWindowSide = camera.position.z > ROOM_CENTER_Z; // firing only works looking in from the window
    if (!onWindowSide) return;
    pointerNDC.x = (p.x / innerWidth) * 2 - 1;
    pointerNDC.y = -(p.y / innerHeight) * 2 + 1;
    raycaster.setFromCamera(pointerNDC, camera);
    const hits = raycaster.intersectObject(doorGlass);
    if (hits.length > 0){
      fireShot();
    }
  }
  function getPos(e){
    if (e.touches && e.touches.length) return {x:e.touches[0].clientX, y:e.touches[0].clientY};
    return {x:e.clientX, y:e.clientY};
  }

  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);
  canvas.addEventListener('touchstart', onPointerDown, {passive:true});
  window.addEventListener('touchmove', onPointerMove, {passive:true});
  window.addEventListener('touchend', onPointerUp);

  canvas.addEventListener('mouseleave', ()=>{
    hoverPoint.set(9999, 9999, 9999);
  });

  canvas.addEventListener('wheel', (e)=>{
    radius = Math.min(12, Math.max(4, radius + e.deltaY * 0.003)); // widened max so both sides can be viewed from further back
    updateCamera();
  }, {passive:true});

  addEventListener('resize', ()=>{
    camera.aspect = innerWidth/innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  /* ---------------------------------------------------------------
     MAIN LOOP — 開いている間だけ回す(billiardTableのrafId方式と同じ)
  --------------------------------------------------------------- */
  function loop(now){
    rafId = requestAnimationFrame(loop);
    const t = clock.getElapsedTime();
    updateWaveLines(t, now);
    updateFireSandEffect(now);
    updateMuzzleVisibility();
    updateShots(now);
    updateReveal(now);
    updateQuoteReveal(now);
    updateSeymourQuoteReveal(now);
    updateDoorQuoteReveal(now);
    renderer.render(scene, camera);
  }

  // show()のたびに演出をまっさらな状態へ戻す(billiardTableのstartBreak()相当)
  function reset(){
    radius = INITIAL_RADIUS; azimuth = INITIAL_AZIMUTH; polar = INITIAL_POLAR;
    updateCamera();
    updateMuzzleVisibility();

    activeShots.forEach(shot => scene.remove(shot.mesh));
    activeShots.length = 0;
    hasFired = false;

    fireEffectT0 = -Infinity;
    waveUniforms.u_fireActive.value = 0.0;
    crackMat.opacity = 0;

    revealT0 = -Infinity;
    floatingTextMat.uniforms.uReveal.value = 0.0;

    quoteRevealT0 = -Infinity;
    quoteMat.opacity = 0;
    seymourQuoteRevealT0 = -Infinity;
    seymourQuoteMat.opacity = 0;
    doorQuoteRevealT0 = -Infinity;
    doorQuoteMat.opacity = 0;

    sandModeCurrent = 0;
    bedVisCurrent = 0;
    windowSeenCurrent = 0;
    panelMat.uniforms.uTextVisible.value = 1;
    floatingTextMat.uniforms.uWindowSeen.value = 0;
    bedMat.opacity = 0;
    bedLeft.visible = false;
    bedRight.visible = false;

    clock.start();
  }

  function show() {
    reset();
    overlay.classList.add('show');
    if (!rafId) loop();
  }

  function hide() {
    overlay.classList.remove('show');
    if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
    dragging = false;
  }

  closeBtn.addEventListener('click', () => {
    hide();
    if (onClose) onClose();
  });

  return { show, hide, isVisible: () => overlay.classList.contains('show') };
}