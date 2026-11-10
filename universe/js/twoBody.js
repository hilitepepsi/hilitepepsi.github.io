// ══════════════════════════════════════════════════════════════
// twoBody.js — 冠(星)とバナナの「二体問題」だけを担う純粋な物理モジュール
//   (見た目・操作・状態遷移を担うthree.js側は fairyTale.js。ここは数値計算だけ)
//
//   ・three.js・描画・DOMに一切依存しない(数値計算のみ)。main.js / record.js などから呼ぶ想定。
//   ・座標は水面(銀河の面)上の2次元。x=横、y=奥(+yがカメラから遠い側)。原点=バナナ(重力源)。
//   ・仕様(ご指示):
//       - 水に関する要素(抵抗・減衰・時間による重力変化・強制捕獲・渦巻き演出)は一切入れない。比喩であり物理には含めない。
//       - 衝突判定(半径どうしの接触)は使わない。見るのは「二体の位置が重なったか」だけ。
//       - 重力場は水面(銀河)の半径Rまで及ぶ前提。場のスケールはRから決める(下記createField)。
//   ・理論上、点と点が重なるのは角運動量L≈0(中心へまっすぐ)の軌道だけ。普通に投げた軌道は
//     楕円か双曲線になり、重ならずに通り過ぎる。そのため「重なり許容tol」を狙いの許容幅として持つ。
//     (半径による当たり判定ではない。)
// ══════════════════════════════════════════════════════════════

export const FAIRY_DT = 1 / 240; // 基準の時間刻み[秒]。中心付近では自動でさらに細かくなる

// 場(フィールド)を水面半径Rから作る。
//   元設計は「穴の半径=20」で mu=24 → 長さ×K、速度×K、mu×K³(時間は不変)でスケールさせる。
//   mu ∝ R³ なので、水面の縁(r=R)での周回周期は常に約115秒で、Rを変えても軌道の形は変わらない。
export function createField(R, overlapRatio = 0.03) {
  const K = R / 20;
  return {
    R, K,
    mu: 24 * K * K * K,
    tol: overlapRatio * R,        // 「位置が重なった」とみなす距離(狙いの許容幅)
    eps2: 1e-6 * K * K,           // 数値発散を避けるだけの極小ソフトニング(物理的な意味はない)
    launchLimit: 5 * K,           // 引っ張れる長さの上限
    launchGain: 0.6,              // 引っ張った長さ→初速の係数
  };
}

// 加速度(ニュートン重力: 距離の2乗に反比例)
export function accel(x, y, f) {
  const q = f.mu / Math.pow(x * x + y * y + f.eps2, 1.5);
  return [-x * q, -y * q];
}

// 原点から線分(a→b)までの最短距離。1ステップで中心を飛び越える(すり抜ける)のを検出する。
export function segmentDistance(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
  let u = l2 > 0 ? -(ax * dx + ay * dy) / l2 : 0;
  u = Math.max(0, Math.min(1, u));
  return Math.hypot(ax + dx * u, ay + dy * u);
}

// 状態 s={x,y,vx,vy,t} をT秒ぶん進める(速度ベルレ法)。
//   中心に近いほど時間刻みを細かくする(落下時間 √(r³/mu) の2%)。1回の呼び出しで最大6000ステップ。
//   戻り値: 二体の位置が重なったらtrue(その時点で打ち切る)。onStepは1ステップごとのコールバック(軌跡の記録用)。
export function integrate(s, T, f, onStep) {
  let el = 0, n = 0;
  while (el < T && n++ < 6000) {
    const r = Math.hypot(s.x, s.y);
    const dt = Math.min(FAIRY_DT, 0.02 * Math.sqrt((r * r * r + 1e-9) / f.mu), T - el);
    const px = s.x, py = s.y;
    let [ax, ay] = accel(s.x, s.y, f);
    s.vx += ax * dt / 2; s.vy += ay * dt / 2;
    s.x += s.vx * dt; s.y += s.vy * dt;
    [ax, ay] = accel(s.x, s.y, f);
    s.vx += ax * dt / 2; s.vy += ay * dt / 2;
    el += dt; s.t = (s.t || 0) + dt;
    if (onStep) onStep(s);
    if (segmentDistance(px, py, s.x, s.y) < f.tol) return true;
  }
  return false;
}

// 引っ張り→初速。from=冠の開始位置、pointer=ポインタの場の座標。
//   slingshot=true : パチンコ式(引いた向きと逆へ飛ぶ)。
//   slingshot=false: ダイレクト式(ポインタの向きへそのまま飛ぶ=矢印の向きに投げる)。
export function launchVelocity(from, pointer, f, { slingshot = true } = {}) {
  const sgn = slingshot ? 1 : -1;
  let dx = sgn * (from.x - pointer.x), dy = sgn * (from.y - pointer.y), l = Math.hypot(dx, dy);
  if (l > f.launchLimit) { dx *= f.launchLimit / l; dy *= f.launchLimit / l; l = f.launchLimit; }
  return { vx: dx * f.launchGain, vy: dy * f.launchGain, l, lim: f.launchLimit };
}

// 予測線: 同じ積分で先まで進めた点列。hit=trueなら重なる軌道(戴冠成功の軌道)。
//   chunk=点を取る時間間隔[秒]、escapeRadius=場の半径の何倍で打ち切るか。
export function predictPath(start, f, { chunk = 0.5, maxChunks = 400, escapeRadius = 4 } = {}) {
  const s = { x: start.x, y: start.y, vx: start.vx, vy: start.vy, t: 0 };
  const pts = [];
  let hit = false;
  for (let n = 0; n < maxChunks && !hit; n++) {
    hit = integrate(s, chunk, f);
    pts.push({ x: s.x, y: s.y });
    if (Math.hypot(s.x, s.y) > f.R * escapeRadius) break;
  }
  return { pts, hit };
}

// 軌道の解析情報(投げる前の判定・HUD表示用)。
//   angularMomentum≈0 のときだけ中心へ落ちる。periapsis(近点距離)がtol以下なら重なる軌道になる。
export function orbitInfo(s, f) {
  const r = Math.hypot(s.x, s.y), v2 = s.vx * s.vx + s.vy * s.vy;
  const L = s.x * s.vy - s.y * s.vx;                 // 比角運動量
  const E = v2 / 2 - f.mu / r;                       // 比エネルギー
  const e = Math.sqrt(Math.max(0, 1 + 2 * E * L * L / (f.mu * f.mu))); // 離心率
  const periapsis = (L * L / f.mu) / (1 + e);
  const bound = E < 0;
  const period = bound ? 2 * Math.PI * Math.sqrt(Math.pow(-f.mu / (2 * E), 3) / f.mu) : Infinity;
  return { angularMomentum: L, energy: E, eccentricity: e, periapsis, bound, period, willOverlap: periapsis < f.tol };
}