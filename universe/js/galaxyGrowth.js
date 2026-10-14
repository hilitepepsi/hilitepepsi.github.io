import * as THREE from 'three';
import {
  GALAXY_RADIUS, GALAXY_GROWTH_MAX_STEPS,
  setGalaxyGrowth, getGalaxyGrowingArms, getGalaxyArmPoint,
} from './galaxy.js';
import { createCaptionBox, makeCaptionController, getSourceCaption } from './captions.js';

// ══════════════════════════════════════════════════════════════
// ── 銀河の「育ち」演出: starburstをクリック → 音符がカメラ側から飛んできて、
//    銀河に着くと粒子に変わり、銀河の一部になる ──
// ══════════════════════════════════════════════════════════════
//
// 流れ(playGalaxyContribution):
//   1. 「I'm saving them.」を画面に出す(以後ずっと表示したまま)
//   2. 音符(♪♫♩♬)が、カメラのすぐ手前(視野の中のランダムな位置)から現れ、
//      今まさに育っている腕(galaxy.jsのgetGalaxyGrowingArms)の上の点へ飛んでいく
//   3. 銀河に着いた音符は、小さな粒子の群れに変わって散り(銀河と一緒に回る)、
//      同時に、その1個ぶんだけ銀河の粒子が増える(setGalaxyGrowth)
//   4. 全部の音符が着き終わると、育ち具合が1ステップ進んだ状態になる
// ★ 2026-10-11 変更(ご指示反映): 育ち具合(ステップ数)は「サイト全体の累計」。
//   訪問者の誰かがstarburstをクリックするたびに、サーバー(galaxy-counter-worker.js)の合計が
//   1増え、全員の銀河が同じ育ち具合になる。クリックの流れは:
//     クリック → サーバーへ「+1」を送って最新の合計を受け取る(最大API_TIMEOUT_MS待つ)
//             → その合計まで育つ演出を始める(他の人の分が増えていれば、その差ぶんも育つ)
//   サーバーが重複(同じIPが同じ日に2回目)と判断したときは、合計は増えず、演出だけ流れる。
//   GROWTH_API_URLが空、またはサーバーに繋がらないときは、この端末だけで育つ(localStorage)。
// ★ 2026-10-11 変更(ご指示反映): 「数万〜数十万規模のクリックで完成」への対応。
//   サーバーが持つのは「クリックの生の合計(count)」だけで、「何クリックで完成か」(CLICKS_TO_COMPLETE)は
//   このファイルで決める(あとから変えてもサーバーは触らなくてよい)。
//   無料枠で収めるため、サーバーへの問い合わせは必要最小限にしてある:
//     ・最新の合計の取得は、宇宙ページに入ったとき(refreshGalaxyGrowth)に1回だけ。さらに10分間はキャッシュ。
//     ・同じ端末は、同じ日(UTC)に2回目以降はサーバーへ送らない(演出だけ流れる)。
// ステップと腕・巻きの対応はgalaxy.jsの冒頭(GALAXY_GROWTH_*)を参照。
//
// 使い方(record.jsが呼ぶ):
//   createGalaxyGrowth(scene, galaxy, camera)  ... 1回。保存済みの育ちを銀河へ反映する
//   playGalaxyContribution(growth)             ... starburstをクリックしたとき
//   updateGalaxyGrowth(growth, deltaSeconds)   ... 毎フレーム
//   restoreSavingText(growth)                  ... starburstが登場したとき(過去にクリック済みなら文字を出す)

// サイト全体の累計を持つサーバー(galaxy-counter-worker.js)のURL。末尾の/は付けない。
// 例: 'https://galaxy-counter.your-subdomain.workers.dev'。空にすると、この端末だけで育つ。
const GROWTH_API_URL = '';
const API_TIMEOUT_MS = 1500; // クリック時、サーバーの返事を待つ最大時間。超えたらこの端末だけで育てる

