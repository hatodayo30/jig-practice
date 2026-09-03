// ライブ配信画面のエントリスクリプト。
// HLS再生、シークバー同期、コメント送受信、ギフト(アイテム)選択の各機能を初期化する。
import Hls from "hls.js";

// 配信用HLSマニフェストのURLと、シークバー上で「ライブ扱い」とみなす配信端からの許容秒数
const STREAM_URL = "https://intern-hls-server.tdmi0e341.workers.dev/stream.m3u8";
const LIVE_EDGE_THRESHOLD_SECONDS = 9;

const video = document.getElementById("stream-video");
const videoFrame = video.closest(".video-frame");
const playToggleBtn = document.getElementById("play-toggle");
const muteToggleBtn = document.getElementById("mute-toggle");
const fullscreenToggleBtn = document.getElementById("fullscreen-toggle");
const liveButton = document.getElementById("live-button");
const liveDot = document.getElementById("live-dot");
const seekBar = document.getElementById("seek-bar");
const seekBarBuffered = document.getElementById("seek-bar-buffered");
const seekBarThumb = document.getElementById("seek-bar-thumb");
const elapsedTimeEl = document.getElementById("elapsed-time");
const debugOverlay = document.getElementById("debug-overlay");
const isDebugEnabled = new URLSearchParams(location.search).has("debug");

let hls = null;

function startPlayback() {
  video.play().catch(() => {});
}

// hls.js対応ブラウザではhls.jsで再生し、Safari等ネイティブHLS対応ブラウザでは
// video要素にsrcを直接設定して再生する
if (Hls.isSupported()) {
  hls = new Hls({ liveDurationInfinity: true });
  hls.loadSource(STREAM_URL);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
  if (isDebugEnabled) {
    window.__hls = hls;
    window.__Hls = Hls;
  }
} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
  video.src = STREAM_URL;
  video.addEventListener("loadedmetadata", startPlayback);
}

// 再生/一時停止・ミュート/ミュート解除ボタンに表示するSVGアイコン
const PLAY_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7L8 5Z" fill="currentColor" /></svg>';
const PAUSE_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>';
const MUTED_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" /><path d="M16.5 8.5 L20.5 15.5 M20.5 8.5 L16.5 15.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>';
const UNMUTED_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" /><path d="M16.5 8.5c1.4 1.2 1.4 5.8 0 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" /><path d="M19 6.5c2.5 2.3 2.5 8.7 0 11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" /></svg>';

// video要素の状態(再生中/一時停止、ミュート状態)に応じてボタンの見た目を更新する
function updatePlayToggle() {
  const isPaused = video.paused;
  playToggleBtn.innerHTML = isPaused ? PLAY_ICON : PAUSE_ICON;
  playToggleBtn.setAttribute("aria-label", isPaused ? "再生" : "一時停止");
}

function updateMuteToggle() {
  const isMuted = video.muted;
  muteToggleBtn.innerHTML = isMuted ? MUTED_ICON : UNMUTED_ICON;
  muteToggleBtn.setAttribute("aria-label", isMuted ? "ミュート解除" : "ミュート");
}

video.addEventListener("play", updatePlayToggle);
video.addEventListener("pause", updatePlayToggle);
video.addEventListener("volumechange", updateMuteToggle);

playToggleBtn.addEventListener("click", () => {
  if (video.paused) {
    video.play();
  } else {
    video.pause();
  }
});

muteToggleBtn.addEventListener("click", () => {
  video.muted = !video.muted;
});

// フルスクリーンの入退場を切り替える
fullscreenToggleBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    videoFrame.requestFullscreen();
  }
});

