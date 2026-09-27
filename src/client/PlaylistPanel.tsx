import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Download,
  GripVertical,
  ListMusic,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Settings,
  Trash2,
} from "lucide-react";
import type {
  PathTemplate,
  PathTemplateField,
  PathTemplatePart,
  PlaylistDetail,
  PlaylistExportFormat,
  PlaylistSyncSettings,
  PlaylistTrackPage,
} from "../shared/playlists";
import { api, count, duration } from "./api";
import { Modal } from "./Modal";

const templateFieldLabels: Record<PathTemplateField, string> = {
  albumArtist: "Исполнитель альбома",
  trackArtist: "Исполнитель трека",
  album: "Альбом",
  year: "Год",
  discNumber: "Диск",
  trackNumber: "Номер трека",
  title: "Название трека",
  originalName: "Исходное имя",
  extension: "Расширение",
};
const folderTemplateFields: PathTemplateField[] = [
  "albumArtist",
  "trackArtist",
  "album",
  "year",
  "discNumber",
];
const fieldPart = (
  field: PathTemplateField,
  fallback = "",
  pad = 0,
): PathTemplatePart => ({
  kind: "field",
  field,
  fallback,
  prefix: "",
  suffix: "",
  pad,
});

function SyncDialog({
  playlist,
  onClose,
  notify,
}: {
  playlist: PlaylistDetail["playlist"];
  onClose: () => void;
  notify: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const settings = useQuery({
    queryKey: ["playlist-sync", playlist.id],
    queryFn: () => api<PlaylistSyncSettings>(`/playlists/${playlist.id}/sync`),
  });
  const templates = useQuery({
    queryKey: ["path-templates"],
    queryFn: () => api<PathTemplate[]>("/path-templates"),
  });
  const [targetPath, setTargetPath] = useState("");
  const [templateId, setTemplateId] = useState("default-album-artist");
  const [autoSync, setAutoSync] = useState(false);
  const [saving, setSaving] = useState(false);
  const [format, setFormat] = useState<PlaylistExportFormat>("m3u8");
  const [source, setSource] = useState<"libraries" | "sync">("libraries");
  const [directoryFields, setDirectoryFields] = useState<PathTemplateField[]>([
    "albumArtist",
    "album",
  ]);
  const [fileNameMode, setFileNameMode] = useState<
    "original" | "number-title" | "title"
  >("original");
  useEffect(() => {
    if (!settings.data) return;
    setTargetPath(settings.data.targetPath || "");
    setTemplateId(settings.data.templateId);
    setAutoSync(settings.data.autoSync);
  }, [settings.data]);
  useEffect(() => {
    const template = templates.data?.find((item) => item.id === templateId);
    if (!template) return;
    setDirectoryFields(
      template.directories.map((pattern) => {
        const field = pattern.find((part) => part.kind === "field");
        return field?.field || "album";
      }),
    );
    const fields = template.fileName
      .filter(
        (part): part is Extract<PathTemplatePart, { kind: "field" }> =>
          part.kind === "field",
      )
      .map((part) => part.field);
    setFileNameMode(
      fields.includes("originalName")
        ? "original"
        : fields.includes("trackNumber")
          ? "number-title"
          : "title",
    );
  }, [templateId, templates.data]);
  const save = async () => {
    setSaving(true);
    try {
      const changedTarget =
        Boolean(settings.data?.targetPath) &&
        settings.data?.targetPath !== (targetPath.trim() || null);
      const cleanupOld = changedTarget
        ? window.confirm(
            "Удалить копии из прежней папки сборки?\n\n«Отмена» оставит их на месте.",
          )
        : false;
      await api(`/playlists/${playlist.id}/sync/settings`, {
        targetPath: targetPath.trim() || null,
        templateId,
        autoSync,
        cleanupOld,
      });
      await queryClient.invalidateQueries({
        queryKey: ["playlist-sync", playlist.id],
      });
      notify("Настройки сборки сохранены");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const chooseFolder = async () => {
    const selected =
      await window.harborPlayerDesktop?.choosePlaylistDirectory();
    if (selected) setTargetPath(selected);
  };
  const runSync = async () => {
    try {
      await save();
      await api(`/playlists/${playlist.id}/sync`, {});
      notify("Сборка добавлена в очередь");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const exportFile = async () => {
    let destination =
      await window.harborPlayerDesktop?.choosePlaylistExportFile(
        playlist.name,
        format,
      );
    if (!destination)
      destination =
        window.prompt("Абсолютный путь файла экспорта") || undefined;
    if (!destination) return;
    try {
      const result = await api<{ written: number; skipped: number }>(
        `/playlists/${playlist.id}/export`,
        { format, destination, source },
      );
      notify(`Экспортировано треков: ${result.written}`);
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const saveTemplate = async () => {
    const current = templates.data?.find((item) => item.id === templateId);
    const defaultName =
      current?.id === "default-album-artist"
        ? `${current.name} — копия`
        : current?.name || "Новый шаблон";
    const name = window.prompt("Название шаблона", defaultName)?.trim();
    if (!name) return;
    const fileName: PathTemplatePart[] =
      fileNameMode === "original"
        ? [fieldPart("originalName", "трек")]
        : fileNameMode === "title"
          ? [
              fieldPart("title", "трек"),
              { kind: "literal", value: "." },
              fieldPart("extension"),
            ]
          : [
              fieldPart("trackNumber", "", 2),
              { kind: "literal", value: " - " },
              fieldPart("title", "трек"),
              { kind: "literal", value: "." },
              fieldPart("extension"),
            ];
    try {
      const saved = await api<PathTemplate>("/path-templates", {
        ...(current && current.id !== "default-album-artist"
          ? { id: current.id }
          : {}),
        name,
        directories: directoryFields.map((field) => [
          fieldPart(
            field,
            field === "albumArtist"
              ? "Неизвестный исполнитель"
              : field === "album"
                ? "Без альбома"
                : "Не указано",
          ),
        ]),
        fileName,
      });
      await queryClient.invalidateQueries({ queryKey: ["path-templates"] });
      setTemplateId(saved.id);
      notify("Шаблон сохранён");
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const deleteTemplate = async () => {
    if (templateId === "default-album-artist") return;
    if (!window.confirm("Удалить выбранный шаблон?")) return;
    try {
      await api(`/path-templates/${templateId}`, undefined, "DELETE");
      setTemplateId("default-album-artist");
      await queryClient.invalidateQueries({ queryKey: ["path-templates"] });
    } catch (error) {
      notify((error as Error).message);
    }
  };
  return (
    <Modal title="Сборка и экспорт" subtitle={playlist.name} onClose={onClose}>
      <div className="form-grid playlist-settings-form">
        <label>
          Папка сборки
          <div className="input-with-action">
            <input
              value={targetPath}
              onChange={(event) => setTargetPath(event.target.value)}
            />
            {window.harborPlayerDesktop && (
              <button
                className="button"
                type="button"
                onClick={() => void chooseFolder()}
              >
                Обзор…
              </button>
            )}
          </div>
        </label>
        <label>
          Шаблон путей
          <select
            value={templateId}
            onChange={(event) => setTemplateId(event.target.value)}
          >
            {(templates.data || []).map((template) => (
              <option key={template.id} value={template.id}>
                {template.name}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="template-builder">
          <legend>Структура папок</legend>
          {directoryFields.map((field, index) => (
            <div key={`${field}-${index}`}>
              <select
                value={field}
                onChange={(event) =>
                  setDirectoryFields((current) =>
                    current.map((item, itemIndex) =>
                      itemIndex === index
                        ? (event.target.value as PathTemplateField)
                        : item,
                    ),
                  )
                }
              >
                {folderTemplateFields.map((option) => (
                  <option key={option} value={option}>
                    {templateFieldLabels[option]}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="icon-button"
                aria-label="Удалить уровень"
                disabled={directoryFields.length === 1}
                onClick={() =>
                  setDirectoryFields((current) =>
                    current.filter((_, itemIndex) => itemIndex !== index),
                  )
                }
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button"
            disabled={directoryFields.length >= 8}
            onClick={() =>
              setDirectoryFields((current) => [...current, "album"])
            }
          >
            <Plus size={14} /> Уровень папки
          </button>
          <label>
            Имя файла
            <select
              value={fileNameMode}
              onChange={(event) =>
                setFileNameMode(event.target.value as typeof fileNameMode)
              }
            >
              <option value="original">Исходное имя</option>
              <option value="number-title">01 — Название.ext</option>
              <option value="title">Название.ext</option>
            </select>
          </label>
          <div className="dialog-actions">
            <button
              className="button"
              type="button"
              onClick={() => void saveTemplate()}
            >
              Сохранить шаблон…
            </button>
            <button
              className="button danger"
              type="button"
              disabled={templateId === "default-album-artist"}
              onClick={() => void deleteTemplate()}
            >
              Удалить шаблон
            </button>
          </div>
        </fieldset>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={autoSync}
            onChange={(event) => setAutoSync(event.target.checked)}
          />
          Собирать автоматически после изменений
        </label>
        <div
          className={`playlist-sync-state state-${settings.data?.state || "idle"}`}
        >
          {settings.data?.message || "Сборка ещё не выполнялась"}
        </div>
        <div className="dialog-actions">
          <button
            className="button"
            disabled={saving}
            onClick={() => void save()}
          >
            Сохранить
          </button>
          <button
            className="button primary"
            disabled={!targetPath.trim() || saving}
            onClick={() => void runSync()}
          >
            <RefreshCw size={16} /> Собрать сейчас
          </button>
        </div>
        <hr />
        <div className="playlist-export-row">
          <select
            value={format}
            onChange={(event) =>
              setFormat(event.target.value as PlaylistExportFormat)
            }
          >
            <option value="m3u8">M3U8</option>
            <option value="xspf">XSPF</option>
          </select>
          <select
            value={source}
            onChange={(event) =>
              setSource(event.target.value as "libraries" | "sync")
            }
          >
            <option value="libraries">Исходные файлы</option>
            <option value="sync">Копии из сборки</option>
          </select>
          <button className="button" onClick={() => void exportFile()}>
            <Download size={16} /> Экспортировать
          </button>
        </div>
      </div>
    </Modal>
  );
}

export function PlaylistPanel({
  playlistId,
  onAddSelection,
  onPlay,
  onRename,
  onDelete,
  notify,
}: {
  playlistId: string | null;
  onAddSelection: () => Promise<void>;
  onPlay: (id: string, startId?: string) => void;
  onRename: (playlist: PlaylistDetail["playlist"]) => void;
  onDelete: (playlist: PlaylistDetail["playlist"]) => void;
  notify: (message: string) => void;
}) {
  const queryClient = useQueryClient();
  const [view, setView] = useState<"composition" | "order">("composition");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [dragged, setDragged] = useState<string | null>(null);
  const [syncOpen, setSyncOpen] = useState(false);
  const detail = useQuery({
    queryKey: ["playlist", playlistId],
    enabled: Boolean(playlistId),
    queryFn: () => api<PlaylistDetail>(`/playlists/${playlistId}`),
  });
  const tracks = useQuery({
    queryKey: ["playlist-tracks", playlistId],
    enabled: Boolean(playlistId),
    queryFn: () =>
      api<PlaylistTrackPage>(
        `/playlists/${playlistId}/tracks?offset=0&limit=500`,
      ),
  });
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["playlists"] }),
      queryClient.invalidateQueries({ queryKey: ["playlist", playlistId] }),
      queryClient.invalidateQueries({
        queryKey: ["playlist-tracks", playlistId],
      }),
    ]);
  };
  const mutate = async (
    url: string,
    body?: unknown,
    method?: "POST" | "DELETE",
  ) => {
    try {
      await api(url, body, method);
      await refresh();
    } catch (error) {
      notify((error as Error).message);
    }
  };
  const reorder = async (entryId: string, beforeId: string) => {
    const ids = detail.data?.entries.map((entry) => entry.id) || [];
    const from = ids.indexOf(entryId);
    const to = ids.indexOf(beforeId);
    if (from < 0 || to < 0 || from === to) return;
    ids.splice(from, 1);
    ids.splice(to, 0, entryId);
    await mutate(`/playlists/${playlistId}/reorder`, { entryIds: ids });
  };
  if (!playlistId)
    return (
      <section className="panel playlist-panel" data-panel-id="playlists">
        <div className="panel-heading">
          <h2>Плейлист</h2>
        </div>
        <div className="playlist-empty">
          <ListMusic size={28} />
          <p>Выберите или создайте плейлист</p>
        </div>
      </section>
    );
  const playlist = detail.data?.playlist;
  return (
    <section className="panel playlist-panel" data-panel-id="playlists">
      <div className="panel-heading playlist-heading">
        <h2>{playlist?.name || "Плейлист"}</h2>
        <div className="playlist-heading-actions">
          <button
            className="icon-button"
            aria-label="Добавить выбранное"
            title="Добавить выбранное"
            onClick={() => void onAddSelection()}
          >
            <Plus size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Воспроизвести плейлист"
            title="Воспроизвести"
            disabled={!playlist?.trackCount}
            onClick={() => onPlay(playlistId)}
          >
            <Play size={17} fill="currentColor" />
          </button>
          <button
            className="icon-button"
            aria-label="Переименовать плейлист"
            title="Переименовать"
            disabled={!playlist}
            onClick={() => playlist && onRename(playlist)}
          >
            <Pencil size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="Настройки сборки"
            title="Сборка и экспорт"
            onClick={() => setSyncOpen(true)}
          >
            <Settings size={17} />
          </button>
          <button
            className="icon-button"
            aria-label="Удалить плейлист"
            title="Удалить"
            disabled={!playlist}
            onClick={() => playlist && onDelete(playlist)}
          >
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="playlist-toolbar">
        <div
          className="segmented compact"
          role="group"
          aria-label="Представление плейлиста"
        >
          <button
            className={view === "composition" ? "active" : ""}
            onClick={() => setView("composition")}
          >
            Состав
          </button>
          <button
            className={view === "order" ? "active" : ""}
            onClick={() => setView("order")}
          >
            Порядок
          </button>
        </div>
        <select
          aria-label="Порядок плейлиста"
          value={playlist?.orderMode || "manual"}
          disabled={!playlist}
          onChange={(event) =>
            void mutate(`/playlists/${playlistId}`, {
              orderMode: event.target.value,
            })
          }
        >
          <option value="manual">Вручную</option>
          <option value="catalog">Исполнитель / альбом</option>
        </select>
      </div>
      <div
        className="playlist-drop-target"
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => {
          if (
            event.dataTransfer.types.includes(
              "application/x-harbor-catalog-selection",
            )
          )
            void onAddSelection();
        }}
      >
        Перетащите сюда треки, альбомы или исполнителей
      </div>
      <div className="playlist-content">
        {detail.isFetching && !detail.data ? (
          <div className="playlist-loading">
            <RefreshCw className="spinning" size={18} /> Загрузка…
          </div>
        ) : view === "composition" ? (
          detail.data?.entries.length ? (
            detail.data.entries.map((entry, index) => {
              const isExpanded = expanded.has(entry.id);
              const nested =
                tracks.data?.items.filter(
                  (item) => item.entryId === entry.id,
                ) || [];
              return (
                <div
                  className="playlist-entry"
                  key={entry.id}
                  draggable={playlist?.orderMode === "manual"}
                  onDragStart={() => setDragged(entry.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => dragged && void reorder(dragged, entry.id)}
                  onDragEnd={() => setDragged(null)}
                >
                  <div className="playlist-entry-main">
                    <GripVertical size={15} className="playlist-drag-handle" />
                    <span className="playlist-position">{index + 1}</span>
                    <button
                      className="playlist-expand"
                      aria-label={isExpanded ? "Свернуть" : "Развернуть"}
                      onClick={() =>
                        setExpanded((current) => {
                          const next = new Set(current);
                          if (next.has(entry.id)) next.delete(entry.id);
                          else next.add(entry.id);
                          return next;
                        })
                      }
                    >
                      {isExpanded ? (
                        <ChevronDown size={15} />
                      ) : (
                        <ChevronRight size={15} />
                      )}
                    </button>
                    {entry.snapshot.coverId ? (
                      <img
                        src={`/api/covers/${entry.snapshot.coverId}`}
                        alt=""
                      />
                    ) : (
                      <span className="playlist-entry-placeholder">
                        <ListMusic size={16} />
                      </span>
                    )}
                    <span className="playlist-entry-copy">
                      <strong>{entry.snapshot.title}</strong>
                      <small>{entry.snapshot.subtitle}</small>
                    </span>
                    <span className="playlist-entry-count">
                      {count(entry.resolvedCount)}
                    </span>
                    {entry.duplicateCount > 0 && (
                      <span
                        className="playlist-entry-warning"
                        title="Уже включены выше"
                      >
                        −{entry.duplicateCount}
                      </span>
                    )}
                    <button
                      className="icon-button"
                      aria-label="Действия элемента"
                      title="Развернуть в треки"
                      disabled={entry.kind === "track"}
                      onClick={() =>
                        void mutate(
                          `/playlists/${playlistId}/entries/${entry.id}/materialize`,
                          {},
                        )
                      }
                    >
                      <Copy size={14} />
                    </button>
                    <button
                      className="icon-button"
                      aria-label="Удалить из плейлиста"
                      onClick={() =>
                        void mutate(
                          `/playlists/${playlistId}/entries/${entry.id}`,
                          undefined,
                          "DELETE",
                        )
                      }
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                  {isExpanded &&
                    nested.map((item) => (
                      <button
                        key={item.track.id}
                        className={`playlist-nested-track ${item.track.available ? "" : "offline"}`}
                        onDoubleClick={() => onPlay(playlistId, item.track.id)}
                      >
                        <span>{item.position + 1}</span>
                        <strong>{item.track.title}</strong>
                        <small>{duration(item.track.duration)}</small>
                      </button>
                    ))}
                </div>
              );
            })
          ) : (
            <div className="playlist-empty">
              <ListMusic size={28} />
              <p>Добавьте музыку из каталога</p>
            </div>
          )
        ) : (
          <div className="playlist-track-order">
            {(tracks.data?.items || []).map((item) => (
              <button
                key={item.track.id}
                className={!item.track.available ? "offline" : ""}
                onDoubleClick={() => onPlay(playlistId, item.track.id)}
              >
                <span>{item.position + 1}</span>
                <span>
                  <strong>{item.track.title}</strong>
                  <small>
                    {(item.track.artists.length
                      ? item.track.artists
                      : item.track.albumArtists
                    ).join(", ")}{" "}
                    · {item.track.albumTitle}
                  </small>
                </span>
                <small>{duration(item.track.duration)}</small>
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="playlist-statusbar">
        <span>
          {count(playlist?.trackCount || 0)} треков ·{" "}
          {duration(tracks.data?.totalDuration || 0)}
        </span>
        {playlist?.unavailableCount ? (
          <span className="warning">
            Недоступно: {playlist.unavailableCount}
          </span>
        ) : null}
      </div>
      {syncOpen && playlist && (
        <SyncDialog
          playlist={playlist}
          onClose={() => setSyncOpen(false)}
          notify={notify}
        />
      )}
    </section>
  );
}
