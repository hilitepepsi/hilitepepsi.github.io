import * as THREE from 'three';
import { TRIPOD_RADIUS } from './universe.js';
import { SUN_ORBIT_PERIOD } from './solarSystem.js';

// ══════════════════════════════════════════════════════════════
// ── 「天の川銀河」: 宇宙ページ(universe.js)のtripod直下に浮かぶ巨大な銀河 ──
// ══════════════════════════════════════════════════════════════
//
// 仕様(ご指示より):
//   - WebGLRenderer前提(WebGPU/TSLは使わない)。位置はJS側で一度だけ計算して
//     BufferGeometryに焼き込み、描画だけGPUに任せる古典的な渦巻き銀河ジェネレーターの手法
//     (Bruno Simon式のアルゴリズム)。見た目重視とのことで8万パーティクル。
//   - solarSystem.jsのORBIT_CENTER(tripod直下・太陽系の公転軌道の中心)と同じ点を
//     銀河の中心として再利用する(main.js側でimportして渡す)。太陽系(太陽・8惑星・
//     軌跡・ih)とは別レイヤーとして共存させる。
//   - サイズは「巨大」とのことなので、tripodの回転軌道半径(TRIPOD_RADIUS)を基準に
//     その数倍の半径を持たせ、tripod・太陽系をまるごと包み込むスケール感にしてある。
//   - カメラから見えていなくてよいとのことなので、登場は太陽系(solarSystem.js)と
//     同じ扱い ── 宇宙ページ到達と同時に、フェードや拡大なしでいきなりフルサイズ
//     表示する(revealGalaxy)。以後、明示的に操作しない限り常にフルサイズのまま
//     (銀河そのものの拡大・縮小演出は廃止済み。詳細は末尾のTODO参照)。
//   - ★ 2026-09-14: 中心の棒状バルジ(バー+コア)は撤去した。「バルジが登場する」
//     演出はrecord.js側の戴冠シーケンス(バナナ消滅→バルジがフェードイン→針→太陽系召喚)
//     が本来の担当であり、あちらは意図通り最初は隠れていて、演出のタイミングで初めて
//     フェードインする。ところがこちらgalaxy.js側にも同じ見た目のバー+コアを銀河本体に
//     常設で焼き込んでいた(2026-09-13追加分)ため、宇宙ページに着いた瞬間から
//     revealGalaxyで銀河ごと即座にフル表示されてしまい、「バルジは演出で登場するはず
//     なのに最初から見えている」という状態になっていた。この銀河本体側の常設バルジを
//     削除し、円盤(渦巻き)だけの銀河に戻すことで、バルジの「登場」はrecord.js側の
//     演出だけが担う形に一本化した。
//   - 銀河の中心には何も置かない(旧・銀河本体のバナナ/クリックでの収束演出は削除済み。
//     現在の「バナナ」はrecord.js側にある、鏡三角錐の頂点に乗る別インスタンス)。
//
//   - ★ 2026-10-25 変更(ご指示反映): 銀河の「育ち」を「減り」に変更。最初は「一本の渦巻きの溝」が
//     びっしり巻いたレコード盤の見た目で、訪問者のクリックで星が減るほど、溝がほどけて複数の腕を
//     もつ銀河の形へ変わり、最後は星がすべてなくなってバルジだけが残る(詳細は下の
//     GALAXY_RECORD_* / GALAXY_MORPH_* と、setGalaxyGrowthの注釈を参照)。
//
// main.js側の想定される呼び出し方:
//   import { createGalaxy, revealGalaxy, updateGalaxy } from './galaxy.js';
//   const galaxy = createGalaxy(scene, GALAXY_ANCHOR); // createSolarSystemの近くで1回
//   // enterUniverse()完了時など、宇宙ページに入ったタイミングで(solarSystemと同時):
//   revealGalaxy(galaxy);
//   // 毎フレームのレンダーループ内:
//   updateGalaxy(galaxy, deltaSeconds);
//   // record.js側の戴冠演出(playNeedleSequence)が銀河を一時的に高速回転させたいときは、
//   // galaxy.needleSpinActiveをtrue/falseに切り替えるだけでよい(updateGalaxy側が見る)。

// ── 銀河の形状パラメータ(仮値。見ながら調整してください) ──────────────
// ★ 修正(ご指摘反映): 「銀河を10倍にしたら密度が足りなくなった」への対応。面積は
//   半径の2乗で増えるので、理論上は粒子数も100倍(80,000→800万)必要になる。
//   ただし差動回転のCPUループをGPUへ移したとはいえ、メモリ(1粒子あたり約60バイトの
//   attributeなので100倍だと数百MB規模になる)やBloom・加算合成によるフィルレートへの
//   影響は未知数なので、まずは安全を見て10倍(80,000→800,000)にした。これで足りなければ、
//   パフォーマンスを見ながらさらに上げてください(GPU側の計算はO(1)なので、CPUループの
//   ボトルネックはもう心配しなくてよい)。
const GALAXY_PARTICLE_COUNT = 800000;
// ── 2026-09-28 追加(ご指摘反映): バルジ周辺の星の密度を上げるための「内側ブースト」粒子 ──
// 実際の銀河(特に棒渦巻銀河)では、星の面密度は中心ほど高く(円盤はほぼ指数関数的に、
// バルジ/バーはさらに濃く)、バルジのすぐ外側が「星の少ない空白のリング」になることはない。
// 一方この銀河の半径分布(pow(random,0.7))は、面密度が中心でもそこまで高くならず、
// さらにバルジ出現時の「穴」が(リマップ方式のため)縁で密度ゼロから始まっていた。
// そこで、円盤のバルジ寄り(GALAXY_INNER_BOOST_RMIN〜RMAX)に追加の粒を撒く。
// 追加粒はバルジ出現前は非表示で、穴の広がりと一緒にフェードインする(setGalaxyHole)。
// 半径分布は「RMINで最も濃く、RMAXへ向けて直線的に0へ」なので、元の円盤とは境目なく繋がる。
// ※ RMINは、バルジ出現時の穴の半径(record.jsのGALAXY_HOLE_RADIUS。銀河ローカルで
//    半径の約0.2倍)の少し内側に合わせてある。穴の大きさを変えたらここも合わせてください。
const GALAXY_INNER_BOOST_COUNT = 120000; // GALAXY_PARTICLE_COUNTと同じ比率(10倍)で増やした
const GALAXY_INNER_BOOST_RMIN_RATIO = 0.17; // GALAXY_RADIUSに対する比率(仮値)
const GALAXY_INNER_BOOST_RMAX_RATIO = 0.45; // 同上(仮値)
// 全粒子の合計(実際に描く数は、星がどれだけ減ったかで変わる)。
const GALAXY_FULL_PARTICLE_COUNT = GALAXY_PARTICLE_COUNT + GALAXY_INNER_BOOST_COUNT;
export const GALAXY_RADIUS = TRIPOD_RADIUS *80; // 「巨大」なので、tripod・太陽系をまるごと包む規模に(以前の2倍。仮値)
// ↑ record.js側がNEEDLE_START_RADIUS(針先=太陽の出発点を「銀河の周縁側」に置く)の
//   計算に参照するためexportした。
const GALAXY_BRANCHES = 9;          // 渦の腕の本数(銀河状態。レコード状態では全部が一本の溝に重なる)
// ★ 2026-10-25 変更(ご指示反映): 「訪問者のクリックで星が減り、最後はバルジだけになる」への対応。
//   以前の「腕3本から9本へ育つ」仕組み(GALAXY_ARM_SETS)は廃止し、最初から全粒子(下のTOTAL)を持つ。
//   育ち具合(ステップ数)が進むと、描画する粒子数(drawRange)が1個ずつ減っていく。
//   ・減る順番: 粒子はジオメトリ生成時に「腕の中心線からのブレ(GALAXY_RANDOMNESS)が小さい順」に
//     (GALAXY_REMOVAL_ORDER_BIASぶんだけ緩めて)並べてあり、末尾(=腕から外れがちな粒)から先に消える。
//     星が減るほど腕がくっきりして見える。
//   ・見た目の変化(レコード→銀河): 全粒子が「レコード状態」と「銀河状態」の2つの位置を持ち、
//     シェーダーが uMorph(0〜1)で混ぜる(VERTEX_SHADERのENABLE_DIFF_ROTATIONブロック)。
//       レコード状態 … 一本のアルキメデス渦(等ピッチ)に、GALAXY_RECORD_TURNS回巻いた溝として並ぶ
//       銀河状態     … 従来どおりの9本の腕(巻き量はGALAXY_SPIN)
//     混ぜるのは極座標(半径と角度)。粒ごとに、溝の角度を「腕の角度にいちばん近い2πの整数倍の側」へ
//     取り直してあるので(polyphony-space-10k.htmlのKKと同じ考え方)、粒の移動は最大でも半周で済み、
//     溝の巻き数(GALAXY_RECORD_TURNS)を増やしても、変形中に粒が振り回されない。
//     レコード状態の見た目(cos/sin)は、取り直しの前後で変わらない。
//   粒子は全部で下のGALAXY_TOTAL_PARTICLE_COUNT個。1クリックで消える数は
//   GALAXY_TOTAL_PARTICLE_COUNT ÷ CLICKS_TO_COMPLETE(galaxyGrowth.js)。
export const GALAXY_TOTAL_PARTICLE_COUNT = GALAXY_FULL_PARTICLE_COUNT;
// 内側ブースト粒(GALAXY_INNER_BOOST_COUNT/全体 = 3/23)を、全体に均等に混ぜる比率。
const GALAXY_BOOST_CYCLE = 23;
const GALAXY_BOOST_PER_CYCLE = 3;

