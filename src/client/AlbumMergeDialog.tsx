import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, ImagePlus, TriangleAlert } from "lucide-react";
import {
  emptyFilter,
  type AlbumMergeContext,
  type AlbumMergeSource,
  type Capabilities,
  type OperationPreview,
  type TagPatch,
} from "../shared/contracts";
import { api, count, prepareCoverFile, type CoverFilePatch } from "./api";
import { activateDialogPrimaryOnEnter } from "./dialog-keyboard";
import { Modal } from "./Modal";

type CoverChoice = `source:${string}` | "upload" | "remove";

const artistsText = (source: AlbumMergeSource) =>
  source.albumArtists.join("; ");

function sourceLabel(source: AlbumMergeSource, index: number) {
  return source.title || `Альбом ${index + 1}`;
}

export function AlbumMergeDialog({
  albumIds,
  anchorAlbumId,
  capabilities,
  onClose,
  onPreview,
}: {
  albumIds: string[];
  anchorAlbumId: string;
  capabilities: Capabilities;
  onClose: () => void;
  onPreview: (preview: OperationPreview) => void;
}) {
  const context = useQuery({
    queryKey: ["album-merge-context", albumIds],
    queryFn: () =>
      api<AlbumMergeContext>("/albums/merge-context", { albumIds }),
  });
  const initialized = useRef(false);
  const primaryButtonRef = useRef<HTMLButtonElement>(null);
  const [albumTitle, setAlbumTitle] = useState("");
  const [albumArtists, setAlbumArtists] = useState("");
  const [year, setYear] = useState("");
  const [coverChoice, setCoverChoice] = useState<CoverChoice>(
    `source:${anchorAlbumId}`,
  );
  const [uploadedCover, setUploadedCover] = useState<CoverFilePatch | null>(
    null,
  );
  const [uploadedCoverName, setUploadedCoverName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!context.data || initialized.current) return;
    const source =
      context.data.sources.find((item) => item.albumId === anchorAlbumId) ||
      context.data.sources[0];
    if (!source) return;
    initialized.current = true;
    setAlbumTitle(source.title);
    setAlbumArtists(artistsText(source));
    setYear(source.year === null ? "" : String(source.year));
    setCoverChoice(`source:${source.albumId}`);
  }, [anchorAlbumId, context.data]);

  const unsupported = useMemo(
    () =>
      context.data
        ? [
            ...new Set(context.data.sources.flatMap((source) => source.formats)),
          ].filter((format) => !capabilities.writableFormats.includes(format))
        : [],
    [capabilities.writableFormats, context.data],
  );

  const chooseSource = (
    source: AlbumMergeSource,
    field: "title" | "artists" | "year",
  ) => {
    if (field === "title") setAlbumTitle(source.title);
    else if (field === "artists") setAlbumArtists(artistsText(source));
    else setYear(source.year === null ? "" : String(source.year));
  };

  const submit = async () => {
    if (!context.data?.compatible) return;
    const parsedYear = year.trim() === "" ? null : Number(year);
    if (
      parsedYear !== null &&
      (!Number.isInteger(parsedYear) || parsedYear < 0 || parsedYear > 9999)
    ) {
      setError("Год должен быть целым числом от 0 до 9999");
      return;
    }
    const patch: TagPatch = {
      albumTitle,
      albumArtists: albumArtists
        .split(";")
        .map((value) => value.trim())
        .filter(Boolean),
      year: parsedYear,
    };
    let coverId: string | undefined;
    if (coverChoice === "upload") {
      if (!uploadedCover) {
        setError("Выберите файл обложки");
        return;
      }
      patch.cover = uploadedCover;
    } else if (coverChoice === "remove") patch.cover = null;
    else {
      const source = context.data.sources.find(
        (item) => `source:${item.albumId}` === coverChoice,
      );
      if (source?.coverId) coverId = source.coverId;
      else patch.cover = null;
    }

    setBusy(true);
    setError("");
    try {
      const preview = await api<OperationPreview>("/operations/preview", {
        kind: "tags",
        intent: "album-merge",
        selection: { filter: { ...emptyFilter, albumIds } },
        patch,
        coverId,
      });
      onPreview(preview);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "Не удалось подготовить объединение",
      );
    } finally {
      setBusy(false);
    }
  };

  const sources = context.data?.sources || [];
  const releaseIds = [
    ...new Set(sources.flatMap((source) => source.musicBrainzReleaseIds)),
  ];
  const coverConflict = new Set(sources.map((source) => source.coverId)).size > 1;
  return (
    <Modal
      wide
      title={`Объединить ${count(albumIds.length)} альбома`}
      subtitle={
        context.data
          ? `${count(context.data.trackCount)} треков${context.data.library ? ` · ${context.data.library.name}` : ""}`
          : "Сравниваем альбомные теги…"
      }
      onClose={busy ? () => {} : onClose}
      onKeyDown={(event) =>
        activateDialogPrimaryOnEnter(event, primaryButtonRef.current)
      }
    >
      {context.error && (
        <p className="error-text" role="alert">
          {context.error.message}
        </p>
      )}
      {context.data && (
        <div className="album-merge-layout">
          <section className="album-merge-sources" aria-label="Исходные альбомы">
            <h3>Исходные альбомы</h3>
            {sources.map((source, index) => (
              <article className="album-merge-source" key={source.albumId}>
                <div className="album-merge-cover">
                  {source.coverId ? (
                    <img src={`/api/covers/${source.coverId}`} alt="" />
                  ) : (
                    <span>Нет обложки</span>
                  )}
                </div>
                <div>
                  <strong>{sourceLabel(source, index)}</strong>
                  <span>{artistsText(source) || "Без исполнителя альбома"}</span>
                  <small>
                    {source.year ?? "Без года"} · {count(source.trackCount)} тр.
                  </small>
                  {!!source.musicBrainzReleaseIds.length && (
                    <small className="album-merge-source-release-id">
                      MB: {source.musicBrainzReleaseIds.join(", ")}
                    </small>
                  )}
                </div>
              </article>
            ))}
            {context.data.relativeFolder && (
              <p className="path-text" title={context.data.relativeFolder}>
                {context.data.relativeFolder}
              </p>
            )}
          </section>

          <section className="album-merge-result" aria-label="Итоговый альбом">
            <h3>Итоговый альбом</h3>
            {!context.data.compatible &&
              context.data.blockers.map((blocker) => (
                <div className="album-merge-blocker" key={blocker}>
                  <TriangleAlert size={18} />
                  <span>{blocker}</span>
                </div>
              ))}
            <MergeField
              label="Название альбома"
              value={albumTitle}
              sources={sources}
              sourceValue={(source) => source.title}
              onChoose={(source) => chooseSource(source, "title")}
              onChange={setAlbumTitle}
            />
            <MergeField
              label="Исполнители альбома"
              value={albumArtists}
              sources={sources}
              sourceValue={artistsText}
              onChoose={(source) => chooseSource(source, "artists")}
              onChange={setAlbumArtists}
              hint="Несколько исполнителей разделяйте точкой с запятой."
            />
            <MergeField
              label="Год"
              value={year}
              sources={sources}
              sourceValue={(source) =>
                source.year === null ? "" : String(source.year)
              }
              onChoose={(source) => chooseSource(source, "year")}
              onChange={setYear}
              inputMode="numeric"
            />

            <div
              className={`album-merge-field ${coverConflict ? "conflict" : ""}`}
            >
              <span className="album-merge-field-label">
                Обложка
                {coverConflict && <small>разные значения</small>}
              </span>
              <div className="album-merge-cover-options">
                {sources.map((source, index) => (
                  <button
                    type="button"
                    key={source.albumId}
                    className={
                      coverChoice === `source:${source.albumId}` ? "active" : ""
                    }
                    onClick={() => setCoverChoice(`source:${source.albumId}`)}
                  >
                    {source.coverId ? (
                      <img src={`/api/covers/${source.coverId}`} alt="" />
                    ) : (
                      <span>∅</span>
                    )}
                    <small>{sourceLabel(source, index)}</small>
                  </button>
                ))}
                <label className={coverChoice === "upload" ? "active" : ""}>
                  <ImagePlus size={22} />
                  <small>{uploadedCoverName || "Свой файл"}</small>
                  <input
                    type="file"
                    accept="image/png,image/jpeg,.png,.jpg,.jpeg"
                    hidden
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (!file) return;
                      if (
                        !["image/jpeg", "image/png"].includes(file.type) &&
                        !/\.(jpe?g|png)$/i.test(file.name)
                      ) {
                        setError("Выберите JPEG или PNG размером до 10 МБ");
                        return;
                      }
                      try {
                        setUploadedCover(await prepareCoverFile(file));
                        setUploadedCoverName(file.name);
                        setCoverChoice("upload");
                        setError("");
                      } catch (caught) {
                        setError(
                          caught instanceof Error
                            ? caught.message
                            : "Не удалось обработать обложку",
                        );
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  className={coverChoice === "remove" ? "active" : ""}
                  onClick={() => setCoverChoice("remove")}
                >
                  <span>∅</span>
                  <small>Без обложки</small>
                </button>
              </div>
            </div>

            {!!releaseIds.length && (
              <details className="album-merge-technical">
                <summary>MusicBrainz Release ID</summary>
                <p>
                  Эти значения сохранятся в файлах, но больше не влияют на
                  группировку альбома.
                </p>
                {releaseIds.map((id) => (
                  <code key={id}>{id}</code>
                ))}
              </details>
            )}
            {!!unsupported.length && (
              <p className="error-text">
                Запись {unsupported.join(", ").toUpperCase()} не прошла проверку
                безопасности. Предпросмотр заблокирует частичное объединение.
              </p>
            )}
          </section>
        </div>
      )}
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
          ref={primaryButtonRef}
          className="button primary"
          disabled={busy || !context.data?.compatible}
          onClick={() => void submit()}
        >
          {busy ? "Проверяем файлы…" : "Далее"}
          <ArrowRight size={16} />
        </button>
      </footer>
    </Modal>
  );
}

