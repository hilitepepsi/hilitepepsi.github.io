
import * as THREE from 'three';

export const BULGE_ORANGE = 0xff9a3c;

function makeGlowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0.0, 'rgba(255,190,110,1)');
  grad.addColorStop(0.25, 'rgba(255,140,50,0.55)');
  grad.addColorStop(1.0, 'rgba(255,120,30,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

const DUST_VERT = `
  attribute float aAlpha;
  attribute float aSize;
  varying float vAlpha;
  void main() {
    vAlpha = aAlpha;
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (300.0 / -mv.z);
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
 * オレンジの暈 + 黒い芯 + スターダストの尾を持つ「Aスター」。
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

  // ── 本体 ──
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(),
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
  }));
  halo.scale.setScalar(1.6);
  group.add(halo);

  const core = new THREE.Mesh(
    new THREE.SphereGeometry(0.12, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0x000000 })
  );
  group.add(core);

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

  group.userData.update = (dt) => {
    group.getWorldPosition(cur);
    group.getWorldScale(wScale);
    const s = wScale.x;

    // 発生: 動いた距離に比例(+静止中の微量)
    if (group.visible) {
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

  group.userData.dispose = () => {
    scene.remove(dust);
    geo.dispose();
    dust.material.dispose();
  };

  scene.add(group);
  return group;
}