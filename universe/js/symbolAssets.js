// ── 記号(Ĥ・ħ・∂ψ/∂t・i・=・ψ)のアセット定義と、ワールド空間での配置計算 ──
// このファイルはTHREEのシーンを直接いじらない「データ+純粋な計算」の層。
// phase1.js(組み立て演出)・phase3.js(②③④演出)・zoom.js(数式ズーム)から共有される。

// ── キャリブレーション: なぜこれが要るか ────────────────────
// hamiltonian.png / hbar.png / i.png / derivative.png は、方程式全体の画像から
// シンボルごとに個別に切り抜かれたPNG。切り抜き時にキャンバスがグリフごとに
// タイトにトリミングされているため、4枚を単純に同じY座標へ並べると、
// 「文字としてのスケールは合っているのに、縦位置(ベースライン)だけズレる」問題が起きる。
//
// これを解決するため、方程式全体を写した1枚の元画像(S_equation-1.png、8000×3237px)から
// 各グリフの実際のバウンディングボックス(ピクセル座標)を計測した。
// 計測の結果、個別切り抜きPNGは元画像に対して常に約0.887倍の拡大率で書き出されている
// ことが確認できた(4シンボルとも誤差1%未満で一致)ので、この係数を使えば
// 「元画像上でのグリフ同士の相対位置」をそのまま個別PNGの配置に変換できる。
export const CROP_TO_MASTER_SCALE = 0.887; // 仮(実測値は0.883〜0.891、平均を採用)

// 元画像(S_equation-1.png)上での各グリフのバウンディングボックス [x0,y0,x1,y1](px、画像座標=Y下向き)
// 「=」の中心Yを基準線(baseline)として、他のシンボルはそこからの相対位置で配置する。
export const MASTER_BBOX = {
  i:           { bbox: [104,  1166, 495,  2159] },
  hbar:        { bbox: [728,  1112, 1453, 2159] },
  derivative:  { bbox: [1640, 89,   3495, 3183] }, // ∂ψ/∂t 分数全体
  equals:      { bbox: [4128, 1598, 5111, 1943] }, // ← 基準線はここ
  hamiltonian: { bbox: [5652, 776,  6892, 2143] },
  psiFinal:    { bbox: [6976, 1112, 7870, 2439] },
};
export const BASELINE_MASTER_Y = (MASTER_BBOX.equals.bbox[1] + MASTER_BBOX.equals.bbox[3]) / 2; // 1770.5

// 個別切り抜きPNG側のデータ(キャンバスサイズ + アルファのタイトbbox)。実測値。
export const SYMBOL_ASSETS = {
  hbar: {
    url: new URL('./data/hbar.png', import.meta.url).href,
    canvas: [865, 1266],
    alphaBbox: [24, 50, 842, 1225],
    master: MASTER_BBOX.hbar,
  },
  derivative: {
    url: new URL('./data/derivative.png', import.meta.url).href,
    canvas: [2226, 3671],
    alphaBbox: [55, 104, 2150, 3605],
    master: MASTER_BBOX.derivative,
  },
  hamiltonian: {
    url: new URL('./data/hamiltonian.png', import.meta.url).href,
    canvas: [1499, 1661],
    alphaBbox: [46, 59, 1449, 1603],
    master: MASTER_BBOX.hamiltonian,
  },
  psiFinal: {
    url: new URL('./data/psi.png', import.meta.url).href,
    canvas: [1198, 3671],
    alphaBbox: [38, 1269, 1046, 2766],
    master: MASTER_BBOX.psiFinal,
  },
  equals: {
    url: new URL('./data/equals.png', import.meta.url).href,
    canvas: [2085, 3671],
    alphaBbox: [497, 1814, 1606, 2203],
    master: MASTER_BBOX.equals,
  },
  i: {
    url: new URL('./data/i.png', import.meta.url).href,
    canvas: [585, 1302],
    alphaBbox: [65, 108, 504, 1228],
    master: MASTER_BBOX.i,
  },
};

// Three.jsのSpriteはテクスチャの中心(=キャンバス中心)をposition.yに置くため、
// キャンバスに余白があると、そのままでは意図した位置からズレる。ここで補正する。
export function contentCenterPx([x0, y0, x1, y1]) {
  return { x: (x0 + x1) / 2, y: (y0 + y1) / 2 };
}

// ── EQUATION_SCALE: 元画像の1pxを、ワールド空間で何ユニットにするか(仮・要調整) ──
export const EQUATION_SCALE = 0.00115; // (2026-08-16: 0.00115で確定とのご指定)

export function symbolWorldSize(symbolKey) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  return {
    width: asset.canvas[0] * scale,
    height: asset.canvas[1] * scale,
  };
}

// symbolKeyの「上下オフセット量」をスカラーで返す(=からの符号付き距離)。
// このスカラーに frame.up を掛けて足すことで、実際のワールド座標に変換する。
export function symbolWorldY(symbolKey, baseOffset = 0) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;

  const masterCenterY = contentCenterPx(asset.master.bbox).y;
  const targetOffset = (BASELINE_MASTER_Y - masterCenterY) * EQUATION_SCALE; // 画像は+Yが下なので符号反転

  const canvasCenterY = asset.canvas[1] / 2;
  const contentCenterY = contentCenterPx(asset.alphaBbox).y;
  const paddingCorrection = (contentCenterY - canvasCenterY) * scale;

  return baseOffset + targetOffset + paddingCorrection;
}

