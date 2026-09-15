// watch.tsx(視聴画面)のテスト。
//
// watch.tsxもhome.tsxと同様、モジュール読み込み時にdocument.getElementById("root")へ
// createRoot(...).render(<Watch/>)する副作用を持つ(export追加以外は無改変)。
// - hls.jsは実ネットワークに触れないよう常にモック化する(ファイル全体で共有)。
// - EventSourceはjsdom未実装のため、vitest-setup.tsのMockEventSourceを使う。
// - CommentsPanel/StreamMeta/VideoPlayer等の単体テストは、自動マウントされた#rootと
//   ぶつからないようbaseElementを別要素にしたrender()の戻り値だけを使う(screenは使わない)。
// - Watch自体のシナリオ(履歴サーバー・channels.json)は、vi.doMock + resetModules +
//   動的importでフレッシュなモジュールインスタンスを読み込み、#root配下をwithin()で検証する。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, within, act, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState, type ReactElement } from "react";
import {
  maskNgWords,
  formatElapsed,
  streamerInfoFromStream,
  getSeekableRange,
  getLiveEdge,
  LoopCountdown,
  VideoPlayer,
  StreamMeta,
  CommentsPanel,
  RecommendedSidebar,
} from "./watch";
import type { Stream } from "./streams-data";
import { MockEventSource } from "./vitest-setup";

// --- hls.jsのモック(ファイル全体で共有。isSupported等の戻り値はテストごとに変える) ---
const hlsMocks = vi.hoisted(() => ({
  isSupported: vi.fn(() => true),
  loadSource: vi.fn(),
  attachMedia: vi.fn(),
  on: vi.fn(),
  destroy: vi.fn(),
}));

vi.mock("hls.js", () => {
  class MockHls {
    static isSupported = hlsMocks.isSupported;
    static Events = { MANIFEST_PARSED: "hlsManifestParsed" };
    liveSyncPosition: number | null = null;
    loadSource = hlsMocks.loadSource;
    attachMedia = hlsMocks.attachMedia;
    on = hlsMocks.on;
    destroy = hlsMocks.destroy;
  }
  return { default: MockHls };
});

function renderIsolated(ui: ReactElement) {
  const baseElement = document.createElement("div");
  document.body.appendChild(baseElement);
  return render(ui, { baseElement });
}

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: "s1",
    title: "テスト配信",
    streamerName: "てすと",
    viewerCount: 100,
    category: "コメディ",
    thumbnailColor: "#112233",
    isRecommended: false,
    channelId: "llamigos",
    ...overrides,
  };
}

interface TestItem {
  id: string;
  name: string;
  iconUrl: string;
  cost: number;
  animationUrl?: string;
}

interface TestComment {
  key: number;
  id?: string;
  text?: string;
  item?: TestItem;
  isNew: boolean;
}

function makeVideoStub(options: { buffered?: { start: number; end: number }[]; currentTime?: number } = {}) {
  const ranges = options.buffered ?? [];
  const buffered = {
    length: ranges.length,
    start: (i: number) => ranges[i].start,
    end: (i: number) => ranges[i].end,
  };
  return { buffered, currentTime: options.currentTime ?? 0 } as unknown as HTMLVideoElement;
}

