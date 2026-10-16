# Short actual playback / synthetic storage comparison

`npm run test:pulse:process` retains per-browser `storage.json` and
`outbox.json` and `outage.json` in its owned `.test-data/pulse-process-*` directory, alongside
the existing result and server log. By default it uses two genuine generated-WAV
playback windows, not synthetic listening-event seeds.

Storage phases distinguish baseline, acknowledged recorder checkpoints,
offline checkpoint/final outbox (not yet ingested), acknowledged finals, and
duplicate-final/stale-checkpoint retry. The online checkpoint adds roughly
15 seconds per browser to the previous harness. `checkpoint` here means a
recorder revision, not `PRAGMA wal_checkpoint`: the observer does not force
SQLite checkpointing or truncate WAL.

Both 60-second WAVs are fully buffered before playback. Before stopping the
server, the harness requires an empty online IndexedDB outbox and retains the
accepted per-event revision/playedMs and both audio positions. During the outage,
each event must produce a newer pending checkpoint with over 15,000 additional
played milliseconds; each unchanged audio source must also progress over 15
seconds from its post-stop position. Wall-clock outage must independently exceed
15 seconds. `outage.json` retains these baselines and offline observations.
The authoritative event cutoff is read after the server stops: each later
checkpoint must exceed both the accepted ledger revision/duration and any
pending revision/duration already present at that cutoff. This excludes a
commit or queued event racing with the earlier online observation.

Each sample retains the exact raw interval ledger, visits and all three
aggregate layers, with `verifySums` inside the read-only logical transaction
checking ledger day contributions against every day/album allocation and
per-day/per-album totals, not only global sums.
Required day and album-stat key/value sets are also compared symmetrically
against the ledger, so missing rows replaced by orphan rows cannot pass.
SQLite,
WAL and SHM byte sizes are sequential filesystem samples (missing is `null`),
not an atomic physical snapshot or peak measurement. Cover image count/bytes
and staging entry count reuse the ingest benchmark's artwork accounting.
Without an opt-in manifest, generated WAV fixtures have no artwork: zero archived
covers remains useful baseline evidence, not a permitted-originals test.

## Opt-in permitted originals: actual storage

Use the existing version-1 `{ "version": 1, "permitted": true, "files": [...] }`
manifest and `HARBOR_PLAYER_UI_ARTWORK_MANIFEST`; paths are relative to the
manifest. No second manifest format or synthetic event seed is used.

```sh
HARBOR_PLAYER_UI_ARTWORK_MANIFEST=.test-data/pulse-permitted-originals/manifest-storage-a.json npm run test:pulse:process
```

The npm command builds first; direct `node scripts/pulse-process-check.mjs`
uses the already-built server/client without rebuilding.
The operator owns original selection/permission, copying, measurement runs and
the report. Keep originals, manifests containing private paths, profiles, traces
and raw artifacts under ignored `.test-data`, never committed or published.

The harness reuses the bounded manifest loader (10 MiB per original, matching the
production scanner, 128 MiB total), deduplicates content IDs, and requires
two to four distinct decodable JPEG/PNG originals. Split larger selections into
multiple version-1 manifests. Each window holds a persistent HTTP/1 SSE
connection: leave browser connection capacity for catalog, audio and recorder
delivery rather than increasing timeouts. Each original becomes a unique album in
a generated WAV via RIFF `id3 ` / ID3v2.3 APIC. Original APIC image bytes are not
transcoded. The normal library scan must recover the exact hash into `covers`;
there are no track/event DB writes. There is one genuine prebuffered playback
window per distinct original per browser, so resource cost grows with the cohort.
The no-manifest scenario remains the original two windows.

All but the last original exercise first-copy at acknowledged recorder
checkpoints, then already-existing archives at final delivery and retries. The
last original's scanned cache file is withheld before listening starts: real
checkpoints must still reach SQLite, while its archive remains absent and its
cover HTTP request returns 404. Only after the API stops is that same cache file
restored; the durable final then recovers the archive after server/browser
restart. Exact SHA-256 archive equality is required again after duplicate-final
and stale-checkpoint retries; exact ledger/day/album sums and retained album
titles are checked independently of artwork.

