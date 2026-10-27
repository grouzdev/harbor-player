import type { DragEvent } from "react";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { z } from "zod";
import {
  PlaylistEntityCopy,
  type PlaylistEntityLabel,
} from "./PlaylistEntityCopy";

export const catalogDragType = "application/x-harbor-catalog-selection";
export const playlistDragType = "application/x-harbor-playlist-entry";
const payloadSchema = z
  .object({
    kind: z.enum(["genre", "artist", "album", "track"]),
    ids: z.array(z.string()).min(1).max(10000),
  })
  .strict();
export type CatalogDragPayload = z.infer<typeof payloadSchema>;

// The ordered data source, not the mounted virtual rows or Ctrl-click order,
// determines the insertion order. A non-selected source is dragged alone.
export function resolveDragIds(
  ordered: readonly string[],
  selected: readonly string[],
  target: string,
) {
  if (!selected.includes(target)) return [target];
  const keys = new Set(selected);
  return [...new Set(ordered)].filter((id) => keys.has(id));
}

export function readCatalogDrag(transfer: Pick<DataTransfer, "getData">) {
  try {
    const result = payloadSchema.safeParse(
      JSON.parse(transfer.getData(catalogDragType)),
    );
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

export function acceptsPlaylistDrop(transfer: Pick<DataTransfer, "types">) {
  return (
    transfer.types.includes(catalogDragType) ||
    transfer.types.includes(playlistDragType)
  );
}

let dismissPreview: (() => void) | undefined;

export function startCatalogDrag(
  event: DragEvent,
  payload: CatalogDragPayload,
  labels: PlaylistEntityLabel[],
) {
  dismissPreview?.();
  event.dataTransfer.setData(catalogDragType, JSON.stringify(payload));
  event.dataTransfer.effectAllowed = "copy";
  const preview = document.createElement("div");
  preview.className = "catalog-drag-preview";
  preview.setAttribute("aria-hidden", "true");
  document.body.append(preview);
  const root = createRoot(preview);
  flushSync(() =>
    root.render(
      <>
        {labels.slice(0, 5).map((label, index) => (
          <div className="playlist-entity-main" key={index}>
            <PlaylistEntityCopy {...label} />
          </div>
        ))}
        {payload.ids.length > 5 ? (
          <div className="catalog-drag-more">Ещё {payload.ids.length - 5}</div>
        ) : null}
      </>,
    ),
  );
  // Native drag images are faded by the browser/OS. Keep the actual preview
  // in the document so text and background remain fully opaque.
  const transparent = document.createElement("canvas");
  transparent.width = transparent.height = 1;
  event.dataTransfer.setDragImage(transparent, 0, 0);
  const position = (x: number, y: number) => {
    preview.style.left = `${Math.max(8, Math.min(x + 20, window.innerWidth - preview.offsetWidth - 8))}px`;
    preview.style.top = `${Math.max(8, Math.min(y + 20, window.innerHeight - preview.offsetHeight - 8))}px`;
  };
  position(event.clientX, event.clientY);
  const follow = (next: globalThis.DragEvent) => {
    // Some platforms send a final drag event at (0, 0).
    if (next.clientX || next.clientY) position(next.clientX, next.clientY);
  };
  const dismiss = () => {
    window.removeEventListener("dragover", follow, true);
    window.removeEventListener("drag", follow, true);
    window.removeEventListener("drop", dismiss, true);
    window.removeEventListener("dragend", dismiss, true);
    window.removeEventListener("blur", dismiss);
    window.removeEventListener("keydown", onKeyDown, true);
    root.unmount();
    preview.remove();
    dismissPreview = undefined;
  };
  const onKeyDown = (next: KeyboardEvent) => {
    if (next.key === "Escape") dismiss();
  };
  dismissPreview = dismiss;
  window.addEventListener("dragover", follow, true);
  window.addEventListener("drag", follow, true);
  window.addEventListener("drop", dismiss, true);
  window.addEventListener("dragend", dismiss, true);
  window.addEventListener("blur", dismiss);
  window.addEventListener("keydown", onKeyDown, true);
}