// 「何クリックで銀河が完成するか」(腕9本+巻きが上限まで育ち切る=GALAXY_GROWTH_MAX_STEPS)。仮値。
// 目安: 想定する訪問数 × 「starburstまで辿り着いてクリックする人の割合」。
// 例: 20万訪問・半数がクリック → 10万。実際の数字を見ながら、あとから変えてよい。
const CLICKS_TO_COMPLETE = 100000;
// サーバーに繋がない(GROWTH_API_URLが空)ときの「1クリックの重さ」。確認用に、1クリック=1ステップ
// (腕3本の形成の1/10)にして、1回の演出で育ちが目に見えるようにしてある。
const LOCAL_PREVIEW_CLICKS_PER_STEP = 1;
const FETCH_CACHE_MINUTES = 10; // 最新の合計を取りに行く間隔の下限(この間は、最後に知っていた値を使う)

const STORAGE_KEY = 'galaxyGrowthSteps';       // 最後に知っていた「育ち具合」(サーバーに繋がらないとき・次回起動の初期表示用)
const CLICKED_KEY = 'galaxyGrowthEverClicked'; // この訪問者が、過去にstarburstをクリックしたことがあるか
const FETCHED_AT_KEY = 'galaxyGrowthFetchedAt'; // 最後にサーバーから合計を取った時刻(ミリ秒)
const LAST_CLICK_DAY_KEY = 'galaxyGrowthLastClickDay'; // 最後にサーバーへ送った日(UTCのYYYY-MM-DD)

const SAVING_TEXT = "I'm saving them.";
const SAVING_TEXT_TOP_PERCENT = 88; // 画面の上から何%の位置に出すか(仮値。戴冠のテキストは75)
const SAVING_WORK = 'J.D. Salinger — The Catcher in the Rye'; // 出典。文字と同じく、一度出したら出したまま
let savingWorkActive = false; // 出典を出している状態か(他の演出が共有の出典ボックスを使って消したあと、出し直すために覚えておく)

const CONTRIBUTIONS_PER_VISIT = 1;  // 1回の訪問で育てられる回数(2回目以降のクリックは何も起きない。仮値)

const NOTE_COUNT = 24;                          // 1回のクリックで飛ばす音符の数(仮値)
const NOTE_GLYPHS = ['♪', '♫', '♩', '♬'];
const NOTE_COLOR = 0xffe2a0;                    // 音符・粒子の色(仮値)
const NOTE_SIZE_FRACTION = 0.035;               // 音符の大きさ。着地点での「画面の高さ」に対する比率(仮値)
const NOTE_START_DISTANCE_RATIO = 0.35;         // カメラ→銀河の距離のうち、カメラ側からこの位置で現れる(0=カメラの目の前、1=銀河)
const NOTE_SPAWN_SPREAD_SECONDS = 1.6;          // 音符を出し始めてから出し終わるまで(秒)
const NOTE_FLIGHT_MIN_SECONDS = 5.4;            // 1個の音符が飛ぶのにかかる秒数の範囲
const NOTE_FLIGHT_MAX_SECONDS = 7.6;
const NOTE_ARC_RATIO = 0.15;                    // 軌道の膨らみ(画面の高さに対する最大比率)。0で一直線

const PUFF_PER_NOTE = 14;                       // 音符1個が変わる粒子の数
const PUFF_MAX = 1200;                          // 同時に存在できる粒子の上限(リングバッファ)
const PUFF_LIFE_SECONDS = 1.6;
const PUFF_SIZE_RATIO = 0.22;                   // 粒子1個の大きさ = 音符の大きさ × この比率
const PUFF_SPEED_RATIO = 0.8;                   // 散る速さ = 音符の大きさ × この比率(1秒あたり)

const STEP_SMOOTHING = 3.0;                     // 銀河の粒子が増えていく滑らかさ(大きいほど素早く追従)

