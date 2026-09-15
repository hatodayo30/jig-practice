// ライブ配信画面のエントリスクリプト。
// HLS再生、シークバー同期、コメント送受信、ギフト(アイテム)選択の各機能を初期化する。
import { StrictMode, useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, CSSProperties, PointerEvent as ReactPointerEvent, RefObject } from "react";
import { createRoot } from "react-dom/client";
import Hls from "hls.js";
import {
  fetchChannels,
  pickDefaultChannel,
  resolvePlaylistUrl,
  LEGACY_DEFAULT_PLAYLIST_URL,
} from "./channels-data";
import { CATALOG_DEFAULT_CHANNEL_ID, findChannelCatalogEntry, loopRemainingSeconds } from "./channel-catalog";
import { fetchStreams, type Stream } from "./streams-data";

// シークバー上で「ライブ扱い」とみなす配信端からの許容秒数
const LIVE_EDGE_THRESHOLD_SECONDS = 9;
const isDebugEnabled = new URLSearchParams(location.search).has("debug");
// URLで指定されたチャンネルID(未指定ならデフォルトチャンネルを再生する)
const requestedChannelId = new URLSearchParams(location.search).get("channelId");

const COMMENT_SERVER_URL = "https://intern-comment-server.intern-comment-server.deno.net";
const COMMENT_MAX_LENGTH = 200;
// 長時間視聴でコメント配列が際限なく伸びないよう、表示する上限を設ける。
// 溢れた分は古い方から捨てる(サイドバーも全画面オーバーレイも最新側しか見ない)。
const COMMENT_MAX_ENTRIES = 300;
// 重複排除用に覚えておくid数。表示上限より十分多く取り、
// 一覧から溢れたコメントが再受信で復活しないようにする。
const SEEN_COMMENT_ID_LIMIT = 1000;
const NG_WORDS = ["死ね", "殺す", "きえろ", "バカ", "アホ"];

// コメント遡り閲覧用の自前サーバー(server/history-server)。intern-comment-serverの/eventsは
// 接続前の投稿を保持しないため、受信したメッセージをこちらにも転送して直近分を保存させる。
// デプロイ先のURL(例: https://xxxx.deno.dev)は VITE_HISTORY_SERVER_URL で差し替える。
// httpのまま https のページから叩くと mixed content で毎回失敗するので必ず設定すること。
// 未到達でも黙って無視される。
const HISTORY_SERVER_URL = import.meta.env.VITE_HISTORY_SERVER_URL ?? "http://localhost:8000";

// 受信メッセージの履歴サーバーへの転送設定。全視聴者が同じメッセージをそれぞれ転送するため、
// 1件ずつ即POSTすると「視聴者数 × メッセージ数」回の書き込みになる。まとめて送って回数を減らす。
const HISTORY_LOG_FLUSH_MS = 1000;
// サーバー側の /log/bulk が1リクエストで受け付ける上限に合わせる
const HISTORY_LOG_MAX_BATCH = 100;

const ITEMS_URL = `${COMMENT_SERVER_URL}/items`;
const ITEM_ICON_FALLBACK =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#ccc"/></svg>'
  );
const ITEM_THEME_COLORS: Record<string, string> = {
  heart: "#ff4d6d",
  star: "#ffb703",
  flower: "#4caf50",
};
// コメント行の背景は、テーマカラーを白に寄せたパステル色にする
const PASTEL_WHITE_RATIO = 0.85;

const GIFT_ANIMATION_DISPLAY_MS = 3200;
const GIFT_ANIMATION_FADE_MS = 250;

// ギフト着弾演出。ギフトアイコンが泡のように左右へ揺れながらコメント欄へ浮き上がる
const GIFT_BUBBLE_DURATION_MS = 1400;
// 上昇中に左右へ振れる基準量。大きくすると蛇行が強くなる
const GIFT_BUBBLE_SWAY_PX = 14;
// 振れ幅のばらつき。同時に複数届いても軌道が重ならないよう1件ごとに揺らす
const GIFT_BUBBLE_SWAY_VARIANCE = 0.4;
// コメント一覧のどこへ着地させるか。左端・下端からの内側オフセット
const GIFT_BUBBLE_LANDING_INSET_X = 28;
const GIFT_BUBBLE_LANDING_INSET_Y = 16;
// 完了通知が届かなかったとき(タブ非表示など)に演出を打ち切るまでの猶予
const GIFT_BUBBLE_FAILSAFE_MARGIN_MS = 400;

const SEEK_REVERT_GUARD_MS = 1500;
const SEEK_REVERT_TOLERANCE_SECONDS = 3;
const SEEK_REVERT_MAX_RETRIES = 3;

// ?debug のオーバーレイはrAFループに相乗りしているが、人が読む情報なので
// 毎フレーム作り直す必要はない。この間隔まで間引く。
const DEBUG_TEXT_INTERVAL_MS = 250;

const VIEWER_COUNT_INITIAL = 1240;
const VIEWER_COUNT_MIN = 100;
const VIEWER_COUNT_MAX_DELTA = 15;
const VIEWER_COUNT_UPDATE_INTERVAL_MS = 4000;

const LIKE_COUNT_STORAGE_KEY = "likeCount";
const LIKE_BUTTON_ANIMATION_MS = 350;
const LIKE_PARTICLE_LIFETIME_MS = 900;
const LIKE_PARTICLES = ["❤️", "💗", "💕"];

// ギフトの持ち点。コメントサーバーはitemのcostを持つがクライアント側の管理に委ねているため、
// ここでlocalStorageベースの残高として実装する
const GIFT_POINTS_STORAGE_KEY = "giftPoints";
const GIFT_POINTS_INITIAL_BALANCE = 500;

// バックエンドと未接続のため、視聴者数はモックデータで表示する。
// タイトル・配信者名は streams-data.ts の配信一覧(ホーム画面と同じデータ)を
// channelId で突き合わせて表示することで、ホーム画面と視聴画面の表示を一致させる。
// 該当する配信が見つからない(データ未取得/未知のchannelId)場合はこの値を代わりに使う。
const MOCK_STREAMER = {
  title: "雑談しながらのんびりゲーム実況",
  name: "はると",
  label: "雑談・ゲーム実況チャンネル",
  iconColor: "#6441a5",
  tags: ["雑談", "ゲーム"],
};

type StreamerInfo = typeof MOCK_STREAMER;

// Streamはlabel/tagsを持たないため、カテゴリから同等の表示情報を組み立てる
export function streamerInfoFromStream(stream: Stream): StreamerInfo {
  return {
    title: stream.title,
    name: stream.streamerName,
    label: `${stream.category}チャンネル`,
    iconColor: stream.thumbnailColor,
    tags: [stream.category],
  };
}

interface Item {
  id: string;
  name: string;
  iconUrl: string;
  cost: number;
  animationUrl?: string;
}

interface CommentEntry {
  key: number;
  /** サーバーが払い出すID。履歴サーバーとライブSSEの重複排除に使う */
  id?: string;
  text?: string;
  item?: Item;
  isNew: boolean;
}

interface GiftAnimationEntry {
  key: number;
  src: string;
  fallback: string;
  alt: string;
  isLeaving: boolean;
}

// ギフト1件分の飛行演出。着地したタイミングでcommentをコメント一覧へ追加する
interface GiftBubbleEntry {
  key: number;
  iconUrl: string;
  fallback: string;
  startX: number;
  startY: number;
  deltaX: number;
  deltaY: number;
  sway: number;
  comment: CommentEntry;
}

interface SeekRange {
  start: number;
  end: number;
}

let nextKey = 0;
function generateKey(): number {
  nextKey += 1;
  return nextKey;
}

interface HistoryLogEntry {
  id: string;
  text: string | null;
  item: Item | null;
  timestamp?: string;
}

// 履歴サーバーへの転送キュー。SSEの受信ごとにPOSTせず、一定間隔でまとめて送る。
const pendingHistoryLogs: HistoryLogEntry[] = [];
let historyLogFlushId = 0;

