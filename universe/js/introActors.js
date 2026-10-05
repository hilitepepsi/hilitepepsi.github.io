import { createAStar } from './aStar.js';

const ARROW_SCALE = 1;

// ── 矢(=Aスター。オレンジの光+黒い芯+スターダストの尾) ──
export function createArrow(scene) {
  const arrowGroup = createAStar(scene, { density: 4, life: 1.4 });
  arrowGroup.scale.setScalar(ARROW_SCALE);
  arrowGroup.visible = false;
  return arrowGroup;
}