// ホーム画面のエントリスクリプト。
// 配信一覧・おすすめ配信をモックデータから取得してカード表示し、
// カードクリックで視聴画面(watch.html)へ遷移させる。
import { fetchStreams, fetchRecommendedStreams } from "./streams-data.js";

const streamGrid = document.getElementById("stream-grid");
const recommendedStreamGrid = document.getElementById("recommended-stream-grid");

function renderStatus(container, message) {
  container.innerHTML = "";
  const status = document.createElement("p");
  status.className = "stream-grid-status";
  status.textContent = message;
  container.appendChild(status);
}

// 1件の配信情報から視聴画面へのリンクカードを組み立てる
function createStreamCard(stream) {
  const card = document.createElement("a");
  card.className = "stream-card";
  card.href = `/watch.html?streamId=${encodeURIComponent(stream.id)}`;

  const thumbnail = document.createElement("div");
  thumbnail.className = "stream-card-thumbnail";
  thumbnail.style.background = stream.thumbnailColor;
  thumbnail.textContent = stream.streamerName.slice(0, 1);

  const liveBadge = document.createElement("span");
  liveBadge.className = "stream-card-live-badge";
  liveBadge.textContent = "LIVE";
  thumbnail.appendChild(liveBadge);

  const viewerBadge = document.createElement("span");
  viewerBadge.className = "stream-card-viewer-badge";
  viewerBadge.textContent = `${stream.viewerCount.toLocaleString()}人視聴中`;
  thumbnail.appendChild(viewerBadge);

  const body = document.createElement("div");
  body.className = "stream-card-body";

  const title = document.createElement("p");
  title.className = "stream-card-title";
  title.textContent = stream.title;

  const streamerName = document.createElement("p");
  streamerName.className = "stream-card-streamer";
  streamerName.textContent = stream.streamerName;

  const category = document.createElement("p");
  category.className = "stream-card-category";
  category.textContent = stream.category;

  body.appendChild(title);
  body.appendChild(streamerName);
  body.appendChild(category);

  card.appendChild(thumbnail);
  card.appendChild(body);
  return card;
}

function renderStreamGrid(container, streams) {
  container.innerHTML = "";
  if (streams.length === 0) {
    renderStatus(container, "現在配信中の番組はありません。");
    return;
  }
  streams.forEach((stream) => container.appendChild(createStreamCard(stream)));
}

async function initRecommendedStreams() {
  renderStatus(recommendedStreamGrid, "読み込み中...");
  try {
    const streams = await fetchRecommendedStreams();
    renderStreamGrid(recommendedStreamGrid, streams);
  } catch {
    renderStatus(recommendedStreamGrid, "おすすめ配信の取得に失敗しました。");
  }
}

async function initStreamList() {
  renderStatus(streamGrid, "読み込み中...");
  try {
    const streams = await fetchStreams();
    renderStreamGrid(streamGrid, streams);
  } catch {
    renderStatus(streamGrid, "配信一覧の取得に失敗しました。");
  }
}

initRecommendedStreams();
initStreamList();
