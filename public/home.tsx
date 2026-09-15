// ホーム画面のエントリスクリプト。
// 配信一覧・おすすめ配信をモックデータから取得してカード表示し、
// カードクリックで視聴画面(watch.html)へ遷移させる。
import { StrictMode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import { createRoot } from "react-dom/client";
import { fetchStreams, fetchRecommendedStreams, type Stream } from "./streams-data";
import { listChannelCatalog } from "./channel-catalog";

type LoadState = "loading" | "error" | "ready";

const ALL_CATEGORIES = "すべて";

// 配信色はサムネのグラデーションと、その下に漏れる「照明」の両方に使うため、
// 16進カラーをRGB成分に分解しておく。
export function hexToRgb(hex: string): [number, number, number] {
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
export function darken(hex: string, ratio: number): string {
  const [r, g, b] = hexToRgb(hex);
  const mix = (channel: number) => Math.round(channel * (1 - ratio));
  return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
}

export function StreamCard({
  stream,
  index,
  tabIndex,
}: {
  stream: Stream;
  index: number;
  tabIndex?: number;
}) {
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
      tabIndex={tabIndex}
      href={`/watch.html?channelId=${encodeURIComponent(stream.channelId)}`}
    >
      <div className="stream-card-thumbnail" style={thumbnailStyle}>
        <span className="stream-card-initial" aria-hidden="true">
          {stream.streamerName.slice(0, 1)}
        </span>
        <span className="stream-card-live-badge">LIVE</span>
        <span className="stream-card-viewer-badge">{stream.viewerCount.toLocaleString()}人</span>
        <div className="stream-card-body">
          <h3 className="stream-card-title">{stream.title}</h3>
          <p className="stream-card-meta">
            <span className="stream-card-streamer">{stream.streamerName}</span>
            <span className="stream-card-category">{stream.category}</span>
          </p>
        </div>
      </div>
    </a>
  );
}

export function StreamGrid({
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

// マーキーの自動送り速度(px/秒)。値を上げるほど速く流れる。
const MARQUEE_PX_PER_SECOND = 40;
// これ以上ポインターが動いたらドラッグ扱いにし、離したときのクリック(遷移)を発生させない
const MARQUEE_DRAG_CLICK_THRESHOLD = 6;

// おすすめ配信を横に流し続けるティッカー用の測定フック。
// カードを2セット以上並べて複製し、複製の「継ぎ目」の間隔(=1周分の移動距離)を
// 実測することでシームレスなループを作る。カード枚数が画面幅に満たない場合は
// セット数を増やして隙間ができないようにする。
function useRecommendedMarqueeLayout(itemCount: number) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const setRefs = useRef<(HTMLDivElement | null)[]>([]);
  const [repeatCount, setRepeatCount] = useState(2);
  const [distance, setDistance] = useState<number | null>(null);
  const [measureTick, setMeasureTick] = useState(0);

  // カード枚数が変わったら複製セット数と測定結果をリセットして測り直す
  useLayoutEffect(() => {
    setRepeatCount(2);
    setDistance(null);
  }, [itemCount]);

  useLayoutEffect(() => {
    if (itemCount === 0) return;
    const container = containerRef.current;
    const firstSet = setRefs.current[0];
    const secondSet = setRefs.current[1];
    if (!container || !firstSet || !secondSet) return;

    // 隣接する2セットの開始位置の差が、そのまま1周分のシームレスな移動距離になる
    const measured = secondSet.getBoundingClientRect().left - firstSet.getBoundingClientRect().left;
    if (measured <= 0) return;

    const containerWidth = container.getBoundingClientRect().width;
    const neededCopies = Math.max(2, Math.ceil((containerWidth * 2) / measured) + 1);

    if (neededCopies !== repeatCount) {
      setRepeatCount(neededCopies);
      return;
    }

    setDistance((prev) => (prev === measured ? prev : measured));
  }, [itemCount, repeatCount, measureTick]);

  // コンテナ幅が変わったら(画面リサイズなど)複製数を測り直す
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setMeasureTick((tick) => tick + 1));
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  return { containerRef, setRefs, repeatCount, distance };
}

// トラックの位置を毎フレーム自前で進める(rAF駆動)ことで、
// 「自動送り」と「ポインターでつかんで動かす」を同じtranslateXの上で両立させる。
// ドラッグ中は自動送りを止めてポインターの移動量をそのまま反映し、
// 離した瞬間から自動送りを再開する。
function useMarqueeDrag({ trackRef, distance, isPaused }: {
  trackRef: React.RefObject<HTMLDivElement | null>;
  distance: number | null;
  isPaused: boolean;
}) {
  const offsetRef = useRef(0);
  const isPausedRef = useRef(isPaused);
  const draggingRef = useRef(false);
  const pointerIdRef = useRef<number | null>(null);
  const lastClientXRef = useRef(0);
  const movedRef = useRef(0);
  const stopDraggingRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    isPausedRef.current = isPaused;
  }, [isPaused]);

  // ドラッグ中にコンポーネントがアンマウントされた場合にwindowのリスナーが残らないようにする
  useEffect(() => () => stopDraggingRef.current?.(), []);

  useEffect(() => {
    let rafId: number;
    let lastTs: number | null = null;

    const step = (ts: number) => {
      const track = trackRef.current;
      if (track && distance) {
        if (!draggingRef.current && !isPausedRef.current) {
          const dt = lastTs === null ? 0 : (ts - lastTs) / 1000;
          offsetRef.current += MARQUEE_PX_PER_SECOND * dt;
        }
        const wrapped = ((offsetRef.current % distance) + distance) % distance;
        track.style.transform = `translateX(${-wrapped}px)`;
      }
      lastTs = ts;
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [trackRef, distance]);

  // ポインターの追従はsetPointerCaptureではなくwindow側のリスナーで行う。
  // captureを使うとポインターを離した瞬間に発火するclickの対象がコンテナ自身に
  // 再ターゲットされてしまい、カードの<a>への本来の遷移が起きなくなるため。
  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!distance) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    const container = e.currentTarget;
    draggingRef.current = true;
    pointerIdRef.current = e.pointerId;
    lastClientXRef.current = e.clientX;
    movedRef.current = 0;
    container.dataset.dragging = "true";

    const handleWindowPointerMove = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== pointerIdRef.current) return;
      const dx = moveEvent.clientX - lastClientXRef.current;
      lastClientXRef.current = moveEvent.clientX;
      movedRef.current += Math.abs(dx);
      offsetRef.current -= dx;
    };

    const cleanup = () => {
      draggingRef.current = false;
      pointerIdRef.current = null;
      container.dataset.dragging = "false";
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", stopDragging);
      window.removeEventListener("pointercancel", stopDragging);
      stopDraggingRef.current = null;
    };

    const stopDragging = (endEvent: PointerEvent) => {
      if (endEvent.pointerId !== pointerIdRef.current) return;
      cleanup();
    };

    stopDraggingRef.current = cleanup;
    window.addEventListener("pointermove", handleWindowPointerMove);
    window.addEventListener("pointerup", stopDragging);
    window.addEventListener("pointercancel", stopDragging);
  };

  // 指/マウスがしきい値以上動いていたらドラッグとみなし、離した瞬間のクリック(遷移)を打ち消す
  const handleClickCapture = (e: React.MouseEvent<HTMLDivElement>) => {
    if (movedRef.current > MARQUEE_DRAG_CLICK_THRESHOLD) {
      e.preventDefault();
      e.stopPropagation();
    }
  };

  return {
    onPointerDown: handlePointerDown,
    onClickCapture: handleClickCapture,
    onDragStart: (e: React.DragEvent) => e.preventDefault(),
  };
}

