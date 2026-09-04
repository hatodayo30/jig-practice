// チャンネルの「尺(ループ周期)」を持つ静的カタログ。
//
// HLSサーバーの各チャンネルは固定尺の動画をループ配信しているため、
// 同じチャンネルを見ている視聴者には常に同じ瞬間の映像が流れる。
// その同期性を画面上で見せるために尺の情報が要るが、サーバーの
// /channels.json は現状404を返し尺も含まないため、ここをモックの真実源とする。
//
// 通信を担う channels-data.ts とは意図的に分けている。あちらはサーバーが返す
// チャンネル一覧そのもの、こちらはサーバーに存在しない付加情報のカタログ。

export interface ChannelCatalogEntry {
  id: string;
  title: string;
  /** 1ループの長さ(秒)。この周期で先頭に巻き戻る。 */
  durationSeconds: number;
}

const CHANNEL_CATALOG: ChannelCatalogEntry[] = [
  { id: "llamigos", title: "Caminandes 3: Llamigos", durationSeconds: 150 },
  { id: "llama-drama", title: "Caminandes 1: Llama Drama", durationSeconds: 90 },
  { id: "gran-dillama", title: "Caminandes 2: Gran Dillama", durationSeconds: 146 },
];

// チャンネル未指定(= /stream.m3u8 で再生している)ときにループ表示が拠り所にするid。
// サーバーのdefaultフラグは /channels.json 越しでしか分からないので、
// 一覧の先頭チャンネルをデフォルトとみなす想定値。
export const CATALOG_DEFAULT_CHANNEL_ID = "llamigos";

export function listChannelCatalog(): ChannelCatalogEntry[] {
  return CHANNEL_CATALOG;
}

// カタログに無いidはundefinedを返す。呼び出し側はこの場合ループ表示を出さない。
export function findChannelCatalogEntry(id: string | null | undefined): ChannelCatalogEntry | undefined {
  if (!id) return undefined;
  return CHANNEL_CATALOG.find((entry) => entry.id === id);
}

// 再生位置から「次にループの先頭へ戻るまでの残り秒数」を求める。
// ループ配信なので currentTime を尺で割った余りがループ内の位置になる。
// 尺が分からない場合(カタログに無いid等)はnullを返す。
export function loopRemainingSeconds(
  durationSeconds: number | null | undefined,
  currentTime: number
): number | null {
  if (!durationSeconds || durationSeconds <= 0) return null;
  if (!Number.isFinite(currentTime) || currentTime < 0) return null;
  return durationSeconds - (currentTime % durationSeconds);
}

// 尺を "m:ss" 形式に整形する
export function formatLoopDuration(seconds: number): string {
  const total = Math.round(seconds);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// バッジ用のざっくりした分数。1:30を「約2分」と切り上げて見せると実感とずれるため、
// 端数がちょうど30秒のときは短い側に倒す(1秒引いてから四捨五入する)。
export function roundedLoopMinutes(seconds: number): number {
  return Math.max(1, Math.round((seconds - 1) / 60));
}
