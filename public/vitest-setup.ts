// Vitestの各テストファイル実行前に一度だけ読み込まれるグローバルセットアップ。
// jsdomが未実装のAPI/このアプリのエントリスクリプトが前提とするDOM構造をここで用意する。
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// home.tsx/watch.tsxはモジュール読み込み時に
// `document.getElementById("root")` へ即座にマウントする(存在しないとthrowする)ため、
// どちらかを一度でもimportするテストファイルでは事前にこの要素が必要。
document.body.innerHTML = '<div id="root"></div>';

// RTLでレンダリングしたコンポーネントは各testの後に必ず後片付けする
// (上記の自動マウントされたツリーはここでは消さない。片付けるとimportし直さない限り復活しない)
afterEach(() => {
  cleanup();
});

// jsdomにはmatchMediaが実装されていない。prefersReducedMotion()やtheme.ts相当の
// 呼び出し元がエラーにならないよう、既定では「マッチしない」を返す軽量モックを用意する。
if (!window.matchMedia) {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

// jsdomはscrollIntoView/HTMLMediaElementの再生系メソッドを実装していないため、
// コメント一覧の自動スクロールや動画再生呼び出しがエラーにならないようno-opを与える
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
if (!HTMLMediaElement.prototype.play) {
  HTMLMediaElement.prototype.play = () => Promise.resolve();
}
if (!HTMLMediaElement.prototype.pause) {
  HTMLMediaElement.prototype.pause = () => {};
}

// jsdomのEventSource未実装を補うテスト用モック。watch.tsxのCommentsPanelは
// マウント時に必ず `new EventSource(...)` を呼ぶため、これが無いとどのテストも
// ReferenceErrorで落ちる。生成されたインスタンスは配列に控えておき、
// 各テストからonmessageを発火させたりcloseされたかを確認できるようにする。
export class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) } as MessageEvent);
  }

  close() {
    this.closed = true;
  }
}

(globalThis as unknown as { EventSource: typeof MockEventSource }).EventSource = MockEventSource;

afterEach(() => {
  MockEventSource.instances = [];
});
