import { useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { HashRouter, useLocation, useNavigate } from "react-router-dom";
import {
  addPlayerAlias,
  db,
  deleteGame,
  findImageDuplicate,
  getSavedGames,
  mergePlayers,
  renamePlayer,
  saveDraft,
  toggleSettlement,
} from "../db/database";
import { clearAllData, downloadBackup, downloadCsv, importBackup } from "../db/backup";
import { calculateBalances, calculateTransfers } from "../lib/settlement";
import { detectDates, reconstructText } from "../lib/ocrPostprocess";
// Original: import { inferWinnerNames, parseOcrText, stableRoundKey, validateRound } from "../lib/parser";
import {
  canonicalizeRoundPlayerNames,
  inferWinnerNames,
  parseOcrText,
  stableRoundKey,
  validateRound,
} from "../lib/parser";
import { createId, formatWon, localDate, sha256 } from "../lib/utils";
import type { EditableRound, Player, PlayerAlias, SavedGame } from "../types";
// Original OCR import: import { TesseractOcrEngine } from "../workers/ocrEngine";
import { PaddleOcrEngine } from "../workers/ocrEngine";

type Screen = "dashboard" | "new" | "history" | "players" | "data";
type ImageItem = { file: File; hash: string; preview: string; duplicate: string | null };

const NAV: Array<{ id: Screen; label: string; glyph: string }> = [
  { id: "dashboard", label: "누적", glyph: "◫" },
  { id: "new", label: "새 게임", glyph: "＋" },
  { id: "history", label: "기록", glyph: "≡" },
  { id: "players", label: "참가자", glyph: "♙" },
  { id: "data", label: "보관함", glyph: "◇" },
];

const SAMPLE_TEXT = `명수 / 지원 인후 -400
명수 / 인후 지원 -800
지원 / 인후 명수 -2000
인후 / 명수 -8800 지원 -2200`;

function useAppData() {
  const [games, setGames] = useState<SavedGame[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [aliases, setAliases] = useState<PlayerAlias[]>([]);
  const [error, setError] = useState<string | null>(null);
  const refresh = async () => {
    try {
      await db.open();
      const [gameRows, playerRows, aliasRows] = await Promise.all([
        getSavedGames(),
        // `name` is display text rather than an IndexedDB index; sort in memory.
        db.players.toArray().then((rows) => rows.sort((a, b) => a.name.localeCompare(b.name, "ko-KR"))),
        db.playerAliases.toArray(),
      ]);
      setGames(gameRows);
      setPlayers(playerRows);
      setAliases(aliasRows);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "로컬 데이터베이스를 열지 못했습니다.");
    }
  };
  useEffect(() => {
    void refresh();
  }, []);
  return { games, players, aliases, error, refresh };
}

function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const data = useAppData();
  const current = (location.pathname.slice(1) || "dashboard") as Screen;
  const [editing, setEditing] = useState<SavedGame | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [dark, setDark] = useState(() => localStorage.getItem("go-stop-theme") === "dark");

  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    localStorage.setItem("go-stop-theme", dark ? "dark" : "light");
  }, [dark]);

  const notify = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), 2600);
  };
  const openEdit = (game: SavedGame) => {
    setEditing(game);
    navigate("/new");
  };
  const go = (screen: Screen) => {
    if (screen !== "new") setEditing(null);
    navigate(`/${screen}`);
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="brand" onClick={() => go("dashboard")} aria-label="누적 대시보드로 이동">
          <span className="brand-mark" aria-hidden="true">고</span>
          <span>
            <strong>고스톱 장부</strong>
            <small>기기 안에서만 정산</small>
          </span>
        </button>
        <button className="icon-button" onClick={() => setDark((value) => !value)} aria-label="화면 테마 전환">
          {dark ? "☀" : "◐"}
        </button>
      </header>

      {data.error && <div className="fatal-banner" role="alert">저장소 오류: {data.error} · 브라우저 저장 공간을 확인해 주세요.</div>}

      <main className="main-content">
        {current === "dashboard" && <Dashboard games={data.games} players={data.players} onNew={() => go("new")} />}
        {current === "new" && (
          <NewGame
            key={editing?.game.id ?? "new"}
            existing={editing}
            playerNames={data.players.map((player) => player.name)}
            onSaved={async () => {
              await data.refresh();
              setEditing(null);
              notify("게임을 안전하게 저장했습니다.");
              navigate("/history");
            }}
          />
        )}
        {current === "history" && (
          <History
            games={data.games}
            onEdit={openEdit}
            onChange={data.refresh}
            notify={notify}
          />
        )}
        {current === "players" && (
          <Players players={data.players} aliases={data.aliases} games={data.games} onChange={data.refresh} notify={notify} />
        )}
        {current === "data" && <DataRoom onChange={data.refresh} notify={notify} />}
      </main>

      <nav className="bottom-nav" aria-label="주요 메뉴">
        {NAV.map((item) => (
          <button key={item.id} className={current === item.id ? "active" : ""} onClick={() => go(item.id)}>
            <span aria-hidden="true">{item.glyph}</span>
            {item.label}
          </button>
        ))}
      </nav>
      {toast && <div className="toast" role="status">{toast}</div>}
    </div>
  );
}

