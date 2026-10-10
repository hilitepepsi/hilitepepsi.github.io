import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { TUNE } from './config.js';

// banana.glb を読み込む。
// Blender側の命名規則: 全体メッシュ = "Banana_Whole", 破片群 = "Shard", "Shard.001", "Shard.002"...(Blenderの重複命名はドット区切り)
const SHARD_NAME_RE = /^Shard\d*$/;

function upgradeToGlass(material) {
  // すでにKHR_materials_transmissionが読み込まれていれば(GLTFLoaderがMeshPhysicalMaterial.transmissionに変換済み)、そのまま使う
  if (material && material.isMeshPhysicalMaterial && material.transmission > 0) {
    return material;
  }
  // transmissionが無い場合のみ、three.js側でガラス風に上書きするフォールバック
  console.log('transmissionが検出できなかったため、フォールバックのガラスマテリアルを適用します:', material?.name);
  return new THREE.MeshPhysicalMaterial({
    color: material?.color ? material.color.clone() : new THREE.Color(0xeaffef),
    transmission: 0.9,
    roughness: 0.06,
    thickness: 0.6,
    ior: 1.45,
    clearcoat: 0.3,
    transparent: true,
  });
}

// ── ガラスのバナナ(Blender製 banana.glb) ──
// 読み込みは非同期のため、`state.mesh` / `state.shards` はglb読み込み完了時に差し替わる。
// 呼び出し側は必ず state 経由(state.mesh.xxx)で参照すること。
export function createBanana(scene) {
  const state = {
    mesh: new THREE.Group(), // glb読み込み完了までの空プレースホルダー(見た目には何も出ない)
    shards: [],
  };

  new GLTFLoader().load(
    './assets/obj/banana.glb',
    (gltf) => {
      const whole = gltf.scene.getObjectByName('Banana_Whole');
      let loadedShards = [];
      gltf.scene.traverse(obj => {
        if (obj.isMesh && SHARD_NAME_RE.test(obj.name)) loadedShards.push(obj);
      });

      if (whole) {
        scene.remove(state.mesh);
        whole.material = upgradeToGlass(whole.material);
        state.mesh = whole;
        scene.add(state.mesh);
        console.log('Banana_Whole material:', state.mesh.material.type, 'transmission=', state.mesh.material.transmission);
      }

      if (loadedShards.length) {
        // 破片数が多すぎる場合は間引く(描画コストを抑える)。爆散の見た目はランダム抽出でも十分成立する
        if (loadedShards.length > TUNE.maxActiveShards) {
          loadedShards = loadedShards
            .sort(() => Math.random() - 0.5)
            .slice(0, TUNE.maxActiveShards);
        }
        state.shards = loadedShards;
        state.shards.forEach(s => {
          s.material = upgradeToGlass(s.material);
          s.userData.homePosition = s.position.clone();
          s.visible = false;
          if (!scene.children.includes(s)) scene.add(s);
        });
      }
      console.log(`banana.glb 読み込み成功: whole=${!!whole}, 使用する破片数=${state.shards.length}(元は${loadedShards.length}個検出)`);
    },
    undefined,
    () => console.error('banana.glb の読み込みに失敗しました')
  );

  function triggerShatter() {
    state.shards.forEach(s => {
      const home = s.userData.homePosition || new THREE.Vector3(0, 0, 0);
      s.position.copy(home);
      s.rotation.set(0, 0, 0);
      s.scale.setScalar(1);
      if (s.material) s.material.opacity = 1;
      s.visible = true;

      // -Z方向への指向性爆散(宇宙の運動法則):
      // xy方向には広がるが、zは常に負方向。円錐状に-Zへ吹き飛ばす
      const dir = new THREE.Vector3(
        (Math.random() - 0.5) * 0.9,
        (Math.random() - 0.5) * 0.9,
        -(0.6 + Math.random() * 0.5) // 常に負、かつ支配的な成分
      ).normalize();
      const dist = 100 + Math.random() * 70; // 飛距離を大幅アップ(旧:1.5〜4.0 → 新:4〜11)
      const dur = 0.8 + Math.random() * 0.6; // 個体差を出して同時着地感を消す

      gsap.to(s.position, {
        x: home.x + dir.x * dist,
        y: home.y + dir.y * dist,
        z: home.z + dir.z * dist,
        duration: dur,
        ease: 'power2.out'
      });
      gsap.to(s.rotation, {
        x: Math.random() * 12 - 6,
        y: Math.random() * 12 - 6,
        z: Math.random() * 12 - 6,
        duration: dur,
        ease: 'power1.out'
      });
      // opacityではなくscaleで消す(透過破片が重なるとソート崩れが出やすいため)
      gsap.to(s.scale, {
        x: 0, y: 0, z: 0,
        duration: 0.5,
        delay: dur * 0.55,
        onComplete: () => { s.visible = false; }
      });
    });
  }

  return { state, triggerShatter };
}