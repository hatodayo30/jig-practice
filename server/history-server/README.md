# コメント履歴サーバー

配信画面のコメント欄で「途中から見ても過去コメントが見える」機能を支える、自前の小さなバックエンドです。
`intern-comment-server` の `/events` は接続前の投稿を保持しないため、フロントエンド([public/watch.tsx](../../public/watch.tsx))が受信したメッセージをこのサーバーにも転送し、直近50件を保存しています。

## ローカルでの起動方法

```sh
deno run --allow-net --allow-read --unstable-kv main.js
```

`Listening on http://0.0.0.0:8000/` と表示されたら起動成功です。

`Deno.openKv()`にパスを渡していないため、ローカル実行時は`main.js`のパスごとに固定されたキャッシュ上のDB(`~/Library/Caches/deno/location_data/.../kv.sqlite3`など)を使い続けます。過去の投稿を消してまっさらな状態から試したい場合は、そのファイルを削除してから再起動してください。Deno Deployにデプロイした場合は、デプロイごとに独立したKVが自動的に割り当たるため気にする必要はありません。

## 動作確認

```sh
curl -X POST localhost:8000/log -H 'Content-Type: application/json' \
  -d '{"id":"t1","text":"hello","timestamp":"2026-01-01T00:00:00.000Z"}'

curl localhost:8000/history
```

## エンドポイント

| メソッド / パス | 動作 |
| --- | --- |
| `POST /log` | フロントが受信したメッセージ1件(`id`必須、`text`と`item`は少なくとも一方)を記録する |
| `GET /history` | 直近50件を古い→新しい順で返す(`{ messages: [...] }`) |

## Deno Deployへのデプロイ(ここは手動作業です)

1. https://dash.deno.com/ で自分のアカウントを使ってプロジェクトを作成する
2. このリポジトリを連携するか、`main.js`をエントリポイントとしてアップロードする
3. デプロイ後に発行されるURL(例: `https://xxxx.deno.dev`)を控える
4. [public/watch.tsx](../../public/watch.tsx)の`HISTORY_SERVER_URL`定数を、控えたURLに書き換える

デプロイ前でも、`HISTORY_SERVER_URL`が到達不能な間はフロント側が黙ってエラーを握りつぶすだけなので、配信アプリ自体は通常通り動きます。