// 「おすすめ配信」を常にゆっくり流れ続けるティッカーとして表示するセクション。
// タブが非アクティブな間は流れを止め、ドラッグ/スワイプしている間は自動送りより
// ポインターの動きを優先する。離せばその場から自動送りを再開する。
export function RecommendedMarquee({
  streams,
  state,
  errorMessage,
  emptyMessage,
}: {
  streams: Stream[];
  state: LoadState;
  errorMessage: string;
  emptyMessage: string;
}) {
  const { containerRef, setRefs, repeatCount, distance } = useRecommendedMarqueeLayout(streams.length);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [isHidden, setIsHidden] = useState(() => document.visibilityState !== "visible");

  useEffect(() => {
    const handleVisibility = () => setIsHidden(document.visibilityState !== "visible");
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, []);

  const dragHandlers = useMarqueeDrag({ trackRef, distance, isPaused: isHidden });

  if (state === "loading") {
    return <p className="stream-grid-status">読み込み中...</p>;
  }
  if (state === "error") {
    return <p className="stream-grid-status">{errorMessage}</p>;
  }
  if (streams.length === 0) {
    return <p className="stream-grid-status">{emptyMessage}</p>;
  }

  return (
    <div className="stream-marquee" ref={containerRef} data-dragging="false" {...dragHandlers}>
      <div className="stream-marquee-track" ref={trackRef}>
        {Array.from({ length: repeatCount }, (_, setIndex) => (
          <div
            className="stream-marquee-set"
            key={setIndex}
            ref={(el) => {
              setRefs.current[setIndex] = el;
            }}
            aria-hidden={setIndex > 0}
          >
            {streams.map((stream, index) => (
              <StreamCard
                key={`${stream.id}-${setIndex}`}
                stream={stream}
                index={index}
                tabIndex={setIndex > 0 ? -1 : undefined}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// チャンネルの視聴数(紐づく配信のviewerCount)ランキング。ジャンル別表示は「配信一覧」の
// ジャンルタブと役割が重複するため持たせず、ランキングだけの軽量なリストにする。
export function ChannelRankingSection({ streams }: { streams: Stream[] }) {
  const channels = listChannelCatalog();
  if (channels.length === 0) return null;

  const viewerCountByChannelId = new Map(streams.map((stream) => [stream.channelId, stream.viewerCount]));
  const ranked = [...channels].sort(
    (a, b) => (viewerCountByChannelId.get(b.id) ?? 0) - (viewerCountByChannelId.get(a.id) ?? 0)
  );

  return (
    <section className="stream-section">
      <div className="stream-section-head">
        <h2 className="stream-section-title">視聴数ランキング</h2>
        <span className="stream-section-count">{channels.length}ch</span>
      </div>
      <ol className="channel-ranking" aria-label="視聴数ランキング">
        {ranked.map((channel, index) => (
          <li key={channel.id}>
            <a className="channel-ranking-item" href={`/watch.html?channelId=${encodeURIComponent(channel.id)}`}>
              <span className="channel-ranking-rank">{index + 1}</span>
              <span className="channel-ranking-title">{channel.title}</span>
              <span className="channel-ranking-viewers">
                {(viewerCountByChannelId.get(channel.id) ?? 0).toLocaleString()}人
              </span>
            </a>
          </li>
        ))}
      </ol>
    </section>
  );
}

// リールの複製回数。少ない配信件数でも回転距離が短くなりすぎないよう十分な数を並べる
const ROULETTE_REPEAT = 8;
const ROULETTE_DURATION_MS = 4200;
const ROULETTE_EASING = "cubic-bezier(0.09, 0.68, 0.15, 1)";
// transitionendが届かなかったとき(transitioncancel等)に演出を打ち切るまでの猶予
const ROULETTE_SETTLE_FALLBACK_MS = 400;
const CONFETTI_COUNT = 28;
const CONFETTI_DURATION_MS = 1600;

// 中央からの距離(フレーム幅に対する比率、0〜1にクランプ)に応じた奥行き演出の強さ。
// 見た目専用のパラメータで、当選判定や移動アニメーションのロジックには影響しない。
const ROULETTE_DEPTH_SCALE_FALLOFF = 0.35;
const ROULETTE_DEPTH_ROTATE_Y_DEG = 20;
const ROULETTE_DEPTH_TRANSLATE_Z_PX = 160;
const ROULETTE_DEPTH_OPACITY_FALLOFF = 0.65;
const ROULETTE_DEPTH_MIN_OPACITY = 0.2;
const ROULETTE_DEPTH_BLUR_PX = 3;
// この範囲より外側にあるカードは画面内に入っていないとみなし、毎フレームの計算対象から除外する
const ROULETTE_DEPTH_CULL_MARGIN_PX = 300;

// リール中央からの距離に応じて、各カードの見た目(奥行き)を連続的に変化させる。
// 当選判定やアニメーションとは独立した、見た目専用の処理。
//
// カード100枚超を1フレームで扱うため、計測(getBoundingClientRect)を先にまとめてから
// 書き込みに移る。書き込んでいるtransform/opacity/filterはレイアウトを無効化しないので
// 交互に行っても強制同期レイアウトにはならないが、読み書きが混ざらない形にしておけば
// 将来レイアウトに影響するプロパティを足したときに事故らない。
function applyRouletteDepth(frame: HTMLDivElement, cards: (HTMLDivElement | null)[]) {
  const frameRect = frame.getBoundingClientRect();
  if (frameRect.width === 0) return;
  const centerX = frameRect.left + frameRect.width / 2;

  // --- 計測フェーズ: レイアウトの読み取りだけを行う ---
  const measured: { card: HTMLDivElement; cardCenterX: number }[] = [];
  for (const card of cards) {
    if (!card) continue;
    const cardRect = card.getBoundingClientRect();
    if (
      cardRect.right < frameRect.left - ROULETTE_DEPTH_CULL_MARGIN_PX ||
      cardRect.left > frameRect.right + ROULETTE_DEPTH_CULL_MARGIN_PX
    ) {
      continue;
    }
    measured.push({ card, cardCenterX: cardRect.left + cardRect.width / 2 });
  }

  // --- 書き込みフェーズ: 以降レイアウトを読まない ---
  for (const { card, cardCenterX } of measured) {
    const distanceRatio = (cardCenterX - centerX) / frameRect.width;
    const absDistanceRatio = Math.min(Math.abs(distanceRatio), 1);

    const scale = 1 - absDistanceRatio * ROULETTE_DEPTH_SCALE_FALLOFF;
    const rotateY = distanceRatio * -ROULETTE_DEPTH_ROTATE_Y_DEG;
    const translateZ = -absDistanceRatio * ROULETTE_DEPTH_TRANSLATE_Z_PX;
    const opacity = Math.max(1 - absDistanceRatio * ROULETTE_DEPTH_OPACITY_FALLOFF, ROULETTE_DEPTH_MIN_OPACITY);
    const blur = absDistanceRatio * ROULETTE_DEPTH_BLUR_PX;

    card.style.transform = `translateZ(${translateZ}px) rotateY(${rotateY}deg) scale(${scale})`;
    card.style.opacity = String(opacity);
    card.style.filter = `blur(${blur}px)`;
  }
}

// 紙吹雪の1粒。色・落下位置・回転・タイミングをランダムに振るだけの飾り
function ConfettiBurst() {
  const pieces = useMemo(
    () =>
      Array.from({ length: CONFETTI_COUNT }, (_, i) => ({
        id: i,
        left: Math.random() * 100,
        hue: Math.round(Math.random() * 360),
        delay: Math.random() * 0.25,
        duration: 0.9 + Math.random() * 0.6,
        rotate: Math.round(Math.random() * 360),
        drift: Math.round((Math.random() - 0.5) * 120),
      })),
    []
  );

  return (
    <div className="confetti-burst" aria-hidden="true">
      {pieces.map((piece) => (
        <span
          key={piece.id}
          className="confetti-piece"
          style={
            {
              left: `${piece.left}%`,
              "--confetti-hue": piece.hue,
              "--confetti-delay": `${piece.delay}s`,
              "--confetti-duration": `${piece.duration}s`,
              "--confetti-rotate": `${piece.rotate}deg`,
              "--confetti-drift": `${piece.drift}px`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}

// ルーレット演出用のリール状態。当選するカードはアニメーション開始時点で先に確定し、
// 見た目(translateXの移動)はその結果に向けて減速しながら近づくだけにする。
function useRouletteReel(streams: Stream[]) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const spinningRef = useRef(false);
  const spinTokenRef = useRef(0);
  // 走行中の演出の後始末。回転中にアンマウントされたときに呼ぶ。
  const cleanupSpinRef = useRef<(() => void) | null>(null);

  const [isSpinning, setIsSpinning] = useState(false);
  const [result, setResult] = useState<Stream | null>(null);
  const [landedReelIndex, setLandedReelIndex] = useState<number | null>(null);
  const [confettiKey, setConfettiKey] = useState(0);
  const [showConfetti, setShowConfetti] = useState(false);

  const reelItems = useMemo(() => {
    if (streams.length === 0) return [];
    return Array.from({ length: ROULETTE_REPEAT }, (_, copy) =>
      streams.map((stream) => ({ stream, key: `${stream.id}-${copy}` }))
    ).flat();
  }, [streams]);

  const spin = () => {
    // 連打しても二重に走らないよう、状態更新を待たずrefで即ガードする
    if (spinningRef.current || streams.length === 0) return;
    const frame = frameRef.current;
    const track = trackRef.current;
    const firstCard = cardRefs.current[0];
    const secondCard = cardRefs.current[1];
    if (!frame || !track || !firstCard) return;

    spinningRef.current = true;
    const token = ++spinTokenRef.current;
    setIsSpinning(true);
    setResult(null);
    setLandedReelIndex(null);
    setShowConfetti(false);

    // 演出開始時点のレイアウトを基準に移動距離を確定する(リサイズが起きても走行中の目標はぶれない)
    track.style.transition = "none";
    track.style.transform = "translateX(0px)";
    track.style.filter = "blur(3px)";
    void track.offsetHeight; // リセットを確実に反映させてから実測する

    // getBoundingClientRect()は奥行き演出(applyRouletteDepthが毎フレーム適用する
    // translateZ/rotateY/scale)の影響を受けた見た目上の矩形を返してしまい、
    // カード幅や間隔の実測値がズレる。offsetWidth/offsetLeftはレイアウト上の値で
    // transformの影響を受けないため、これらを使って中央合わせのズレを防ぐ。
    const cardWidth = firstCard.offsetWidth;
    const step = secondCard ? secondCard.offsetLeft - firstCard.offsetLeft : cardWidth;
    const frameCenter = frame.offsetWidth / 2;

    // 先頭・末尾の複製を避けた「安全な」ループ内からランダムに当選indexを決める
    const lastLoopStart = (ROULETTE_REPEAT - 2) * streams.length;
    const targetIndex = lastLoopStart + Math.floor(Math.random() * streams.length);
    const targetOffset = -(targetIndex * step + cardWidth / 2 - frameCenter);

    requestAnimationFrame(() => {
      if (spinTokenRef.current !== token) return;
      // ぼかしはtransformと同じ減速カーブだと最初の一瞬でほぼ消えてしまうため、
      // 「回っている感」が最後まで残るようlinearでゆっくり晴らす
      track.style.transition = `transform ${ROULETTE_DURATION_MS}ms ${ROULETTE_EASING}, filter ${ROULETTE_DURATION_MS}ms linear`;
      track.style.transform = `translateX(${targetOffset}px)`;
      track.style.filter = "blur(0px)";
    });

    // 演出の後始末。アンマウント時にも呼べるよう、状態更新とは分けておく。
    const cleanupSpin = () => {
      track.removeEventListener("transitionend", handleTransitionEnd);
      window.clearTimeout(fallbackId);
      if (cleanupSpinRef.current === cleanupSpin) cleanupSpinRef.current = null;
    };

    const settle = () => {
      cleanupSpin();
      if (spinTokenRef.current !== token) return;
      const landed = streams[targetIndex % streams.length];
      setResult(landed);
      setLandedReelIndex(targetIndex);
      setIsSpinning(false);
      spinningRef.current = false;
      setConfettiKey((key) => key + 1);
      setShowConfetti(true);
    };

    const handleTransitionEnd = (event: TransitionEvent) => {
      // transitionendはバブリングするため、カードのホバー演出(.stream-card-thumbnailの
      // transform遷移)が偶然重なって発火したイベントを拾わないよう、対象がtrack自身で
      // かつ"transform"の完了であることを確認してから処理する(trackは"filter"も同時に
      // 遷移させているため、プロパティ名を見ずに解除すると本命のtransform完了を取りこぼす)。
      if (event.target !== track || event.propertyName !== "transform") return;
      settle();
    };

    // transitionendはtransitioncancel(遷移が別の指定で打ち切られた場合)では発火しない。
    // 取りこぼすとspinningRefがtrueのまま固着し、以後サイコロボタンが二度と押せなくなるため、
    // 尺を過ぎても届かなければこちらで確定させる。
    const fallbackId = window.setTimeout(settle, ROULETTE_DURATION_MS + ROULETTE_SETTLE_FALLBACK_MS);
    track.addEventListener("transitionend", handleTransitionEnd);
    cleanupSpinRef.current = cleanupSpin;
  };

  // 回転中にアンマウントされてもリスナと保険タイマーを残さない
  useEffect(() => () => cleanupSpinRef.current?.(), []);

  useEffect(() => {
    if (!showConfetti) return;
    const timer = window.setTimeout(() => setShowConfetti(false), CONFETTI_DURATION_MS);
    return () => window.clearTimeout(timer);
  }, [showConfetti]);

  // 立体的な奥行き演出専用のループ。当選判定やtranslateXのアニメーション処理には
  // 一切干渉しない。
  //
  // カード位置が動くのは回転中(trackのtransform遷移中)だけなので、毎フレーム回すのも
  // その間に限る。静止中は見た目が変わらないため一度反映すれば足り、放置しても負荷が残らない。
  useEffect(() => {
    if (reelItems.length === 0) return;
    // reelItemsが減ったとき、前回の要素が配列の末尾に残らないようにする
    cardRefs.current.length = reelItems.length;

    const apply = () => {
      const frame = frameRef.current;
      if (frame) applyRouletteDepth(frame, cardRefs.current);
    };

    apply();
    window.addEventListener("resize", apply);

    let rafId = 0;
    if (isSpinning) {
      const tick = () => {
        // ウィンドウが隠れている間は見た目を更新しても意味が無い
        if (document.visibilityState === "visible") apply();
        rafId = requestAnimationFrame(tick);
      };
      rafId = requestAnimationFrame(tick);
    }

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", apply);
    };
  }, [reelItems.length, isSpinning]);

  return {
    frameRef,
    trackRef,
    cardRefs,
    reelItems,
    isSpinning,
    result,
    landedReelIndex,
    confettiKey,
    showConfetti,
    spin,
  };
}

// 「サイコロを振る」→ カードが横に流れて減速し、中央のポインターでピタッと止まる演出。
// 止まった配信がその場の「今日の1本」になる。
export function TodaysPickSection({ streams }: { streams: Stream[] }) {
  const {
    frameRef,
    trackRef,
    cardRefs,
    reelItems,
    isSpinning,
    result,
    landedReelIndex,
    confettiKey,
    showConfetti,
    spin,
  } = useRouletteReel(streams);

  if (streams.length === 0) return null;

  const buttonLabel = isSpinning ? "選んでいます…" : result ? "もう一度振る" : "サイコロを振る";

  return (
    <section className="stream-section">
      <div className="stream-section-head">
        <h2 className="stream-section-title">🎲 今日の1本</h2>
      </div>
      <p className="roulette-note">サイコロを振って、今日見る配信をランダムに1本選びます。</p>

      <div className="roulette-panel">
        <div className="roulette-frame" ref={frameRef}>
          <span className="roulette-pointer roulette-pointer-top" aria-hidden="true" />
          <span className="roulette-pointer roulette-pointer-bottom" aria-hidden="true" />
          <div className="roulette-track" ref={trackRef}>
            {reelItems.map((item, index) => (
              <div
                className={`roulette-card${index === landedReelIndex ? " is-landed" : ""}`}
                key={item.key}
                ref={(el) => {
                  cardRefs.current[index] = el;
                }}
              >
                <StreamCard stream={item.stream} index={index} tabIndex={-1} />
              </div>
            ))}
          </div>
          {showConfetti && <ConfettiBurst key={confettiKey} />}
        </div>

        <button type="button" className="roulette-button" onClick={spin} disabled={isSpinning}>
          <span
            className={`roulette-button-icon${isSpinning ? " is-spinning" : ""}`}
            aria-hidden="true"
          >
            🎲
          </span>
          <span>{buttonLabel}</span>
        </button>

        {result && !isSpinning && (
          <div className="roulette-result">
            <p className="roulette-result-label">今日のあなたへの1本</p>
            <h3 className="roulette-result-title">{result.title}</h3>
            <p className="roulette-result-meta">
              <span className="roulette-result-streamer">{result.streamerName}</span>
              <span>{result.category}</span>
              <span>{result.viewerCount.toLocaleString()}人視聴中</span>
            </p>
            <a
              className="roulette-result-cta"
              href={`/watch.html?channelId=${encodeURIComponent(result.channelId)}`}
            >
              この配信を見る
            </a>
          </div>
        )}
      </div>
    </section>
  );
}

export function useStreamList(fetcher: () => Promise<Stream[]>) {
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

export function App() {
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

  // 「すべて」選択時はカテゴリごとの小節に分けて並べる。個別カテゴリ選択時は1グループしかないので単一グリッドのままでよい
  const groupedStreams = useMemo(() => {
    if (category !== ALL_CATEGORIES) return null;
    const byCategory = new Map<string, Stream[]>();
    for (const stream of all.streams) {
      const group = byCategory.get(stream.category);
      if (group) group.push(stream);
      else byCategory.set(stream.category, [stream]);
    }
    return categories
      .filter((name) => name !== ALL_CATEGORIES)
      .map((name) => ({ name, streams: byCategory.get(name) ?? [] }));
  }, [all.streams, category, categories]);

  return (
    <main className="home-main">
      <section className="stream-section">
        <div className="stream-section-head">
          <h2 className="stream-section-title">おすすめ配信</h2>
        </div>
        <RecommendedMarquee
          streams={recommended.streams}
          state={recommended.state}
          errorMessage="おすすめ配信を読み込めませんでした。時間をおいて再読み込みしてください。"
          emptyMessage="いまおすすめできる配信はありません。下の配信一覧から探せます。"
        />
      </section>

      {all.state === "ready" && <ChannelRankingSection streams={all.streams} />}

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
        {all.state === "ready" && groupedStreams ? (
          <div className="stream-group-list">
            {groupedStreams.map((group) => (
              <div className="stream-group" key={group.name}>
                <div className="stream-group-head">
                  <h3 className="stream-group-title">{group.name}</h3>
                  <span className="stream-group-count">{group.streams.length}件</span>
                </div>
                <StreamGrid
                  className="stream-grid"
                  streams={group.streams}
                  state={all.state}
                  errorMessage="配信一覧を読み込めませんでした。時間をおいて再読み込みしてください。"
                  emptyMessage="このカテゴリの配信はまだありません。"
                />
              </div>
            ))}
          </div>
        ) : (
          <StreamGrid
            className="stream-grid"
            streams={visibleStreams}
            state={all.state}
            errorMessage="配信一覧を読み込めませんでした。時間をおいて再読み込みしてください。"
            emptyMessage="いま配信中の番組はありません。"
          />
        )}
      </section>

      {all.state === "ready" && <TodaysPickSection streams={all.streams} />}
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