// ── 保存 ─────────────────────────────────────
function loadSteps() {
  try {
    const value = Number(localStorage.getItem(STORAGE_KEY));
    return Number.isFinite(value) ? THREE.MathUtils.clamp(value, 0, GALAXY_GROWTH_MAX_STEPS) : 0;
  } catch (e) {
    return 0; // localStorageが使えない環境(プライベートモード等)では、毎回0から
  }
}

function saveSteps(steps) {
  try { localStorage.setItem(STORAGE_KEY, String(steps)); } catch (e) { /* 保存できなくても演出は続ける */ }
}

// 1クリックが育ちに与えるステップ数(クリックの合計→ステップ数の換算)。
function stepsPerClick() {
  return 1 / (GROWTH_API_URL ? CLICKS_TO_COMPLETE / GALAXY_GROWTH_MAX_STEPS : LOCAL_PREVIEW_CLICKS_PER_STEP);
}

function todayUtc() {
  return new Date().toISOString().slice(0, 10);
}

function readStored(key) {
  try { return localStorage.getItem(key); } catch (e) { return null; }
}

function writeStored(key, value) {
  try { localStorage.setItem(key, String(value)); } catch (e) { /* 何もしない */ }
}

function hasEverClicked() {
  try { return localStorage.getItem(CLICKED_KEY) === '1'; } catch (e) { return false; }
}

function markClicked() {
  try { localStorage.setItem(CLICKED_KEY, '1'); } catch (e) { /* 何もしない */ }
}

// ── サーバーとのやりとり ──────────────────────────
// サーバーの仕様(galaxy-counter-worker.js):
//   GET  {URL}/count       → { count }               いままでのクリックの合計
//   POST {URL}/contribute  → { count, counted }      +1して最新の合計を返す(重複ならcounted=false・合計は据え置き)
// 返ってきたcountは、stepsPerClick()を掛けて「育ちのステップ数」に換算して使う。
async function callApi(path, method) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), API_TIMEOUT_MS);
  try {
    const response = await fetch(GROWTH_API_URL + path, { method, signal: controller.signal });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const data = await response.json();
    if (!Number.isFinite(Number(data.count))) throw new Error('不正な応答');
    return {
      steps: THREE.MathUtils.clamp(Number(data.count) * stepsPerClick(), 0, GALAXY_GROWTH_MAX_STEPS),
      counted: data.counted,
    };
  } finally {
    clearTimeout(timer);
  }
}

// ── 音符のテクスチャ(文字をCanvasに描いただけ。画像ファイルは不要) ──
function makeNoteTexture(glyph) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.font = '96px serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(255, 220, 150, 0.9)';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#ffffff';
  ctx.fillText(glyph, 64, 70);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// ── 音符が変わる粒子(銀河の子なので、銀河と一緒に回る。ローカル座標で動かす) ──