// ── レコード状態(初期の見た目)のパラメータ(仮値。見ながら調整してください) ──────────
// 溝の巻き数。多いほど溝が細かく、レコードらしくなる(ただし画面上で溝の間隔が粒の大きさより
// 細かくなると、溝が見分けられず均一な円盤に見える。その場合は減らすか、粒を小さくする)。
const GALAXY_RECORD_TURNS = 96; // ★ 2026-10-25: 48→96(2倍)
// 溝が始まる内側の半径(GALAXY_RADIUSに対する比率)。バルジ出現時の穴(record.jsのGALAXY_HOLE_RADIUS、
// 約0.2倍)と合わせると、穴がそのままレコード中央のラベルの位置になる。
const GALAXY_RECORD_INNER_RATIO = 0.17;
const GALAXY_RECORD_GROOVE_WIDTH = 0.35; // 溝の太さ(溝の間隔=ピッチに対する比率。小さいほど細く鋭い)
const GALAXY_RECORD_EDGE_FADE = 0.02;    // 外周のふち。GALAXY_RADIUSに対するこの幅で消える(レコードは縁がくっきり)
// 曲と曲の間の「無音の帯」(半径の比率)。溝の粒がうすくなり、レコードの曲間に見える。[]で無効。
const GALAXY_RECORD_TRACK_GAPS = [0.40, 0.56, 0.70, 0.84];
const GALAXY_RECORD_TRACK_GAP_WIDTH = 0.012; // 無音の帯の半幅(GALAXY_RADIUSに対する比率)
const GALAXY_RECORD_TRACK_GAP_DIM = 0.12;    // 無音の帯での粒の濃さ(0=完全に消える、1=変えない)
// 星が減る割合(0〜1)に対する、レコード→銀河の変形の進み方。
// START以前はずっとレコード、ENDで完全に銀河の形になる(間はなめらか)。ENDを1に近づけるほど、
// 最後の最後まで変形が続く。
const GALAXY_MORPH_START = 0.0;
const GALAXY_MORPH_END = 0.97; // ★ 2026-10-28: 0.85→0.97。ここで変形は完了し、以降は「外周の星から」消える(下のGALAXY_PERIPHERY_FADE_RATIO・setGalaxyGrowth参照)
// 変形が終わった(=星が97%減った)あと、残りの星を「外周から内側へ」消していくときの、消える縁のぼかし幅
// (GALAXY_RADIUSに対する比率)。大きいほど縁がなだらかに薄れる。0に近いとくっきりした境目が走る。
const GALAXY_PERIPHERY_FADE_RATIO = 0.06;
// 星が消える順番の「腕からの遠さ」への偏り(0〜1)。1=腕から遠い粒から順に消える(最後は腕の芯だけが
// 残り、細い線になる)、0=完全にランダムに消える(腕の太さは保たれるが、腕はくっきりしにくい)。
const GALAXY_REMOVAL_ORDER_BIAS = 0.6;
// ★ バグ修正(ご指摘反映): 「銀河を巨大化したら渦の溝構造が見えず均質な円盤になった」
//   への対応。以前はspinAngle = radius(絶対座標) * GALAXY_SPIN * 0.02 という式で、
//   半径の「絶対値」に巻き付きが比例していた。GALAXY_RADIUSを10倍にしたことで、
//   外周の星のspinAngleも10倍(約2.4回転→約24回転)に膨れ上がり、隣り合う巻きが
//   互いに重なりすぎて渦の溝が見分けられなくなっていた(薄まったのではなく、
//   巻きすぎて潰れていた)。
//   GALAXY_SPINの意味を「中心(radius=0)から外周(radius=GALAXY_RADIUS)までの
//   総巻き数(ラジアン)」に変更し、半径をGALAXY_RADIUSで正規化してから掛けることで、
//   銀河の絶対サイズが変わっても見た目の巻き数が変わらないようにした(下のspinAngleの
//   計算を参照)。値は旧式でGALAXY_RADIUSが約117.6だった頃の外周でのspinAngle
//   (117.6 × -6.5 × 0.02 ≈ -15.3)と同じ巻き数になるよう再計算してある。
// ★ 2026-10-11 変更(ご指示反映): 「粒子数は変えずに、腕の巻き量を半減」。-15.3 → -7.65(約2.4周→約1.2周)。
//   粒子数(GALAXY_PARTICLE_COUNT等)は触っていない。符号(巻く向き)も同じ。
const GALAXY_SPIN = -7.65; // 中心→外周の総巻き数(ラジアン)。絶対サイズに依存しない(仮値。見た目を見ながら調整してください)
const GALAXY_RANDOMNESS = 0.75;     // 腕からのブレの強さ(半径に対する比率)
const GALAXY_RANDOMNESS_POWER = 4;  // 大きいほど「腕の近くに密集・稀に大きく外れる」分布になる
const GALAXY_FLATTEN = 0.25;        // 円盤の厚み(Y方向だけXZより浅くする比率)

const GALAXY_INSIDE_COLOR = new THREE.Color(0xffd9a0);  // 中心側。暖色(仮値)
const GALAXY_OUTSIDE_COLOR = new THREE.Color(0x3a6fd8); // 外側の腕。寒色(仮値)

// ★ バグ修正(ご指摘反映): 「銀河内から見た星が小さすぎる」への対応。頂点シェーダーで
//   `gl_PointSize *= (1.0 / -viewPosition.z)` という、カメラからの距離に反比例する
//   減衰をかけている(遠いほど小さく見える、通常の遠近感)。config.jsのUNIVERSE_CAMERA_
//   DISTANCEを10倍(1000→10000)にしたため、カメラが銀河から10倍遠くなり、この減衰だけで
//   星が画面上で約10倍小さく見えるようになっていた。基準サイズ側を10倍にして打ち消す。
export const GALAXY_POINT_SIZE = 680;      // Pointsの基準サイズ(カメラ距離10倍化を打ち消すため、以前の10倍。仮値。uSizeとして渡す)
// ★ バグ修正(ご指摘反映): 「銀河の星を大きくしたら近くだとまぶしい」への対応。
//   gl_PointSize *= (1.0 / -viewPosition.z) は距離に反比例するため、基準サイズを
//   10倍にすると「遠くから見た時に丁度いい」のと同時に「近くで見た時は10倍以上
//   オーバーに巨大化する」が両方同時に起きる(遠い場所での見え方を基準に逆算した
//   サイズなので、それより近い場所では常に大きすぎる)。これは露出(exposure)では
//   直せない——露出は画面全体を均一に明るく/暗くするだけなので、「遠くはちょうど良い・
//   近くは明るすぎる」という距離に依存した差を解消できず、結局「近くを基準に暗くすると
//   遠くも暗くなる」という妥協にしかならない(以前試して効果を感じなかったのはこれが理由)。
//   本当に直すべきは「画面上の大きさ」の方で、bulge(record.js側のBULGE_MAX_PIXEL_SIZE)
//   と同じ仕組みの上限クランプ(uMaxPixelSize)を星にも適用する。遠くの星は元々この上限より
//   小さいので影響を受けず、近くの星だけが上限で頭打ちになり、まぶしさが抑えられる。
const GALAXY_MAX_PIXEL_SIZE = 48;   // 画面上の見かけサイズの上限(px)。bulgeのBULGE_MAX_PIXEL_SIZEと同じ値にした(仮値)
// ★ 2026-10-11 追加(ご指示反映): 「銀河が明るすぎる」への対応。見える側の輝きレイヤー(FRAGMENT_SHADER)の
//   色に掛ける倍率(1.0=従来通り、小さいほど暗い)。バルジの明るさ(record.jsのBULGE_BRIGHTNESS)とは
//   独立した値で、どちらも単独で調整できる。実行中に変えたいときはsetGalaxyBrightness()を使う。
//   鏡用の不透明レイヤー(FRAGMENT_SHADER_OPAQUE)には掛けない(鏡の見え方を変えないため)。
const GALAXY_BRIGHTNESS = 0.6;      // 仮値。見た目を見ながら調整してください

// ── 2026-09-17 追加: 円盤の境界フェード ────────────────────
// 外周(および中心に穴をあけたときの内周)を、粒子ごとのalphaで滑らかに減衰させて
// 「縁がぷつりと切れる」のを防ぐ。値はGALAXY_RADIUSに対する比率(仮値)。
const GALAXY_OUTER_FADE = 0.30;     // 外周側: 半径のこの割合ぶんの幅をかけて0へ
const GALAXY_INNER_FADE = 0.35;     // 内周側: innerRadiusのこの割合ぶんの幅をかけて0へ(穴があるときのみ)
const GALAXY_EDGE_SIZE_FALLOFF = 0.55; // 縁で粒を小さくする度合い(0=変えない、1=完全に消える手前まで細る)

