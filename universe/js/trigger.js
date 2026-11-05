import * as THREE from 'three';
import { createCaptionBox, makeCaptionController, createKoanBox, updateKoanScreenPosition, getSourceCaption } from './captions.js';
 
// ── フィナーレの星:(300,300,300)、緑 ─────────────
// hotspots.js の星とは別枠(1回クリックのみ・専用の演出)なので、
// main.js 側では hotspotMeshes とは別のオブジェクトとしてレイキャストする。
export const TRIGGER_STAR_POS = new THREE.Vector3(50, 50, 50); //(300,300,300)
const TRIGGER_COLOR = 0x39ff8c; // 隠しiボタンと同じ緑(#39ff8c)
const STAR_HIT_RADIUS = 16;    // hotspots.js の HOTSPOT_HIT_RADIUS と同スケール
 
// ── 線A移動中に順番に切り替える短い引用。中身は仮。後で差し替え前提 ──
// 文字列のままならQUOTE_INTERVAL(秒)で一定間隔表示(従来通り)。
// 個別に表示時間を変えたい行だけ captions.js の CONVERGENCE_QUOTES 等と同じ書き方で
// { text: '...', duration: 秒数 } にする。
const TRIGGER_QUOTES = ['the poems written all over the finger and pocket and everywhere. In green Ink. he’d have something to read when he was in the field and nobody was up at bat.',
                       'Anyway, that’s what I wrote stradlater’s composition about.','It was a very descriptive subject. … Allie had this left-handed fielder’s mitt.',
                       'All I had to do was change Allie’s name so that nobody would know it was my brother',
                       'I slept in the garage the night he died, and I broke all the goddam windows with my fist,',
                       {text: 'My hand still hurts me once in a while, when it rains and all, and I can’t make a real fist any more — not a tight one', duration: 10},''

];
const QUOTE_INTERVAL =5; // 1行あたりのデフォルト表示秒数(仮)

// 出典: フィナーレの引用はすべてThe Catcher in the Rye(著者は常にJ.D. Salinger)
const TRIGGER_WORK = 'The Catcher in the Rye';

// captions.js の startQuoteSequence と同じ正規化: 文字列 or {text, duration} を
// 常に {text, duration} の形へ揃えておく。
function normalizeTriggerQuotes(quotes, defaultDuration) {
  return quotes.map((q) =>
    typeof q === 'string'
      ? { text: q, duration: defaultDuration }
      : { text: q.text, duration: q.duration ?? defaultDuration }
  );
}
const NORMALIZED_TRIGGER_QUOTES = normalizeTriggerQuotes(TRIGGER_QUOTES, QUOTE_INTERVAL);
 
// ── 原点通過後に表示する公案 ──
const KOAN_TEXT = '*We know the sound of two hands clapping.\nBut what is the sound of one hand clapping?*';
// 公案の出典: Nine Storiesのエピグラフ。引用の出典(TRIGGER_WORK)と同じ右下の共有出典ボックスに出す。
const KOAN_WORK = 'Nine Stories (epigraph)';
 
// ── 演出パラメータ(すべて仮値。実際に見ながら調整する前提) ──
const WAIT_BEFORE_GROW = 3.0;       // クリック直後、最寄り点への合流アニメが終わってからの待機
const SNAP_DURATION = 1.6;          // 星クリック直後、カメラが線A上の最寄り点へ寄っていく時間
const LINE_GROW_DURATION = 3.0;     // 線Aが星→原点へ伸びる時間
const FULL_TRAVEL_DURATION = 30.0;  // 星の実位置からのフル距離を移動する場合の合計秒数
const Y_AXIS_TRAVEL_DURATION = 6.0; // 原点 → 次の目的地への移動時間
 
const ORIGIN = new THREE.Vector3(0, 0, 0);
// Y軸の実終端(18,0,0)ではなく、軸から外れた固定点(仮値・要調整)。
 export const TRIGGER_DEST = new THREE.Vector3(29, -10, -10); //(30-10-10)

// 視線が線A/軸そのものと一致する(edge-on:線が点に潰れて見えなくなる)のを避けるため、
// 狙う点は原点そのものではなく、少しずらした固定点にする。線A〜原点到達まではこちらを見る。
const TRIGGER_LOOK_TARGET = new THREE.Vector3(-1, -1, -1);
// 原点通過後、TRIGGER_DESTへ向かう間はこちらを見る。
export const TRIGGER_DEST_LOOK_TARGET = new THREE.Vector3(3, 3, 3);
 
