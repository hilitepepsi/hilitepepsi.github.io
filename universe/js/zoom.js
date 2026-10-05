import * as THREE from 'three';
import { SYMBOL_ASSETS, symbolWorldSize, symbolWorldPosition } from './symbolAssets.js';

// ── Phase3準備: 数式クリックでのズーム ──────────────────────
// Carousel(③④)が加わると横幅が増えるので、あらかじめiħ側(左)に
// 「予約席」の幅を確保しておく。
export const CAROUSEL_RESERVE_WORLD_WIDTH = symbolWorldSize('i').width + symbolWorldSize('hbar').width;

const ZOOM_MARGIN_RATIO = 0.12; // 画面に対して上下左右に残す余白の比率(仮)

// 数式が「タイトフィット(=画面いっぱい)」時の何割の大きさに見えるようにするか。
// 0.52 = タイトフィット時の約5割強の大きさ。仮値、調整してください。
// (2026-08-16: 「もう少しアップに」とのことで0.3→0.4→0.52に)
const ZOOM_SIZE_RATIO = 0.52;

// 現在配置されている数式シンボル全体のワールド空間バウンディングボックス(中心・幅・高さ)。
// minX側(iħがある側)にCAROUSEL_RESERVE_WORLD_WIDTH分を足して、
// まだ存在しない③④の分の余白もあらかじめ確保しておく。
export function computeEquationBounds(vertexWorld, frame) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const key of Object.keys(SYMBOL_ASSETS)) {
    const pos = symbolWorldPosition(key, vertexWorld, frame);
    const sx = pos.clone().sub(vertexWorld).dot(frame.right);
    const sy = pos.clone().sub(vertexWorld).dot(frame.up);
    const { width, height } = symbolWorldSize(key);
    minX = Math.min(minX, sx - width / 2);
    maxX = Math.max(maxX, sx + width / 2);
    minY = Math.min(minY, sy - height / 2);
    maxY = Math.max(maxY, sy + height / 2);
  }
  minX -= CAROUSEL_RESERVE_WORLD_WIDTH;

  const width = maxX - minX;
  const height = maxY - minY;
  const center = vertexWorld.clone()
    .addScaledVector(frame.right, (minX + maxX) / 2)
    .addScaledVector(frame.up, (minY + maxY) / 2);
  return { center, width, height };
}

// 数式クリック時: 向きは変えず、frame.forward方向にカメラを寄せる(離す)だけのズーム。
// width/heightがちょうど画角に収まる距離を計算し、余白(ZOOM_MARGIN_RATIO)を残した上で、
// さらにsizeRatio分だけ引きの絵にする(sizeRatio=1ならタイトフィット、小さいほど遠目)。
//
// axes / axisLabels: createAxes() / createAxisLabels() の戻り値をそのまま渡す(任意)。
// 渡した場合、カメラが数式へ寄っていくズーム開始と同時に軸・XYZラベルを非表示にする
// (setAxesVisible/hideはクリック判定側も一緒に無効化する実装になっているので、
//  ズーム中に軸が視界の裏で誤ってクリック判定されることもない)。
// 元に戻す(軸を再表示する)タイミングはこの関数の外(main.js側でホーム状態へ戻す処理)で
// axes.setAxesVisible(true) / axisLabels.show() を呼ぶ想定。
export function zoomToEquation({ camera, controls, vertexWorld, frame, duration = 1.6, sizeRatio = ZOOM_SIZE_RATIO, axes, axisLabels, onComplete }) {
  const { center, width, height } = computeEquationBounds(vertexWorld, frame);
  const vFov = THREE.MathUtils.degToRad(camera.fov);
  const hFov = 2 * Math.atan(Math.tan(vFov / 2) * camera.aspect);

  const targetW = width * (1 + ZOOM_MARGIN_RATIO * 2);
  const targetH = height * (1 + ZOOM_MARGIN_RATIO * 2);
  const tightDistance = Math.max(
    (targetW / 2) / Math.tan(hFov / 2),
    (targetH / 2) / Math.tan(vFov / 2),
  );
  // 見た目のサイズをsizeRatio倍にしたいので、距離はその逆数倍だけ遠ざける
  const targetDistance = tightDistance / sizeRatio;

  const targetPos = center.clone().addScaledVector(frame.forward, -targetDistance);

  if (controls) controls.enabled = false;
  // カメラが数式へ「接近」を始めるのと同時に軸・XYZラベルを消す(見た目にもクリック判定にも効く)
  if (axes) axes.setAxesVisible(false);
  if (axisLabels) axisLabels.hide();

  const startPos = camera.position.clone();
  const startTarget = controls ? controls.target.clone() : center.clone();
  const progress = { t: 0 };
  const lookAt = new THREE.Vector3();

  gsap.to(progress, {
    t: 1, duration, ease: 'power2.inOut',
    onUpdate: () => {
      camera.position.lerpVectors(startPos, targetPos, progress.t);
      lookAt.lerpVectors(startTarget, center, progress.t);
      camera.lookAt(lookAt);
    },
    onComplete: () => {
      camera.position.copy(targetPos);
      camera.lookAt(center);
      if (controls) controls.target.copy(center);
      if (onComplete) onComplete();
    },
  });
}