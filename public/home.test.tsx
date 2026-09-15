// home.tsx(ホーム画面)のテスト。
//
// home.tsxはモジュール読み込み時に document.getElementById("root") へ即座に
// createRoot(...).render(<App/>) するエントリスクリプトのため(export追加以外は
// 無改変)、どのシンボルをimportしてもこの副作用が一度だけ走る。
// - StreamCard/StreamGrid等の単体テストは、自動マウントされた#rootとぶつからないよう
//   render()にbaseElementを別要素で指定し、返ってくるクエリだけを使う(screenは使わない)。
// - App自体の状態(loading/ready/error/カテゴリ絞り込み)を差し替えてテストしたい箇所は、
//   vi.doMock + vi.resetModules() + 動的importで、streams-dataを差し替えた
//   フレッシュなモジュールインスタンスを都度読み込み、#root配下をwithin()で検証する。
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, waitFor, within, renderHook, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactElement } from "react";
import {
  hexToRgb,
  darken,
  StreamCard,
  StreamGrid,
  RecommendedMarquee,
  ChannelRankingSection,
  TodaysPickSection,
  useStreamList,
} from "./home";
import type { Stream } from "./streams-data";

function renderIsolated(ui: ReactElement) {
  const baseElement = document.createElement("div");
  document.body.appendChild(baseElement);
  return render(ui, { baseElement });
}

function makeStream(overrides: Partial<Stream> = {}): Stream {
  return {
    id: "s1",
    title: "テスト配信タイトル",
    streamerName: "てすと配信者",
    viewerCount: 1234,
    category: "コメディ",
    thumbnailColor: "#112233",
    isRecommended: false,
    channelId: "llamigos",
    ...overrides,
  };
}

describe("hexToRgb", () => {
  it("6桁hex(#あり)をRGBに変換する", () => {
    expect(hexToRgb("#ff0080")).toEqual([255, 0, 128]);
  });

  it("6桁hex(#なし)も変換できる", () => {
    expect(hexToRgb("ff0080")).toEqual([255, 0, 128]);
  });

  it("3桁の省略形を展開して変換する", () => {
    expect(hexToRgb("#f08")).toEqual([255, 0, 136]);
  });
});

describe("darken", () => {
  it("ratio=0では元の色を維持する", () => {
    expect(darken("#664422", 0)).toBe("rgb(102, 68, 34)");
  });

  it("ratio=1では黒(0,0,0)になる", () => {
    expect(darken("#664422", 1)).toBe("rgb(0, 0, 0)");
  });
});

describe("StreamCard", () => {
  it("配信情報を表示し、watch.htmlへのリンクを持つ", () => {
    const stream = makeStream({
      title: "雑談配信",
      streamerName: "はると",
      viewerCount: 1234,
      category: "コメディ",
      channelId: "llamigos",
    });
    const { getByText, getByRole } = renderIsolated(<StreamCard stream={stream} index={0} />);

    expect(getByText("雑談配信")).toBeInTheDocument();
    expect(getByText("はると")).toBeInTheDocument();
    expect(getByText("コメディ")).toBeInTheDocument();
    expect(getByText("LIVE")).toBeInTheDocument();
    expect(getByText("1,234人")).toBeInTheDocument();

    const link = getByRole("link");
    expect(link).toHaveAttribute("href", "/watch.html?channelId=llamigos");
  });
});

describe("StreamGrid", () => {
  const props = {
    errorMessage: "エラーメッセージ",
    emptyMessage: "空メッセージ",
  };

  it("state=loadingのとき読み込み中を表示する", () => {
    const { getByText } = renderIsolated(<StreamGrid streams={[]} state="loading" {...props} />);
    expect(getByText("読み込み中...")).toBeInTheDocument();
  });

  it("state=errorのときerrorMessageを表示する", () => {
    const { getByText } = renderIsolated(<StreamGrid streams={[]} state="error" {...props} />);
    expect(getByText("エラーメッセージ")).toBeInTheDocument();
  });

  it("streamsが空のときemptyMessageを表示する", () => {
    const { getByText } = renderIsolated(<StreamGrid streams={[]} state="ready" {...props} />);
    expect(getByText("空メッセージ")).toBeInTheDocument();
  });

  it("正常データのとき件数分のStreamCardを表示する", () => {
    const streams = [makeStream({ id: "1", title: "配信1" }), makeStream({ id: "2", title: "配信2" })];
    const { getByText, getAllByRole } = renderIsolated(<StreamGrid streams={streams} state="ready" {...props} />);
    expect(getByText("配信1")).toBeInTheDocument();
    expect(getByText("配信2")).toBeInTheDocument();
    expect(getAllByRole("link")).toHaveLength(2);
  });
});

