import type { HTMLAttributes, ReactNode, RefObject } from "react";
import { ChevronRight, Play, Plus, RefreshCw, X } from "lucide-react";
import type {
  CatalogFilter,
  FacetRelevance,
  Job,
  Library,
} from "../shared/contracts";
import { count } from "./api";
import { librarySelectionKey } from "./location-selection";
import { ListTile } from "./ListTile";

type LibraryPanelProps = {
  libraries: Library[];
  filter: CatalogFilter;
  facetRelevance?: FacetRelevance;
  hasFacetRelevance: boolean;
  currentLibraryId?: string;
  highlightedLocations: Set<string>;
  expandedLibraryIds: Set<string>;
  activeJobs: Job[];
  listRef: RefObject<HTMLDivElement | null>;
  surfaceProps: HTMLAttributes<HTMLDivElement>;
  marquee: ReactNode;
  renderFolderLevel: (libraryId: string) => ReactNode;
  onReset: () => void;
  onToggleExpanded: (libraryId: string) => void;
  onSelect: (event: React.MouseEvent, key: string) => void;
  onContextMenu: (event: React.MouseEvent, library: Library) => void;
  onAdd: () => void;
};

export function LibraryPanel({
  libraries,
  filter,
  facetRelevance,
  hasFacetRelevance,
  currentLibraryId,
  highlightedLocations,
  expandedLibraryIds,
  activeJobs,
  listRef,
  surfaceProps,
  marquee,
  renderFolderLevel,
  onReset,
  onToggleExpanded,
  onSelect,
  onContextMenu,
  onAdd,
}: LibraryPanelProps) {
  return (
    <aside className="panel libraries-panel" data-panel-id="libraries">
      <div className="panel-heading">
        <h2>Библиотеки</h2>
        <PanelSelectionIndicator
          total={libraries.length}
          selected={filter.libraryIds.length}
          active={filter.libraryIds.length > 0 || filter.folders.length > 0}
          resetLabel="Сбросить библиотеки"
          onReset={onReset}
        />
      </div>
      <div
        className="library-list selection-surface"
        ref={listRef}
        {...surfaceProps}
      >
        {libraries.map((library) => {
          const expanded = expandedLibraryIds.has(library.id);
          const selectionKey = librarySelectionKey(library.id);
          return (
            <div key={library.id} className="library-container">
              <ListTile
                className={!library.available ? "offline" : ""}
                related={
                  hasFacetRelevance &&
                  !!facetRelevance?.libraryIds.includes(library.id)
                }
                playing={currentLibraryId === library.id}
                statusIcon={
                  currentLibraryId === library.id ? (
                    <Play size={13} fill="currentColor" />
                  ) : undefined
                }
                selected={highlightedLocations.has(selectionKey)}
                current={filter.folders.some(
                  (folder) => folder.libraryId === library.id,
                )}
                expanded={expanded}
                title={library.path}
                value={library.name}
                selectionKey={selectionKey}
                startAction={
                  <button
                    type="button"
                    className="tree-toggle"
                    data-selection-ignore
                    aria-label={`${expanded ? "Свернуть" : "Развернуть"} библиотеку «${library.name}»`}
                    aria-expanded={expanded}
                    onClick={() => onToggleExpanded(library.id)}
                  >
                    <ChevronRight
                      size={14}
                      className={`folder-chevron ${expanded ? "expanded" : ""}`}
                    />
                  </button>
                }
                suffix={count(library.trackCount)}
                onSelect={(event) => onSelect(event, selectionKey)}
                onContextMenu={(event) => onContextMenu(event, library)}
              />
              {expanded && renderFolderLevel(library.id)}
            </div>
          );
        })}
        {marquee}
      </div>
      <button className="add-library" onClick={onAdd}>
        <Plus size={16} />
        Подключить папку
      </button>
      {activeJobs.length > 0 && (
        <div className="sidebar-bottom">
          {activeJobs.slice(0, 3).map((job) => (
            <div className="scan-status" key={job.id}>
              <RefreshCw size={14} className="spinning" />
              <div>
                <strong>{job.label}</strong>
                <small>
                  {job.status === "queued"
                    ? "В очереди"
                    : `${count(job.completed)} из ${count(job.total)} обработано`}
                </small>
                {job.status === "running" && job.total > 0 && (
                  <div
                    className="scan-status-bar"
                    aria-label={`Прогресс: ${job.completed} из ${job.total}`}
                  >
                    <i
                      style={{
                        width: `${Math.min(100, Math.round((job.completed / job.total) * 100))}%`,
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </aside>
  );
}

type GenrePanelProps = {
  genres: { name: string; count: number }[];
  filter: CatalogFilter;
  facetRelevance?: FacetRelevance;
  hasFacetRelevance: boolean;
  currentPlayerGenres: Set<string>;
  highlightedGenres: Set<string>;
  listRef: RefObject<HTMLDivElement | null>;
  surfaceProps: HTMLAttributes<HTMLDivElement>;
  marquee: ReactNode;
  onReset: () => void;
  onSelect: (event: React.MouseEvent, genre: string) => void;
};

export function GenrePanel({
  genres,
  filter,
  facetRelevance,
  hasFacetRelevance,
  currentPlayerGenres,
  highlightedGenres,
  listRef,
  surfaceProps,
  marquee,
  onReset,
  onSelect,
}: GenrePanelProps) {
  return (
    <section className="panel genres-panel" data-panel-id="genres">
      <div className="panel-heading">
        <h2>Жанры</h2>
        <PanelSelectionIndicator
          total={genres.length}
          selected={filter.genres.length}
          active={filter.genres.length > 0}
          resetLabel="Сбросить жанры"
          onReset={onReset}
        />
      </div>
      <div
        className="genre-list selection-surface"
        ref={listRef}
        {...surfaceProps}
      >
        {genres.map((genre) => {
          const label = genre.name || "Без жанра";
          const playing = currentPlayerGenres.has(genre.name);
          return (
            <ListTile
              key={genre.name}
              className="genre-row"
              related={
                hasFacetRelevance &&
                !!facetRelevance?.genres.includes(genre.name)
              }
              playing={playing}
              statusIcon={
                playing ? <Play size={13} fill="currentColor" /> : undefined
              }
              selected={highlightedGenres.has(genre.name)}
              selectionKey={genre.name}
              value={label}
              suffix={count(genre.count)}
              onSelect={(event) => onSelect(event, genre.name)}
            />
          );
        })}
        {marquee}
      </div>
    </section>
  );
}

function PanelSelectionIndicator({
  total,
  selected,
  active,
  resetLabel,
  onReset,
}: {
  total: number;
  selected: number;
  active: boolean;
  resetLabel: string;
  onReset: () => void;
}) {
  if (!active) return <span className="panel-count">{count(total)}</span>;
  return (
    <div className="panel-selection-chip">
      <span>{`${count(selected)}/${count(total)}`}</span>
      <button
        className="icon-button facet-reset"
        aria-label={resetLabel}
        title={resetLabel}
        onClick={onReset}
      >
        <X size={15} />
      </button>
    </div>
  );
}