// symbolKeyの「左右オフセット量」をスカラーで返す(=からの符号付き距離)。
export function symbolWorldX(symbolKey, baseOffset = 0) {
  const asset = SYMBOL_ASSETS[symbolKey];
  const scale = EQUATION_SCALE * CROP_TO_MASTER_SCALE;
  const baselineMasterX = contentCenterPx(MASTER_BBOX.equals.bbox).x;

  const masterCenterX = contentCenterPx(asset.master.bbox).x;
  const targetOffset = (masterCenterX - baselineMasterX) * EQUATION_SCALE;

  const canvasCenterX = asset.canvas[0] / 2;
  const contentCenterX = contentCenterPx(asset.alphaBbox).x;
  const paddingCorrection = (contentCenterX - canvasCenterX) * scale;

  return baseOffset + targetOffset + paddingCorrection;
}

// ── 微調整用の手動オフセット(frame.right / frame.up 方向のスカラー)。──
// 「ほんの少し左上に」なら、そのシンボルのキーに小さめの負のx・正のyを入れる。
const SYMBOL_MANUAL_OFFSET = {
  psiFinal: { x: 0, y: 0 }, // 仮。必要なら調整してください
};

// symbolKeyの「ワールド空間での最終目標座標」を返す。
// vertexWorld: 頂点(=既存の緑いiのワールド座標)。
// frame: computeScreenFrame(camera) の戻り値。
export function symbolWorldPosition(symbolKey, vertexWorld, frame) {
  const manual = SYMBOL_MANUAL_OFFSET[symbolKey] ?? { x: 0, y: 0 };
  return vertexWorld.clone()
    .addScaledVector(frame.right, symbolWorldX(symbolKey, 0) + manual.x)
    .addScaledVector(frame.up, symbolWorldY(symbolKey, 0) + manual.y);
}

// ── 星→グリフ収束: PNGのアルファ情報から「文字の形をした点群」を作る ──────
const GLYPH_ALPHA_THRESHOLD = 80;
const GLYPH_SAMPLE_STEP = 2;
const GLYPH_MAX_POINTS = 6000;

const glyphPointsCache = {}; // symbolKey -> Promise<Array<{u:number, v:number}>>
// u,v は「そのシンボルの中心を(0,0)とした、幅・高さに対する比率」(-0.5〜0.5)。
// vは画像が+Y下向きなのに対しワールドのframe.upは上向きなので反転済み。

function sampleGlyphPoints(symbolKey) {
  if (glyphPointsCache[symbolKey]) return glyphPointsCache[symbolKey];
  const asset = SYMBOL_ASSETS[symbolKey];
  glyphPointsCache[symbolKey] = new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      let data;
      try {
        data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      } catch (err) {
        console.error(`sampleGlyphPoints(${symbolKey}): getImageData失敗`, err);
        resolve([]);
        return;
      }
      const { width, height } = canvas;
      const points = [];
      for (let y = 0; y < height; y += GLYPH_SAMPLE_STEP) {
        for (let x = 0; x < width; x += GLYPH_SAMPLE_STEP) {
          const alpha = data[(y * width + x) * 4 + 3];
          if (alpha > GLYPH_ALPHA_THRESHOLD) {
            points.push({ u: x / width - 0.5, v: 0.5 - y / height });
          }
        }
      }
      if (points.length > GLYPH_MAX_POINTS) {
        for (let i = points.length - 1; i > GLYPH_MAX_POINTS; i--) {
          const j = Math.floor(Math.random() * (i + 1));
          [points[i], points[j]] = [points[j], points[i]];
        }
        points.length = GLYPH_MAX_POINTS;
      }
      resolve(points);
    };
    img.onerror = (err) => {
      console.error(`sampleGlyphPoints(${symbolKey}): 画像読み込み失敗`, err);
      resolve([]);
    };
    img.src = asset.url;
  });
  return glyphPointsCache[symbolKey];
}

// symbolKeyの形をした「星の収束先」をワールド座標でcount個生成する。
// basePointWorld: そのシンボルの中心位置(ワールド座標。通常はsymbolWorldPosition()の結果)
// frame: computeScreenFrame(camera) の戻り値(right/upベクトルだけ使う)。
// ⚠ 以前あったcamera.localToWorld()の呼び出しは不要になった
// (=基準点も方向ベクトルも、最初からワールド空間の値をそのまま使っているため)。
export async function computeGlyphWorldPoints(symbolKey, { frame, basePointWorld, count }) {
  const points = await sampleGlyphPoints(symbolKey);
  if (points.length === 0) return [];
  const { width, height } = symbolWorldSize(symbolKey);
  const result = [];
  for (let i = 0; i < count; i++) {
    const p = points[Math.floor(Math.random() * points.length)];
    result.push(
      basePointWorld.clone()
        .addScaledVector(frame.right, p.u * width)
        .addScaledVector(frame.up, p.v * height)
    );
  }
  return result;
}

// TODO:
//   - STAR_CONVERGENCE の count/duration は仮値(phase1.js側)。
//   - GLYPH_SAMPLE_STEP / GLYPH_ALPHA_THRESHOLD も画像次第で調整が必要かもしれない。