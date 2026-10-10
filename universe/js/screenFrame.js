import * as THREE from 'three';

// ── カメラの実際の姿勢から「画面の右/上/前方」ベクトルを取り出す ──────────
// カメラのmatrixWorldの列0=ローカルX(右)、列1=ローカルY(上)、
// forwardはcamera.getWorldDirection()(カメラが向いている方向)で取得する。
// Phase 1〜2の間カメラが静止している前提なので、これは一度だけ呼べば十分。
export function computeScreenFrame(camera) {
  camera.updateMatrixWorld();
  const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
  const forward = new THREE.Vector3();
  camera.getWorldDirection(forward); // 正規化済みで返る
  const cameraPos = camera.getWorldPosition(new THREE.Vector3());
  return { right, up, forward, cameraPos };
}

// frame(computeScreenFrameの戻り値)を使って、「カメラからdepthだけ前方、
// 画面のscreenX(右方向)・screenY(上方向)だけずれた点」のワールド座標を返す。
// hbar/hamiltonianの「軸を歩いている」区間の経路(MANUAL_PATH)に使う。
export function planePoint(frame, depth, screenX, screenY) {
  return frame.cameraPos.clone()
    .addScaledVector(frame.forward, depth)
    .addScaledVector(frame.right, screenX)
    .addScaledVector(frame.up, screenY);
}

// ワールド座標をビューポートに対する%位置(left%/top%としてそのまま使える値)に変換する。
// cameraが静止している前提(Phase 1の間はそう)なので、呼ぶタイミングは一度でよい。
// (現状どこからも呼ばれていないが、キャプションをワールド座標に追従させたくなった
//  ときのために残してある)
export function worldToScreenPercent(worldPos, camera) {
  const ndc = worldPos.clone().project(camera);
  return {
    leftPercent: (ndc.x * 0.5 + 0.5) * 100,
    topPercent: (1 - (ndc.y * 0.5 + 0.5)) * 100,
  };
}