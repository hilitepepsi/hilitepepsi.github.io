// ══════════════════════════════════════════════════════════════
// ── 銀河の育ち(サイト全体の累計)を数える、小さなサーバー ──
// ══════════════════════════════════════════════════════════════
// Cloudflare Workers + D1(SQLite)で動く。無料枠(2026-10時点)で足りる設計:
//   Workers 100,000リクエスト/日 ・ D1 書き込み100,000行/日・読み取り5,000,000行/日
// エンドポイントは2つだけ:
//   GET  /count       → { count }              いままでに数えたクリックの合計
//   POST /contribute  → { count, counted }     +1して最新の合計を返す。
//                                              同じIPが同じ日(UTC)に2回目以降なら、合計は増やさず counted=false
// 返すのは「クリックの生の合計」だけ。それを銀河の育ちへ換算する(何クリックで完成か)のは
// クライアント側(galaxyGrowth.jsのCLICKS_TO_COMPLETE)なので、完成までの規模を後から変えても
// このサーバーは作り直さなくてよい。
//
// ── 1日あたりの上限の目安(無料枠) ──
//   ・数えられるクリック: 1クリックで2行書き込む(IPの記録+カウンター)ので、約50,000クリック/日。
//   ・リクエスト: GET(宇宙ページに入った人)+POST(starburstをクリックした人)の合計で100,000/日。
//   上限を超えた日は、超えた分のリクエストがエラーになり、クライアントはその端末だけで育てて続行する
//   (サイトは壊れないが、その日の超過分は全体の合計に入らない)。数日〜数か月かけて数万〜数十万
//   クリックに届く想定なら問題にならない。1日にそれ以上が集中しそうなら、Workers Paid($5/月)にすると
//   上限が実質なくなる(コードはそのまま)。
//
// ── デプロイ手順(Cloudflareのアカウントがあれば数分) ──
//   1. npm i -g wrangler && wrangler login
//   2. wrangler d1 create galaxy-counter              ← 出てきたdatabase_idを下のwrangler.tomlに貼る
//   3. wrangler d1 execute galaxy-counter --remote --file=galaxy-counter-schema.sql
//   4. このファイルと同じ場所に、次の内容でwrangler.tomlを作る:
//        name = "galaxy-counter"
//        main = "galaxy-counter-worker.js"
//        compatibility_date = "2026-01-01"
//        [[d1_databases]]
//        binding = "DB"
//        database_name = "galaxy-counter"
//        database_id = "ここにdatabase_id"
//        [vars]
//        ALLOWED_ORIGINS = "https://あなたのサイト.example"   # カンマ区切りで複数可。"*"なら全許可
//        IP_SALT = "適当なランダム文字列"                      # IPをハッシュ化するときの塩(任意)
//   5. wrangler deploy → 表示されたURLをgalaxyGrowth.jsのGROWTH_API_URLへ
//
// ── 補足 ──
//  ・IPアドレスは生のままは保存せず、「IP+塩」のSHA-256ハッシュだけを、日付と組にして持つ。
//  ・カウンターはSQLの UPDATE count = count + 1(D1は書き込みが直列化される)なので、
//    同時に何件来ても数え漏れない。
//  ・「同じIPは1日1回」なので、同じ会社・学校など同じIPを共有する人は、1日に1回しか数えられない。
//  ・記録した行(IP×日付)は消さない。数十万行でも数十MBで、無料枠のストレージ(5GB)に十分収まる
//    (行の削除も「書き込み」として数えられてしまうので、わざと消さない)。

async function sha256Hex(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const allowedOrigins = (env.ALLOWED_ORIGINS || '*').split(',').map((s) => s.trim());
    const origin = request.headers.get('Origin') || '';
    const corsHeaders = {
      'Access-Control-Allow-Origin': allowedOrigins.includes('*') ? '*' : (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]),
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };
    const reply = (body, status = 200) => new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders });

    const readCount = async () => {
      const row = await env.DB.prepare('SELECT count FROM counter WHERE id = 1').first();
      return row ? row.count : 0;
    };

    try {
      if (url.pathname === '/count' && request.method === 'GET') {
        return reply({ count: await readCount() });
      }

      if (url.pathname === '/contribute' && request.method === 'POST') {
        const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
        const today = new Date().toISOString().slice(0, 10); // UTCの日付
        const ipHash = await sha256Hex(ip + (env.IP_SALT || ''));
        // 今日まだ数えていないIPなら行が1つ増える(changes=1)。数えていれば何も書かれない(changes=0)。
        const inserted = await env.DB
          .prepare('INSERT OR IGNORE INTO seen (day, ip_hash) VALUES (?, ?)')
          .bind(today, ipHash)
          .run();
        if (!inserted.meta.changes) return reply({ count: await readCount(), counted: false });
        const row = await env.DB
          .prepare('UPDATE counter SET count = count + 1 WHERE id = 1 RETURNING count')
          .first();
        return reply({ count: row.count, counted: true });
      }

      return reply({ error: 'not found' }, 404);
    } catch (e) {
      // 無料枠の上限超過などでD1が失敗したとき。クライアントはこれを受けて、その端末だけで育てる。
      return reply({ error: 'unavailable' }, 503);
    }
  },
};