import * as THREE from 'three';
import { DOT_COLOR } from './axisStationOverlay.js';

// ── 「Teddy」「The Catcher in the Rye」クリック時に表示する星座風の画像 ──────
// 画像ファイルは jsフォルダと並ぶ imgフォルダ に置く想定:
//   /img/Cat.png        ← Teddy用(準備済み)
//   /img/Catcher1.png   ← The Catcher in the Rye用(画像はあるが、今回はまだ繋がない)
// このファイルからは相対パス '../img/xxx.png' で参照する。
//
// 表示位置は「宇宙の端」寄りにしたいとのことだったので、ここでは仮の座標を置いてある。
// 実際に良さそうな場所は各自お好みで POSITIONS の値を書き換えて探ってください
// (home状態でカメラを動かしながら console.log(camera.position) すると座標の見当がつけやすい)。
const POSITIONS = {
  Y_END: new THREE.Vector3(10, 10, -70), // Teddy(Cat.png)
  X_END: new THREE.Vector3(-390, -310, -100),  // The Catcher in the Rye
};

// url: null のものは「まだ画像を繋がない」の意味。showしても何も表示されない(エラーにもならない)。
// Catcher1.pngを繋ぐ準備ができたら、X_END.url を new URL('../img/Catcher1.png', import.meta.url).href に変える。
const IMAGE_CONFIG = {
  Y_END: {
    url: new URL('../img/Cat.png', import.meta.url).href,
    position: POSITIONS.Y_END,
    width: 26,   // ワールド単位での表示サイズ(横)
    height: 26,  // 〃(縦)。Cat.pngの縦横比に応じて後で調整してください
    blurPX: 6,   // ブラーの強さ(px)
    tintColor: `#${DOT_COLOR.toString(16).padStart(6, '0')}`, // ← Teddyの点(yEndDot)と同じ発色
    tintStrength: 0.6, // 1に近いほど元の濃淡が消えて単色シルエットに近づく
  },
  X_END: {
    url: new URL('../img/Catcher1.png', import.meta.url).href,
    position: POSITIONS.X_END,
    mode: 'transparentStars', // ← Cat.pngと違い、ティント/強ブラーはせず黒背景だけ透過にする
    width: 336,   // 元画像は1051×1496(横:縦 ≒ 0.70)。大きく・きれいに見せたいので縦長のまま拡大
    height: 480,
    blackPoint: 14, // これ以下の明るさは完全透明(黒背景を抜く)
    whitePoint: 55, // これ以上の明るさは完全不透明(明るい星・線をくっきり残す)
    blurPX: 0,      // 星図のディテールを残したいので基本0。縁が硬すぎる場合だけ1〜2を試す
  },
};

// 画像を「ブラー + 単色ティント」したcanvasテクスチャに変換する(Teddy/Cat.png用)。
// 発光している点(yEndDot等)と馴染むよう、色そのものをDOT_COLORへ寄せてしまう方式。
//   1) 元画像をぼかして描く
//   2) 元の形(アルファ)は保ったまま、色だけtintColorへ寄せる(source-atop)
function createBlurredTintedTexture(url, { blurPX, tintColor, tintStrength, canvasSize = 512 }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvasSize;
      canvas.height = canvasSize;
      const ctx = canvas.getContext('2d');

      const scale = Math.min(canvasSize / img.width, canvasSize / img.height);
      const w = img.width * scale;
      const h = img.height * scale;
      const ox = (canvasSize - w) / 2;
      const oy = (canvasSize - h) / 2;

      ctx.filter = `blur(${blurPX}px)`;
      ctx.drawImage(img, ox, oy, w, h);
      ctx.filter = 'none';

      ctx.globalCompositeOperation = 'source-atop';
      ctx.globalAlpha = tintStrength;
      ctx.fillStyle = tintColor;
      ctx.fillRect(0, 0, canvasSize, canvasSize);
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      resolve(texture);
    };
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