function MergeField({
  label,
  value,
  sources,
  sourceValue,
  onChoose,
  onChange,
  hint,
  inputMode,
}: {
  label: string;
  value: string;
  sources: AlbumMergeSource[];
  sourceValue: (source: AlbumMergeSource) => string;
  onChoose: (source: AlbumMergeSource) => void;
  onChange: (value: string) => void;
  hint?: string;
  inputMode?: "numeric";
}) {
  const conflict = new Set(sources.map(sourceValue)).size > 1;
  return (
    <div className={`album-merge-field ${conflict ? "conflict" : ""}`}>
      <span className="album-merge-field-label">
        {label}
        {conflict && <small>разные значения</small>}
      </span>
      <div className="album-merge-candidates">
        {sources.map((source, index) => {
          const candidate = sourceValue(source);
          return (
            <button
              type="button"
              key={source.albumId}
              className={candidate === value ? "active" : ""}
              onClick={() => onChoose(source)}
              title={sourceLabel(source, index)}
            >
              {candidate || "∅"}
            </button>
          );
        })}
      </div>
      <input
        aria-label={label}
        value={value}
        inputMode={inputMode}
        placeholder="Не указано"
        onChange={(event) => onChange(event.target.value)}
      />
      {hint && <small className="muted">{hint}</small>}
    </div>
  );
}
