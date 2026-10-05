// ── オープニング演出タイムライン + 状態管理 ─────
// state: 'idle'(クリック待ち) → 'playing'(演出中) → 'home'(トップページ状態)
// gsapは index.html でグローバル読み込みしているため、ここでは import せずそのまま使う。

const ARROW_ARC_HEIGHT = 40; // 矢の放物線の高さ(少しだけ弧を描かせる。大きくするほど山なりになる)

// Aスターの発射位置 = 射手座の「弓の先」。
// sagittarius.jsの各星は「射手座グループの中心(=ARCHER_POS)からのオフセット」で置かれていて、
// グループに回転・拡縮はかけていないので、ワールド座標 = ARCHER_POS + オフセット になる。
// (sagittarius.js の SAGITTARIUS_SHAPE の「弓の先」と同じ値。そちらを動かしたらここも合わせる)
const BOW_TIP_OFFSET = { x: -53, y: 13, z: 5 };

export function createIntroSequence(deps) {
  const {
    camera, controls, lookTarget, archer, arrowGroup,
    bananaState, triggerShatter, axes,
    TUNE, ARCHER_POS, AXIS_X_FAR,
    HOME_CAMERA_TARGET,
    archerArt, // 3D空間に固定されたSprite(archerArt.js)
  } = deps;

  let state = 'idle';

  function setHomeState() {
    state = 'home';
    controls.enabled = true;
    controls.target.copy(HOME_CAMERA_TARGET);
    document.getElementById('axisHint').classList.add('show');
  }

  function startSequence() {
    if (state !== 'idle') return;
    state = 'playing';
    document.getElementById('hint').classList.add('hidden');

    const tl = gsap.timeline({ defaults: { ease: 'power2.inOut' } });

    // 1) カメラが振り返る
    tl.set(archer, { visible: true });
    tl.to(lookTarget, { x: ARCHER_POS.x, y: ARCHER_POS.y, z: ARCHER_POS.z, duration: 1.4 });
    if (archerArt) {
      // 振り返り開始から0.6秒後、途中から淡く(opacity 0.45まで)浮かび上がる
      tl.to(archerArt.material, { opacity: 0.2, duration: 1.2 }, '<+=0.7');
    }
    tl.to({}, { duration: 0.3 }); // 溜め

    // 2) 矢が放たれ、カメラも視線を戻す
    tl.set(arrowGroup, { visible: true });
    const arrowStart = {
      x: ARCHER_POS.x + BOW_TIP_OFFSET.x,
      y: ARCHER_POS.y + BOW_TIP_OFFSET.y,
      z: ARCHER_POS.z + BOW_TIP_OFFSET.z,
    };
    tl.set(arrowGroup.position, arrowStart);
    // 放物線: x/zは直線で原点へ、yだけsin(πt)の山なりを足して弧を描かせる
    const arrowFlight = { t: 0 };
    tl.to(arrowFlight, {
      t: 1, duration: 2.0, ease: 'power1.in',
      onUpdate: () => {
        const t = arrowFlight.t;
        arrowGroup.position.x = arrowStart.x * (1 - t);
        arrowGroup.position.z = arrowStart.z * (1 - t);
        arrowGroup.position.y = arrowStart.y * (1 - t) + Math.sin(Math.PI * t) * ARROW_ARC_HEIGHT;
      },
      onComplete: () => { arrowGroup.visible = false; bananaState.mesh.visible = false; triggerShatter(); }
    }, 'fly');
    tl.to(lookTarget, { x: 0, y: 0, z: 0, duration: 2.0, ease: 'power1.inOut' }, 'fly');
    if (archerArt) {
      tl.to(archerArt.material, { opacity: 0, duration: 1.0 }, 'fly'); // 矢が飛ぶのと同時にフェードアウト
    }

    // 3) 破砕を見せる間(スカラー)
    tl.to({}, { duration: 0.9 });

    // 4) Y軸が伸びる
    tl.to(axes.yAxis.scale, { y: 1, duration: 1.1, ease: 'power2.out' });

    // 5) Xが刃跡風に到達 ― 刃(travelMarker)が遠方から原点へ走り、
    //    通り抜けた軌跡がそのままX軸として刻まれていく(原点からではなく逆向きに伸びる)
    tl.set(axes.travelMarker, { visible: true });
    tl.set(axes.travelMarker.position, { x: AXIS_X_FAR.x, y: AXIS_X_FAR.y, z: AXIS_X_FAR.z });
    tl.call(() => axes.updateXAxisTrail(AXIS_X_FAR.z));
    tl.to(axes.travelMarker.position, {
      z: 0, duration: TUNE.travelDuration, ease: TUNE.travelEase,
      onUpdate: () => axes.updateXAxisTrail(axes.travelMarker.position.z),
      onComplete: () => {
        axes.travelMarker.visible = false;
        axes.updateXAxisTrail(0);
      }
    });

    // 6) Z軸が伸びる(カメラは最初からホームポジションにいるため、ここでの移動は不要)
    tl.to(axes.zAxis.scale, { y: 1, duration: 3.1, ease: 'power2.out' });

    // 7) トップページ状態へ
    tl.call(setHomeState);
  }

  return {
    startSequence,
    getState: () => state,
  };
}