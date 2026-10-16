import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

// Permanent guard against older binaries, which require a positive integer PID.
// Neither this marker nor the SQLite file may be removed on release.
const marker = '{"protocol":"harbor-sqlite-ownership-v1"}\n';

export function acquireInstanceLock(dataDir: string): () => void {
  mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, "server.lock");
  const db = new Database(path.join(dataDir, "server-ownership.sqlite"), {
    timeout: 0,
  });
  try {
    // Rollback-journal EXCLUSIVE holds the OS-managed lock until close, including
    // in an otherwise empty database. WAL would not provide this exclusion.
    if (db.pragma("journal_mode", { simple: true }) !== "delete")
      throw new Error("Неожиданный journal_mode блокировки каталога");
    db.exec("BEGIN EXCLUSIVE");
    try {
      writeFileSync(file, marker, { flag: "wx" });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      if (readFileSync(file, "utf8") !== marker)
        throw new Error(
          `Неподдерживаемая или неполная блокировка ${file}. Автоматический takeover запрещён. Остановите все старые экземпляры Harbor Player перед ручной миграцией блокировки.`,
        );
    }
  } catch (error) {
    db.close();
    if ((error as { code?: string }).code === "SQLITE_BUSY")
      throw new Error(
        "Harbor Player уже запущен с этим каталогом данных. Откройте существующее окно браузера.",
        { cause: error },
      );
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    db.close();
    released = true;
  };
}
