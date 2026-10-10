import * as THREE from 'three';
import {
  STROKE_MAIN,
  STROKE_CROSSBAR_T,
  STROKE_CROSSBAR_H,
  segmentsToCurvePath,
  METAPHONY_VIEWBOX,
  METAPHONY_BASELINE_Y,
} from './metaphonyPath.js';

// ── ラッパ(発散らせん) → 間隔(小さなsin波) → Metaphony(2D筆記体) ─────────
//
// コンセプト: AXISWAVE(ラッパ=音を発する形)の中を振動(=文字)が通り抜けて
// 出てくる、という一連の視覚表現。
//
//   1) HORN      … 振幅が分数(有理関数)プロファイル r(u) = AMP_MAX・f(u) で
//                  発散していくらせん(u:0→1)。序盤ゆっくり広がり、終盤で急に開く。
//   2) GAP(sin波)… ラッパの先端とMetaphonyの間に間隔を取るための、
//                  ごく小さな振幅のsin波のつなぎ。ここから進行方向が
//                  LETTER_BEND_ANGLEだけ右へ曲がる。
//   3) LETTERS   … M→e→t→a→p→h→o→n→y の一筆書き(main)。GAPで曲がった
//                  向きのまま続く。
//   4) CROSSBARS … tとhの横線を、もう別々の形状として保持せず、1本の直線
//                  (始点と終点の2点だけ)として扱う、完全に独立した最後の
//                  ストローク。mainの終点(yの位置)から直接繋がる補完線は
//                  描かない(別のLineオブジェクトとして分離している)。
//                  groupA(HORN+GAP+LETTERS)が描き終わってからCROSSBAR_DELAY_SECONDS
//                  待ち、そこからCROSSBAR_DRAW_SECONDSかけて描く。
//
// 完成後の挙動: 両ストロークが描き終わってから DISAPPEAR_DELAY_SECONDS
// 経過すると、FADE_OUT_SECONDSかけて「進行軸の原点側から」線が消えていく
// (末端から縮むのではなく、始点側から順に消えるワイプ)。
// (update(elapsed)を毎フレーム呼び出してもらう前提。elapsedはシーン開始からの
//  経過秒数で、zAxisWave.jsのupdate(elapsed)と同じ単位)
//
// 実装方針: (HORN+GAP+LETTERS) を1本の連続ストローク(groupA)、
// (CROSSBAR_T+CROSSBAR_H) をもう1本の独立ストローク(groupB)として、
// それぞれ別のTHREE.Lineで持つ。reveal(t)はgroupAだけを弧長比率で伸ばし、
// groupBの遅延描画・両ストロークの消滅ワイプはupdate(elapsed)側の
// 経過時間で駆動する。
// ─────────────────────────────────────────────────────────────────

// ── HORN(ラッパ)パラメータ ──────────────────────────────────────────
const HORN_SAMPLES = 400;
const HORN_TURNS = 20;
// 発散のさせ方: 分数(有理関数) f(u) = k・u / (1 + (k-1)・u) で 0→1に正規化された
// プロファイルを作り、それにHORN_AMP_MAXを掛けて半径にする。
// k<1で「序盤ゆっくり・終盤に急上昇」になる(kが小さいほど終盤の立ち上がりが急)。
const HORN_FRAC_K = 0.12;
function hornRadiusProfile(u) {
  const k = HORN_FRAC_K;
  return (k * u) / (1 + (k - 1) * u);
}
const HORN_AMP_MAX = 30;
const HORN_TOTAL_LENGTH = 40; // 軸方向(進行方向)の全長
const HORN_SPIRAL_DIR = 1;      // らせんの回転方向。-1で逆回転

// ── GAP(ラッパ〜文字の間、小さなsin波) パラメータ ─────────────────────
const GAP_LENGTH = 24;         // 間隔の長さ(ワールド単位)。波数を変えずに波長を倍にするため、長さも倍にしている
const GAP_SINE_AMPLITUDE = 0.5; // 振幅を半分に
const GAP_SINE_CYCLES = 5;      // 間隔内での振動回数(波数)。変更なし
const GAP_SAMPLES = 60;

