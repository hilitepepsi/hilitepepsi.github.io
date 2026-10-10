import * as THREE from 'three';
// gsapは index.html でグローバル読み込みしているため、ここでは import せずそのまま使う。

// ── 定数 ───────────────────────────────────────
export const AXIS_LENGTH = 18;
export const AXIS_COLOR  = 0xbfe9ff;
export const ARCHER_POS  = new THREE.Vector3(0, 24, 380);
export const AXIS_X_FAR  = new THREE.Vector3(0, 0, 120);
export const AXIS_X_ANCHOR_Z = AXIS_LENGTH;

export const AXIS_WORLD_DIR = {
  X: new THREE.Vector3(0, 0, 1),
  Y: new THREE.Vector3(1, 0, 0),
  Z: new THREE.Vector3(0, 1, 0),
};

// ══════════════════════════════════════════════════════════════
// ── ホーム(main.jsのイントロ・record.jsの鏡演出)用のカメラ ──────────
//   ★ この3つ(DISTANCE/TARGET/POS)は他ページと共有されているため、
//   ここより下は絶対に変更しないこと。宇宙ページだけ視点を変えたい場合は、
//   このすぐ下にある「universe.js専用のカメラ視点」ブロックの方を編集する。
// ══════════════════════════════════════════════════════════════
export const HOME_CAMERA_DISTANCE = 34;
export const HOME_CAMERA_TARGET = new THREE.Vector3(0, 0, 0);
export const HOME_CAMERA_POS = new THREE.Vector3(1, 1, 1)
  .normalize()
  .multiplyScalar(HOME_CAMERA_DISTANCE);

// ══════════════════════════════════════════════════════════════
// ── universe.js専用のカメラ視点(上のHOME_CAMERA_*とは完全に独立) ───────
//   2026-09-11: phase3(数式ズーム→②③④展開後)で静止しているカメラの実際の
//   position/targetを、main.js側のdumpCamera()デバッグ関数でその場でキャプチャして
//   固定値化した(採取値をきれいな数値に丸めてある)。以前あった「距離46・方向比率
//   (1,0.3,1)」という計算式ベースの推測値は、実際の画角とは大きくズレていたため
//   (position差で約51ユニット)、このキャプチャ値に置き換えている。
//   HOME_CAMERA_POS/TARGET/DISTANCEはmain.js(イントロ)・record.js(鏡演出)でも
//   参照されているため、宇宙ページ用にここを直接書き換えると他ページに被害が出る。
//   そのためここで独立した定数として新設している。宇宙ページの視点を調整したい
//   ときはこのブロックだけを触ればよい。
//
//   ★ 2026-09-11 再調整(ご指示反映): 上記の経緯の通り、このPOSはもともとPhase3
//   (数式ズームの間近の距離感)からそのまま流用した値だったため、tripod
//   (半径TRIPOD_RADIUS≈14.7・高さAPEX_HEIGHT≈10.4)や銀河(半径GALAXY_RADIUS≈118。
//   galaxy.js参照)を含む宇宙ページの実際のスケール感には近すぎた(原点からの距離が
//   約5.7しかなく、tripodの脚が描く円の内側にほぼ埋まっていた)。
//   「カメラを離して、余裕を持ってtripod/リングを小さく配置したい」「視点をもっと
//   水平に近くしたい」というご指示を反映し、
//     - TARGETをtripod中腹(だいたいAPEX_HEIGHT/2)あたりへ上げて、脚(y=0)〜頂点
//       (y≈APEX_HEIGHT)〜リング上昇後(banana付近)までを画面の上下バランスよく収める。
//     - POSは水平方向の距離を大きく取りつつ、TARGETとの高低差を小さくして
//       極角(OrbitControlsのphi)が90°(=真横から見た「水平」)に近づくようにした。
//   ★ 2026-09-11 さらに再調整(ご指示反映): 「まだcarouselに近すぎる」とのことで、
//   TARGETからの距離を約37→約85(倍以上)に拡大した(方向・水平寄りの角度比率は維持)。
//   宇宙ページはcontrols.enableZoom=false(main.js参照)で入場時の距離が固定される
//   ため、この距離感がそのままずっと保たれる。仮値なので、見ながら調整してください。
// ══════════════════════════════════════════════════════════════
export const UNIVERSE_CAMERA_TARGET = new THREE.Vector3(0, 1, 0);

// ★ 2026-09-12 変更: 「方向」と「距離」を分離した。以前はUNIVERSE_CAMERA_POSに
//   生のワールド座標(60,12,60)を直接ハードコードしていて、距離を変えたいだけでも
//   3成分すべてを計算し直す必要があった(単位ベクトルではないので、値をそのまま
//   スケールしても意図した距離にならない)。
//   今後fov=2の疑似正射影で使う前提だと、見た目のズーム量はほぼこのDISTANCE
//   一本で決まる(狭いfovでは「距離が近い=拡大、遠い=縮小」がほぼそのまま効く)。
//   DIRは「どの角度から見るか」だけを担当し、正規化してあるので長さ(スケール)は
//   気にしなくてよい。
export const UNIVERSE_CAMERA_DIR = new THREE.Vector3(160, 8, 160).normalize(); // 以前のPOSと同じ向きを維持
// ★ 修正(ご指示反映): 「銀河を10倍にしたので、カメラ位置も10倍遠ざけたい」への対応。
//   fov(角度)は世界のスケールと無関係なので変える必要はないが、距離は世界座標の
//   長さそのものなので、銀河(galaxy.js側のGALAXY_RADIUS)と同じ比率で大きくしないと
//   カメラが相対的に銀河へ近づきすぎる(=銀河の内側に埋まって見える)。
export const UNIVERSE_CAMERA_DISTANCE = 10000; // ズーム量はこの数字だけで調整する。小さいほど拡大される(以前の10倍)
export const UNIVERSE_CAMERA_POS = UNIVERSE_CAMERA_TARGET.clone().add(
  UNIVERSE_CAMERA_DIR.clone().multiplyScalar(UNIVERSE_CAMERA_DISTANCE)
);

