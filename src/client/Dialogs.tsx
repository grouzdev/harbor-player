import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  ArrowRight,
  Check,
  FolderInput,
  History,
  ImagePlus,
  LoaderCircle,
  Search,
  RotateCcw,
  TriangleAlert,
} from "lucide-react";
import type {
  Capabilities,
  Library,
  OperationPreview,
  OperationRetryResult,
  OperationSummary,
  MetadataProposal,
  MusicBrainzCandidate,
  PerTrackTagPatch,
  Selection,
  SelectionSummary,
  TagField,
  TagPatch,
} from "../shared/contracts";
import { api, count, fieldLabels, operationLabels } from "./api";
import { Modal } from "./Modal";

export function AddLibraryDialog({
  onClose,
  onAdded,
}: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  return (
    <Modal
      title="Подключить библиотеку"
      subtitle="Музыка останется в своей папке. Мы добавим её в каталог."
      onClose={onClose}
    >
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("/libraries", { name, path: folder });
            onAdded();
            onClose();
          } catch (e) {
            setError((e as Error).message);
          } finally {
            setBusy(false);
          }
        }}
      >
        <label className="field">
          Путь к папке
          <input
            autoFocus
            required
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder={"D:\\Music\\Collection"}
          />
        </label>
        <label className="field">
          Название библиотеки <span className="muted">необязательно</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Например, Коллекция"
          />
        </label>
        <p className="hint">
          Можно подключить несколько папок с разных дисков. Вложенные папки
          будут просканированы автоматически.
        </p>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-footer">
          <button type="button" className="button secondary" onClick={onClose}>
            Отмена
          </button>
          <button className="button primary" disabled={busy || !folder.trim()}>
            <FolderInput size={16} />
            {busy ? "Подключение…" : "Подключить"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}

