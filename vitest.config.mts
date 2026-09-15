// Vitest専用の設定。vite.config.ts(root: "public")とは独立させ、
// vite.config.tsは編集せずにテスト実行環境だけをここで定義する。
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  root: "public",
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest-setup.ts"],
    css: false,
    restoreMocks: true,
  },
});
