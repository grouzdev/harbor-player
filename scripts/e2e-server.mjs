import { mkdir, rm, copyFile, readFile } from "node:fs/promises";
import path from "node:path";
import { createApp } from "../dist/server/app.js";
const releaseId = "11111111-1111-4111-8111-111111111111";
const missingCoverReleaseId = "99999999-9999-4999-8999-999999999999";
const groupId = "22222222-2222-4222-8222-222222222222";
const recordingIds = Array.from(
  { length: 6 },
  (_, index) =>
    `${String(index + 3).repeat(8)}-${String(index + 3).repeat(4)}-4${String(index + 3).repeat(3)}-8${String(index + 3).repeat(3)}-${String(index + 3).repeat(12)}`,
);
const release = {
  id: releaseId,
  title: "Тестовый альбом MusicBrainz",
  date: "2025-01-02",
  country: "RU",
  status: "Official",
  "artist-credit": [{ name: "Исполнитель" }],
  "release-group": { id: groupId, "first-release-date": "2025" },
  genres: [{ name: "Ambient", count: 4 }],
  media: [
    {
      position: 1,
      format: "Digital Media",
      "track-count": 6,
      tracks: recordingIds.map((id, index) => ({
        position: index + 1,
        title: `Трек ${index + 1}`,
        length: 3000,
        recording: { id, title: `Трек ${index + 1}` },
      })),
    },
  ],
  "track-count": 6,
  "cover-art-archive": { front: true, artwork: true },
};
const coverBytes = Buffer.concat([
  await readFile(path.resolve(".fixtures/cover.png")),
  Buffer.from([0]),
]);
const missingCoverRelease = {
  id: missingCoverReleaseId,
  title: "Тестовый альбом без обложки",
  "artist-credit": [{ name: "Исполнитель" }],
  "track-count": 6,
};
const musicBrainzFetch = async (input) => {
  const url = String(input);
  if (url.includes("musicbrainz.test/ws/2/release?"))
    return Response.json({
      releases: [
        { ...release, score: 100, "cover-art-archive": undefined },
        { ...missingCoverRelease, score: 90 },
      ],
    });
  if (url.includes(`musicbrainz.test/ws/2/release/${releaseId}?`))
    return Response.json(release);
  if (url.includes(`musicbrainz.test/ws/2/release-group/${groupId}?`))
    return Response.json({ genres: [{ name: "Ambient", count: 4 }] });
  if (url.endsWith(`coverart.test/release/${releaseId}`))
    return Response.json({
      images: [{ id: "123", front: true, approved: true }],
    });
  if (
    url.endsWith(`coverart.test/release/${releaseId}/123-1200`) ||
    url.endsWith(`coverart.test/release/${releaseId}/front-250`)
  )
    return new Response(coverBytes, {
      headers: { "Content-Type": "image/png" },
    });
  return Response.json({}, { status: 404 });
};
const root = path.resolve(".test-data/browser");
if (!root.startsWith(path.resolve(".test-data") + path.sep))
  throw new Error("Unsafe test path");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });
for (const browser of ["chrome", "edge"]) {
  const source = path.join(root, browser, "Downloads");
  const target = path.join(root, browser, "Collection");
  const tree = path.join(root, browser, "Tree");
  await mkdir(path.join(source, "Album"), { recursive: true });
  await mkdir(target, { recursive: true });
  await mkdir(path.join(tree, "Rock", "Album"), { recursive: true });
  await mkdir(path.join(tree, "Rock", "Live"), { recursive: true });
  await mkdir(path.join(tree, "Jazz", "Album"), { recursive: true });
  for (const format of ["mp3", "flac", "m4a", "aac", "ogg", "opus", "wav"])
    await copyFile(
      path.resolve(".fixtures", `sample.${format}`),
      path.join(source, "Album", `sample.${format}`),
    );
  await copyFile(
    path.resolve(".fixtures/cover.png"),
    path.join(source, "Album", "cover.png"),
  );
  await copyFile(
    path.resolve(".fixtures/sample.flac"),
    path.join(tree, "Rock", "Album", "album.flac"),
  );
  await copyFile(
    path.resolve(".fixtures/sample.flac"),
    path.join(tree, "Rock", "Live", "live.flac"),
  );
  await copyFile(
    path.resolve(".fixtures/sample.flac"),
    path.join(tree, "Jazz", "Album", "jazz.flac"),
  );
}
const { app } = await createApp({
  dataDir: path.join(root, "data"),
  port: 4327,
  musicBrainz: {
    fetch: musicBrainzFetch,
    apiBase: "https://musicbrainz.test/ws/2",
    coverBase: "https://coverart.test",
    minIntervalMs: 0,
  },
});
await app.listen({ host: "127.0.0.1", port: 4327 });
const close = async () => {
  await app.close();
  process.exit(0);
};
process.on("SIGINT", close);
process.on("SIGTERM", close);
