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
//   curl -X POST localhost:8000/log/bulk -H 'Content-Type: application/json' \
//     -d '{"messages":[{"id":"t2","text":"hi","timestamp":"2026-01-01T00:00:01.000Z"}]}'
//   curl localhost:8000/history
//
// エンドポイント:
//   POST /log      … フロントが受信したメッセージ1件を記録する
//   POST /log/bulk … 同じく、まとめて記録する(視聴者ごとの書き込み回数を減らすため)
//   GET  /history  … 直近 HISTORY_LIMIT 件を古い→新しい順で返す
//
// ストレージに Deno KV を使う理由: Deno Deploy はアクセス状況に応じてこのサーバーを
// 複数インスタンスに複製することがある。インメモリ配列だとインスタンスごとに別々の
// 履歴になってしまうが、KV はどのインスタンスから読んでも同じデータが見える。

const HISTORY_LIMIT = 50;
// 履歴の掃除は書き込みのたびに走らせる必要がない。全視聴者が受信メッセージを
// 転送してくるため書き込み自体が多く、毎回プレフィックスを全走査するとその分が丸ごと無駄になる。
const TRIM_INTERVAL = 20;
// Deno KV の atomic は1トランザクションあたりの操作数に上限があるため分割してコミットする
const TRIM_BATCH_SIZE = 100;
// 1リクエストで受け付けるメッセージ数の上限
const MAX_BULK_MESSAGES = 100;

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

// 保存後、件数が HISTORY_LIMIT を超えていたら古いものから削除する。
// 新しい順に HISTORY_LIMIT 件読み飛ばした残りが削除対象になる。
async function trimHistory() {
  const stale = [];
  let seen = 0;
  for await (const entry of kv.list({ prefix: ["messages"] }, { reverse: true })) {
    if (++seen > HISTORY_LIMIT) stale.push(entry.key);
  }
  // 1件ずつ await すると削除数だけ往復が増えるのでまとめてコミットする
  for (let i = 0; i < stale.length; i += TRIM_BATCH_SIZE) {
    const tx = kv.atomic();
    for (const key of stale.slice(i, i + TRIM_BATCH_SIZE)) tx.delete(key);
    await tx.commit();
  }
}

let writesSinceTrim = 0;
let trimInFlight = null;

// 掃除はレスポンスを待たせずに行う。履歴が一時的に HISTORY_LIMIT を少し超えても
// GET /history 側で上限を切って返すため、見え方は変わらない。
function scheduleTrim(writeCount) {
  writesSinceTrim += writeCount;
  if (writesSinceTrim < TRIM_INTERVAL || trimInFlight) return;
  writesSinceTrim = 0;
  trimInFlight = trimHistory()
    .catch(() => {})
    .finally(() => {
      trimInFlight = null;
    });
}

// 受け取ったペイロードを保存用のキーと値に変換する。不正なら error を返す。
function normalizeMessage(payload) {
  const { id, text, item, timestamp } = payload ?? {};
  if (typeof id !== "string" || !id) return { error: "id is required" };
  if (!text && !item) return { error: "text or item is required" };
  // 同じメッセージを複数の視聴者が転送してくるが、id と timestamp が同じなら
  // キーも同じになるので上書きされ、履歴が重複しない。
  return {
    key: ["messages", timestamp ?? new Date().toISOString(), id],
    value: { id, text: text ?? null, item: item ?? null, timestamp: timestamp ?? null },
  };
}

async function readJson(req) {
  try {
    return { payload: await req.json() };
  } catch {
    return { error: "invalid JSON" };
  }
}

async function handleLog(req) {
  const { payload, error: parseError } = await readJson(req);
  if (parseError) return json({ error: parseError }, { status: 400 });

  const { key, value, error } = normalizeMessage(payload);
  if (error) return json({ error }, { status: 400 });

  await kv.set(key, value);
  scheduleTrim(1);

  return json({ ok: true });
}

// 視聴者1人あたりの書き込み回数を減らすためのまとめ受け口。
// 受信メッセージは全視聴者がそれぞれ転送してくるので、ここが効くと書き込みが大きく減る。
async function handleBulkLog(req) {
  const { payload, error: parseError } = await readJson(req);
  if (parseError) return json({ error: parseError }, { status: 400 });

  const messages = payload?.messages;
  if (!Array.isArray(messages)) return json({ error: "messages array is required" }, { status: 400 });
  if (messages.length > MAX_BULK_MESSAGES) {
    return json({ error: `messages must be ${MAX_BULK_MESSAGES} or fewer` }, { status: 400 });
  }

  // 1件でも不正なら弾くのではなく、保存できるものだけ保存する。
  // fire-and-forgetで送られてくるため、呼び出し側は失敗を再送できない。
  const tx = kv.atomic();
  let stored = 0;
  for (const message of messages) {
    const { key, value, error } = normalizeMessage(message);
    if (error) continue;
    tx.set(key, value);
    stored += 1;
  }
  if (stored > 0) {
    await tx.commit();
    scheduleTrim(stored);
  }

  return json({ ok: true, stored, received: messages.length });
}

async function handleHistory() {
  // 新しい順に HISTORY_LIMIT 件だけ取り、返す直前に古い→新しい順へ戻す。
  // 掃除を間引いている分ここに上限超過が残りうるが、この時点で切り落とされる。
  const messages = [];
  for await (const entry of kv.list({ prefix: ["messages"] }, { reverse: true, limit: HISTORY_LIMIT })) {
    messages.push(entry.value);
  }
  messages.reverse();

  // 数秒の遅れは遡り表示では問題にならないので、短時間だけキャッシュを許可する
  return json({ messages }, { headers: { "Cache-Control": "public, max-age=5" } });
}

Deno.serve((req) => {
  const { pathname } = new URL(req.url);

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (pathname === "/log" && req.method === "POST") {
    return handleLog(req);
  }
  if (pathname === "/log/bulk" && req.method === "POST") {
    return handleBulkLog(req);
  }
  if (pathname === "/history" && req.method === "GET") {
    return handleHistory();
  }
  return json({ error: "Not Found" }, { status: 404 });
});