// ── tripod/リングの入れ替えフェーズの区切り(tripodRingSwap.js側で使用) ──
//   record.viewMixCurrent(0〜1)のうち、0〜PHASE_SWAP_ENDの区間が「tripod降下+リング上昇+
//   鏡tripodへの入れ替え」の区間、PHASE_SWAP_END〜1がそれ以降(スクロールし切った後の
//   余白)になる。以前はrecord.js側のカメラ振り向き処理もこの区切りを参照していたが、
//   カメラを完全固定する方針に変更した際にその処理自体を撤去したため、現在参照している
//   のはtripodRingSwap.jsのみ。config.js側に定数化してあるのは、将来またカメラ側の
//   処理が復活したときに2箇所で値がズレるバグを防ぐため(仮値。見た目を見ながら調整してください)。
export const PHASE_SWAP_END = 0.5;

export const AXIS_STATION = {
  duration: 2.2,
};

export const TUNE = {
  starSize: 0.2,
  starBrightMin: 0.3,
  starBrightMax: 2.2,
  // bloomStrength: 発光の強さそのもの。星は部分参加(main.js側のexcludeFromBloom)
  // に切り替えたので、これは主にガラスパネルなど星以外の発光に効く。
  // 過剰にならない元の水準へ戻す。
  bloomStrength: 1.3,
  bloomRadius: 0.4,
  bloomThreshold: 0.3,
  travelDuration: 3.0,
  travelEase: 'power2.in',
  maxActiveShards: 200,
};

// ── 球面座標 ─────────────────────────────────
function toSpherical(v) {
  const r = v.length() || 1;
  return {
    r,
    theta: Math.atan2(v.x, v.z),
    phi: Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1)),
  };
}
function fromSpherical(r, theta, phi) {
  return new THREE.Vector3(
    r * Math.sin(phi) * Math.sin(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.cos(theta)
  );
}

// ── 軸ステーション: 3軸それぞれの位置を求める ──────────────────
const STATION_HEIGHT = 16;
const STATION_SIDE   = 20;
const STATION_DEPTH  = 24;

export function getAxisStationView(axisWorldDir, axisLength) {
  const d = axisWorldDir.clone().normalize();
  const target = d.clone().multiplyScalar(axisLength / 2);
  const position = target.clone();

  if (Math.abs(d.x) > 0.5) {
    // d = world X (概念Y軸)
    position.y += STATION_HEIGHT;
    position.z += STATION_DEPTH;
  } else if (Math.abs(d.z) > 0.5) {
    // d = world Z (概念X軸)
    position.x += STATION_SIDE;
    position.y += STATION_HEIGHT;
  } else {
    // d = world Y (概念Z軸)
    position.x += STATION_SIDE;
    position.z += STATION_DEPTH;
  }

  // upは固定値ではなく、軸方向dとカメラ→注視点の向きから毎回算出する。
  // cross(d, forward)はdと直交するので、upがdと重なって退化することがない
  // → どの軸でも「軸自身は画面の横(right)」「upは軸と垂直」が保証される。
  const forward = target.clone().sub(position).normalize();
  const up = new THREE.Vector3().crossVectors(d, forward).normalize();

  return { position, target, up };
}

// ── ホーム→軸ステーションへの遷移 ──────────────────
export function flyToAxisStation(camera, controls, view, opts = {}) {
  const { duration = 2.2, onComplete } = opts;
  if (controls) controls.enabled = false;

  const start = toSpherical(camera.position.clone());
  const end = toSpherical(view.position.clone());

  const TWO_PI = Math.PI * 2;
  let dTheta = (((end.theta - start.theta) % TWO_PI) + TWO_PI) % TWO_PI;
  if (dTheta > Math.PI) dTheta -= TWO_PI;

  const startQuat = camera.quaternion.clone();
  const endQuat = new THREE.Quaternion().setFromRotationMatrix(
    new THREE.Matrix4().lookAt(view.position, view.target, view.up)
  );

  const progress = { t: 0 };

  return gsap.to(progress, {
    t: 1,
    duration,
    ease: 'power2.inOut',
    onUpdate: () => {
      const t = progress.t;
      const theta = start.theta + dTheta * t;
      const phi = THREE.MathUtils.lerp(start.phi, end.phi, t);
      const r = THREE.MathUtils.lerp(start.r, end.r, t);
      camera.position.copy(fromSpherical(r, theta, phi));
      camera.quaternion.slerpQuaternions(startQuat, endQuat, t);
    },
    onComplete: () => {
      camera.position.copy(view.position);
      camera.quaternion.copy(endQuat);
      camera.up.copy(view.up);
      if (controls) {
        controls.target.copy(view.target);
        controls.enabled = true;
        controls.update();
      }
      if (onComplete) onComplete();
    }
  });
}