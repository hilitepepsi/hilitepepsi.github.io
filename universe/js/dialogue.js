import * as THREE from 'three';
import { getSourceCaption } from './captions.js';

// ── セリフ表示(星の真上に直接投影して表示) ─────
export function createDialogue(camera) {
  const dialogueEl = document.getElementById('dialogue');
  const sourceCaption = getSourceCaption(); // captions.js側(convergence/hamiltonian/finale)と共有の右下出典ボックス
  let dialogueTimer = null;
  let activeStar = null;                                // 現在セリフを表示中の星
  const dialogueOffset = new THREE.Vector3(0, 0.6, 0);  // 星から少し浮かせるオフセット

  // entry: 文字列(従来通り、出典なし)、または { text, work }(hotspots.js側で出典付きにした場合)。
  function show(entry, starMesh) {
    const { text, work } = typeof entry === 'string' ? { text: entry, work: null } : entry;

    // 別の星を触って切り替わる場合、前の星が消えたままにならないよう先に戻す
    if (activeStar && activeStar !== starMesh) {
      activeStar.visible = true;
    }
    dialogueEl.textContent = text;
    dialogueEl.classList.add('show');
    if (work) sourceCaption.setText(work); else sourceCaption.hide();
    activeStar = starMesh || null;
    if (activeStar) activeStar.visible = false; // 星を消してそこにセリフを表示する
    updatePosition();
    clearTimeout(dialogueTimer);
    dialogueTimer = setTimeout(() => {
      dialogueEl.classList.remove('show');
      sourceCaption.hide();
      if (activeStar) activeStar.visible = true; // セリフが終わったら星を戻す
      activeStar = null;
    }, 10000);
  }


  // activeStarのワールド座標をスクリーン座標に投影し、テキストをその真上に追従させる
  function updatePosition() {
    if (!activeStar) return;
    const v = activeStar.position.clone().add(dialogueOffset).project(camera);
    dialogueEl.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    dialogueEl.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
  }

  // 外部都合(例:Y軸ステーションの追加表示をカメラ移動で元に戻す)で
  // 即座にセリフを閉じたいときに使う。10秒タイマーによる自動復帰
  // (activeStar.visible = true)が後から誤発火しないよう、先にactiveStarをnullにしておく。
  function hide() {
    clearTimeout(dialogueTimer);
    dialogueEl.classList.remove('show');
    sourceCaption.hide();
    activeStar = null;
  }

  return { show, hide, updatePosition };
}