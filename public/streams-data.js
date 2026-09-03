// ホーム画面/おすすめ配信で使う配信一覧データ。
// 現状はモック配列を返すだけだが、本物のAPIに差し替えやすいよう
// データ取得部分を非同期関数(fetchStreams/fetchRecommendedStreams)として分離している。

const MOCK_STREAMS = [
  {
    id: "1",
    title: "雑談しながらのんびりゲーム実況",
    streamerName: "はると",
    viewerCount: 1240,
    category: "雑談・ゲーム実況",
    thumbnailColor: "#6441a5",
    isRecommended: true,
  },
  {
    id: "2",
    title: "初見さん歓迎！深夜のRPG攻略配信",
    streamerName: "みかん",
    viewerCount: 856,
    category: "ゲーム実況",
    thumbnailColor: "#e75480",
    isRecommended: true,
  },
  {
    id: "3",
    title: "朝活もくもく作業配信",
    streamerName: "つばめ",
    viewerCount: 312,
    category: "作業・勉強",
    thumbnailColor: "#3b82f6",
    isRecommended: false,
  },
  {
    id: "4",
    title: "弾き語りリクエスト大会",
    streamerName: "ソラ",
    viewerCount: 2103,
    category: "音楽",
    thumbnailColor: "#f59e0b",
    isRecommended: true,
  },
  {
    id: "5",
    title: "格闘ゲームランクマッチ配信",
    streamerName: "レン",
    viewerCount: 604,
    category: "ゲーム実況",
    thumbnailColor: "#10b981",
    isRecommended: false,
  },
  {
    id: "6",
    title: "料理配信：今日は炊き込みご飯",
    streamerName: "ふじの",
    viewerCount: 189,
    category: "料理",
    thumbnailColor: "#ef4444",
    isRecommended: false,
  },
];

// 本物のAPIに差し替える際は、この中身をfetch呼び出しに置き換える想定。
export async function fetchStreams() {
  return MOCK_STREAMS;
}

export async function fetchRecommendedStreams() {
  return MOCK_STREAMS.filter((stream) => stream.isRecommended);
}
