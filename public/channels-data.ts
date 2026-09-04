// HLSサーバーが配信するチャンネル一覧の取得・URL解決を行う。
// streams-data.tsと対になる位置づけで、HLSサーバーとの通信をここに閉じ込める。

export interface Channel {
  id: string;
  title: string;
  category: string;
  playlist: string;
  default: boolean;
  retired: boolean;
  attribution: string;
  license: string;
  source: string;
}

const HLS_SERVER_BASE = "https://intern-hls-server.tomaton.workers.dev";

// 後方互換用の固定エンドポイント。デフォルトチャンネルと同一内容が返る想定。
export const LEGACY_DEFAULT_PLAYLIST_URL = `${HLS_SERVER_BASE}/stream.m3u8`;

export async function fetchChannels(): Promise<Channel[]> {
  const response = await fetch(`${HLS_SERVER_BASE}/channels.json`);
  if (!response.ok) {
    throw new Error(`チャンネル一覧の取得に失敗しました (status: ${response.status})`);
  }
  const data = (await response.json()) as Channel[] | { channels?: Channel[] };
  return Array.isArray(data) ? data : data.channels ?? [];
}

// playlistが相対パス/絶対URLのどちらで返っても再生可能な絶対URLに正規化する
export function resolvePlaylistUrl(channel: Channel): string {
  return new URL(channel.playlist, HLS_SERVER_BASE).toString();
}

export function pickDefaultChannel(channels: Channel[]): Channel | undefined {
  return channels.find((channel) => channel.default) ?? channels[0];
}
