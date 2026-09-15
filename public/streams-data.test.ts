import { describe, expect, it } from "vitest";
import { fetchRecommendedStreams, fetchStreams } from "./streams-data";

describe("fetchStreams", () => {
  it("13件のモック配信を返す", async () => {
    const streams = await fetchStreams();
    expect(streams).toHaveLength(13);
  });

  it("各配信が必須フィールドを健全な値で持つ", async () => {
    const streams = await fetchStreams();
    for (const stream of streams) {
      expect(typeof stream.id).toBe("string");
      expect(stream.id.length).toBeGreaterThan(0);
      expect(typeof stream.title).toBe("string");
      expect(typeof stream.streamerName).toBe("string");
      expect(stream.viewerCount).toBeGreaterThan(0);
      expect(typeof stream.category).toBe("string");
      expect(stream.thumbnailColor).toMatch(/^#[0-9a-f]{6}$/i);
      expect(typeof stream.isRecommended).toBe("boolean");
      expect(typeof stream.channelId).toBe("string");
    }
  });

  it("idは重複しない", async () => {
    const streams = await fetchStreams();
    expect(new Set(streams.map((s) => s.id)).size).toBe(streams.length);
  });
});

describe("fetchRecommendedStreams", () => {
  it("isRecommended:trueの配信のみを返す", async () => {
    const recommended = await fetchRecommendedStreams();
    expect(recommended.length).toBeGreaterThan(0);
    expect(recommended.every((stream) => stream.isRecommended)).toBe(true);
  });

  it("fetchStreamsの結果からisRecommended:trueだけを絞り込んだものと一致する", async () => {
    const [all, recommended] = await Promise.all([fetchStreams(), fetchRecommendedStreams()]);
    expect(recommended).toEqual(all.filter((stream) => stream.isRecommended));
  });
});
