import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Check, FileText, LoaderCircle, Pencil, Search } from "lucide-react";
import type { Job, OperationPreview, Track } from "../shared/contracts";
import type {
  AutomaticLyrics,
  LyricsCandidate,
  TrackLyrics,
} from "../shared/lyrics";
import { api, duration } from "./api";
import { Modal } from "./Modal";
import "./styles/lyrics.css";

export function LyricsDialog({
  track,
  onClose,
}: {
  track: Track;
  onClose: () => void;
}) {
  const client = useQueryClient();
  const [text, setText] = useState("");
  const [draft, setDraft] = useState("");
  const [artist, setArtist] = useState(track.artists.join(", "));
  const [title, setTitle] = useState(track.title);
  const [mode, setMode] = useState<"reading" | "search" | "edit">("reading");
  const [results, setResults] = useState<LyricsCandidate[] | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [localSaved, setLocalSaved] = useState(false);
  const [fileSaved, setFileSaved] = useState(false);
  const [preview, setPreview] = useState<OperationPreview | null>(null);
  const [stored, setStored] = useState<TrackLyrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [reload, setReload] = useState(0);
  const controller = useRef(new AbortController());
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    setLoading(true);
    setError("");
    const url = `/tracks/${encodeURIComponent(track.id)}/lyrics`;
    void (async () => {
      try {
        const data = await api<TrackLyrics>(url, undefined, "GET", {
          signal: abort.signal,
        });
        if (abort.signal.aborted) return;
        setStored(data);
        let value = data.local?.trim() ? data.local : data.embedded || "";
        let saved = false;
        if (!value.trim()) {
          setMode("search");
          const automatic = await api<AutomaticLyrics>(
            `${url}/auto`,
            {},
            "POST",
            { signal: abort.signal },
          );
          if (abort.signal.aborted) return;
          value = automatic.text || "";
          saved = automatic.saved;
          if (value && !saved && !data.writable)
            setError("Текст найден, но запись в этот файл недоступна.");
          setResults(automatic.candidates);
          if (!value) setMode("search");
        }
        if (abort.signal.aborted) return;
        setText(value);
        setMode(value ? "reading" : "search");
        setFileSaved(saved);
        setStored(saved ? { ...data, embedded: value } : data);
        if (saved) void client.invalidateQueries();
      } catch (e) {
        if (!abort.signal.aborted)
          setError(
            e instanceof Error ? e.message : "Не удалось получить текст",
          );
      } finally {
        if (!abort.signal.aborted) setLoading(false);
      }
    })();
    return () => abort.abort();
  }, [track.id, reload, client]);
  const loaded = stored !== null && !loading;
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (e) {
      setPreview(null);
      if (!controller.current.signal.aborted)
        setError(
          e instanceof Error ? e.message : "Не удалось выполнить действие",
        );
    } finally {
      setBusy(false);
    }
  }
  function changeText(value: string) {
    setText(value);
    setLocalSaved(false);
    setFileSaved(false);
    setMode("reading");
    setError("");
  }
  const openSearch = () => {
    setMode("search");
    setError("");
  };
  return (
    <>
      <Modal
        title={track.title}
        subtitle={track.artists.join(", ")}
        onClose={onClose}
        className="lyrics-modal"
        closeOnBackdrop
      >
        <div className="lyrics-body" aria-busy={busy || loading}>
          {loading && (
            <LoaderCircle className="spin" aria-label="Загрузка текста" />
          )}
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          {!stored && !loading && error && (
            <button onClick={() => setReload((value) => value + 1)}>
              Повторить
            </button>
          )}
          {loaded &&
            mode === "reading" &&
            (text ? (
              <div className="lyrics-text">{text}</div>
            ) : (
              <button className="lyrics-empty" onClick={openSearch}>
                Найти текст
              </button>
            ))}
          {loaded && mode === "search" && (
            <>
              <form
                className="lyrics-search"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    const candidates = await api<LyricsCandidate[]>(
                      "/lyrics/search",
                      { artist, title },
                      "POST",
                      { signal: controller.current.signal },
                    );
                    setResults(
                      [...candidates].sort(
                        (a, b) =>
                          Number(b.albumName === track.albumTitle) -
                            Number(a.albumName === track.albumTitle) ||
                          Math.abs(a.duration - track.duration) -
                            Math.abs(b.duration - track.duration),
                      ),
                    );
                  });
                }}
              >
                <input
                  aria-label="Исполнитель"
                  placeholder="Исполнитель"
                  value={artist}
                  maxLength={500}
                  required
                  onChange={(e) => setArtist(e.target.value)}
                />
                <input
                  aria-label="Название"
                  placeholder="Название"
                  value={title}
                  maxLength={1000}
                  required
                  onChange={(e) => setTitle(e.target.value)}
                />
                <button
                  className="icon-button"
                  type="submit"
                  title="Найти в LRCLIB"
                  aria-label="Найти в LRCLIB"
                  disabled={busy || !artist.trim() || !title.trim()}
                >
                  <Search size={18} />
                </button>
              </form>
              {results?.length === 0 && <p role="status">Ничего не найдено</p>}
              {results?.map((result) => (
                <button
                  key={result.id}
                  className="lyrics-result"
                  disabled={busy || !result.plainLyrics?.trim()}
                  onClick={() => {
                    const value = result.plainLyrics!;
                    changeText(value);
                    if (
                      !stored?.local?.trim() &&
                      !stored?.embedded?.trim() &&
                      stored?.writable
                    )
                      void run(async () => {
                        const saved = await api<AutomaticLyrics>(
                          `/tracks/${encodeURIComponent(track.id)}/lyrics/fill`,
                          { text: value },
                          "POST",
                          { signal: controller.current.signal },
                        );
                        setText(saved.text || value);
                        setFileSaved(saved.saved);
                        setStored(
                          (current) =>
                            current && { ...current, embedded: saved.text },
                        );
                        await client.invalidateQueries();
                      });
                  }}
                >
                  <span>{result.trackName}</span>
                  <small>
                    {result.artistName} · {result.albumName} ·{" "}
                    {duration(result.duration)}
                    {result.instrumental
                      ? " · Инструментальная"
                      : !result.plainLyrics?.trim()
                        ? " · Без текста"
                        : ""}
                  </small>
                </button>
              ))}
            </>
          )}
          {loaded && mode === "edit" && (
            <textarea
              aria-label="Текст песни"
              value={draft}
              maxLength={100_000}
              autoFocus
              onChange={(e) => setDraft(e.target.value)}
            />
          )}
        </div>
        <div className="lyrics-actions">
          {mode === "edit" ? (
            <>
              <button disabled={busy} onClick={() => setMode("reading")}>
                Отмена
              </button>
              <button
                className="primary"
                disabled={!draft.trim()}
                onClick={() => changeText(draft)}
              >
                Готово
              </button>
            </>
          ) : (
            <>
              <button
                className="icon-button"
                title="Найти другой текст"
                aria-label="Найти другой текст"
                disabled={busy || !loaded}
                onClick={openSearch}
              >
                <Search size={18} />
              </button>
              <button
                className="icon-button"
                title="Редактировать текст"
                aria-label="Редактировать текст"
                disabled={busy || !loaded}
                onClick={() => {
                  setDraft(text);
                  setMode("edit");
                  setError("");
                }}
              >
                <Pencil size={18} />
              </button>
              {mode === "search" && (
                <button disabled={busy} onClick={() => setMode("reading")}>
                  Назад
                </button>
              )}
              {mode === "reading" && (
                <>
                  <button
                    disabled={busy || !loaded || !text.trim() || localSaved}
                    title="Сохранить в Harbor"
                    onClick={() =>
                      void run(async () => {
                        await api(
                          `/tracks/${encodeURIComponent(track.id)}/lyrics`,
                          { text },
                        );
                        setLocalSaved(true);
                        void client.invalidateQueries({
                          queryKey: ["lyrics", track.id],
                        });
                      })
                    }
                  >
                    {localSaved ? (
                      <Check size={16} aria-label="Сохранено в Harbor" />
                    ) : (
                      "В Harbor"
                    )}
                  </button>
                  <button
                    className="primary"
                    disabled={
                      busy || !stored?.writable || !text.trim() || fileSaved
                    }
                    onClick={() =>
                      void run(async () => {
                        const op = await api<OperationPreview>(
                          "/operations/preview",
                          {
                            kind: "tags",
                            selection: { trackIds: [track.id] },
                            patch: { lyrics: text },
                            companions: false,
                          },
                        );
                        const failure = op.items.find((item) => item.error);
                        if (failure) throw new Error(failure.error);
                        setPreview(op);
                      })
                    }
                  >
                    {fileSaved ? (
                      <Check size={16} aria-label="Записано в файл" />
                    ) : (
                      <>
                        <FileText size={16} /> В файл…
                      </>
                    )}
                  </button>
                </>
              )}
            </>
          )}
          {busy && (
            <LoaderCircle size={16} className="spin" aria-label="Выполняется" />
          )}
        </div>
      </Modal>
      {preview && (
        <Modal
          title={
            stored?.embedded
              ? "Заменить текст в файле?"
              : "Записать текст в файл?"
          }
          subtitle={track.relativePath}
          onClose={() => {
            if (!busy) setPreview(null);
          }}
        >
          <div className="lyrics-confirm-actions">
            <button disabled={busy} onClick={() => setPreview(null)}>
              Отмена
            </button>
            <button
              className="primary"
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const job = await api<Job>(
                    `/operations/${preview.id}/execute`,
                    {},
                  );
                  let current = job;
                  while (
                    current.status === "queued" ||
                    current.status === "running"
                  ) {
                    await new Promise((resolve) => setTimeout(resolve, 400));
                    if (controller.current.signal.aborted) return;
                    const jobs = await api<Job[]>("/jobs", undefined, "GET", {
                      signal: controller.current.signal,
                    });
                    const next = jobs.find((item) => item.id === job.id);
                    if (!next) throw new Error("Операция больше недоступна");
                    current = next;
                  }
                  setPreview(null);
                  if (current.errors.length || current.status !== "done")
                    throw new Error(
                      current.errors.join("\n") || "Не удалось записать текст",
                    );
                  setFileSaved(true);
                  setStored(
                    (current) => current && { ...current, embedded: text },
                  );
                  await client.invalidateQueries();
                })
              }
            >
              Записать
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
