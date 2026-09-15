/// <reference types="vite/client" />

// 履歴サーバーの向き先はデプロイ環境ごとに変わるため、ビルド時の環境変数で差し替える。
// 未設定ならローカル開発用の既定値(http://localhost:8000)にフォールバックする。
interface ImportMetaEnv {
  readonly VITE_HISTORY_SERVER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
