// ── 方程式 iħ∂ψ/∂t = Ĥψ の組み立て演出(schrodinger-sequence-timeline.md 参照) ──
//
// 2026-08-16: ファイルが1500行超まで肥大化したため、役割ごとに分割した。
// このファイルは「窓口(バレル)」で、中身は各モジュールからのre-exportのみ。
// main.js 側の `import { ... } from './equationAssembly.js'` は変更不要。
//
//   screenFrame.js  … カメラ姿勢から画面基準ベクトル(right/up/forward)を取り出す幾何ユーティリティ
//   symbolAssets.js … 記号(Ĥ・ħ・∂ψ/∂t・i・=・ψ)のアセット定義とワールド空間配置計算(純粋関数・データ層)
//   captions.js     … 画面に流すセリフ・ワンフレーズのDOM制御(THREE非依存)
//   zoom.js         … 数式クリック時のカメラズーム
//   phase1.js       … ①(iħ∂ψ/∂t=Ĥψ)が組み上がるまでの演出・星の収束
//   phase3.js       … ②③④(カルーセル)の段階遷移演出
//
// ★ 設計方針(ワールド空間方式。camera.add方式からの全面書き直し):
// 記号も星(stars.js)も、**全部ワールド空間の同じ1つの座標系**に置く。カメラの子にはしない。
// カメラがどんな向きを向いていても、「画面の右」「画面の上」に対応するワールド方向ベクトルは、
// カメラのmatrixWorldの列から一度取り出すだけで求まる(computeScreenFrame参照)。これさえあれば、
//   位置 = 頂点(ワールド座標) + 右ベクトル×オフセット + 上ベクトル×オフセット
// という単純な足し算だけで、記号も星の収束先も同じ式で配置できる。

export { computeScreenFrame } from './screenFrame.js';

export {
  SYMBOL_ASSETS,
  EQUATION_SCALE,
  symbolWorldSize,
  symbolWorldY,
  symbolWorldX,
  symbolWorldPosition,
  computeGlyphWorldPoints,
} from './symbolAssets.js';

export {
  CAROUSEL_RESERVE_WORLD_WIDTH,
  computeEquationBounds,
  zoomToEquation,
} from './zoom.js';

export {
  STAR_CONVERGENCE,
  topAnchorCenter,
  SYMBOL_COLOR,
  createEquationAssembly,
  startPhase1,
} from './phase1.js';

export {
  PHASE3_ASSETS,
  PHASE3_SCALE,
  phase3SymbolWorldSize,
  createPhase3Assets,
  startPhase3,
} from './phase3.js';