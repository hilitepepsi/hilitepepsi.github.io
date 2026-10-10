import * as THREE from 'three';
import { AXIS_LENGTH, AXIS_COLOR, AXIS_X_ANCHOR_Z } from './config.js';

// ── X軸ラインの「原点方向へ流れる光」シェーダー(X軸専用) ──────
// 頂点属性 aProgress(0=原点側, 1=先端側)をフラグメントで線形補間し、
// その値と同じ位置に明るい帯(streak)を置いて、時間とともにprogress=1→0へ
// (=先端から原点へ)流れて見えるようにする。ループする1本の帯なので、
// 見た目としては「光が繰り返し原点へ吸い込まれていく」ような表現になる。
// この演出はXステーション滞在中(=The Catcher in the Rye表示中)だけ有効にする。
// (uActive: main.js側でshowXOverlay()/hideXOverlay()に合わせて1/0を切り替える。
//  offのときはstreak項が消え、Y/Z軸と同じ「単色フルブライト」の見た目に揃う)
// uOpacity: fadeOut/fadeIn(下記)でXAxisをなめらかに消すためのフェード係数(0〜1)。
// uActiveの明滅とは別軸の値なので、両方を掛け合わせてアルファへ反映する。
function makeFlowAxisMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColor: { value: new THREE.Color(AXIS_COLOR) },
      uTime: { value: 0 },
      uActive: { value: 0 },
      uOpacity: { value: 1 },
    },
    vertexShader: `
      attribute float aProgress;
      varying float vProgress;
      void main() {
        vProgress = aProgress;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uActive;
      uniform float uOpacity;
      varying float vProgress;
      void main() {
        float speed = 0.35;   // 流れる速さ
        float width = 0.16;   // 帯の幅(progress空間, 0〜1)
        // uTimeが増えるほど0→1の帯位置が「減っていく」(fractのラップで先端→原点を繰り返す)
        float streakPos = fract(-uTime * speed);
        float d = abs(vProgress - streakPos);
        d = min(d, 1.0 - d); // 0〜1のループ上の最短距離
        float streak = smoothstep(width, 0.0, d) * uActive; // ← offのときは0(流れない)
        // offのときは単色フルブライト(1.0)、onのときは流れ演出の明滅(0.5〜1.6)に切り替える
        float brightness = mix(1.0, 0.5, uActive) + streak * 1.1;
        gl_FragColor = vec4(uColor * brightness, uOpacity);
      }
    `,
    transparent: true,
  });
}

// ── Y軸・Z軸用: 流れないシンプルな単色ライン ──────
// 「原点へ向かう流れ」の演出はXページ(X軸)専用の機能だったため、Y/Zは通常の単色ラインにする。
// transparent:trueにしておくのは、fadeOut/fadeIn(下記)でopacityをアニメーションさせるため
// (three.jsはtransparent:falseだとopacity値そのものを描画に反映しない)。
function makeStaticAxisMaterial() {
  return new THREE.LineBasicMaterial({ color: AXIS_COLOR, transparent: true, opacity: 1 });
}

// ── 三軸(すべて同色、初期はscale.y=0で非表示) ──
// aProgress: 0=原点側の頂点, 1=先端側の頂点(流れシェーダー使用時のみ意味を持つ)
function makeAxisLine() {
  const geo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(0, AXIS_LENGTH, 0)
  ]);
  geo.setAttribute('aProgress', new THREE.Float32BufferAttribute([0, 1], 1));
  const mat = makeStaticAxisMaterial();
  const line = new THREE.Line(geo, mat);
  line.scale.y = 0;
  return line;
}

// ── クリック判定専用の見えない「太い」当たり判定シリンダー ──
// Lineは見た目上1px幅で、raycasterのデフォルト閾値でも狙いにくい。
// 各軸に半径を持つ円柱を重ねて、そちらをraycast対象にすることで確実にクリックできるようにする。
// (visible=falseにしても、three.jsのraycastは可視判定を見ないのでヒットテストには使える)
function makeHitCylinder(length, axisName, radius = 0.7) {
  const geo = new THREE.CylinderGeometry(radius, radius, length, 8, 1, true);
  geo.translate(0, length / 2, 0); // ピボットを原点側の端に合わせる(線の局所座標(0→length, local+Y)と一致させる)
  const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ visible: false }));
  mesh.userData.axisName = axisName;
  mesh.layers.set(0); // ← レイヤー0=通常のraycast対象。非表示時はsetAxesVisible()でレイヤー1に退避してヒットしないようにする
  return mesh;
}

