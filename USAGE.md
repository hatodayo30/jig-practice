# 使い方

## 概要

このサーバーは 5 つのエンドポイントを持ちます。

| メソッド | パス                        | 用途                                                    |
| -------- | --------------------------- | ------------------------------------------------------- |
| POST     | `/messages`                 | コメント / アイテムの投稿を受け付ける                   |
| GET      | `/events`                   | 全視聴者に配信されるイベントストリーム (SSE) に接続する |
| GET      | `/items`                    | 投稿可能なアイテムの一覧を取得する                      |
| GET      | `/icons/<itemId>.webp`      | アイテムのアイコン画像 (WebP) を取得する                |
| GET      | `/animations/<itemId>.webp` | アイテムのアニメーション画像 (WebP) を取得する          |

視聴者は `/events` に接続しながら、投稿時に `/messages` を叩きます。
投稿は `/events` を通じて自分自身にも他の視聴者にも配信されます。

サーバーは投稿を保持しません。
`/events` に接続した時点より前に投稿されたメッセージは、その接続には届きません。

## POST /messages

コメント (テキスト) またはアイテム投稿を受け付けます。
両方を同時に含めることもできます (テキスト付きアイテム投稿)。

### リクエスト

```
POST /messages HTTP/1.1
Content-Type: application/json

{ "text": "こんにちは" }
```

```
POST /messages HTTP/1.1
Content-Type: application/json

{ "itemId": "heart" }
```

```
POST /messages HTTP/1.1
Content-Type: application/json

{ "text": "こんにちは", "itemId": "heart" }
```

#### ボディフィールド

| フィールド | 型     | 制約                                        |
| ---------- | ------ | ------------------------------------------- |
| `text`     | string | 1〜200 文字 (Unicode コードポイント数)      |
| `itemId`   | string | `GET /items` が返す `items[].id` のいずれか |

`text` と `itemId` は少なくとも一方が必須です。
両方省略した場合は 400 になります。

### 応答 (成功)

```
HTTP/1.1 202 Accepted
Content-Type: application/json

{
  "id": "0d0d6a7e-3a1e-4a3c-8c30-7e7b0b3f6c2c",
  "timestamp": "2026-06-12T03:14:15.123Z"
}
```

202 は「受理した」の意味で、この時点で `/events` に接続中のクライアントへの配信が完了しているとは限りません (非同期)。
`id` と `timestamp` は同じ投稿が `/events` に流れる際にも一致します。

### 応答 (失敗)

| ステータス | `error.code`        | 発生条件                                                                                          |
| ---------- | ------------------- | ------------------------------------------------------------------------------------------------- |
| 400        | `VALIDATION_FAILED` | ボディが JSON でない、`text` / `itemId` 両方欠落、`text` が長すぎる、`itemId` が許可リスト外 など |
| 413        | `PAYLOAD_TOO_LARGE` | リクエストボディが 1024 バイトを超えた                                                            |
| 429        | `RATE_LIMITED`      | 同一クライアントからの投稿レートが上限を超えた (下記「制限値」参照)                               |

エラー応答のボディ形式は「エラー応答」節を参照してください。

## GET /events

Server-Sent Events (SSE) で、全視聴者への配信ストリームに接続します。

### 応答

```
HTTP/1.1 200 OK
Content-Type: text/event-stream

id: 0d0d6a7e-3a1e-4a3c-8c30-7e7b0b3f6c2c
event: message
data: {"id":"0d0d6a7e-3a1e-4a3c-8c30-7e7b0b3f6c2c","text":"こんにちは","item":null,"timestamp":"2026-06-12T03:14:15.123Z"}

:keepalive

id: 3f6c2c0d-0d6a-7e3a-1e4a-3c8c307e7b0b
event: message
data: {"id":"3f6c2c0d-0d6a-7e3a-1e4a-3c8c307e7b0b","text":null,"item":{"id":"heart","name":"ハート","iconUrl":"https://intern-comment-server.intern-comment-server.deno.net/icons/heart.webp?v=fcd08515","cost":10,"group":"気持ち","animationUrl":null},"timestamp":"2026-06-12T03:14:20.456Z"}
```

投稿があるまで接続は開いたままです。
クライアントはいつでも切断できます。

### `message` イベントの `data`

`data` は JSON 文字列です。
パースすると次の形になります。

| フィールド          | 型                 | 内容                                                               |
| ------------------- | ------------------ | ------------------------------------------------------------------ |
| `id`                | string             | 投稿を一意に識別する UUID。POST /messages 応答の `id` と同一       |
| `text`              | string または null | テキスト。アイテム単独投稿の場合は null                            |
| `item`              | object または null | 投稿されたアイテム。テキスト単独投稿の場合は null                  |
| `item.id`           | string             | アイテム ID。`POST /messages` の `itemId` に指定する値             |
| `item.name`         | string             | アイテムの表示名                                                   |
| `item.iconUrl`      | string             | アイテムのアイコン画像の URL。クエリを含めてそのまま使ってください |
| `item.cost`         | number             | アイテムのコスト (10〜1000 の整数)                                 |
| `item.group`        | string             | アイテムの見た目のテーマ                                           |
| `item.animationUrl` | string または null | アニメーション画像の URL。持たないアイテムは null                  |
| `timestamp`         | string             | ISO 8601 形式のタイムスタンプ (UTC)                                |