// ── LETTERS(Metaphony)パラメータ ────────────────────────────────────
// ラッパの振幅(HORN_AMP_MAX)から独立させた、固定の文字の高さ(ワールド単位)。
const LETTER_TARGET_HEIGHT = 13;
const LETTER_SCALE = LETTER_TARGET_HEIGHT / METAPHONY_VIEWBOX.height;
// sin波(GAP)より後ろの部分(LETTERS/CROSSBARS)を、letterUp軸周りに曲げる角度。
const LETTER_BEND_ANGLE = Math.PI / 4; // 45度
const LETTER_BEND_SIGN = -1; // 進行方向から見て左へ曲げる

// 関数全体(ラッパ・間隔のsin波・文字)を軸(growDir)周りに180度回転させるための符号。
// -1にすると、tipPoint自体が反対側(下側)に移動し、それに追従してgap/文字も
// 自然に下側から生えるようになる(一部だけを後からずらす、という不連続なことはしない)。
const ORIENTATION_SIGN = -1;

// 金色(ゴールド)系の黄色で統一。bloomを後付けする前提で、暗すぎない高輝度域を使う。
const GOLD_HUE = 0.135;
const GOLD_SATURATION = 0.85;
const _tmpColor = new THREE.Color();
function hornColor(u, out) {
  const lightness = THREE.MathUtils.lerp(0.28, 0.72, THREE.MathUtils.clamp(u, 0, 1));
  out.setHSL(GOLD_HUE, GOLD_SATURATION, lightness);
  return out;
}
const GAP_COLOR = new THREE.Color().setHSL(GOLD_HUE, GOLD_SATURATION, 0.72);
const LETTER_COLOR = new THREE.Color().setHSL(GOLD_HUE, GOLD_SATURATION, 0.72);

function buildRevealableLine(scene, points, colors) {
  const cumLength = new Float32Array(points.length);
  for (let i = 1; i < points.length; i++) {
    cumLength[i] = cumLength[i - 1] + points[i].distanceTo(points[i - 1]);
  }
  const totalLength = cumLength[cumLength.length - 1];

  const positions = new Float32Array(points.length * 3);
  const colorArr = new Float32Array(points.length * 3);
  for (let i = 0; i < points.length; i++) {
    positions[i * 3] = points[i].x;
    positions[i * 3 + 1] = points[i].y;
    positions[i * 3 + 2] = points[i].z;
    colorArr[i * 3] = colors[i].r;
    colorArr[i * 3 + 1] = colors[i].g;
    colorArr[i * 3 + 2] = colors[i].b;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colorArr, 3));
  geometry.setDrawRange(0, 0);

  const material = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 });
  const line = new THREE.Line(geometry, material);
  line.frustumCulled = false;
  line.visible = false;
  scene.add(line);

  // targetLengthに達するまでの頂点数(先頭からの弧長で数える)
  function countUpToLength(targetLength) {
    let lo = 0, hi = cumLength.length - 1;
    if (targetLength <= 0) return 0;
    if (targetLength >= totalLength) return cumLength.length;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (cumLength[mid] <= targetLength) lo = mid; else hi = mid - 1;
    }
    return lo + 1;
  }

  return { line, geometry, totalLength, countUpToLength };
}

