// ホーム画面のエントリスクリプト。
// 配信一覧・おすすめ配信をモックデータから取得してカード表示し、
// カードクリックで視聴画面(watch.html)へ遷移させる。
import { StrictMode, useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { fetchStreams, fetchRecommendedStreams, type Stream } from "./streams-data";
import { formatLoopDuration, listChannelCatalog, roundedLoopMinutes } from "./channel-catalog";

type LoadState = "loading" | "error" | "ready";

const ALL_CATEGORIES = "すべて";

// 配信色はサムネのグラデーションと、その下に漏れる「照明」の両方に使うため、
// 16進カラーをRGB成分に分解しておく。
function hexToRgb(hex: string): [number, number, number] {
  const value = hex.replace("#", "");
  const full =
    value.length === 3
      ? value
          .split("")
          .map((channel) => channel + channel)
          .join("")
      : value;
  const int = parseInt(full, 16);
  return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
}

// グラデーションの暗い側を作る(ratio=0で元の色、1で黒)
function darken(hex: string, ratio: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => Math.round(channel * (1 - ratio));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

function StreamCard({ stream, index }: { stream: Stream; index: number }) {
  const [r, g, b] = hexToRgb(stream.thumbnailColor);
  const cardStyle = {
    "--light": stream.thumbnailColor,
    "--light-rgb": `${r}, ${g}, ${b}`,
    "--i": index,
  } as CSSProperties;
  const thumbnailStyle = {
    background: `linear-gradient(155deg, ${stream.thumbnailColor} 0%, ${darken(
      stream.thumbnailColor,
      0.42
    )} 100%)`,
  };

  return (
    <a
      className="stream-card"
      style={cardStyle}
      href={`/watch.html?channelId=${encodeURIComponent(stream.channelId)}`}
    >
      <div className="stream-card-thumbnail" style={thumbnailStyle}>
        <span className="stream-card-initial" aria-hidden="true">
          {stream.streamerName.slice(0, 1)}
        </span>
        <span className="stream-card-live-badge">LIVE</span>
        <span className="stream-card-viewer-badge">{stream.viewerCount.toLocaleString()}人</span>
      </div>
      <div className="stream-card-body">
        <h3 className="stream-card-title">{stream.title}</h3>
        <p className="stream-card-meta">
          <span className="stream-card-streamer">{stream.streamerName}</span>
          <span className="stream-card-category">{stream.category}</span>
        </p>
      </div>
    </a>
  );
}

function StreamGrid({
  streams,
  state,
  errorMessage,
  emptyMessage,
  className,
}: {
  streams: Stream[];
  state: LoadState;
  errorMessage: string;
  emptyMessage: string;
  className?: string;
}) {
  if (state === "loading") {
    return (
      <div className={className}>
        <p className="stream-grid-status">読み込み中...</p>
      </div>
    );
  }
  if (state === "error") {
    return (
      <div className={className}>
        <p className="stream-grid-status">{errorMessage}</p>
      </div>
    );
  }
  if (streams.length === 0) {
    return (
      <div className={className}>
        <p className="stream-grid-status">{emptyMessage}</p>
      </div>
    );
  }
  return (
    <div className={className}>
      {streams.map((stream, index) => (
        <StreamCard key={stream.id} stream={stream} index={index} />
      ))}
    </div>
  );
}

// 配信中チャンネルを尺つきで並べる軽量な一覧。StreamGridの配信カードとは別物で、
// 「どのチャンネルも固定尺でループしていて、開けば他の視聴者と同じ瞬間が見られる」
// ことを伝えるための表示。尺のカタログが空なら何も出さない。
function LoopingChannelSection() {
  const channels = listChannelCatalog();
  if (channels.length === 0) return null;

  return (
    <section className="stream-section">
      <div className="stream-section-head">
        <h2 className="stream-section-title">同時視聴中のチャンネル</h2>
        <span className="stream-section-count">{channels.length}ch</span>
      </div>
      <p className="loop-channel-note">
        どのチャンネルも固定の尺でループ再生中。同じチャンネルを開いている人には、いつでも同じ瞬間の映像が流れます。
      </p>
      <ul className="loop-channel-list">
        {channels.map((channel) => (
          <li key={channel.id}>
            <a
              className="loop-channel-item"
              href={`/watch.html?channelId=${encodeURIComponent(channel.id)}`}
            >
              <span className="loop-channel-title">{channel.title}</span>
              <span className="loop-channel-badge">約{roundedLoopMinutes(channel.durationSeconds)}分でループ</span>
              <span className="loop-channel-duration">{formatLoopDuration(channel.durationSeconds)}</span>
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}

function useStreamList(fetcher: () => Promise<Stream[]>) {
  const [state, setState] = useState<LoadState>("loading");
  const [streams, setStreams] = useState<Stream[]>([]);

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    fetcher()
      .then((result) => {
        if (cancelled) return;
        setStreams(result);
        setState("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [fetcher]);

  return { state, streams };
}

function App() {
  const recommended = useStreamList(fetchRecommendedStreams);
  const all = useStreamList(fetchStreams);
  const [category, setCategory] = useState(ALL_CATEGORIES);

  // 絞り込みの選択肢は配信データのcategoryから作るので、選んで0件になる組み合わせは出ない
  const categories = useMemo(
    () => [ALL_CATEGORIES, ...new Set(all.streams.map((stream) => stream.category))],
    [all.streams]
  );
  const visibleStreams =
    category === ALL_CATEGORIES
      ? all.streams
      : all.streams.filter((stream) => stream.category === category);

  return (
    <main className="home-main">
      <section className="stream-section">
        <div className="stream-section-head">
          <h2 className="stream-section-title">おすすめ配信</h2>
        </div>
        <StreamGrid
          className="stream-grid stream-grid--recommended"
          streams={recommended.streams}
          state={recommended.state}
          errorMessage="おすすめ配信を読み込めませんでした。時間をおいて再読み込みしてください。"
          emptyMessage="いまおすすめできる配信はありません。下の配信一覧から探せます。"
        />
      </section>

      <LoopingChannelSection />

      <section className="stream-section">
        <div className="stream-section-head">
          <h2 className="stream-section-title">配信一覧</h2>
          {all.state === "ready" && (
            <span className="stream-section-count">{visibleStreams.length}件</span>
          )}
        </div>
        {all.state === "ready" && categories.length > 2 && (
          <div className="category-filter" role="group" aria-label="カテゴリで絞り込む">
            {categories.map((name) => (
              <button
                key={name}
                type="button"
                className={`category-chip${name === category ? " is-active" : ""}`}
                aria-pressed={name === category}
                onClick={() => setCategory(name)}
              >
                {name}
              </button>
            ))}
          </div>
        )}
        <StreamGrid
          className="stream-grid"
          streams={visibleStreams}
          state={all.state}
          errorMessage="配信一覧を読み込めませんでした。時間をおいて再読み込みしてください。"
          emptyMessage="いま配信中の番組はありません。"
        />
      </section>
    </main>
  );
}

const container = document.getElementById("root");
if (!container) throw new Error("#root element not found");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>
);