function flushHistoryLogs() {
  historyLogFlushId = 0;
  if (pendingHistoryLogs.length === 0) return;
  const messages = pendingHistoryLogs.splice(0, HISTORY_LOG_MAX_BATCH);
  fetch(`${HISTORY_SERVER_URL}/log/bulk`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages }),
    // ページ離脱中でも送信を打ち切られないようにする
    keepalive: true,
  }).catch(() => {
    // 履歴サーバーが未起動/未デプロイのときは何もしない
  });
  // 上限を超えて残っていれば続けて送る
  if (pendingHistoryLogs.length > 0) scheduleHistoryLogFlush();
}

function scheduleHistoryLogFlush() {
  if (historyLogFlushId !== 0) return;
  historyLogFlushId = window.setTimeout(flushHistoryLogs, HISTORY_LOG_FLUSH_MS);
}

// 遡り閲覧のため、受信したメッセージを履歴サーバーにも転送しておく(失敗しても無視)
function queueHistoryLog(entry: HistoryLogEntry) {
  pendingHistoryLogs.push(entry);
  scheduleHistoryLogFlush();
}

// 離脱時はまとめ送りを待たずに残りを吐き出す
window.addEventListener("pagehide", () => {
  if (historyLogFlushId !== 0) window.clearTimeout(historyLogFlushId);
  historyLogFlushId = 0;
  flushHistoryLogs();
});

// OSの「視差効果を減らす」設定。演出は省いても情報(コメント)は必ず表示する
function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// NGワードフィルタ。送受信データ自体は変更せず、表示直前にマスクする
export function maskNgWords(text: string): string {
  return NG_WORDS.reduce((masked, word) => (word ? masked.split(word).join("***") : masked), text);
}

// アイテムIDから色相を一意に導出する(同じIDなら常に同じ色になる)
function hueForItemId(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

function hslToHex(h: number, s: number, l: number): string {
  const saturation = s / 100;
  const lightness = l / 100;
  const a = saturation * Math.min(lightness, 1 - lightness);
  const channel = (n: number) => {
    const k = (n + h / 30) % 12;
    const value = lightness - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
    return Math.round(255 * value)
      .toString(16)
      .padStart(2, "0");
  };
  return `#${channel(0)}${channel(8)}${channel(4)}`;
}

// アイテムの基準色。未定義のIDはIDから導出した色相で代用する
function getItemThemeColor(id: string): string {
  return ITEM_THEME_COLORS[id] ?? hslToHex(hueForItemId(id), 70, 45);
}

// コメント行の背景色はテーマカラーと同系統にして、ギフト選択時の色と対応させる
function pastelColorForItemId(id: string): string {
  const [r, g, b] = hexToRgb(getItemThemeColor(id));
  const lighten = (channel: number) => Math.round(channel + (255 - channel) * PASTEL_WHITE_RATIO);
  return `rgb(${lighten(r)}, ${lighten(g)}, ${lighten(b)})`;
}

// "#rrggbb"形式の16進カラーコードをRGB各成分に変換する
function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return [158, 158, 158];
  const [, r, g, b] = match;
  return [parseInt(r, 16), parseInt(g, 16), parseInt(b, 16)];
}

// "#rrggbb"形式の16進カラーコードを "r, g, b" 形式のCSS用文字列に変換する
function hexToRgbString(hex: string): string {
  return hexToRgb(hex).join(", ");
}

// コメントに投稿者情報が無いため、コメントのkeyから色と頭文字を一意に導出し、
// 疑似的な「投稿者アイコン」として表示する(黄金角を使い隣り合うkeyでも色相が離れるようにする)
function avatarColorForComment(comment: CommentEntry): string {
  const hue = (comment.key * 137.508) % 360;
  return hslToHex(hue, 65, 55);
}

function avatarLabelForComment(comment: CommentEntry): string {
  const source = comment.text?.trim() || comment.item?.name;
  return source ? source.charAt(0).toUpperCase() : "?";
}

