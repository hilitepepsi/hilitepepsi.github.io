import * as THREE from 'three';
import { MIRROR_APEX_HEIGHT, BANANA_HEIGHT_ABOVE_APEX, revealCrossfadeRingDrawing } from './record.js';
import { PHASE_SWAP_END } from './config.js';
import { TRIPOD_GROUND_Y, RING_DOWN_Y, setIhFade } from './universe.js';

// ══════════════════════════════════════════════════════════════
// ── 切り替え時の座標入れ替え: tripod ⇄ 鏡tripod / リング ⇄ バナナの高さ ─────
// ══════════════════════════════════════════════════════════════
//
// ★ 2026-09-11 設計変更(ご指示反映): 「カメラは一切動かさない(銀河などの背景を
//   完全に固定表示しておきたいため)」という方針に合わせて、この演出のロジックを
//   丸ごと書き換えた。
//
//   これまでは、スクロールに合わせてtripod自体をgroundYまで降下させ、それと
//   歩調を合わせるためにカメラも振り向ける(controls.targetを動かす)必要があった。
//   しかし疑似正射影(狭FOV)のカメラだと、カメラを動かした瞬間に手前のtripod/リング
//   だけでなく、画面奥の銀河(天の川)まで一緒にズレて見えてしまう。銀河はこの演出の
//   「外側」にあるべき背景なので、これは避けたい。
//
//   そこで方針を反転させた: カメラ側では一切吸収せず、tripod・リング・鏡tripodの
//   3者だけで完結させる。
//     - tripod(universe.tripodAnchor)は、この演出の間ずっとREST_Y(後述)に固定。
//       もう降下アニメーションはしない=常時「鏡tripodと同じ場所」に居続ける。
//     - 鏡tripod(record.mirrorVisualAnchor。バナナはその子)も同じREST_Yに固定
//       (以前からの設計のまま、変更なし)。
//     - 動くのはリング(record.js側の専用リング。crossfadeRing)だけ。REST_Y(下=carousel側)⇔
//       バナナの高さ(上=鏡側)の間を、record.viewMixCurrentのスクロール量に応じて
//       上下させる。
//   tripodと鏡tripodは常に同じ場所(REST_Y)に重なっているので、この2つのvisibleを
//   入れ替えるだけで交代演出が成立する(下記updateTripodRingSwap参照)。
//
// ★ 2026-09-12 追加(ご指示反映その1): 一時期、tripod⇔鏡tripodの切り替えをopacityの
//   クロスフェードにしていたが、「フェード仕様を撤廃してほしい」とのご指示により撤去した。
//   以前(クロスフェード導入前)と同じ、swapT>=1を境にしたvisibleの瞬時トグルに戻して
//   ある(下記updateTripodRingSwap参照)。
//
// ★ 2026-09-12 追加(ご指示反映その2): 「クロスフェード中、2つの同じ立体(tripodと
//   鏡tripod)が必ず同じ角度になっているようにしてほしい」への対応。以前は
//   record.js側でmirrorVisualAnchorを「独自に」自転させていたが、起動タイミングの差
//   (tripodはuniverse.isActiveになった瞬間から回転、鏡tripodはそこから約1秒遅れる
//   startRecordDisplay以降にしか回転しない)によって固定の角度ズレが生じていた
//   (詳細はrecord.js側の該当コメント参照)。ここで毎フレーム
//   record.mirrorVisualAnchor.quaternion.copy(universe.axesGroup.quaternion) して
//   しまうことで、鏡tripodの向きを「本物のtripodの現在の向きの複製」にし、速度や
//   タイミングに関係なく常に完全一致させる。
//
// ★ 2026-09-15 追加(ご指示反映): 「バナナクリック後の一連の演出(戴冠→リング拡大→
//   リング消滅)が終わったら、tripod⇔鏡tripodの切り替え自体はもう使わない(その後の
//   スクロールは別の用途=銀河俯瞰に転用する)」との方針変更。この演出はあくまで
//   「バナナクリックが起きるまで」の一度きりの片道切符として扱い、record.js側の
//   演出完了(onRingContact)を合図に finishTripodRingSwap() を呼んで、carousel側
//   (tripod表示・鏡tripod非表示・リングは等倍で下限に固定)へ強制的に戻し、以後は
//   updateTripodRingSwapを呼んでも何もしない「done」状態に固定する。
//   ★ 2026-09-17 再実装(ご指摘反映): 以前はrecord.js側のgrowGoldenRing/hideGoldenRingが
//   このモジュールが管理しているのと同じuniverse.goldenRing(carouselの飾りリング)を
//   直接操作しており(拡大→opacity0で非表示)、そのせいで「carousel状態に戻したつもりの
//   リング」が拡大・消滅したままになる、ihの高さもおかしくなる、という不具合が起きて
//   いた(今回ご指摘いただいた不具合)。record.js側に戴冠演出専用のリング
//   (crossfadeRing)を新設してそちらへ役割を完全に移したため、universe.goldenRingは
//   もう戴冠演出からは一切触られない。finishTripodRingSwapはtripod・crossfadeRingを
//   もとの状態(carousel側)へ戻すだけでよく、universe.goldenRingについては何もする
//   必要がなくなった(常にもとの位置・見た目のまま安定している)。
//
// ── REST_Y(tripod・鏡tripodの高さ)/ RING_DOWN_Y(リングの下限)について ──────
//   ★ 2026-09-11 再修正(ご指示反映): 「carousel時の高さを5下げる」対応はいったん撤回。
//   tripod・鏡tripod自体はuniverse.js側のTRIPOD_GROUND_Y(=0。tripod終端3点が乗る
//   「地面」)にそのまま固定する(以前あったREST_Y_DROPは削除)。構図の余裕はここではなく、
//   カメラを離す・角度を水平寄りにする方向(config.jsのUNIVERSE_CAMERA_POS/TARGET)で
//   調整する方針に変更した。
//   ★ 2026-09-11 追加(ご指示反映): 「リングの下限だけ、もう10下げたい」とのことなので、
//   リングの下側(carousel側)の着地点だけを別定数RING_DOWN_Yに切り出し、TRIPOD_GROUND_Yから
//   さらに10下げた。tripod・鏡tripod(REST_Y)はTRIPOD_GROUND_Yのまま変えていないので、
//   リングだけが他の2つより低い位置から上昇してくる見え方になる。
//   ★ tripodHitMesh・roofParticlesなど、この演出と無関係な他の要素は今まで通り
//   TRIPOD_GROUND_Y(=0)基準のままなので、ここを変えても影響しない
//   (universe.js側は一切変更していない)。
const REST_Y = TRIPOD_GROUND_Y;
// ★ 2026-09-18 修正(ご指摘反映): リングの下限(RING_DOWN_Y)は、ihの高さ計算からも
//   直接参照したくなったため、このファイル内のローカル定数ではなくuniverse.js側で
//   一元管理する定数(TRIPOD_GROUND_Yのすぐ下で定義)に変更した。値そのものを調整
//   したい場合はuniverse.js側のRING_DOWN_DROPを編集してください(以前16→14。
//   「リングの下限をほんの少し高く」というご指示への対応)。