describe("RecommendedMarquee", () => {
  const props = {
    errorMessage: "おすすめエラー",
    emptyMessage: "おすすめ空",
  };

  it("state=loadingのとき読み込み中を表示する", () => {
    const { getByText } = renderIsolated(<RecommendedMarquee streams={[]} state="loading" {...props} />);
    expect(getByText("読み込み中...")).toBeInTheDocument();
  });

  it("state=errorのときerrorMessageを表示する", () => {
    const { getByText } = renderIsolated(<RecommendedMarquee streams={[]} state="error" {...props} />);
    expect(getByText("おすすめエラー")).toBeInTheDocument();
  });

  it("streamsが空のときemptyMessageを表示する", () => {
    const { getByText } = renderIsolated(<RecommendedMarquee streams={[]} state="ready" {...props} />);
    expect(getByText("おすすめ空")).toBeInTheDocument();
  });

  it("正常データのとき配信タイトルを表示する(複製表示を含む)", () => {
    const streams = [makeStream({ id: "1", title: "おすすめ配信A" })];
    const { getAllByText } = renderIsolated(<RecommendedMarquee streams={streams} state="ready" {...props} />);
    // マーキーはシームレスループ用に複数セット複製されるため、複数出現し得る
    expect(getAllByText("おすすめ配信A").length).toBeGreaterThanOrEqual(1);
  });
});

describe("ChannelRankingSection", () => {
  it("視聴数の多い順にチャンネルをランキング表示する", () => {
    const streams = [
      makeStream({ channelId: "llamigos", viewerCount: 100 }),
      makeStream({ channelId: "sintel", viewerCount: 900 }),
    ];
    const { getByText, getAllByRole } = renderIsolated(<ChannelRankingSection streams={streams} />);
    expect(getByText("視聴数ランキング")).toBeInTheDocument();
    expect(getByText("13ch")).toBeInTheDocument();

    const links = getAllByRole("link");
    // sintelがllamigosより視聴数が多いので先頭に来る
    expect(links[0]).toHaveAttribute("href", "/watch.html?channelId=sintel");
  });

  it("対応する配信データが無いチャンネルは0人として表示する", () => {
    const { getAllByText } = renderIsolated(<ChannelRankingSection streams={[]} />);
    expect(getAllByText("0人").length).toBeGreaterThan(0);
  });
});

