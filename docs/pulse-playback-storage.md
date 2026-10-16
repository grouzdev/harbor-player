# Short actual playback / synthetic storage comparison

`npm run test:pulse:process` retains per-browser `storage.json` and
`outbox.json` and `outage.json` in its owned `.test-data/pulse-process-*` directory, alongside
the existing result and server log. It uses two genuine generated-WAV playback
windows, not synthetic listening-event seeds.

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
Generated WAV fixtures currently have no artwork: zero archived covers is
useful baseline evidence, not a permitted-originals test.

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
No actual new measurements or permitted-original results are recorded here.

## Validation

```sh
npx vitest run tests/pulse-playback-storage.test.ts
npm run test:pulse:process
```

The second command builds and runs Chrome and Edge. The helper regression is
also included in `npm test` and CI. Syntax and formatting checks alone do not
establish runtime acceptance.