// --- シークバー表示用のヘルパー群 ---
// video.seekable は hls.js の liveDurationInfinity 設定により「配信開始からの
// 全履歴」を指す見かけ上の値になり、実際にはブラウザ側で破棄されて戻れない
// 古い位置まで「シーク可能」に見えてしまう(このサーバーはセグメントURLを
// 使い回すため、破棄された位置は原理的に正しく再取得できない)。
// そのため実際に今デコード済みの video.buffered から、currentTime を含む
// (見つからなければ最後の)区間を実効的なシーク可能範囲として使う。
function getSeekableRange() {
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

// ライブは video.duration が Infinity/NaN になるため、再生位置・尺の算出には
// duration ではなく seekable(DVRウィンドウ) と、可能なら hls.js のライブ端情報を使う。
function isLiveStream() {
  return !Number.isFinite(video.duration);
}

// 配信のライブ端(最新位置)を返す。hls.jsの情報が使えればそちらを優先し、
// なければseekable範囲の終端を代わりに使う
function getLiveEdge(range) {
  if (hls && Number.isFinite(hls.liveSyncPosition)) return hls.liveSyncPosition;
  return range.end;
}

// 秒数を "mm:ss"(1時間以上は "h:mm:ss")形式の文字列に整形する
function formatElapsed(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

// ?debug クエリパラメータ付きアクセス時のみ、再生位置やバッファ状況などの
// デバッグ情報をオーバーレイ表示する
function renderDebugOverlay(range) {
  if (!isDebugEnabled) return;
  debugOverlay.hidden = false;
  const buffered = video.buffered;
  const bufferedRanges = Array.from({ length: buffered.length }, (_, i) =>
    `[${buffered.start(i).toFixed(2)}, ${buffered.end(i).toFixed(2)}]`
  ).join(" ");
  debugOverlay.textContent = [
    `currentTime: ${video.currentTime.toFixed(2)}`,
    `duration: ${video.duration}`,
    `bufferedRange(実効シーク範囲): ${range ? `[${range.start.toFixed(2)}, ${range.end.toFixed(2)}]` : "-"}`,
    `buffered(生データ): ${bufferedRanges || "-"}`,
    `liveSyncPosition: ${hls?.liveSyncPosition ?? "-"}`,
  ].join("\n");
}

// シークバーのつまみ・バッファ表示・LIVEインジケーター・経過時間表示をまとめて更新する
function updateSeekBar() {
  const range = getSeekableRange();
  if (!range || range.end <= range.start) {
    seekBarBuffered.style.width = "0%";
    seekBarThumb.style.left = "0%";
    liveButton.classList.remove("is-live");
    liveDot.classList.remove("is-live");
    elapsedTimeEl.textContent = "--:--";
    renderDebugOverlay(null);
    return;
  }

  const span = range.end - range.start;
  const position = Math.min(Math.max(video.currentTime - range.start, 0), span);

  // range 自体が「実際にバッファ済みの区間」なので、表示中のバー全体が常にバッファ済み。
  seekBarBuffered.style.width = "100%";
  seekBarThumb.style.left = `${(position / span) * 100}%`;

  const liveEdge = getLiveEdge(range);
  const isLive = liveEdge - video.currentTime <= LIVE_EDGE_THRESHOLD_SECONDS;
  liveButton.classList.toggle("is-live", isLive);
  liveDot.classList.toggle("is-live", isLive);

  elapsedTimeEl.textContent = isLiveStream()
    ? formatElapsed(video.currentTime)
    : `${formatElapsed(video.currentTime)} / ${formatElapsed(video.duration)}`;
  renderDebugOverlay(range);
}

// --- シークバーのドラッグ操作 ---
// ライブ配信中、シーク直後にhls.js側のライブプレイリスト再読み込みと競合して
// currentTimeがライブ端付近へ強制的に戻されることがある(サーバーのプレイリストが
// 直近6セグメント分しか公開しておらず、その裏側の内部処理と重なるタイミング依存の競合)。
// 実機検証では「一度だけ同じ位置へ再シークすると安定する」ことを確認できたため、
// 直後に大きく乖離したseekingが来た場合は自動的に同じ位置へリトライする。
const SEEK_REVERT_GUARD_MS = 1500;
const SEEK_REVERT_TOLERANCE_SECONDS = 3;
const SEEK_REVERT_MAX_RETRIES = 3;

let pendingSeek = null;

function clearPendingSeek() {
  if (pendingSeek) clearTimeout(pendingSeek.timeoutId);
  pendingSeek = null;
}

function armSeekRevertGuard(target, retriesLeft) {
  clearPendingSeek();
  pendingSeek = {
    target,
    retriesLeft,
    timeoutId: setTimeout(clearPendingSeek, SEEK_REVERT_GUARD_MS),
  };
}

video.addEventListener("seeking", () => {
  if (!pendingSeek) return;
  const diff = Math.abs(video.currentTime - pendingSeek.target);
  if (diff <= SEEK_REVERT_TOLERANCE_SECONDS) return;
  if (pendingSeek.retriesLeft <= 0) {
    clearPendingSeek();
    return;
  }
  const { target, retriesLeft } = pendingSeek;
  clearPendingSeek();
  video.currentTime = target;
  armSeekRevertGuard(target, retriesLeft - 1);
});

// シークバー上の割合(0〜1)を実際の再生時刻に変換してシークする
function seekToRatio(ratio) {
  const range = getSeekableRange();
  if (!range) return;
  const span = range.end - range.start;
  const target = range.start + Math.min(Math.max(ratio, 0), 1) * span;
  video.currentTime = target;
  armSeekRevertGuard(target, SEEK_REVERT_MAX_RETRIES);
  // ドラッグ中は rAF による補間更新を止めているため、timeupdate 等の発火を待たず
  // ここで即座に見た目を反映する(待つとつまみが実際の再生位置に追従して見えない)。
  updateSeekBar();
}

// ポインター位置からシークバー上の割合(0〜1の範囲外もあり得る)を算出する
function ratioFromPointerEvent(event) {
  const rect = seekBar.getBoundingClientRect();
  return (event.clientX - rect.left) / rect.width;
}

// シークバーのポインター操作(押下・ドラッグ・離す)をハンドリングする
let isSeeking = false;

seekBar.addEventListener("pointerdown", (event) => {
  isSeeking = true;
  seekBar.setPointerCapture(event.pointerId);
  seekToRatio(ratioFromPointerEvent(event));
});

seekBar.addEventListener("pointermove", (event) => {
  if (!isSeeking) return;
  seekToRatio(ratioFromPointerEvent(event));
});

function endSeek(event) {
  if (!isSeeking) return;
  isSeeking = false;
  seekBar.releasePointerCapture(event.pointerId);
}

seekBar.addEventListener("pointerup", endSeek);
seekBar.addEventListener("pointercancel", endSeek);

// LIVEボタン押下で配信のライブ端まで一気にシークして再生を再開する
liveButton.addEventListener("click", () => {
  const range = getSeekableRange();
  if (!range) return;
  video.currentTime = getLiveEdge(range);
  startPlayback();
});

// timeupdate はブラウザによっては数百ms〜1秒間隔でしか発火しないため、
// 再生中は rAF でも補間更新し、シークバーの見た目の追従を滑らかにする。
let rafId = null;

function tick() {
  if (!isSeeking) updateSeekBar();
  rafId = requestAnimationFrame(tick);
}

function startRaf() {
  if (rafId !== null) return;
  rafId = requestAnimationFrame(tick);
}

function stopRaf() {
  if (rafId === null) return;
  cancelAnimationFrame(rafId);
  rafId = null;
}

// 再生中のみrAFループを回し、一時停止・終了時は止めて無駄な更新をしない
video.addEventListener("play", startRaf);
video.addEventListener("pause", stopRaf);
video.addEventListener("ended", stopRaf);

// timeupdate/progress/durationchangeイベントでもシークバーを更新する
video.addEventListener("timeupdate", updateSeekBar);
video.addEventListener("progress", updateSeekBar);
video.addEventListener("durationchange", updateSeekBar);

if (!video.paused) startRaf();

updatePlayToggle();
updateMuteToggle();
updateSeekBar();

// --- コメント機能 ---
// コメントサーバーのURLと、新着コメントをハイライト表示する時間
const COMMENT_SERVER_URL = "https://intern-comment-server.intern-comment-server.deno.net";
const commentList = document.getElementById("comment-list");
const COMMENT_HIGHLIGHT_DURATION_MS = 1500;

// --- ギフトアニメーション演出 ---
// アイテムがanimationUrlを持つ場合、動画エリア上にポップアップ表示してからフェードアウトする
const giftAnimationLayer = document.getElementById("gift-animation-layer");
const GIFT_ANIMATION_DISPLAY_MS = 3200;
const GIFT_ANIMATION_FADE_MS = 250;

function playGiftAnimation(item) {
  if (!item?.animationUrl) return;

  const img = document.createElement("img");
  img.className = "gift-animation-item";
  img.src = item.animationUrl;
  img.alt = item.name;
  img.addEventListener("error", () => {
    img.src = item.iconUrl;
  }, { once: true });

  giftAnimationLayer.appendChild(img);

  setTimeout(() => {
    img.classList.add("is-leaving");
  }, GIFT_ANIMATION_DISPLAY_MS - GIFT_ANIMATION_FADE_MS);

  setTimeout(() => {
    img.remove();
  }, GIFT_ANIMATION_DISPLAY_MS);
}

// アイテムIDから薄いパステルカラーを一意に導出する(同じIDなら常に同じ色になる)
function pastelColorForItemId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  const hue = hash % 360;
  return `hsl(${hue}, 70%, 90%)`;
}

// 1件のコメント(テキストおよび/または選択されたアイテム)をリストに描画する
function renderCommentEntry({ text, item }) {
  if (item) playGiftAnimation(item);

  const li = document.createElement("li");
  li.className = "comment-item";

  if (item) {
    li.style.setProperty("--item-bg-color", pastelColorForItemId(item.id));

    const icon = document.createElement("img");
    icon.className = "comment-item-icon";
    icon.src = item.iconUrl;
    icon.alt = item.name;
    li.appendChild(icon);
    li.appendChild(document.createTextNode(item.name));
  }

  if (text) {
    if (item) li.appendChild(document.createTextNode(" "));
    li.appendChild(document.createTextNode(text));
  }

  if (!item && !text) return;

  commentList.appendChild(li);
  commentList.scrollTop = commentList.scrollHeight;

  li.classList.add("is-new");
  setTimeout(() => li.classList.remove("is-new"), COMMENT_HIGHLIGHT_DURATION_MS);
}

// SSE(Server-Sent Events)で他ユーザーのコメントをリアルタイム受信する
const commentEvents = new EventSource(`${COMMENT_SERVER_URL}/events`);
commentEvents.onmessage = (event) => {
  try {
    const payload = JSON.parse(event.data);
    renderCommentEntry(payload);
  } catch {
    // 不正なデータは無視する
  }
};

const COMMENT_MAX_LENGTH = 200;
const commentInput = document.getElementById("comment-input");
const sendButton = document.getElementById("send-button");
const charCounter = document.getElementById("char-counter");
const commentError = document.getElementById("comment-error");

// --- コメント入力欄のバリデーションと送信 ---
let isSending = false;

// 入力中のコメントの状態(空か、文字数制限を超えているか)を判定する
function getCommentValidation() {
  const value = commentInput.value;
  const length = value.length;
  return {
    value,
    length,
    isEmpty: value.trim().length === 0,
    isOverLimit: length > COMMENT_MAX_LENGTH,
  };
}

function showCommentError(message) {
  commentError.textContent = message;
  commentError.hidden = false;
}

function hideCommentError() {
  commentError.hidden = true;
  commentError.textContent = "";
}

// コメントテキストかアイテム選択のどちらかがあり、文字数超過や送信中でなければ送信可能
function canSend() {
  const { isEmpty, isOverLimit } = getCommentValidation();
  const hasItem = selectedItemId !== null;
  return (!isEmpty || hasItem) && !isOverLimit && !isSending;
}

function updateSendButtonDisabled() {
  sendButton.disabled = !canSend();
}

// 文字数カウンター・エラーメッセージ・送信ボタンの有効/無効を入力内容に合わせて更新する
function updateCommentUI() {
  const { length, isOverLimit } = getCommentValidation();

  charCounter.textContent = `${length}/${COMMENT_MAX_LENGTH}`;
  charCounter.classList.toggle("is-over", isOverLimit);

  if (isOverLimit) {
    showCommentError(`文字数が上限(${COMMENT_MAX_LENGTH}文字)を超えています。`);
  } else {
    hideCommentError();
  }

  updateSendButtonDisabled();
}

// コメントサーバーにコメント本文/選択アイテムをPOST送信し、成功したら入力状態をリセットする
async function sendComment() {
  const { value, isOverLimit } = getCommentValidation();
  const text = value.trim();
  const itemId = selectedItemId;
  if ((!text && !itemId) || isOverLimit || isSending) return;

  const payload = {};
  if (text) payload.text = text;
  if (itemId) payload.itemId = itemId;

  isSending = true;
  sendButton.textContent = "送信中...";
  hideCommentError();
  updateSendButtonDisabled();

  try {
    const response = await fetch(`${COMMENT_SERVER_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`送信に失敗しました (status: ${response.status})`);
    }

    commentInput.value = "";
    selectedItemId = null;
    renderItemPanel();
    renderSelectedItemPreview();
    updateCommentUI();
  } catch {
    showCommentError("送信に失敗しました。通信環境をご確認のうえ、再送信してください。");
  } finally {
    isSending = false;
    sendButton.textContent = "送信";
    updateSendButtonDisabled();
  }
}

// 送信ボタンクリック時のハンドラ(送信可能な場合のみ送信を実行する)
function handleSendClick() {
  if (!canSend()) return;
  sendComment();
}

commentInput.addEventListener("input", updateCommentUI);

sendButton.addEventListener("click", handleSendClick);

// --- ギフト(アイテム)選択機能 ---
// アイテム一覧取得APIのURLと、アイコン画像読み込み失敗時のフォールバック画像
const ITEMS_URL = `${COMMENT_SERVER_URL}/items`;
const ITEM_ICON_FALLBACK =
  "data:image/svg+xml," +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><rect width="24" height="24" rx="4" fill="#ccc"/></svg>'
  );

// アイテムIDごとのテーマカラー(選択中の枠色や光彩表現に使用)
const ITEM_THEME_COLORS = {
  heart: "#ff4d6d",
  star: "#ffb703",
  flower: "#4caf50",
};
const ITEM_THEME_FALLBACK_COLOR = "#9e9e9e";

function getItemThemeColor(id) {
  return ITEM_THEME_COLORS[id] ?? ITEM_THEME_FALLBACK_COLOR;
}

// "#rrggbb"形式の16進カラーコードを "r, g, b" 形式のCSS用文字列に変換する
function hexToRgbString(hex) {
  const match = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!match) return "158, 158, 158";
  const [, r, g, b] = match;
  return `${parseInt(r, 16)}, ${parseInt(g, 16)}, ${parseInt(b, 16)}`;
}

const itemToggleButton = document.getElementById("item-toggle-button");
const itemPanelBackdrop = document.getElementById("item-panel-backdrop");
const itemPanelBody = document.getElementById("item-panel-body");
const itemPanelContent = document.getElementById("item-panel-content");
const itemPanelCloseButton = document.getElementById("item-panel-close");
const selectedItemPreview = document.getElementById("selected-item-preview");
const selectedItemPreviewIcon = document.getElementById("selected-item-preview-icon");
const selectedItemPreviewName = document.getElementById("selected-item-preview-name");

// アイテムパネルの開閉状態、取得済みアイテム一覧、読み込み/エラー状態、選択中アイテムID
let isItemPanelOpen = false;
let items = null;
let isItemsLoading = false;
let itemsError = null;
let selectedItemId = null;

// 将来の送信機能から選択中アイテムを参照するためのエントリポイント
export function getSelectedItem() {
  if (!items || !selectedItemId) return null;
  return items.find((item) => item.id === selectedItemId) ?? null;
}

// アイテムパネル(オーバーレイ)と背景の開閉状態を反映する
function syncItemPanelOpenState() {
  itemPanelBody.classList.toggle("is-open", isItemPanelOpen);
  itemPanelBackdrop.classList.toggle("is-open", isItemPanelOpen);
}

function closeItemPanel() {
  if (!isItemPanelOpen) return;
  isItemPanelOpen = false;
  itemToggleButton.setAttribute("aria-expanded", "false");
  itemToggleButton.classList.remove("is-open");
  syncItemPanelOpenState();
}

// ギフトボタン左の余白に、選択中アイテムのアイコン・名前をプレビュー表示する
function renderSelectedItemPreview() {
  const item = getSelectedItem();

  if (!item) {
    selectedItemPreview.hidden = true;
    return;
  }

  const themeColor = getItemThemeColor(item.id);
  selectedItemPreview.style.setProperty("--item-color", themeColor);
  selectedItemPreview.style.setProperty("--item-color-rgb", hexToRgbString(themeColor));
  selectedItemPreviewIcon.src = item.iconUrl;
  selectedItemPreviewIcon.alt = item.name;
  selectedItemPreviewName.textContent = item.name;
  selectedItemPreview.hidden = false;
}

// アイテムクリック時のトグル選択(同じアイテムを再クリックすると選択解除)
function handleItemClick(item) {
  selectedItemId = selectedItemId === item.id ? null : item.id;
  renderItemPanel();
  renderSelectedItemPreview();
  updateSendButtonDisabled();
}

// アイテムパネルの中身を状態(読み込み中/エラー/一覧)に応じて描画し直す
function renderItemPanel() {
  itemPanelContent.innerHTML = "";

  if (isItemsLoading) {
    const status = document.createElement("p");
    status.className = "item-status";
    status.textContent = "読み込み中...";
    itemPanelContent.appendChild(status);
  } else if (itemsError) {
    const status = document.createElement("p");
    status.className = "item-status is-error";
    status.textContent = itemsError;
    itemPanelContent.appendChild(status);

    const retryButton = document.createElement("button");
    retryButton.type = "button";
    retryButton.className = "item-retry-button";
    retryButton.textContent = "再取得";
    retryButton.addEventListener("click", fetchItems);
    itemPanelContent.appendChild(retryButton);
  } else if (items) {
    const list = document.createElement("div");
    list.className = "item-choice-list";

    items.forEach((item) => {
      const isSelected = item.id === selectedItemId;

      const themeColor = getItemThemeColor(item.id);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "item-choice";
      button.classList.toggle("is-selected", isSelected);
      button.setAttribute("aria-pressed", String(isSelected));
      button.style.setProperty("--item-color", themeColor);
      button.style.setProperty("--item-color-rgb", hexToRgbString(themeColor));
      button.addEventListener("click", () => handleItemClick(item));

      const icon = document.createElement("img");
      icon.className = "item-choice-icon";
      icon.src = item.iconUrl;
      icon.alt = item.name;
      icon.addEventListener("error", () => {
        icon.src = ITEM_ICON_FALLBACK;
      }, { once: true });

      const name = document.createElement("span");
      name.className = "item-choice-name";
      name.textContent = item.name;

      button.appendChild(icon);
      button.appendChild(name);
      list.appendChild(button);
    });

    itemPanelContent.appendChild(list);
  }
}

// アイテム一覧をサーバーから取得する(初回パネル表示時・再取得ボタン押下時に呼ばれる)
async function fetchItems() {
  isItemsLoading = true;
  itemsError = null;
  renderItemPanel();

  try {
    const response = await fetch(ITEMS_URL);
    if (!response.ok) {
      throw new Error(`アイテム一覧の取得に失敗しました (status: ${response.status})`);
    }
    const data = await response.json();
    items = data.items ?? [];
  } catch {
    itemsError = "アイテム一覧の取得に失敗しました。";
  } finally {
    isItemsLoading = false;
    renderItemPanel();
  }
}

// アイテムパネルの開閉トグル。初回オープン時に未取得ならアイテム一覧を取得する
itemToggleButton.addEventListener("click", () => {
  isItemPanelOpen = !isItemPanelOpen;
  itemToggleButton.setAttribute("aria-expanded", String(isItemPanelOpen));
  itemToggleButton.classList.toggle("is-open", isItemPanelOpen);
  syncItemPanelOpenState();

  if (isItemPanelOpen && items === null && !isItemsLoading) {
    fetchItems();
  }
});

// 背景クリック、✕ボタン、またはEscapeキーでオーバーレイを閉じる
itemPanelBackdrop.addEventListener("click", closeItemPanel);
itemPanelCloseButton.addEventListener("click", closeItemPanel);

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeItemPanel();
});

renderItemPanel();
renderSelectedItemPreview();
updateCommentUI();

// --- 配信者プロフィール・視聴者数(モック)表示 ---
// バックエンドと未接続のため、配信者情報・視聴者数はモックデータで表示する
const streamerIconEl = document.getElementById("streamer-icon");
const streamTitleBoxEl = document.getElementById("stream-title-box");
const viewerCountBoxEl = document.getElementById("viewer-count-box");

const MOCK_STREAMER = {
  name: "はると",
  label: "雑談・ゲーム実況チャンネル",
  iconColor: "#6441a5",
};

// 実画像を用意せず、名前の頭文字を円形アイコンとして描画したdata URIを生成する
function initialAvatarDataUrl(name, color) {
  const initial = name.slice(0, 1);
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 36 36">` +
    `<circle cx="18" cy="18" r="18" fill="${color}" />` +
    `<text x="18" y="24" font-size="16" font-family="sans-serif" fill="#fff" text-anchor="middle">${initial}</text>` +
    `</svg>`;
  return "data:image/svg+xml," + encodeURIComponent(svg);
}

const streamerIconImg = document.createElement("img");
streamerIconImg.className = "streamer-icon-img";
streamerIconImg.src = initialAvatarDataUrl(MOCK_STREAMER.name, MOCK_STREAMER.iconColor);
streamerIconImg.alt = MOCK_STREAMER.name;
streamerIconEl.appendChild(streamerIconImg);

streamTitleBoxEl.textContent = "";
const streamerNameEl = document.createElement("span");
streamerNameEl.className = "streamer-name";
streamerNameEl.textContent = MOCK_STREAMER.name;
const streamerLabelEl = document.createElement("span");
streamerLabelEl.className = "streamer-label";
streamerLabelEl.textContent = MOCK_STREAMER.label;
streamTitleBoxEl.appendChild(streamerNameEl);
streamTitleBoxEl.appendChild(streamerLabelEl);

// 視聴者数のモック表示。数秒おきに小さくランダム増減させてライブ感を出す
const VIEWER_COUNT_INITIAL = 1240;
const VIEWER_COUNT_MIN = 100;
const VIEWER_COUNT_MAX_DELTA = 15;
const VIEWER_COUNT_UPDATE_INTERVAL_MS = 4000;

let viewerCount = VIEWER_COUNT_INITIAL;

function renderViewerCount() {
  viewerCountBoxEl.textContent = `${viewerCount.toLocaleString()}人視聴中`;
}

renderViewerCount();

setInterval(() => {
  const delta = Math.floor(Math.random() * (VIEWER_COUNT_MAX_DELTA * 2 + 1)) - VIEWER_COUNT_MAX_DELTA;
  viewerCount = Math.max(VIEWER_COUNT_MIN, viewerCount + delta);
  renderViewerCount();
}, VIEWER_COUNT_UPDATE_INTERVAL_MS);
