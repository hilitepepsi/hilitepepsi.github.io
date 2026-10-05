import * as THREE from 'three';

// ── 星空(球殻状に分布し、シェーダーで瞬く) ───────
//
// ★ 拡張(星→ψ / 星→=収束):
// 各星は「現在位置(position)」に加えて「収束先座標(aTarget)」を持つ。
// 通常は position === aTarget なので、uProgress を動かしても何も起きない
// (=まだ収束先が割り当てられていない星は、これまで通りただの背景の瞬きとして漂う)。
//
// 特定の星たちに aTarget として「ψ(または=)の形をした点群」を割り当て、
// uProgress を 0→1 にアニメーションさせると、その星たちだけが頂点シェーダー上で
// position→aTarget へ滑らかに移動する(GPUモーフ)。
//
// 収束が完了したら、その星たちの position 自体を aTarget の値で上書き(焼き込み)し、
// uProgress を 0 に戻す。position===aTargetになった星は今後 uProgress が
// また動いても位置が変わらない(=固定される)ので、続けて「別の星の集団」を
// 次の形(例: =)へ収束させる、という多段階の演出が同じ uProgress ひとつで実現できる。
// ── 星本体は「芯」だけのシンプルな円(下のフラグメントシェーダー参照)。
//   発光(光暈)はsceneSetup.js側の丸いBloomパイプラインに委ねる方針にしたため、
//   以前ここにあった焼き込みテクスチャ用のグラデーション調整パラメータは廃止した。

// ★ 変更: 以前はcanvasに焼き込んだ「芯+広い光暈」のグラデーションテクスチャを使い、
//   Bloom専用パスから完全除外(excludeFromBloom)することで丸さを保っていた。
//   しかし静的な焼き込みテクスチャでは、実際の明るさに反応して伸び縮みする
//   UnrealBloomPassらしい発光感が出せず不満が残っていたため、方針を変更する。
//   → 星本体(この点)は「芯」だけのシンプルな円にし、周囲の発光(光暈)は
//   sceneSetup.js側に新設した専用の丸いBloomパイプライン(閾値抽出+十分な解像度の
//   分離ガウシアン。UnrealBloomPassのような低解像度ミップを使わないため、
//   どれだけ強くかけても輪郭が四角くならない)に完全に委ねる。
//   この星はUnrealBloomPass本体(bloomComposer)からは今まで通り除外したまま、
//   新しい丸いBloomパイプラインにだけ含める(sceneSetup.jsのincludeInRoundBloom参照)。

