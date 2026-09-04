// ホーム画面/おすすめ配信で使う配信一覧データ。
// 現状はモック配列を返すだけだが、本物のAPIに差し替えやすいよう
// データ取得部分を非同期関数(fetchStreams/fetchRecommendedStreams)として分離している。

export interface Stream {
  id: string;
  title: string;
  streamerName: string;
  viewerCount: number;
  category: string;
  thumbnailColor: string;
  isRecommended: boolean;
  channelId: string;
}

const MOCK_STREAMS: Stream[] = [
  {
    id: "1",
    title: "雑談しながらのんびりゲーム実況",
    streamerName: "はると",
    viewerCount: 1240,
    category: "コメディ",
    thumbnailColor: "#6441a5",
    isRecommended: true,
    channelId: "llamigos",
  },
  {
    id: "2",
    title: "初見さん歓迎！深夜のRPG攻略配信",
    streamerName: "みかん",
    viewerCount: 856,
    category: "SF",
    thumbnailColor: "#e75480",
    isRecommended: true,
    channelId: "elephants-dream",
  },
  {
    id: "3",
    title: "朝活もくもく作業配信",
    streamerName: "つばめ",
    viewerCount: 312,
    category: "ファンタジー",
    thumbnailColor: "#3b82f6",
    isRecommended: false,
    channelId: "spring",
  },
  {
    id: "4",
    title: "弾き語りリクエスト大会",
    streamerName: "ソラ",
    viewerCount: 2103,
    category: "ドラマ",
    thumbnailColor: "#f59e0b",
    isRecommended: true,
    channelId: "coffee-run",
  },
  {
    id: "5",
    title: "格闘ゲームランクマッチ配信",
    streamerName: "レン",
    viewerCount: 604,
    category: "SF",
    thumbnailColor: "#10b981",
    isRecommended: false,
    channelId: "tears-of-steel",
  },
  {
    id: "6",
    title: "料理配信：今日は炊き込みご飯",
    streamerName: "ふじの",
    viewerCount: 189,
    category: "コメディ",
    thumbnailColor: "#ef4444",
    isRecommended: false,
    channelId: "wing-it",
  },
  {
    id: "7",
    title: "深夜のまったりトーク配信",
    streamerName: "ゆずき",
    viewerCount: 723,
    category: "コメディ",
    thumbnailColor: "#8b5cf6",
    isRecommended: false,
    channelId: "big-buck-bunny",
  },
  {
    id: "8",
    title: "異世界探索リレー実況",
    streamerName: "かなで",
    viewerCount: 1580,
    category: "ファンタジー",
    thumbnailColor: "#14b8a6",
    isRecommended: true,
    channelId: "cosmos-laundromat",
  },
  {
    id: "9",
    title: "ゆるゆる雑談ラジオ",
    streamerName: "あおい",
    viewerCount: 445,
    category: "コメディ",
    thumbnailColor: "#f97316",
    isRecommended: false,
    channelId: "glass-half",
  },
  {
    id: "10",
    title: "コメント読み上げ雑談配信",
    streamerName: "こはる",
    viewerCount: 968,
    category: "コメディ",
    thumbnailColor: "#eab308",
    isRecommended: false,
    channelId: "gran-dillama",
  },
  {
    id: "11",
    title: "初心者歓迎！まったり雑談",
    streamerName: "りお",
    viewerCount: 512,
    category: "コメディ",
    thumbnailColor: "#ec4899",
    isRecommended: false,
    channelId: "llama-drama",
  },
  {
    id: "12",
    title: "宇宙開発ニュース解説配信",
    streamerName: "しずく",
    viewerCount: 1102,
    category: "SF",
    thumbnailColor: "#06b6d4",
    isRecommended: true,
    channelId: "singularity",
  },
  {
    id: "13",
    title: "ファンタジー小説朗読配信",
    streamerName: "つきの",
    viewerCount: 634,
    category: "ファンタジー",
    thumbnailColor: "#a855f7",
    isRecommended: false,
    channelId: "sintel",
  },
];

// 本物のAPIに差し替える際は、この中身をfetch呼び出しに置き換える想定。
export async function fetchStreams(): Promise<Stream[]> {
  return MOCK_STREAMS;
}

export async function fetchRecommendedStreams(): Promise<Stream[]> {
  return MOCK_STREAMS.filter((stream) => stream.isRecommended);
}
