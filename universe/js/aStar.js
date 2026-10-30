import * as THREE from 'three';

export const BULGE_ORANGE = 0xff9a3c;

const ORB_VERT = `
  varying vec3 vNormal;
  void main() {
    vNormal = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;
// 中心ほど明るく、縁に向かって滑らかに溶ける(球体そのものが発光して見える)
const ORB_FRAG = `
  varying vec3 vNormal;
  void main() {
    float f = clamp(abs(vNormal.z), 0.0, 1.0);
    float glow = pow(f, 1.6);
    // BULGE_ORANGE (0xff9a3c) をそのまま使う。中心も白に寄せずオレンジのまま
    vec3 col = vec3(1.0, 0.604, 0.235);
    gl_FragColor = vec4(col, glow);
  }
`;

const DUST_VERT = `
  uniform float uZoom;
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = min(aSize * uZoom * (300.0 / -mv.z), 24.0); // uZoom: 俯瞰のズーム係数(1=等倍)。ズームで尾の粒が巨大なにじみにならないよう24pxで頭打ち
    gl_Position = projectionMatrix * mv;
  }
`;
const DUST_FRAG = `
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float soft = pow(1.0 - d, 2.0);
    vec3 col = mix(vec3(1.0, 0.75, 0.35), vec3(1.0, 0.5, 0.15), 1.0 - vAlpha);
    gl_FragColor = vec4(col, soft * vAlpha);
  }
`;

/**
 * 発光する球体 + スターダストの尾を持つ「Aスター」。
 * 毎フレーム group.userData.update(dt) を呼ぶこと(dt は秒)。
 *
 * opts:
 *   maxParticles: 粒の最大数
 *   density:      移動距離あたりの粒数(ワールド単位)
 *   idleRate:     静止中に毎秒出す粒数(バルジ中心用。矢は0でOK)
 *   life:         粒の寿命(秒)
 *   size:         粒の基準サイズ
 *   spread:       出現位置のばらつき(ワールド単位)
 */
export function createAStar(scene, opts = {}) {
  const {
    maxParticles = 400,
    density = 6,
    idleRate = 0,
    life = 1.4,
    size = 1.0,
    spread = 0.15,
  } = opts;

  const group = new THREE.Group();

  // ── 本体(発光する球体) ──
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(0.5, 32, 32),
    new THREE.ShaderMaterial({
      vertexShader: ORB_VERT,
      fragmentShader: ORB_FRAG,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
    })
  );
  group.add(orb);

  // ── スターダスト(ワールド座標のプール) ──
  const pos = new Float32Array(maxParticles * 3);
  const vel = new Float32Array(maxParticles * 3);
  const age = new Float32Array(maxParticles).fill(life); // 寿命超え = 空き
  const alpha = new Float32Array(maxParticles);
  const psize = new Float32Array(maxParticles);
  const baseSize = new Float32Array(maxParticles);

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('aAlpha', new THREE.BufferAttribute(alpha, 1));
  geo.setAttribute('aSize', new THREE.BufferAttribute(psize, 1));

  const dust = new THREE.Points(geo, new THREE.ShaderMaterial({
    uniforms: { uZoom: { value: 1 } },
    vertexShader: DUST_VERT,
    fragmentShader: DUST_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  dust.frustumCulled = false;
  scene.add(dust);

  let cursor = 0;
  const prev = new THREE.Vector3();
  const cur = new THREE.Vector3();
  const wScale = new THREE.Vector3();
  let hasPrev = false;
  let carry = 0; // 端数の粒を次フレームへ持ち越す

  function spawn(x, y, z, s) {
    const i = cursor;
    cursor = (cursor + 1) % maxParticles;
    pos[i * 3]     = x + (Math.random() - 0.5) * spread * s;
    pos[i * 3 + 1] = y + (Math.random() - 0.5) * spread * s;
    pos[i * 3 + 2] = z + (Math.random() - 0.5) * spread * s;
    // ゆっくりランダムにふわっと漂う
    vel[i * 3]     = (Math.random() - 0.5) * 0.25 * s;
    vel[i * 3 + 1] = (Math.random() - 0.5) * 0.25 * s;
    vel[i * 3 + 2] = (Math.random() - 0.5) * 0.25 * s;
    age[i] = 0;
    baseSize[i] = size * s * (0.5 + Math.random() * 0.8);
  }

  // group.visibleだけでなく、親(バルジなど)が隠れている場合も「見えていない」と扱う。
  // (尾の粒はscene直下に置いてあるので、親が隠れても勝手には隠れない。以前はバルジが隠れる8°未満でも
  //  尾が出続けて、carousel側に不要なAスターの光が残っていた)
  const effectivelyVisible = () => {
    for (let n = group; n; n = n.parent) if (!n.visible) return false;
    return true;
  };

  group.userData.update = (dt) => {
    const shown = effectivelyVisible();
    dust.visible = shown; // 隠れている間は、残っている粒も描かない
    group.getWorldPosition(cur);
    group.getWorldScale(wScale);
    const s = wScale.x;

    // 発生: 動いた距離に比例(+静止中の微量)
    if (shown) {
      let n = idleRate * dt;
      if (hasPrev) n += cur.distanceTo(prev) * density / Math.max(s, 1e-6) * 1.0;
      carry += n;
      while (carry >= 1) {
        carry -= 1;
        // 前フレーム位置〜現在位置の間にばらまくと線状の尾になる
        const t = hasPrev ? Math.random() : 1;
        spawn(
          prev.x + (cur.x - prev.x) * t,
          prev.y + (cur.y - prev.y) * t,
          prev.z + (cur.z - prev.z) * t,
          s
        );
      }
      prev.copy(cur);
      hasPrev = true;
    } else {
      hasPrev = false; // 非表示中の瞬間移動で尾が引かれないように
      carry = 0;
    }

    // 更新: 移動・縮小・フェード
    for (let i = 0; i < maxParticles; i++) {
      if (age[i] >= life) { alpha[i] = 0; continue; }
      age[i] += dt;
      const k = Math.min(age[i] / life, 1);
      pos[i * 3]     += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      alpha[i] = (1 - k) * (1 - k);
      psize[i] = baseSize[i] * (1 - 0.6 * k);
    }
    geo.attributes.position.needsUpdate = true;
    geo.attributes.aAlpha.needsUpdate = true;
    geo.attributes.aSize.needsUpdate = true;
  };

  // 俯瞰のズーム係数を尾(スターダスト)の粒の大きさへ反映する(球体は実寸のメッシュなので不要)。
  group.userData.setZoom = (z) => { dust.material.uniforms.uZoom.value = z; };

  group.userData.dispose = () => {
    scene.remove(dust);
    geo.dispose();
    dust.material.dispose();
  };

  scene.add(group);
  return group;
}