// ★ 2026-09-17 修正(ご指摘反映): 「なぜTRIPOD/IH/下側リングの座標を使い回さず、
//   わざわざ新しい定数(CAROUSEL_FINAL_DROP・RING_EXTRA_LIFT)を足しているのか」との
//   ご指摘の通りで、finishTripodRingSwapは「演出開始前と同じ、当初の配置に戻す」
//   だけでよかった。tripodAnchor・goldenRingはどちらも作成時点で既に正しい高さ
//   (tripodAnchor→原点=REST_Y、goldenRing→universe.js側のmakeGoldenRingが
//   position.set(0, TRIPOD_GROUND_Y, 0)を設定済み)なので、finishTripodRingSwap内で
//   個別に下げ幅・引き上げ幅を計算し直す必要はなく、その「当初の値」へ戻すだけで
//   よい。ih(ihSprite)もuniverse.js側でgoldenRing.position.yを毎フレーム参照する
//   式になっているため、goldenRingさえ正しい高さに戻せば自動的に追従する
//   (=ihだけ個別に何か設定する必要はない)。これによりCAROUSEL_FINAL_DROP /
//   RING_EXTRA_LIFTの2定数は不要になったため削除した。

// ★ 2026-09-12 再修正(ご指示反映):「単純にリングが下限にあるときだけihが存在する
//   ようにしてほしい。中間位置のリングでもihが見えているのが気になる(屋根の粒子と
//   視覚的にぶつかる)」への対応。以前はrevealIh/hideIhを時間(秒)で駆動する独立の
//   フェードにしていたが、そのフェード秒数の間にリング自体は中間位置まで進んでしまい、
//   結果的に中間位置でもihがまだ薄っすら見えてしまっていた。
//   そこで「時間」ではなく「リングが今どれだけ下限に近いか(swapT)」だけを毎フレーム
//   直接不透明度に反映する方式に変更した。IH_EDGE_FADE_RANGEというごく狭い範囲だけで
//   フェードし、それ以外(中間位置を含む全域)ではopacity=0・非表示になる。
const IH_EDGE_FADE_RANGE = 0.05; // 仮値。下限(swapT=0)からこの範囲内だけihをフェード表示する

