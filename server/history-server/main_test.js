// main.js のユニットテスト。
//
// main.js はモジュールのトップレベルで
//   - Deno.openKv()   … 引数なし = 本番/ローカルの永続KVを開く
//   - Deno.serve(...) … 即座にポートをlistenする
// を実行するため、そのままimportすると本番データに触れ、実サーバーが起動してしまう。
// そこで import 前に Deno.openKv / Deno.serve を一時的にスタブへ差し替え、
//   - openKv は ":memory:" を渡した一時KV(テスト用)を返すようにする
//   - serve は実際にlistenせず、渡されたルーティングハンドラ関数を捕まえるだけにする
// ことで副作用を無害化する。ESモジュールは2回目以降のimportで再実行されないため、
// この差し替え → import → 復元は本ファイルで1回だけ行い、以降の全テストは
// キャプチャした「ルーティングハンドラ関数」と「一時KVインスタンス」を共有する。
//
// 注意: このテストは単一プロセス・単一KVインスタンスでの検証である。
// main.js は「Deno Deployが複数インスタンスに複製してもKV経由で同じ履歴が見える」
// ことを狙った設計だが、複数インスタンス間でのデータ共有そのものはこのテストの
// 対象外(単一インスタンステスト)。

import { assertEquals, assertStringIncludes } from "jsr:@std/assert";

const HISTORY_LIMIT = 50;

/** @type {(req: Request) => Response | Promise<Response>} */
let handler;
/** @type {Deno.Kv} */
let kv;

{
  const origOpenKvDesc = Object.getOwnPropertyDescriptor(Deno, "openKv");
  const origServeDesc = Object.getOwnPropertyDescriptor(Deno, "serve");
  const realOpenKv = Deno.openKv;

  Object.defineProperty(Deno, "openKv", {
    configurable: true,
    value: async () => {
      kv = await realOpenKv(":memory:");
      return kv;
    },
  });
  Object.defineProperty(Deno, "serve", {
    configurable: true,
    value: (h) => {
      handler = h;
      // main.js top-level は戻り値を使わないため、最低限の形だけ満たす。
      return {
        finished: Promise.resolve(),
        shutdown: () => Promise.resolve(),
        ref() {},
        unref() {},
        addr: { transport: "tcp", hostname: "127.0.0.1", port: 0 },
      };
    },
  });

  await import("./main.js");

  Object.defineProperty(Deno, "openKv", origOpenKvDesc);
  Object.defineProperty(Deno, "serve", origServeDesc);
}

/** 各テスト開始前に履歴を空にする */
async function clearMessages() {
  for await (const entry of kv.list({ prefix: ["messages"] })) {
    await kv.delete(entry.key);
  }
}

/** POST /log を叩くヘルパー */
function postLog(body) {
  const init = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
  };
  if (typeof body === "string") {
    init.body = body; // 不正JSONを直接送りたいケース用
  } else if (body !== undefined) {
    init.body = JSON.stringify(body);
  }
  return handler(new Request("http://localhost/log", init));
}

/** GET /history を叩くヘルパー */
function getHistory() {
  return handler(new Request("http://localhost/history"));
}

// --- POST /log -------------------------------------------------------