export function ActionDialog({
  kind,
  selection,
  libraries,
  capabilities,
  onClose,
  onPreview,
}: {
  kind: "move" | "tags" | "trash";
  selection: Selection;
  libraries: Library[];
  capabilities: Capabilities;
  onClose: () => void;
  onPreview: (preview: OperationPreview) => void;
}) {
  const summary = useQuery({
    queryKey: ["selection-summary", selection],
    queryFn: () => api<SelectionSummary>("/selection-summary", selection),
  });
  const [target, setTarget] = useState(
    libraries[1]?.id || libraries[0]?.id || "",
  );
  const [companions, setCompanions] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [touched, setTouched] = useState<Set<string>>(new Set());
  const [cover, setCover] = useState<TagPatch["cover"]>(undefined);
  const [coverName, setCoverName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [musicBrainzTitle, setMusicBrainzTitle] = useState("");
  const [musicBrainzArtist, setMusicBrainzArtist] = useState("");
  const [musicBrainzCandidates, setMusicBrainzCandidates] = useState<
    MusicBrainzCandidate[] | null
  >(null);
  const [musicBrainzProposal, setMusicBrainzProposal] =
    useState<MetadataProposal | null>(null);
  const [musicBrainzBusy, setMusicBrainzBusy] = useState(false);
  const [musicBrainzError, setMusicBrainzError] = useState("");
  const [proposalFields, setProposalFields] = useState<Set<TagField>>(
    new Set(),
  );
  const [replaceFields, setReplaceFields] = useState<Set<TagField>>(new Set());
  useEffect(() => {
    if (summary.data) {
      setValues(
        Object.fromEntries(
          Object.entries(summary.data.fields).map(([key, f]) => [
            key,
            f.mixed
              ? ""
              : Array.isArray(f.value)
                ? f.value.join("; ")
                : String(f.value ?? ""),
          ]),
        ),
      );
      setMusicBrainzTitle(summary.data.musicBrainz.title);
      setMusicBrainzArtist(summary.data.musicBrainz.artist);
    }
  }, [summary.data]);
  const edit = (key: string, value: string) => {
    setValues((v) => ({ ...v, [key]: value }));
    setTouched((t) => new Set(t).add(key));
  };
  const unsupported =
    summary.data?.formats.filter(
      (f) => !capabilities.writableFormats.includes(f),
    ) || [];
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const patch: Record<string, unknown> = {};
      for (const key of touched)
        patch[key] = ["artists", "albumArtists", "genres"].includes(key)
          ? (values[key] || "")
              .split(";")
              .map((v) => v.trim())
              .filter(Boolean)
          : ["year", "trackNumber", "discNumber"].includes(key)
            ? values[key]?.trim()
              ? Number(values[key])
              : null
            : values[key];
      if (cover !== undefined) patch.cover = cover;
      const itemPatches: Record<string, PerTrackTagPatch> = {};
      if (musicBrainzProposal)
        for (const item of musicBrainzProposal.items) {
          if (!item.patch) continue;
          const proposed: Record<string, unknown> = {};
          for (const field of proposalFields) {
            if (field === "cover" || touched.has(field)) continue;
            if (item.missingFields.includes(field) || replaceFields.has(field))
              proposed[field] = item.patch[field as keyof PerTrackTagPatch];
          }
          if (Object.keys(proposed).length)
            itemPatches[item.trackId] = proposed as PerTrackTagPatch;
        }
      const remoteCover =
        cover === undefined &&
        proposalFields.has("cover") &&
        musicBrainzProposal?.cover;
      const coverTrackIds = remoteCover
        ? musicBrainzProposal.items
            .filter(
              (item) =>
                item.patch &&
                (item.missingFields.includes("cover") ||
                  replaceFields.has("cover")),
            )
            .map((item) => item.trackId)
        : undefined;
      const preview = await api<OperationPreview>("/operations/preview", {
        kind,
        selection,
        targetLibraryId: kind === "move" ? target : undefined,
        companions,
        patch: kind === "tags" ? patch : undefined,
        itemPatches:
          kind === "tags" && Object.keys(itemPatches).length
            ? itemPatches
            : undefined,
        coverId: kind === "tags" && remoteCover ? remoteCover.id : undefined,
        coverTrackIds: kind === "tags" ? coverTrackIds : undefined,
      });
      onPreview(preview);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const selectedProposalCount = musicBrainzProposal
    ? musicBrainzProposal.items.reduce(
        (count, item) =>
          count +
          [...proposalFields].filter(
            (field) =>
              (field === "cover"
                ? !!musicBrainzProposal.cover && !!item.patch
                : !!item.patch?.[field as keyof PerTrackTagPatch]) &&
              (item.missingFields.includes(field) || replaceFields.has(field)),
          ).length,
        0,
      )
    : 0;
  return (
    <Modal
      title={
        kind === "tags"
          ? "Редактировать теги"
          : kind === "move"
            ? "Перенести в библиотеку"
            : "Удалить из библиотеки"
      }
      subtitle={
        summary.data
          ? `Выбрано треков: ${count(summary.data.count)}`
          : "Проверяем выбранные треки…"
      }
      onClose={onClose}
    >
      {summary.error && <p className="error-text">{summary.error.message}</p>}
      {kind === "tags" && (
        <>
          <p className="hint">
            Применяются только отмеченные поля. Несколько исполнителей и жанров
            разделяйте точкой с запятой.
          </p>
          <section className="musicbrainz-panel">
            <div className="musicbrainz-heading">
              <div>
                <Search size={18} />
                <strong>MusicBrainz</strong>
              </div>
              <span className="muted">Метаданные и Cover Art Archive</span>
            </div>
            {summary.data?.musicBrainz.supported ? (
              <>
                <div className="musicbrainz-query">
                  <label>
                    {summary.data.musicBrainz.mode === "album"
                      ? "Альбом"
                      : "Трек"}
                    <input
                      aria-label="Название для поиска MusicBrainz"
                      value={musicBrainzTitle}
                      onChange={(event) =>
                        setMusicBrainzTitle(event.target.value)
                      }
                    />
                  </label>
                  <label>
                    Исполнитель
                    <input
                      aria-label="Исполнитель для поиска MusicBrainz"
                      value={musicBrainzArtist}
                      onChange={(event) =>
                        setMusicBrainzArtist(event.target.value)
                      }
                    />
                  </label>
                  <button
                    type="button"
                    className="button secondary"
                    disabled={musicBrainzBusy || !musicBrainzTitle.trim()}
                    onClick={async () => {
                      setMusicBrainzBusy(true);
                      setMusicBrainzError("");
                      setMusicBrainzCandidates(null);
                      setMusicBrainzProposal(null);
                      setProposalFields(new Set());
                      setReplaceFields(new Set());
                      try {
                        const result = await api<{
                          candidates: MusicBrainzCandidate[];
                        }>("/metadata/musicbrainz/search", {
                          selection,
                          title: musicBrainzTitle,
                          artist: musicBrainzArtist,
                        });
                        setMusicBrainzCandidates(result.candidates);
                      } catch (e) {
                        setMusicBrainzError((e as Error).message);
                      } finally {
                        setMusicBrainzBusy(false);
                      }
                    }}
                  >
                    {musicBrainzBusy ? (
                      <LoaderCircle className="spin" size={16} />
                    ) : (
                      <Search size={16} />
                    )}
                    {musicBrainzBusy ? "Ищем…" : "Найти"}
                  </button>
                </div>
                {musicBrainzCandidates?.length === 0 && (
                  <p className="hint">Подходящих вариантов не найдено.</p>
                )}
                {!!musicBrainzCandidates?.length && !musicBrainzProposal && (
                  <div className="musicbrainz-results" role="list">
                    {musicBrainzCandidates.map((candidate) => (
                      <button
                        type="button"
                        className="musicbrainz-candidate"
                        role="listitem"
                        key={candidate.id}
                        disabled={musicBrainzBusy}
                        onClick={async () => {
                          setMusicBrainzBusy(true);
                          setMusicBrainzError("");
                          try {
                            const proposal = await api<MetadataProposal>(
                              "/metadata/musicbrainz/proposal",
                              {
                                selection,
                                releaseId: candidate.releaseId,
                                recordingId: candidate.recordingId,
                              },
                            );
                            const defaults = new Set<TagField>();
                            for (const item of proposal.items) {
                              if (!item.patch) continue;
                              for (const field of item.missingFields)
                                if (
                                  field === "cover"
                                    ? proposal.cover
                                    : item.patch?.[
                                        field as keyof PerTrackTagPatch
                                      ] !== undefined
                                )
                                  defaults.add(field);
                            }
                            setProposalFields(defaults);
                            setReplaceFields(new Set());
                            setMusicBrainzProposal(proposal);
                          } catch (e) {
                            setMusicBrainzError((e as Error).message);
                          } finally {
                            setMusicBrainzBusy(false);
                          }
                        }}
                      >
                        {candidate.thumbnailUrl ? (
                          <img
                            src={candidate.thumbnailUrl}
                            alt=""
                            loading="lazy"
                          />
                        ) : (
                          <span className="musicbrainz-no-cover">
                            Нет обложки
                          </span>
                        )}
                        <span className="musicbrainz-candidate-copy">
                          <strong>{candidate.title}</strong>
                          <span>
                            {candidate.artists.join("; ") ||
                              "Исполнитель не указан"}
                          </span>
                          <small>
                            {[
                              candidate.date,
                              candidate.country,
                              candidate.formats.join(", "),
                              candidate.status,
                              candidate.trackCount
                                ? `${candidate.trackCount} тр.`
                                : null,
                              `${candidate.score}%`,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </small>
                        </span>
                      </button>
                    ))}
                  </div>
                )}
                {musicBrainzProposal && (
                  <div className="musicbrainz-proposal">
                    <div className="musicbrainz-selected">
                      {musicBrainzProposal.cover && (
                        <img
                          src={`/api/covers/${musicBrainzProposal.cover.id}`}
                          alt="Предложенная обложка"
                        />
                      )}
                      <div>
                        <strong>{musicBrainzProposal.releaseTitle}</strong>
                        <span>
                          Сопоставлено:{" "}
                          {
                            musicBrainzProposal.items.filter(
                              (item) => item.patch,
                            ).length
                          }{" "}
                          из {musicBrainzProposal.items.length}
                        </span>
                        {musicBrainzProposal.cover?.warning && (
                          <small>{musicBrainzProposal.cover.warning}</small>
                        )}
                      </div>
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => setMusicBrainzProposal(null)}
                      >
                        Другой вариант
                      </button>
                    </div>
                    <div className="musicbrainz-fields">
                      {(Object.keys(fieldLabels) as TagField[]).map((field) => {
                        const available =
                          field === "cover"
                            ? !!musicBrainzProposal.cover
                            : musicBrainzProposal.items.some(
                                (item) =>
                                  item.patch?.[
                                    field as keyof PerTrackTagPatch
                                  ] !== undefined,
                              );
                        if (!available) return null;
                        const selected = proposalFields.has(field);
                        return (
                          <div className="musicbrainz-field" key={field}>
                            <label>
                              <input
                                type="checkbox"
                                checked={selected}
                                onChange={(event) =>
                                  setProposalFields((fields) => {
                                    const next = new Set(fields);
                                    event.target.checked
                                      ? next.add(field)
                                      : next.delete(field);
                                    return next;
                                  })
                                }
                              />
                              {fieldLabels[field]}
                            </label>
                            <label className="replace-existing">
                              <input
                                type="checkbox"
                                disabled={!selected}
                                checked={replaceFields.has(field)}
                                onChange={(event) =>
                                  setReplaceFields((fields) => {
                                    const next = new Set(fields);
                                    event.target.checked
                                      ? next.add(field)
                                      : next.delete(field);
                                    return next;
                                  })
                                }
                              />
                              заменить заполненные
                            </label>
                          </div>
                        );
                      })}
                    </div>
                    {musicBrainzProposal.items.some((item) => item.warning) && (
                      <details className="musicbrainz-warnings">
                        <summary>Проблемы сопоставления</summary>
                        {musicBrainzProposal.items
                          .filter((item) => item.warning)
                          .map((item) => (
                            <p key={item.trackId}>
                              {item.title}: {item.warning}
                            </p>
                          ))}
                      </details>
                    )}
                  </div>
                )}
              </>
            ) : (
              summary.data && (
                <p className="hint">{summary.data.musicBrainz.reason}</p>
              )
            )}
            {musicBrainzError && (
              <p className="error-text" role="alert">
                {musicBrainzError}
              </p>
            )}
          </section>
          {!!unsupported.length && (
            <p className="error-text">
              Запись {unsupported.join(", ").toUpperCase()} не прошла проверку
              безопасности. Эти файлы будут пропущены.
            </p>
          )}
          <div className="tag-fields">
            {Object.entries(fieldLabels)
              .filter(([key]) => key !== "cover")
              .map(([key, label]) => (
                <div
                  className={`tag-field ${touched.has(key) ? "changed" : ""}`}
                  key={key}
                >
                  <label className="tag-label">
                    <input
                      type="checkbox"
                      checked={touched.has(key)}
                      aria-label={`Изменить: ${label}`}
                      onChange={(e) =>
                        setTouched((t) => {
                          const next = new Set(t);
                          e.target.checked ? next.add(key) : next.delete(key);
                          return next;
                        })
                      }
                    />
                    {label}
                  </label>
                  <input
                    aria-label={label}
                    type={
                      ["year", "trackNumber", "discNumber"].includes(key)
                        ? "number"
                        : "text"
                    }
                    min="0"
                    value={values[key] || ""}
                    placeholder={
                      summary.data?.fields[key]?.mixed
                        ? "Разные значения"
                        : "Не указано"
                    }
                    onChange={(e) => edit(key, e.target.value)}
                  />
                </div>
              ))}
          </div>
          <div className="cover-edit">
            <label className="button secondary">
              <ImagePlus size={16} />
              {coverName || "Добавить обложку"}
              <input
                type="file"
                accept="image/png,image/jpeg"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (
                    file.size > 10 * 1024 * 1024 ||
                    !["image/jpeg", "image/png"].includes(file.type)
                  ) {
                    setError("Выберите JPEG или PNG до 10 МБ");
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = () => {
                    setCover({
                      data: String(reader.result).split(",")[1],
                      mime: file.type as "image/jpeg" | "image/png",
                    });
                    setCoverName(file.name);
                  };
                  reader.readAsDataURL(file);
                }}
              />
            </label>
            <button
              className="text-button"
              onClick={() => {
                setCover(null);
                setCoverName("Обложка будет удалена");
              }}
            >
              Удалить обложку
            </button>
            {cover !== undefined && (
              <button
                className="text-button"
                onClick={() => {
                  setCover(undefined);
                  setCoverName("");
                }}
              >
                Сбросить
              </button>
            )}
          </div>
        </>
      )}
      {kind === "move" && (
        <>
          <label className="field">
            Куда перенести
            <select value={target} onChange={(e) => setTarget(e.target.value)}>
              {libraries
                .filter((l) => l.available)
                .map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
            </select>
          </label>
          <p className="hint">
            Структура вложенных папок сохранится. Совпадающие имена будут
            показаны как конфликты.
          </p>
          <label className="check-line">
            <input
              type="checkbox"
              checked={companions}
              onChange={(e) => setCompanions(e.target.checked)}
            />
            Перенести обложки и сопутствующие файлы целых альбомов
          </label>
        </>
      )}
      {kind === "trash" && (
        <div className="notice">
          <History size={24} />
          <p>
            Файлы будут перемещены в область восстановления. Вернуть их можно
            через журнал операций.
          </p>
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="modal-footer">
        <button className="button secondary" onClick={onClose}>
          Отмена
        </button>
        <button
          className="button primary"
          disabled={
            busy ||
            !summary.data ||
            (kind === "tags" &&
              !touched.size &&
              cover === undefined &&
              !selectedProposalCount)
          }
          onClick={submit}
        >
          {busy ? "Проверяем файлы…" : "Посмотреть изменения"}
          <ArrowRight size={16} />
        </button>
      </footer>
    </Modal>
  );
}

export function PreviewDialog({
  preview,
  onClose,
  onExecute,
}: {
  preview: OperationPreview;
  onClose: () => void;
  onExecute: (id: string) => Promise<void>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const virtual = useVirtualizer({
    count: preview.items.length,
    getScrollElement: () => ref.current,
    estimateSize: () => (preview.kind === "tags" ? 138 : 100),
    overscan: 5,
  });
  const valid = preview.items.filter((i) => !i.error);
  const conflicts = preview.items.length - valid.length;
  return (
    <Modal
      wide
      title={`${operationLabels[preview.kind]}: предварительный просмотр`}
      subtitle={`${count(valid.length)} файлов готовы${conflicts ? ` · ${count(conflicts)} будут пропущены` : ""}`}
      onClose={busy ? () => {} : onClose}
    >
      <div ref={ref} className="preview-list">
        <div style={{ height: virtual.getTotalSize(), position: "relative" }}>
          {virtual.getVirtualItems().map((row) => {
            const item = preview.items[row.index];
            return (
              <div
                key={item.id}
                data-index={row.index}
                ref={virtual.measureElement}
                className={`preview-item ${item.error ? "conflict" : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  width: "100%",
                  transform: `translateY(${row.start}px)`,
                }}
              >
                <div className="preview-item-title">
                  {item.error ? (
                    <TriangleAlert size={16} />
                  ) : (
                    <Check size={16} />
                  )}
                  <strong>{item.title}</strong>
                  {item.companion && (
                    <span className="badge">Сопутствующий файл</span>
                  )}
                </div>
                <div className="path-text" title={item.source}>
                  {item.source}
                </div>
                {preview.kind !== "tags" && (
                  <div className="path-text target" title={item.destination}>
                    → {item.destination}
                  </div>
                )}
                {preview.kind === "tags" && (
                  <div className="tag-diff">
                    {Object.entries(effectivePreviewPatch(preview, item)).map(
                      ([key, value]) => (
                        <span key={key}>
                          <b>{fieldLabels[key]}:</b>{" "}
                          {key === "cover"
                            ? value === null
                              ? "удалить"
                              : "новая обложка"
                            : `${display(item.before?.[key as keyof TagPatch])} → ${display(value)}`}
                        </span>
                      ),
                    )}
                  </div>
                )}
                {item.error && <p className="error-text">{item.error}</p>}
              </div>
            );
          })}
        </div>
      </div>
      <p className="hint">
        Каждый файл проверяется повторно перед изменением. Результат появится в
        журнале.
      </p>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <footer className="modal-footer">
        <button className="button secondary" disabled={busy} onClick={onClose}>
          Отмена
        </button>
        <button
          className="button primary"
          disabled={busy || !valid.length}
          onClick={async () => {
            setBusy(true);
            try {
              await onExecute(preview.id);
            } catch (e) {
              setError((e as Error).message);
              setBusy(false);
            }
          }}
        >
          {busy ? "Запуск…" : `Применить к ${count(valid.length)} файлам`}
        </button>
      </footer>
    </Modal>
  );
}
function display(value: unknown) {
  return Array.isArray(value)
    ? value.join("; ") || "∅"
    : value === null || value === undefined || value === ""
      ? "∅"
      : String(value);
}

function effectivePreviewPatch(
  preview: OperationPreview,
  item: OperationPreview["items"][number],
): TagPatch {
  const patch: TagPatch = { ...(item.patch || {}), ...(preview.patch || {}) };
  if (
    patch.cover !== undefined &&
    preview.coverTrackIds &&
    (!item.trackId || !preview.coverTrackIds.includes(item.trackId))
  )
    delete patch.cover;
  return patch;
}

export function HistoryDialog({
  onClose,
  onPreview,
}: {
  onClose: () => void;
  onPreview: (preview: OperationPreview) => void;
}) {
  const history = useQuery({
    queryKey: ["history"],
    queryFn: () => api<OperationSummary[]>("/operations"),
    refetchInterval: 2000,
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [details, setDetails] = useState<OperationPreview | null>(null);
  return (
    <Modal
      wide
      title="Журнал операций"
      subtitle="История изменений и восстановление файлов"
      onClose={onClose}
    >
      <div className="history-list">
        {!history.data?.length && (
          <div className="empty-small">
            <History size={32} />
            <p>Здесь появятся переносы, удаления и изменения тегов.</p>
          </div>
        )}
        {history.data?.map((op) => (
          <article className="history-item" key={op.id}>
            <div className="history-title">
              <strong>{operationLabels[op.kind]}</strong>
              <span className="muted">
                {new Date(op.createdAt).toLocaleString("ru-RU")}
              </span>
            </div>
            <p>
              {op.status === "running"
                ? "Выполняется"
                : op.status === "interrupted"
                  ? "Прервано"
                  : `Готово: ${op.completed} из ${op.total}`}
              {op.errors.length > 0 && (
                <span className="error-text">
                  {" "}
                  · Ошибок: {op.errors.length}
                </span>
              )}
            </p>
            <div className="history-actions">
              <button
                className="text-button"
                onClick={async () => {
                  try {
                    setDetails(
                      await api<OperationPreview>(`/operations/${op.id}`),
                    );
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                Подробнее
              </button>
              {["trash", "tags"].includes(op.kind) &&
                op.completed > 0 &&
                op.status !== "running" && (
                  <button
                    className="button secondary small"
                    disabled={!!busy}
                    onClick={async () => {
                      setBusy(op.id);
                      try {
                        onPreview(
                          await api(`/operations/${op.id}/restore`, {}),
                        );
                      } catch (e) {
                        setError((e as Error).message);
                      } finally {
                        setBusy("");
                      }
                    }}
                  >
                    <RotateCcw size={14} />
                    Восстановить
                  </button>
                )}
              {(op.status === "interrupted" ||
                (op.errors.length && op.completed < op.total)) && (
                <button
                  className="text-button"
                  disabled={!!busy}
                  onClick={async () => {
                    setBusy(op.id);
                    try {
                      if (op.kind === "tags") {
                        const retry = await api<OperationRetryResult>(
                          `/operations/${op.id}/retry`,
                          {},
                        );
                        if (retry.action === "preview")
                          onPreview(retry.preview);
                        else await history.refetch();
                      } else {
                        await api(`/operations/${op.id}/execute`, {});
                        await history.refetch();
                      }
                    } catch (e) {
                      setError((e as Error).message);
                    } finally {
                      setBusy("");
                    }
                  }}
                >
                  Повторить незавершённые
                </button>
              )}
            </div>
          </article>
        ))}
      </div>
      {details && (
        <div className="history-details">
          <strong>Результаты по файлам</strong>
          <div>
            {details.items.map((i) => (
              <p key={i.id} className={i.error ? "error-text" : ""}>
                {i.title}:{" "}
                {i.error || (i.phase === "done" ? "готово" : i.phase)}
                <small>
                  {i.source} → {i.destination}
                </small>
              </p>
            ))}
          </div>
          <button className="text-button" onClick={() => setDetails(null)}>
            Скрыть
          </button>
        </div>
      )}
      {(error || history.error) && (
        <p className="error-text" role="alert">
          {error || history.error?.message}
        </p>
      )}
    </Modal>
  );
}
