import * as THREE from 'three';

// ── 射手座(「ティーポット」型のアステリズムを星+線で表現) ──
// 中心(ARCHER_POS)からのオフセットで各星を配置。500スケールの奥行きでも
// くっきり読み取れるよう、頂点間の間隔を大きめ(数十単位)に取っている。
//
// セリフは星ごとではなく、この星座全体に1つだけ(main.js側でdialogue.showする固定文言)。
// どの星をクリックしても、射手座全体(星+線)を消してそのセリフを表示する。
const SAGITTARIUS_SHAPE = [
  [  0,  20,   0 ], // 0 蓋
  [-12,  0,   4 ], // 1 右肩
  [-28,  -1,   0 ], // 2 右のティーポットの口
  [-11, -24,  -3 ], // 3 右(底)
  [ 30, -13,   3 ], // 4 左下(底)
  [ 40,  -5,   0 ], // 5 左端下
  [ 28,   8,  -4 ], // 6 左端上
  [18,   7,   5 ], // 左肩
  [-19,   52,   5 ],  //弓の上
  [-51,   15,   5 ], //弓の先
  [-19,   -37,   5 ], //弓の下
];
const SAGITTARIUS_EDGES = [
  [0,1], [1,2], [2,3], [3,4], [4,5], [5,6], [6,7], [7,0], [4,7], // 本体の輪郭+注ぎ口
  [1,7], [1,3],                                     // 持ち手
];

// hotspots.jsのHOTSPOT_HIT_RADIUSと同じ考え方: 見た目のサイズ(1.1)のままだと
// 画面上でクリックするのがほぼ不可能なので、判定専用の大きな透明球を子として追加する。
// 星同士の間隔(数十単位)より狭くして、隣の星の判定と重ならないようにしてある。
const SAGITTARIUS_HIT_RADIUS = 6;

export function createSagittarius(scene, center) {
  const group = new THREE.Group();
  group.position.copy(center);

  const starMat = new THREE.MeshBasicMaterial({ color: 0xbfe9ff });
  const starGeo = new THREE.SphereGeometry(1.1, 12, 12);
  const hitGeo = new THREE.SphereGeometry(SAGITTARIUS_HIT_RADIUS, 12, 12);

  const stars = SAGITTARIUS_SHAPE.map(([x, y, z]) => {
    const s = new THREE.Mesh(starGeo, starMat);
    s.position.set(x, y, z);

    // 判定専用の当たり判定球(hotspots.jsのhitAreaと同じく、visible=trueのままopacityをほぼ0にする方式。
    // material.visible=falseだと環境によってraycastが拾わないことがあるため)。
    const hitArea = new THREE.Mesh(
      hitGeo,
      new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.001, depthWrite: false, depthTest: false })
    );
    s.add(hitArea);

    group.add(s);
    return s;
  });

  const linePts = [];
  SAGITTARIUS_EDGES.forEach(([a, b]) => linePts.push(stars[a].position, stars[b].position));
  const lines = new THREE.LineSegments(
    new THREE.BufferGeometry().setFromPoints(linePts),
    new THREE.LineBasicMaterial({ color: 0xbfe9ff, transparent: true, opacity: 0.4 })
  );
  group.add(lines);

  scene.add(group);
  group.userData.stars = stars; // ← main.js側のクリック判定(raycast対象)に使う
  return group;
}