// 画像を「黒背景だけ透過にする」canvasテクスチャに変換する(Catcher/Catcher1.png用)。
// Cat.pngと違い、この画像は自前の色(金色の星図)をそのまま活かしたいので、
// ティントや強いブラーはかけない。黒(=背景)ほど透明、明るい(=星・線)ほど不透明になるよう
// 輝度(luminance)からアルファを作る、いわゆる「輝度キー抜き」。
//   blackPoint: これ以下の明るさは完全透明
//   whitePoint: これ以上の明るさは完全不透明(この間はなだらかにグラデーション)
//   blurPX    : 0でOK。輪郭を少しだけ柔らかくしたい場合のみ1〜2程度を指定
function createTransparentStarTexture(url, { blackPoint = 14, whitePoint = 55, blurPX = 0, maxDimension = 1024 }) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      // 元の縦横比を保ったまま、なるべく大きく・きれいに見えるサイズで描く
      const scale = Math.min(1, maxDimension / Math.max(img.width, img.height));
      const w = Math.round(img.width * scale);
      const h = Math.round(img.height * scale);

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (blurPX > 0) ctx.filter = `blur(${blurPX}px)`;
      ctx.drawImage(img, 0, 0, w, h);
      ctx.filter = 'none';

      const imageData = ctx.getImageData(0, 0, w, h);
      const data = imageData.data;
      const range = Math.max(1, whitePoint - blackPoint);
      for (let i = 0; i < data.length; i += 4) {
        const luminance = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
        const alpha = Math.min(1, Math.max(0, (luminance - blackPoint) / range));
        data[i + 3] = Math.round(alpha * 255);
      }
      ctx.putImageData(imageData, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.colorSpace = THREE.SRGBColorSpace;
      texture.needsUpdate = true;
      resolve(texture);
    };
    img.onerror = (err) => reject(err);
    img.src = url;
  });
}

function makeImageSprite(config) {
  const { url, position, width, height } = config;
  const material = new THREE.SpriteMaterial({
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.position.copy(position);
  sprite.scale.set(width, height, 1);
  sprite.visible = false;
  sprite.userData.wantVisible = false; // ← クリック時点でまだ画像がロード中だった場合に「ロードできたら出す」の意思を覚えておく

  sprite.userData.readyPromise = url
    ? (config.mode === 'transparentStars'
        ? createTransparentStarTexture(url, config)
        : createBlurredTintedTexture(url, config))
        .then((texture) => { material.map = texture; material.needsUpdate = true; })
        .catch((err) => console.error('constellation image load failed:', url, err))
    : Promise.resolve(); // urlが無い(=画像未設定)場合は即解決。material.mapは無いままなので表示は常にno-op

  return sprite;
}

export function createAxisConstellationOverlay(scene) {
  const group = new THREE.Group();
  scene.add(group);

  const yEndImage = makeImageSprite(IMAGE_CONFIG.Y_END);
  group.add(yEndImage);

  const xEndImage = makeImageSprite(IMAGE_CONFIG.X_END);
  group.add(xEndImage);

  function fadeSprite(sprite, visible) {
    sprite.userData.wantVisible = visible;

    if (!visible) {
      if (!sprite.material.map) return; // 画像未設定なら何もしていないので何もしなくてよい
      gsap.to(sprite.material, {
        opacity: 0,
        duration: 0.5,
        ease: 'power2.in',
        onComplete: () => { sprite.visible = false; },
      });
      return;
    }

    // 表示リクエスト。ロード済みならすぐにフェードイン、ロード中なら完了を待ってから
    // (ただしその間にhideされていたら出さない = wantVisibleを都度チェック)
    sprite.userData.readyPromise.then(() => {
      if (!sprite.userData.wantVisible) return; // 待っている間にクリックが取り消された(別軸へ移動等)
      if (!sprite.material.map) return; // 画像未設定(urlがまだ無い)ならno-op
      sprite.visible = true;
      gsap.to(sprite.material, {
        opacity: 1,
        duration: 0.8,
        ease: 'power2.out',
      });
    });
  }

  return {
    group,
    showTeddyImage: () => fadeSprite(yEndImage, true),
    hideTeddyImage: () => fadeSprite(yEndImage, false),
    showCatcherImage: () => fadeSprite(xEndImage, true),
    hideCatcherImage: () => fadeSprite(xEndImage, false),
  };
}