Deno.test("POST /log: 正常系 - idとtextを含む正しいリクエストで記録される", async () => {
  await clearMessages();

  const res = await postLog({
    id: "msg-1",
    text: "hello",
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { ok: true });

  const historyRes = await getHistory();
  const { messages } = await historyRes.json();
  assertEquals(messages.length, 1);
  assertEquals(messages[0], {
    id: "msg-1",
    text: "hello",
    item: null,
    timestamp: "2026-01-01T00:00:00.000Z",
  });
});

Deno.test("POST /log: 異常系 - idが未指定なら400", async () => {
  await clearMessages();

  const res = await postLog({ text: "hello" });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertStringIncludes(body.error, "id");

  const { messages } = await (await getHistory()).json();
  assertEquals(messages.length, 0);
});

Deno.test("POST /log: 異常系 - 不正なJSONなら400", async () => {
  await clearMessages();

  const res = await postLog("{not valid json");
  assertEquals(res.status, 400);
  const body = await res.json();
  assertStringIncludes(body.error, "JSON");

  const { messages } = await (await getHistory()).json();
  assertEquals(messages.length, 0);
});

Deno.test("POST /log: 異常系 - textとitemが両方欠如していたら400", async () => {
  await clearMessages();

  const res = await postLog({ id: "msg-1" });
  assertEquals(res.status, 400);
  const body = await res.json();
  assertStringIncludes(body.error, "text");

  const { messages } = await (await getHistory()).json();
  assertEquals(messages.length, 0);
});

Deno.test("POST /log: itemのみでも記録される(textの代替として許容)", async () => {
  await clearMessages();

  const res = await postLog({
    id: "msg-1",
    item: { kind: "gift", name: "star" },
    timestamp: "2026-01-01T00:00:00.000Z",
  });
  assertEquals(res.status, 200);

  const { messages } = await (await getHistory()).json();
  assertEquals(messages.length, 1);
  assertEquals(messages[0].item, { kind: "gift", name: "star" });
});

// --- GET /history ------------------------------------------------------

Deno.test("GET /history: 履歴が0件のとき空配列を返す", async () => {
  await clearMessages();

  const res = await getHistory();
  assertEquals(res.status, 200);
  assertEquals(await res.json(), { messages: [] });
});

Deno.test("GET /history: 直近の投稿が古い→新しい順で返る", async () => {
  await clearMessages();

  const timestamps = [
    "2026-01-01T00:00:00.000Z",
    "2026-01-03T00:00:00.000Z",
    "2026-01-02T00:00:00.000Z",
  ];
  for (const ts of timestamps) {
    const res = await postLog({ id: `id-${ts}`, text: "m", timestamp: ts });
    assertEquals(res.status, 200);
  }

  const { messages } = await (await getHistory()).json();
  assertEquals(
    messages.map((m) => m.timestamp),
    ["2026-01-01T00:00:00.000Z", "2026-01-02T00:00:00.000Z", "2026-01-03T00:00:00.000Z"],
  );
});

Deno.test("GET /history: 51件投稿すると最古の1件が切り詰められ50件になる", async () => {
  await clearMessages();

  const total = HISTORY_LIMIT + 1;
  for (let i = 0; i < total; i++) {
    const ts = new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString();
    const res = await postLog({ id: `id-${i}`, text: `m${i}`, timestamp: ts });
    assertEquals(res.status, 200);
  }

  const { messages } = await (await getHistory()).json();
  assertEquals(messages.length, HISTORY_LIMIT);
  // 最も古い id-0(秒=0) は消え、id-1 以降 id-50 までの50件が残る。
  assertEquals(messages[0].id, "id-1");
  assertEquals(messages[messages.length - 1].id, `id-${total - 1}`);
});

// --- CORS ---------------------------------------------------------------

Deno.test("CORS: 通常レスポンスにもCORSヘッダが付与される", async () => {
  await clearMessages();

  const res = await getHistory();
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), "Content-Type");
});

Deno.test("CORS: OPTIONSプリフライトリクエストに204とCORSヘッダを返す", async () => {
  const res = await handler(new Request("http://localhost/log", { method: "OPTIONS" }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get("Access-Control-Allow-Origin"), "*");
  assertEquals(res.headers.get("Access-Control-Allow-Methods"), "GET, POST, OPTIONS");
  assertEquals(res.headers.get("Access-Control-Allow-Headers"), "Content-Type");
});

// --- その他 ---------------------------------------------------------------

Deno.test("未定義パスへのリクエストは404", async () => {
  const res = await handler(new Request("http://localhost/unknown"));
  assertEquals(res.status, 404);
  assertEquals(await res.json(), { error: "Not Found" });
});