`text` と `item` は少なくとも一方が非 null です。

トップレベルの `id` は投稿の ID、`item.id` はアイテムの ID です。

アイテムの表示に必要な情報は `item` に揃っているので、受信側は `GET /items` を呼ばずにアイテムを描画できます。
`item` の中身は `GET /items` の要素と同じ形です。

```js
if (payload.item) {
  icon.src = payload.item.iconUrl;
  icon.alt = payload.item.name;
}
```

### keepalive

`:keepalive` で始まる行は SSE のコメント行で、プロキシによる接続タイムアウトを防ぐために定期送信されます。
クライアントは無視して構いません (`EventSource` は自動的に無視します)。

### 履歴なし

接続時点より前の投稿は、その接続には配信されません。
過去のメッセージを取得する手段はありません。

### ダミー投稿

動作確認用に、サーバーが一定間隔でダミーメッセージを流します。
`/events` に接続していれば、何も投稿しなくてもメッセージが降ってきます。

ダミーの内容は全接続で共通です。
同じ時間帯に接続していれば、誰の画面にも同じメッセージが同じ順序で届きます。
接続した直後にまず 1 件届き、以降は一定間隔で続きます。

### 応答 (失敗)

| ステータス | `error.code`           | 発生条件                                       |
| ---------- | ---------------------- | ---------------------------------------------- |
| 429        | `TOO_MANY_CONNECTIONS` | 同一クライアントからの同時接続数が上限を超えた |

## GET /items

投稿できるアイテムの一覧を返します。
アイテム選択 UI の生成に利用してください。

### 応答

```
HTTP/1.1 200 OK
Content-Type: application/json

{
  "items": [
    {
      "id": "heart",
      "name": "ハート",
      "iconUrl": "https://intern-comment-server.intern-comment-server.deno.net/icons/heart.webp?v=fcd08515",
      "cost": 10,
      "group": "気持ち",
      "animationUrl": null
    },
    {
      "id": "star",
      "name": "スター",
      "iconUrl": "https://intern-comment-server.intern-comment-server.deno.net/icons/star.webp?v=3440103d",
      "cost": 50,
      "group": "気持ち",
      "animationUrl": null
    },
    {
      "id": "clap",
      "name": "拍手",
      "iconUrl": "https://intern-comment-server.intern-comment-server.deno.net/icons/clap.webp?v=dbd62569",
      "cost": 1000,
      "group": "気持ち",
      "animationUrl": "https://intern-comment-server.intern-comment-server.deno.net/animations/clap.webp?v=ddc48ca1"
    },
    {
      "id": "flower",
      "name": "お花",
      "iconUrl": "https://intern-comment-server.intern-comment-server.deno.net/icons/flower.webp?v=61d3c7e9",
      "cost": 10,
      "group": "自然",
      "animationUrl": null
    },
    ...
  ]
}
```

| フィールド             | 型                 | 内容                                                              |
| ---------------------- | ------------------ | ----------------------------------------------------------------- |
| `items`                | array              | アイテムの配列                                                    |
| `items[].id`           | string             | `POST /messages` の `itemId` に指定できる値                       |
| `items[].name`         | string             | UI 表示用の名前 (最大 20 文字)                                    |
| `items[].iconUrl`      | string             | アイコン画像の URL。クエリを含めて `<img src>` にそのまま渡せます |
| `items[].cost`         | number             | アイテムのコスト (10〜1000 の整数)                                |
| `items[].group`        | string             | アイテムの見た目のテーマ                                          |
| `items[].animationUrl` | string または null | アニメーション画像の URL。持たないアイテムは null                 |

SSE の `item` と同じ形です。

アイテムの種類が増減する場合があるので、ID をクライアント側にハードコードせず、この一覧から組んでください。

`name` は最大 20 文字です。
上限ちょうどの名前を持つアイテムを 1 つ用意してあるので、長い名前でレイアウトが崩れないかを確認できます。

### `cost`

アイテムに付いた 10〜1000 の整数です。

このサーバーでは所持数をどう持ち、何を単位と呼ぶかは管理しないので、クライアント側で自由に決めてください。

### `group`

アイテムの見た目のテーマです。
`気持ち` / `自然` / `食べ物` / `お祝い` の 4 つがあります。

```js
const byGroup = Map.groupBy(items, (item) => item.group);
```

### `animationUrl`

アニメーション画像を持つアイテムだけが URL を返します。
持たないアイテムは null です。

