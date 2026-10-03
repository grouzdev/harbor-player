import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  emptyFilter,
  type CatalogFilter,
  type FacetRelevance,
} from "../shared/contracts";
import { api, catalogUrl } from "./api";
import { minimalRevealScrollTop } from "./panel-scroll";
import type { SelectionChangeOptions } from "./panel-selection";

export function firstRelevantGenre(
  genres: readonly { name: string }[],
  relevant: readonly string[],
) {
  const names = new Set(relevant);
  return genres.find((genre) => names.has(genre.name))?.name;
}

// Requests originate only from artist item clicks, never from query changes.
export function useArtistGenreReveal(
  filter: CatalogFilter,
  isSearching: boolean,
  genres: readonly { name: string }[] | undefined,
  genresPending: boolean,
  releaseGenrePosition: () => void,
) {
  const [request, setRequest] = useState<{ artists: string[] } | null>(null);
  const active = useRef<typeof request>(null);
  const relevanceFilter = useMemo(
    () => ({ ...emptyFilter, artists: request?.artists ?? [] }),
    [request],
  );
  const relevance = useQuery({
    queryKey: ["facet-relevance", relevanceFilter],
    queryFn: () =>
      api<FacetRelevance>(catalogUrl("facet-relevance", relevanceFilter)),
    enabled: !!request && !isSearching,
  });
  const requestReveal = useCallback(
    (artists: string[], options?: SelectionChangeOptions) => {
      const next =
        options?.viewportAnchor?.panelId === "artists" &&
        artists.includes(options.viewportAnchor.key)
          ? { artists: [...artists] }
          : null;
      if (next) releaseGenrePosition();
      active.current = next;
      setRequest(next);
    },
    [releaseGenrePosition],
  );

  useEffect(() => {
    if (!request) return;
    const cancel = () => {
      active.current = null;
      setRequest(null);
    };
    if (
      isSearching ||
      JSON.stringify(request.artists) !== JSON.stringify(filter.artists)
    ) {
      cancel();
      return;
    }
    const surface = document.querySelector<HTMLElement>(
      '[data-panel-id="genres"] .selection-surface',
    );
    if (!surface) {
      cancel();
      return;
    }
    const onInteraction = (event: Event) => {
      if (
        event.target instanceof Node &&
        surface.closest('[data-panel-id="genres"]')?.contains(event.target)
      )
        cancel();
    };
    surface.addEventListener("scroll", cancel);
    window.addEventListener("pointerdown", onInteraction, true);
    window.addEventListener("wheel", onInteraction, true);
    window.addEventListener("keydown", onInteraction, true);
    let frame = 0;
    if (!genresPending && genres && relevance.data) {
      frame = requestAnimationFrame(() => {
        if (active.current !== request) return;
        const key = firstRelevantGenre(genres, relevance.data.genres);
        const item = [
          ...surface.querySelectorAll<HTMLElement>("[data-selection-key]"),
        ].find((row) => row.dataset.selectionKey === key);
        if (item) {
          // Drop only genre restoration. The clicked artist retains its own Y.
          releaseGenrePosition();
          const top =
            item.getBoundingClientRect().top -
            surface.getBoundingClientRect().top +
            surface.scrollTop;
          const next = minimalRevealScrollTop(
            top,
            item.getBoundingClientRect().height,
            surface.scrollTop,
            surface.clientHeight,
            surface.scrollHeight - surface.clientHeight,
          );
          surface.scrollTop = next;
        }
        cancel();
      });
    }
    return () => {
      cancelAnimationFrame(frame);
      surface.removeEventListener("scroll", cancel);
      window.removeEventListener("pointerdown", onInteraction, true);
      window.removeEventListener("wheel", onInteraction, true);
      window.removeEventListener("keydown", onInteraction, true);
    };
  }, [
    request,
    filter.artists,
    isSearching,
    genres,
    genresPending,
    relevance.data,
    releaseGenrePosition,
  ]);

  return requestReveal;
}
