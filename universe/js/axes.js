import * as THREE from 'three';
import { AXIS_LENGTH, AXIS_X_ANCHOR_Z } from './config.js';

// ══════════════════════════════════════════════════════════════
// 三軸の表現: 「宇宙｜Moffat光芒」+ 原点の一等星(axes_star_lab.html の A案)
// ──────────────────────────────────────────────────────────────
// 1px線(THREE.Line)の代わりに、画面上で一定ピクセル幅になる「帯(クアッド)」を描き、
// フラグメントで線に直交するMoffat分布 (1 + r²)^-1.4 を当てて、芯が明るく裾が長い光芒にする。
// 端は丸く(線の延長方向にも同じ分布で)減衰する。
// 線は原点側が明るく先端へ向かって減衰・先細りする(原点の一等星はステーション滞在中にオーバーレイ側で出す)。
// 終端には星を置かない(終端の点・極小スパイクは axisStationOverlay.js 側で、ステーション滞在中のみ出す)。
// 加算合成なので、暗い背景の上で光として重なる。
// ══════════════════════════════════════════════════════════════

// ── 光芒の見た目パラメータ(ラボの初期値に合わせてある) ──────
const AXIS_GLOW_WIDTH = 1.2;       // 芯の太さ(CSS px)。Moffatの広がりの基準
const AXIS_GLOW_EXT = 26;          // 帯の半幅 = EXT × 太さ(裾が切れない余白)
const AXIS_GLOW_LINK = 1;          // 1=太さをカメラ距離に連動(ラボの「太さをズームに連動」) / 0=常に一定px
const AXIS_GLOW_REF_DIST = 60;     // 連動時の基準距離(この距離で太さがちょうどAXIS_GLOW_WIDTH)。カメラの標準距離に合わせて調整
export const AXIS_GLOW_COLOR = 0x4a8fff;  // 軸の色(裾側)。★ 以前はconfig.jsのAXIS_COLORだったが、「もっと青く」のためここで上書き。水色寄りに戻すなら 0x7fb8ff 側へ
const AXIS_GLOW_CORE = 0xa0c8ff;   // 芯の色。白寄りにしたければ 0xc8e0ff 側へ
const AXIS_TIP_FALL = 0.12;        // 先端での明るさの下限(原点=1)。0にすると先端で完全に消える
const AXIS_TIP_WIDTH = 0.15;       // 先端での太さ(原点=1)。小さいほど針のように尖る。1にすると従来の一定の太さ

// ── 原点の一等星(画面上のピクセル径で描く。距離で縮まらない) ──
// ★ 星そのものは axisStationOverlay.js が終端の点と同じ扱い(ステーション滞在中のみ)で出す。ここは値だけを持つ。
export const ORIGIN_STAR_SIZE = 5;        // 芯の大きさ(CSS px)
export const ORIGIN_STAR_SPIKE = 150;     // 回折スパイクの長さ(CSS px)
export const ORIGIN_STAR_GAIN = 1;        // 星の明るさ
// 軸の断面の鋭さ: 星のスパイクの sw(=size×0.3) と、軸の芯の太さ(AXIS_GLOW_WIDTH)を揃える比。
// 基準距離では軸とスパイクの太さがぴったり一致する。軸だけ太く/細くしたければ AXIS_GLOW_WIDTH 側を触る。
const AXIS_SPIKE_SW_RATIO = (ORIGIN_STAR_SIZE * 0.3) / AXIS_GLOW_WIDTH;

// ── X軸の「原点へ流れる光」(Xステーション滞在中だけ) ──
// ★ 2026-10-29 変更: 流れをより誇張した。流れていない部分(振幅の低い部分)をずっと暗くし、
//   流れの先頭との明暗差を大きくしてある(以前は 基準0.5 / 先頭+1.1 = 約3倍差、今は約11倍差)。
const X_FLOW_BASE = 0.15;   // 流れていない部分の明るさ(1=通常の軸と同じ)。小さいほど暗く、流れが際立つ
const X_FLOW_PEAK = 1.6;    // 流れの先頭に足す明るさ。大きいほど先頭が強く、にじみも広がる
const X_FLOW_WIDTH = 0.16;  // 流れの幅(軸全体の長さに対する比)