export function createTrumpetToMetaphony(scene) {
  // 伸びる向き: 左から右(world +X)。realDir/imagDirはそれに直交する2方向(らせんの回転面)。
  const growDir = new THREE.Vector3(1, 0, 0);
  const realDir = new THREE.Vector3(0, 1, 0);
  const imagDir = new THREE.Vector3(0, 0, 1);

  // ① HORN
  const hornPoints = [];
  const hornColors = [];
  let tipPoint = null;
  let tipPhase = 0;
  for (let i = 0; i < HORN_SAMPLES; i++) {
    const u = i / (HORN_SAMPLES - 1);
    const radius = HORN_AMP_MAX * hornRadiusProfile(u);
    const phase = HORN_SPIRAL_DIR * HORN_TURNS * Math.PI * 2 * u;
    const p = growDir.clone().multiplyScalar(u * HORN_TOTAL_LENGTH)
      .addScaledVector(realDir, ORIENTATION_SIGN * radius * Math.cos(phase))
      .addScaledVector(imagDir, ORIENTATION_SIGN * radius * Math.sin(phase));
    hornPoints.push(p);
    hornColors.push(hornColor(u, _tmpColor).clone());
    if (i === HORN_SAMPLES - 1) {
      tipPoint = p;
      tipPhase = phase;
    }
  }

  // 先端(開口部の縁)での局所座標系: forward=軸方向のまま、up=その点の外向き半径方向
  // (HORNと同じORIENTATION_SIGNを使い、一貫して180度回転させる)
  const letterForward = growDir.clone();
  const letterUp = realDir.clone().multiplyScalar(ORIENTATION_SIGN * Math.cos(tipPhase))
    .addScaledVector(imagDir, ORIENTATION_SIGN * Math.sin(tipPhase))
    .normalize();

  // GAP(sin波)より後ろの部分すべて(GAP自体・LETTERS・CROSSBARS)に使う、
  // 45度曲げた進行方向。letterUp軸周りに回転させるので、上下(letterUp成分)は
  // 変えずに左右だけ振る。
  const letterForwardBent = letterForward.clone()
    .applyAxisAngle(letterUp, LETTER_BEND_SIGN * LETTER_BEND_ANGLE);

  // ② GAP: ラッパの先端から、小さなsin波でMetaphonyの開始点まで間隔を取る
  //    (GAPの時点からletterForwardBentを使い、ここで曲がり始める)
  const gapPoints = [];
  const gapColors = [];
  for (let i = 1; i < GAP_SAMPLES; i++) { // i=0(=tipPoint)は horn の最後の点と重複するので除く
    const u = i / (GAP_SAMPLES - 1);
    const p = tipPoint.clone()
      .addScaledVector(letterForwardBent, u * GAP_LENGTH)
      .addScaledVector(letterUp, GAP_SINE_AMPLITUDE * Math.sin(u * GAP_SINE_CYCLES * Math.PI * 2));
    gapPoints.push(p);
    gapColors.push(GAP_COLOR);
  }

  // Metaphonyの文字の原点(GAP分だけラッパの先端から離れた位置。曲げた後の方向を使う)
  const letterOrigin = tipPoint.clone().addScaledVector(letterForwardBent, GAP_LENGTH);

  function svgPointToWorld(x, y) {
    const forwardOffset = x * LETTER_SCALE;
    // 文字だけが上下逆さまになっていたため、letterUp方向はtipPoint/gapの位置決めに
    // そのまま使いつつ、文字のグリフだけ垂直方向を反転して読める向きに直す
    // (letterOrigin自体はforwardOffsetのみで決まるため、出現位置は変わらない)
    const verticalOffset = (y - METAPHONY_BASELINE_Y) * LETTER_SCALE;
    // sin波以降(LETTERS/CROSSBARS)は、曲げた進行方向(letterForwardBent)を使う
    return letterOrigin.clone()
      .addScaledVector(letterForwardBent, forwardOffset)
      .addScaledVector(letterUp, verticalOffset);
  }

  function sampleStrokeToWorld(segments) {
    const curvePath = segmentsToCurvePath(segments);
    const svgLength = curvePath.getLength();
    const sampleCount = Math.max(2, Math.round(svgLength * 0.6));
    return curvePath.getSpacedPoints(sampleCount).map((p2) => svgPointToWorld(p2.x, p2.y));
  }

  // ③ LETTERS(M〜yの一筆書き)
  const mainPoints = sampleStrokeToWorld(STROKE_MAIN);
  const mainColors = mainPoints.map(() => LETTER_COLOR);

  // groupA = HORN + GAP + LETTERS(main) をひとつの連続ストロークとして結合
  const groupAPoints = hornPoints.concat(gapPoints, mainPoints);
  const groupAColors = hornColors.concat(gapColors, mainColors);
  const groupA = buildRevealableLine(scene, groupAPoints, groupAColors);

  // ④ CROSSBARS: tの横線とhの横線を、もう分けずに「1本の直線」として扱う。
  // 実座標としてはtの横線の始点とhの横線の終点の2点だけを使うが、左から右へ
  // 滑らかにrevealできるよう、アニメーション用に間を等間隔に補間したサンプル
  // 点を生成する(形状としての情報量は2点のまま)。
  const CROSSBAR_SAMPLES = 40;
  const crossbarStartSvg = STROKE_CROSSBAR_T[0][0];
  const lastCrossbarHSeg = STROKE_CROSSBAR_H[STROKE_CROSSBAR_H.length - 1];
  const crossbarEndSvg = lastCrossbarHSeg[lastCrossbarHSeg.length - 1];
  const crossbarStartWorld = svgPointToWorld(crossbarStartSvg[0], crossbarStartSvg[1]);
  const crossbarEndWorld = svgPointToWorld(crossbarEndSvg[0], crossbarEndSvg[1]);
  const crossbarPoints = [];
  for (let i = 0; i < CROSSBAR_SAMPLES; i++) {
    const u = i / (CROSSBAR_SAMPLES - 1);
    crossbarPoints.push(crossbarStartWorld.clone().lerp(crossbarEndWorld, u));
  }
  const crossbarColors = crossbarPoints.map(() => LETTER_COLOR);
  const groupB = buildRevealableLine(scene, crossbarPoints, crossbarColors);

  // ── groupB(横線)の遅延描画、完成後の消滅ワイプのタイミング ──────────
  const CROSSBAR_DELAY_SECONDS = 2;   // groupA完成後、groupBを描き始めるまでの待ち時間
  const CROSSBAR_DRAW_SECONDS = 1;    // groupBを描くのにかける時間(仮の値。見ながら調整してください)
  const DISAPPEAR_DELAY_SECONDS = 10; // 両方描き終えてから、消え始めるまでの待ち時間(仮の値)
  const FADE_OUT_SECONDS = 2;         // 進行軸の原点側から消えていくのにかける時間
  const BASE_OPACITY = 0.95;

  let lastT = 0;
  let groupACompletedAt = null; // groupAが描き終わった(t>=1になった)elapsed
  let crossbarDoneAt = null;    // groupBまで描き終わったelapsed

  // reveal(t): t=0→1でgroupA(ラッパ→間隔→文字本体)だけを弧長比率で伸ばす。
  // groupB(t・hの横線)はここでは動かさず、update(elapsed)側の経過時間で
  // 「groupA完成からCROSSBAR_DELAY_SECONDS待ってから描き始める」を実現する。
  function reveal(t) {
    const clamped = THREE.MathUtils.clamp(t, 0, 1);
    lastT = clamped;

    const aLen = clamped * groupA.totalLength;
    groupA.line.visible = aLen > 0;
    groupA.geometry.setDrawRange(0, groupA.countUpToLength(aLen));

    if (clamped < 1) {
      // 巻き戻された場合は、groupB以降の状態も含めて全てリセットする
      groupACompletedAt = null;
      crossbarDoneAt = null;
      groupB.line.visible = false;
      groupB.geometry.setDrawRange(0, 0);
      groupA.line.material.opacity = BASE_OPACITY;
      groupB.line.material.opacity = BASE_OPACITY;
    }
  }

  function reset() {
    groupA.geometry.setDrawRange(0, 0);
    groupB.geometry.setDrawRange(0, 0);
    groupA.line.visible = false;
    groupB.line.visible = false;
    groupA.line.material.opacity = BASE_OPACITY;
    groupB.line.material.opacity = BASE_OPACITY;
    lastT = 0;
    groupACompletedAt = null;
    crossbarDoneAt = null;
  }

  // 進行軸(world X)の値が低い順に、groupA/groupBをまたいでまとめて数える。
  // pointsArr は先頭から見て概ね進行軸方向に単調増加している前提(horn/gap/
  // letters/crossbarいずれもその方向に生成しているため)。
  function countPointsBelowX(pointsArr, thresholdX) {
    for (let i = 0; i < pointsArr.length; i++) {
      if (pointsArr[i].x >= thresholdX) return i;
    }
    return pointsArr.length;
  }
  const allMinX = Math.min(groupAPoints[0].x, crossbarPoints[0].x);
  const allMaxX = Math.max(
    groupAPoints[groupAPoints.length - 1].x,
    crossbarPoints[crossbarPoints.length - 1].x
  );

  // update(elapsed): groupA完成後、
  //   1) CROSSBAR_DELAY_SECONDS待ってからgroupBをCROSSBAR_DRAW_SECONDSかけて描く
  //   2) 両方描き終えてからDISAPPEAR_DELAY_SECONDS待つ
  //   3) FADE_OUT_SECONDSかけて、groupA/groupBをまたいで進行軸の数値が低い順に
  //      まとめて消していく(横線だけ先に/後に消えるということはない)
  // elapsedはシーン開始からの経過秒数(zAxisWave.jsのupdate(elapsed)と同じ単位)を想定。
  function update(elapsed) {
    if (lastT < 1) return;
    if (groupACompletedAt === null) groupACompletedAt = elapsed;

    const sinceGroupA = elapsed - groupACompletedAt;

    if (crossbarDoneAt === null) {
      const drawT = THREE.MathUtils.clamp(
        (sinceGroupA - CROSSBAR_DELAY_SECONDS) / CROSSBAR_DRAW_SECONDS, 0, 1
      );
      const bLen = drawT * groupB.totalLength;
      groupB.line.visible = bLen > 0;
      groupB.geometry.setDrawRange(0, groupB.countUpToLength(bLen));
      if (drawT >= 1) crossbarDoneAt = elapsed;
      return;
    }

    const sinceComplete = elapsed - crossbarDoneAt;
    if (sinceComplete < DISAPPEAR_DELAY_SECONDS) return;

    // 進行軸の数値が低い方から、groupA・groupBを同じ基準(thresholdX)でまとめて消す
    const fadeT = THREE.MathUtils.clamp(
      (sinceComplete - DISAPPEAR_DELAY_SECONDS) / FADE_OUT_SECONDS, 0, 1
    );
    const thresholdX = THREE.MathUtils.lerp(allMinX, allMaxX, fadeT);

    const aStart = countPointsBelowX(groupAPoints, thresholdX);
    groupA.geometry.setDrawRange(aStart, Math.max(0, groupAPoints.length - aStart));

    const bStart = countPointsBelowX(crossbarPoints, thresholdX);
    groupB.geometry.setDrawRange(bStart, Math.max(0, crossbarPoints.length - bStart));

    if (fadeT >= 1) {
      groupA.line.visible = false;
      groupB.line.visible = false;
    }
  }

  // 外部(配置先のコード)が、この形状のローカル座標系を基準に向きを計算できるよう、
  // 主要な方向ベクトルを公開しておく。letterForward/letterUpはGAP(sin波)以降の
  // 進行方向・上方向(=文字面を張る2方向)。normalはその2方向から求めた文字面の法線
  // (このグループに回転がかかっていない状態でのローカル方向)。
  const localAxes = {
    forward: letterForwardBent.clone(),
    up: letterUp.clone(),
    normal: new THREE.Vector3().crossVectors(letterForwardBent, letterUp).normalize(),
  };

  // 配置確認など、2秒待ち・描画アニメーションを気にせず即座に全体を表示したいときに使う。
  // reveal/updateの遅延タイミングとは独立している。
  function showFull() {
    groupA.line.visible = true;
    groupA.geometry.setDrawRange(0, groupA.countUpToLength(groupA.totalLength));
    groupB.line.visible = true;
    groupB.geometry.setDrawRange(0, groupB.countUpToLength(groupB.totalLength));
  }

  return { lines: [groupA.line, groupB.line], reveal, reset, update, showFull, localAxes };
}