beforeEach(() => {
  localStorage.clear();
  hlsMocks.isSupported.mockReturnValue(true);
  hlsMocks.loadSource.mockClear();
  hlsMocks.attachMedia.mockClear();
  hlsMocks.on.mockClear();
  hlsMocks.destroy.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("maskNgWords", () => {
  it("NGワードを***に置換する", () => {
    expect(maskNgWords("死ねばいいのに")).toBe("***ばいいのに");
  });

  it("NGワードを含まない文字列はそのまま返す", () => {
    expect(maskNgWords("こんにちは")).toBe("こんにちは");
  });

  it("複数種類のNGワードをまとめて置換する", () => {
    expect(maskNgWords("バカかアホか")).toBe("***か***か");
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "00:00"],
    [5, "00:05"],
    [65, "01:05"],
    [3599, "59:59"],
    [3600, "1:00:00"],
    [3665, "1:01:05"],
  ])("%i秒 -> %s", (seconds, expected) => {
    expect(formatElapsed(seconds)).toBe(expected);
  });

  it.each([-1, NaN, Infinity])("%pのとき--:--を返す", (seconds) => {
    expect(formatElapsed(seconds)).toBe("--:--");
  });
});

describe("streamerInfoFromStream", () => {
  it("categoryからlabel/tagsを導出する", () => {
    const stream = makeStream({ title: "配信タイトル", streamerName: "配信者名", category: "SF" });
    expect(streamerInfoFromStream(stream)).toMatchObject({
      title: "配信タイトル",
      name: "配信者名",
      label: "SFチャンネル",
      tags: ["SF"],
    });
  });
});

describe("getSeekableRange", () => {
  it("bufferedが空のときnullを返す", () => {
    expect(getSeekableRange(makeVideoStub())).toBeNull();
  });

  it("currentTimeを含む区間を選択する", () => {
    const video = makeVideoStub({
      buffered: [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
      currentTime: 25,
    });
    expect(getSeekableRange(video)).toEqual({ start: 20, end: 30 });
  });

  it("どの区間にも含まれなければ最後の区間を返す", () => {
    const video = makeVideoStub({
      buffered: [
        { start: 0, end: 10 },
        { start: 20, end: 30 },
      ],
      currentTime: 100,
    });
    expect(getSeekableRange(video)).toEqual({ start: 20, end: 30 });
  });
});

describe("getLiveEdge", () => {
  it("hls.liveSyncPositionが有限ならそれを優先する", () => {
    const hls = { liveSyncPosition: 42 } as unknown as Parameters<typeof getLiveEdge>[0];
    expect(getLiveEdge(hls, { start: 0, end: 30 })).toBe(42);
  });

  it("hlsが無ければrange.endを返す", () => {
    expect(getLiveEdge(null, { start: 0, end: 30 })).toBe(30);
  });
});

describe("LoopCountdown", () => {
  it("durationSecondsが無ければ何も描画しない", () => {
    const { container } = renderIsolated(
      <LoopCountdown durationSeconds={null} rootRef={{ current: null }} ringRef={{ current: null }} timeRef={{ current: null }} />
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("durationSeconds指定時は器を描画し、初期表示は--:--", () => {
    const { getByText } = renderIsolated(
      <LoopCountdown durationSeconds={600} rootRef={{ current: null }} ringRef={{ current: null }} timeRef={{ current: null }} />
    );
    expect(getByText("次のループまで")).toBeInTheDocument();
    expect(getByText("--:--")).toBeInTheDocument();
  });
});

describe("VideoPlayer", () => {
  const baseProps = { giftAnimations: [], loopDurationSeconds: null, comments: [] };

  it("playlistUrlが無いとき読み込み中を表示する", () => {
    const { getByText } = renderIsolated(<VideoPlayer playlistUrl={null} {...baseProps} />);
    expect(getByText("読み込み中...")).toBeInTheDocument();
  });

  it("Hls.isSupported()がtrueならloadSource/attachMediaが呼ばれる", () => {
    hlsMocks.isSupported.mockReturnValue(true);
    renderIsolated(<VideoPlayer playlistUrl="https://example.com/stream.m3u8" {...baseProps} />);
    expect(hlsMocks.loadSource).toHaveBeenCalledWith("https://example.com/stream.m3u8");
    expect(hlsMocks.attachMedia).toHaveBeenCalled();
  });

  it("hls.js非対応かつネイティブHLSも非対応の場合はクラッシュせずに描画する", () => {
    hlsMocks.isSupported.mockReturnValue(false);
    const originalCanPlayType = HTMLMediaElement.prototype.canPlayType;
    HTMLMediaElement.prototype.canPlayType = () => "";
    try {
      expect(() => renderIsolated(<VideoPlayer playlistUrl="https://example.com/stream.m3u8" {...baseProps} />)).not.toThrow();
      expect(hlsMocks.loadSource).not.toHaveBeenCalled();
    } finally {
      HTMLMediaElement.prototype.canPlayType = originalCanPlayType;
    }
  });
});

describe("StreamMeta", () => {
  const streamer = streamerInfoFromStream(makeStream({ streamerName: "ゆずき", category: "コメディ" }));

  it("フォローボタンをクリックするとフォロー中表示に切り替わる", async () => {
    const { getByRole } = renderIsolated(<StreamMeta streamer={streamer} />);
    const button = getByRole("button", { name: /フォロー/ });
    expect(button).toHaveAttribute("aria-pressed", "false");

    await userEvent.click(button);

    expect(button).toHaveAttribute("aria-pressed", "true");
    expect(localStorage.getItem("follow:ゆずき")).toBe("true");
  });

  it("いいねボタンをクリックするとカウントが増える", async () => {
    const { getByRole, getByText } = renderIsolated(<StreamMeta streamer={streamer} />);
    expect(getByText("0")).toBeInTheDocument();

    await userEvent.click(getByRole("button", { name: "いいね" }));

    expect(getByText("1")).toBeInTheDocument();
    expect(localStorage.getItem("likeCount")).toBe("1");
  });
});

describe("CommentsPanel", () => {
  function CommentsPanelHarness({ initialComments = [] }: { initialComments?: TestComment[] }) {
    const [comments, setComments] = useState<TestComment[]>(initialComments);
    const appendComment = (comment: TestComment) => setComments((prev) => [...prev, comment]);
    return <CommentsPanel comments={comments} appendComment={appendComment} onGiftItem={() => {}} />;
  }

  function mockFetch(handler: (url: string, init?: RequestInit) => Promise<Partial<Response> & { json?: () => unknown }> | (Partial<Response> & { json?: () => unknown })) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        const result = await handler(url, init);
        return { ok: true, status: 200, json: async () => undefined, ...result } as Response;
      })
    );
  }

  it("コメントが無いとき空状態を表示する", () => {
    mockFetch(() => ({}));
    const { getByText } = renderIsolated(<CommentsPanelHarness />);
    expect(getByText("まだコメントはありません")).toBeInTheDocument();
  });

  it("EventSourceでテキストコメントを受信すると一覧に追加され、履歴サーバーへ転送する", async () => {
    mockFetch(() => ({}));
    const { getByText } = renderIsolated(<CommentsPanelHarness />);

    const source = MockEventSource.instances[MockEventSource.instances.length - 1];
    expect(source).toBeDefined();
    act(() => {
      source!.emit({ id: "m1", text: "こんにちは", timestamp: "2026-01-01T00:00:00.000Z" });
    });

    await waitFor(() => expect(getByText("こんにちは")).toBeInTheDocument());

    // 履歴サーバーへの転送は1件ずつ即POSTせず、一定間隔でまとめて /log/bulk へ送る。
    // (全視聴者が同じメッセージを転送するため、即POSTだと視聴者数分の書き込みになる)
    const fetchMock = globalThis.fetch as ReturnType<typeof vi.fn>;
    await waitFor(
      () =>
        expect(fetchMock).toHaveBeenCalledWith(
          "http://localhost:8000/log/bulk",
          expect.objectContaining({ method: "POST" })
        ),
      { timeout: 3000 }
    );

    const bulkCall = fetchMock.mock.calls.find(([url]) => url === "http://localhost:8000/log/bulk");
    expect(JSON.parse((bulkCall![1] as RequestInit).body as string)).toEqual({
      messages: [{ id: "m1", text: "こんにちは", item: null, timestamp: "2026-01-01T00:00:00.000Z" }],
    });
  });

  it("NGワードを含むコメントはマスクして表示する", async () => {
    mockFetch(() => ({}));
    const { getByText } = renderIsolated(<CommentsPanelHarness />);
    const source = MockEventSource.instances[MockEventSource.instances.length - 1]!;
    act(() => {
      source.emit({ id: "m2", text: "アホか" });
    });
    await waitFor(() => expect(getByText("***か")).toBeInTheDocument());
  });

  it("アイテム一覧の取得に失敗したらエラーと再取得ボタンを表示する", async () => {
    mockFetch((url) => {
      if (typeof url === "string" && url.includes("/items")) return { ok: false, status: 500 };
      return {};
    });
    const { getByRole, getByText } = renderIsolated(<CommentsPanelHarness />);

    await userEvent.click(getByRole("button", { name: "ギフト" }));

    await waitFor(() => expect(getByText("アイテム一覧の取得に失敗しました。")).toBeInTheDocument());
    expect(getByRole("button", { name: "再取得" })).toBeInTheDocument();
  });

  it("200文字を超えるコメントは送信できず文字数エラーを表示する", async () => {
    mockFetch(() => ({}));
    const { getByPlaceholderText, getByRole, getByText } = renderIsolated(<CommentsPanelHarness />);
    const textarea = getByPlaceholderText("コメントを入力");

    fireEvent.change(textarea, { target: { value: "あ".repeat(201) } });

    expect(getByRole("button", { name: "送信" })).toBeDisabled();
    expect(getByText("文字数が上限(200文字)を超えています。")).toBeInTheDocument();
  });

  it("コメント送信が成功すると入力欄がクリアされる", async () => {
    mockFetch(() => ({}));
    const { getByPlaceholderText, getByRole } = renderIsolated(<CommentsPanelHarness />);
    const textarea = getByPlaceholderText("コメントを入力") as HTMLTextAreaElement;

    await userEvent.type(textarea, "やっほー");
    await userEvent.click(getByRole("button", { name: "送信" }));

    await waitFor(() => expect(textarea.value).toBe(""));
  });

  it("コメント送信が失敗すると送信エラーを表示する", async () => {
    mockFetch((url) => {
      if (typeof url === "string" && url.includes("/messages")) return { ok: false, status: 500 };
      return {};
    });
    const { getByPlaceholderText, getByRole, getByText } = renderIsolated(<CommentsPanelHarness />);
    const textarea = getByPlaceholderText("コメントを入力");

    await userEvent.type(textarea, "やっほー");
    await userEvent.click(getByRole("button", { name: "送信" }));

    await waitFor(() =>
      expect(getByText("送信に失敗しました。通信環境をご確認のうえ、再送信してください。")).toBeInTheDocument()
    );
  });
});

describe("RecommendedSidebar", () => {
  it("activeChannelIdと一致する配信を除外して表示する", () => {
    const streams = [
      makeStream({ id: "1", channelId: "llamigos", title: "配信A" }),
      makeStream({ id: "2", channelId: "sintel", title: "配信B" }),
    ];
    const { getByText, queryByText } = renderIsolated(
      <RecommendedSidebar streams={streams} activeChannelId="llamigos" />
    );
    expect(getByText("配信B")).toBeInTheDocument();
    expect(queryByText("配信A")).not.toBeInTheDocument();
  });

  it("除外後に0件なら何も描画しない", () => {
    const streams = [makeStream({ id: "1", channelId: "llamigos" })];
    const { container } = renderIsolated(<RecommendedSidebar streams={streams} activeChannelId="llamigos" />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("Watch", () => {
  function mockFetch(handler: (url: string) => (Partial<Response> & { json?: () => unknown }) | Promise<never>) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const result = await handler(url);
        return { ok: true, status: 200, json: async () => undefined, ...result } as Response;
      })
    );
  }

  async function mountWatch(search = "") {
    window.history.pushState({}, "", `/watch.html${search}`);
    vi.resetModules();
    document.body.innerHTML = '<div id="root"></div>';
    await import("./watch");
    return within(document.getElementById("root") as HTMLElement);
  }

  afterEach(() => {
    window.history.pushState({}, "", "/watch.html");
  });

  it("正常系: 履歴サーバーの過去コメントを初期表示する", async () => {
    mockFetch((url) => {
      if (url.includes("/history")) {
        return { json: async () => ({ messages: [{ id: "h1", text: "過去のコメント", item: null }] }) };
      }
      if (url.includes("/channels.json")) return { json: async () => [] };
      return {};
    });

    const root = await mountWatch();
    await waitFor(() => expect(root.getByText("過去のコメント")).toBeInTheDocument());
  });

  it("異常系: 履歴サーバーが応答しなくてもクラッシュせず通常表示になる", async () => {
    mockFetch((url) => {
      if (url.includes("/history")) return Promise.reject(new Error("network error"));
      if (url.includes("/channels.json")) return { json: async () => [] };
      return {};
    });

    const root = await mountWatch();
    await waitFor(() => expect(root.getByText("まだコメントはありません")).toBeInTheDocument());
  });

  it("channelId指定時、一致するチャンネルのplaylistで再生する", async () => {
    mockFetch((url) => {
      if (url.includes("/channels.json")) {
        return {
          json: async () => [
            { id: "sintel", title: "Sintel", category: "ファンタジー", playlist: "/sintel/stream.m3u8", default: false },
            { id: "llamigos", title: "Llamigos", category: "コメディ", playlist: "/llamigos/stream.m3u8", default: true },
          ],
        };
      }
      if (url.includes("/history")) return { json: async () => ({ messages: [] }) };
      return {};
    });

    await mountWatch("?channelId=sintel");
    await waitFor(() =>
      expect(hlsMocks.loadSource).toHaveBeenCalledWith("https://intern-hls-server.tomaton.workers.dev/sintel/stream.m3u8")
    );
  });

  it("異常系: channels.jsonの取得に失敗したら後方互換の固定URLで再生を続ける", async () => {
    mockFetch((url) => {
      if (url.includes("/channels.json")) return Promise.reject(new Error("network error"));
      if (url.includes("/history")) return { json: async () => ({ messages: [] }) };
      return {};
    });

    await mountWatch("?channelId=sintel");
    await waitFor(() =>
      expect(hlsMocks.loadSource).toHaveBeenCalledWith("https://intern-hls-server.tomaton.workers.dev/stream.m3u8")
    );
  });
});