`storage.json` adds original hash/size/dimension/decode provenance, cover HTTP
status/body bytes/elapsed transfer time, and SQLite `dbstat` bytes/pages per
table/index (allocated pages, not logical row payload). `http-storage-*.json`
retains parent-clock actual ingest HTTP intervals, concurrent `/api/libraries`
reads and sampled staging entries/bytes. It reuses `batchReadEvidence` to
calculate actual interval overlap and overlapping catalog-read p95. Compare
**that catalog-read p95** with the <50 ms guideline, not ingest ACK latency.
No overlap means NOT MEASURED, not PASS; this short workload cannot guarantee
enough samples for a stable tail estimate. Staging samples must stay within
four active copies and the supplied total original bytes, and final quiescent
staging must drain to zero. Sampling can miss brief copies; it is not a peak.

Transfer time includes HTTP/body collection, not browser decode or GPU/native
memory. Manifest `sharp-raw` decode is fixture validation, not browser decode
evidence. Missing/corrupt UI rendering, image/GPU/native memory and 30/365-day
model comparison remain separate operator evidence. This harness proves
missing-source ingestion/recovery, not every original in every scenario, OS
sleep, physical FAT/exFAT publication, or a year of actual playback.

Compare baseline-to-final size deltas, interval/day/album/visit cardinality,
played milliseconds, and unchanged logical totals after retry against the
30/365-day ingest model's corresponding fields. Do not multiply this short
run into a measured yearly total: SQLite page allocation, indexes, WAL reuse,
deduplicated covers and calendar distribution do not grow linearly. WAL peaks
from a model must not be equated with these sampled sizes. Retain the measured
build's SHA/dirty status and executable identity alongside any comparison.
The retained provenance includes SHA/dirty state, source and dist artifact
SHA-256 hashes (including generated build info when present), Node executable
hash/version and browser version in each browser's storage/result evidence.
New permitted-original measurements are recorded in
[the originals report](measurements/pulse-originals.md), not in this methodology.

## Separate image diagnostic and actual UI failure checks

```sh
node scripts/pulse-artwork-diagnostic.mjs --foreground --manifest .test-data/pulse-permitted-originals/manifest.json
node scripts/pulse-process-cover-ui.mjs --data-dir .test-data/pulse-process-<run>/chrome/data --channel chrome
```

The first command requires explicit foreground authorization, supports Windows
owned-tree cleanup, uses installed Electron against the built workspace by
default, and creates a separate aggregate UI fixture. A labeled overlay displays
up to 12 originals; it does not stand in for actual recorder events or Pulse
card readiness. HTTP body/MIME/SHA-256 verification and browser decode timing are
separate. Three before/decoded/idle samples retain full native KiB process
metrics, detailed Chromium allocator byte scalars and Windows per-process GPU
dedicated/shared/committed bytes. These counters overlap: never sum allocator
hierarchies, infer dedicated VRAM from working set, or infer a leak from this short
instrumented run. No forced GC; detailed dump loss/failure stops the cohort.

The second command copies an accepted, stopped actual-process fixture into a
fresh isolated data directory, then checks the real Pulse title/statistics and
image fallback with normal, missing and corrupt archive/cache bytes. It neither
seeds events nor edits the source database. Repeat with `msedge` and its fixture
to check both browsers. A read-only ownership lock rejects live sources and
prevents their server from starting during the check. SQLite/WAL and logical
Pulse snapshots must match before/after copying and remain unchanged at teardown;
a mismatch fails acceptance. The UI navigates to the latest populated day, even
when the history range extends past the playback date to today.
Raw profiles, HTML failures and traces remain local.

## Validation

```sh
npx vitest run tests/pulse-playback-storage.test.ts
npm run test:pulse:process
```

The second command builds and runs Chrome and Edge. The helper regression is
also included in `npm test` and CI. Syntax and formatting checks alone do not
establish runtime acceptance.