// 0〜1の範囲でt(record.viewMixCurrent)を[a,b]の区間に対して正規化する(a未満は0、b超は1)。
function remap01(t, a, b) {
  return THREE.MathUtils.clamp((t - a) / (b - a), 0, 1);
}

// scene/universe/record: それぞれcreateScene的な処理・createUniverse・createRecordDisplayで
// 既に作成済みのインスタンスをそのまま渡す(このファイルでは新規作成しない)。
export function createTripodRingSwap(scene, universe, record) {
  // 表示権はこのモジュールが一元管理する。初期状態は必ず「tripod側」から始める
  // (record.js側で誤ってvisible=trueにされていても、ここで確実に隠しておく)。
  record.mirrorVisualAnchor.visible = false;
  universe.tripodAnchor.visible = true;

  // バナナの高さ(REST_Y + 頂点 + バナナの上乗せ分)。record.js側の設計上、
  // mirrorVisualAnchorは常にREST_Yに固定されるため、これはスクロール量に関係なく
  // 最初から最後まで一定の値になる(=毎フレーム計算し直す必要はない)。
  const bananaY = REST_Y + MIRROR_APEX_HEIGHT + BANANA_HEIGHT_ABOVE_APEX;

  return {
    universe,
    record,
    restY: REST_Y,
    ringDownY: RING_DOWN_Y,
    bananaY,
    swapped: false, // swapT>=1(鏡tripod側へ完全に切り替わった)かどうか。今のところ他ファイルからは未参照
    done: false, // ← 2026-09-15追加: finishTripodRingSwap済みかどうか。true以降、updateTripodRingSwapは何もしない
  };
}