// ── 2026-09-17 追加: 「腕の強調」演出用パラメータ ───────────────────
// ご指示反映: 「固定三本の腕を太くする」演出。GALAXY_BRANCHES=9本のうち3個おき
// (=120°間隔で均等)の3本だけを対象にし、setGalaxyArmEmphasis(galaxy, 0〜1)で
// 太さ・明るさを外部からアニメーションできるようにする。
//   - main.js側: 最後の俯瞰視点(telescopeモード突入)になったタイミングで0→1
//   - 将来追加予定のレコードのアーム(tonearm)を円盤に置くギミック: 1→0
//     (=今の常時の静かな見た目に戻す)を想定している(現時点では呼び出し元は
//     まだ実装されていない)。
export const GALAXY_ARM_EMPHASIS_BRANCHES = [0, 3, 6]; // 9本中3個おき=120°間隔で均等な3本
const GALAXY_ARM_THICKEN_STRENGTH = 1.4;   // 強調時、対象の腕の粒を最大(1+この値)倍太くする(仮値)
const GALAXY_ARM_BRIGHTEN_STRENGTH = 0.9;  // 強調時、対象の腕の粒を最大(1+この値)倍明るくする(仮値)


// ── 自転の演出パラメータ ─────────────────────────────
const ROTATION_AXIS_DIR = new THREE.Vector3(0, 1, 0);
export const ROTATION_DIRECTION = -1;       // 自転の向き(+1/-1)。以前と逆回転にしたいのでマイナスに
// ご指示「銀河の回転も太陽系と同じ速度にして」の反映: 以前は独自の固定値(2π/3秒=3秒で1周)
// だったが、solarSystem.jsのSUN_ORBIT_PERIOD(太陽が主軌道を1周する秒数)から直接導出し、
// 銀河の自転も「太陽系の公転と同じ周期」でぴったり1周するようにした。
// ★ 2026-09-12 追加: main.js側で「カメラも銀河と同じ速度で回転させたい」との
//   ご指示があったため、他ファイルから参照できるようexportした(値自体は変更なし)。
export const ANGULAR_SPEED = (2 * Math.PI) / SUN_ORBIT_PERIOD; // ラジアン/秒
// ご指示「レコードの針が出現して、太陽が中心に到達するまでのみ、銀河の回転を1秒で半周する
// 速度にして」の反映。半周(π radian)を1秒でこなす速さ=πラジアン/秒。
// record.js側がplayNeedleSequenceの開始〜完了の間だけgalaxy.needleSpinActiveをtrueにする。
const NEEDLE_SPIN_MAGNITUDE = Math.PI; // ラジアン/秒(=1秒で半周)

// ── Points用シェーダー ────────────────────────────────
// 円形のソフトフォールアウト + 距離に応じたサイズ減衰 + 全体をuAlphaで一括フェード。
const VERTEX_SHADER = /* glsl */ `
  uniform float uSize;
  uniform float uPixelRatio;
  uniform float uNearFadeStart;
  uniform float uNearFadeRange;
  uniform float uMaxPixelSize;
  uniform float uZoom;               // 2026-10-27: 俯瞰のズーム係数(=tan(基準fov/2)÷tan(現在fov/2))。1=等倍。fovを狭めたとき星も一緒に拡大されるようにする
  uniform float uArmEmphasis;         // 0=通常、1=強調full(setGalaxyArmEmphasisで外部からtween)
  uniform float uArmThickenStrength;  // 強調時の太さ倍率の強さ(bulge側は0=無効)
  uniform float uArmBrightenStrength; // 強調時の明るさ倍率の強さ(bulge側は0=無効)
  uniform float uHoleRadius;          // 中心の穴の半径(銀河ローカル)。0=穴なし(setGalaxyHoleでtween)
  uniform float uHoleFade;            // 穴のふちをぼかす幅
  uniform float uCut;                 // 外周から消す境目の半径(銀河ローカル)。これより外側の星は消える。通常は1e6(=無効)。setGalaxyGrowthが設定
  uniform float uCutW;                // 境目のぼかし幅
  uniform float uBoostAmount;         // 内側ブースト粒(aBoost=1)の表示度合い 0〜1
  attribute float aScale;
  attribute float aAlpha;
  attribute float aBaseRadius; // 粒の中心からのXZ半径(bulge側用。銀河本体はシェーダー内で毎回求める)
  attribute float aBoost;      // 1=内側ブースト粒 / 0=通常の粒(この属性を持たないbulge側は0扱い)
  attribute float aArmWeight; // 0/1: 強調対象の腕(GALAXY_ARM_EMPHASIS_BRANCHES)に属するか
  attribute vec3 aColor;
  #ifdef ENABLE_DIFF_ROTATION
    // 銀河本体専用。粒子ごとに「銀河状態」と「レコード状態」の2つの位置(極座標)を持ち、
    // uMorph(0=レコード、1=銀河。setGalaxyGrowthが設定)で混ぜる。差動回転(中心ほど速い)も
    // ここで角度に足す。経過時間はuDiffElapsed(CPU側はこの1個のfloatを増やすだけ)。
    // 差動回転を止めたあとも、uDiffElapsedはその時点の値のまま残る(=ねじれが保たれ、
    // 以後は銀河全体の剛体回転が続く。以前の「位置の焼き込み」と同じ見え方)。
    uniform float uDiffActive;
    uniform float uDiffElapsed;
    uniform float uMorph;
    attribute float aDiffRadius;     // 銀河状態: 腕の中心線上の半径
    attribute float aDiffBaseAngle;  // 銀河状態: branchAngle+spinAngle
    attribute float aDiffRandomX;    // 銀河状態: 腕からのブレ
    attribute float aDiffRandomZ;
    attribute float aRecRadius;      // レコード状態: 溝の半径(溝の幅ぶんのブレ込み)
    attribute float aRecAngle;       // レコード状態: 溝の上の角度(何周も巻いた値)
    attribute float aRecAlpha;       // レコード状態: 濃さ(縁・曲間の無音の帯・ブースト粒は0)
  #endif
  varying vec3 vColor;
  varying float vAlpha;
  varying float vColorBoost;
  void main() {
    vec3 pos = position;
    float baseRadius = aBaseRadius;
    float baseAlpha = aAlpha;
    float edgeSize = 1.0;   // 縁で粒を細らせる倍率(銀河本体はここで求める。bulgeはaScaleに焼き込み済み)
    float armMorph = 1.0;   // 腕の強調は銀河状態のときだけ効かせる
    #ifdef ENABLE_DIFF_ROTATION
      float r = mix(aRecRadius, aDiffRadius, uMorph);
      // ω(r) = ANGULAR_SPEED * GALAXY_RADIUS / max(r, minRadius)(外周で通常の回転速度、中心ほど速い)
      float minRadius = DIFF_GALAXY_RADIUS * DIFF_MIN_RADIUS_RATIO;
      float omega = DIFF_ANGULAR_SPEED * (DIFF_GALAXY_RADIUS / max(r, minRadius));
      float angle = mix(aRecAngle, aDiffBaseAngle, uMorph) + DIFF_ROTATION_SIGN * omega * uDiffElapsed;
      pos.x = cos(angle) * r + aDiffRandomX * uMorph;
      pos.z = sin(angle) * r + aDiffRandomZ * uMorph;
      pos.y = position.y * uMorph;
      baseRadius = length(pos.xz);
      baseAlpha = mix(aRecAlpha, aAlpha, uMorph);
      baseAlpha *= 1.0 - smoothstep(uCut - uCutW, uCut, r); // 変形完了後は外周の星から消える(uCut=1e6なら何も起きない)
      edgeSize = 1.0 - DIFF_EDGE_SIZE_FALLOFF * (1.0 - baseAlpha);
      armMorph = uMorph;
    #endif
    vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
    vec4 viewPosition = viewMatrix * modelPosition;
    vec4 projectedPosition = projectionMatrix * viewPosition;
    gl_Position = projectedPosition;

    gl_PointSize = uSize * aScale * edgeSize * uPixelRatio;
    gl_PointSize *= (uZoom / -viewPosition.z); // uZoomは通常1。俯瞰のズーム時だけmain.jsが上げる(星が実寸のまま拡大される)

    // 中心の穴: 半径uHoleRadiusより内側の粒は消え、ふちはuHoleFadeの幅でなめらかに現れる。
    // 頂点属性ではなくuniformで判定するので、穴の広がりをtweenしてもジオメトリの
    // 作り直しは不要。粒も穴に近いほど少し細らせる。
    float holeFade = 1.0;
    if (uHoleRadius > 0.0) {
      holeFade = smoothstep(uHoleRadius, uHoleRadius + max(uHoleFade, 0.0001), baseRadius);
    }
    gl_PointSize *= mix(0.45, 1.0, holeFade);
    float boostFade = mix(1.0, uBoostAmount, aBoost);

    // ★ 2026-09-17 追加: 強調対象の腕の粒だけ、uArmEmphasisに応じて太く・明るくする。
    float armBoost = aArmWeight * uArmEmphasis * armMorph;
    gl_PointSize *= 1.0 + armBoost * uArmThickenStrength;

    // ★ 2026-09-17 追加: 画面上の見かけサイズに上限を設ける(カメラが極端に近づいても
    //   「ベタ塗りの巨大な正方形」までは膨らまなくなる)。uMaxPixelSize未指定(0)のときは無効。
    if (uMaxPixelSize > 0.0) {
      gl_PointSize = min(gl_PointSize, uMaxPixelSize);
    }

    vColor = aColor;
    vColorBoost = 1.0 + armBoost * uArmBrightenStrength;
    // カメラが粒に近づきすぎたとき、距離に応じてアルファを落として消す。
    // 銀河本体側は常に十分遠いので、uNearFadeStart=0/uNearFadeRange=1(実質無効)で呼べばよい。
    float viewDist = -viewPosition.z;
    float nearFade = smoothstep(uNearFadeStart, uNearFadeStart + max(uNearFadeRange, 0.0001), viewDist);
    vAlpha = baseAlpha * nearFade * holeFade * boostFade;
  }
`;

