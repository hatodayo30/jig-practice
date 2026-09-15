import { describe, expect, it } from "vitest";
import {
  CATALOG_DEFAULT_CHANNEL_ID,
  findChannelCatalogEntry,
  formatLoopDuration,
  listChannelCatalog,
  loopRemainingSeconds,
} from "./channel-catalog";

describe("listChannelCatalog", () => {
  it("13件のカタログを返す", () => {
    const catalog = listChannelCatalog();
    expect(catalog).toHaveLength(13);
  });

  it("既定チャンネルidを含む", () => {
    const catalog = listChannelCatalog();
    expect(catalog.some((entry) => entry.id === CATALOG_DEFAULT_CHANNEL_ID)).toBe(true);
  });
});

describe("findChannelCatalogEntry", () => {
  it("存在するidに一致するエントリを返す", () => {
    const entry = findChannelCatalogEntry("llamigos");
    expect(entry).toMatchObject({ id: "llamigos", title: "Caminandes 3: Llamigos" });
  });

  it("存在しないidはundefinedを返す", () => {
    expect(findChannelCatalogEntry("does-not-exist")).toBeUndefined();
  });

  it.each([null, undefined, ""])("id=%pのときundefinedを返す", (id) => {
    expect(findChannelCatalogEntry(id)).toBeUndefined();
  });
});

describe("loopRemainingSeconds", () => {
  it("通常値: durationSecondsの範囲内で残り秒数を返す", () => {
    expect(loopRemainingSeconds(100, 40)).toBe(60);
  });

  it("currentTimeがdurationを超えたら剰余で折り返す", () => {
    expect(loopRemainingSeconds(100, 240)).toBe(60);
  });

  it.each([0, -1, null, undefined])("durationSeconds=%pのときnullを返す", (duration) => {
    expect(loopRemainingSeconds(duration, 10)).toBeNull();
  });

  it.each([-1, NaN, Infinity])("currentTime=%pのときnullを返す", (currentTime) => {
    expect(loopRemainingSeconds(100, currentTime)).toBeNull();
  });
});

describe("formatLoopDuration", () => {
  it.each([
    [0, "0:00"],
    [5, "0:05"],
    [59, "0:59"],
    [60, "1:00"],
    [90, "1:30"],
    [596, "9:56"],
    [90.4, "1:30"],
  ])("%i秒 -> %s", (seconds, expected) => {
    expect(formatLoopDuration(seconds)).toBe(expected);
  });
});