function createPuff(galaxy) {
  const positions = new Float32Array(PUFF_MAX * 3);
  const colors = new Float32Array(PUFF_MAX * 3); // 加算合成なので、色を黒へ近づけて消す
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const material = new THREE.PointsMaterial({
    size: 1, sizeAttenuation: true, vertexColors: true,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.frustumCulled = false; // 位置が動き続けるので、境界球での判定はさせない
  points.raycast = () => {};
  galaxy.starsGroup.add(points);
  return {
    points, positions, colors,
    velocities: new Float32Array(PUFF_MAX * 3),
    ages: new Float32Array(PUFF_MAX).fill(Infinity), // Infinity=未使用
    cursor: 0,
    baseColor: new THREE.Color(NOTE_COLOR),
  };
}

export function createGalaxyGrowth(scene, galaxy, camera) {
  const steps = loadSteps(); // まず「最後に知っていた育ち」で表示しておき、サーバーの最新値が届いたら置き換える
  setGalaxyGrowth(galaxy, steps);
  const growth = {
    scene, galaxy, camera,
    committedSteps: steps,   // 確定している育ち(サーバーの合計、またはこの端末だけの値)
    targetSteps: steps,      // 音符が着くたびに増える、見た目の目標
    shownSteps: steps,       // 実際に銀河へ反映しているステップ数(目標へ滑らかに追従)
    contributionsThisVisit: 0,
    contributing: false,     // クリックしてから、音符が飛び始めるまでの間(サーバーの返事待ち)
    elapsed: 0,
    notes: [],
    textures: NOTE_GLYPHS.map(makeNoteTexture),
    puff: createPuff(galaxy),
    savingCaption: null,
  };
  return growth;
}

// サーバーの最新の合計を取ってきて、銀河へ反映する(銀河はまだ表示前なので、即座に切り替えてよい)。
// record.jsが、宇宙ページに入った瞬間(startRecordDisplay)に1回だけ呼ぶ。ページを開いただけで
// 宇宙ページまで来ない人は、サーバーを一切使わない。FETCH_CACHE_MINUTES以内に取得済みなら取りに行かない。
export function refreshGalaxyGrowth(growth) {
  if (!growth || !GROWTH_API_URL) return;
  const fetchedAt = Number(readStored(FETCHED_AT_KEY));
  if (Number.isFinite(fetchedAt) && Date.now() - fetchedAt < FETCH_CACHE_MINUTES * 60 * 1000) return;
  callApi('/count', 'GET').then(({ steps }) => {
    writeStored(FETCHED_AT_KEY, Date.now());
    growth.committedSteps = steps;
    saveSteps(steps);
    if (growth.contributing || growth.notes.length > 0) return; // 演出中は触らない(演出の終わりで合わせる)
    growth.targetSteps = growth.shownSteps = steps;
    setGalaxyGrowth(growth.galaxy, steps);
  }).catch((e) => console.warn('[galaxyGrowth] 最新の育ちを取得できませんでした(最後に知っていた値で表示します):', e));
}

// ── 「I'm saving them.」(一度出したら消さない) ──
function showSavingText(growth) {
  if (!growth.savingCaption) {
    growth.savingCaption = makeCaptionController(
      createCaptionBox({ leftPercent: 50, topPercent: SAVING_TEXT_TOP_PERCENT, noWrap: true })
    );
  }
  growth.savingCaption.setText(SAVING_TEXT);
  savingWorkActive = true;
  getSourceCaption().setText(SAVING_WORK);
}

// 共有の出典ボックス(右下)を他の演出が使って消えてしまったとき、出典を出し直す。
// (「I'm saving them.」を出している間だけ有効。出していなければ何もしない)
export function reapplySavingWork() {
  if (savingWorkActive) getSourceCaption().setText(SAVING_WORK);
}

// ★ 2026-10-14 変更(ご指示反映): 文の出現タイミングは「starburstをクリックしたとき」のみにした。
//   そのため、starburstの登場(トーンアームを置いた直後)では呼ばなくなった(record.jsから呼び出しを外した)。
//   この関数自体は残してあるが、今は使っていない。
// この訪問者が過去にクリック済みなら、文字を出し直す。
// (サイト全体の累計が1以上でも、まだクリックしていない人には出さない)
export function restoreSavingText(growth) {
  if (growth && hasEverClicked()) showSavingText(growth);
}

// ── 音符を飛ばす ───────────────────────────────
const _center = new THREE.Vector3();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _world = new THREE.Vector3();
const _ndc = new THREE.Vector3();

// 画面に映っている腕の上の点を選ぶ(カメラが銀河のごく一部しか映さない構図でも、
// 画面の外に着いてしまわないように)。見つからなければ画面の中心に最も近い点。
function pickTarget(growth, arms, out) {
  const { galaxy, camera } = growth;
  let best = null;
  let bestScore = Infinity;
  const candidate = new THREE.Vector3();
  for (let tries = 0; tries < 40; tries++) {
    const arm = arms[Math.floor(Math.random() * arms.length)];
    const ratio = 0.15 + 0.85 * Math.sqrt(Math.random());
    getGalaxyArmPoint(galaxy, arm, ratio, candidate);
    candidate.x += (Math.random() - 0.5) * GALAXY_RADIUS * 0.03;
    candidate.z += (Math.random() - 0.5) * GALAXY_RADIUS * 0.03;
    galaxy.starsGroup.localToWorld(_world.copy(candidate));
    _ndc.copy(_world).project(camera);
    const score = _ndc.z > 1 ? Infinity : Math.max(Math.abs(_ndc.x), Math.abs(_ndc.y));
    if (score < 0.85) return out.copy(candidate);
    if (score < bestScore) { bestScore = score; best = candidate.clone(); }
  }
  return out.copy(best || candidate);
}

function spawnNotes(growth, previousSteps) {
  const { camera, galaxy, scene } = growth;
  const arms = getGalaxyGrowingArms(previousSteps);
  galaxy.starsGroup.getWorldPosition(_center);
  const distance = camera.position.distanceTo(_center);
  const tanHalfFov = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const visibleHeight = 2 * distance * tanHalfFov;      // 銀河の距離で画面に映る高さ
  const noteSize = visibleHeight * NOTE_SIZE_FRACTION;  // 着地点での大きさがこの比率になる
  growth.noteSize = noteSize;
  growth.puff.points.material.size = noteSize * PUFF_SIZE_RATIO;

  camera.updateMatrixWorld();
  _right.setFromMatrixColumn(camera.matrixWorld, 0);
  _up.setFromMatrixColumn(camera.matrixWorld, 1);
  _forward.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  const startDistance = distance * NOTE_START_DISTANCE_RATIO;
  const halfHeight = startDistance * tanHalfFov;
  const halfWidth = halfHeight * camera.aspect;

  growth.stepGainPerNote = (growth.committedSteps - previousSteps) / NOTE_COUNT;
  for (let i = 0; i < NOTE_COUNT; i++) {
    const material = new THREE.SpriteMaterial({
      map: growth.textures[i % growth.textures.length],
      color: NOTE_COLOR, transparent: true, opacity: 0,
      depthTest: false, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(noteSize, noteSize, 1);
    sprite.renderOrder = 10;
    sprite.visible = false;
    scene.add(sprite);

    const start = new THREE.Vector3().copy(camera.position)
      .addScaledVector(_forward, startDistance)
      .addScaledVector(_right, (Math.random() * 2 - 1) * 0.9 * halfWidth)
      .addScaledVector(_up, (Math.random() * 2 - 1) * 0.9 * halfHeight);
    const targetLocal = pickTarget(growth, arms, new THREE.Vector3());
    // 軌道の膨らみは、画面の中で見える向き(上下左右)に付ける。
    const arcDirection = new THREE.Vector3()
      .addScaledVector(_right, Math.random() * 2 - 1)
      .addScaledVector(_up, Math.random() * 2 - 1);

    growth.notes.push({
      sprite, start, targetLocal, arcDirection,
      arcSize: visibleHeight * NOTE_ARC_RATIO * Math.random(),
      delay: (i / NOTE_COUNT) * NOTE_SPAWN_SPREAD_SECONDS,
      duration: THREE.MathUtils.lerp(NOTE_FLIGHT_MIN_SECONDS, NOTE_FLIGHT_MAX_SECONDS, Math.random()),
      t: 0,
      seed: Math.random() * Math.PI * 2,
    });
  }
}

// 音符が銀河に着いた: その場で粒子の群れに変わり、銀河の粒子が1個ぶん増える。
function convertNoteToParticles(growth, note) {
  const puff = growth.puff;
  const scale = growth.galaxy.starsGroup.scale.x || 1; // 銀河は拡大されているので、ローカルの速度はその分小さく
  const speed = (growth.noteSize * PUFF_SPEED_RATIO) / scale;
  for (let n = 0; n < PUFF_PER_NOTE; n++) {
    const i = puff.cursor;
    puff.cursor = (puff.cursor + 1) % PUFF_MAX;
    puff.positions[i * 3] = note.targetLocal.x;
    puff.positions[i * 3 + 1] = note.targetLocal.y;
    puff.positions[i * 3 + 2] = note.targetLocal.z;
    const theta = Math.random() * Math.PI * 2;
    const flat = Math.random() * 2 - 1;                // 銀河は薄い円盤なので、上下には広がりすぎないようにする
    const ring = Math.sqrt(1 - flat * flat);
    const v = speed * (0.3 + Math.random() * 0.7);
    puff.velocities[i * 3] = Math.cos(theta) * ring * v;
    puff.velocities[i * 3 + 1] = flat * v * 0.3;
    puff.velocities[i * 3 + 2] = Math.sin(theta) * ring * v;
    puff.ages[i] = 0;
  }
  growth.targetSteps += growth.stepGainPerNote;
}

function disposeNote(growth, note) {
  growth.scene.remove(note.sprite);
  note.sprite.material.dispose(); // テクスチャは使い回しているので、マテリアルだけ破棄
}

function updateNotes(growth, deltaSeconds) {
  for (let i = growth.notes.length - 1; i >= 0; i--) {
    const note = growth.notes[i];
    note.t += deltaSeconds;
    const k = (note.t - note.delay) / note.duration;
    if (k < 0) continue; // まだ出番ではない
    if (k >= 1) {
      convertNoteToParticles(growth, note);
      disposeNote(growth, note);
      growth.notes.splice(i, 1);
      continue;
    }
    // 着地点は銀河の自転に合わせて動くので、毎フレーム、ローカル座標からワールドへ求め直す。
    growth.galaxy.starsGroup.localToWorld(_world.copy(note.targetLocal));
    const eased = k * k * (3 - 2 * k);
    note.sprite.position.lerpVectors(note.start, _world, eased)
      .addScaledVector(note.arcDirection, Math.sin(Math.PI * k) * note.arcSize);
    note.sprite.visible = true;
    note.sprite.material.opacity = Math.min(k / 0.12, 1); // 出始めはふわっと
    note.sprite.material.rotation = Math.sin(growth.elapsed * 3 + note.seed) * 0.35;
  }
  // 全部着き終わったら、目標を保存済みの値にぴったり合わせる(浮動小数の誤差を残さない)
  if (growth.notes.length === 0) growth.targetSteps = growth.committedSteps;
}

function updatePuff(growth, deltaSeconds) {
  const puff = growth.puff;
  let changed = false;
  for (let i = 0; i < PUFF_MAX; i++) {
    if (puff.ages[i] === Infinity) continue;
    changed = true;
    puff.ages[i] += deltaSeconds;
    if (puff.ages[i] >= PUFF_LIFE_SECONDS) {
      puff.ages[i] = Infinity;
      puff.colors[i * 3] = puff.colors[i * 3 + 1] = puff.colors[i * 3 + 2] = 0;
      continue;
    }
    puff.positions[i * 3] += puff.velocities[i * 3] * deltaSeconds;
    puff.positions[i * 3 + 1] += puff.velocities[i * 3 + 1] * deltaSeconds;
    puff.positions[i * 3 + 2] += puff.velocities[i * 3 + 2] * deltaSeconds;
    const fade = Math.pow(1 - puff.ages[i] / PUFF_LIFE_SECONDS, 2);
    puff.colors[i * 3] = puff.baseColor.r * fade;
    puff.colors[i * 3 + 1] = puff.baseColor.g * fade;
    puff.colors[i * 3 + 2] = puff.baseColor.b * fade;
  }
  if (changed) {
    puff.points.geometry.attributes.position.needsUpdate = true;
    puff.points.geometry.attributes.color.needsUpdate = true;
  }
}

// ── クリックされたとき ──────────────────────────
// 今回の分を送り、サイト全体の最新の合計を受け取る。サーバーが使えなければこの端末だけで+1する。
async function requestContribution(growth, previousSteps) {
  const localNext = Math.min(previousSteps + stepsPerClick(), GALAXY_GROWTH_MAX_STEPS);
  if (!GROWTH_API_URL) return localNext;
  // 同じ端末は、同じ日(UTC)に2回目以降はサーバーへ送らない(サーバーも同じIPの2回目は数えないので、無駄な通信になる)。
  // 合計は据え置きで、演出だけ流れる。
  if (readStored(LAST_CLICK_DAY_KEY) === todayUtc()) return previousSteps;
  try {
    const { steps } = await callApi('/contribute', 'POST');
    writeStored(LAST_CLICK_DAY_KEY, todayUtc());
    writeStored(FETCHED_AT_KEY, Date.now()); // 返ってきた合計は最新なので、取得済みとして扱う
    return steps;
  } catch (e) {
    console.warn('[galaxyGrowth] サーバーへ送れませんでした。この端末だけで育てます:', e);
    return localNext;
  }
}

// 戻り値: 受け付けたらtrue(今回の訪問で育てられる回数を使い切っていたらfalse)。
// 文字はすぐ出し、音符はサーバーの返事(最大API_TIMEOUT_MS)を待ってから飛ばす。
export function playGalaxyContribution(growth) {
  if (!growth || growth.contributionsThisVisit >= CONTRIBUTIONS_PER_VISIT) return false;
  growth.contributionsThisVisit++;
  growth.contributing = true;
  markClicked();
  showSavingText(growth);

  const previousSteps = growth.committedSteps;
  requestContribution(growth, previousSteps).then((newSteps) => {
    growth.committedSteps = newSteps; // サイト全体の最新の合計(他の人の分が増えていれば、その差も一緒に育つ)
    saveSteps(newSteps);
    growth.targetSteps = previousSteps; // 音符が着くたびに、ここから少しずつ増える
    spawnNotes(growth, previousSteps);
    growth.contributing = false;
  });
  return true;
}

// 開発用: 育ちを最初(腕3本)に戻す。ブラウザのコンソールなどから呼ぶ想定。
export function resetGalaxyGrowth(growth) {
  // 育ち具合だけでなく、クリック済みフラグ・サーバー取得時刻・最後に送った日も消して、まっさらに戻す
  // (残しておくと、サーバーに繋いだ状態で「今日はもう送った」扱いになり、テストで送れなくなる)。
  [STORAGE_KEY, CLICKED_KEY, FETCHED_AT_KEY, LAST_CLICK_DAY_KEY].forEach((key) => {
    try { localStorage.removeItem(key); } catch (e) { /* 何もしない */ }
  });
  growth.savingCaption?.hide();
  if (savingWorkActive) { savingWorkActive = false; getSourceCaption().hide(); }
  growth.notes.forEach((note) => disposeNote(growth, note));
  growth.notes.length = 0;
  growth.committedSteps = growth.targetSteps = growth.shownSteps = 0;
  growth.contributionsThisVisit = 0;
  setGalaxyGrowth(growth.galaxy, 0);
}

// ── 毎フレーム ──────────────────────────────
export function updateGalaxyGrowth(growth, deltaSeconds) {
  if (!growth) return;
  growth.elapsed += deltaSeconds;
  updateNotes(growth, deltaSeconds);
  updatePuff(growth, deltaSeconds);

  // 銀河の粒子の数・巻きは、目標へ滑らかに追従させる(音符が着くたびに、少しずつ増える)。
  if (growth.shownSteps !== growth.targetSteps) {
    const follow = 1 - Math.exp(-STEP_SMOOTHING * deltaSeconds);
    growth.shownSteps += (growth.targetSteps - growth.shownSteps) * follow;
    if (Math.abs(growth.targetSteps - growth.shownSteps) < 1e-4) growth.shownSteps = growth.targetSteps;
    setGalaxyGrowth(growth.galaxy, growth.shownSteps);
  }
}