export function createStars(scene, count = 3000) {
  const positions = new Float32Array(count * 3);
  const targets = new Float32Array(count * 3); // 収束先座標(未割当時はpositionと同じ値)
  const phases = new Float32Array(count);
  // ── ドット化用の追加属性 ──────────────────────────
  // aActive: 「今まさに収束アニメーション中(uProgressを適用すべき)」か。1=対象、0=対象外。
  //   これが無いと、uProgressが動くたびに「収束先=現在地」の無関係な星まで
  //   (見た目上は動かなくても)サイズ縮小演出に巻き込まれてしまう。
  // aFormed: 「収束が完了して焼き込み済み(=固まったドット)」か。1=固定でシャープな小さいドット。
  //   一度立ったら以後ずっと1のまま(次のuProgressサイクルの影響を受けない)。
  // aIsPsi: 「ψの形を構成する星か」。1のものだけ、後でuPsiFadeによって
  //   本物のpsi.pngスプライトへクロスフェードしながらフェードアウトできる。
  const active = new Float32Array(count);
  const formed = new Float32Array(count);
  const isPsi = new Float32Array(count);
  const radius = 150;

  for (let i = 0; i < count; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.acos(2 * Math.random() - 1);
    const r = radius + Math.random() * 350;

    const x = r * Math.sin(phi) * Math.cos(theta);
    const y = r * Math.sin(phi) * Math.sin(theta);
    const z = r * Math.cos(phi);

    positions[i * 3]     = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    // 初期状態: 収束先=現在位置(=まだどの形にも属していない、という意味)
    targets[i * 3]     = x;
    targets[i * 3 + 1] = y;
    targets[i * 3 + 2] = z;

    phases[i] = Math.random() * Math.PI * 2;
  }

  const geometry = new THREE.BufferGeometry();
  const positionAttr = new THREE.BufferAttribute(positions, 3);
  const targetAttr = new THREE.BufferAttribute(targets, 3);
  positionAttr.setUsage(THREE.DynamicDrawUsage); // 焼き込み時にCPUから書き換えるため
  targetAttr.setUsage(THREE.DynamicDrawUsage);   // 収束先を割り当てるたびに書き換えるため
  geometry.setAttribute('position', positionAttr);
  geometry.setAttribute('aTarget', targetAttr);
  geometry.setAttribute('phase', new THREE.BufferAttribute(phases, 1));

  const activeAttr = new THREE.BufferAttribute(active, 1);
  const formedAttr = new THREE.BufferAttribute(formed, 1);
  const isPsiAttr = new THREE.BufferAttribute(isPsi, 1);
  activeAttr.setUsage(THREE.DynamicDrawUsage);
  formedAttr.setUsage(THREE.DynamicDrawUsage);
  isPsiAttr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aActive', activeAttr);
  geometry.setAttribute('aFormed', formedAttr);
  geometry.setAttribute('aIsPsi', isPsiAttr);

  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color(0x9ecbff) },
      uProgress: { value: 0 }, // 0=position(現在地)のまま、1=aTarget(収束先)に到着
      uPsiFade: { value: 0 },  // 0=星のψのまま、1=本物のpsi.pngへ完全にクロスフェード済み(星側は非表示)
    },
    vertexShader: `
            attribute float phase;
            attribute vec3 aTarget;
            attribute float aActive;
            attribute float aFormed;
            attribute float aIsPsi;
            uniform float uTime;
            uniform float uProgress;
            uniform float uPsiFade;
            varying float vTwinkle;
            varying float vFormed;
            varying float vHide;
            void main() {
                vTwinkle = 0.5 + 0.5 * sin(uTime * 1.5 + phase * 6.2831);
                // aActive=0の星(収束に無関係な星)は、uProgressが動いても
                // position→aTargetのmixが実質no-opになる(元々position===aTargetのため)。
                // ここではさらに「サイズ縮小演出」もaActiveでゲートし、無関係の星を巻き込まない。
                float travel = uProgress * aActive;
                vec3 morphed = mix(position, aTarget, travel);
                // vFormed: 0=まだ普通の星、1=完全に収束済み(固まったドット)。
                // アニメ中(travel)と焼き込み後(aFormed)のどちらでも同じ「締まった見た目」になるよう統合。
                vFormed = max(aFormed, travel);
                vHide = aIsPsi * uPsiFade; // ψを構成する星だけ、本物のpsi.pngへの置き換え時にフェードアウト
                vec4 mvPosition = modelViewMatrix * vec4(morphed, 1.0);
                // サイズは元の値に戻した(発光の見た目はテクスチャ側の
                // グラデーション調整で作る方針にしたため)。
                float shrink = mix(0.9, 0.2, vFormed);
                float rawSize = (1.2 + vTwinkle * 3.3) * shrink * (300.0 / -mvPosition.z);
                gl_PointSize = max(rawSize, 3.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
    fragmentShader: `
            uniform vec3 uColor;
            varying float vTwinkle;
            varying float vFormed;
            varying float vHide;
            void main() {
                // ★ 変更: 以前はここでテクスチャ(uStarTex)をサンプリングしていたが、
                // 光暈をsceneSetup.js側の丸いBloomパイプラインに任せる方針にしたため、
                // ここでは芯だけのシンプルな円マスクを自前で計算する。
                float d = distance(gl_PointCoord, vec2(0.5));
                float mask = 1.0 - smoothstep(0.0, 0.5, d);
                // 収束済みほど輪郭を締める: 距離マスクに対してpowをかけると
                // 裾野(にじみ部分)が急峻になり、シャープな小さいドットに近づく。
                float sharpness = mix(1.0, 3.5, vFormed);
                mask = pow(mask, sharpness);
                // 収束済みほど瞬きを抑えて明るさを安定させる(文字として読みやすくする)。
                // ここでのbrightnessは「色の強さ」であり、blend時の重み(alpha=mask)とは
                // 別物として扱う。alphaをそのままmaskにしておくことで、なめらかな
                // 円の形状(裾野の柔らかさ)を壊さずに保ちつつ、色をuColor*brightnessで
                // 1.0超まで押し上げて(1chあたり255でクリップされる)、芯が白飛びするような
                // 「発光の強さ」を表現できる。この明るさが丸いBloomパイプラインの
                // 閾値抽出(luminosityThreshold)にそのまま効いてくる。
                float brightness = mix(1.1 + vTwinkle * 0.8, 4.2, vFormed);
                float alpha = mask * (1.0 - vHide);
                if (alpha <= 0.001) discard;
                gl_FragColor = vec4(uColor * brightness, alpha);
            }
        `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending
  });

  const stars = new THREE.Points(geometry, material);
  scene.add(stars);

  // ── 未割当プール: まだどの形にも使われていない星のindexリスト ──
  // 「セリフの星」(hotspots.js側で別に作られる、クリックで文章が出る星)はこの
  // createStars()の管理下には無い別オブジェクトなので、ここでは一切関与しない
  // (=自動的に無視される)。
  const unassignedPool = Array.from({ length: count }, (_, i) => i);

  // 未割当プールに何個残っているか(=「残り全部」を収束に使いたいときに使う)。
  function remainingCount() {
    return unassignedPool.length;
  }

  // 未割当プールからランダムにn個取り出す(取り出した分はプールから除外される)。
  // nがプール残数より多ければ、残っている分だけ返す。
  function pickUnassigned(n) {
    const picked = [];
    for (let k = 0; k < n && unassignedPool.length > 0; k++) {
      const idx = Math.floor(Math.random() * unassignedPool.length);
      picked.push(unassignedPool.splice(idx, 1)[0]);
    }
    return picked;
  }

  // 指定した星たち(indices)に、新しい収束先(worldPoints、ワールド座標のVector3配列)を
  // 割り当てて、duration秒かけてuProgressを0→1にアニメーションさせる(GPUモーフ)。
  // worldPointsの要素数がindicesより少ない場合は繰り返し使う(% worldPoints.length)。
  //
  // 完了後は、対象の星たちの position を aTarget の値で焼き込み固定する
  // (=これらの星は以後うごかない)。同時にuProgressを0へ戻すので、続けて
  // 別のindices集合に新しい収束先を割り当てれば、既に固定された星に影響を
  // 与えずに「次の形」への収束を始められる。
  function morphStarsToPoints(indices, worldPoints, { duration = 10, ease = 'power2.inOut', onUpdate, onComplete } = {}) {
    if (indices.length === 0 || worldPoints.length === 0) {
      if (onComplete) onComplete();
      return null;
    }
    const tgtArr = targetAttr.array;
    const actArr = activeAttr.array;
    indices.forEach((idx, i) => {
      const p = worldPoints[i % worldPoints.length];
      // aTargetはこのPointsメッシュのローカル座標系(=頂点シェーダーでpositionと
      // 直接mixされる)なので、渡されたワールド座標をここでローカルへ変換しておく。
      // (starsメッシュ自体が回転しているとズレるため必須。収束開始前に
      // setRotationEnabled(false)で自転を止めておくことと対で機能する)
      const local = stars.worldToLocal(p.clone());
      tgtArr[idx * 3]     = local.x;
      tgtArr[idx * 3 + 1] = local.y;
      tgtArr[idx * 3 + 2] = local.z;
      actArr[idx] = 1;
    });

    targetAttr.needsUpdate = true;
    activeAttr.needsUpdate = true;

    const state = { t: 0 };
    return gsap.to(state, {
      t: 1,
      duration,
      ease,
      onUpdate: () => {
        material.uniforms.uProgress.value = state.t;
        if (onUpdate) onUpdate(state.t);
      },
      onComplete: () => {
        // 焼き込み: 今回動かした星のposition自体をaTargetの値で上書き。
        // これで position === aTarget になるため、以後uProgressが変化しても
        // この星たちは動かない(=次の形の収束に巻き込まれない)。
        const posArr = positionAttr.array;
        const frmArr = formedAttr.array;
        indices.forEach((idx) => {
          posArr[idx * 3]     = tgtArr[idx * 3];
          posArr[idx * 3 + 1] = tgtArr[idx * 3 + 1];
          posArr[idx * 3 + 2] = tgtArr[idx * 3 + 2];
          actArr[idx] = 0;  // このアニメは終わったのでactiveは解除
          frmArr[idx] = 1;  // 代わりにformedを立てる(=以後ずっとシャープな小さいドットに固定)
        });
        positionAttr.needsUpdate = true;
        activeAttr.needsUpdate = true;
        formedAttr.needsUpdate = true;
        material.uniforms.uProgress.value = 0; // 次の割当のためにリセット(焼き込み済みの星は無影響)
        if (onComplete) onComplete();
      }
    });
  }

  // 星空全体のゆるやかな自転。収束が始まったら止める(=ψ/=の形がカメラに対して
  // 固定されている必要があるため。数式本体がcamera.addされているのと同じ理由)。
  let rotationEnabled = true;
  function setRotationEnabled(enabled) {
    rotationEnabled = enabled;
  }

  // 指定した星たち(indices)を「ψを構成する星」としてマークする。
  // これらはfadeGlyph()を呼ぶとuPsiFadeに応じてフェードアウトする対象になる
  // (=最終的に本物のpsi.pngスプライトへすり替える際に使う)。
  function markAsGlyph(indices) {
    const arr = isPsiAttr.array;
    indices.forEach((idx) => { arr[idx] = 1; });
    isPsiAttr.needsUpdate = true;
  }

  // markAsGlyph()でマークした星たちを、duration秒かけてフェードアウトする
  // (uPsiFadeを0→1にアニメーション)。呼び出し側は同時に本物のpsi.pngスプライトを
  // フェードインさせることで、星の集合体→PNGへのクロスフェードになる。
  function fadeGlyph(duration = 3, onComplete) {
    const state = { t: material.uniforms.uPsiFade.value };
    return gsap.to(state, {
      t: 1,
      duration,
      ease: 'power1.inOut',
      onUpdate: () => { material.uniforms.uPsiFade.value = state.t; },
      onComplete,
    });
  }

  return {
    mesh: stars,
    count,
    update(time) {
      material.uniforms.uTime.value = time;
      if (rotationEnabled) stars.rotation.y = time * 0.005;
    },
    pickUnassigned,
    remainingCount,
    morphStarsToPoints,
    setRotationEnabled,
    markAsGlyph,
    fadeGlyph,
  };
}