import * as THREE from 'three';

// お好みの発光色。元のfilterチェーンが作っていた色に近いシアン寄りの青緑を仮置き。
// 実機で見比べて微調整してください(スポイトツールで元の見た目をサンプリングするのが早いです)。
const TINT_COLOR = 'rgba(118, 237, 255, 0.56)';
const BLUR_SCALE = 0.2; // 小さいほどぼける(縮小率)

export function createArcherArt(scene, position, { width = 60, height = 40, blurScale = BLUR_SCALE } = {}) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter; // ミップマップ不要、単純な線形補間でぼかしを活かす
  texture.generateMipmaps = false;

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(width, height, 1);
  sprite.position.copy(position);
  sprite.visible = false;
  scene.add(sprite);

  const img = new Image();
  img.crossOrigin = 'anonymous';
  img.onload = () => {
    // ぼかし用に、意図的に低い解像度へ縮小して描く(拡大時ににじむ=ぼかしになる)
    const w = Math.max(1, Math.round(img.width * blurScale));
    const h = Math.max(1, Math.round(img.height * blurScale));
    canvas.width = w;
    canvas.height = h;

    // 1. まず元画像(黒い線画+透明背景)をそのまま縮小描画
    ctx.drawImage(img, 0, 0, w, h);

    // 2. アルファ(形)はそのまま、色だけをTINT_COLORに置き換える
    ctx.globalCompositeOperation = 'source-in';
    ctx.fillStyle = TINT_COLOR;
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    texture.needsUpdate = true;
    sprite.visible = true;
  };
  img.src = './img/sagittarius.png';

  return sprite;
}