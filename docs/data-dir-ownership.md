# Data-directory ownership

`MusicService` acquires ownership before opening the catalog, workers, or recovery.
The lifetime handle is a dedicated `better-sqlite3` connection to
`server-ownership.sqlite`, with timeout zero, rollback-journal (`delete`) mode,
and an open `BEGIN EXCLUSIVE` transaction. Closing that connection releases
ownership; process death releases the operating-system locks. There is no
PID-liveness decision, stale-file deletion, lease, or heartbeat.

The ownership database is intentionally independent of the catalog: catalog
transactions and checkpoints must not release service ownership. It is persistent
and **must never be removed or replaced**, including after a crash. Unlinking an
open lock database could split contenders across different file objects. Release
is idempotent and never deletes or rewrites either ownership file.

This uses the project's existing native SQLite dependency, with its existing
requirement for reliable SQLite filesystem locking. No additional native package
or filesystem allow-list is introduced. Broken/advisory-lock-incompatible network
filesystems are not made safe by this protocol; neither would the catalog be safe
there. Node/Electron use the same SQLite binding. Platform execution evidence is
separate from that design rationale; a Windows run does not prove POSIX,
Electron-packaged, or physical FAT/exFAT behavior.

## Legacy binaries and migration

`server.lock` is now a permanent exact protocol marker:

```text
{"protocol":"harbor-sqlite-ownership-v1"}
```

The stored representation includes one trailing newline. Old binaries require
a positive integer `pid`; they reject this marker instead of attempting stale
takeover. New binaries create it exclusively, under SQLite ownership, and accept
only the exact representation. It remains after normal release and crashes.
Failure or a crash during marker creation can leave incomplete contents: those
contents are preserved and startup fails closed.

An existing legacy PID lock is **never automatically migrated**, even if its PID
appears dead. A previous binary may be paused between its stale-PID observation
and unlink; automatically replacing that file cannot safely exclude it.
Malformed, unknown, unreadable, incomplete, or live legacy locks likewise prevent
startup without deleting data.

Manual migration requires an operator to stop **all** old service/app processes
and automatic-restart supervisors, including suspended instances, and prevent concurrent
old-version starts throughout migration. Only after establishing that offline
boundary may the operator preserve the old `server.lock` elsewhere and remove
that legacy file from the isolated directory being migrated. The next new-version
startup creates the permanent guard. Do not remove `server-ownership.sqlite`,
catalog files, journals, artwork, or staging. No automatic migration command is
provided, and this change does not modify a working user profile.

Once migrated, downgrade is not transparent: the permanent marker deliberately
blocks old binaries. Removing it while any new owner is running is unsafe.
Manual edits/replacement of ownership files and malicious filesystem mutation
are outside the ownership guarantee.

## Failure behavior

One winner holds the exclusive transaction. Losers receive an error before
`MusicService` opens its catalog or starts recovery. SQLite busy maps to the
existing "already running" diagnostic; permission, corruption, unexpected journal
mode, and marker-validation failures propagate rather than permit startup.
Crashing after SQLite acquisition but before marker creation releases ownership;
a later new process may retry. Crashing after a partial marker write releases
the OS lock but leaves startup blocked for explicit operator investigation.

This protocol does not implement staging recovery.