const FRAGMENT_SHADER = /* glsl */ `
  uniform float uAlpha;
  uniform float uBrightness; // 色に掛ける明るさ(1=そのまま)。銀河とバルジで別々の値を渡す
  varying vec3 vColor;
  varying float vAlpha;
  varying float vColorBoost;
  void main() {
    float strength = distance(gl_PointCoord, vec2(0.5));
    strength = 1.0 - smoothstep(0.0, 0.5, strength);
    if (strength <= 0.0) discard;
    gl_FragColor = vec4(vColor * vColorBoost * uBrightness, strength * uAlpha * vAlpha);
  }
`;

// ★ 2026-09-19 追加(ご指摘反映): 「ガラス(トーンアーム)に星が透過しない」への対応。
//   three.jsのtransmissionは、その時点までに描画済みの「不透明(opaque)」なジオメトリ
//   だけを背景としてキャプチャする。銀河の粒はAdditiveBlending+transparent:trueな
//   ソフトな光でできているため、透過パスより後(半透明パス)で描かれてしまい、
//   ガラス越しには一切映らない。そこで、同じ位置・色を使った「不透明な核」だけの
//   レイヤーをもう1枚(下記FRAGMENT_SHADER_OPAQUE + createGalaxyOpaqueMaterial)追加し、
//   従来のソフトな輝きレイヤーの下に重ねて描く。核レイヤーはtransparent:false/
//   depthWrite:trueの完全な不透明ジオメトリなので、これがtransmissionに正しく
//   キャプチャされ、ガラス越しに星が見えるようになる。
const FRAGMENT_SHADER_OPAQUE = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  varying float vColorBoost;
  void main() {
    float strength = distance(gl_PointCoord, vec2(0.5));
    if (strength > 0.42) discard;
    // 縁のフェード(vAlpha。円盤外周/穴のふちで0に近づく)がごく小さい粒は、
    // もともと「見えない」ことを意図した粒なので、不透明レイヤー側でも描かない。
    if (vAlpha < 0.05) discard;
    // ★ 2026-09-19 修正(ご指摘反映): 「星が明るく、ぼやけてしまった」への対応。
    //   このレイヤーはtransmission用に「不透明な何か」を用意するためだけの黒子であり、
    //   見た目そのものは従来通り上の輝きレイヤー(FRAGMENT_SHADER)だけで作る想定だった。
    //   ところがvColorBoost(腕の強調時の増光)まで掛けたうえで完全不透明(alpha=1固定)に
    //   していたため、輝きレイヤーの下で実質「もう一枚ぶん明るい円」が常時重なる形になり、
    //   全体が明るく・(UnrealBloomPassが小さな不透明な円に弱いため)ぼやけて見える原因に
    //   なっていた。vColorBoostの掛け算をやめ、少し暗めの色で塗るだけにする
    //   (下のGALAXY_OPAQUE_POINT_SIZEも大幅に縮小してあり、main.js側でBloom対象からも
    //   完全に除外している)。
    // ★ 2026-09-19 追加(前回修正の副作用の是正): 「鏡tripodがほとんど何も映らなく
    //   なった」への対応。鏡tripod(record.js createMirrorMaterial)はCubeCameraで
    //   シーンをそのまま撮影しており、main.js側のBloom(ポストプロセス)を一切経由しない。
    //   そのため、excludeFromBloomでBloom対象から外しても鏡の見え方には無関係で、
    //   鏡に映る明るさは「このレイヤーの生の色」だけで決まる。前回、直接見た画面の
    //   Bloomのぼやけ対策として色を0.7倍に暗くしたところ、光源が一つもないこのシーンで
    //   鏡が拾える数少ない明るい material だったため、鏡がほぼ何も映さなくなって
    //   しまった。サイズ(GALAXY_OPAQUE_POINT_SIZE=小さいまま)とBloom除外はそのまま
    //   残しつつ、色だけ鏡用に明るく(1.0倍より明るい1.4倍に)戻す。excludeFromBloomは
    //   main.js側のBloom合成にしか効かないので、この明るさを上げても直接見た画面が
    //   再びぼやけることはない。
    gl_FragColor = vec4(vColor * 1.4, 1.0);
  }