function Dashboard({ games, players, onNew }: { games: SavedGame[]; players: Player[]; onNew: () => void }) {
  const ranking = useMemo(() => {
    const map = new Map<string, { id: string; name: string; balance: number; games: number; wins: number; losses: number; zero: number; best: number; worst: number; recent: string }>();
    for (const game of games) {
      for (const balance of game.balances) {
        const current = map.get(balance.playerId) ?? {
          id: balance.playerId, name: balance.playerName, balance: 0, games: 0, wins: 0, losses: 0, zero: 0, best: 0, worst: 0, recent: "",
        };
        current.balance += balance.balance;
        current.games += 1;
        if (balance.balance > 0) current.wins += 1;
        else if (balance.balance < 0) current.losses += 1;
        else current.zero += 1;
        current.best = Math.max(current.best, balance.balance);
        current.worst = Math.min(current.worst, balance.balance);
        if (game.game.playedAt > current.recent) current.recent = game.game.playedAt;
        map.set(balance.playerId, current);
      }
    }
    return [...map.values()].sort((a, b) => b.balance - a.balance || a.id.localeCompare(b.id));
  }, [games]);
  const totalRounds = games.reduce((sum, game) => sum + game.rounds.length, 0);
  const mostActive = [...ranking].sort((a, b) => b.games - a.games || a.name.localeCompare(b.name))[0];

  return (
    <section className="page dashboard-page">
      <div className="hero-card">
        <div>
          <span className="eyebrow">우리끼리 쓰는 정산 기록</span>
          <h1>이번 판도<br /><em>깔끔하게 끝.</em></h1>
          <p>사진은 밖으로 나가지 않아요. 카톡 캡처를 올리고, 추출된 금액만 확인하세요.</p>
        </div>
        <button className="primary hero-action" onClick={onNew}>새 게임 정산 <span>→</span></button>
      </div>
      <div className="stat-grid">
        <article><small>모든 게임</small><strong>{games.length}</strong><span>games</span></article>
        <article><small>기록한 판</small><strong>{totalRounds}</strong><span>rounds</span></article>
        <article><small>함께한 사람</small><strong>{players.length}</strong><span>players</span></article>
      </div>
      <div className="section-heading">
        <div><span className="eyebrow">전체 누적</span><h2>손익 순위</h2></div>
        {mostActive && <span className="soft-badge">최다 참여 · {mostActive.name} {mostActive.games}회</span>}
      </div>
      {ranking.length === 0 ? (
        <EmptyState icon="♧" title="첫 게임을 기록해 보세요" body="OCR 없이 판을 직접 입력하는 것도 가능합니다." action="새 게임 만들기" onAction={onNew} />
      ) : (
        <div className="ranking-list">
          {ranking.map((item, index) => (
            <article key={item.id} className="ranking-row">
              <span className={`rank rank-${index + 1}`}>{index + 1}</span>
              <div className="avatar">{item.name.slice(0, 1)}</div>
              <div className="ranking-person">
                <strong>{item.name}</strong>
                <small>{item.games}게임 · 최근 {item.recent}</small>
              </div>
              <div className={`money ${item.balance >= 0 ? "positive" : "negative"}`}>{formatWon(item.balance)}</div>
            </article>
          ))}
        </div>
      )}
      {ranking[0] && (
        <div className="insight-strip">
          <span>오늘의 기록</span>
          <strong>누적 1위 {ranking[0].name}</strong>
          <span>{formatWon(ranking[0].balance)} · 최고 하루 {formatWon(ranking[0].best)}</span>
        </div>
      )}
    </section>
  );
}

