import * as THREE from 'three';
import { AXIS_LENGTH, AXIS_WORLD_DIR } from './config.js';

// ── 三軸(X/Y/Z)のラベル ────────────────────────────
// 各軸の先端よりわずか手前にテキストスプライトを置く。
// Sprite なので常にカメラの方を向き、どの角度から見ても文字として読める。

const LABEL_OFFSET = 1.6;      // 先端からどれだけ手前に置くか(軸の線とかぶらないように)
const LABEL_WORLD_SIZE = 2.2;  // スプライトの表示サイズ(ワールド単位)

// ── 汎用テキストスプライト生成 ──────────────────
// axisStationOverlay.js(軸タイトルなど、複数文字のテキスト)からも再利用するため、
// キャンバスサイズ・フォントサイズ・スプライトの表示サイズを引数で指定できるようにしてある。
export function makeTextSprite(text, opts = {}) {
  const {
    canvasWidth = 128,
    canvasHeight = 128,
    fontPx = canvasHeight * 0.62,
    worldWidth = LABEL_WORLD_SIZE,
    worldHeight = LABEL_WORLD_SIZE,
  } = opts;

  const canvas = document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  const ctx = canvas.getContext('2d');

  function draw() {
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);
    ctx.font = `italic 600 ${fontPx}px "Cormorant Garamond", serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#bcdcec';       // ← 明度を下げた文字色(以前は#eaf6ffでほぼ白、blurと相まって滲んで見えていた)
    ctx.shadowColor = '#bfe9ff';
    ctx.shadowBlur = fontPx * 0.08;  // ← にじみ(shadowBlur)も控えめに(以前は0.18)
    ctx.fillText(text, canvasWidth / 2, canvasHeight / 2 + canvasHeight * 0.03);
  }
  draw();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;

  // ページのGoogle Fonts読み込みが後から完了することがあるので、
  // フォント準備完了時に一度描き直す(先に描画してしまうとフォールバック書体のままになるため)
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { draw(); texture.needsUpdate = true; });
  }

  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(worldWidth, worldHeight, 1);
  return sprite;
}

function makeLabelSprite(text) {
  return makeTextSprite(text, {
    canvasWidth: 128,
    canvasHeight: 128,
    worldWidth: LABEL_WORLD_SIZE,
    worldHeight: LABEL_WORLD_SIZE,
  });
}

export function createAxisLabels(scene) {
  const group = new THREE.Group();
  group.visible = false; // home状態に達するまでは表示しない(main.js側でshow()する)
  // ↑ 初期状態はhide()を経由せず直接falseにしているため、
  //   ラベルのraycastレイヤーも下のループでこの後すぐ1(=対象外)にしておく必要がある

  const entries = [
    ['X', AXIS_WORLD_DIR.X],
    ['Y', AXIS_WORLD_DIR.Y],
    ['Z', AXIS_WORLD_DIR.Z],
  ];

  const sprites = {};
  for (const [name, dir] of entries) {
    const sprite = makeLabelSprite(name);
    sprite.position.copy(dir.clone().normalize().multiplyScalar(AXIS_LENGTH + LABEL_OFFSET));
    // ── 軸クリック判定との連携 ──────────────────
    // axes.js のヒットシリンダー(userData.axisName)と同じキーを持たせておくことで、
    // main.js 側は「ラベルに当たった場合もaxisNameで同じ処理に合流させる」だけでよい。
    // Sprite自体がraycast可能(スプライトの表示矩形がそのまま判定領域になる)なので、
    // 専用の当たり判定メッシュを別途用意する必要はない。
    sprite.userData.axisName = name;
    sprite.layers.set(1); // ← 初期状態(非表示)はレイヤー1(raycast対象外)。show()で0に戻す。
    group.add(sprite);
    sprites[name] = sprite;
  }

  scene.add(group);

  // ラベルのraycast対象リスト(main.jsのクリック判定にaxisHitAreasと一緒に渡す用)
  const labelHitAreas = Object.values(sprites);

  function show() {
    group.visible = true;
    for (const s of labelHitAreas) s.layers.set(0);
  }
  function hide() {
    group.visible = false;
    for (const s of labelHitAreas) s.layers.set(1); // レイヤー退避でクリック判定も一緒に消す(visibleだけだとraycastは反応してしまうため)
  }

  return { group, sprites, labelHitAreas, show, hide };
}