// 画面の「下」に見せたい向き(概念Y軸 = world +X)。upはこれを毎フレーム
// 視線方向から直交化して求める(下のcomputeUp参照)ので、固定のup定数は持たない。
const DOWN_REF = new THREE.Vector3(1, 0, 0);
 
// 視線方向(forward)から、DOWN_REFがなるべく画面下に来るようなupを都度計算する。
// axisCamera.js の getAxisStationView と同じ考え方(Gram-Schmidtで直交成分を取り出す)。
// forwardとDOWN_REFがたまたまほぼ平行(直交成分がほぼ0)になる瞬間だけ、
// world up(0,1,0)にフォールバックすることで、upとforwardが平行になって
// カメラ姿勢が縮退する(=映像が破綻する)事態を構造的に防ぐ。
export function computeUp(forward) {
  const f = forward.clone().normalize();
  const alongForward = f.clone().multiplyScalar(DOWN_REF.dot(f));
  const perp = DOWN_REF.clone().sub(alongForward); // DOWN_REFのうち、forward成分を除いた残り
  if (perp.lengthSq() < 1e-6) {
    return new THREE.Vector3(0, 1, 0); // ほぼ平行だった場合のフォールバック
  }
  return perp.negate().normalize(); // 「down」の逆 = up
}
 
export function createTrigger(scene) {
  // ── 星本体 ──
  const star = new THREE.Mesh(
    new THREE.SphereGeometry(0.35, 12, 12),
    new THREE.MeshBasicMaterial({ color: TRIGGER_COLOR })
  );
  star.position.copy(TRIGGER_STAR_POS);
  star.userData.isTriggerStar = true;
 
  // クリック判定専用の透明な大きい球(hotspots.js / axisStationOverlay.js と同じ方式)
  const hitArea = new THREE.Mesh(
    new THREE.SphereGeometry(STAR_HIT_RADIUS, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
  );
  star.add(hitArea);
  scene.add(star);
 
  // ── 線A(星→原点)。growLineで伸ばすまでは非表示・長さ0 ──
  const lineAGeo = new THREE.BufferGeometry().setFromPoints([
    TRIGGER_STAR_POS.clone(),
    TRIGGER_STAR_POS.clone(),
  ]);
  const lineA = new THREE.Line(lineAGeo, new THREE.LineBasicMaterial({ color: TRIGGER_COLOR }));
  lineA.visible = false;
  lineA.frustumCulled = false; // axes.js の xAxis と同じ理由(頂点を毎フレーム書き換えるため)
  scene.add(lineA);
 
  function setLineAEnd(point) {
    const posAttr = lineA.geometry.attributes.position;
    posAttr.setXYZ(1, point.x, point.y, point.z);
    posAttr.needsUpdate = true;
    lineA.geometry.computeBoundingSphere();
  }
 
  // ── 原点付近で自動フェードインする「i」(隠しiボタンとは別インスタンス)。
  //    今後main.js側でクリックを拾えるよう isTriggerIcon フラグを立てておく
  //    (trigger.starのuserData.isTriggerStarと同じ考え方。main.js側のクリックハンドラで
  //    trigger.js の handleIconClick() を呼び出す想定)。 ──
  const iTexture = new THREE.TextureLoader().load(new URL('./data/eq/i-icon.png', import.meta.url).href);
  iTexture.colorSpace = THREE.SRGBColorSpace;
  const iSprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: iTexture,
    transparent: true,
    depthWrite: false,
    opacity: 0,
  }));
  const I_WORLD_WIDTH = 0.45;
  iSprite.scale.set(I_WORLD_WIDTH, I_WORLD_WIDTH * (762 / 300), 1);
  iSprite.position.set(-1, -1, -1);
  iSprite.visible = false;
  iSprite.userData.isTriggerIcon = true;
  scene.add(iSprite);

  // ── クリック判定専用の当たり判定(見た目のiSpriteとは別)。 ──
  // hotspots.js / axisStationOverlay.js と同じ理由・同じ方式:
  // 見た目のサイズ(I_WORLD_WIDTH=0.45)のままだと、特にカメラがTRIGGER_DESTへ
  // 離れていくにつれ画面上でどんどん小さくなり、実質クリックできなくなる。
  // material.visible=falseだと環境によってraycastが拾わないことがあるため、
  // ここでも「visible=trueのまま、ほぼ完全に透明(opacity限りなく0)」の
  // 実績のある方式にする。
  // 注意: iSpriteはSpriteでscale(0.45×1.14)がローカル座標系にかかるため、
  // 子にすると半径がその倍率の影響を受けてしまう。ここでは子にせず、
  // iSpriteと同じワールド位置に独立したMeshとして置き、表示切り替えのたびに
  // 手動で位置・visibleを同期させる。
  const I_HIT_RADIUS = 1.4; // 仮。axisStationOverlayのI_HIT_RADIUS(0.70)よりだいぶ広め
                             // (iSpriteはTRIGGER_DESTへ離れていく間ずっとクリックできてほしいため)
  const iHitArea = new THREE.Mesh(
    new THREE.SphereGeometry(I_HIT_RADIUS, 12, 12),
    new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
  );
  iHitArea.position.copy(iSprite.position);
  iHitArea.visible = false; // iSpriteのvisible/opacityフェードと合わせてmain.js側で切り替える
  scene.add(iHitArea);
 
  // ── 公案テキスト用の3D固定アンカー((-2,-2,-2))。以前と同じ、この点に追従して表示する ──
  const koanAnchor = new THREE.Object3D();
  koanAnchor.position.set(-2, -2, -2);
  scene.add(koanAnchor);
 
  // ── フィナーレ専用のセリフ表示(dialogue.js は流用せず、captions.js の
  //    汎用コントローラーを使う)。 ──
  // 引用(TRIGGER_QUOTES)は画面を四分割した右上ブロックの中央に固定表示。
  // (createCaptionBoxの既定値がそのままleft:75%/top:50%なので引数なしでOK)
  const captionEl = createCaptionBox();
  const caption = makeCaptionController(captionEl);
 
  // 公案(KOAN_TEXT)だけは以前と同じ、3D空間上の固定点(koanAnchor)に追従する表示。
  // 引用の2倍サイズ・イタリックで、captionとは別要素として持つ。
  const koanEl = createKoanBox();
  const koanCaption = makeCaptionController(koanEl);
 
  // 毎フレーム(travelToDest中)呼び出して、koanAnchorの投影先にkoanElを追従させる。
  // camera.matrixWorldはThree.jsのレンダーループ側(main.js)で毎フレーム更新されている前提
  // (このモジュール自体はレンダーループを持たないため、呼び出し側のupdateタイミングに依存する)。
  function updateKoanScreenPositionForCamera(camera) {
    updateKoanScreenPosition(koanEl, koanAnchor, camera);
  }
 
  return { star, lineA, setLineAEnd, iSprite, iHitArea, caption, koanAnchor, koanCaption, updateKoanScreenPosition: updateKoanScreenPositionForCamera };
}
 