export function createAxes(scene) {
  const yAxis = makeAxisLine();
  yAxis.rotation.z = -Math.PI / 2; // local Y → world +X
  scene.add(yAxis);
  // 当たり判定はyAxisの子にすることで、回転・伸びる演出(scale.y)にそのまま追従させる
  const yHit = makeHitCylinder(AXIS_LENGTH, 'Y');
  yAxis.add(yHit);

  // Xだけは「刃跡」そのものを軸として使う。原点から伸ばすのではなく、
  // 遠方の到達点(AXIS_X_ANCHOR_Z)を固定端にして、刃(travelMarker)が
  // 原点へ向かって進むのに合わせて「すでに切られた跡」を逆向きに刻んでいく。
  // 頂点0=先端側(固定・遠方)なのでaProgress=1、頂点1=原点側(伸びてくる)なのでaProgress=0。
  const xAxisGeo = new THREE.BufferGeometry().setFromPoints([
    new THREE.Vector3(0, 0, AXIS_X_ANCHOR_Z),
    new THREE.Vector3(0, 0, AXIS_X_ANCHOR_Z),
  ]);
  xAxisGeo.setAttribute('aProgress', new THREE.Float32BufferAttribute([1, 0], 1));
  const xAxis = new THREE.Line(xAxisGeo, makeFlowAxisMaterial());
  xAxis.frustumCulled = false; // 毎フレーム頂点を書き換えるためbounding sphereが陳腐化する→カメラ角度で消える不具合を防ぐ
  scene.add(xAxis);
  // Xは頂点を直接書き換える方式(親のscaleに乗らない)なので、当たり判定は独立した円柱として置く。
  // home状態に達する頃には刃跡は原点(0,0,0)から先端(0,0,AXIS_X_ANCHOR_Z)まで描き終わっているので、
  // 完成形と同じ範囲を最初から静的に用意しておけばよい。
  const xHit = makeHitCylinder(AXIS_LENGTH, 'X');
  xHit.rotation.x = Math.PI / 2; // local +Y → world +Z
  scene.add(xHit);

  // travelMarker(刃)の現在z位置に合わせて、xAxisの「刻まれた区間」を更新する
  function updateXAxisTrail(currentZ) {
    const nearZ = THREE.MathUtils.clamp(currentZ, 0, AXIS_X_ANCHOR_Z);
    const posAttr = xAxis.geometry.attributes.position;
    posAttr.setXYZ(0, 0, 0, AXIS_X_ANCHOR_Z); // 固定端(遠方)
    posAttr.setXYZ(1, 0, 0, nearZ);           // 刃の現在地(原点へ向かって減っていく)
    posAttr.needsUpdate = true;
    xAxis.geometry.computeBoundingSphere(); // ← 追記: 更新しないとraycast用のbounding sphereが古いままヒット判定が壊れる
  }

  const zAxis = makeAxisLine(); // local Y → world +Y(そのまま)
  scene.add(zAxis);
  const zHit = makeHitCylinder(AXIS_LENGTH, 'Z');
  zAxis.add(zHit);

  const axisLines = [xAxis, yAxis, zAxis];
  const axisHitAreas = [xHit, yHit, zHit]; // ← クリック判定はこちらを使う(main.js)

  // ── 軸の表示/クリック判定をまとめてオン・オフ ─────────────────
  // 数式にズームして「カメラが接近」しているあいだは軸が視界の邪魔・不整合になるため、
  // 見た目(line.visible)を消すだけでなく、当たり判定シリンダーもレイヤー1へ退避させて
  // raycastにヒットしなくする(three.jsのraycastはvisibleを見ないため、visible=falseだけでは
  // クリック判定は消えない → makeHitCylinder側コメント参照)。
  let axesVisible = true;
  function setAxesVisible(visible) {
    axesVisible = visible;
    for (const line of axisLines) line.visible = visible;
    for (const hit of axisHitAreas) hit.layers.set(visible ? 0 : 1);
  }
  function isAxesVisible() {
    return axesVisible;
  }

  // 現在のopacity値を3本の軸(Y/Z=material.opacity、X=uOpacityユニフォーム)へまとめて反映する。
  function setAxesOpacity(opacity) {
    yAxis.material.opacity = opacity;
    zAxis.material.opacity = opacity;
    xAxis.material.uniforms.uOpacity.value = opacity;
  }

  // ── なめらかなフェードアウト/フェードイン ──────────────────
  // main.js の fadeOutAxisVisuals() から `typeof axes.fadeOut === 'function'` の
  // 保険付きで呼ばれる想定(数式ズーム開始時、軸まわりの表示を一斉にフェードさせる箇所)。
  // クリック判定は「見えている間だけ」有効にしたいので、フェード開始と同時に即座にレイヤー退避し、
  // 見た目の消滅(opacity)だけをdurationかけてなめらかに追わせる。
  function fadeOut(duration = 1.2) {
    axesVisible = false;
    for (const hit of axisHitAreas) hit.layers.set(1); // クリック判定は先に切っておく
    gsap.to({ o: 1 }, {
      o: 0,
      duration,
      ease: 'power1.out',
      onUpdate: function () { setAxesOpacity(this.targets()[0].o); },
      onComplete: () => { for (const line of axisLines) line.visible = false; },
    });
  }

  // 軸を再び出したくなったとき用(現時点ではmain.js側に「ズームから戻る」導線が
  // まだ無いため未使用だが、追加された際にそのまま呼べるように用意しておく)。
  function fadeIn(duration = 1.2) {
    axesVisible = true;
    for (const line of axisLines) line.visible = true;
    setAxesOpacity(0);
    gsap.to({ o: 0 }, {
      o: 1,
      duration,
      ease: 'power1.out',
      onUpdate: function () { setAxesOpacity(this.targets()[0].o); },
      onComplete: () => { for (const hit of axisHitAreas) hit.layers.set(0); },
    });
  }

  // 毎フレーム呼ぶと、X軸の「原点へ向かう流れ」のアニメーションが進む(Y/Zは静的なので対象外)
  function update(t) {
    xAxis.material.uniforms.uTime.value = t;
  }

  // Xステーション滞在中だけ流れ演出をオンにする(main.jsのshowXOverlay/hideXOverlayから呼ぶ)
  function setXFlowActive(active) {
    xAxis.material.uniforms.uActive.value = active ? 1 : 0;
  }

  // ── Xの「刃跡」トラベルマーカー ─────────────────
  const travelMarker = new THREE.Mesh(
    new THREE.BoxGeometry(0.06, 0.06, 3),
    new THREE.MeshBasicMaterial({ color: AXIS_COLOR })
  );
  travelMarker.visible = false;
  scene.add(travelMarker);

  return { xAxis, yAxis, zAxis, axisLines, axisHitAreas, travelMarker, updateXAxisTrail, update, setXFlowActive, setAxesVisible, isAxesVisible, fadeOut, fadeIn };
}