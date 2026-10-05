import * as THREE from 'three';

// ── 星に紐づくセリフ(位置と台詞のペア) ───────────
const HOTSPOTS = [
   //X
  { pos: [-200, -280, 10],  special: 'starburst',
                            text:  [{ text: 'It\’s rainning.\nIt\’s starting to rain.', work: 'The Catcher in the Rye'},
                                   { text: 'Aren\’t you gonna ride too?', work: 'The Catcher in the Rye'},
                                   ] },
  { pos: [-80, -130, 100],  text: [{ text: 'This is a people shooting hat.', work: 'The Catcher in the Rye'},
                                   { text: 'Mine came from Mark Cross.', work: 'The Catcher in the Rye'},
                                   ] },
  { pos: [-450, -330, 50],  text: [{ text: 'Go home and get your bike and meet me in front of Bobby\’s house. Hurry up.', work: 'The Catcher in the Rye'},
                                   { text: 'But twice ─ twice ─ we were there it started to rain.', work: 'The Catcher in the Rye'},
                                   { text: 'He never got sore about anything', work: 'The Catcher in the Rye'},
                                   ] },
  //Y
  { pos: [120, -200, -150], text: [{ text:'That was a secret bugle only Admirals to hear.\n—Boo Boo Glass', work: 'Down at the Dinghy'},
                                   ] },
  { pos: [200, -100, -260], text: [{ text: 'What did one wall say to the other wall?\n—Charles', work: 'For Esmé—with Love and Squalor'},
                                   { text: 'The door banged open without having been wrapped on. X raised his head, turned it, and corporal Z standing in the door.', work: 'For Esmé—with Love and Squalor'},
                                   ] },
  { pos: [-50, -30, -100],  text: [{ text: 'Did the tigers run all around that tree?\n─Sybil Carpenter', work: 'A Perfect Day for Bananafish'},
                                    { text: 'Here comes a wave.\n─Sybil Carpenter', work: 'A Perfect Day for Bananafish'},
                                   ] },
  { pos: [-30, -100, -60],  text: [{ text:'gift horse\n─Teddy', work: 'Teddy',},
                                   { text:'triumvirate\n─Teddy', work: 'Teddy'},
                                   ] },
  //Z
  { pos: [-200,10, -150],   text: [{ text: 'I want to talk to Seymour.\n─Franny Glass', work: 'Zooey'},
                                   { text: 'The only kind of chicken soup Bessie ever brings to anybody around this madhouse.\n─Zooey Glass', work: 'Zooey'},
                                   ] },
  { pos: [-70, 30, -190],   text: [{ text: 'I was Mercury himself.\n─Buddy Glass', work: 'Seymour: an Introduction'},
                                   { text: 'This which, I suggest, though possibly not to everyone’s taste, is highly literate vaudeville.\n─Buddy Glass', work: 'Seymour: an Introduction'},
                                   ] },
  { pos: [-100, 150, -140], text: [{ text: 'Keep me up till five only because all your stars are out, and for other reason.\n─Seymour Glass', work: 'Seymour: an Introduction'},
                                   { text: 'All we do our whole lives is go from one little piece of Holy Ground to the next.\n─Seymour Glass', work: 'Seymour: an Introduction'},
                                    ]},

];

// ← 見た目のサイズはそのまま(0.35)。星は原点から100〜380くらい離れた位置に置かれていて、
//   画面上でこの小ささをピクセル単位でクリックするのはほぼ不可能に近いため、
//   axisStationOverlay.jsのmakeDotと同じパターンで「判定専用の大きな透明球」を子として追加する。
const HOTSPOT_HIT_RADIUS = 16; // ← 星までの距離が大きいので、他の点(DOT_HIT_RADIUS=1.1)よりだいぶ広めにしてある

// ── Phoebeの星(special: 'starburst')専用のビジュアル ───────────────
// 他の星と同じ小球ではなく、中心の明るいコア+十字・斜め方向に伸びるスパイクを
// canvasで描いた1枚のテクスチャをスプライト(常にカメラ向き)としてAdditiveBlendingで
// 重ねることで、ポストプロセスのbloomなしに「眩しい星」らしいstarburstの見た目を作る。
const STARBURST_SPRITE_SIZE = 14; // ワールド単位。HOTSPOT_HIT_RADIUS(16)よりひと回り小さくして、
                                   // 光が判定球からあまりはみ出さないようにしてある(仮値、見た目を見て調整可)。