`;
// ★ 2026-09-19 修正: 上のvColor*1.4(鏡用の明るさ)に合わせて、サイズも0.1倍→0.16倍へ
//   少しだけ戻した。鏡(CubeCamera)は解像度256pxしかないため、点が小さすぎると
//   ほぼサブピクセルになって消えてしまう。直接見た画面ではBloom除外+輝きレイヤーの
//   下に隠れる大きさなので、この程度ならまだ見た目への影響はほぼない想定。
const GALAXY_OPAQUE_POINT_SIZE = GALAXY_POINT_SIZE * 0.16; // 仮値。鏡での見え方とのバランスで調整してください

// ── ジオメトリ生成: 位置・色・サイズ属性をJS側で一度だけ計算する ─────────
// 渦巻き円盤のみ(中心の棒状バルジは撤去済み。上部コメント参照)。
// ★ 2026-09-16 追加: innerRadius(既定0)で、銀河状態の半径を[innerRadius, GALAXY_RADIUS]に
//   リマップして中心に穴を作れる(setGalaxyInnerRadius)。
// ★ 2026-10-25 変更(ご指示反映): 粒子ごとに「銀河状態」と「レコード状態」の2つの位置を持たせる。
//   ・粒子は index が大きいほど「腕の中心線から外れがちな粒」になるよう並べてある
//     (ブレの大きさの乱数を、GALAXY_REMOVAL_ORDER_BIASで偏らせた順に並べ替える)。描画数を減らすと
//     末尾から消えるので、星が減るほど腕がくっきりする。ブレの分布そのものは従来と同じ。
//     腕の割り当て(i % 9)・ブースト粒(3/23)は全体に均等に混ざる。
//   ・レコード状態: 一本のアルキメデス渦(等ピッチ)。溝の上の位置は、面積が一様になるよう
//     rc = sqrt(Rin² + u(R²-Rin²)) で決め、角度は rc に比例(GALAXY_RECORD_TURNS回巻き)。
//     銀河状態の半径と同じ乱数 u から作るので、混ぜている途中も粒は渦に沿ったまま動く。
//     ブースト粒はレコード状態では濃さ0(=見えない)で、変形が進むにつれて現れる。
function buildGalaxyGeometry(innerRadius = 0) {
  const totalCount = GALAXY_TOTAL_PARTICLE_COUNT;

  const positions = new Float32Array(totalCount * 3); // 銀河状態の位置(yは銀河状態の厚み。シェーダーが使う)
  const colors = new Float32Array(totalCount * 3);
  const scales = new Float32Array(totalCount);
  const alphas = new Float32Array(totalCount);
  const armWeights = new Float32Array(totalCount);
  const boostFlags = new Float32Array(totalCount); // 内側ブースト粒なら1
  // 銀河状態(差動回転の基準も兼ねる)
  const diffRadius = new Float32Array(totalCount);
  const diffBaseAngle = new Float32Array(totalCount);
  const diffRandomX = new Float32Array(totalCount);
  const diffRandomZ = new Float32Array(totalCount);
  // レコード状態
  const recRadii = new Float32Array(totalCount);
  const recAngles = new Float32Array(totalCount);
  const recAlphas = new Float32Array(totalCount);

  // 外周/内周のフェード幅(ワールド単位)。0除算を避けるため下限を持たせる。
  const outerFadeWidth = Math.max(GALAXY_RADIUS * GALAXY_OUTER_FADE, 1e-6);
  const innerFadeWidth = innerRadius > 0 ? Math.max(innerRadius * GALAXY_INNER_FADE, 1e-6) : 0;

  const smoothstep = (edge0, edge1, x) => {
    const t = Math.min(Math.max((x - edge0) / (edge1 - edge0), 0), 1);
    return t * t * (3 - 2 * t);
  };

  // レコード状態の幾何
  const recInner = GALAXY_RADIUS * GALAXY_RECORD_INNER_RATIO;
  const recSpan = GALAXY_RADIUS - recInner;
  const recPitch = recSpan / GALAXY_RECORD_TURNS; // 溝の間隔(隣り合う巻きの半径の差)
  const recAngleOf = (r) => Math.sign(GALAXY_SPIN) * Math.PI * 2 * GALAXY_RECORD_TURNS * (r - recInner) / recSpan; // 巻く向きはGALAXY_SPINと同じ(ほどけ方が連続する)
  const recEdgeWidth = Math.max(GALAXY_RADIUS * GALAXY_RECORD_EDGE_FADE, 1e-6);
  const gapHalf = Math.max(GALAXY_RADIUS * GALAXY_RECORD_TRACK_GAP_WIDTH, 1e-6);
  const recAlphaOf = (r) => {
    let a = 1 - smoothstep(GALAXY_RADIUS - recEdgeWidth, GALAXY_RADIUS, r);
    for (const c of GALAXY_RECORD_TRACK_GAPS) {
      const d = Math.abs(r - c * GALAXY_RADIUS);
      a *= 1 - (1 - GALAXY_RECORD_TRACK_GAP_DIM) * (1 - smoothstep(gapHalf * 0.5, gapHalf, d));
    }
    return a;
  };

  // 消える順に並べたブレの乱数(0〜1)。バケットに分けて並べるだけのO(n)の並べ替え
  // (92万個でも一瞬。バケット内の順は不問)。bias=1なら乱数の小さい順、0なら並べ替えなし。
  const sortedKeys = new Float32Array(totalCount);
  {
    const BUCKETS = 4096;
    const keys = new Float32Array(totalCount);
    const bucketOf = new Uint16Array(totalCount);
    const starts = new Uint32Array(BUCKETS + 1);
    for (let j = 0; j < totalCount; j++) {
      const k = Math.random();
      keys[j] = k;
      const order = GALAXY_REMOVAL_ORDER_BIAS * k + (1 - GALAXY_REMOVAL_ORDER_BIAS) * Math.random();
      const b = Math.min(BUCKETS - 1, Math.floor(order * BUCKETS));
      bucketOf[j] = b;
      starts[b + 1]++;
    }
    for (let b = 0; b < BUCKETS; b++) starts[b + 1] += starts[b]; // starts[b]=バケットbの先頭の位置
    for (let j = 0; j < totalCount; j++) sortedKeys[starts[bucketOf[j]]++] = keys[j];
  }

  for (let i = 0; i < totalCount; i++) {
    const i3 = i * 3;

    const isBoost = Math.floor(i / 3) % GALAXY_BOOST_CYCLE < GALAXY_BOOST_PER_CYCLE;
    let radius;     // 銀河状態の半径(腕の中心線上)
    let recCenter;  // レコード状態の、溝の中心線上の半径
    if (isBoost) {
      // 内側ブースト粒: [RMIN, RMAX]で「RMINが最も濃く、RMAXで0へ直線的に減る」分布。
      // (三角形分布の逆関数: r = RMAX - (RMAX-RMIN)*sqrt(v))
      const rMin = GALAXY_RADIUS * GALAXY_INNER_BOOST_RMIN_RATIO;
      const rMax = GALAXY_RADIUS * GALAXY_INNER_BOOST_RMAX_RATIO;
      radius = rMax - (rMax - rMin) * Math.sqrt(Math.random());
      recCenter = Math.max(radius, recInner); // レコード状態では見えない(濃さ0)ので、位置は何でもよい
    } else {
      const u = Math.random();
      radius = innerRadius + Math.pow(u, 0.7) * (GALAXY_RADIUS - innerRadius);
      recCenter = Math.sqrt(recInner * recInner + u * (GALAXY_RADIUS * GALAXY_RADIUS - recInner * recInner));
    }
    const armIndex = i % GALAXY_BRANCHES;
    const branchAngle = (armIndex / GALAXY_BRANCHES) * Math.PI * 2;
    const spinAngle = (radius / GALAXY_RADIUS) * GALAXY_SPIN; // 正規化半径(0〜1)を使う(銀河のサイズに依存しない)

    // 腕からのブレ。向きは球面上で一様(★2026-09-17: 四角いシルエット対策)、大きさは
    // 並べ替え済みの乱数の累乗(iが大きいほど大きくなりがち=末尾ほど腕から外れた粒)。
    const randomStrength = Math.pow(sortedKeys[i], GALAXY_RANDOMNESS_POWER) * GALAXY_RANDOMNESS * radius;
    const dirTheta = Math.random() * Math.PI * 2;
    const dirY = Math.random() * 2 - 1;          // cos(φ)を一様に取ると球面上で一様になる
    const dirXZ = Math.sqrt(1 - dirY * dirY);
    const randomX = Math.cos(dirTheta) * dirXZ * randomStrength;
    const randomY = dirY * randomStrength * GALAXY_FLATTEN; // Y方向だけ薄くして円盤にする
    const randomZ = Math.sin(dirTheta) * dirXZ * randomStrength;

    const x = Math.cos(branchAngle + spinAngle) * radius + randomX;
    const z = Math.sin(branchAngle + spinAngle) * radius + randomZ;

    positions[i3] = x;
    positions[i3 + 1] = randomY;
    positions[i3 + 2] = z;

    diffRadius[i] = radius;
    diffBaseAngle[i] = branchAngle + spinAngle;
    diffRandomX[i] = randomX;
    diffRandomZ[i] = randomZ;

    // レコード状態: 溝の中心線からの半径方向のブレ(三角分布。溝の太さ=ピッチ×GALAXY_RECORD_GROOVE_WIDTH)。
    const recRadius = recCenter + (Math.random() + Math.random() - 1) * 0.5 * GALAXY_RECORD_GROOVE_WIDTH * recPitch;
    recRadii[i] = recRadius;
    // 溝の角度は2πの整数倍ぶん取り直しても、レコード状態の位置は変わらない。腕の角度に最も近い側を選ぶ。
    const recAngleRaw = recAngleOf(recCenter);
    recAngles[i] = recAngleRaw - Math.PI * 2 * Math.round((recAngleRaw - (branchAngle + spinAngle)) / (Math.PI * 2));
    recAlphas[i] = isBoost ? 0 : recAlphaOf(recRadius);

    const mixedColor = GALAXY_INSIDE_COLOR.clone().lerp(GALAXY_OUTSIDE_COLOR, radius / GALAXY_RADIUS);
    colors[i3] = mixedColor.r;
    colors[i3 + 1] = mixedColor.g;
    colors[i3 + 2] = mixedColor.b;

    // 境界フェード(銀河状態)。ブレを足した「実際の」XZ半径で判定する。
    const finalRadius = Math.hypot(x, z);
    let edge = 1 - smoothstep(GALAXY_RADIUS - outerFadeWidth, GALAXY_RADIUS, finalRadius);
    if (innerFadeWidth > 0) {
      edge *= smoothstep(innerRadius, innerRadius + innerFadeWidth, finalRadius);
    }

    alphas[i] = edge;
    boostFlags[i] = isBoost ? 1 : 0;
    // 大きさの個体差(0.3〜1.0)。縁で粒を細らせる処理は、状態ごとに変わるのでシェーダー側で行う。
    scales[i] = Math.random() * 0.7 + 0.3;

    // 強調対象の3本の腕(GALAXY_ARM_EMPHASIS_BRANCHES)に属する粒だけ1、それ以外は0。
    armWeights[i] = GALAXY_ARM_EMPHASIS_BRANCHES.includes(armIndex) ? 1 : 0;
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('aColor', new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute('aScale', new THREE.BufferAttribute(scales, 1));
  geometry.setAttribute('aAlpha', new THREE.BufferAttribute(alphas, 1));
  geometry.setAttribute('aArmWeight', new THREE.BufferAttribute(armWeights, 1));
  geometry.setAttribute('aBoost', new THREE.BufferAttribute(boostFlags, 1));
  geometry.setAttribute('aDiffRadius', new THREE.BufferAttribute(diffRadius, 1));
  geometry.setAttribute('aDiffBaseAngle', new THREE.BufferAttribute(diffBaseAngle, 1));
  geometry.setAttribute('aDiffRandomX', new THREE.BufferAttribute(diffRandomX, 1));
  geometry.setAttribute('aDiffRandomZ', new THREE.BufferAttribute(diffRandomZ, 1));
  geometry.setAttribute('aRecRadius', new THREE.BufferAttribute(recRadii, 1));
  geometry.setAttribute('aRecAngle', new THREE.BufferAttribute(recAngles, 1));
  geometry.setAttribute('aRecAlpha', new THREE.BufferAttribute(recAlphas, 1));
  // CPU側で「いまの粒の位置」を求める(getGalaxyStarPoint。音符の着地点用)ための控え。
  geometry.userData.morphData = {
    radius: diffRadius, baseAngle: diffBaseAngle, randomX: diffRandomX, randomZ: diffRandomZ,
    recRadius: recRadii, recAngle: recAngles, positions,
  };
  geometry.setDrawRange(0, totalCount); // 最初は全部描く(育ち具合はsetGalaxyGrowthが反映する)
  return geometry;
}

// ── 2026-09-28 追加(ご指摘反映): 中心の穴を「なめらかに広げる」ための関数。 ──
// 「バルジ登場時に銀河へ急に穴が開くが、バルジの拡大に伴って穴も広がってほしい」への対応。
// 下のsetGalaxyInnerRadiusはジオメトリを丸ごと作り直す方式で、1回きりの瞬間的な切り替え
// にしか使えなかった。こちらはシェーダーのuniformだけを書き換えるので、毎フレーム(tweenの
// onUpdate)から呼んでよい。
//   radius: 穴の半径(銀河ローカル座標)。0で穴なし。
//   boostAmount: 内側ブースト粒(バルジ周辺の星の密度を上げる追加粒)の表示度合い 0〜1。
//                穴の広がりと同じ進行度を渡すと、穴が広がるにつれて周りの星が増えていく。
export function setGalaxyHole(galaxy, radius, boostAmount = 1) {
  if (!galaxy) return;
  const fade = Math.max(radius * GALAXY_INNER_FADE, 1e-6); // ふちのぼかし幅も穴の大きさに比例
  [galaxy.material, galaxy.opaqueMaterial].forEach((m) => {
    if (!m) return;
    m.uniforms.uHoleRadius.value = radius;
    m.uniforms.uHoleFade.value = fade;
    m.uniforms.uBoostAmount.value = boostAmount;
  });
}

// ══ 2026-10-25 変更(ご指示反映): 銀河の「育ち」→「星が減る」 ══════════════════════
// 育ち具合は「ステップ数」1つで表す(0=星が全部ある・レコードの見た目 〜 MAX=星が全部なくなる)。
// 小数でよく、tweenから連続で渡せる。starburstのクリック(record.js/galaxyGrowth.js)で進む。
//   progress = steps / GALAXY_GROWTH_MAX_STEPS         … 星が減った割合(0〜1)
//   描く粒子数 = 全粒子 × (1 - progress)                 … 末尾(腕から外れた粒)から消える
//   morph     = smoothstep(START, END, progress)        … 0=レコード、1=銀河の腕
// progress=1では粒子が0個になり、中心のバルジ(record.js)だけが残る。
export const GALAXY_GROWTH_MAX_STEPS = 100;

// ステップ数から、描画する粒子数と変形の度合いを求める(純粋な計算)。
export function getGalaxyGrowthLayout(steps) {
  const progress = THREE.MathUtils.clamp(steps / GALAXY_GROWTH_MAX_STEPS, 0, 1);
  const t = THREE.MathUtils.clamp((progress - GALAXY_MORPH_START) / Math.max(GALAXY_MORPH_END - GALAXY_MORPH_START, 1e-6), 0, 1);
  // ★ 2026-10-28: 変形はMORPH_ENDで完了する。そこまでは従来どおり「末尾(腕から外れた粒)から」消え、
  //   MORPH_END以降は残った粒(腕の芯)を「外周から内側へ」消す(peripheryQ: 0→1)。
  //   後半は粒子数ではなく半径のしきい値(cut)で消すので、drawCountはMORPH_ENDの時点の数のまま
  //   据え置き、peripheryQ=1(=progress 1)で0にする。
  const peripheryQ = THREE.MathUtils.clamp((progress - GALAXY_MORPH_END) / Math.max(1 - GALAXY_MORPH_END, 1e-6), 0, 1);
  const cutWidth = GALAXY_RADIUS * GALAXY_PERIPHERY_FADE_RATIO;
  return {
    progress,
    morph: t * t * (3 - 2 * t),
    peripheryQ,
    // しきい値: peripheryQ=0で外周の外(=何も消えない)、1で中心(=全部消える)。0のときは無効値(1e6)。
    cut: peripheryQ > 0 ? (1 - peripheryQ) * (GALAXY_RADIUS + cutWidth) : 1e6,
    cutWidth,
    drawCount: peripheryQ >= 1 ? 0 : Math.round(GALAXY_TOTAL_PARTICLE_COUNT * (1 - Math.min(progress, GALAXY_MORPH_END))),
  };
}

// 育ち具合を反映する。粒子の描画数(drawRange)とシェーダーのuniformを書き換えるだけなので
// 毎フレーム(tweenのonUpdate)から呼んでよい。核レイヤーは同じジオメトリを共有しているので一緒に変わる。
export function setGalaxyGrowth(galaxy, steps) {
  if (!galaxy || !galaxy.points) return;
  const { morph, drawCount, cut, cutWidth } = getGalaxyGrowthLayout(steps);
  galaxy.points.geometry.setDrawRange(0, drawCount);
  const hasStars = drawCount > 0; // 0個のときは描画自体をやめる(バルジだけが残る)
  galaxy.points.visible = hasStars;
  if (galaxy.opaquePoints) galaxy.opaquePoints.visible = hasStars;
  [galaxy.material, galaxy.opaqueMaterial].forEach((m) => {
    if (!m) return;
    if (m.uniforms.uMorph) m.uniforms.uMorph.value = morph;
    m.uniforms.uCut.value = cut;
    m.uniforms.uCutW.value = cutWidth;
  });
  galaxy.growthCut = cut; // 外周から消えている最中の境目(getGalaxyRandomStarPointが消えた星を避けるのに使う)
  galaxy.growthSteps = Math.max(steps, 0);
  galaxy.growthMorph = morph;
}

// index番目の粒の「いまの」位置を、銀河ローカル座標でoutに返す(VERTEX_SHADERと同じ式。
// 差動回転のねじれも含む)。音符の着地点などCPU側で星の位置が欲しいときに使う。
export function getGalaxyStarPoint(galaxy, index, out = new THREE.Vector3()) {
  const data = galaxy.points.geometry.userData.morphData;
  const m = galaxy.growthMorph || 0;
  const r = THREE.MathUtils.lerp(data.recRadius[index], data.radius[index], m);
  const minRadius = GALAXY_RADIUS * GALAXY_DIFF_MIN_RADIUS_RATIO;
  const omega = ANGULAR_SPEED * (GALAXY_RADIUS / Math.max(r, minRadius));
  const angle = THREE.MathUtils.lerp(data.recAngle[index], data.baseAngle[index], m)
    + (-ROTATION_DIRECTION) * omega * (galaxy.diffElapsed || 0);
  return out.set(
    Math.cos(angle) * r + data.randomX[index] * m,
    data.positions[index * 3 + 1] * m,
    Math.sin(angle) * r + data.randomZ[index] * m,
  );
}

// いま残っている星(描画中の粒)からランダムに1つ選び、その位置を返す。星が1つも残っていなければ
// 銀河の中心(=バルジ)を返す。
export function getGalaxyRandomStarPoint(galaxy, out = new THREE.Vector3()) {
  const count = galaxy && galaxy.points ? galaxy.points.geometry.drawRange.count : 0;
  if (!(count > 0)) return out.set(0, 0, 0);
  // ★ 2026-10-28: 外周から消えている最中(growthCut有効)は、消えた星(境目より外側)を避けて選ぶ。
  //   描画数(drawRange)だけでは外周の消失が分からないので、半径で判定して引き直す。
  const cut = galaxy.growthCut || 1e6;
  const radii = galaxy.points.geometry.userData.morphData.radius;
  let index = Math.floor(Math.random() * count);
  for (let tries = 0; tries < 30 && radii[index] > cut; tries++) {
    index = Math.floor(Math.random() * count);
  }
  return getGalaxyStarPoint(galaxy, index, out);
}

// ── 2026-09-16 追加: バルジ出現のタイミングでrecord.js側から呼んでもらい、円盤の
//    中心にinnerRadius分の穴をあける(=そこから先はバルジが埋める想定)。
//    ジオメトリを丸ごと作り直して差し替える、簡易な実装(アニメーションなし。
//    「出現の際に」という一度きりのタイミングなので、瞬時の切り替えで十分という判断)。
export function setGalaxyInnerRadius(galaxy, innerRadius) {
  if (!galaxy || !galaxy.points) return;
  const oldGeometry = galaxy.points.geometry; // opaquePointsとも共有している同一インスタンス
  const newGeometry = buildGalaxyGeometry(innerRadius);
  newGeometry.setDrawRange(0, oldGeometry.drawRange.count); // 育ち具合(描画する粒子数)を引き継ぐ
  galaxy.points.geometry = newGeometry;
  if (galaxy.opaquePoints) galaxy.opaquePoints.geometry = newGeometry; // ← 核レイヤーにも同じジオメトリを張り直す
  oldGeometry.dispose();
}

// ── 2026-09-17 追加: 固定3本の腕(GALAXY_ARM_EMPHASIS_BRANCHES)の強調度を設定する。
//    amountは0(通常)〜1(太さ・明るさとも最大)。値そのものを毎フレーム/tweenの
//    onUpdateから渡す想定(このモジュール自体はアニメーションしない。呼び出し側の
//    main.js/record.js側でgsap.toなどを使ってamountを0→1、1→0とtweenしてください)。
export function setGalaxyArmEmphasis(galaxy, amount) {
  if (!galaxy || !galaxy.material) return;
  galaxy.material.uniforms.uArmEmphasis.value = amount;
  if (galaxy.opaqueMaterial) galaxy.opaqueMaterial.uniforms.uArmEmphasis.value = amount; // 核レイヤーも一緒に強調する
}

// ── 2026-10-11 追加: 銀河の明るさ(輝きレイヤーの色の倍率)を実行中に変える。1=従来通り。
//    バルジの明るさはrecord.jsのsetBulgeBrightnessで別に変える(2つは独立)。
export function setGalaxyBrightness(galaxy, value) {
  if (!galaxy || !galaxy.material) return;
  galaxy.material.uniforms.uBrightness.value = value;
}

// ── 2026-09-17 追加: 銀河・バルジなど「Points+この円形ソフトシェーダー」を使う
//    描画すべてで共有するマテリアル生成関数。record.js側のバルジも同じ質感
//    (円形フォールオフ・縁のフェード・近接時のサイズ上限とフェード)を使えるよう
//    export している。
//   - size: uSize(基準の点サイズ)
//   - nearFadeStart/nearFadeRange: この距離(ワールド単位)より近づくとアルファが
//     落ちて消える。銀河のように常に十分遠い場合は0のままでよい(実質無効)。
//   - maxPixelSize: 画面上の見かけサイズの上限(px)。0で無効。
//   - brightness: 色に掛ける明るさ(uBrightness)。1=そのまま。銀河とバルジで別々に渡す。
export function createStarPointsMaterial({
  size,
  nearFadeStart = 0,
  nearFadeRange = 1,
  maxPixelSize = 0,
  brightness = 1,
  armThickenStrength = 0,
  armBrightenStrength = 0,
  enableDiffRotation = false, // ← trueの場合のみ、GPU側差動回転(aDiffRadius等のattribute)を有効にする。bulge側は使わないのでfalseのまま。
} = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    // ★ ENABLE_DIFF_ROTATION有効時のみ、差動回転の式に使う定数をシェーダー内リテラルとして
    //   埋め込む(実行時に変化しない値なのでuniformにせず#defineにしている)。
    defines: enableDiffRotation ? {
      ENABLE_DIFF_ROTATION: 1,
      DIFF_GALAXY_RADIUS: GALAXY_RADIUS.toFixed(6),
      DIFF_ANGULAR_SPEED: ANGULAR_SPEED.toFixed(8),
      DIFF_MIN_RADIUS_RATIO: GALAXY_DIFF_MIN_RADIUS_RATIO.toFixed(6),
      DIFF_ROTATION_SIGN: (-ROTATION_DIRECTION).toFixed(1),
      DIFF_EDGE_SIZE_FALLOFF: GALAXY_EDGE_SIZE_FALLOFF.toFixed(6),
    } : {},
    uniforms: {
      uSize: { value: size },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uZoom: { value: 1 },
      uAlpha: { value: 1 },
      uBrightness: { value: brightness },
      uNearFadeStart: { value: nearFadeStart },
      uNearFadeRange: { value: nearFadeRange },
      uMaxPixelSize: { value: maxPixelSize },
      uArmEmphasis: { value: 0 }, // setGalaxyArmEmphasisで0〜1をtweenする
      uArmThickenStrength: { value: armThickenStrength },
      uArmBrightenStrength: { value: armBrightenStrength },
      uHoleRadius: { value: 0 },
      uHoleFade: { value: 1 },
      uCut: { value: 1e6 },
      uCutW: { value: 1 },
      uBoostAmount: { value: 0 },
      ...(enableDiffRotation ? {
        uDiffActive: { value: 0 },
        uDiffElapsed: { value: 0 },
        uMorph: { value: 0 }, // 0=レコード、1=銀河(setGalaxyGrowthが設定)
      } : {}),
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
}

// ★ 2026-09-19 追加: 上記createStarPointsMaterialの「不透明な核」版。頂点シェーダーは
//   同じもの(位置・サイズ計算を完全に揃えるため)を使い、フラグメントシェーダーだけ
//   FRAGMENT_SHADER_OPAQUEに差し替える。transparent:falseかつdepthWrite:trueにすることで、
//   このレイヤーだけがrenderer側の不透明パスに乗り、ガラスのtransmissionに正しく
//   キャプチャされる(詳細は上のFRAGMENT_SHADER_OPAQUE定義部のコメント参照)。
//   見た目は「輝きレイヤーの中心にある、少し小さめの実体」程度になるよう
//   GALAXY_OPAQUE_POINT_SIZEを輝きより小さくしてある。
export function createGalaxyOpaqueMaterial({
  size,
  nearFadeStart = 0,
  nearFadeRange = 1,
  maxPixelSize = 0,
  armThickenStrength = 0,
  armBrightenStrength = 0,
  enableDiffRotation = false, // ★ 追加: 輝きレイヤー側(createStarPointsMaterial)と必ず同じ値を渡すこと。
  //   同じジオメトリ(=同じaDiffRadius等のattribute)を共有しているので、片方だけ差動回転を
  //   適用すると、核(opaque)だけが輝きレイヤーから位置的にズレて見えてしまう。
} = {}) {
  return new THREE.ShaderMaterial({
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER_OPAQUE,
    defines: enableDiffRotation ? {
      ENABLE_DIFF_ROTATION: 1,
      DIFF_GALAXY_RADIUS: GALAXY_RADIUS.toFixed(6),
      DIFF_ANGULAR_SPEED: ANGULAR_SPEED.toFixed(8),
      DIFF_MIN_RADIUS_RATIO: GALAXY_DIFF_MIN_RADIUS_RATIO.toFixed(6),
      DIFF_ROTATION_SIGN: (-ROTATION_DIRECTION).toFixed(1),
      DIFF_EDGE_SIZE_FALLOFF: GALAXY_EDGE_SIZE_FALLOFF.toFixed(6),
    } : {},
    uniforms: {
      uSize: { value: size },
      uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
      uZoom: { value: 1 },
      uAlpha: { value: 1 },
      uNearFadeStart: { value: nearFadeStart },
      uNearFadeRange: { value: nearFadeRange },
      uMaxPixelSize: { value: maxPixelSize },
      uArmEmphasis: { value: 0 },
      uArmThickenStrength: { value: armThickenStrength },
      uArmBrightenStrength: { value: armBrightenStrength },
      uHoleRadius: { value: 0 },
      uHoleFade: { value: 1 },
      uCut: { value: 1e6 },
      uCutW: { value: 1 },
      uBoostAmount: { value: 0 },
      ...(enableDiffRotation ? {
        uDiffActive: { value: 0 },
        uDiffElapsed: { value: 0 },
        uMorph: { value: 0 }, // 0=レコード、1=銀河(setGalaxyGrowthが設定)
      } : {}),
    },
    transparent: false,
    depthWrite: true,
  });
}

function buildGalaxyMaterial() {
  return createStarPointsMaterial({
    size: GALAXY_POINT_SIZE,
    armThickenStrength: GALAXY_ARM_THICKEN_STRENGTH,
    armBrightenStrength: GALAXY_ARM_BRIGHTEN_STRENGTH,
    maxPixelSize: GALAXY_MAX_PIXEL_SIZE,
    brightness: GALAXY_BRIGHTNESS,
    enableDiffRotation: true, // ← 差動回転をGPU側で計算する(詳細はVERTEX_SHADER内コメント参照)
  });
}

function buildGalaxyOpaqueMaterial() {
  return createGalaxyOpaqueMaterial({
    size: GALAXY_OPAQUE_POINT_SIZE,
    armThickenStrength: GALAXY_ARM_THICKEN_STRENGTH, // 輝きレイヤーと同じ比率で太さも連動させる(見た目に出ないサイズだが念のため揃える)
    armBrightenStrength: 0, // このレイヤーの色はもう固定(vColor*0.7)なので、増光側は使わない
    enableDiffRotation: true, // ★ 追加: 輝きレイヤーと同じジオメトリを共有するので、必ず同じ設定にする
  });
}

// scene: universe.js/solarSystem.jsと同じシーンに追加する想定。
// anchor: 銀河の中心にするワールド座標。main.js側でrecord.jsのバナナが最終的に着地する
//         座標から計算したもの(GALAXY_ANCHOR)を渡す想定。
export function createGalaxy(scene, anchor) {
  const geometry = buildGalaxyGeometry();
  const material = buildGalaxyMaterial();
  const points = new THREE.Points(geometry, material);
  // 8万パーティクルへの標準のPoints raycastは重く、かつこの銀河自体はもうクリック対象では
  // ないので無効化しておく(no-op化)。
  points.raycast = () => {};
  // 粒の位置はシェーダーが毎回求める(position属性は銀河状態の値のまま)ので、境界球での判定はさせない。
  points.frustumCulled = false;

  // ★ 2026-09-19 追加: 不透明な「核」レイヤー(ガラス越しの透過用。上記コメント参照)。
  //   輝きレイヤー(points)とまったく同じジオメトリ(=同じBufferGeometryインスタンス)を
  //   共有するので、位置・見た目のフェードは常に完全に一致する。
  const opaqueMaterial = buildGalaxyOpaqueMaterial();
  const opaquePoints = new THREE.Points(geometry, opaqueMaterial);
  opaquePoints.raycast = () => {};
  opaquePoints.frustumCulled = false;

  // starsGroup: 銀河のパーティクルだけを持つグループ。ここをrotateすることで自転を表現する。
  const starsGroup = new THREE.Group();
  starsGroup.position.copy(anchor);
  starsGroup.add(opaquePoints); // 先に不透明な核を描画し、
  starsGroup.add(points);       // その上から輝きレイヤーを重ねる
  starsGroup.visible = false; // revealGalaxyまで隠しておく(solarSystem.groupと同じ扱い)
  scene.add(starsGroup);

  return {
    starsGroup,
    points,
    material,
    opaquePoints,   // ← ガラス透過用の不透明レイヤー(setGalaxyInnerRadiusが一緒に張り替える)
    opaqueMaterial,
    state: 'hidden', // 'hidden' → 'idle'
    growthSteps: 0, // 育ち具合(setGalaxyGrowthが更新)。0=星が全部ある(レコードの見た目)
    growthMorph: 0, // 変形の度合い(setGalaxyGrowthが更新)。0=レコード、1=銀河の腕
    needleSpinActive: false, // ← 旧・針実装が使っていたフラグ(現在は呼び出し元なし。将来の再利用のため残す)
    // ★ 2026-09-18 追加(ご指示反映): 「トーンアームを円盤の外周に置いたら、銀河の
    //   回転を少し上げる」への対応。needleSpinActive(固定でπ rad/秒という大きな
    //   ジャンプ)とは別に、通常速度に対する「掛け算の倍率」だけを持たせておき、
    //   setGalaxySpinBoost()で自由な値に変えられるようにした。
    spinBoost: 1,
    // ★ 修正: 銀河俯瞰時、アームを置くまでの間だけ「中心に近いほど角速度を速く」する
    //   差動回転を有効にするためのフラグ。角度計算自体はGPU側(VERTEX_SHADER)でやるので、
    //   CPU側で持つのは経過秒数1個(diffElapsed)だけでよい(以前は粒子ごとの累積回転角を
    //   Float32Arrayで持っていたが、GPU移行により不要になった)。
    diffRotationActive: false,
    diffElapsed: 0,
  };
}

// ── 宇宙ページ到達と同時に呼ぶ: solarSystem.group.visible = true と同じ扱いで、
//    フェードや拡大演出なしにいきなりフルサイズで表示する ──────────────
export function revealGalaxy(galaxy) {
  if (!galaxy || galaxy.state !== 'hidden') return;
  galaxy.starsGroup.visible = true;
  galaxy.state = 'idle';
}

// ── 毎フレーム呼ぶ: 銀河をworld Yまわりに自転させる(state==='idle'の間) ──
export function updateGalaxy(galaxy, deltaSeconds) {
  if (!galaxy || galaxy.state === 'hidden') return;
  if (galaxy.diffRotationActive) {
    // ★ バグ修正(ご指摘反映: 粒子を増やすとCPUループが重くなる問題への対応)。
    //   以前はここで毎フレーム全粒子分のCPUループ(updateGalaxyDifferentialRotation)を
    //   回してposition属性を直接書き換えていた。粒子数を増やすとこれが真っ先に
    //   ボトルネックになるため、実際の角度計算はGPU(VERTEX_SHADER内のENABLE_DIFF_
    //   ROTATIONブロック)へ移し、ここでは経過秒数(uDiffElapsed)を1個のfloatとして
    //   更新するだけにした(O(1)/フレーム。粒子数に関係なく一定コスト)。
    galaxy.diffElapsed += deltaSeconds;
    if (galaxy.material?.uniforms.uDiffElapsed) galaxy.material.uniforms.uDiffElapsed.value = galaxy.diffElapsed;
    if (galaxy.opaqueMaterial?.uniforms.uDiffElapsed) galaxy.opaqueMaterial.uniforms.uDiffElapsed.value = galaxy.diffElapsed;
    return; // この間は通常の剛体回転(starsGroup全体を一括rotate)はかけない
  }
  const magnitude = galaxy.needleSpinActive ? NEEDLE_SPIN_MAGNITUDE : ANGULAR_SPEED * (galaxy.spinBoost ?? 1);
  galaxy.starsGroup.rotateOnWorldAxis(ROTATION_AXIS_DIR, ROTATION_DIRECTION * magnitude * deltaSeconds);
}

// ── 銀河俯瞰時: 中心に近いほど角速度を速くする差動回転(実際の銀河のイメージ) ──
// 剛体回転(starsGroup全体を一括rotate)だと全粒子が同じ角速度になってしまうため、
// この間だけ粒子ごとにradiusに応じた角速度で見かけの位置を変える(今はGPU側=
// VERTEX_SHADER内のENABLE_DIFF_ROTATIONブロックで計算。ここのコメントの式が
// そのままGLSL側に対応しているので、式を変えるときは両方直すこと)。
// ω(r) = ANGULAR_SPEED * GALAXY_RADIUS / r としており、外周(r=GALAXY_RADIUS)では通常の
// ANGULAR_SPEEDに一致し、中心に近づくほど速くなる(実際の銀河の回転曲線がほぼ平坦な
// ことの簡易的な近似)。中心付近で角速度が発散しないよう下限半径を設けている。
const GALAXY_DIFF_MIN_RADIUS_RATIO = 0.06; // GALAXY_RADIUSに対する比率(仮値)

// ★ 2026-10-25 変更: 以前は、差動回転を止める瞬間に「見かけの位置」をposition属性へ焼き込んでいたが、
//   粒の位置は(レコード⇔銀河の変形のために)常にシェーダーが求める方式になったので、焼き込みは不要。
//   止めたあとはuDiffElapsedがその時点の値のまま残り、ねじれが保たれる。

// main.js側: 最後の銀河俯瞰(enterGalaxyOverview)に到達したタイミングでtrueにし、
// record.js側: トーンアームを置いた(placeTonearmOnRecord)タイミングでfalseに戻す
// (=通常の剛体回転の「現状の仕様」へ復帰する)。
export function setGalaxyDifferentialRotation(galaxy, active) {
  if (!galaxy) return;
  const wasActive = galaxy.diffRotationActive;
  galaxy.diffRotationActive = !!active;
  if (galaxy.diffRotationActive) {
    galaxy.diffElapsed = 0; // 有効化のたびリセット(累積のズレを防ぐ)
    if (galaxy.material?.uniforms.uDiffActive) galaxy.material.uniforms.uDiffActive.value = 1;
    if (galaxy.opaqueMaterial?.uniforms.uDiffActive) galaxy.opaqueMaterial.uniforms.uDiffActive.value = 1;
    if (galaxy.material?.uniforms.uDiffElapsed) galaxy.material.uniforms.uDiffElapsed.value = 0;
    if (galaxy.opaqueMaterial?.uniforms.uDiffElapsed) galaxy.opaqueMaterial.uniforms.uDiffElapsed.value = 0;
  } else if (wasActive) {
    // 止めるだけ。uDiffElapsed(ねじれ)はそのまま残し、以後は銀河全体の剛体回転が続く。
    if (galaxy.material?.uniforms.uDiffActive) galaxy.material.uniforms.uDiffActive.value = 0;
    if (galaxy.opaqueMaterial?.uniforms.uDiffActive) galaxy.opaqueMaterial.uniforms.uDiffActive.value = 0;
  }
}

// トーンアーム(record.js側)が針を置いたときなど、銀河の自転速度を通常のANGULAR_SPEEDに
// 対する倍率で一時的に変えたいときに呼ぶ。multiplier=1が通常速度。
export function setGalaxySpinBoost(galaxy, multiplier) {
  if (!galaxy) return;
  galaxy.spinBoost = multiplier;
}

// TODO:
//   - GALAXY_RADIUS(=TRIPOD_RADIUS*8)を含む形状パラメータ(GALAXY_PARTICLE_COUNT /
//     GALAXY_BRANCHES / GALAXY_SPIN / GALAXY_RANDOMNESS(_POWER) / GALAXY_FLATTEN /
//     GALAXY_POINT_SIZE)は全て仮値です。実際に見ながら調整してください。
//   - GALAXY_INSIDE_COLOR / GALAXY_OUTSIDE_COLOR も仮値(暖色→寒色のグラデーション)。
//   - ANGULAR_SPEED / ROTATION_DIRECTION / NEEDLE_SPIN_MAGNITUDEも仮値。ROTATION_DIRECTIONは
//     +1/-1で自転の向きを切り替えられます(GALAXY_SPINの符号と合わせて渦の見え方が決まります)。
//   - リサイズ時にuPixelRatioを更新したい場合は、resizeハンドラから
//     galaxy.material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2)
//     galaxy.opaqueMaterial.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio, 2)
//     の両方を呼んでください(このモジュール単体ではresizeイベントを監視していません)。
//   - ★ 2026-09-14: 銀河そのものの拡大・縮小(バナナクリックでの収束消滅・スクロールでの
//     出し入れ・ドラッグでの掴み移動など)は仕様として廃止されたため、関連コードは
//     すべて削除しました。削除したもの: 中心の棒状バルジ(バー+コア。上部コメント参照)、
//     銀河本体のバナナ(makeBananaMesh)とその当たり判定、掴み判定用の透明球
//     (GRAB_HIT_RADIUS)、placeGalaxyAt / flyGalaxyTo / collapseGalaxy / uncollapseGalaxy /
//     setGalaxyRevealAmount / revealBanana の各関数、およびそれらが使っていた
//     COLLAPSE_* 定数・collapseSpinMagnitude / revealSpinMagnitude・'static' /
//     'collapsing' / 'revealing' / 'done' の各state。現在galaxy.stateは
//     'hidden'→'idle'の2値のみです。銀河は一度revealGalaxyされたら、明示的な
//     操作手段がない(=常にフルサイズ・等速自転のまま)状態になっています。
