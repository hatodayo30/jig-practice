// コメント遡り閲覧用の履歴サーバー。
//
// intern-comment-server の /events は「接続時点より前の投稿は届かない」仕様のため、
// フロントエンドが受信したメッセージをこのサーバーにも転送(fire-and-forgetでPOST)してもらい、
// 直近 HISTORY_LIMIT 件を保存しておく。視聴開始時にフロントはまず GET /history を叩き、
// 過去分を先に表示してから /events に接続することで「途中から見ても過去コメントが見える」を実現する。
//
// 起動:  deno run --allow-net --allow-read --unstable-kv main.js
// 確認:
//   curl -X POST localhost:8000/log -H 'Content-Type: application/json' \
//     -d '{"id":"t1","text":"hello","timestamp":"2026-01-01T00:00:00.000Z"}'
//   curl localhost:8000/history
//
// エンドポイント:
//   POST /log     … フロントが受信したメッセージ1件を記録する
//   GET  /history … 直近 HISTORY_LIMIT 件を古い→新しい順で返す
//
// ストレージに Deno KV を使う理由: Deno Deploy はアクセス状況に応じてこのサーバーを
// 複数インスタンスに複製することがある。インメモリ配列だとインスタンスごとに別々の
// 履歴になってしまうが、KV はどのインスタンスから読んでも同じデータが見える。

const HISTORY_LIMIT = 50;
const kv = await Deno.openKv();

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

function json(body, init) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...corsHeaders, ...(init?.headers ?? {}) },
  });
}

// 保存後、件数が HISTORY_LIMIT を超えていたら古いものから削除する
async function trimHistory() {
  const entries = [];
  for await (const entry of kv.list({ prefix: ["messages"] })) entries.push(entry);
  if (entries.length <= HISTORY_LIMIT) return;
  const excess = entries.slice(0, entries.length - HISTORY_LIMIT);
  for (const entry of excess) await kv.delete(entry.key);
}

async function handleLog(req) {
  let payload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "invalid JSON" }, { status: 400 });
  }

  const { id, text, item, timestamp } = payload ?? {};
  if (typeof id !== "string" || !id) {
    return json({ error: "id is required" }, { status: 400 });
  }
  if (!text && !item) {
    return json({ error: "text or item is required" }, { status: 400 });
  }

  const key = ["messages", timestamp ?? new Date().toISOString(), id];
  await kv.set(key, { id, text: text ?? null, item: item ?? null, timestamp: timestamp ?? null });
  await trimHistory();

  return json({ ok: true });
}

async function handleHistory() {
  const messages = [];
  for await (const entry of kv.list({ prefix: ["messages"] })) messages.push(entry.value);
  return json({ messages });
}

Deno.serve((req) => {
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (pathname === "/log" && req.method === "POST") {
    return handleLog(req);
  }
  if (pathname === "/history" && req.method === "GET") {
    return handleHistory();
  }
  return json({ error: "Not Found" }, { status: 404 });
});