describe("TodaysPickSection", () => {
  it("streamsが空のとき何も描画しない", () => {
    const { container } = renderIsolated(<TodaysPickSection streams={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("初期状態でサイコロを振るボタンを表示する", () => {
    const streams = [makeStream()];
    const { getByRole } = renderIsolated(<TodaysPickSection streams={streams} />);
    expect(getByRole("button", { name: /サイコロを振る/ })).toBeInTheDocument();
  });
});

describe("useStreamList", () => {
  it("初期状態はloading", () => {
    const { result } = renderHook(() => useStreamList(() => new Promise<Stream[]>(() => {})));
    expect(result.current.state).toBe("loading");
  });

  it("fetcherが成功したらstateがreadyになりstreamsを保持する", async () => {
    const streams = [makeStream()];
    const { result } = renderHook(() => useStreamList(() => Promise.resolve(streams)));
    await waitFor(() => expect(result.current.state).toBe("ready"));
    expect(result.current.streams).toEqual(streams);
  });

  it("fetcherが失敗したらstateがerrorになる", async () => {
    const { result } = renderHook(() => useStreamList(() => Promise.reject(new Error("fail"))));
    await waitFor(() => expect(result.current.state).toBe("error"));
  });
});

describe("App", () => {
  function mockStreamsData(overrides: {
    fetchStreams?: () => Promise<Stream[]>;
    fetchRecommendedStreams?: () => Promise<Stream[]>;
  }) {
    vi.doMock("./streams-data", () => ({
      fetchStreams: vi.fn(overrides.fetchStreams ?? (() => Promise.resolve([]))),
      fetchRecommendedStreams: vi.fn(overrides.fetchRecommendedStreams ?? (() => Promise.resolve([]))),
    }));
  }

  async function mountApp() {
    document.body.innerHTML = '<div id="root"></div>';
    // dynamic import()の解決は、home.tsx末尾のcreateRoot(...).render(...)による
    // 初回コミットの完了を保証しない(Vite/ReactのスケジューリングでマクロタスクS1つ分
    // 遅れることがある)ため、act()でくるみつつ1tick分フラッシュしてから返す。
    await act(async () => {
      await import("./home");
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    return within(document.getElementById("root") as HTMLElement);
  }

  // 「配信一覧」セクションだけに絞ってクエリするヘルパー。
  // 同じ配信タイトルは視聴数ランキング(実カタログ13件、常に表示)やTodaysPickSectionの
  // ルーレットリール(全ストリームをROULETTE_REPEAT回複製)にも登場しうるため、
  // #root全体に対するgetByTextでは複数一致してしまう。
  function getStreamListSection(root: ReturnType<typeof within>) {
    const heading = root.getByRole("heading", { name: "配信一覧" });
    return within(heading.closest("section") as HTMLElement);
  }

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    vi.doUnmock("./streams-data");
  });

  it("正常系: 配信一覧の件数・カテゴリ絞り込みが表示され、クリックで絞り込める", async () => {
    const streams = [
      makeStream({ id: "1", title: "配信A", category: "コメディ", channelId: "llamigos" }),
      makeStream({ id: "2", title: "配信B", category: "SF", channelId: "sintel" }),
      makeStream({ id: "3", title: "配信C", category: "ドラマ", channelId: "spring" }),
    ];
    mockStreamsData({
      fetchStreams: () => Promise.resolve(streams),
      fetchRecommendedStreams: () => Promise.resolve([streams[0]]),
    });

    const root = await mountApp();
    await waitFor(() => expect(root.getByText("3件")).toBeInTheDocument());

    const scifiChip = root.getByRole("button", { name: "SF" });
    await userEvent.click(scifiChip);

    // 配信タイトルは視聴数ランキング/今日の1本のルーレットリールにも登場するため、
    // 「配信一覧」セクション内に絞ってクリック後の絞り込み結果を確認する
    const list = getStreamListSection(root);
    expect(list.getByText("配信B")).toBeInTheDocument();
    expect(list.queryByText("配信A")).not.toBeInTheDocument();
    expect(list.queryByText("配信C")).not.toBeInTheDocument();
  });

  it("異常系: おすすめ配信の取得に失敗したらエラーメッセージを表示する", async () => {
    mockStreamsData({
      fetchStreams: () => Promise.resolve([makeStream()]),
      fetchRecommendedStreams: () => Promise.reject(new Error("network error")),
    });

    const root = await mountApp();
    await waitFor(() =>
      expect(
        root.getByText("おすすめ配信を読み込めませんでした。時間をおいて再読み込みしてください。")
      ).toBeInTheDocument()
    );
  });

  it("異常系: 配信一覧が空のとき件数バッジが0件になり、配信カードが表示されない", async () => {
    // all.streams=[]かつカテゴリ未選択(すべて)の場合、Appはカテゴリ別グループ表示の
    // 分岐(groupedStreamsが空配列=truthy)に入るため、StreamGridのemptyMessageは
    // 出ない(0件バッジのみが表示される)。これが現在の実装の実際の挙動。
    mockStreamsData({
      fetchStreams: () => Promise.resolve([]),
      fetchRecommendedStreams: () => Promise.resolve([]),
    });

    const root = await mountApp();
    await waitFor(() => expect(root.getByText("0件")).toBeInTheDocument());
    // 視聴数ランキングは実カタログ(13件)を使うため常にリンクを持つ。
    // ここでは「配信一覧」セクションに配信カードが無いことだけを確認する
    expect(getStreamListSection(root).queryAllByRole("link")).toHaveLength(0);
  });

  it("読み込み中はおすすめ配信欄に読み込み中を表示する", async () => {
    mockStreamsData({
      fetchStreams: () => new Promise<Stream[]>(() => {}),
      fetchRecommendedStreams: () => new Promise<Stream[]>(() => {}),
    });

    const root = await mountApp();
    expect(root.getAllByText("読み込み中...").length).toBeGreaterThan(0);
  });
});