// 毎フレーム呼ぶ(main.jsのレンダーループから、updateRecordDisplay(...)の後で)。
// record.phase==='inactive'の間はrecord.viewMixCurrentが常に0のままなので、呼んでも
// 見た目は変化しない(リングがringDownYのまま、tripod/鏡tripodも常にrestYで静止している)。
// ★ 2026-09-15追加: finishTripodRingSwap済み(swap.done)の場合は即return。以後この
//   スワップ演出自体が「終わった」ものとして扱い、record.viewMixCurrentがどう動いても
//   (=どうせもうscroll用途が変わって動かないはずだが、念のため)carousel側の見た目を
//   上書きされないようにする。
export function updateTripodRingSwap(swap, camera) {
  if (swap.done) return;
  const { universe, record, restY, ringDownY, bananaY } = swap;
  const t = record.viewMixCurrent; // 0=carousel側 / 1=鏡側。record.js側のスクロール補間をそのまま流用する
  const swapT = remap01(t, 0, PHASE_SWAP_END);

  // ── ih.pngの出現/消滅(ご指示反映): 「リングが下限にあるときだけ存在する」という
  //   シンプルな条件に変更。swapTが下限(0)からIH_EDGE_FADE_RANGE以内のごく狭い区間だけ
  //   フェード表示し、それ以外(中間位置・鏡側含む全域)では常にopacity=0・非表示にする。
  //   tripodがまだクリックされていない(tripodRingRevealed=false、リング自体が未形成)間は
  //   常に非表示。
  const ihFade = universe.tripodRingRevealed
    ? 1 - remap01(swapT, 0, IH_EDGE_FADE_RANGE)
    : 0;
  setIhFade(universe, ihFade);

  // ── tripod: この演出中ずっとREST_Yに固定する(もう降下アニメーションはしない)。
  //   liftTripod(tripodの浮上。axesGroup.position.yを直接動かす、別機能)がまだtween中の
  //   可能性があるので、その分を毎フレーム打ち消してREST_Yへ引き戻す(=常に「liftされて
  //   いないのと同じ高さ」に固定され続ける)。
  const descendedAnchorY = restY - universe.axesGroup.position.y;
  universe.tripodAnchor.position.set(0, descendedAnchorY, 0);

  // 鏡tripod(+バナナ。その子なので一緒に動く)も、tripodと同じREST_Yに常に固定しておく。
  // x・zは常に0(鏡tripod側はもともとx,z=0に矯正済みなので、ここでも0に保つ)。
  record.mirrorVisualAnchor.position.set(0, restY, 0);

  // ── 角度の同期(ご指示反映): 本物のtripod(universe.axesGroup)の「現在の向き」を
  //   そのまま鏡tripodへ複製する。速度・タイミングに依存する積算方式をやめたことで、
  //   切り替え(visibleの瞬時トグル)の前後を含め常に両者が完全に同じ角度になる。
  record.mirrorVisualAnchor.quaternion.copy(universe.axesGroup.quaternion);

  // ── リング: このモジュールの中で唯一動く要素。RING_DOWN_Y(carousel側=下)→バナナの
  //   高さ(bananaY=鏡側=上)の間を、record.viewMixCurrentのスクロール量(swapT)に応じて
  //   上下させる。カメラは一切動かさないので、この上下移動がそのまま画面上の見た目の
  //   変化になる(=tripod・鏡tripodは静止したまま、リングだけが動いて見える)。
  // ★ 2026-09-17 変更(ご指摘反映): 以前はuniverse.goldenRing(carouselの飾りリング)を
  //   直接動かしていたが、record.js側の戴冠演出(旧growGoldenRing/hideGoldenRing)と
  //   衝突していたため、この演出専用のrecord.crossfadeRingへ役割を移した。
  //   ★ 2026-09-17 再訂正: 「太陽系のらせん軌道サイズまで拡大→消える」戴冠演出も、
  //   このcrossfadeRing自身が担う(新しい別リングを下に発生させるのではない。ご指摘の
  //   通り、拡大するのはもともと上にあるこのリング自身)。
  //   crossfadeRingの可視化(1回だけ)は、ご指示反映で「一周描きながら出現する」
  //   演出(revealCrossfadeRingDrawing。record.js側で定義)に変更した。
  const ring = record.crossfadeRing;
  if (universe.tripodRingRevealed && !ring.visible) {
    revealCrossfadeRingDrawing(ring, camera);
  }
  ring.position.set(0, THREE.MathUtils.lerp(ringDownY, bananaY, swapT), 0);

  // ── tripod⇔鏡tripodの切り替え(ご指示反映: フェード仕様を撤廃し、以前の瞬時トグルに
  //   戻した)。swapT>=1(=鏡側へスクロールし切った)を境に、見た目をそのまま入れ替える。
  // ★ 2026-09-16 追加(バグ修正): 「バルジが出現していない」への対応。戴冠演出中
  //   (record.coronationLockVisible)は、スクロールの値(swapT)に関わらず鏡tripod側
  //   (mirrorVisualAnchor。バナナ・王冠・バルジの親)を強制的に表示し続ける。以前は
  //   演出中にswapTが1未満へ戻ると、その子であるバルジ等ごと非表示にされてしまっていた。
  const swapped = record.coronationLockVisible ? true : swapT >= 1;
  universe.tripodAnchor.visible = !swapped;
  record.mirrorVisualAnchor.visible = swapped;
  swap.swapped = swapped;
}