現在アニメーション画像を持つのは 20 件のうち 4 件です。
残りの 16 件は null なので、null のときはアイコン画像 (`iconUrl`) だけで描画してください。

```js
const src = item.animationUrl ?? item.iconUrl;
```

どのアイテムが持つかは増減しうるので、id を決め打ちせず `GET /items` の応答で分岐してください。

null のアイテムの `/animations/<itemId>.webp` は 404 になります。

## GET /icons/&lt;itemId&gt;.webp

アイテムのアイコン画像 (WebP、192x192) を返します。
`GET /items` の `iconUrl` と SSE の `item.iconUrl` が指す先がこのエンドポイントです。

`iconUrl` には `?v=<ハッシュ>` が付きます。
画像の中身から計算した値で、画像を差し替えると値が変わります。

URL を自分で組み立てないでください。
`iconUrl` をそのまま使ってください。
このクエリを落とすと、画像を差し替えたときに古い画像が最大 1 週間表示され続けます。

### 応答

```
HTTP/1.1 200 OK
Content-Type: image/webp
Cache-Control: public, max-age=604800
```

画像はデプロイでしか変わらないため、1 週間のキャッシュを許可しています。
差し替えたときは `iconUrl` のクエリが変わるので、新しい画像がすぐに表示されます。

クエリはどのファイルを返すかには影響しません。
`?v=` が違っていても、クエリが無くても、同じ画像を返します。

存在しない `itemId` を指定した場合は 404 `NOT_FOUND` になります。

### 素材のライセンス

アイコン画像は [Twemoji](https://github.com/jdecked/twemoji) を元に作られています。
ライセンスは [CC-BY 4.0](https://creativecommons.org/licenses/by/4.0/) で、表示する画面には帰属表記が要ります。
アイコンを表示する画面を公開する場合は、フッタか HTML コメントに 1 行入れてください。

```html
<!-- Icons: Twemoji by Twitter, Inc and other contributors, licensed under CC-BY 4.0 -->
```

表記の全文は [CREDITS.md](./CREDITS.md) にあります。
[`/sample`](https://intern-comment-server.intern-comment-server.deno.net/sample) のフッタが実例です。

## GET /animations/&lt;itemId&gt;.webp

アイテムのアニメーション画像 (WebP) を返します。
`GET /items` の `animationUrl` と SSE の `item.animationUrl` が指す先がこのエンドポイントです。

応答の形とキャッシュの扱いは `/icons/<itemId>.webp` と同じです。
`animationUrl` にも `?v=<ハッシュ>` が付くので、クエリごとそのまま使ってください。

アニメーション画像を持つのは一部のアイテムだけです。
`animationUrl` が null のアイテムを指定した場合は 404 `NOT_FOUND` になります。

アイコン画像と同じ 192x192 で、ループするアニメーション WebP です。
`<img src>` にそのまま渡せば再生されます。

## エラー応答

4xx / 5xx の応答ボディは共通形式です。

```
HTTP/1.1 400 Bad Request
Content-Type: application/json

{
  "error": {
    "code": "VALIDATION_FAILED",
    "message": "Request failed schema validation.",
    "details": [
      { "field": "text", "issue": "too_big", "message": "..." }
    ]
  }
}
```

| フィールド      | 型     | 内容                                                                        |
| --------------- | ------ | --------------------------------------------------------------------------- |
| `error.code`    | string | 機械が読むエラーコード (下記)                                               |
| `error.message` | string | 人間が読むためのエラーの説明                                                |
| `error.details` | array  | 補足情報 (省略される場合あり)。バリデーションエラー時は違反フィールドの一覧 |

### エラーコード一覧

| コード                 | 意味                                                        |
| ---------------------- | ----------------------------------------------------------- |
| `VALIDATION_FAILED`    | リクエストの形式が正しくない                                |
| `PAYLOAD_TOO_LARGE`    | ボディサイズが上限を超えた                                  |
| `RATE_LIMITED`         | 投稿レート上限に達した                                      |
| `TOO_MANY_CONNECTIONS` | SSE 同時接続数上限に達した                                  |
| `NOT_FOUND`            | 存在しないパス (未知のアイコン、素材の無いアニメーション等) |

## サンプルクライアント

[`/sample`](https://intern-comment-server.intern-comment-server.deno.net/sample) に、`POST /messages` と `GET /events` を最低限叩ける HTML ページがあります。

## 制限値

| 項目                                        | 値                                          |
| ------------------------------------------- | ------------------------------------------- |
| `text` の最大文字数                         | 200 文字                                    |
| POST /messages ボディサイズ                 | 1024 バイト                                 |
| POST /messages のレート (同一クライアント)  | 平均 5 req/sec、瞬間最大 10 連続            |
| GET /events の同時接続数 (同一クライアント) | 5                                           |
| `itemId` の許可値                           | `GET /items` が返す `items[].id` のいずれか |
| `items[].name` の最大文字数                 | 20 文字                                     |