function NewGame({
  existing,
  playerNames,
  onSaved,
}: {
  existing: SavedGame | null;
  playerNames: string[];
  onSaved: () => Promise<void>;
}) {
  const initialRounds: EditableRound[] =
    existing?.rounds.map((round) => ({
      id: round.id,
      winnerName: round.winnerName,
      losers: round.losses.map((loss) => ({ name: loss.playerName, amount: loss.amount })),
      rawText: round.rawText,
      normalizedText: round.rawText,
      confidence: round.confidence,
      warning: round.warning,
      warningConfirmed: round.warningConfirmed,
      sourceImageHash: round.sourceImageHash,
      sourceImageIndex: round.sourceImageIndex,
      duplicateConfirmed: round.duplicateConfirmed,
    })) ?? [];
  const [date, setDate] = useState(existing?.game.playedAt ?? localDate());
  const [title, setTitle] = useState(existing?.game.title ?? "");
  const [memo, setMemo] = useState(existing?.game.memo ?? "");
  const [images, setImages] = useState<ImageItem[]>([]);
  const [rounds, setRounds] = useState<EditableRound[]>(initialRounds);
  const [progress, setProgress] = useState<{ active: boolean; label: string; value: number }>({ active: false, label: "", value: 0 });
  const [message, setMessage] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const knownImages = existing?.images.map((image) => ({ hash: image.sha256, name: image.originalName })) ?? [];

  useEffect(() => () => images.forEach((image) => URL.revokeObjectURL(image.preview)), [images]);

  const selectImages = async (event: ChangeEvent<HTMLInputElement>) => {
    const incoming = [...(event.target.files ?? [])];
    event.target.value = "";
    if (images.length + incoming.length > 10) return setMessage("이미지는 최대 10장까지 선택할 수 있습니다.");
    const accepted: ImageItem[] = [];
    for (const file of incoming) {
      try {
        if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) throw new Error("JPG, PNG, WEBP만 지원합니다.");
        if (file.size > 10 * 1024 * 1024) throw new Error("이미지 한 장은 10MB 이하여야 합니다.");
        const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
        if (bitmap.width * bitmap.height > 25_000_000) {
          bitmap.close();
          throw new Error("이미지 해상도가 2,500만 픽셀을 넘습니다.");
        }
        bitmap.close();
        const hash = await sha256(file);
        if ([...images, ...accepted].some((item) => item.hash === hash)) throw new Error("같은 이미지를 이미 선택했습니다.");
        const duplicate = await findImageDuplicate(hash);
        accepted.push({
          file,
          hash,
          preview: URL.createObjectURL(file),
          duplicate: duplicate?.game ? `${duplicate.game.playedAt} · ${duplicate.game.title || "제목 없는 게임"}에 사용됨` : null,
        });
      } catch (reason) {
        setMessage(`${file.name}: ${reason instanceof Error ? reason.message : "이미지를 읽지 못했습니다."}`);
      }
    }
    setImages((current) => [...current, ...accepted]);
  };

  const moveImage = (index: number, direction: -1 | 1) => {
    setImages((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const removeImage = (index: number) => {
    setImages((current) => {
      URL.revokeObjectURL(current[index].preview);
      return current.filter((_, itemIndex) => itemIndex !== index);
    });
  };

  const markDuplicates = (items: EditableRound[]) => {
    const count = new Map<string, number>();
    return items.map((round) => {
      const key = stableRoundKey(round);
      const seen = count.get(key) ?? 0;
      count.set(key, seen + 1);
      return seen > 0
        ? { ...round, warning: round.warning ?? "다른 이미지와 겹치는 중복 판일 수 있습니다.", warningConfirmed: false }
        : round;
    });
  };

  const runOcr = async () => {
    if (!images.length) return setMessage("먼저 카카오톡 스크린샷을 선택해 주세요.");
    const controller = new AbortController();
    abortRef.current = controller;
    // Original OCR engine: const engine = new TesseractOcrEngine();
    const engine = new PaddleOcrEngine();
    const parsed: EditableRound[] = [];
    const recognizedImages: Array<{
      text: string;
      confidence: number;
      sourceImageHash: string;
      sourceImageIndex: number;
    }> = [];
    const dates = new Set<string>();
    setProgress({ active: true, label: "한국어 OCR 모델을 준비하는 중", value: 0 });
    setMessage(null);
    try {
      await engine.initialize(({ status, progress: value }) => setProgress({ active: true, label: status, value: value * 0.15 }));
      for (const [index, image] of images.entries()) {
        setProgress({ active: true, label: `${index + 1}/${images.length} 이미지 인식 중`, value: index / images.length });
        try {
          const result = await engine.recognize(image.file, controller.signal);
          const text = result.tokens.length ? reconstructText(result.tokens) : result.text;
          detectDates(text).forEach((value) => dates.add(value));
          // Original: parsed.push(...parseOcrText(text, { confidence: result.confidence, sourceImageHash: image.hash, sourceImageIndex: index }));
          recognizedImages.push({
            text,
            confidence: result.confidence,
            sourceImageHash: image.hash,
            sourceImageIndex: index,
          });
        } catch (reason) {
          if (reason instanceof DOMException && reason.name === "AbortError") throw reason;
          setMessage(`${image.file.name} 인식에 실패했습니다. 다른 이미지는 계속 처리했습니다.`);
        }
      }
      const knownPlayerNames = [
        ...playerNames,
        ...recognizedImages.flatMap(({ text }) => inferWinnerNames(text)),
      ];
      for (const recognized of recognizedImages) {
        parsed.push(...parseOcrText(recognized.text, {
          confidence: recognized.confidence,
          sourceImageHash: recognized.sourceImageHash,
          sourceImageIndex: recognized.sourceImageIndex,
          knownPlayerNames,
        }));
      }
      const canonicalized = canonicalizeRoundPlayerNames(parsed, playerNames);
      if (dates.size === 1) setDate([...dates][0]);
      if (dates.size > 1) setMessage(`서로 다른 날짜(${[...dates].join(", ")})가 감지되었습니다. 날짜를 확인해 주세요.`);
      if (!parsed.length) setMessage("정산 형식의 문장을 찾지 못했습니다. 판을 직접 추가하거나 이미지를 바꿔 보세요.");
      if (canonicalized.corrections.length && dates.size <= 1) {
        setMessage(
          `OCR 이름 보정: ${canonicalized.corrections.map(({ from, to }) => `${from} → ${to}`).join(", ")}. 판을 확인해 주세요.`,
        );
      }
      // Original: setRounds((current) => markDuplicates([...current, ...parsed]));
      setRounds((current) => markDuplicates([...current, ...canonicalized.rounds]));
    } catch (reason) {
      // Original: setMessage(reason instanceof DOMException && reason.name === "AbortError" ? "OCR을 취소했습니다." : "OCR 처리 중 문제가 생겼습니다.");
      console.error("OCR processing failed.", reason);
      setMessage(
        reason instanceof DOMException && reason.name === "AbortError"
          ? "OCR을 취소했습니다."
          : `OCR 처리 중 문제가 생겼습니다: ${reason instanceof Error ? reason.message : String(reason)}`,
      );
    } finally {
      await engine.terminate();
      setProgress({ active: false, label: "", value: 0 });
      abortRef.current = null;
    }
  };

  const addSample = () => {
    setMessage(null);
    setRounds(markDuplicates([...rounds, ...parseOcrText(SAMPLE_TEXT)]));
  };
  const addRound = () =>
    setRounds((current) => [
      ...current,
      {
        id: createId(), winnerName: "", losers: [{ name: "", amount: 0 }], rawText: "직접 추가한 판", normalizedText: "",
        confidence: 1, warning: null, warningConfirmed: true, sourceImageHash: "", sourceImageIndex: 0, duplicateConfirmed: false,
      },
    ]);

  const updateRound = (id: string, updater: (round: EditableRound) => EditableRound) =>
    setRounds((current) => current.map((round) => (round.id === id ? updater(round) : round)));

  const save = async () => {
    const error = rounds.map(validateRound).find(Boolean);
    if (!date) return setMessage("게임 날짜를 입력해 주세요.");
    if (!rounds.length) return setMessage("한 판 이상 입력해 주세요.");
    if (!existing && !images.length) return setMessage("스크린샷을 한 장 이상 선택해 주세요.");
    if (error) return setMessage(error);
    setMessage("로컬 장부에 저장하는 중…");
    try {
      const balanceMap = calculateBalances(rounds);
      if ([...balanceMap.values()].reduce((sum, value) => sum + value, 0) !== 0) throw new Error("손익 합계가 0원이 아닙니다.");
      await saveDraft({
        id: existing?.game.id,
        playedAt: date,
        title,
        memo,
        rounds,
        images: [...knownImages, ...images.map((image) => ({ hash: image.hash, name: image.file.name }))],
      });
      await onSaved();
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : "저장하지 못했습니다.");
    }
  };

  const previewBalances = calculateBalances(rounds.filter((round) => !validateRound({ ...round, warning: null })));
  const previewTransfers =
    previewBalances.size && [...previewBalances.values()].reduce((sum, value) => sum + value, 0) === 0
      ? calculateTransfers([...previewBalances].map(([name, balance]) => ({ id: name, name, balance })))
      : [];

  return (
    <section className="page new-page">
      <div className="page-title">
        <span className="eyebrow">{existing ? "기록 다시 보기" : "새로운 정산"}</span>
        <h1>{existing ? "게임을 수정해요" : "캡처부터 정산까지"}</h1>
        <p>이미지는 저장하지 않고, 판 기록만 이 브라우저에 남깁니다.</p>
      </div>

      <div className="form-card step-card">
        <div className="step-number">01</div>
        <div className="card-title"><div><h2>게임 정보</h2><p>날짜만 필수예요.</p></div></div>
        <div className="form-grid">
          <label>날짜<input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
          <label>제목 <span>선택</span><input maxLength={80} value={title} onChange={(event) => setTitle(event.target.value)} placeholder="예: 명수네 집" /></label>
          <label className="full">메모 <span>선택</span><textarea maxLength={500} value={memo} onChange={(event) => setMemo(event.target.value)} placeholder="특이사항을 남겨두세요." /></label>
        </div>
      </div>

      <div className="form-card step-card">
        <div className="step-number">02</div>
        <div className="card-title"><div><h2>카톡 캡처</h2><p>최대 10장 · 장당 10MB</p></div><span className="privacy-chip">외부 전송 없음</span></div>
        <label className="upload-zone">
          <input type="file" accept="image/jpeg,image/png,image/webp" multiple capture="environment" onChange={selectImages} />
          <span className="upload-icon">＋</span>
          <strong>스크린샷 선택 또는 촬영</strong>
          <small>JPG · PNG · WEBP</small>
        </label>
        {images.length > 0 && (
          <div className="image-strip">
            {images.map((image, index) => (
              <article key={image.hash} className="image-thumb">
                <img src={image.preview} alt={`${index + 1}번째 선택 이미지`} />
                <span>{index + 1}</span>
                <div className="thumb-actions">
                  <button onClick={() => moveImage(index, -1)} disabled={index === 0} aria-label="앞으로 이동">‹</button>
                  <button onClick={() => moveImage(index, 1)} disabled={index === images.length - 1} aria-label="뒤로 이동">›</button>
                  <button onClick={() => removeImage(index)} aria-label="이미지 제거">×</button>
                </div>
                {image.duplicate && <small className="duplicate-note">{image.duplicate}</small>}
              </article>
            ))}
          </div>
        )}
        <div className="button-row">
          <button className="primary" onClick={runOcr} disabled={progress.active || !images.length}>사진에서 판 추출하기</button>
          <button className="secondary" onClick={addSample}>샘플로 체험</button>
          {progress.active && <button className="danger-link" onClick={() => abortRef.current?.abort()}>취소</button>}
        </div>
        {progress.active && (
          <div className="progress-wrap" role="status">
            <div><span>{progress.label}</span><strong>{Math.round(progress.value * 100)}%</strong></div>
            <progress max="1" value={progress.value} />
            <small>첫 실행은 한국어 모델 다운로드로 시간이 걸릴 수 있어요.</small>
          </div>
        )}
      </div>

      <div className="form-card step-card">
        <div className="step-number">03</div>
        <div className="card-title">
          <div><h2>판 검토</h2><p>승자와 금액을 한 번만 확인하세요.</p></div>
          <button className="secondary compact" onClick={addRound}>판 직접 추가</button>
        </div>
        {rounds.length === 0 ? (
          <div className="review-empty"><span>◎</span><strong>아직 추출된 판이 없어요</strong><p>사진을 인식하거나 직접 판을 추가해 주세요.</p></div>
        ) : (
          <div className="round-list">
            {rounds.map((round, roundIndex) => (
              <article className={`round-card ${round.warning && !round.warningConfirmed ? "has-warning" : ""}`} key={round.id}>
                <div className="round-head">
                  <span className="round-index">{String(roundIndex + 1).padStart(2, "0")}판</span>
                  <div className="round-order">
                    <button disabled={roundIndex === 0} onClick={() => setRounds((current) => {
                      const next = [...current]; [next[roundIndex - 1], next[roundIndex]] = [next[roundIndex], next[roundIndex - 1]]; return next;
                    })}>↑</button>
                    <button disabled={roundIndex === rounds.length - 1} onClick={() => setRounds((current) => {
                      const next = [...current]; [next[roundIndex + 1], next[roundIndex]] = [next[roundIndex], next[roundIndex + 1]]; return next;
                    })}>↓</button>
                    <button onClick={() => setRounds((current) => current.filter((item) => item.id !== round.id))}>삭제</button>
                  </div>
                </div>
                <label>승자<input list="players" value={round.winnerName} onChange={(event) => updateRound(round.id, (item) => ({ ...item, winnerName: event.target.value }))} placeholder="이름" /></label>
                <div className="loss-list">
                  <span className="field-label">패자와 잃은 금액</span>
                  {round.losers.map((loss, lossIndex) => (
                    <div className="loss-row" key={`${round.id}-${lossIndex}`}>
                      <input aria-label={`${roundIndex + 1}판 ${lossIndex + 1}번째 패자`} list="players" value={loss.name} onChange={(event) => updateRound(round.id, (item) => ({
                        ...item, losers: item.losers.map((entry, index) => index === lossIndex ? { ...entry, name: event.target.value } : entry),
                      }))} placeholder="이름" />
                      <div className="amount-input"><input aria-label={`${roundIndex + 1}판 ${lossIndex + 1}번째 금액`} type="number" min="1" step="100" value={loss.amount || ""} onChange={(event) => updateRound(round.id, (item) => ({
                        ...item, losers: item.losers.map((entry, index) => index === lossIndex ? { ...entry, amount: Number(event.target.value) } : entry),
                      }))} placeholder="0" /><span>원</span></div>
                      <button className="remove-loss" onClick={() => updateRound(round.id, (item) => ({ ...item, losers: item.losers.filter((_, index) => index !== lossIndex) }))} aria-label="패자 삭제">×</button>
                    </div>
                  ))}
                  <button className="add-loss" onClick={() => updateRound(round.id, (item) => ({ ...item, losers: [...item.losers, { name: "", amount: 0 }] }))}>＋ 패자 추가</button>
                </div>
                <details>
                  <summary>OCR 원문 · {Math.round(round.confidence * 100)}%</summary>
                  <p>{round.rawText}</p>
                  <small>{round.normalizedText}</small>
                </details>
                {round.warning && (
                  <label className="warning-box">
                    <input type="checkbox" checked={round.warningConfirmed} onChange={(event) => updateRound(round.id, (item) => ({
                      ...item, warningConfirmed: event.target.checked, duplicateConfirmed: item.warning?.includes("중복") ? event.target.checked : item.duplicateConfirmed,
                    }))} />
                    <span><strong>확인이 필요해요</strong>{round.warning}</span>
                  </label>
                )}
                {validateRound(round) && <p className="field-error">{validateRound(round)}</p>}
              </article>
            ))}
          </div>
        )}
        <datalist id="players">{playerNames.map((name) => <option key={name} value={name} />)}</datalist>
      </div>

      {rounds.length > 0 && (
        <div className="result-preview">
          <div className="card-title"><div><span className="eyebrow">미리 계산</span><h2>현재 정산</h2></div><span>{rounds.length}판</span></div>
          <div className="balance-preview">
            {[...previewBalances].sort((a, b) => b[1] - a[1]).map(([name, balance]) => (
              <div key={name}><span>{name}</span><strong className={balance >= 0 ? "positive" : "negative"}>{formatWon(balance)}</strong></div>
            ))}
          </div>
          {previewTransfers.length > 0 && (
            <div className="transfer-preview">
              {previewTransfers.map((transfer) => (
                <div key={`${transfer.fromId}-${transfer.toId}`}>
                  <strong>{transfer.fromName}</strong><span>→</span><strong>{transfer.toName}</strong><em>{formatWon(transfer.amount, false)}</em>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      {message && <div className="inline-message" role="alert">{message}</div>}
      <div className="sticky-save">
        <div><small>이미지 {images.length || knownImages.length}장 · {rounds.length}판</small><strong>{date}</strong></div>
        <button className="primary" onClick={save}>{existing ? "수정 내용 저장" : "게임 저장하기"}</button>
      </div>
    </section>
  );
}

function History({
  games,
  onEdit,
  onChange,
  notify,
}: {
  games: SavedGame[];
  onEdit: (game: SavedGame) => void;
  onChange: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [player, setPlayer] = useState("");
  const [openId, setOpenId] = useState<string | null>(games[0]?.game.id ?? null);
  const playerOptions = [...new Set(games.flatMap((game) => game.balances.map((balance) => balance.playerName)))].sort();
  const filtered = games.filter((game) => {
    const hasText = `${game.game.title} ${game.game.playedAt}`.toLocaleLowerCase().includes(query.toLocaleLowerCase());
    return hasText && (!player || game.balances.some((balance) => balance.playerName === player));
  });

  const copyResult = async (game: SavedGame) => {
    const balances = [...game.balances].sort((a, b) => b.balance - a.balance).map((item) => `${item.playerName}: ${formatWon(item.balance)}`).join("\n");
    const transfers = game.settlements.map((item) => `${item.fromName} → ${item.toName}: ${formatWon(item.amount, false)}`).join("\n");
    await navigator.clipboard.writeText(`[고스톱 최종 정산]\n${game.game.playedAt}${game.game.title ? ` · ${game.game.title}` : ""}\n\n${balances}\n\n[송금]\n${transfers || "송금 없음"}`);
    notify("정산 결과를 복사했습니다.");
  };

  return (
    <section className="page">
      <div className="page-title"><span className="eyebrow">날짜별 장부</span><h1>게임 기록</h1><p>수정하면 누적 손익도 자동으로 다시 계산됩니다.</p></div>
      <div className="filter-bar">
        <input aria-label="제목 또는 날짜 검색" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="제목이나 날짜 검색" />
        <select aria-label="참가자 필터" value={player} onChange={(event) => setPlayer(event.target.value)}>
          <option value="">모든 참가자</option>{playerOptions.map((name) => <option key={name}>{name}</option>)}
        </select>
      </div>
      {filtered.length === 0 ? (
        <EmptyState icon="□" title="저장된 게임이 없어요" body="새 게임을 정산하면 날짜별로 이곳에 쌓입니다." />
      ) : (
        <div className="game-list">
          {filtered.map((saved) => {
            const leader = [...saved.balances].sort((a, b) => b.balance - a.balance)[0];
            const open = openId === saved.game.id;
            return (
              <article className="game-card" key={saved.game.id}>
                <button className="game-summary" onClick={() => setOpenId(open ? null : saved.game.id)} aria-expanded={open}>
                  <div className="date-block"><strong>{saved.game.playedAt.slice(8)}</strong><span>{saved.game.playedAt.slice(0, 7)}</span></div>
                  <div><strong>{saved.game.title || "제목 없는 게임"}</strong><small>{saved.rounds.length}판 · {saved.balances.length}명</small></div>
                  <div className="game-winner"><small>1위 {leader?.playerName}</small><strong>{leader ? formatWon(leader.balance) : "0원"}</strong></div>
                  <span>{open ? "⌃" : "⌄"}</span>
                </button>
                {open && (
                  <div className="game-detail">
                    {saved.game.memo && <p className="memo">{saved.game.memo}</p>}
                    <div className="detail-grid">
                      <div><h3>손익</h3>{[...saved.balances].sort((a, b) => b.balance - a.balance).map((balance) => (
                        <p key={balance.id}><span>{balance.playerName}</span><strong className={balance.balance >= 0 ? "positive" : "negative"}>{formatWon(balance.balance)}</strong></p>
                      ))}</div>
                      <div><h3>정산 송금 목록</h3>{saved.settlements.length ? saved.settlements.map((item) => (
                        <label className="settlement-check" key={item.id}>
                          <input type="checkbox" checked={item.isPaid} onChange={async (event) => {
                            await toggleSettlement(item.id, event.target.checked); await onChange();
                          }} />
                          <span><strong>{item.fromName} → {item.toName}</strong>{formatWon(item.amount, false)}</span>
                        </label>
                      )) : <p>송금할 금액이 없습니다.</p>}</div>
                    </div>
                    <details className="round-history"><summary>판 기록 {saved.rounds.length}개 보기</summary>{saved.rounds.map((round) => (
                      <p key={round.id}><span>{round.sequence + 1}판 · {round.winnerName} 승</span><small>{round.losses.map((loss) => `${loss.playerName} -${loss.amount.toLocaleString("ko-KR")}`).join(" · ")}</small></p>
                    ))}</details>
                    <div className="button-row">
                      <button className="primary compact" onClick={() => copyResult(saved)}>결과 복사</button>
                      <button className="secondary compact" onClick={() => onEdit(saved)}>수정</button>
                      <button className="danger-link" onClick={async () => {
                        if (!confirm(`${saved.game.playedAt} 게임을 삭제할까요? 되돌릴 수 없습니다.`)) return;
                        await deleteGame(saved.game.id); await onChange(); notify("게임을 삭제했습니다.");
                      }}>삭제</button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Players({
  players,
  aliases,
  games,
  onChange,
  notify,
}: {
  players: Player[];
  aliases: PlayerAlias[];
  games: SavedGame[];
  onChange: () => Promise<void>;
  notify: (message: string) => void;
}) {
  const totals = new Map<string, number>();
  games.forEach((game) => game.balances.forEach((balance) => totals.set(balance.playerId, (totals.get(balance.playerId) ?? 0) + balance.balance)));
  return (
    <section className="page">
      <div className="page-title"><span className="eyebrow">이름을 한 사람으로</span><h1>참가자와 별칭</h1><p>“인후”, “이누”, “inu”처럼 다르게 적힌 이름을 정리하세요.</p></div>
      {players.length === 0 ? <EmptyState icon="♙" title="아직 참가자가 없어요" body="게임을 저장하면 참가자가 자동으로 만들어집니다." /> : (
        <div className="player-grid">
          {players.map((player) => {
            const playerAliases = aliases.filter((alias) => alias.playerId === player.id);
            return (
              <article className="player-card" key={player.id}>
                <div className="player-head"><span className="avatar large">{player.name.slice(0, 1)}</span><div><strong>{player.name}</strong><small>{games.filter((game) => game.balances.some((balance) => balance.playerId === player.id)).length}게임</small></div><em className={(totals.get(player.id) ?? 0) >= 0 ? "positive" : "negative"}>{formatWon(totals.get(player.id) ?? 0)}</em></div>
                <div className="alias-list"><span>별칭</span>{playerAliases.length ? playerAliases.map((alias) => <small key={alias.id}>{alias.alias}</small>) : <small>등록 없음</small>}</div>
                <div className="player-actions">
                  <button onClick={async () => {
                    const name = prompt("새 대표 이름", player.name); if (!name) return;
                    try { await renamePlayer(player.id, name); await onChange(); notify("대표 이름을 바꿨습니다."); } catch (reason) { notify(reason instanceof Error ? reason.message : "이름을 바꾸지 못했습니다."); }
                  }}>이름 수정</button>
                  <button onClick={async () => {
                    const alias = prompt(`${player.name}의 별칭`); if (!alias) return;
                    try { await addPlayerAlias(player.id, alias); await onChange(); notify("별칭을 추가했습니다."); } catch (reason) { notify(reason instanceof Error ? reason.message : "별칭을 추가하지 못했습니다."); }
                  }}>별칭 추가</button>
                  {players.length > 1 && <button onClick={async () => {
                    const targetName = prompt(`"${player.name}"을 누구에게 합칠까요?\n${players.filter((item) => item.id !== player.id).map((item) => item.name).join(", ")}`);
                    const target = players.find((item) => item.name === targetName); if (!target) return;
                    if (!confirm(`${player.name}의 모든 기록을 ${target.name}(으)로 합칠까요?`)) return;
                    try { await mergePlayers(player.id, target.id); await onChange(); notify("참가자를 합쳤습니다."); } catch (reason) { notify(reason instanceof Error ? reason.message : "참가자를 합치지 못했습니다."); }
                  }}>합치기</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

function DataRoom({ onChange, notify }: { onChange: () => Promise<void>; notify: (message: string) => void }) {
  const importInput = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<"merge" | "replace">("merge");
  const handleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ""; if (!file) return;
    if (mode === "replace" && (!confirm("현재 데이터를 모두 지우고 백업으로 바꿀까요?") || !confirm("정말 덮어쓸까요? 되돌릴 수 없습니다."))) return;
    try { await importBackup(file, mode); await onChange(); notify("백업을 안전하게 복원했습니다."); }
    catch (reason) { notify(reason instanceof Error ? reason.message : "백업을 복원하지 못했습니다."); }
  };
  return (
    <section className="page">
      <div className="page-title"><span className="eyebrow">내 데이터 관리</span><h1>보관함</h1><p>기기 변경이나 브라우저 데이터 삭제 전에 꼭 백업하세요.</p></div>
      <div className="local-warning"><span>!</span><div><strong>기록은 이 브라우저에만 저장됩니다.</strong><p>기기 간 자동 동기화는 없습니다. JSON 파일을 안전한 곳에 보관하세요.</p></div></div>
      <div className="data-grid">
        <article className="data-card"><span className="data-icon">↓</span><div><h2>JSON 백업</h2><p>참가자, 게임, 판, 송금 완료 상태를 모두 저장합니다. 원본 이미지는 포함하지 않습니다.</p></div><button className="primary" onClick={() => void downloadBackup()}>백업 파일 받기</button></article>
        <article className="data-card"><span className="data-icon">↑</span><div><h2>JSON 복원</h2><p>기존 기록에 합치거나, 백업 내용으로 완전히 교체할 수 있습니다.</p></div><div className="import-actions"><select value={mode} onChange={(event) => setMode(event.target.value as "merge" | "replace")}><option value="merge">기존 기록과 합치기</option><option value="replace">전체 교체</option></select><button className="secondary" onClick={() => importInput.current?.click()}>백업 선택</button><input ref={importInput} hidden type="file" accept="application/json,.json" onChange={handleImport} /></div></article>
        <article className="data-card"><span className="data-icon">▦</span><div><h2>CSV 내보내기</h2><p>날짜·제목·참가자별 손익을 한글이 깨지지 않는 표 파일로 저장합니다.</p></div><button className="secondary" onClick={() => void downloadCsv()}>CSV 파일 받기</button></article>
      </div>
      <div className="privacy-card"><span className="eyebrow">개인정보 안내</span><h2>사진과 기록은 밖으로 나가지 않아요.</h2><p>OCR, 파싱, 저장, 통계 계산은 모두 이 기기 안에서 처리됩니다. 분석 도구·광고·원격 로그를 사용하지 않습니다. OCR 모델은 처음 사용할 때 정적 파일로 내려받아 브라우저 캐시에 저장됩니다.</p><ul><li>브라우저 사이트 데이터를 지우면 기록도 사라질 수 있습니다.</li><li>원본 스크린샷은 게임 저장 후 보관하지 않습니다.</li><li>이 앱은 다른 기기와 자동으로 동기화하지 않습니다.</li></ul></div>
      <div className="danger-zone"><div><strong>모든 로컬 데이터 삭제</strong><p>게임, 참가자, 별칭과 정산 상태를 영구 삭제합니다.</p></div><button className="danger-button" onClick={async () => {
        if (!confirm("모든 로컬 기록을 삭제할까요? JSON 백업이 없다면 복구할 수 없습니다.")) return;
        if (!confirm("마지막 확인입니다. 정말 삭제할까요?")) return;
        await clearAllData(); await onChange(); notify("이 브라우저의 모든 기록을 삭제했습니다.");
      }}>전체 삭제</button></div>
      {/* Original footer: <footer className="app-info"><strong>고스톱 장부 v1.0</strong><span>Tesseract.js 6 · IndexedDB · 오픈소스</span></footer> */}
      <footer className="app-info"><strong>고스톱 장부 v1.1</strong><span>PaddleOCR.js · 한국어 PP-OCRv5 · IndexedDB</span></footer>
    </section>
  );
}

function EmptyState({ icon, title, body, action, onAction }: { icon: string; title: string; body: string; action?: string; onAction?: () => void }) {
  return <div className="empty-state"><span>{icon}</span><strong>{title}</strong><p>{body}</p>{action && <button className="secondary" onClick={onAction}>{action}</button>}</div>;
}

export default function App() {
  return <HashRouter><Shell /></HashRouter>;
}