// ── 2026-09-15 追加: バナナクリック後の演出(戴冠→リング拡大→リング消滅)が完了した
//    瞬間に呼ぶ。record.js側(playNeedleSequence内のonRingContact)から、record.
//    onSequenceCompleteフック経由で呼ばれる想定(main.js側の配線を参照)。
//
//    以後このスワップ演出はもう使わない片道切符なので、carousel側(tripod表示・
//    鏡tripod非表示)へ強制的に確定させ、doneフラグを立ててupdateTripodRingSwapを
//    無効化する。
//
//    ★ 2026-09-17 簡略化(ご指摘反映): 戴冠演出の「拡大→消滅」はcrossfadeRing自身が
//    担うため(record.js側参照)、universe.goldenRingのscale/opacity/positionを個別に
//    戻す処理はもとから不要(常にもとのままで安定している)。crossfadeRingは通常
//    hideCrossfadeRingのonComplete時点で既にvisible=falseになっているはずだが、
//    念のためここでも明示的に隠しておく。
//    ★ 2026-09-17 バグ修正(ご指摘反映): 「バナナ消滅後のcarouselの位置が高い」の
//    原因は、ここでtripodAnchorをrestYへ戻す際にliftTripod分(axesGroup.position.y)を
//    差し引いていなかったこと。updateTripodRingSwapが毎フレーム行っているのと同じ式
//    (restY - axesGroup.position.y)に揃えた(下記参照)。
export function finishTripodRingSwap(swap) {
  if (!swap || swap.done) return;
  swap.done = true;
  const { universe, record, restY, ringDownY } = swap;

  // ★ 2026-09-17 修正(ご指摘反映): 「バナナ消滅後のcarouselの位置が高い」バグの
  //   修正。以前はここで単純にuniverse.tripodAnchor.position.set(0, restY, 0)して
  //   いたが、これは「liftTripod(universe.js側。tripodの浮上演出。axesGroup.position.y
  //   を直接動かす、別機能)が一度も起きていない」前提の式だった。実際にはcarouselが
  //   通常成立する過程でliftTripodが既に呼ばれ、axesGroup.position.yがTRIPOD_LIFT_HEIGHT
  //   まで上がった状態になっている。tripodAnchorとaxesGroupは親子関係にあり、画面上の
  //   見た目の高さは両者の合計(tripodAnchor.position.y + axesGroup.position.y)になる
  //   ため、tripodAnchor側だけをrestYに戻すと合計がrestY+TRIPOD_LIFT_HEIGHTになって
  //   しまい、本来の高さより高く見えていた。
  //   tripodシステムでcarouselが成立するとき(=上のupdateTripodRingSwapが毎フレーム
  //   行っている)と同じ式(descendedAnchorY = restY - axesGroup.position.y)を
  //   ここでも使い、liftTripod分をきちんと打ち消す。
  universe.tripodAnchor.position.set(0, restY - universe.axesGroup.position.y, 0);
  universe.tripodAnchor.visible = true;
  record.mirrorVisualAnchor.visible = false;

  // crossfadeRing(carousel⇔鏡の引き継ぎ+戴冠演出の拡大縮小を兼ねるリング)の
  // 後始末(念のための安全策。通常は既にhideCrossfadeRingのonCompleteで
  // visible=false・opacity=0になっているはず)。
  gsap.killTweensOf(record.crossfadeRing.material);
  if (record.crossfadeRing.userData.radiusTween) record.crossfadeRing.userData.radiusTween.kill();
  record.crossfadeRing.visible = false;
  record.crossfadeRing.material.opacity = 0;

  // ★ 2026-09-17 追加(バグ修正に伴う対応): crossfadeRingが担っていた「carouselの
  //   リング」の見た目を、ここでuniverse.goldenRingへ引き継ぐ。tripodクリックの
  //   瞬間からここまではcrossfadeRingだけが可視化されていた(goldenRingは
  //   revealTripodRingではもう触らないようにしたため、ここまでずっと非可視のまま)。
  //   以後(=このcarousel再登場〜銀河俯瞰画面)はgoldenRingがmain.js側の俯瞰時の
  //   表示切り替え対象になるので、ここで確実に可視・不透明にしておく。
  // ★ 2026-09-17 修正(ご指摘反映): 「鏡面リングの出現位置は、tripodスワップシステム
  //   での最下限位置(ringDownY)に出現させて」への対応。以前はuniverse.goldenRingの
  //   生成時の位置(TRIPOD_GROUND_Y)のまま何もしていなかったが、ここで明示的に
  //   ringDownY(crossfadeRingが下限として使っているのと同じ値。ih が carousel の
  //   屋根にぶつからないよう、universe.js側のRING_DOWN_DROPで下げてある)へ移動させる。
  universe.goldenRing.visible = true;
  universe.goldenRing.material.opacity = 1;
  universe.goldenRing.position.set(0, ringDownY, 0);

  // ihはcarousel側の通常表示(常時フル不透明)に戻す。ihUnlocked===falseのままなら
  // setIhFade内部の判定でどのみち非表示になるので、ここで一律1を渡してよい。
  setIhFade(universe, 1);

  // ★ 2026-09-16 追加(ご指摘反映): 「数式も出現させて」への対応。数式スプライトは
  //   axesGroup(→tripodAnchor)の子なので本来tripodAnchor.visible=trueに連動して
  //   出現するはずだが、念のため現在選択中のスプライトを明示的に可視・不透明へ
  //   戻しておく(hover演出やtweenの状態が残っていても確実に見えるようにするため)。
  const currentSprite = universe.sprites && universe.sprites[universe.equationIndex];
  if (currentSprite) {
    if (currentSprite.material) {
      gsap.killTweensOf(currentSprite.material);
      currentSprite.material.opacity = 1;
    }
    currentSprite.visible = true;
  }

  swap.swapped = false;
}