// おすすめ配信サムネのグラデーション用。ratio=0で元の色、1で黒に近づく
function darkenHex(hex: string, ratio: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => Math.round(channel * (1 - ratio));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

// 秒数を "mm:ss"(1時間以上は "h:mm:ss")形式の文字列に整形する
export function formatElapsed(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// 実画像を用意せず、名前の頭文字を円形アイコンとして描画したdata URIを生成する
function initialAvatarDataUrl(name: string, color: string): string {
  const initial = name.slice(0, 1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">` +
    `<circle cx="18" cy="18" r="18" fill="${color}" />` +
    `<text x="18" y="24" font-size="16" font-family="sans-serif" fill="#fff" text-anchor="middle">${initial}</text>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

// video.seekable は hls.js の liveDurationInfinity 設定により「配信開始からの
// 全履歴」を指す見かけ上の値になり、実際にはブラウザ側で破棄されて戻れない
// 古い位置まで「シーク可能」に見えてしまう(このサーバーはセグメントURLを
// 使い回すため、破棄された位置は原理的に正しく再取得できない)。
// そのため実際に今デコード済みの video.buffered から、currentTime を含む
// (見つからなければ最後の)区間を実効的なシーク可能範囲として使う。
export function getSeekableRange(video: HTMLVideoElement): SeekRange | null {
  const buffered = video.buffered;
  if (buffered.length === 0) return null;

  const currentTime = video.currentTime;
  let start = buffered.start(0);
  let end = buffered.end(0);
  for (let i = 0; i < buffered.length; i += 1) {
    start = buffered.start(i);
    end = buffered.end(i);
    if (start <= currentTime && currentTime <= end) break;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
  return { start, end };
}

// 配信のライブ端(最新位置)を返す。hls.jsの情報が使えればそちらを優先し、
// なければseekable範囲の終端を代わりに使う
export function getLiveEdge(hls: Hls | null, range: SeekRange): number {
  if (hls && Number.isFinite(hls.liveSyncPosition)) return hls.liveSyncPosition as number;
  return range.end;
}

// ?debug クエリパラメータ付きアクセス時のみ、再生位置やバッファ状況などの
// デバッグ情報をオーバーレイ表示する
function renderDebugText(video: HTMLVideoElement, hls: Hls | null, range: SeekRange | null): string {
  const buffered = video.buffered;
  const bufferedRanges = Array.from({ length: buffered.length }, (_, i) =>
    `[${buffered.start(i).toFixed(2)}, ${buffered.end(i).toFixed(2)}]`
  ).join(" ");
  return [
    `currentTime: ${video.currentTime.toFixed(2)}`,
    `duration: ${video.duration}`,
    `bufferedRange(実効シーク範囲): ${range ? `[${range.start.toFixed(2)}, ${range.end.toFixed(2)}]` : "-"}`,
    `buffered(生データ): ${bufferedRanges || "-"}`,
    `liveSyncPosition: ${hls?.liveSyncPosition ?? "-"}`,
  ].join("\n");
}

// 再生/一時停止・ミュート/ミュート解除ボタンに表示するSVGアイコン
function PlayIcon() {
  return (
    <svg className="video-control-icon" viewBox="0 0 24 24" fill="none">
      <path d="M8 5v14l11-7L8 5Z" fill="currentColor" />
    </svg>
  );
}
function PauseIcon() {
  return (
    <svg className="video-control-icon" viewBox="0 0 24 24" fill="none">
      <rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" />
      <rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" />
    </svg>
  );
}
function MutedIcon() {
  return (
    <svg className="video-control-icon" viewBox="0 0 24 24" fill="none">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="M16.5 8.5 L20.5 15.5 M20.5 8.5 L16.5 15.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}
function UnmutedIcon() {
  return (
    <svg className="video-control-icon" viewBox="0 0 24 24" fill="none">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="M16.5 8.5c1.4 1.2 1.4 5.8 0 7" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
      <path d="M19 6.5c2.5 2.3 2.5 8.7 0 11" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

// シークバーのうち「秒単位でしか変わらない」値だけをReactのstateで持つ。
// つまみの位置とループ残り時間は毎フレーム変わるため、stateには入れずrefで
// DOMへ直接書き込む(そうしないと再生中ずっと60回/秒で再レンダリングが走る)。
interface SeekState {
  /** 実効シーク範囲が取れているか。バッファ表示の有無に対応する。 */
  hasRange: boolean;
  isLive: boolean;
  elapsed: string;
}

// 参照が変わらないよう定数として持つ。同じ参照をsetStateに渡せばReactは再レンダリングしない。
const INITIAL_SEEK_STATE: SeekState = {
  hasRange: false,
  isLive: false,
  elapsed: "--:--",
};

// ループ内の進み具合を示す細い円の周長。2πr(r=6) ≒ 37.7。
const LOOP_RING_CIRCUMFERENCE = 2 * Math.PI * 6;

// 「次のループ開始まで残りmm:ss」表示。チャンネルの尺が分からないときは何も出さない。
// 尺は固定なので、同じチャンネルを見ている視聴者にはこの残り時間も同じ値が出る
// ——それが同時視聴の同期性の可視化になる。
//
// 残り時間は毎フレーム変わるため、値の反映はVideoPlayerのrAFループがrefを通じて
// 直接DOMへ書き込む。このコンポーネント自身は器を描くだけで再レンダリングされない。
export function LoopCountdown({
  durationSeconds,
  rootRef,
  ringRef,
  timeRef,
}: {
  durationSeconds: number | null;
  rootRef: RefObject<HTMLSpanElement | null>;
  ringRef: RefObject<SVGCircleElement | null>;
  timeRef: RefObject<HTMLSpanElement | null>;
}) {
  if (!durationSeconds) return null;

  return (
    <span
      className="loop-countdown"
      ref={rootRef}
      // 再生位置が取れるまでは値が無いので隠しておく(rAFループが表示に切り替える)
      hidden
      title={`このチャンネルは${formatElapsed(durationSeconds)}でループしています。同じチャンネルを見ている人には同じ瞬間の映像が流れます。`}
    >
      <svg className="loop-countdown-ring" viewBox="0 0 16 16" aria-hidden="true">
        <circle className="loop-countdown-ring-track" cx="8" cy="8" r="6" />
        <circle
          className="loop-countdown-ring-value"
          ref={ringRef}
          cx="8"
          cy="8"
          r="6"
          strokeDasharray={LOOP_RING_CIRCUMFERENCE}
          strokeDashoffset={LOOP_RING_CIRCUMFERENCE}
        />
      </svg>
      <span className="loop-countdown-label">次のループまで</span>
      <span className="loop-countdown-time" ref={timeRef}>
        --:--
      </span>
    </span>
  );
}

export function VideoPlayer({
  playlistUrl,
  giftAnimations,
  loopDurationSeconds,
  comments,
}: {
  playlistUrl: string | null;
  giftAnimations: GiftAnimationEntry[];
  loopDurationSeconds: number | null;
  comments: CommentEntry[];
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const videoFrameRef = useRef<HTMLDivElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const seekBarRef = useRef<HTMLDivElement>(null);
  const isSeekingRef = useRef(false);
  const pendingSeekRef = useRef<{ target: number; retriesLeft: number; timeoutId: number } | null>(null);
  const rafIdRef = useRef<number | null>(null);
  const fullscreenCommentListRef = useRef<HTMLUListElement>(null);
  // 毎フレーム変わる表示(つまみ位置・ループ残り)はstateを経由せずここへ直接書く
  const seekThumbRef = useRef<HTMLDivElement | null>(null);
  const loopCountdownRef = useRef<HTMLSpanElement | null>(null);
  const loopRingRef = useRef<SVGCircleElement | null>(null);
  const loopTimeRef = useRef<HTMLSpanElement | null>(null);
  const lastDebugAtRef = useRef(0);

  const [isPaused, setIsPaused] = useState(true);
  const [isMuted, setIsMuted] = useState(true);
  const [seekState, setSeekState] = useState<SeekState>(INITIAL_SEEK_STATE);
  const [debugText, setDebugText] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // 尺はレンダリングをまたいでrAFループから読むためrefにも写す
  const loopDurationRef = useRef(loopDurationSeconds);
  loopDurationRef.current = loopDurationSeconds;

  // 毎フレーム更新する値の反映。Reactのstateを経由すると再生中ずっと60回/秒で
  // VideoPlayer全体(全画面時はコメント一覧も)が再描画されるため、DOMへ直接書く。
  const writeSeekDom = useCallback((thumbPct: number, loopRemaining: number | null) => {
    // 親にCSS変数を置くと配下すべてのスタイル再計算を誘発するので、つまみ自身に直接書く
    const thumb = seekThumbRef.current;
    if (thumb) thumb.style.left = `${thumbPct}%`;

    const root = loopCountdownRef.current;
    if (!root) return;
    const duration = loopDurationRef.current;
    if (loopRemaining === null || !duration) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    // ループ内の進み具合。残り時間の割合をそのまま円の欠けとして使う
    if (loopRingRef.current) {
      loopRingRef.current.style.strokeDashoffset = String(LOOP_RING_CIRCUMFERENCE * (loopRemaining / duration));
    }
    // 残り時間なので切り上げる(0.4秒残り → 00:01)。00:00 を挟まず次の周期の頭に戻る。
    const label = formatElapsed(Math.ceil(loopRemaining));
    const time = loopTimeRef.current;
    if (time && time.textContent !== label) time.textContent = label;
  }, []);

  // ?debug時のみ。人が読むオーバーレイなので毎フレーム作り直さず間引く。
  const updateDebugText = useCallback((video: HTMLVideoElement, range: SeekRange | null) => {
    const now = performance.now();
    if (now - lastDebugAtRef.current < DEBUG_TEXT_INTERVAL_MS) return;
    lastDebugAtRef.current = now;
    setDebugText(renderDebugText(video, hlsRef.current, range));
  }, []);

  const updateSeekBar = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    const range = getSeekableRange(video);
    if (!range || range.end <= range.start) {
      writeSeekDom(0, null);
      // 同じ参照を渡すのでReactは再レンダリングをスキップする
      setSeekState(INITIAL_SEEK_STATE);
      if (isDebugEnabled) updateDebugText(video, null);
      return;
    }

    const span = range.end - range.start;
    const position = Math.min(Math.max(video.currentTime - range.start, 0), span);
    const liveEdge = getLiveEdge(hlsRef.current, range);
    const isLive = liveEdge - video.currentTime <= LIVE_EDGE_THRESHOLD_SECONDS;
    const elapsed = !Number.isFinite(video.duration)
      ? formatElapsed(video.currentTime)
      : `${formatElapsed(video.currentTime)} / ${formatElapsed(video.duration)}`;

    // rAFループに相乗りしているので、setIntervalを足さずに1秒未満の精度で更新される
    writeSeekDom((position / span) * 100, loopRemainingSeconds(loopDurationRef.current, video.currentTime));

    // 秒単位でしか変わらない値だけstateへ。変化が無ければ前の参照を返して再レンダリングを止める。
    setSeekState((prev) =>
      prev.hasRange && prev.isLive === isLive && prev.elapsed === elapsed
        ? prev
        : { hasRange: true, isLive, elapsed }
    );
    if (isDebugEnabled) updateDebugText(video, range);
  }, [writeSeekDom, updateDebugText]);

  const clearPendingSeek = useCallback(() => {
    if (pendingSeekRef.current) clearTimeout(pendingSeekRef.current.timeoutId);
    pendingSeekRef.current = null;
  }, []);

  // アンマウント時に最後のシーク巻き戻しガードが残らないようにする
  useEffect(() => clearPendingSeek, [clearPendingSeek]);

  function armSeekRevertGuard(target: number, retriesLeft: number) {
    clearPendingSeek();
    pendingSeekRef.current = {
      target,
      retriesLeft,
      timeoutId: window.setTimeout(clearPendingSeek, SEEK_REVERT_GUARD_MS),
    };
  }

  // ライブ配信中、シーク直後にhls.js側のライブプレイリスト再読み込みと競合して
  // currentTimeがライブ端付近へ強制的に戻されることがある(サーバーのプレイリストが
  // 直近6セグメント分しか公開しておらず、その裏側の内部処理と重なるタイミング依存の競合)。
  // 実機検証では「一度だけ同じ位置へ再シークすると安定する」ことを確認できたため、
  // 直後に大きく乖離したseekingが来た場合は自動的に同じ位置へリトライする。
  function handleSeeking() {
    const video = videoRef.current;
    const pending = pendingSeekRef.current;
    if (!video || !pending) return;
    const diff = Math.abs(video.currentTime - pending.target);
    if (diff <= SEEK_REVERT_TOLERANCE_SECONDS) return;
    if (pending.retriesLeft <= 0) {
      clearPendingSeek();
      return;
    }
    const { target, retriesLeft } = pending;
    clearPendingSeek();
    video.currentTime = target;
    armSeekRevertGuard(target, retriesLeft - 1);
  }

  // シークバー上の割合(0〜1)を実際の再生時刻に変換してシークする
  function seekToRatio(ratio: number) {
    const video = videoRef.current;
    if (!video) return;
    const range = getSeekableRange(video);
    if (!range) return;
    const span = range.end - range.start;
    const target = range.start + Math.min(Math.max(ratio, 0), 1) * span;
    video.currentTime = target;
    armSeekRevertGuard(target, SEEK_REVERT_MAX_RETRIES);
    // ドラッグ中は rAF による補間更新を止めているため、timeupdate 等の発火を待たず
    // ここで即座に見た目を反映する(待つとつまみが実際の再生位置に追従して見えない)。
    updateSeekBar();
  }

  function ratioFromPointerEvent(event: ReactPointerEvent<HTMLDivElement>) {
    const rect = seekBarRef.current!.getBoundingClientRect();
    return (event.clientX - rect.left) / rect.width;
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLDivElement>) {
    isSeekingRef.current = true;
    event.currentTarget.setPointerCapture(event.pointerId);
    seekToRatio(ratioFromPointerEvent(event));
  }
  function handlePointerMove(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isSeekingRef.current) return;
    seekToRatio(ratioFromPointerEvent(event));
  }
  function endSeek(event: ReactPointerEvent<HTMLDivElement>) {
    if (!isSeekingRef.current) return;
    isSeekingRef.current = false;
    event.currentTarget.releasePointerCapture(event.pointerId);
  }

  const stopRaf = useCallback(() => {
    if (rafIdRef.current === null) return;
    cancelAnimationFrame(rafIdRef.current);
    rafIdRef.current = null;
  }, []);

  // timeupdate はブラウザによっては数百ms〜1秒間隔でしか発火しないため、
  // 再生中は rAF でも補間更新し、シークバーの見た目の追従を滑らかにする。
  // tickはループ開始時に一度だけ作る。毎レンダリングで作り直すと、走行中のrAF連鎖が
  // 古いクロージャを掴んだままになる。
  const startRaf = useCallback(() => {
    if (rafIdRef.current !== null) return;
    const tick = () => {
      if (!isSeekingRef.current) updateSeekBar();
      rafIdRef.current = requestAnimationFrame(tick);
    };
    rafIdRef.current = requestAnimationFrame(tick);
  }, [updateSeekBar]);

  // 非表示タブでは見た目の更新に意味が無いのでループごと止める。
  // videoは再生され続けるため、復帰時はtimeupdateを待たずここで再開する。
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "hidden") stopRaf();
      else if (videoRef.current && !videoRef.current.paused) startRaf();
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, [startRaf, stopRaf]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !playlistUrl) return;
    let hls: Hls | null = null;
    let isCancelled = false;
    const startPlayback = () => {
      if (isCancelled) return;
      video.play().catch(() => {});
    };

    // チャンネル切替時、前チャンネルのシーク状態を引き継がないようリセットする
    clearPendingSeek();
    isSeekingRef.current = false;
    setSeekState(INITIAL_SEEK_STATE);

    // hls.js対応ブラウザではhls.jsで再生し、Safari等ネイティブHLS対応ブラウザでは
    // video要素にsrcを直接設定して再生する
    if (Hls.isSupported()) {
      hls = new Hls({ liveDurationInfinity: true });
      hlsRef.current = hls;
      hls.loadSource(playlistUrl);
      hls.attachMedia(video);
      hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
      if (isDebugEnabled) {
        (window as unknown as Record<string, unknown>).__hls = hls;
        (window as unknown as Record<string, unknown>).__Hls = Hls;
      }
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      video.src = playlistUrl;
      video.addEventListener("loadedmetadata", startPlayback);
    }

    if (!video.paused) startRaf();
    updateSeekBar();

    return () => {
      isCancelled = true;
      hls?.destroy();
      hlsRef.current = null;
      // destroy済みのインスタンスをグローバル経由で保持し続けないよう、
      // チャンネル切替のたびにデバッグ用の参照も外す
      if (isDebugEnabled) (window as unknown as Record<string, unknown>).__hls = null;
      video.removeEventListener("loadedmetadata", startPlayback);
      stopRaf();
    };
  }, [playlistUrl, clearPendingSeek, startRaf, stopRaf, updateSeekBar]);

  function handlePlayToggle() {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) video.play();
    else video.pause();
  }
  function handleMuteToggle() {
    const video = videoRef.current;
    if (!video) return;
    video.muted = !video.muted;
  }
  // フルスクリーンの入退場を切り替える
  function handleFullscreenToggle() {
    if (document.fullscreenElement) {
      document.exitFullscreen();
    } else {
      videoFrameRef.current?.requestFullscreen();
    }
  }

  // 全画面化中は.video-frameの外(サイドバーのコメント欄)が描画されなくなるため、
  // 全画面状態を検知して右下にコメントの簡易オーバーレイを出す
  useEffect(() => {
    function onFullscreenChange() {
      setIsFullscreen(document.fullscreenElement === videoFrameRef.current);
    }
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // 全画面オーバーレイも新着コメントが増えたら最下部までスクロールする
  useEffect(() => {
    const el = fullscreenCommentListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments]);
  // LIVEボタン押下で配信のライブ端まで一気にシークして再生を再開する
  function handleLiveClick() {
    const video = videoRef.current;
    if (!video) return;
    const range = getSeekableRange(video);
    if (!range) return;
    video.currentTime = getLiveEdge(hlsRef.current, range);
    video.play().catch(() => {});
  }

  return (
    <div className="video-frame" ref={videoFrameRef}>
      <video
        ref={videoRef}
        className="video-player"
        autoPlay
        muted
        playsInline
        onPlay={() => {
          setIsPaused(false);
          if (document.visibilityState === "visible") startRaf();
        }}
        onPause={() => {
          setIsPaused(true);
          stopRaf();
        }}
        onEnded={() => stopRaf()}
        onVolumeChange={() => setIsMuted(videoRef.current?.muted ?? false)}
        onTimeUpdate={updateSeekBar}
        onProgress={updateSeekBar}
        onDurationChange={updateSeekBar}
        onSeeking={handleSeeking}
      />
      {!playlistUrl && <p className="video-loading-status">読み込み中...</p>}
      <div className="gift-animation-layer" aria-hidden="true">
        {giftAnimations.map((animation) => (
          <img
            key={animation.key}
            className={`gift-animation-item${animation.isLeaving ? " is-leaving" : ""}`}
            src={animation.src}
            alt={animation.alt}
            onError={(event) => {
              event.currentTarget.onerror = null;
              event.currentTarget.src = animation.fallback;
            }}
          />
        ))}
      </div>
      {isDebugEnabled && <pre className="debug-overlay">{debugText}</pre>}
      {isFullscreen && comments.length > 0 && (
        <div className="fullscreen-comment-overlay" aria-live="polite">
          <ul className="fullscreen-comment-list" ref={fullscreenCommentListRef}>
            {comments.map((comment) => (
              <li key={comment.key} className="fullscreen-comment-item">
                {comment.item && (
                  <img
                    className="fullscreen-comment-item-icon"
                    src={comment.item.iconUrl}
                    alt={comment.item.name}
                    onError={(event) => {
                      event.currentTarget.onerror = null;
                      event.currentTarget.src = ITEM_ICON_FALLBACK;
                    }}
                  />
                )}
                {comment.item?.name}
                {comment.text ? (comment.item ? " " : "") + comment.text : null}
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="video-controls">
        <div
          className="seek-bar"
          ref={seekBarRef}
          role="slider"
          aria-label="シークバー"
          tabIndex={0}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endSeek}
          onPointerCancel={endSeek}
        >
          <div className="seek-bar-track">
            {/* つまみの位置は毎フレーム変わるため、rAFループがleftを直接書き換える */}
            <div className={`seek-bar-buffered${seekState.hasRange ? " is-active" : ""}`} />
            <div className="seek-bar-thumb" ref={seekThumbRef} />
          </div>
        </div>
        <div className="video-controls-row">
          <button
            type="button"
            className="video-control-btn"
            aria-label={isPaused ? "再生" : "一時停止"}
            onClick={handlePlayToggle}
          >
            {isPaused ? <PlayIcon /> : <PauseIcon />}
          </button>
          <button
            type="button"
            className="video-control-btn"
            aria-label={isMuted ? "ミュート解除" : "ミュート"}
            onClick={handleMuteToggle}
          >
            {isMuted ? <MutedIcon /> : <UnmutedIcon />}
          </button>
          <button
            type="button"
            className={`live-button${seekState.isLive ? " is-live" : ""}`}
            aria-label="ライブに戻る"
            onClick={handleLiveClick}
          >
            <span className={`live-dot${seekState.isLive ? " is-live" : ""}`} />
            LIVE
          </button>
          <span className="elapsed-time">{seekState.elapsed}</span>
          <LoopCountdown
            durationSeconds={loopDurationSeconds}
            rootRef={loopCountdownRef}
            ringRef={loopRingRef}
            timeRef={loopTimeRef}
          />
          <div className="video-controls-spacer" />
          <button type="button" className="video-control-btn" aria-label="全画面表示" onClick={handleFullscreenToggle}>
            <svg className="video-control-icon" viewBox="0 0 24 24" fill="none">
              <path
                d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

export function StreamMeta({ streamer }: { streamer: StreamerInfo }) {
  const avatarUrl = initialAvatarDataUrl(streamer.name, streamer.iconColor);
  const followStorageKey = `follow:${streamer.name}`;

  const [isFollowing, setIsFollowing] = useState(() => localStorage.getItem(followStorageKey) === "true");
  const [viewerCount, setViewerCount] = useState(VIEWER_COUNT_INITIAL);
  const [likeCount, setLikeCount] = useState(() => Number(localStorage.getItem(LIKE_COUNT_STORAGE_KEY)) || 0);
  const [particles, setParticles] = useState<{ key: number; emoji: string; left: number; drift: number }[]>([]);
  const [isLiked, setIsLiked] = useState(false);

  // 視聴者数のモック表示。数秒おきに小さくランダム増減させてライブ感を出す
  useEffect(() => {
    const id = window.setInterval(() => {
      setViewerCount((count) => {
        const delta = Math.floor(Math.random() * (VIEWER_COUNT_MAX_DELTA * 2 + 1)) - VIEWER_COUNT_MAX_DELTA;
        return Math.max(VIEWER_COUNT_MIN, count + delta);
      });
    }, VIEWER_COUNT_UPDATE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, []);

  function toggleFollow() {
    setIsFollowing((prev) => {
      const next = !prev;
      localStorage.setItem(followStorageKey, String(next));
      return next;
    });
  }

  function handleLike() {
    setLikeCount((count) => {
      const next = count + 1;
      localStorage.setItem(LIKE_COUNT_STORAGE_KEY, String(next));
      return next;
    });

    const key = generateKey();
    setParticles((prev) => [
      ...prev,
      {
        key,
        emoji: LIKE_PARTICLES[Math.floor(Math.random() * LIKE_PARTICLES.length)],
        left: 8 + Math.random() * 16,
        drift: Math.floor(Math.random() * 30) - 15,
      },
    ]);
    setTimeout(() => {
      setParticles((prev) => prev.filter((particle) => particle.key !== key));
    }, LIKE_PARTICLE_LIFETIME_MS);

    setIsLiked(false);
    requestAnimationFrame(() => setIsLiked(true));
    setTimeout(() => setIsLiked(false), LIKE_BUTTON_ANIMATION_MS);
  }

  return (
    <div className="stream-meta">
      <div className="streamer-icon">
        <img className="streamer-icon-img" src={avatarUrl} alt={streamer.name} />
      </div>
      <div className="stream-title-box">
        <span className="streamer-name">{streamer.name}</span>
        <span className="streamer-label">{streamer.label}</span>
        <div className="stream-tag-row">
          {streamer.tags.map((tag) => (
            <span key={tag} className="stream-tag-badge">
              {tag}
            </span>
          ))}
        </div>
      </div>
      <button
        type="button"
        className={`follow-toggle-button${isFollowing ? " is-following" : ""}`}
        aria-pressed={isFollowing}
        onClick={toggleFollow}
      >
        <span className="follow-toggle-icon" aria-hidden="true">
          {isFollowing ? "🔔" : "🔕"}
        </span>
        <span className="follow-toggle-label">{isFollowing ? "フォロー中" : "フォロー"}</span>
      </button>
      <div className="like-button-wrap">
        <div className="like-particle-layer" aria-hidden="true">
          {particles.map((particle) => (
            <span
              key={particle.key}
              className="like-particle"
              style={{ left: `${particle.left}px`, "--drift": `${particle.drift}px` } as CSSProperties}
            >
              {particle.emoji}
            </span>
          ))}
        </div>
        <button type="button" className={`like-button${isLiked ? " is-liked" : ""}`} aria-label="いいね" onClick={handleLike}>
          <span className="like-button-icon" aria-hidden="true">
            ♡
          </span>
        </button>
        <span className="like-count">{likeCount.toLocaleString()}</span>
      </div>
      <div className="viewer-count-box">
        <span className="viewer-count-number">{viewerCount.toLocaleString()}</span>人視聴中
      </div>
    </div>
  );
}

// 1件ごとの振れ幅。左右の向きもランダムにして、同時到着した泡が重なって見えないようにする
function randomGiftBubbleSway(): number {
  const scale = 1 - GIFT_BUBBLE_SWAY_VARIANCE + Math.random() * GIFT_BUBBLE_SWAY_VARIANCE * 2;
  return GIFT_BUBBLE_SWAY_PX * scale * (Math.random() < 0.5 ? -1 : 1);
}

// 飛行中の位置指定。left/topには中心座標を置くので、常に自身の半分だけ戻してから移動させる
function giftBubbleTransform(x: number, y: number, scale: number): string {
  return `translate(-50%, -50%) translate(${x}px, ${y}px) scale(${scale})`;
}

// ギフト1個分の飛行演出。Web Animations APIで泡のような蛇行上昇を再生し、
// 着地したらonFinishで親へ通知する。要素はアンマウントで消えるためDOMに残らない
function GiftBubble({
  bubble,
  onFinish,
}: {
  bubble: GiftBubbleEntry;
  onFinish: (bubble: GiftBubbleEntry) => void;
}) {
  const elementRef = useRef<HTMLImageElement>(null);
  // アニメーションはマウント時に一度だけ張るため、最新のコールバックはrefで読む
  const onFinishRef = useRef(onFinish);
  onFinishRef.current = onFinish;

  useEffect(() => {
    const element = elementRef.current;
    if (!element) return;

    const { deltaX, deltaY, sway } = bubble;
    const animation = element.animate(
      [
        { transform: giftBubbleTransform(0, 0, 0.7), opacity: 0.85, offset: 0 },
        { transform: giftBubbleTransform(deltaX * 0.2 - sway, deltaY * 0.3, 0.95), opacity: 1, offset: 0.25 },
        { transform: giftBubbleTransform(deltaX * 0.45 + sway, deltaY * 0.55, 1), opacity: 1, offset: 0.5 },
        { transform: giftBubbleTransform(deltaX * 0.7 - sway * 0.7, deltaY * 0.8, 0.9), opacity: 0.9, offset: 0.75 },
        { transform: giftBubbleTransform(deltaX, deltaY, 0.45), opacity: 0, offset: 1 },
      ],
      { duration: GIFT_BUBBLE_DURATION_MS, easing: "ease-in-out", fill: "forwards" }
    );

    // 完了通知は高々1回。失敗時の保険と本来のonfinishが二重に走ってもコメントは重複させない
    let isSettled = false;
    function settle() {
      if (isSettled) return;
      isSettled = true;
      onFinishRef.current(bubble);
    }
    animation.onfinish = settle;
    const failsafeId = window.setTimeout(settle, GIFT_BUBBLE_DURATION_MS + GIFT_BUBBLE_FAILSAFE_MARGIN_MS);

    return () => {
      window.clearTimeout(failsafeId);
      // cancelではonfinishが発火しないため、途中終了でコメントが二重追加されることはない
      animation.cancel();
    };
  }, [bubble]);

  return (
    <img
      ref={elementRef}
      className="gift-bubble"
      src={bubble.iconUrl}
      alt=""
      style={{ left: `${bubble.startX}px`, top: `${bubble.startY}px` }}
      onError={(event) => {
        event.currentTarget.onerror = null;
        event.currentTarget.src = bubble.fallback;
      }}
    />
  );
}

export function CommentsPanel({
  onGiftItem,
  comments,
  appendComment,
}: {
  onGiftItem: (item: Item) => void;
  comments: CommentEntry[];
  appendComment: (comment: CommentEntry) => void;
}) {
  const listRef = useRef<HTMLUListElement>(null);
  // 飛行演出の起点。選択中のギフトチップがあればそれを、無ければギフトボタンを使う
  const giftPreviewRef = useRef<HTMLDivElement>(null);
  const giftButtonRef = useRef<HTMLButtonElement>(null);
  const [giftBubbles, setGiftBubbles] = useState<GiftBubbleEntry[]>([]);

  // ギフト受信時、アイコンをコメント一覧の下端へ飛ばす。座標は都度getBoundingClientRectで
  // 実測するのでリサイズやレイアウト変更にも追従する。起点や一覧が測れないとき、
  // および動きを減らす設定のときは演出を省いて即座にコメントを出す
  const playGiftBubble = useCallback(
    (item: Item, comment: CommentEntry) => {
      const originElement = giftPreviewRef.current ?? giftButtonRef.current;
      const listElement = listRef.current;
      if (!originElement || !listElement || prefersReducedMotion()) {
        appendComment(comment);
        return;
      }

      const originRect = originElement.getBoundingClientRect();
      const listRect = listElement.getBoundingClientRect();
      const startX = originRect.left + originRect.width / 2;
      const startY = originRect.top + originRect.height / 2;
      // 着地点は「次のコメントが現れる位置」。一覧が埋まっていなければ既存コメントの直下、
      // 埋まっていて最下部まで流れている場合は一覧の下端になる
      const contentBottom =
        listRect.top + Math.min(listElement.scrollHeight - listElement.scrollTop, listRect.height);
      setGiftBubbles((prev) => [
        ...prev,
        {
          key: generateKey(),
          iconUrl: item.iconUrl,
          fallback: ITEM_ICON_FALLBACK,
          startX,
          startY,
          deltaX: listRect.left + GIFT_BUBBLE_LANDING_INSET_X - startX,
          deltaY: contentBottom - GIFT_BUBBLE_LANDING_INSET_Y - startY,
          sway: randomGiftBubbleSway(),
          comment,
        },
      ]);
    },
    [appendComment]
  );

  // 着地した演出要素を取り除き、入れ替わりに実際のコメントを一覧へ流す。
  // 演出は1件ずつ独立して動くので、連続して届いても互いに干渉しない
  const handleGiftBubbleFinish = useCallback(
    (bubble: GiftBubbleEntry) => {
      setGiftBubbles((prev) => prev.filter((entry) => entry.key !== bubble.key));
      appendComment(bubble.comment);
    },
    [appendComment]
  );

  // SSE(Server-Sent Events)で他ユーザーのコメントをリアルタイム受信する
  useEffect(() => {
    const events = new EventSource(`${COMMENT_SERVER_URL}/events`);
    events.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as {
          id?: string;
          text?: string;
          item?: Item;
          timestamp?: string;
        };
        const { id, text, item, timestamp } = payload ?? {};
        if (!item && !text) return;

        const comment: CommentEntry = {
          key: generateKey(),
          id,
          text: text ? maskNgWords(text) : undefined,
          item,
          isNew: true,
        };
        if (id) {
          queueHistoryLog({ id, text: text ?? null, item: item ?? null, timestamp });
        }
        if (item) {
          onGiftItem(item);
          // ギフトは飛行演出が着地してからコメント一覧に追加する
          playGiftBubble(item, comment);
        } else {
          appendComment(comment);
        }
      } catch {
        // 不正なデータは無視する
      }
    };
    return () => events.close();
  }, [onGiftItem, appendComment, playGiftBubble]);

  // 新着コメントが増えたら一覧の最下部までスクロールする
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [comments]);

  // --- ギフト(アイテム)選択機能 ---
  const [isPanelOpen, setIsPanelOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);
  const [isItemsLoading, setIsItemsLoading] = useState(false);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const selectedItem = items?.find((item) => item.id === selectedItemId) ?? null;

  // ギフトの持ち点。端末内でのみ保持し、送信成功のたびに消費する
  const [points, setPoints] = useState(() => {
    const stored = localStorage.getItem(GIFT_POINTS_STORAGE_KEY);
    return stored !== null ? Number(stored) : GIFT_POINTS_INITIAL_BALANCE;
  });
  function spendPoints(amount: number) {
    setPoints((prev) => {
      const next = prev - amount;
      localStorage.setItem(GIFT_POINTS_STORAGE_KEY, String(next));
      return next;
    });
  }
  const insufficientPoints = selectedItem !== null && selectedItem.cost > points;

  // アイテム一覧をサーバーから取得する(初回パネル表示時・再取得ボタン押下時に呼ばれる)
  const fetchItems = useCallback(async () => {
    setIsItemsLoading(true);
    setItemsError(null);
    try {
      const response = await fetch(ITEMS_URL);
      if (!response.ok) {
        throw new Error(`アイテム一覧の取得に失敗しました (status: ${response.status})`);
      }
      const data = (await response.json()) as { items?: Item[] };
      setItems(data.items ?? []);
    } catch {
      setItemsError("アイテム一覧の取得に失敗しました。");
    } finally {
      setIsItemsLoading(false);
    }
  }, []);

  function closePanel() {
    setIsPanelOpen(false);
  }
  // アイテムパネルの開閉トグル。初回オープン時に未取得ならアイテム一覧を取得する
  function togglePanel() {
    setIsPanelOpen((open) => {
      const next = !open;
      if (next && items === null && !isItemsLoading) fetchItems();
      return next;
    });
  }
  // アイテムクリック時のトグル選択(同じアイテムを再クリックすると選択解除)
  function handleItemClick(item: Item) {
    setSelectedItemId((id) => (id === item.id ? null : item.id));
  }

  // 背景クリック、✕ボタン、またはEscapeキーでオーバーレイを閉じる
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  // --- コメント入力欄のバリデーションと送信 ---
  const [commentText, setCommentText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const length = commentText.length;
  const isEmpty = commentText.trim().length === 0;
  const isOverLimit = length > COMMENT_MAX_LENGTH;
  const canSend = (!isEmpty || selectedItemId !== null) && !isOverLimit && !isSending && !insufficientPoints;
  const displayedError = isOverLimit
    ? `文字数が上限(${COMMENT_MAX_LENGTH}文字)を超えています。`
    : insufficientPoints && selectedItem
      ? `ポイントが足りません(必要 ${selectedItem.cost}pt / 所持 ${points}pt)`
      : sendError;

  function handleCommentInput(event: ChangeEvent<HTMLTextAreaElement>) {
    const value = event.target.value;
    setCommentText(value);
    if (value.length <= COMMENT_MAX_LENGTH) setSendError(null);
  }

  // コメントサーバーにコメント本文/選択アイテムをPOST送信し、成功したら入力状態をリセットする
  async function sendComment() {
    const text = commentText.trim();
    const itemId = selectedItemId;
    if ((!text && !itemId) || isOverLimit || isSending || insufficientPoints) return;

    const payload: { text?: string; itemId?: string } = {};
    if (text) payload.text = text;
    if (itemId) payload.itemId = itemId;

    setIsSending(true);
    setSendError(null);

    try {
      const response = await fetch(`${COMMENT_SERVER_URL}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`送信に失敗しました (status: ${response.status})`);
      }
      if (itemId) {
        const cost = items?.find((item) => item.id === itemId)?.cost ?? 0;
        spendPoints(cost);
      }
      setCommentText("");
      setSelectedItemId(null);
      closePanel();
    } catch {
      setSendError("送信に失敗しました。通信環境をご確認のうえ、再送信してください。");
    } finally {
      setIsSending(false);
    }
  }

  function handleSendClick() {
    if (!canSend) return;
    sendComment();
  }

  return (
    <>
      <div className="gift-bubble-layer" aria-hidden="true">
        {giftBubbles.map((bubble) => (
          <GiftBubble key={bubble.key} bubble={bubble} onFinish={handleGiftBubbleFinish} />
        ))}
      </div>
      <section className="comment-area">
        <div className="comment-panel-head">
          <h2 className="area-title">コメント</h2>
          {comments.length > 0 && <span className="comment-count">{comments.length}件</span>}
        </div>
        {comments.length === 0 && (
          <div className="comment-empty">
            <p className="comment-empty-title">まだコメントはありません</p>
            <p className="comment-empty-hint">最初のひとことを送ると、ここに流れます。</p>
          </div>
        )}
        <ul className="comment-list" ref={listRef}>
          {comments.map((comment) => (
            <li
              key={comment.key}
              className={`comment-item${comment.item ? " comment-item--gift" : ""}${
                comment.isNew ? " is-new" : ""
              }`}
              style={
                comment.item
                  ? ({ "--item-bg-color": pastelColorForItemId(comment.item.id) } as CSSProperties)
                  : undefined
              }
            >
              <span
                className="comment-avatar"
                style={{ "--avatar-color": avatarColorForComment(comment) } as CSSProperties}
                aria-hidden="true"
              >
                {avatarLabelForComment(comment)}
              </span>
              <div className="comment-body">
                {comment.item && (
                  <>
                    <img className="comment-item-icon" src={comment.item.iconUrl} alt={comment.item.name} />
                    {comment.item.name}
                  </>
                )}
                {comment.text && (
                  <>
                    {comment.item ? " " : null}
                    {comment.text}
                  </>
                )}
              </div>
            </li>
          ))}
        </ul>
        <div className={`item-panel-backdrop${isPanelOpen ? " is-open" : ""}`} onClick={closePanel} />
        <div className={`item-panel-body${isPanelOpen ? " is-open" : ""}`} id="item-panel-body">
          <div className="item-panel-inner">
            <div className="item-panel-header">
              <span className="item-panel-title">ギフトを選ぶ</span>
              <span className="gift-points-badge" title="ギフトに使えるポイント">
                <span aria-hidden="true">🪙</span> {points.toLocaleString()}pt
              </span>
              <button type="button" className="item-panel-close" aria-label="閉じる" onClick={closePanel}>
                ✕
              </button>
            </div>
            <div className="item-panel-content">
              {isItemsLoading && <p className="item-status">読み込み中...</p>}
              {itemsError && (
                <>
                  <p className="item-status is-error">{itemsError}</p>
                  <button type="button" className="item-retry-button" onClick={fetchItems}>
                    再取得
                  </button>
                </>
              )}
              {!isItemsLoading && !itemsError && items && (
                <div className="item-choice-list">
                  {items.map((item) => {
                    const isSelected = item.id === selectedItemId;
                    const isUnaffordable = item.cost > points;
                    const themeColor = getItemThemeColor(item.id);
                    return (
                      <button
                        key={item.id}
                        type="button"
                        className={`item-choice${isSelected ? " is-selected" : ""}${
                          isUnaffordable ? " is-unaffordable" : ""
                        }`}
                        aria-pressed={isSelected}
                        style={
                          {
                            "--item-color": themeColor,
                            "--item-color-rgb": hexToRgbString(themeColor),
                          } as CSSProperties
                        }
                        onClick={() => handleItemClick(item)}
                      >
                        <img
                          className="item-choice-icon"
                          src={item.iconUrl}
                          alt={item.name}
                          onError={(event) => {
                            event.currentTarget.onerror = null;
                            event.currentTarget.src = ITEM_ICON_FALLBACK;
                          }}
                        />
                        <span className="item-choice-name">{item.name}</span>
                        <span className="item-choice-cost">{item.cost}pt</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
      <section className="send-area">
        <div className="gift-row">
          <span className="gift-points-badge" title="ギフトに使えるポイント">
            <span aria-hidden="true">🪙</span> {points.toLocaleString()}pt
          </span>
          {selectedItem && (
            <div
              ref={giftPreviewRef}
              className="selected-item-preview"
              style={
                {
                  "--item-color": getItemThemeColor(selectedItem.id),
                  "--item-color-rgb": hexToRgbString(getItemThemeColor(selectedItem.id)),
                } as CSSProperties
              }
            >
              <img className="selected-item-preview-icon" src={selectedItem.iconUrl} alt={selectedItem.name} />
              <span className="selected-item-preview-name">{selectedItem.name}</span>
            </div>
          )}
          <button
            type="button"
            ref={giftButtonRef}
            className={`gift-button${isPanelOpen ? " is-open" : ""}`}
            aria-expanded={isPanelOpen}
            aria-controls="item-panel-body"
            onClick={togglePanel}
          >
            <span className="gift-button-icon" aria-hidden="true">
              ★
            </span>
            <span>ギフト</span>
          </button>
        </div>
        <div className="comment-row">
          <textarea
            className="comment-input"
            placeholder="コメントを入力"
            rows={2}
            value={commentText}
            onChange={handleCommentInput}
          />
          <button type="button" className="send-button" disabled={!canSend} onClick={handleSendClick}>
            {isSending ? "送信中..." : "送信"}
          </button>
        </div>
        <div className="comment-meta-row">
          <span className={`char-counter${isOverLimit ? " is-over" : ""}`}>
            {length}/{COMMENT_MAX_LENGTH}
          </span>
        </div>
        {displayedError && (
          <p className="comment-error" role="alert">
            {displayedError}
          </p>
        )}
      </section>
    </>
  );
}

// おすすめ配信の1件分。サムネはホーム画面のカードと同じ配色ロジックを縮小して流用する
function RecommendedThumbnail({ stream }: { stream: Stream }) {
  const gradient = `linear-gradient(155deg, ${stream.thumbnailColor} 0%, ${darkenHex(
    stream.thumbnailColor,
    0.42
  )} 100%)`;
  return (
    <div className="recommended-item-thumbnail" style={{ background: gradient }}>
      <span className="recommended-item-initial" aria-hidden="true">
        {stream.streamerName.slice(0, 1)}
      </span>
      <span className="recommended-item-live-badge">LIVE</span>
      <span className="recommended-item-viewer-badge">{stream.viewerCount.toLocaleString()}人</span>
    </div>
  );
}

// 視聴画面左側のおすすめ配信パネル。今見ているチャンネルは一覧から除く
export function RecommendedSidebar({
  streams,
  activeChannelId,
}: {
  streams: Stream[];
  activeChannelId: string | null;
}) {
  const visibleStreams = streams.filter((stream) => stream.channelId !== activeChannelId);
  if (visibleStreams.length === 0) return null;

  return (
    <aside className="recommended-area" aria-label="おすすめの配信">
      <h2 className="recommended-area-title">おすすめの配信</h2>
      <ul className="recommended-list">
        {visibleStreams.map((stream) => (
          <li key={stream.id}>
            <a
              className="recommended-item"
              href={`/watch.html?channelId=${encodeURIComponent(stream.channelId)}`}
            >
              <RecommendedThumbnail stream={stream} />
              <div className="recommended-item-body">
                <p className="recommended-item-title">{stream.title}</p>
                <p className="recommended-item-meta">
                  <span className="recommended-item-streamer">{stream.streamerName}</span>
                  <span className="recommended-item-category">{stream.category}</span>
                </p>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function Watch() {
  const [giftAnimations, setGiftAnimations] = useState<GiftAnimationEntry[]>([]);
  const [activeChannelId, setActiveChannelId] = useState<string | null>(null);
  const [recommendedStreams, setRecommendedStreams] = useState<Stream[]>([]);
  // コメント一覧はサイドバーと全画面オーバーレイの双方から参照するため、
  // CommentsPanelではなくここで一元管理する
  const [comments, setComments] = useState<CommentEntry[]>([]);
  // 履歴サーバーからの遡り取得と、ライブSSE受信の両方がここを通るため、
  // 同じidのメッセージが二重に表示されないようにここで一元的に弾く
  const seenIdsRef = useRef<Set<string>>(new Set());

  // 既出idの記録。Setは挿入順を保つので、溢れた分は古い方から捨てられる。
  const rememberCommentId = useCallback((id: string) => {
    const seen = seenIdsRef.current;
    seen.add(id);
    if (seen.size <= SEEN_COMMENT_ID_LIMIT) return;
    let excess = seen.size - SEEN_COMMENT_ID_LIMIT;
    for (const oldest of seen) {
      seen.delete(oldest);
      if (--excess <= 0) break;
    }
  }, []);

  const appendComment = useCallback(
    (comment: CommentEntry) => {
      if (comment.id) {
        if (seenIdsRef.current.has(comment.id)) return;
        rememberCommentId(comment.id);
      }
      // 新着の縁取り(.is-new)はCSSアニメーションで自然に消える。以前はタイマーで
      // isNewをfalseに戻していたが、1件のためにコメント配列全体を作り直すことになり、
      // 件数に比例して1コメントあたりのコストが増えていた。
      setComments((prev) => {
        const next = [...prev, comment];
        return next.length > COMMENT_MAX_ENTRIES ? next.slice(next.length - COMMENT_MAX_ENTRIES) : next;
      });
    },
    [rememberCommentId]
  );

  // 視聴開始時、履歴サーバーから直近のコメントを取得して先頭にまとめて差し込む。
  // 履歴サーバー未デプロイ/未起動でも黙って無視し、通常の視聴に支障は出さない
  useEffect(() => {
    // アンマウント後にレスポンスの受信とパースを続けないよう、接続ごと打ち切る
    const controller = new AbortController();
    fetch(`${HISTORY_SERVER_URL}/history`, { signal: controller.signal })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: { messages?: { id: string; text: string | null; item: Item | null }[] } | null) => {
        if (!data?.messages) return;
        const seed: CommentEntry[] = [];
        for (const message of data.messages) {
          if (seenIdsRef.current.has(message.id)) continue;
          rememberCommentId(message.id);
          seed.push({
            key: generateKey(),
            id: message.id,
            text: message.text ? maskNgWords(message.text) : undefined,
            item: message.item ?? undefined,
            isNew: false,
          });
        }
        if (seed.length > 0) setComments((prev) => [...seed, ...prev]);
      })
      .catch(() => {
        // 履歴サーバーが未起動/未デプロイのとき、および中断時は何もしない
      });
    return () => controller.abort();
  }, [rememberCommentId]);
  // channelId指定時はチャンネル一覧取得を待ち、未指定時は待たずに固定エンドポイントで即再生する
  const [playlistUrl, setPlaylistUrl] = useState<string | null>(
    requestedChannelId ? null : LEGACY_DEFAULT_PLAYLIST_URL
  );

  useEffect(() => {
    let cancelled = false;
    fetchChannels()
      .then((list) => {
        if (cancelled) return;
        if (requestedChannelId) {
          const matched = list.find((channel) => channel.id === requestedChannelId) ?? pickDefaultChannel(list);
          if (matched) {
            setActiveChannelId(matched.id);
            setPlaylistUrl(resolvePlaylistUrl(matched));
            return;
          }
        }
        const defaultChannel = pickDefaultChannel(list);
        if (defaultChannel) setActiveChannelId(defaultChannel.id);
      })
      .catch(() => {
        if (cancelled) return;
        // channelId指定時、一覧が取れなくても後方互換の固定エンドポイントで再生を続ける
        setPlaylistUrl((current) => current ?? LEGACY_DEFAULT_PLAYLIST_URL);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetchStreams().then((list) => {
      if (!cancelled) setRecommendedStreams(list);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // ループ表示は /channels.json の取得結果に依存させない。取得できていればそのidを、
  // まだ/取れなくてもURL指定のid、それも無ければ既定チャンネルとみなして尺を引く。
  // カタログに無いidのときはundefinedになり、ループ表示自体が出ない。
  const resolvedChannelId = activeChannelId ?? requestedChannelId ?? CATALOG_DEFAULT_CHANNEL_ID;
  const loopChannel = findChannelCatalogEntry(resolvedChannelId);

  // ホーム画面の配信一覧(streams-data.ts)からchannelIdが一致する配信を探し、
  // タイトル・配信者名をホーム画面と一致させる。取得前/未知のchannelIdの間はMOCK_STREAMERを表示する。
  const activeStream = recommendedStreams.find((stream) => stream.channelId === resolvedChannelId) ?? null;
  const streamerInfo = activeStream ? streamerInfoFromStream(activeStream) : MOCK_STREAMER;

  // アイテムがanimationUrlを持つ場合、動画エリア上にポップアップ表示してからフェードアウトする
  const triggerGiftAnimation = useCallback((item: Item) => {
    if (!item.animationUrl) return;
    const key = generateKey();
    setGiftAnimations((prev) => [
      ...prev,
      { key, src: item.animationUrl as string, fallback: item.iconUrl, alt: item.name, isLeaving: false },
    ]);
    setTimeout(() => {
      setGiftAnimations((prev) => prev.map((a) => (a.key === key ? { ...a, isLeaving: true } : a)));
    }, GIFT_ANIMATION_DISPLAY_MS - GIFT_ANIMATION_FADE_MS);
    setTimeout(() => {
      setGiftAnimations((prev) => prev.filter((a) => a.key !== key));
    }, GIFT_ANIMATION_DISPLAY_MS);
  }, []);

  return (
    <div className="layout">
      <RecommendedSidebar streams={recommendedStreams} activeChannelId={activeChannelId} />
      <section
        className="video-area"
        style={{ "--stage-light-rgb": hexToRgbString(streamerInfo.iconColor) } as CSSProperties}
      >
        <div className="stage">
          <VideoPlayer
            playlistUrl={playlistUrl}
            giftAnimations={giftAnimations}
            loopDurationSeconds={loopChannel?.durationSeconds ?? null}
            comments={comments}
          />
          <h1 className="watch-title">{streamerInfo.title}</h1>
          <StreamMeta streamer={streamerInfo} />
        </div>
      </section>
      <aside className="side-area">
        <CommentsPanel onGiftItem={triggerGiftAnimation} comments={comments} appendComment={appendComment} />
      </aside>
    </div>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <Watch />
  </StrictMode>
);
