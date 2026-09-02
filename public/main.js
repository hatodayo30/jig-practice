import Hls from "hls.js";

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

function startPlayback() {
  video.play().catch(() => {});
}

if (Hls.isSupported()) {
  const hls = new Hls({ liveDurationInfinity: true });
  hls.loadSource(STREAM_URL);
  hls.attachMedia(video);
  hls.on(Hls.Events.MANIFEST_PARSED, startPlayback);
} else if (video.canPlayType("application/vnd.apple.mpegurl")) {
  video.src = STREAM_URL;
  video.addEventListener("loadedmetadata", startPlayback);
}

const PLAY_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><path d="M8 5v14l11-7L8 5Z" fill="currentColor" /></svg>';
const PAUSE_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor" /><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor" /></svg>';
const MUTED_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" /><path d="M16.5 8.5 L20.5 15.5 M20.5 8.5 L16.5 15.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" /></svg>';
const UNMUTED_ICON =
  '<svg class="video-control-icon" viewBox="0 0 24 24" fill="none"><path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" /><path d="M16.5 8.5c1.4 1.2 1.4 5.8 0 7" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" /><path d="M19 6.5c2.5 2.3 2.5 8.7 0 11" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" /></svg>';

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

fullscreenToggleBtn.addEventListener("click", () => {
  if (document.fullscreenElement) {
    document.exitFullscreen();
  } else {
    videoFrame.requestFullscreen();
  }
});

function getSeekableRange() {
  const seekable = video.seekable;
  if (seekable.length === 0) return null;
  return { start: seekable.start(0), end: seekable.end(seekable.length - 1) };
}

function updateSeekBar() {
  const range = getSeekableRange();
  if (!range || range.end <= range.start) {
    seekBarBuffered.style.width = "0%";
    seekBarThumb.style.left = "0%";
    liveButton.classList.remove("is-live");
    liveDot.classList.remove("is-live");
    return;
  }

  const span = range.end - range.start;
  const position = Math.min(Math.max(video.currentTime - range.start, 0), span);
  seekBarBuffered.style.width = "100%";
  seekBarThumb.style.left = `${(position / span) * 100}%`;

  const isLive = range.end - video.currentTime <= LIVE_EDGE_THRESHOLD_SECONDS;
  liveButton.classList.toggle("is-live", isLive);
  liveDot.classList.toggle("is-live", isLive);
}

function seekToRatio(ratio) {
  const range = getSeekableRange();
  if (!range) return;
  const span = range.end - range.start;
  video.currentTime = range.start + Math.min(Math.max(ratio, 0), 1) * span;
}

function ratioFromPointerEvent(event) {
  const rect = seekBar.getBoundingClientRect();
  return (event.clientX - rect.left) / rect.width;
}

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

liveButton.addEventListener("click", () => {
  const range = getSeekableRange();
  if (!range) return;
  video.currentTime = range.end;
  startPlayback();
});

video.addEventListener("timeupdate", updateSeekBar);
video.addEventListener("progress", updateSeekBar);
video.addEventListener("durationchange", updateSeekBar);

updatePlayToggle();
updateMuteToggle();
updateSeekBar();

const COMMENT_SERVER_URL = "https://intern-comment-server.intern-comment-server.deno.net";
const commentList = document.getElementById("comment-list");

function renderCommentEntry({ text, item }) {
  const li = document.createElement("li");
  li.className = "comment-item";

  if (item) {
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
}

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

let isSending = false;

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

function updateSendButtonDisabled() {
  const { isEmpty, isOverLimit } = getCommentValidation();
  sendButton.disabled = isEmpty || isOverLimit || isSending;
}

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

async function sendComment(text) {
  isSending = true;
  sendButton.textContent = "送信中...";
  hideCommentError();
  updateSendButtonDisabled();

  try {
    const response = await fetch(`${COMMENT_SERVER_URL}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });

    if (!response.ok) {
      throw new Error(`送信に失敗しました (status: ${response.status})`);
    }

    commentInput.value = "";
  } catch {
    showCommentError("送信に失敗しました。通信環境をご確認のうえ、再送信してください。");
  } finally {
    isSending = false;
    sendButton.textContent = "送信";
    updateSendButtonDisabled();
  }
}

function handleSendClick() {
  const { value, isEmpty, isOverLimit } = getCommentValidation();
  if (isEmpty || isOverLimit || isSending) return;
  sendComment(value.trim());
}

commentInput.addEventListener("input", updateCommentUI);

sendButton.addEventListener("click", handleSendClick);

updateCommentUI();