// TODO:
//   - PHASE_SWAP_END・IH_EDGE_FADE_RANGEはどちらも仮値です。見た目を見ながら調整してください。
//   - RING_DOWN_DROP(=14。universe.js側で定義)も仮値です。リングのcarousel側の下限を
//     TRIPOD_GROUND_Yからどれだけ下げるか、見た目を見ながら調整してください。
//   - tripodHitMesh(tripodクリック判定用、universe.js側でsceneに直接addされておりtripodAnchorの
//     子ではない)は今回動かしていません。鏡側表示中にtripodHitMeshへのクリック判定が
//     残ってしまう可能性があるので、必要であれば main.js側でswap.swappedを見て
//     判定自体をスキップするなどの対応を検討してください。
//   - カメラは今回の変更でこのファイル・record.js双方から完全に触らなくなりました
//     (UNIVERSE_CAMERA_POS/TARGETに入ったまま、ユーザーの手動ドラッグ以外では動きません)。
//     「tripod/リングの位置を交代させたのに構図が窮屈」等が起きた場合は、REST_Yをここで
//     いじるのではなく、config.js側のUNIVERSE_CAMERA_POS/TARGET(カメラの距離・角度)を
//     調整する方向で対応してください。
//   - finishTripodRingSwap()は片道切符です(doneフラグはfalseへ戻す手段を用意していません)。
//     再度carousel⇔鏡の切り替えを使い直したい場合は、swap.doneをfalseに戻すリセット関数を
//     別途追加してください。