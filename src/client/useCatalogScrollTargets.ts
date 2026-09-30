import { useCallback, useRef, useState } from "react";

export type CatalogScrollTarget = {
  requestId: number;
  filterKey: string;
};

type ArtistScrollTarget = CatalogScrollTarget & { artist: string };
type GenreScrollTarget = CatalogScrollTarget & { genre: string };
type AlbumScrollTarget = CatalogScrollTarget & { album: string };
type TrackScrollTarget = CatalogScrollTarget & { track: string };

export function useCatalogScrollTargets(filterKey: string) {
  const filterKeyRef = useRef(filterKey);
  filterKeyRef.current = filterKey;
  const [artistScrollTarget, setArtistScrollTarget] =
    useState<ArtistScrollTarget | null>(null);
  const [genreScrollTarget, setGenreScrollTarget] =
    useState<GenreScrollTarget | null>(null);
  const [albumScrollTarget, setAlbumScrollTarget] =
    useState<AlbumScrollTarget | null>(null);
  const [trackScrollTarget, setTrackScrollTarget] =
    useState<TrackScrollTarget | null>(null);
  const requestArtistScroll = useCallback(
    (artist: string, targetFilterKey = filterKeyRef.current) =>
      setArtistScrollTarget((current) => ({
        artist,
        requestId: (current?.requestId || 0) + 1,
        filterKey: targetFilterKey,
      })),
    [],
  );
  const requestGenreScroll = useCallback(
    (genre: string, targetFilterKey = filterKeyRef.current) =>
      setGenreScrollTarget((current) => ({
        genre,
        requestId: (current?.requestId || 0) + 1,
        filterKey: targetFilterKey,
      })),
    [],
  );
  const requestAlbumScroll = useCallback(
    (album: string, targetFilterKey = filterKeyRef.current) =>
      setAlbumScrollTarget((current) => ({
        album,
        requestId: (current?.requestId || 0) + 1,
        filterKey: targetFilterKey,
      })),
    [],
  );
  const requestTrackScroll = useCallback(
    (track: string, targetFilterKey = filterKeyRef.current) =>
      setTrackScrollTarget((current) => ({
        track,
        requestId: (current?.requestId || 0) + 1,
        filterKey: targetFilterKey,
      })),
    [],
  );
  return {
    filterKeyRef,
    artistScrollTarget,
    genreScrollTarget,
    albumScrollTarget,
    trackScrollTarget,
    requestArtistScroll,
    requestGenreScroll,
    requestAlbumScroll,
    requestTrackScroll,
  };
}