let starburstTextureCache = null;
function getStarburstTexture() {
  if (starburstTextureCache) return starburstTextureCache;

  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  const cx = size / 2;
  const cy = size / 2;

  // 中心の明るいコア(放射状グラデーション)
  const core = ctx.createRadialGradient(cx, cy, 0, cx, cy, size * 0.14);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.4, 'rgba(255,247,214,0.9)');
  core.addColorStop(1, 'rgba(255,247,214,0)');
  ctx.fillStyle = core;
  ctx.fillRect(0, 0, size, size);

  // 中心を貫通する細長い三角形(先端に向けてグラデーションで減衰)をスパイクとして描く。
  // angle: スパイクの向き(ラジアン)、length: 中心から先端までの長さ、width: 根元の太さ。
  function drawSpike(angle, length, width) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    const grad = ctx.createLinearGradient(0, 0, length, 0);
    grad.addColorStop(0, 'rgba(255,250,230,0.95)');
    grad.addColorStop(0.5, 'rgba(255,250,230,0.35)');
    grad.addColorStop(1, 'rgba(255,250,230,0)');
    ctx.fillStyle = grad;
    // 反対向きにも同じ三角形を描いて、中心を突き抜ける1本のスパイクに見せる
    for (let dir = 0; dir < 2; dir++) {
      ctx.beginPath();
      ctx.moveTo(0, -width / 2);
      ctx.lineTo(length, 0);
      ctx.lineTo(0, width / 2);
      ctx.closePath();
      ctx.fill();
      ctx.rotate(Math.PI);
    }
    ctx.restore();
  }

  // ★ 修正: 以前はR = size*0.5(キャンバスの縁ぎりぎり)まで伸ばしていたため、横・縦の
  //   スパイクが正方形の縁に接する形になり、Bloomでぼかした際に角ばりが出る原因になって
  //   いた。縁に接しないよう少し短くする。
  const R = size * 0.42;
  drawSpike(0, R, size * 0.05);              // 横(太め・長め)
  drawSpike(Math.PI / 2, R, size * 0.05);    // 縦(太め・長め)
  drawSpike(Math.PI / 4, R * 0.7, size * 0.022);      // 斜め(細め・短め)
  drawSpike(-Math.PI / 4, R * 0.7, size * 0.022);     // 斜め(細め・短め)

  const tex = new THREE.CanvasTexture(canvas);
  // ★ 修正: generateMipmapsを無効化していなかったため、既定のミップマップ自動生成
  //   (正方形ブロック単位での平均化)によって縮小時に角ばりがにじみ出ていた。
  //   stars.js等の他のテクスチャと同様、明示的に無効化する。
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  starburstTextureCache = tex;
  return tex;
}

export function createHotspots(scene) {
  const hotspotMeshes = [];
  const hotspotGeo = new THREE.SphereGeometry(0.35, 12, 12);
  const hitGeo = new THREE.SphereGeometry(HOTSPOT_HIT_RADIUS, 12, 12);

  HOTSPOTS.forEach(h => {
    const isStarburst = h.special === 'starburst';
    // Phoebeの星だけコアを心持ち大きく・白寄りにして、後段でスパイクを重ねたときに
    // 中心の光量が負けないようにする(他の星はこれまで通り0.35/0xfff3c4)。
    const mat = new THREE.MeshBasicMaterial({ color: isStarburst ? 0xffffff : 0xfff3c4 });
    const geo = isStarburst ? new THREE.SphereGeometry(0.6, 12, 12) : hotspotGeo;
    const m = new THREE.Mesh(geo, mat);
    m.position.set(...h.pos);
    m.userData.texts = h.text;
    // ★ 追加: main.js側で「テクスチャだけの発光にする(=Bloomを一切かけない)」対応の
    //   ため、starburstのメッシュだけ判別できるようにタグ付けしておく。
    if (isStarburst) m.userData.isStarburst = true;

    if (isStarburst) {
      const spriteMat = new THREE.SpriteMaterial({
        map: getStarburstTexture(),
        color: 0xfff7d6,
        blending: THREE.AdditiveBlending,
        transparent: true,
        depthWrite: false,
      });
      const sprite = new THREE.Sprite(spriteMat);
      sprite.scale.set(STARBURST_SPRITE_SIZE, STARBURST_SPRITE_SIZE, 1);
      m.add(sprite); // 星本体(m)に追従して動くよう子として追加
    }

    // 判定専用の当たり判定球(見た目にはほぼ影響しないよう、限りなく透明)。
    // material.visible=falseだとraycastが環境によって拾わないことがあるため、
    // 他の箇所(yzPanel.mesh / axisStationOverlayのhitArea)と同じく
    // visible=trueのままopacityをほぼ0にする方式にする。
    const hitArea = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
    );
    m.add(hitArea);

    scene.add(m);
    hotspotMeshes.push(m);
  });
  return hotspotMeshes;
}