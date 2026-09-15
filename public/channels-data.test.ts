import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LEGACY_DEFAULT_PLAYLIST_URL,
  fetchChannels,
  pickDefaultChannel,
  resolvePlaylistUrl,
  type Channel,
} from "./channels-data";

function makeChannel(overrides: Partial<Channel> = {}): Channel {
  return {
    id: "sample",
    title: "Sample",
    category: "コメディ",
    playlist: "/sample.m3u8",
    default: false,
    retired: false,
    attribution: "",
    license: "",
    source: "",
    ...overrides,
  };
}

function mockFetchOnce(response: Partial<Response> & { json?: () => unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => undefined,
      ...response,
    })
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchChannels", () => {
  it("配列レスポンスはそのまま返す", async () => {
    const channels = [makeChannel({ id: "a" }), makeChannel({ id: "b" })];
    mockFetchOnce({ json: async () => channels });
    await expect(fetchChannels()).resolves.toEqual(channels);
  });

  it("{ channels: [...] }形式はchannelsを取り出して返す", async () => {
    const channels = [makeChannel({ id: "a" })];
    mockFetchOnce({ json: async () => ({ channels }) });
    await expect(fetchChannels()).resolves.toEqual(channels);
  });

  it("channelsキーが無いオブジェクトは空配列を返す", async () => {
    mockFetchOnce({ json: async () => ({}) });
    await expect(fetchChannels()).resolves.toEqual([]);
  });

  it("response.ok=falseのときステータスコードを含むメッセージで例外を投げる", async () => {
    mockFetchOnce({ ok: false, status: 500 });
    await expect(fetchChannels()).rejects.toThrow(/500/);
  });
});

describe("resolvePlaylistUrl", () => {
  it("相対パスをHLSサーバー基準の絶対URLに解決する", () => {
    const channel = makeChannel({ playlist: "/foo/stream.m3u8" });
    expect(resolvePlaylistUrl(channel)).toBe("https://intern-hls-server.tomaton.workers.dev/foo/stream.m3u8");
  });

  it("既に絶対URLの場合はそのまま(正規化された形で)返す", () => {
    const channel = makeChannel({ playlist: "https://example.com/other.m3u8" });
    expect(resolvePlaylistUrl(channel)).toBe("https://example.com/other.m3u8");
  });
});

describe("pickDefaultChannel", () => {
  it("default:trueのチャンネルを返す", () => {
    const channels = [makeChannel({ id: "a" }), makeChannel({ id: "b", default: true })];
    expect(pickDefaultChannel(channels)?.id).toBe("b");
  });

  it("defaultが無ければ先頭を返す", () => {
    const channels = [makeChannel({ id: "a" }), makeChannel({ id: "b" })];
    expect(pickDefaultChannel(channels)?.id).toBe("a");
  });

  it("空配列はundefinedを返す", () => {
    expect(pickDefaultChannel([])).toBeUndefined();
  });
});

describe("LEGACY_DEFAULT_PLAYLIST_URL", () => {
  it("HLSサーバーの既定エンドポイントを指す", () => {
    expect(LEGACY_DEFAULT_PLAYLIST_URL).toBe("https://intern-hls-server.tomaton.workers.dev/stream.m3u8");
  });
});