// 点pointから直線(始点start, 単位方向dir)への最短点
function nearestPointOnLine(point, start, dir) {
  const toPoint = point.clone().sub(start);
  const t = toPoint.dot(dir);
  return start.clone().addScaledVector(dir, t);
}
 
// ── フィナーレ本編(星クリックで main.js から呼ぶ) ─────────────────
// camera / controls / dialogue は main.js が持つインスタンスをそのまま渡す。
// trigger は createTrigger() の戻り値。
// onOrigin: 原点到達の瞬間に呼ばれる(公案への切り替え等、main.js側の追加演出用フック)
// onDone:   TRIGGER_DESTへの移動が終わった時点で呼ばれる(この先の続きは未実装)
export function runTrigger({ camera, controls, dialogue, trigger, onOrigin, onDone }) {
  if (controls) controls.enabled = false;
 
  // dialogue引数は今回のセリフ表示には使用しない
  // (dialogue.js への依存をやめ、自作の trigger.caption / trigger.koanCaption を使っているため)。
  void dialogue;
 
  // 星クリック後も星自体は消さない(main.js 側の click ハンドラで意図せず
  // hidden にされているケースへの保険。もし main.js 側で明示的に
  // star.visible = false としている箇所があれば、そちらも合わせて削除してください)。
  trigger.star.visible = true;
 
  const lineDir = ORIGIN.clone().sub(TRIGGER_STAR_POS).normalize(); // 星→原点の単位方向
 
  // 現在の狙う点。線A〜原点到達まではTRIGGER_LOOK_TARGET、
  // 原点通過後はarriveAtOrigin()内でTRIGGER_DEST_LOOK_TARGETに切り替える。
  let currentLookTarget = TRIGGER_LOOK_TARGET;
  function lookTarget() {
    return currentLookTarget;
  }
 
  // 毎フレーム、その時点のカメラ位置→lookTargetの向きからupを計算してから向きを決める
  function applyLookAt() {
    const target = lookTarget();
    const forward = target.clone().sub(camera.position);
    camera.up.copy(computeUp(forward));
    camera.lookAt(target);
  }
 
  // 引用の自動切り替えタイマー。travelToOriginで開始し、フィナーレ全体が終わる
  // (travelToDest完了)までは止めない。最後の点に到達したらここでまとめて消す。
  let quoteTimer = null;

  // 出典表示(右下)。captions.js側(convergence/hamiltonian)と同じ共有インスタンスを使う。
  const sourceCaption = getSourceCaption();

  // セリフ1行を右上のcaptionへ、同時に出典を右下へ反映する共通ヘルパー。
  // 空文字(最後のダミー行)のときは出典も一緒に消す。
  function showTriggerQuote(idx) {
    const q = NORMALIZED_TRIGGER_QUOTES[idx];
    if (!q) return;
    trigger.caption.setText(q.text);
    if (q.text) sourceCaption.setText(TRIGGER_WORK); else sourceCaption.hide();
  }

  // 1) セリフ1行目(このクリックでは1回きり)。画面四分割・右上ブロック中央のcaptionに表示。
  //    2行目以降はtravelToOrigin側で、各行のdurationが経過するたびに切り替える。
  showTriggerQuote(0);
 
  // 2) カメラの自由視点を終了。まず位置はstartPosに保ったまま、向きだけを
  //    TRIGGER_LOOK_TARGETへ回転させる(合流はまだしない)。
  const startPos = camera.position.clone();
  const nearest = nearestPointOnLine(startPos, TRIGGER_STAR_POS, lineDir);
 
  rotateToLookTarget();
 
  function rotateToLookTarget() {
    // 目標の向き(quaternion)を、位置はstartPosのまま一時的にlookAtして求める
    const startQuat = camera.quaternion.clone();
    camera.position.copy(startPos);
    const forward = currentLookTarget.clone().sub(startPos);
    camera.up.copy(computeUp(forward));
    camera.lookAt(currentLookTarget);
    const endQuat = camera.quaternion.clone();
    camera.quaternion.copy(startQuat); // アニメーション開始のため、見た目を一旦元の向きに戻す
 
    const rotProgress = { t: 0 };
    gsap.to(rotProgress, {
      t: 1,
      duration: SNAP_DURATION,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.copy(startPos); // 位置はまだ動かさない
        camera.quaternion.slerpQuaternions(startQuat, endQuat, rotProgress.t);
      },
      onComplete: () => {
        // 3) 5秒待機してから線Aを伸ばし始める
        gsap.delayedCall(WAIT_BEFORE_GROW, growLine);
      },
    });
  }
 
  function growLine() {
    trigger.lineA.visible = true;
    const p = { t: 0 };
    gsap.to(p, {
      t: 1,
      duration: LINE_GROW_DURATION,
      ease: 'power1.out',
      onUpdate: () => {
        trigger.setLineAEnd(TRIGGER_STAR_POS.clone().lerp(ORIGIN, p.t));
      },
      onComplete: mergeToLine,
    });
  }
 
  // 線Aが伸び終わったあと、カメラの位置を線A上の最寄り点(nearest)へ合流させる。
  // 向きは合流中もTRIGGER_LOOK_TARGETを見続ける(applyLookAtで毎フレーム再計算)。
  function mergeToLine() {
    const mergeProgress = { t: 0 };
    gsap.to(mergeProgress, {
      t: 1,
      duration: SNAP_DURATION,
      ease: 'power2.inOut',
      onUpdate: () => {
        camera.position.lerpVectors(startPos, nearest, mergeProgress.t);
        applyLookAt();
      },
      onComplete: travelToOrigin,
    });
  }
 
  function travelToOrigin() {
    // 最寄り点から原点までの距離を、星の実位置からのフル距離に対する比率で
    // FULL_TRAVEL_DURATIONに換算する(経路が短ければ早く終わる)
    const fullDist = TRIGGER_STAR_POS.length();
    const remainDist = nearest.length();
    const duration = FULL_TRAVEL_DURATION * (remainDist / fullDist);
 
    // 引用を順番に切り替える(行ごとのdurationに従う)。経路が短くて全部出し切れなくても、
    // ここではclearしない(最後の点=TRIGGER_DESTに到達するまで右上のセリフ表示を続けたいため)。
    let quoteIdx = 0; // 0番目は上(showTriggerQuote(0))で表示済み
    function scheduleNextQuote() {
      const current = NORMALIZED_TRIGGER_QUOTES[quoteIdx];
      quoteTimer = setTimeout(() => {
        quoteIdx++;
        if (quoteIdx < NORMALIZED_TRIGGER_QUOTES.length) {
          showTriggerQuote(quoteIdx);
          scheduleNextQuote();
        } else {
          quoteTimer = null;
        }
      }, current.duration * 1000);
    }
    scheduleNextQuote();
 
    const p = { t: 0 };
    gsap.to(p, {
      t: 1,
      duration,
      ease: 'none', // 一定速度
      onUpdate: () => {
        camera.position.lerpVectors(nearest, ORIGIN, p.t);
        applyLookAt();
        // 原点付近で「i」を自動フェードイン(クリック不要)
        if (p.t > 0.85 && !trigger.iSprite.visible) {
          trigger.iSprite.visible = true;
          trigger.iHitArea.visible = true; // ← 見た目と同時にクリック判定も有効化
          gsap.to(trigger.iSprite.material, { opacity: 1, duration: 1.2, ease: 'power2.out' });
        }
      },
      onComplete: () => {
        // ここではquoteTimerを止めない。セリフは最後の点(TRIGGER_DEST)到達まで表示を続ける。
        arriveAtOrigin();
      },
    });
  }
 
  function arriveAtOrigin() {
    // 4) 原点到達で瞬時に反転(=以後TRIGGER_DESTへ進む)。カメラは常に固定点を見続ける。
    currentLookTarget = TRIGGER_DEST_LOOK_TARGET; // ここでlookTargetを切り替えないとTRIGGER_DESTへの移動中も(0,-1,-1)を見続けてしまう
    if (onOrigin) onOrigin();
    trigger.updateKoanScreenPosition(camera); // 表示前に投影位置を計算しておく
    trigger.koanCaption.setText(KOAN_TEXT); // 以前と同じ、3D固定点(koanAnchor)に追従する表示に戻す
    travelToDest();
  }
 
  function travelToDest() {
    const p = { t: 0 };
    gsap.to(p, {
      t: 1,
      duration: Y_AXIS_TRAVEL_DURATION,
      ease: 'power1.inOut',
      onUpdate: () => {
        camera.position.lerpVectors(ORIGIN, TRIGGER_DEST, p.t);
        applyLookAt(); // 視覚的には後ろ向きに進む
        trigger.updateKoanScreenPosition(camera); // カメラが動く間、koanAnchorの投影位置に文字を追従させる
      },
      onComplete: () => {
        // 最後の点(TRIGGER_DEST)に到達したので、ここでまとめて片付ける
        if (quoteTimer) {
          clearTimeout(quoteTimer);
          quoteTimer = null;
        }
        trigger.caption.hide(); // 右上の引用セリフはここまで表示を続け、最後の点到達で消す
        // 右上の引用が消えるので、その出典(Catcher in the Rye)も外し、代わりに
        // 残り続ける公案の出典(Nine Stories のエピグラフ)を右下に表示する。
        // (公案はiクリック時のhandleIconClickで消えるので、出典もそこで一緒に消える)
        sourceCaption.setText(KOAN_WORK);
        trigger.lineA.visible = false; // Y軸側(TRIGGER_DEST)に到達したら緑の線Aを消す
        if (onDone) onDone();
      },
    });
  }
}
 
// ── iクリック後のフック ─────────────────────────────
export function handleIconClick({ trigger, onNextPhase }) {
  trigger.caption.hide();
  trigger.koanCaption.hide();
  getSourceCaption().hide(); // 引用の出典(右下)も念のため一緒に閉じる
  trigger.iHitArea.visible = false; // クリック済みなので判定は閉じる(見た目のiSprite自体は次の演出側で制御)
 
  // 次のモーション(未設計)へのフック。呼び出し側で用意されていれば呼ぶだけ。
  if (onNextPhase) onNextPhase();
}