// THREE.Colorはカラーマネジメントで内部値が線形化されるが、ここでは出力をそのままcanvasへ出すため、
// getHex()で得られるsRGB値を0〜1に戻して素直に渡す(LineBasicMaterialと同じ見た目の色になる)。
function srgbVec3(hex) {
  const h = new THREE.Color(hex).getHex();
  return new THREE.Vector3(((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255);
}

// 全軸で共有するユニフォーム(画面サイズ・太さ)。resizeで1か所更新すれば全軸に反映される。
const glowShared = {
  uRes: { value: new THREE.Vector2(1, 1) }, // 描画バッファのピクセルサイズ
  uWidth: { value: AXIS_GLOW_WIDTH },       // 太さ(デバイスpx)
  uDpr: { value: 1 },                       // 星のpxサイズ換算用
};
function setViewportSize(cssWidth, cssHeight, pixelRatio = 1) {
  glowShared.uRes.value.set(Math.max(1, cssWidth * pixelRatio), Math.max(1, cssHeight * pixelRatio));
  glowShared.uWidth.value = AXIS_GLOW_WIDTH * pixelRatio;
  glowShared.uDpr.value = pixelRatio;
}
// renderer側のサイズ変更を拾えない場合に備え、ウィンドウ全体を描画領域とみなして追従する。
// (描画領域がウィンドウ全体でない場合は、返り値の axes.setViewportSize(w, h, dpr) を呼ぶこと)
setViewportSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
window.addEventListener('resize', () => {
  setViewportSize(window.innerWidth, window.innerHeight, window.devicePixelRatio || 1);
});

// ── 光芒マテリアル ────────────────────────────────────────────
// 頂点: 線分の両端をview空間でnear面にクリップ → 画面上のピクセル座標へ → 線方向・直交方向に膨らませる。
//   親のscale/rotation(Y軸のscale.yで伸びる演出など)はmodelViewMatrixに含まれるのでそのまま効く。
//   線が実質ゼロ長(scale.y=0の初期状態、X軸の刃跡が未到達の状態)のときは vVis で消す。
// フラグメント: Moffat光芒。X軸だけ従来の「原点へ流れる光」(uActive/uTime)を重ねられる。
//   progA/progB = 線分のA端/B端の進行度(0=原点側, 1=先端側)。流れの帯位置の計算に使う。
function makeGlowMaterial(progA, progB, { refDist = AXIS_GLOW_REF_DIST, visLo = 0.02, visHi = 0.6 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: srgbVec3(AXIS_GLOW_COLOR) },
      uCore: { value: srgbVec3(AXIS_GLOW_CORE) },
      uTime: { value: 0 },
      uActive: { value: 0 },
      uOpacity: { value: 1 },
      uFlowBase: { value: X_FLOW_BASE },
      uFlowPeak: { value: X_FLOW_PEAK },
      uFlowWidth: { value: X_FLOW_WIDTH },
      uFall: { value: AXIS_TIP_FALL },
      uSwRatio: { value: AXIS_SPIKE_SW_RATIO },
      uTipW: { value: AXIS_TIP_WIDTH },
      uProgA: { value: progA },
      uProgB: { value: progB },
      uExt: { value: AXIS_GLOW_EXT },
      uLink: { value: AXIS_GLOW_LINK },
      uRef: { value: refDist },
      uVisLo: { value: visLo },
      uVisHi: { value: visHi },
      uRes: glowShared.uRes,
      uWidth: glowShared.uWidth,
    },
    vertexShader: `
      uniform vec2 uRes;
      uniform float uWidth, uExt, uLink, uRef, uVisLo, uVisHi;
      attribute vec3 aOther;  // 線分のもう一方の端(オブジェクト空間)
      attribute float aSide;  // 帯の左右 (-1 / +1)
      attribute float aEnd;   // この頂点が属する端 (0=A端, 1=B端)
      varying float vAc;      // 線に直交する方向の符号付き距離(px)
      varying float vAl;      // A端を0とした線方向の位置(px。端の外側は負 / len超え)
      varying float vLen;     // 線の画面上の長さ(px)
      varying float vW;       // 芯の太さ(px)
      varying float vE;       // 帯の半幅(px)
      varying float vVis;     // 0〜1: 実質ゼロ長のとき0
      void main() {
        vec4 vt = modelViewMatrix * vec4(position, 1.0);
        vec4 vo = modelViewMatrix * vec4(aOther, 1.0);

        // 長さがほぼ0(scale.y=0など)のときは描かない
        float worldLen = length((modelMatrix * vec4(position, 1.0)).xyz - (modelMatrix * vec4(aOther, 1.0)).xyz);
        vVis = smoothstep(uVisLo, uVisHi, worldLen);

        // near面(view空間でz=-near)より手前側にはみ出した端をクリップする
        float near = projectionMatrix[3][2] / (projectionMatrix[2][2] - 1.0);
        float nz = -near * 1.02;
        vec3 a = vt.xyz;
        vec3 b = vo.xyz;
        if (a.z > nz && b.z > nz) { // 両端ともカメラの後ろ
          vAc = 0.0; vAl = 0.0; vLen = 1.0; vW = 1.0; vE = 1.0; vVis = 0.0;
          gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
          return;
        }
        if (a.z > nz) a = mix(a, b, (nz - a.z) / (b.z - a.z));
        if (b.z > nz) b = mix(b, a, (nz - b.z) / (a.z - b.z));

        vec4 ca = projectionMatrix * vec4(a, 1.0);
        vec4 cb = projectionMatrix * vec4(b, 1.0);
        vec2 sa = ca.xy / ca.w * 0.5 * uRes; // この頂点側の端(px)
        vec2 sb = cb.xy / cb.w * 0.5 * uRes; // 反対側の端(px)

        float len = max(length(sb - sa), 0.001);
        vec2 d = len > 0.01 ? (sb - sa) / len : vec2(1.0, 0.0); // この端→反対端
        vec2 dAB = aEnd < 0.5 ? d : -d;                          // A→B
        vec2 n = vec2(-dAB.y, dAB.x);

        float wv = uWidth * mix(1.0, uRef / max(-a.z, 0.001), uLink);
        float E = uExt * wv;

        // 端の外側へ E だけ延長し、直交方向にも ±E 広げる
        vec2 p = sa - d * E + n * aSide * E;

        vAc = aSide * E;
        vAl = aEnd < 0.5 ? -E : len + E;
        vLen = len;
        vW = wv;
        vE = E;

        // w=1にして、vAc/vAlが画面上で線形補間されるようにする(透視補間によるゆがみ防止)
        gl_Position = vec4(p / (0.5 * uRes), ca.z / ca.w, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor, uCore;
      uniform float uTime, uActive, uOpacity, uProgA, uProgB, uFlowBase, uFlowPeak, uFlowWidth, uFall, uSwRatio, uTipW;
      varying float vAc, vAl, vLen, vW, vE, vVis;
      float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      void main() {
        // 線分の外側(端の先)での距離
        float da = vAl < 0.0 ? -vAl : (vAl > vLen ? vAl - vLen : 0.0);
        // 帯の縁でぷつっと切れないための窓
        float win = 1.0 - smoothstep(0.6, 1.0, max(abs(vAc), da) / vE);

        // 進行度(0=原点側 → 1=先端側)
        float prog = mix(uProgA, uProgB, clamp(vAl / vLen, 0.0, 1.0));

        // ★ 原点の星のスパイク(makeStarMesh)と同じ表現:
        //   線に直交する方向は鋭い指数減衰 exp(-|y|/sw)、長さ方向は (1-進行度)^2 で先細り(先端はuFallを下限に残す)。
        //   色も星と同じ「裾=uColor、芯=uCoreを v² で足す」合成。
        // 太さも先端へ向けて細くする(針のように尖る)。極細でサブピクセルに消えないよう下限0.6px
        float pg = clamp(prog, 0.0, 1.0);
        float sw = max(vW * uSwRatio * mix(1.0, uTipW, pg), 0.6);
        float r = length(vec2(vAc, da)) / sw;
        float taper = mix(uFall, 1.0, pow(1.0 - pg, 2.0));
        float v = exp(-r) * taper * win;
        vec3 c = uColor * (v * 0.9) + uCore * (0.3 * v * v);

        // X軸の「原点へ流れる光」(uActive=1のときだけ。0のときは単色フルブライト相当=1.0)
        float streakPos = fract(-uTime * 0.35);
        float dd = abs(prog - streakPos);
        dd = min(dd, 1.0 - dd);
        float streak = smoothstep(uFlowWidth, 0.0, dd) * uActive;
        float brightness = mix(1.0, uFlowBase, uActive) + streak * uFlowPeak;
        c *= brightness;
        // 明るくなりすぎても白に飛ばさず、色相を保ったまま収める
        c /= max(1.0, max(max(c.r, c.g), c.b));

        c *= vVis;
        // 暗い裾のバンディング対策の微小ディザ
        if (dot(c, vec3(1.0)) > 0.0002) {
          c += (hh(gl_FragCoord.xy) + hh(gl_FragCoord.xy + 7.3) - 1.0) / 255.0;
        }
        // AdditiveBlending = (src.rgb * alpha) + dst → alphaにフェード係数を渡す
        gl_FragColor = vec4(max(c, 0.0), uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });

  // 既存コード(main.js等)が material.opacity を触っても効くよう、uOpacityへ橋渡しする
  Object.defineProperty(mat, 'opacity', {
    get() { return mat.uniforms.uOpacity.value; },
    set(v) { mat.uniforms.uOpacity.value = v; },
    configurable: true,
  });
  return mat;
}

// ── 光芒の帯ジオメトリ(4頂点のクアッド) ────────────────────────
// 頂点0,1 = A端の左右 / 頂点2,3 = B端の左右。各頂点は自分の端(position)と反対端(aOther)を持つ。
function makeGlowGeometry(a, b) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(12), 3));
  geo.setAttribute('aOther', new THREE.BufferAttribute(new Float32Array(12), 3));
  geo.setAttribute('aSide', new THREE.BufferAttribute(new Float32Array([-1, 1, -1, 1]), 1));
  geo.setAttribute('aEnd', new THREE.BufferAttribute(new Float32Array([0, 0, 1, 1]), 1));
  geo.setIndex([0, 1, 2, 2, 1, 3]);
  setGlowEnds(geo, a, b);
  return geo;
}
export function setGlowEnds(geo, a, b) {
  const p = geo.attributes.position;
  const o = geo.attributes.aOther;
  for (let i = 0; i < 4; i++) {
    const self = i < 2 ? a : b;
    const other = i < 2 ? b : a;
    p.setXYZ(i, self.x, self.y, self.z);
    o.setXYZ(i, other.x, other.y, other.z);
  }
  p.needsUpdate = true;
  o.needsUpdate = true;
}

// ── Y/Z軸用: ローカルY方向に伸びる光芒(scale.y=0で非表示) ──────
// A=原点側(進行度0) / B=先端側(進行度1)。Y/Zは流れ演出を使わない(uActiveは常に0)。
function makeAxisLine() {
  const geo = makeGlowGeometry(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, AXIS_LENGTH, 0));
  const line = new THREE.Mesh(geo, makeGlowMaterial(0, 1));
  line.frustumCulled = false; // 端の延長・画面ピクセル幅分の膨らみはbounding sphereに含まれないため
  line.scale.y = 0;
  return line;
}

// ── 他のシーン(宇宙ページのtripod等)で、ホームの軸と同じ表現の軸線を作る ──────────
// a=原点側(進行度0) / b=先端側(進行度1)。ホームの軸と同じシェーダー(鋭い断面・先端へ先細り・濃い青)を使う。
// refDist: 太さの基準距離(この距離で芯の太さがちょうど AXIS_GLOW_WIDTH px)。カメラが遠い/疑似正射影の画面では、
//          そのカメラの標準距離を渡すこと(既定=ホームのカメラ距離)。
// 初期のopacityは0(フェードイン前提)。material.opacity を触れば従来のLineBasicMaterialと同様にフェードできる。
// 親のscale・回転・移動はそのまま効く(modelViewMatrixに含まれる)。ごく小さく縮めても消えないよう、ゼロ長判定のしきい値は小さくしてある。
export function makeSpikeAxisMesh(a, b, { refDist } = {}) {
  const mesh = new THREE.Mesh(
    makeGlowGeometry(a, b),
    makeGlowMaterial(0, 1, { refDist, visLo: 0.0001, visHi: 0.001 })
  );
  mesh.frustumCulled = false;
  mesh.material.opacity = 0;
  return mesh;
}

// ── クリック判定専用の見えない「太い」当たり判定シリンダー ──
// 光芒は見た目が帯なのでraycastには向かない。各軸に半径を持つ円柱を重ねて、そちらをraycast対象にする。
// (visible=falseにしても、three.jsのraycastは可視判定を見ないのでヒットテストには使える)
function makeHitCylinder(length, axisName, radius = 0.7) {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8, 1, true);
  geo.translate(0, length / 2, 0); // ピボットを原点側の端に合わせる(線の局所座標(0→length, local+Y)と一致させる)
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.userData.axisName = axisName;
  mesh.layers.set(0); // ← レイヤー0=通常のraycast対象。非表示時はsetAxesVisible()でレイヤー1に退避してヒットしないようにする
  return mesh;
}

// ── 星(画面上のピクセル径の光点 + 回折スパイク) ─────────────────
// オブジェクトの原点(0,0,0)を画面へ投影し、その位置にピクセル単位の板を描く。
// 距離で縮まらない(本物の星と同じ)。スパイクは画面の縦横(+薄い斜め4本)に固定。
// spike=0 ならスパイク無しの光点。原点の一等星(axes.js)と、終端の極小スパイク(axisStationOverlay.js)の両方で使う。
// 子として付ければ親の位置・visibleにそのまま追従する。raycastには反応しない。
// baseRadius(ワールド単位)を渡すと、その球(例: 終端の点)の画面上の半径を超えた位置から spike(px) ぶん伸ばす。
// 球が大きく見えてもスパイクが球の中に埋もれない。
export function makeStarMesh({ color, coreColor, size = 3, spike = 0, gain = 1, baseRadius = 0 } = {}) {
  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: srgbVec3(color) },
      uCoreColor: { value: srgbVec3(coreColor ?? color) },
      uSize: { value: size },
      uSpike: { value: spike },
      uBaseR: { value: baseRadius },
      uGain: { value: gain },
      uOpacity: { value: 1 },
      uRes: glowShared.uRes,
      uDpr: glowShared.uDpr,
    },
    vertexShader: `
      uniform vec2 uRes;
      uniform float uSize, uSpike, uDpr, uBaseR;
      varying vec2 vQ;
      varying float vH;
      varying float vRb;
      void main() {
        vec4 c = projectionMatrix * modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        if (c.w <= 0.0001) { vQ = vec2(0.0); vH = 1.0; vRb = 0.0; gl_Position = vec4(2.0, 2.0, 2.0, 1.0); return; }
        // 基準球の画面上の半径(px)。c.w = 視点からの距離
        float rpx = uBaseR * projectionMatrix[1][1] * 0.5 * uRes.y / c.w;
        float H = max(uSize * 9.0, uSpike * 1.05) * uDpr + rpx * 1.1;
        vec2 q = position.xy * H;
        vQ = q; vH = H; vRb = rpx;
        gl_Position = vec4(c.xy + q * 2.0 / uRes * c.w, c.z, c.w);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor, uCoreColor;
      uniform float uSize, uSpike, uDpr, uGain, uOpacity;
      varying vec2 vQ;
      varying float vH;
      varying float vRb;
      float hh(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      // off: 先細りの起点を中心からoffだけ外へずらす(基準球の縁から伸ばす)
      float spk(vec2 q, float sw, float sl, float off) { return exp(-abs(q.y) / sw) * pow(max(1.0 - max(abs(q.x) - off, 0.0) / sl, 0.0), 2.0); }
      void main() {
        float sz = uSize * uDpr, sl = uSpike * uDpr;
        vec2 q = vQ;
        float r = length(q) / sz;
        float core = 1.3 * pow(1.0 + r * r, -1.5);
        float wh = exp(-r * r * 0.6);
        float sp = 0.0;
        if (sl > 0.0) {
          float sw = sz * 0.3;
          sp = spk(q, sw, sl, vRb) + spk(q.yx, sw, sl, vRb);
          vec2 d = vec2(q.x + q.y, q.x - q.y) * 0.7071;
          sp += 0.25 * (spk(d, sw, sl * 0.55, vRb) + spk(d.yx, sw, sl * 0.55, vRb));
        }
        float win = 1.0 - smoothstep(0.75, 1.0, max(abs(q.x), abs(q.y)) / vH);
        vec3 c = (uColor * (core + sp * 0.9) + uCoreColor * (wh * 0.9 + 0.3 * sp * sp)) * win * uGain;
        if (dot(c, vec3(1.0)) > 0.0002) {
          c += (hh(gl_FragCoord.xy) + hh(gl_FragCoord.xy + 7.3) - 1.0) / 255.0;
        }
        gl_FragColor = vec4(max(c, 0.0), uOpacity);
      }
    `,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
  mesh.frustumCulled = false;
  mesh.raycast = () => {}; // 当たり判定には参加させない(ドット等の子にしてもクリックを邪魔しない)
  return mesh;
}

export function createAxes(scene) {
  const yAxis = makeAxisLine();
  yAxis.rotation.z = -Math.PI / 2; // local Y → world +X
  scene.add(yAxis);
  // 当たり判定はyAxisの子にすることで、回転・伸びる演出(scale.y)にそのまま追従させる
  const yHit = makeHitCylinder(AXIS_LENGTH, 'Y');
  yAxis.add(yHit);

  // Xだけは「刃跡」そのものを軸として使う。原点から伸ばすのではなく、
  // 遠方の到達点(AXIS_X_ANCHOR_Z)を固定端にして、刃(travelMarker)が
  // 原点へ向かって進むのに合わせて「すでに切られた跡」を逆向きに刻んでいく。
  // A端=先端側(固定・遠方)なので進行度1、B端=原点側(伸びてくる)なので進行度0。
  const xAxisGeo = makeGlowGeometry(
    new THREE.Vector3(0, 0, AXIS_X_ANCHOR_Z),
    new THREE.Vector3(0, 0, AXIS_X_ANCHOR_Z)
  );
  const xAxis = new THREE.Mesh(xAxisGeo, makeGlowMaterial(1, 0));
  xAxis.frustumCulled = false; // 毎フレーム頂点を書き換えるうえ、画面ピクセル幅で膨らむためカリングしない
  scene.add(xAxis);
  // Xは頂点を直接書き換える方式(親のscaleに乗らない)なので、当たり判定は独立した円柱として置く。
  // home状態に達する頃には刃跡は原点(0,0,0)から先端(0,0,AXIS_X_ANCHOR_Z)まで描き終わっているので、
  // 完成形と同じ範囲を最初から静的に用意しておけばよい。
  const xHit = makeHitCylinder(AXIS_LENGTH, 'X');
  xHit.rotation.x = Math.PI / 2; // local +Y → world +Z
  scene.add(xHit);

  // travelMarker(刃)の現在z位置に合わせて、xAxisの「刻まれた区間」を更新する
  const xFar = new THREE.Vector3(0, 0, AXIS_X_ANCHOR_Z);
  const xNear = new THREE.Vector3(0, 0, AXIS_X_ANCHOR_Z);
  function updateXAxisTrail(currentZ) {
    const nearZ = THREE.MathUtils.clamp(currentZ, 0, AXIS_X_ANCHOR_Z);
    xNear.set(0, 0, nearZ);                       // 刃の現在地(原点へ向かって減っていく)
    setGlowEnds(xAxis.geometry, xFar, xNear);     // 固定端(遠方)と刃の現在地で帯を作り直す
    xAxis.geometry.computeBoundingSphere();
  }

  const zAxis = makeAxisLine(); // local Y → world +Y(そのまま)
  scene.add(zAxis);
  const zHit = makeHitCylinder(AXIS_LENGTH, 'Z');
  zAxis.add(zHit);

  const axisLines = [xAxis, yAxis, zAxis];
  const axisHitAreas = [xHit, yHit, zHit]; // ← クリック判定はこちらを使う(main.js)

  // ── 軸の表示/クリック判定をまとめてオン・オフ ─────────────────
  // 数式にズームして「カメラが接近」しているあいだは軸が視界の邪魔・不整合になるため、
  // 見た目(line.visible)を消すだけでなく、当たり判定シリンダーもレイヤー1へ退避させて
  // raycastにヒットしなくする(three.jsのraycastはvisibleを見ないため、visible=falseだけでは
  // クリック判定は消えない → makeHitCylinder側コメント参照)。
  let axesVisible = true;
  function setAxesVisible(visible) {
    axesVisible = visible;
    for (const line of axisLines) line.visible = visible;
    for (const hit of axisHitAreas) hit.layers.set(visible ? 0 : 1);
  }
  function isAxesVisible() {
    return axesVisible;
  }

  // 現在のopacity値を3本の軸(uOpacityユニフォーム)へまとめて反映する。
  function setAxesOpacity(opacity) {
    for (const line of axisLines) line.material.uniforms.uOpacity.value = opacity;
  }

  // ── なめらかなフェードアウト/フェードイン ──────────────────
  // main.js の fadeOutAxisVisuals() から `typeof axes.fadeOut === 'function'` の
  // 保険付きで呼ばれる想定(数式ズーム開始時、軸まわりの表示を一斉にフェードさせる箇所)。
  // クリック判定は「見えている間だけ」有効にしたいので、フェード開始と同時に即座にレイヤー退避し、
  // 見た目の消滅(opacity)だけをdurationかけてなめらかに追わせる。
  function fadeOut(duration = 1.2) {
    axesVisible = false;
    for (const hit of axisHitAreas) hit.layers.set(1); // クリック判定は先に切っておく
    gsap.to({ o: 1 }, {
      o: 0,
      duration,
      ease: 'power1.out',
      onUpdate: function () { setAxesOpacity(this.targets()[0].o); },
      onComplete: () => { for (const line of axisLines) line.visible = false; },
    });
  }

  // 軸を再び出したくなったとき用(現時点ではmain.js側に「ズームから戻る」導線が
  // まだ無いため未使用だが、追加された際にそのまま呼べるように用意しておく)。
  function fadeIn(duration = 1.2) {
    axesVisible = true;
    for (const line of axisLines) line.visible = true;
    setAxesOpacity(0);
    gsap.to({ o: 0 }, {
      o: 1,
      duration,
      ease: 'power1.out',
      onUpdate: function () { setAxesOpacity(this.targets()[0].o); },
      onComplete: () => { for (const hit of axisHitAreas) hit.layers.set(0); },
    });
  }

  // 毎フレーム呼ぶと、X軸の「原点へ向かう流れ」のアニメーションが進む(Y/Zは静的なので対象外)
  function update(t) {
    xAxis.material.uniforms.uTime.value = t;
  }

  // Xステーション滞在中だけ流れ演出をオンにする(main.jsのshowXOverlay/hideXOverlayから呼ぶ)
  function setXFlowActive(active) {
    xAxis.material.uniforms.uActive.value = active ? 1 : 0;
  }

  // ── Xの「刃跡」トラベルマーカー ─────────────────
  const travelMarker = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 3),
    new THREE.MeshBasicMaterial({ color: AXIS_GLOW_COLOR })
  );
  travelMarker.visible = false;
  scene.add(travelMarker);

  return { xAxis, yAxis, zAxis, axisLines, axisHitAreas, travelMarker, updateXAxisTrail, update, setXFlowActive, setAxesVisible, isAxesVisible, fadeOut, fadeIn, setViewportSize };
}
