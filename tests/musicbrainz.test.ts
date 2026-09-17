import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { Catalog } from "../dist/server/database.js";
import {
  escapeLucene,
  MusicBrainzService,
} from "../dist/server/musicbrainz.js";
import type { Track } from "../src/shared/contracts.js";

const releaseId = "11111111-1111-4111-8111-111111111111";
const groupId = "22222222-2222-4222-8222-222222222222";
const recordingOne = "33333333-3333-4333-8333-333333333333";
const recordingTwo = "44444444-4444-4444-8444-444444444444";
let root: string;
let catalog: Catalog;

beforeEach(async () => {
  await mkdir(".test-data", { recursive: true });
  root = await mkdtemp(path.resolve(".test-data", "musicbrainz-"));
  catalog = new Catalog(root);
  catalog.addLibrary("Music", path.join(root, "Music"));
});

afterEach(async () => {
  catalog.close();
  await rm(root, { recursive: true, force: true });
});

function addTrack(overrides: Partial<Track>): Track {
  const library = catalog.libraries()[0];
  const track: Track = {
    id: String(overrides.id || crypto.randomUUID()),
    libraryId: library.id,
    relativePath: "Artist/Album/01 Track.flac",
    title: "Track",
    artists: ["Artist"],
    albumTitle: "Album",
    albumArtists: ["Artist"],
    albumKey: "album",
    genres: [],
    year: null,
    trackNumber: null,
    discNumber: null,
    duration: 180,
    format: "flac",
    size: 1,
    mtimeMs: 1,
    coverId: null,
    available: true,
    missingTagFields: ["genres", "year", "trackNumber", "discNumber", "cover"],
    ...overrides,
  };
  catalog.upsert(track);
  return track;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

describe("MusicBrainz client", () => {
  it("escapes Lucene syntax", () => {
    expect(escapeLucene('AC/DC: "Live"')).toBe('AC\\/DC\\: \\"Live\\"');
  });

  it("serializes requests and reuses the search cache", async () => {
    const track = addTrack({ id: "one" });
    const times: number[] = [];
    const fetcher = vi.fn(async () => {
      times.push(Date.now());
      return json({ recordings: [] });
    }) as unknown as typeof fetch;
    const service = new MusicBrainzService(catalog, root, {
      fetch: fetcher,
      minIntervalMs: 30,
    });
    const selection = { trackIds: [track.id] };
    await Promise.all([
      service.search(selection, { title: "First", artist: "Artist" }),
      service.search(selection, { title: "Second", artist: "Artist" }),
    ]);
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(25);
    await service.search(selection, { title: "First", artist: "Artist" });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(
      (fetcher.mock.calls[0][1]?.headers as Record<string, string>)[
        "User-Agent"
      ],
    ).toContain("HarborPlayer/0.1.0");
  });

  it("retries a throttled MusicBrainz response", async () => {
    const track = addTrack({ id: "retry" });
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt++;
      return attempt === 1
        ? new Response(null, { status: 503, headers: { "Retry-After": "0" } })
        : json({ recordings: [] });
    }) as unknown as typeof fetch;
    const service = new MusicBrainzService(catalog, root, {
      fetch: fetcher,
      minIntervalMs: 0,
    });
    await expect(
      service.search(
        { trackIds: [track.id] },
        { title: "Track", artist: "Artist" },
      ),
    ).resolves.toMatchObject({ candidates: [] });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("provides a lazy thumbnail URL even when search results omit cover art", async () => {
    const track = addTrack({ id: "thumbnail-search" });
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes("/recording?"))
        return json({
          recordings: [
            {
              id: recordingOne,
              score: 100,
              releases: [{ id: releaseId, title: "Album" }],
            },
          ],
        });
      return json({}, 404);
    }) as unknown as typeof fetch;
    const service = new MusicBrainzService(catalog, root, {
      fetch: fetcher,
      minIntervalMs: 0,
    });

    await expect(
      service.search(
        { trackIds: [track.id] },
        { title: "Track", artist: "Artist" },
      ),
    ).resolves.toMatchObject({
      candidates: [
        {
          releaseId,
          thumbnailUrl: `/api/metadata/musicbrainz/thumbnail/${releaseId}`,
        },
      ],
    });
  });

  it("caches a missing thumbnail from Cover Art Archive", async () => {
    const fetcher = vi.fn(async () => json({}, 404)) as unknown as typeof fetch;
    const service = new MusicBrainzService(catalog, root, {
      fetch: fetcher,
      minIntervalMs: 0,
    });

    await expect(service.thumbnail(releaseId)).resolves.toBeNull();
    await expect(service.thumbnail(releaseId)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("builds per-track album proposals and downloads an exact front cover", async () => {
    const first = addTrack({
      id: "one",
      title: "01 First",
      relativePath: "Artist/Album/01 First.flac",
      missingTagFields: [
        "title",
        "genres",
        "year",
        "trackNumber",
        "discNumber",
        "cover",
      ],
    });
    const second = addTrack({
      id: "two",
      title: "Second",
      relativePath: "Artist/Album/02 Second.flac",
      duration: 200,
      missingTagFields: [
        "genres",
        "year",
        "trackNumber",
        "discNumber",
        "cover",
      ],
    });
    const release = {
      id: releaseId,
      title: "Album",
      date: "2020-05-01",
      country: "GB",
      status: "Official",
      "artist-credit": [{ name: "Artist" }],
      "release-group": { id: groupId, "first-release-date": "2019" },
      genres: [{ name: "Rock", count: 2 }],
      media: [
        {
          position: 1,
          format: "Digital Media",
          "track-count": 2,
          tracks: [
            {
              position: 1,
              title: "First",
              length: 180000,
              recording: { id: recordingOne, title: "First" },
            },
            {
              position: 2,
              title: "Second",
              length: 200000,
              recording: { id: recordingTwo, title: "Second" },
            },
          ],
        },
      ],
      "cover-art-archive": { front: true },
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/release/${releaseId}?`)) return json(release);
      if (url.includes(`/release-group/${groupId}?`))
        return json({ genres: [{ name: "Alternative Rock", count: 4 }] });
      if (url.endsWith(`/release/${releaseId}`))
        return json({ images: [{ id: "123", front: true, approved: true }] });
      if (url.endsWith(`/release/${releaseId}/123-1200`))
        return new Response(Uint8Array.from([255, 216, 255, 0]));
      return json({}, 404);
    }) as unknown as typeof fetch;
    const service = new MusicBrainzService(catalog, root, {
      fetch: fetcher,
      minIntervalMs: 0,
    });
    const proposal = await service.proposal(
      { trackIds: [first.id, second.id] },
      releaseId,
    );
    expect(proposal.items.map((item) => item.patch?.title)).toEqual([
      "First",
      "Second",
    ]);
    expect(proposal.items[0].match).toBe("title-duration");
    expect(proposal.items[1].patch?.genres).toEqual([
      "Alternative Rock",
      "Rock",
    ]);
    expect(proposal.items[1].patch?.trackNumber).toBe(2);
    expect(proposal.cover?.source).toBe("release");
    expect(proposal.cover?.id).toMatch(/^[a-f0-9]{64}\.jpg$/);
  });

  it("labels a release-group cover as a fallback", async () => {
    const track = addTrack({ id: "fallback" });
    const detail = {
      id: releaseId,
      title: "Album",
      "artist-credit": [{ name: "Artist" }],
      "release-group": { id: groupId },
      media: [
        {
          position: 1,
          tracks: [
            {
              position: 1,
              title: "Track",
              length: 180000,
              recording: { id: recordingOne, title: "Track" },
            },
          ],
        },
      ],
    };
    const fetcher = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes(`/release/${releaseId}?`)) return json(detail);
      if (url.includes(`/release-group/${groupId}?`))
        return json({ genres: [] });
      if (url.endsWith(`/release/${releaseId}`)) return json({}, 404);
      if (url.endsWith(`/release-group/${groupId}`))
        return json({ images: [{ id: "group", front: true, approved: true }] });
      if (url.endsWith(`/release-group/${groupId}/front-1200`))
        return new Response(Uint8Array.from([255, 216, 255, 0]));
      return json({}, 404);
    }) as unknown as typeof fetch;
    const service = new MusicBrainzService(catalog, root, {
      fetch: fetcher,
      minIntervalMs: 0,
    });
    const proposal = await service.proposal(
      { trackIds: [track.id] },
      releaseId,
      recordingOne,
    );
    expect(proposal.cover?.source).toBe("release-group");
    expect(proposal.cover?.warning).toContain("другому изданию");
  });
});
